import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";
import {
  getNotificationSettings,
  setNotificationPreference,
} from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotifications();
});

describe("getNotificationSettings", () => {
  it("shows a Student with no Purchases only Discussion Replies, on by default", async () => {
    const result = await getNotificationSettings(db, notifications, base.user.id);

    expect(result).toEqual({
      ok: true,
      settings: [{ category: "discussion-replies", enabled: true }],
    });
  });

  it("shows a buyer with a Purchase their Refund Request updates", async () => {
    buy(base.user.id);

    expect(await categoriesShownTo(base.user.id)).toEqual([
      "refund-request-updates",
      "discussion-replies",
    ]);
  });

  it("shows a Team Admin on a Team Licence their Seat claims", async () => {
    buyTeamLicence(base.user.id);

    expect(await categoriesShownTo(base.user.id)).toEqual([
      "refund-request-updates",
      "seat-claims",
      "discussion-replies",
    ]);
  });

  it("shows an Instructor Enrollments, off by default, and Discussion Questions", async () => {
    const result = await getNotificationSettings(
      db,
      notifications,
      base.instructor.id
    );

    expect(result).toEqual({
      ok: true,
      settings: [
        { category: "enrollments", enabled: false },
        { category: "discussion-questions", enabled: true },
        { category: "discussion-replies", enabled: true },
      ],
    });
  });

  it("shows a Platform Admin Open Refund Requests", async () => {
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    expect(await categoriesShownTo(platformAdmin.id)).toEqual([
      "open-refund-requests",
      "discussion-replies",
    ]);
  });

  it("shows a stored choice instead of the default", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });

    const result = await getNotificationSettings(
      db,
      notifications,
      base.instructor.id
    );

    expect(result).toEqual({
      ok: true,
      settings: [
        { category: "enrollments", enabled: true },
        { category: "discussion-questions", enabled: true },
        { category: "discussion-replies", enabled: false },
      ],
    });
  });

  it("says so when the preferences can't be read", async () => {
    notifications.failWith(new Error("Knock is down"));

    const result = await getNotificationSettings(
      db,
      notifications,
      base.user.id
    );

    expect(result).toMatchObject({ ok: false });
  });
});

describe("setNotificationPreference", () => {
  it("changes only the one category", async () => {
    await notifications.syncUser({
      id: base.instructor.id,
      name: base.instructor.name,
      email: base.instructor.email,
      avatarUrl: null,
    });

    const result = await setNotificationPreference(
      db,
      notifications,
      base.instructor.id,
      "discussion-questions",
      false
    );

    expect(result).toEqual({ ok: true });
    expect(notifications.preferences.get(base.instructor.id)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: false },
      "discussion-questions": { feed: false },
      "discussion-replies": { feed: true },
    });
  });

  it("refuses a category the person doesn't see, so it keeps its default", async () => {
    const result = await setNotificationPreference(
      db,
      notifications,
      base.user.id,
      "open-refund-requests",
      false
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(notifications.preferences.get(base.user.id)).toBeUndefined();
  });

  it("reports a failed save instead of throwing", async () => {
    notifications.failWith(new Error("Knock is down"));

    const result = await setNotificationPreference(
      db,
      notifications,
      base.user.id,
      "discussion-replies",
      false
    );

    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

function buyTeamLicence(userId: number) {
  const purchase = buy(userId);
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId, role: schema.TeamMemberRole.Admin })
    .run();
  db.insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code: `seat-${purchase.id}`,
      purchaseId: purchase.id,
    })
    .run();
  return purchase;
}

function buy(userId: number) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 7900, country: "AU" })
    .returning()
    .get();
}

async function categoriesShownTo(userId: number) {
  const result = await getNotificationSettings(db, notifications, userId);
  if (!result.ok) throw new Error(result.error);
  return result.settings.map((setting) => setting.category);
}
