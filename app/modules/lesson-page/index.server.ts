import { db } from "~/db";
import {
  calculateWatchProgress,
  computeResult,
  getBestAttempt,
  getCommentById,
  getCourseWithDetails,
  getLastWatchPosition,
  getLessonById,
  getLessonProgress,
  getLessonProgressForCourse,
  getLessonThread,
  getModuleById,
  getQuizById,
  getQuizByLessonId,
  getQuizWithQuestions,
  getUserById,
  markLessonComplete,
  markLessonInProgress,
  type Db,
} from "./lib/queries";

export type { CommentAuthor, ThreadComment } from "./lib/queries";

type Id = number;

/**
 * The reads and writes behind a Lesson page: the course and its curriculum,
 * the Student's progress and watch position, the Discussion thread, and the
 * quiz with its grading. The app uses `lessonPage`; tests build their own
 * against a test database.
 */
export function createLessonPage(database: Db) {
  return {
    getCourseWithDetails: (courseId: Id) =>
      getCourseWithDetails(database, courseId),
    getLessonById: (lessonId: Id) => getLessonById(database, lessonId),
    getModuleById: (moduleId: Id) => getModuleById(database, moduleId),
    getUserById: (userId: Id) => getUserById(database, userId),
    getLessonProgress: (userId: Id, lessonId: Id) =>
      getLessonProgress(database, userId, lessonId),
    getLessonProgressForCourse: (userId: Id, courseId: Id) =>
      getLessonProgressForCourse(database, userId, courseId),
    markLessonComplete: (userId: Id, lessonId: Id, now: Date) =>
      markLessonComplete(database, { userId, lessonId, now }),
    markLessonInProgress: (userId: Id, lessonId: Id) =>
      markLessonInProgress(database, userId, lessonId),
    getLastWatchPosition: (userId: Id, lessonId: Id) =>
      getLastWatchPosition(database, userId, lessonId),
    /** Furthest position watched, as a whole percentage of the video, 0–100. */
    calculateWatchProgress: (
      userId: Id,
      lessonId: Id,
      videoDurationSeconds: number
    ) =>
      calculateWatchProgress(
        database,
        { userId, lessonId },
        videoDurationSeconds
      ),
    getCommentById: (commentId: Id) => getCommentById(database, commentId),
    /** Top-level comments with their replies, oldest first. */
    getLessonThread: (lessonId: Id) => getLessonThread(database, lessonId),
    getQuizById: (quizId: Id) => getQuizById(database, quizId),
    getQuizByLessonId: (lessonId: Id) => getQuizByLessonId(database, lessonId),
    getQuizWithQuestions: (quizId: Id) =>
      getQuizWithQuestions(database, quizId),
    getBestAttempt: (userId: Id, quizId: Id) =>
      getBestAttempt(database, userId, quizId),
    /** Grades the answers and records the attempt. Null when it fails. */
    computeResult: (
      userId: Id,
      quizId: Id,
      selectedAnswers: Record<number, number>
    ) => computeResult(database, { userId, quizId }, selectedAnswers),
  };
}

export const lessonPage = createLessonPage(db);
