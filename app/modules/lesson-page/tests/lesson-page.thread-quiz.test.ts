import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { addComment, addLesson, addModule, addQuiz, setUp } from "./fixtures";

function lessonSetUp() {
  const env = setUp();
  const lesson = addLesson(env.db, addModule(env.db, env.course.id, 1).id, 1);
  return { ...env, lesson };
}

describe("getLessonThread", () => {
  it("is empty for a lesson that does not exist", () => {
    const { page } = setUp();
    expect(page.getLessonThread(999)).toEqual([]);
  });

  it("nests replies under their question and marks the instructor", () => {
    const { db, page, lesson, user, instructor } = lessonSetUp();
    const question = addComment(db, { lessonId: lesson.id, userId: user.id });
    addComment(db, {
      lessonId: lesson.id,
      userId: instructor.id,
      parentId: question.id,
    });

    const [thread] = page.getLessonThread(lesson.id);

    expect(thread.id).toBe(question.id);
    expect(thread.author.isInstructor).toBe(false);
    expect(thread.author.isPlatformAdmin).toBe(false);
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0].author.isInstructor).toBe(true);
    expect(thread.replies[0].replies).toEqual([]);
  });

  it("drops a deleted question that has no replies", () => {
    const { db, page, lesson, user } = lessonSetUp();
    addComment(db, { lessonId: lesson.id, userId: user.id }, { deleted: true });
    expect(page.getLessonThread(lesson.id)).toEqual([]);
  });

  it("keeps a deleted question with replies, hiding its body", () => {
    const { db, page, lesson, user, instructor } = lessonSetUp();
    const question = addComment(
      db,
      { lessonId: lesson.id, userId: user.id },
      { body: "secret", deleted: true }
    );
    addComment(db, {
      lessonId: lesson.id,
      userId: instructor.id,
      parentId: question.id,
    });

    const [thread] = page.getLessonThread(lesson.id);

    expect(thread.deleted).toBe(true);
    expect(thread.body).toBe("");
    expect(thread.editedAt).toBeNull();
    expect(thread.replies).toHaveLength(1);
  });

  it("leaves deleted replies out", () => {
    const { db, page, lesson, user } = lessonSetUp();
    const question = addComment(db, { lessonId: lesson.id, userId: user.id });
    const ref = { lessonId: lesson.id, userId: user.id, parentId: question.id };
    addComment(db, ref, { deleted: true });

    const [thread] = page.getLessonThread(lesson.id);

    expect(thread.deleted).toBe(false);
    expect(thread.body).toBe("A question");
    expect(thread.replies).toEqual([]);
  });
});

describe("quizzes", () => {
  it("finds a lesson's quiz with its questions in position order", () => {
    const { db, page, lesson } = lessonSetUp();
    const { quiz, questions } = addQuiz(db, lesson.id, [
      QuestionType.MultipleChoice,
      QuestionType.TrueFalse,
    ]);

    expect(page.getQuizByLessonId(lesson.id)?.id).toBe(quiz.id);
    expect(page.getQuizById(quiz.id)?.lessonId).toBe(lesson.id);
    const full = page.getQuizWithQuestions(quiz.id);
    expect(full?.questions.map((q) => q.id)).toEqual(
      [...questions].reverse().map((q) => q.id)
    );
    expect(full?.questions[0].options).toHaveLength(2);
    expect(page.getQuizWithQuestions(999)).toBeNull();
  });

  it("grades every question type and records the attempt", () => {
    const { db, page, lesson, user } = lessonSetUp();
    const { quiz, questions } = addQuiz(db, lesson.id, [
      QuestionType.MultipleChoice,
      QuestionType.TrueFalse,
    ]);
    const [mc, tf] = questions;

    const result = page.computeResult(user.id, quiz.id, {
      [mc.id]: mc.right,
      [tf.id]: tf.right,
    });

    expect(result).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 2,
      totalQuestions: 2,
    });
    expect(result?.questionResults).toContainEqual({
      questionId: tf.id,
      correct: true,
      selectedOptionId: tf.right,
      correctOptionId: tf.right,
    });
    const answers = db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result?.attemptId ?? 0))
      .all();
    expect(answers).toHaveLength(2);
  });

  it("marks a wrong and an unanswered question, and fails the attempt", () => {
    const { db, page, lesson, user } = lessonSetUp();
    const types = [QuestionType.MultipleChoice, QuestionType.MultipleChoice];
    const { quiz, questions } = addQuiz(db, lesson.id, types);
    const [answered, skipped] = questions;

    const result = page.computeResult(user.id, quiz.id, {
      [answered.id]: answered.wrong,
    });

    expect(result).toMatchObject({ score: 0, passed: false, grade: "F" });
    expect(result?.questionResults).toContainEqual({
      questionId: skipped.id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    });
    expect(result?.questionResults).toContainEqual({
      questionId: answered.id,
      correct: false,
      selectedOptionId: answered.wrong,
      correctOptionId: answered.right,
    });
  });

  it.each([
    { right: 9, grade: "A", passed: true },
    { right: 8, grade: "B", passed: true },
    { right: 7, grade: "C", passed: false },
    { right: 6, grade: "D", passed: false },
    { right: 5, grade: "F", passed: false },
  ])(
    "of 10 questions, $right right grades $grade",
    ({ right, grade, passed }) => {
      const { db, page, lesson, user } = lessonSetUp();
      const types = Array.from({ length: 10 }, () => QuestionType.TrueFalse);
      const { quiz, questions } = addQuiz(db, lesson.id, types);
      const answers = Object.fromEntries(
        questions.map((q, i) => [q.id, i < right ? q.right : q.wrong])
      );

      expect(page.computeResult(user.id, quiz.id, answers)).toMatchObject({
        grade,
        passed,
      });
    }
  );

  it("scores an empty quiz as 0 and an unknown quiz as null", () => {
    const { db, page, lesson, user } = lessonSetUp();
    const { quiz } = addQuiz(db, lesson.id, []);
    expect(page.computeResult(user.id, quiz.id, {})?.score).toBe(0);
    expect(page.computeResult(user.id, 999, {})).toBeNull();
  });

  it("keeps the best attempt", () => {
    const { db, page, lesson, user } = lessonSetUp();
    const { quiz, questions } = addQuiz(db, lesson.id);
    const [q] = questions;
    page.computeResult(user.id, quiz.id, { [q.id]: q.right });
    page.computeResult(user.id, quiz.id, { [q.id]: q.wrong });

    expect(page.getBestAttempt(user.id, quiz.id)?.score).toBe(1);
  });
});
