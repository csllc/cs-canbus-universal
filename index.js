'use strict';

const { Duplex } = require('stream');

// The adapter modules are optional dependencies. Each one is only loaded on
// the platforms it supports, and if it is not installed or fails to load (for
// example because its vendor driver or library is missing), it is skipped so
// that the remaining adapters keep working. The reason each skipped module
// could not be loaded is kept in loadErrors, which is exported as
// csCanbus.loadErrors.
const loadErrors = {};

function loadAdapterModule(name, platforms) {
  if (!platforms.includes(process.platform)) {
    return undefined;
  }
  try {
    return require(name);
  } catch (err) {
    loadErrors[name] = err;
    return undefined;
  }
}

// Supported adapter types. If another adapter type is added, add it here.
//  key:       property of this.adapters, and of this for the module instance
//  str:       adapter type, as used in options.priority and in port IDs
//  module:    npm package that implements the adapter
//  platforms: platforms the package supports
const ADAPTER_TYPES = [
  { key: 'canusbcom', str: 'can-usb-com', module: '@csllc/can-usb-com',
    platforms: ['win32', 'darwin', 'linux'], prop: 'canUsbCom' }, // GridConnect CAN-USB-COM
  { key: 'pcanusb', str: 'pcan-usb', module: '@csllc/cs-pcan-usb',
    platforms: ['win32', 'darwin'], prop: 'pcanUsb' }, // PEAK-System PCAN-USB
  { key: 'canlib', str: 'canlib', module: '@csllc/cs-canlib',
    platforms: ['win32'], prop: 'canlib' }, // Kvaser CANlib
  { key: 'socketcan', str: 'socketcan', module: '@csllc/cs-socketcan',
    platforms: ['linux'], prop: 'socketcan' }, // Linux SocketCAN
];

// Adapter classes that loaded successfully, by adapter type
const ADAPTER_CLASSES = {};
for (const a of ADAPTER_TYPES) {
  const cls = loadAdapterModule(a.module, a.platforms);
  if (cls) {
    ADAPTER_CLASSES[a.str] = cls;
  }
}

// Default priority of adapters, highest (left) to lowest (right)
const DEFAULT_PRIORITY = {
  win32: ['can-usb-com', 'pcan-usb', 'canlib'],
  darwin: ['pcan-usb', 'can-usb-com'],
  linux: ['can-usb-com', 'socketcan'],
};

// Default configuration used unless overridden by caller
function defaultOptions() {
  return {
    canRate: 250000,
    filters: [],
    loopback: false,
    priority: (DEFAULT_PRIORITY[process.platform] || ['can-usb-com']).slice(),
  };
}

// Events passed through from the selected adapter module
const PASSTHROUGH_EVENTS = ['error', 'write', 'status'];

// Module
module.exports = class csCanbus extends Duplex {
  constructor(options) {
    super({ objectMode: true });

    this.setOptions(options);
    this.setAdapters(this.options.priority);

    // Create an instance of each available adapter module, e.g. this.canUsbCom
    for (const a of ADAPTER_TYPES) {
      const Adapter = ADAPTER_CLASSES[a.str];
      if (Adapter) {
        try {
          this[a.prop] = new Adapter(this.options);
        } catch (err) {
          loadErrors[a.module] = err;
        }
      }
    }

    this.ports = undefined; // List of all available ports across all modules
    this.selectedModule = undefined; // First module to provide a successfully opened port
    this.selectedPort = undefined; // First port to be successfully opened
    this._listeners = [];
  }

  // Why each adapter module that could not be used was skipped, keyed by
  // package name
  static get loadErrors() {
    return loadErrors;
  }

  // Sets (or re-sets) the configuration options
  setOptions(options) {
    this.options = Object.assign({}, this.options || defaultOptions(), options);
  }

  setAdapters(priority) {
    this.adapters = {};
    for (const a of ADAPTER_TYPES) {
      this.adapters[a.key] = { str: a.str, priority: undefined };
    }

    // Check that all strings in the priorities array are valid
    for (const p of priority) {
      if (!ADAPTER_TYPES.some((a) => a.str === p)) {
        throw new Error('Unknown adapter in priority list: ' + p);
      }
    }

    // Based on indices of the strings in priority, set priorities for adapters
    for (const a in this.adapters) {
      this.adapters[a].priority = priority.indexOf(this.adapters[a].str);
    }
  }

  // Enumerates ports for each CAN adapter type, in order of priority. Each port
  // gets a type (the adapter type) and an id (type_path) property. If an
  // adapter type fails to list its ports, it is skipped.
  async list() {
    const lists = await Promise.all(this.options.priority.map(async (type) => {
      const module = this._moduleForType(type);
      if (!module) {
        return [];
      }
      let ports;
      try {
        ports = await module.list();
      } catch (err) {
        console.error('cs-canbus-universal: Unable to list ' + type + ' ports: ' + err);
        return [];
      }
      return (ports || []).map((port) => {
        port.type = type;
        port.id = type + '_' + port.path;
        return port;
      });
    }));

    this.ports = lists.flat();
    return this.ports;
  }

  async open(id) {
    if (id === 'auto') {
      console.debug('cs-canbus-universal: Automatically selecting CAN port');
      console.debug('cs-canbus-universal: Port priority: ' + JSON.stringify(this.options.priority));
      // If we've already built a list of ports use it instead of rebuilding
      // the list. Older versions of SerialPort, used by can-usb-com, had a bug
      // where list() didn't resolve when called a second time.
      const ports = this.ports || await this.list();
      return this.autoOpen(ports);
    }

    // Resolve the ID to a module name and port/path. The type never contains
    // an underscore, but the path might.
    const sep = id.indexOf('_');
    const port = {
      type: id.slice(0, sep),
      path: id.slice(sep + 1),
    };
    if (sep < 1 || port.path === '') {
      throw new Error('Invalid port ID: ' + id);
    }
    if (!isNaN(port.path)) {
      port.path = Number(port.path);
    }

    const module = this._lookupModule(port);
    await module.open(port.path);
    console.debug('opened port ' + port.path + ' using ' + port.type);
    this._attach(module, port);
  }

  // Sequentially tries to open each port in ports. Since ports is arranged in
  // order of priority, this resolves on the first successful attempt to open a
  // port, and rejects only if none of the ports can be opened.
  autoOpen(ports) {
    return this._tryOpenPorts(ports, 0);
  }

  async close() {
    const module = this.selectedModule;
    this._detach();
    // Emit close event on behalf of the module we're wrapping
    this.emit('close');
    if (module) {
      return module.close();
    }
  }

  write(msg) {
    return this.selectedModule.write(msg) || Promise.resolve();
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
    if (this.selectedModule) {
      return this.selectedModule.isConnected();
    } else {
      return false;
    }
  }

  _onData(...args) {
    return this.selectedModule._onData(...args);
  }

  _read() {}

  _write() {}

  async _tryOpenPorts(ports, p = 0) {
    if (!ports || ports.length === 0) {
      throw new Error('No CAN ports available.');
    }

    for (; p < ports.length; p++) {
      const port = ports[p];
      console.debug('Attempting to open port ' + p + ': ' + port.type + '_' + port.path + ' ...');
      try {
        const module = this._lookupModule(port);
        await module.open(port.path);
        console.debug('Opened port ' + p + ': ' + port.type + '_' + port.path);
        this._attach(module, port);
        return;
      } catch (err) {
        console.error('Unable to open port ' + p + ' (' + port.path + ') using ' + port.type + ': ' + err);
      }
    }

    throw new Error('Unable to open any of ' + ports.length + ' available CAN ports.');
  }

  // Saves the module and port that were opened, passes the module's events
  // through, and emits open on behalf of the module
  _attach(module, port) {
    this._detach();
    this.selectedPort = port;
    this.selectedModule = module;

    this._listen('data', (msg) => { this.push(msg); });
    for (const event of PASSTHROUGH_EVENTS) {
      this._listen(event, (arg) => { this.emit(event, arg); });
    }

    this.emit('open');
  }

  _listen(event, listener) {
    this.selectedModule.on(event, listener);
    this._listeners.push([event, listener]);
  }

  // Removes the event listeners added by _attach, so that the module can be
  // opened again without passing its events through twice
  _detach() {
    if (this.selectedModule) {
      for (const [event, listener] of this._listeners) {
        this.selectedModule.removeListener(event, listener);
      }
    }
    this._listeners = [];
  }

  _moduleForType(type) {
    const a = ADAPTER_TYPES.find((t) => t.str === type);
    return a ? this[a.prop] : undefined;
  }

  _lookupModule(port) {
    if (!ADAPTER_TYPES.some((a) => a.str === port.type)) {
      throw new Error('Unrecognized port type: ' + port.type);
    }
    const module = this._moduleForType(port.type);
    if (!module) {
      throw new Error('Adapter module for ' + port.type + ' is not available');
    }
    return module;
  }
};
