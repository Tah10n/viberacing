# Database baseline

This directory is the pre-production database baseline. Databases created from commits before this
baseline are unsupported and must be recreated with `corepack pnpm local:reset`.

Starting with this baseline, this marker and numbered SQL migrations are append-only. Never edit,
delete, or rename this file or an existing migration, and never renumber a migration. Add the next
unique three-digit migration number instead. Numbers are strictly sequential without gaps, including
when one change adds multiple migrations.
