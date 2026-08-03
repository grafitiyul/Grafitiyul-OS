// Shared bilingual-field translation tests (translateField — the service
// behind every settings תרגם action). Pure: fake provider client, no network.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { translateField } from './translate.js';

const provider = (reply) => ({
  captured: null,
  messages: {
    create: async function (req) {
      this.parent.captured = req;
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] };
    },
  },
  init() { this.messages.create = this.messages.create.bind({ parent: this }); return this; },
});
const fake = (reply) => provider(reply).init();

test('he_to_en: prompts Hebrew→English and returns the content', async () => {
  const p = fake({ content: '<p>Hello</p>' });
  const out = await translateField({ content: '<p>שלום</p>', providerClient: p });
  assert.equal(out.content, '<p>Hello</p>');
  assert.match(p.captured.system, /Hebrew content into natural, fluent English/);
});

test('en_to_he: direction flips the prompt', async () => {
  const p = fake({ content: '<p>שלום</p>' });
  await translateField({ content: '<p>Hello</p>', direction: 'en_to_he', providerClient: p });
  assert.match(p.captured.system, /English content into natural, fluent Hebrew/);
});

test('token preservation is enforced — a lost {{token}} rejects the result', async () => {
  const p = fake({ content: '<p>Hello</p>' }); // token dropped
  await assert.rejects(
    () => translateField({ content: '<p>שלום {{customer_first_name}}</p>', providerClient: p }),
    (e) => e.code === 'translation_tokens_changed' && e.detail.lost.includes('customer_first_name'),
  );
});

test('surviving tokens pass and are chip-normalized in html format', async () => {
  const p = fake({ content: '<p>Hi {{customer_first_name}}</p>' });
  const out = await translateField({
    content: '<p>שלום {{customer_first_name}}</p>',
    providerClient: p,
  });
  assert.match(out.content, /data-field-key="customer_first_name"/);
});

test('text format skips chip normalization', async () => {
  const p = fake({ content: 'Hi {{customer_first_name}}' });
  const out = await translateField({
    content: 'שלום {{customer_first_name}}', format: 'text', providerClient: p,
  });
  assert.equal(out.content, 'Hi {{customer_first_name}}');
});

test('unconfigured (no key, no provider) throws translation_not_configured', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => translateField({ content: '<p>שלום</p>' }),
      (e) => e.code === 'translation_not_configured',
    );
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
