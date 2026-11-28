import { describe, it, expect } from "vitest";
import { LessonProgressStatus } from "~/db/schema";
import { addLesson, addModule, addWatchEvent, setUp } from "./fixtures";

describe("getCourseWithDetails", () => {
  it("is null for an unknown course", () => {
    const { page } = setUp();
    expect(page.getCourseWithDetails(999)).toBeNull();
  });

  it("returns modules in order, each with its own lessons in order", () => {
    const { db, page, course, instructor } = setUp();
    const second = addModule(db, course.id, 2);
    const first = addModule(db, course.id, 1);
    const b = addLesson(db, first.id, 2);
    const a = addLesson(db, first.id, 1);
    const c = addLesson(db, second.id, 1);

    const details = page.getCourseWithDetails(course.id);

    expect(details?.instructorName).toBe(instructor.name);
    expect(details?.categoryName).toBe("Programming");
    expect(details?.modules.map((m) => m.id)).toEqual([first.id, second.id]);
    expect(details?.modules[0].lessons.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(details?.modules[1].lessons.map((l) => l.id)).toEqual([c.id]);
  });

  it("returns a course with no modules", () => {
    const { page, course } = setUp();
    expect(page.getCourseWithDetails(course.id)?.modules).toEqual([]);
  });
});

describe("lesson progress", () => {
  it("starts a lesson as in progress", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);

    page.markLessonInProgress(user.id, lesson.id);

    expect(page.getLessonProgress(user.id, lesson.id)?.status).toBe(
      LessonProgressStatus.InProgress
    );
  });

  it("completes a lesson with a completion time", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);

    const progress = page.markLessonComplete(user.id, lesson.id);

    expect(progress.status).toBe(LessonProgressStatus.Completed);
    expect(progress.completedAt).not.toBeNull();
  });

  it("completes a lesson that was in progress, keeping one row", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    const started = page.markLessonInProgress(user.id, lesson.id);

    const completed = page.markLessonComplete(user.id, lesson.id);

    expect(completed.id).toBe(started.id);
    expect(completed.status).toBe(LessonProgressStatus.Completed);
  });

  it("never moves a completed lesson back to in progress", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    page.markLessonComplete(user.id, lesson.id);

    const after = page.markLessonInProgress(user.id, lesson.id);

    expect(after.status).toBe(LessonProgressStatus.Completed);
  });

  it("moves a lesson with another status to in progress", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    const first = page.markLessonInProgress(user.id, lesson.id);

    const again = page.markLessonInProgress(user.id, lesson.id);

    expect(again.id).toBe(first.id);
    expect(again.status).toBe(LessonProgressStatus.InProgress);
  });

  it("lists one Student's progress in one course only", () => {
    const { db, page, course, user, instructor } = setUp();
    const mod = addModule(db, course.id, 1);
    const a = addLesson(db, mod.id, 1);
    const b = addLesson(db, mod.id, 2);
    page.markLessonComplete(user.id, a.id);
    page.markLessonInProgress(user.id, b.id);
    page.markLessonComplete(instructor.id, a.id);

    const rows = page.getLessonProgressForCourse(user.id, course.id);

    expect(rows.map((r) => r.lessonId).sort()).toEqual([a.id, b.id].sort());
    expect(rows.every((r) => r.userId === user.id)).toBe(true);
  });

  it("lists nothing for a course with no modules or no lessons", () => {
    const { db, page, course, user } = setUp();
    expect(page.getLessonProgressForCourse(user.id, course.id)).toEqual([]);
    addModule(db, course.id, 1);
    expect(page.getLessonProgressForCourse(user.id, course.id)).toEqual([]);
  });
});

describe("watching", () => {
  it("resumes from the start when nothing was watched", () => {
    const { page, user } = setUp();
    expect(page.getLastWatchPosition(user.id, 1)).toBe(0);
  });

  it("resumes from the most recent position, not the furthest", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    const ref = { userId: user.id, lessonId: lesson.id };
    addWatchEvent(db, { ...ref, positionSeconds: 300 }, "2026-01-01T10:00:00Z");
    addWatchEvent(db, { ...ref, positionSeconds: 120 }, "2026-01-01T11:00:00Z");

    expect(page.getLastWatchPosition(user.id, lesson.id)).toBe(120);
  });

  it("reports the furthest position as a rounded percentage", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    const ref = { userId: user.id, lessonId: lesson.id };
    addWatchEvent(db, { ...ref, positionSeconds: 200 }, "2026-01-01T10:00:00Z");
    addWatchEvent(db, { ...ref, positionSeconds: 50 }, "2026-01-01T11:00:00Z");

    expect(page.calculateWatchProgress(user.id, lesson.id, 600)).toBe(33);
  });

  it("caps progress at 100 and is 0 without a duration or any events", () => {
    const { db, page, course, user } = setUp();
    const lesson = addLesson(db, addModule(db, course.id, 1).id, 1);
    expect(page.calculateWatchProgress(user.id, lesson.id, 600)).toBe(0);
    const ref = { userId: user.id, lessonId: lesson.id };
    addWatchEvent(db, { ...ref, positionSeconds: 700 }, "2026-01-01T10:00:00Z");

    expect(page.calculateWatchProgress(user.id, lesson.id, 600)).toBe(100);
    expect(page.calculateWatchProgress(user.id, lesson.id, 0)).toBe(0);
  });
});
