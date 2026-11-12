BEGIN;

ALTER TABLE public.external_account
  DROP COLUMN IF EXISTS username;

ALTER TABLE public."user"
  DROP COLUMN IF EXISTS "createdAt";

COMMIT;
