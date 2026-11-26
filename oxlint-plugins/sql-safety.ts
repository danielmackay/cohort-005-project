import { definePlugin, defineRule } from "@oxlint/plugins";
import type { Context, ESTree, Scope } from "@oxlint/plugins";

// `sql.raw` skips Drizzle's parameterisation, so any runtime value inside it is
// a SQL injection. The rule bans only that: static SQL in `sql.raw` stays
// legal, because building fixed fragments (column lists, ORDER BY keywords) is
// what `sql.raw` is for.

type Node = ESTree.Node;

function isStaticString(node: Node, context: Context): boolean {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string";
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "BinaryExpression":
      return (
        node.operator === "+" &&
        isStaticString(node.left, context) &&
        isStaticString(node.right, context)
      );
    case "Identifier":
      return isConstBoundToStaticString(node, context);
    default:
      return false;
  }
}

// A `const` initialised with static SQL can never hold user input, so naming a
// fragment does not trip the rule. `let` and parameters can be reassigned or
// passed anything, so they still count as dynamic.
function isConstBoundToStaticString(
  node: Extract<Node, { type: "Identifier" }>,
  context: Context
): boolean {
  let scope: Scope | null = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      const [definition] = variable.defs;
      if (variable.defs.length !== 1 || definition === undefined) return false;
      const declarator = definition.node;
      const declaration = definition.parent;
      return (
        declarator.type === "VariableDeclarator" &&
        declaration?.type === "VariableDeclaration" &&
        declaration.kind === "const" &&
        declarator.init != null &&
        isStaticString(declarator.init, context)
      );
    }
    scope = scope.upper;
  }
  return false;
}

function isSqlRawCallee(callee: Node): boolean {
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "sql") {
    return false;
  }
  const { property } = callee;
  if (callee.computed) {
    return property.type === "Literal" && property.value === "raw";
  }
  return property.type === "Identifier" && property.name === "raw";
}

const noDynamicSqlRaw = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow passing a dynamic string to Drizzle's sql.raw, which is not parameterised.",
    },
    messages: {
      dynamicSqlRaw:
        "sql.raw does not escape its input: a dynamic string here is a SQL injection. Use the sql`...` template tag or Drizzle operators (eq, like, ...), which bind values as parameters. Keep sql.raw for static SQL only.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isSqlRawCallee(node.callee)) return;
        const [argument] = node.arguments;
        if (argument === undefined) return;
        if (
          argument.type !== "SpreadElement" &&
          isStaticString(argument, context)
        ) {
          return;
        }
        context.report({ node: argument, messageId: "dynamicSqlRaw" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "sql-safety" },
  rules: { "no-dynamic-sql-raw": noDynamicSqlRaw },
});
