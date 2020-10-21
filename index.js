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

// TODO: Should non-applicable filter options fail silently? Make that an option
// for the user?


// Module
module.exports = class csCanbus extends Duplex {
  constructor(options) {
    super({ objectMode: true });

    this.setOptions(options);

    this.canUsbCom = new CANUSBCOM(this.options); // GridConnect CAN-USB-COM
    this.pcanUsb = new PCANUSB(this.options); // PEAK-System PCAN-USB
    this.canlib = new CANlib(this.options); // Kvaser CANlib

    this.ports = undefined;
    this.selectedModule = undefined;
    this.selectedPort = undefined;

    // TODO: Provide adapter priority list through constructor?

  }

  // Sets (or re-sets) the configuration options
  setOptions(options) {
    // Save for later use
    this.options = Object.assign(DEFAULT_OPTIONS, options);
  }

  list() {
    var me = this;

    return new Promise(function(resolve) {
      // Enumerate adapters for each CAN adapter type, using predefined
      // indices
      var adapters = [];
      adapters.splice(canusbcom, 0, me.canUsbCom.list());
      adapters.splice(pcanusb, 0, me.pcanUsb.list());
      adapters.splice(canlib, 0, me.canlib.list());

    Promise.all(adapters)
        .then((ports) => {
          // Identify each adapter's type by adding an element to the port list
          ports[canusbcom].forEach(elem => { elem['type'] = 'can-usb-com'; });
          ports[pcanusb].forEach(elem => { elem['type'] = 'pcan-usb'; });
          ports[canlib].forEach(elem => { elem['type'] = 'canlib'; });
          // Concatenate nested arrays returned by promises
          ports = [].concat.apply([], ports);
          me.ports = ports;
          resolve(ports);
        });
    });
  }

  open(ports) {
    var me = this;

    return new Promise(function(resolve) {


      // Sequentially and recursively try to open each port by executing a
      // promise on each of the members of the ports array

      // Return on the first successful attempt to open a port
      try {
        me._tryOpenPort(ports, 0);
      } catch (err) {
        // An error is only thrown by me._tryOpenPort if none of the ports
        // are able to be opened.
        reject(err);
      }
    });
  }

  close() {
    // Emit close event on behalf of the module we're wrapping
    this.emit('close');
    // TODO: try binding instead?
    return this.selectedModule.close();
  }

  write(msg) {
    return this.selectedModule.write(msg);
  }

  status() {
    return this.selectedModule.status();
  }

  isOpen() {
    if (this.selectedModule) {
      return this.selectedModule.isOpen();
    } else {
      return false;
    }
  }

  isConnected() {
    return this.selectedModule.isConnected();
  }
  
  _read() {}
  
  _write() {}

  _tryOpenPort(ports, p) {
    var me = this;
    // Attempt to open a given port using its corresponding module's open()
    // method
    console.log("Attempting to open port " + p + "...");
    me.selectedModule = me._lookupModule(ports[p]);
    me.selectedModule.open(ports[p].path);
      .then(() => {
        console.log("Opened port " + p + " (" + ports[p].path + ") using " + ports[p].type);
        // If successful, save the module (already assigned) and port for posterity
        me.selectedPort = ports[p];
      })
      .catch((err) => {
        console.error("Unable to open port " + p + " (" + ports[p].path + ") using " + ports[p].type + ": " + err);
        p++;
        if (p < ports.length) {
          me._tryOpenPort(ports, p);
        } else {
          throw new Error("Unable to open any of " + p + " available CAN ports.");
        }
      });
  }

  _lookupModule(port) {
    var me = this;
    
    switch(port.type) {
    case "can-usb-com":
      return me.canUsbCom;
    case "pcan-usb":
      return me.pcanUsb;
    case "canlib":
      return me.canlib;
    default:
      console.log(port);
      throw new Error("Unrecognized port type: " + port.type);
    }
  }
}




