# GOS — Make.com Full Scenario Inventory (233)

**Date:** 2026-08-03 · **Read-only.** Companion to `GOS-shutdown-readiness-audit-2026-08-03.md`.

Legend — 🟢 active & ran in last 30d · 🟡 active but no runs in retained history · ⚪ inactive · 🔴 inactive + `isinvalid` (mostly the 2026-07-30 auto-deactivation) · 📣 sends customer/staff communication.
Runs/Err = within the **last 50 executions** Make retains per scenario.
Systems — PD=Pipedrive AT=Airtable Cal=Calendar WA=WhatsApp(Wassenger/WATI) Woo=WooCommerce.


#### 📁 (no folder) — 74 scenarios (27 active, 15 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 4459424 | 🟢 active | daily | HTTP |  | 34/0 | 2026-08-03 | טריגר לסנריו  https://us1.make.com/120547/scenarios/4452993/edit |
| 1978153 | 🟢 active | daily | AT HTTP |  | 34/0 | 2026-08-03 | דחיפה של פתיחת תיקייה בגוגל תמונות |
| 430271 | 🟢 active | scheduled | Woo HTTP |  | 33/0 | 2026-08-02 | מדי לילה בודק נטישות עגלה באתר > מכניס לפייפדרייב |
| 2906484 | 🟢 active | webhook | AT |  | 50/0 | 2026-08-02 | מדריך מאשר רשומת שכר באיירטייבל |
| 430254 | 🟢 active | weekly | AT |  | 5/0 | 2026-08-02 | פעם בשבוע - מחיקת רשומות ישנות של שיחות משוב ממתינות מהאיירטייבל |
| 1830861 | 🟢 active | webhook | PD AT |  | 50/0 | 2026-08-01 | שינויים כמות משתתפים / מידע חשוב על הלקוח / עדכון שם,טלפון,מייל בפרסון |
| 3190154 | 🟢 active | webhook | AT Gmail | 📣 | 2/0 | 2026-08-01 | שכר - צוות הניהול מאשר את הערות של המדריך |
| 4095754 | 🟢 active | webhook | AT Cal |  | 50/0 | 2026-07-31 | עדכון באירוע ביומן |
| 430341 | 🟢 active | webhook | HTTP |  | 50/0 | 2026-07-31 | כפתור ביצוע פעולות מקבל טריגר מפייפדרייב |
| 430326 | 🟢 active | webhook | HTTP |  | 30/0 | 2026-07-30 | שליחת מייל אישור עדכני |
| 2600471 | 🟢 active | webhook | PD AT Gmail WA | 📣 | 17/0 | 2026-07-30 | עדכון שעת סיור מהדיל |
| 430338 | 🟡 active·idle | webhook | PD |  | 0/0 | — | ביטול פולואפ מהמייל > עדכון לפייפדרייב |
| 4698828 | 🟡 active·idle | webhook | AT |  | 0/0 | — | דחייה ללא תאריך |
| 430312 | 🟡 active·idle | webhook | PD Gmail iCount HTTP | 📣 | 0/0 | — | הוצאת חשבונית לתשלום חוזרת מפייפדרייב לאייקאונט + שליחה ללקוח |
| 601178 | 🟡 active·idle | webhook | WA | 📣 | 0/0 | — | התראה לאלינוי על פעולות במייק |
| 445156 | 🟡 active·idle | webhook | PD AT Gmail | 📣 | 0/0 | — | [טופל]שליחת מייל מיידי |
| 430314 | 🟡 active·idle | webhook | PD AT Cal Sheets Drive HTTP |  | 0/0 | — | טופס איחוד אירועים מעדכן יומן ופייפדרייב (אירועים מרובים בטופס אחד) |
| 430339 | 🟡 active·idle | webhook | PD Cal Sheets Drive |  | 0/0 | — | טופס איחוד אירועים מעדכן יומן ופייפדרייב (המשך אם יש אירועים מרובים) |
| 445168 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | כפתור באיירטייבל להוספת ניסוח מייל מיידי |
| 430342 | 🟡 active·idle | webhook | PD Gmail | 📣 | 0/0 | — | לקוח מאשר תאריך חלופי > עדכון לפייפדרייב |
| 3190312 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | מחיקת הודעות וואצאפ מהפייפ ומאיירטייבל |
| 430334 | 🟡 active·idle | webhook | PD |  | 0/0 | — | מילוי טופס פורמס שיחות מכירה מעדכן פייפדרייב |
| 430330 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | מילוי טופס שיחת משוב בפורמס > עדכון לאיירטייבל ולפייפדרייב |
| 430311 | 🟡 active·idle | webhook | PD Sheets Drive |  | 0/0 | — | מענה על שאלון לקראת פעילות מעדכן קובץ שיטס ופייפדרייב |
| 430332 | 🟡 active·idle | webhook | PD |  | 0/0 | — | עדכון מהמייל על ביטול תזכורת תשלום ללקוח |
| 430351 | 🟡 active·idle | webhook | PD AT Gmail Cal | 📣 | 0/0 | — | שינוי תאריך/שעה - שליחה ללקוח לאישור ועדכון ליומן אם כבר יש אירוע |
| 1914956 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | תשובות של טופס עדכון איש כספים ואיש שנוכח בפעילות\ |
| 430297 | 🔴 invalid | daily | PD HTTP |  | 30/2 | 2026-07-30 | מיזוג אנשי קשר פעם ביום |
| 430238 | 🔴 invalid | daily | PD Sheets iCount WA | 📣 | 31/2 | 2026-07-30 | מדי לילה - משיכת נתוני סגירות דו"ח יומי לגיליון נתונים + שליחה בקבוצת וואטסאפ המצב היום |
| 430300 | 🔴 invalid | daily | PD Gmail | 📣 | 30/2 | 2026-07-30 | מייל למשרד עם סיכום פולואפים למחר נשלח מדי ערב |
| 430265 | 🔴 invalid | daily | PD Gmail | 📣 | 30/2 | 2026-07-30 | מייל למשרד עם סיכום תזכורות תשלום למחר נשלח מדי ערב |
| 2084319 | ⚪ inactive | scheduled | Cal |  | 0/0 | — | CHECK EVENT IN GGOGLE CALENDAR |
| 3711041 | ⚪ inactive | scheduled | AT |  | 0/0 | — | Integration Airtable |
| 2066050 | ⚪ inactive | scheduled | PD Link |  | 0/0 | — | Integration Bitly |
| 4498021 | ⚪ inactive | meta-instant | Meta |  | 0/0 | — | Integration Facebook Lead Ads |
| 3136312 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM |
| 3170013 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM |
| 3225208 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM |
| 4452731 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM |
| 4452753 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM |
| 3823009 | ⚪ inactive | scheduled | PD AT |  | 0/0 | — | Integration Pipedrive CRM, Airtable |
| 3086104 | ⚪ inactive | scheduled | PD |  | 0/0 | — | Integration Pipedrive CRM, Tools |
| 3857770 | ⚪ inactive | scheduled | Link |  | 0/0 | — | Integration Short.io |
| 1984383 | ⚪ inactive | scheduled | WA | 📣 | 0/0 | — | Integration Wassenger |
| 2686481 | ⚪ inactive | webhook | — |  | 0/0 | — | Integration Webhooks |
| 1927699 | ⚪ inactive | scheduled | — |  | 0/0 | — | Replace Connections Across Make Account [Airtable] |
| 4631786 | ⚪ inactive | webhook | AT HTTP |  | 0/0 | — | הבאת סיורים להכשרת מדריכים |
| 454247 | ⚪ inactive | scheduled | AT Cal |  | 0/0 | — | חיפוש אירוע ביומן |
| 430327 | ⚪ inactive | webhook | PD AT Cal Sheets Drive |  | 0/0 | — | טופס איחוד אירועים מעדכן יומן ופייפדרייב |
| 430302 | ⚪ inactive | scheduled | PD Link |  | 0/0 | — | יצירת קישורים לסוכנויות ומפיקים |
| 4038842 | ⚪ inactive | webhook | — |  | 0/0 | — | יצירת תיקייה בגוגל פוטוז |
| 430237 | 🔴 invalid | weekly | PD Sheets |  | 0/0 | — | כל יום רביעי - משיכת מידע לקובץ נתוני קמפיינים |
| 430350 | ⚪ inactive | webhook | PD Gmail Woo | 📣 | 0/0 | — | לידים מקמפיין חידה בסמוב > נכנסים לפייפדרייב ומקבלים מייל+קופון |
| 430305 | ⚪ inactive | daily | PD Gmail | 📣 | 0/0 | — | לקוחות עסקיים - מייל למשרד עבור תזכורות לתשלום |
| 430285 | ⚪ inactive | daily | PD Gmail | 📣 | 0/0 | — | לקוחות עסקיים - מייל למשרד עבור תזכורות לתשלום (גיבוי) |
| 430287 | ⚪ inactive | daily | PD AT Gmail iCount HTTP | 📣 | 0/0 | — | לקוחות עסקיים - פולואפים אוטומטיים במייל (גיבוי) |
| 430284 | ⚪ inactive | daily | PD AT Gmail Link HTTP | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ישן) |
| 430269 | ⚪ inactive | daily | PD AT Gmail WA Link | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (שבת - ערב) |
| 430268 | ⚪ inactive | daily | PD AT Gmail iCount WA HTTP | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לתשלום ביום הפעילות עבור הלקוח + המדריך |
| 430276 | ⚪ inactive | daily | PD AT Gmail WA | 📣 | 0/0 | — | לקוחות פרטיים ועסקיים (לא סוכנויות ומפיקים) - מייל+וואטסאפ חודש אחרי פעילות |
| 430318 | ⚪ inactive | webhook | PD AT Gmail Sheets WA | 📣 | 0/0 | — | לקוחות פרטיים ועסקיים - מייל+וואטסאפ יומיים אחרי פעילות לאנשים נוספים שמילאו שאלון |
| 430260 | ⚪ inactive | daily | PD AT Gmail Woo WA HTTP | 📣 | 0/0 | — | לקוחות פרטיים - מייל+וואטסאפ יומיים אחרי פעילות |
| 430280 | ⚪ inactive | scheduled | PD Sheets |  | 0/0 | — | מילוי טופס שיחת משוב בפורמס > עדכון לפייפדרייב רטרואקטיבי |
| 2580984 | ⚪ inactive | daily | PD HTTP | 📣 | 0/0 | — |  סוכנויות ומפיקים - מייל שנה אחרי פעילות |
| 430275 | ⚪ inactive | daily | PD AT |  | 0/0 | — | סיורים אתמול - העתקה לטבלת שיחות משוב באיירטייבל |
| 430304 | ⚪ inactive | daily | PD Gmail Sheets | 📣 | 0/0 | — | סיורים מאתמול - הכנסת נתונים לגיליון נתונים יומיים ושליחה לאלינוי (גיבוי) |
| 430303 | ⚪ inactive | daily | PD Gmail Sheets | 📣 | 0/0 | — | סיורים מאתמול - הכנסת נתונים לקובץ חישוב שכר ושליחה לאלינוי (גיבוי) |
| 430270 | 🔴 invalid | daily | PD AT Gmail Sheets | 📣 | 0/0 | — | סיורים מאתמול - הכנסת נתונים לקובץ נתונים יומיים+שכר ושליחה לאלינוי (איחוד) |
| 2466375 | ⚪ inactive | scheduled | PD |  | 0/0 | — | עדכון דילים בלינק לסלקיה ללקוח - היסטורי |
| 430255 | ⚪ inactive | daily | AT Cal Woo |  | 0/0 | — | רכישה מהאתר - בדיקה מול יומנים מרובים |
| 430313 | ⚪ inactive | webhook | PD AT Gmail Cal Drive Woo iCount WA HTTP | 📣 | 0/0 | — | רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב |
| 612620 | ⚪ inactive | webhook | PD AT Gmail Cal Drive Woo iCount WA HTTP | 📣 | 0/0 | — | רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב (גיבוי 12.1.23) |
| 430281 | ⚪ inactive | scheduled | PD Gmail | 📣 | 0/0 | — | שליחת לינקים אישיים לאנשי קשר תחת סוכנויות |
| 430283 | ⚪ inactive | daily | PD AT HTTP |  | 0/0 | — | תזכורות למדריכים לקראת פעילות (גיבוי) |

#### 📁 ארכיון — 26 scenarios (0 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 430310 | ⚪ inactive | webhook | PD AT Link HTTP |  | 0/0 | — | [1] מילוי טופס פנימי לקוחות עסקיים (או לקוח פרטי שצריך הצעה) > מעדכן פייפדרייב ושולח קריאה לוובהוק |
| 430309 | ⚪ inactive | webhook | PD AT Gmail iCount WA HTTP | 📣 | 0/0 | — | [2] דיל לקוחות עסקיים חדש (או לקוח פרטי שצריך הצעה) > שולח הצעת מחיר במייל+וואטסאפ עם קישור לטופס הזמנה ומעביר סטייג |
| 430319 | ⚪ inactive | webhook | PD AT Gmail Cal Drive iCount WA HTTP | 📣 | 0/0 | — | Closed 5.2.24 - דיל לקוח עסקי הופך לוון > עדכון סטייג' > הוצאת חשבון עסקה ושליחה במייל > עדכון ביומן |
| 619425 | ⚪ inactive | daily | WA | 📣 | 0/0 | — | בדיקת כמות פעולות במייק מדי יום |
| 430236 | ⚪ inactive | daily | PD Gmail | 📣 | 0/0 | — | בדיקת מזהי ארגונים בפייפדרייב |
| 430293 | ⚪ inactive | monthly | PD Gmail Sheets | 📣 | 0/0 | — | בכל 3 לחודש מושך נתוני סיורים מחודש קודם - הכנסת נתונים לגיליון נתונים מסכם |
| 526111 | ⚪ inactive | scheduled | PD |  | 0/0 | — | דו"ח יומי עסקאות והכנסות |
| 430328 | ⚪ inactive | webhook | WA | 📣 | 0/0 | — | טופס פאנזינג שולח הודעת וואטסאפ |
| 430355 | ⚪ inactive | immediately | PD Link |  | 0/0 | — | יצירת קישורים מקוצרים לסוכנויות/חברות הפקה חדשות-כובה על ידי גל ב21.5.25 |
| 430264 | 🔴 invalid | daily | PD AT Sheets Drive |  | 0/0 | — | יצירת שאלון לקראת פעילות לסיורים בשבוע הקרוב - OFF |
| 430336 | ⚪ inactive | webhook | PD AT Gmail | 📣 | 0/0 | — | כפתור שליחת מיילים מיידיים לסוכנים/מפיקים - נסגר ב-26.3.24 |
| 430286 | ⚪ inactive | daily | PD AT Gmail Woo HTTP | 📣 | 0/0 | — | לקוחות עסקיים - יום אחרי פעילות העברה לפייפליין גבייה + מייל סיכום פעילות (גיבוי) |
| 430263 | ⚪ inactive | daily | PD AT Gmail iCount HTTP | 📣 | 0/0 | — | לקוחות עסקיים - פולואפים אוטומטיים במייל OFFFF |
| 430298 | ⚪ inactive | daily | PD AT Gmail Link | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לקראת פעילות (גיבוי) |
| 430257 | ⚪ inactive | daily | PD AT Gmail WA Link | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ימות השבוע - בוקר) |
| 430290 | ⚪ inactive | daily | PD Gmail iCount WA HTTP | 📣 | 0/0 | — | לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (ימות השבוע - בוקר) (wassenger) |
| 430348 | ⚪ inactive | webhook | PD AT WA | 📣 | 0/0 | — | לקוחות פרטיים - שליחת וואטסאפ מיידי OFF |
| 430277 | ⚪ inactive | daily | PD AT Gmail WA Link | 📣 | 0/0 | — | לקוחות פרטיים - תזכורות לקראת פעילות |
| 430278 | ⚪ inactive | daily | PD Gmail | 📣 | 0/0 | — | נסגר לבקשת אלינוי - 1.2.24בדיקת סיורים קרובים - אם לא מופיע שיבוץ מדריך בפייפדרייב |
| 1889735 | ⚪ inactive | webhook | PD |  | 0/0 | — | נסגר לבקשת אלינוי 14.2.24 -אקטיבטי שיבוץ מדריך |
| 430294 | ⚪ inactive | daily | PD AT Gmail | 📣 | 0/0 | — | סוכנויות ומפיקים - מייל שבוע אחרי פעילות עם קישור לטופס הזמנה חוזרת- OFF ON PURPOSE 20/7/25 |
| 430250 | ⚪ inactive | scheduled | PD Sheets |  | 0/0 | — | עדכון מקור בשדה חדש |
| 430259 | ⚪ inactive | daily | PD AT Cal |  | 0/0 | — | עובר כל יום על השיבוצים ביומן ומעדכן לפייפדרייב ולאיירטייבל |
| 430252 | ⚪ inactive | scheduled | PD WA | 📣 | 0/0 | — | שליחת וואטסאפ חד פעמי - מצב בטחוני |
| 430296 | ⚪ inactive | daily | PD AT WA | 📣 | 0/0 | — | תזכורות למדריכים יום אחרי פעילות |
| 430272 | ⚪ inactive | daily | PD AT WA | 📣 | 0/0 | — | תזכורות למדריכים לקראת פעילות |

#### 📁 wassenger — 16 scenarios (8 active, 8 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 3121861 | 🟢 active | webhook | PD AT WA | 📣 | 50/0 | 2026-08-03 | שליחה לאחר עריכה בפייפ |
| 440474 | 🟢 active | daily | PD AT WA Link HTTP | 📣 | 34/0 | 2026-08-03 | לקוחות פרטיים - תזכורות לקראת פעילות (wassenger - check content) |
| 2607384 | 🟢 active | watch(util) | Gmail HTTP | 📣 | 34/0 | 2026-08-03 | בדיקת חיבור ווסנג'ר |
| 3956203 | 🟢 active | daily | AT WA | 📣 | 34/0 | 2026-08-03 | שליחת וואטסאפ ב6 בבוקר על סיורים שלא מולא סיכום סיור |
| 3734669 | 🟢 active | webhook | WA | 📣 | 1/0 | 2026-07-15 | דיל מפאנזינג |
| 439285 | 🟡 active·idle | webhook | WA | 📣 | 0/0 | — | טופס פאנזינג שולח הודעת וואטסאפ (wassenger) |
| 430344 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | כפתור באיירטייבל להוספת ניסוח וואטסאפ מיידי |
| 4046811 | 🟡 active·idle | webhook | AT WA | 📣 | 0/0 | — | שליחת הודעה עם משוב בקבוצת מדריכים  |
| 430295 | 🔴 invalid | daily | PD AT Gmail iCount WA HTTP | 📣 | 32/1 | 2026-08-01 | לקוחות עסקיים - תזכורת לתשלום ביום הפעילות עבור הלקוח + המדריך (wassenger) |
| 430291 | 🔴 invalid | daily | PD Gmail iCount WA HTTP | 📣 | 30/2 | 2026-07-30 | לקוחות עסקיים - תזכורת לקראת פעילות + תזכורות לתשלום (שבת - ערב) (wassenger) |
| 1081615 | 🔴 invalid | scheduled | PD WA | 📣 | 1/1 | 2026-07-15 | ענת בדיקה |
| 3868542 | ⚪ inactive | webhook | — |  | 0/0 | — | (note) נוצר נאוט ידני בדיל -> שליחת ווצאפ למשרד |
| 2923485 | ⚪ inactive | webhook | WA | 📣 | 0/0 | — | טופס השתתפות |
| 4339341 | ⚪ inactive | immediately | PD WA | 📣 | 0/0 | — | עדכון מזהה איש קשר בוואסנגר |
| 3954621 | ⚪ inactive | webhook | WA | 📣 | 0/0 | — | שליחת הודעת וואטסאפ חדשה בקבוצת לוגיסטיקה-כובה בתאריך 25.11.25 לבקשת דור |
| 440488 | ⚪ inactive | daily | PD AT WA | 📣 | 0/0 | — | תזכורות למדריכים לקראת פעילות (wassenger) ענת סגרה 11/05/2025 |

#### 📁 לידים לפייפדרייב — 15 scenarios (13 active, 7 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 3897811 | 🟢 active | webhook | PD |  | 50/48 | 2026-08-03 | Find/Create UTM |
| 1069253 | 🟢 active | webhook | PD Gmail WA HTTP | 📣 | 50/48 | 2026-08-03 | pipe4u |
| 430307 | 🟢 active | webhook | HTTP |  | 42/0 | 2026-08-03 | דף נחיתה אלמנטור > פייפדרייב |
| 430331 | 🟢 active | webhook | HTTP |  | 12/0 | 2026-07-26 | טופס עמוד צור קשר באתר > פייפדרייב + סמוב |
| 430315 | 🟢 active | webhook | HTTP |  | 7/0 | 2026-07-23 | טופס בעמודי מוצר באתר > פייפדרייב |
| 430317 | 🟡 active·idle | webhook | PD Gmail WA | 📣 | 0/0 | — | Leads' Google form > Pipedrive |
| 430343 | 🟡 active·idle | webhook | PD WA | 📣 | 0/0 | — | Smoove subsricbers - food > Create Pipedrive Contact & Deal |
| 430335 | 🟡 active·idle | webhook | PD WA | 📣 | 0/0 | — | Smoove subsricbers - Graffiti > Create Pipedrive Contact & Deal |
| 430320 | 🟡 active·idle | webhook | HTTP |  | 0/0 | — | דף נחיתה פעילות בת מצווה > פייפדרייב + סמוב |
| 430321 | 🟡 active·idle | webhook | HTTP |  | 0/0 | — | טופס פוטר באתר > פייפדרייב + סמוב |
| 1989063 | 🟡 active·idle | webhook | PD |  | 0/0 | — | יצירת לינק לצ'אט בווסנג'ר כפתור בפייפ |
| 430337 | 🟡 active·idle | webhook | PD |  | 0/0 | — | לקוח לחץ במייל על לינק ליצירת קשר > הכנסה לפייפדרייב |
| 430346 | 🟡 active·idle | webhook | HTTP |  | 0/0 | — | פופאפ צור קשר באתר > פייפדרייב |
| 430352 | 🔴 invalid | meta-instant | Gmail Meta HTTP | 📣 | 41/9 | 2026-08-01 | לידים מטופס פייסבוק קמפיין גרפיטי רימרקטינג > פייפדרייב |
| 1989054 | 🔴 invalid | immediately | PD |  | 49/1 | 2026-07-31 | פרסון חדש בפייפ- הוספת לינק לצ'אט בווסנג'ר |

#### 📁 דיל עבר לוון — 13 scenarios (12 active, 10 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1899057 | 🟢 active | webhook | AT |  | 30/0 | 2026-08-02 | עדכון שולם מהפייפ לאיירטייבל |
| 1889926 | 🟢 active | webhook | PD AT iCount HTTP |  | 48/0 | 2026-07-31 | הוצאת חשבונית עסקה לאחר סגירה |
| 889158 | 🟢 active | webhook | PD AT Gmail Cal WA HTTP | 📣 | 50/0 | 2026-07-31 | לאנדוליני לקוח - מילוי טופס הרשמה לסיור u88fvsgtaqhk5qgdh9fpy8oalwc95vty |
| 965408 | 🟢 active | webhook | PD AT Gmail HTTP | 📣 | 48/2 | 2026-07-31 | עדכון בדיל טופס הרשמה לסיור  e3wey951dfxns5fdm2at7yvs11k8tkmp |
| 889252 | 🟢 active | webhook | PD AT Drive |  | 50/0 | 2026-07-31 | פתח תיקיה בגוגל דרייב |
| 1015939 | 🟢 active | webhook | PD AT Gmail WA | 📣 | 50/0 | 2026-07-30 | שליחת וואצאפ חוגגים סגירות אחרי וון |
| 1651940 | 🟢 active | webhook | PD HTTP |  | 50/0 | 2026-07-30 | שליחת מסר לאחר WON p7agxxa1tqont84rumkfu3jgql6tuoix |
| 440477 | 🟢 active | webhook | PD AT Gmail Cal Woo iCount HTTP | 📣 | 27/0 | 2026-07-30 | רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב |
| 4602660 | 🟢 active | on-demand | AT Gmail | 📣 | 37/1 | 2026-07-28 | הוצאת חשבונית עסקה לאחר סגירה 2 |
| 728643 | 🟢 active | webhook | PD AT HTTP |  | 9/0 | 2026-07-28 | טופס עדכון סיור לפייפ 7 ixqlleyrtoxql7matrs1m5ueznq3h5s |
| 430322 | 🟡 active·idle | webhook | PD AT Gmail Drive Docs Woo | 📣 | 0/0 | — | רכישת שובר מתנה > מייצר קופון ושולח במייל + מעדכן פייפדרייב |
| 3648282 | 🟡 active·idle | webhook | AT Woo HTTP |  | 0/0 | — | שליחה חוזרת להזמנות באתר |
| 430740 | ⚪ inactive | webhook | PD AT Gmail WA | 📣 | 0/0 | — | נסגר 28.3 דיל הפך לוון > שליחת נקודת מפגש בוואטסאפ (wassenger) |

#### 📁 עסקיים — 13 scenarios (8 active, 7 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 2725066 | 🟢 active | webhook | PD AT Gmail | 📣 | 33/0 | 2026-07-28 | עדכון תנאי תשלום בדיל שמשוייך לארגון בפייפ עיסקי |
| 4549250 | 🟢 active | webhook | PD Gmail iCount WA HTTP | 📣 | 1/0 | 2026-07-08 | שליחת תוכן 2 ימים לפני תזכורת לתשלום |
| 430324 | 🟡 active·idle | webhook | PD Gmail Drive Docs HTTP | 📣 | 0/0 | — | [טופל]לקוח עסקי ממלא טופס הזמנה > עדכון לדיל בפייפדרייב > שליחת מסמך ללקוח > שליחת נוטיפיקציה למשרד |
| 1443989 | 🟡 active·idle | webhook | AT Gmail | 📣 | 0/0 | — | יוזר חדש בפייפ לטבלת המרה באיירטייבל |
| 430325 | 🟡 active·idle | webhook | PD AT Gmail iCount HTTP | 📣 | 0/0 | — | לקוחות עסקיים - העברת סטייג' > שליחת תזכורת תשלום ללקוח |
| 430345 | 🟡 active·idle | webhook | PD AT Gmail iCount HTTP | 📣 | 0/0 | — | לקוחות עסקיים - לחיצה על לינק במייל > שליחת תזכורת תשלום ללקוח |
| 430308 | 🟡 active·idle | webhook | PD AT Gmail Drive Docs Link | 📣 | 0/0 | — | סוכני תיירות וחברות הפקה ממלאים טופס הזמנה (חוזרת) > יצירת דיל > שליחת מסמך ללקוח > שליחת נוטיפיקציה למשרד |
| 4561651 | 🟡 active·idle | webhook | PD Gmail iCount WA HTTP | 📣 | 0/0 | — | שליחת תוכן 5 ימים לפני תזכורת לתשלום |
| 430267 | 🔴 invalid | daily | PD Gmail iCount HTTP | 📣 | 32/1 | 2026-08-01 | לקוחות עסקיים - הוצאת קבלות פעם ביום - 8:00 |
| 430261 | 🔴 invalid | daily | PD Woo HTTP |  | 30/2 | 2026-07-31 | לקוחות עסקיים - יום אחרי פעילות העברה לפייפליין גבייה + יומיים אחרי מייל סיכום פעילות |
| 430273 | 🔴 invalid | daily | PD Gmail iCount HTTP | 📣 | 30/2 | 2026-07-31 | לקוחות עסקיים - הוצאת קבלות פעם ביום - 16:00 |
| 4549206 | 🔴 invalid | webhook | PD HTTP |  | 9/1 | 2026-07-31 | שליחת תוכן 4 ימים לפני |
| 1989068 | 🔴 invalid | webhook | PD AT |  | 17/2 | 2026-07-30 | סיכום סיור - לקוח עיסקי |

#### 📁 לאנדוליני: אוטומציות חדשות — 12 scenarios (11 active, 9 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 698867 | 🟢 active | webhook | PD |  | 50/0 | 2026-08-03 | בכל דיל חדש הוסף לינקים לטפסים - לאנדוליני |
| 2125961 | 🟢 active | webhook | PD AT Gmail WA Link | 📣 | 50/0 | 2026-08-03 | הרכבת מסר / תוכן |
| 4131439 | 🟢 active | weekly | PD AT HTTP |  | 14/1 | 2026-08-03 | שליחת הודעות מתוזמנות ב8 בבוקר |
| 4131369 | 🟢 active | daily | PD AT Drive |  | 34/0 | 2026-08-03 | פתיחת תיקייה בגוגל דרייב לסיורים כל יום |
| 830264 | 🟢 active | webhook | PD AT |  | 50/5 | 2026-07-31 | מדיל לטופס פילאאוט pre fill |
| 1411537 | 🟢 active | webhook | PD |  | 50/0 | 2026-07-30 | סגירת משימות אוטומטיות אחרי וון |
| 1445570 | 🟢 active | immediately | AT Fillout |  | 13/10 | 2026-07-26 | טופס משוב - ניסיונות לשיחות |
| 964304 | 🟢 active | immediately | PD AT Gmail | 📣 | 2/0 | 2026-07-22 | הקמת מוצר חדש מעדכן מזהה בפייפ |
| 430347 | 🟡 active·idle | webhook | PD AT Gmail | 📣 | 0/0 | — | הוספת מוצר בווקומרס מוסיפה אותו בפייפדרייב ובאיירטייבל |
| 1449188 | 🟡 active·idle | webhook | AT Gmail WA HTTP | 📣 | 0/0 | — | המשך טיפול לאחר שיחת משוב |
| 704964 | 🟡 active·idle | webhook | PD AT |  | 0/0 | — | מטופס הוספת מדריך/מועמד חדש לאיירטייבל ולפייפ - לאנדוליני |
| 799554 | 🔴 invalid | daily | PD |  | 30/2 | 2026-07-30 | דיל פתוח ללא משימה מקבל משימה בחצות |

#### 📁 מדריכים — 11 scenarios (10 active, 10 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 4452993 | 🟢 active | webhook | AT WA | 📣 | 34/0 | 2026-08-03 | שליחת לו"ז הודעה של כל הסיורים של מחר |
| 2693681 | 🟢 active | webhook | AT |  | 50/0 | 2026-08-02 | מחשבון שכר |
| 4749928 | 🟢 active | webhook | AT WA | 📣 | 50/0 | 2026-08-02 | הודעה חדשה על כל מדריך שמילא טופס תיאום סיור |
| 1126045 | 🟢 active | webhook | PD AT Drive WA HTTP | 📣 | 50/0 | 2026-08-01 | שליחת תכנים ללקוח לאחר מילוי טופס סיכום סיור+מחיקת הודעות מתוזמנות |
| 1051602 | 🟢 active | webhook | AT WA | 📣 | 50/0 | 2026-07-31 | שליחת הודעה למדריך טופס סיום הסיור- סיכומי סיור |
| 2844878 | 🟢 active | monthly | AT HTTP |  | 4/0 | 2026-07-31 | תזמון חודשי למחשבון שכר |
| 1126290 | 🟢 active | webhook | AT WA | 📣 | 50/0 | 2026-07-31 | רדיפה למדריך למלא טופס תיאום סיור |
| 2883326 | 🟢 active | webhook | AT |  | 26/0 | 2026-07-30 | עדכון חודש ושנה בשכר |
| 430349 | 🟢 active | webhook | PD AT Gmail Cal | 📣 | 4/0 | 2026-07-29 | כפתור באיירטייבל להקמת מדריך.ה חדש.ה |
| 4207107 | 🟢 active | webhook | PD AT Gmail | 📣 | 1/0 | 2026-07-08 | הכנסת הערות עבור השכר מהפייפ |
| 972724 | ⚪ inactive | scheduled | PD AT |  | 0/0 | — | עדכון מדריכים היסטורי |

#### 📁 לוסטים ודחייה — 8 scenarios (5 active, 5 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 2034772 | 🟢 active | webhook | PD WA Smoove | 📣 | 50/0 | 2026-07-30 | דיל הפך ללוסט-שליחה לסמוב |
| 440482 | 🟢 active | webhook | PD WA | 📣 | 7/0 | 2026-07-29 | עסקאות שהפכו ללוסט > עדכון לוואטסאפ (wassenger) |
| 1160762 | 🟢 active | webhook | PD AT Gmail Cal | 📣 | 12/0 | 2026-07-29 | ביטול עסקה - לוסט |
| 456768 | 🟡 active·idle | webhook | PD WA | 📣 | 0/0 | — | דיל בפייפ הפך ללוסט- יקר מידי > וואטסאפ |
| 1586537 | 🟡 active·idle | webhook | PD AT WA | 📣 | 0/0 | — | עדכון הלינק לרדיפה למילוי תאריך סיור |
| 1070979 | 🔴 invalid | daily | PD |  | 30/2 | 2026-07-30 | לוסט לדיל לאחר 30 יום |
| 1353334 | 🔴 invalid | daily | PD |  | 30/2 | 2026-07-30 | לוסט לדיל עיסקי לאחר 60 יום |
| 430323 | ⚪ inactive | webhook | PD WA | 📣 | 0/0 | — | עסקאות שהפכו ללוסט > עדכון לוואטסאפ |

#### 📁 להדליק אחרי המלחמה.... — 6 scenarios (0 active, 4 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 430262 | 🔴 invalid | daily | PD WA | 📣 | 30/2 | 2026-07-31 | לקוחות פרטיים - פולואפ 1 (אישי) בוואטסאפ - 16:00 |
| 430292 | 🔴 invalid | daily | PD HTTP | 📣 | 31/1 | 2026-07-31 | לקוחות פרטיים ועסקיים (לא סוכנויות ומפיקים) - מייל+וואטסאפ חודש אחרי פעילות (wassenger) |
| 430266 | 🔴 invalid | daily | PD WA | 📣 | 31/1 | 2026-07-31 | לקוחות פרטיים - פולואפ 2 (גנרי) בוואטסאפ |
| 430274 | 🔴 invalid | daily | PD WA | 📣 | 31/1 | 2026-07-31 | לקוחות פרטיים - פולואפ 1 (אישי) בוואטסאפ - 10:00 |
| 440466 | ⚪ inactive | webhook | PD AT Gmail Sheets WA | 📣 | 0/0 | — | לקוחות פרטיים ועסקיים - מייל+וואטסאפ יומיים אחרי פעילות לאנשים נוספים שמילאו שאלון (wassenger) |
| 440472 | ⚪ inactive | daily | PD Woo HTTP | 📣 | 0/0 | — | לקוחות פרטיים - מייל+וואטסאפ יומיים אחרי פעילות (wassenger) |

#### 📁 הכנסת תוכן וואצאפ לדיל — 5 scenarios (5 active, 5 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 4345044 | 🟢 active | scheduled | PD AT Gmail | 📣 | 50/0 | 2026-08-03 | הכנסת התכתבות וואצאפ לדיל |
| 4357153 | 🟢 active | daily | AT |  | 33/0 | 2026-08-02 | מחיקת הדטא הודעות וואצאפ |
| 4548217 | 🟢 active | webhook | AT |  | 50/0 | 2026-08-01 | מחיקת דטא לאחר שבוע שלא הוקם איש קשר בפייפ |
| 4359629 | 🟢 active | webhook | PD AT HTTP |  | 50/1 | 2026-07-28 | הקמת איש קשר בפייפ |
| 4447721 | 🟢 active | webhook | PD AT Gmail | 📣 | 50/0 | 2026-07-26 | בדיקה אם איש קשר קיים בפייפ ושליחה לאיירטייבל |

#### 📁 חשיפה — 5 scenarios (4 active, 1 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 3252574 | 🟢 active | webhook | AT Cognito |  | 11/0 | 2026-07-29 | ביטול סיור חשיפה בקוגניטו |
| 3162997 | 🟡 active·idle | webhook | PD AT Cognito HTTP |  | 0/0 | — | העברת לתשלום מהרשמה לסיור חשיפה |
| 3106389 | 🟡 active·idle | watch(cognitoforms) | AT Gmail WA Cognito Link | 📣 | 0/0 | — | הקמת סיורי חשיפה |
| 3314785 | 🟡 active·idle | webhook | PD |  | 0/0 | — | וון על דיל שמקושר לדילים נוספים |
| 4069207 | ⚪ inactive | webhook | AT Cognito |  | 0/0 | — | סטטוס משתתפים בסיור חשיפה - מלאי |

#### 📁 סוכנים ומפיקים — 5 scenarios (4 active, 5 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 430353 | 🟢 active | immediately | PD Link |  | 50/0 | 2026-08-03 | הוספת טלפון בפורמט 05/972... לכל איש קשר שנכנס + יצירת קישורים מקוצרים לאנשים תחת סוכנות/הפקה |
| 1993303 | 🟢 active | webhook | PD Cognito |  | 50/5 | 2026-08-01 | פתיחת לינק להזמנת סוכנים חדש |
| 1993342 | 🟢 active | watch(cognitoforms) | PD AT Gmail Cognito | 📣 | 14/0 | 2026-07-27 | הזמנות מסוכנים לפייפ |
| 430333 | 🟢 active | webhook | PD Link |  | 5/0 | 2026-07-26 | יצירת קישורים לאנשים שמקושרים לסוכנויות ומפיקים - מיידי [ps31cvs7um4nq4zuo72ecd0o18no5ly9@hook.us1.make.com] |
| 430258 | 🔴 invalid | daily | PD Link |  | 32/1 | 2026-08-01 | יצירת קישורים לאנשים שמקושרים לסוכנויות ומפיקים - פעם ביום |

#### 📁 הצעת מחיר — 5 scenarios (4 active, 4 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1817282 | 🟢 active | immediately | PD Gmail Prospero | 📣 | 21/0 | 2026-07-29 | לאחר החתימה על ההצעה |
| 1443901 | 🟢 active | webhook | PD AT Gmail WA Prospero HTTP | 📣 | 44/1 | 2026-07-28 | הצעת מחיר |
| 4453116 | 🟢 active | immediately | PD AT |  | 2/0 | 2026-07-22 | הקמת מוצר חדש בפייפ לאיירטייבל |
| 430340 | 🟡 active·idle | webhook | PD AT Gmail iCount HTTP | 📣 | 0/0 | — | [טופל] הוצאת הצעת מחיר חוזרת מפייפדרייב לאייקאונט + שליחה ללקוח |
| 1830833 | 🔴 invalid | webhook | PD |  | 49/1 | 2026-07-31 | הוספת הערה בדיל במוצר |

#### 📁 סליקה — 5 scenarios (4 active, 3 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 835533 | 🟢 active | webhook | PD HTTP |  | 50/5 | 2026-08-02 | לינק לסליקה |
| 835854 | 🟢 active | webhook | PD AT WA | 📣 | 40/0 | 2026-07-30 | תפיסת הסליקה מדף סליקה בפייפ |
| 3934706 | 🟢 active | webhook | — |  | 12/0 | 2026-07-27 | מוטרג מהתוסף חשבוניות אצל לאנדוליני |
| 1711911 | 🟡 active·idle | webhook | PD AT HTTP |  | 0/0 | — | סליקה עצמאית קירות של תקוה |
| 4677244 | ⚪ inactive | scheduled | iCount |  | 0/0 | — | Integration iCount |

#### 📁 עסקיים לפני המכירה — 4 scenarios (2 active, 2 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1564301 | 🟢 active | webhook | PD AT Gmail HTTP | 📣 | 50/0 | 2026-07-28 | דיל עסקי מאושר לאיירטייבל |
| 4677340 | 🟢 active | on-demand | PD AT |  | 34/0 | 2026-07-26 | חישוב ועדכון צפי תשלום |
| 2329750 | ⚪ inactive | webhook | PD |  | 0/0 | — | עדכון תנאי תשלום מהארגון לדיל |
| 1723213 | ⚪ inactive | webhook | PD AT |  | 0/0 | — | פתיחת טופס הזמנה חדש לאנדוליני |

#### 📁 טריגרים לאוטומציה — 3 scenarios (0 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 4509531 | ⚪ inactive | webhook | — |  | 0/0 | — | טריגר וובהוק |
| 4509524 | ⚪ inactive | meta-instant | Meta |  | 0/0 | — | טריגר לאוטומציה - מיידי פייסבוק |
| 4509527 | ⚪ inactive | meta-instant | Meta |  | 0/0 | — | טריגר לאוטומציה  - פייסבוק חיפוש |

#### 📁 היסטוריה — 2 scenarios (0 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1651844 | ⚪ inactive | scheduled | PD AT |  | 0/0 | — | עדכון המוצרים בין הפייפ לאיירטייבל |
| 892358 | ⚪ inactive | scheduled | PD AT |  | 0/0 | — | עדכון מוצר היסטורי |

#### 📁 שעות עבודה — 1 scenarios (1 active, 1 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1213773 | 🟢 active | webhook | — |  | 50/0 | 2026-08-01 | Office hours calculator |

#### 📁 כללי — 1 scenarios (1 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 3018034 | 🟡 active·idle | watch(cognitoforms) | Smoove Cognito | 📣 | 0/0 | — | טופס השתתפות |

#### 📁 AI — 1 scenarios (0 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 4227190 | ⚪ inactive | watch(app#wassenger-0waevn) | WA | 📣 | 0/0 | — | AI |

#### 📁 One click — 1 scenarios (0 active, 0 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1952599 | ⚪ inactive | webhook | AT HTTP |  | 0/0 | — | one click |

#### 📁 מנגנון בקרה — 1 scenarios (0 active, 1 ran in last 30d)

| ID | Status | Trigger | Systems | Comms? | Runs/Err | Last run | Scenario |
|---|---|---|---|---|---|---|---|
| 1052263 | 🔴 invalid | weekly | PD AT Gmail HTTP | 📣 | 33/3 | 2026-08-02 | מנגנון בקרה |
