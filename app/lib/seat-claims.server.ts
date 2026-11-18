import { eq } from "drizzle-orm";
import { coupons, enrollments, purchases } from "~/db/schema";
import { enrollUser, findEnrollment } from "~/lib/enrollments.server";
import {
  getSeatAvailability,
  type Db,
  type Failure,
} from "~/lib/refunds.server";

// ─── Seat claims ───
// A Student claiming a Seat on a Team Licence by its code, which enrols them in
// the course. See GLOSSARY.md (Seat, Claimed Seat, Team Licence).
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Seat = typeof coupons.$inferSelect;
type Enrollment = typeof enrollments.$inferSelect;

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimResult =
  { ok: true; seat: Seat; enrollment: Enrollment } | Failure;

export function getSeatByCode(db: Db, code: string): Seat | undefined {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

/**
 * Claims the Seat with this code for a Student and enrols them. A Seat can only
 * be claimed from the country its Team Licence was bought in, and not while
 * the Team Licence has an Open Refund Request or after it was refunded.
 */
export function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): ClaimResult {
  const seat = getSeatByCode(db, code);
  if (!seat) {
    return { ok: false, status: 404, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return {
      ok: false,
      status: 409,
      error: "Coupon has already been redeemed",
    };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, status: 409, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, status: 409, error: SEAT_REFUNDED };
  }

  if (findEnrollment(db, userId, seat.courseId)) {
    return {
      ok: false,
      status: 409,
      error: "You are already enrolled in this course",
    };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      status: 403,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  // Enrol before claiming so a refused Enrollment leaves the Seat unclaimed.
  return db.transaction((tx): ClaimResult => {
    const enrolled = enrollUser(tx, userId, seat.courseId, now);
    if (!enrolled.ok) return enrolled;

    const claimed = tx
      .update(coupons)
      .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .returning()
      .get();

    return { ok: true, seat: claimed, enrollment: enrolled.enrollment };
  });
}
