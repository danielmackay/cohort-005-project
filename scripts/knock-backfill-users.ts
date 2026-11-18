// One-off backfill: syncs every user in data.db to Knock (name, email, avatar)
// and gives each one the default Notification preferences for any category
// they have no preference for yet. Existing preferences are never overwritten,
// so it is safe to re-run.
//
// Usage: npm run knock:backfill-users
//
// Needs the Knock keys in .env (or the shell), as the app does. Without them it
// stops rather than pretending to sync.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import { knockNotificationsIfConfigured } from "../app/lib/notifications.server";
import { syncAllUsers } from "../app/lib/users.server";

async function main() {
  const notifications = await knockNotificationsIfConfigured();
  if (!notifications) {
    throw new Error(
      "Knock is not configured: set KNOCK_SECRET_API_KEY (or KNOCK_API_KEY), " +
        "KNOCK_SIGNING_KEY, KNOCK_PUBLIC_API_KEY and KNOCK_FEED_CHANNEL_ID in .env."
    );
  }

  const sqlite = new Database("data.db", { fileMustExist: true });
  const db = drizzle(sqlite, { schema });

  const report = await syncAllUsers(db, notifications);
  sqlite.close();

  console.log(`Synced ${report.synced.length} users to Knock.`);
  if (report.failed.length > 0) {
    console.error(`Failed to sync ${report.failed.length} users:`);
    for (const { userId, error } of report.failed) {
      console.error(`  user ${userId}: ${error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
