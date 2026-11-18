import { existsSync } from "node:fs";
import type {
  FeedConnection,
  NotificationCategory,
  NotificationChannel,
  NotificationData,
  NotificationPreferences,
  NotificationType,
} from "~/lib/notifications";

// ─── Notifications: server port ───
// The one way server code sends Notifications, in Cadence's language and
// shaped like MailTransport. Services take a `Notifications` as a parameter so
// tests can hand in the in-memory fake (`app/test/fake-notifications.ts`).
//
// Adapters:
// - Knock (`knock-notifications.server.ts`): the only server code that
//   imports Knock.
// - No-op (below): logs instead of sending when no Knock secret key is set,
//   like the `.outbox/` fallback for email.
// - In-memory fake (tests).

/** A Cadence user as a Notification names them, as recipient or sender. */
export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** One catalogue Notification to send. */
export type OutgoingNotification<
  T extends NotificationType = NotificationType,
> = {
  type: T;
  recipients: NotificationUser[];
  /** Who caused it, or null when Cadence itself sent it. */
  sender: NotificationUser | null;
  data: NotificationData[T];
  /** One per domain event, e.g. `discussion-reply:<commentId>`. */
  idempotencyKey: string;
};

export interface Notifications {
  notify<T extends NotificationType>(
    notification: OutgoingNotification<T>
  ): Promise<void>;
  /** Signs a token that lets the browser read only this user's Notification Feed. */
  signUserToken(userId: number): Promise<string>;
  /**
   * Archives every Notification whose trigger data names this comment as its
   * `commentId`, so it leaves every recipient's feed. Notifications that only
   * mention it as `questionId` (replies under a question) are left alone.
   */
  archiveForComment(commentId: number): Promise<void>;
  /**
   * Sync user: tells the vendor the user's current name, email and avatar, and
   * writes the default Notification preferences for every category the user
   * has no preference for yet. Never overwrites an existing preference.
   */
  syncUser(user: NotificationUser): Promise<void>;
  /**
   * The user's stored Notification preferences. A category or channel with no
   * stored preference is missing, so the caller applies Cadence's default.
   */
  getPreferences(userId: number): Promise<NotificationPreferences>;
  /** Sets one category on one channel, leaving every other preference alone. */
  setPreference(
    userId: number,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean
  ): Promise<void>;
}

/**
 * Sends a Notification after a domain write has committed. A failure is logged
 * and swallowed on purpose: a vendor outage must never fail or roll back the
 * action that caused the Notification. There are no retries.
 */
export async function notifyAfterCommit<T extends NotificationType>(
  notifications: Notifications,
  notification: OutgoingNotification<T>
): Promise<void> {
  try {
    await notifications.notify(notification);
  } catch (error) {
    console.error(
      `[notifications] Failed to send ${notification.type} (${notification.idempotencyKey})`,
      error
    );
  }
}

/**
 * Archives a comment's Notifications after its soft delete has committed.
 * Like notifyAfterCommit, a failure is logged and never fails the delete.
 */
export async function archiveForCommentAfterCommit(
  notifications: Notifications,
  commentId: number
): Promise<void> {
  try {
    await notifications.archiveForComment(commentId);
  } catch (error) {
    console.error(
      `[notifications] Failed to archive Notifications for comment ${commentId}`,
      error
    );
  }
}

/**
 * Syncs a user after their row has been written. Like `notifyAfterCommit`, a
 * failure is logged and swallowed: a vendor outage must never fail signup or a
 * profile edit. Triggers identify their recipients inline, so a user whose
 * sync failed still receives Notifications.
 */
export async function syncUserAfterCommit(
  notifications: Notifications,
  user: NotificationUser
): Promise<void> {
  try {
    await notifications.syncUser(user);
  } catch (error) {
    console.error(`[notifications] Failed to sync user ${user.id}`, error);
  }
}

// ─── No-op adapter ───

export function loggingNotifications(
  log: (message: string) => void = console.info
): Notifications {
  return {
    async notify(notification) {
      log(
        `[notifications] Knock is not configured; not sending ${notification.type} ` +
          `to ${notification.recipients.map((r) => r.id).join(", ")} ` +
          `(${notification.idempotencyKey}): ${JSON.stringify(notification.data)}`
      );
    },
    async signUserToken() {
      throw new Error(
        "Knock is not configured, so no user token can be signed"
      );
    },
    async archiveForComment(commentId) {
      log(
        `[notifications] Knock is not configured; not archiving Notifications for comment ${commentId}`
      );
    },
    async syncUser(user) {
      log(
        `[notifications] Knock is not configured; not syncing user ${user.id}`
      );
    },
    async getPreferences() {
      // Nothing is stored anywhere, so every category shows its default.
      return {};
    },
    async setPreference() {
      // Thrown rather than logged: pretending to save would show a switch that
      // snaps back on the next reload.
      throw new Error(
        "Knock is not configured, so Notification preferences can't be saved"
      );
    },
  };
}

// ─── Configuration ───

export type KnockServerConfig = {
  secretApiKey: string;
  signingKey: string;
  publicApiKey: string;
  feedChannelId: string;
};

let envLoaded = false;

/**
 * Vite only puts `VITE_` values from `.env` on `process.env`, so the Knock keys
 * are loaded explicitly. A missing `.env` is fine: the no-op adapter applies.
 */
function loadDotEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  if (!existsSync(".env")) return;
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    console.error("[notifications] Could not load .env", error);
  }
}

/**
 * Reads the Knock keys, or returns null when Knock isn't fully configured.
 * The secret key is read as KNOCK_SECRET_API_KEY, falling back to the
 * SDK's own default name KNOCK_API_KEY.
 */
export function readKnockConfig(
  env: Record<string, string | undefined> = process.env
): KnockServerConfig | null {
  const secretApiKey = env.KNOCK_SECRET_API_KEY ?? env.KNOCK_API_KEY;
  const signingKey = env.KNOCK_SIGNING_KEY;
  const publicApiKey = env.KNOCK_PUBLIC_API_KEY;
  const feedChannelId = env.KNOCK_FEED_CHANNEL_ID;

  if (!secretApiKey) return null;
  if (!signingKey || !publicApiKey || !feedChannelId) {
    console.error(
      "[notifications] KNOCK_SECRET_API_KEY is set but KNOCK_SIGNING_KEY, " +
        "KNOCK_PUBLIC_API_KEY or KNOCK_FEED_CHANNEL_ID is missing; Notifications are off"
    );
    return null;
  }
  return { secretApiKey, signingKey, publicApiKey, feedChannelId };
}

type Configured = { config: KnockServerConfig | null; port: Notifications };
let configured: Configured | null = null;

// Built lazily so importing this module has no side effects (tests never
// touch .env or Knock).
async function getConfigured(): Promise<Configured> {
  if (configured) return configured;
  loadDotEnvOnce();
  const config = readKnockConfig();
  if (!config) {
    configured = { config: null, port: loggingNotifications() };
    return configured;
  }
  const { knockNotifications } =
    await import("~/lib/knock-notifications.server");
  configured = { config, port: knockNotifications(config) };
  return configured;
}

/** The app's Notifications port: Knock when configured, otherwise the no-op. */
export async function defaultNotifications(): Promise<Notifications> {
  return (await getConfigured()).port;
}

/**
 * The Knock adapter, or null when Knock isn't configured. For scripts (seed,
 * backfill) that should say so once rather than fall back to the no-op.
 */
export async function knockNotificationsIfConfigured(): Promise<Notifications | null> {
  const { config, port } = await getConfigured();
  return config ? port : null;
}

/**
 * The browser's connection details for this user's feed, or null when Knock
 * isn't configured or signing fails. With null, the feed shows its empty state.
 */
export async function getFeedConnection(
  userId: number
): Promise<FeedConnection | null> {
  const { config, port } = await getConfigured();
  if (!config) return null;
  try {
    return {
      publicApiKey: config.publicApiKey,
      feedChannelId: config.feedChannelId,
      userId: String(userId),
      userToken: await port.signUserToken(userId),
    };
  } catch (error) {
    console.error(
      `[notifications] Could not sign a feed token for user ${userId}`,
      error
    );
    return null;
  }
}
