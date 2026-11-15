# Browser (web) push: how it works and what it would take in Cadence

Research for issue #4 (part of the in-app Notifications map, #2). Researched 2026-11-15 against primary sources: MDN, WebKit, Chrome, Mozilla, the IETF RFC, and each provider's own docs. Footnote links point to the source for each claim.

## TL;DR

- Web push is a W3C standard stack (Service Worker + Push API + Notifications API) with VAPID server identification. Every major desktop browser supports it, as do Chrome, Firefox and Samsung Internet on Android. **iOS/iPadOS 16.4+ supports it only for sites the user has added to the Home Screen** with a `standalone`/`fullscreen` manifest. In an ordinary Safari tab on iOS it is not available.
- Every engine now requires the permission request to come from a user gesture. Chrome also demotes sites with poor acceptance to a "quiet" bell icon, auto-revokes permission from low-engagement, high-volume sites, and (since January 2026) rate-limits the Push API for those sites. A user who clicks Block can only be won back through browser settings.
- Providers: **MagicBell** and **SuprSend** have native VAPID web push channels. **Knock** (front-runner) has no first-party web push channel; it sends web push through its **FCM** integration, so you take on Firebase. **Novu** goes through FCM or third-party web push services (Pushpad, OneSignal, Pusher Beams). **Courier** goes through OneSignal, FCM or MagicBell.
- Cadence today has **no web app manifest and no service worker** (`public/` holds only `favicon.svg` and `images/`). We would need a root-scoped service worker, a manifest (required for iOS), a soft-ask UI, a subscription store (ours or the provider's), and handling for expiry (404/410).
- Recommendation for the spec: keep web push **out of v1** and ship in-app first. Design the notification model to be channel-agnostic so web push can be added later as an opt-in channel. If we choose Knock, budget for FCM.

## 1. The model: Service Worker + Push API + VAPID

1. The page registers a **service worker**. Push messages are delivered to the service worker, which can run when the site isn't open.[^mdn-push]
2. Inside a user gesture, the page calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`. `applicationServerKey` is the server's **VAPID public key**. The push service binds the subscription to it, and the server signs each send with the matching private key.[^webdev-sub]
3. The browser returns a `PushSubscription`: an **endpoint URL** on the browser vendor's push service plus encryption keys (`p256dh`, `auth`). The endpoint is a capability URL, so anyone who has it can push to that user. Treat it as a secret and protect the subscribe endpoint against CSRF.[^mdn-push]
4. The app server POSTs an encrypted payload to the endpoint (Web Push Protocol, RFC 8030) with a required `TTL` header and optional `Urgency` and `Topic` headers. A `Topic` lets a newer message replace one that hasn't been delivered yet.[^rfc8030]
5. The service worker receives a `push` event and calls `registration.showNotification()`. `pushsubscriptionchange` fires when a subscription is invalidated or about to expire.[^mdn-push]
6. `userVisibleOnly: true` is mandatory in Chrome and Safari, which means there is **no silent push**: every push must show a notification. Safari revokes subscriptions that break this rule.[^webdev-sub][^webkit-meet]
7. HTTPS (a secure context) is required. `localhost` works for development.[^mdn-reqperm][^fcm-web]

**Declarative Web Push (Safari only):** WebKit added a mode in iOS/iPadOS 18.4 and macOS 15.5 where the push payload itself describes the notification (`"web_push": 8030`, `notification.title`, `notification.navigate`). Safari can then show it without a service worker; a service worker, if present, can still modify it. Other engines don't support it yet.[^webkit-declarative] For now it's an optimisation, not a replacement.

## 2. Browser support (late 2026)

| Browser | Status | Notes |
| --- | --- | --- |
| Chrome desktop / Android | Supported (since 50) | Requires `userVisibleOnly: true` and a VAPID key.[^caniuse][^webdev-sub] |
| Edge (Chromium) | Supported (79+) | Same model as Chrome.[^caniuse] |
| Firefox desktop / Android | Supported (desktop 44+) | Quota on push messages that don't show a notification; it resets on each visit.[^caniuse][^mdn-push] |
| Safari macOS | Supported since 16.1 (Ventura+) | Standards-based; no Apple Developer account needed. caniuse marks 16.1–17.x "partial", 18+ full.[^webkit-meet][^caniuse] |
| Safari iOS / iPadOS | **16.4+, Home Screen web apps only** | Manifest `display: standalone` or `fullscreen`; permission must come from a direct user interaction; delivered via APNs (allow `*.push.apple.com` if you filter egress); integrates with Focus; the Badging API is supported.[^webkit-ios] caniuse still marks iOS as "partial".[^caniuse] |
| Samsung Internet | Supported | [^caniuse] |

MDN lists the Push API as **Baseline: widely available since March 2023**.[^mdn-push]

**Implication for Cadence:** on iPhone, only learners who install Cadence to the Home Screen can receive web push. Most iOS learners will never do that unless we prompt them, so iOS reach will be low.

## 3. Permission-prompt rules and best practice

**What browsers enforce**

- **User gesture required everywhere.** Firefox 72+ instantly rejects `Notification.requestPermission()` and `PushManager.subscribe()` without a gesture and shows only a small icon in the address bar.[^moz-72] Safari allows a subscription only after a click or keypress.[^webkit-meet] iOS requires direct user interaction.[^webkit-ios] MDN says to request permission only from a user-gesture handler.[^mdn-reqperm]
- **Chrome quiet UI.** Chrome 80+ replaces the pop-up with a bell icon in the address bar for sites with low acceptance rates, for users who usually block, and for sites with abusive prompts or notifications.[^chrome-help][^chrome-chip]
- **Chrome auto-revocation.** Chrome removes notification permission from sites with very low engagement and high notification volume; installed web apps are exempt. Google reports that fewer than 1% of notifications get any interaction.[^chrome-revoke]
- **Chrome Push API rate limits (rollout from January 2026).** Chrome calculates daily from pushes per time on site, prompts per time on site, and engagement score. Offending sites are capped at 1,000 messages/min and get HTTP 429 above that, for 1, then 7, then 14 days. Google says legitimate sites should be unaffected.[^chrome-ratelimit]
- **Denied is sticky.** Once a user blocks, the site can't prompt again; the user has to change the setting manually.[^webdev-sub] `default` behaves like `denied`.[^mdn-reqperm]
- Chrome and Firefox no longer allow the prompt from cross-origin iframes.[^mdn-reqperm]

**Best practice (from the same sources)**

- Use a **soft ask**: an in-page explanation with a button, shown at a moment when the value is obvious (for example "Notify me when the instructor replies" next to a comment, or "Remind me when the next module drops"). Only the click on that button triggers the native prompt.[^chrome-chip][^webdev-sub]
- Never prompt on page load. Don't re-prompt in the same session after a dismissal, because Chrome then goes quiet.[^chrome-chip]
- Call `Notification.requestPermission()` yourself rather than letting `subscribe()` prompt implicitly.[^webdev-sub]

## 4. What each provider offers for web push

| Provider | Web push path | Native VAPID? | Notes |
| --- | --- | --- | --- |
| **Knock** | Via the **Firebase Cloud Messaging** integration. Get a token from the FCM web SDK and store it as the user's FCM channel data (`tokens[]` or `devices[]`). FCM overrides accept a `webpush` block.[^knock-fcm] | **No.** Knock's FCM tutorial says it has no first-party web push channel.[^knock-fcm-tut] | Push providers: APNs, FCM, Expo, OneSignal, Amazon SNS.[^knock-push] Can drop invalid tokens after a bounce.[^knock-push] Needs a Firebase project, `firebase-messaging-sw.js` at the root, and a VAPID key from the Firebase console.[^fcm-web] |
| **Novu** | FCM (web), or the web push services **Pushpad**, OneSignal, Pusher Beams, plus a Push Webhook.[^novu-push] | No direct VAPID channel. Pushpad uses a `uid` mapped to subscriber credentials.[^novu-pushpad] | Tokens are stored on the subscriber per integration, max 100 per channel. Stale tokens are auto-removed for FCM and Expo.[^novu-push] |
| **MagicBell** | Native **Web Push channel**.[^magicbell-wp] | **Yes.** Configure the VAPID public/private keys in the dashboard or with `PUT /v2/integrations/web_push`.[^magicbell-wp] | The client calls `pushManager.subscribe()` and saves endpoint + `p256dh` + `auth` with `PUT /v2/channels/web_push/tokens`. Has a delivery log and a tester.[^magicbell-wp] |
| **Courier** | **OneSignal** for browser push (store `oneSignalExternalUserId`/`oneSignalPlayerID`). FCM covers web too. MagicBell is also listed as a provider.[^courier-push][^courier-node] | No first-party web push. "Courier Push" is in-app over WebSocket, not browser push.[^courier-react] | |
| **SuprSend** | Native **WebPush** vendor in the JS and React SDKs.[^suprsend-js] | **Yes.** Pass `vapidKey` to the SDK; SuprSend holds the private key.[^suprsend-js] | Root `serviceworker.js` imports SuprSend's CDN script. `registerPush()` must run from a user action. HTTPS required.[^suprsend-js] |

**If Knock stays the front-runner:** web push means adding Firebase (console project, VAPID key pair, FCM JS SDK, `firebase-messaging-sw.js`). FCM says its web SDK works wherever the Push API does (it links the caniuse matrix) but does not name Safari, so verify Safari/iOS delivery in a spike.[^fcm-web] The other option is to skip the provider for this channel and send direct VAPID pushes ourselves (for example with the `web-push` npm library, which Knock's own blog demonstrates). That puts subscription storage and expiry handling on us.

## 5. What Cadence would need

Current state: React Router 8.3 SSR app with SQLite and Drizzle. There is **no manifest, no service worker**, and `public/` holds only `favicon.svg` and `images/`.

1. **HTTPS** in every non-local environment. Fine for prod; check preview deploys.[^fcm-web]
2. **Service worker at the origin root** (`/sw.js` or `/firebase-messaging-sw.js`) so its scope covers every route, served from `public/`. It handles `push` → `showNotification`, `notificationclick` → `clients.openWindow(url)` (deep link to the lesson or comment), and `pushsubscriptionchange` → re-subscribe and POST to the server.[^mdn-push][^suprsend-js] It must not get in the way of SSR navigation: no fetch handler unless we want offline support.
3. **Web app manifest** (`/manifest.webmanifest` linked from `app/root.tsx`) with `name`, `id`, icons and `display: "standalone"`. Without it there is no iOS push at all.[^webkit-ios]
4. **Soft-ask UI and preferences**: a per-user "Browser notifications" toggle in notification preferences, plus context-specific prompts. The native prompt is shown only from a click.
5. **Subscription storage**, one of:
   - **Provider-held**: MagicBell or SuprSend tokens, or Knock/Novu FCM channel data. We only make an authenticated call to register the token for the current user.
   - **Self-held**: a new `push_subscriptions` table (`id`, `userId`, `endpoint` unique, `p256dh`, `auth`, `userAgent`, `createdAt`, `lastSuccessAt`). One user can have many browsers. The table needs a Drizzle migration and a seed update.
6. **VAPID key pair** as server environment variables. Generate it once and never rotate it casually, because rotating invalidates every existing subscription.[^webdev-sub]
7. **Send pipeline** (self-held case): encrypt and POST with `TTL` (and `Topic` to collapse repeats). On **404/410**, delete the subscription. Treat 201/202 as "accepted", not "delivered".[^rfc8030]
8. **Logout and user switching**: remove or unbind the browser's subscription on logout, so a shared machine doesn't keep getting the previous user's notifications. The dev UI user switcher makes this easy to test.

## 6. Pitfalls

- **Delivery is best-effort.** Push services may drop or expire messages before the TTL and may expire subscriptions at any time. There is no delivery guarantee.[^rfc8030] Web push should never be the only copy of a notification; the in-app inbox stays the source of truth.
- **Subscription churn.** Expired or revoked subscriptions come back as 404/410 and must be pruned.[^rfc8030][^novu-push]
- **No silent push.** Every push must show a notification (`userVisibleOnly`), so you can't use push for background sync or badge-only updates outside Safari's Badging API.[^webdev-sub][^webkit-ios]
- **Notification fatigue is now penalised by the platform.** Chrome's quiet UI, auto-revocation and rate limits all target high volume with low engagement.[^chrome-revoke][^chrome-ratelimit] Cadence should send only high-signal events and offer batching or digests.
- **Quiet UI and sticky deny.** A bad first prompt can lose the user permanently.[^webdev-sub][^chrome-help]
- **iOS reach** depends on Home Screen install; many iOS learners will never qualify.[^webkit-ios]
- **Service worker scope and bundling.** A worker emitted to a subdirectory silently breaks push.[^suprsend-js] FCM needs `firebase-messaging-sw.js` at the root.[^fcm-web]
- **Firefox quota** on pushes that don't show a notification.[^mdn-push]
- **Security**: endpoints are capability URLs; protect the register endpoint against CSRF and tie it to the authenticated session.[^mdn-push]

## Sources

[^mdn-push]: MDN, Push API. https://developer.mozilla.org/en-US/docs/Web/API/Push_API
[^mdn-reqperm]: MDN, `Notification.requestPermission()`. https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static
[^webdev-sub]: web.dev (Chrome team), Subscribing a user. https://web.dev/articles/push-notifications-subscribing-a-user
[^rfc8030]: IETF RFC 8030, Generic Event Delivery Using HTTP Push. https://www.rfc-editor.org/rfc/rfc8030
[^caniuse]: caniuse, Push API. https://caniuse.com/push-api
[^webkit-meet]: WebKit, Meet Web Push (Safari 16 / macOS Ventura). https://webkit.org/blog/12945/meet-web-push/ and WWDC22 "Meet Web Push for Safari" https://developer.apple.com/videos/play/wwdc2022/10098/
[^webkit-ios]: WebKit, Web Push for Web Apps on iOS and iPadOS. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
[^webkit-declarative]: WebKit, Meet Declarative Web Push. https://webkit.org/blog/16535/meet-declarative-web-push/
[^moz-72]: Mozilla Hacks, Upcoming notification permission changes in Firefox 72. https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/ and Firefox 72 release notes https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72
[^chrome-chip]: Chrome for Developers, Permissions request chip. https://developer.chrome.com/blog/permissions-chip
[^chrome-help]: Google Chrome Help, Use notifications to get alerts. https://support.google.com/chrome/answer/3220216
[^chrome-revoke]: Google, Reducing notification overload (automatic notification permission revocation), Oct 2025. https://blog.google/chromium/automatic-notification-permission/
[^chrome-ratelimit]: Chrome for Developers, Increasing web push notification value with rate limits. https://developer.chrome.com/blog/web-push-rate-limits
[^fcm-web]: Firebase, Set up a JavaScript Firebase Cloud Messaging client app. https://firebase.google.com/docs/cloud-messaging/js/client
[^knock-push]: Knock docs, Push overview. https://docs.knock.app/integrations/push/overview
[^knock-fcm]: Knock docs, Firebase Cloud Messaging. https://docs.knock.app/integrations/push/firebase
[^knock-fcm-tut]: Knock docs, Sending web push notifications with FCM. https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm
[^novu-push]: Novu docs, Push providers. https://docs.novu.co/platform/integrations/push
[^novu-pushpad]: Novu docs, Pushpad. https://docs.novu.co/platform/integrations/push/pushpad
[^magicbell-wp]: MagicBell docs, Web Push channel. https://www.magicbell.com/docs/channels/web_push
[^courier-push]: Courier docs, Push providers. https://www.courier.com/docs/integrations/push/overview
[^courier-node]: Courier, Send push notifications with Node.js (OneSignal for browser push). https://www.courier.com/guides/nodejs-send-push-notifications
[^courier-react]: Courier, In-app browser notifications in React (Courier Push over WebSocket). https://www.courier.com/guides/react-notifications
[^suprsend-js]: SuprSend docs, WebPush (JS SDK). https://docs.suprsend.com/docs/js-webpush and React https://docs.suprsend.com/docs/react-webpush
