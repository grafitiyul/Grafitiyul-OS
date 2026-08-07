import test from 'node:test';
import assert from 'node:assert/strict';
import {
  floatingZ,
  dialogZ,
  FLOATING_BASE_Z,
  FLOATING_MAX_DEPTH,
  DIALOG_BASE_Z,
  PANE_MAX_Z,
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

test('a top-level dialog sits on the modal layer; a nested one is lifted above its host', () => {
  assert.equal(dialogZ(0), DIALOG_BASE_Z);
  assert.ok(dialogZ(1) > floatingZ(0).panel, 'a dialog raised from a popover covers it');
});

test('a modal dialog paints ABOVE every drawer and workspace pane', () => {
  // The production defect: the Quote preview opened from a Deal drawer had its
  // footer buttons hidden behind the WhatsApp pane, because dialogs sat at 50
  // and drawers at 60.
  assert.ok(dialogZ(0) > PANE_MAX_Z, 'dialog above the pane ceiling');
});

test('a dropdown opened INSIDE a dialog still paints above that dialog', () => {
  // Dialog hands its children depth+1, so this is the depth a menu inside a
  // top-level dialog actually gets. Without it, every select in every modal
  // would render underneath the modal.
  assert.ok(floatingZ(1).panel > dialogZ(0));
  assert.ok(floatingZ(1).catcher > dialogZ(0), 'its outside-click catcher too');
});

test('an anchored global overlay paints above any drawer', () => {
  // Global search belongs to the application layer, not to whichever pane
  // happens to be open under it.
  assert.ok(floatingZ(0).catcher > PANE_MAX_Z);
});

test('the whole order holds, low to high', () => {
  const order = [PANE_MAX_Z, dialogZ(0), floatingZ(0).catcher, floatingZ(FLOATING_MAX_DEPTH).panel];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] > order[i - 1], `step ${i}: ${order[i]} > ${order[i - 1]}`);
  }
  assert.ok(order[order.length - 1] < 100, 'and all of it stays below app chrome');
});
