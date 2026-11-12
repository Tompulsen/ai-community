BEGIN;

ALTER TABLE public.external_account
  ADD COLUMN IF NOT EXISTS username varchar(128);

ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT NOW();

COMMIT;
