import type {
  Notifications,
  OutgoingNotification,
} from "~/lib/notifications.server";

// In-memory Notifications adapter for tests. Records every call and can be told
// to fail, so services can be tested without Knock.

export type FakeNotifications = Notifications & {
  notified: OutgoingNotification[];
  /** Makes every later call reject with this error. */
  failWith(error: Error): void;
};

export function createFakeNotifications(): FakeNotifications {
  const notified: OutgoingNotification[] = [];
  let failure: Error | null = null;

  return {
    notified,
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
  };
}
