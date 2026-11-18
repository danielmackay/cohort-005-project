import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, TeamMemberRole, UserRole } from "~/db/schema";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";
import { NotificationType } from "~/lib/notifications";
import { claimSeat } from "./seat-claims.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;
let teamLicence: typeof schema.purchases.$inferSelect;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  notifications = createFakeNotifications();
  base = seedBaseData(db);

  teamAdmin = db
    .insert(schema.users)
    .values({
      name: "Tess Admin",
      email: "tess@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();

  teamLicence = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 15800,
      country: "AU",
    })
    .returning()
    .get();
});

function addSeat(code: string) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({
      teamId: team.id,
      userId: teamAdmin.id,
      role: TeamMemberRole.Admin,
    })
    .run();
  return db
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code,
      purchaseId: teamLicence.id,
    })
    .returning()
    .get();
}

function getSeat(code: string) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code))
    .get();
}

function enrollmentCount() {
  return db.select().from(schema.enrollments).all().length;
}

describe("claimSeat", () => {
  it("claims an available Seat and enrols the Student", async () => {
    addSeat("SEAT-1");

    const result = await claimSeat(
      db,
      notifications,
      "SEAT-1",
      base.user.id,
      "AU",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
      },
    });
    expect(getSeat("SEAT-1")).toMatchObject({
      redeemedByUserId: base.user.id,
      redeemedAt: NOW.toISOString(),
    });
  });

  it("refuses a code that doesn't exist", async () => {
    expect(
      await claimSeat(db, notifications, "NOPE", base.user.id, "AU", NOW)
    ).toEqual({
      ok: false,
      status: 404,
      error: "Coupon not found",
    });
  });

  it("refuses a Seat that has already been claimed", async () => {
    addSeat("SEAT-1");
    const other = db
      .insert(schema.users)
      .values({
        name: "Olly",
        email: "olly@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    await claimSeat(db, notifications, "SEAT-1", other.id, "AU", NOW);

    expect(
      await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW)
    ).toEqual({
      ok: false,
      status: 409,
      error: "Coupon has already been redeemed",
    });
    expect(enrollmentCount()).toBe(1);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", async () => {
    addSeat("SEAT-1");
    db.insert(schema.refunds)
      .values({
        purchaseId: teamLicence.id,
        status: RefundStatus.Open,
        reason: "Changed plans",
        requestedAt: NOW.toISOString(),
      })
      .run();

    expect(
      await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW)
    ).toEqual({
      ok: false,
      status: 409,
      error:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
    expect(enrollmentCount()).toBe(0);
  });

  it("refuses a Seat whose Team Licence was refunded", async () => {
    const seat = addSeat("SEAT-1");
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, seat.id))
      .run();

    expect(
      await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW)
    ).toEqual({
      ok: false,
      status: 409,
      error:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
    expect(enrollmentCount()).toBe(0);
  });

  it("refuses a Student who is already enrolled, leaving the Seat unclaimed", async () => {
    addSeat("SEAT-1");
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    expect(
      await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW)
    ).toEqual({
      ok: false,
      status: 409,
      error: "You are already enrolled in this course",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
  });

  it("refuses a claim from a different country than the purchase", async () => {
    addSeat("SEAT-1");

    expect(
      await claimSeat(db, notifications, "SEAT-1", base.user.id, "NZ", NOW)
    ).toEqual({
      ok: false,
      status: 403,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
  });
});

describe("claimSeat Notifications", () => {
  function sent(type: string) {
    return notifications.notified.filter((n) => n.type === type);
  }

  it("tells the Team Admin who claimed a Seat, on which course, and how many Seats are left", async () => {
    addSeat("SEAT-1");
    addSeat("SEAT-2");
    addSeat("SEAT-3");

    await claimSeat(db, notifications, "SEAT-2", base.user.id, "AU", NOW);

    const seatId = getSeat("SEAT-2")?.id;
    expect(sent(NotificationType.SeatClaimed)).toEqual([
      {
        type: NotificationType.SeatClaimed,
        recipients: [
          {
            id: teamAdmin.id,
            name: "Tess Admin",
            email: "tess@example.com",
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
          seatId,
          purchaseId: teamLicence.id,
          claimerName: "Test User",
          courseTitle: "Test Course",
          seatsLeft: 2,
          url: "/team",
        },
        idempotencyKey: `seat-claimed:${seatId}`,
      },
    ]);
  });

  it("counts down to no Seats left as each Seat is claimed", async () => {
    addSeat("SEAT-1");
    addSeat("SEAT-2");
    const olly = db
      .insert(schema.users)
      .values({
        name: "Olly",
        email: "olly@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();

    await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW);
    await claimSeat(db, notifications, "SEAT-2", olly.id, "AU", NOW);

    expect(sent(NotificationType.SeatClaimed).map((n) => n.data)).toMatchObject(
      [{ seatsLeft: 1 }, { seatsLeft: 0 }]
    );
  });

  it("doesn't count refunded Seats as left", async () => {
    addSeat("SEAT-1");
    const refunded = addSeat("SEAT-2");
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, refunded.id))
      .run();

    await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW);

    expect(sent(NotificationType.SeatClaimed)[0]?.data).toMatchObject({
      seatsLeft: 0,
    });
  });

  it("tells the Instructor about the new Enrollment", async () => {
    addSeat("SEAT-1");

    const result = await claimSeat(
      db,
      notifications,
      "SEAT-1",
      base.user.id,
      "AU",
      NOW
    );
    if (!result.ok) throw new Error(result.error);

    expect(sent(NotificationType.NewEnrollment)).toMatchObject([
      {
        recipients: [{ id: base.instructor.id }],
        sender: { id: base.user.id },
        data: {
          enrollmentId: result.enrollment.id,
          courseId: base.course.id,
          url: `/instructor/${base.course.id}/students`,
        },
      },
    ]);
  });

  it("doesn't tell a Team Admin about claiming a Seat themselves", async () => {
    addSeat("SEAT-1");

    await claimSeat(db, notifications, "SEAT-1", teamAdmin.id, "AU", NOW);

    expect(sent(NotificationType.SeatClaimed)).toEqual([]);
    expect(sent(NotificationType.NewEnrollment)).toHaveLength(1);
  });

  it("sends nothing for a Seat on hold", async () => {
    addSeat("SEAT-1");
    db.insert(schema.refunds)
      .values({
        purchaseId: teamLicence.id,
        status: RefundStatus.Open,
        reason: "Changed plans",
        requestedAt: NOW.toISOString(),
      })
      .run();

    await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW);

    expect(notifications.notified).toEqual([]);
  });

  it("sends nothing for a refunded Seat", async () => {
    const seat = addSeat("SEAT-1");
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, seat.id))
      .run();

    await claimSeat(db, notifications, "SEAT-1", base.user.id, "AU", NOW);

    expect(notifications.notified).toEqual([]);
  });

  it("still claims the Seat when the port fails", async () => {
    addSeat("SEAT-1");
    notifications.failWith(new Error("Knock is down"));

    const result = await claimSeat(
      db,
      notifications,
      "SEAT-1",
      base.user.id,
      "AU",
      NOW
    );

    expect(result).toMatchObject({ ok: true });
    expect(getSeat("SEAT-1")?.redeemedByUserId).toBe(base.user.id);
    expect(enrollmentCount()).toBe(1);
  });
});
