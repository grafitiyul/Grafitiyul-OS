import test from 'node:test';
import assert from 'node:assert/strict';
import { sendNewLeadAutoReply, autoReplyKey } from './newLeadAutoReply.js';

// One bridge configured, so the canonical sender resolver has an unambiguous
// answer without inventing a fallback number.
process.env.WHATSAPP_BRIDGE_URLS = 'main=http://bridge.test';

// A stand-in covering exactly the tables this path writes: the idempotency
// ledger, the chat lookup and the canonical outbound queue. The queue write is
// NOT stubbed out — the tests assert the real row shape, which is what proves
// "sending goes through the canonical queue".
function createDb({ templates = [], chats = [] } = {}) {
  const db = { newLeadAutoReply: [], whatsAppScheduledMessage: [], whatsAppChat: chats, whatsAppTemplate: templates };
  let seq = 0;
  const match = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

  const client = {
    _tables: db,
    $transaction: async (fn) => fn(client),
    newLeadAutoReply: {
      create: async ({ data }) => {
        if (db.newLeadAutoReply.some((r) => r.idempotencyKey === data.idempotencyKey)) {
          const e = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `nlar_${++seq}`, ...data };
        db.newLeadAutoReply.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = db.newLeadAutoReply.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    whatsAppTemplate: {
      findFirst: async ({ where }) => db.whatsAppTemplate.find((r) => match(r, where)) || null,
    },
    whatsAppChat: {
      findFirst: async ({ where }) => db.whatsAppChat.find((r) => match(r, where)) || null,
    },
    whatsAppScheduledMessage: {
      create: async ({ data }) => {
        const row = { id: `sched_${++seq}`, ...data };
        db.whatsAppScheduledMessage.push(row);
        return row;
      },
    },
  };
  return client;
}

const template = (over = {}) => ({
  id: 'tpl_1',
  nameHe: 'ברוכים הבאים',
  bodyHeHtml: '<p>שלום {{customer_first_name}}, קיבלנו את הפנייה שלך!</p>',
  bodyEnHtml: '<p>Hi {{customer_first_name}}, we got your enquiry!</p>',
  isActive: true,
  isNewLeadDefault: true,
  ...over,
});

// A canonical-shaped trigger context. contact IS the deal's primary contact.
const ctxFor = ({ phone = '050-123-4567', firstNameHe = 'דור', firstNameEn = 'Dor' } = {}) => ({
  deal: { id: 'deal_1' },
  contact: {
    id: 'contact_1',
    firstNameHe, lastNameHe: 'כהן',
    firstNameEn, lastNameEn: 'Cohen',
    phones: [{ value: phone, isPrimary: true }],
    emails: [],
  },
  org: null, tour: null, payment: null, owner: null, links: {},
});

const run = (db, ctx, payload = {}) =>
  sendNewLeadAutoReply(
    { dealId: 'deal_1', origin: 'ingress:website_form', ingressEventId: 'evt_1', ...payload },
    { info() {}, warn() {}, error() {} },
    { db, loadContext: async () => ctx },
  );

const ledger = (db) => db._tables.newLeadAutoReply[0];
const queue = (db) => db._tables.whatsAppScheduledMessage;

// ── The happy paths ─────────────────────────────────────────────────────────

test('auto-reply: an Israeli lead is queued once, in Hebrew', async () => {
  const db = createDb({ templates: [template()] });
  const r = await run(db, ctxFor({ phone: '050-123-4567' }));

  assert.equal(r.status, 'queued');
  assert.equal(r.language, 'he');
  assert.equal(queue(db).length, 1);
  const msg = queue(db)[0];
  assert.match(msg.content, /שלום דור/, 'the Hebrew body rendered with the resolved first name');
  assert.doesNotMatch(msg.content, /\{\{/, 'no raw variable may reach the customer');
  assert.equal(msg.destinationPhone, '972501234567');
  assert.equal(msg.destinationJid, '972501234567@s.whatsapp.net');
});

test('auto-reply: a foreign lead is queued in English', async () => {
  const db = createDb({ templates: [template()] });
  const r = await run(db, ctxFor({ phone: '+1 212 555 1234' }));

  assert.equal(r.status, 'queued');
  assert.equal(r.language, 'en');
  assert.match(queue(db)[0].content, /Hi Dor/);
  assert.equal(queue(db)[0].destinationPhone, '12125551234');
});

// The regression that motivated "language from the phone only".
test('auto-reply: an English-looking name on an Israeli number still sends Hebrew', async () => {
  const db = createDb({ templates: [template()] });
  const r = await run(db, ctxFor({ phone: '054-987-6543', firstNameHe: 'דייויד', firstNameEn: 'David' }));
  assert.equal(r.language, 'he');
  assert.match(queue(db)[0].content, /שלום דייויד/);
});

// ── The canonical queue ─────────────────────────────────────────────────────

test('auto-reply: sending goes through the canonical queue with the CUSTOMER shape', async () => {
  const db = createDb({ templates: [template()] });
  await run(db, ctxFor());
  const msg = queue(db)[0];
  // personRefId null is what resolves the 'customer' sending-window policy —
  // a non-null value would silently make this a staff send.
  assert.equal(msg.personRefId, null, 'a customer row must carry no personRefId');
  assert.equal(msg.bypassSendingWindow, false, 'sending windows are never bypassed');
  assert.equal(msg.accountId, 'main', 'the account came from the canonical resolver');
  assert.equal(msg.status, undefined, 'the queue owns status/retries — not this feature');
  assert.match(msg.createdById, /^new-lead-auto-reply:tpl_1$/);
});

test('auto-reply: an existing private chat on the account is reused for thread continuity', async () => {
  const db = createDb({
    templates: [template()],
    chats: [{ id: 'chat_9', accountId: 'main', phoneNumber: '972501234567', type: 'private' }],
  });
  await run(db, ctxFor({ phone: '0501234567' }));
  assert.equal(queue(db)[0].chatId, 'chat_9');
});

// ── Exactly once ────────────────────────────────────────────────────────────

test('auto-reply: 27 retries of the same event send exactly one message', async () => {
  const db = createDb({ templates: [template()] });
  const results = [];
  for (let i = 0; i < 27; i++) results.push(await run(db, ctxFor()));

  assert.equal(results[0].status, 'queued');
  assert.ok(results.slice(1).every((r) => r.status === 'duplicate'), 'every retry is a duplicate');
  assert.equal(queue(db).length, 1, 'exactly one message may be queued');
  assert.equal(db._tables.newLeadAutoReply.length, 1, 'exactly one ledger row');
});

test('auto-reply: the idempotency key is derived from the deal id', () => {
  assert.equal(autoReplyKey('deal_1'), 'new_lead_auto_reply:deal_1');
});

// ── Deliberate skips — each recorded with an explicit reason ─────────────────

test('auto-reply: no starred template means no send, recorded explicitly', async () => {
  const db = createDb({ templates: [] });
  const r = await run(db, ctxFor());
  assert.deepEqual({ status: r.status, reason: r.reason }, { status: 'skipped', reason: 'no_starred_template' });
  assert.equal(queue(db).length, 0);
  assert.equal(ledger(db).status, 'skipped');
  assert.match(ledger(db).reason, /לא סומן נוסח/);
});

test('auto-reply: an inactive starred template does not send', async () => {
  const db = createDb({ templates: [template({ isActive: false })] });
  const r = await run(db, ctxFor());
  assert.equal(r.reason, 'no_starred_template');
  assert.equal(queue(db).length, 0);
});

test('auto-reply: a missing required language SKIPS — it never falls back', async () => {
  // Foreign lead, template has Hebrew only.
  const db = createDb({ templates: [template({ bodyEnHtml: null })] });
  const r = await run(db, ctxFor({ phone: '+1 212 555 1234' }));
  assert.deepEqual({ status: r.status, reason: r.reason }, { status: 'skipped', reason: 'missing_en_content' });
  assert.equal(queue(db).length, 0, 'a foreign lead must never receive the Hebrew body');
  assert.equal(ledger(db).language, 'en');
  assert.equal(ledger(db).templateId, 'tpl_1');
});

test('auto-reply: an Israeli lead with an English-only template skips too', async () => {
  const db = createDb({ templates: [template({ bodyHeHtml: null })] });
  const r = await run(db, ctxFor({ phone: '050-123-4567' }));
  assert.equal(r.reason, 'missing_he_content');
  assert.equal(queue(db).length, 0);
});

test('auto-reply: an unclassifiable phone does not guess a language', async () => {
  const db = createDb({ templates: [template()] });
  const r = await run(db, ctxFor({ phone: '+9725551780355' }));
  assert.deepEqual({ status: r.status, reason: r.reason }, { status: 'skipped', reason: 'invalid_phone' });
  assert.equal(queue(db).length, 0);
});

test('auto-reply: a lead with no phone is skipped distinctly', async () => {
  const db = createDb({ templates: [template()] });
  const ctx = ctxFor();
  ctx.contact.phones = [];
  const r = await run(db, ctx);
  assert.equal(r.reason, 'missing_phone');
  assert.equal(queue(db).length, 0);
});

test('auto-reply: no WhatsApp account configured is an honest skip, not a crash', async () => {
  const saved = process.env.WHATSAPP_BRIDGE_URLS;
  process.env.WHATSAPP_BRIDGE_URLS = '';
  try {
    const db = createDb({ templates: [template()] });
    const r = await run(db, ctxFor());
    assert.deepEqual({ status: r.status, reason: r.reason }, { status: 'skipped', reason: 'no_account' });
    assert.equal(queue(db).length, 0);
    // The rendered text is still frozen on the ledger, so an operator can see
    // exactly what would have been sent.
    assert.match(ledger(db).renderedText, /שלום דור/);
  } finally {
    process.env.WHATSAPP_BRIDGE_URLS = saved;
  }
});

// ── Observability ───────────────────────────────────────────────────────────

test('auto-reply: a successful attempt records the full audit trail', async () => {
  const db = createDb({ templates: [template()] });
  await run(db, ctxFor());
  const row = ledger(db);
  assert.equal(row.idempotencyKey, 'new_lead_auto_reply:deal_1');
  assert.equal(row.origin, 'ingress:website_form');
  assert.equal(row.ingressEventId, 'evt_1');
  assert.equal(row.dealId, 'deal_1');
  assert.equal(row.contactId, 'contact_1');
  assert.equal(row.phoneIntl, '972501234567');
  assert.equal(row.language, 'he');
  assert.equal(row.templateId, 'tpl_1');
  assert.equal(row.templateName, 'ברוכים הבאים');
  assert.equal(row.accountId, 'main');
  assert.equal(row.scheduledMessageId, queue(db)[0].id);
  assert.equal(row.status, 'queued');
  assert.equal(row.reason, null);
  // Frozen: a later edit to the template must not rewrite what was sent.
  assert.equal(row.renderedText, queue(db)[0].content);
});

test('auto-reply: every attempt leaves a ledger row — no silent outcome', async () => {
  for (const [name, setup] of [
    ['no template', { templates: [] }],
    ['no language', { templates: [template({ bodyEnHtml: null })] }],
    ['good', { templates: [template()] }],
  ]) {
    const db = createDb(setup);
    await run(db, ctxFor({ phone: '+1 212 555 1234' }));
    assert.equal(db._tables.newLeadAutoReply.length, 1, `${name}: exactly one ledger row`);
    const row = ledger(db);
    assert.ok(['queued', 'skipped', 'failed'].includes(row.status), `${name}: a final status`);
    if (row.status !== 'queued') assert.ok(row.reason, `${name}: a skip must carry a reason`);
  }
});

test('auto-reply: a missing deal or contact is refused before anything is sent', async () => {
  const db1 = createDb({ templates: [template()] });
  assert.equal((await run(db1, { deal: null, contact: null })).reason, 'no_deal');

  const db2 = createDb({ templates: [template()] });
  assert.equal((await run(db2, { deal: { id: 'deal_1' }, contact: null })).reason, 'no_contact');

  assert.equal(queue(db1).length + queue(db2).length, 0);
});

test('auto-reply: never throws into the intake path', async () => {
  const db = createDb({ templates: [template()] });
  // A context loader that explodes must not propagate — lead creation and the
  // webhook response must be unaffected.
  const r = await sendNewLeadAutoReply(
    { dealId: 'deal_1' },
    { info() {}, warn() {}, error() {} },
    { db, loadContext: async () => { throw new Error('boom'); } },
  );
  assert.equal(r.status, 'failed');
  assert.equal(ledger(db).status, 'failed');
  assert.match(ledger(db).reason, /boom/);
});

test('auto-reply: a call with no dealId does nothing at all', async () => {
  const db = createDb({ templates: [template()] });
  const r = await sendNewLeadAutoReply({ dealId: null }, { info() {}, error() {} }, { db });
  assert.equal(r.status, 'skipped');
  assert.equal(db._tables.newLeadAutoReply.length, 0);
});
