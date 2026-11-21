BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE community_submission ADD COLUMN IF NOT EXISTS "firstPublishedAt" timestamptz;
-- Historical publications are marked without issuing chances. Never remove this marker on edits or takedowns.
UPDATE community_submission s SET "firstPublishedAt"=COALESCE(s."submittedAt", NOW())
WHERE s."firstPublishedAt" IS NULL AND (s."approvedNoteId" IS NOT NULL OR s.status IN ('published','approved','removed')
  OR EXISTS (SELECT 1 FROM moderation_log l WHERE l.type='communityReview'
    AND l.info->>'submissionId'=s.id AND l.info->>'action'='remove'));
COMMIT;
