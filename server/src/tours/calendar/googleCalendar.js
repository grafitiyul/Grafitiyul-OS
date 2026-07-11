import { getFreshAccessToken } from '../../email/googleClient.js';

// Google Calendar v3 REST, hand-rolled over global fetch — the SAME lean
// pattern as gmailFetch (src/email/googleClient.js): bearer token from the
// shared encrypted-token store, one forced-refresh retry on 401. The calendar
// is a sync TARGET only; every method here is called exclusively by the tours
// calendar sync worker (no manual event editing from GOS by product rule).
//
// All writes pass sendUpdates=all so GOOGLE owns the notification story:
// insert → invitations, patch with attendee changes → invites/cancellations
// only for the affected guests, delete → cancellation emails. GOS never sends
// its own invitation emails.

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export async function calendarFetch(client, account, path, { method = 'GET', query, body } = {}) {
  let token = await getFreshAccessToken(client, account);
  for (let attempt = 0; ; attempt += 1) {
    const url = new URL(`${CALENDAR_BASE}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      // Force-refresh once (expiry clock skew / revoked access token).
      await client.emailAccount.update({
        where: { id: account.id },
        data: { accessTokenEnc: null, accessTokenExpiresAt: null },
      });
      account.accessTokenEnc = null;
      account.accessTokenExpiresAt = null;
      token = await getFreshAccessToken(client, account);
      continue;
    }
    // DELETE returns 204 with an empty body; don't force-parse JSON.
    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(
        `gcal ${method} ${path} → ${res.status}: ${payload?.error?.message || ''}`.trim(),
      );
      err.status = res.status;
      err.reason = payload?.error?.errors?.[0]?.reason || null;
      throw err;
    }
    return payload;
  }
}

// The worker always operates on the org account's PRIMARY calendar.
const CAL = 'primary';

export const gcal = {
  getEvent: (client, account, eventId) =>
    calendarFetch(client, account, `/calendars/${CAL}/events/${encodeURIComponent(eventId)}`),

  insertEvent: (client, account, event) =>
    calendarFetch(client, account, `/calendars/${CAL}/events`, {
      method: 'POST',
      query: { sendUpdates: 'all' },
      body: event,
    }),

  patchEvent: (client, account, eventId, patch) =>
    calendarFetch(client, account, `/calendars/${CAL}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      query: { sendUpdates: 'all' },
      body: patch,
    }),

  deleteEvent: (client, account, eventId) =>
    calendarFetch(client, account, `/calendars/${CAL}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      query: { sendUpdates: 'all' },
    }),

  // Idempotency guard for creates: if a previous insert succeeded but the DB
  // write of the event id was lost, the event is findable by the private
  // extended property we stamp on every event (gosTourEventId).
  findByTourEventId: async (client, account, tourEventId) => {
    const res = await calendarFetch(client, account, `/calendars/${CAL}/events`, {
      query: {
        privateExtendedProperty: `gosTourEventId=${tourEventId}`,
        showDeleted: 'false',
        maxResults: '2',
      },
    });
    return res?.items?.[0] || null;
  },
};
