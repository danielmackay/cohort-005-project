# Notification Preferences live in Knock, for both Channels

Every Notification Preference is stored in Knock, including the choice about email, which Knock never sends. Each Notification is one Knock preference category with an `in_app_feed` and an `email` setting, and the defaults are Knock's environment default preference set. Knock applies the Feed setting itself. Before each Notification email it sends, Cadence reads the person's preferences from Knock (the read already includes the environment default) and sends only if the Notification and its email are both on. One store means one place to change a preference and one set of defaults.

## Considered Options

- **Store every preference in Cadence's SQLite database and skip the Knock trigger for muted Notifications.** Rejected: it needs a new table and a migration, and it rebuilds the per-category, per-channel model and defaults that Knock already provides.
- **Split the store: Knock for the Feed, SQLite for email.** Rejected: one preference would live in two places, and the rule that email can't be on while the Notification is off would span both.

## Consequences

- Each Notification email costs one Knock read per recipient beforehand. If that read fails, Cadence logs it and sends the email anyway: one unwanted email is better than silence while the Feed is probably failing too.
- Refund approved and Refund declined can't be muted. A person's signed user token can write their own Knock preferences, so the lock can't rely on the settings UI. Their Knock workflows override recipient preferences, and Cadence sends their emails without a preference check.
- Writes go through Cadence's server with Knock's `merge` persistence strategy. The default `replace` strategy would wipe every category the write leaves out.
- Moving preferences out of Knock later means migrating every person's stored set.
