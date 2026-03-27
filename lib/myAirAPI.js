/* eslint-disable linebreak-style */

'use strict';

const http = require('http');
const timers = require('timers');

const DEFAULT_COMMAND_THROTTLE_ENABLED = false;
const DEFAULT_COMMAND_THROTTLE_DELAY_MS = 500;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 500;

const queuedWrites = [];
const inFlightMyAirDataRequests = new Map();
let isDrainingQueue = false;

function logMessage(log, ...args) {
  if (typeof log === 'function') {
    log(...args);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

function normalizeErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.message) {
    return error.message;
  }

  return `${error}`;
}

function getBooleanSetting(homey, key, defaultValue) {
  if (!homey || !homey.settings || typeof homey.settings.get !== 'function') {
    return defaultValue;
  }

  return homey.settings.get(key) === true;
}

function getIntegerSetting(homey, key, defaultValue) {
  if (!homey || !homey.settings || typeof homey.settings.get !== 'function') {
    return defaultValue;
  }

  const value = Number.parseInt(homey.settings.get(key), 10);
  if (!Number.isFinite(value) || value < 0) {
    return defaultValue;
  }

  return value;
}

function getCommandThrottleEnabled(homey) {
  return getBooleanSetting(homey, 'commandThrottleEnabled', DEFAULT_COMMAND_THROTTLE_ENABLED);
}

function getCommandThrottleDelayMs(homey) {
  return getIntegerSetting(homey, 'commandThrottleDelayMs', DEFAULT_COMMAND_THROTTLE_DELAY_MS);
}

function getRetryCount(homey) {
  return getIntegerSetting(homey, 'retryCount', DEFAULT_RETRY_COUNT);
}

function getRetryDelayMs(homey) {
  return getIntegerSetting(homey, 'retryDelayMs', DEFAULT_RETRY_DELAY_MS);
}

async function waitForDelay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  await wait(ms);
}

async function reportCommunicationFailure(homey, source, error) {
  if (!homey || !homey.app || typeof homey.app.reportCommunicationFailure !== 'function') {
    return;
  }

  try {
    await homey.app.reportCommunicationFailure(source, normalizeErrorMessage(error));
  } catch (reportError) {
    const message = normalizeErrorMessage(reportError);
    logMessage(homey.error && homey.error.bind(homey), `Failed to report communication failure: ${message}`);
  }
}

function buildRetryLabel(source) {
  if (source === 'polling') {
    return 'MyAir polling';
  }

  return 'MyAir command';
}

async function runWithRetries({
  homey,
  source,
  log,
  operation,
  reportFailure,
}) {
  const retryCount = getRetryCount(homey);

  for (let attemptNumber = 0; attemptNumber <= retryCount; attemptNumber += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attemptNumber >= retryCount) {
        if (reportFailure) {
          await reportCommunicationFailure(homey, source, error);
        }
        throw error;
      }

      const retryDelayMs = getRetryDelayMs(homey);
      const humanAttempt = attemptNumber + 1;
      const message = normalizeErrorMessage(error);
      logMessage(
        log,
        `${buildRetryLabel(source)} attempt ${humanAttempt} failed. Retrying ${humanAttempt} of ${retryCount} in ${retryDelayMs}ms: ${message}`,
      );
      await waitForDelay(retryDelayMs);
    }
  }

  throw new Error('MyAir request retry loop exited unexpectedly');
}

function requestJson({
  ipAddress,
  path,
  timeout,
  log,
  logRequest,
  parseErrorPrefix,
  validateResponse,
}) {
  return new Promise((resolve, reject) => {
    if (!ipAddress) {
      reject(new Error('MyAir IP address is not configured'));
      return;
    }

    const options = {
      hostname: ipAddress,
      port: 2025,
      path,
      method: 'GET',
    };

    if (Number.isFinite(timeout) && timeout > 0) {
      options.timeout = timeout;
    }

    if (logRequest) {
      logMessage(log, path);
      logMessage(log, options);
    }

    const req = http.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const snippet = responseBody ? ` Body: ${responseBody.slice(0, 200)}` : '';
            reject(new Error(`MyAir responded with status ${res.statusCode}.${snippet}`));
            return;
          }

          const responseJson = JSON.parse(responseBody);
          if (typeof validateResponse === 'function') {
            const validationError = validateResponse(responseJson, res);
            if (validationError) {
              reject(new Error(validationError));
              return;
            }
          }

          resolve(responseJson);
        } catch (error) {
          reject(new Error(`${parseErrorPrefix}: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy(new Error('MyAir data request timed out'));
    });

    req.end();
  });
}

function isSetAirconCommand(command) {
  return typeof command === 'string' && command.startsWith('/setAircon');
}

async function waitForInterCommandDelay(homey) {
  const delayMs = getCommandThrottleDelayMs(homey);
  await waitForDelay(delayMs);
  return delayMs;
}

async function sendImmediateCommand(ipAddress, command, log, homey) {
  await runWithRetries({
    homey,
    source: 'command',
    log,
    reportFailure: true,
    operation: async () => {
      await requestJson({
        ipAddress,
        path: command,
        log,
        logRequest: true,
        parseErrorPrefix: 'Error parsing response',
        validateResponse: (responseJson) => {
          if (responseJson.ack === true && responseJson.request === 'setAircon') {
            return null;
          }

          return 'Invalid response received from MyAir';
        },
      });
    },
  });
}

async function executeQueuedWrite(job, shouldWaitBeforeSend) {
  if (shouldWaitBeforeSend) {
    const delayMs = await waitForInterCommandDelay(job.homey);
    logMessage(job.log, `MyAir command queue waited ${delayMs}ms before sending next command.`);
  }

  try {
    logMessage(job.log, `MyAir command queue sending command. Remaining queued commands: ${queuedWrites.length}`);
    await sendImmediateCommand(job.ipAddress, job.command, job.log, job.homey);
    job.resolve();
  } catch (error) {
    job.reject(error);
  }
}

async function drainQueuedWrites() {
  if (isDrainingQueue) {
    return;
  }

  if (queuedWrites.length > 0) {
    logMessage(queuedWrites[0].log, `MyAir command queue starting drain with ${queuedWrites.length} queued command(s).`);
  }

  isDrainingQueue = true;

  let shouldWaitBeforeSend = false;

  while (queuedWrites.length > 0) {
    const job = queuedWrites.shift();
    await executeQueuedWrite(job, shouldWaitBeforeSend);
    shouldWaitBeforeSend = true;
  }

  isDrainingQueue = false;

  if (queuedWrites.length > 0) {
    await drainQueuedWrites();
  }
}

function enqueueCommand(job) {
  return new Promise((resolve, reject) => {
    queuedWrites.push({
      homey: job.homey,
      ipAddress: job.ipAddress,
      command: job.command,
      log: job.log,
      resolve,
      reject,
    });

    logMessage(job.log, `MyAir command queued. Queue depth is now ${queuedWrites.length}.`);

    drainQueuedWrites().catch((error) => {
      const message = normalizeErrorMessage(error);
      logMessage(job.log, `Command queue stopped unexpectedly: ${message}`);
    });
  });
}

async function sendCommandToMyAir(ipAddress, command, log, homey) {
  if (!isSetAirconCommand(command)) {
    logMessage(log, 'MyAir command throttling skipped because this is not a /setAircon command.');
    await sendImmediateCommand(ipAddress, command, log, homey);
    return;
  }

  const shouldUseQueue = getCommandThrottleEnabled(homey) || isDrainingQueue || queuedWrites.length > 0;

  if (!shouldUseQueue) {
    logMessage(log, 'MyAir command throttling disabled; sending command immediately.');
    await sendImmediateCommand(ipAddress, command, log, homey);
    return;
  }

  logMessage(log, 'MyAir command throttling enabled; command will be sent through the queue.');
  await enqueueCommand({
    homey,
    ipAddress,
    command,
    log,
  });
}

async function fetchMyAirData(homey, ipAddress, timeout, log) {
  const requestKey = `${ipAddress || 'unknown'}:${timeout || 0}`;
  if (inFlightMyAirDataRequests.has(requestKey)) {
    return inFlightMyAirDataRequests.get(requestKey);
  }

  const requestPromise = runWithRetries({
    homey,
    source: 'polling',
    log,
    reportFailure: true,
    operation: async () => requestJson({
      ipAddress,
      path: '/getSystemData',
      timeout,
      log,
      logRequest: false,
      parseErrorPrefix: 'Error parsing MyAir data',
    }),
  });

  inFlightMyAirDataRequests.set(requestKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    if (inFlightMyAirDataRequests.get(requestKey) === requestPromise) {
      inFlightMyAirDataRequests.delete(requestKey);
    }
  }
}

module.exports = {
  fetchMyAirData,
  sendCommandToMyAir,
};
