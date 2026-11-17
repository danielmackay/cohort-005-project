# Knock delivers Notifications

Cadence sends every Notification through Knock, a hosted vendor, and builds its own Notification Feed UI on Knock's headless feed API. Knock was the only vendor we looked at that passed every requirement on its free plan: production requires signed RS256 user tokens (so the DevUI user switcher works, because we sign a token for whoever is in the session), preferences are stored per category × channel and map onto our Notification Categories, and the feed API is mature.

## Considered Options

- **Courier** (runner-up): scoped JWTs and pay-as-you-go pricing, but web push also needs FCM or OneSignal, and its preferences are by topic rather than category.
- **MagicBell**: has native web push, but the free tier is only 1K deliveries a month, then $249/mo.
- **Novu**: the cheapest paid tier, but feed auth is a static HMAC with no expiry and there are no categories. That isn't production grade.
- **SuprSend**: category preferences are only on the $250/mo Business plan.

## Consequences

- Knock has no web push of its own. Web push would need a Firebase project and FCM, an extra service that weighs against shipping web push at all.
- The free plan covers 10K messages a month, then jumps to $250/mo. We accept that cliff and will revisit if volume gets close to it.
