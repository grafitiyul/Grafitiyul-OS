import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Hebrew UTF-8 regression — REAL Hebrew text, byte-exact through the same
// express.json() request-parsing + res.json() serialization stack the
// communication routes ride. Guards against any body-parser/charset config
// regression. (The 2026-07 mojibake incident originated OUTSIDE the app — a
// Windows-shell curl harness mangled Hebrew argv before the HTTP request; the
// pipeline itself was and must remain byte-clean, which this test pins.)

const HEBREW = {
  internalName: 'חוגגים סגירות 🎉 — בדיקת קידוד',
  description: 'תיאור עם גרשיים ״כפולים״, מקף–ארוך ו-ASCII mixed',
};

test('Hebrew JSON round-trips byte-exact through express request/response', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/echo', (req, res) => res.json(req.body));

  // Explicit IPv4 loopback — avoids the Windows IPv6/IPv4 dual-stack race
  // between listen and fetch under a fully loaded parallel test run.
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(HEBREW),
    });
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.internalName, HEBREW.internalName);
    assert.equal(body.description, HEBREW.description);
    // No replacement characters anywhere.
    assert.ok(!JSON.stringify(body).includes('�'));
  } finally {
    server.close();
  }
});
