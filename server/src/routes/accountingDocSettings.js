import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  getAccountingDocSettings,
  unknownDocNoteTokens,
  docNotesVariableCatalog,
} from '../accountingDocNotes.js';
import { variableByKey } from '../communication/variables.js';

// Settings → כספים → "פרטי בנק גרפיטיול" — the server-backed singleton behind
// the default content of iCount document notes (structured bank fields + the
// three template blocks + per-doctype inclusion flags). Admin-only
// (requireAdminAuth at mount). Changes affect FUTURE documents only — issued
// iCount documents and their snapshots are never touched from here.

const router = Router();

const STRING_KEYS = [
  'bankAccountHolder',
  'bankName',
  'bankNumber',
  'bankBranchName',
  'bankBranchNumber',
  'bankAccountNumber',
  'dealInfoTemplate',
  'bankTemplate',
  'cancellationTemplate',
];
const BOOL_KEYS = [
  'dealInfoIncludeDeal',
  'dealInfoIncludeInvoice',
  'bankIncludeDeal',
  'bankIncludeInvoice',
  'cancellationIncludeDeal',
  'cancellationIncludeInvoice',
];
const TEMPLATE_KEYS = ['dealInfoTemplate', 'bankTemplate', 'cancellationTemplate'];

router.get(
  '/',
  handle(async (_req, res) => {
    const settings = await getAccountingDocSettings(prisma);
    res.json({ settings, variables: docNotesVariableCatalog(variableByKey) });
  }),
);

router.put(
  '/',
  handle(async (req, res) => {
    const data = {};
    for (const key of STRING_KEYS) {
      if (typeof req.body?.[key] === 'string') data[key] = req.body[key];
    }
    for (const key of BOOL_KEYS) {
      if (req.body?.[key] !== undefined) data[key] = !!req.body[key];
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'no_valid_fields' });
    }
    // A template referencing a token nothing can resolve is rejected outright —
    // an unresolvable token must never be storable, let alone reach a document.
    const unknown = {};
    for (const key of TEMPLATE_KEYS) {
      if (data[key] === undefined) continue;
      const bad = unknownDocNoteTokens(data[key]);
      if (bad.length) unknown[key] = bad;
    }
    if (Object.keys(unknown).length) {
      return res.status(400).json({ error: 'unknown_tokens', unknown });
    }
    await getAccountingDocSettings(prisma); // ensure the singleton row exists
    const updated = await prisma.accountingDocSettings.update({
      where: { id: 'singleton' },
      data: { ...data, updatedBy: req.adminAuth?.userId || null },
    });
    res.json({ settings: updated });
  }),
);

export default router;
