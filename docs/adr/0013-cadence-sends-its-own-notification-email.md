# Cadence sends its own Notification email

Knock, the notification vendor, runs the Notification Feed and nothing else. When a Notification also goes out by email, Cadence sends that email itself through `mailer.server.ts` and Postmark, as it already did for Refund Request decisions. This keeps the vendor integration to one job and leaves email working when Knock is unavailable.

## Considered Options

- **Let Knock send the email, with Postmark as its email provider.** Rejected: one trigger per event and email preferences enforced by Knock were attractive, but it adds a second Knock channel to configure in every environment, moves the working Refund Request decision email into Knock templates, takes Notification emails out of the `.outbox/` development fallback, and makes that email depend on Knock being up.

## Consequences

- Knock does not enforce email preferences. Cadence must check the person's preference for the email Channel before each send.
- A Notification that goes out by email is two sends, to Knock and to Postmark. They are attempted independently, and a failure of either is logged and never fails the action that caused the Notification.
- Email is sent the moment the event happens, one per Notification. Skipping an email because the Notification was already read, or batching several into one, would need a delayed-job mechanism Cadence does not have.
