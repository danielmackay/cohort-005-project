import { eq } from "drizzle-orm";
import { UserRole, users } from "~/db/schema";
import {
  syncUserAfterCommit,
  type NotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import type { Failure, Queryable } from "~/lib/refunds.server";

// ─── Users ───
// Creating and editing users, and keeping the Notifications vendor's copy of
// each user (name, email, avatar) in step. Role is never synced: recipients
// chosen by role are looked up when a Notification fires.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

function toNotificationUser(user: typeof users.$inferSelect): NotificationUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

export type SignUpResult = { userId: number; created: boolean };

/**
 * Creates a Student with this email, or returns the existing user with it
 * (signup doubles as login). Only a newly created user is synced.
 */
export async function signUp(
  db: Queryable,
  notifications: Notifications,
  name: string,
  email: string
): Promise<SignUpResult> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return { userId: existing.id, created: false };

  const created = db
    .insert(users)
    .values({ name, email, role: UserRole.Student, avatarUrl: null })
    .returning()
    .get();

  await syncUserAfterCommit(notifications, toNotificationUser(created));
  return { userId: created.id, created: true };
}

export type UpdateResult = { ok: true } | Failure;

/**
 * A person editing their own profile on `/settings`. Email isn't editable
 * there. Bio isn't synced, so only a name change syncs the user.
 */
export async function updateProfile(
  db: Queryable,
  notifications: Notifications,
  userId: number,
  name: string,
  bio: string | null
): Promise<UpdateResult> {
  const before = db.select().from(users).where(eq(users.id, userId)).get();
  if (!before) return { ok: false, status: 404, error: "User not found." };

  const after = db
    .update(users)
    .set({ name, bio })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (!after) return { ok: false, status: 404, error: "User not found." };

  if (after.name !== before.name) {
    await syncUserAfterCommit(notifications, toNotificationUser(after));
  }
  return { ok: true };
}

export type SyncReport = {
  synced: number[];
  failed: { userId: number; error: string }[];
};

/**
 * Syncs every user, one at a time, for the seed and the one-off backfill.
 * A failure is reported and the rest carry on; nothing is thrown.
 */
export async function syncAllUsers(
  db: Queryable,
  notifications: Notifications
): Promise<SyncReport> {
  const report: SyncReport = { synced: [], failed: [] };
  const all = db.select().from(users).orderBy(users.id).all();

  // Sequential on purpose: Knock rate-limits bursts, and a backfill has no
  // deadline.
  for (const user of all) {
    try {
      await notifications.syncUser(toNotificationUser(user));
      report.synced.push(user.id);
    } catch (error) {
      console.error(`[notifications] Failed to sync user ${user.id}`, error);
      report.failed.push({
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/** A Platform Admin editing someone's name and email in admin users. */
export async function adminUpdateUser(
  db: Queryable,
  notifications: Notifications,
  userId: number,
  name: string,
  email: string
): Promise<UpdateResult> {
  const before = db.select().from(users).where(eq(users.id, userId)).get();
  if (!before) return { ok: false, status: 404, error: "User not found." };

  const emailOwner = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (emailOwner && emailOwner.id !== userId) {
    return {
      ok: false,
      status: 409,
      error: "Another user already has that email.",
    };
  }

  const after = db
    .update(users)
    .set({ name, email })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (!after) return { ok: false, status: 404, error: "User not found." };

  await syncUserAfterCommit(notifications, toNotificationUser(after));
  return { ok: true };
}
