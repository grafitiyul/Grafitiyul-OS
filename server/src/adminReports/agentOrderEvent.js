// Agent reservation processed → Admin Report #10.
//
// Fired from the reservation processor, from the SAME first-processing guard
// the Communication Center trigger uses, so the two notifications can never
// disagree about what "a new agent order arrived" means. One report per
// ReservationSession (the order), never one per created Deal.
//
// Figures come from the Deals that were actually created — not from the
// submitted form — so what the office sees is what GOS booked.

import { prisma } from '../db.js';
import { fireAdminReport } from './dispatch.js';

export async function collectAgentOrder(sessionId, client = prisma) {
  const session = await client.reservationSession.findUnique({
    where: { id: sessionId },
    select: {
      sessionNo: true,
      groups: {
        orderBy: { sortOrder: 'asc' },
        select: {
          groupName: true, productLabel: true, locationLabel: true,
          createdDeal: {
            select: {
              orderNo: true, participants: true, valueMinor: true,
              tourDate: true, tourTime: true,
              product: { select: { nameHe: true } },
              location: { select: { nameHe: true } },
            },
          },
        },
      },
    },
  });
  if (!session) return null;

  // Only groups that produced a Deal are reportable — a group that failed
  // processing is not a booked order and must not be reported as one.
  const groups = session.groups
    .filter((g) => g.createdDeal)
    .map((g) => {
      const d = g.createdDeal;
      // Frozen form labels are the fallback when a catalog row was since
      // renamed or unlinked — the same convention the summary PDF uses.
      const productName = [
        d.product?.nameHe || g.productLabel || null,
        d.location?.nameHe || g.locationLabel || null,
      ].filter(Boolean).join(' - ') || null;
      return {
        groupName: g.groupName || null,
        tourDate: d.tourDate || null,
        tourTime: d.tourTime || null,
        productName,
        participants: d.participants ?? null,
        totalMinor: d.valueMinor == null ? null : Number(d.valueMinor),
        dealOrderNo: d.orderNo ?? null,
      };
    });

  const totals = groups.map((g) => g.totalMinor).filter((v) => v != null);
  return {
    orderNo: session.sessionNo,
    groups,
    totalMinor: totals.length ? totals.reduce((a, b) => a + b, 0) : null,
  };
}

export async function reportAgentOrder(sessionId, { client = prisma, log = console } = {}) {
  const agentOrder = await collectAgentOrder(sessionId, client);
  if (!agentOrder || !agentOrder.groups.length) return { skipped: 'no_created_deals' };
  return fireAdminReport({
    number: 10,
    idempotencyKey: `agent_order:${sessionId}`,
    sessionId,
    data: { agentOrder },
  }, log);
}
