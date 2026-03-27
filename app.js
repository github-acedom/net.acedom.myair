'use strict';

const Homey = require('homey');

const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 500;

class MyApp extends Homey.App {

  async ensureDefaultSetting(key, defaultValue, isValid) {
    const currentValue = await this.homey.settings.get(key);
    if (isValid(currentValue)) {
      return;
    }

    await this.homey.settings.set(key, defaultValue);
  }

  async reportCommunicationFailure(source, errorMessage) {
    try {
      const controlDriver = this.homey.drivers.getDriver('myair_control');
      if (!controlDriver || typeof controlDriver.reportCommunicationFailure !== 'function') {
        this.log(`Communication failure reported (${source}) but the control driver is unavailable.`);
        return;
      }

      await controlDriver.reportCommunicationFailure(source, errorMessage);
    } catch (error) {
      this.error('Failed to route communication failure to the control driver:', error);
    }
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');

    await this.ensureDefaultSetting('retryCount', DEFAULT_RETRY_COUNT, (value) => Number.isInteger(value) && value >= 0);
    await this.ensureDefaultSetting('retryDelayMs', DEFAULT_RETRY_DELAY_MS, (value) => Number.isInteger(value) && value >= 0);

    // Registering the flow action listener for setting aircon mode
    try {
      this.log('Attempting to register setAirconModeAction...');
      const setAirconModeAction = this.homey.flow.getActionCard('set_aircon_mode');
      setAirconModeAction.registerRunListener(async (args, state) => {
        this.log(`Set aircon mode to ${args.fan_mode}`);

        if (!args.device) {
          this.log('Device not found');
          return false; // Ensure there's a device reference
        }

        // Correctly invoke the method to change the fan speed
        try {
          // Directly call the method designed to handle fan speed changes
          await args.device.onCapabilityMode(args.fan_mode);

          this.log(`Aircon mode set to ${args.fan_mode}`);
          return true; // Success
        } catch (error) {
          this.log(`Error setting aircon mode: ${error}`);
          return false; // Indicate failure
        }
      });
      this.log('setAirconModeAction registered successfully.');
    } catch (error) {
      this.log('Failed to register setAirconModeAction:', error);
    }

    // Registering the flow action listener for setting aircon mode
    try {
      this.log('Attempting to register setAirconFanAction...');
      const setAirconFanAction = this.homey.flow.getActionCard('set_aircon_fan');
      setAirconFanAction.registerRunListener(async (args, state) => {
        this.log(`Attempting to set aircon fan to: ${args.fan_speed}`);

        // Assuming 'args.device' directly provides a reference to your device instance
        if (!args.device) {
          this.log('Device not found');
          return false; // Ensure there's a device reference
        }

        // Correctly invoke the method to change the fan speed
        try {
          // Directly call the method designed to handle fan speed changes
          await args.device.onCapabilityFan(args.fan_speed);

          this.log(`Aircon fan set to ${args.fan_speed}`);
          return true; // Success
        } catch (error) {
          this.log(`Error setting aircon fan: ${error}`);
          return false; // Indicate failure
        }
      });

      this.log('setAirconFanAction registered successfully.');
    } catch (error) {
      this.log('Failed to register setAirconFanAction:', error);
    }
  }

}

module.exports = MyApp;
