import { describe, it, expect } from "vitest";
import { noteDraft } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("noteDraft", () => {
  it("counts characters against the Note limit", () => {
    const draft = noteDraft("hello", "");
    expect(draft.length).toBe(5);
    expect(draft.max).toBe(MAX_NOTE_LENGTH);
  });

  it("offers Save for new text that differs from the saved Note", () => {
    const draft = noteDraft("new thought", "old thought");
    expect(draft.unsaved).toBe(true);
    expect(draft.canSave).toBe(true);
  });

  it("does not offer Save when nothing changed", () => {
    const draft = noteDraft("same", "same");
    expect(draft.unsaved).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("does not offer Save for a blank Note", () => {
    const draft = noteDraft("   \n ", "something");
    expect(draft.empty).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("treats text with content as not empty", () => {
    expect(noteDraft(" a ", "").empty).toBe(false);
  });

  it("accepts a Note exactly at the limit", () => {
    const draft = noteDraft("x".repeat(MAX_NOTE_LENGTH), "");
    expect(draft.tooLong).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("refuses a Note one character over the limit", () => {
    const draft = noteDraft("x".repeat(MAX_NOTE_LENGTH + 1), "");
    expect(draft.tooLong).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("treats text that differs from the saved Note only by surrounding whitespace as saved", () => {
    const draft = noteDraft("saved thought  \n", "saved thought");
    expect(draft.unsaved).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("treats CRLF and LF line breaks as the same text", () => {
    expect(
      noteDraft("line one\nline two", "line one\r\nline two").unsaved
    ).toBe(false);
  });

  it("does not count surrounding whitespace, which the server trims", () => {
    expect(noteDraft("  hello  ", "").length).toBe(5);
  });
});
