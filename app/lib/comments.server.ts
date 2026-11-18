import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { NotificationType, commentUrl, toSnippet } from "~/lib/notifications";
import {
  notifyAfterCommit,
  type NotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import type { Failure, Queryable } from "~/lib/refunds.server";

// ─── Comments ───
// Discussion Questions (top-level comments) and Discussion Replies (one level
// beneath a question) on a lesson. See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Comment = typeof comments.$inferSelect;

export type CommentResult = { ok: true; comment: Comment } | Failure;

function getComment(db: Queryable, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function getLesson(db: Queryable, lessonId: number) {
  return db
    .select({ id: lessons.id, title: lessons.title, courseSlug: courses.slug })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function getNotificationUser(
  db: Queryable,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

function validateBody(body: string): { ok: true; body: string } | Failure {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, body: trimmed };
}

/**
 * Posts a Discussion Question (`parentId` null) or a Discussion Reply to one.
 * Replies are one level deep only, so a reply's parent must be a question on
 * the same lesson.
 *
 * A Discussion Reply from anyone but the question's author sends that author a
 * Discussion Reply Notification once the comment is saved. Other repliers in
 * the thread are never notified.
 */
export async function createComment(
  db: Queryable,
  notifications: Notifications,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): Promise<CommentResult> {
  const valid = validateBody(body);
  if (!valid.ok) return valid;

  const lesson = getLesson(db, lessonId);
  if (!lesson) {
    return { ok: false, status: 404, error: "Lesson not found" };
  }

  let question: Comment | undefined;
  if (parentId !== null) {
    const parent = getComment(db, parentId);
    if (!parent) {
      return { ok: false, status: 404, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return {
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      };
    }
    question = parent;
  }

  const comment = db
    .insert(comments)
    .values({
      userId: authorId,
      lessonId,
      parentId,
      body: valid.body,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  if (question && question.userId !== authorId) {
    await notifyQuestionAuthor(db, notifications, question, comment, lesson);
  }

  return { ok: true, comment };
}

async function notifyQuestionAuthor(
  db: Queryable,
  notifications: Notifications,
  question: Comment,
  reply: Comment,
  lesson: { id: number; title: string; courseSlug: string }
) {
  const recipient = getNotificationUser(db, question.userId);
  const sender = getNotificationUser(db, reply.userId);
  if (!recipient || !sender) {
    console.error(
      `[notifications] Not sending discussion-reply:${reply.id}: ` +
        `question author ${question.userId} or replier ${reply.userId} not found`
    );
    return;
  }

  await notifyAfterCommit(notifications, {
    type: NotificationType.DiscussionReply,
    recipients: [recipient],
    sender,
    data: {
      commentId: reply.id,
      questionId: question.id,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      courseSlug: lesson.courseSlug,
      snippet: toSnippet(reply.body),
      url: commentUrl(lesson.courseSlug, lesson.id, reply.id),
    },
    idempotencyKey: `discussion-reply:${reply.id}`,
  });
}

/** Replaces the body of the author's own comment. Deleted comments stay deleted. */
export function editComment(
  db: Queryable,
  commentId: number,
  editorId: number,
  body: string,
  now: Date
): CommentResult {
  const valid = validateBody(body);
  if (!valid.ok) return valid;

  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.deletedAt !== null) {
    return { ok: false, status: 409, error: "Comment has been deleted" };
  }
  if (existing.userId !== editorId) {
    return {
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    };
  }

  const comment = db
    .update(comments)
    .set({ body: valid.body, editedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}

/**
 * Soft-deletes a comment: its author or staff on the course may. The row stays
 * so a deleted question can still anchor the replies beneath it. Deleting an
 * already-deleted comment keeps its first deletion time.
 */
export function deleteComment(
  db: Queryable,
  commentId: number,
  deleterId: number,
  isStaff: boolean,
  now: Date
): CommentResult {
  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.userId !== deleterId && !isStaff) {
    return {
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    };
  }
  if (existing.deletedAt !== null) {
    return { ok: true, comment: existing };
  }

  const comment = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}
