// THE owner of the guide-message flow's settings.
//
// One flow — Management Tasks → tour summary → "הודעה למדריך" — and one
// question it has to answer: which of our numbers do we write to guides from?
//
// This replaced a per-template sending number. That was the wrong shape: an
// office does not decide "which number sends" per wording, it decides it once
// for how it talks to its guides. The operator can still override it for a
// single message; that override never writes anything here.
//
// NOT related to whatsapp/newLeadTemplate.js, which owns the account the
// automatic reply to a new CUSTOMER lead goes out from. Different flow,
// different audience, different default — neither module reads the other, and
// changing one must never move the other.

import { prisma } from '../db.js';

export const SETTINGS_ID = 'singleton';

// The number guide messages go out from when nothing is configured.
//
// 'office' (שירות לקוחות): writing to a guide about a tour that already
// happened is service, not sales, and it is the number guides already have a
// conversation on. A stable bridge-keyed id, never the Hebrew label — renaming
// the number in admin must not change which number sends.
export const DEFAULT_GUIDE_SEND_ACCOUNT_ID = 'office';

/** The stored row, or null when it has never been written. */
export async function getGuideMessageSettings({ db = prisma } = {}) {
  return db.guideMessageSettings.findUnique({ where: { id: SETTINGS_ID } });
}

/**
 * The account the composer starts on: the configured one, else the documented
 * flow default. Never a coin-flip between two real business numbers.
 */
export async function guideSendAccountId({ db = prisma } = {}) {
  const row = await getGuideMessageSettings({ db }).catch(() => null);
  return (row?.sendAccountId || '').trim() || DEFAULT_GUIDE_SEND_ACCOUNT_ID;
}

export class GuideSettingsError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

/**
 * Set the flow's default sending number.
 *
 * `validAccountIds` comes from the canonical account list — this module does
 * not decide which numbers exist. An unknown id is refused rather than stored:
 * an invisible bad setting surfaces later as a message from the wrong business
 * number, or as none at all.
 */
export async function setGuideSendAccount(accountId, validAccountIds = null, { db = prisma, updatedById = null } = {}) {
  const id = String(accountId ?? '').trim();
  if (!id) throw new GuideSettingsError('account_required');
  if (validAccountIds && !validAccountIds.includes(id)) throw new GuideSettingsError('unknown_account');
  return db.guideMessageSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, sendAccountId: id, updatedById },
    update: { sendAccountId: id, updatedById },
  });
}

/**
 * What the composer needs to preselect a number and to be honest about it:
 *   accountId  the id to start on
 *   source     'configured' | 'flow_default'
 *   available  it still exists in the canonical list (a retired number does not)
 *   connected  its bridge is up right now
 *
 * A configured-but-unavailable number resolves to itself with available:false
 * rather than to a substitute. Silently swapping business numbers is the
 * failure mode this module exists to prevent.
 */
export async function resolveGuideComposerAccount(accounts = [], { db = prisma } = {}) {
  const row = await getGuideMessageSettings({ db }).catch(() => null);
  const configured = (row?.sendAccountId || '').trim();
  const accountId = configured || DEFAULT_GUIDE_SEND_ACCOUNT_ID;
  const match = accounts.find((a) => a.id === accountId) || null;
  return {
    accountId,
    source: configured ? 'configured' : 'flow_default',
    available: !!match,
    connected: !!match?.connected,
  };
}
