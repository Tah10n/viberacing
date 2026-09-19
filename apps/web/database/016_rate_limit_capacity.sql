-- A hard storage ceiling independent of cleanup success or distinct client addresses.
CREATE TABLE rate_limit_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  bucket_count bigint NOT NULL CHECK (bucket_count >= 0)
);
INSERT INTO rate_limit_capacity (bucket_count) SELECT count(*) FROM rate_limit_buckets;

CREATE FUNCTION maintain_rate_limit_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM inserted_buckets) THEN RETURN NULL; END IF;
    UPDATE rate_limit_capacity SET bucket_count = bucket_count + (SELECT count(*) FROM inserted_buckets)
      WHERE singleton RETURNING bucket_count INTO allocated;
    IF allocated > 200000 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'rate_limit_capacity_exceeded';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM deleted_buckets) THEN RETURN NULL; END IF;
    UPDATE rate_limit_capacity SET bucket_count = bucket_count - (SELECT count(*) FROM deleted_buckets) WHERE singleton;
  ELSE
    UPDATE rate_limit_capacity SET bucket_count = 0 WHERE singleton;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER rate_limit_capacity_insert AFTER INSERT ON rate_limit_buckets
  REFERENCING NEW TABLE AS inserted_buckets
  FOR EACH STATEMENT EXECUTE FUNCTION maintain_rate_limit_capacity();
CREATE TRIGGER rate_limit_capacity_delete AFTER DELETE ON rate_limit_buckets
  REFERENCING OLD TABLE AS deleted_buckets
  FOR EACH STATEMENT EXECUTE FUNCTION maintain_rate_limit_capacity();
CREATE TRIGGER rate_limit_capacity_truncate AFTER TRUNCATE ON rate_limit_buckets
  FOR EACH STATEMENT EXECUTE FUNCTION maintain_rate_limit_capacity();
