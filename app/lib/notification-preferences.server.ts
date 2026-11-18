import { and, eq } from "drizzle-orm";
import {
  coupons,
  courses,
  purchases,
  teamMembers,
  TeamMemberRole,
  UserRole,
  users,
} from "~/db/schema";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationCategory,
  NotificationChannel,
  type NotificationPreferences,
} from "~/lib/notifications";
import type { Notifications } from "~/lib/notifications.server";
import type { Queryable } from "~/lib/refunds.server";

// ─── Notification preferences ───
// What a person sees on the Notifications card in /settings, and saving one
// switch.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type NotificationSetting = {
  category: NotificationCategory;
  enabled: boolean;
};

export type SettingsResult =
  | { ok: true; settings: NotificationSetting[] }
  | { ok: false; error: string };

/**
 * The categories this person could ever receive. It turns on what they are or
 * have, not their UserRole.
 */
function categoriesFor(
  db: Queryable,
  userId: number
): Set<NotificationCategory> {
  const shown = new Set<NotificationCategory>([
    NotificationCategory.DiscussionReplies,
  ]);

  const hasPurchase = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .get();
  if (hasPurchase) shown.add(NotificationCategory.RefundRequestUpdates);

  // Seat claimed Notifications go to the Team Admins of the claimed Seat's
  // team. A Team Licence is the Purchase behind a team's Seats, so a team with
  // Seats has one.
  const isTeamLicenceAdmin = db
    .select({ id: coupons.id })
    .from(teamMembers)
    .innerJoin(coupons, eq(coupons.teamId, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  if (isTeamLicenceAdmin) shown.add(NotificationCategory.SeatClaims);

  // Enrollments and Discussion Questions go to the course's owner, so owning a
  // course is what makes someone an Instructor here.
  const ownsCourse = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.instructorId, userId))
    .get();
  // Open Refund Requests go to every user whose role is admin, and being a
  // Platform Admin is nothing but that role.
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (user?.role === UserRole.Admin) {
    shown.add(NotificationCategory.OpenRefundRequests);
  }

  if (ownsCourse) {
    shown.add(NotificationCategory.Enrollments);
    shown.add(NotificationCategory.DiscussionQuestions);
  }

  return shown;
}

export async function getNotificationSettings(
  db: Queryable,
  notifications: Notifications,
  userId: number
): Promise<SettingsResult> {
  const shown = categoriesFor(db, userId);

  let stored: NotificationPreferences;
  try {
    stored = await notifications.getPreferences(userId);
  } catch (error) {
    console.error(
      `[notifications] Could not read preferences for user ${userId}`,
      error
    );
    return {
      ok: false,
      error: "Couldn't load your Notification settings. Try again in a moment.",
    };
  }

  const channel = NotificationChannel.Feed;
  // Catalogue order, so the card reads the same for everyone.
  const settings = Object.values(NotificationCategory)
    .filter((category) => shown.has(category))
    .map((category) => ({
      category,
      enabled:
        stored[category]?.[channel] ??
        DEFAULT_NOTIFICATION_PREFERENCES[category][channel],
    }));
  return { ok: true, settings };
}

export type SetPreferenceResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 502; error: string };

/** Saves one switch on the card: one category, on the feed. */
export async function setNotificationPreference(
  db: Queryable,
  notifications: Notifications,
  userId: number,
  category: NotificationCategory,
  enabled: boolean
): Promise<SetPreferenceResult> {
  // A hidden switch keeps its default, so it can't be set behind the card's back.
  if (!categoriesFor(db, userId).has(category)) {
    return {
      ok: false,
      status: 403,
      error: "You don't receive that kind of Notification.",
    };
  }

  try {
    await notifications.setPreference(
      userId,
      category,
      NotificationChannel.Feed,
      enabled
    );
  } catch (error) {
    console.error(
      `[notifications] Could not save ${category} for user ${userId}`,
      error
    );
    return {
      ok: false,
      status: 502,
      error: "Couldn't save that change. Try again in a moment.",
    };
  }
  return { ok: true };
}
