import { useEffect, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import AllocationPanel from './AllocationPanel.jsx';

// "שייך לדילים נוספים" for a payment that ALREADY exists on this deal — an
// issued document or a manual/gateway evidence row.
//
// A workspace, not a small confirm (Product & UX standard 12): the operator is
// reading several deals' balances and doing arithmetic that must be auditable.
export default function AllocationDialog({ open, onClose, dealId, row, onDone }) {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // A payment that has never been split has no group yet — the dialog then
  // opens on the single origin deal, which is the honest starting point.
  //
  // Keyed on the payment's IDENTITY, never on the row object: the collection
  // card refetches on every deal event, and depending on `row` would hand this
  // effect a brand-new object mid-edit and reset an allocation the operator is
  // halfway through typing.
  const groupId = row?.allocationGroupId || null;
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    (async () => {
      if (!groupId) { setGroup(null); return; }
      setLoading(true);
      try {
        const res = await api.payments.allocation(groupId);
        if (alive) setGroup(res.group);
      } catch {
        if (alive) setGroup(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, groupId]);

  if (!open || !row) return null;

  const realMinor = row.documentAmountMinor ?? row.amountMinor;
  const payment = {
    groupId: row.allocationGroupId || null,
    realMinor,
    currency: row.currency || 'ILS',
    docnum: row.docnum || null,
    doctype: row.doctype || null,
    label: row.doctypeLabel || row.kindLabel || 'תשלום',
  };

  const initial = group
    ? group.allocations
    : [{
      dealId,
      orderNo: row.orderNo ?? null,
      dealTitle: row.clientName || null,
      amountMinor: realMinor,
      dealTotalMinor: null,
    }];

  async function apply(plan, opts) {
    setBusy(true);
    try {
      if (group?.groupId) {
        await api.payments.setAllocation(group.groupId, { allocations: plan, ...opts });
      } else {
        await api.deals.allocatePayment(dealId, {
          sourceKind: row.rowType === 'evidence' ? 'collection_evidence' : 'icount_document',
          rowId: row.id,
          allocations: plan,
          ...opts,
        });
      }
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="שיוך תשלום לדילים" size="xl">
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">טוען…</div>
      ) : (
        <AllocationPanel
          payment={payment}
          initial={initial}
          originDealId={group?.allocations?.[0]?.dealId || dealId}
          onApply={apply}
          onCancel={onClose}
          busy={busy}
        />
      )}
    </Dialog>
  );
}
