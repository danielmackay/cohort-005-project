// Files that were over the token limit before the limit was enforced. The
// check skips them so that an unrelated edit does not force a large split
// into the same commit.
//
// This list only shrinks. Never add a file: split it instead. When a listed
// file is split below the limit, delete its entry. `file-tokens.test.ts` fails
// on an entry that no longer exists or no longer exceeds the limit, so stale
// entries cannot linger and silently exempt a file that later regrows.
export const OVERSIZED_BASELINE: readonly string[] = [
  "app/lib/refunds.server.test.ts",
  "app/lib/refunds.server.ts",
  "app/modules/instructor-analytics/lib/instructor-analytics.ts",
  "app/modules/instructor-analytics/tests/instructor-analytics.test.ts",
  "app/routes/courses.$slug.lessons.$lessonId.tsx",
  "app/routes/courses.$slug.tsx",
  "app/routes/instructor.$courseId.lessons.$lessonId.quiz.tsx",
  "app/routes/instructor.$courseId.tsx",
  "app/routes/instructor.analytics.tsx",
  "request-logger/README.md",
  "request-logger/agents.test.ts",
  "request-logger/agents.ts",
  "request-logger/proxy.ts",
  "request-logger/render.ts",
  "scripts/seed.ts",
];
