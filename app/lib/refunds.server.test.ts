import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  approveRefundRequest,
  declineRefundRequest,
  enrollStudent,
  hasHadRefund,
  markRefundFailed,
  markRefundIssued,
} from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;

function buyCourse(userId: number, amountPaid = 7900) {
  const purchase = db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function raiseRefundRequest(purchaseId: number) {
  return db
    .insert(schema.refunds)
    .values({ purchaseId, reason: "Not what I expected." })
    .returning()
    .get();
}

function getRefundRequest(id: number) {
  const request = db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.id, id))
    .get();
  if (!request) throw new Error(`No Refund Request ${id}`);
  return request;
}

function getEnrollment(userId: number) {
  const enrollment = db
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .get();
  if (!enrollment) throw new Error(`No Enrollment for user ${userId}`);
  return enrollment;
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  admin = db
    .insert(schema.users)
    .values({
      name: "Test Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
});

describe("approveRefundRequest", () => {
  it("creates a Pending Refund for the full amount and ends the student's access", () => {
    const purchase = buyCourse(base.user.id, 7900);
    const request = raiseRefundRequest(purchase.id);

    const result = approveRefundRequest(db, request.id, admin.id);

    expect(result).toEqual({ ok: true });
    const decided = getRefundRequest(request.id);
    expect(decided.status).toBe(schema.RefundStatus.Approved);
    expect(decided.refundState).toBe(schema.RefundState.Pending);
    expect(decided.amountRefunded).toBe(7900);
    expect(decided.resolvedByUserId).toBe(admin.id);
    expect(decided.resolvedAt).not.toBeNull();
    expect(getEnrollment(base.user.id).status).toBe(
      schema.EnrollmentStatus.Refunded
    );
  });

  it("refuses anyone who isn't an Admin, including the course's own instructor", () => {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);

    const result = approveRefundRequest(db, request.id, base.instructor.id);

    expect(result).toEqual({
      ok: false,
      error: "Only Admins can decide Refund Requests.",
    });
    expect(getRefundRequest(request.id).status).toBe(schema.RefundStatus.Open);
    expect(getEnrollment(base.user.id).status).toBe(
      schema.EnrollmentStatus.Active
    );
  });

  it("refuses a Refund Request that has already been decided", () => {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);
    approveRefundRequest(db, request.id, admin.id);

    const result = approveRefundRequest(db, request.id, admin.id);

    expect(result).toEqual({
      ok: false,
      error: "This Refund Request has already been decided.",
    });
  });

  it("voids the unclaimed Seat Coupons on a refunded team purchase", () => {
    const purchase = buyCourse(base.user.id, 39500);
    const team = db.insert(schema.teams).values({}).returning().get();
    for (const code of ["seat-one", "seat-two"]) {
      db.insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          purchaseId: purchase.id,
          code,
        })
        .run();
    }
    const request = raiseRefundRequest(purchase.id);

    approveRefundRequest(db, request.id, admin.id);

    const seats = db.select().from(schema.coupons).all();
    expect(seats).toHaveLength(2);
    for (const seat of seats) {
      expect(seat.voidedAt).not.toBeNull();
    }
  });

  it("leaves the buyer's own Enrollment alone when refunding a team purchase", () => {
    buyCourse(base.user.id);
    const teamPurchase = db
      .insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 39500 })
      .returning()
      .get();
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: teamPurchase.id,
        code: "team-seat",
      })
      .run();

    approveRefundRequest(db, raiseRefundRequest(teamPurchase.id).id, admin.id);

    expect(getEnrollment(base.user.id).status).toBe(
      schema.EnrollmentStatus.Active
    );
    expect(hasHadRefund(db, base.user.id, base.course.id)).toBe(false);
  });

  it("refuses a Refund Request that doesn't exist", () => {
    const result = approveRefundRequest(db, 999, admin.id);

    expect(result).toEqual({ ok: false, error: "Refund Request not found." });
  });
});

describe("declineRefundRequest", () => {
  it("records the Admin's reason, creates no Refund and leaves access alone", () => {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);

    const result = declineRefundRequest(
      db,
      request.id,
      admin.id,
      "You've finished most of the course."
    );

    expect(result).toEqual({ ok: true });
    const decided = getRefundRequest(request.id);
    expect(decided.status).toBe(schema.RefundStatus.Declined);
    expect(decided.declineReason).toBe("You've finished most of the course.");
    expect(decided.refundState).toBeNull();
    expect(decided.amountRefunded).toBeNull();
    expect(decided.resolvedByUserId).toBe(admin.id);
    expect(getEnrollment(base.user.id).status).toBe(
      schema.EnrollmentStatus.Active
    );
  });

  it("requires a reason the student can read", () => {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);

    const result = declineRefundRequest(db, request.id, admin.id, "   ");

    expect(result).toEqual({
      ok: false,
      error: "Tell the student why their Refund Request was declined.",
    });
    expect(getRefundRequest(request.id).status).toBe(schema.RefundStatus.Open);
  });

  it("refuses non-Admins and Refund Requests that are already decided", () => {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);

    expect(
      declineRefundRequest(db, request.id, base.instructor.id, "No.")
    ).toEqual({ ok: false, error: "Only Admins can decide Refund Requests." });

    approveRefundRequest(db, request.id, admin.id);

    expect(declineRefundRequest(db, request.id, admin.id, "No.")).toEqual({
      ok: false,
      error: "This Refund Request has already been decided.",
    });
  });
});

describe("markRefundIssued and markRefundFailed", () => {
  function approvedRefund() {
    const purchase = buyCourse(base.user.id);
    const request = raiseRefundRequest(purchase.id);
    approveRefundRequest(db, request.id, admin.id);
    return request;
  }

  it("marks a Pending Refund as Issued", () => {
    const request = approvedRefund();

    expect(markRefundIssued(db, request.id, admin.id)).toEqual({ ok: true });
    expect(getRefundRequest(request.id).refundState).toBe(
      schema.RefundState.Issued
    );
  });

  it("marks a Pending Refund as Failed, keeping the request approved and access ended", () => {
    const request = approvedRefund();

    expect(markRefundFailed(db, request.id, admin.id)).toEqual({ ok: true });
    const refund = getRefundRequest(request.id);
    expect(refund.refundState).toBe(schema.RefundState.Failed);
    expect(refund.status).toBe(schema.RefundStatus.Approved);
    expect(getEnrollment(base.user.id).status).toBe(
      schema.EnrollmentStatus.Refunded
    );
  });

  it("only moves a Refund that is still Pending", () => {
    const request = approvedRefund();
    markRefundIssued(db, request.id, admin.id);

    expect(markRefundFailed(db, request.id, admin.id)).toEqual({
      ok: false,
      error: "Only a Pending Refund can be marked Issued or Failed.",
    });

    const open = raiseRefundRequest(buyCourse(admin.id).id);
    expect(markRefundIssued(db, open.id, admin.id)).toEqual({
      ok: false,
      error: "Only a Pending Refund can be marked Issued or Failed.",
    });
  });

  it("refuses anyone who isn't an Admin", () => {
    const request = approvedRefund();

    expect(markRefundIssued(db, request.id, base.instructor.id)).toEqual({
      ok: false,
      error: "Only Admins can decide Refund Requests.",
    });
  });
});

describe("enrollStudent", () => {
  it("gives a new student an Active Enrollment", () => {
    const enrollment = enrollStudent(db, base.user.id, base.course.id);

    expect(enrollment.status).toBe(schema.EnrollmentStatus.Active);
    expect(enrollment.userId).toBe(base.user.id);
    expect(enrollment.courseId).toBe(base.course.id);
  });

  it("makes a Refunded Enrollment active again instead of creating a second one", () => {
    const purchase = buyCourse(base.user.id);
    const original = getEnrollment(base.user.id);
    approveRefundRequest(db, raiseRefundRequest(purchase.id).id, admin.id);

    const enrollment = enrollStudent(db, base.user.id, base.course.id);

    expect(enrollment.id).toBe(original.id);
    expect(enrollment.enrolledAt).toBe(original.enrolledAt);
    expect(enrollment.status).toBe(schema.EnrollmentStatus.Active);
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
  });

  it("refuses a student who already has an Active Enrollment", () => {
    buyCourse(base.user.id);

    expect(() => enrollStudent(db, base.user.id, base.course.id)).toThrow(
      "User is already enrolled in this course"
    );
  });
});

describe("hasHadRefund", () => {
  it("is false for a student whose Refund Requests were only declined", () => {
    const purchase = buyCourse(base.user.id);
    expect(hasHadRefund(db, base.user.id, base.course.id)).toBe(false);

    declineRefundRequest(
      db,
      raiseRefundRequest(purchase.id).id,
      admin.id,
      "Outside the window."
    );

    expect(hasHadRefund(db, base.user.id, base.course.id)).toBe(false);
  });

  it("stays true after the student buys the course again", () => {
    const first = buyCourse(base.user.id);
    approveRefundRequest(db, raiseRefundRequest(first.id).id, admin.id);
    db.insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 7900 })
      .run();
    enrollStudent(db, base.user.id, base.course.id);

    expect(hasHadRefund(db, base.user.id, base.course.id)).toBe(true);
  });

  it("only counts Refunds for that course", () => {
    const purchase = buyCourse(base.user.id);
    approveRefundRequest(db, raiseRefundRequest(purchase.id).id, admin.id);
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Other Course",
        slug: "other-course",
        description: "Another course",
        salesCopy: "Another course.",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();

    expect(hasHadRefund(db, base.user.id, otherCourse.id)).toBe(false);
  });
});
