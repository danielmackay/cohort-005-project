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
      icon: "discussion",
      avatar: { kind: "sender", name: "Ada Lovelace", avatarUrl: null },
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

describe("describeNotification for Refund Requests", () => {
  const refundRequest = {
    refundRequestId: 4,
    purchaseId: 11,
    courseTitle: "JS Basics",
    amountPaid: 7900,
  };

  it("renders the Refund Request confirmation with nowhere to go", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "refund-request-confirmation",
          sender: null,
          data: refundRequest,
        })
      )
    ).toEqual({
      title: "Your refund request for JS Basics is under review",
      snippet: "$79.00. We review every refund request by hand.",
      href: null,
      icon: "refund",
      avatar: { kind: "cadence" },
      recognised: true,
    });
  });

  it("renders an Open Refund Request for a Platform Admin", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "open-refund-request",
          data: {
            ...refundRequest,
            buyerName: "Ada (when she asked)",
            reason: "It was not what I expected.",
            url: "/admin/refunds",
          },
        })
      )
    ).toEqual({
      title: "Ada Lovelace asked for a refund on JS Basics",
      snippet: "$79.00: It was not what I expected.",
      href: "/admin/refunds",
      icon: "refund",
      avatar: { kind: "sender", name: "Ada Lovelace", avatarUrl: null },
      recognised: true,
    });
  });

  it("names the buyer from the data when the sender is missing", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "open-refund-request",
          sender: null,
          data: {
            ...refundRequest,
            buyerName: "Ada Lovelace",
            reason: "Nope.",
            url: "/admin/refunds",
          },
        })
      ).title
    ).toBe("Ada Lovelace asked for a refund on JS Basics");
  });

  it("renders an approval with its decision note", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "refund-request-approved",
          sender: { name: "Pat Admin", avatarUrl: null },
          data: {
            ...refundRequest,
            decisionNote: "Sorry it wasn't for you.",
            url: "/settings#refund-requests",
          },
        })
      )
    ).toEqual({
      title: "Your refund for JS Basics was approved",
      snippet: "$79.00 is on its way back to you. Sorry it wasn't for you.",
      href: "/settings#refund-requests",
      icon: "refund",
      avatar: { kind: "sender", name: "Pat Admin", avatarUrl: null },
      recognised: true,
    });
  });

  it("renders an approval with no decision note", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "refund-request-approved",
          data: {
            ...refundRequest,
            decisionNote: null,
            url: "/settings#refund-requests",
          },
        })
      ).snippet
    ).toBe("$79.00 is on its way back to you.");
  });

  it("renders a decline with its note and that they can ask again", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "refund-request-declined",
          data: {
            ...refundRequest,
            decisionNote: "You finished the course.",
            url: "/settings#refund-requests",
          },
        })
      )
    ).toEqual({
      title: "Your refund request for JS Basics was declined",
      snippet: "You finished the course. You can raise a new refund request.",
      href: "/settings#refund-requests",
      icon: "refund",
      avatar: { kind: "sender", name: "Ada Lovelace", avatarUrl: null },
      recognised: true,
    });
  });

  it("renders a generic row when Refund Request data is malformed or links off-site", () => {
    expect(
      describeNotification(
        feedNotification({
          type: "refund-request-declined",
          data: { ...refundRequest, decisionNote: null, url: "/settings" },
        })
      ).recognised
    ).toBe(false);
    expect(
      describeNotification(
        feedNotification({
          type: "open-refund-request",
          data: {
            ...refundRequest,
            buyerName: "Ada",
            reason: "Nope.",
            url: "//evil.example/phish",
          },
        })
      ).href
    ).toBeNull();
  });
});
