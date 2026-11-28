import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { describeDraft, type NoteDraft } from "./lib/draft";

export type { NoteDraft };

/**
 * What the Note editor shows for the text in the box: the character count,
 * whether it is over the limit, whether it differs from the saved Note, and
 * whether Save should be offered.
 */
export function noteDraft(body: string, savedBody: string): NoteDraft {
  return describeDraft(body, savedBody, MAX_NOTE_LENGTH);
}
