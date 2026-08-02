// APPLY the future-tour deposit audit (2026-08-02) — classification ONLY.
//
// Writes Deal.paymentReview* (the reviewed deposit-vs-full classification) for
// the 22 deals of the 72-deal future-WON population where money has already
// been collected, plus the one no-amount deal. The 49 deals with nothing
// collected yet stay unclassified — the deposit question is about money
// already received, and they are already in the active collection queue.
//
// What this script NEVER does:
//   • never touches valueMinor / Builder / documents / evidence / notes —
//     amounts stay exactly what computeCollection derives from real evidence;
//   • never overwrites paymentReviewSource='operator';
//   • never re-raises a collectionReview flag an operator cleared.
//
// For the two deals whose computed "paid" is contradicted by their own notes
// (#26153 explicit "מקדמה 300, הסכום המלא 2150"; #26039 open "לגבות יתרת
// תשלום" task) it ALSO sets the collectionReview flag (code
// 'deposit_only_suspected') so the resolver honestly reports 'review' instead
// of a false 'paid', and the Deal panel offers the two-verdict resolution.
//
// Finally it re-runs the canonical work-queue classifier so the queue reflects
// the new classifications immediately (the same code that runs on every boot).
//
// Run (from server/):  DB_URL=<postgres url> node scripts/apply-future-deposit-review.mjs [--dry-run]

import { PrismaClient } from '@prisma/client';
import { classifyCollectionWorkQueue } from '../src/maintenance/classifyCollectionWorkQueue.js';

const dbUrl = process.env.DB_URL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('No DB_URL provided.');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const SOURCE = 'audit:future_deposit_2026_08';

// orderNo → classification. Evidence is a POINTER to existing history (note
// excerpts as imported from Pipedrive, iCount document numbers) — the history
// itself is untouched.
const FULL = (docnum, amountILS, note) => ({
  status: 'confirmed_full',
  evidence: {
    audit: SOURCE,
    basis: `חשבונית-קבלה ${docnum} על ₪${amountILS} — זהה לסכום העסקה המוסכם`,
    documents: [{ doctype: 'invrec', docnum, amountILS }],
    ...(note ? { excerpts: [note] } : {}),
  },
});

const CLASSIFICATIONS = {
  26310: FULL('38437', 1600),
  26373: FULL('38486', 1770),
  26606: FULL('38493', 500),
  26592: FULL('38488', 700),
  25377: FULL('38016', 900),
  26316: FULL('38425', 300),
  26597: FULL('38498', 450),
  26293: FULL('38420', 500),
  26303: FULL('38422', 450),
  26369: FULL('38490', 450),
  26387: FULL('38484', 1500),
  26258: FULL('38392', 2150),
  26569: FULL('38478', 500),
  26352: FULL('38457', 1900),
  26288: FULL('38416', 450),
  25704: FULL('38132', 3200, 'הערת Pipedrive: "בחרה תשלום מלא עם אפשרות ביטול! במקור - הצעתי לה הכל מראש או 500 ללא ביטול"'),
  26231: FULL('38456', 2600, 'הערת Pipedrive: "היא נוטה לשלם הכל ולא מקדמה של 400 ש\'ח" — קבלה על מלוא הסכום'),

  // ── Deposit only — confirmed by the deal's own notes/documents ────────────
  26153: {
    status: 'confirmed_deposit',
    evidence: {
      audit: SOURCE,
      basis: 'העסקה נקראת "שולם" רק כי סכום העסקה נרשם כגובה המקדמה',
      excerpts: ['הערת Pipedrive: "שילם מקדמה 300 ש\'ח שלא מוחזרת במקרה של ביטול. הסכום המלא 2150 ש\'ח - 10 אנשים בשבת."'],
      documents: [{ doctype: 'invrec', docnum: '38343', amountILS: 300 }],
      // Deterministic from the note (2150 − 300). Recorded as a PROPOSAL for
      // the operator — the agreed amount itself is corrected through the
      // Builder, not by this script (participant-count dependent).
      proposedOutstandingMinor: 185000,
      proposedAgreedTotalMinor: 215000,
    },
    reviewFlag: {
      code: 'deposit_only_suspected',
      reason:
        'שולמה מקדמה של ₪300 בלבד; לפי הערות העסקה המחיר המלא שסוכם הוא ₪2,150 (ל־10 משתתפים). סכום העסקה הרשום (₪300) הוא גובה המקדמה, ולכן "שולם במלואו" שגוי.',
    },
  },
  25865: {
    status: 'confirmed_deposit',
    evidence: {
      audit: SOURCE,
      basis: 'מקדמה ₪300 מתוך מחיר מלא לפי 2000+120 למשתתף — כבר מוצג "שולם חלקית" ונמצא בגבייה פעילה',
      excerpts: ['הערת Pipedrive: "שילמה מקדמה 300 ש\'ח שלא מוחזרים במקרה של ביטול! שאר התשלום לפי 2000+120"', 'משימת Pipedrive פתוחה: "לגבות את יתרת התשלום"'],
      documents: [{ doctype: 'invrec', docnum: '38212', amountILS: 300 }],
    },
  },
  25314: {
    status: 'confirmed_deposit',
    evidence: {
      audit: SOURCE,
      basis: 'מקדמה ₪500 מתוך ₪1,650 — כבר מוצג "שולם חלקית" ונמצא בגבייה פעילה',
      excerpts: ['הערת Pipedrive: "שילם מקדמה 500 שח בהעברה בנקאית מתוך מחיר: 1,650 ש\'ח לקבוצה של עד 10 משתתפים"', 'משימת Pipedrive פתוחה: "אלינוי - לגבות את היתרה"'],
      documents: [{ doctype: 'invrec', docnum: '38008', amountILS: 500 }],
    },
  },
  26285: {
    status: 'confirmed_deposit',
    evidence: {
      audit: SOURCE,
      basis: 'קבלה על ₪300 מתוך סכום עסקה ₪2,000 — כבר מוצג "שולם חלקית" ונמצא בגבייה פעילה',
      documents: [{ doctype: 'invrec', docnum: '38428', amountILS: 300 }],
    },
  },

  // ── Suspected — evidence contradicts the computed "paid" ─────────────────
  26039: {
    status: 'suspected_deposit',
    evidence: {
      audit: SOURCE,
      basis: 'קבלה על מלוא סכום העסקה (₪3,200) אך קיימת משימת גבייה פתוחה מ-Pipedrive והתכתבות על השלמת יתרה לפי מספר משתתפים סופי',
      excerpts: [
        'התכתבות: "אשלח לך כרגע על 10, ותעדכני בהמשך ונשלים את היתרה"',
        'משימת Pipedrive פתוחה: "גבייה · לגבות יתרת תשלום"',
      ],
      documents: [{ doctype: 'invrec', docnum: '38314', amountILS: 3200 }],
    },
    reviewFlag: {
      code: 'deposit_only_suspected',
      reason:
        'קיימת קבלה על מלוא סכום העסקה (₪3,200 עבור 10 משתתפים), אך משימת גבייה פתוחה מ-Pipedrive ("לגבות יתרת תשלום") והתכתבות על השלמת יתרה מרמזות שייתכן סכום נוסף לפי מספר המשתתפים הסופי.',
    },
  },

  // ── Unresolved ────────────────────────────────────────────────────────────
  24412: {
    status: 'unresolved',
    evidence: {
      audit: SOURCE,
      basis: 'סכום עסקה ₪0 וללא מסמכי תשלום — אין ראיות להכרעה; העסקה כבר בגבייה פעילה (חסר סכום)',
    },
  },
};

async function main() {
  const orderNos = Object.keys(CLASSIFICATIONS).map(Number);
  const deals = await prisma.deal.findMany({
    where: { orderNo: { in: orderNos } },
    select: {
      id: true, orderNo: true, title: true,
      paymentReviewStatus: true, paymentReviewSource: true,
      collectionReview: true,
    },
  });
  if (deals.length !== orderNos.length) {
    const found = new Set(deals.map((d) => d.orderNo));
    throw new Error(`resolved ${deals.length}/${orderNos.length}; missing: ${orderNos.filter((n) => !found.has(n)).join(',')}`);
  }

  const now = new Date();
  let written = 0, skippedOperator = 0, unchanged = 0, flagged = 0, flagSkipped = 0;

  for (const deal of deals) {
    const c = CLASSIFICATIONS[deal.orderNo];

    if (deal.paymentReviewSource === 'operator') {
      console.log(`#${deal.orderNo} — operator decision present, NOT touched`);
      skippedOperator += 1;
    } else if (deal.paymentReviewStatus === c.status) {
      unchanged += 1;
    } else {
      console.log(`#${deal.orderNo} — paymentReviewStatus ${deal.paymentReviewStatus || '∅'} → ${c.status}`);
      if (!dryRun) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: {
            paymentReviewStatus: c.status,
            paymentReviewSource: SOURCE,
            paymentReviewEvidence: c.evidence,
            paymentReviewAt: now,
            paymentReviewBy: null,
          },
        });
      }
      written += 1;
    }

    // The review flag — only when none exists AND none was ever cleared by an
    // operator (a cleared flag means a human already answered; stay silent).
    if (c.reviewFlag) {
      if (deal.collectionReview) {
        console.log(`#${deal.orderNo} — collectionReview already present (${deal.collectionReview.code || 'set'}${deal.collectionReview.clearedAt ? ', cleared by operator' : ''}), NOT touched`);
        flagSkipped += 1;
      } else {
        console.log(`#${deal.orderNo} — raising collectionReview flag '${c.reviewFlag.code}'`);
        if (!dryRun) {
          await prisma.deal.update({
            where: { id: deal.id },
            data: {
              collectionReview: {
                code: c.reviewFlag.code,
                reason: c.reviewFlag.reason,
                flaggedAt: now.toISOString(),
                flaggedBy: SOURCE,
              },
            },
          });
        }
        flagged += 1;
      }
    }
  }

  console.log(
    `[apply] ${written} classifications written, ${unchanged} unchanged, ${skippedOperator} operator-preserved, ` +
      `${flagged} review flags raised, ${flagSkipped} flags left untouched${dryRun ? ' — DRY RUN' : ''}`,
  );

  if (!dryRun) {
    // Reflect the new classifications in the work queue NOW, via the exact
    // code that runs on every boot — never a second implementation.
    await classifyCollectionWorkQueue(prisma, { log: console });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
