'use strict';

const { Driver } = require('homey');
const http = require('http');

class MyAirZoneDriver extends Driver {

  async fetchMyAirData(ipAddress) {
    const timeout = this.requestTimeout || 5000;
    if (!ipAddress) {
      throw new Error('MyAir IP address is not configured');
    }

    // Multiple zone devices can call this during startup; share one in-flight request.
    if (this._inFlightFetch && this._inFlightFetch.ipAddress === ipAddress) {
      return this._inFlightFetch.promise;
    }

    const fetchPromise = new Promise((resolve, reject) => {
      const options = {
        hostname: ipAddress,
        port: 2025,
        path: '/getSystemData',
        method: 'GET',
        timeout,
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const snippet = data ? ` Body: ${data.slice(0, 200)}` : '';
              this.error(`MyAir responded with status ${res.statusCode}.${snippet}`);
              return reject(new Error(`MyAir responded with status ${res.statusCode}`));
            }
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (error) {
            reject(new Error(`Error parsing MyAir data: ${error.message}`));
          }
          return undefined;
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Error fetching MyAir data: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy(new Error('MyAir data request timed out'));
      });

      req.end();
    });

    this._inFlightFetch = {
      ipAddress,
      promise: fetchPromise,
    };

    try {
      return await fetchPromise;
    } finally {
      if (this._inFlightFetch && this._inFlightFetch.promise === fetchPromise) {
        this._inFlightFetch = null;
      }
    }
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');

    let pollingInterval = await this.homey.settings.get('pollingInterval');
    let requestTimeout = await this.homey.settings.get('requestTimeout');

    // If pollingInterval is null or less than 60000 milliseconds, default to 60000 milliseconds
    if (!pollingInterval || pollingInterval < 60000) {
      pollingInterval = 60000; // Default to 60 seconds
      await this.homey.settings.set('pollingInterval', pollingInterval);
    }
    if (!requestTimeout || requestTimeout < 1000) {
      requestTimeout = 5000; // Default to 5 seconds
      await this.homey.settings.set('requestTimeout', requestTimeout);
    }
    this.requestTimeout = requestTimeout;

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

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.log('Cleared MyAir polling interval on driver unload');
    }
    this._inFlightFetch = null;
  }

  resolveSignalQuality(rssi, zoneType) {
    const parsedZoneType = Number.parseInt(zoneType, 10);
    if (parsedZoneType === 0) {
      return 'No Sensor';
    }

    const parsedRssi = Number.parseFloat(rssi);
    if (!Number.isFinite(parsedRssi)) {
      return 'Unknown';
    }

    // MyAir reports RSSI as a positive magnitude (e.g. 52, 70, 85).
    const signal = Math.abs(parsedRssi);
    if (signal === 0) {
      return 'Dead';
    }

    if (signal <= 70) {
      return 'Excellent';
    }
    if (signal <= 80) {
      return 'Good';
    }
    if (signal <= 90) {
      return 'Poor';
    }
    if (signal <= 100) {
      return 'Weak';
    }
    return 'Dead';
  }

  async syncZoneCapabilities(device, zoneType) {
    if (device.hasCapability('measure_ventopen') === false) {
      await device.addCapability('measure_ventopen');
    }
    if (device.hasCapability('wifi_signal') === false) {
      await device.addCapability('wifi_signal');
    }
    if (!Number.isFinite(zoneType)) {
      return;
    }

    if (zoneType === 0) {
      if (device.hasCapability('target_ventopen') === false) {
        await device.addCapability('target_ventopen');
      }
      if (device.hasCapability('target_temperature')) {
        await device.removeCapability('target_temperature');
      }
      if (device.hasCapability('measure_temperature')) {
        await device.removeCapability('measure_temperature');
      }
    } else if (zoneType === 1) {
      if (device.hasCapability('target_ventopen')) {
        await device.removeCapability('target_ventopen');
      }
      if (device.hasCapability('target_temperature') === false) {
        await device.addCapability('target_temperature');
      }
      if (device.hasCapability('measure_temperature') === false) {
        await device.addCapability('measure_temperature');
      }
    }
  }

  async triggerTargetTemperatureChange(device, temperature, previousTemperature, source) {
    if (!this._targetTemperatureChangeTrigger) {
      this._targetTemperatureChangeTrigger = this.homey.flow.getDeviceTriggerCard('target_temperature_changed');
    }

    if (!this._targetTemperatureChangeTrigger) {
      this.error('Target temperature change trigger card is unavailable.');
      return;
    }

    const normalizedSource = source || 'unknown';
    const baseTokens = { temperature };
    if (Number.isFinite(previousTemperature)) {
      baseTokens.previous_temperature = previousTemperature;
    }
    const tokens = {
      temperature: baseTokens.temperature,
      source: normalizedSource,
    };
    if (Number.isFinite(previousTemperature)) {
      tokens.previous_temperature = previousTemperature;
    }
    const state = {
      temperature,
      previous_temperature: previousTemperature,
      source: normalizedSource,
    };

    this.log(`Triggering target temperature change for ${device.getName()} to ${temperature} (source=${normalizedSource})`);
    try {
      await this._targetTemperatureChangeTrigger.trigger(device, tokens, state);
    } catch (error) {
      this.error(`Failed to trigger target temperature change with source token for ${device.getName()}: ${error.message}`);
      try {
        await this._targetTemperatureChangeTrigger.trigger(device, baseTokens, state);
        this.log(`Triggered target temperature change for ${device.getName()} without source token fallback.`);
      } catch (fallbackError) {
        this.error(`Failed fallback trigger for ${device.getName()}: ${fallbackError.message}`);
      }
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
      if (!ipAddress) {
        this.log('MyAir IP address not configured; skipping poll.');
        return;
      }
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
            const zoneType = Number.parseInt(zoneInfo.type, 10);
            const storedZoneType = Number.parseInt(device.getStoreValue('zoneType'), 10);
            if (Number.isFinite(zoneType) && zoneType !== storedZoneType) {
              await device.setStoreValue('zoneType', zoneType);
            }
            await this.syncZoneCapabilities(device, zoneType);

            // Update device state
            if (device.hasCapability('onoff')) {
              await device.setCapabilityValue('onoff', zoneInfo.state === 'open');
            }
            if (device.hasCapability('target_temperature')) {
              const currentTarget = device.getCapabilityValue('target_temperature');
              const nextTarget = Number.parseFloat(zoneInfo.setTemp);
              const resolvedTarget = Number.isFinite(nextTarget) ? nextTarget : zoneInfo.setTemp;
              if (currentTarget !== resolvedTarget) {
                await device.setCapabilityValue('target_temperature', resolvedTarget);
                await this.triggerTargetTemperatureChange(device, resolvedTarget, currentTarget, 'myair');
              }
            }
            if (device.hasCapability('measure_temperature')) {
              await device.setCapabilityValue('measure_temperature', zoneInfo.measuredTemp);
            }
            if (device.hasCapability('measure_ventopen')) {
              await device.setCapabilityValue('measure_ventopen', zoneInfo.value);
            }
            if (device.hasCapability('target_ventopen')) {
              await device.setCapabilityValue('target_ventopen', zoneInfo.value);
            }
            if (device.hasCapability('wifi_signal')) {
              await device.setCapabilityValue('wifi_signal', this.resolveSignalQuality(zoneInfo.rssi, zoneInfo.type));
            }
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
          const zoneType = Number.parseInt(zoneInfo.type, 10);
          const store = {
            address: ipAddress,
          };
          if (Number.isFinite(zoneType)) {
            store.zoneType = zoneType;
          }

          const capabilities = zoneType === 0
            ? ['onoff', 'measure_ventopen', 'target_ventopen', 'wifi_signal']
            : ['onoff', 'target_temperature', 'measure_temperature', 'measure_ventopen', 'wifi_signal'];

          return {
            name: zoneInfo.name,
            data: { id: zoneId }, // Unique identifier for the device
            store,
            // Include other properties as needed
            // settings: {...},
            // icon: "/path/to/icon.svg",
            capabilities,
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
