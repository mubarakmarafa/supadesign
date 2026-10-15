import { createOxlintRuleHarness } from "./test/utils.ts";

const waits = createOxlintRuleHarness("test-waits/no-long-waits", {
  filename: "src/example.test.ts",
  pluginName: "test-waits",
  pluginPath: "oxlint-plugin-supaterm/test-waits.ts",
});

waits.valid("short Effect sleep", "await Effect.sleep(1000);");
waits.valid("abort watchdog", "setTimeout(() => controller.abort(), 30000);");
waits.valid("short Effect duration string", 'await Effect.sleep("250 millis");');
waits.valid("one second duration string", 'await Effect.sleep("1 second");');
waits.valid(
  "Effect sleep on a TestClock",
  'yield* Effect.sleep("31 seconds"); yield* TestClock.adjust("31 seconds");',
);
waits.invalid("long Effect sleep", "await Effect.sleep(1001);");
waits.invalid("long Effect duration string", 'await Effect.sleep("3 seconds");');
waits.invalid("unparsed Effect duration string", 'await Effect.sleep("soon");');
waits.invalid("browser wait", "await page.waitForTimeout(10);");
waits.invalid("unknown timer", "await new Promise((resolve) => setTimeout(resolve, delay));");
