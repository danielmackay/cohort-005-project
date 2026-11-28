import { useState } from "react";
import { useFetcher } from "react-router";
import { NotebookPen } from "lucide-react";
import { LessonSection } from "~/components/lesson-section";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn, formatRelativeTime } from "~/lib/utils";
import { noteDraft } from "~/modules/note-draft";

export function LessonNote({
  note,
}: {
  note: { body: string; updatedAt: string } | null;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const savedBody = note?.body ?? "";
  const [body, setBody] = useState(savedBody);
  const draft = noteDraft(body, savedBody);
  const isSaving = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  return (
    <LessonSection
      icon={NotebookPen}
      title="Your notes"
      description="Private to you. Jot things down while you watch."
    >
      <fetcher.Form method="post" className="space-y-2">
        <input type="hidden" name="intent" value="save-note" />
        <Textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What stood out in this lesson?"
          aria-label="Your notes"
          className="min-h-28 resize-y"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isSaving || !draft.canSave}>
            {isSaving ? "Saving..." : "Save note"}
          </Button>
          <NoteStatus
            error={error}
            unsaved={draft.unsaved}
            updatedAt={note?.updatedAt}
          />
          <span
            className={cn(
              "ml-auto text-xs",
              draft.tooLong ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {draft.length} / {draft.max}
          </span>
        </div>
      </fetcher.Form>
    </LessonSection>
  );
}

function NoteStatus({
  error,
  unsaved,
  updatedAt,
}: {
  error: string | undefined;
  unsaved: boolean;
  updatedAt: string | undefined;
}) {
  if (error) return <span className="text-xs text-destructive">{error}</span>;
  if (unsaved && updatedAt !== undefined)
    return (
      <span className="text-xs text-muted-foreground">Unsaved changes</span>
    );
  if (updatedAt === undefined) return null;
  return (
    <span suppressHydrationWarning className="text-xs text-muted-foreground">
      Saved {formatRelativeTime(updatedAt)}
    </span>
  );
}
