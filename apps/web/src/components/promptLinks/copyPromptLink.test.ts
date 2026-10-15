import { expect, it } from "vite-plus/test";
import { parseNewThreadLink } from "@supaterm/shared/promptLinks";
import { promptLinkFor } from "./copyPromptLink";

it("shares readable context labels without references whose payloads cannot travel", () => {
  const link = promptLinkFor(
    "Review [selected code](supaterm-context://v1/code/code_1) with ![screenshot](supaterm-context://v1/image/image_1)",
  );
  expect(link).not.toBeNull();
  const parsed = parseNewThreadLink(new URL(link!).search);
  expect(parsed).toMatchObject({
    value: { prompt: { text: "Review selected code with screenshot" } },
  });
});
