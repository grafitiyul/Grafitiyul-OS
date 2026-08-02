// Automation registration — importing this module wires every automation into
// the registry. Adding an automation is ONE import line here plus the
// definition file; the runtime, the API and the registry screen never change.
//
// Order does not matter: automations are independent by construction (they
// react to events, never to each other). Read order in the registry comes from
// the ledger, so it follows allocation, not import order.
//
// Both automations here are NEW behaviour on the tour summary. No existing GOS
// behaviour was migrated into this engine — coordination reports, tour
// completion, payroll hooks and the background workers all still belong to
// their own modules.

import './AUT-001.payment-received.js';
import './AUT-002.tour-summary-review.js';
import './AUT-003.logistics-alert.js';
