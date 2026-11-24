BEGIN;
ALTER TABLE community_skill ADD COLUMN IF NOT EXISTS "legacyId" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS community_skill_legacy_id ON community_skill ("legacyId");
COMMIT;
