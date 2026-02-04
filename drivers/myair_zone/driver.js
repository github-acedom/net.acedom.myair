'use strict';

const { Driver } = require('homey');
const http = require('http');

class MyAirZoneDriver extends Driver {

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
    this.log('MyDriver has been initialized');

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

    // Initialize the trigger card for target temperature change
    this._targetTemperatureChangeTrigger = this.homey.flow.getDeviceTriggerCard('target_temperature_changed');
    if (this._targetTemperatureChangeTrigger) {
      this.log('Target temperature change trigger card successfully assigned.');
    } else {
      this.error('Failed to assign target temperature change trigger card.');
    }
  }

  async triggerTargetTemperatureChange(device, temperature, previousTemperature) {
    if (!this._targetTemperatureChangeTrigger) {
      return;
    }

    const tokens = { temperature };
    if (Number.isFinite(previousTemperature)) {
      tokens.previous_temperature = previousTemperature;
    }

    const state = {
      temperature,
      previous_temperature: previousTemperature,
    };

    this.log(`Triggering target temperature change for ${device.getName()} to ${temperature}`);
    try {
      await this._targetTemperatureChangeTrigger.trigger(device, tokens, state);
    } catch (error) {
      this.error(`Failed to trigger target temperature change for ${device.getName()}: ${error.message}`);
    }
  }

  async pollMyAirData() {
    try {
      this.log('function pollMyAirData');
      const devices = this.getDevices();
      if (devices.length === 0) {
        this.log('No devices to poll.');
        return;
      }

      const ipAddress = this.homey.settings.get('myAirIp');
      const data = await this.fetchMyAirData(ipAddress);

      if (data && data.aircons && data.aircons.ac1 && data.aircons.ac1.zones) {
        for (const [zoneId, zoneInfo] of Object.entries(data.aircons.ac1.zones)) {
          this.log(zoneId);
          let device;
          try {
            device = this.getDevice({ id: zoneId });
          } catch (error) {
            this.log(`Device with ID ${zoneId} not found, skipping.`);
            continue; // Skip to the next iteration if device not found
          }

          if (device) {
            this.log('Updating device state for:', zoneId);
            // Update device state
            await device.setCapabilityValue('onoff', zoneInfo.state === 'open');
            const currentTarget = device.getCapabilityValue('target_temperature');
            const nextTarget = Number.parseFloat(zoneInfo.setTemp);
            const resolvedTarget = Number.isFinite(nextTarget) ? nextTarget : zoneInfo.setTemp;
            if (currentTarget !== resolvedTarget) {
              await device.setCapabilityValue('target_temperature', resolvedTarget);
              await this.triggerTargetTemperatureChange(device, resolvedTarget, currentTarget);
            }
            await device.setCapabilityValue('measure_temperature', zoneInfo.measuredTemp);
            await device.setCapabilityValue('measure_ventopen', zoneInfo.value);
          }
        }
      }
    } catch (err) {
      this.error('Error polling MyAir data:', err);
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
        const devices = Object.entries(myAirData.aircons.ac1.zones).map(([zoneId, zoneInfo]) => {
          return {
            name: zoneInfo.name,
            data: { id: zoneId }, // Unique identifier for the device
            store: {
              address: ipAddress,
            },
            // Include other properties as needed
            // settings: {...},
            // icon: "/path/to/icon.svg",
            capabilities: ['onoff', 'target_temperature', 'measure_temperature'],
            // capabilitiesOptions: {...},
          };
        });

        return devices;
      } catch (err) {
        this.error('Error fetching devices:', err);
        return []; // Return an empty array in case of error
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

module.exports = MyAirZoneDriver;
