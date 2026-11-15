# In-app notification providers: Knock vs Novu, MagicBell, Courier, SuprSend

Research for issue #3 (part of #2). Researched 2026-11-15 against official docs and pricing pages only. Where a vendor's docs did not answer a question, the cell says **not documented** rather than guessing.

Context: Cadence is React Router v7 SSR + SQLite/Drizzle. Scope is in-app Notifications (feed/inbox), event-driven (a Reply to my Comment, a new Lesson on an enrolled Course), for Students, Instructors, Platform Admins and Team Admins.

## Summary table

| | Knock | Novu | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| React package | `@knocklabs/react` | `@novu/react` (React 18/19) | `@magicbell/react` | `@trycourier/courier-react` (v9) | `@suprsend/react` |
| Prebuilt vs headless | Prebuilt popover/feed/bell + full hook set | Drop-in `<Inbox />`, override sub-components, or headless hooks / `@novu/js` | Prebuilt (Inbox, FloatingInbox, UserPreferences, WebPushButton…); headless hooks not documented | Prebuilt + theme, custom views, or low-level APIs | Drop-in components or headless SDK |
| Real-time | Websocket (documented) | Real-time; dedicated WS service in self-host architecture | "Persistent connection" | Real-time, cross-device sync (transport not named) | WebSocket managed by the component |
| Web push | **No first-party channel**; via FCM web | FCM webpush, Pushpad, OneSignal | **First-class** VAPID web push + `WebPushButton` | Via OneSignal (FCM listed for web) | Native web push (VAPID from dashboard) |
| Batching / digest | Batch step on all plans, key, window, max activities, `total_activities` | Digest step (window/cron, grouping key; one per workflow) | **Not documented** | Journeys batch + topic digests on user-chosen schedule | Batch/digest (Business+), user-chosen Instant/Daily/Weekly cadence |
| Read/seen/archived | seen, read, interacted, archived + counts | read, snooze, tabs/filters (archive not stated on overview) | read/unread, archive, delete | read, archive, opened | not stated on the page read |
| Preferences | All plans; per-tenant defaults on Enterprise | Built-in Preferences UI per workflow/channel | Per channel x category, `UserPreferences` component | Subscription topics/sections | Business+ |
| Idempotency | `Idempotency-Key` on trigger, 24 h, 2xx only | `Idempotency-Key` (must ask support to enable); `transactionId` best-effort | Not documented | `Idempotency-Key`, 25 h default, up to 1 year | `$idempotency_key`, 24 h |
| Client feed auth | Signed JWT, RS256, `sub` = user id (enhanced security mode) | HMAC-SHA256 `subscriberHash` of subscriberId | User JWT signed on your server | Backend-minted JWT, `signIn({ userId, jwt })` | Signed JWT, ES256, `entity_id` = distinct_id |
| Environments / local dev | Unlimited environments, commits + promotion, CLI | Dev + Prod (Free/Pro); `npx novu dev` local studio | Projects (1 free, 5 Startup) | Test/custom envs (count as sends) | Sandbox + Production workspaces |
| Self-host | No (Enterprise "dedicated infrastructure") | **Yes**: MIT community edition (some Inbox features cloud-only) + Enterprise self-host | No | No | Enterprise only (self-host / BYOC beta) |
| Free tier | 10k messages/mo | 10k runs/mo, 5 workflows, 24 h activity retention | 1k deliveries/mo | 10k sends/mo | 10k/mo, SuprSend branding, no batching |
| First paid | Starter $250/mo, 50k, $0.005 over | Pro from $30/mo, 30k, $1.20/1k over | Startup $249/mo, 50k, $0.0025 over | Business $0.005/send (all sends billed) | Essentials $100/mo, 50k, $0.002 over (no batching); Business $250/mo, 50k, $0.005 over |

### Cost at course-platform scale (illustrative)

Assume 50,000 in-app messages a month (for example ~5,000 active Students at ~10 Notifications each). Batching reduces billed messages for every vendor that bills per message.

| Vendor | Plan that covers 50k | Approx. monthly |
|---|---|---|
| Novu | Pro: $30 + 20k x $1.20/1k | ~$54 |
| SuprSend | Essentials (no batching) / Business (batching) | $100 / $250 |
| MagicBell | Startup | $249 |
| Knock | Starter | $250 |
| Courier | Business: 50k x $0.005 | $250 |

Under 10k messages a month, Knock, Novu, Courier and SuprSend are all free. Knock's free tier keeps batching, preferences and unlimited environments; SuprSend's free tier drops batching and shows branding.

## Key takeaways

1. **Knock remains the strongest fit on features for a cloud-only build.** It documents everything Cadence needs: websocket feed, seen/read/archived states, batching on every plan (including free), preferences, a true `Idempotency-Key` on trigger, RS256-signed user tokens, and unlimited environments with commit/promote. Its free tier (10k messages) covers development and an early launch.
2. **Novu beats Knock on price and self-hosting.** About $54/mo vs $250/mo at 50k messages, and an MIT community edition for self-hosting (multi-service stack: MongoDB, Redis, API/Worker/WS). Trade-offs: idempotency needs support to enable, only one digest step per workflow, free-tier activity retention is 24 h, and some Inbox features are cloud-only when self-hosted.
3. **MagicBell beats Knock on browser push**: first-class VAPID web push with a `WebPushButton` component. Knock has no first-party web push and routes through FCM. MagicBell's docs do not document batching/digests or idempotency, which hurts for "3 people replied".
4. **SuprSend and Courier beat Knock on user-chosen digest cadence.** Recipients pick Instant/Daily/Weekly (SuprSend) or a schedule per subscription topic (Courier). SuprSend Essentials ($100/mo) is cheaper than Knock but has no batching. Courier's idempotency window is the most flexible (25 h, up to 1 year), but it bills every send once you leave the free tier.
5. **Every provider holds the Notification records.** None mirrors into your database for you. Cadence should either (a) keep its own domain events in SQLite as the source of truth and treat the provider as the delivery and feed layer, or (b) mirror via provider webhooks (Knock outbound webhooks are per environment, retried on non-2xx, so upsert by message id). Map Cadence `user.id` straight to the provider recipient id (`sub` / `subscriberId` / `distinct_id`). Mint the client token in a React Router loader on the server and pass it to the provider component.

## Detail by question

### Prebuilt React components vs headless
- **Knock**: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton`, plus "a complete set of React hooks" for building your own UI. [Knock React overview](https://docs.knock.app/in-app-ui/react/overview)
- **Novu**: `<Inbox />` built from Bell, Notifications, InboxContent and Preferences sub-components. You can override styles and replace UI elements, or go headless with `@novu/react` hooks or framework-agnostic `@novu/js`. [Novu Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **MagicBell**: ContextProvider, FloatingInbox, Inbox, InlineNotification, ToastContainer, UserPreferences, WebPushButton. The page does not document headless hooks. [MagicBell React](https://www.magicbell.com/docs/libraries/magicbell-react)
- **Courier**: `CourierInbox` + `useCourier`, themed with `CourierInboxTheme`, custom views, or low-level APIs. [Courier Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)
- **SuprSend**: `@suprsend/react`, drop-in components or headless. [SuprSend React inbox](https://docs.suprsend.com/docs/inbox-react)

### Real-time delivery
- **Knock**: "over a websocket when new messages are sent to an in-app feed channel". [Knock feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
- **Novu**: The Inbox syncs in real time. The self-host architecture includes a dedicated WS service, and production config takes a `socketUrl`. [Novu prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production), [Novu self-hosting](https://docs.novu.co/community/self-hosting-novu/overview)
- **MagicBell**: Persistent connection, no page refresh needed. [MagicBell in-app channel](https://www.magicbell.com/docs/channels/in_app)
- **Courier**: Real-time with cross-device state sync; transport not named. [Courier Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)
- **SuprSend**: The component manages its own WebSocket connection. [SuprSend React SDK](https://docs.suprsend.com/docs/react-sdk)

### Web push
- **Knock**: "Knock does not have a first-party web push channel"; use FCM and store the browser token as channel data. Knock does not validate stale tokens. [Knock FCM web push tutorial](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm), [Knock push overview](https://docs.knock.app/integrations/push/overview)
- **Novu**: FCM webpush, Pushpad and OneSignal. [Novu push integrations](https://docs.novu.co/platform/integrations/push), [FCM](https://docs.novu.co/platform/integrations/push/fcm)
- **MagicBell**: Native web push with VAPID keys; per-device tokens via `PUT /v2/channels/web_push/tokens`. [MagicBell web push](https://www.magicbell.com/docs/channels/web_push)
- **Courier**: OneSignal is the documented browser route; FCM is listed as Android/iOS/Web. [Courier push providers](https://www.courier.com/docs/integrations/push/overview)
- **SuprSend**: Native web push. The VAPID public key comes from the dashboard, the service worker is served from the site root, and HTTPS is required. [SuprSend web push quick start](https://docs.suprsend.com/docs/web-push-quick-start)

### Batching, preferences, states
- **Knock batch**: windows can be fixed, dynamic or sliding (max 90 days). An optional batch key splits batches (e.g. per Lesson). Max activities is 2-1000, and `total_activities` drives copy like "left N comments". Only the first or last 10 activities are returned. [Knock batch function](https://docs.knock.app/designing-workflows/batch-function). States are seen/read/interacted/archived; filter by status or trigger data. [Knock feeds](https://docs.knock.app/in-app-ui/feeds/overview)
- **Novu digest**: window by amount/unit or cron, with a grouping key. Novu does not support two digest steps in one workflow. [Novu digest](https://docs.novu.co/framework/digest)
- **MagicBell**: preferences per channel x category (`PUT /v2/channels/user_preferences`); read/unread, archive, delete. No digest docs found. [MagicBell in-app](https://www.magicbell.com/docs/channels/in_app), [API v2](https://www.magicbell.com/docs/api/reference)
- **Courier**: Journeys batch nodes (inactivity, max count, max wait) and topic digests (Instant/Daily/Weekly/...). Automations is legacy. [Courier daily digest](https://www.courier.com/docs/guides/send-a-daily-digest), [Courier Journeys](https://www.courier.com/docs/journeys/overview)
- **SuprSend**: batch/digest, an option to let the first trigger through immediately, and user-chosen cadence from the preference centre. [SuprSend changelog](https://docs.suprsend.com/changelog/overview)

### Records, triggering, idempotency
- **Knock**: trigger `POST /workflows/:key/trigger` with recipients (inline identify), actor, tenant, data and cancellation_key. Runs are async. [Trigger API](https://docs.knock.app/api-reference/workflows/trigger). `Idempotency-Key` works only on trigger; Knock caches 2xx responses for 24 h. [Idempotent requests](https://docs.knock.app/api-reference/overview/idempotent-requests). Message content is fixed once generated; to change it, archive and re-trigger. Outbound webhooks can mirror message status changes. [Outbound webhooks](https://docs.knock.app/developer-tools/outbound-webhooks/overview)
- **Novu**: `POST /v1/events/trigger` (`name`, `to`, `payload`, `actor`, `tenant`, max 100 recipients). Novu checks `transactionId` during processing, so concurrent retries are not reliably deduplicated. The `Idempotency-Key` header returns 409 while the first request is in flight, and support must enable it. [Novu trigger](https://docs.novu.co/api-reference/events/trigger-event)
- **Courier**: `Idempotency-Key` on POST `/send`, journeys invoke, profiles and preferences. Courier keeps keys for 25 h by default, extendable to 1 year via `x-idempotency-expiration`, and replays errors too. [Courier API reference](https://www.courier.com/docs/reference/)
- **SuprSend**: `$idempotency_key` in the trigger body, deduplicated for 24 h. Recipients are a `distinct_id` or inline, max 100. [SuprSend trigger workflow](https://docs.suprsend.com/docs/trigger-workflow)
- **MagicBell**: no deduplication or idempotency documented on the pages read.

### Recipient identity and client auth
- **Knock**: enhanced security mode rejects requests without a user token. The JWT is RS256-signed with the Knock signing key; `sub` = user id, with `iat`/`exp` recommended and optional `grants`. Pass it as `userToken` on `KnockProvider`. [Knock security](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Novu**: `subscriberHash` = HMAC-SHA256(subscriberId, secret key), hex. If HMAC is enabled and the hash is missing, the Inbox will not load. [Novu prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)
- **MagicBell**: User JWT generated on your server. [MagicBell user auth](https://www.magicbell.com/docs/api/authentication/user)
- **Courier**: backend generates a JWT from the API key; the client calls `signIn({ userId, jwt })`. [Courier Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)
- **SuprSend**: ES256 JWT, `entity_type: subscriber`, `entity_id` = distinct_id; optional `scope.tenant_id`. Enhanced Security Mode is off in Sandbox, so a bad token still "works" there. [SuprSend client auth](https://docs.suprsend.com/docs/client-authentication)

### Local development / test
- **Knock**: environments (development, production, custom) each have isolated data, content and API keys. Content is versioned by commits, rolls back, and promotes up the chain; the CLI takes `--environment`. The trigger example shows a `sandbox_mode` setting, but the page does not describe it. [Knock environments](https://docs.knock.app/concepts/environments)
- **Novu**: Dev + Prod environments; `npx novu dev` runs a local studio (localhost:2022) tunnelled to your bridge app. [Novu digest/framework docs](https://docs.novu.co/framework/introduction)
- **Courier**: Test and custom environments, but test sends count the same as production. [Courier pricing](https://www.courier.com/pricing)
- **SuprSend**: Sandbox workspace. Email/SMS go only to verified channels; Inbox and Push are unrestricted. [SuprSend inbox quick start](https://docs.suprsend.com/docs/inbox-quick-start)
- **MagicBell**: projects (1 on free, 5 on Startup). [MagicBell pricing](https://www.magicbell.com/pricing)
- Mocking: no vendor documents an official mock server. For Cadence tests, wrap the provider behind a small server-side `notify()` module and fake it in Vitest.

### Self-host
- **Knock**: none documented; Enterprise mentions "dedicated infrastructure". [Knock pricing](https://knock.app/pricing)
- **Novu**: the repository has `LICENSE-MIT` plus `LICENSE-ENTERPRISE` / `EE-PACKAGES-LICENSE` for an `enterprise/` folder. The community self-hosted edition lacks some Inbox features, SSO and RBAC. [Novu self-hosting](https://docs.novu.co/community/self-hosting-novu/overview), [novuhq/novu](https://github.com/novuhq/novu)
- **SuprSend**: self-host or BYOC requires an Enterprise licence. [What is SuprSend](https://docs.suprsend.com/docs/what-is-suprsend)
- **MagicBell, Courier**: none documented.

### Pricing sources
[Knock](https://knock.app/pricing) · [Novu](https://novu.co/pricing) · [MagicBell](https://www.magicbell.com/pricing) · [Courier](https://www.courier.com/pricing) · [SuprSend](https://www.suprsend.com/pricing)

## Open gaps
- Knock web push via FCM: confirm the token-staleness handling burden if web push becomes in-scope.
- Whether a Knock in-app batched message updates in place while the batch window is still open. The docs do not say; check before specifying "3 people replied" UX.
- MagicBell batching/digest: absent from the docs; confirm with the vendor if MagicBell is still under consideration.
- Novu idempotency: requires support to enable. Confirm availability on the Pro plan.
