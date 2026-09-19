-- Repair databases that applied 016 while an older instance was still writing.
-- Block bucket mutations before the snapshot; existing triggers resume after commit.
LOCK TABLE rate_limit_buckets IN SHARE ROW EXCLUSIVE MODE;
UPDATE rate_limit_capacity SET bucket_count = (SELECT count(*) FROM rate_limit_buckets)
WHERE singleton;
