'use strict';

const { Driver } = require('homey');
const http = require('http');

class MyAirControlDriver extends Driver {

  async fetchMyAirData(ipAddress) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ipAddress,
        port: 2025,
        path: '/getSystemData',
        method: 'GET',
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (error) {
            reject(new Error(`Error parsing MyAir data: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Error fetching MyAir data: ${error.message}`));
      });

      req.end();
    });
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    let pollingInterval = await this.homey.settings.get('pollingInterval');

    // If pollingInterval is null or less than 60000 milliseconds, default to 60000 milliseconds
    if (!pollingInterval || pollingInterval < 60000) {
      pollingInterval = 60000; // Default to 60 seconds
      await this.homey.settings.set('pollingInterval', pollingInterval);
    }

    // Initial delayed poll to avoid immediate polling on app start
    this.homey.setTimeout(async () => {
      await this.pollMyAirData();
    }, 10000); // Delay of 10000 milliseconds (10 seconds)

    // Set up the polling interval
    this.pollInterval = this.homey.setInterval(async () => {
      await this.pollMyAirData();
    }, pollingInterval);

    // Initialize the trigger card for mode change
    this._modeChangeTrigger = this.homey.flow.getDeviceTriggerCard('mode_changed');
    if (this._modeChangeTrigger) {
      this.log('Mode change trigger card successfully assigned.');
    } else {
      this.error('Failed to assign mode change trigger card.');
    }

    this._modeChangeTrigger.registerRunListener(async (args, state) => {
      this.error('Validating args... for FlowDeviceTrigger');
      // args is the user input,
      // for example { 'location': 'New York' }
      // state is the parameter passed in trigger()
      // for example { 'location': 'Amsterdam' }

      // If true, this flow should run
      return true;
    });

    this.log('MyDriver has been initialized');
  }

  // Method to trigger the mode change flow
  async triggerModeChange(device, mode) {
    const tokens = { mode };
    const state = {};

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
      const data = await this.fetchMyAirData(ipAddress);

      if (data && data.aircons && data.aircons.ac1 && data.aircons.ac1.info) {
        const airconInfo = data.aircons.ac1.info;

        for (const device of devices) {
          // Update device state for the aircon primary unit
          await device.setCapabilityValue('onoff', airconInfo.state === 'on');

          // Check and update aircon mode
          if (airconInfo.mode) {
            const currentMode = device.getCapabilityValue('aircon_mode');
            const newMode = airconInfo.mode;
            this.log(`Current mode: ${currentMode}, New mode: ${newMode}`);
            if (currentMode !== newMode) {
              this.log(`Mode has changed from ${currentMode} to ${newMode}. Updating...`);
              await device.setCapabilityValue('aircon_mode', newMode);

              // Detailed logging before triggering the flow
              this.log(`Triggering mode change flow for device: ${device.getName()}, Mode: ${newMode}`);
              await this.triggerModeChange(device, newMode);
              this.log(`Mode change flow trigger called for device: ${device.getName()}, Mode: ${newMode}`);
            } else {
              this.log('Mode has not changed. No update necessary.');
            }
          }

          // Update fan speed
          if (airconInfo.fan) {
            // Assuming 'aircon_fan' is the capability name in your device class
            // and airconInfo.fan contains the fan speed data in the expected format
            // You might need to map airconInfo.fan values to your defined 'aircon_fan' capability values if they differ
            await device.setCapabilityValue('aircon_fan', airconInfo.fan);
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
            capabilities: ['onoff'], // Include relevant capabilities for the control unit
            // You can add additional properties like settings, icon, capabilitiesOptions, etc.
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
