'use strict';

const Homey = require('homey');
const {Log} = require('homey-log');

class EasyAccess extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.homeyLog = new Log({homey: this.homey});
    this.log('EasyAccess has been initialized');

    // Register flows
    this.homey.flow.getConditionCard('auto_relock').registerRunListener((args) => {
      return args.device.getSettings().auto_relock_time;
    });

    this.homey.flow.getActionCard('auto_relock').registerRunListener(async (args) => {
      const device = args.device;
      const enabled = args.enabled;
      if (device.getSettings().auto_relock_time === enabled) {
        return;
      }
      await device.setSettings({
        auto_relock_time: enabled,
      });
      device.writeSettings({
        autoRelockTime: device.mapAutoRelockSetting(enabled),
      });
    });


  }
}

module.exports = EasyAccess;
