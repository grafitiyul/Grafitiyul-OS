-- Configurable unit labels for General Activity Types, so the payroll breakdown
-- can read "₪40 לשעה × 1.5 שעות" instead of a unitless "₪40 × 1.5". The label
-- belongs to the activity type (it describes the activity itself), NOT any one
-- PayrollEntry / PayrollEntryLine.
--
-- Nullable, NO backfill: existing types keep NULL and the Guide Portal falls
-- back to the unitless "₪40 × 1.5" display (its current behaviour). Auto-filling
-- every legacy type with "שעה" would mislabel non-hourly ones (equipment יחידה,
-- travel ק"מ), so we leave them empty and let the office set the right noun.
-- New types default to שעה/שעות at the API layer, not in the schema.
ALTER TABLE "GeneralActivityType" ADD COLUMN "unitLabelSingularHe" TEXT;
ALTER TABLE "GeneralActivityType" ADD COLUMN "unitLabelPluralHe" TEXT;
