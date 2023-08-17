'use strict';

const Homey = require('homey');
const { ZigBeeDevice } = require('homey-zigbeedriver');
const { PowerConfigurationCluster } = require('zigbee-clusters');
const EasyAccessDoorLockCluster = require('./EasyAccessDoorlockCluster');

class EasyConnectLockDevice extends ZigBeeDevice {

	async onNodeInit({ zclNode }) {
		if (Homey.env.DEBUG === '1') {
			this.enableDebug();
		}

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

		if (this.hasCapability('measure_battery')) {
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
		}
	}

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
}

module.exports = EasyConnectLockDevice;

