-- Reindex sortOrder globally across ContentItem + QuestionItem per folder.
--
-- The previous backfill ranked each table independently, producing ties
-- between content and question rows at sortOrder 0, 1, 2... which the bank
-- list broke with a createdAt tie-breaker. That tie-break produced an
-- interleaved-by-creation-date ordering that looked like the list was
-- forcing a content/question alternation.
--
-- Fix: re-rank the union of both tables per folder so every row has a
-- globally-unique sortOrder. Preserves any prior manual order where
-- possible by using existing sortOrder as the primary sort key.
--
-- Uses a temporary table because PostgreSQL CTE scope is one statement.

CREATE TEMP TABLE _reindex_ranks (
    id   TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    rnk  INTEGER NOT NULL
);

INSERT INTO _reindex_ranks (id, kind, rnk)
SELECT
    x.id,
    x.kind,
    (ROW_NUMBER() OVER (
        PARTITION BY x."folderId"
        ORDER BY x."sortOrder" ASC, x."createdAt" ASC, x.id ASC
    ) - 1) AS rnk
FROM (
    SELECT id, "folderId", "createdAt", "sortOrder", 'content'  AS kind FROM "ContentItem"
    UNION ALL
    SELECT id, "folderId", "createdAt", "sortOrder", 'question' AS kind FROM "QuestionItem"
) x;

UPDATE "ContentItem" c
   SET "sortOrder" = r.rnk
  FROM _reindex_ranks r
 WHERE r.kind = 'content'
   AND r.id = c.id;

UPDATE "QuestionItem" q
   SET "sortOrder" = r.rnk
  FROM _reindex_ranks r
 WHERE r.kind = 'question'
   AND r.id = q.id;

DROP TABLE _reindex_ranks;
