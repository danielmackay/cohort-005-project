import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, TeamMemberRole, UserRole } from "~/db/schema";
import { claimSeat } from "./seat-claims.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;
let teamLicence: typeof schema.purchases.$inferSelect;

beforeEach(() => {
  db = createTestDb();
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
  it("claims an available Seat and enrols the Student", () => {
    addSeat("SEAT-1");

    const result = claimSeat(db, "SEAT-1", base.user.id, "AU", NOW);

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

  it("refuses a code that doesn't exist", () => {
    expect(claimSeat(db, "NOPE", base.user.id, "AU", NOW)).toEqual({
      ok: false,
      status: 404,
      error: "Coupon not found",
    });
  });

  it("refuses a Seat that has already been claimed", () => {
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
    claimSeat(db, "SEAT-1", other.id, "AU", NOW);

    expect(claimSeat(db, "SEAT-1", base.user.id, "AU", NOW)).toEqual({
      ok: false,
      status: 409,
      error: "Coupon has already been redeemed",
    });
    expect(enrollmentCount()).toBe(1);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", () => {
    addSeat("SEAT-1");
    db.insert(schema.refunds)
      .values({
        purchaseId: teamLicence.id,
        status: RefundStatus.Open,
        reason: "Changed plans",
        requestedAt: NOW.toISOString(),
      })
      .run();

    expect(claimSeat(db, "SEAT-1", base.user.id, "AU", NOW)).toEqual({
      ok: false,
      status: 409,
      error:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
    expect(enrollmentCount()).toBe(0);
  });

  it("refuses a Seat whose Team Licence was refunded", () => {
    const seat = addSeat("SEAT-1");
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, seat.id))
      .run();

    expect(claimSeat(db, "SEAT-1", base.user.id, "AU", NOW)).toEqual({
      ok: false,
      status: 409,
      error:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
    expect(enrollmentCount()).toBe(0);
  });

  it("refuses a Student who is already enrolled, leaving the Seat unclaimed", () => {
    addSeat("SEAT-1");
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    expect(claimSeat(db, "SEAT-1", base.user.id, "AU", NOW)).toEqual({
      ok: false,
      status: 409,
      error: "You are already enrolled in this course",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
  });

  it("refuses a claim from a different country than the purchase", () => {
    addSeat("SEAT-1");

    expect(claimSeat(db, "SEAT-1", base.user.id, "NZ", NOW)).toEqual({
      ok: false,
      status: 403,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect(getSeat("SEAT-1")?.redeemedAt).toBeNull();
  });
});
