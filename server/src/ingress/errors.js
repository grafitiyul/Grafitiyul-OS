// Ingress Platform — THE shared error model.
//
// Every failure anywhere in the pipeline (adapter, validation, normalization,
// attribution, resolution, persistence) is an IngressError carrying:
//   • code     — stable machine-readable reason, stored on IngressEvent and
//                shown in the admin surface. Never a free-text string.
//   • stage    — which pipeline stage produced it (observability grouping).
//   • retryable— whether a retry could plausibly succeed. Permanent faults
//                (bad signature, unmappable payload) must NOT burn retries;
//                transient ones (provider 5xx, DB blip) must.
//
// The pipeline is the only place that decides what to DO with an error; every
// other module just throws the right coded error. This is what keeps failure
// handling out of the adapters.

export const STAGES = Object.freeze({
  RECEIVE: 'receive',
  VALIDATE: 'validate',
  NORMALIZE: 'normalize',
  ATTRIBUTE: 'attribute',
  RESOLVE: 'resolve',
  PERSIST: 'persist',
});

// Permanent — replaying the same payload will fail identically. Retrying is
// pure waste, so the pipeline parks the event as `failed` immediately.
export const PERMANENT_CODES = Object.freeze([
  'signature_invalid',
  'signature_secret_missing',
  'source_unknown',
  'source_disabled',
  'payload_unparseable',
  'payload_empty',
  'contract_invalid',
  'no_usable_identity',
  'store_unknown',
  'page_not_allowed',
  'form_not_allowed',
]);

export class IngressError extends Error {
  constructor(code, { stage = null, retryable = null, detail = null, cause = null } = {}) {
    super(code);
    this.name = 'IngressError';
    this.code = code;
    this.stage = stage;
    // Explicit wins; otherwise derive from the permanent list. Unknown codes
    // default to retryable — a transient bug should not silently drop a lead.
    this.retryable = retryable === null ? !PERMANENT_CODES.includes(code) : Boolean(retryable);
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

export function ingressError(code, opts) {
  return new IngressError(code, opts);
}

// Any thrown value → IngressError. Unknown throws become retryable
// `internal_error` so an unexpected bug is retried and surfaced, never lost.
export function toIngressError(err, stage = null) {
  if (err instanceof IngressError) {
    if (!err.stage && stage) err.stage = stage;
    return err;
  }
  return new IngressError('internal_error', {
    stage,
    retryable: true,
    detail: err?.message ? String(err.message).slice(0, 500) : null,
    cause: err,
  });
}
