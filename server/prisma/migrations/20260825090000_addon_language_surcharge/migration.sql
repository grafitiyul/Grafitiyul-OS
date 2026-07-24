-- Language-surcharge applicability metadata (data-driven; defect #4).
--
-- Additive column: the tour-language keys that TRIGGER a language surcharge for
-- a system language addon. The pricing engine evaluates this set — it never
-- hard-codes language codes; the "regular" languages are simply those absent
-- from it, editable in data without a deploy.
ALTER TABLE "Addon" ADD COLUMN "autoApplyLanguages" TEXT[] NOT NULL DEFAULT '{}';

-- Wire the EXISTING owner-created language-surcharge addon into the canonical
-- system-surcharge mechanism, idempotently and portably:
--   * give it the stable key so logic references it by KEY, never by name;
--   * declare the trigger languages as DATA (es/fr/ru = every non-regular tour
--     language currently supported).
-- Matches the untagged addon by its ASCII English name (falls back to the
-- Hebrew name). Never overwrites an existing systemKey. On any environment
-- without such an addon these UPDATEs are safe no-ops.
UPDATE "Addon"
   SET "systemKey" = 'language_surcharge'
 WHERE "systemKey" IS NULL
   AND ("nameEn" = 'Language Surcharge' OR "nameHe" = 'תוספת שפה');

UPDATE "Addon"
   SET "autoApplyLanguages" = '{es,fr,ru}'
 WHERE "systemKey" = 'language_surcharge'
   AND "autoApplyLanguages" = '{}';
