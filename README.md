# NodeJS Universal CAN Bus Module

This module encapsulates functionality for the following CAN libraries and adapters:

 - `can-usb-com`: ([npm](https://www.npmjs.com/package/can-usb-com), [GitHub](https://github.com/bglase/can-usb-com)) GridConnect CAN-USB-COM
 - `cs-pcan-usb`: ([npm](https://www.npmjs.com/package/@csllc/cs-pcan-usb), [GitHub](https://github.com/csllc/cs-pcan-usb)) PEAK-System PCAN-USB
 - `cs-canlib`: ([npm](https://www.npmjs.com/package/@csllc/cs-canlib), [GitHub](https://github.com/csllc/cs-canlib)) Kvaser Leaf Light v2
 - `cs-socketcan`: ([npm](https://www.npmjs.com/package/@csllc/cs-socketcan), [GitHub](https://github.com/csllc/cs-socketcan)) PiCAN 2 for Raspberry Pi

Development is focused on the USB CAN adapters listed above, but this module and its dependencies may work with others supported by the underlying libraries with little to no modification.

## Getting Started

The following assumes that [NodeJS](https://nodejs.org) is already installed. This module was developed using Node v12.18.4 and v10.22.0 for Windows 10 64-bit, macOS 10.15.7, and Raspberry Pi OS 10.6.

To install this module, run:
```
npm install @csllc/cs-canbus-universal
```

## Usage

### Listing available ports

The `list()` method returns an array of `port` objects as returned by their respective modules.

```js
const Can = require('@csllc/cs-canbus-universal');

let can = new Can({
  canRate: 250000,
  filters: [ {
      ext: true,
      id: '10EF0000 10EFFFFF',
  } ]
});

can.list()
  .then((ports) => {
    console.log(ports);
  });
```

Example output:
```js
[ { path: 'COM9',
    manufacturer: 'FTDI',
    serialNumber: 'A601UDK6',
    pnpId: 'FTDIBUS\\VID_0403+PID_6001+A601UDK6A\\0000',
    locationId: undefined,
    vendorId: '0403',
    productId: '6001',
    type: 'can-usb-com',
    id: 'can-usb-com_COM9' },
  { channel_handle: 81,
    device_type: 5,
    controller_number: 0,
    device_features: 0,
    device_name: 'PCAN-USB',
    device_id: 86,
    channel_condition: 1,
    path: 81,
    type: 'pcan-usb',
    id: 'pcan-usb_81' },
  { channel: 0,
    channel_type: 48,
    path: 0,
    type: 'canlib',
    id: 'canlib_0' } ]
```

Each element of `ports` contains `path`, `type`, and `id`, which uniquely identify the port in a consistent manner, in addition to properties specific to the implementation of a library.

### Opening the first available port

The `ports` array, seen above, can be passed to the `autoOpen()`, which automatically selects the first available port based on the `priority` array passed to the constructor. If a port is unable to be opened (i.e. it is in use by another program), the next port in the `ports` array will be used.

```js
const Can = require('@csllc/cs-canbus-universal');

let can = new Can({
  canRate: 250000,
  filters: [ {
      ext: true,
      id: '10EF0000 10EFFFFF',
  } ],
  priority: ['pcan-usb', 'can-usb-com', 'canlib']
});

can.list()
  .then((ports) => {
    return can.autoOpen(ports)
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });

  });
```

Example output: 

```
Attempting to open port 0: pcan-usb_81 ...
Unable to open port 0 (81) using pcan-usb: Error [PCAN_ERROR_INITIALIZE]: pcan_CAN_Initialize: Error at CAN_Initialize.
Attempting to open port 1: can-usb-com_COM9 ...
Unable to open port 1 (COM9) using can-usb-com: Error: Opening COM9: Access denied
Attempting to open port 2: canlib_0 ...
Opened port 2: canlib_0

```

### Opening a specific port

Alternatively, a specific port may be opened by passing an ID from a single element of the `ports` array to the `open()` method.

```js
const Can = require('@csllc/cs-canbus-universal');

let can = new Can({
  canRate: 250000,
  filters: [ {
      ext: true,
      id: '10EF0000 10EFFFFF',
  } ]
});

can.list()
  .then((ports) => {
    console.log(ports);
    return can.open(ports[0].id)
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  })
```

Example output:

```
[ { path: 'COM9',
    manufacturer: 'FTDI',
    serialNumber: 'A601UDK6',
    pnpId: 'FTDIBUS\\VID_0403+PID_6001+A601UDK6A\\0000',
    locationId: undefined,
    vendorId: '0403',
    productId: '6001',
    type: 'can-usb-com',
    id: 'can-usb-com_COM9' },
  { channel_handle: 81,
    device_type: 5,
    controller_number: 0,
    device_features: 0,
    device_name: 'PCAN-USB',
    device_id: 86,
    channel_condition: 1,
    path: 81,
    type: 'pcan-usb',
    id: 'pcan-usb_81' },
  { channel: 0,
    channel_type: 48,
    path: 0,
    type: 'canlib',
    id: 'canlib_0' } ]
opened port COM9 using can-usb-com
```

### Filtering

See the documentation of the individual CAN modules for details on filtering. While this module passes the constructor's `filter` parameter directly to the modules, they may have differences in implementation that affect certain use cases.

### Streaming

This module extends the NodeJS stream interface, so it can be piped into other stream instances.

### Event and method wrapping

The following events and methods are wrapped or passed through by the `cs-canbus-universal` module. The `open` and `close` events are emitted by this module directly.

#### Events
 - `error`
 - `data`
 - `write`
 - `open`
 - `close`

#### Methods
 - `write(msg)`
 - `status()`
 - `isOpen()`
 - `isConnected()`

## API

This module's API functions generally return Promises, which are resolved or rejected when a request is complete. 

Refer to the [documentation on Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) for details on how to chain requests together, detect errors, etc. 

## Development

Before updating or modifying this package, please

 - Lint any changes using `eslint`.
 - Confirm that the `basic` unit test passes.

In order to run unit tests (`npm test`), one CAN adapter must be connected to the computer.

The `pingpong` example will automatically select two available CAN adapters plugged into the computer. These adapters must be connected via a properly terminated CAN bus.

Do not run any tests on a bus with active traffic, since receiving unexpected CAN packets may confuse the tests.

## Credit

The `_tryOpenPorts()` method's use of recursive `Promise`s was based upon a blog post published by Tamás Polgár: https://medium.com/developer-rants/running-promises-in-a-loop-sequentially-one-by-one-bd803181b283

