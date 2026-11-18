import { describe, it, expect } from "vitest";
import { fromKnockCategories } from "./knock-notifications.server";

const FEED = "feed-channel-id";

describe("fromKnockCategories", () => {
  it("reads a choice Cadence stored by the feed's channel id", () => {
    expect(
      fromKnockCategories(
        { "discussion-replies": { channels: { [FEED]: false } } },
        FEED
      )
    ).toEqual({ "discussion-replies": { feed: false } });
  });

  it("reads the environment default stored by channel type", () => {
    expect(
      fromKnockCategories(
        { enrollments: { channel_types: { in_app_feed: false } } },
        FEED
      )
    ).toEqual({ enrollments: { feed: false } });
  });

  it("prefers the channel id over the channel type when both are set", () => {
    expect(
      fromKnockCategories(
        {
          enrollments: {
            channels: { [FEED]: true },
            channel_types: { in_app_feed: false },
          },
        },
        FEED
      )
    ).toEqual({ enrollments: { feed: true } });
  });

  it("reads a whole category turned off", () => {
    expect(fromKnockCategories({ "seat-claims": false }, FEED)).toEqual({
      "seat-claims": { feed: false },
    });
  });

  it("leaves out categories Cadence doesn't know and ones with no feed setting", () => {
    expect(
      fromKnockCategories(
        {
          marketing: true,
          "discussion-questions": { channels: { "other-channel": false } },
        },
        FEED
      )
    ).toEqual({});
  });
});
