'use strict';

const { Device } = require('homey');
const { sendCommandToMyAir } = require('../../lib/myAirAPI');

class MyAirZoneDevice extends Device {

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
      // You need to check if migration is needed
      // do not call addCapability on every init!
      await this.addCapability('measure_ventopen');
    }

    // register a capability listener
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemp.bind(this));
    this.registerCapabilityListener('measure_ventopen', this.onCapabilityVentOpenPerc.bind(this));
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

    const deviceData = this.getData();
    const zoneId = deviceData.id;
    const ipAddress = this.homey.settings.get('myAirIp');

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

    // ... set value to real device, e.g.
    // await setMyDeviceState({ on: value });

    // or, throw an error
    // throw new Error('Switching the device failed!');
  }

}

module.exports = MyAirZoneDevice;
