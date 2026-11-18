# Knock

Cadence sends Notifications through [Knock](https://knock.app). The app talks to it through the Notifications port (`app/lib/notifications.server.ts`); `app/lib/knock-notifications.server.ts` is the only server code that imports Knock. Without the keys below, the app uses a no-op adapter that logs instead, and the bell shows its empty state.

## Environment variables

Put these in `.env` (never committed). The app and the scripts load it themselves.

| Variable | Used by | What it is |
| --- | --- | --- |
| `KNOCK_SECRET_API_KEY` | app, backfill | The environment's secret API key. `KNOCK_API_KEY` is read as a fallback (the SDK's own default name). |
| `KNOCK_PUBLIC_API_KEY` | app (browser) | The environment's public API key, for the feed. |
| `KNOCK_SIGNING_KEY` | app | The environment's signing key (PEM or base64 PEM). Signs each user's feed token. |
| `KNOCK_FEED_CHANNEL_ID` | app, setup, backfill | The id (not key) of the in-app feed channel. |
| `KNOCK_SERVICE_TOKEN` | `knock:setup` | A Management API service token (dashboard → Settings → Service tokens). Not needed at runtime. |
| `KNOCK_ENVIRONMENT` | `knock:setup` | Optional target environment slug. Defaults to `development`. |

If the secret key is set but any of the signing key, public key or feed channel id is missing, the app logs that and turns Notifications off.

## Setting up an environment

1. In the Knock dashboard, create an in-app feed channel and copy its id into `KNOCK_FEED_CHANNEL_ID`. Turn on enhanced security, so a feed can only be read with its own user's token. The fallback templates build links from the Knock variable `app_url` (Settings → Variables), so set it to the app's origin.
2. Push the workflows and their preference categories:

   ```sh
   npm run knock:setup                  # development
   npm run knock:setup -- production    # or KNOCK_ENVIRONMENT=production
   ```

   It upserts and commits every workflow in `knock/workflows/`, replacing `$FEED_CHANNEL_KEY` with the feed channel's key. Safe to re-run. Knock normally only accepts edits in Development; other environments get changes by promoting the commit in the dashboard. Workflow descriptions must stay under 280 characters.
3. Once per environment, sync every existing user and write their default preferences:

   ```sh
   npm run knock:backfill-users
   ```

   It uses the keys in `.env`, so point those at the environment you mean. Safe to re-run: it never overwrites a user's choice. New users are synced on signup and profile edits after that.

## Categories and workflows

Each workflow file is named after its Notification type (`app/lib/notifications.ts`, `NotificationType`) and belongs to one preference category (`NOTIFICATION_CATEGORY`):

| Category | Workflows | Default |
| --- | --- | --- |
| `refund-request-updates` | `refund-request-confirmation`, `refund-request-approved`, `refund-request-declined` | on |
| `open-refund-requests` | `open-refund-request` | on |
| `seat-claims` | `seat-claimed` | on |
| `enrollments` | `new-enrollment` | off |
| `discussion-questions` | `discussion-question` | on |
| `discussion-replies` | `discussion-reply` | on |

Each workflow has a single `in_app_feed` step. Cadence renders the feed row's text itself from the trigger data; the step's template is only a fallback.

## Preferences and the dashboard default

Cadence's defaults live in code (`DEFAULT_NOTIFICATION_PREFERENCES`) and are written to each user, keyed by the feed channel id, when the user is synced. Don't rely on the environment default preference set in the Knock dashboard: it is per environment, invisible to the code, and Knock merges it into every user's set by channel type. Cadence treats a category as already chosen only when the user has a setting under the feed channel id, so its own defaults are written even where the dashboard default covers the category, and a user's own choice is never overwritten.

## Adding email later

Email becomes a second step in each workflow JSON (a channel step with `channel_type: "email"`), plus a second Cadence channel: add `Email` to `NotificationChannel`, its defaults to `DEFAULT_NOTIFICATION_PREFERENCES`, and its Knock channel id and type to `knockChannelIds` and `KNOCK_CHANNEL_TYPE` in the adapter. Stored feed preferences don't change.
