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
  // Priority of adapters, highest (left) to lowest (right)
  priorities: [ 'pcan-usb', 'can-usb-com', 'canlib' ],
};

// Default adapter list; priorities are assigned in constructor
// If another adapter type is added, be sure to update this
const DEFAULT_ADAPTERS = {
  canusbcom: { str: "can-usb-com", priority: undefined },
  pcanusb: { str: "pcan-usb", priority: undefined },
  canlib: { str: "canlib", priority: undefined }
};

// TODO: Should non-applicable acceptance filter options fail silently?
// Make that an option for the user?


// Module
module.exports = class csCanbus extends Duplex {
  constructor(options) {
    super({ objectMode: true });

    this.setOptions(options);
    this.setAdapters(this.options.priorities);

    this.canUsbCom = new CANUSBCOM(this.options); // GridConnect CAN-USB-COM
    this.pcanUsb = new PCANUSB(this.options); // PEAK-System PCAN-USB
    this.canlib = new CANlib(this.options); // Kvaser CANlib

    this.ports = undefined; // List of all available ports across all modules
    this.selectedModule = undefined; // First module to provide a successfully opened port
    this.selectedPort = undefined; // First port to be successfully opened
  }

  // Sets (or re-sets) the configuration options
  setOptions(options) {
    // Save for later use
    this.options = Object.assign(DEFAULT_OPTIONS, options);
  }

  setAdapters(priorities) {
    this.adapters = DEFAULT_ADAPTERS;
    // Check that all strings in the priorities array are valid
    for (const p in priorities) {
      if (JSON.stringify(this.adapters).indexOf(priorities[p]) == -1) {
        throw new Error("Unknown adapter in priority list: " + priorities[p]);
      }
    }
    // Based on indicies of the strings in this.options.priorities, set priorities
    // for adapters
    for (const a in this.adapters) {
      this.adapters[a].priority = priorities.indexOf(this.adapters[a].str);
    }
  }

  list() {
    var me = this;

    return new Promise(function(resolve) {
      // Enumerate adapters for each CAN adapter type, in order of priority
      var adapters = [];
      adapters.splice(me.adapters.canusbcom.priority, 0, me.canUsbCom.list());
      adapters.splice(me.adapters.pcanusb.priority, 0, me.pcanUsb.list());
      adapters.splice(me.adapters.canlib.priority, 0, me.canlib.list());

      // Generate list of all available ports, across all modules and
      // preserving order
      Promise.all(adapters)
        .then((ports) => {
          // Identify each adapter's type by adding a type element to the port list
          ports[me.adapters.canusbcom.priority].forEach(elem => { elem['type'] = me.adapters.canusbcom.str; });
          ports[me.adapters.pcanusb.priority].forEach(elem => { elem['type'] = me.adapters.pcanusb.str; });
          ports[me.adapters.canlib.priority].forEach(elem => { elem['type'] = me.adapters.canlib.str; });
          // Concatenate nested arrays returned by the promises
          ports = [].concat.apply([], ports);
          me.ports = ports;
          resolve(ports);
        });
    });
  }

  open(ports) {
    var me = this;

    return new Promise(function(resolve) {
      // Sequentially and recursively try to open each port by executing the
      // module-specific open promise on each of the members of the ports array.
      //
      // Since ports is arranged in order of priority, this will return on the
      // first successful attempt to open a port.
      //
      // Upon success, event handlers are set up by _tryOpenPorts as well.
      me._tryOpenPorts(ports, 0)
        .then(() => {
          resolve();
        })
        .catch((err) => {
        // An error is only thrown by me._tryOpenPorts if none of the ports
        // are able to be opened.
          reject(err);
        });
    });
  }

  close() {
    // Emit close event on behalf of the module we're wrapping
    this.emit('close');
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

  _tryOpenPorts(ports, p) {
    var me = this;

    return new Promise(function(resolve) {
      // Attempt to open a given port using its corresponding module's open()
      // method
      console.log("Attempting to open port " + p + "...");
      let module = me._lookupModule(ports[p]);
      module.open(ports[p].path)
        .then(() => {
          console.log("Opened port " + p + " (" + ports[p].path + ") using " + ports[p].type);
          // If successful, save the module (already assigned) and port for posterity
          me.selectedPort = ports[p];
          me.selectedModule = module;
          // Event passthrough
          me.selectedModule.on('error', (err) => { me.emit('error', err); });
          me.selectedModule.on('data', (msg) => { me.push(msg); });
          me.selectedModule.on('write', (msg) => { me.emit('write', msg); });
          // Emit open event on behalf of the module we're wrapping
          me.emit('open');
          resolve();
        })
        .catch((err) => {
          console.error("Unable to open port " + p + " (" + ports[p].path + ") using " + ports[p].type + ": " + err);
          p++;
          if (p < ports.length) {
            // Recursively try the next port in the ports array
            resolve(me._tryOpenPorts(ports, p));
          } else {
            throw new Error("Unable to open any of " + p + " available CAN ports.");
          }
        });
    });
  }

  _lookupModule(port) {
    var me = this;
    
    switch(port.type) {
    case me.adapters.canusbcom.str:
      return me.canUsbCom;
    case me.adapters.pcanusb.str:
      return me.pcanUsb;
    case me.adapters.canlib.str:
      return me.canlib;
    default:
      throw new Error("Unrecognized port type: " + port.type);
    }
  }
}




