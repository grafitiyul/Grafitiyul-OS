// Baileys connection manager — port of the Challenge System's battle-hardened
// BaileysClient (client.ts), Slice-1 scope, one instance per WhatsApp account.
//
// What this DOES:
//   - Boot a Baileys socket using the Postgres-backed auth state.
//   - Persist QR codes + connection status to WhatsAppAccount so the GOS
//     admin UI renders them without talking to Baileys directly.
//   - Reconnect with exponential backoff after non-loggedOut closures.
//   - NEVER auto-wipe creds on loggedOut (deploy-overlap protection — the
//     hard-learned Challenge System lesson); stop reconnecting and surface
//     the state so the admin decides.
//   - Expose admin recovery: restartSocket / hardResetSession / signOut.
//
// What this DOES NOT YET DO (later slices): message ingestion + media
// (Slice 2), outbound send + retransmit replay (Slice 6 of the module plan).
// The extension point is marked SLICE-2 HOOK below.
//
// Reconnect math: delay = min(maxDelay, minDelay * 2^attempt); attempts reset
// after the connection stays open ≥ healthyMs.
//
// Hardening carried over verbatim (each fixed a real production failure):
//   - activeSocketId guard: every event handler captures its socketId at
//     attach time and ignores events from replaced sockets — prevents an old
//     socket's late close event from clobbering the fresh live socket (the
//     post-QR flapping bug).
//   - reconnectChain + reopenInFlight: all connect/reopen work serializes
//     through one promise chain; concurrent triggers coalesce.
//   - per-instance msgRetryCounterCache that survives socket reopens (a
//     per-socket cache un-bounds Baileys' retry-receipt loop).
//   - readiness snapshot separate from persisted status: wsState is reported
//     for diagnostics but never gates ok (wrapper readyState can read
//     'unknown' on a healthy socket).

import pino from 'pino';
import { config } from './config.js';
import { prisma } from './db.js';
import { getBaileys } from './baileysLib.js';
import { makePostgresAuthState } from './authStore.js';
import { accountState } from './accountState.js';
import { createIngest } from './ingest.js';
import { isMediaConfigured } from './media.js';

const RETRY_CACHE_TTL_MS = 15 * 60_000;

function makeRetryCounterCache() {
  const map = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [k, e] of map) {
      if (now - e.at > RETRY_CACHE_TTL_MS) map.delete(k);
    }
  };
  return {
    get(key) {
      sweep();
      const e = map.get(key);
      return e ? e.v : undefined;
    },
    set(key, value) {
      sweep();
      map.set(key, { v: value, at: Date.now() });
      return true;
    },
    del(key) {
      return map.delete(key) ? 1 : 0;
    },
    flushAll() {
      map.clear();
    },
  };
}

function wsStateName(raw) {
  switch (raw) {
    case 0: return 'CONNECTING';
    case 1: return 'OPEN';
    case 2: return 'CLOSING';
    case 3: return 'CLOSED';
    default: return 'unknown';
  }
}

function describeReason(code) {
  if (code === undefined) return 'unknown';
  for (const [name, value] of Object.entries(getBaileys().DisconnectReason)) {
    if (typeof value === 'number' && value === code) return name;
  }
  return `code_${code}`;
}

function errMessage(err) {
  if (err instanceof Error) return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  return String(err).slice(0, 240);
}

function disconnectCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode;
}

export class WaClient {
  constructor(accountId) {
    this.accountId = accountId;
    this.log = pino({ level: config.logLevel, name: `baileys:${accountId}` });
    this.socket = null;
    this.auth = null;
    this.reconnectTimer = null;
    this.healthyTimer = null;
    // loggedOut told us to stop reconnecting; cleared by explicit start().
    this.stopped = false;
    // In-memory backoff counter (the persisted reconnectAttempts is UI-only).
    this.attempt = 0;
    // In-memory "usable for protocol work" flag — set on connection.update
    // 'open', cleared on 'close'. Cheaper and race-free vs reading the DB row.
    this.connected = false;
    // Readiness diagnostics.
    this.socketOpenedAt = null;
    this.lastConnectionUpdate = null;
    this.lastDisconnectReason = null;
    this.staleReason = null;
    this.reconnecting = false;
    // Single-socket lifecycle invariant (see file header).
    this.activeSocketId = 0;
    this.reopenInFlight = false;
    this.reconnectChain = Promise.resolve();
    // Baileys retry-receipt counter cache — per INSTANCE (per account), so it
    // survives reopenSocket() but two accounts in one process could never
    // share state. No module-level account state anywhere in this file.
    this.msgRetryCounterCache = makeRetryCounterCache();
    // All outbound sends serialize through one promise chain (Slice 6) —
    // concurrent sends through one WhatsApp socket corrupt ordering and trip
    // rate heuristics. Same withSendLock pattern as the reconnect chain.
    this.sendChain = Promise.resolve();
  }

  async start() {
    this.stopped = false;
    if (this.socket) {
      this.log.info('client already running, ignoring start()');
      return;
    }
    await this.withReconnectLock(() => this.connect());
  }

  isConnected() {
    return this.getReadiness().ok;
  }

  // Full snapshot of every signal used to decide whether the socket is
  // usable. Priority order: reconnecting → staleReason → no socket → not
  // connected → no user (handshake incomplete). wsState is diagnostics only.
  getReadiness() {
    const socket = this.socket;
    const hasSocket = socket !== null;
    const hasUser = !!socket?.user;
    const ws = socket?.ws;
    const wsState = wsStateName(ws?.readyState);
    const ageMs = this.socketOpenedAt ? Date.now() - this.socketOpenedAt.getTime() : null;

    let reason = null;
    if (this.reconnecting) reason = 'reconnecting';
    else if (this.staleReason) reason = `stale:${this.staleReason}`;
    else if (!hasSocket) reason = 'no_socket';
    else if (!this.connected) reason = 'not_connected_flag';
    else if (!hasUser) reason = 'no_user';

    return {
      ok: reason === null,
      reason,
      hasSocket,
      connected: this.connected,
      hasUser,
      wsState,
      ageMs,
      lastUpdate: this.lastConnectionUpdate,
      lastDisconnectReason: this.lastDisconnectReason,
      staleReason: this.staleReason,
      reconnecting: this.reconnecting,
    };
  }

  // Single entry point EVERY reconnect path funnels through: admin restart
  // (markStale=true), restartRequired close (markStale=false — routine
  // protocol signal), connectionReplaced fallback (markStale=true).
  async reopenSocket(reason, opts) {
    if (this.stopped) {
      this.log.warn({ reason }, 'reopen skipped: client stopped');
      return;
    }
    if (this.reopenInFlight) {
      this.log.info({ reason }, 'reopen skipped: another reopen already in progress');
      return;
    }
    this.reopenInFlight = true;
    try {
      await this.withReconnectLock(async () => {
        const oldSocketId = this.activeSocketId;
        this.reconnecting = true;
        this.connected = false;
        if (opts.markStale) this.staleReason = reason;
        const ageMs = this.socketOpenedAt ? Date.now() - this.socketOpenedAt.getTime() : null;
        this.log.warn(
          { reason, oldSocketId, ageMs, markStale: opts.markStale, lastUpdate: this.lastConnectionUpdate },
          'reopen requested',
        );

        // Detach OUR listeners from the old socket BEFORE end()ing it —
        // belt-and-suspenders alongside the activeSocketId guard.
        const old = this.socket;
        this.socket = null;
        this.socketOpenedAt = null;
        if (old) {
          this.detachListeners(old, oldSocketId);
          try {
            old.end(new Error(`bridge_force_reopen:${reason}`));
            this.log.info({ oldSocketId, reason }, 'old socket closed');
          } catch (err) {
            this.log.warn({ err: errMessage(err), oldSocketId }, 'old socket end() threw; proceeding with reopen');
          }
        }

        if (opts.markStale) {
          await accountState.setDisconnected(prisma, `stale_socket:${reason}`, { incrementAttempts: false });
        }

        this.attempt = 0;
        this.clearTimers();

        try {
          await this.connect();
          this.log.info({ reason, newSocketId: this.activeSocketId }, 'reopen connect() returned (awaiting connection.update open)');
        } catch (err) {
          this.log.error({ err: errMessage(err), reason }, 'reopen connect() failed; falling back to scheduled backoff');
          this.scheduleReconnect();
        }
        // reconnecting flag is cleared by connection.update('open'), not here.
      });
    } finally {
      this.reopenInFlight = false;
    }
  }

  // Admin restart: keeps the persisted auth, rebuilds the live socket. For a
  // wedged socket with a healthy session.
  async restartSocket() {
    this.log.warn('admin restart-socket requested');
    await this.reopenSocket('admin_restart', { markStale: true });
  }

  // Admin HARD RESET: NO logout call (socket.logout() hangs on broken
  // sessions — exactly when a wipe is needed most). Tear down locally, wipe
  // every WhatsAppSession row for this account, reset the account row to a
  // fresh-pair state, open a new socket → fresh QR within ~1s.
  async hardResetSession() {
    this.log.warn('hard-reset-session requested');
    if (this.stopped) {
      this.log.warn('hard-reset deferred: client.stopped=true; un-stopping for the reset');
      this.stopped = false;
    }
    return this.withReconnectLock(async () => {
      this.reopenInFlight = true;
      try {
        const oldSocketId = this.activeSocketId;
        this.reconnecting = true;
        this.connected = false;
        this.staleReason = 'hard_reset';
        this.lastDisconnectReason = null;
        this.log.warn({ oldSocketId }, 'hard-reset: tearing down current socket (no logout call)');

        const old = this.socket;
        this.socket = null;
        this.socketOpenedAt = null;
        if (old) {
          this.detachListeners(old, oldSocketId);
          try {
            old.end(new Error('bridge_hard_reset'));
            this.log.info({ oldSocketId }, 'hard-reset: old socket closed');
          } catch (err) {
            this.log.warn({ err: errMessage(err), oldSocketId }, 'hard-reset: old socket end() threw; proceeding');
          }
        }

        try {
          if (this.auth) {
            await this.auth.clear();
          } else {
            const handle = await makePostgresAuthState(prisma, this.accountId);
            await handle.clear();
          }
          this.log.warn('hard-reset: persisted auth state wiped');
        } catch (err) {
          this.log.error({ err: errMessage(err) }, 'hard-reset: auth.clear() failed; continuing — corrupt rows will be overwritten by fresh pair');
        }
        this.auth = null;

        // Reset the account row to a clean fresh-pair state (keep the row —
        // label/active are admin-owned; only transient fields are cleared).
        try {
          await prisma.whatsAppAccount.updateMany({
            where: { id: this.accountId },
            data: {
              status: 'disconnected', qr: null,
              phoneJid: null, deviceName: null,
              lastQrAt: null, lastConnectedAt: null, lastDisconnectAt: null,
              lastDisconnectReason: 'hard_reset', reconnectAttempts: 0,
            },
          });
          this.log.warn('hard-reset: account row reset');
        } catch (err) {
          this.log.error({ err: errMessage(err) }, 'hard-reset: account row reset failed; continuing — connect() will reset on its own');
        }

        this.attempt = 0;
        this.clearTimers();

        try {
          await this.connect();
          this.log.info({ newSocketId: this.activeSocketId }, 'hard-reset: connect() returned (awaiting QR)');
        } catch (err) {
          this.log.error({ err: errMessage(err) }, 'hard-reset: connect() failed; falling back to scheduled backoff');
          this.scheduleReconnect();
        }
      } finally {
        this.reopenInFlight = false;
      }
    });
  }

  // Disconnect + wipe credentials. Logs the device out on the WhatsApp side
  // too (freeing the linked-device slot). After this the bridge is stopped;
  // the admin re-pairs via hard-reset (which un-stops and emits a QR).
  async signOut() {
    this.log.warn('admin sign-out requested');
    this.stopped = true;
    this.connected = false;
    this.clearTimers();
    try {
      await this.socket?.logout('admin sign-out');
    } catch (err) {
      this.log.warn({ err: errMessage(err) }, 'logout() failed; proceeding with local wipe');
    }
    this.socket = null;
    if (this.auth) {
      await this.auth.clear();
      this.auth = null;
    }
    await accountState.setDisconnected(prisma, 'signed_out', { incrementAttempts: false });
  }

  // ── Outbound send (Slice 6) — verbatim port of the proven sendText ───────
  // Serialization + double readiness check + onWhatsApp gate + 12s timeout
  // with stale-mark-and-reconnect + stale-socket guard. Text-only V1.

  withSendLock(fn) {
    const next = this.sendChain.then(fn, fn);
    this.sendChain = next.catch(() => undefined);
    return next;
  }

  // Existence probe before a phone-JID send. Groups (and @lid privacy JIDs,
  // which onWhatsApp can't resolve) pass through — they only exist because
  // WhatsApp itself told us about them.
  async checkOnWhatsApp(jid) {
    if (!this.socket) throw new Error('whatsapp_not_connected');
    if (!jid.endsWith('@s.whatsapp.net')) return { registered: true, resolvedJid: jid };
    const ON_WA_TIMEOUT_MS = 6_000;
    let timer = null;
    const probe = this.socket.onWhatsApp(jid);
    probe.catch(() => undefined);
    try {
      const result = await Promise.race([
        probe,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('on_whatsapp_timeout')), ON_WA_TIMEOUT_MS);
        }),
      ]);
      const first = Array.isArray(result) ? result[0] : null;
      return { registered: !!first?.exists, resolvedJid: first?.jid ?? null };
    } catch (err) {
      if (err instanceof Error && err.message === 'on_whatsapp_timeout') throw err;
      throw new Error('on_whatsapp_failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Send a text message to a JID (existing chat or phone JID). `quoted` is an
  // optional reply context reconstructed from a mirrored row:
  //   { externalId, fromMe, participant, text }
  // Returns { externalMessageId, payloadBytes, timestamp }.
  async sendText({ jid, text, quoted = null }) {
    const options = {};
    if (quoted?.externalId) {
      // Minimal reconstructed context — enough for WhatsApp clients to
      // render the reply header. participant is required in groups.
      options.quoted = {
        key: {
          remoteJid: jid,
          id: quoted.externalId,
          fromMe: !!quoted.fromMe,
          ...(quoted.participant ? { participant: quoted.participant } : {}),
        },
        message: { conversation: quoted.text || ' ' },
      };
    }
    return this.sendContent(jid, { text }, options);
  }

  // Send a voice note (Slice: voice from GOS). ptt:true renders the WhatsApp
  // voice-message bubble; the buffer should already be OGG/Opus (see
  // voice.js) — anything else degrades to an audio-file message.
  async sendVoice({ jid, buffer, mimetype, seconds = null }) {
    return this.sendContent(jid, {
      audio: buffer,
      ptt: true,
      mimetype,
      ...(seconds ? { seconds: Math.round(seconds) } : {}),
    });
  }

  // The serialized send core every outbound type funnels through:
  // double readiness check, onWhatsApp gate, stale-socket guard, 12s timeout
  // with stale-mark-and-reconnect, retransmit payload capture.
  async sendContent(jid, content, options = {}) {
    // Fast-fail outside the lock — don't queue behind other sends when the
    // socket is already known-unusable.
    const pre = this.getReadiness();
    if (!pre.ok) {
      this.log.warn({ readiness: pre }, 'send pre-flight readiness failed');
      throw new Error('whatsapp_not_connected');
    }
    return this.withSendLock(async () => {
      // Re-check INSIDE the lock — the socket may have gone stale while this
      // send waited its turn.
      const readiness = this.getReadiness();
      if (!readiness.ok) {
        this.log.warn({ readiness }, 'send post-lock readiness failed');
        throw new Error('whatsapp_not_connected');
      }
      const capturedSocketId = this.activeSocketId;
      const socket = this.socket;

      const { registered } = await this.checkOnWhatsApp(jid);
      if (!registered) throw new Error('whatsapp_number_not_found');

      if (this.activeSocketId !== capturedSocketId || this.socket !== socket) {
        this.log.warn(
          { capturedSocketId, activeSocketId: this.activeSocketId },
          'send: socket replaced during send — refusing stale send',
        );
        throw new Error('whatsapp_not_connected');
      }

      const SEND_TIMEOUT_MS = 12_000;
      let timer = null;
      const sendPromise = socket.sendMessage(jid, content, options);
      sendPromise.catch(() => undefined);
      let result;
      try {
        result = await Promise.race([
          sendPromise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('send_timeout')), SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        if (err instanceof Error && err.message === 'send_timeout') {
          // A hung sendMessage means the socket is a zombie — recycle it so
          // the NEXT send has a chance. Fire-and-forget; this send fails.
          this.log.warn({ jidShape: jid.slice(-20) }, 'send timed out — marking socket stale and reconnecting');
          void this.reopenSocket('send_timeout', { markStale: true });
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }

      const id = result?.key?.id;
      if (!id) throw new Error('send_no_message_id');

      // Proto-encode the payload for retransmit replay (getMessage). Failure
      // here is non-fatal — the message went out; only replay is unavailable.
      let payloadBytes = null;
      try {
        const inner = result?.message;
        if (inner) payloadBytes = Buffer.from(getBaileys().proto.Message.encode(inner).finish());
      } catch (err) {
        this.log.warn({ externalMessageId: id, err: errMessage(err) }, 'send: payload encode failed — replay unavailable for this id');
      }

      const ts = result?.messageTimestamp ? new Date(Number(result.messageTimestamp) * 1000) : new Date();
      this.log.info({ externalMessageId: id, quoted: !!options.quoted, ptt: !!content.ptt }, 'send: sent');
      return { externalMessageId: id, payloadBytes, timestamp: ts };
    });
  }

  // Serialize ALL connect/reopen work through one promise chain. Errors are
  // swallowed at the chain boundary so one failed reopen doesn't poison the
  // queue for subsequent calls.
  withReconnectLock(fn) {
    const next = this.reconnectChain.then(fn, fn);
    this.reconnectChain = next.catch(() => undefined);
    return next;
  }

  detachListeners(socket, socketId) {
    // Baileys' typed emitter needs explicit event names. The activeSocketId
    // guard inside each handler is the primary defense; this stops the old
    // emitter from dispatching to our closures even before end().
    try {
      socket.ev.removeAllListeners('connection.update');
      socket.ev.removeAllListeners('creds.update');
      socket.ev.removeAllListeners('messages.upsert');
      socket.ev.removeAllListeners('messages.reaction');
      socket.ev.removeAllListeners('messaging-history.set');
      socket.ev.removeAllListeners('chats.upsert');
      socket.ev.removeAllListeners('chats.update');
      socket.ev.removeAllListeners('contacts.upsert');
      socket.ev.removeAllListeners('contacts.update');
    } catch {
      /* old socket already torn down */
    }
    void socketId;
  }

  async connect() {
    if (this.stopped) return;
    // Single-socket invariant: refuse to overwrite a live socket. If one is
    // alive, the right path is reopenSocket() (teardown under the mutex).
    if (this.socket) {
      this.log.warn({ activeSocketId: this.activeSocketId }, 'connect() called with an existing socket; refusing to overwrite');
      return;
    }

    const socketId = ++this.activeSocketId;

    await accountState.setConnecting(prisma);
    this.auth = await makePostgresAuthState(prisma, this.accountId);
    // hasCreds=false → Baileys emits a QR shortly; true → resume without QR.
    // keyCount < ~10 on a previously-paired account is a smell of wiped keys.
    this.log.info({ hasCreds: this.auth.hasCreds, keyCount: this.auth.keyCount }, 'auth state loaded');

    const { makeWASocket, Browsers, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = getBaileys();

    // Recommended protocol version; the bundled fallback applies if
    // WhatsApp's update endpoint is unreachable.
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.log.info({ version, isLatest }, 'starting socket');

    const baileysLogger = pino({ level: 'warn', name: `baileys-internal:${this.accountId}` });

    const socket = makeWASocket({
      version,
      // Wrap the Postgres key store in the official in-memory cache layer —
      // per-device encryption fanout reads the same keys repeatedly; writes
      // still flow through to Postgres.
      auth: {
        creds: this.auth.state.creds,
        keys: makeCacheableSignalKeyStore(this.auth.state.keys, baileysLogger),
      },
      // Visible name on the phone's linked-devices list.
      browser: Browsers.appropriate(`Grafitiyul OS (${this.accountId})`),
      // We don't want the full history dump — but we DO want the recent
      // bundle: it carries lidPnMappings (bulk PN↔LID) on every reconnect.
      // Some v7 rc lines skip ALL history sync when syncFullHistory=false and
      // shouldSyncHistoryMessage is unset; the explicit () => true keeps the
      // recent bundle flowing (consumed in Slice 2).
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => true,
      // Retry-receipt counter cache — per account instance, survives reopens.
      msgRetryCounterCache: this.msgRetryCounterCache,
      logger: baileysLogger,
      // Outbound retransmit replay (Slice 6): when a recipient's device asks
      // WhatsApp to resend one of OUR messages, Baileys calls this; returning
      // the stored proto payload prevents "waiting for this message" on their
      // side. Miss (old/inbound/encode-failed row) → undefined, which is safe.
      getMessage: async (key) => {
        const id = key?.id;
        if (!id) return undefined;
        try {
          const row = await prisma.whatsAppMessage.findUnique({
            where: { accountId_externalMessageId: { accountId: this.accountId, externalMessageId: id } },
            select: { outboundPayload: true },
          });
          if (!row?.outboundPayload) return undefined;
          return getBaileys().proto.Message.decode(row.outboundPayload);
        } catch (err) {
          this.log.warn({ id, err: errMessage(err) }, '[getMessage] lookup/decode failed — returning undefined');
          return undefined;
        }
      },
    });
    this.socket = socket;
    this.log.info({ socketId }, 'socket created');

    socket.ev.on('creds.update', async () => {
      try {
        await this.auth?.saveCreds();
      } catch (err) {
        this.log.error({ err: errMessage(err) }, 'saveCreds failed');
      }
    });

    socket.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(socketId, update);
    });

    // ── Message ingestion (Slice 2) ─────────────────────────────────────
    // One ingest instance per socket (fresh socket reference per reconnect).
    // Every handler captures `socketId` and no-ops when it no longer matches
    // activeSocketId — the same stale-socket guard as handleConnectionUpdate;
    // without it a replaced socket's late events kept writing through old
    // references after a reopen (duplicate rows / stale media reads).
    const ingest = createIngest({
      prisma,
      socket,
      accountId: this.accountId,
      log: pino({ level: config.logLevel, name: `ingest:${this.accountId}` }),
    });
    const guarded = (fn) => (payload) => {
      if (socketId !== this.activeSocketId) return;
      void fn(payload);
    };
    socket.ev.on('messages.upsert', guarded(ingest.onMessagesUpsert));
    socket.ev.on('messages.reaction', guarded(ingest.onReactions));
    socket.ev.on('messaging-history.set', guarded(ingest.onHistorySync));
    socket.ev.on('chats.upsert', guarded(ingest.onChatsUpsert));
    socket.ev.on('chats.update', guarded(ingest.onChatsUpdate));
    socket.ev.on('contacts.upsert', guarded(ingest.onContactsUpsert));
    socket.ev.on('contacts.update', guarded(ingest.onContactsUpdate));

    this.log.info({ socketId, mediaConfigured: isMediaConfigured() }, 'handlers wired');
  }

  async handleConnectionUpdate(socketId, update) {
    const { connection, lastDisconnect, qr } = update;

    // Stale-handler guard: if the active socket moved on, this event is from
    // a torn-down socket and MUST NOT touch shared state (the post-QR
    // flapping bug: an old socket's late close called setDisconnected +
    // scheduleReconnect against the fresh live socket, and the cycle
    // continued).
    if (socketId !== this.activeSocketId) {
      const code = disconnectCode(lastDisconnect);
      this.log.info(
        {
          socketId,
          activeSocketId: this.activeSocketId,
          connection,
          disconnectReason: code !== undefined ? describeReason(code) : null,
        },
        'connection.update from stale socket; ignoring',
      );
      return;
    }

    // Structured raw log of every update — the exact statusCode driving the
    // branch selection below. No credential content is ever logged.
    if (connection || lastDisconnect || qr) {
      const code = disconnectCode(lastDisconnect);
      this.log.info(
        {
          socketId,
          connection,
          hasQr: !!qr,
          disconnectCode: code,
          disconnectReasonName: code !== undefined ? describeReason(code) : null,
          disconnectErrMsg: lastDisconnect?.error?.message,
          isLoggedOut: code === getBaileys().DisconnectReason.loggedOut,
        },
        'connection.update',
      );
    }

    if (qr) {
      this.log.info({ socketId }, 'qr code emitted; waiting for scan');
      await accountState.setQrRequired(prisma, qr);
    }

    if (connection) {
      this.lastConnectionUpdate = connection;
    }

    if (connection === 'open') {
      this.attempt = 0;
      this.connected = true;
      this.staleReason = null;
      this.reconnecting = false;
      this.socketOpenedAt = new Date();
      // restartRequired / connectionReplaced are routine "rebuild the socket"
      // protocol signals — once open again, leaving them in
      // lastDisconnectReason makes the UI show a fault on a healthy bridge.
      if (this.lastDisconnectReason === 'restartRequired' || this.lastDisconnectReason === 'connectionReplaced') {
        this.lastDisconnectReason = null;
      }
      const me = this.socket?.user;
      // v7: for LID-migrated accounts user.id is the LID; the phone JID moved
      // to user.phoneNumber. Persist the phone so the admin sees a number,
      // not an opaque LID. Fallback to id keeps pre-migration accounts working.
      const mePhoneJid = me?.phoneNumber ?? me?.id ?? null;
      this.log.info({ socketId, jid: me?.id, phoneJid: mePhoneJid, name: me?.name }, 'connected');
      await accountState.setConnected(prisma, { phoneJid: mePhoneJid, deviceName: me?.name ?? null });
      // Healthy checkpoint: reset reconnectAttempts after staying open long enough.
      this.clearHealthyTimer();
      this.healthyTimer = setTimeout(() => {
        void accountState.markHealthy(prisma);
      }, config.reconnectHealthyMs);
    }

    if (connection === 'close') {
      this.connected = false;
      this.socketOpenedAt = null;
      this.clearHealthyTimer();
      const code = disconnectCode(lastDisconnect);
      const reason = describeReason(code);
      this.lastDisconnectReason = reason;

      // loggedOut (401) is ambiguous: (a) real unlink / ban — re-pair needed;
      // (b) deploy overlap — Railway started the new container while the old
      // one was still connected; the same creds work again on the next boot.
      // Policy (hard-learned): NEVER auto-wipe creds. Stop reconnecting and
      // surface the state. Real unlink → admin clicks sign-out/hard-reset;
      // deploy overlap → next boot connects cleanly with no admin action.
      if (code === getBaileys().DisconnectReason.loggedOut) {
        this.log.warn({ socketId, code, reason }, 'connection closed (loggedOut) — keeping creds; admin must sign out to wipe + re-pair');
        this.socket = null;
        await accountState.setDisconnected(prisma, reason, { incrementAttempts: false });
        return;
      }

      // restartRequired (515): WhatsApp's "rebuild the socket" signal, fired
      // right after pairing and occasionally mid-session. Routes through the
      // unified reopen path so it serializes with every other trigger.
      // markStale=false: not a fault — the UI shows "reconnecting", not red.
      if (code === getBaileys().DisconnectReason.restartRequired) {
        this.log.info({ socketId, code }, 'restartRequired — funnelling through reopenSocket (routine post-handshake signal)');
        void this.reopenSocket('restartRequired', { markStale: false });
        return;
      }

      // connectionReplaced (440): usually self-inflicted (new socket while
      // the old TCP was alive) and already swallowed by the activeSocketId
      // guard. Reaching here means an OUTSIDE session connected; reopen and
      // let WhatsApp arbitrate.
      if (code === getBaileys().DisconnectReason.connectionReplaced) {
        this.log.warn({ socketId, code }, 'connectionReplaced on the active socket — funnelling through reopenSocket');
        void this.reopenSocket('connectionReplaced', { markStale: true });
        return;
      }

      // Anything else (timedOut, connectionLost, generic close): passive
      // exponential backoff.
      this.log.warn({ socketId, code, reason }, 'connection closed; scheduling reconnect');
      this.socket = null;
      await accountState.setDisconnected(prisma, reason);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const exp = Math.min(
      config.reconnectMaxDelayMs,
      config.reconnectMinDelayMs * Math.pow(2, this.attempt),
    );
    this.attempt++;
    this.log.info({ delayMs: exp, attempt: this.attempt }, 'scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Funnel through the reconnect lock so a delayed scheduled connect
      // can't race a manual reopen landing while this timer fires.
      void this.withReconnectLock(() => this.connect()).catch((err) => {
        this.log.error({ err: errMessage(err) }, 'scheduled reconnect failed; rescheduling');
        this.scheduleReconnect();
      });
    }, exp);
  }

  clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHealthyTimer();
  }

  clearHealthyTimer() {
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
  }
}
