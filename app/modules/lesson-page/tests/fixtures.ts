import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLessonPage } from "../index.server";

// The module only reads most of these tables; nothing else in it writes
// modules, lessons, quizzes, comments or watch events, so rows go in directly.
// Kept in one place so a schema change touches only this file.

export function setUp() {
  const db = createTestDb();
  const base = seedBaseData(db);
  return { db, ...base, page: createLessonPage(db) };
}

export function addModule(db: TestDb, courseId: number, position: number) {
  return db
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
}

export function addLesson(db: TestDb, moduleId: number, position: number) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title: `Lesson ${position}`, position })
    .returning()
    .get();
}

export function addWatchEvent(
  db: TestDb,
  event: { userId: number; lessonId: number; positionSeconds: number },
  createdAt: string
) {
  db.insert(schema.videoWatchEvents)
    .values({ ...event, eventType: "progress", createdAt })
    .run();
}

export function addComment(
  db: TestDb,
  comment: { lessonId: number; userId: number; parentId?: number },
  options: { body?: string; deleted?: boolean } = {}
) {
  return db
    .insert(schema.comments)
    .values({
      ...comment,
      body: markdown(options.body ?? "A question"),
      deletedAt: options.deleted ? "2026-01-01T00:00:00.000Z" : null,
    })
    .returning()
    .get();
}

/** A quiz whose questions each have one right and one wrong option. */
export function addQuiz(
  db: TestDb,
  lessonId: number,
  types: QuestionType[] = [QuestionType.MultipleChoice]
) {
  const quiz = db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check", passingScore: 0.7 })
    .returning()
    .get();
  const questions = types.map((questionType, index) => {
    const question = db
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Q${index + 1}`,
        questionType,
        // Stored in reverse so a test can see the reads order by position.
        position: types.length - index,
      })
      .returning()
      .get();
    const [right, wrong] = [true, false].map((isCorrect) =>
      db
        .insert(schema.quizOptions)
        .values({
          questionId: question.id,
          optionText: isCorrect ? "right" : "wrong",
          isCorrect,
        })
        .returning()
        .get()
    );
    return { id: question.id, right: right.id, wrong: wrong.id };
  });
  return { quiz, questions };
}
