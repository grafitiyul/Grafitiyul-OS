// Durable background work for the media platform.
//
// This deliberately replaces the fire-and-forget pattern found in the
// recruitment system (`transcribeChunkAsync` + a polling assembler). That
// design loses every in-flight job on a restart and can only report failure to
// a console nobody is reading. A MediaJob row survives a deploy, is claimed
// exactly once, retries with a REASON, and can be shown honestly in the UI.
//
// Job kinds: transcribe | thumbnail | mirror_to_r2 | probe_metadata.

export const JOB_STATUS = Object.freeze({
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
});

export const JOB_KINDS = Object.freeze({
  transcribe: 'transcribe',
  thumbnail: 'thumbnail',
  mirrorToR2: 'mirror_to_r2',
  probeMetadata: 'probe_metadata',
});

const LIVE = [JOB_STATUS.queued, JOB_STATUS.running];

/**
 * Queue work, idempotently.
 *
 * A double-clicked "תמלל" button, a retried request and a duplicated webhook
 * must all result in ONE job. If a live job of this kind already exists for the
 * media we return it untouched rather than creating a second — enforcing in the
 * service layer what a partial unique index would express, without the
 * permanent schema drift a raw index would cause.
 */
export async function enqueueJob(client, { mediaId, kind, payload = null, requestedById = null, maxAttempts = 3 }) {
  if (!mediaId || !kind) throw new Error('invalid_job');
  const existing = await client.mediaJob.findFirst({
    where: { mediaId, kind, status: { in: LIVE } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { job: existing, created: false };
  const job = await client.mediaJob.create({
    data: { mediaId, kind, payload: payload || undefined, requestedById, maxAttempts },
  });
  return { job, created: true };
}

/**
 * Claim ONE due job atomically.
 *
 * The guarded updateMany is the concurrency control: two workers racing for the
 * same row both attempt the transition from `queued`, and Postgres lets exactly
 * one of them see count === 1. The loser simply looks for another job. This is
 * why the claim is a conditional update and not a read-then-write.
 */
export async function claimJob(client, { kind, now = new Date() } = {}) {
  const candidate = await client.mediaJob.findFirst({
    where: {
      status: JOB_STATUS.queued,
      notBefore: { lte: now },
      ...(kind ? { kind } : {}),
    },
    orderBy: { notBefore: 'asc' },
  });
  if (!candidate) return null;
  const res = await client.mediaJob.updateMany({
    where: { id: candidate.id, status: JOB_STATUS.queued },
    data: {
      status: JOB_STATUS.running,
      claimedAt: now,
      startedAt: now,
      attempts: { increment: 1 },
    },
  });
  if (res.count === 0) return null; // another worker won the race
  return client.mediaJob.findUnique({ where: { id: candidate.id }, include: { media: true } });
}

export async function completeJob(client, jobId) {
  return client.mediaJob.update({
    where: { id: jobId },
    data: { status: JOB_STATUS.done, completedAt: new Date(), lastError: null },
  });
}

/**
 * Fail a job with a REASON the operator can act on.
 *
 * Retries back off, and a job that has used its attempts settles as `failed`
 * rather than being retried forever. `lastError` is preserved either way —
 * a surface showing a bare "failed" with no cause is exactly the dishonest
 * status this project forbids.
 */
export async function failJob(client, jobId, error, { backoffMs = 60_000 } = {}) {
  const job = await client.mediaJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const message = String(error?.message || error || 'unknown_error').slice(0, 500);
  const exhausted = job.attempts >= job.maxAttempts;
  return client.mediaJob.update({
    where: { id: jobId },
    data: {
      status: exhausted ? JOB_STATUS.failed : JOB_STATUS.queued,
      lastError: message,
      notBefore: exhausted ? job.notBefore : new Date(Date.now() + backoffMs * job.attempts),
      completedAt: exhausted ? new Date() : null,
    },
  });
}

export async function cancelJob(client, jobId) {
  return client.mediaJob.updateMany({
    where: { id: jobId, status: { in: LIVE } },
    data: { status: JOB_STATUS.cancelled, completedAt: new Date() },
  });
}

/** The live job of a kind for one media, if any — what the UI polls. */
export async function liveJobFor(client, { mediaId, kind }) {
  return client.mediaJob.findFirst({
    where: { mediaId, kind, status: { in: LIVE } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Honest processing state for a media item.
 *
 * Never reports success because work was merely queued: `queued` and `running`
 * are their own states, and a failure carries its reason forward.
 */
export async function mediaJobState(client, { mediaId, kind }) {
  const job = await client.mediaJob.findFirst({
    where: { mediaId, kind },
    orderBy: { createdAt: 'desc' },
  });
  if (!job) return { status: 'not_started', error: null, attempts: 0 };
  return {
    status: job.status,
    error: job.lastError || null,
    attempts: job.attempts,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}
