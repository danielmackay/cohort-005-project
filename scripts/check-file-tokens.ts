// Usage:
//   tsx scripts/check-file-tokens.ts              checks files staged for commit
//   tsx scripts/check-file-tokens.ts <file>...    checks the given working-tree files
//
// Exit codes: 0 all files within the limit, 1 a file is over the limit,
// 2 the check itself could not run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  findOversizedFiles,
  formatReport,
  type FileSample,
} from "./file-tokens";

function git(args: readonly string[]): Buffer {
  return execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 });
}

// Reads the staged blob rather than the working tree, because the staged
// version is what the commit will contain.
function stagedFiles(): FileSample[] {
  const names = git([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ])
    .toString("utf8")
    .split("\0")
    .filter((name) => name.length > 0);

  return names.map((path) => ({
    path,
    content: git(["cat-file", "blob", `:${path}`]),
  }));
}

function workingTreeFiles(paths: readonly string[]): FileSample[] {
  return paths.map((path) => ({ path, content: readFileSync(path) }));
}

function main(): number {
  const paths = process.argv.slice(2);
  const files = paths.length > 0 ? workingTreeFiles(paths) : stagedFiles();
  const oversized = findOversizedFiles(files);

  if (oversized.length === 0) {
    return 0;
  }

  console.error(formatReport(oversized));
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-file-tokens: could not run the check: ${message}`);
  process.exitCode = 2;
}
