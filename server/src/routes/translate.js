import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { translateField, translationConfigured } from '../communication/translate.js';

// The shared bilingual-field translation endpoint — ONE service behind every
// settings-screen "תרגם לאנגלית" action (never per-screen logic). Returns the
// translated content only; the CLIENT fills the target field and the operator
// reviews and saves — nothing is persisted here.

const router = Router();

router.get(
  '/status',
  handle(async (_req, res) => {
    res.json({ configured: translationConfigured() });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const content = String(req.body?.content || '');
    if (!content.trim()) return res.status(400).json({ error: 'content_required' });
    try {
      const out = await translateField({
        content,
        direction: req.body?.direction === 'en_to_he' ? 'en_to_he' : 'he_to_en',
        tone: req.body?.tone || null,
        format: req.body?.format === 'text' ? 'text' : 'html',
      });
      res.json(out);
    } catch (e) {
      // 422, never 5xx — Cloudflare replaces 502/504 with its own HTML page
      // and the client would lose the structured error code.
      res.status(422).json({ error: e.code || 'translation_failed', detail: e.detail });
    }
  }),
);

export default router;
