-- The STABLE external-order identity.
--
-- (source, sourceKey, externalId) = store + provider order id. Every later
-- delivery for the same order resolves through this index to the Deal that
-- order already created, so a status transition (pending → processing →
-- completed) or an edit updates ONE deal instead of creating another.
--
-- Read by ingress/resolve.js findDealForExternalOrder.
CREATE INDEX "IngressEvent_source_sourceKey_externalId_idx"
  ON "IngressEvent" ("source", "sourceKey", "externalId");
