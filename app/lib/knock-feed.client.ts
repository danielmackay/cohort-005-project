import Knock from "@knocklabs/client";
import type { NotificationFeedClient, FeedPage } from "~/lib/notification-feed";
import type { FeedConnection, FeedNotification } from "~/lib/notifications";

// ─── Knock adapter for the Notification Feed client port ───
// The only browser code that imports `@knocklabs/client`. Knock's feed items
// are read as untyped JSON and checked field by field before Cadence sees
// them, so nothing is cast unchecked.

const PAGE_SIZE = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSender(actors: unknown): FeedNotification["sender"] {
  if (!Array.isArray(actors)) return null;
  const actor: unknown = actors[0];
  if (!isRecord(actor) || typeof actor.name !== "string") return null;
  return {
    name: actor.name,
    avatarUrl: typeof actor.avatar === "string" ? actor.avatar : null,
  };
}

function toFeedNotification(item: unknown): FeedNotification | null {
  if (
    !isRecord(item) ||
    typeof item.id !== "string" ||
    typeof item.inserted_at !== "string" ||
    !isRecord(item.source) ||
    typeof item.source.key !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    // The workflow key is the catalogue Notification's type.
    type: item.source.key,
    sender: toSender(item.actors),
    data: item.data ?? null,
    insertedAt: item.inserted_at,
    readAt: typeof item.read_at === "string" ? item.read_at : null,
    seenAt: typeof item.seen_at === "string" ? item.seen_at : null,
  };
}

function toFeedPage(response: unknown): FeedPage {
  if (!isRecord(response) || !Array.isArray(response.entries)) {
    throw new Error("Knock returned a feed response without entries");
  }
  const notifications: FeedNotification[] = [];
  for (const entry of response.entries) {
    const notification = toFeedNotification(entry);
    if (notification) {
      notifications.push(notification);
    } else {
      console.error(
        "[notification-feed] Skipping a malformed Knock feed item",
        entry
      );
    }
  }
  const pageInfo = response.page_info;
  const after =
    isRecord(pageInfo) && typeof pageInfo.after === "string"
      ? pageInfo.after
      : null;
  return { notifications, nextCursor: after };
}

export function connectKnockFeed(
  connection: FeedConnection
): NotificationFeedClient {
  const knock = new Knock(connection.publicApiKey);
  // "skip": the server keeps Knock's user records current; the browser only reads.
  knock.authenticate({ id: connection.userId }, connection.userToken, {
    identificationStrategy: "skip",
  });
  const feed = knock.feeds.initialize(connection.feedChannelId, {
    page_size: PAGE_SIZE,
    archived: "exclude",
  });

  return {
    async list(after) {
      const result = await feed.fetch(after ? { after } : undefined);
      // Knock skips a fetch (returning undefined) when one is already in flight.
      if (!result) throw new Error("Knock skipped the feed fetch");
      if (result.status !== "ok") {
        throw new Error(
          `Knock could not load the feed: ${JSON.stringify(result.data)}`
        );
      }
      const response: unknown = result.data;
      return toFeedPage(response);
    },

    dispose() {
      feed.dispose();
      knock.logout();
    },
  };
}
