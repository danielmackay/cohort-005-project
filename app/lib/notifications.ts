// ─── Notifications: shared catalogue ───
// What a Notification is in Cadence's language, shared by the server (which
// sends trigger data) and the browser (which renders rows from it). The text
// of every row belongs to Cadence: it is built here from the trigger data, not
// from the vendor's templates. See GLOSSARY.md.
//
// Nothing here may import a vendor SDK.

/** The catalogue of Notifications Cadence can send. */
export const NotificationType = {
  DiscussionReply: "discussion-reply",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/**
 * A preference category a person can mute. Every catalogue Notification
 * belongs to exactly one.
 */
export const NotificationCategory = {
  DiscussionReplies: "discussion-replies",
} as const;

export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const NOTIFICATION_CATEGORY: Record<
  NotificationType,
  NotificationCategory
> = {
  [NotificationType.DiscussionReply]: NotificationCategory.DiscussionReplies,
};

/** Trigger data for a Discussion Reply Notification. A snapshot taken when sent. */
export type DiscussionReplyData = {
  // Kept as top-level scalars: the vendor can only filter trigger data on
  // top-level scalar values, and deleting a comment archives by commentId.
  commentId: number;
  questionId: number;
  lessonId: number;
  lessonTitle: string;
  courseSlug: string;
  snippet: string;
  url: string;
};

/** Maps each catalogue Notification to the trigger data it carries. */
export type NotificationData = {
  [NotificationType.DiscussionReply]: DiscussionReplyData;
};

// ─── Snippets and links ───

export const SNIPPET_MAX_LENGTH = 140;

/** One line of a comment body, cut to fit a feed row. */
export function toSnippet(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SNIPPET_MAX_LENGTH) return oneLine;
  return `${oneLine.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd()}…`;
}

export function commentUrl(
  courseSlug: string,
  lessonId: number,
  commentId: number
): string {
  return `/courses/${courseSlug}/lessons/${lessonId}#comment-${commentId}`;
}

// ─── Reading trigger data back (browser) ───
// Trigger data comes back from the vendor as untyped JSON, so every field is
// checked before it is used. Nothing is cast unchecked.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isDiscussionReplyData(
  value: unknown
): value is DiscussionReplyData {
  return (
    isRecord(value) &&
    isFiniteNumber(value.commentId) &&
    isFiniteNumber(value.questionId) &&
    isFiniteNumber(value.lessonId) &&
    typeof value.lessonTitle === "string" &&
    typeof value.courseSlug === "string" &&
    typeof value.snippet === "string" &&
    typeof value.url === "string" &&
    // Only same-site paths: the link comes from trigger data, which a
    // malformed or hostile payload could point anywhere.
    value.url.startsWith("/")
  );
}

/**
 * What the browser needs to read the signed-in user's Notification Feed,
 * handed over by the layout loader (not a `VITE_` variable).
 */
export type FeedConnection = {
  publicApiKey: string;
  feedChannelId: string;
  userId: string;
  /** Signed for `userId` only: it can't read anyone else's feed. */
  userToken: string;
};

/** A Notification as the feed shows it, after reading it from the vendor. */
export type FeedNotification = {
  id: string;
  type: string;
  sender: { name: string; avatarUrl: string | null } | null;
  data: unknown;
  insertedAt: string;
  readAt: string | null;
  seenAt: string | null;
};

const BADGE_CAP = 9;

/** The bell's badge text for an unseen count, or null when there's no badge. */
export function unseenBadgeLabel(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > BADGE_CAP ? `${BADGE_CAP}+` : String(unseenCount);
}

/**
 * The small icon at the bottom-right of a row's avatar. "generic" is for a
 * Notification the feed couldn't recognise.
 */
export type NotificationIcon =
  | "discussion"
  | "refund"
  | "team"
  | "enrollment"
  | "generic";

/** The sender's real avatar, or Cadence's "C" when Cadence itself sent it. */
export type NotificationAvatar =
  | { kind: "sender"; name: string; avatarUrl: string | null }
  | { kind: "cadence" };

export type NotificationRow = {
  title: string;
  snippet: string;
  /** Where clicking the row goes, or null when there is nowhere to go. */
  href: string | null;
  icon: NotificationIcon;
  avatar: NotificationAvatar;
  /** False when the type or data wasn't recognised and a generic row is shown. */
  recognised: boolean;
};

type RowText = Pick<NotificationRow, "title" | "snippet" | "href">;

/** How the feed renders one catalogue Notification. */
type RowRenderer<T extends NotificationType> = {
  /** Checks untyped trigger data before `text` sees it. */
  isData: (value: unknown) => value is NotificationData[T];
  icon: Exclude<NotificationIcon, "generic">;
  text: (data: NotificationData[T], senderName: string) => RowText;
};

// Every catalogue Notification must have a renderer: adding a type to
// `NotificationType` fails typecheck until it gets one here.
const ROW_RENDERERS: { [T in NotificationType]: RowRenderer<T> } = {
  [NotificationType.DiscussionReply]: {
    isData: isDiscussionReplyData,
    icon: "discussion",
    text: (data, senderName) => ({
      title: `${senderName} replied to your question on ${data.lessonTitle}`,
      snippet: data.snippet,
      href: data.url,
    }),
  },
};

function isNotificationType(type: string): type is NotificationType {
  return Object.hasOwn(ROW_RENDERERS, type);
}

// Narrows the renderer and its data together, which TypeScript can't do
// through an index on a union key.
function renderRow<T extends NotificationType>(
  renderer: RowRenderer<T>,
  data: unknown,
  senderName: string
): (RowText & { icon: NotificationIcon }) | null {
  if (!renderer.isData(data)) return null;
  return { ...renderer.text(data, senderName), icon: renderer.icon };
}

/**
 * Builds a feed row's text, link, icon and avatar from a Notification. An
 * unknown type or data that fails its type guard gets a generic row rather
 * than a cast; the caller logs it.
 */
export function describeNotification(
  notification: FeedNotification
): NotificationRow {
  const avatar: NotificationAvatar = notification.sender
    ? {
        kind: "sender",
        name: notification.sender.name,
        avatarUrl: notification.sender.avatarUrl,
      }
    : { kind: "cadence" };
  const senderName = notification.sender?.name ?? "Someone";

  const rendered = isNotificationType(notification.type)
    ? renderRow(
        ROW_RENDERERS[notification.type],
        notification.data,
        senderName
      )
    : null;

  if (rendered) return { ...rendered, avatar, recognised: true };
  return {
    title: "New notification",
    snippet: "",
    href: null,
    icon: "generic",
    avatar,
    recognised: false,
  };
}
