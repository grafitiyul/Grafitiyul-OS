// Pure helpers for the Deal-header action "פתח דיל חדש לאותו איש קשר".
// The action reuses the canonical CreateDealModal in preset-contact mode —
// these helpers only decide HOW the flow starts and what the multi-contact
// chooser rows display. Kept as plain JS so the logic is testable with the
// node test runner without bundling JSX.
import { contactNameHe } from './config.js';

// How the action behaves for a given deal payload:
//   'none'   — no linked contacts → the menu item is disabled with a reason
//   'direct' — exactly one linked contact → straight into the canonical modal
//   'choose' — several linked contacts → a small chooser dialog first
// Only genuinely linked DealContact rows count — never a guess by name, phone,
// organization or the deal title.
export function sameContactActionState(deal) {
  const rows = Array.isArray(deal?.contacts) ? deal.contacts : [];
  if (rows.length === 0) return { mode: 'none', rows: [] };
  return { mode: rows.length === 1 ? 'direct' : 'choose', rows };
}

// Display fields for one chooser row. The deal payload carries each contact's
// PRIMARY phone/email only (CONTACT_SELECT server-side) — exactly what the
// chooser needs. Hebrew name wins, Latin-only contacts fall back to English —
// the same precedence as every other CRM surface.
export function chooserRow(dc) {
  const c = dc?.contact || {};
  const en = `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
  return {
    contactId: dc?.contactId || c.id || null,
    name: contactNameHe(c) || en || '—',
    phone: c.phones?.[0]?.value || '',
    email: c.emails?.[0]?.value || '',
    isPrimary: !!dc?.isPrimary,
  };
}
