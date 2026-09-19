import pg from "pg";
import console from "node:console";
import { databaseClientConfig } from "./database-config.js";

const [action, userId] = process.argv.slice(2);
if (
  !["list", "hide", "restore", "prune"].includes(action) ||
  (["hide", "restore"].includes(action) && !/^[1-9][0-9]{0,18}$/.test(userId ?? "")) ||
  process.argv.length > (["hide", "restore"].includes(action) ? 4 : 3)
) {
  console.error("Usage: node scripts/moderate.mjs list|prune|hide USER_ID|restore USER_ID");
  process.exit(2);
}
// Operator-only database access. No route, session, or connector capability invokes this CLI.
const pool = new pg.Pool({
  ...databaseClientConfig(process.env),
  max: 1,
  connectionTimeoutMillis: 1000,
  statement_timeout: 8000,
});
try {
  if (action === "list") {
    const result =
      await pool.query(`SELECT u.id::text AS user_id, u.ranking_hidden, s.signals, s.observed_at
      FROM ranking_signals s JOIN users u ON u.id=s.user_id
      WHERE s.observed_at > now()-interval '30 days' ORDER BY s.observed_at DESC, u.id LIMIT 100`);
    process.stdout.write(JSON.stringify(result.rows, null, 2) + "\n");
  } else if (action === "prune") {
    await pool.query(`DELETE FROM ranking_signals WHERE user_id IN
      (SELECT user_id FROM ranking_signals WHERE observed_at <= now()-interval '30 days' LIMIT 1000)`);
    await pool.query(`DELETE FROM ranking_moderation_log WHERE id IN
      (SELECT id FROM ranking_moderation_log WHERE acted_at <= now()-interval '365 days' LIMIT 1000)`);
    process.stdout.write("Pruned at most 1000 expired signals and 1000 audit actions.\n");
  } else {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT ranking_hidden FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      );
      if (!current.rows.length) throw new Error("user_not_found");
      const hidden = action === "hide";
      if (current.rows[0].ranking_hidden !== hidden) {
        await client.query("UPDATE users SET ranking_hidden=$2 WHERE id=$1", [userId, hidden]);
        await client.query("INSERT INTO ranking_moderation_log(user_id,hidden) VALUES ($1,$2)", [
          userId,
          hidden,
        ]);
        await client.query(
          `DELETE FROM ranking_moderation_log WHERE user_id=$1 AND id NOT IN
          (SELECT id FROM ranking_moderation_log WHERE user_id=$1 ORDER BY id DESC LIMIT 100)`,
          [userId],
        );
      }
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({ user_id: userId, hidden }) + "\n");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} catch {
  console.error("moderation_failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
