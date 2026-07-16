// Graph-consequence engine for owner decisions on legacy DEALS. PURE — no I/O.
//
// ── THE PRINCIPLE (owner, 2026-07-16) ─────────────────────────────────────────
// The Migration Review Center is the owner's FINAL AUTHORITY over what enters
// GOS. A legacy foreign key must never block a legitimate owner decision; the
// system's job is to compute EXACTLY what else is removed or disconnected by the
// decision, present it, and — once approved — execute the graph change safely.
// Blocking is reserved for GOS-side impossibilities only.
//
// This is the module every entity-level review consumes: deleting a deal changes
// what its contacts' deletion boundaries see (a dead WON deal no longer protects
// its junk contact), what an organisation still references, and what the deal
// importer must skip. Nothing here touches Snapshot #1.

const t = (s) => String(s ?? '').trim();

// What approving "delete this deal as historical junk" would do to the graph.
//
//   deal          — { id, title, status, value, wonTime, personId, orgId, orgName,
//                     activityCount, noteCount, fileCount }
//   linkedPersons — every person on the deal (primary + participants):
//                   [{ legacyId, name, relationship: 'primary'|'participant',
//                      otherDeals: {open,won,lost}   // EXCLUDING this deal and
//                                                    // any already-dead deal
//                      otherHistory: number,          // activities+notes+files+other participant links
//                      imported: 'contact'|'organization'|'excluded'|'deleted'|'not_imported' }]
//   orgOtherDeals — how many OTHER live deals reference deal.orgId (null if no org)
export function computeDealDeletionImpact({ deal, linkedPersons = [], orgOtherDeals = null }) {
  const consequences = [];
  const contacts = linkedPersons.map((p) => {
    const remaining = p.otherDeals || { open: 0, won: 0, lost: 0 };
    const losesOnlyDeal = remaining.open + remaining.won + remaining.lost === 0;
    const losesWonProtection = remaining.open + remaining.won === 0;
    const becomesShell = losesOnlyDeal && (p.otherHistory || 0) === 0;
    // Deletable = the contact's own deletion boundary would pass once this deal is
    // dead: no remaining WON/OPEN links anywhere.
    const becomesDeletable = losesWonProtection && !['contact', 'organization'].includes(p.imported);
    return {
      legacyId: p.legacyId, name: p.name, relationship: p.relationship,
      remainingDeals: remaining, becomesShell, becomesDeletable,
      imported: p.imported,
    };
  });

  for (const c of contacts) {
    if (c.imported === 'contact') {
      consequences.push(`"${c.name}" כבר יובא כאיש קשר ל-GOS — מחיקת העסקה לא מוחקת אותו`);
    } else if (c.becomesDeletable) {
      consequences.push(`"${c.name}" מאבד את קשר ה-${c.relationship === 'primary' ? 'איש קשר הראשי' : 'משתתף'} היחיד שהגן עליו — ניתן יהיה למחוק אותו`);
    } else {
      consequences.push(`"${c.name}" נשאר מוגן על ידי עסקאות אחרות (${c.remainingDeals.won} WON · ${c.remainingDeals.open} פתוחות)`);
    }
  }
  if (deal.orgId != null) {
    consequences.push(
      orgOtherDeals === 0
        ? `הארגון "${deal.orgName || deal.orgId}" לא יפנה אליו יותר אף עסקה חיה`
        : `הארגון "${deal.orgName || deal.orgId}" נשאר עם ${orgOtherDeals} עסקאות אחרות`,
    );
  }
  const ops = (deal.activityCount || 0) + (deal.noteCount || 0) + (deal.fileCount || 0);
  consequences.push(ops === 0 ? 'לא נמחק שום מידע תפעולי — אין פעילויות, הערות או קבצים על העסקה' : `${deal.activityCount || 0} פעילויות, ${deal.noteCount || 0} הערות ו-${deal.fileCount || 0} קבצים של העסקה לא ייובאו`);
  consequences.push('אף עסקה מיובאת אחרת אינה מושפעת'); // a deal deletion is graph-local by construction

  return {
    deal: {
      id: deal.id, title: t(deal.title), status: deal.status, value: deal.value ?? 0,
      wonTime: deal.wonTime || null, orgId: deal.orgId ?? null, orgName: deal.orgName || null,
    },
    contacts,
    organization: deal.orgId != null ? { legacyId: deal.orgId, name: deal.orgName || null, otherDeals: orgOtherDeals } : null,
    operationalData: { activities: deal.activityCount || 0, notes: deal.noteCount || 0, files: deal.fileCount || 0 },
    consequences,
    // NOTHING blocks. The report is the safety mechanism; approval is the owner's.
    blocking: [],
  };
}

export const dealSubjectKey = (dealId) => `deal:${dealId}`;
export const dealIdFromSubjectKey = (key) => {
  const m = /^deal:(\d+)$/.exec(String(key || ''));
  return m ? Number(m[1]) : null;
};
