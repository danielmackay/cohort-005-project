import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  connectNotificationFeed,
  mergeNotifications,
  type FeedCounts,
  type NotificationFeedClient,
} from "~/lib/notification-feed";
import type { FeedConnection, FeedNotification } from "~/lib/notifications";

// The bell's data layer: the live socket, token refresh, merging pages and
// live updates, and optimistic seen/read changes. The bell itself is only UI.

// ─── Notification Feed state: one live connection per signed-in user ───

type FeedState = {
  status: "connecting" | "ready" | "error";
  notifications: FeedNotification[];
  counts: FeedCounts;
  /** Cursor for the next (older) page, or null when everything is loaded. */
  nextCursor: string | null;
  loadingMore: boolean;
};

const INITIAL_STATE: FeedState = {
  status: "connecting",
  notifications: [],
  counts: { unseen: 0, unread: 0 },
  nextCursor: null,
  loadingMore: false,
};

async function refreshUserToken(userId: string): Promise<string> {
  const response = await fetch(
    `/api/notification-token?userId=${encodeURIComponent(userId)}`
  );
  if (!response.ok) {
    throw new Error(`Token refresh failed with ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("userToken" in body) ||
    typeof body.userToken !== "string"
  ) {
    throw new Error("Token refresh returned no token");
  }
  return body.userToken;
}

function reportFailure(message: string, error: unknown) {
  console.error(`[notification-feed] ${message}`, error);
  toast.error(message);
}

/**
 * Connects to the signed-in user's Notification Feed: reads the first page
 * (for the badge), then keeps it current over one live socket. A DevUI switch
 * hands in a different user, which tears the connection down and opens a new
 * one with that user's token.
 */
export function useNotificationFeed(connection: FeedConnection | null) {
  const [state, setState] = useState<FeedState>(INITIAL_STATE);
  const clientRef = useRef<NotificationFeedClient | null>(null);

  // Keyed on the user, not the token: the layout loader signs a new token on
  // every run, and reconnecting after each action would churn the socket.
  // Tokens are refreshed in place before they expire instead.
  const userId = connection?.userId ?? null;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    setState(INITIAL_STATE);
    const current = connectionRef.current;
    if (!current) {
      setState({ ...INITIAL_STATE, status: "ready" });
      return;
    }

    let disposed = false;
    let client: NotificationFeedClient | null = null;
    let unsubscribe: (() => void) | null = null;

    connectNotificationFeed(current, {
      refreshUserToken: () => refreshUserToken(current.userId),
    })
      .then(async (connected) => {
        if (disposed) {
          connected.dispose();
          return;
        }
        client = connected;
        clientRef.current = connected;
        unsubscribe = connected.subscribe((update) => {
          setState((s) => ({
            ...s,
            notifications: mergeNotifications(
              s.notifications,
              update.notifications
            ),
            counts: update.counts,
          }));
        });
        const page = await connected.list();
        if (disposed) return;
        setState((s) => ({
          ...s,
          status: "ready",
          notifications: mergeNotifications(
            s.notifications,
            page.notifications
          ),
          counts: page.counts,
          nextCursor: page.nextCursor,
        }));
      })
      .catch((error: unknown) => {
        console.error(
          "[notification-feed] Could not connect to the feed",
          error
        );
        if (!disposed) setState((s) => ({ ...s, status: "error" }));
      });

    return () => {
      disposed = true;
      unsubscribe?.();
      client?.dispose();
      clientRef.current = null;
    };
  }, [userId]);

  const loadMore = useCallback(() => {
    const client = clientRef.current;
    if (!client || state.loadingMore || !state.nextCursor) return;
    const cursor = state.nextCursor;
    setState((s) => ({ ...s, loadingMore: true }));
    client
      .list(cursor)
      .then((page) =>
        setState((s) => ({
          ...s,
          loadingMore: false,
          notifications: mergeNotifications(
            s.notifications,
            page.notifications
          ),
          nextCursor: page.nextCursor,
        }))
      )
      .catch((error: unknown) => {
        reportFailure("Couldn't load older Notifications", error);
        setState((s) => ({ ...s, loadingMore: false }));
      });
  }, [state.loadingMore, state.nextCursor]);

  const markAllSeen = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const before = state.counts.unseen;
    // Nothing unseen: skip the request rather than spend Knock's rate limit.
    if (before === 0) return;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      counts: { ...s.counts, unseen: 0 },
      notifications: s.notifications.map((n) =>
        n.seenAt ? n : { ...n, seenAt: now }
      ),
    }));
    client.markAllSeen().catch((error: unknown) => {
      reportFailure("Couldn't update your Notifications", error);
      setState((s) => ({ ...s, counts: { ...s.counts, unseen: before } }));
    });
  }, [state.counts.unseen]);

  const markRead = useCallback((notification: FeedNotification) => {
    const client = clientRef.current;
    if (!client || notification.readAt) return;
    const now = new Date().toISOString();
    const setRead = (readAt: string | null, delta: number) =>
      setState((s) => ({
        ...s,
        counts: { ...s.counts, unread: Math.max(0, s.counts.unread + delta) },
        notifications: s.notifications.map((n) =>
          n.id === notification.id ? { ...n, readAt } : n
        ),
      }));
    setRead(now, -1);
    client.markRead(notification.id).catch((error: unknown) => {
      reportFailure("Couldn't mark that Notification as read", error);
      setRead(null, 1);
    });
  }, []);

  const markAllRead = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const previous = state;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      counts: { ...s.counts, unread: 0 },
      notifications: s.notifications.map((n) =>
        n.readAt ? n : { ...n, readAt: now }
      ),
    }));
    client.markAllRead().catch((error: unknown) => {
      reportFailure("Couldn't mark your Notifications as read", error);
      setState((s) => ({
        ...s,
        counts: { ...s.counts, unread: previous.counts.unread },
        notifications: s.notifications.map(
          (n) => previous.notifications.find((p) => p.id === n.id) ?? n
        ),
      }));
    });
  }, [state]);

  return { state, loadMore, markAllSeen, markRead, markAllRead };
}

export type NotificationFeed = ReturnType<typeof useNotificationFeed>;
