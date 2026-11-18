import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Popover } from "radix-ui";
import { Bell } from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  connectNotificationFeed,
  type NotificationFeedClient,
} from "~/lib/notification-feed";
import {
  describeNotification,
  type FeedConnection,
  type FeedNotification,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

type FeedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; notifications: FeedNotification[] }
  | { status: "error" };

/**
 * The bell in the sidebar header. Opening it lists the signed-in user's
 * Notifications, newest first. With no connection (signed out, or Knock not
 * configured) it shows the empty state.
 */
export function NotificationBell({
  connection,
}: {
  connection: FeedConnection | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FeedState>({ status: "idle" });
  const clientRef = useRef<Promise<NotificationFeedClient> | null>(null);

  // One client per signed-in user and token. A DevUI switch hands in a new
  // connection, so the old client is torn down before the new user's feed is
  // read with its own token.
  const userId = connection?.userId ?? null;
  const userToken = connection?.userToken ?? null;
  useEffect(() => {
    setState({ status: "idle" });
    if (!connection) return;
    const client = connectNotificationFeed(connection);
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client
        .then((c) => c.dispose())
        .catch((error: unknown) =>
          console.error("[notification-feed] Could not close the feed", error)
        );
    };
    // Keyed on the identity and token, not the object, which is new on every
    // loader run.
  }, [userId, userToken]);

  useEffect(() => {
    if (!open) return;
    const client = clientRef.current;
    if (!client) {
      setState({ status: "loaded", notifications: [] });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    client
      .then((c) => c.list())
      .then((page) => {
        if (!cancelled) {
          setState({ status: "loaded", notifications: page.notifications });
        }
      })
      .catch((error: unknown) => {
        console.error(
          "[notification-feed] Could not load Notifications",
          error
        );
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId, userToken]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-80 rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b px-4 py-3 text-sm font-semibold">
            Notifications
          </div>
          <FeedBody state={state} onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FeedBody({
  state,
  onNavigate,
}: {
  state: FeedState;
  onNavigate: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="px-4 py-6 text-sm text-destructive">
        Couldn't load your Notifications. Try again in a moment.
      </p>
    );
  }
  if (state.notifications.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        You're all caught up.
      </p>
    );
  }
  return (
    <ul className="max-h-96 divide-y overflow-y-auto">
      {state.notifications.map((notification) => (
        <li key={notification.id}>
          <NotificationRow
            notification={notification}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );
}

function NotificationRow({
  notification,
  onNavigate,
}: {
  notification: FeedNotification;
  onNavigate: () => void;
}) {
  const row = describeNotification(notification);

  useEffect(() => {
    if (!row.recognised) {
      console.error(
        `[notification-feed] Unrecognised Notification ${notification.id} (${notification.type})`,
        notification.data
      );
    }
  }, [row.recognised, notification]);

  const content = (
    <div className="flex items-start gap-3 px-4 py-3">
      <UserAvatar
        name={notification.sender?.name ?? "Cadence"}
        avatarUrl={notification.sender?.avatarUrl ?? null}
        className={cn("size-8 shrink-0", notification.readAt && "opacity-60")}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", !notification.readAt && "font-semibold")}>
          {row.title}
        </p>
        {row.snippet && (
          <p className="truncate text-sm text-muted-foreground">
            {row.snippet}
          </p>
        )}
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {formatRelativeTime(notification.insertedAt)}
        </p>
      </div>
    </div>
  );

  if (!row.href) return content;
  return (
    <Link to={row.href} onClick={onNavigate} className="block hover:bg-muted">
      {content}
    </Link>
  );
}
