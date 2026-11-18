import { describe, expect, it } from "vitest";
import { describeNotification, type FeedNotification } from "./notifications";

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
      recognised: true,
    });
  });

  it("renders a generic row with no link when the data is malformed", () => {
    expect(
      describeNotification(feedNotification({ data: { commentId: "7" } }))
    ).toEqual({
      title: "New notification",
      snippet: "",
      href: null,
      recognised: false,
    });
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

  it("refuses a protocol-relative link", () => {
    const row = describeNotification(
      feedNotification({
        data: {
          commentId: 7,
          questionId: 3,
          lessonId: 9,
          lessonTitle: "Closures",
          courseSlug: "js-basics",
          snippet: "Hi",
          url: "//evil.example/phish",
        },
      })
    );
    expect(row.href).toBeNull();
  });

  it("renders a Discussion Question row from its trigger data", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "discussion-question",
          data: {
            commentId: 3,
            lessonId: 9,
            lessonTitle: "Closures",
            courseSlug: "js-basics",
            snippet: "How do closures work?",
            url: "/courses/js-basics/lessons/9#comment-3",
          },
        })
      )
    ).toEqual({
      title: "Ada Lovelace asked a question on Closures",
      snippet: "How do closures work?",
      href: "/courses/js-basics/lessons/9#comment-3",
      recognised: true,
    });
  });

  it("refuses a Discussion Question link that leaves the site", () => {
    const row = describeNotification(
      feedNotification({
        type: "discussion-question",
        data: {
          commentId: 3,
          lessonId: 9,
          lessonTitle: "Closures",
          courseSlug: "js-basics",
          snippet: "Hi",
          url: "//evil.example/phish",
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
