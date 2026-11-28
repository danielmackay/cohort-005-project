export type NoteDraft = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  unsaved: boolean;
  canSave: boolean;
};

export function describeDraft(
  body: string,
  savedBody: string,
  max: number
): NoteDraft {
  const length = body.length;
  const tooLong = length > max;
  // The save action rejects a blank Note, so the button must not offer it.
  const empty = body.trim().length === 0;
  const unsaved = body !== savedBody;
  return {
    length,
    max,
    tooLong,
    empty,
    unsaved,
    canSave: unsaved && !empty && !tooLong,
  };
}
