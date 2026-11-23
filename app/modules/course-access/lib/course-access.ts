import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  UserRole,
  courses,
  lessons,
  modules,
  purchases,
  users,
} from "~/db/schema";
import { isEnrolled } from "~/lib/enrollments.server";
import { checkPppAccess } from "~/lib/ppp";

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Who is asking, resolved once per request. `country` is where they are now,
 * not where they bought; null means unknown, which never triggers a PPP Block.
 */
export type Viewer = {
  userId: number | null;
  country: string | null;
};

export type LessonTarget = {
  lessonId: number;
  /**
   * The course the URL names. When given, a lesson from any other course is a
   * 404, so access to one course can't reach another course's lesson by id.
   */
  courseId?: number;
};

export type LessonDenial =
  | { reason: "signed-out" }
  | { reason: "not-enrolled"; userId: number }
  | {
      reason: "ppp-blocked";
      userId: number;
      purchaseCountry: string;
      currentCountry: string;
    };

export type LessonGrant = {
  userId: number;
  isCourseStaff: boolean;
  /**
   * Course Staff have Course Access without an Enrollment. Progress belongs to
   * Students, so callers record it only when this is true.
   */
  enrolled: boolean;
};

export type LessonAccess = { courseId: number } & (
  | ({ granted: true } & LessonGrant)
  | ({ granted: false } & LessonDenial)
);

export type CourseStaffTarget = {
  courseId: number;
  /** When given, must belong to the course, or the call is a 404. */
  moduleId?: number;
  /** When given, must belong to the course, or the call is a 404. */
  lessonId?: number;
};

export type CourseStaffGrant = {
  userId: number;
  isPlatformAdmin: boolean;
};

// One wording per outcome. These used to drift across a dozen hand-written
// guards; keeping them here is what makes every route answer the same way.
const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";
const NOT_COURSE_STAFF_MESSAGE =
  "Only this course's Instructor or a Platform Admin can do that.";
const NO_COURSE_ACCESS_MESSAGE = "You must be enrolled in this course.";
const PPP_BLOCKED_MESSAGE =
  "This course was bought with a regional discount and can only be taken from the country it was bought in.";

function signedOut(): never {
  throw data(SIGNED_OUT_MESSAGE, { status: 401 });
}

function notFound(message: string): never {
  throw data(message, { status: 404 });
}

function forbidden(message: string): never {
  throw data(message, { status: 403 });
}

function findUser(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function findCourse(db: Db, id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function findModuleCourseId(db: Db, moduleId: number) {
  return db
    .select({ courseId: modules.courseId })
    .from(modules)
    .where(eq(modules.id, moduleId))
    .get()?.courseId;
}

function findLessonCourseId(db: Db, lessonId: number) {
  return db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessons.id, lessonId))
    .get()?.courseId;
}

function findPurchaseCountry(db: Db, userId: number, courseId: number) {
  return (
    db
      .select({ country: purchases.country })
      .from(purchases)
      .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
      .get()?.country ?? null
  );
}

function isCourseStaff(
  user: typeof users.$inferSelect,
  course: typeof courses.$inferSelect
) {
  return user.role === UserRole.Admin || course.instructorId === user.id;
}

/** The course the lesson belongs to, or a 404 if it doesn't exist or isn't in `target.courseId`. */
function resolveLessonCourse(db: Db, target: LessonTarget) {
  const lessonCourseId = findLessonCourseId(db, target.lessonId);
  if (lessonCourseId === undefined) notFound("Lesson not found.");
  if (target.courseId !== undefined && target.courseId !== lessonCourseId) {
    notFound("Lesson not found in this course.");
  }
  const course = findCourse(db, lessonCourseId);
  if (!course) notFound("Course not found.");
  return course;
}

export function getLessonAccess(
  db: Db,
  viewer: Viewer,
  target: LessonTarget
): LessonAccess {
  const course = resolveLessonCourse(db, target);
  const courseId = course.id;

  if (viewer.userId === null) {
    return { courseId, granted: false, reason: "signed-out" };
  }
  // A session pointing at a deleted user is treated as signed out rather than
  // erroring, so a stale cookie still renders the paywall.
  const user = findUser(db, viewer.userId);
  if (!user) return { courseId, granted: false, reason: "signed-out" };
  const userId = user.id;

  const enrolled = isEnrolled(db, userId, courseId);

  // Course Staff speak for the course: they need no Enrollment, and a PPP
  // Block never applies to them.
  if (isCourseStaff(user, course)) {
    return { courseId, granted: true, userId, isCourseStaff: true, enrolled };
  }

  if (!enrolled) {
    return { courseId, granted: false, reason: "not-enrolled", userId };
  }

  const ppp = checkPppAccess(
    course.price,
    course.pppEnabled,
    findPurchaseCountry(db, userId, courseId),
    viewer.country
  );
  if (ppp.blocked && ppp.purchaseCountry && ppp.blockedCountry) {
    return {
      courseId,
      granted: false,
      reason: "ppp-blocked",
      userId,
      purchaseCountry: ppp.purchaseCountry,
      currentCountry: ppp.blockedCountry,
    };
  }

  return { courseId, granted: true, userId, isCourseStaff: false, enrolled };
}

export function requireLessonAccess(
  db: Db,
  viewer: Viewer,
  target: LessonTarget
): { courseId: number } & LessonGrant {
  const access = getLessonAccess(db, viewer, target);
  if (access.granted) {
    const { granted: _granted, ...grant } = access;
    return grant;
  }
  switch (access.reason) {
    case "signed-out":
      return signedOut();
    case "not-enrolled":
      return forbidden(NO_COURSE_ACCESS_MESSAGE);
    case "ppp-blocked":
      return forbidden(PPP_BLOCKED_MESSAGE);
  }
}

export function requireCourseStaff(
  db: Db,
  viewer: Viewer,
  target: CourseStaffTarget
): CourseStaffGrant {
  if (viewer.userId === null) signedOut();
  const user = findUser(db, viewer.userId);
  if (!user) signedOut();

  const course = findCourse(db, target.courseId);
  if (!course) notFound("Course not found.");

  if (
    target.moduleId !== undefined &&
    findModuleCourseId(db, target.moduleId) !== course.id
  ) {
    notFound("Module not found in this course.");
  }
  if (
    target.lessonId !== undefined &&
    findLessonCourseId(db, target.lessonId) !== course.id
  ) {
    notFound("Lesson not found in this course.");
  }

  if (!isCourseStaff(user, course)) forbidden(NOT_COURSE_STAFF_MESSAGE);

  return { userId: user.id, isPlatformAdmin: user.role === UserRole.Admin };
}

export function requireUserId(viewer: Viewer): number {
  if (viewer.userId === null) signedOut();
  return viewer.userId;
}

/**
 * For pages that span all of someone's courses rather than one course, so
 * Course Staff doesn't apply.
 */
export function requireInstructorOrAdmin(db: Db, viewer: Viewer) {
  const userId = requireUserId(viewer);
  const user = findUser(db, userId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    forbidden("Only instructors can access this page.");
  }

  return { userId, user, isAdmin: user.role === UserRole.Admin };
}
