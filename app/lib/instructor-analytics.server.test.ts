import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import type { AnalyticsRange } from "./analytics";
import { markdown } from "./text";
import {
  getInstructorAnalytics,
  type AnalyticsViewer,
} from "./instructor-analytics.server";

// Midday, so moving a few hours either way for the machine's timezone never
// pushes "today" onto a different calendar day.
const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let otherInstructor: typeof schema.users.$inferSelect;
let otherCourse: typeof schema.courses.$inferSelect;
let admin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  otherInstructor = db
    .insert(schema.users)
    .values({
      name: "Other Instructor",
      email: "other@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();

  otherCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Someone else's course",
      salesCopy: markdown("## Other Course"),
      instructorId: otherInstructor.id,
      categoryId: base.category.id,
      status: CourseStatus.Published,
    })
    .returning()
    .get();

  admin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

function purchase(courseId: number, amountPaid: number, createdAt: string) {
  return db
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .returning()
    .get();
}

function asInstructor(): AnalyticsViewer {
  return { userId: base.instructor.id, isAdmin: false };
}

function asAdmin(): AnalyticsViewer {
  return { userId: admin.id, isAdmin: true };
}

function analytics(
  viewer: AnalyticsViewer,
  {
    range = "30d",
    requestedInstructorId = null,
    requestedCourseId = null,
  }: {
    range?: AnalyticsRange;
    requestedInstructorId?: number | null;
    requestedCourseId?: number | null;
  } = {}
) {
  return getInstructorAnalytics(
    db,
    viewer,
    { range, requestedInstructorId, requestedCourseId },
    NOW
  );
}

describe("getInstructorAnalytics", () => {
  describe("the date range", () => {
    it("measures the range back from the given now, not the real clock", () => {
      purchase(base.course.id, 1000, daysBefore(3));
      purchase(base.course.id, 2000, daysBefore(10));

      expect(analytics(asInstructor(), { range: "7d" }).summary).toMatchObject({
        grossCents: 1000,
        purchaseCount: 1,
      });
      expect(analytics(asInstructor(), { range: "30d" }).summary).toMatchObject(
        { grossCents: 3000, purchaseCount: 2 }
      );
    });

    it("ends the revenue series on the given now, one point per day", () => {
      purchase(base.course.id, 1000, daysBefore(3));

      const { series } = analytics(asInstructor(), { range: "7d" });

      expect(series.granularity).toBe("day");
      // Seven days back plus today itself.
      expect(series.points).toHaveLength(8);
      expect(series.points.at(-1)?.bucket).toBe(
        NOW.toISOString().slice(0, 10)
      );
    });
  });

  describe("refund exposure", () => {
    it("counts only purchases still inside their window as of the given now", () => {
      purchase(base.course.id, 1000, daysBefore(3));
      purchase(base.course.id, 2000, daysBefore(14));
      purchase(base.course.id, 4000, daysBefore(15));

      const { refundExposure, summary } = analytics(asInstructor());

      expect(summary.grossCents).toBe(7000);
      expect(refundExposure).toMatchObject({
        grossCents: 3000,
        purchaseCount: 2,
        closingTodayCount: 1,
        sharePercent: 43,
      });
      expect(refundExposure.courses).toEqual([
        {
          courseId: base.course.id,
          title: base.course.title,
          grossCents: 3000,
          purchaseCount: 2,
          // The most urgent purchase heads the course, not the newest.
          daysLeft: 0,
        },
      ]);
    });

    it("counts the days left in whole calendar days", () => {
      purchase(base.course.id, 1000, daysBefore(3));

      const { refundExposure } = analytics(asInstructor());

      expect(refundExposure.courses[0]?.daysLeft).toBe(11);
      expect(refundExposure.closingTodayCount).toBe(0);
    });
  });

  describe("access", () => {
    it("pins an instructor to their own figures whatever instructor they ask for", () => {
      purchase(base.course.id, 1000, daysBefore(1));
      purchase(otherCourse.id, 5000, daysBefore(1));

      const result = analytics(asInstructor(), {
        requestedInstructorId: otherInstructor.id,
      });

      expect(result.instructorId).toBe(base.instructor.id);
      expect(result.summary.grossCents).toBe(1000);
      expect(result.instructors).toEqual([]);
    });

    it("ignores a course the viewer does not own", () => {
      const result = analytics(asInstructor(), {
        requestedCourseId: otherCourse.id,
      });

      expect(result.selectedCourseId).toBeNull();
      expect(result.progress).toBeNull();
      expect(result.funnel).toBeNull();
      expect(result.quizzes).toBeNull();
      expect(result.countries).toBeNull();
    });

    it("selects a course the viewer owns", () => {
      const result = analytics(asInstructor(), {
        requestedCourseId: base.course.id,
      });

      expect(result.selectedCourseId).toBe(base.course.id);
      expect(result.progress).not.toBeNull();
    });

    it("shows an admin every instructor when none is picked", () => {
      purchase(base.course.id, 1000, daysBefore(1));
      purchase(otherCourse.id, 5000, daysBefore(1));

      const result = analytics(asAdmin());

      expect(result.instructorId).toBeNull();
      expect(result.summary.grossCents).toBe(6000);
      expect(result.instructors.map((one) => one.id).sort()).toEqual(
        [base.instructor.id, otherInstructor.id].sort()
      );
      expect(result.unpublished).toBe(false);
    });

    it("lets an admin narrow to one instructor", () => {
      purchase(base.course.id, 1000, daysBefore(1));
      purchase(otherCourse.id, 5000, daysBefore(1));

      const result = analytics(asAdmin(), {
        requestedInstructorId: otherInstructor.id,
      });

      expect(result.instructorId).toBe(otherInstructor.id);
      expect(result.summary.grossCents).toBe(5000);
    });
  });
});
