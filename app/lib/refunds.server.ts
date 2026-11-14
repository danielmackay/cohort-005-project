import { and, eq, isNull, notExists } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  enrollments,
  purchases,
  refunds,
  users,
  UserRole,
  EnrollmentStatus,
  RefundState,
  RefundStatus,
} from "~/db/schema";

// Every function takes the database first so tests can pass an in-memory one.
// Routes pass the app's `db`. See docs/adr/0001-refund-ends-access-but-keeps-progress.md.
type Database = BetterSQLite3Database<typeof schema>;

export type RefundDecisionResult = { ok: true } | { ok: false; error: string };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const NOT_AN_ADMIN = {
  ok: false,
  error: "Only Admins can decide Refund Requests.",
} as const;

function isAdmin(tx: Tx, userId: number) {
  const user = tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Admin;
}

function isTeamPurchase(tx: Tx, purchaseId: number) {
  const seat = tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return seat !== undefined;
}

function findOpenRefundRequest(tx: Tx, refundRequestId: number) {
  const request = tx
    .select({ status: refunds.status, purchase: purchases })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, refundRequestId))
    .get();

  if (!request) {
    return { ok: false, error: "Refund Request not found." } as const;
  }
  if (request.status !== RefundStatus.Open) {
    return {
      ok: false,
      error: "This Refund Request has already been decided.",
    } as const;
  }
  return { ok: true, request } as const;
}

/**
 * An Admin accepts an Open Refund Request: it becomes a Pending Refund for the
 * full amount paid, and the student's Enrollment is refunded straight away.
 */
export function approveRefundRequest(
  database: Database,
  refundRequestId: number,
  adminUserId: number
): RefundDecisionResult {
  return database.transaction((tx) => {
    if (!isAdmin(tx, adminUserId)) return NOT_AN_ADMIN;

    const found = findOpenRefundRequest(tx, refundRequestId);
    if (!found.ok) return found;
    const request = found.request;
    const now = new Date().toISOString();

    tx.update(refunds)
      .set({
        status: RefundStatus.Approved,
        refundState: RefundState.Pending,
        amountRefunded: request.purchase.amountPaid,
        resolvedAt: now,
        resolvedByUserId: adminUserId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    // A team purchase pays for Seat Coupons, not the buyer's own access, so
    // refunding it must not touch any Enrollment the buyer got another way.
    if (!isTeamPurchase(tx, request.purchase.id)) {
      tx.update(enrollments)
        .set({ status: EnrollmentStatus.Refunded })
        .where(
          and(
            eq(enrollments.userId, request.purchase.userId),
            eq(enrollments.courseId, request.purchase.courseId)
          )
        )
        .run();
    }

    tx.update(coupons)
      .set({ voidedAt: now })
      .where(
        and(eq(coupons.purchaseId, request.purchase.id), isNull(coupons.redeemedAt))
      )
      .run();

    return { ok: true };
  });
}

/**
 * An Admin turns down an Open Refund Request with a reason the student sees.
 * There is no Refund, and the student keeps their access.
 */
export function declineRefundRequest(
  database: Database,
  refundRequestId: number,
  adminUserId: number,
  reason: string
): RefundDecisionResult {
  return database.transaction((tx) => {
    if (!isAdmin(tx, adminUserId)) return NOT_AN_ADMIN;

    const found = findOpenRefundRequest(tx, refundRequestId);
    if (!found.ok) return found;

    const declineReason = reason.trim();
    if (!declineReason) {
      return {
        ok: false,
        error: "Tell the student why their Refund Request was declined.",
      };
    }

    tx.update(refunds)
      .set({
        status: RefundStatus.Declined,
        declineReason,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: adminUserId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    return { ok: true };
  });
}

/** An Admin confirms the money for a Pending Refund reached the student. */
export function markRefundIssued(
  database: Database,
  refundRequestId: number,
  adminUserId: number
): RefundDecisionResult {
  return moveRefundOutOfPending(
    database,
    refundRequestId,
    adminUserId,
    RefundState.Issued
  );
}

/**
 * An Admin records that the money for a Pending Refund couldn't be sent. The
 * request stays approved and the Enrollment stays refunded: the decision stands.
 */
export function markRefundFailed(
  database: Database,
  refundRequestId: number,
  adminUserId: number
): RefundDecisionResult {
  return moveRefundOutOfPending(
    database,
    refundRequestId,
    adminUserId,
    RefundState.Failed
  );
}

function moveRefundOutOfPending(
  database: Database,
  refundRequestId: number,
  adminUserId: number,
  to: RefundState.Issued | RefundState.Failed
): RefundDecisionResult {
  return database.transaction((tx) => {
    if (!isAdmin(tx, adminUserId)) return NOT_AN_ADMIN;

    const moved = tx
      .update(refunds)
      .set({ refundState: to })
      .where(
        and(
          eq(refunds.id, refundRequestId),
          eq(refunds.refundState, RefundState.Pending)
        )
      )
      .run();

    if (moved.changes === 0) {
      return {
        ok: false,
        error: "Only a Pending Refund can be marked Issued or Failed.",
      };
    }
    return { ok: true };
  });
}

/**
 * Gives a student access to a course. A student has one Enrollment per course
 * for good, so buying again after a Refund makes their Refunded Enrollment
 * active again, and the progress they made before comes back with it.
 */
export function enrollStudent(
  database: Database,
  userId: number,
  courseId: number
) {
  const existing = database
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  if (!existing) {
    return database
      .insert(enrollments)
      .values({ userId, courseId, status: EnrollmentStatus.Active })
      .returning()
      .get();
  }

  if (existing.status === EnrollmentStatus.Active) {
    throw new Error("User is already enrolled in this course");
  }

  return database
    .update(enrollments)
    .set({ status: EnrollmentStatus.Active })
    .where(eq(enrollments.id, existing.id))
    .returning()
    .get();
}

/**
 * Has this student ever had a Refund for this course? A student gets at most
 * one, so a course bought again after a Refund can't be refunded again.
 */
export function hasHadRefund(
  database: Database,
  userId: number,
  courseId: number
) {
  const approved = database
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refunds.status, RefundStatus.Approved),
        // Refunding a team purchase isn't the student's own Refund.
        notExists(
          database
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.purchaseId, purchases.id))
        )
      )
    )
    .get();
  return approved !== undefined;
}
