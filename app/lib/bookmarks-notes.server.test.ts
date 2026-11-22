import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 6, 13, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function rowCount(table: typeof schema.bookmarks | typeof schema.notes) {
  return db
    .select()
    .from(table)
    .where(
      and(eq(table.userId, base.user.id), eq(table.lessonId, lessonIds[0]))
    )
    .all().length;
}

describe("bookmarking a Lesson", () => {
  it("bookmarks a Lesson with no Bookmark, and un-bookmarks it on the next toggle", () => {
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);

    expect(toggleBookmark(db, base.user.id, lessonIds[0])).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0])).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0]);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
    expect(rowCount(schema.bookmarks)).toBe(1);
  });

  it("keeps one Student's Bookmark separate from another's", () => {
    const other = addStudent("Olive");
    toggleBookmark(db, other.id, lessonIds[0]);

    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });
});

describe("saving a Note", () => {
  it("creates a Note, trimmed, on a Lesson with none", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  # not a heading  ", NOW);

    expect(result).toEqual({
      ok: true,
      note: { body: "# not a heading", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "# not a heading",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "first", NOW);
    saveNote(db, base.user.id, lessonIds[0], "second", LATER);

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "second",
      updatedAt: LATER.toISOString(),
    });
    expect(rowCount(schema.notes)).toBe(1);

    const row = db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.userId, base.user.id))
      .get();
    expect(row?.createdAt).toBe(NOW.toISOString());
  });

  it("accepts a Note of exactly the cap", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(MAX_NOTE_LENGTH), NOW);

    expect(result.ok).toBe(true);
  });

  it("refuses a Note over the cap with a message, and stores nothing", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("removes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "something", NOW);

    const result = saveNote(db, base.user.id, lessonIds[0], "   ", LATER);

    expect(result).toEqual({ ok: true, note: null });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("lists only the Student's own Bookmarks, newest first, with Lesson and Course", () => {
    const other = addStudent("Olive");
    toggleBookmark(db, base.user.id, lessonIds[0]);
    toggleBookmark(db, other.id, lessonIds[1]);
    toggleBookmark(db, base.user.id, lessonIds[2]);

    const rows = listBookmarks(db, base.user.id);

    expect(rows.map((row) => row.lessonTitle)).toEqual(["Lesson 3", "Lesson 1"]);
    expect(rows[0]).toMatchObject({
      lessonId: lessonIds[2],
      courseTitle: "Test Course",
      courseSlug: "test-course",
      moduleTitle: "Basics",
    });
  });

  it("lists only the Student's own Notes, most recently edited first, with Lesson and Course", () => {
    const other = addStudent("Olive");
    saveNote(db, base.user.id, lessonIds[0], "older", NOW);
    saveNote(db, base.user.id, lessonIds[1], "newer", LATER);
    saveNote(db, other.id, lessonIds[2], "not mine", LATER);

    const rows = listNotes(db, base.user.id);

    expect(rows.map((row) => row.body)).toEqual(["newer", "older"]);
    expect(rows[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      courseTitle: "Test Course",
      courseSlug: "test-course",
      updatedAt: LATER.toISOString(),
    });
  });
});

describe("approving a Refund", () => {
  it("leaves the Student's Bookmarks and Notes in place", async () => {
    const admin = db
      .insert(schema.users)
      .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, base.user.id, lessonIds[0]);
    saveNote(db, base.user.id, lessonIds[0], "keep me", NOW);

    const notifications = fakeNotifications();
    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not for me.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      NOW,
      notifications
    );

    expect(approved.ok).toBe(true);
    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
    expect(listNotes(db, base.user.id).map((row) => row.body)).toEqual(["keep me"]);
  });
});
