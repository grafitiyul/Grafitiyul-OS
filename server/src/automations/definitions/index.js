// Automation registration — importing this module wires every automation into
// the registry. Adding an automation is ONE import line here plus the
// definition file; the runtime, the API and the registry screen never change.
//
// Order does not matter: automations are independent by construction (they
// react to events, never to each other). Read order in the registry comes from
// the ledger, so it follows allocation, not import order.
//
// Slice 1 registers nothing — the registry core, the dependency resolvers and
// the publish guard all work correctly against an empty registry, which is
// exactly what lets Slice 0 ship on its own. Adoption of the existing
// behaviours (AUT-001 …) lands in Slice 2, one definition at a time, each with
// a parity test proving the new path matches the old one.

// import './AUT-001.coordination-on-time.js';
