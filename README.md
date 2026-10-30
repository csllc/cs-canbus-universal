# NodeJS Universal CAN Bus Module

This module encapsulates functionality for the following CAN libraries and adapters:

 - `can-usb-com`: ([npm](https://www.npmjs.com/package/@csllc/can-usb-com), [GitHub](https://github.com/csllc/can-usb-com)) GridConnect CAN-USB-COM
 - `cs-pcan-usb`: ([npm](https://www.npmjs.com/package/@csllc/cs-pcan-usb), [GitHub](https://github.com/csllc/cs-pcan-usb)) PEAK-System PCAN-USB
 - `cs-canlib`: ([npm](https://www.npmjs.com/package/@csllc/cs-canlib), [GitHub](https://github.com/csllc/cs-canlib)) Kvaser Leaf Light v2
 - `cs-socketcan`: ([npm](https://www.npmjs.com/package/@csllc/cs-socketcan), [GitHub](https://github.com/csllc/cs-socketcan)) PiCAN 2 for Raspberry Pi

Development is focused on the USB CAN adapters listed above, but this module and its dependencies may work with others supported by the underlying libraries with little to no modification.

## Getting Started

The following assumes that [NodeJS](https://nodejs.org) is already installed. NodeJS 20 or later is required, and Node 24 or later is recommended.

To install this module, run:
```
npm install @csllc/cs-canbus-universal
```

The adapter modules are optional dependencies, and each one is only used on the platforms it supports:

| Adapter type (`priority`) | Module | Windows | macOS | Linux |
|---|---|---|---|---|
| `can-usb-com` | `@csllc/can-usb-com` | yes | yes | yes |
| `pcan-usb` | `@csllc/cs-pcan-usb` | yes | yes | |
| `canlib` | `@csllc/cs-canlib` | yes | | |
| `socketcan` | `@csllc/cs-socketcan` | | | yes |

Some adapters also need their vendor's driver or library to be installed; see each module's documentation. If an adapter module is not installed or cannot be loaded (for example because its vendor driver is missing), it is skipped and the other adapters still work. The reason each module was skipped is available in the static `loadErrors` property, keyed by package name:

```js
const Can = require('@csllc/cs-canbus-universal');

for (const [name, err] of Object.entries(Can.loadErrors)) {
  console.log(name, 'is not available:', err.message);
}
```

The default `priority` depends on the platform: `['can-usb-com', 'pcan-usb', 'canlib']` on Windows, `['pcan-usb', 'can-usb-com']` on macOS, and `['can-usb-com', 'socketcan']` on Linux.

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

The `ports` array, seen above, can be passed to the `autoOpen()`, which automatically selects the first available port based on the `priority` array passed to the constructor. If a port is unable to be opened (i.e. it is in use by another program), the next port in the `ports` array will be used. `autoOpen()` rejects if none of the ports can be opened.

Calling `open('auto')` does the same thing, calling `list()` first if it hasn't already been called.

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

 - Lint any changes: `npm run lint`
 - Confirm that the unit tests pass: `npm test`
 - Confirm that the hardware tests pass: `npm run test:hardware`

`npm test` runs `test/unit.test.js`, which replaces the adapter modules with fakes and needs no hardware.

`npm run test:hardware` runs `test/basic.test.js` and `test/filter.test.js`, which need one CAN adapter connected to the computer.

The `pingpong` example will automatically select two available CAN adapters plugged into the computer. These adapters must be connected via a properly terminated CAN bus. It also needs `@csllc/j1939`, which is not a dependency of this package.

Do not run any tests on a bus with active traffic, since receiving unexpected CAN packets may confuse the tests.

## Distribution

The module is plain JavaScript, so nothing needs to be compiled when it is installed. The adapter modules it wraps are optional dependencies, published separately, each with its own prebuilt binaries where it has native code. If an optional dependency fails to install on a particular system, npm skips it and this module skips that adapter.

### Releasing

Releases are published by the GitHub Actions workflow in `.github/workflows/release.yml`, which runs when a version tag is pushed:

 1. Run the hardware tests locally with a CAN adapter connected: `npm run test:hardware` (the CI runners have no CAN hardware, so they only run the unit tests)
 1. `npm version patch` (or `minor` / `major`), which updates `package.json` and creates the tag `vX.Y.Z`
 1. `git push --follow-tags`

The workflow lints the code and runs the unit tests on Windows, macOS and Linux with NodeJS 20, 22 and 24, and shows which adapter modules are usable on each. It then publishes the package to npm. Publishing uses npm trusted publishing, so no npm token is stored in GitHub; the package's trusted publisher on npmjs.com must name this repository and the workflow file `release.yml`.

## Licensing and Dependencies

This project is licensed under the MIT license - see the [LICENSE](LICENSE) file for details.

The adapter modules it uses are licensed separately; see each module's documentation.
