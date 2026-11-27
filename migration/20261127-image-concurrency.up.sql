CREATE INDEX CONCURRENTLY IF NOT EXISTS community_creation_request_image_admission
ON community_creation_request (((record->>'deadline')::bigint))
WHERE record->>'kind'='image'
AND record#>>'{result,status}' IN ('pending','indeterminate');
