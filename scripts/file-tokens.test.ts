import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OVERSIZED_BASELINE } from "./file-token-baseline";
import {
  BYTES_PER_TOKEN,
  MAX_TOKENS,
  estimateTokens,
  findOversizedFiles,
  formatReport,
} from "./file-tokens";

const LIMIT_BYTES = MAX_TOKENS * BYTES_PER_TOKEN;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function textFile(path: string, bytes: number) {
  return { path, content: new Uint8Array(bytes).fill(0x61) };
}

describe("estimateTokens", () => {
  it("divides bytes by four, rounding up", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it("rejects negative byte counts", () => {
    expect(() => estimateTokens(-1)).toThrow(RangeError);
  });
});

describe("findOversizedFiles", () => {
  it("allows a file exactly at the limit", () => {
    expect(findOversizedFiles([textFile("app/a.ts", LIMIT_BYTES)])).toEqual([]);
  });

  it("flags a file one token over the limit", () => {
    const result = findOversizedFiles([
      textFile("app/a.ts", LIMIT_BYTES + BYTES_PER_TOKEN),
    ]);
    expect(result).toEqual([
      {
        path: "app/a.ts",
        bytes: LIMIT_BYTES + BYTES_PER_TOKEN,
        estimatedTokens: MAX_TOKENS + 1,
      },
    ]);
  });

  it("skips lockfiles and generated migrations", () => {
    const big = LIMIT_BYTES * 2;
    expect(
      findOversizedFiles([
        textFile("package-lock.json", big),
        textFile("drizzle/meta/0012_snapshot.json", big),
        textFile("drizzle/0012_cool_name.sql", big),
      ])
    ).toEqual([]);
  });

  it("skips binary files", () => {
    const image = new Uint8Array(LIMIT_BYTES * 2);
    expect(
      findOversizedFiles([{ path: "public/logo.png", content: image }])
    ).toEqual([]);
  });

  it("skips files on the baseline", () => {
    const files = [
      textFile("app/legacy.ts", LIMIT_BYTES * 2),
      textFile("app/new.ts", LIMIT_BYTES * 2),
    ];
    const result = findOversizedFiles(files, ["app/legacy.ts"]);
    expect(result.map((file) => file.path)).toEqual(["app/new.ts"]);
  });

  it("lists the largest file first", () => {
    const result = findOversizedFiles([
      textFile("app/small.ts", LIMIT_BYTES + 100),
      textFile("app/big.ts", LIMIT_BYTES * 3),
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "app/big.ts",
      "app/small.ts",
    ]);
  });
});

// Reads the real files: the baseline is only honest while every entry still
// names an oversized file.
describe("OVERSIZED_BASELINE", () => {
  it.each(OVERSIZED_BASELINE)("%s still exceeds the limit", (path) => {
    const absolutePath = join(REPO_ROOT, path);
    expect(
      existsSync(absolutePath),
      `${path} no longer exists. Remove it from scripts/file-token-baseline.ts.`
    ).toBe(true);
    expect(
      estimateTokens(statSync(absolutePath).size),
      `${path} is now within the limit. Remove it from scripts/file-token-baseline.ts.`
    ).toBeGreaterThan(MAX_TOKENS);
  });

  it("has no duplicate entries", () => {
    expect(new Set(OVERSIZED_BASELINE).size).toBe(OVERSIZED_BASELINE.length);
  });
});

describe("formatReport", () => {
  it("gives route-specific splitting advice", () => {
    const report = formatReport([
      {
        path: "app/routes/courses.$slug.tsx",
        bytes: 30000,
        estimatedTokens: 7500,
      },
    ]);
    expect(report).toContain("app/routes/courses.$slug.tsx: ~7500 tokens");
    expect(report).toContain("app/modules/<name>/");
    expect(report).toContain("Do not shrink a file by minifying");
  });

  it("gives test-specific splitting advice", () => {
    const report = formatReport([
      {
        path: "app/lib/refunds.server.test.ts",
        bytes: 24000,
        estimatedTokens: 6000,
      },
    ]);
    expect(report).toContain("one file per `describe` block");
  });
});
