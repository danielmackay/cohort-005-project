import Knock, { NotFoundError, signUserToken } from "@knocklabs/node";
import {
  NotificationChannel,
  defaultsForMissingCategories,
  type NotificationPreferences,
  type NotificationType,
} from "~/lib/notifications";
import type {
  KnockServerConfig,
  NotificationUser,
  Notifications,
} from "~/lib/notifications.server";

// ─── Knock adapter for the Notifications port ───
// The only server code that imports Knock. Everything Knock-named (workflow
// keys, user ids as strings, actors, idempotency headers) stays in this file.

/** Each catalogue Notification is a Knock workflow with this key. */
const WORKFLOW_KEY: Record<NotificationType, string> = {
  "discussion-reply": "discussion-reply",
  "discussion-question": "discussion-question",
  "refund-request-confirmation": "refund-request-confirmation",
  "open-refund-request": "open-refund-request",
  "refund-request-approved": "refund-request-approved",
  "refund-request-declined": "refund-request-declined",
  "seat-claimed": "seat-claimed",
  "new-enrollment": "new-enrollment",
};

// Long enough to read a feed in one sitting. A DevUI switch re-runs the layout
// loader, which signs a fresh token for the newly selected user.
const USER_TOKEN_TTL_SECONDS = 60 * 60;

// Triggers run inline in the request that caused them, after the commit. The
// SDK defaults (2 retries, 60s timeout) would let a Knock outage stall that
// request for minutes, so fail fast instead: the caller logs and moves on.
const TRIGGER_TIMEOUT_MS = 5_000;
const TRIGGER_MAX_RETRIES = 1;

function knockUserId(userId: number): string {
  return String(userId);
}

// Inline identification on every trigger: Knock drops a recipient it has never
// seen (no message, no error), and the actor's current name and avatar are
// what the feed shows for who sent each Notification. This stays alongside
// syncUser because sync is best-effort: a user whose sync failed, or who was
// created before the backfill ran, must still receive Notifications.
function toKnockUser(user: NotificationUser) {
  return {
    id: knockUserId(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
  };
}

export function knockNotifications(config: KnockServerConfig): Notifications {
  const knock = new Knock({
    apiKey: config.secretApiKey,
    timeout: TRIGGER_TIMEOUT_MS,
    maxRetries: TRIGGER_MAX_RETRIES,
  });

  return {
    async notify(notification) {
      if (notification.recipients.length === 0) return;

      await knock.workflows.trigger(
        WORKFLOW_KEY[notification.type],
        {
          recipients: notification.recipients.map(toKnockUser),
          actor: notification.sender ? toKnockUser(notification.sender) : null,
          data: notification.data,
        },
        // Without this the SDK sends a random key per request, so a retried
        // domain event could send the Notification twice.
        { idempotencyKey: notification.idempotencyKey }
      );
    },

    async archiveForComment(commentId) {
      // Knock matches trigger_data against top-level scalars, and the match is
      // type-sensitive: the JSON number 42 finds `commentId: 42`, the string
      // "42" finds nothing. Triggers send commentId as a number, so filter
      // with one.
      const messageIds: string[] = [];
      for await (const message of knock.messages.list({
        trigger_data: JSON.stringify({ commentId }),
        channel_id: config.feedChannelId,
      })) {
        messageIds.push(message.id);
      }
      // Knock refuses an empty batch with a 422.
      if (messageIds.length === 0) return;
      await knock.messages.batch.archive({ message_ids: messageIds });
    },

    signUserToken(userId) {
      return signUserToken(knockUserId(userId), {
        signingKey: config.signingKey,
        expiresInSeconds: USER_TOKEN_TTL_SECONDS,
      });
    },

    async syncUser(user) {
      const { id, ...properties } = toKnockUser(user);
      // An upsert: creates the user, or updates them in place.
      await knock.users.update(id, properties);

      const missing = defaultsForMissingCategories(
        await existingPreferenceCategories(knock, id)
      );
      if (Object.keys(missing).length === 0) return;

      await knock.users.setPreferences(id, PREFERENCE_SET, {
        // Knock replaces the whole set by default; merge writes only the
        // missing categories and leaves every existing choice alone.
        __persistence_strategy__: "merge",
        categories: toKnockCategories(missing, config.feedChannelId),
      });
    },
  };
}

// ─── Preferences ───

const PREFERENCE_SET = "default";

/**
 * The categories the user's preference set already names.
 *
 * Checked against Knock Development: an unknown user gets 404, and an
 * identified user's set always comes back with the environment default (set in
 * the Knock dashboard) merged in, indistinguishable from the user's own
 * choices. So a category the environment default covers counts as already set
 * and is left to that default.
 */
async function existingPreferenceCategories(
  knock: Knock,
  knockUserId: string
): Promise<Set<string>> {
  try {
    const set = await knock.users.getPreferences(knockUserId, PREFERENCE_SET);
    return new Set(Object.keys(set.categories ?? {}));
  } catch (error) {
    if (error instanceof NotFoundError) return new Set();
    throw error;
  }
}

/** Knock's channel id for each Cadence channel. */
function knockChannelIds(
  feedChannelId: string
): Record<NotificationChannel, string> {
  return { [NotificationChannel.Feed]: feedChannelId };
}

function isNotificationChannel(value: string): value is NotificationChannel {
  return Object.values<string>(NotificationChannel).includes(value);
}

/**
 * Cadence category names are Knock's category keys as they are (the workflows
 * in knock/workflows/ declare them), and each Cadence channel becomes its
 * Knock channel id.
 */
function toKnockCategories(
  preferences: NotificationPreferences,
  feedChannelId: string
): Record<string, { channels: Record<string, boolean> }> {
  const channelIds = knockChannelIds(feedChannelId);
  const categories: Record<string, { channels: Record<string, boolean> }> = {};
  for (const [category, byChannel] of Object.entries(preferences)) {
    const channels: Record<string, boolean> = {};
    for (const [channel, enabled] of Object.entries(byChannel ?? {})) {
      if (isNotificationChannel(channel) && typeof enabled === "boolean") {
        channels[channelIds[channel]] = enabled;
      }
    }
    categories[category] = { channels };
  }
  return categories;
}
