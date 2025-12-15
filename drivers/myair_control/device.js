'use strict';

const { Device } = require('homey');
const { sendCommandToMyAir } = require('../../lib/myAirAPI');

class MyAirControlDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyAirControlDevice has been initialized');

    this.log('Device init');
    this.log('Name:', this.getName());
    this.log('Class:', this.getClass());

    // Add missing capabilities once, guarded to avoid repeated adds
    try {
      if (this.hasCapability('aircon_fan') === false) {
        this.log('adding cap aircon_fan');
        await this.addCapability('aircon_fan');
      }

      if (this.hasCapability('aircon_mode') === false) {
        this.log('adding cap aircon_mode');
        await this.addCapability('aircon_mode');
      }
    } catch (err) {
      this.error('Failed to add capability:', err && err.message ? err.message : err);
      return; // Do not continue registration if capabilities failed to add
    }

    // register a capability listener
    this.registerCapabilityListener('aircon_mode', this.onCapabilityMode.bind(this));
    this.registerCapabilityListener('aircon_fan', this.onCapabilityFan.bind(this));
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
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

  async onCapabilityMode(value) {
    this.log('function onCapabilityMode');
    this.log(value);

    const ipAddress = this.homey.settings.get('myAirIp');

    // Determine the mode based on the input value
    // Adjust the logic to match your aircon's supported modes
    let mode;
    switch (value) {
      case 'cool':
        mode = value;
        break;
      case 'heat':
        mode = value;
        break;
      case 'fan': // Assuming these are valid modes for your aircon
        mode = 'vent'; // Send "vent" when the input value is "dry"
        break;
      case 'dry':
        mode = value;
        break;
      default:
        this.log(`Unsupported mode value: ${value}`);
        return; // Exit the function if the value is not supported
    }

    // Construct the command for updating the aircon's mode
    const jsonCommand = JSON.stringify({
      ac1: {
        info: {
          mode,
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set aircon mode to ${mode}`);
    } catch (error) {
      this.error('Failed to set aircon mode:', error && error.message ? error.message : error);
      throw new Error('Changing the aircon mode failed!');
    }
  }

  async onCapabilityFan(value) {
    this.log('function onCapabilityFan');
    this.log(value);

    const ipAddress = this.homey.settings.get('myAirIp');

    // Determine the fan mode based on the input value
    // This example assumes 'value' will be a string like 'auto', 'high', 'medium', 'low'
    // You may need to adjust the logic based on the actual expected input and your aircon's supported fan modes
    let fanMode;
    switch (value) {
      case 'auto':
      case 'autoAA':
      case 'myFan':
        fanMode = 'autoAA'; // Assuming 'autoAA' is a valid mode for your aircon
        break;
      case 'high':
        fanMode = value; // Adjust this line as needed
        break;
      case 'medium':
        fanMode = value; // Adjust this line as needed
        break;
      case 'low':
        // Translate 'high', 'medium', 'low' to your aircon's specific fan modes if different from 'autoAA'
        // Example: fanMode = value;
        fanMode = value; // Adjust this line as needed
        break;
      default:
        this.log(`Unsupported fan value: ${value}`);
        return; // Exit the function if the value is not supported
    }

    // Construct the command for updating the fan setting
    const jsonCommand = JSON.stringify({
      ac1: {
        info: {
          fan: fanMode,
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set aircon fan mode to ${fanMode}`);
    } catch (error) {
      this.error('Failed to set aircon fan mode:', error && error.message ? error.message : error);
      throw new Error('Changing the aircon fan mode failed!');
    }
  }

  // this method is called when the Device has requested a state change (turned on or off)
  async onCapabilityOnoff(value) {
    this.log('function onCapabilityOnoff');
    this.log(value);

    const ipAddress = this.homey.settings.get('myAirIp');

    // Construct the command for turning the aircon on or off
    const jsonCommand = JSON.stringify({
      ac1: {
        info: {
          state: value ? 'on' : 'off',
        },
      },
    });

    const encodedCommand = encodeURIComponent(jsonCommand);
    const command = `/setAircon?json=${encodedCommand}`;

    try {
      await sendCommandToMyAir(ipAddress, command, this.log.bind(this));
      this.log(`Set aircon state to ${value ? 'on' : 'off'}`);
    } catch (error) {
      this.error('Failed to set aircon state:', error && error.message ? error.message : error);
      throw new Error('Switching the aircon state failed!');
    }
  }

}

module.exports = MyAirControlDevice;
