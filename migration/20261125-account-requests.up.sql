BEGIN;
CREATE TABLE IF NOT EXISTS community_creation_request (
  key text PRIMARY KEY,
  fingerprint text NOT NULL,
  contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  state text NOT NULL CHECK (state IN ('preparing', 'dispatch_intent', 'running', 'succeeded', 'failed', 'indeterminate', 'failed_before_dispatch')),
  version integer NOT NULL DEFAULT 1,
  owner text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  record jsonb NOT NULL,
  next_poll bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_creation_request_pending ON community_creation_request(next_poll) WHERE next_poll IS NOT NULL;
CREATE TABLE IF NOT EXISTS community_group_credential (
  key text PRIMARY KEY,
  binding jsonb NOT NULL,
  provenance text NOT NULL DEFAULT 'native-create',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
