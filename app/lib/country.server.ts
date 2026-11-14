import { getSession } from "~/lib/session";

// ─── Country Resolution ───
// Layered approach: (1) dev session override, (2) CF-IPCountry header.
// Returns a 2-letter ISO country code or null. Null prices at full price
// (Tier 1): a page never waits on a network call to learn the country.
// An ip-api.com lookup used to fill in a missing header; it was dropped
// because every course and lesson page then waited on a rate-limited
// (45/min) plain-HTTP call. See docs/adr/0008 (deprecated).

export async function resolveCountry(request: Request): Promise<string | null> {
  // 1. Dev session override
  const session = await getSession(request);
  const devCountry = session.get("devCountry");
  if (typeof devCountry === "string" && devCountry.length === 2) {
    return devCountry.toUpperCase();
  }

  // 2. Cloudflare CF-IPCountry header
  const cfCountry = request.headers.get("CF-IPCountry");
  if (cfCountry && cfCountry.length === 2 && cfCountry !== "XX") {
    return cfCountry.toUpperCase();
  }

  return null;
}
