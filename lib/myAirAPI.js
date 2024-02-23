/* eslint-disable linebreak-style */

'use strict';

const http = require('http');

async function sendCommandToMyAir(ipAddress, command, log) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ipAddress,
      port: 2025,
      path: command,
      method: 'GET',
    };

    log(command);
    log(options);

    const req = http.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          const responseJson = JSON.parse(responseBody);
          if (res.statusCode === 200 && responseJson.ack === true && responseJson.request === 'setAircon') {
            resolve();
          } else {
            reject(new Error('Invalid response or non-200 status code received'));
          }
        } catch (error) {
          reject(new Error(`Error parsing response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

module.exports = {
  sendCommandToMyAir,
};
