import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.video-tracking";
import { courseAccess } from "~/modules/course-access/index.server";
import { getViewer } from "~/modules/course-access/viewer.server";
import { parseJsonBody } from "~/lib/validation";
import { db } from "~/db";
import { videoWatchEvents } from "~/db/schema";

const videoTrackingSchema = z.object({
  lessonId: z.number(),
  eventType: z.string(),
  positionSeconds: z.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const viewer = await getViewer(request);
  // Fail fast on a signed-out request before reading the body.
  courseAccess.requireUserId(viewer);

  const parsed = await parseJsonBody(request, videoTrackingSchema);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const { lessonId, eventType, positionSeconds } = parsed.data;

  // No course in this URL: Course Access finds it from the lesson. Watch time
  // is Student progress, so Course Staff without an Enrollment record none.
  const grant = courseAccess.requireLesson(viewer, { lessonId });
  if (!grant.enrolled) {
    throw data("Only enrolled Students record progress.", { status: 403 });
  }
  const currentUserId = grant.userId;

  db
    .insert(videoWatchEvents)
    .values({
      userId: currentUserId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning()
    .get();

  return { success: true };
}
