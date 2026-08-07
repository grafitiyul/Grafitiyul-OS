import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { userOrigin } from '../timeline/events.js';
import { registerDealOrderNoParam } from './dealParam.js';
import {
  ConversionError,
  previewConversion,
  convertDealActivityType,
  runConversionEffects,
} from '../deals/activityConversion.js';
import { raiseConversionRecovery, raiseConversionOverpayment } from '../deals/conversionReview.js';

// Activity-type CONVERSION — mounted at /api/deals, serves /:dealId/conversion*.
//
// Three endpoints, matching the three phases in deals/activityConversion.js:
//
//   GET  /:dealId/conversion/preview   what would happen (pure read, no writes)
//   POST /:dealId/conversion           do it (one transaction + post-commit)
//   POST /:dealId/conversion/retry-effects
//                                      re-run only the external effects after a
//                                      partial post-commit failure
//
// Its own router rather than more lines in deals.js, the same way tour planning,
// tasks and files each got one — and because the deal-scoped orderNo resolver
// has to be registered per router (the #26340 lesson).

const router = Router();
registerDealOrderNoParam(router);

// Refusal codes → HTTP status. 422 = "the request is understood but the state
// is not ready" (missing fields, an invalid slot); 409 = "the state conflicts"
// (a full slot, a decision the operator still owes us, a duplicate operation).
const STATUS_BY_CODE = {
  not_found: 404,
  invalid_activity_type: 400,
  conversion_op_id_required: 400,
  same_activity_type: 409,
  tour_full: 409,
  organization_choice_required: 409,
  conversion_op_id_conflict: 409,
  won_requirements_missing: 422,
  tour_slot_required: 422,
  tour_slot_invalid: 422,
  tour_slot_not_scheduled: 422,
};

function sendConversionError(res, err) {
  if (!(err instanceof ConversionError)) throw err;
  const status = STATUS_BY_CODE[err.code] || 422;
  return res.status(status).json({ error: err.code, ...(err.details || {}) });
}

const str = (v) => (v ? String(v) : null);

router.get(
  '/:dealId/conversion/preview',
  handle(async (req, res) => {
    try {
      const preview = await previewConversion(prisma, {
        dealId: req.params.dealId,
        targetActivityType: str(req.query.target),
        tourEventId: str(req.query.tourEventId),
        allowOverbook: req.query.allowOverbook === 'true',
        organizationChoice: str(req.query.organizationChoice),
      });
      res.json(preview);
    } catch (err) {
      return sendConversionError(res, err);
    }
  }),
);

router.post(
  '/:dealId/conversion',
  handle(async (req, res) => {
    const b = req.body || {};
    let result;
    try {
      result = await convertDealActivityType({
        dealId: req.params.dealId,
        targetActivityType: str(b.targetActivityType),
        tourEventId: str(b.tourEventId),
        allowOverbook: b.allowOverbook === true,
        organizationChoice: str(b.organizationChoice),
        opId: str(b.opId),
        origin: await userOrigin(req.adminAuth?.userId),
        actorUserId: req.adminAuth?.userId || null,
      });
    } catch (err) {
      return sendConversionError(res, err);
    }

    // A replayed request (double click, refresh, retry) converges silently —
    // the DB unique on conversionOpId already decided there is nothing to do.
    if (result.alreadyDone) {
      return res.json({ ...result, effects: null, deal: await loadConvertedDeal(req.params.dealId) });
    }

    // POST-COMMIT. The conversion is real from here on: an external failure
    // must never be reported as a failed conversion, so effects are attempted,
    // reported honestly, and anything left undone becomes a loud recovery card
    // that the retry endpoint below can finish.
    const effects = await runConversionEffects(result);
    if (!effects.ok) {
      await raiseConversionRecovery({
        dealId: result.dealId,
        opId: result.opId,
        oldTourEventId: result.oldTourEventId,
        newTourEventId: result.newTourEventId,
        deliveryIds: result.deliveryIds,
        effects,
      }).catch(() => {});
    }
    // Money is never auto-refunded. An overpayment left by a cheaper target
    // becomes an explicit operator decision, per the existing accounting rules.
    await raiseConversionOverpayment({ dealId: result.dealId }).catch(() => {});

    res.json({ ...result, effects, deal: await loadConvertedDeal(req.params.dealId) });
  }),
);

// Finish a conversion whose external effects failed. Every effect is idempotent,
// so this is safe to press any number of times; it never re-converts anything
// (the DB truth was committed the first time).
router.post(
  '/:dealId/conversion/retry-effects',
  handle(async (req, res) => {
    const b = req.body || {};
    const effects = await runConversionEffects({
      dealId: req.params.dealId,
      oldTourEventId: str(b.oldTourEventId),
      newTourEventId: str(b.newTourEventId),
      deliveryIds: Array.isArray(b.deliveryIds) ? b.deliveryIds.map(String) : [],
    });
    res.json({ effects });
  }),
);

// Minimal post-conversion payload — the client refetches the full deal through
// its own canonical loader; this only confirms the new truth.
async function loadConvertedDeal(dealId) {
  return prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true, orderNo: true, activityType: true, activityTypeAssumedAt: true,
      organizationId: true, tourDate: true, tourTime: true, conversionOpId: true,
    },
  });
}

export default router;
