-- Independent, read-only inventory. Emits aggregates only, never account records.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH counts AS (
  SELECT 'user' AS name, count(*) AS rows FROM public."user"
  UNION ALL SELECT 'user_profile', count(*) FROM public.user_profile
  UNION ALL SELECT 'external_account', count(*) FROM public.external_account
  UNION ALL SELECT 'drive_file', count(*) FROM public.drive_file
  UNION ALL SELECT 'note', count(*) FROM public.note
  UNION ALL SELECT 'community_submission', count(*) FROM public.community_submission
  UNION ALL SELECT 'community_tag', count(*) FROM public.community_tag
  UNION ALL SELECT 'note_favorite', count(*) FROM public.note_favorite
  UNION ALL SELECT 'note_reaction', count(*) FROM public.note_reaction
  UNION ALL SELECT 'following', count(*) FROM public.following
  UNION ALL SELECT 'community_lottery_config', count(*) FROM public.community_lottery_config
  UNION ALL SELECT 'community_lottery_account', count(*) FROM public.community_lottery_account
  UNION ALL SELECT 'community_lottery_referral', count(*) FROM public.community_lottery_referral
  UNION ALL SELECT 'community_lottery_draw', count(*) FROM public.community_lottery_draw
), awards AS (
  SELECT prize
  FROM public.community_lottery_draw d,
  LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(d.prizes) = 'array' THEN d.prizes ELSE '[]'::jsonb END
  ) AS prize
)
SELECT jsonb_build_object(
  'kind', 'legacy-readonly-inventory',
  'capturedAt', transaction_timestamp(),
  'readOnly', current_setting('transaction_read_only'),
  'coreCounts', (SELECT jsonb_object_agg(name, rows) FROM counts),
  'allTableEstimates', (
    SELECT jsonb_agg(jsonb_build_object('table', relname, 'estimatedRows', n_live_tup) ORDER BY relname)
    FROM pg_stat_user_tables WHERE schemaname = 'public'
  ),
  'submissionStates', (
    SELECT jsonb_object_agg(status, total)
    FROM (SELECT status, count(*) AS total FROM public.community_submission GROUP BY status) s
  ),
  'mfaEnabled', (SELECT count(*) FROM public.user_profile WHERE "twoFactorEnabled"),
  'lottery', jsonb_build_object(
    'chancesTotal', (SELECT COALESCE(sum(balance), 0) FROM public.community_lottery_account),
    'pendingDraws', (SELECT count(*) FROM public.community_lottery_draw WHERE "creditPending"),
    'awardStates', (SELECT jsonb_object_agg(status, total) FROM (
      SELECT COALESCE(prize->>'status', 'missing') AS status, count(*) AS total
      FROM awards GROUP BY COALESCE(prize->>'status', 'missing')
    ) s),
    'receiptCount', (SELECT count(*) FROM awards WHERE prize ? 'creditReceipt')
  ),
  'orphanReferences', jsonb_build_object(
    'submissionAuthors', (SELECT count(*) FROM public.community_submission s
      LEFT JOIN public."user" u ON u.id = s."authorId" WHERE u.id IS NULL),
    'submissionNotes', (SELECT count(*) FROM public.community_submission s
      LEFT JOIN public.note n ON n.id = s."approvedNoteId" WHERE s."approvedNoteId" IS NOT NULL AND n.id IS NULL),
    'submissionFiles', (SELECT count(*) FROM public.community_submission s
      CROSS JOIN LATERAL unnest(s."fileIds") f(id)
      LEFT JOIN public.drive_file d ON d.id = f.id WHERE d.id IS NULL),
    'submissionTags', (SELECT count(*) FROM public.community_submission s
      CROSS JOIN LATERAL unnest(s."tagIds") t(id)
      LEFT JOIN public.community_tag d ON d.id = t.id WHERE d.id IS NULL),
    'externalAccountUsers', (SELECT count(*) FROM public.external_account e
      LEFT JOIN public."user" u ON u.id = e."userId" WHERE e."userId" IS NOT NULL AND u.id IS NULL)
  ),
  'notCovered', jsonb_build_array(
    'physical file hashes', 'JSON generation and pendingRevision references',
    'Redis notifications and reaction buffers', 'browser IndexedDB and localStorage',
    'New API receipt reconciliation', 'allTableEstimates are not exact counts'
  )
);
ROLLBACK;
