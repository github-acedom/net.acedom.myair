'use strict';

const { Device } = require('homey');
const { sendCommandToMyAir } = require('../../lib/myAirAPI');

class MyAirZoneDevice extends Device {

  getZoneType() {
    const zoneType = Number.parseInt(this.getStoreValue('zoneType'), 10);
    return Number.isFinite(zoneType) ? zoneType : null;
  }

  async refreshZoneTypeFromController() {
    const storedZoneType = this.getZoneType();
    if (storedZoneType !== null) {
      return storedZoneType;
    }

    const ipAddress = this.homey.settings.get('myAirIp');
    if (!ipAddress) {
      return null;
    }

    const zoneId = this.getData().id;
    const driver = this.driver || this.homey.drivers.getDriver('myair_zone');
    if (!driver || typeof driver.fetchMyAirData !== 'function') {
      return null;
    }

    try {
      const data = await driver.fetchMyAirData(ipAddress);
      const zoneType = Number.parseInt(
        data
        && data.aircons
        && data.aircons.ac1
        && data.aircons.ac1.zones
        && data.aircons.ac1.zones[zoneId]
        && data.aircons.ac1.zones[zoneId].type,
        10,
      );

      if (Number.isFinite(zoneType)) {
        await this.setStoreValue('zoneType', zoneType);
        return zoneType;
      }
    } catch (error) {
      const message = error && error.message ? error.message : error;
      this.log(`Failed to refresh zone type from controller: ${message}`);
    }

    return null;
  }

  async syncCapabilitiesByZoneType(zoneType) {
    if (this.hasCapability('measure_ventopen') === false) {
      await this.addCapability('measure_ventopen');
    }
    if (!Number.isFinite(zoneType)) {
      return;
    }

    if (zoneType === 0) {
      if (this.hasCapability('target_ventopen') === false) {
        await this.addCapability('target_ventopen');
      }
      if (this.hasCapability('target_temperature')) {
        await this.removeCapability('target_temperature');
      }
      if (this.hasCapability('measure_temperature')) {
        await this.removeCapability('measure_temperature');
      }
    } else if (zoneType === 1) {
      if (this.hasCapability('target_ventopen')) {
        await this.removeCapability('target_ventopen');
      }
      if (this.hasCapability('target_temperature') === false) {
        await this.addCapability('target_temperature');
      }
      if (this.hasCapability('measure_temperature') === false) {
        await this.addCapability('measure_temperature');
      }
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');

    this.log('Device init');
    this.log('Name:', this.getName());
    this.log('Class:', this.getClass());

    if (this.hasCapability('measure_ventopen') === false) {
      this.log('adding cap measure_ventopen');
      await this.addCapability('measure_ventopen');
    }
    if (this.hasCapability('wifi_signal') === false) {
      this.log('adding cap wifi_signal');
      // Migration capability for existing paired devices
      await this.addCapability('wifi_signal');
    }

    const zoneType = await this.refreshZoneTypeFromController();
    await this.syncCapabilitiesByZoneType(zoneType);

    // register a capability listener
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    if (this.hasCapability('target_temperature')) {
      this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemp.bind(this));
    }
    if (this.hasCapability('target_ventopen')) {
      this.registerCapabilityListener('target_ventopen', this.onCapabilityVentOpenPerc.bind(this));
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('MyDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
  }

  // this method is called when the Device has requested a state change (turned on or off)
  async onCapabilityTargetTemp(value, opts) {
    this.log('function onCapabilityTargetTemp');
    const zoneType = this.getZoneType();
    if (zoneType === 0) {
      throw new Error('This zone does not support target temperature. Use vent percentage.');
    }

    const deviceData = this.getData();
    const zoneId = deviceData.id;
    const ipAddress = this.homey.settings.get('myAirIp');
    const previousTemperature = this.getCapabilityValue('target_temperature');

    // Construct the command for setting the temperature
    const jsonCommand = JSON.stringify({
      ac1: {
        zones: {
          [zoneId]: {
            setTemp: value,
          },
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set target temperature for zone ${zoneId} to ${value}`);
      const driver = this.driver || this.homey.drivers.getDriver('myair_zone');
      if (driver && driver.triggerTargetTemperatureChange) {
        await driver.triggerTargetTemperatureChange(this, value, previousTemperature, 'homey');
      }
    } catch (error) {
      this.error('Failed to set target temperature:', error);
      throw new Error('Setting the target temperature failed!');
    }
  }

  async onCapabilityOnoff(value, opts) {
    this.log('function onCapabilityTargetTemp');
    this.log('Changing onoff to:', value);

    const deviceData = this.getData();
    this.log('Device data:', deviceData);

    const zoneId = deviceData.id;
    this.log(zoneId);

    const ipAddress = this.homey.settings.get('myAirIp');

    const jsonCommand = JSON.stringify({
      ac1: {
        zones: {
          [zoneId]: {
            state: value ? 'open' : 'close',
          },
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set zone ${zoneId} to ${value ? 'open' : 'close'}`);
    } catch (error) {
      this.error('Failed to set zone state:', error);
      throw new Error('Switching the device failed!');
    }
  }

  async onCapabilityVentOpenPerc(value, opts) {
    this.log('function onCapabilityVentOpenPerc');
    const zoneType = this.getZoneType();
    if (zoneType === 1) {
      throw new Error('Vent percentage is only supported for type 0 zones.');
    }

    const deviceData = this.getData();
    const zoneId = deviceData.id;
    const ipAddress = this.homey.settings.get('myAirIp');
    const nextValue = Number.parseFloat(value);
    if (!Number.isFinite(nextValue)) {
      throw new Error('Invalid vent percentage value');
    }

    const normalizedValue = Math.max(0, Math.min(100, Math.round(nextValue / 5) * 5));
    const jsonCommand = JSON.stringify({
      ac1: {
        zones: {
          [zoneId]: {
            value: normalizedValue,
          },
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set zone ${zoneId} vent opening to ${normalizedValue}%`);
    } catch (error) {
      this.error('Failed to set zone vent opening:', error);
      throw new Error('Setting zone vent opening failed!');
    }
  }

}

module.exports = MyAirZoneDevice;
