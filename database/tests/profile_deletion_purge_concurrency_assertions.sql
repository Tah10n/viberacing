\set ON_ERROR_STOP on

-- Read-only assertions over the committed synthetic deletion-purge race fixtures.

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id IN (
      '00000000-0000-4000-8000-000000025101',
      '00000000-0000-4000-8000-000000025102',
      '00000000-0000-4000-8000-000000025103'
    )
  ) THEN
    RAISE EXCEPTION 'deletion-purge races left primary profiles behind';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        pg_catalog.count(*) AS job_count,
        pg_catalog.bool_and(
          state = 'purged'
          AND profile_id IS NULL
          AND completed_at IS NOT NULL
        ) AS all_terminal
      FROM viberacing_private.deletion_jobs
      WHERE deletion_job_id IN (
        '00000000-0000-4000-8000-000000025201',
        '00000000-0000-4000-8000-000000025202',
        '00000000-0000-4000-8000-000000025203'
      )
    ) AS deletion_summary
    WHERE deletion_summary.job_count = 3
      AND deletion_summary.all_terminal
  ) THEN
    RAISE EXCEPTION 'deletion-purge races did not terminally settle every exact job';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_tombstones AS tombstone_record
    JOIN viberacing_private.deletion_jobs AS job_record
      ON job_record.profile_ref_digest = tombstone_record.profile_ref_digest
    WHERE job_record.deletion_job_id IN (
      '00000000-0000-4000-8000-000000025201',
      '00000000-0000-4000-8000-000000025202',
      '00000000-0000-4000-8000-000000025203'
    )
  ) THEN
    RAISE EXCEPTION 'primary purge invented an unreviewed tombstone in a race';
  END IF;
END
$assertions$;
