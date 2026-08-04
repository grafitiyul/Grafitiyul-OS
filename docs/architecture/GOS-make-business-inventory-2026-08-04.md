# Make.com — Business-Level Scenario Inventory (233)

**Date:** 2026-08-04 · Read-only. Companion to `GOS-retirement-decision-package-2026-08-04.md`.

Every scenario below is described as a BUSINESS process. "Flow" is generated from the
scenario's actual steps, with technical plumbing removed.

Status: 🟢 live (active + ran recently) · 🟡 active but idle · ⚪ inactive · 🔴 auto-disabled by the 2026-07-30 outage


---

## 📁 (no folder) — 74 scenarios (11 live)

### 1978153 — דחיפה של פתיחת תיקייה בגוגל תמונות

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Airtable
- **Business flow:** looks up an Airtable record → calls another automation / external service
- **GOS replaces it?** **Yes** — Tour Gallery
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4459424 — טריגר לסנריו  https://us1.make.com/120547/scenarios/4452993/edit

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** —
- **Business flow:** calls another automation / external service
- **GOS replaces it?** **Yes** — none needed — internal trigger helper
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430341 — כפתור ביצוע פעולות מקבל טריגר מפייפדרייב

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Incoming email
- **Systems:** —
- **Business flow:** receives an incoming email → branches on conditions → calls another automation / external service
- **GOS replaces it?** **Yes** — Deal actions in the GOS UI
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430271 — מדי לילה בודק נטישות עגלה באתר > מכניס לפייפדרייב

- **Status:** 🟢 live · last ran 2026-08-02 · 33 runs / 0 errors sampled
- **Trigger:** Scheduled every 15 min
- **Systems:** WooCommerce (website shop)
- **Business flow:** reads the website order → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 2906484 — מדריך מאשר רשומת שכר באיירטייבל

- **Status:** 🟢 live · last ran 2026-08-02 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — מדריך מאשר רשומת שכר באיירטייבל
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → updates an Airtable record
- **GOS replaces it?** **Yes** — Payroll module — guide approval
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4095754 — עדכון באירוע ביומן

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — calendar changes webhook
- **Systems:** Website / incoming form · Airtable · Google Calendar
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → updates the calendar event → loops over items → looks up an Airtable record → updates the calendar event
- **GOS replaces it?** **Yes** — Tour Calendar sync worker (TourEvent is SSOT)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2600471 — עדכון שעת סיור מהדיל

- **Status:** 🟢 live · last ran 2026-07-30 · 17 runs / 0 errors sampled
- **Trigger:** Webhook — עדכון שעת סיור מהדיל
- **Systems:** Website / incoming form · Pipedrive · Airtable · WhatsApp (Wassenger) · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → updates an Airtable record → updates the deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → sends an email
- **GOS replaces it?** **Yes** — Tour Calendar sync + Confirmation Email
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430254 — פעם בשבוע - מחיקת רשומות ישנות של שיחות משוב ממתינות מהאיירטייבל

- **Status:** 🟢 live · last ran 2026-08-02 · 5 runs / 0 errors sampled
- **Trigger:** Scheduled (weekly)
- **Systems:** Airtable
- **Business flow:** looks up an Airtable record → deletes an Airtable record
- **GOS replaces it?** **Yes** — none needed — Airtable housekeeping
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1830861 — שינויים כמות משתתפים / מידע חשוב על הלקוח / עדכון שם,טלפון,מייל בפרסון

- **Status:** 🟢 live · last ran 2026-08-01 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — שינויים כמות משתתפים / מידע חשוב על הלקוח
- **Systems:** Website / incoming form · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → branches on conditions → reads deals from Pipedrive → branches on conditions → looks up an Airtable record → updates an Airtable record → writes a note on the Pipedrive deal → looks up the contact in Pipedrive → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** **Yes** — Deals module (participants + customer info)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 3190154 — שכר - צוות הניהול מאשר את הערות של המדריך

- **Status:** 🟢 live · last ran 2026-08-01 · 2 runs / 0 errors sampled
- **Trigger:** Webhook — צוות הניהול מאשר את הערות של המדריך
- **Systems:** Website / incoming form · Airtable · Gmail
- **Business flow:** receives a form/web submission → looks up an Airtable record → sends an email
- **GOS replaces it?** **Yes** — Payroll module — office approval
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430326 — שליחת מייל אישור עדכני

- **Status:** 🟢 live · last ran 2026-07-30 · 30 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת מייל אישור עדכני
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** **Yes** — Confirmation Email module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430338 — ביטול פולואפ מהמייל > עדכון לפייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — ביטול פולואפים מהמייל
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 4698828 — דחייה ללא תאריך

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — דחייה ללא תאריך
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430312 — הוצאת חשבונית לתשלום חוזרת מפייפדרייב לאייקאונט + שליחה ללקוח

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — יצירת חשבונית חדשה מפייפדרייב
- **Systems:** Website / incoming form · Pipedrive · iCount · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → reads/writes Pipedrive → handles deal products in Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 601178 — התראה לאלינוי על פעולות במייק

- **Status:** 🟡 active but idle
- **Trigger:** Incoming email
- **Systems:** WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 445156 — [טופל]שליחת מייל מיידי

- **Status:** 🟡 active but idle
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Airtable · Gmail
- **Business flow:** receives an incoming email → reads deals from Pipedrive → looks up the contact in Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → sends an email → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430314 — טופס איחוד אירועים מעדכן יומן ופייפדרייב (אירועים מרובים בטופס אחד)

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — טופס איחוד אירועים - מרובה אירועים
- **Systems:** Website / incoming form · Airtable · Google Calendar · Pipedrive · Google Sheets · Google Drive
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → reads the calendar → deletes the calendar event → looks for an existing company in Pipedrive → branches on conditions → reads deals from Pipedrive → looks for an existing company in Pipedrive → reads deals from Pipedrive → reads a Google Sheet → writes a row to a Google Sheet → reads deals from Pipedrive → branches on conditions → handles a Drive file → updates the deal in Pipedrive → reads deals from Pipedrive → reads the calendar → updates the calendar event → branches on conditions → loops over items → looks up an Airtable record → reads the calendar → calls another automation / external service
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430339 — טופס איחוד אירועים מעדכן יומן ופייפדרייב (המשך אם יש אירועים מרובים)

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — טופס איחוד אירועים (המשך אם יש אירועים מרובים)
- **Systems:** Website / incoming form · Google Calendar · Pipedrive · Google Sheets · Google Drive
- **Business flow:** receives a form/web submission → deletes the calendar event → looks for an existing company in Pipedrive → branches on conditions → reads deals from Pipedrive → looks for an existing company in Pipedrive → reads deals from Pipedrive → reads a Google Sheet → writes a row to a Google Sheet → reads deals from Pipedrive → branches on conditions → handles a Drive file → updates the deal in Pipedrive → reads deals from Pipedrive → reads the calendar → updates the calendar event
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 445168 — כפתור באיירטייבל להוספת ניסוח מייל מיידי

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הוספת מייל מיידי חדש בכפתור איירטייבל
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → loops over items → reads/writes Pipedrive → updates an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430342 — לקוח מאשר תאריך חלופי > עדכון לפייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — לקוח עסקי מאשר שינוי תאריך/שעה
- **Systems:** Website / incoming form · Pipedrive · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive → writes a note on the Pipedrive deal → sends an email → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 3190312 — מחיקת הודעות וואצאפ מהפייפ ומאיירטייבל

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — כפתור למחיקת ערך בשדה דרופדאון בפייפ
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → deletes an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430334 — מילוי טופס פורמס שיחות מכירה מעדכן פייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — טופס פורמס תסריט שיחת מכירה
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → writes a note on the Pipedrive deal → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430330 — מילוי טופס שיחת משוב בפורמס > עדכון לאיירטייבל ולפייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — גוגל פורמס שיחות משוב
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → branches on conditions → looks up an Airtable record → updates an Airtable record → reads deals from Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430311 — מענה על שאלון לקראת פעילות מעדכן קובץ שיטס ופייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שאלון לקראת פעילות
- **Systems:** Website / incoming form · Pipedrive · Google Sheets · Google Drive
- **Business flow:** receives a form/web submission → branches on conditions → reads deals from Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → reads a Google Sheet → writes a row to a Google Sheet → handles a Drive file → writes a row to a Google Sheet → updates the deal in Pipedrive → looks for an existing company in Pipedrive → updates the deal in Pipedrive → reads a Google Sheet → writes a row to a Google Sheet → handles a Drive file → writes a row to a Google Sheet → updates the deal in Pipedrive → looks for an existing company in Pipedrive → updates the deal in Pipedrive → handles deal products in Pipedrive → reads a Google Sheet → branches on conditions → writes a row to a Google Sheet → branches on conditions → writes a row to a Google Sheet
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430332 — עדכון מהמייל על ביטול תזכורת תשלום ללקוח

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — ביטול תזכורת תשלום ללקוח מהמייל
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430351 — שינוי תאריך/שעה - שליחה ללקוח לאישור ועדכון ליומן אם כבר יש אירוע

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שינוי תאריך/שעה לדיל לקוח עסקי
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail · Google Calendar
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → reads/writes Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → normalises the Israeli phone number → updates the deal in Pipedrive → looks up an Airtable record → sends an email → looks up an Airtable record → reads the calendar → looks up an Airtable record → updates the calendar event → sends an email → looks up the contact in Pipedrive → handles deal products in Pipedrive → normalises the Israeli phone number → sends an email → writes a note on the Pipedrive deal → looks up an Airtable record → reads the calendar → looks up an Airtable record → updates the calendar event → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1914956 — תשובות של טופס עדכון איש כספים ואיש שנוכח בפעילות\

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — טופס עדכון פרטים
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads deals from Pipedrive → updates an Airtable record → writes a note on the Pipedrive deal → branches on conditions → reads/writes Pipedrive → branches on conditions → creates the contact in Pipedrive → reads/writes Pipedrive → branches on conditions → creates the contact in Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 2084319 — CHECK EVENT IN GGOGLE CALENDAR

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Google Calendar
- **Business flow:** reads the calendar
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3711041 — Integration Airtable

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Airtable
- **Business flow:** looks up an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 2066050 — Integration Bitly

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Link shortener
- **Business flow:** looks up the contact in Pipedrive → shortens a link
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4498021 — Integration Facebook Lead Ads

- **Status:** ⚪ inactive
- **Trigger:** Facebook/Instagram lead form
- **Systems:** Facebook Lead Ads
- **Business flow:** receives a Facebook/Instagram lead
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3136312 — Integration Pipedrive CRM

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3170013 — Integration Pipedrive CRM

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3225208 — Integration Pipedrive CRM

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4452731 — Integration Pipedrive CRM

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** handles deal products in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4452753 — Integration Pipedrive CRM

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** handles deal products in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3823009 — Integration Pipedrive CRM, Airtable

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3086104 — Integration Pipedrive CRM, Tools

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 3857770 — Integration Short.io

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Link shortener
- **Business flow:** shortens a link
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 1984383 — Integration Wassenger

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** WhatsApp (Wassenger)
- **Business flow:** sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 2686481 — Integration Webhooks

- **Status:** ⚪ inactive
- **Trigger:** Webhook — New contact in wassenger
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 1927699 — Replace Connections Across Make Account [Airtable]

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** —
- **Business flow:** (no readable steps — blueprint empty or unusual)
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4631786 — הבאת סיורים להכשרת מדריכים

- **Status:** ⚪ inactive
- **Trigger:** Webhook — incoming form/system call
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 454247 — חיפוש אירוע ביומן

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Airtable · Google Calendar
- **Business flow:** looks up an Airtable record → branches on conditions → reads the calendar
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430327 — טופס איחוד אירועים מעדכן יומן ופייפדרייב

- **Status:** ⚪ inactive
- **Trigger:** Webhook — טופס איחוד אירועים
- **Systems:** Website / incoming form · Airtable · Google Calendar · Pipedrive · Google Sheets · Google Drive
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → reads the calendar → deletes the calendar event → looks for an existing company in Pipedrive → branches on conditions → reads deals from Pipedrive → looks for an existing company in Pipedrive → reads deals from Pipedrive → reads a Google Sheet → writes a row to a Google Sheet → reads deals from Pipedrive → branches on conditions → handles a Drive file → updates the deal in Pipedrive → reads deals from Pipedrive → reads the calendar → updates the calendar event
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430302 — יצירת קישורים לסוכנויות ומפיקים

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Link shortener
- **Business flow:** reads/writes Pipedrive → shortens a link → reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4038842 — יצירת תיקייה בגוגל פוטוז

- **Status:** ⚪ inactive
- **Trigger:** Webhook — יצירת תיקייה בגוגל פוטוז
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430237 — כל יום רביעי - משיכת מידע לקובץ נתוני קמפיינים

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (weekly)
- **Systems:** Pipedrive · Google Sheets
- **Business flow:** reads deals from Pipedrive → reads/writes Pipedrive → handles deal products in Pipedrive → writes a row to a Google Sheet
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430350 — לידים מקמפיין חידה בסמוב > נכנסים לפייפדרייב ומקבלים מייל+קופון

- **Status:** ⚪ inactive
- **Trigger:** Webhook — קמפיין חידה - נרשמים מסמוב
- **Systems:** Website / incoming form · Pipedrive · WooCommerce (website shop) · Gmail
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → creates a website coupon → sends an email → branches on conditions → updates the contact in Pipedrive → reads/writes Pipedrive → branches on conditions → creates a deal in Pipedrive → writes a note on the Pipedrive deal → creates the contact in Pipedrive → creates a deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430305 — לקוחות עסקיים - מייל למשרד עבור תזכורות לתשלום

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430285 — לקוחות עסקיים - מייל למשרד עבור תזכורות לתשלום (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430287 — לקוחות עסקיים - פולואפים אוטומטיים במייל (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Airtable · Gmail
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → talks to iCount → calls another automation / external service → normalises the Israeli phone number → branches on conditions → looks up an Airtable record → sends an email → updates the deal in Pipedrive → looks up an Airtable record → sends an email → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430284 — לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ישן)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · Gmail
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → shortens a link → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → calls another automation / external service → sends an email → normalises the Israeli phone number → calls another automation / external service → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → calls another automation / external service → sends an email → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430269 — לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (שבת - ערב)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → sends a WhatsApp message → sends an email → normalises the Israeli phone number → sends a WhatsApp message → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430268 — לקוחות עסקיים - תזכורת לתשלום ביום הפעילות עבור הלקוח + המדריך

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → talks to iCount → calls another automation / external service → sends an email → looks up an Airtable record → talks to iCount → calls another automation / external service → sends an email → looks up an Airtable record → branches on conditions → calls another automation / external service → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430276 — לקוחות פרטיים ועסקיים (לא סוכנויות ומפיקים) - מייל+וואטסאפ חודש אחרי פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → looks up the contact in Pipedrive → branches on conditions → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message → looks up an Airtable record → branches on conditions → looks up the contact in Pipedrive → branches on conditions → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430318 — לקוחות פרטיים ועסקיים - מייל+וואטסאפ יומיים אחרי פעילות לאנשים נוספים שמילאו שאלון

- **Status:** ⚪ inactive
- **Trigger:** Webhook — My gateway-webhook webhook
- **Systems:** Website / incoming form · Pipedrive · Airtable · Google Sheets · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → reads a Google Sheet → sends an email → branches on conditions → reads a Google Sheet → sends an email → branches on conditions → reads a Google Sheet → normalises the Israeli phone number → sends a WhatsApp message → writes a row to a Google Sheet → branches on conditions → reads a Google Sheet → normalises the Israeli phone number → sends a WhatsApp message → writes a row to a Google Sheet
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430260 — לקוחות פרטיים - מייל+וואטסאפ יומיים אחרי פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · WooCommerce (website shop) · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → creates a website coupon → looks up the contact in Pipedrive → branches on conditions → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430238 — מדי לילה - משיכת נתוני סגירות דו"ח יומי לגיליון נתונים + שליחה בקבוצת וואטסאפ המצב היום

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 31 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Google Sheets · iCount · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → writes a row to a Google Sheet → reads deals from Pipedrive → issues an accounting document (iCount) → talks to iCount → issues an accounting document (iCount) → talks to iCount → reads/writes Make storage → reads deals from Pipedrive → sends a WhatsApp message → branches on conditions → reads/writes Make storage
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430297 — מיזוג אנשי קשר פעם ביום

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** looks up the contact in Pipedrive → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → calls another automation / external service
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430300 — מייל למשרד עם סיכום פולואפים למחר נשלח מדי ערב

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads deals from Pipedrive → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → sends an email → reads deals from Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → sends an email → reads deals from Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → sends an email → reads deals from Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → sends an email → reads deals from Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → sends an email
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430265 — מייל למשרד עם סיכום תזכורות תשלום למחר נשלח מדי ערב

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → reads/writes Pipedrive → sends an email
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430280 — מילוי טופס שיחת משוב בפורמס > עדכון לפייפדרייב רטרואקטיבי

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Google Sheets · Pipedrive
- **Business flow:** reads a Google Sheet → branches on conditions → reads deals from Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 2580984 —  סוכנויות ומפיקים - מייל שנה אחרי פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430275 — סיורים אתמול - העתקה לטבלת שיחות משוב באיירטייבל

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → creates an Airtable record → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430304 — סיורים מאתמול - הכנסת נתונים לגיליון נתונים יומיים ושליחה לאלינוי (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Google Sheets · Gmail
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → writes a row to a Google Sheet → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430303 — סיורים מאתמול - הכנסת נתונים לקובץ חישוב שכר ושליחה לאלינוי (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Google Sheets · Gmail
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → writes a row to a Google Sheet → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430270 — סיורים מאתמול - הכנסת נתונים לקובץ נתונים יומיים+שכר ושליחה לאלינוי (איחוד)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Google Sheets · Gmail · Airtable
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → writes a row to a Google Sheet → branches on conditions → writes a row to a Google Sheet → branches on conditions → writes a row to a Google Sheet → reads a Google Sheet → sends an email → looks up an Airtable record → writes a row to a Google Sheet
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 2466375 — עדכון דילים בלינק לסלקיה ללקוח - היסטורי

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430255 — רכישה מהאתר - בדיקה מול יומנים מרובים

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** WooCommerce (website shop) · Airtable · Google Calendar
- **Business flow:** reads the website order → looks up an Airtable record → reads the calendar → loops over items → branches on conditions → loops over items → branches on conditions → updates the calendar event → creates a calendar event
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430313 — רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב

- **Status:** ⚪ inactive
- **Trigger:** Webhook — My gateway-webhook webhook
- **Systems:** Website / incoming form · WooCommerce (website shop) · Pipedrive · Airtable · Gmail · Google Calendar · Google Drive · iCount · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → branches on conditions → reads the website order → normalises the Israeli phone number → looks for an existing company in Pipedrive → looks up an Airtable record → branches on conditions → loops over items → branches on conditions → sends an email → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email → branches on conditions → looks up an Airtable record → reads the calendar → loops over items → branches on conditions → reads/writes Pipedrive → loops over items → branches on conditions → updates the calendar event → creates a Google Drive folder → shares the Drive folder → creates a calendar event → creates a Google Drive folder → shares the Drive folder → branches on conditions → reads/writes Pipedrive → creates a calendar event → branches on conditions → creates a calendar event → calls another automation / external service → branches on conditions → issues an accounting document (iCount) → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → writes a note on the Pipedrive deal → creates a deal in Pipedrive → handles deal products in Pipedrive → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → reads the calendar → updates the calendar event → loops over items → sends an email → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → creates a calendar event → calls another automation / external service → loops over items → branches on conditions → sends a WhatsApp message → sends an email → sends a WhatsApp message → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 612620 — רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב (גיבוי 12.1.23)

- **Status:** ⚪ inactive
- **Trigger:** Webhook — My gateway-webhook webhook
- **Systems:** Website / incoming form · WooCommerce (website shop) · Pipedrive · Airtable · Gmail · Google Calendar · Google Drive · iCount · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → branches on conditions → reads the website order → normalises the Israeli phone number → looks for an existing company in Pipedrive → looks up an Airtable record → branches on conditions → loops over items → branches on conditions → sends an email → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email → branches on conditions → looks up an Airtable record → reads the calendar → loops over items → branches on conditions → reads/writes Pipedrive → loops over items → branches on conditions → updates the calendar event → creates a Google Drive folder → shares the Drive folder → creates a calendar event → creates a Google Drive folder → shares the Drive folder → branches on conditions → reads/writes Pipedrive → creates a calendar event → branches on conditions → creates a calendar event → calls another automation / external service → branches on conditions → issues an accounting document (iCount) → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → writes a note on the Pipedrive deal → creates a deal in Pipedrive → handles deal products in Pipedrive → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → reads the calendar → updates the calendar event → loops over items → sends an email → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → creates a calendar event → calls another automation / external service → loops over items → branches on conditions → sends a WhatsApp message → sends an email → sends a WhatsApp message → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430281 — שליחת לינקים אישיים לאנשי קשר תחת סוכנויות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Gmail
- **Business flow:** looks up the contact in Pipedrive → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430283 — תזכורות למדריכים לקראת פעילות (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → branches on conditions → normalises the Israeli phone number → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → calls another automation / external service → looks up an Airtable record → branches on conditions → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 ארכיון — 26 scenarios (0 live)

### 430310 — [1] מילוי טופס פנימי לקוחות עסקיים (או לקוח פרטי שצריך הצעה) > מעדכן פייפדרייב ושולח קריאה לוובהוק

- **Status:** ⚪ inactive
- **Trigger:** Webhook — טופס פנימי לקוחות עסקיים
- **Systems:** Website / incoming form · Pipedrive · Airtable · Link shortener
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → creates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → looks up an Airtable record → handles deal products in Pipedrive → calls another automation / external service → creates a company in Pipedrive → branches on conditions → updates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → shortens a link → reads/writes Pipedrive → shortens a link → reads/writes Pipedrive → branches on conditions → reads/writes Pipedrive → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → branches on conditions → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → creates a company in Pipedrive → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → branches on conditions → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → creates a deal in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → updates the contact in Pipedrive → creates a company in Pipedrive → branches on conditions → creates a deal in Pipedrive → looks up an Airtable record → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430309 — [2] דיל לקוחות עסקיים חדש (או לקוח פרטי שצריך הצעה) > שולח הצעת מחיר במייל+וואטסאפ עם קישור לטופס הזמנה ומעביר סטייג

- **Status:** ⚪ inactive
- **Trigger:** Webhook — דיל לקוחות עסקיים חדש בפייפ
- **Systems:** Website / incoming form · Pipedrive · iCount · Airtable · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → reads/writes Pipedrive → normalises the Israeli phone number → handles deal products in Pipedrive → branches on conditions → calls another automation / external service → reads/writes Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → sends an email → updates the deal in Pipedrive → looks up an Airtable record → branches on conditions → sends a WhatsApp message → creates a follow-up task in Pipedrive → looks up an Airtable record → branches on conditions → sends an email → updates the deal in Pipedrive → looks up an Airtable record → branches on conditions → creates a follow-up task in Pipedrive → branches on conditions → sends a WhatsApp message → looks up an Airtable record → branches on conditions → updates the deal in Pipedrive → branches on conditions → sends an email → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430319 — Closed 5.2.24 - דיל לקוח עסקי הופך לוון > עדכון סטייג' > הוצאת חשבון עסקה ושליחה במייל > עדכון ביומן

- **Status:** ⚪ inactive
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Airtable · Google Calendar · Google Drive · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → updates the deal in Pipedrive → reads deals from Pipedrive → branches on conditions → looks up an Airtable record → reads the calendar → deletes the calendar event → reads/writes Pipedrive → normalises the Israeli phone number → branches on conditions → calls another automation / external service → reads/writes Pipedrive → handles deal products in Pipedrive → reads/writes Pipedrive → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → creates a Google Drive folder → shares the Drive folder → updates the deal in Pipedrive → handles deal products in Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → creates a calendar event → updates the deal in Pipedrive → creates a calendar event → looks up an Airtable record → branches on conditions → creates a calendar event → updates the deal in Pipedrive → creates a calendar event → branches on conditions → looks up an Airtable record → branches on conditions → sends an email → looks up an Airtable record → branches on conditions → sends an email → looks up an Airtable record → branches on conditions → sends an email → looks up an Airtable record → branches on conditions → sends an email → looks up an Airtable record → branches on conditions → sends an email → looks up an Airtable record → branches on conditions → sends an email → sends a WhatsApp message → handles deal products in Pipedrive → creates a calendar event → branches on conditions → creates a calendar event → reads/writes Pipedrive → loops over items → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 619425 — בדיקת כמות פעולות במייק מדי יום

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** WhatsApp (Wassenger)
- **Business flow:** branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430236 — בדיקת מזהי ארגונים בפייפדרייב

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads/writes Pipedrive → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430293 — בכל 3 לחודש מושך נתוני סיורים מחודש קודם - הכנסת נתונים לגיליון נתונים מסכם

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (monthly)
- **Systems:** Pipedrive · Google Sheets · Gmail
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → reads a Google Sheet → writes a row to a Google Sheet → reads a Google Sheet → writes a row to a Google Sheet → reads/writes Pipedrive → writes a row to a Google Sheet → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 526111 — דו"ח יומי עסקאות והכנסות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430328 — טופס פאנזינג שולח הודעת וואטסאפ

- **Status:** ⚪ inactive
- **Trigger:** Webhook — My gateway-webhook webhook
- **Systems:** Website / incoming form · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430355 — יצירת קישורים מקוצרים לסוכנויות/חברות הפקה חדשות-כובה על ידי גל ב21.5.25

- **Status:** ⚪ inactive
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive · Link shortener
- **Business flow:** reads/writes Pipedrive → branches on conditions → shortens a link → reads/writes Pipedrive → shortens a link → reads/writes Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430264 — יצירת שאלון לקראת פעילות לסיורים בשבוע הקרוב - OFF

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Google Sheets · Google Drive
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → reads a Google Sheet → writes a row to a Google Sheet → handles a Drive file → updates the deal in Pipedrive → looks for an existing company in Pipedrive → updates the deal in Pipedrive → reads a Google Sheet → writes a row to a Google Sheet → handles a Drive file → updates the deal in Pipedrive → looks for an existing company in Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430336 — כפתור שליחת מיילים מיידיים לסוכנים/מפיקים - נסגר ב-26.3.24

- **Status:** ⚪ inactive
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Gmail · Airtable
- **Business flow:** receives an incoming email → looks up the contact in Pipedrive → branches on conditions → sends an email → looks up the contact in Pipedrive → branches on conditions → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email → branches on conditions → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430286 — לקוחות עסקיים - יום אחרי פעילות העברה לפייפליין גבייה + מייל סיכום פעילות (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WooCommerce (website shop) · Airtable · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → handles deal products in Pipedrive → reads/writes Pipedrive → branches on conditions → creates a website coupon → looks up the contact in Pipedrive → branches on conditions → looks up an Airtable record → sends an email → branches on conditions → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email → looks up an Airtable record → sends an email → looks up an Airtable record → calls another automation / external service → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430263 — לקוחות עסקיים - פולואפים אוטומטיים במייל OFFFF

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Airtable · Gmail
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → talks to iCount → calls another automation / external service → normalises the Israeli phone number → branches on conditions → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → branches on conditions → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → branches on conditions → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → branches on conditions → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → looks up an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430298 — לקוחות עסקיים - תזכורת לקראת פעילות (גיבוי)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · Gmail
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → shortens a link → sends an email → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → shortens a link → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430257 — לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ימות השבוע - בוקר)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → sends an email → branches on conditions → sends an email → normalises the Israeli phone number → sends a WhatsApp message → sends an email → normalises the Israeli phone number → sends a WhatsApp message → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430290 — לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ימות השבוע - בוקר) (wassenger)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → talks to iCount → sends an email → calls another automation / external service → branches on conditions → sends an email → normalises the Israeli phone number → sends a WhatsApp message → sends an email → normalises the Israeli phone number → sends a WhatsApp message → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430348 — לקוחות פרטיים - שליחת וואטסאפ מיידי OFF

- **Status:** ⚪ inactive
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → reads deals from Pipedrive → looks up the contact in Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → looks up an Airtable record → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → creates a follow-up task in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive → normalises the Israeli phone number → looks up an Airtable record → branches on conditions → sends a WhatsApp message → creates a follow-up task in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430277 — לקוחות פרטיים - תזכורות לקראת פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → looks up the contact in Pipedrive → handles deal products in Pipedrive → looks up an Airtable record → shortens a link → branches on conditions → sends an email → branches on conditions → sends an email → branches on conditions → sends an email → looks up the contact in Pipedrive → handles deal products in Pipedrive → looks up an Airtable record → shortens a link → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message → looks up the contact in Pipedrive → handles deal products in Pipedrive → looks up an Airtable record → shortens a link → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430278 — נסגר לבקשת אלינוי - 1.2.24בדיקת סיורים קרובים - אם לא מופיע שיבוץ מדריך בפייפדרייב

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 1889735 — נסגר לבקשת אלינוי 14.2.24 -אקטיבטי שיבוץ מדריך

- **Status:** ⚪ inactive
- **Trigger:** Webhook — שיבוץ מדריך
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → creates a follow-up task in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430294 — סוכנויות ומפיקים - מייל שבוע אחרי פעילות עם קישור לטופס הזמנה חוזרת- OFF ON PURPOSE 20/7/25

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Gmail
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → normalises the Israeli phone number → looks up an Airtable record → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430250 — עדכון מקור בשדה חדש

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Google Sheets
- **Business flow:** reads deals from Pipedrive → reads a Google Sheet → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430259 — עובר כל יום על השיבוצים ביומן ומעדכן לפייפדרייב ולאיירטייבל

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Airtable · Google Calendar · Pipedrive
- **Business flow:** looks up an Airtable record → reads the calendar → branches on conditions → looks for an existing company in Pipedrive → updates the deal in Pipedrive → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430252 — שליחת וואטסאפ חד פעמי - מצב בטחוני

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → normalises the Israeli phone number → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430296 — תזכורות למדריכים יום אחרי פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → looks up an Airtable record → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430272 — תזכורות למדריכים לקראת פעילות

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → normalises the Israeli phone number → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 wassenger — 16 scenarios (5 live)

### 2607384 — בדיקת חיבור ווסנג'ר

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Gmail
- **Business flow:** branches on conditions → calls another automation / external service → sends an email → calls another automation / external service → sends an email → calls another automation / external service → sends an email
- **GOS replaces it?** **Yes** — WhatsApp bridge health + בקרה detectors
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 3734669 — דיל מפאנזינג

- **Status:** 🟢 live · last ran 2026-07-15 · 1 runs / 0 errors sampled
- **Trigger:** Incoming email
- **Systems:** WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → sends a WhatsApp message
- **GOS replaces it?** **Yes** — Deal sources
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 440474 — לקוחות פרטיים - תזכורות לקראת פעילות (wassenger - check content)

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · Link shortener · WhatsApp (Wassenger)
- **Business flow:** reads/writes Pipedrive → reads deals from Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → looks up the contact in Pipedrive → handles deal products in Pipedrive → looks up an Airtable record → shortens a link → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Partly — Communication Center pre-activity reminders
- **Still missing in GOS:** No active CC rule carries these yet
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 3121861 — שליחה לאחר עריכה בפייפ

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת וואטסאפ מיידי
- **Systems:** Website / incoming form · Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → branches on conditions → reads/writes Airtable → branches on conditions → normalises the Israeli phone number → updates the deal in Pipedrive → writes a note on the Pipedrive deal → branches on conditions → sends a WhatsApp message → updates the deal in Pipedrive → creates a follow-up task in Pipedrive → writes a note on the Pipedrive deal → updates the deal in Pipedrive
- **GOS replaces it?** **Yes** — WhatsApp module (Baileys bridge)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 3956203 — שליחת וואטסאפ ב6 בבוקר על סיורים שלא מולא סיכום סיור

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Airtable · WhatsApp (Wassenger)
- **Business flow:** looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → sends a WhatsApp message → looks up an Airtable record → branches on conditions → looks up an Airtable record → sends a WhatsApp message
- **GOS replaces it?** **Yes** — Manager Reports #7/#8 (missing tour summaries)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 439285 — טופס פאנזינג שולח הודעת וואטסאפ (wassenger)

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — טופס פאנזינג שולח הודעת וואטסאפ
- **Systems:** Website / incoming form · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430344 — כפתור באיירטייבל להוספת ניסוח וואטסאפ מיידי

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הוספת וואטסאפ מיידי חדש בכפתור איירטייבל
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → loops over items → reads/writes Pipedrive → updates an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 4046811 — שליחת הודעה עם משוב בקבוצת מדריכים 

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שליחת הודעה עם משוב בקבוצת מדריכים 
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → loops over items → sends a WhatsApp message → branches on conditions → looks up an Airtable record → sends a WhatsApp message → loops over items → looks up an Airtable record → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 3868542 — (note) נוצר נאוט ידני בדיל -> שליחת ווצאפ למשרד

- **Status:** ⚪ inactive
- **Trigger:** Webhook — נוצר note ידני בדיל
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 2923485 — טופס השתתפות

- **Status:** ⚪ inactive
- **Trigger:** Webhook — מענה מהוואצאפ
- **Systems:** Website / incoming form · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430291 — לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (שבת - ערב) (wassenger)

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → reads/writes Pipedrive → handles deal products in Pipedrive → calls another automation / external service → talks to iCount → calls another automation / external service → branches on conditions → sends an email → normalises the Israeli phone number → sends a WhatsApp message → sends an email → normalises the Israeli phone number → sends a WhatsApp message → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430295 — לקוחות עסקיים - תזכורת לתשלום ביום הפעילות עבור הלקוח + המדריך (wassenger)

- **Status:** 🔴 auto-disabled · last ran 2026-08-01 · 32 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → talks to iCount → calls another automation / external service → sends an email → looks up an Airtable record → talks to iCount → calls another automation / external service → sends an email → looks up an Airtable record → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 4339341 — עדכון מזהה איש קשר בוואסנגר

- **Status:** ⚪ inactive
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** reads/writes Pipedrive → talks to WhatsApp (Wassenger) → branches on conditions → talks to WhatsApp (Wassenger)
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 1081615 — ענת בדיקה

- **Status:** ⚪ inactive · last ran 2026-07-15 · 1 runs / 1 errors sampled
- **Trigger:** Scheduled every 15 min
- **Systems:** WhatsApp (Wassenger) · Pipedrive
- **Business flow:** talks to WhatsApp (Wassenger) → loops over items → reads/writes Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; last ran 2026-07-15. Kept only as a record.

### 3954621 — שליחת הודעת וואטסאפ חדשה בקבוצת לוגיסטיקה-כובה בתאריך 25.11.25 לבקשת דור

- **Status:** ⚪ inactive
- **Trigger:** Webhook — שליחת הודעת וואטסאפ חדשה בקבוצת לוגיסטיקה
- **Systems:** Website / incoming form · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 440488 — תזכורות למדריכים לקראת פעילות (wassenger) ענת סגרה 11/05/2025

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → branches on conditions → normalises the Israeli phone number → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 לידים לפייפדרייב — 15 scenarios (5 live)

### 3897811 — Find/Create UTM

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 48 errors sampled
- **Trigger:** Webhook — Find/Create UTM
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → branches on conditions → reads/writes Pipedrive → branches on conditions → reads/writes Pipedrive
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 1069253 — pipe4u

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 48 errors sampled
- **Trigger:** Webhook — Pipe4u
- **Systems:** Website / incoming form · Pipedrive · WhatsApp (Wassenger) · Gmail
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → calls another automation / external service → branches on conditions → looks for an existing company in Pipedrive → branches on conditions → updates the contact in Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → branches on conditions → creates a deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → writes a note on the Pipedrive deal → creates a follow-up task in Pipedrive → sends a WhatsApp message → creates the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → updates the contact in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive → looks for an existing company in Pipedrive → branches on conditions → updates the contact in Pipedrive → reads/writes Pipedrive → reads deals from Pipedrive → reads/writes Pipedrive → branches on conditions → creates a deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → writes a note on the Pipedrive deal → creates a follow-up task in Pipedrive → sends a WhatsApp message → creates the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → updates the contact in Pipedrive → sends a WhatsApp message → sends an email
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430307 — דף נחיתה אלמנטור > פייפדרייב

- **Status:** 🟢 live · last ran 2026-08-03 · 42 runs / 0 errors sampled
- **Trigger:** Webhook — דף נחיתה אלמנטור
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430315 — טופס בעמודי מוצר באתר > פייפדרייב

- **Status:** 🟢 live · last ran 2026-07-23 · 7 runs / 0 errors sampled
- **Trigger:** Webhook — Website product form
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430331 — טופס עמוד צור קשר באתר > פייפדרייב + סמוב

- **Status:** 🟢 live · last ran 2026-07-26 · 12 runs / 0 errors sampled
- **Trigger:** Webhook — Website contact form
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430317 — Leads' Google form > Pipedrive

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — Elinoy's Google form - leads
- **Systems:** Website / incoming form · Pipedrive · WhatsApp (Wassenger) · Gmail
- **Business flow:** receives a form/web submission → branches on conditions → looks for an existing company in Pipedrive → branches on conditions → updates the contact in Pipedrive → reads/writes Pipedrive → branches on conditions → creates a deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → creates a follow-up task in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → creates a follow-up task in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → creates a follow-up task in Pipedrive → creates a deal in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive → creates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive → updates the contact in Pipedrive → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430343 — Smoove subsricbers - food > Create Pipedrive Contact & Deal

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — Smoove subscribers - food
- **Systems:** Website / incoming form · Pipedrive · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → looks up the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → creates a follow-up task in Pipedrive → creates the contact in Pipedrive → creates a deal in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430335 — Smoove subsricbers - Graffiti > Create Pipedrive Contact & Deal

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — Smoove subscribers
- **Systems:** Website / incoming form · Pipedrive · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → looks up the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → creates a follow-up task in Pipedrive → creates the contact in Pipedrive → creates a deal in Pipedrive → sends a WhatsApp message → creates a follow-up task in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430320 — דף נחיתה פעילות בת מצווה > פייפדרייב + סמוב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — דף נחיתה פעילות בת מצווה
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430321 — טופס פוטר באתר > פייפדרייב + סמוב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — Website footer form
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 1989063 — יצירת לינק לצ'אט בווסנג'ר כפתור בפייפ

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — יצירת לינק לצ'אט בווסנג'ר כפתור בפייפ
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → updates the contact in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430337 — לקוח לחץ במייל על לינק ליצירת קשר > הכנסה לפייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — לקוח לחץ במייל על לינק ליצירת קשר
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → looks up the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430346 — פופאפ צור קשר באתר > פייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — פופאפ צור קשר באתר
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → calls another automation / external service
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 430352 — לידים מטופס פייסבוק קמפיין גרפיטי רימרקטינג > פייפדרייב

- **Status:** ⚪ inactive · last ran 2026-08-01 · 41 runs / 9 errors sampled
- **Trigger:** Facebook/Instagram lead form
- **Systems:** Facebook Lead Ads · Gmail
- **Business flow:** receives a Facebook/Instagram lead → normalises the Israeli phone number → calls another automation / external service → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; last ran 2026-08-01. Kept only as a record.

### 1989054 — פרסון חדש בפייפ- הוספת לינק לצ'אט בווסנג'ר

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 49 runs / 1 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive
- **Business flow:** reads/writes Pipedrive → branches on conditions → looks up the contact in Pipedrive → updates the contact in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 דיל עבר לוון — 13 scenarios (10 live)

### 1889926 — הוצאת חשבונית עסקה לאחר סגירה

- **Status:** 🟢 live · last ran 2026-07-31 · 48 runs / 0 errors sampled
- **Trigger:** Webhook — הוצאת חשבונית עסקה לקוח עסקי
- **Systems:** Website / incoming form · Pipedrive · Airtable · iCount
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → updates the deal in Pipedrive → looks up an Airtable record → reads/writes Pipedrive → handles deal products in Pipedrive → branches on conditions → talks to iCount → calls another automation / external service → branches on conditions → calls another automation / external service → updates the deal in Pipedrive → branches on conditions → looks up the contact in Pipedrive → reads/writes Pipedrive → updates the deal in Pipedrive → calls another automation / external service → reads/writes Pipedrive → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → branches on conditions → looks up the contact in Pipedrive
- **GOS replaces it?** Partly — Native iCount module
- **Still missing in GOS:** Business-invoice parity not verified against iCount
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 4602660 — הוצאת חשבונית עסקה לאחר סגירה 2

- **Status:** 🟢 live · last ran 2026-07-28 · 37 runs / 1 errors sampled
- **Trigger:** Scheduled (on-demand)
- **Systems:** Airtable · Gmail
- **Business flow:** looks up an Airtable record → branches on conditions → normalises the Israeli phone number → sends an email → normalises the Israeli phone number → sends an email
- **GOS replaces it?** Partly — Native iCount module
- **Still missing in GOS:** Same as above
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 728643 — טופס עדכון סיור לפייפ 7 ixqlleyrtoxql7matrs1m5ueznq3h5s

- **Status:** 🟢 live · last ran 2026-07-28 · 9 runs / 0 errors sampled
- **Trigger:** Webhook — עדכון סיור מטופס הרשמה לפייפדרייב
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → updates the deal in Pipedrive → writes a note on the Pipedrive deal → calls another automation / external service
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Unmapped — needs a business owner
- **Recommendation:** **Requires my decision** — Live, no GOS replacement identified.

### 889158 — לאנדוליני לקוח - מילוי טופס הרשמה לסיור u88fvsgtaqhk5qgdh9fpy8oalwc95vty

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — דיל הפך לWON
- **Systems:** Website / incoming form · Pipedrive · Airtable · WhatsApp (Wassenger) · Gmail · Google Calendar
- **Business flow:** receives a form/web submission → looks up the contact in Pipedrive → reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions → updates an Airtable record → looks up an Airtable record → branches on conditions → calls another automation / external service → updates an Airtable record → updates the deal in Pipedrive → branches on conditions → sends a WhatsApp message → sends an email → writes a note on the Pipedrive deal → updates the deal in Pipedrive → looks up an Airtable record → creates a calendar event → updates an Airtable record → updates the deal in Pipedrive → reads/writes Pipedrive → updates the deal in Pipedrive → creates an Airtable record → looks up an Airtable record → branches on conditions → updates an Airtable record → updates the deal in Pipedrive → handles deal products in Pipedrive → creates an Airtable record → updates an Airtable record → updates the deal in Pipedrive → branches on conditions → sends an email → writes a note on the Pipedrive deal
- **GOS replaces it?** Partly — Confirmation Email + Tour Calendar + Files
- **Still missing in GOS:** Registration-form intake has no GOS form yet
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 965408 — עדכון בדיל טופס הרשמה לסיור  e3wey951dfxns5fdm2at7yvs11k8tkmp

- **Status:** 🟢 live · last ran 2026-07-31 · 48 runs / 2 errors sampled
- **Trigger:** Webhook — עדכון בפייפ טופס עדכון סיור מהאיירטייבל לפייפ
- **Systems:** Website / incoming form · Airtable · Pipedrive · Gmail
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → updates the deal in Pipedrive → handles deal products in Pipedrive → writes a note on the Pipedrive deal → calls another automation / external service → sends an email
- **GOS replaces it?** **Yes** — Confirmation Email module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1899057 — עדכון שולם מהפייפ לאיירטייבל

- **Status:** 🟢 live · last ran 2026-08-02 · 30 runs / 0 errors sampled
- **Trigger:** Webhook — עדכון שולם מהפייפ לאיירטייבל
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** **Yes** — GOS payment state
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 889252 — פתח תיקיה בגוגל דרייב

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — סיור חדש באיירטייבל
- **Systems:** Website / incoming form · Airtable · Google Drive · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → creates a Google Drive folder → updates an Airtable record → updates the deal in Pipedrive
- **GOS replaces it?** **Yes** — Files module + Tour Gallery
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 440477 — רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב

- **Status:** 🟢 live · last ran 2026-07-30 · 27 runs / 0 errors sampled
- **Trigger:** Webhook — רכישה באתר
- **Systems:** Website / incoming form · Airtable · WooCommerce (website shop) · Pipedrive · iCount · Gmail · Google Calendar
- **Business flow:** receives a form/web submission → branches on conditions → looks up an Airtable record → creates an Airtable record → reads the website order → normalises the Israeli phone number → looks for an existing company in Pipedrive → looks up an Airtable record → branches on conditions → loops over items → branches on conditions → calls another automation / external service → branches on conditions → issues an accounting document (iCount) → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → updates the deal in Pipedrive → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → writes a note on the Pipedrive deal → creates a deal in Pipedrive → handles deal products in Pipedrive → updates the deal in Pipedrive → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → updates the deal in Pipedrive → branches on conditions → updates the contact in Pipedrive → branches on conditions → creates a deal in Pipedrive → handles deal products in Pipedrive → updates the deal in Pipedrive → calls another automation / external service → reads/writes Pipedrive → branches on conditions → reads deals from Pipedrive → updates the deal in Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → reads/writes Pipedrive → loops over items → sends an email → creates the contact in Pipedrive → creates a deal in Pipedrive → handles deal products in Pipedrive → updates the deal in Pipedrive → calls another automation / external service → reads/writes Pipedrive → creates a calendar event → calls another automation / external service
- **GOS replaces it?** Partly — Confirmation Email + Calendar sync + iCount + Woo ingress
- **Still missing in GOS:** WOO_PRIMARY_WEBHOOK_SECRET unset; adapter gaps G1/G2/G4
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 1015939 — שליחת וואצאפ חוגגים סגירות אחרי וון

- **Status:** 🟢 live · last ran 2026-07-30 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת וואצאפ חוגגים סגירות אחרי וון
- **Systems:** Website / incoming form · Pipedrive · Airtable · WhatsApp (Wassenger) · Gmail
- **Business flow:** receives a form/web submission → looks up the contact in Pipedrive → reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → sends a WhatsApp message → sends an email → writes a note on the Pipedrive deal → sends a WhatsApp message → writes a note on the Pipedrive deal
- **GOS replaces it?** **Yes** — Manager Report #26 (deal WON)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1651940 — שליחת מסר לאחר WON p7agxxa1tqont84rumkfu3jgql6tuoix

- **Status:** 🟢 live · last ran 2026-07-30 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — status won
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → writes a note on the Pipedrive deal → reads/writes Pipedrive
- **GOS replaces it?** **Yes** — Manager Report #26 + Confirmation Email module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430322 — רכישת שובר מתנה > מייצר קופון ושולח במייל + מעדכן פייפדרייב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — רכישת שובר - טריגר מסנריו רכישה
- **Systems:** Website / incoming form · WooCommerce (website shop) · Airtable · Google Docs · Google Drive · Gmail · Pipedrive
- **Business flow:** receives a form/web submission → reads the website order → looks up an Airtable record → creates a website coupon → branches on conditions → produces a document → handles a Drive file → branches on conditions → sends an email → looks for an existing company in Pipedrive → reads/writes Pipedrive → loops over items → branches on conditions → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → updates the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → handles deal products in Pipedrive → writes a note on the Pipedrive deal → creates the contact in Pipedrive → creates a deal in Pipedrive → writes a note on the Pipedrive deal → handles deal products in Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 3648282 — שליחה חוזרת להזמנות באתר

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הכנסת הזמנה מהאתר
- **Systems:** Website / incoming form · Airtable · WooCommerce (website shop)
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → deletes an Airtable record → reads the website order → calls another automation / external service → reads the website order → calls another automation / external service
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430740 — נסגר 28.3 דיל הפך לוון > שליחת נקודת מפגש בוואטסאפ (wassenger)

- **Status:** ⚪ inactive
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Airtable · WhatsApp (Wassenger) · Gmail
- **Business flow:** receives an incoming email → reads deals from Pipedrive → reads/writes Pipedrive → looks up an Airtable record → branches on conditions → sends a WhatsApp message → sends an email
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 עסקיים — 13 scenarios (2 live)

### 2725066 — עדכון תנאי תשלום בדיל שמשוייך לארגון בפייפ עיסקי

- **Status:** 🟢 live · last ran 2026-07-28 · 33 runs / 0 errors sampled
- **Trigger:** Webhook — עדכון תנאי תשלום בדיל שמשוייך לארגון בפייפ עיסקי
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail
- **Business flow:** receives a form/web submission → reads/writes Pipedrive → branches on conditions → looks up an Airtable record → updates the deal in Pipedrive → sends an email
- **GOS replaces it?** **Yes** — Deal classification SSOT (org-level payment terms)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4549250 — שליחת תוכן 2 ימים לפני תזכורת לתשלום

- **Status:** 🟢 live · last ran 2026-07-08 · 1 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת תוכן 2 ימים לפני תזכורת לתשלום
- **Systems:** Website / incoming form · Pipedrive · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads/writes Pipedrive → talks to iCount → sends an email → calls another automation / external service → looks up the contact in Pipedrive → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Partly — Communication Center + iCount
- **Still missing in GOS:** No active CC rule
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 430324 — [טופל]לקוח עסקי ממלא טופס הזמנה > עדכון לדיל בפייפדרייב > שליחת מסמך ללקוח > שליחת נוטיפיקציה למשרד

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — לקוח עסקי שלח טופס הזמנה באתר
- **Systems:** Website / incoming form · Pipedrive · Gmail · Google Docs · Google Drive
- **Business flow:** receives a form/web submission → branches on conditions → reads deals from Pipedrive → branches on conditions → normalises the Israeli phone number → updates the deal in Pipedrive → branches on conditions → calls another automation / external service → reads/writes Pipedrive → handles deal products in Pipedrive → sends an email → branches on conditions → produces a document → handles a Drive file → sends an email → produces a document → handles a Drive file → sends an email → reads/writes Pipedrive → branches on conditions → sends an email → calls another automation / external service
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1443989 — יוזר חדש בפייפ לטבלת המרה באיירטייבל

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הוספת יוזר חדש לפייפ
- **Systems:** Website / incoming form · Airtable · Gmail
- **Business flow:** receives a form/web submission → creates an Airtable record → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430325 — לקוחות עסקיים - העברת סטייג' > שליחת תזכורת תשלום ללקוח

- **Status:** 🟡 active but idle
- **Trigger:** Incoming email
- **Systems:** Pipedrive · iCount · Airtable · Gmail
- **Business flow:** receives an incoming email → reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → issues an accounting document (iCount) → talks to iCount → calls another automation / external service → branches on conditions → looks up an Airtable record → sends an email → updates the deal in Pipedrive → looks up an Airtable record → sends an email → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430345 — לקוחות עסקיים - לחיצה על לינק במייל > שליחת תזכורת תשלום ללקוח

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שליחת תזכורת תשלום ללקוח עסקי
- **Systems:** Website / incoming form · Pipedrive · iCount · Airtable · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → talks to iCount → calls another automation / external service → branches on conditions → looks up an Airtable record → sends an email → updates the deal in Pipedrive → looks up an Airtable record → sends an email → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430308 — סוכני תיירות וחברות הפקה ממלאים טופס הזמנה (חוזרת) > יצירת דיל > שליחת מסמך ללקוח > שליחת נוטיפיקציה למשרד

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — סוכן תיירות שלח טופס הזמנה באתר
- **Systems:** Website / incoming form · Pipedrive · Link shortener · Airtable · Gmail · Google Docs · Google Drive
- **Business flow:** receives a form/web submission → normalises the Israeli phone number → looks for an existing company in Pipedrive → branches on conditions → creates the contact in Pipedrive → normalises the Israeli phone number → branches on conditions → shortens a link → updates the contact in Pipedrive → shortens a link → updates the contact in Pipedrive → shortens a link → updates the contact in Pipedrive → shortens a link → updates the contact in Pipedrive → reads/writes Pipedrive → updates the contact in Pipedrive → creates a deal in Pipedrive → branches on conditions → looks up an Airtable record → handles deal products in Pipedrive → sends an email → reads deals from Pipedrive → branches on conditions → handles deal products in Pipedrive → branches on conditions → produces a document → handles a Drive file → sends an email → produces a document → handles a Drive file → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 4561651 — שליחת תוכן 5 ימים לפני תזכורת לתשלום

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שליחת תוכן 5 ימים לפני תזכורת לתשלום
- **Systems:** Website / incoming form · Pipedrive · iCount · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads/writes Pipedrive → handles deal products in Pipedrive → talks to iCount → sends an email → calls another automation / external service → looks up the contact in Pipedrive → normalises the Israeli phone number → branches on conditions → sends an email → sends a WhatsApp message → sends an email → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 430273 — לקוחות עסקיים - הוצאת קבלות פעם ביום - 16:00

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → reads/writes Pipedrive → handles deal products in Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → sends an email
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430267 — לקוחות עסקיים - הוצאת קבלות פעם ביום - 8:00

- **Status:** 🔴 auto-disabled · last ran 2026-08-01 · 32 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · iCount · Gmail
- **Business flow:** reads deals from Pipedrive → branches on conditions → reads/writes Pipedrive → handles deal products in Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → sends an email
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430261 — לקוחות עסקיים - יום אחרי פעילות העברה לפייפליין גבייה + יומיים אחרי מייל סיכום פעילות

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WooCommerce (website shop)
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → reads/writes Pipedrive → branches on conditions → creates a website coupon → looks up the contact in Pipedrive → handles deal products in Pipedrive → calls another automation / external service → branches on conditions → updates the deal in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 1989068 — סיכום סיור - לקוח עיסקי

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 17 runs / 2 errors sampled
- **Trigger:** Webhook — טופס סיכום סיור הושלם - לקוח עיסקי
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → creates a follow-up task in Pipedrive → loops over items → looks up an Airtable record → reads/writes Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 4549206 — שליחת תוכן 4 ימים לפני

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 9 runs / 1 errors sampled
- **Trigger:** Webhook — שליחת תוכן 4 ימים לפני
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads/writes Pipedrive → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 לאנדוליני: אוטומציות חדשות — 12 scenarios (8 live)

### 698867 — בכל דיל חדש הוסף לינקים לטפסים - לאנדוליני

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — new deal from pipedrive webhook
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → updates the deal in Pipedrive
- **GOS replaces it?** **Yes** — Deal capability URLs
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 964304 — הקמת מוצר חדש מעדכן מזהה בפייפ

- **Status:** 🟢 live · last ran 2026-07-22 · 2 runs / 0 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive · Airtable · Gmail
- **Business flow:** handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → handles deal products in Pipedrive → creates an Airtable record → looks up an Airtable record → handles deal products in Pipedrive → sends an email
- **GOS replaces it?** **Yes** — Products/Pricing module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2125961 — הרכבת מסר / תוכן

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — הרכבת/שליחת מסר
- **Systems:** Website / incoming form · Pipedrive · Airtable · Link shortener · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → reads/writes Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions → looks up an Airtable record → shortens a link → branches on conditions → normalises the Israeli phone number → branches on conditions → sends an email → writes a note on the Pipedrive deal → sends an email → branches on conditions → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → sends an email
- **GOS replaces it?** Partly — Communication Center message assembly
- **Still missing in GOS:** CC has 0 active customer rules — content not migrated
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 1445570 — טופס משוב - ניסיונות לשיחות

- **Status:** 🟢 live · last ran 2026-07-26 · 13 runs / 10 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Fillout · Airtable
- **Business flow:** reads a Fillout form submission → updates an Airtable record → looks up an Airtable record → branches on conditions → updates an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** UNKNOWN PURPOSE — 77% error rate
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 830264 — מדיל לטופס פילאאוט pre fill

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 5 errors sampled
- **Trigger:** Webhook — מדיל לטופס פילאאוט webhook
- **Systems:** Website / incoming form · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → handles deal products in Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions
- **GOS replaces it?** Partly — Questionnaire Engine
- **Still missing in GOS:** Fillout pre-fill link has no GOS equivalent
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 1411537 — סגירת משימות אוטומטיות אחרי וון

- **Status:** 🟢 live · last ran 2026-07-30 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — סגירת משימות אוטומטיות אחרי וון
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads/writes Pipedrive
- **GOS replaces it?** **Yes** — CRM Tasks workspace
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4131369 — פתיחת תיקייה בגוגל דרייב לסיורים כל יום

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Airtable · Google Drive · Pipedrive
- **Business flow:** looks up an Airtable record → creates a Google Drive folder → updates an Airtable record → updates the deal in Pipedrive
- **GOS replaces it?** **Yes** — Files module + Tour Gallery
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4131439 — שליחת הודעות מתוזמנות ב8 בבוקר

- **Status:** 🟢 live · last ran 2026-08-03 · 14 runs / 1 errors sampled
- **Trigger:** Scheduled (weekly)
- **Systems:** Airtable · Pipedrive
- **Business flow:** reads/writes Make storage → looks up an Airtable record → branches on conditions → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service → reads/writes Make storage
- **GOS replaces it?** Partly — Communication Center scheduled sends
- **Still missing in GOS:** No active CC rule
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 430347 — הוספת מוצר בווקומרס מוסיפה אותו בפייפדרייב ובאיירטייבל

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הוספת מוצר חדש
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail
- **Business flow:** receives a form/web submission → handles deal products in Pipedrive → creates an Airtable record → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1449188 — המשך טיפול לאחר שיחת משוב

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — המשך טיפול לאחר שיחת משוב
- **Systems:** Website / incoming form · Gmail · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → branches on conditions → sends an email → looks up an Airtable record → sends a WhatsApp message → calls another automation / external service → sends a WhatsApp message → sends an email
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 704964 — מטופס הוספת מדריך/מועמד חדש לאיירטייבל ולפייפ - לאנדוליני

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — הוספת מדריך/מועמד webhook
- **Systems:** Website / incoming form · Airtable · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → reads/writes Airtable
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 799554 — דיל פתוח ללא משימה מקבל משימה בחצות

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → creates a follow-up task in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 מדריכים — 11 scenarios (10 live)

### 4749928 — הודעה חדשה על כל מדריך שמילא טופס תיאום סיור

- **Status:** 🟢 live · last ran 2026-08-02 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — בוצע שיחת תיאום שליחת הודעה לקבוצת וואצאפ
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → looks up an Airtable record → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** **Yes** — Questionnaire Engine (tour-operational lifecycle)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4207107 — הכנסת הערות עבור השכר מהפייפ

- **Status:** 🟢 live · last ran 2026-07-08 · 1 runs / 0 errors sampled
- **Trigger:** Webhook — שדה הערות עבור השכר
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → looks up an Airtable record → updates an Airtable record → sends an email
- **GOS replaces it?** **Yes** — Payroll module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 430349 — כפתור באיירטייבל להקמת מדריך.ה חדש.ה

- **Status:** 🟢 live · last ran 2026-07-29 · 4 runs / 0 errors sampled
- **Trigger:** Webhook — קליטת מדריך חדש בכפתור איירטייבל
- **Systems:** Website / incoming form · Airtable · Pipedrive · Google Calendar · Gmail
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → loops over items → reads/writes Pipedrive → reads the calendar → updates an Airtable record → sends an email
- **GOS replaces it?** **Yes** — Staff module (manual staff creation)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2693681 — מחשבון שכר

- **Status:** 🟢 live · last ran 2026-08-02 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — מחשבון שכר
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → loops over items → looks up an Airtable record → loops over items → looks up an Airtable record → reads/writes Airtable → loops over items → looks up an Airtable record → loops over items → looks up an Airtable record → reads/writes Airtable → loops over items → looks up an Airtable record → loops over items → looks up an Airtable record → reads/writes Airtable
- **GOS replaces it?** **Yes** — Payroll module (PayrollEntry per assignment)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2883326 — עדכון חודש ושנה בשכר

- **Status:** 🟢 live · last ran 2026-07-30 · 26 runs / 0 errors sampled
- **Trigger:** Webhook — עדכון חודש ושכר
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** **Yes** — Payroll module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1126290 — רדיפה למדריך למלא טופס תיאום סיור

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — רדיפה למדריך למלא טופס תיאום סיור
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → looks up an Airtable record → sends a WhatsApp message
- **GOS replaces it?** **Yes** — Manager Reports #11–#16 + Guide Portal
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1051602 — שליחת הודעה למדריך טופס סיום הסיור- סיכומי סיור

- **Status:** 🟢 live · last ran 2026-07-31 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת טופס סיום למדריך
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → looks up an Airtable record → branches on conditions → sends a WhatsApp message → creates an Airtable record → sends a WhatsApp message → creates an Airtable record → reads/writes Make storage → loops over items → looks up an Airtable record → branches on conditions → sends a WhatsApp message → creates an Airtable record → sends a WhatsApp message → creates an Airtable record → reads/writes Make storage
- **GOS replaces it?** **Yes** — Manager Reports #7/#8 + Guide Portal questionnaires
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4452993 — שליחת לו"ז הודעה של כל הסיורים של מחר

- **Status:** 🟢 live · last ran 2026-08-03 · 34 runs / 0 errors sampled
- **Trigger:** Webhook — שליחת הודעה סיכום הסיורים מחר
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → looks up an Airtable record → sends a WhatsApp message
- **GOS replaces it?** **Yes** — Manager Reports #11–#16 (guide schedule + per-booking messages)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1126045 — שליחת תכנים ללקוח לאחר מילוי טופס סיכום סיור+מחיקת הודעות מתוזמנות

- **Status:** 🟢 live · last ran 2026-08-01 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — לאחר מילוי טופס סיור סיור
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger) · Google Drive · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → loops over items → looks up an Airtable record → calls another automation / external service → branches on conditions → talks to WhatsApp (Wassenger) → updates an Airtable record → handles a Drive file → branches on conditions → calls another automation / external service → loops over items → branches on conditions → reads/writes Make storage → looks up an Airtable record → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Partly — Confirmation Email + Communication Center
- **Still missing in GOS:** Post-summary customer content is not yet a CC rule
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 2844878 — תזמון חודשי למחשבון שכר

- **Status:** 🟢 live · last ran 2026-07-31 · 4 runs / 0 errors sampled
- **Trigger:** Scheduled (monthly)
- **Systems:** Airtable
- **Business flow:** looks up an Airtable record → calls another automation / external service
- **GOS replaces it?** **Yes** — Payroll module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 972724 — עדכון מדריכים היסטורי

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 לוסטים ודחייה — 8 scenarios (3 live)

### 1160762 — ביטול עסקה - לוסט

- **Status:** 🟢 live · last ran 2026-07-29 · 12 runs / 0 errors sampled
- **Trigger:** Webhook — לוסט לקוח ביטל
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail · Google Calendar
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → updates an Airtable record → branches on conditions → updates an Airtable record → looks up an Airtable record → updates an Airtable record → sends an email → deletes the calendar event
- **GOS replaces it?** **Yes** — GOS deal status + Tour Calendar sync
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2034772 — דיל הפך ללוסט-שליחה לסמוב

- **Status:** 🟢 live · last ran 2026-07-30 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — דיל הפך ללוסט-שליחה לסמוב
- **Systems:** Website / incoming form · Pipedrive · Smoove · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → updates the marketing mailing list (Smoove) → branches on conditions → reads/writes Pipedrive → sends a WhatsApp message
- **GOS replaces it?** Partly — Manager Reports + GOS deal status
- **Still missing in GOS:** Smoove marketing-list update on lost deals
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 440482 — עסקאות שהפכו ללוסט > עדכון לוואטסאפ (wassenger)

- **Status:** 🟢 live · last ran 2026-07-29 · 7 runs / 0 errors sampled
- **Trigger:** Incoming email
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → reads deals from Pipedrive → handles deal products in Pipedrive → sends a WhatsApp message → branches on conditions → sends a WhatsApp message
- **GOS replaces it?** **Yes** — GOS deal status + WhatsApp module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 456768 — דיל בפייפ הפך ללוסט- יקר מידי > וואטסאפ

- **Status:** 🟡 active but idle
- **Trigger:** Incoming email
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → reads deals from Pipedrive → looks up the contact in Pipedrive → normalises the Israeli phone number → sends a WhatsApp message → creates a follow-up task in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1586537 — עדכון הלינק לרדיפה למילוי תאריך סיור

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — שליחת וואצאפ לתאום סיור ששולם כבר
- **Systems:** Website / incoming form · Airtable · WhatsApp (Wassenger) · Pipedrive
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → sends a WhatsApp message → updates an Airtable record → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1070979 — לוסט לדיל לאחר 30 יום

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 1353334 — לוסט לדיל עיסקי לאחר 60 יום

- **Status:** 🔴 auto-disabled · last ran 2026-07-30 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430323 — עסקאות שהפכו ללוסט > עדכון לוואטסאפ

- **Status:** ⚪ inactive
- **Trigger:** Incoming email
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** receives an incoming email → reads deals from Pipedrive → handles deal products in Pipedrive → sends a WhatsApp message
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 להדליק אחרי המלחמה.... — 6 scenarios (0 live)

### 430292 — לקוחות פרטיים ועסקיים (לא סוכנויות ומפיקים) - מייל+וואטסאפ חודש אחרי פעילות (wassenger)

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 31 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 440466 — לקוחות פרטיים ועסקיים - מייל+וואטסאפ יומיים אחרי פעילות לאנשים נוספים שמילאו שאלון (wassenger)

- **Status:** ⚪ inactive
- **Trigger:** Webhook — מייל+וואטסאפ יום אחרי פעילות לאנשים נוספים
- **Systems:** Website / incoming form · Pipedrive · Airtable · Google Sheets · Gmail · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → reads a Google Sheet → sends an email → branches on conditions → reads a Google Sheet → sends an email → branches on conditions → reads a Google Sheet → normalises the Israeli phone number → sends a WhatsApp message → writes a row to a Google Sheet → branches on conditions → reads a Google Sheet → normalises the Israeli phone number → sends a WhatsApp message → writes a row to a Google Sheet
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 440472 — לקוחות פרטיים - מייל+וואטסאפ יומיים אחרי פעילות (wassenger)

- **Status:** ⚪ inactive
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WooCommerce (website shop)
- **Business flow:** reads deals from Pipedrive → handles deal products in Pipedrive → branches on conditions → creates a website coupon → handles deal products in Pipedrive → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 430274 — לקוחות פרטיים - פולואפ 1 (אישי) בוואטסאפ - 10:00

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 31 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → reads/writes Pipedrive → branches on conditions → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → updates the deal in Pipedrive → reads/writes Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430262 — לקוחות פרטיים - פולואפ 1 (אישי) בוואטסאפ - 16:00

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 30 runs / 2 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → reads/writes Pipedrive → branches on conditions → normalises the Israeli phone number → branches on conditions → sends a WhatsApp message → updates the deal in Pipedrive → reads/writes Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

### 430266 — לקוחות פרטיים - פולואפ 2 (גנרי) בוואטסאפ

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 31 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · WhatsApp (Wassenger)
- **Business flow:** reads deals from Pipedrive → normalises the Israeli phone number → branches on conditions → looks up the contact in Pipedrive → branches on conditions → sends a WhatsApp message → updates the deal in Pipedrive → creates a follow-up task in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 הכנסת תוכן וואצאפ לדיל — 5 scenarios (5 live)

### 4447721 — בדיקה אם איש קשר קיים בפייפ ושליחה לאיירטייבל

- **Status:** 🟢 live · last ran 2026-07-26 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — איש קשר חדש לאיירטייבל
- **Systems:** Website / incoming form · Airtable · Pipedrive · Gmail
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads/writes Pipedrive → branches on conditions → updates an Airtable record → reads/writes Pipedrive → branches on conditions → sends an email → updates an Airtable record
- **GOS replaces it?** **Yes** — Contacts module + WhatsApp mirror
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4345044 — הכנסת התכתבות וואצאפ לדיל

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 0 errors sampled
- **Trigger:** Scheduled every 360 min
- **Systems:** Airtable · Pipedrive · Gmail
- **Business flow:** looks up an Airtable record → branches on conditions → reads/writes Pipedrive → branches on conditions → writes a note on the Pipedrive deal → updates an Airtable record → reads/writes Pipedrive → updates an Airtable record → reads/writes Pipedrive → branches on conditions → sends an email → updates an Airtable record → writes a note on the Pipedrive deal → updates an Airtable record → reads/writes Pipedrive → writes a note on the Pipedrive deal → updates an Airtable record → reads/writes Pipedrive → updates an Airtable record → reads/writes Pipedrive
- **GOS replaces it?** **Yes** — WhatsApp module (native chat mirror on the Deal)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4359629 — הקמת איש קשר בפייפ

- **Status:** 🟢 live · last ran 2026-07-28 · 50 runs / 1 errors sampled
- **Trigger:** Webhook — הקמת איש קשר בפייפ
- **Systems:** Website / incoming form · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → calls another automation / external service → reads/writes Pipedrive → looks up an Airtable record → writes a note on the Pipedrive deal → updates an Airtable record
- **GOS replaces it?** **Yes** — Contacts module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4548217 — מחיקת דטא לאחר שבוע שלא הוקם איש קשר בפייפ

- **Status:** 🟢 live · last ran 2026-08-01 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — מחיקת דטא לאחר שבוע
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → loops over items → deletes an Airtable record
- **GOS replaces it?** **Yes** — none needed — Airtable housekeeping
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4357153 — מחיקת הדטא הודעות וואצאפ

- **Status:** 🟢 live · last ran 2026-08-02 · 33 runs / 0 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Airtable
- **Business flow:** looks up an Airtable record → loops over items → deletes an Airtable record
- **GOS replaces it?** **Yes** — none needed — Airtable housekeeping
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

---

## 📁 חשיפה — 5 scenarios (1 live)

### 3252574 — ביטול סיור חשיפה בקוגניטו

- **Status:** 🟢 live · last ran 2026-07-29 · 11 runs / 0 errors sampled
- **Trigger:** Webhook — ביטול סיור בקוגניטו
- **Systems:** Website / incoming form · Airtable · Cognito Forms
- **Business flow:** receives a form/web submission → looks up an Airtable record → reads a Cognito form submission
- **GOS replaces it?** **Yes** — Open Tours module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 3162997 — העברת לתשלום מהרשמה לסיור חשיפה

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — מעבר לדף סליקה לאחר הרשמה לסיור חשיפה
- **Systems:** Website / incoming form · Cognito Forms · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → branches on conditions → reads a Cognito form submission → loops over items → branches on conditions → calls another automation / external service → reads deals from Pipedrive → looks up the contact in Pipedrive → reads a Cognito form submission → looks up an Airtable record → loops over items → updates the deal in Pipedrive → reads a Cognito form submission → branches on conditions → updates the deal in Pipedrive → writes a note on the Pipedrive deal → handles deal products in Pipedrive → updates the deal in Pipedrive → reads a Cognito form submission → calls another automation / external service → branches on conditions
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 3106389 — הקמת סיורי חשיפה

- **Status:** 🟡 active but idle
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Cognito Forms · Airtable · Link shortener · WhatsApp (Wassenger) · Gmail
- **Business flow:** reads a Cognito form submission → loops over items → reads a Cognito form submission → creates an Airtable record → reads a Cognito form submission → updates an Airtable record → reads a Cognito form submission → shortens a link → sends a WhatsApp message → sends an email → updates an Airtable record
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 3314785 — וון על דיל שמקושר לדילים נוספים

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — וון על דיל עם דילים מקושרים
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → loops over items → updates the deal in Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 4069207 — סטטוס משתתפים בסיור חשיפה - מלאי

- **Status:** ⚪ inactive
- **Trigger:** Webhook — סטטוס משתתפים בסיור חשיפה
- **Systems:** Website / incoming form · Airtable · Cognito Forms
- **Business flow:** receives a form/web submission → looks up an Airtable record → branches on conditions → reads a Cognito form submission
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 סוכנים ומפיקים — 5 scenarios (4 live)

### 430353 — הוספת טלפון בפורמט 05/972... לכל איש קשר שנכנס + יצירת קישורים מקוצרים לאנשים תחת סוכנות/הפקה

- **Status:** 🟢 live · last ran 2026-08-03 · 50 runs / 0 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive · Link shortener
- **Business flow:** reads/writes Pipedrive → branches on conditions → normalises the Israeli phone number → updates the contact in Pipedrive → reads/writes Pipedrive → normalises the Israeli phone number → branches on conditions → shortens a link → updates the contact in Pipedrive
- **GOS replaces it?** **Yes** — Phone normalizer + capability URLs
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1993342 — הזמנות מסוכנים לפייפ

- **Status:** 🟢 live · last ran 2026-07-27 · 14 runs / 0 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Cognito Forms · Pipedrive · Airtable · Gmail
- **Business flow:** reads a Cognito form submission → reads/writes Pipedrive → looks up an Airtable record → branches on conditions → creates the contact in Pipedrive → reads/writes Pipedrive → loops over items → branches on conditions → creates a deal in Pipedrive → reads a Cognito form submission → handles deal products in Pipedrive → updates the deal in Pipedrive → reads/writes Pipedrive → writes a note on the Pipedrive deal → branches on conditions → reads/writes Pipedrive → branches on conditions → creates the contact in Pipedrive → updates the deal in Pipedrive → writes a note on the Pipedrive deal → sends an email
- **GOS replaces it?** Partly — Agent Reservations module
- **Still missing in GOS:** Same as above
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 430333 — יצירת קישורים לאנשים שמקושרים לסוכנויות ומפיקים - מיידי [ps31cvs7um4nq4zuo72ecd0o18no5ly9@hook.us1.make.com]

- **Status:** 🟢 live · last ran 2026-07-26 · 5 runs / 0 errors sampled
- **Trigger:** Incoming email
- **Systems:** Pipedrive · Link shortener
- **Business flow:** receives an incoming email → looks up the contact in Pipedrive → branches on conditions → reads/writes Pipedrive → normalises the Israeli phone number → shortens a link → updates the contact in Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** **Yes** — Capability URLs
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1993303 — פתיחת לינק להזמנת סוכנים חדש

- **Status:** 🟢 live · last ran 2026-08-01 · 50 runs / 5 errors sampled
- **Trigger:** Webhook — פתיחת לינק דינמי לטופס הזמנה
- **Systems:** Website / incoming form · Pipedrive · Cognito Forms
- **Business flow:** receives a form/web submission → looks up the contact in Pipedrive → branches on conditions → reads/writes Pipedrive → branches on conditions → looks up the contact in Pipedrive → reads a Cognito form submission
- **GOS replaces it?** Partly — Agent Reservations module
- **Still missing in GOS:** Cognito order form not replaced by the GOS reservation flow
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 430258 — יצירת קישורים לאנשים שמקושרים לסוכנויות ומפיקים - פעם ביום

- **Status:** 🔴 auto-disabled · last ran 2026-08-01 · 32 runs / 1 errors sampled
- **Trigger:** Scheduled (daily)
- **Systems:** Pipedrive · Link shortener
- **Business flow:** looks up the contact in Pipedrive → branches on conditions → reads/writes Pipedrive → normalises the Israeli phone number → shortens a link → updates the contact in Pipedrive → writes a note on the Pipedrive deal
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 הצעת מחיר — 5 scenarios (3 live)

### 1443901 — הצעת מחיר

- **Status:** 🟢 live · last ran 2026-07-28 · 44 runs / 1 errors sampled
- **Trigger:** Webhook — שליחת הצעת מחיר
- **Systems:** Website / incoming form · Pipedrive · Gmail · Airtable · Prospero · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → sends an email → reads/writes Pipedrive → looks up an Airtable record → handles deal products in Pipedrive → branches on conditions → handles deal products in Pipedrive → looks up an Airtable record → sends an email → branches on conditions → looks up an Airtable record → loops over items → looks up an Airtable record → normalises the Israeli phone number → sends an email → branches on conditions → reads deals from Pipedrive → loops over items → produces a proposal document (Prospero) → branches on conditions → updates the deal in Pipedrive → writes a note on the Pipedrive deal → sends a WhatsApp message → calls another automation / external service → writes a note on the Pipedrive deal → sends a WhatsApp message → writes a note on the Pipedrive deal
- **GOS replaces it?** Partly — Quote module (Offer/Version/QuoteDocument)
- **Still missing in GOS:** Prospero PDF styling + the WhatsApp send of the quote link
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 4453116 — הקמת מוצר חדש בפייפ לאיירטייבל

- **Status:** 🟢 live · last ran 2026-07-22 · 2 runs / 0 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Pipedrive · Airtable
- **Business flow:** handles deal products in Pipedrive → looks up an Airtable record → reads/writes Airtable → looks up an Airtable record → branches on conditions → handles deal products in Pipedrive → looks up an Airtable record → handles deal products in Pipedrive
- **GOS replaces it?** **Yes** — Products/Pricing module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1817282 — לאחר החתימה על ההצעה

- **Status:** 🟢 live · last ran 2026-07-29 · 21 runs / 0 errors sampled
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Prospero · Pipedrive · Gmail
- **Business flow:** produces a proposal document (Prospero) → updates the deal in Pipedrive → writes a note on the Pipedrive deal → reads/writes Pipedrive → sends an email → writes a note on the Pipedrive deal
- **GOS replaces it?** Partly — Quote module — signed-quote handling
- **Still missing in GOS:** Prospero signature webhook has no GOS equivalent
- **Recommendation:** **Keep temporarily** — Live, and GOS covers it only partly.

### 430340 — [טופל] הוצאת הצעת מחיר חוזרת מפייפדרייב לאייקאונט + שליחה ללקוח

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — יצירת הצעת מחיר מפייפדרייב
- **Systems:** Website / incoming form · Pipedrive · iCount · Airtable · Gmail
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → reads/writes Pipedrive → normalises the Israeli phone number → handles deal products in Pipedrive → issues an accounting document (iCount) → calls another automation / external service → reads/writes Pipedrive → updates the deal in Pipedrive → looks up an Airtable record → branches on conditions → sends an email
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

### 1830833 — הוספת הערה בדיל במוצר

- **Status:** 🔴 auto-disabled · last ran 2026-07-31 · 49 runs / 1 errors sampled
- **Trigger:** Webhook — הוספת הערה במוצר
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → handles deal products in Pipedrive
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.

---

## 📁 סליקה — 5 scenarios (3 live)

### 835533 — לינק לסליקה

- **Status:** 🟢 live · last ran 2026-08-02 · 50 runs / 5 errors sampled
- **Trigger:** Webhook — פתיחת לינק דינמי לסליקה
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up the contact in Pipedrive → handles deal products in Pipedrive → branches on conditions → calls another automation / external service → branches on conditions → calls another automation / external service → branches on conditions
- **GOS replaces it?** **Yes** — GOS payment links (Cardcom + iCount)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 3934706 — מוטרג מהתוסף חשבוניות אצל לאנדוליני

- **Status:** 🟢 live · last ran 2026-07-27 · 12 runs / 0 errors sampled
- **Trigger:** Webhook — לאחר הפקה של מסמך חשבונאי בתוסף
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission
- **GOS replaces it?** **Yes** — Native iCount module
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 835854 — תפיסת הסליקה מדף סליקה בפייפ

- **Status:** 🟢 live · last ran 2026-07-30 · 40 runs / 0 errors sampled
- **Trigger:** Webhook — תפיסת סליקה
- **Systems:** Website / incoming form · Pipedrive · Airtable · WhatsApp (Wassenger)
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → branches on conditions → updates the deal in Pipedrive → writes a note on the Pipedrive deal → looks up an Airtable record → updates an Airtable record → updates the deal in Pipedrive → sends a WhatsApp message
- **GOS replaces it?** **Yes** — GOS payment links
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 1711911 — סליקה עצמאית קירות של תקוה

- **Status:** 🟡 active but idle
- **Trigger:** Webhook — סליקה עצמאית קירות של תקוה
- **Systems:** Website / incoming form · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → calls another automation / external service → handles deal products in Pipedrive → reads deals from Pipedrive → looks up an Airtable record → updates the deal in Pipedrive → writes a note on the Pipedrive deal → looks up an Airtable record → creates an Airtable record → updates the deal in Pipedrive
- **GOS replaces it?** Partly — GOS Ingress Platform (website_form) — code shipped, not credentialed
- **Still missing in GOS:** WEBSITE_FORM_SECRET unset; `messege`/`webpage` aliases missing
- **Recommendation:** **Keep temporarily** — Lead-intake dependency — the only path these leads have into GOS today.

### 4677244 — Integration iCount

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** iCount
- **Business flow:** issues an accounting document (iCount)
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 עסקיים לפני המכירה — 4 scenarios (2 live)

### 1564301 — דיל עסקי מאושר לאיירטייבל

- **Status:** 🟢 live · last ran 2026-07-28 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — דיל עסקי הפך ל WON
- **Systems:** Website / incoming form · Pipedrive · Airtable · Gmail
- **Business flow:** receives a form/web submission → branches on conditions → reads deals from Pipedrive → reads/writes Pipedrive → looks up an Airtable record → reads/writes Airtable → calls another automation / external service → branches on conditions → looks up an Airtable record → reads/writes Airtable → reads/writes Pipedrive → updates an Airtable record → sends an email
- **GOS replaces it?** **Yes** — Deals + Tours modules
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 4677340 — חישוב ועדכון צפי תשלום

- **Status:** 🟢 live · last ran 2026-07-26 · 34 runs / 0 errors sampled
- **Trigger:** Scheduled (on-demand)
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → reads/writes Pipedrive → looks up an Airtable record → reads/writes Airtable → looks up an Airtable record → reads/writes Airtable → reads/writes Pipedrive
- **GOS replaces it?** **Yes** — Collection module (גבייה)
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

### 2329750 — עדכון תנאי תשלום מהארגון לדיל

- **Status:** ⚪ inactive
- **Trigger:** Webhook — עדכון תנאי תשלום מהארגון לדיל
- **Systems:** Website / incoming form · Pipedrive
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → reads/writes Pipedrive → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 1723213 — פתיחת טופס הזמנה חדש לאנדוליני

- **Status:** ⚪ inactive
- **Trigger:** Webhook — לינק לטופס הזמנה דינמי
- **Systems:** Website / incoming form · Pipedrive · Airtable
- **Business flow:** receives a form/web submission → reads deals from Pipedrive → looks up an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 טריגרים לאוטומציה — 3 scenarios (0 live)

### 4509531 — טריגר וובהוק

- **Status:** ⚪ inactive
- **Trigger:** Webhook — חיבור וובהוק - גרפיטיול
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4509524 — טריגר לאוטומציה - מיידי פייסבוק

- **Status:** ⚪ inactive
- **Trigger:** Facebook/Instagram lead form
- **Systems:** Facebook Lead Ads
- **Business flow:** receives a Facebook/Instagram lead
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 4509527 — טריגר לאוטומציה  - פייסבוק חיפוש

- **Status:** ⚪ inactive
- **Trigger:** Facebook/Instagram lead form
- **Systems:** Facebook Lead Ads
- **Business flow:** receives a Facebook/Instagram lead
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 היסטוריה — 2 scenarios (0 live)

### 1651844 — עדכון המוצרים בין הפייפ לאיירטייבל

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Airtable
- **Business flow:** handles deal products in Pipedrive → looks up an Airtable record → updates an Airtable record
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

### 892358 — עדכון מוצר היסטורי

- **Status:** ⚪ inactive
- **Trigger:** Scheduled every 15 min
- **Systems:** Pipedrive · Airtable
- **Business flow:** reads deals from Pipedrive → looks up an Airtable record → branches on conditions → creates an Airtable record → looks up an Airtable record → branches on conditions → updates an Airtable record → updates the deal in Pipedrive → handles deal products in Pipedrive → creates an Airtable record → updates an Airtable record → updates the deal in Pipedrive → updates an Airtable record → updates the deal in Pipedrive
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 שעות עבודה — 1 scenarios (1 live)

### 1213773 — Office hours calculator

- **Status:** 🟢 live · last ran 2026-08-01 · 50 runs / 0 errors sampled
- **Trigger:** Webhook — Office hours calculator
- **Systems:** Website / incoming form
- **Business flow:** receives a form/web submission → branches on conditions
- **GOS replaces it?** **Yes** — none needed — internal helper
- **Recommendation:** **Replace inside GOS** — Live, and GOS already covers it completely. Disable after a 48h parity watch.

---

## 📁 כללי — 1 scenarios (0 live)

### 3018034 — טופס השתתפות

- **Status:** 🟡 active but idle
- **Trigger:** Instant (watches a system for changes)
- **Systems:** Cognito Forms · Smoove
- **Business flow:** reads a Cognito form submission → updates the marketing mailing list (Smoove)
- **GOS replaces it?** Not identified
- **Still missing in GOS:** Confirm with the business whether this path should still carry traffic
- **Recommendation:** **Requires my decision** — Active but no runs in the retained window — cannot tell "no traffic" from "silently broken".

---

## 📁 AI — 1 scenarios (0 live)

### 4227190 — AI

- **Status:** ⚪ inactive
- **Trigger:** Instant (watches a system for changes)
- **Systems:** WhatsApp (Wassenger)
- **Business flow:** reads WhatsApp
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 One click — 1 scenarios (0 live)

### 1952599 — one click

- **Status:** ⚪ inactive
- **Trigger:** Webhook — one click_messaging1
- **Systems:** Website / incoming form · Airtable
- **Business flow:** receives a form/web submission → looks up an Airtable record → calls another automation / external service
- **GOS replaces it?** Not identified
- **Recommendation:** **Can shut down now** — Already inactive; no retained run history. Kept only as a record.

---

## 📁 מנגנון בקרה — 1 scenarios (0 live)

### 1052263 — מנגנון בקרה

- **Status:** 🔴 auto-disabled · last ran 2026-08-02 · 33 runs / 3 errors sampled
- **Trigger:** Scheduled (weekly)
- **Systems:** Pipedrive · Airtable · Gmail
- **Business flow:** reads/writes Pipedrive → reads deals from Pipedrive → looks up an Airtable record → branches on conditions → calls another automation / external service → updates an Airtable record → branches on conditions → updates an Airtable record → looks up an Airtable record → branches on conditions → deletes an Airtable record → sends an email
- **GOS replaces it?** Partly — varies
- **Still missing in GOS:** Confirm whether the business still wants this behaviour at all
- **Recommendation:** **Requires my decision** — Auto-disabled by Make during the Pipedrive 429 outage (2026-07-30..08-02), NOT by a decision.
