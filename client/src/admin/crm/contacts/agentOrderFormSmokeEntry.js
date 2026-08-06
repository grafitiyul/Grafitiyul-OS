// Bundle entry for agentOrderFormCard.smoke.test.js — the real card plus the
// canonical toast channel, so the test drives production code, not a copy.
export { default as AgentOrderFormCard } from './AgentOrderFormCard.jsx';
export { subscribeToasts } from '../../../lib/toast.js';
