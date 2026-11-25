// Enforces the "Keep files under 5000 tokens" rule in CODING_STANDARDS.md.
//
// Tokens are estimated as bytes / 4. That is close enough for English prose and
// TypeScript with real tokenizers, costs nothing to compute, and needs no
// model-specific dependency. The limit is a nudge to split files, not a billing
// calculation, so a cheap estimate that errs either way by ~20% is fine.

import { OVERSIZED_BASELINE } from "./file-token-baseline";

export const MAX_TOKENS = 5000;
export const BYTES_PER_TOKEN = 4;

// Files that are machine-written or vendored. Splitting them is impossible or
// would fight the tool that owns them.
const EXEMPT_PATTERNS: readonly RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)skills-lock\.json$/,
  // Drizzle migrations and snapshots are generated and forward-only.
  /^drizzle\//,
  /\.snap$/,
];

// Git's own binary heuristic: a NUL byte in the first 8000 bytes.
const BINARY_SNIFF_BYTES = 8000;

export interface FileSample {
  path: string;
  content: Uint8Array;
}

export interface OversizedFile {
  path: string;
  bytes: number;
  estimatedTokens: number;
}

export function estimateTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Byte count must be a non-negative number: ${bytes}`);
  }
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

export function isExempt(path: string): boolean {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(path));
}

export function isBinary(content: Uint8Array): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

export function findOversizedFiles(
  files: readonly FileSample[],
  baseline: readonly string[] = OVERSIZED_BASELINE
): OversizedFile[] {
  const baselined = new Set(baseline);
  return files
    .filter(
      (file) =>
        !isExempt(file.path) &&
        !baselined.has(file.path) &&
        !isBinary(file.content)
    )
    .map((file) => ({
      path: file.path,
      bytes: file.content.byteLength,
      estimatedTokens: estimateTokens(file.content.byteLength),
    }))
    .filter((file) => file.estimatedTokens > MAX_TOKENS)
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);
}

function splitAdvice(path: string): string[] {
  if (/\.test\.tsx?$/.test(path)) {
    return [
      "This is a test file. Split it by behaviour: one file per `describe` block",
      "or feature area (e.g. `refunds.partial.test.ts`, `refunds.window.test.ts`).",
      "Move shared setup and fixtures into a fixtures file next to the tests",
      "and import it from each new file. Do not delete or merge test cases.",
    ];
  }
  if (/^app\/routes\/.+\.tsx?$/.test(path)) {
    return [
      "This is a route module. Keep it as thin glue: loader, action, and a",
      "component that composes smaller pieces.",
      "- Move data access and business rules out of `loader`/`action` into a deep",
      "  module under `app/modules/<name>/` and import its entry point",
      "  (see app/modules/README.md).",
      "- Move each large JSX section into its own component under",
      "  `app/components/` and pass data in as props.",
    ];
  }
  if (/^app\/modules\/[^/]+\/lib\//.test(path)) {
    return [
      "This is module internals. Split it into several files in the same `lib/`",
      "folder, one per responsibility, which import each other freely.",
      "Keep the module's entry points and their exports unchanged so callers",
      "are untouched. Do not add a barrel file.",
    ];
  }
  if (/\.mdx?$/.test(path)) {
    return [
      "This is a document. Split it into focused topic files and link to them",
      "from a short parent document. For a skill, keep SKILL.md to the core",
      "steps and move reference material into sibling files it points to.",
    ];
  }
  return [
    "Split it by responsibility: find the groups of functions or types that",
    "change together and move each group into its own file, then import them",
    "from the original location.",
  ];
}

export function formatReport(oversized: readonly OversizedFile[]): string {
  const sections = oversized.map((file) =>
    [
      `✖ ${file.path}: ~${file.estimatedTokens} tokens ` +
        `(${file.bytes} bytes; limit ${MAX_TOKENS} tokens ≈ ` +
        `${MAX_TOKENS * BYTES_PER_TOKEN} bytes)`,
      ...splitAdvice(file.path).map((line) => `  ${line}`),
    ].join("\n")
  );

  return [
    `File token limit exceeded. CODING_STANDARDS.md: keep every file under ` +
      `${MAX_TOKENS} tokens (estimated as bytes / ${BYTES_PER_TOKEN}).`,
    "",
    ...sections.flatMap((section) => [section, ""]),
    "How to fix:",
    "  1. Split each file above along the lines suggested, aiming well under",
    "     the limit so the next small edit does not trip it again.",
    "  2. Do not shrink a file by minifying, deleting comments, shortening",
    "     names or squashing lines. The point is smaller units of meaning.",
    "  3. Update every import of moved code, then run `npm run check`.",
    "  4. Re-check with `npm run check:tokens -- <file> [<file>...]`.",
    "  5. Stage the new files and commit again.",
  ].join("\n");
}
