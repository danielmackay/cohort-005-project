import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Popover } from "radix-ui";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "~/components/user-avatar";
import {
  connectNotificationFeed,
  mergeNotifications,
  type FeedCounts,
  type NotificationFeedClient,
} from "~/lib/notification-feed";
import {
  describeNotification,
  unseenBadgeLabel,
  type FeedConnection,
  type FeedNotification,
  type NotificationIcon,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── Feed state: one live connection per signed-in user ───

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
function useNotificationFeed(connection: FeedConnection | null) {
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

type Feed = ReturnType<typeof useNotificationFeed>;

// ─── The bell ───

/**
 * The bell in the sidebar header, with a badge counting unseen Notifications.
 * Opening it marks them all seen (not read). With no connection (Knock not
 * configured) it shows the empty state.
 */
export function NotificationBell({
  connection,
}: {
  connection: FeedConnection | null;
}) {
  const feed = useNotificationFeed(connection);
  const [open, setOpen] = useState(false);
  const badge = unseenBadgeLabel(feed.state.counts.unseen);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) feed.markAllSeen();
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            badge ? `Notifications (${badge} unseen)` : "Notifications"
          }
          className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
          {badge && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="z-50 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
            <Bell className="size-4" />
            <span className="font-semibold">Notifications</span>
            <button
              type="button"
              onClick={feed.markAllRead}
              disabled={feed.state.counts.unread === 0}
              className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
            >
              Mark all as read
            </button>
          </div>
          <FeedList feed={feed} close={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FeedList({ feed, close }: { feed: Feed; close: () => void }) {
  const { state, loadMore } = feed;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasRows = state.status === "ready" && state.notifications.length > 0;

  // Infinite scroll: load the next page when the end of the list comes into
  // view. Re-observing after each page fires again if the end is still visible.
  useEffect(() => {
    if (!hasRows) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: scrollRef.current }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasRows]);

  if (state.status === "connecting") {
    return <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="p-8 text-center text-sm text-destructive">
        Couldn't load your Notifications. Try again in a moment.
      </p>
    );
  }
  if (state.notifications.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        You're all caught up.
      </p>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <ul>
        {state.notifications.map((notification) => (
          <li key={notification.id}>
            <NotificationRow
              notification={notification}
              markRead={feed.markRead}
              close={close}
            />
          </li>
        ))}
      </ul>
      <div
        ref={sentinelRef}
        className="p-3 text-center text-xs text-muted-foreground"
      >
        {state.loadingMore
          ? "Loading…"
          : state.nextCursor === null && "That's everything."}
      </div>
    </div>
  );
}

const ICONS: Record<NotificationIcon, React.ReactNode> = {
  discussion: <MessageSquare />,
  refund: <Receipt />,
  team: <UsersRound />,
  enrollment: <GraduationCap />,
  generic: <Bell />,
};

function NotificationRow({
  notification,
  markRead,
  close,
}: {
  notification: FeedNotification;
  markRead: (notification: FeedNotification) => void;
  close: () => void;
}) {
  const navigate = useNavigate();
  const row = describeNotification(notification);
  const isRead = notification.readAt !== null;

  useEffect(() => {
    if (!row.recognised) {
      console.error(
        `[notification-feed] Unrecognised Notification ${notification.id} (${notification.type})`,
        notification.data
      );
    }
  }, [row.recognised, notification.id, notification.type, notification.data]);

  // Marks it read, then goes to the most specific place there is. With
  // nowhere to go (e.g. a Refund Request confirmation), the popover stays open.
  function onOpen() {
    markRead(notification);
    if (!row.href) return;
    close();
    navigate(row.href);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
      <span className="relative shrink-0">
        {row.avatar.kind === "sender" ? (
          <UserAvatar
            name={row.avatar.name}
            avatarUrl={row.avatar.avatarUrl}
            className={cn("size-9", isRead && "opacity-60")}
          />
        ) : (
          <span
            aria-label="Cadence"
            className={cn(
              "flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
              isRead && "opacity-60"
            )}
          >
            C
          </span>
        )}
        <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
          {ICONS[row.icon]}
        </span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn("block truncate text-sm", !isRead && "font-semibold")}
        >
          {row.title}
        </span>
        <span
          className="block truncate text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          {row.snippet && `${row.snippet} · `}
          {formatRelativeTime(notification.insertedAt)}
        </span>
      </button>
      {!isRead && (
        <button
          type="button"
          onClick={() => markRead(notification)}
          title="Mark as read"
          aria-label="Mark as read"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-primary"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}
