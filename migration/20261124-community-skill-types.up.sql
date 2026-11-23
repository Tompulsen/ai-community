BEGIN;
-- Existing skills were only available in text conversations.
ALTER TABLE community_skill ADD COLUMN IF NOT EXISTS kind varchar(8) NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','video'));
COMMIT;
