import test from 'node:test';
import assert from 'node:assert/strict';
import {
  floatingZ,
  dialogZ,
  FLOATING_BASE_Z,
  FLOATING_MAX_DEPTH,
  DIALOG_BASE_Z,
} from './floatingLayerCore.js';

// The layering contract. Every case here is a real nesting the Deal workspace
// produces: a Tour Details popover, the guide picker opened inside it, and an
// error dialog raised from that picker.

test('depth 0 keeps the historical AnchoredMenu values', () => {
  assert.deepEqual(floatingZ(0), { catcher: 90, panel: 91 });
});

test('a nested surface catcher outranks its parent panel', () => {
  // THE nesting bug: the child popover must be dismissible by clicking the
  // parent popover, which only works if its catcher paints above that panel.
  const parent = floatingZ(0);
  const child = floatingZ(1);
  assert.ok(child.catcher > parent.panel, 'child catcher above parent panel');
  assert.ok(child.panel > child.catcher, 'child panel above its own catcher');
});

test('every level is strictly above the one below it', () => {
  for (let d = 1; d <= FLOATING_MAX_DEPTH; d += 1) {
    assert.ok(floatingZ(d).catcher > floatingZ(d - 1).panel, `depth ${d}`);
  }
});

test('the band never reaches the z-100 app-chrome layer', () => {
  assert.ok(floatingZ(FLOATING_MAX_DEPTH).panel < 100);
  assert.equal(floatingZ(0).catcher, FLOATING_BASE_Z);
});

test('depth is clamped, so runaway nesting cannot escape the band', () => {
  assert.deepEqual(floatingZ(99), floatingZ(FLOATING_MAX_DEPTH));
  assert.deepEqual(floatingZ(-5), floatingZ(0));
  assert.deepEqual(floatingZ(undefined), floatingZ(0));
});

test('a top-level dialog keeps z-50; a nested one is lifted above its host', () => {
  assert.equal(dialogZ(0), DIALOG_BASE_Z);
  assert.ok(dialogZ(1) > floatingZ(0).panel, 'a dialog raised from a popover covers it');
});
