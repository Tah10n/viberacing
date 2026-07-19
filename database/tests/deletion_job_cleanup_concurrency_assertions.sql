\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic terminal deletion-job cleanup race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id IN (
      '00000000-0000-4000-8000-000000035201',
      '00000000-0000-4000-8000-000000035202'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent terminal deletion-job cleanup did not remove each aged batch once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000035203'
      AND state = 'purged'
      AND profile_id IS NULL
      AND completed_at > pg_catalog.statement_timestamp() - INTERVAL '30 days'
  ) THEN
    RAISE EXCEPTION 'concurrent terminal deletion-job cleanup removed retained evidence';
  END IF;
END
$assertion$;

RESET ROLE;
