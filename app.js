'use strict';

const Homey = require('homey');
// const { sendCommandToMyAir } = require('./lib/myAirAPI');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');

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
