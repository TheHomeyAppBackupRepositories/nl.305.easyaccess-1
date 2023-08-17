'use strict';

const Homey = require('homey');
const {Log} = require('homey-log');
const EasyAccessDoorLockCluster = require('./lib/EasyAccessDoorlockCluster');
const {debug} = require('zigbee-clusters');

debug(Homey.env.DEBUG === '1');

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

    this.homey.flow.getActionCard('set_pin').registerRunListener(async (args) => {
      const newPin = args.pin.trim();
      this.log(args);
      this.log('Add pin with ID:', args.ID, 'and PIN:', newPin);
      if (newPin.length < 4 || newPin.length > 8 || isNaN(Number(newPin))) {
        throw new Error(`Pin should be 4-8 digits, ${newPin} given`);
      }

      const pinAsBuffer = Buffer.alloc(newPin.length);
      newPin.split('').forEach((number, idx) => pinAsBuffer.writeUInt8(number, idx));
      this.log('PIN as buffer:', JSON.stringify(pinAsBuffer));

      await args.device.zclNode
          .endpoints[args.device.getClusterEndpoint(EasyAccessDoorLockCluster)]
          .clusters[EasyAccessDoorLockCluster.NAME]
          .setPinCode({
            userId: args.ID,
            userStatus: 0x00,
            userType: 0x00,
            pinLength: newPin.length,
            pin: pinAsBuffer,
          }).catch(this.error);
    });
    this.homey.flow.getActionCard('delete_pin').registerRunListener(async (args) => {
      this.log(args);
      this.log('Delete pin with ID:', args.ID);
      await args.device.zclNode
          .endpoints[args.device.getClusterEndpoint(EasyAccessDoorLockCluster)]
          .clusters[EasyAccessDoorLockCluster.NAME]
          .clearPinCode({
            userId: args.ID,
          }).catch(this.error);
    });


  }
}

module.exports = EasyAccess;
