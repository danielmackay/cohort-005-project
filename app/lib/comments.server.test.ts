import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { createComment, deleteComment, editComment } from "./comments.server";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotifications();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

describe("createComment", () => {
  it("posts a Discussion Question with the body trimmed", async () => {
    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  ",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "How do closures work?",
        createdAt: NOW.toISOString(),
      },
    });
  });

  it("refuses an empty comment", async () => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        null,
        "   ",
        NOW
      )
    ).toEqual({ ok: false, status: 400, error: "Comment cannot be empty" });
    expect(db.select().from(schema.comments).all()).toHaveLength(0);
  });

  it("refuses a comment over the length limit", async () => {
    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "x".repeat(MAX_COMMENT_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
    expect(db.select().from(schema.comments).all()).toHaveLength(0);
  });

  it("accepts a comment exactly at the length limit", async () => {
    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "x".repeat(MAX_COMMENT_LENGTH),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a comment on a lesson that doesn't exist", async () => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        9999,
        null,
        "Hi",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });

  it("posts a Discussion Reply under a Discussion Question", async () => {
    const question = await postQuestion(base.user.id);

    const result = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Here's how.",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { parentId: question.id, userId: base.instructor.id },
    });
  });

  it("refuses a reply to a reply", async () => {
    const question = await postQuestion(base.user.id);
    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Here's how.",
      NOW
    );
    if (!reply.ok) throw new Error("reply should have been posted");

    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        reply.comment.id,
        "Thanks",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a reply to a question on another lesson", async () => {
    const question = await postQuestion(base.user.id);
    const otherLessonId = addLesson(2);

    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        otherLessonId,
        question.id,
        "Hi",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a reply to a question that doesn't exist", async () => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        9999,
        "Hi",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 404,
      error: "Parent comment not found",
    });
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("soft-deletes the author's own comment", async () => {
    const question = await postQuestion(base.user.id);

    const result = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: LATER.toISOString() },
    });
  });

  it("lets staff delete someone else's comment", async () => {
    const question = await postQuestion(base.user.id);

    const result = deleteComment(
      db,
      question.id,
      base.instructor.id,
      true,
      LATER
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { deletedAt: LATER.toISOString() },
    });
  });

  it("refuses to delete someone else's comment for a non-staff user", async () => {
    const question = await postQuestion(base.instructor.id);

    expect(deleteComment(db, question.id, base.user.id, false, LATER)).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
    expect(getStored(question.id)?.deletedAt).toBeNull();
  });

  it("refuses a comment that doesn't exist", async () => {
    expect(deleteComment(db, 9999, base.user.id, false, LATER)).toEqual({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });

  it("keeps the first deletion time when deleted twice", async () => {
    const question = await postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, LATER);

    const again = deleteComment(
      db,
      question.id,
      base.user.id,
      false,
      new Date(2026, 9, 8)
    );

    expect(again).toMatchObject({
      ok: true,
      comment: { deletedAt: LATER.toISOString() },
    });
  });
});

describe("editComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("replaces the author's body and records when it was edited", async () => {
    const question = await postQuestion(base.user.id);

    const result = editComment(
      db,
      question.id,
      base.user.id,
      "  Edited  ",
      LATER
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { body: "Edited", editedAt: LATER.toISOString() },
    });
  });

  it("refuses to edit someone else's comment", async () => {
    const question = await postQuestion(base.user.id);

    expect(
      editComment(db, question.id, base.instructor.id, "Mine now", LATER)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    });
  });

  it("refuses to edit a deleted comment", async () => {
    const question = await postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, LATER);

    expect(
      editComment(db, question.id, base.user.id, "Back again", LATER)
    ).toEqual({ ok: false, status: 409, error: "Comment has been deleted" });
  });

  it("refuses an empty body", async () => {
    const question = await postQuestion(base.user.id);

    expect(editComment(db, question.id, base.user.id, " ", LATER)).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
    expect(getStored(question.id)?.body).toBe("How do closures work?");
  });
});

function getStored(commentId: number) {
  return db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, commentId))
    .get();
}

function addLesson(position: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "More", position: position })
    .returning()
    .get();
  return db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: `Lesson ${position}`, position })
    .returning()
    .get().id;
}

async function postQuestion(authorId: number, onLessonId = lessonId) {
  const result = await createComment(
    db,
    notifications,
    authorId,
    onLessonId,
    null,
    "How do closures work?",
    NOW
  );
  if (!result.ok) throw new Error(`question not posted: ${result.error}`);
  return result.comment;
}

async function postReply(authorId: number, questionId: number, body: string) {
  const result = await createComment(
    db,
    notifications,
    authorId,
    lessonId,
    questionId,
    body,
    NOW
  );
  if (!result.ok) throw new Error(`reply not posted: ${result.error}`);
  return result.comment;
}

describe("Discussion Reply Notification", () => {
  it("notifies the question's author when someone else replies", async () => {
    const question = await postQuestion(base.user.id);

    const reply = await postReply(
      base.instructor.id,
      question.id,
      "Closures capture variables."
    );

    expect(notifications.notified).toEqual([
      {
        type: "discussion-reply",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        sender: {
          id: base.instructor.id,
          name: "Test Instructor",
          email: "instructor@example.com",
          avatarUrl: null,
        },
        data: {
          commentId: reply.id,
          questionId: question.id,
          lessonId,
          lessonTitle: "Lesson 1",
          courseSlug: "test-course",
          snippet: "Closures capture variables.",
          url: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
        },
        idempotencyKey: `discussion-reply:${reply.id}`,
      },
    ]);
  });

  it("sends nothing when the author replies to their own question", async () => {
    const question = await postQuestion(base.user.id);

    await postReply(base.user.id, question.id, "Never mind, I worked it out.");

    expect(notifications.notified).toEqual([]);
  });

  it("notifies only the question's author, never other repliers in the thread", async () => {
    const question = await postQuestion(base.user.id);
    await postReply(base.instructor.id, question.id, "First answer.");
    notifications.notified.length = 0;

    const otherReplier = db
      .insert(schema.users)
      .values({
        name: "Other Student",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    await postReply(otherReplier.id, question.id, "Same question here.");

    expect(
      notifications.notified.map((n) => n.recipients.map((r) => r.id))
    ).toEqual([[base.user.id]]);
  });

  it("still posts the reply when sending the Notification fails", async () => {
    const question = await postQuestion(base.user.id);
    notifications.failWith(new Error("Knock is down"));

    const result = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Here's how.",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { parentId: question.id, body: "Here's how." },
    });
    expect(
      db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.parentId, question.id))
        .all()
    ).toHaveLength(1);
  });

  it("cuts a long reply down to a one-line snippet", async () => {
    const question = await postQuestion(base.user.id);

    await postReply(
      base.instructor.id,
      question.id,
      `First line\n\nsecond line ${"x".repeat(200)}`
    );

    const snippet = notifications.notified[0]?.data.snippet ?? "";
    expect(snippet.startsWith("First line second line xxx")).toBe(true);
    expect(snippet).toHaveLength(140);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
