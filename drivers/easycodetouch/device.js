'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, ZCLDataTypes, PowerConfigurationCluster, DoorLockCluster, debug } = require('zigbee-clusters');

//#region DoorLock cluster definition
const ATTRIBUTES = {
	lockState: {
		id: 0,
		type: ZCLDataTypes.enum8({
			LOCKED: 0x01,
			UNLOCKED: 0x02
		}),
	},
	// 	ENABLED: 0x01,
	// 	DISABLED: 0x00
	autoRelockTime: {
		id: 0x0023,
		type: ZCLDataTypes.uint32,
	},
	// 	OFF: 0x00,
	// 	LOW: 0x01,
	// 	NORMAL: 0x02
	soundVolume: {
		id: 0x0024,
		type: ZCLDataTypes.uint8,
	},
	// First octet: userID, second octet: 0, third octet: reason, fourth octet: source
	// Undocumented, found by trial and error.
	eventReport: {
		id: 0x0100,
		type: ZCLDataTypes.buffer,
	}
};
const COMMANDS = {
	lock: {
		id: 0,
	},
	unlock: {
		id: 1,
	},
	setPinCode: {
		id: 0x05,
		direction: Cluster.DIRECTION_CLIENT_TO_SERVER,
		args: {
			userId: ZCLDataTypes.uint16,
			userStatus: ZCLDataTypes.enum8({
				AVAILABLE: 0x00,
				OCCUPIED: 0x01,
			}),
			userType: ZCLDataTypes.enum8({
				UNRESTRICTED: 0x00,
			}),
			pinLength: ZCLDataTypes.uint8,
			pin: ZCLDataTypes.buffer,
		},
	},
	setPinCodeResponse: {
		id: 0x05,
		direction: Cluster.DIRECTION_SERVER_TO_CLIENT,
		args: {
			success: ZCLDataTypes.uint8, // But seems to be stuck on zero
		},
	},
	clearPinCode: {
		id: 0x07,
		direction: Cluster.DIRECTION_CLIENT_TO_SERVER,
		args: {
			userId: ZCLDataTypes.uint16,
		},
	},
	clearPinCodeResponse: {
		id: 0x07,
		direction: Cluster.DIRECTION_SERVER_TO_CLIENT,
		args: {
			success: ZCLDataTypes.bool, // But seems to be stuck on zero
		},
	},
	event: { // Does not seem to be triggered, no longer implemented
		id: 0x20,
		args: {
			source: ZCLDataTypes.uint8,
			code: ZCLDataTypes.uint8,
			userId: ZCLDataTypes.uint16, //always 0?
			pin: ZCLDataTypes.uint8, //always 0?
			zigBeeLocalTime: ZCLDataTypes.uint32, //always 0?
			// data: ZCLDataTypes.string //the lock doesnt send data string?
		},
	},
};

class EasyAccessDoorLockCluster extends DoorLockCluster {

	static get ATTRIBUTES() {
		return ATTRIBUTES;
	}

	static get COMMANDS() {
		return COMMANDS;
	}

	/**
	 * Normally you would implement a BoundCluster for receiving COMMAND's from the doorlock
	 * However somehow our BoundCluster got ignored and "events" got received in the normal Cluster..
	 * Maybe this is because a Cluster & BoundCluster arent normally supposed to be used together for the same Cluster ID?
	 */
	onEvent(args, meta, frame, rawFrame) {
		this.emit('commands.event', args);
	}
}

Cluster.addCluster(EasyAccessDoorLockCluster);
debug();
//#endregion

class EasyConnectLockDevice extends ZigBeeDevice {

	async onNodeInit({ zclNode }) {
		this.enableDebug();

		//#region Settings
		const endpointId = this.getClusterEndpoint(EasyAccessDoorLockCluster);

		try {
			const deviceSettings = await zclNode
				.endpoints[endpointId]
				.clusters[EasyAccessDoorLockCluster.NAME]
				.readAttributes('autoRelockTime', 'soundVolume');

			await this.copyDeviceSettings(deviceSettings);

			await this.configureAttributeReporting([
				{
					endpointId: endpointId,
					cluster: EasyAccessDoorLockCluster,
					attributeName: 'autoRelockTime',
					minInterval: 0,
					maxInterval: 300,
					minChange: 1,
				},
				{
					endpointId: endpointId,
					cluster: EasyAccessDoorLockCluster,
					attributeName: 'soundVolume',
					minInterval: 0,
					maxInterval: 300,
					minChange: 1,
				},
			]);
		} catch (e) {
			if (this.isFirstInit()) {
				throw e;
			} else {
				this.error(e);
			}
		}

		zclNode.endpoints[endpointId].clusters[EasyAccessDoorLockCluster.NAME]
			.on('attr.autoRelockTime', (autoRelockTime) => {
				this.copyDeviceSettings({autoRelockTime});
		 	});

		zclNode.endpoints[endpointId].clusters[EasyAccessDoorLockCluster.NAME]
			.on('attr.soundVolume', (soundVolume) => {
				this.copyDeviceSettings({soundVolume});
			});
		//#endregion

		//#region Events
		const eventTrigger = this.homey.flow.getDeviceTriggerCard('lock_event');
		zclNode.endpoints[endpointId].clusters[EasyAccessDoorLockCluster.NAME]
			.on('attr.eventReport', (event) => {
				try {
					this.log('Event received', JSON.stringify(event));
					const sourceMap = {
						0x02: 'Keypad',
						0x04: 'RF',
						0x0a: 'Remote', // Bluetooth or Zigbee
					}

					const reasonMap = {
						0x00: 'Unknown',
						0x01: 'Lock',
						0x02: 'Unlock',
						0x03: 'Lock failure invalid PIN or ID',
						0x04: 'Lock failure invalid schedule',
						0x05: 'Unlock failure invalid PIN or ID',
						0x06: 'Unlock failure invalid schedule',
						0x07: 'One touch lock',
						0x08: 'Key lock',
						0x09: 'Key unlock',
						0x0A: 'Auto lock',
						0x0B: 'Schedule lock', //e.g. auto-relock
						0x0C: 'Schedule unlock',
						0x0D: 'Manual lock (Key or Thumbturn)', // &indeterminate if through the app
						0x0E: 'Manual unlock (Key or Thumbturn)', // &indeterminate if through the app
						0x0F: 'Non-Access user operational event',
					}

					const tokens = {
						source: sourceMap[event[3]] || 'Unknown',
						reason: reasonMap[event[2]] || 'Unknown',
						userId: event[0],
					};

					eventTrigger.trigger(this, tokens).catch(this.error);
				} catch (err) {
					console.error(err);
				}
			});
		// zclNode.endpoints[endpointId].clusters[EasyAccessDoorLockCluster.NAME]
		// 	.on('event', event => {
		// 		try {
		// 			this.log('Event received', event);
		// 			const sourceMap = {
		// 				0x00: 'Keypad',
		// 				0x01: 'RF',
		// 				0x02: 'Manual', //e.g. key
		// 				0x03: 'RFID',
		// 				0xff: 'Indeterminate' //e.g. auto-relock, app command
		// 			}
		//
		// 			const codeMap = {
		// 				0x00: 'Unknown',
		// 				0x01: 'Lock',
		// 				0x02: 'Unlock',
		// 				0x03: 'Lock failure invalid PIN or ID',
		// 				0x04: 'Lock failure invalid schedule',
		// 				0x05: 'Unlock failure invalid PIN or ID',
		// 				0x06: 'Unlock failure invalid schedule',
		// 				0x07: 'One touch lock',
		// 				0x08: 'Key lock',
		// 				0x09: 'Key unlock',
		// 				0x0A: 'Auto lock',
		// 				0x0B: 'Schedule lock', //e.g. auto-relock
		// 				0x0C: 'Schedule unlock',
		// 				0x0D: 'Manual lock (Key or Thumbturn)', // &indeterminate if through the app
		// 				0x0E: 'Manual unlock (Key or Thumbturn)', // &indeterminate if through the app
		// 				0x0F: 'Non-Access user operational event',
		// 			}
		//
		// 			const tokens = {
		// 				source: sourceMap[event.source],
		// 				reason: codeMap[event.code]
		// 			}
		//
		// 			eventTrigger.trigger(this, tokens).catch(this.error);
		// 		} catch (err) {
		// 			console.error(err);
		// 		}
		// 	});

		// Register PIN flow handlers
		const setPINAction = this.homey.flow.getActionCard('set_pin');
		setPINAction.registerRunListener(async (args) => {
			if (this.zclNode !== args.device.zclNode) {
				return;
			}

			if (args.ID < 1 || args.ID > 50) {
				throw new Error(`User id should be between 1-50, ${args.ID} given`);
			}

			const newPin = args.pin.trim();
			this.log('Add pin with ID:', args.ID, 'and PIN:', newPin);
			if (newPin.length < 4 || newPin.length > 8 || isNaN(Number(newPin))) {
				throw new Error(`Pin should be 4-8 digits, ${newPin} given`);
			}

			const pinAsBuffer = Buffer.alloc(newPin.length);
			newPin.split('').forEach((number, idx) => pinAsBuffer.writeUInt8(number, idx));
			this.log('PIN as buffer:', JSON.stringify(pinAsBuffer));

			await this.zclNode
				.endpoints[endpointId]
				.clusters[EasyAccessDoorLockCluster.NAME]
				.setPinCode({
					userId: args.ID,
					userStatus: 0x00,
					userType: 0x00,
					pinLength: newPin.length,
					pin: pinAsBuffer,
			    });
		});
		const deletePINAction = this.homey.flow.getActionCard('delete_pin');
		deletePINAction.registerRunListener(async (args) => {
			if (this.zclNode !== args.device.zclNode) {
				return;
			}

			if (args.ID < 1 || args.ID > 50) {
				throw new Error(`User id should be between 1-50, ${args.ID} given`);
			}

			this.log('Delete pin with ID:', args.ID);
			await this.zclNode
				.endpoints[endpointId]
				.clusters[EasyAccessDoorLockCluster.NAME]
				.clearPinCode({
				    userId: args.ID,
			    });
		});
		//#endregion

		//#region Capabilities
		this.registerCapability('locked', EasyAccessDoorLockCluster, {
			get: 'lockState',
			getOpts: {
				getOnStart: true,
				getOnOnline: true,
				pollInterval: 1000 * 60
			},
			report: 'lockState',
			reportParser: (report) => report === 'LOCKED',
			reportOpts: {
				configureAttributeReporting: {
					minInterval: 0,
					maxInterval: 60,
					minChange: 1,
				}
			},
			set: 'lockState',
			setParser: async (setLocked) => {
				const cluster = zclNode
					.endpoints[this.getClusterEndpoint(EasyAccessDoorLockCluster)]
					.clusters[EasyAccessDoorLockCluster.NAME];

				if (setLocked === true) {
					await cluster.lock();
				} else {
					await cluster.unlock();
				}

				// Return null which will skip the "set" action
				return null;
			}
		});

		this.registerCapability('measure_battery', PowerConfigurationCluster, {
			get: 'batteryPercentageRemaining',
			getOpts: {
				getOnStart: true,
				getOnOnline: true,
				pollInterval: 1000 * 60 * 60
			},
			report: 'batteryPercentageRemaining',
			reportParser: (report) => {
				if (Number.isFinite(report)) {
					//Battery percentage is a value between 0 and 0xC8 (200)
					//This because it has a step interval of 0.5
					return report / 2;
				}
				return null;
			}
		});
		// #endregion
	}

	//#region Settings handlers
	async onSettings({newSettings, changedKeys}) {
		if (this.zclNode === undefined || this.zclNode === null) {
			return;
		}

		this.saveSettingsToDevice(newSettings, changedKeys);
	}

	/**
	 * {auto_relock_time: true, sound_volume: 'normal'}
	 * @typedef {object} HomeySettings
	 * @property {boolean} [deviceSettings.auto_relock_time]
	 * @property {string} [deviceSettings.sound_volume]
	 *
	 * @param {HomeySettings} settings
	 * @param {string[]} changedKeys
	 */
	saveSettingsToDevice(settings, changedKeys) {
		this.debug('Write settings to device', settings, changedKeys);
		const newDeviceSettings = {};
		for (const changedKey of changedKeys) {
			const newSetting = settings[changedKey];
			switch (changedKey) {
				case 'auto_relock_time': {
					newDeviceSettings.autoRelockTime = this.mapAutoRelockSetting(newSetting);
					break;
				}
				case 'sound_volume': {
					newDeviceSettings.soundVolume = this.mapSoundVolumeSetting(newSetting);
					break;
				}
			}
		}
		if (Object.keys(newDeviceSettings).length > 0) {
			this.writeSettings(newDeviceSettings);
		}
	}

	mapSoundVolumeSetting(newSetting) {
		const soundVolumeMap = {
			undefined: 0x02,
			'off': 0x00,
			'low': 0x01,
			'normal': 0x02
		}
		return soundVolumeMap[newSetting];
	}

	mapAutoRelockSetting(newSetting) {
		const autoRelockTimeMap = {
			undefined: 0x01,
			true: 0x01,
			false: 0x00
		}
		return autoRelockTimeMap[newSetting];
	}

	writeSettings(newDeviceSettings) {
		this.debug('Parsed write settings to device', newDeviceSettings);
		if (this.settingsInterval) {
			clearInterval(this.settingsInterval);
		}
		const settingsAction = () => this.zclNode
			.endpoints[this.getClusterEndpoint(EasyAccessDoorLockCluster)]
			.clusters[EasyAccessDoorLockCluster.NAME]
			.writeAttributes(newDeviceSettings)
			.then(() => {
				clearInterval(this.settingsInterval);
				this.settingsInterval = null;
			})
			.catch(this.error);
		this.settingsInterval = this.homey.setInterval(settingsAction, 60000);
		setImmediate(settingsAction);
	}

	/**
	 * { autoRelockTime: 1, soundVolume: 2 }
	 * @typedef {object} DeviceSettings
	 * @property {number} [deviceSettings.autoRelockTime]
	 * @property {number} [deviceSettings.soundVolume]
	 *
	 * @param {DeviceSettings} deviceSettings
	 */
	async copyDeviceSettings(deviceSettings) {
		this.debug('Copy settings from device', deviceSettings);
		const homeySettings = {};

		if (deviceSettings.autoRelockTime != null) {
			const autoRelockMap = {
				undefined: true,
				0x00: false,
				0x01: true
			}
			homeySettings.auto_relock_time = autoRelockMap[deviceSettings.autoRelockTime];
		}

		if (deviceSettings.soundVolume != null) {
			const soundMap = {
				undefined: 'normal',
				0x00: 'off',
				0x01: 'low',
				0x02: 'normal'
			}
			homeySettings.sound_volume = soundMap[deviceSettings.soundVolume];
		}

		if (Object.keys(homeySettings).length > 0) {
			this.debug('Parsed copy settings from device', homeySettings);
			await this.setSettings(homeySettings);
		}

		return homeySettings;
	}
	//#endregion
}

module.exports = EasyConnectLockDevice;

