import { and, eq, isNull } from "drizzle-orm";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  teamMembers,
  TeamMemberRole,
  users,
} from "~/db/schema";
import {
  findEnrollment,
  insertEnrollment,
  notifyEnrollment,
} from "~/lib/enrollments.server";
import { NotificationType, TEAM_URL } from "~/lib/notifications";
import {
  notifyAfterCommit,
  type NotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import {
  getSeatAvailability,
  type Db,
  type Failure,
} from "~/lib/refunds.server";
import { getNotificationUser, toNotificationUser } from "~/lib/users.server";

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
export async function claimSeat(
  db: Db,
  notifications: Notifications,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): Promise<ClaimResult> {
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
  const result = db.transaction((tx): ClaimResult => {
    const enrolled = insertEnrollment(tx, userId, seat.courseId, now);
    if (!enrolled.ok) return enrolled;

    const claimed = tx
      .update(coupons)
      .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .returning()
      .get();

    return { ok: true, seat: claimed, enrollment: enrolled.enrollment };
  });
  if (!result.ok) return result;

  await notifySeatClaimed(db, notifications, result.seat);
  await notifyEnrollment(db, notifications, result.enrollment);
  return result;
}

// ─── Seat claimed Notification ───
// Sent after the claim has committed, through notifyAfterCommit, so a failing
// port never fails the claim.

/**
 * The Team Admins of the team a Seat belongs to. Buying a Team Licence makes
 * the buyer its team's Team Admin, and this is the same membership the
 * Notifications card checks before it shows the Seat claims switch.
 */
function getTeamAdmins(db: Db, teamId: number): NotificationUser[] {
  return db
    .select()
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .all()
    .map((row) => toNotificationUser(row.users));
}

async function notifySeatClaimed(
  db: Db,
  notifications: Notifications,
  seat: Seat
) {
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, seat.courseId))
    .get();
  const teamAdmins = getTeamAdmins(db, seat.teamId);
  const claimer =
    seat.redeemedByUserId === null
      ? undefined
      : getNotificationUser(db, seat.redeemedByUserId);

  if (teamAdmins.length === 0 || !claimer || !course) {
    console.error(
      `[notifications] Not sending the Seat claimed Notification for Seat ${seat.id}: ` +
        `its Team Admin, claimer or course was not found`
    );
    return;
  }

  // Notifications are only for what someone else did.
  const recipients = teamAdmins.filter((admin) => admin.id !== claimer.id);
  if (recipients.length === 0) return;

  // A refunded Seat can never be claimed, so it doesn't count as left.
  const seatsLeft = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, seat.purchaseId),
        isNull(coupons.redeemedByUserId),
        isNull(coupons.refundedAt)
      )
    )
    .all().length;

  await notifyAfterCommit(notifications, {
    type: NotificationType.SeatClaimed,
    recipients,
    sender: claimer,
    data: {
      seatId: seat.id,
      purchaseId: seat.purchaseId,
      claimerName: claimer.name,
      courseTitle: course.title,
      seatsLeft,
      url: TEAM_URL,
    },
    idempotencyKey: `${NotificationType.SeatClaimed}:${seat.id}`,
  });
}
