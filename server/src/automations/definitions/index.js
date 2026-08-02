// Automation registration — importing this module wires every automation into
// the registry.
//
// ── There are currently NONE, and that is the finished state ────────────────
// All four allocated automations have been retired into Manager Reports:
//   AUT-001 → report #19   (payment left after the tour)
//   AUT-002 → a direct call from questionnaires/service.js (review cards)
//   AUT-003 → report #20   (logistics)
//   AUT-004 → report #25   (new external lead)
//
// The pattern every one of them followed was: a business event, routed through
// a registry runtime, into Communication Center content, into the queue. That
// middle layer added a second idempotency mechanism and an enable/disable
// toggle on top of operations already idempotent by their own unique index,
// and split "what happens when X" across three files. The Communication Center
// now owns CUSTOMER-facing content only; every message to the team is a
// code-defined report on the shared queue.
//
// The ENGINE stays. What it is for is unchanged and still valid: a business
// event an operator wants routed to editable content. Nothing needs it today.
//
// Adding one back is: allocate an id in ledger.js, add a trigger kind and the
// source that emits it, add a definition file, add one import line here.
// ledger.js keeps every retired id and its reason, so no id is ever reused.
