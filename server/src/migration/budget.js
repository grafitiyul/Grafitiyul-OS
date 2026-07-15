// Hard request guard for the one-time migration extraction.
//
// Purpose (deliberately small — NOT a permanent API-budget platform): an approved
// run may make no more than its measured request plan plus an explicit margin.
//
// Semantics:
//   * `limit` is a CUMULATIVE ceiling on Pipedrive requests for this snapshot,
//     read from config before launch and checked BEFORE every request.
//   * `used` is persisted in the snapshot's R2 run state, so restarting the
//     process CANNOT reset the allowance. Raising the ceiling requires an
//     explicit config change by the operator — never an automatic reset.
//   * We do NOT try to infer company-wide consumption (Pipedrive does not expose
//     it reliably); this only bounds what THIS run does.
export class RunLimitReached extends Error {
  constructor(limit, used) {
    super(`migration_run_limit_reached: ${used}/${limit} Pipedrive requests for this run`);
    this.code = 'RUN_LIMIT_REACHED';
    this.limit = limit;
    this.used = used;
  }
}

export class RequestBudget {
  // onPersist(snapshot) is awaited every `persistEvery` requests so a hard kill
  // can under-count by at most `persistEvery` — never over-grant across restarts.
  constructor({ limit, used = 0, onPersist = null, persistEvery = 50 } = {}) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('budget_limit_required');
    this.limit = limit;
    this.used = Number(used) || 0;
    this.onPersist = onPersist;
    this.persistEvery = persistEvery;
    this._sincePersist = 0;
  }

  remaining() { return Math.max(0, this.limit - this.used); }
  snapshot() { return { limit: this.limit, used: this.used }; }

  // Call IMMEDIATELY BEFORE each Pipedrive request. Throws instead of exceeding.
  async take() {
    if (this.used >= this.limit) throw new RunLimitReached(this.limit, this.used);
    this.used += 1;
    this._sincePersist += 1;
    if (this.onPersist && this._sincePersist >= this.persistEvery) {
      this._sincePersist = 0;
      await this.onPersist(this.snapshot());
    }
  }

  async flush() {
    this._sincePersist = 0;
    if (this.onPersist) await this.onPersist(this.snapshot());
  }
}
