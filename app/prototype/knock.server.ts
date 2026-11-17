// PROTOTYPE: throwaway, for the wayfinder ticket "What does the Notification Feed look like in Cadence?".
// Not production code: no error handling, no abstractions, no tests.
import Knock, { signUserToken } from "@knocklabs/node";

// react-router dev does not load .env into process.env for server code.
if (!process.env.KNOCK_API_KEY) process.loadEnvFile(".env");

export const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY! });

export const knockPublicConfig = () => ({
  publicApiKey: process.env.KNOCK_PUBLIC_API_KEY!,
  feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
});

export const knockUserId = (id: number) => `cadence-user-${id}`;

export function signFeedToken(userId: number) {
  return signUserToken(knockUserId(userId), {
    signingKey: process.env.KNOCK_SIGNING_KEY!,
    expiresInSeconds: 60 * 60,
  });
}

type Person = { id: number; name: string; email: string };
const recipient = (u: Person) => ({
  id: knockUserId(u.id),
  name: u.name,
  email: u.email,
});

// The Development environment only has the two workflows the Knock spike made.
// Every demo Notification rides on "discussion-reply" and carries its catalogue
// kind in `data.kind`; the Feed renders from `data`, not from Knock's templates.
export type DemoNotification = {
  kind:
    | "refund-approved"
    | "refund-declined"
    | "refund-request-opened"
    | "seat-claimed"
    | "new-enrollment"
    | "discussion-question"
    | "discussion-reply";
  course_title: string;
  lesson_title?: string;
  excerpt?: string;
  url: string;
};

export function sendDemoNotification(args: {
  actor: Person;
  to: Person;
  data: DemoNotification;
}) {
  return knock.workflows.trigger("discussion-reply", {
    actor: recipient(args.actor),
    recipients: [recipient(args.to)],
    data: args.data,
  });
}
