// THE shared server-side realtime mechanism — channelised SSE plumbing,
// extracted from payroll/events.js when the CRM Tasks workspace became the
// second consumer (decision #7: one realtime system, never two).
//
// This module is MECHANISM only: subscriber registry per channel, plain
// fan-out, and the Express/SSE plumbing (headers, heartbeat, cleanup).
// POLICY stays in the domain modules — payroll/events.js keeps its post-commit
// guard, guide-scoped filtering and minimal-payload rules and iterates
// subscribersOf() itself; tasks/events.js keeps its own guard and uses the
// plain publish(). Events are INVALIDATION HINTS only, everywhere.
//
// Delivery is in-process (single Railway service). If GOS ever scales to
// multiple instances this module is the seam to swap for pg NOTIFY/Redis.

export const SSE_HEARTBEAT = ':hb\n\n';
export const SSE_RETRY = 'retry: 5000\n\n';
export const HEARTBEAT_MS = 25_000; // well under Railway's edge idle timeout

// channel name → Set<sub>. A sub is { send(event), ...domainScopeFields }.
const channels = new Map();

function channelSet(channel) {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  return set;
}

export function subscribe(channel, sub) {
  const set = channelSet(channel);
  set.add(sub);
  return () => set.delete(sub);
}

/** Snapshot — safe to iterate while subscribers come and go. */
export function subscribersOf(channel) {
  return [...(channels.get(channel) ?? [])];
}

export function subscriberCount(channel) {
  return channels.get(channel)?.size ?? 0;
}

/** Plain fan-out to every subscriber. A dead socket never breaks the others. */
export function publish(channel, event) {
  for (const sub of subscribersOf(channel)) {
    try {
      sub.send(event);
    } catch {
      /* dead socket — its close handler cleans it up */
    }
  }
}

export function sseData(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Attach an SSE stream to an Express response and register the subscriber on
// `channel` (extra fields ride on the sub for domain filtering, e.g. payroll's
// guide scope). One stream per mounted client surface; the heartbeat keeps
// proxies from closing the idle connection; close cleans everything up.
export function openStream(req, res, { channel, ...scope }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(SSE_RETRY);
  res.write(':connected\n\n');

  const sub = { ...scope, send: (event) => res.write(sseData(event)) };
  const unsubscribe = subscribe(channel, sub);
  const heartbeat = setInterval(() => {
    try {
      res.write(SSE_HEARTBEAT);
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
}
