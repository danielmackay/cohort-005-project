// PROTOTYPE — throwaway spike for wayfinder ticket "Does Knock hold up against Cadence?" (#26).
// Not production code: no error handling, no abstractions, no tests.
import Knock, { signUserToken } from "@knocklabs/node";

// react-router dev does not load .env into process.env for server code.
if (!process.env.KNOCK_API_KEY) process.loadEnvFile(".env");

export const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY! });

export const knockPublicConfig = () => ({
  publicApiKey: process.env.KNOCK_PUBLIC_API_KEY!,
  feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
});

// Cadence user ids are integers; Knock wants strings.
export const knockUserId = (id: number) => `cadence-user-${id}`;

// Check 1: RS256 user token for whoever the session says is the current user.
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

// Check 2: Discussion Reply → question author. Inline-identifies both users.
export function notifyDiscussionReply(args: {
  replier: Person;
  questionAuthor: Person;
  lessonTitle: string;
  lessonUrl: string;
  replyExcerpt: string;
}) {
  return knock.workflows.trigger("discussion-reply", {
    actor: recipient(args.replier),
    recipients: [recipient(args.questionAuthor)],
    data: {
      lesson_title: args.lessonTitle,
      lesson_url: args.lessonUrl,
      reply_excerpt: args.replyExcerpt,
    },
  });
}

// Check 4: new Enrollment → Instructor (should be OFF unless the Instructor opted in).
export function notifyNewEnrollment(args: {
  student: Person;
  instructor: Person;
  courseTitle: string;
}) {
  return knock.workflows.trigger("new-enrollment", {
    actor: recipient(args.student),
    recipients: [recipient(args.instructor)],
    data: { course_title: args.courseTitle },
  });
}
