import type { FeedConnection, FeedNotification } from "~/lib/notifications";

// ─── Notification Feed: client port ───
// The only way feed components talk to the vendor, in Cadence's language. The
// Knock adapter (`knock-feed.client.ts`) is the only browser code that imports
// `@knocklabs/client`. It is loaded lazily because the vendor SDK needs
// `window` and must never run during server rendering.

export type FeedPage = {
  /** Newest first. */
  notifications: FeedNotification[];
  /** Pass to `list` for the next (older) page, or null at the end. */
  nextCursor: string | null;
};

export interface NotificationFeedClient {
  /** One page of the signed-in user's Notifications, newest first. */
  list(after?: string | null): Promise<FeedPage>;
  /** Closes every connection. The client can't be used afterwards. */
  dispose(): void;
}

export async function connectNotificationFeed(
  connection: FeedConnection
): Promise<NotificationFeedClient> {
  const { connectKnockFeed } = await import("~/lib/knock-feed.client");
  return connectKnockFeed(connection);
}
