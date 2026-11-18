import { describe, expect, it } from "vitest";
import { mergeNotifications } from "./notification-feed";
import type { FeedNotification } from "./notifications";

function notification(
  id: string,
  insertedAt: string,
  overrides: Partial<FeedNotification> = {}
): FeedNotification {
  return {
    id,
    type: "discussion-reply",
    sender: null,
    data: null,
    insertedAt,
    readAt: null,
    seenAt: null,
    ...overrides,
  };
}

describe("mergeNotifications", () => {
  it("appends an older page after what is already loaded", () => {
    const loaded = [
      notification("b", "2026-11-18T10:00:00.000Z"),
      notification("a", "2026-11-18T09:00:00.000Z"),
    ];
    const olderPage = [notification("z", "2026-11-17T09:00:00.000Z")];

    expect(mergeNotifications(loaded, olderPage).map((n) => n.id)).toEqual([
      "b",
      "a",
      "z",
    ]);
  });

  it("puts a live arrival at the top without duplicating rows it overlaps", () => {
    const loaded = [
      notification("b", "2026-11-18T10:00:00.000Z"),
      notification("a", "2026-11-18T09:00:00.000Z"),
    ];
    // A live update re-reads the first page, which overlaps what's loaded.
    const firstPage = [
      notification("c", "2026-11-18T11:00:00.000Z"),
      notification("b", "2026-11-18T10:00:00.000Z"),
    ];

    expect(mergeNotifications(loaded, firstPage).map((n) => n.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("takes the incoming copy of a row it already has", () => {
    const loaded = [notification("a", "2026-11-18T09:00:00.000Z")];
    const incoming = [
      notification("a", "2026-11-18T09:00:00.000Z", {
        readAt: "2026-11-18T12:00:00.000Z",
      }),
    ];

    expect(mergeNotifications(loaded, incoming)[0].readAt).toBe(
      "2026-11-18T12:00:00.000Z"
    );
  });
});
