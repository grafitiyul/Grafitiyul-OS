import { Router } from 'express';

// LEGACY payment URLs — /pay/:token and /pay/c/:token.
//
// These are the URLs already in the wild (older links, bookmarks). The canonical
// structure is now /payment/icount/<token> (provider visible in the URL), so
// these permanently redirect to their canonical equivalents. The real
// resolution/redirect to iCount lives in routes/payment.js — this file only
// preserves backward compatibility.

const router = Router();

// Custom-description link — declared BEFORE /:token so 'c' isn't swallowed.
router.get('/c/:token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(301, `/payment/icount/c/${encodeURIComponent(req.params.token)}`);
});

router.get('/:token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(301, `/payment/icount/${encodeURIComponent(req.params.token)}`);
});

export default router;
