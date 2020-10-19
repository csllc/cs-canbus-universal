'use strict';

const CANUSBCOM = require('can-usb-com');
const PCANUSB = require('@csllc/cs-pcan-usb');
const CANlib = require('@csllc/cs-canlib');

const { Duplex } = require('stream');

// Default configuration used unless overridden by caller
const DEFAULT_OPTIONS = {
  canRate: 250000,
  filters: [],
  loopback: false,
};

// Indices for managing resolved promises
// If another adapter type is added, be sure to update this
// TODO: Can this be done as an enum-like thing instead?
const canusbcom = 0;
const pcanusb = 1;
const canlib = 2;

// Establish priority of adapters, if more than one present on system
// TODO: Use a config file for this
const adapterPriorities = [ 'can-usb-com', 'pcan-usb', 'canlib' ];



// Module
module.exports = class csCanbus extends Duplex {
  constructor(options) {
    super({ objectMode: true });

    this.canUsbCom = new CANUSBCOM(); // GridConnect CAN-USB-COM
    this.pcanUsb = new PCANUSB(); // PEAK-System PCAN-USB
    this.canlib = new CANlib(); // Kvaser CANlib

    this.ports = undefined;
    this.selectedPort = undefined;
    this.canModule = undefined;
  }

  list() {
    var me = this;

    return new Promise(function(resolve) {
      // Enumerate adapters for each CAN adapter type
      var adapters = [];
      adapters.splice(canusbcom, 0, me.canUsbCom.list());
      adapters.splice(pcanusb, 0, me.pcanUsb.list());
      adapters.splice(canlib, 0, me.canlib.list());

    Promise.all(adapters)
        .then((ports) => {
          // Identify each adapter's type
          ports[canusbcom].forEach(elem => { elem['type'] = 'can-usb-com'; });
          ports[pcanusb].forEach(elem => { elem['type'] = 'pcan-usb'; });
          ports[canlib].forEach(elem => { elem['type'] = 'canlib'; });
          // Concatenate arrays returned by promises
          ports = [].concat.apply([], ports);
          me.ports = ports;
          resolve(ports);
        });
    });
  }

  open(ports) {
    var me = this;

      // Automatically select one CAN adapter port on the system
      let adapters;
      let type;
      
      // Iterate through the adapter priorities list and pull out relevant
      // elements from the array of all adapters obtained in list()
      for (const t in adapterPriorities) {
        let type = adapterPriorities[t];
        console.log("Trying " + type + "...");

        switch (type) {
        case 'can-usb-com':
          me.canModule = me.canUsbCom;
          adapters = ports.filter((port) => {
            return port.type === 'can-usb-com';
          });
          break;
        case 'pcan-usb':
          me.canModule = me.pcanUsb;
          adapters = ports.filter((port) => {
            return port.type === 'pcan-usb';
          });
          break;
        case 'canlib':
          me.canModule = me.canlib;
          adapters = ports.filter((port) => {
            return port.type === 'canlib';
          });
          break;
        default:
          throw new Error('Unknown CAN adapter type: ' + type);
          break;
        }

        // Try to connect to each adapter in the adapters array populated above,
        // and break out upon the first success
        for (const p in adapters)  {
          let port = adapters[p];
          console.log(port);

          return me.canModule.open(port.path)
            .then(() => { me.selectedPort = port; })
            .then(() => {
              // Enable event passthrough
              me.canModule.on('data', (msg) => { me.push(msg); });
              // TODO: Other events?
            })
            .catch((err) => {});
        }

        

        // If all ports for the adapter type fail, loop through again with the next type.
      }

    // Maybe here check if me.canModule is defined. If it's not defined by now, that's a problem
  }


  close() {
    return this.canModule.close();
  }

  write(msg) {
    return this.canModule.write(msg);
  }

  status() {
    return this.canModule.status();
  }

  isOpen() {
    return this.canModule.isOpen();
  }

  isConnected() {
    return this.canModule.isConnected();

  }
  
  _read() {}
  
  _write() {}


}

