CREATE TABLE IF NOT EXISTS community_maintenance_benefit (
  id varchar(32) PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  definition jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_maintenance_one_active ON community_maintenance_benefit (active) WHERE active;
CREATE TABLE IF NOT EXISTS community_maintenance_delivery (
  id varchar(32) PRIMARY KEY,
  "benefitId" varchar(32) NOT NULL REFERENCES community_maintenance_benefit(id),
  "userId" varchar(32) NOT NULL,
  issuer text NOT NULL,
  subject varchar(16) NOT NULL,
  "displayCount" integer NOT NULL DEFAULT 0 CHECK ("displayCount" >= 0),
  "lastShownAt" timestamptz,
  "claimedAt" timestamptz,
  credits integer CHECK (credits BETWEEN 1 AND 1000000),
  "validityDays" integer CHECK ("validityDays" BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'unclaimed' CHECK (status IN ('unclaimed','pending','fulfilled','blocked')),
  attempts integer NOT NULL DEFAULT 0,
  "retryAt" timestamptz,
  receipt jsonb,
  UNIQUE ("benefitId",issuer,subject),
  UNIQUE ("benefitId","userId")
);
CREATE INDEX IF NOT EXISTS community_maintenance_pending ON community_maintenance_delivery ("retryAt") WHERE status='pending';
CREATE INDEX IF NOT EXISTS community_maintenance_account_records ON community_maintenance_delivery (issuer,subject,"claimedAt" DESC,id DESC) WHERE "claimedAt" IS NOT NULL;
