import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { NOTIFICATION_SETTINGS_ID } from "~/components/notification-settings-card";
import { Popover } from "radix-ui";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  Settings,
  UsersRound,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  useNotificationFeed,
  type NotificationFeed,
} from "~/lib/use-notification-feed";
import {
  describeNotification,
  unseenBadgeLabel,
  type FeedConnection,
  type FeedNotification,
  type NotificationIcon,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

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
            <Link
              to={`/settings#${NOTIFICATION_SETTINGS_ID}`}
              onClick={() => setOpen(false)}
              aria-label="Notification settings"
              title="Notification settings"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-4" />
            </Link>
          </div>
          <FeedList feed={feed} close={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FeedList({ feed, close }: { feed: NotificationFeed; close: () => void }) {
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
