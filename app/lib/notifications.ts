// ─── Notifications: shared catalogue ───
// What a Notification is in Cadence's language, shared by the server (which
// sends trigger data) and the browser (which renders rows from it). The text
// of every row belongs to Cadence: it is built here from the trigger data, not
// from the vendor's templates. See GLOSSARY.md.
//
// Nothing here may import a vendor SDK.

import { formatPrice } from "~/lib/utils";

/** The catalogue of Notifications Cadence can send. */
export const NotificationType = {
  DiscussionReply: "discussion-reply",
  DiscussionQuestion: "discussion-question",
  RefundRequestConfirmation: "refund-request-confirmation",
  OpenRefundRequest: "open-refund-request",
  RefundRequestApproved: "refund-request-approved",
  RefundRequestDeclined: "refund-request-declined",
  SeatClaimed: "seat-claimed",
  NewEnrollment: "new-enrollment",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/**
 * A preference category a person can mute. Every catalogue Notification
 * belongs to exactly one.
 */
export const NotificationCategory = {
  RefundRequestUpdates: "refund-request-updates",
  OpenRefundRequests: "open-refund-requests",
  SeatClaims: "seat-claims",
  Enrollments: "enrollments",
  DiscussionQuestions: "discussion-questions",
  DiscussionReplies: "discussion-replies",
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
  [NotificationType.RefundRequestConfirmation]:
    NotificationCategory.RefundRequestUpdates,
  [NotificationType.OpenRefundRequest]: NotificationCategory.OpenRefundRequests,
  [NotificationType.RefundRequestApproved]:
    NotificationCategory.RefundRequestUpdates,
  [NotificationType.RefundRequestDeclined]:
    NotificationCategory.RefundRequestUpdates,
  [NotificationType.SeatClaimed]: NotificationCategory.SeatClaims,
  [NotificationType.NewEnrollment]: NotificationCategory.Enrollments,
};

// ─── Preferences (category × channel) ───

/**
 * Where a Notification can be delivered. Only the feed exists today; email
 * becomes a second channel later, with no change to stored preferences.
 */
export const NotificationChannel = {
  Feed: "feed",
} as const;

export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Whether each category is on, per channel. A missing entry has no preference yet. */
export type NotificationPreferences = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

/**
 * Everyone starts with every category on, except Enrollments: a popular course
 * would flood an Instructor's feed, so they opt in.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  [NotificationCategory.RefundRequestUpdates]: { feed: true },
  [NotificationCategory.OpenRefundRequests]: { feed: true },
  [NotificationCategory.SeatClaims]: { feed: true },
  [NotificationCategory.Enrollments]: { feed: false },
  [NotificationCategory.DiscussionQuestions]: { feed: true },
  [NotificationCategory.DiscussionReplies]: { feed: true },
};

/**
 * The defaults for the categories a user has no preference for yet. Syncing
 * writes only these, so a re-sync never overwrites a choice someone made, and a
 * category added to the catalogue later gets its default on the next sync.
 */
export function defaultsForMissingCategories(
  existingCategories: ReadonlySet<string>
): NotificationPreferences {
  const missing: NotificationPreferences = {};
  for (const category of Object.values(NotificationCategory)) {
    if (!existingCategories.has(category)) {
      missing[category] = { ...DEFAULT_NOTIFICATION_PREFERENCES[category] };
    }
  }
  return missing;
}

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

// Refund Request trigger data. Amounts are integer cents, as stored, so the
// row can format them the same way the rest of Cadence does.

/** Notification 8: the buyer's own Refund Request is waiting on a decision. */
export type RefundRequestConfirmationData = {
  refundRequestId: number;
  purchaseId: number;
  courseTitle: string;
  amountPaid: number;
};

/** Notification 3: a new Open Refund Request for a Platform Admin to decide. */
export type OpenRefundRequestData = {
  refundRequestId: number;
  purchaseId: number;
  // A snapshot alongside the sender, so the row still reads right if the
  // sender is missing.
  buyerName: string;
  courseTitle: string;
  amountPaid: number;
  reason: string;
  url: string;
};

/** Notification 1: the buyer's Refund Request was approved. */
export type RefundRequestApprovedData = {
  refundRequestId: number;
  purchaseId: number;
  courseTitle: string;
  amountPaid: number;
  decisionNote: string | null;
  url: string;
};

/** Notification 2: the buyer's Refund Request was declined. A note is required. */
export type RefundRequestDeclinedData = {
  refundRequestId: number;
  purchaseId: number;
  courseTitle: string;
  amountPaid: number;
  decisionNote: string;
  url: string;
};

/** Notification 4: a Seat on the Team Admin's Team Licence was claimed. */
export type SeatClaimedData = {
  seatId: number;
  purchaseId: number;
  // A snapshot alongside the sender, so the row still reads right if the
  // sender is missing.
  claimerName: string;
  courseTitle: string;
  /** Unclaimed Seats on the Team Licence right after this claim. */
  seatsLeft: number;
  url: string;
};

/** Notification 5: a Student enrolled in the Instructor's course. */
export type NewEnrollmentData = {
  enrollmentId: number;
  courseId: number;
  // A snapshot for the same reason as SeatClaimedData.claimerName.
  studentName: string;
  courseTitle: string;
  url: string;
};

/** Maps each catalogue Notification to the trigger data it carries. */
export type NotificationData = {
  [NotificationType.DiscussionReply]: DiscussionReplyData;
  [NotificationType.DiscussionQuestion]: DiscussionQuestionData;
  [NotificationType.RefundRequestConfirmation]: RefundRequestConfirmationData;
  [NotificationType.OpenRefundRequest]: OpenRefundRequestData;
  [NotificationType.RefundRequestApproved]: RefundRequestApprovedData;
  [NotificationType.RefundRequestDeclined]: RefundRequestDeclinedData;
  [NotificationType.SeatClaimed]: SeatClaimedData;
  [NotificationType.NewEnrollment]: NewEnrollmentData;
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

/** Where a Platform Admin decides Open Refund Requests. */
export const OPEN_REFUND_REQUESTS_URL = "/admin/refunds";

/** The buyer's own Refund Requests, on their Settings page. */
export const BUYER_REFUND_REQUESTS_URL = "/settings#refund-requests";

/** Where a Team Admin manages their Team Licences and Seats. */
export const TEAM_URL = "/team";

/** Where an Instructor sees who is enrolled in their course. */
export function courseStudentsUrl(courseId: number): string {
  return `/instructor/${courseId}/students`;
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
  /** `senderName` is null when Cadence itself sent it. */
  text: (data: NotificationData[T], senderName: string | null) => RowText;
};

// Every catalogue Notification must have a renderer: adding a type to
// `NotificationType` fails typecheck until it gets one here. Rows from a
// sender who has gone missing fall back to "Someone" unless the trigger data
// carries a snapshot of their name.
const ROW_RENDERERS: { [T in NotificationType]: RowRenderer<T> } = {
  [NotificationType.DiscussionReply]: {
    isData: isDiscussionReplyData,
    icon: "discussion",
    text: (data, senderName) => ({
      title: `${senderName ?? "Someone"} replied to your question on ${data.lessonTitle}`,
      snippet: data.snippet,
      href: data.url,
    }),
  },
  [NotificationType.DiscussionQuestion]: {
    isData: isDiscussionQuestionData,
    icon: "discussion",
    text: (data, senderName) => ({
      title: `${senderName ?? "Someone"} asked a question on ${data.lessonTitle}`,
      snippet: data.snippet,
      href: data.url,
    }),
  },
  [NotificationType.RefundRequestConfirmation]: {
    isData: isRefundRequestConfirmationData,
    icon: "refund",
    text: (data) => ({
      title: `Your refund request for ${data.courseTitle} is under review`,
      snippet: `${formatPrice(data.amountPaid)}. We review every refund request by hand.`,
      // Nothing to do yet, so clicking only marks it read.
      href: null,
    }),
  },
  [NotificationType.OpenRefundRequest]: {
    isData: isOpenRefundRequestData,
    icon: "refund",
    text: (data, senderName) => ({
      title: `${senderName ?? data.buyerName} asked for a refund on ${data.courseTitle}`,
      snippet: toSnippet(`${formatPrice(data.amountPaid)}: ${data.reason}`),
      href: data.url,
    }),
  },
  [NotificationType.RefundRequestApproved]: {
    isData: isRefundRequestApprovedData,
    icon: "refund",
    text: (data) => {
      const onItsWay = `${formatPrice(data.amountPaid)} is on its way back to you.`;
      return {
        title: `Your refund for ${data.courseTitle} was approved`,
        snippet: toSnippet(
          data.decisionNote ? `${onItsWay} ${data.decisionNote}` : onItsWay
        ),
        href: data.url,
      };
    },
  },
  [NotificationType.RefundRequestDeclined]: {
    isData: isRefundRequestDeclinedData,
    icon: "refund",
    text: (data) => ({
      title: `Your refund request for ${data.courseTitle} was declined`,
      snippet: toSnippet(
        `${data.decisionNote} You can raise a new refund request.`
      ),
      href: data.url,
    }),
  },
  [NotificationType.SeatClaimed]: {
    isData: isSeatClaimedData,
    icon: "team",
    text: (data, senderName) => ({
      title: `${senderName ?? data.claimerName} claimed a Seat on ${data.courseTitle}`,
      snippet: seatsLeftLabel(data.seatsLeft),
      href: data.url,
    }),
  },
  [NotificationType.NewEnrollment]: {
    isData: isNewEnrollmentData,
    icon: "enrollment",
    text: (data, senderName) => ({
      title: `${senderName ?? data.studentName} enrolled in ${data.courseTitle}`,
      snippet: "",
      href: data.url,
    }),
  },
};

function isNotificationType(type: string): type is NotificationType {
  return Object.hasOwn(ROW_RENDERERS, type);
}

// Looks the renderer up through a generic key so TypeScript keeps the
// renderer and its data correlated; indexing with the plain union would
// widen `text` to accept the intersection of every type's data.
function renderRow<T extends NotificationType>(
  type: T,
  data: unknown,
  senderName: string | null
): (RowText & { icon: NotificationIcon }) | null {
  const renderer: RowRenderer<T> = ROW_RENDERERS[type];
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
  const senderName = notification.sender?.name ?? null;

  const rendered = isNotificationType(notification.type)
    ? renderRow(notification.type, notification.data, senderName)
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

// ─── Refund Request rows ───

function hasRefundRequestFields(
  value: unknown
): value is Record<string, unknown> & RefundRequestConfirmationData {
  return (
    isRecord(value) &&
    isFiniteNumber(value.refundRequestId) &&
    isFiniteNumber(value.purchaseId) &&
    typeof value.courseTitle === "string" &&
    isFiniteNumber(value.amountPaid)
  );
}

export function isRefundRequestConfirmationData(
  value: unknown
): value is RefundRequestConfirmationData {
  return hasRefundRequestFields(value);
}

export function isOpenRefundRequestData(
  value: unknown
): value is OpenRefundRequestData {
  return (
    hasRefundRequestFields(value) &&
    typeof value.buyerName === "string" &&
    typeof value.reason === "string" &&
    isSameSitePath(value.url)
  );
}

export function isRefundRequestApprovedData(
  value: unknown
): value is RefundRequestApprovedData {
  return (
    hasRefundRequestFields(value) &&
    (value.decisionNote === null || typeof value.decisionNote === "string") &&
    isSameSitePath(value.url)
  );
}

export function isRefundRequestDeclinedData(
  value: unknown
): value is RefundRequestDeclinedData {
  return (
    hasRefundRequestFields(value) &&
    typeof value.decisionNote === "string" &&
    isSameSitePath(value.url)
  );
}

// ─── Seat claim and Enrollment rows ───

export function isSeatClaimedData(value: unknown): value is SeatClaimedData {
  return (
    isRecord(value) &&
    isFiniteNumber(value.seatId) &&
    isFiniteNumber(value.purchaseId) &&
    typeof value.claimerName === "string" &&
    typeof value.courseTitle === "string" &&
    isFiniteNumber(value.seatsLeft) &&
    isSameSitePath(value.url)
  );
}

export function isNewEnrollmentData(
  value: unknown
): value is NewEnrollmentData {
  return (
    isRecord(value) &&
    isFiniteNumber(value.enrollmentId) &&
    isFiniteNumber(value.courseId) &&
    typeof value.studentName === "string" &&
    typeof value.courseTitle === "string" &&
    isSameSitePath(value.url)
  );
}

function seatsLeftLabel(seatsLeft: number): string {
  if (seatsLeft <= 0) return "No Seats left";
  return seatsLeft === 1 ? "1 Seat left" : `${seatsLeft} Seats left`;
}
