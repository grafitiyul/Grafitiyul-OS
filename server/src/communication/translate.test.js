import test from 'node:test';
import assert from 'node:assert/strict';
import { translateContent } from './translate.js';
import { chipHtml } from '../../../shared/variableTokens.mjs';

// Fake Anthropic client — exercises the full translateContent path (prompting,
// parsing, token-preservation check, chip normalization) without a provider.
const fakeClient = (payload) => ({
  messages: {
    create: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    }),
  },
});

test('translation preserves variables and normalizes raw tokens back into chips', async () => {
  const result = await translateContent({
    subject: 'אישור הזמנה {{deal_number}}',
    body: `<p>שלום ${chipHtml('customer_first_name', 'שם פרטי')}, נתראה ב-{{tour_date}}.</p>`,
    channel: 'email',
    providerClient: fakeClient({
      subject: 'Order confirmation {{deal_number}}',
      // The model returned a RAW token where the input had a chip — the
      // normalizer must canonicalize it back to a chip node.
      body: '<p>Hello {{customer_first_name}}, see you on {{tour_date}}.</p>',
    }),
  });
  assert.equal(result.subject, 'Order confirmation {{deal_number}}');
  assert.ok(result.body.includes('data-field-key="customer_first_name"'));
  assert.ok(result.body.includes('data-field-key="tour_date"'));
  assert.ok(!/\{\{customer_first_name\}\}/.test(result.body));
});

test('a translation that LOSES a variable is rejected, never returned', async () => {
  await assert.rejects(
    () => translateContent({
      subject: '',
      body: '<p>שלום {{customer_first_name}}</p>',
      channel: 'whatsapp',
      providerClient: fakeClient({ subject: '', body: '<p>Hello there</p>' }),
    }),
    (err) => {
      assert.equal(err.code, 'translation_tokens_changed');
      assert.deepEqual(err.detail.lost, ['customer_first_name']);
      return true;
    },
  );
});

test('a translation that INVENTS a variable is rejected', async () => {
  await assert.rejects(
    () => translateContent({
      subject: '', body: '<p>שלום</p>', channel: 'whatsapp',
      providerClient: fakeClient({ subject: '', body: '<p>Hi {{customer_first_name}}</p>' }),
    }),
    (err) => err.code === 'translation_tokens_changed' && err.detail.invented.includes('customer_first_name'),
  );
});

test('unconfigured provider throws the explicit not-configured code', async () => {
  const hadKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => translateContent({ subject: '', body: '<p>x</p>', channel: 'whatsapp' }),
      (err) => err.code === 'translation_not_configured',
    );
  } finally {
    if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey;
  }
});

test('a provider refusal maps to translation_failed', async () => {
  const refusing = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } };
  await assert.rejects(
    () => translateContent({ subject: '', body: '<p>x</p>', channel: 'whatsapp', providerClient: refusing }),
    (err) => err.code === 'translation_failed',
  );
});
