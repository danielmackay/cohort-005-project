import { and, eq } from "drizzle-orm";
import { courses, enrollments } from "~/db/schema";
import type { Failure, Queryable } from "~/lib/refunds.server";

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
 * Enrols a Student in a course. Takes a transaction as well as the database so
 * a Seat claim can enrol in the same transaction that claims the Seat.
 */
export function enrollUser(
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
