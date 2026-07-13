// Detector registration — importing this module (from server index.js) wires
// every detector into the sweep worker and its issue types into the registry.
// Adding a module to בקרה = one detector file + one import line here; the
// dashboard, API and lifecycle never change.

import './gallery.js';
import './whatsapp.js';
import './dealTourSync.js';
import './heldExpired.js';
import './overCapacity.js';
import './wooSync.js';
// Register the canonical tour-change impact issue type at startup (event-emitted
// by rule/exception edits; no sweep detector).
import '../../tours/changeImpact.js';
