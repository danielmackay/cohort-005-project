import { and, eq } from "drizzle-orm";
import { courses, enrollments, users } from "~/db/schema";
import { NotificationType, courseStudentsUrl } from "~/lib/notifications";
import {
  notifyAfterCommit,
  type NotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import type { Db, Failure, Queryable } from "~/lib/refunds.server";

// ─── Enrollments ───
// Enrolling a Student in a course, from an Individual Purchase or a Claimed
// Seat. An Enrollment is not tied to the Purchase behind it (docs/adr/0004),
// so a Lapsed Student is enrolled again with a fresh row.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Enrollment = typeof enrollments.$inferSelect;

export type EnrollResult = { ok: true; enrollment: Enrollment } | Failure;

export function findEnrollment(
  db: Queryable,
  userId: number,
  courseId: number
): Enrollment | undefined {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Enrols a Student in a course and tells the Instructor. Use insertEnrollment
 * instead when the Enrollment is one write in a bigger transaction.
 */
export async function enrollUser(
  db: Db,
  notifications: Notifications,
  userId: number,
  courseId: number,
  now: Date
): Promise<EnrollResult> {
  const result = insertEnrollment(db, userId, courseId, now);
  if (!result.ok) return result;

  await notifyEnrollment(db, notifications, result.enrollment);
  return result;
}

/**
 * Writes an Enrollment without sending anything, so it can run inside a
 * transaction (a Seat claim, an Individual Purchase). The caller sends the
 * Enrollment Notification with notifyEnrollment once the transaction commits.
 */
export function insertEnrollment(
  db: Queryable,
  userId: number,
  courseId: number,
  now: Date
): EnrollResult {
  if (findEnrollment(db, userId, courseId)) {
    return {
      ok: false,
      status: 409,
      error: "User is already enrolled in this course",
    };
  }

  const course = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    return { ok: false, status: 404, error: "Course not found" };
  }

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();

  return { ok: true, enrollment };
}

// ─── Enrollment Notification ───

export function getNotificationUser(
  db: Queryable,
  userId: number
): NotificationUser | undefined {
  const user = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user;
}

/**
 * Tells the course's Instructor about a new Enrollment. Call it only after the
 * Enrollment has committed: a failing port is logged and never fails the
 * Enrollment.
 */
export async function notifyEnrollment(
  db: Queryable,
  notifications: Notifications,
  enrollment: Enrollment
): Promise<void> {
  const course = db
    .select({ title: courses.title, instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, enrollment.courseId))
    .get();
  const student = getNotificationUser(db, enrollment.userId);
  const instructor = course && getNotificationUser(db, course.instructorId);

  if (!course || !student || !instructor) {
    console.error(
      `[notifications] Not sending the Enrollment Notification for Enrollment ${enrollment.id}: ` +
        `its course, Student or Instructor was not found`
    );
    return;
  }

  // Notifications are only for what someone else did.
  if (instructor.id === student.id) return;

  // Sent to every Instructor regardless: the vendor drops it for anyone whose
  // Enrollments preference is off, which it is by default.
  await notifyAfterCommit(notifications, {
    type: NotificationType.NewEnrollment,
    recipients: [instructor],
    sender: student,
    data: {
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      studentName: student.name,
      courseTitle: course.title,
      url: courseStudentsUrl(enrollment.courseId),
    },
    idempotencyKey: `${NotificationType.NewEnrollment}:${enrollment.id}`,
  });
}
