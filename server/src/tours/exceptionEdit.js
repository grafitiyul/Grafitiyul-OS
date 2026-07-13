// Pure reconciliation planner for a one-off EXCEPTION edit. Given the (edited)
// exception and the already-materialized slots on its date, it decides what to
// cancel / retime, and separates out the occurrences that carry registrations so
// the caller can require explicit confirmation and emit a canonical impact
// record. 'add' exceptions materialize via generation, so there is no existing
// slot to reconcile here. No IO — unit-tested directly.

export function planExceptionReconcile(exception, slots = []) {
  const cancel = [];
  const retime = [];
  const registered = []; // affected occurrences that hold seats → need confirm

  for (const s of slots) {
    const seats = s.seats || 0;
    if (exception.type === 'cancel') {
      if (seats > 0) registered.push({ ...s, action: 'cancel' });
      else cancel.push(s);
    } else if (exception.type === 'time_override') {
      if (!exception.time || exception.time === s.startTime) continue; // noop
      if (seats > 0) registered.push({ ...s, action: 'retime', toTime: exception.time });
      else retime.push({ ...s, toTime: exception.time });
    }
    // 'add' → handled by generation; nothing to reconcile on existing slots.
  }
  return { cancel, retime, registered };
}

// Split into an impact summary + the actions safe to apply. Registered
// occurrences are only cancelled/retimed when confirmRegistered is set; those
// become `impacted` (the caller emits one canonical impact record each).
export function classifyExceptionPlan(plan, { confirmRegistered = false } = {}) {
  const regCancel = plan.registered.filter((r) => r.action === 'cancel');
  const regRetime = plan.registered.filter((r) => r.action === 'retime');
  return {
    summary: {
      willCancel: plan.cancel.length,
      willRetime: plan.retime.length,
      requiresConfirmation: plan.registered,
    },
    apply: {
      cancel: [...plan.cancel, ...(confirmRegistered ? regCancel : [])],
      retime: [...plan.retime, ...(confirmRegistered ? regRetime : [])],
      impacted: confirmRegistered ? plan.registered : [],
    },
  };
}
