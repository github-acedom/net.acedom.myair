'use strict';

const { Driver } = require('homey');
const http = require('http');
const { fetchMyAirData: fetchMyAirDataRequest } = require('../../lib/myAirAPI');

const COMMUNICATION_FAILURE_INTERVAL_MS = 60 * 60 * 1000;

class MyAirControlDriver extends Driver {

  mapMyAirModeToCapability(mode) {
    if (mode === 'vent') {
      return 'fan';
    }

    return mode;
  }

  async fetchMyAirData(ipAddress) {
    const timeout = this.requestTimeout || 5000;
    return fetchMyAirDataRequest(this.homey, ipAddress, timeout, this.log.bind(this));
  }

  getCommunicationFailureState(device) {
    const deviceId = device.getData().id;
    if (!this._communicationFailureStates) {
      this._communicationFailureStates = new Map();
    }

    if (!this._communicationFailureStates.has(deviceId)) {
      this._communicationFailureStates.set(deviceId, {
        lastTriggeredAt: 0,
        counts: {
          polling: 0,
          command: 0,
        },
        lastError: '',
      });
    }

    return this._communicationFailureStates.get(deviceId);
  }

  buildCommunicationFailureSummary(counts) {
    const parts = [];

    if (counts.polling > 0) {
      parts.push(`${counts.polling} polling failure${counts.polling === 1 ? '' : 's'}`);
    }

    if (counts.command > 0) {
      parts.push(`${counts.command} command failure${counts.command === 1 ? '' : 's'}`);
    }

    if (parts.length === 0) {
      return '0 failures this period';
    }

    return `${parts.join(', ')} this period`;
  }

  async triggerCommunicationFailure(device, source, state) {
    if (!this._communicationFailureTrigger) {
      this._communicationFailureTrigger = this.homey.flow.getDeviceTriggerCard('communication_failure');
    }

    if (!this._communicationFailureTrigger) {
      this.error('Communication failure trigger card is unavailable.');
      return;
    }

    const failureCount = state.counts.polling + state.counts.command;
    const tokens = {
      source,
      failure_count: failureCount,
      summary: this.buildCommunicationFailureSummary(state.counts),
      last_error: state.lastError,
    };
    const triggerState = {
      source,
      failure_count: failureCount,
      summary: tokens.summary,
      last_error: state.lastError,
    };

    try {
      await this._communicationFailureTrigger.trigger(device, tokens, triggerState);
      this.log(`Triggered communication failure flow for ${device.getName()}: ${tokens.summary}`);
    } catch (error) {
      this.error(`Failed to trigger communication failure flow for ${device.getName()}: ${error.message}`);
    }
  }

  async reportCommunicationFailure(source, errorMessage) {
    const normalizedSource = source === 'command' ? 'command' : 'polling';
    const devices = this.getDevices();
    if (devices.length === 0) {
      this.log(`Communication failure reported (${normalizedSource}) but no control devices are paired.`);
      return;
    }

    const now = Date.now();

    for (const device of devices) {
      const state = this.getCommunicationFailureState(device);
      state.counts[normalizedSource] += 1;
      state.lastError = errorMessage || 'Unknown error';

      if (state.lastTriggeredAt && now - state.lastTriggeredAt < COMMUNICATION_FAILURE_INTERVAL_MS) {
        this.log(`Suppressing communication failure trigger for ${device.getName()} until the one-hour window expires.`);
        continue;
      }

      state.lastTriggeredAt = now;
      await this.triggerCommunicationFailure(device, normalizedSource, state);
      state.counts = {
        polling: 0,
        command: 0,
      };
    }
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    let pollingInterval = await this.homey.settings.get('pollingInterval');
    let requestTimeout = await this.homey.settings.get('requestTimeout');

    // If pollingInterval is null or less than 60000 milliseconds, default to 60000 milliseconds
    if (!pollingInterval || pollingInterval < 60000) {
      pollingInterval = 60000; // Default to 60 seconds
      await this.homey.settings.set('pollingInterval', pollingInterval);
    }

    // If requestTimeout is null or less than 1000 milliseconds, default to 5000 milliseconds
    if (!requestTimeout || requestTimeout < 1000) {
      requestTimeout = 5000; // Default to 5 seconds
      await this.homey.settings.set('requestTimeout', requestTimeout);
    }

    // Cache request timeout for all calls
    this.requestTimeout = requestTimeout;

    // Initialize the trigger card for mode change
    this._modeChangeTrigger = this.homey.flow.getDeviceTriggerCard('mode_changed');
    if (this._modeChangeTrigger) {
      this.log('Mode change trigger card successfully assigned.');
    } else {
      this.error('Failed to assign mode change trigger card.');
    }

    // Register the run listener for the mode change trigger
    this._modeChangeTrigger.registerRunListener(async (args, state) => {
      this.log('Validating args and state in run listener...');

      // Only proceed if the state matches the expected args
      if (args.mode === state.mode) {
        this.log(`Mode is ${args.mode}. Proceeding with flow logic.`);
        return true;
      }
      this.log(`Mode does not match: args.mode=${args.mode}, state.mode=${state.mode}. Skipping flow logic.`);
      return false;
    });

    // Initialize condition card for checking current mode
    this._modeIsCondition = this.homey.flow.getConditionCard('is_aircon_mode');
    if (this._modeIsCondition) {
      this._modeIsCondition.registerRunListener(async (args) => {
        const currentMode = args.device.getCapabilityValue('aircon_mode');
        this.log(`Checking if current mode (${currentMode}) equals ${args.mode}`);
        return currentMode === args.mode;
      });
    } else {
      this.error('Failed to assign mode condition card.');
    }

    // Initialize condition card for checking current fan speed
    this._fanSpeedIsCondition = this.homey.flow.getConditionCard('is_fan_speed');
    if (this._fanSpeedIsCondition) {
      this._fanSpeedIsCondition.registerRunListener(async (args) => {
        const currentFan = args.device.getCapabilityValue('aircon_fan');
        // Map UI dropdown value to capability value; UI exposes "auto" while capability uses "autoAA"
        const expectedFan = args.speed === 'auto' ? 'autoAA' : args.speed;
        this.log(`Checking if current fan speed (${currentFan}) equals ${expectedFan}`);
        return currentFan === expectedFan;
      });
    } else {
      this.error('Failed to assign fan speed condition card.');
    }

    this._communicationFailureTrigger = this.homey.flow.getDeviceTriggerCard('communication_failure');
    this._communicationFailureStates = new Map();
    if (this._communicationFailureTrigger) {
      this.log('Communication failure trigger card successfully assigned.');
    } else {
      this.error('Failed to assign communication failure trigger card.');
    }

    this.log('MyDriver has been initialized');

    // Poll immediately so the UI has a current state on first open.
    await this.pollMyAirData();

    // Set up the recurring polling interval after the initial refresh.
    this.pollInterval = this.homey.setInterval(async () => {
      await this.pollMyAirData();
    }, pollingInterval);
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.log('Cleared MyAir polling interval on driver unload');
    }
    this._communicationFailureStates = new Map();
  }

  // Method to trigger the mode change flow
  async triggerModeChange(device, mode) {
    const tokens = { mode };
    const state = { mode };

    this.log(`Attempting to trigger mode change flow for device ${device.getName()} with mode: ${mode}`);
    this.log(`Tokens: ${JSON.stringify(tokens)}, State: ${JSON.stringify(state)}`);

    try {
      await this._modeChangeTrigger.trigger(device, tokens, state);
      this.log(`Mode change flow successfully triggered for device ${device.getName()} with mode: ${mode}`);
    } catch (error) {
      this.error(`Failed to trigger mode change flow for device ${device.getName()} with mode: ${mode}. Error: ${error.message}`);
    }
  }

  async pollMyAirData() {
    try {
      this.log('Polling MyAir Control Data');
      const devices = this.getDevices();
      if (devices.length === 0) {
        this.log('No MyAir Control devices to poll.');
        return;
      }

      const ipAddress = this.homey.settings.get('myAirIp');
      if (!ipAddress) {
        this.log('MyAir IP address not configured; skipping poll.');
        return;
      }
      const data = await this.fetchMyAirData(ipAddress);

      if (data && data.aircons && data.aircons.ac1 && data.aircons.ac1.info) {
        const airconInfo = data.aircons.ac1.info;

        for (const device of devices) {
          // Update device state for the aircon primary unit
          await device.setCapabilityValue('onoff', airconInfo.state === 'on');

          // Check and update aircon mode
          if (airconInfo.mode) {
            const currentMode = device.getCapabilityValue('aircon_mode');
            const newMode = this.mapMyAirModeToCapability(airconInfo.mode);
            this.log(`Current mode: ${currentMode}, API mode: ${airconInfo.mode}, New mode: ${newMode}`);
            if (currentMode !== newMode) {
              this.log(`Mode has changed from ${currentMode} to ${newMode}. Updating...`);
              await device.setCapabilityValue('aircon_mode', newMode);
              this.log(`Mode updated to ${newMode}. Preparing to trigger mode changed flow...`);

              // Trigger the mode changed flow
              this.log(`Triggering mode change flow for device: ${device.getName()}, Mode: ${newMode}`);
              await this.triggerModeChange(device, newMode);
              this.log(`Mode change flow trigger called for device: ${device.getName()}, Mode: ${newMode}`);
            } else {
              this.log('Mode has not changed. No update necessary.');
            }
          }

          // Update fan speed
          if (airconInfo.fan) {
            // Map API value to capability value; API may return "auto" while capability stores "autoAA"
            const fanValue = airconInfo.fan === 'auto' ? 'autoAA' : airconInfo.fan;
            // Assuming 'aircon_fan' is the capability name in your device class
            // and airconInfo.fan contains the fan speed data in the expected format
            // You might need to map airconInfo.fan values to your defined 'aircon_fan' capability values if they differ
            await device.setCapabilityValue('aircon_fan', fanValue);
          }

          // Include any other capabilities you need to update, like target_temperature
          // Make sure to map any MyAir specific values to your Homey capability value formats if necessary
        }
      }
    } catch (err) {
      this.error('Error polling MyAir Control data:', err);
    }
  }

  async onPairListDevices() {
    this.log('Listing devices for pairing...');

    // Retrieve the saved IP address

    const ipAddress = this.homey.settings.get('myAirIp') || 'IP Not Set';

    this.log('Using IP Address:', ipAddress);

    return [
      {
        name: 'myAir',
        data: {
          id: 'myAir',
        },
        store: {
          address: ipAddress, // Use the retrieved IP address
        },
      },
    ];
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */

  async onPair(session) {
    this.log('onPair');

    session.setHandler('validateIp', async (validateIp) => {
      this.log(`Validating IP ${validateIp}...`);

      // Test API Key
      try {
        const isValid = await this.validateIp(validateIp);
        this.log(`IP Address validation result: ${isValid}`);
        this.homey.settings.set('myAirIp', validateIp);
        this.log('IP address saved');
        return isValid;
      } catch (err) {
        this.error(err);
        return false;
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        const ipAddress = this.homey.settings.get('myAirIp');
        const myAirData = await this.fetchMyAirData(ipAddress);
        if (myAirData && myAirData.aircons && myAirData.aircons.ac1) {
          return [{
            name: 'MyAir Control Unit',
            data: { id: 'myAirControlUnit' }, // A unique identifier for the control unit
            store: {
              address: ipAddress,
            },
            capabilities: ['onoff', 'aircon_mode', 'aircon_fan'],
          }];
        }
        this.log('No MyAir Control Unit data available');
        return [];
      } catch (err) {
        this.error('Error fetching MyAir Control Unit:', err);
        return [];
      }
    });

    session.setHandler('add_device', async () => {
      this.log('function add_device');
    });

    session.setHandler('showView', async (viewId) => {
      this.log(`View: ${viewId}`);
    });

    await session.showView('my_view');
  }

  async validateIp(ipAddress) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ipAddress,
        port: 2025,
        path: '/getSystemData',
        method: 'GET',
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (d) => {
          data += d;
        });

        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            // Check a simple element in the JSON response
            if (parsedData && parsedData.aircons && parsedData.aircons.ac1) {
              resolve(true);
            } else {
              resolve(false);
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

}

module.exports = MyAirControlDriver;
