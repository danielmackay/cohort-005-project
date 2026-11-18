import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";
import * as schema from "~/db/schema";
import { NotificationType } from "~/lib/notifications";
import { buyIndividualPurchase, buyTeamLicence } from "./purchases.server";
import { claimSeat } from "./seat-claims.server";

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

describe("buyIndividualPurchase", () => {
  it("records the Purchase and enrols the buyer", async () => {
    const result = await buyIndividualPurchase(
      db,
      notifications,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      purchase: {
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
        country: "AU",
      },
      enrollment: { userId: base.user.id, courseId: base.course.id },
    });
  });

  it("tells the course's Instructor about the new Enrollment", async () => {
    const result = await buyIndividualPurchase(
      db,
      notifications,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      NOW
    );
    if (!result.ok) throw new Error(result.error);

    expect(notifications.notified).toMatchObject([
      {
        type: NotificationType.NewEnrollment,
        recipients: [{ id: base.instructor.id }],
        sender: { id: base.user.id },
        data: { enrollmentId: result.enrollment.id },
      },
    ]);
  });

  it("records no Purchase and sends nothing when the buyer is already enrolled", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const result = await buyIndividualPurchase(
      db,
      notifications,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      NOW
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(db.select().from(schema.purchases).all()).toEqual([]);
    expect(notifications.notified).toEqual([]);
  });
});

describe("buyTeamLicence", () => {
  it("grants Seats without enrolling anyone", () => {
    const result = buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      14700,
      "AU",
      3
    );

    expect(result.purchase).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 14700,
    });
    expect(result.seats).toHaveLength(3);
    expect(db.select().from(schema.enrollments).all()).toEqual([]);
  });

  it("sends the Enrollment Notification only once a Seat is claimed, not on purchase", async () => {
    const { seats } = buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      2
    );
    const claimer = db
      .insert(schema.users)
      .values({
        name: "Olly",
        email: "olly@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();

    const [seat] = seats;
    if (!seat) throw new Error("No Seat was granted");
    await claimSeat(db, notifications, seat.code, claimer.id, "AU", NOW);

    const enrollmentNotifications = notifications.notified.filter(
      (n) => n.type === NotificationType.NewEnrollment
    );
    expect(enrollmentNotifications).toMatchObject([
      { sender: { id: claimer.id } },
    ]);
  });

  it("makes the buyer the Team Admin, reusing their team for a second Team Licence", () => {
    const first = buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      1
    );
    const second = buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      4900,
      "AU",
      1
    );

    expect(second.team.id).toBe(first.team.id);
    expect(db.select().from(schema.teamMembers).all()).toMatchObject([
      {
        teamId: first.team.id,
        userId: base.user.id,
        role: schema.TeamMemberRole.Admin,
      },
    ]);
  });
});
