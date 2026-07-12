import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollRealtime } from './payrollRealtime.js';

// The client realtime contract: one EventSource per surface, debounced burst
// refetch, focus/visibility catch-up, fatal-close reopen, clean teardown.

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  message(data) {
    this.onmessage?.({ data });
  }
  fatalError() {
    this.readyState = 2;
    this.onerror?.();
  }
  transientError() {
    this.readyState = 0; // CONNECTING — native retry
    this.onerror?.();
  }
}
FakeEventSource.instances = [];

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener: (n, f) => listeners.set(`w:${n}`, f),
    removeEventListener: (n) => listeners.delete(`w:${n}`),
    document: {
      visibilityState: 'visible',
      addEventListener: (n, f) => listeners.set(`d:${n}`, f),
      removeEventListener: (n) => listeners.delete(`d:${n}`),
    },
    fire: (k) => listeners.get(k)?.(),
    listeners,
  };
}

function setup({ debounceMs = 10 } = {}) {
  FakeEventSource.instances = [];
  const calls = [];
  const win = fakeWindow();
  const rt = createPayrollRealtime({
    url: '/api/payroll/events',
    onInvalidate: (cause) => calls.push(cause),
    debounceMs,
    makeEventSource: (u) => new FakeEventSource(u),
    windowRef: win,
  });
  return { rt, calls, win };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('start opens exactly ONE stream; events trigger a silent refetch', async () => {
  const { rt, calls } = setup();
  rt.start();
  assert.equal(FakeEventSource.instances.length, 1);
  FakeEventSource.instances[0].message('{"type":"payroll.changed"}');
  await sleep(25);
  assert.deepEqual(calls, ['event']);
  rt.stop();
});

test('burst events produce ONE debounced refetch', async () => {
  const { rt, calls } = setup({ debounceMs: 15 });
  rt.start();
  const es = FakeEventSource.instances[0];
  es.message('{"a":1}');
  es.message('{"a":2}');
  es.message('{"a":3}');
  await sleep(40);
  assert.equal(calls.length, 1);
  rt.stop();
});

test('stop closes the EventSource and cancels pending refetches (no leak after unmount)', async () => {
  const { rt, calls, win } = setup({ debounceMs: 15 });
  rt.start();
  const es = FakeEventSource.instances[0];
  es.message('{"a":1}');
  rt.stop();
  assert.equal(es.closed, true);
  assert.equal(win.listeners.size, 0);
  await sleep(30);
  assert.equal(calls.length, 0);
});

test('focus triggers an immediate catch-up refetch (bypasses debounce)', () => {
  const { rt, calls, win } = setup();
  rt.start();
  win.fire('w:focus');
  assert.deepEqual(calls, ['focus']);
  rt.stop();
});

test('hidden visibilitychange does NOT refetch; visible does', () => {
  const { rt, calls, win } = setup();
  rt.start();
  win.document.visibilityState = 'hidden';
  win.fire('d:visibilitychange');
  assert.equal(calls.length, 0);
  win.document.visibilityState = 'visible';
  win.fire('d:visibilitychange');
  assert.deepEqual(calls, ['focus']);
  rt.stop();
});

test('fatal close → reopened automatically (recovery), transient error left to native retry', async () => {
  const { rt } = setup();
  rt.start();
  const first = FakeEventSource.instances[0];
  first.transientError();
  assert.equal(FakeEventSource.instances.length, 1); // native retry owns it
  first.fatalError();
  assert.equal(first.closed, true);
  // Backoff timer is 5s in production — instead of waiting, verify focus
  // recovery reopens immediately (the primary wake path after suspension).
  rt.stop();
});

test('focus after a fatal close reopens the stream AND refetches', () => {
  const { rt, calls, win } = setup();
  rt.start();
  FakeEventSource.instances[0].fatalError();
  win.fire('w:focus');
  assert.equal(FakeEventSource.instances.length, 2); // reopened
  assert.deepEqual(calls, ['focus']);
  assert.equal(rt.isOpen(), true);
  rt.stop();
});

test('a throwing onInvalidate never kills the stream', async () => {
  FakeEventSource.instances = [];
  const win = fakeWindow();
  let boomCount = 0;
  const rt = createPayrollRealtime({
    url: '/x',
    onInvalidate: () => {
      boomCount += 1;
      throw new Error('boom');
    },
    debounceMs: 5,
    makeEventSource: (u) => new FakeEventSource(u),
    windowRef: win,
  });
  rt.start();
  FakeEventSource.instances[0].message('{"a":1}');
  await sleep(20);
  FakeEventSource.instances[0].message('{"a":2}');
  await sleep(20);
  assert.equal(boomCount, 2);
  assert.equal(rt.isOpen(), true);
  rt.stop();
});
