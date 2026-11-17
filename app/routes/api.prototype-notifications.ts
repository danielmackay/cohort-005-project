// PROTOTYPE: seeds the current user's Notification Feed with one of each catalogue Notification.
import { eq, ne } from "drizzle-orm";
import type { Route } from "./+types/api.prototype-notifications";
import { db } from "~/db";
import { users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  sendDemoNotification,
  type DemoNotification,
} from "~/prototype/knock.server";

const course = "Introduction to TypeScript";
const lessonUrl = "/courses/introduction-to-typescript/lessons/2";

const catalogue: DemoNotification[] = [
  { kind: "refund-approved", course_title: course, url: "/courses/introduction-to-typescript" },
  {
    kind: "refund-declined",
    course_title: course,
    excerpt: "More than half of the course has been completed.",
    url: "/courses/introduction-to-typescript",
  },
  { kind: "refund-request-opened", course_title: course, url: "/admin/refunds" },
  { kind: "seat-claimed", course_title: course, url: "/team" },
  { kind: "new-enrollment", course_title: course, url: "/instructor/1/students" },
  {
    kind: "discussion-question",
    course_title: course,
    lesson_title: "Installing and Configuring TypeScript",
    excerpt: "Why does tsc ignore my tsconfig when I pass a file name?",
    url: lessonUrl,
  },
  {
    kind: "discussion-reply",
    course_title: course,
    lesson_title: "Installing and Configuring TypeScript",
    excerpt: "Passing files on the command line skips tsconfig.json. Use -p instead.",
    url: lessonUrl,
  },
];

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) throw new Response("Pick a user", { status: 401 });
  const me = db.select().from(users).where(eq(users.id, currentUserId)).get()!;
  const others = db.select().from(users).where(ne(users.id, currentUserId)).all();
  const form = await request.formData();
  const only = form.get("kind");
  const picks = only ? catalogue.filter((c) => c.kind === only) : catalogue;

  // Sequential so the feed's newest-first order matches catalogue order reversed.
  for (const [i, data] of picks.entries()) {
    await sendDemoNotification({
      actor: others[(i + Math.floor(Math.random() * others.length)) % others.length],
      to: me,
      data,
    });
  }
  return { sent: picks.length };
}
