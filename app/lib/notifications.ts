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
  DiscussionQuestion: "discussion-question",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/**
 * A preference category a person can mute. Every catalogue Notification
 * belongs to exactly one.
 */
export const NotificationCategory = {
  DiscussionReplies: "discussion-replies",
  DiscussionQuestions: "discussion-questions",
} as const;

export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const NOTIFICATION_CATEGORY: Record<
  NotificationType,
  NotificationCategory
> = {
  [NotificationType.DiscussionReply]: NotificationCategory.DiscussionReplies,
  [NotificationType.DiscussionQuestion]:
    NotificationCategory.DiscussionQuestions,
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

/** Trigger data for a Discussion Question Notification. A snapshot taken when sent. */
export type DiscussionQuestionData = {
  // Top-level scalar for the same reason as DiscussionReplyData.commentId.
  commentId: number;
  lessonId: number;
  lessonTitle: string;
  courseSlug: string;
  snippet: string;
  url: string;
};

/** Maps each catalogue Notification to the trigger data it carries. */
export type NotificationData = {
  [NotificationType.DiscussionReply]: DiscussionReplyData;
  [NotificationType.DiscussionQuestion]: DiscussionQuestionData;
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
    isSameSitePath(value.url)
  );
}

export function isDiscussionQuestionData(
  value: unknown
): value is DiscussionQuestionData {
  return (
    isRecord(value) &&
    isFiniteNumber(value.commentId) &&
    isFiniteNumber(value.lessonId) &&
    typeof value.lessonTitle === "string" &&
    typeof value.courseSlug === "string" &&
    typeof value.snippet === "string" &&
    isSameSitePath(value.url)
  );
}

// Only same-site paths: the link comes from trigger data, which a malformed or
// hostile payload could point anywhere. "//host" and "/\host" are
// protocol-relative in browsers, so they leave the site too.
function isSameSitePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
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

export type NotificationRow = {
  title: string;
  snippet: string;
  /** Where clicking the row goes, or null when there is nowhere to go. */
  href: string | null;
  /** False when the type or data wasn't recognised and a generic row is shown. */
  recognised: boolean;
};

/**
 * Builds a feed row's text and link from a Notification. An unknown type or
 * data that fails its type guard gets a generic row rather than a cast.
 */
export function describeNotification(
  notification: FeedNotification
): NotificationRow {
  const senderName = notification.sender?.name ?? "Someone";

  if (
    notification.type === NotificationType.DiscussionReply &&
    isDiscussionReplyData(notification.data)
  ) {
    const data = notification.data;
    return {
      title: `${senderName} replied to your question on ${data.lessonTitle}`,
      snippet: data.snippet,
      href: data.url,
      recognised: true,
    };
  }

  if (
    notification.type === NotificationType.DiscussionQuestion &&
    isDiscussionQuestionData(notification.data)
  ) {
    const data = notification.data;
    return {
      title: `${senderName} asked a question on ${data.lessonTitle}`,
      snippet: data.snippet,
      href: data.url,
      recognised: true,
    };
  }

  return {
    title: "New notification",
    snippet: "",
    href: null,
    recognised: false,
  };
}
