import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";
import * as schema from "~/db/schema";
import { NotificationType } from "~/lib/notifications";
import { enrollUser } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  notifications = createFakeNotifications();
  base = seedBaseData(db);
});

describe("enrollUser", () => {
  it("enrols a Student in a course", async () => {
    const result = await enrollUser(
      db,
      notifications,
      base.user.id,
      base.course.id,
      NOW
    );

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

  it("refuses a Student who is already enrolled", async () => {
    await enrollUser(db, notifications, base.user.id, base.course.id, NOW);

    expect(
      await enrollUser(db, notifications, base.user.id, base.course.id, NOW)
    ).toEqual({
      ok: false,
      status: 409,
      error: "Student is already enrolled in this course",
    });
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
  });

  it("refuses a course that doesn't exist", async () => {
    expect(
      await enrollUser(db, notifications, base.user.id, 9999, NOW)
    ).toEqual({
      ok: false,
      status: 404,
      error: "Course not found",
    });
  });

  it("enrols a Lapsed Student again", async () => {
    const first = await enrollUser(
      db,
      notifications,
      base.user.id,
      base.course.id,
      NOW
    );
    if (!first.ok) throw new Error(first.error);
    db.delete(schema.enrollments).run();

    const LATER = new Date(2026, 10, 1);
    expect(
      await enrollUser(db, notifications, base.user.id, base.course.id, LATER)
    ).toMatchObject({
      ok: true,
      enrollment: { enrolledAt: LATER.toISOString() },
    });
  });
});

describe("enrollUser Notifications", () => {
  it("tells the course's Instructor who enrolled, linking to the students page", async () => {
    const result = await enrollUser(
      db,
      notifications,
      base.user.id,
      base.course.id,
      NOW
    );
    if (!result.ok) throw new Error(result.error);

    expect(notifications.notified).toEqual([
      {
        type: NotificationType.NewEnrollment,
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        sender: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: {
          enrollmentId: result.enrollment.id,
          courseId: base.course.id,
          studentName: "Test User",
          courseTitle: "Test Course",
          url: `/instructor/${base.course.id}/students`,
        },
        idempotencyKey: `new-enrollment:${result.enrollment.id}`,
      },
    ]);
  });

  it("tells the Instructor again when a Lapsed Student enrols again", async () => {
    await enrollUser(db, notifications, base.user.id, base.course.id, NOW);
    db.delete(schema.enrollments).run();

    const again = await enrollUser(
      db,
      notifications,
      base.user.id,
      base.course.id,
      new Date(2026, 10, 1)
    );
    if (!again.ok) throw new Error(again.error);

    expect(notifications.notified).toHaveLength(2);
    expect(notifications.notified[1]).toMatchObject({
      type: NotificationType.NewEnrollment,
      data: { enrollmentId: again.enrollment.id },
      idempotencyKey: `new-enrollment:${again.enrollment.id}`,
    });
  });

  it("doesn't tell the Instructor about enrolling in their own course", async () => {
    await enrollUser(
      db,
      notifications,
      base.instructor.id,
      base.course.id,
      NOW
    );

    expect(notifications.notified).toEqual([]);
  });

  it("sends nothing for a refused Enrollment", async () => {
    await enrollUser(db, notifications, base.user.id, base.course.id, NOW);
    notifications.notified.length = 0;

    await enrollUser(db, notifications, base.user.id, base.course.id, NOW);
    await enrollUser(db, notifications, base.user.id, 9999, NOW);

    expect(notifications.notified).toEqual([]);
  });

  it("still enrols the Student when the port fails", async () => {
    notifications.failWith(new Error("Knock is down"));

    const result = await enrollUser(
      db,
      notifications,
      base.user.id,
      base.course.id,
      NOW
    );

    expect(result).toMatchObject({ ok: true });
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
  });
});
