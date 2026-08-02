// Automation registration — importing this module wires every automation into
// the registry. Adding an automation is ONE import line here plus the
// definition file; the runtime, the API and the registry screen never change.
//
// ── What is NOT here anymore ────────────────────────────────────────────────
// Every questionnaire automation has been retired. AUT-001 and AUT-003 became
// Manager Reports #19 and #20; AUT-002 became a direct call from the submit
// path (questionnaires/service.js), because a registry runtime between "a form
// was submitted" and "a card exists" added a second idempotency layer and an
// enable/disable toggle on top of operations that are each already idempotent,
// and made the chain readable only by tracing a definition, a trigger match and
// an action executor.
//
// What remains is the ONE thing this engine is genuinely for: a business event
// that an operator wants to route to editable Communication Center content.
//
// Order does not matter: automations are independent by construction (they
// react to events, never to each other). Read order in the registry comes from
// the ledger, so it follows allocation, not import order.

import './AUT-004.new-lead-manager-alert.js';
