// Automation registration — importing this module wires every automation into
// the registry. Adding an automation is ONE import line here plus the
// definition file; the runtime, the API and the registry screen never change.
//
// Order does not matter: automations are independent by construction (they
// react to events, never to each other). Read order in the registry comes from
// the ledger, so it follows allocation, not import order.
//
// AUT-001 was retired: the same business event is now Manager Report #19, so
// there is exactly one implementation and one sender. See ledger.js RETIRED.
//
// The automations here are NEW behaviour on the tour summary. No existing GOS
// behaviour was migrated into this engine — coordination reports, tour
// completion, payroll hooks and the background workers all still belong to
// their own modules.

import './AUT-002.tour-summary-review.js';
import './AUT-003.logistics-alert.js';
import './AUT-004.new-lead-manager-alert.js';
