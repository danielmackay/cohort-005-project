import {
  defaultsForMissingCategories,
  type NotificationPreferences,
} from "~/lib/notifications";
import type {
  NotificationUser,
  Notifications,
  OutgoingNotification,
} from "~/lib/notifications.server";

// In-memory Notifications adapter for tests. Records every call and can be told
// to fail, so services can be tested without Knock.

export type FakeNotifications = Notifications & {
  notified: OutgoingNotification[];
  /** Every user synced, in order. */
  synced: NotificationUser[];
  /** Each user's stored preferences, by user id. Seed it to model a user who already has some. */
  preferences: Map<number, NotificationPreferences>;
  /** Makes every later call reject with this error. */
  failWith(error: Error): void;
};

export function createFakeNotifications(): FakeNotifications {
  const notified: OutgoingNotification[] = [];
  const synced: NotificationUser[] = [];
  const preferences = new Map<number, NotificationPreferences>();
  let failure: Error | null = null;

  return {
    notified,
    synced,
    preferences,
    failWith(error) {
      failure = error;
    },
    async notify(notification) {
      if (failure) throw failure;
      notified.push(notification);
    },
    async signUserToken(userId) {
      if (failure) throw failure;
      return `fake-token-for-${userId}`;
    },
    async syncUser(user) {
      if (failure) throw failure;
      synced.push({ ...user });
      // Same rule as the Knock adapter: fill in missing categories, merge.
      const existing = preferences.get(user.id) ?? {};
      preferences.set(user.id, {
        ...existing,
        ...defaultsForMissingCategories(new Set(Object.keys(existing))),
      });
    },
  };
}
