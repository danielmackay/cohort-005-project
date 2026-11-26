import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "./sql-safety";

RuleTester.describe = describe;
RuleTester.it = it;

const rule = plugin.rules["no-dynamic-sql-raw"];
if (rule === undefined) {
  throw new Error("sql-safety plugin does not export no-dynamic-sql-raw");
}

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = { messageId: "dynamicSqlRaw" };

ruleTester.run("no-dynamic-sql-raw", rule, {
  valid: [
    `sql.raw("ORDER BY created_at DESC")`,
    "sql.raw(`ORDER BY created_at DESC`)",
    `sql.raw("SELECT " + "1")`,
    `sql["raw"]("SELECT 1")`,
    `const ORDER = "created_at DESC"; sql.raw(ORDER)`,
    `const ORDER = "created_at " + "DESC"; sql.raw("ORDER BY " + ORDER)`,
    // The tagged template binds `${search}` as a parameter.
    "sql`title LIKE ${search}`",
    // Only Drizzle's `sql` identifier is in scope.
    "db.raw(search)",
    "other.raw(`x ${search}`)",
  ],
  invalid: [
    {
      code: "sql.raw(`(title LIKE '%${search}%')`)",
      errors: [error],
    },
    { code: `sql.raw("title = '" + search + "'")`, errors: [error] },
    { code: "sql.raw(search)", errors: [error] },
    { code: `sql["raw"](search)`, errors: [error] },
    { code: "sql.raw(...parts)", errors: [error] },
    { code: "sql.raw(build())", errors: [error] },
    { code: `let fragment = "x"; sql.raw(fragment)`, errors: [error] },
    { code: "function f(fragment) { sql.raw(fragment) }", errors: [error] },
    {
      code: "const fragment = `x ${search}`; sql.raw(fragment)",
      errors: [error],
    },
  ],
});
