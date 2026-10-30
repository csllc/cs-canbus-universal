/**
 * Unit tests that need no CAN hardware. The adapter modules are replaced with
 * fakes, so these run on any platform.
 */

const CanBus = require('..');
const chai = require('chai');
const expect = chai.expect;
chai.should();
chai.use(require('chai-events'));

const { EventEmitter } = require('events');

// Stands in for an adapter module (can-usb-com, cs-pcan-usb, etc.)
class FakeAdapter extends EventEmitter {
  constructor(ports, failPaths = []) {
    super();
    this.ports = ports;
    this.failPaths = failPaths;
    this.opened = undefined;
  }

  async list() {
    return this.ports.map((p) => Object.assign({}, p));
  }

  async open(path) {
    if (this.failPaths.includes(path)) {
      throw new Error('Access denied');
    }
    this.opened = path;
  }

  async close() {
    this.opened = undefined;
  }

  isOpen() {
    return this.opened !== undefined;
  }

  isConnected() {
    return this.isOpen();
  }

  write(msg) {
    this.emit('write', msg);
  }
}

// Creates an instance with fake can-usb-com and pcan-usb adapters
function makeBus(canUsbCom, pcanUsb, options = {}) {
  const can = new CanBus(Object.assign({
    priority: ['pcan-usb', 'can-usb-com'],
  }, options));
  can.canUsbCom = canUsbCom;
  can.pcanUsb = pcanUsb;
  can.canlib = undefined;
  can.socketcan = undefined;
  return can;
}

// Keep the module's progress messages out of the test output
let saved;
before(() => {
  saved = { debug: console.debug, error: console.error };
  console.debug = () => {};
  console.error = () => {};
});
after(() => {
  console.debug = saved.debug;
  console.error = saved.error;
});

describe('Module', () => {
  it('should load and construct with default options', () => {
    const can = new CanBus();
    expect(can.options.canRate).to.eq(250000);
    expect(can.options.filters).to.deep.eq([]);
    expect(can.options.loopback).to.eq(false);
    expect(can.options.priority).to.be.an('array').that.is.not.empty;
    expect(can.isOpen()).to.eq(false);
  });

  it('should report adapter modules that could not be loaded', () => {
    expect(CanBus.loadErrors).to.be.an('object');
  });

  it('should not share options between instances', () => {
    const a = new CanBus({ canRate: 500000, loopback: true });
    const b = new CanBus();
    expect(a.options.canRate).to.eq(500000);
    expect(a.options.loopback).to.eq(true);
    expect(b.options.canRate).to.eq(250000);
    expect(b.options.loopback).to.eq(false);

    a.options.priority.push('modified');
    expect(new CanBus().options.priority).to.not.include('modified');
  });

  it('should reject an unknown adapter in the priority list', () => {
    expect(() => new CanBus({ priority: ['can-usb'] })).to.throw(/Unknown adapter/);
  });

  it('should list ports from the installed adapter modules', async function() {
    // The CI runners have no CAN adapters, so the list may well be empty;
    // this checks that the real adapter modules load and list without error.
    this.timeout(10000);
    const ports = await new CanBus().list();
    expect(ports).to.be.an('array');
  });
});

describe('Listing ports', () => {
  it('should list ports in priority order with type and id', async () => {
    const can = makeBus(
      new FakeAdapter([{ path: 'COM9' }]),
      new FakeAdapter([{ path: 81 }, { path: 82 }]));

    const ports = await can.list();

    expect(ports.map((p) => p.id)).to.deep.eq([
      'pcan-usb_81', 'pcan-usb_82', 'can-usb-com_COM9',
    ]);
    expect(ports[0].type).to.eq('pcan-usb');
    expect(ports[2].type).to.eq('can-usb-com');
    expect(can.ports).to.eq(ports);
  });

  it('should skip adapters that are unavailable', async () => {
    const can = makeBus(new FakeAdapter([{ path: 'COM9' }]), undefined);
    const ports = await can.list();
    expect(ports.map((p) => p.id)).to.deep.eq(['can-usb-com_COM9']);
  });

  it('should skip adapters that fail to list ports', async () => {
    const broken = new FakeAdapter([]);
    broken.list = async () => { throw new Error('driver missing'); };
    const can = makeBus(new FakeAdapter([{ path: 'COM9' }]), broken);
    const ports = await can.list();
    expect(ports.map((p) => p.id)).to.deep.eq(['can-usb-com_COM9']);
  });
});

describe('Opening ports', () => {
  it('should open a specific port by id', async () => {
    const canUsbCom = new FakeAdapter([{ path: 'COM9' }]);
    const can = makeBus(canUsbCom, new FakeAdapter([{ path: 81 }]));

    const p = can.should.emit('open');
    await can.open('can-usb-com_COM9');
    await p;

    expect(canUsbCom.opened).to.eq('COM9');
    expect(can.selectedModule).to.eq(canUsbCom);
    expect(can.isOpen()).to.eq(true);
  });

  it('should convert numeric paths and keep underscores in paths', async () => {
    const canUsbCom = new FakeAdapter([]);
    const pcanUsb = new FakeAdapter([]);
    const can = makeBus(canUsbCom, pcanUsb);

    await can.open('pcan-usb_81');
    expect(pcanUsb.opened).to.equal(81);

    await can.open('can-usb-com_/dev/serial/by-id/usb-FTDI_A601');
    expect(canUsbCom.opened).to.eq('/dev/serial/by-id/usb-FTDI_A601');
  });

  it('should reject invalid or unknown ids', async () => {
    const can = makeBus(new FakeAdapter([]), undefined);
    await expectReject(can.open('nonsense'), /Invalid port ID/);
    await expectReject(can.open('foo_1'), /Unrecognized port type/);
    await expectReject(can.open('pcan-usb_81'), /not available/);
  });

  it('should automatically open the first port that can be opened', async () => {
    const canUsbCom = new FakeAdapter([{ path: 'COM9' }]);
    const pcanUsb = new FakeAdapter([{ path: 81 }, { path: 82 }], [81]);
    const can = makeBus(canUsbCom, pcanUsb);

    await can.open('auto');

    expect(can.selectedPort.id).to.eq('pcan-usb_82');
    expect(pcanUsb.opened).to.eq(82);
    expect(canUsbCom.opened).to.eq(undefined);
  });

  it('should fall through to a lower priority adapter', async () => {
    const canUsbCom = new FakeAdapter([{ path: 'COM9' }]);
    const pcanUsb = new FakeAdapter([{ path: 81 }], [81]);
    const can = makeBus(canUsbCom, pcanUsb);

    const ports = await can.list();
    await can.autoOpen(ports);

    expect(can.selectedPort.id).to.eq('can-usb-com_COM9');
  });

  it('should reject if no port can be opened', async () => {
    const can = makeBus(
      new FakeAdapter([{ path: 'COM9' }], ['COM9']),
      new FakeAdapter([{ path: 81 }], [81]));
    await expectReject(can.open('auto'), /Unable to open any of 2/);
  });

  it('should reject if there are no ports', async () => {
    const can = makeBus(new FakeAdapter([]), new FakeAdapter([]));
    await expectReject(can.open('auto'), /No CAN ports/);
  });
});

describe('Events', () => {
  let can;
  let adapter;

  beforeEach(async () => {
    adapter = new FakeAdapter([{ path: 'COM9' }]);
    can = makeBus(adapter, undefined);
    await can.open('can-usb-com_COM9');
  });

  it('should pass data through', (done) => {
    can.once('data', (msg) => {
      expect(msg).to.deep.eq({ id: 0x100, ext: false, buf: Buffer.from([1]) });
      done();
    });
    adapter.emit('data', { id: 0x100, ext: false, buf: Buffer.from([1]) });
  });

  it('should pass write, status and error events through', async () => {
    const pw = can.should.emit('write');
    const ps = can.should.emit('status');
    const pe = can.should.emit('error');
    can.write({ id: 1, ext: false, buf: [] });
    adapter.emit('status', { connected: true });
    adapter.emit('error', new Error('bus off'));
    await Promise.all([pw, ps, pe]);
  });

  it('should emit close and stop passing events through after close', async () => {
    const pc = can.should.emit('close');
    await can.close();
    await pc;
    expect(adapter.listenerCount('data')).to.eq(0);
    expect(adapter.listenerCount('error')).to.eq(0);
  });

  it('should not pass events through twice after reopening', async () => {
    await can.close();
    await can.open('can-usb-com_COM9');
    let count = 0;
    can.on('write', () => { count++; });
    can.write({ id: 1, ext: false, buf: [] });
    expect(count).to.eq(1);
  });
});

async function expectReject(promise, pattern) {
  try {
    await promise;
  } catch (err) {
    expect(err.message).to.match(pattern);
    return;
  }
  throw new Error('Expected promise to reject');
}
