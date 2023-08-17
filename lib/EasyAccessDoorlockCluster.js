'use strict';

const {ZCLDataTypes, Cluster, DoorLockCluster} = require('zigbee-clusters');
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

module.exports = EasyAccessDoorLockCluster;
