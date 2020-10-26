'use strict';

const { Duplex } = require('stream');

// Selectively include modules depending on platform
var CANUSBCOM = undefined;
var PCANUSB = undefined;
var CANLIB = undefined;

if ((process.platform == "win32") ||
    (process.platform == "darwin")) {
  PCANUSB = require('@csllc/cs-pcan-usb');
  CANUSBCOM = require('can-usb-com');
}

if (process.platform == "win32") {
  CANLIB = require('@csllc/cs-canlib');
}

// Default configuration used unless overridden by caller
var DEFAULT_OPTIONS;

// Default priority of adapters, highest (left) to lowest (right)
switch (process.platform) {
case "win32":
  DEFAULT_OPTIONS = {
    canRate: 250000,
    filters: [],
    loopback: false,
    priority: [ 'can-usb-com', 'pcan-usb', 'canlib' ]
  };
  break;
case "darwin":
  DEFAULT_OPTIONS = {
    canRate: 250000,
    filters: [],
    loopback: false,
    priority: [ 'pcan-usb', 'can-usb-com' ]
  };
  break;
default:
  DEFAULT_OPTIONS = {
    canRate: 250000,
    filters: [],
    loopback: false,
    priority: [ 'can-usb-com' ]
  };
  break;
} 

// Default adapter list; priorities are assigned in constructor
// If another adapter type is added, be sure to update this
const DEFAULT_ADAPTERS = {
  canusbcom: { str: "can-usb-com", priority: undefined },
  pcanusb: { str: "pcan-usb", priority: undefined },
  canlib: { str: "canlib", priority: undefined }
};

// Module
module.exports = class csCanbus extends Duplex {
  constructor(options) {
    super({ objectMode: true });

    this.setOptions(options);
    this.setAdapters(this.options.priority);

    if (CANUSBCOM) {
      this.canUsbCom = new CANUSBCOM(this.options); // GridConnect CAN-USB-COM
    }
    if (PCANUSB) {
      this.pcanUsb = new PCANUSB(this.options); // PEAK-System PCAN-USB
    }
    if (CANLIB) {
      this.canlib = new CANLIB(this.options); // Kvaser CANlib
    }

    this.ports = undefined; // List of all available ports across all modules
    this.selectedModule = undefined; // First module to provide a successfully opened port
    this.selectedPort = undefined; // First port to be successfully opened
  }

  // Sets (or re-sets) the configuration options
  setOptions(options) {
    // Save for later use
    this.options = Object.assign(DEFAULT_OPTIONS, options);
  }

  setAdapters(priority) {
    this.adapters = DEFAULT_ADAPTERS;
    // Check that all strings in the priorities array are valid
    for (const p in priority) {
      if (JSON.stringify(this.adapters).indexOf(priority[p]) == -1) {
        throw new Error("Unknown adapter in priority list: " + priority[p]);
      }
    }
    // Based on indicies of the strings in this.options.priorities, set priorities
    // for adapters
    for (const a in this.adapters) {
      this.adapters[a].priority = priority.indexOf(this.adapters[a].str);
    }
  }

  list() {
    var me = this;

    return new Promise(function(resolve) {
      // Enumerate adapters for each CAN adapter type, in order of priority
      var adapter_list = [];
      for (const p in me.options.priority) {
        switch (me.options.priority[p]) {
        case me.adapters.canusbcom.str:
          adapter_list.push(me.canUsbCom.list());
          break;
        case me.adapters.pcanusb.str:
          adapter_list.push(me.pcanUsb.list());
          break;
        case me.adapters.canlib.str:
          adapter_list.push(me.canlib.list());
          break;
        }
      }
      
      // Generate list of all available ports, across all modules and
      // preserving order
      Promise.all(adapter_list)
        .then((ports) => {
          // Identify each adapter's type by adding a type element to the port list
          if (CANUSBCOM) {
            ports[me.adapters.canusbcom.priority].forEach((elem) => {
              elem['type'] = me.adapters.canusbcom.str;
            });
          }
          if (PCANUSB) {
            ports[me.adapters.pcanusb.priority].forEach((elem) => {
              elem['type'] = me.adapters.pcanusb.str;
            });
          }
          if (CANLIB) {
            ports[me.adapters.canlib.priority].forEach((elem) => {
              elem['type'] = me.adapters.canlib.str;

            });
          }
          // Concatenate nested arrays returned by the promises
          ports = [].concat.apply([], ports);

          // Add an ID property as well, which will uniquely identify each port
          ports.forEach((elem) => {
            elem['id'] = (elem.type + "_" + elem.path);
          });
          
          me.ports = ports;
          resolve(ports);
        });
    });
  }

  open(id) {
    var me = this;

    return new Promise(function(resolve, reject) {
      if (id == "auto") {
        console.debug("cs-canbus-universal: Automatically selecting CAN port");
        console.debug("cs-canbus-universal: Port priority: " + JSON.stringify(me.options.priority));
        me.list()
          .then((ports) => {
            return me.autoOpen(ports)
              .catch((err) => {
                console.error(err);
                reject(err);
              });
          });
      } else {
        // Resovle the ID to a module name and port/path
        let port = {};
        port.type = id.split("_")[0];
        port.path = id.split("_")[1];
        if (!isNaN(port.path)) { port.path = Number(port.path); }

        let module = me._lookupModule(port);
        module.open(port.path)
          .then(() => {
            console.debug("opened port " + port.path + " using " + port.type);

            // If successful, save the module and port for posterity
            me.selectedPort = port;
            me.selectedModule = module;
            // Event passthrough
            me.selectedModule.on('error', (err) => { me.emit('error', err); });
            me.selectedModule.on('data', (msg) => { me.push(msg); });
            me.selectedModule.on('write', (msg) => { me.emit('write', msg); });
            resolve();
          })
          .then(() => {
            //Emit open event on behalf of the module we're wrapping
            me.emit('open');
          })
          .catch((err) => {
            reject(err);
          });
      }
    });
  }

  autoOpen(ports) {
    var me = this;

    return new Promise(function(resolve, reject) {
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

    return new Promise(function(resolve, reject) {
      // Attempt to open a given port using its corresponding module's open()
      // method
      console.debug("Attempting to open port " + p + ": " + ports[p].type + "_" + ports[p].path + " ...");
      let module = me._lookupModule(ports[p]);
      module.open(ports[p].path)
        .then(() => {
          console.debug("Opened port " + p + ": " + ports[p].type + "_" + ports[p].path);
          // If successful, save the module and port for posterity
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
            reject("Unable to open any of " + p + " available CAN ports.");
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




