# GOS — Settings Module Plan (future, not implemented)

**Status:** Plan only. Not built. Captured so we build toward it; do not implement until scheduled.
**Last updated:** 2026-06-26

## Goal
The "Organization Types" screen must **not** stay a top-level CRM page. It's low-frequency
(touched mostly at initial setup), so it belongs inside a global **Settings** module, modeled like
the existing Challenge-style **category-cards → detail page** pattern.

## Target structure
```
Settings  (global module — category cards)
├── CRM Settings                ← one card
│   ├── Organization Types      ← the current screen lives here
│   ├── Organization Subtypes
│   ├── Deal Stages
│   ├── Sources
│   ├── Payment Terms
│   ├── Email Templates
│   ├── WhatsApp Templates
│   ├── Quote Templates
│   └── … (extensible)
├── Team / Access Settings      ← future card
├── Finance Settings            ← future card
└── … (other category cards)
```

## UX model
- **Settings landing** = a grid of **category cards** (icon + title + short description), exactly like
  the Challenge system's category overview.
- Clicking a card (e.g. **CRM Settings**) opens a **detail settings page** that lists its sub-screens
  (Organization Types, Deal Stages, Sources, …).
- Each sub-screen is a focused page (the current Organization Types page is one of these).

## Routing (proposed, when built)
- `/admin/settings` → category cards
- `/admin/settings/crm` → CRM Settings sub-screen list
- `/admin/settings/crm/organization-types` → current Organization Types screen (moved here)
- `/admin/settings/crm/deal-stages`, `/sources`, `/payment-terms`, `/email-templates`,
  `/whatsapp-templates`, `/quote-templates`, …

## Migration of the current screen
- Move the existing `client/src/admin/crm/settings/CrmSettingsPage.jsx` content under the new
  Settings → CRM Settings → Organization Types route.
- Remove "CRM Settings" / the Organization-Types tab from being a primary CRM destination; CRM's
  daily surface stays Activities → Deals → Contacts/Organizations.
- A top-level **Settings** entry replaces it in the nav (gear icon), low in the rail.

## Why later, not now
Per the implementation-phase rule: this is an easily-reversible navigation/IA change, not a
schema/ownership decision. It does not block the Deal module and shouldn't interrupt it. Build it
when the number of settings screens (Deal Stages, Sources, Payment Terms, templates) makes the flat
CRM tab cramped — likely alongside or just after Deal Stages land.
