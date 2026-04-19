-- Visual annotations on document instances (check / x / highlight / line /
-- note). Separate JSON column so annotations never flow through the value
-- resolution pipeline. Existing instances default to empty array.

ALTER TABLE "DocumentInstance"
    ADD COLUMN "annotationsSnapshot" JSONB NOT NULL DEFAULT '[]'::jsonb;
