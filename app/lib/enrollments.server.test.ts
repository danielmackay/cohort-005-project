import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { enrollUser } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("enrollUser", () => {
  it("enrols a Student in a course", () => {
    const result = enrollUser(db, base.user.id, base.course.id, NOW);

    expect(result).toMatchObject({
      ok: true,
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
        completedAt: null,
      },
    });
  });

  it("refuses a Student who is already enrolled", () => {
    enrollUser(db, base.user.id, base.course.id, NOW);

    expect(enrollUser(db, base.user.id, base.course.id, NOW)).toEqual({
      ok: false,
      status: 409,
      error: "User is already enrolled in this course",
    });
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
  });

  it("refuses a course that doesn't exist", () => {
    expect(enrollUser(db, base.user.id, 9999, NOW)).toEqual({
      ok: false,
      status: 404,
      error: "Course not found",
    });
  });

  it("enrols a Lapsed Student again", () => {
    const first = enrollUser(db, base.user.id, base.course.id, NOW);
    if (!first.ok) throw new Error(first.error);
    db.delete(schema.enrollments).run();

    const LATER = new Date(2026, 10, 1);
    expect(enrollUser(db, base.user.id, base.course.id, LATER)).toMatchObject({
      ok: true,
      enrollment: { enrolledAt: LATER.toISOString() },
    });
  });
});
