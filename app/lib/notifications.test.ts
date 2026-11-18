import { describe, expect, it } from "vitest";
import {
  describeNotification,
  unseenBadgeLabel,
  type FeedNotification,
} from "./notifications";

describe("unseenBadgeLabel", () => {
  it("shows no badge when nothing is unseen", () => {
    expect(unseenBadgeLabel(0)).toBeNull();
  });

  it("shows the exact count up to nine", () => {
    expect(unseenBadgeLabel(1)).toBe("1");
    expect(unseenBadgeLabel(9)).toBe("9");
  });

  it("caps the count at 9+", () => {
    expect(unseenBadgeLabel(10)).toBe("9+");
    expect(unseenBadgeLabel(250)).toBe("9+");
  });
});

function feedNotification(
  overrides: Partial<FeedNotification>
): FeedNotification {
  return {
    id: "msg_1",
    type: "discussion-reply",
    sender: { name: "Ada Lovelace", avatarUrl: null },
    data: {
      commentId: 7,
      questionId: 3,
      lessonId: 9,
      lessonTitle: "Closures",
      courseSlug: "js-basics",
      snippet: "They capture variables.",
      url: "/courses/js-basics/lessons/9#comment-7",
    },
    insertedAt: "2026-11-18T10:00:00.000Z",
    readAt: null,
    seenAt: null,
    ...overrides,
  };
}

describe("describeNotification", () => {
  it("renders a Discussion Reply row from its trigger data", () => {
    expect(describeNotification(feedNotification({}))).toEqual({
      title: "Ada Lovelace replied to your question on Closures",
      snippet: "They capture variables.",
      href: "/courses/js-basics/lessons/9#comment-7",
      icon: "discussion",
      avatar: { kind: "sender", name: "Ada Lovelace", avatarUrl: null },
      recognised: true,
    });
  });

  it("shows the sender's real avatar", () => {
    const row = describeNotification(
      feedNotification({
        sender: { name: "Ada Lovelace", avatarUrl: "/avatars/ada.png" },
      })
    );
    expect(row.avatar).toEqual({
      kind: "sender",
      name: "Ada Lovelace",
      avatarUrl: "/avatars/ada.png",
    });
  });

  it("shows the Cadence avatar when there is no sender", () => {
    const row = describeNotification(feedNotification({ sender: null }));
    expect(row.avatar).toEqual({ kind: "cadence" });
  });

  it("renders a generic row with no link when the data is malformed", () => {
    expect(
      describeNotification(feedNotification({ data: { commentId: "7" } }))
    ).toEqual({
      title: "New notification",
      snippet: "",
      href: null,
      icon: "generic",
      avatar: { kind: "sender", name: "Ada Lovelace", avatarUrl: null },
      recognised: false,
    });
  });

  it("renders a generic row when the data is missing entirely", () => {
    expect(
      describeNotification(feedNotification({ data: null })).recognised
    ).toBe(false);
  });

  it("refuses a link that leaves the site", () => {
    const row = describeNotification(
      feedNotification({
        data: {
          commentId: 7,
          questionId: 3,
          lessonId: 9,
          lessonTitle: "Closures",
          courseSlug: "js-basics",
          snippet: "Hi",
          url: "https://evil.example/phish",
        },
      })
    );
    expect(row.href).toBeNull();
  });

  it("renders a generic row for an unknown Notification type", () => {
    expect(
      describeNotification(feedNotification({ type: "something-new" }))
        .recognised
    ).toBe(false);
  });
});
