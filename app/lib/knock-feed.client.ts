import Knock from "@knocklabs/client";
import type {
  FeedClientOptions,
  FeedCounts,
  FeedPage,
  FeedUpdate,
  NotificationFeedClient,
} from "~/lib/notification-feed";
import type { FeedConnection, FeedNotification } from "~/lib/notifications";

// ─── Knock adapter for the Notification Feed client port ───
// The only browser code that imports `@knocklabs/client`. Knock's feed items
// are read as untyped JSON and checked field by field before Cadence sees
// them, so nothing is cast unchecked.
//
// Knock's messages client resolves (rather than throws) on a 4xx, handing back
// the error body, so every status update checks the shape of what it got.

const PAGE_SIZE = 20;

// Ask for a fresh token a minute before the current one expires.
const TOKEN_REFRESH_LEAD_MS = 60_000;

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

function toFeedNotifications(entries: unknown): FeedNotification[] {
  if (!Array.isArray(entries)) {
    throw new Error("Knock returned feed entries that aren't a list");
  }
  const notifications: FeedNotification[] = [];
  for (const entry of entries) {
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
  return notifications;
}

function toCounts(meta: unknown): FeedCounts {
  if (
    !isRecord(meta) ||
    typeof meta.unseen_count !== "number" ||
    typeof meta.unread_count !== "number"
  ) {
    throw new Error("Knock returned feed metadata without counts");
  }
  return { unseen: meta.unseen_count, unread: meta.unread_count };
}

function toFeedPage(response: unknown): FeedPage {
  if (!isRecord(response)) {
    throw new Error("Knock returned an empty feed response");
  }
  const pageInfo = response.page_info;
  const after =
    isRecord(pageInfo) && typeof pageInfo.after === "string"
      ? pageInfo.after
      : null;
  return {
    notifications: toFeedNotifications(response.entries),
    nextCursor: after,
    counts: toCounts(response.meta),
  };
}

function describeFailure(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function connectKnockFeed(
  connection: FeedConnection,
  options: FeedClientOptions
): NotificationFeedClient {
  const knock = new Knock(connection.publicApiKey);
  // "skip": the server keeps Knock's user records current; the browser only reads.
  knock.authenticate({ id: connection.userId }, connection.userToken, {
    identificationStrategy: "skip",
    timeBeforeExpirationInMs: TOKEN_REFRESH_LEAD_MS,
    onUserTokenExpiring: async () => {
      try {
        return await options.refreshUserToken();
      } catch (error) {
        // Returning nothing leaves the old token in place; the feed stops
        // updating once it expires, until the page is reloaded.
        console.error(
          "[notification-feed] Could not refresh the feed token",
          error
        );
        return undefined;
      }
    },
  });
  // Only used for its live socket. Pages are read directly (below) because the
  // SDK's feed skips a fetch while another is in flight, and its own socket
  // handler fetches on every arrival.
  const feed = knock.feeds.initialize(connection.feedChannelId, {
    page_size: PAGE_SIZE,
    archived: "exclude",
  });
  let listening = false;

  async function bulkUpdate(status: "seen" | "read"): Promise<void> {
    // Bulk by channel: covers Notifications that haven't loaded, and never
    // sends an id list (an empty one is a 422).
    const result: unknown = await knock.messages.bulkUpdateAllStatusesInChannel(
      {
        channelId: connection.feedChannelId,
        status,
        options: { user_ids: [connection.userId], archived: "exclude" },
      }
    );
    if (!isRecord(result) || typeof result.id !== "string") {
      throw new Error(
        `Knock could not mark all ${status}: ${describeFailure(result)}`
      );
    }
  }

  return {
    async list(after) {
      const response = await knock.client().makeRequest({
        method: "GET",
        url: `/v1/users/${encodeURIComponent(connection.userId)}/feeds/${encodeURIComponent(connection.feedChannelId)}`,
        params: {
          page_size: PAGE_SIZE,
          archived: "exclude",
          ...(after ? { after } : {}),
        },
      });
      if (response.statusCode !== "ok") {
        throw new Error(
          `Knock could not load the feed (${response.status}): ${describeFailure(response.error ?? response.body)}`
        );
      }
      const body: unknown = response.body;
      return toFeedPage(body);
    },

    subscribe(listener) {
      const onRealtime = (payload: unknown) => {
        try {
          if (!isRecord(payload)) {
            throw new Error("Knock sent a live update without a payload");
          }
          const update: FeedUpdate = {
            notifications: toFeedNotifications(payload.items),
            counts: toCounts(payload.metadata),
          };
          listener(update);
        } catch (error) {
          console.error(
            "[notification-feed] Could not read a live update",
            error
          );
        }
      };
      feed.on("items.received.realtime", onRealtime);
      if (!listening) {
        listening = true;
        feed.listenForUpdates();
      }
      return () => feed.off("items.received.realtime", onRealtime);
    },

    async markRead(notificationId) {
      if (!notificationId) return;
      const result: unknown = await knock.messages.batchUpdateStatuses(
        [notificationId],
        "read"
      );
      if (!Array.isArray(result)) {
        throw new Error(
          `Knock could not mark ${notificationId} read: ${describeFailure(result)}`
        );
      }
    },

    markAllSeen: () => bulkUpdate("seen"),
    markAllRead: () => bulkUpdate("read"),

    dispose() {
      feed.dispose();
      knock.logout();
    },
  };
}
