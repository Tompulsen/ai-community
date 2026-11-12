-- Run inside the caller's transaction after the username/createdAt schema upgrade.
-- The caller supplies pg_temp._verified_accounts and community.account_issuer.
-- This migration changes only the community database.
DO $migration$
DECLARE
  account_issuer text := current_setting('community.account_issuer', true);
  entry record;
  field_name text;
  original_users integer;
  removed_users integer;
  removed_works integer;
  removed_files integer;
  moved_files integer;
  changed_users integer;
  has_remaining_reference boolean;
BEGIN
  IF account_issuer IS DISTINCT FROM 'https://zhangyuapi.com'
    OR to_regclass('pg_temp._verified_accounts') IS NULL THEN
    RAISE EXCEPTION 'Verified accounts and the expected account issuer are required';
  END IF;
  IF (SELECT count(*) FROM _verified_accounts) <> 8
    OR (SELECT count(*) FROM _verified_accounts WHERE is_root) <> 1
    OR NOT EXISTS (SELECT 1 FROM _verified_accounts WHERE id='1' AND is_root)
    OR EXISTS (
      SELECT 1 FROM _verified_accounts
      WHERE id !~ '^[1-9][0-9]*$' OR length(id)>16
        OR username IS NULL OR btrim(username)='' OR length(username)>128
        OR username ~ '[[:cntrl:]]' OR token IS NULL OR length(token)<>16
    )
    OR EXISTS (SELECT lower(username) FROM _verified_accounts GROUP BY lower(username) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Expected eight distinct verified numeric accounts and root account 1';
  END IF;

  LOCK TABLE public."user", public.external_account IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO original_users FROM public."user";

  IF EXISTS (
    SELECT 1 FROM public.external_account e
    LEFT JOIN _verified_accounts v ON v.id=e.subject
    LEFT JOIN public."user" u ON u.id=e."userId"
    WHERE e.issuer IS DISTINCT FROM account_issuer OR v.id IS NULL OR u.id IS NULL
  ) OR EXISTS (
    SELECT e."userId" FROM public.external_account e GROUP BY e."userId" HAVING count(*)<>1
  ) OR EXISTS (
    SELECT e.subject FROM public.external_account e GROUP BY e.subject HAVING count(*)<>1
  ) THEN
    RAISE EXCEPTION 'Untrusted, missing, duplicate or multiple-issuer account mappings';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _verified_accounts v JOIN public."user" u ON u.id=v.id
    WHERE NOT EXISTS (SELECT 1 FROM public.external_account e
      WHERE e.issuer=account_issuer AND e.subject=v.id AND e."userId"=u.id)
  ) THEN
    RAISE EXCEPTION 'A verified numeric ID is occupied by a different community account';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _verified_accounts v WHERE v.id<>'1'
    AND NOT EXISTS (SELECT 1 FROM public.external_account e WHERE e.subject=v.id AND e.issuer=account_issuer)
  ) THEN
    RAISE EXCEPTION 'A non-root verified account has no existing binding';
  END IF;

  CREATE TEMP TABLE _identity_fk_state ON COMMIT DROP AS
    SELECT c.conrelid, n.nspname AS schema_name, t.relname AS table_name,
      c.conname, c.condeferrable, c.condeferred
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND n.nspname='public' AND c.conparentid=0;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype='f' AND c.confrelid='public."user"'::regclass
      AND (cardinality(c.conkey)<>1 OR cardinality(c.confkey)<>1
        OR NOT EXISTS (SELECT 1 FROM pg_attribute a
          WHERE a.attrelid=c.confrelid AND a.attnum=c.confkey[1] AND a.attname='id'))
  ) THEN
    RAISE EXCEPTION 'This migration requires single-column foreign keys referencing user.id';
  END IF;
  FOR entry IN SELECT * FROM _identity_fk_state ORDER BY conrelid, conname LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',
      entry.schema_name, entry.table_name, entry.conname);
  END LOOP;
  SET CONSTRAINTS ALL DEFERRED;

  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id='1') THEN
    INSERT INTO public."user" (id,username,"usernameLower",host,token,name,"createdAt")
      SELECT id,username,lower(username),NULL,token,left(COALESCE(NULLIF(name,''),username),50),NOW()
      FROM _verified_accounts WHERE id='1';
    INSERT INTO public.user_profile ("userId","autoAcceptFollowed",password,email,"emailVerified")
      VALUES ('1',true,NULL,NULL,false);
    INSERT INTO public.external_account (issuer,subject,"userId","createdAt",username)
      SELECT account_issuer,id,id,NOW(),username FROM _verified_accounts WHERE id='1';
  END IF;

  CREATE TEMP TABLE _identity_id_map ON COMMIT DROP AS
    SELECT e."userId"::varchar(32) AS old_id, v.id::varchar(32) AS new_id
    FROM public.external_account e JOIN _verified_accounts v ON v.id=e.subject
    WHERE e.issuer=account_issuer;
  ALTER TABLE _identity_id_map ADD PRIMARY KEY (old_id);
  ALTER TABLE _identity_id_map ADD UNIQUE (new_id);
  CREATE TEMP TABLE _identity_deleted_users ON COMMIT DROP AS
    SELECT u.id FROM public."user" u
    WHERE NOT EXISTS (SELECT 1 FROM _identity_id_map m WHERE m.old_id=u.id);
  SELECT count(*) INTO removed_users FROM _identity_deleted_users;
  IF removed_users<>5 THEN
    RAISE EXCEPTION 'Expected exactly five unbound development accounts, found %', removed_users;
  END IF;
  CREATE TEMP TABLE _identity_kept_works ON COMMIT DROP AS
    SELECT s.id,s."approvedNoteId" FROM public.community_submission s
    JOIN _identity_id_map m ON m.old_id=s."authorId";
  CREATE TEMP TABLE _identity_kept_files ON COMMIT DROP AS
    SELECT f.id FROM public.drive_file f JOIN _identity_id_map m ON m.old_id=f."userId";
  IF (SELECT count(*) FROM _identity_kept_works)<>19
    OR (SELECT count(*) FROM _identity_kept_files)<>36 THEN
    RAISE EXCEPTION 'The retained development data differs from the verified 19 works / 36 files';
  END IF;

  CREATE TEMP TABLE _identity_protected_files (id varchar(32) PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO _identity_protected_files
    SELECT f.id FROM _identity_kept_files f
    UNION SELECT unnest(s."fileIds") FROM public.community_submission s JOIN _identity_kept_works w ON w.id=s.id
    UNION SELECT u."avatarId" FROM public."user" u JOIN _identity_id_map m ON m.old_id=u.id WHERE u."avatarId" IS NOT NULL
    UNION SELECT u."bannerId" FROM public."user" u JOIN _identity_id_map m ON m.old_id=u.id WHERE u."bannerId" IS NOT NULL
    UNION SELECT unnest(n."fileIds") FROM public.note n JOIN _identity_id_map m ON m.old_id=n."userId"
    ON CONFLICT DO NOTHING;
  INSERT INTO _identity_protected_files
    SELECT DISTINCT refs.id
    FROM public.community_submission s JOIN _identity_kept_works w ON w.id=s.id
    CROSS JOIN LATERAL (
      SELECT value AS id FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(to_jsonb(s)->'generation'->'referenceFileIds')='array'
        THEN to_jsonb(s)->'generation'->'referenceFileIds' ELSE '[]'::jsonb END)
      UNION SELECT value FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(to_jsonb(s)->'pendingRevision'->'fileIds')='array'
        THEN to_jsonb(s)->'pendingRevision'->'fileIds' ELSE '[]'::jsonb END)
      UNION SELECT value FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(to_jsonb(s)->'pendingRevision'->'generation'->'referenceFileIds')='array'
        THEN to_jsonb(s)->'pendingRevision'->'generation'->'referenceFileIds' ELSE '[]'::jsonb END)
    ) refs
    WHERE refs.id IS NOT NULL ON CONFLICT DO NOTHING;
  CREATE TEMP TABLE _identity_removed_files ON COMMIT DROP AS
    SELECT f.id,f."accessKey",f."thumbnailAccessKey",f."webpublicAccessKey"
    FROM public.drive_file f JOIN _identity_deleted_users d ON d.id=f."userId"
    WHERE NOT EXISTS (SELECT 1 FROM _identity_protected_files p WHERE p.id=f.id);
  IF (SELECT count(*) FROM public.drive_file f JOIN _identity_deleted_users d ON d.id=f."userId")<>7 THEN
    RAISE EXCEPTION 'Expected seven files owned by the removed development accounts';
  END IF;
  UPDATE public.drive_file f SET "userId"='1'
    FROM _identity_deleted_users d WHERE f."userId"=d.id
      AND EXISTS (SELECT 1 FROM _identity_protected_files p WHERE p.id=f.id);
  GET DIAGNOSTICS moved_files = ROW_COUNT;

  -- Save all user references, including known denormalized columns without FKs.
  CREATE TEMP TABLE _identity_user_columns ON COMMIT DROP AS
    SELECT DISTINCT t.oid AS relation_id,n.nspname AS schema_name,t.relname AS table_name,
      a.attname AS column_name,a.attnotnull
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid
      JOIN pg_type ty ON ty.oid=a.atttypid
    WHERE n.nspname='public' AND t.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      AND ty.typcategory='S' AND NOT (t.oid='public."user"'::regclass AND a.attname='id')
      AND (a.attname=ANY(ARRAY[
        'userId','authorId','ownerId','fromUserId','toUserId','replyUserId','renoteUserId',
        'reviewedById','moderatorId','reporterId','targetUserId','assigneeId','recipientId',
        'followerId','followeeId','blockerId','blockeeId','muterId','muteeId',
        'inviterId','invitedById','userListUserId','createdById','updatedById','rootUserId','proxyAccountId'
      ]) OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype='f'
        AND c.conrelid=t.oid AND c.confrelid='public."user"'::regclass AND a.attnum=ANY(c.conkey)));
  FOR entry IN SELECT * FROM _identity_user_columns ORDER BY relation_id,column_name LOOP
    EXECUTE format('UPDATE %I.%I t SET %I=m.new_id FROM _identity_id_map m WHERE t.%I=m.old_id AND m.old_id<>m.new_id',
      entry.schema_name,entry.table_name,entry.column_name,entry.column_name);
  END LOOP;
  UPDATE public."user" u SET id=m.new_id
    FROM _identity_id_map m WHERE u.id=m.old_id AND m.old_id<>m.new_id;
  GET DIAGNOSTICS changed_users = ROW_COUNT;
  UPDATE public.meta SET "rootUserId"='1';

  -- Delete only the unbound test owners' content; keep protected shared media.
  DELETE FROM public.community_submission s USING _identity_deleted_users d WHERE s."authorId"=d.id;
  GET DIAGNOSTICS removed_works = ROW_COUNT;
  IF removed_works<>2 THEN RAISE EXCEPTION 'Expected two obsolete test works, found %',removed_works; END IF;
  DELETE FROM public.note n USING _identity_deleted_users d WHERE n."userId"=d.id;
  DELETE FROM public.drive_file f USING _identity_removed_files d WHERE f.id=d.id;
  GET DIAGNOSTICS removed_files = ROW_COUNT;

  FOR entry IN SELECT * FROM _identity_user_columns ORDER BY relation_id,column_name LOOP
    IF entry.table_name='user' OR entry.table_name='meta' THEN
      IF entry.attnotnull THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t JOIN _identity_deleted_users d ON t.%I=d.id)',
          entry.schema_name,entry.table_name,entry.column_name) INTO has_remaining_reference;
        IF has_remaining_reference THEN RAISE EXCEPTION 'Required account reference remains in %.%',entry.table_name,entry.column_name; END IF;
      ELSE
        EXECUTE format('UPDATE %I.%I t SET %I=NULL FROM _identity_deleted_users d WHERE t.%I=d.id',
          entry.schema_name,entry.table_name,entry.column_name,entry.column_name);
      END IF;
    ELSIF entry.column_name=ANY(ARRAY['reviewedById','moderatorId','assigneeId','createdById','updatedById']) THEN
      EXECUTE format('UPDATE %I.%I t SET %I=%s FROM _identity_deleted_users d WHERE t.%I=d.id',
        entry.schema_name,entry.table_name,entry.column_name,
        CASE WHEN entry.attnotnull THEN quote_literal('1') ELSE 'NULL' END,entry.column_name);
    ELSIF NOT entry.attnotnull THEN
      EXECUTE format('UPDATE %I.%I t SET %I=NULL FROM _identity_deleted_users d WHERE t.%I=d.id',
        entry.schema_name,entry.table_name,entry.column_name,entry.column_name);
    ELSE
      IF entry.table_name='community_lottery_draw' THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t JOIN _identity_deleted_users d ON t.%I=d.id)',
          entry.schema_name,entry.table_name,entry.column_name) INTO has_remaining_reference;
        IF has_remaining_reference THEN
          RAISE EXCEPTION 'Lottery draw ownership must be nullable; do not delete credit receipts';
        END IF;
      END IF;
      EXECUTE format('DELETE FROM %I.%I t USING _identity_deleted_users d WHERE t.%I=d.id',
        entry.schema_name,entry.table_name,entry.column_name);
    END IF;
  END LOOP;

  FOR entry IN
    SELECT n.nspname AS schema_name,t.relname AS table_name,a.attname AS column_name
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid
      JOIN pg_type ty ON ty.oid=a.atttypid JOIN pg_type element ON element.oid=ty.typelem
    WHERE n.nspname='public' AND t.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      AND element.typcategory='S'
      AND (a.attname ~* '(user|actor|recipient|owner).*Ids$' OR a.attname IN ('mentions','reads'))
  LOOP
    EXECUTE format('UPDATE %I.%I t SET %I=ARRAY(SELECT COALESCE(m.new_id,v.id) FROM unnest(t.%I) WITH ORDINALITY v(id,ord)
      LEFT JOIN _identity_id_map m ON m.old_id=v.id WHERE NOT EXISTS (SELECT 1 FROM _identity_deleted_users d WHERE d.id=v.id) ORDER BY v.ord)
      WHERE EXISTS (SELECT 1 FROM unnest(t.%I) v(id) WHERE EXISTS(SELECT 1 FROM _identity_id_map m WHERE m.old_id=v.id AND m.old_id<>m.new_id)
        OR EXISTS(SELECT 1 FROM _identity_deleted_users d WHERE d.id=v.id))',
      entry.schema_name,entry.table_name,entry.column_name,entry.column_name,entry.column_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.note'::regclass
    AND attname='reactionAndUserPairCache' AND NOT attisdropped) THEN
    UPDATE public.note SET "reactionAndUserPairCache"='{}';
  END IF;
  FOREACH field_name IN ARRAY ARRAY['userId','actorId','targetUserId','moderatorId','reporterId','assigneeId','recipientId','inviterId'] LOOP
    UPDATE public.moderation_log l SET info=jsonb_set(l.info,ARRAY[field_name],to_jsonb(m.new_id))
      FROM _identity_id_map m WHERE l.info->>field_name=m.old_id AND m.old_id<>m.new_id;
    DELETE FROM public.moderation_log l USING _identity_deleted_users d WHERE l.info->>field_name=d.id;
  END LOOP;

  DELETE FROM public."user" u USING _identity_deleted_users d WHERE u.id=d.id;
  UPDATE public."user" u SET username=v.username,"usernameLower"=lower(v.username)
    FROM _verified_accounts v WHERE u.id=v.id;
  UPDATE public.external_account e SET username=v.username
    FROM _verified_accounts v WHERE e.issuer=account_issuer AND e.subject=v.id AND e."userId"=v.id;
  DELETE FROM public.used_username r WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u."usernameLower"=r.username);
  INSERT INTO public.used_username (username,"createdAt")
    SELECT u."usernameLower",NOW() FROM public."user" u ON CONFLICT (username) DO NOTHING;
  FOREACH field_name IN ARRAY ARRAY['password_reset_request','user_pending','pending_user','signin','user_ip'] LOOP
    IF to_regclass(format('public.%I',field_name)) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I',field_name);
    END IF;
  END LOOP;
  UPDATE public."user" u SET
    "followersCount"=(SELECT count(*) FROM public.following f WHERE f."followeeId"=u.id),
    "followingCount"=(SELECT count(*) FROM public.following f WHERE f."followerId"=u.id),
    "notesCount"=(SELECT count(*) FROM public.note n WHERE n."userId"=u.id);

  IF (SELECT count(*) FROM public."user")<>8 OR (SELECT count(*) FROM public.external_account)<>8
    OR EXISTS (SELECT 1 FROM public."user" u LEFT JOIN public.external_account e
      ON e."userId"=u.id AND e.subject=u.id AND e.issuer=account_issuer
      WHERE u.id !~ '^[1-9][0-9]*$' OR e.subject IS NULL)
    OR EXISTS (SELECT 1 FROM public.external_account e WHERE e."userId" IS DISTINCT FROM e.subject OR e.issuer<>account_issuer)
    OR NOT EXISTS (SELECT 1 FROM public.meta WHERE "rootUserId"='1')
    OR (SELECT count(*) FROM public.community_submission)<>19
    OR EXISTS (SELECT 1 FROM _identity_kept_works w LEFT JOIN public.community_submission s ON s.id=w.id
      WHERE s.id IS NULL OR s."approvedNoteId" IS DISTINCT FROM w."approvedNoteId")
    OR EXISTS (SELECT 1 FROM _identity_kept_files f LEFT JOIN public.drive_file d ON d.id=f.id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Final numeric identity/content preservation checks failed';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  FOR entry IN SELECT * FROM _identity_fk_state ORDER BY conrelid,conname LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER CONSTRAINT %I %s',
      entry.schema_name,entry.table_name,entry.conname,
      CASE WHEN entry.condeferrable THEN
        CASE WHEN entry.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED' ELSE 'DEFERRABLE INITIALLY IMMEDIATE' END
      ELSE 'NOT DEFERRABLE' END);
  END LOOP;
  CREATE TEMP TABLE _identity_cleanup_summary ON COMMIT DROP AS
    SELECT jsonb_build_object(
      'kind','zhangyu-numeric-account-migration','usersBefore',original_users,'usersAfter',8,
      'removedUnboundUsers',removed_users,'rekeyedUsers',changed_users,'rootAccountId','1',
      'retainedWorks',19,'removedTestWorks',removed_works,'retainedOriginalFiles',36,
      'removedTestFiles',removed_files,'protectedFilesReassignedToRoot',moved_files,
      'physicalFileKeysToDelete',COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM (
        SELECT DISTINCT key FROM _identity_removed_files f
        CROSS JOIN LATERAL unnest(ARRAY[f."accessKey",f."thumbnailAccessKey",f."webpublicAccessKey"]) AS file_key(key)
        WHERE key IS NOT NULL AND key<>''
          AND NOT EXISTS (SELECT 1 FROM public.drive_file kept WHERE key=ANY(ARRAY[kept."accessKey",kept."thumbnailAccessKey",kept."webpublicAccessKey"]))
      ) keys),'[]'::jsonb)
    ) AS summary;
END
$migration$;

SELECT summary::text FROM _identity_cleanup_summary;
