import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function variable(node: ESTree.Node, source: SourceCode): Variable | undefined {
  if (node.type !== "Identifier") return undefined;
  let scope: Scope | null = source.getScope(node);
  while (scope !== null) {
    const found = scope.set.get(node.name);
    if (found !== undefined) return found;
    scope = scope.upper;
  }
  return undefined;
}

function property(node: ESTree.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return undefined;
}

function imported(node: ESTree.Node, source: SourceCode, name: string): boolean {
  if (node.type !== "Identifier") return false;
  return (
    variable(node, source)?.defs.some((definition) => {
      const specifier = definition.node;
      if (
        specifier.parent?.type !== "ImportDeclaration" ||
        !["node:timers/promises", "timers/promises"].includes(specifier.parent.source.value)
      )
        return false;
      if (name === "*") {
        return (
          specifier.type === "ImportNamespaceSpecifier" ||
          specifier.type === "ImportDefaultSpecifier"
        );
      }
      return (
        specifier.type === "ImportSpecifier" &&
        (specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value) === name
      );
    }) ?? false
  );
}

function arithmetic(operator: string, left: number, right: number): number | undefined {
  if (operator === "*") return left * right;
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "/") return left / right;
  return undefined;
}

function value(
  node: ESTree.Node,
  source: SourceCode,
  seen = new Set<ESTree.Node>(),
): number | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "Identifier") {
    const definition = variable(node, source)?.defs[0];
    if (
      definition?.node.type === "VariableDeclarator" &&
      definition.node.init !== null &&
      definition.node.parent.type === "VariableDeclaration" &&
      definition.node.parent.kind === "const"
    )
      return value(definition.node.init, source, seen);
  }
  if (node.type === "ConditionalExpression") {
    const yes = value(node.consequent, source, new Set(seen));
    const no = value(node.alternate, source, new Set(seen));
    return yes === undefined || no === undefined ? undefined : Math.max(yes, no);
  }
  if (node.type === "BinaryExpression") {
    const left = value(node.left, source, new Set(seen));
    const right = value(node.right, source, new Set(seen));
    return left === undefined || right === undefined
      ? undefined
      : arithmetic(node.operator, left, right);
  }
  return undefined;
}

const DURATION_UNIT_MILLIS: Record<string, number> = {
  nano: 1e-6,
  micro: 1e-3,
  milli: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

function durationStringMillis(input: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(nano|micro|milli|second|minute|hour|day|week)s?$/.exec(
    input.trim(),
  );
  if (match === null) return undefined;
  const unit = DURATION_UNIT_MILLIS[match[2] ?? ""];
  return unit === undefined ? undefined : Number(match[1]) * unit;
}

function durationMillis(node: ESTree.Node, source: SourceCode): number | undefined {
  const direct = value(node, source);
  if (direct !== undefined) return direct;
  if (node.type === "Literal" && typeof node.value === "string") {
    return durationStringMillis(node.value);
  }
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return undefined;
  const method = property(node.callee);
  const amount = node.arguments[0];
  if (amount === undefined) return undefined;
  const number = value(amount, source);
  if (number === undefined) return undefined;
  if (method === "millis" || method === "milliseconds") return number;
  if (method === "seconds") return number * 1000;
  if (method === "minutes") return number * 60_000;
  return undefined;
}

function callbackSleep(node: ESTree.CallExpression, source: SourceCode): boolean {
  return (
    node.callee.type === "Identifier" &&
    node.callee.name === "setTimeout" &&
    (variable(node.callee, source)?.defs.length ?? 0) === 0 &&
    node.arguments[0]?.type === "Identifier"
  );
}

const noLongTestWaitsRule = defineRule({
  meta: {
    type: "problem",
    messages: {
      browserSleep:
        "Do not use waitForTimeout in tests. Wait for an observable condition or a rendered frame.",
      longSleep:
        "Test sleeps must be statically bounded to 1000ms. Use mock timers, a completion signal, or short retry intervals.",
    },
    schema: [],
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const member = node.callee.type === "MemberExpression" ? property(node.callee) : undefined;
        if (member === "waitForTimeout") {
          context.report({ messageId: "browserSleep", node });
          return;
        }
        const effectSleep =
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Effect" &&
          member === "sleep";
        const promiseTimer =
          imported(node.callee, context.sourceCode, "setTimeout") ||
          (node.callee.type === "MemberExpression" &&
            member === "setTimeout" &&
            imported(node.callee.object, context.sourceCode, "*")) ||
          (node.callee.type === "MemberExpression" &&
            member === "wait" &&
            imported(node.callee.object, context.sourceCode, "scheduler"));
        const callbackTimer = callbackSleep(node, context.sourceCode);
        if (!effectSleep && !promiseTimer && !callbackTimer) return;
        if (effectSleep && context.sourceCode.text.includes("TestClock")) return;
        const delay = node.arguments[effectSleep || promiseTimer ? 0 : 1];
        const milliseconds = delay === undefined ? 0 : durationMillis(delay, context.sourceCode);
        if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds > 1000) {
          context.report({ messageId: "longSleep", node });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "test-waits" },
  rules: { "no-long-waits": noLongTestWaitsRule },
});
