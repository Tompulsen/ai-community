BEGIN;
CREATE TABLE IF NOT EXISTS community_skill (
  id varchar(32) PRIMARY KEY,
  "authorId" varchar(32) NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description varchar(1000) NOT NULL,
  body text NOT NULL CHECK (octet_length(body) <= 65536),
  sha256 varchar(64) NOT NULL,
  filename varchar(160) NOT NULL,
  archive bytea NOT NULL CHECK (octet_length(archive) <= 5242880),
  size integer NOT NULL CHECK (size > 0 AND size <= 5242880),
  files jsonb NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending','published','rejected','removed')),
  official boolean NOT NULL DEFAULT false,
  "requestId" varchar(80) NOT NULL,
  "requestHash" varchar(64) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  "reviewNote" varchar(1000) NOT NULL DEFAULT '',
  "reviewedBy" varchar(32),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_skill_status_id ON community_skill (status,id DESC);
CREATE INDEX IF NOT EXISTS community_skill_author_id ON community_skill ("authorId",id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS community_skill_author_request ON community_skill ("authorId","requestId");
COMMIT;
