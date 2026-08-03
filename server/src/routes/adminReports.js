// Admin Reports API ("דיווחי מנהלים") — the catalog of CODE-MANAGED internal
// notifications. Mounted at /api/admin-reports behind requireAdminAuth.
//
// The catalog itself is code (adminReports/registry.js) and is NOT editable
// here — only the destination and enabled flag are. Every preview and test
// send goes through the SAME renderer production uses; there is no second
// rendering path.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { parseListQuery } from './listPagination.js';
import { callBridge } from '../whatsapp/bridgeClient.js';
import { loadTriggerContext } from '../communication/context.js';
import { REPORTS, reportByNumber, renderReport, renderReportSample, renderReportBoth, hasEnglish, reportChannel, reportGroup } from '../adminReports/registry.js';
import { audienceKindFromReport } from '../communication/sendingPolicy.js';
import { destinationLabel } from '../adminReports/dispatch.js';

const router = Router();
const str = (v) => (v == null ? null : String(v).trim() || null);

// ── catalog ──────────────────────────────────────────────────────────────────

router.get('/', handle(async (req, res) => {
  // `group` scopes the catalog to one surface: 'office' = the Manager Reports
  // screen, 'coordination' = Tour Settings → שיחת תיאום → התראות,
  // 'tour_summary' = Tour Settings → סיכום סיור → התראות. One catalog, one
  // renderer, several windows onto it.
  const group = str(req.query.group);
  const [configs, chats] = await Promise.all([
    prisma.adminReportConfig.findMany(),
    prisma.whatsAppChat.findMany({
      where: { type: 'group', providerDeletedAt: null },
      select: { id: true, groupSubject: true, accountId: true },
    }),
  ]);
  const configByNumber = new Map(configs.map((c) => [c.reportNumber, c]));
  const chatById = new Map(chats.map((c) => [c.id, c]));

  // Per-report delivery stats — one grouped query, never N+1.
  const [counts, lastSent, lastFailed] = await Promise.all([
    prisma.adminReportDelivery.groupBy({ by: ['reportNumber'], _count: { _all: true } }),
    prisma.adminReportDelivery.findMany({
      where: { status: 'sent' }, orderBy: { sentAt: 'desc' }, distinct: ['reportNumber'],
      select: { reportNumber: true, sentAt: true, destinationLabel: true },
    }),
    prisma.adminReportDelivery.findMany({
      where: { status: { in: ['failed', 'failed_final'] } }, orderBy: { updatedAt: 'desc' }, distinct: ['reportNumber'],
      select: { reportNumber: true, updatedAt: true, lastError: true },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.reportNumber, c._count._all]));

  // The effective audience×channel policy per cell — ONE query, so every card
  // can say what actually governs its timing without opening the queue screen.
  const policies = await prisma.sendingWindowPolicy.findMany({
    include: { window: { select: { name: true } } },
  });
  const policyBy = new Map(policies.map((p) => [p.audienceKind + ':' + p.channel, p]));
  const sentBy = new Map(lastSent.map((d) => [d.reportNumber, d]));
  const failedBy = new Map(lastFailed.map((d) => [d.reportNumber, d]));

  const catalog = group ? REPORTS.filter((r) => reportGroup(r) === group) : REPORTS;
  res.json({
    codeManaged: true,
    reports: catalog.map((r) => {
      const config = configByNumber.get(r.number) || null;
      const chat = config?.waChatId ? chatById.get(config.waChatId) : null;
      return {
        number: r.number,
        key: r.key,
        nameHe: r.nameHe,
        group: reportGroup(r),
        // 'guides' / 'customer' → the destination is that ONE person's WhatsApp,
        // resolved per event; the UI hides the group picker and shows the sending
        // account only. 'config' → the configured group chat.
        audience: r.audience || 'config',
        triggerHe: r.triggerHe,
        dataHe: r.dataHe,
        enabled: config ? config.enabled : false,
        // A per-person report needs only a sending ACCOUNT — there is no group
        // to pick, because the recipient comes from the business event.
        configured: (r.audience === 'guides' || r.audience === 'customer')
          ? !!config?.waAccountId
          : !!(config?.waAccountId && config?.waChatId),
        waAccountId: config?.waAccountId || null,
        waChatId: config?.waChatId || null,
        destinationName: chat?.groupSubject || null,
        // Both languages from the SAME renderers production uses — the screen
        // never re-implements a preview.
        preview: renderReportSample(r.number),
        previewBoth: renderReportBoth(r.number),
        hasEnglish: hasEnglish(r),
        channel: reportChannel(r),
        sendInGuideLanguage: !!config?.sendInGuideLanguage,
        // 'כפוף לחלון השליחה' + what that currently MEANS for this report.
        respectSendingWindow: config ? config.respectSendingWindow !== false : true,
        windowPolicy: (() => {
          const kind = audienceKindFromReport(r);
          const pol = policyBy.get(kind + ':' + reportChannel(r));
          return {
            audienceKind: kind,
            channel: reportChannel(r),
            enabled: !!pol?.enabled,
            windowName: pol?.enabled ? (pol.window?.name || null) : null,
          };
        })(),
        deliveryCount: countBy.get(r.number) || 0,
        lastSentAt: sentBy.get(r.number)?.sentAt || null,
        lastSentTo: sentBy.get(r.number)?.destinationLabel || null,
        lastFailedAt: failedBy.get(r.number)?.updatedAt || null,
        lastError: failedBy.get(r.number)?.lastError || null,
      };
    }),
  });
}));

// ── configuration (destination + enabled) ────────────────────────────────────

router.put('/:number/config', handle(async (req, res) => {
  const number = Number(req.params.number);
  if (!reportByNumber(number)) return res.status(404).json({ error: 'unknown_report' });
  const b = req.body || {};

  // A group destination must belong to the selected sending account — the same
  // invariant the Communication Center enforces.
  const waAccountId = b.waAccountId !== undefined ? str(b.waAccountId) : undefined;
  const waChatId = b.waChatId !== undefined ? str(b.waChatId) : undefined;
  if (waChatId) {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: waChatId }, select: { accountId: true, providerDeletedAt: true },
    });
    if (!chat) return res.status(400).json({ error: 'chat_not_found' });
    if (chat.providerDeletedAt) return res.status(400).json({ error: 'chat_deleted' });
    const account = waAccountId !== undefined ? waAccountId : (await prisma.adminReportConfig.findUnique({
      where: { reportNumber: number }, select: { waAccountId: true },
    }))?.waAccountId;
    if (account && chat.accountId !== account) {
      return res.status(400).json({ error: 'chat_wrong_account' });
    }
  }

  // Stamp the activation floor on the OFF→ON edge only, so re-saving a
  // destination on an already-active report does not move it.
  const prev = await prisma.adminReportConfig.findUnique({ where: { reportNumber: number }, select: { enabled: true, activatedAt: true } });
  const turningOn = b.enabled === true && !prev?.enabled;
  const data = {
    ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}),
    ...(turningOn ? { activatedAt: new Date() } : {}),
    ...(waAccountId !== undefined ? { waAccountId } : {}),
    ...(waChatId !== undefined ? { waChatId } : {}),
    // 'שלח בשפת המדריך' — reuses the report's existing renderEn; no second
    // language mechanism.
    ...(b.sendInGuideLanguage !== undefined ? { sendInGuideLanguage: !!b.sendInGuideLanguage } : {}),
    // 'כפוף לחלון השליחה' — bypass affects TIME rules only, resolved by the
    // one sending-policy resolver; nothing else about delivery changes.
    ...(b.respectSendingWindow !== undefined ? { respectSendingWindow: !!b.respectSendingWindow } : {}),
    updatedById: req.adminAuth?.userId || null,
  };
  const config = await prisma.adminReportConfig.upsert({
    where: { reportNumber: number },
    update: data,
    create: { reportNumber: number, enabled: b.enabled !== false, activatedAt: b.enabled !== false ? new Date() : null, waAccountId: waAccountId ?? null, waChatId: waChatId ?? null, updatedById: req.adminAuth?.userId || null },
  });
  res.json({ ...config, destinationName: await destinationLabel(config) });
}));

// ── preview / simulation ─────────────────────────────────────────────────────
// mode 'sample' (default) → the report's realistic synthetic sample.
// mode 'deal'             → a REAL deal loaded read-only through the canonical
//                           context loader (nothing written, nothing sent).
router.post('/:number/preview', handle(async (req, res) => {
  const number = Number(req.params.number);
  const report = reportByNumber(number);
  if (!report) return res.status(404).json({ error: 'unknown_report' });
  const b = req.body || {};

  if (b.mode !== 'deal') {
    return res.json({ mode: 'sample', text: renderReportSample(number) });
  }
  const dealId = str(b.dealId);
  if (!dealId) return res.status(400).json({ error: 'deal_required' });
  const ctx = await loadTriggerContext({ dealId });
  if (!ctx.deal) return res.status(404).json({ error: 'deal_not_found' });
  // Trigger-carried values don't exist for a read-only preview; the caller may
  // supply a sample payload so change/quote/payment lines render honestly.
  Object.assign(ctx, b.data || {});
  res.json({ mode: 'deal', text: renderReport(number, ctx) });
}));

// ── test send (explicit destination only) ────────────────────────────────────

router.post('/:number/test-send', handle(async (req, res) => {
  const number = Number(req.params.number);
  const report = reportByNumber(number);
  if (!report) return res.status(404).json({ error: 'unknown_report' });
  const b = req.body || {};
  const testAccountId = str(b.testAccountId);
  const testChatId = str(b.testChatId);
  if (!testAccountId || !testChatId) return res.status(400).json({ error: 'test_destination_required' });

  const chat = await prisma.whatsAppChat.findUnique({
    where: { id: testChatId }, select: { externalChatId: true, accountId: true },
  });
  if (!chat) return res.status(400).json({ error: 'chat_not_found' });
  if (chat.accountId !== testAccountId) return res.status(400).json({ error: 'chat_wrong_account' });

  // Same renderer as production; only the destination differs.
  let text;
  if (str(b.dealId)) {
    const ctx = await loadTriggerContext({ dealId: str(b.dealId) });
    if (!ctx.deal) return res.status(404).json({ error: 'deal_not_found' });
    Object.assign(ctx, b.data || {});
    text = renderReport(number, ctx);
  } else {
    text = renderReportSample(number);
  }

  try {
    const data = await callBridge(testAccountId, '/send', {
      method: 'POST',
      timeoutMs: 25_000,
      body: {
        jid: chat.externalChatId,
        text: `🧪 *בדיקה — דיווח מנהלים #${number}*\n\n${text}`,
        idempotencyKey: `gos-reporttest-${number}-${Date.now()}`,
      },
    });
    res.json({ ok: true, providerMessageId: data?.externalMessageId ?? null });
  } catch (err) {
    // 422 (never 5xx) — Cloudflare would mask a 5xx as an HTML page.
    res.status(422).json({ error: 'test_send_failed', detail: String(err?.data?.error || err?.code || err?.message).slice(0, 200) });
  }
}));

// ── delivery log ─────────────────────────────────────────────────────────────

router.get('/deliveries', handle(async (req, res) => {
  const { page, pageSize, skip, take } = parseListQuery({ page: req.query.page || '1', pageSize: req.query.pageSize });
  const where = {};
  if (req.query.reportNumber) where.reportNumber = Number(req.query.reportNumber);
  if (str(req.query.status)) where.status = req.query.status;
  const [total, rows] = await Promise.all([
    prisma.adminReportDelivery.count({ where }),
    prisma.adminReportDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  ]);
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter(Boolean))];
  const deals = dealIds.length
    ? await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, orderNo: true, title: true } })
    : [];
  const dealMap = new Map(deals.map((d) => [d.id, d]));
  res.json({
    rows: rows.map((r) => ({ ...r, deal: r.dealId ? dealMap.get(r.dealId) || null : null })),
    total, page, pageSize,
  });
}));

export default router;
