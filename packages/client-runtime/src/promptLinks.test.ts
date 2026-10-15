import {
  ProviderDriverKind,
  ProviderInstanceId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type RepositoryIdentity,
  type ThreadPullRequestLink,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findPromptLinkProject,
  findPromptLinkPullRequestThread,
  resolvePromptLinkModelSelection,
} from "./promptLinks.ts";

const identity = (canonicalKey: string, origin?: string): RepositoryIdentity => ({
  canonicalKey,
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: `https://${canonicalKey}` },
  ...(origin ? { origin: { canonicalKey: origin } } : {}),
});

describe("findPromptLinkProject", () => {
  it("takes the first exact match and never a fork of the repository", () => {
    const projects = [
      {
        id: "fork",
        repositoryIdentity: identity(
          "github.com/supabitapp/supacode-next",
          "github.com/me/supacode-next",
        ),
      },
      { id: "none", repositoryIdentity: null },
      { id: "recent", repositoryIdentity: identity("github.com/SupabitApp/Supacode-Next") },
      { id: "older", repositoryIdentity: identity("github.com/supabitapp/supacode-next") },
    ];
    expect(
      findPromptLinkProject(projects, { owner: "supabitapp", name: "supacode-next" })?.id,
    ).toBe("recent");
    expect(findPromptLinkProject(projects, { owner: "me", name: "supacode-next" })?.id).toBe(
      "fork",
    );
    expect(findPromptLinkProject(projects, { owner: "gitlab", name: "x" })).toBeUndefined();
  });
});

describe("findPromptLinkPullRequestThread", () => {
  const link = (number: number, source: ThreadPullRequestLink["source"] = "created") =>
    ({
      host: "github.com",
      repository: "supabitapp/supacode-next",
      number,
      url: `https://github.com/supabitapp/supacode-next/pull/${number}`,
      source,
      linkedAt: "2026-01-01T00:00:00.000Z",
      snapshot: null,
      stack: null,
    }) satisfies ThreadPullRequestLink;

  it("finds the most recently updated thread linked to the pull request", () => {
    const threads = [
      { id: "old", updatedAt: "2026-01-01T00:00:00.000Z", pullRequests: [link(7)] },
      { id: "new", updatedAt: "2026-02-01T00:00:00.000Z", pullRequests: [link(7)] },
      { id: "other", updatedAt: "2026-03-01T00:00:00.000Z", pullRequests: [link(8)] },
      {
        id: "dismissed",
        updatedAt: "2026-04-01T00:00:00.000Z",
        pullRequests: [link(7, "stack-dismissed")],
      },
    ];
    const pullRequest = { owner: "SupabitApp", name: "supacode-next", number: 7 };
    expect(findPromptLinkPullRequestThread(threads, pullRequest)?.id).toBe("new");
    expect(findPromptLinkPullRequestThread(threads, { ...pullRequest, number: 9 })).toBeUndefined();
  });
});

describe("resolvePromptLinkModelSelection", () => {
  const provider = (
    instanceId: string,
    driver: string,
    status: "ready" | "warning" | "error" | "disabled" = "ready",
  ) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    status,
    models: [
      { slug: "small", name: "Small" },
      { slug: "big", name: "Big", aliases: ["opus"], isDefault: true },
    ],
  });

  it("maps the requested provider and model onto a usable instance", () => {
    const providers = [provider("broken", "claudeAgent", "error"), provider("work", "claudeAgent")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claude", model: "small" }),
    ).toEqual({
      selection: { instanceId: "work", model: "small" },
      exact: true,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claudeagent", model: "opus" }),
    ).toEqual({
      selection: { instanceId: "work", model: "big" },
      exact: true,
    });
  });

  it("uses the instance default for an unknown model, and nothing for a missing provider", () => {
    const providers = [provider("codex", "codex")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "codex", model: "nope" }),
    ).toEqual({
      selection: { instanceId: "codex", model: "big" },
      exact: false,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "cursor", model: null }),
    ).toBeNull();
  });

  it("respects the destination project's enablement rather than machine enablement", () => {
    const projectId = ProjectId.make("project-a");
    const instanceId = ProviderInstanceId.make("codex");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), config: {}, enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    const providers = [provider("codex", "codex")];
    const request = { provider: "codex", model: "small" };
    expect(resolvePromptLinkModelSelection(providers, request, { settings, projectId })).toBeNull();
    expect(
      resolvePromptLinkModelSelection(providers, request, { settings, projectId: null }),
    ).toMatchObject({
      selection: { instanceId, model: "small" },
      exact: true,
    });
    settings.projectSettingsOverrides[projectId]!.providerInstances[instanceId]!.enabled = true;
    expect(
      resolvePromptLinkModelSelection([{ ...providers[0]!, enabled: false }], request, {
        settings,
        projectId,
      }),
    ).toMatchObject({
      selection: { instanceId, model: "small" },
      exact: true,
    });
  });
});
