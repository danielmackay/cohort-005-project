import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  enrollments,
  purchases,
  teamMembers,
  teams,
  TeamMemberRole,
} from "~/db/schema";
import { insertEnrollment, notifyEnrollment } from "~/lib/enrollments.server";
import type { Notifications } from "~/lib/notifications.server";
import type { Db, Failure, Queryable } from "~/lib/refunds.server";

// ─── Purchases ───
// Buying a course: an Individual Purchase enrols the buyer, a Team Licence
// grants Seats and enrols nobody. See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Purchase = typeof purchases.$inferSelect;
type Enrollment = typeof enrollments.$inferSelect;
type Seat = typeof coupons.$inferSelect;
type Team = typeof teams.$inferSelect;

export type IndividualPurchaseResult =
  { ok: true; purchase: Purchase; enrollment: Enrollment } | Failure;

/**
 * Records an Individual Purchase and enrols the buyer, then tells the course's
 * Instructor. A refused Enrollment records no Purchase.
 */
export async function buyIndividualPurchase(
  db: Db,
  notifications: Notifications,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
): Promise<IndividualPurchaseResult> {
  // Enrol first so a refused Enrollment returns before the Purchase is written.
  const result = db.transaction((tx): IndividualPurchaseResult => {
    const enrolled = insertEnrollment(tx, userId, courseId, now);
    if (!enrolled.ok) return enrolled;

    const purchase = insertPurchase(tx, userId, courseId, amountPaid, country);
    return { ok: true, purchase, enrollment: enrolled.enrollment };
  });
  if (!result.ok) return result;

  await notifyEnrollment(db, notifications, result.enrollment);
  return result;
}

export type TeamLicenceResult = {
  purchase: Purchase;
  team: Team;
  seats: Seat[];
};

/**
 * Records a Team Licence and grants its Seats, making the buyer the Team Admin.
 * Nobody is enrolled, so it sends no Enrollment Notification: that waits until
 * a Seat is claimed.
 */
export function buyTeamLicence(
  db: Db,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  quantity: number
): TeamLicenceResult {
  return db.transaction((tx) => {
    const purchase = insertPurchase(tx, userId, courseId, amountPaid, country);
    const team = getOrCreateTeamForAdmin(tx, userId);
    const seats = Array.from({ length: quantity }, () =>
      tx
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId,
          code: crypto.randomBytes(12).toString("base64url"),
          purchaseId: purchase.id,
        })
        .returning()
        .get()
    );
    return { purchase, team, seats };
  });
}

function insertPurchase(
  db: Queryable,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
): Purchase {
  return db
    .insert(purchases)
    .values({ userId, courseId, amountPaid, country })
    .returning()
    .get();
}

function getOrCreateTeamForAdmin(db: Queryable, userId: number): Team {
  const membership = db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  const existing =
    membership &&
    db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
  if (existing) return existing;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
  return team;
}
