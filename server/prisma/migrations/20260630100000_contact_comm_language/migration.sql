-- Contact: preferred communication language (he | en). ADDITIVE, nullable only.
-- The Deal/Quote never copies it — a future Quote defaults from the contact.
-- Safe to re-run.

ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "communicationLanguage" TEXT;
