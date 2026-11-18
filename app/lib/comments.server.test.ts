import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { createComment, deleteComment, editComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

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
  it("posts a Discussion Question with the body trimmed", () => {
    const result = createComment(
      db,
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

  it("refuses an empty comment", () => {
    expect(createComment(db, base.user.id, lessonId, null, "   ", NOW)).toEqual(
      { ok: false, status: 400, error: "Comment cannot be empty" }
    );
    expect(db.select().from(schema.comments).all()).toHaveLength(0);
  });

  it("refuses a comment over the length limit", () => {
    const result = createComment(
      db,
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

  it("accepts a comment exactly at the length limit", () => {
    const result = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "x".repeat(MAX_COMMENT_LENGTH),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a comment on a lesson that doesn't exist", () => {
    expect(createComment(db, base.user.id, 9999, null, "Hi", NOW)).toEqual({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });

  it("posts a Discussion Reply under a Discussion Question", () => {
    const question = postQuestion(base.user.id);

    const result = createComment(
      db,
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

  it("refuses a reply to a reply", () => {
    const question = postQuestion(base.user.id);
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Here's how.",
      NOW
    );
    if (!reply.ok) throw new Error("reply should have been posted");

    expect(
      createComment(db, base.user.id, lessonId, reply.comment.id, "Thanks", NOW)
    ).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a reply to a question on another lesson", () => {
    const question = postQuestion(base.user.id);
    const otherLessonId = addLesson(2);

    expect(
      createComment(db, base.user.id, otherLessonId, question.id, "Hi", NOW)
    ).toEqual({
      ok: false,
      status: 400,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a reply to a question that doesn't exist", () => {
    expect(createComment(db, base.user.id, lessonId, 9999, "Hi", NOW)).toEqual({
      ok: false,
      status: 404,
      error: "Parent comment not found",
    });
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("soft-deletes the author's own comment", () => {
    const question = postQuestion(base.user.id);

    const result = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: LATER.toISOString() },
    });
  });

  it("lets staff delete someone else's comment", () => {
    const question = postQuestion(base.user.id);

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

  it("refuses to delete someone else's comment for a non-staff user", () => {
    const question = postQuestion(base.instructor.id);

    expect(deleteComment(db, question.id, base.user.id, false, LATER)).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
    expect(getStored(question.id)?.deletedAt).toBeNull();
  });

  it("refuses a comment that doesn't exist", () => {
    expect(deleteComment(db, 9999, base.user.id, false, LATER)).toEqual({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });

  it("keeps the first deletion time when deleted twice", () => {
    const question = postQuestion(base.user.id);
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

  it("replaces the author's body and records when it was edited", () => {
    const question = postQuestion(base.user.id);

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

  it("refuses to edit someone else's comment", () => {
    const question = postQuestion(base.user.id);

    expect(
      editComment(db, question.id, base.instructor.id, "Mine now", LATER)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    });
  });

  it("refuses to edit a deleted comment", () => {
    const question = postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, LATER);

    expect(
      editComment(db, question.id, base.user.id, "Back again", LATER)
    ).toEqual({ ok: false, status: 409, error: "Comment has been deleted" });
  });

  it("refuses an empty body", () => {
    const question = postQuestion(base.user.id);

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

function postQuestion(authorId: number, onLessonId = lessonId) {
  const result = createComment(
    db,
    authorId,
    onLessonId,
    null,
    "How do closures work?",
    NOW
  );
  if (!result.ok) throw new Error(`question not posted: ${result.error}`);
  return result.comment;
}
