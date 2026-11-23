import { db } from "~/db";
import {
  getLessonAccess,
  requireCourseStaff,
  requireInstructorOrAdmin,
  requireLessonAccess,
  requireUserId,
  type CourseStaffTarget,
  type Db,
  type LessonTarget,
  type Viewer,
} from "./lib/course-access";

export type {
  CourseStaffGrant,
  CourseStaffTarget,
  LessonAccess,
  LessonDenial,
  LessonGrant,
  LessonTarget,
  Viewer,
} from "./lib/course-access";

/**
 * Course Access bound to a database: who may take a course's lessons, and who
 * is its Course Staff. The app uses `courseAccess`, which reads the app
 * database; tests build their own against a test database.
 *
 * Every call takes a `Viewer` from `getViewer` (./viewer.server), never a
 * Request. The `require*` calls throw React Router `data()` responses in a
 * fixed order: 401 signed out, then 404 for a missing or mismatched course,
 * module or lesson, then 403.
 */
export function createCourseAccess(database: Db) {
  return {
    /**
     * Whether the viewer may take this lesson: watch, read, discuss and record
     * progress. Granted to Course Staff and to Enrolled Students without a PPP
     * Block; otherwise denied with the one reason the page should explain.
     *
     * Still throws a 404 when the lesson doesn't exist or isn't in
     * `target.courseId`: that's a bad URL, not an access question.
     */
    lesson(viewer: Viewer, target: LessonTarget) {
      return getLessonAccess(database, viewer, target);
    },

    /** `lesson`, but throws 401/404/403 instead of returning a denial. */
    requireLesson(viewer: Viewer, target: LessonTarget) {
      return requireLessonAccess(database, viewer, target);
    },

    /**
     * Throws unless the viewer is the course's Instructor or a Platform Admin.
     * A `moduleId` or `lessonId` outside the course is a 404.
     */
    requireCourseStaff(viewer: Viewer, target: CourseStaffTarget) {
      return requireCourseStaff(database, viewer, target);
    },

    /** Throws 401 unless someone is signed in. Returns their user id. */
    requireUserId(viewer: Viewer) {
      return requireUserId(viewer);
    },

    /**
     * Throws unless the viewer is an Instructor or a Platform Admin, without
     * tying them to a course: for pages that span all of someone's courses.
     */
    requireInstructorOrAdmin(viewer: Viewer) {
      return requireInstructorOrAdmin(database, viewer);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const courseAccess = /* @__PURE__ */ createCourseAccess(db);
