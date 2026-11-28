export type NoteDraft = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  unsaved: boolean;
  canSave: boolean;
};

/**
 * The server trims a Note before storing it, and the browser submits line
 * breaks as CRLF while the text box holds LF, so both sides are compared in
 * that stored form. Otherwise a saved Note reads as unsaved straight away.
 */
function asStored(body: string): string {
  return body.replaceAll("\r\n", "\n").trim();
}

export function describeDraft(
  body: string,
  savedBody: string,
  max: number
): NoteDraft {
  const stored = asStored(body);
  const length = stored.length;
  const tooLong = length > max;
  // The save action rejects a blank Note, so the button must not offer it.
  const empty = length === 0;
  const unsaved = stored !== asStored(savedBody);
  return {
    length,
    max,
    tooLong,
    empty,
    unsaved,
    canSave: unsaved && !empty && !tooLong,
  };
}
