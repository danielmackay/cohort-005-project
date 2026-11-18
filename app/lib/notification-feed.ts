import type { FeedConnection, FeedNotification } from "~/lib/notifications";

// ─── Notification Feed: client port ───
// The only way feed components talk to the vendor, in Cadence's language. The
// Knock adapter (`knock-feed.client.ts`) is the only browser code that imports
// `@knocklabs/client`. It is loaded lazily because the vendor SDK needs
// `window` and must never run during server rendering.

export type FeedCounts = {
  /** Drives the bell's badge. Opening the popover marks everything seen. */
  unseen: number;
  /** Seen isn't read: this only drops when Notifications are marked read. */
  unread: number;
};

export type FeedPage = {
  /** Newest first. */
  notifications: FeedNotification[];
  /** Pass to `list` for the next (older) page, or null at the end. */
  nextCursor: string | null;
  counts: FeedCounts;
};

/** What a live update carries: the newest Notifications and fresh counts. */
export type FeedUpdate = {
  /** Newest first. May overlap Notifications already loaded. */
  notifications: FeedNotification[];
  counts: FeedCounts;
};

export interface NotificationFeedClient {
  /** One page of the signed-in user's Notifications, newest first. */
  list(after?: string | null): Promise<FeedPage>;
  /**
   * Listens for Notifications arriving live over the vendor's socket. There
   * is one socket per client, so the badge and popover share it. Nothing
   * polls: repeated feed reads are rate limited. Returns an unsubscribe.
   */
  subscribe(listener: (update: FeedUpdate) => void): () => void;
  markRead(notificationId: string): Promise<void>;
  /** Every Notification the user has, loaded or not. Doesn't mark them read. */
  markAllSeen(): Promise<void>;
  /** Every Notification the user has, loaded or not. */
  markAllRead(): Promise<void>;
  /** Closes every connection. The client can't be used afterwards. */
  dispose(): void;
}

export type FeedClientOptions = {
  /**
   * Fetches a freshly signed token for the same user, called before the
   * current one expires so a long-open tab keeps its live connection.
   */
  refreshUserToken: () => Promise<string>;
};

export async function connectNotificationFeed(
  connection: FeedConnection,
  options: FeedClientOptions
): Promise<NotificationFeedClient> {
  const { connectKnockFeed } = await import("~/lib/knock-feed.client");
  return connectKnockFeed(connection, options);
}

/**
 * Merges newly read Notifications (an older page, or the first page re-read
 * after a live update) into what's loaded: one row per Notification, newest
 * first, with the incoming copy winning so its read and seen state is current.
 */
export function mergeNotifications(
  loaded: FeedNotification[],
  incoming: FeedNotification[]
): FeedNotification[] {
  const byId = new Map(loaded.map((n) => [n.id, n]));
  for (const notification of incoming) byId.set(notification.id, notification);
  return [...byId.values()].sort((a, b) =>
    b.insertedAt.localeCompare(a.insertedAt)
  );
}
