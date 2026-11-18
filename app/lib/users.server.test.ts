import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  adminUpdateUser,
  signUp,
  syncAllUsers,
  updateProfile,
} from "./users.server";
import {
  createFakeNotifications,
  type FakeNotifications,
} from "~/test/fake-notifications";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotifications();
});

describe("signUp", () => {
  it("syncs a new user's name, email and avatar", async () => {
    const result = await signUp(
      db,
      notifications,
      "Grace Hopper",
      "grace@example.com"
    );

    expect(result).toMatchObject({ created: true });
    expect(notifications.synced).toEqual([
      {
        id: result.userId,
        name: "Grace Hopper",
        email: "grace@example.com",
        avatarUrl: null,
      },
    ]);
  });

  it("gives a new user the default preferences: everything on except Enrollments", async () => {
    const { userId } = await signUp(
      db,
      notifications,
      "Grace Hopper",
      "grace@example.com"
    );

    expect(notifications.preferences.get(userId)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: false },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: true },
    });
  });
});

describe("updateProfile", () => {
  it("syncs the user when their name changes", async () => {
    const result = await updateProfile(
      db,
      notifications,
      base.user.id,
      "Renamed User",
      "New bio"
    );

    expect(result).toEqual({ ok: true });
    expect(notifications.synced).toEqual([
      {
        id: base.user.id,
        name: "Renamed User",
        email: "test@example.com",
        avatarUrl: null,
      },
    ]);
  });

  it("doesn't sync when only the bio changes", async () => {
    await updateProfile(
      db,
      notifications,
      base.user.id,
      "Test User",
      "New bio"
    );

    expect(notifications.synced).toEqual([]);
  });

  it("never overwrites preferences the user already has", async () => {
    notifications.preferences.set(base.user.id, {
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });

    await updateProfile(db, notifications, base.user.id, "Renamed User", null);

    expect(notifications.preferences.get(base.user.id)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: true },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: false },
    });
  });

  it("still saves the profile when the sync fails", async () => {
    notifications.failWith(new Error("Knock is down"));

    const result = await updateProfile(
      db,
      notifications,
      base.user.id,
      "Renamed User",
      null
    );

    expect(result).toEqual({ ok: true });
  });

  it("refuses an unknown user", async () => {
    const result = await updateProfile(db, notifications, 9999, "Nobody", null);

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(notifications.synced).toEqual([]);
  });
});

describe("adminUpdateUser", () => {
  it("syncs the user a Platform Admin edited", async () => {
    const result = await adminUpdateUser(
      db,
      notifications,
      base.user.id,
      "Edited Name",
      "edited@example.com"
    );

    expect(result).toEqual({ ok: true });
    expect(notifications.synced).toEqual([
      {
        id: base.user.id,
        name: "Edited Name",
        email: "edited@example.com",
        avatarUrl: null,
      },
    ]);
  });

  it("refuses an email another user already has, without syncing", async () => {
    const result = await adminUpdateUser(
      db,
      notifications,
      base.user.id,
      "Test User",
      "instructor@example.com"
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(notifications.synced).toEqual([]);
  });

  it("refuses an unknown user", async () => {
    const result = await adminUpdateUser(
      db,
      notifications,
      9999,
      "Nobody",
      "nobody@example.com"
    );

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(notifications.synced).toEqual([]);
  });
});

describe("syncAllUsers", () => {
  it("syncs every user and reports them", async () => {
    const report = await syncAllUsers(db, notifications);

    expect(notifications.synced.map((u) => u.email)).toEqual([
      "test@example.com",
      "instructor@example.com",
    ]);
    expect(report).toEqual({
      synced: [base.user.id, base.instructor.id],
      failed: [],
    });
  });

  it("gives defaults to users without preferences and leaves existing ones alone", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
    });

    await syncAllUsers(db, notifications);

    expect(notifications.preferences.get(base.user.id)?.enrollments).toEqual({
      feed: false,
    });
    expect(
      notifications.preferences.get(base.instructor.id)?.enrollments
    ).toEqual({ feed: true });
  });

  it("carries on past a failed sync and reports it", async () => {
    notifications.failWith(new Error("Knock is down"));

    const report = await syncAllUsers(db, notifications);

    expect(report).toEqual({
      synced: [],
      failed: [
        { userId: base.user.id, error: "Knock is down" },
        { userId: base.instructor.id, error: "Knock is down" },
      ],
    });
  });
});
