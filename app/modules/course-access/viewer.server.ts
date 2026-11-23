import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import type { Viewer } from "./lib/course-access";

export type { Viewer } from "./lib/course-access";

/**
 * Who is making this request: the signed-in user (or none) and the country
 * they're in now (dev override first, then `CF-IPCountry`). Resolve it once
 * per loader or action and pass it to every Course Access call.
 */
export async function getViewer(request: Request): Promise<Viewer> {
  const [userId, country] = await Promise.all([
    getCurrentUserId(request),
    resolveCountry(request),
  ]);
  return { userId, country };
}
