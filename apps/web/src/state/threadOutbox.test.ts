import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  PlanId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
} from "@supaterm/contracts";
import type { ThreadOutboxEntry } from "./threadOutboxDelivery";
import { DraftId } from "../composerDraftStore";
import type { OutboxTurn } from "./threadOutboxSchema";

const harness = vi.hoisted(() => ({
  records: new Map<string, ThreadOutboxEntry<OutboxTurn>>(),
  run: vi.fn(),
  verify: vi.fn(),
  marked: vi.fn(),
  finalized: vi.fn(),
  supportsUploads: false,
  online: false,
  existingThread: false,
  archivedThread: false,
}));

vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  const registry = AtomRegistry.make();
  return {
    appAtomRegistry: {
      set: registry.set.bind(registry),
      subscribe: registry.subscribe.bind(registry),
      get: (...args: Parameters<typeof registry.get>) => {
        const atom: unknown = args[0];
        if (typeof atom !== "string") return registry.get(...args);
        if (atom === "presentation")
          return { connection: { phase: harness.online ? "connected" : "offline" } };
        if (atom === "shell") return { status: harness.online ? "live" : "cached" };
        if (atom === "snapshot")
          return {
            archivedThreads: harness.archivedThread ? [{ id: "thread" }] : [],
            threads: harness.existingThread
              ? [
                  {
                    id: "thread",
                    branch: "old",
                    runtimeMode: "approval-required",
                    interactionMode: "plan",
                  },
                ]
              : [],
          };
        return new Map([
          [
            "environment",
            {
              environment: {
                capabilities: {
                  attachmentUploads: harness.supportsUploads,
                  inlineMessageContext: true,
                  fileAttachments: { maxUploadBytes: 1_000 },
                },
              },
            },
          ],
        ]);
      },
    },
  };
});
vi.mock("./presentation", () => ({
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("./shell", () => ({ environmentShell: { stateValueAtom: () => "shell" } }));
vi.mock("./server", () => ({ environmentServerConfigsAtom: "configs" }));
vi.mock("./threadCommands", () => ({
  directThreadEnvironment: {
    startTurn: { label: "send" },
    updateMetadata: { label: "branch" },
    setRuntimeMode: { label: "runtime" },
    setInteractionMode: { label: "interaction" },
    snapshotAtom: () => "snapshot",
  },
}));
vi.mock("./attachments", () => ({
  attachmentEnvironment: { createUploadUrl: { label: "upload" }, remove: { label: "remove" } },
}));
vi.mock("./assets", () => ({ assetEnvironment: { createUrl: { label: "verify" } } }));
vi.mock("./vcs", () => ({ fetchVcsRefs: { label: "refs" } }));
vi.mock("./session", () => ({
  readPreparedConnection: () => ({ httpBaseUrl: "https://environment.example" }),
}));
vi.mock("../lib/utils", () => ({
  randomUUID: () => "generated-command",
  newThreadId: () => ThreadId.make("replacement-thread"),
}));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (id: string) => id },
  markPromotedDraftThreadByRef: harness.marked,
  finalizePromotedDraftThreadByRef: harness.finalized,
}));
vi.mock("../lib/imageCompression", () => ({
  readFileAsDataUrl: async (file: File) => `data:${file.type};base64,${btoa(await file.text())}`,
}));
vi.mock("@supaterm/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/runtime")>()),
  runAtomCommand: (...args: unknown[]) => harness.run(...args),
}));
vi.mock("@supaterm/client-runtime/state/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/attachments")>()),
  verifyPersistedAttachmentUpload: (...args: unknown[]) => harness.verify(...args),
}));
vi.mock("./threadOutboxStorage", () => ({
  browserThreadOutboxStorage: {
    load: async () => [...harness.records.values()],
    write: async (entry: ThreadOutboxEntry<OutboxTurn>) => {
      if (!harness.records.has(entry.id)) return false;
      harness.records.set(entry.id, entry);
      return true;
    },
    writeMany: async (entries: ReadonlyArray<ThreadOutboxEntry<OutboxTurn>>) => {
      for (const entry of entries) harness.records.set(entry.id, entry);
    },
    remove: async (id: string) => {
      harness.records.delete(id);
    },
    withLock: async (_scope: string, action: () => Promise<unknown>) => action(),
  },
}));

function target() {
  return {
    environmentId: EnvironmentId.make("environment"),
    input: {
      commandId: CommandId.make("stable-command"),
      threadId: ThreadId.make("thread"),
      message: {
        messageId: MessageId.make("message"),
        role: "user" as const,
        text: "Saved prompt",
        attachments: [],
      },
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
    },
  };
}

function worktreeTarget() {
  const original = target();
  return {
    ...original,
    pendingWorktree: { projectCwd: "/project", startFromOrigin: true },
    input: {
      ...original.input,
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project"),
          title: "Offline task",
          modelSelection: original.input.modelSelection,
          runtimeMode: original.input.runtimeMode,
          interactionMode: original.input.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: "2026-10-09T00:00:00Z",
        },
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  harness.records.clear();
  harness.online = false;
  harness.supportsUploads = false;
  harness.existingThread = false;
  harness.archivedThread = false;
  harness.run.mockResolvedValue(AsyncResult.success({ sequence: 1 }));
  harness.verify.mockResolvedValue({ status: "verified" });
});

describe("web thread outbox delivery", () => {
  it.each(["default", "current"])(
    "resolves the %s branch for a restored offline worktree with an attachment",
    async (branchKind) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      await enqueueThreadOutboxTurn({
        ...worktreeTarget(),
        localAttachments: [
          {
            id: "local-image",
            type: "image",
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 5,
            bytes: new Blob(["image"], { type: "image/png" }),
          },
        ],
      });
      await webThreadOutbox.drain();
      expect(harness.run).not.toHaveBeenCalled();
      vi.resetModules();
      harness.online = true;
      const expectedBranch = branchKind === "default" ? "origin/main" : "feature/current";
      harness.run.mockImplementation(async (_registry, operation) => {
        if (operation.label === "refs")
          return AsyncResult.success({
            isRepo: true,
            refs: [
              { name: "remote/other", isDefault: false, current: true, isRemote: true },
              { name: "feature/current", isDefault: false, current: true, isRemote: false },
              ...(branchKind === "default"
                ? [{ name: "origin/main", isDefault: true, current: false, isRemote: true }]
                : []),
            ],
          });
        expect(harness.records.get("message")?.payload.pendingWorktree).toBeUndefined();
        expect(harness.records.get("message")?.payload.input.bootstrap).toMatchObject({
          createThread: { branch: expectedBranch },
          prepareWorktree: { baseBranch: expectedBranch },
        });
        return AsyncResult.success({ sequence: 1 });
      });
      await (await import("./threadOutbox")).webThreadOutbox.drain();
      expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["refs", "send"]);
      expect(harness.run.mock.calls[0]![2]).toEqual({
        environmentId: "environment",
        input: { cwd: "/project", limit: 100, refresh: true },
      });
      expect(harness.run.mock.calls[1]![2].input).toMatchObject({
        commandId: "stable-command",
        message: {
          messageId: "message",
          text: "Saved prompt",
          attachments: [{ id: "local-image", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        },
        bootstrap: {
          createThread: { branch: expectedBranch },
          prepareWorktree: {
            projectCwd: "/project",
            baseBranch: expectedBranch,
            startFromOrigin: true,
          },
          runSetupScript: true,
        },
      });
    },
  );

  it("keeps an explicit worktree base branch without querying refs", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const { pendingWorktree, ...original } = worktreeTarget();
    await enqueueThreadOutboxTurn({
      ...original,
      input: {
        ...original.input,
        bootstrap: {
          ...original.input.bootstrap,
          prepareWorktree: { ...pendingWorktree, baseBranch: "release" },
        },
      },
    });
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["send"]);
    expect(harness.run.mock.calls[0]![2].input.bootstrap.prepareWorktree.baseBranch).toBe(
      "release",
    );
  });

  it("retries branch lookup after a disconnect and retains the resolved branch across reload", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(worktreeTarget());
    harness.online = true;
    harness.run.mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    let saved = harness.records.get("message")!;
    expect(saved.status).toBe("pending");
    expect(saved.payload.pendingWorktree?.projectCwd).toBe("/project");
    harness.records.set("message", { ...saved, retryAt: 0 });
    harness.run
      .mockResolvedValueOnce(
        AsyncResult.success({
          isRepo: true,
          refs: [{ name: "main", isDefault: true, current: false, isRemote: false }],
        }),
      )
      .mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    saved = harness.records.get("message")!;
    expect(saved.status).toBe("pending");
    expect(saved.payload.pendingWorktree).toBeUndefined();
    expect(saved.payload.input.bootstrap?.prepareWorktree?.baseBranch).toBe("main");
    harness.records.set("message", { ...saved, retryAt: 0 });
    vi.resetModules();
    await (await import("./threadOutbox")).webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual([
      "refs",
      "refs",
      "send",
      "send",
    ]);
    expect(harness.run.mock.calls[3]![2]).toEqual(harness.run.mock.calls[2]![2]);
  });

  it.each([true, false])(
    "retains a failed worktree when no usable branch exists: isRepo=%s",
    async (isRepo) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      await enqueueThreadOutboxTurn(worktreeTarget());
      harness.online = true;
      harness.run.mockResolvedValueOnce(AsyncResult.success({ isRepo, refs: [] }));
      await webThreadOutbox.drain();
      expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual(["refs"]);
      expect(harness.records.get("message")).toMatchObject({
        status: "failed",
        error: isRepo
          ? "No default or current branch is available. Choose a base branch for this worktree."
          : "This project is not a Git repository. Choose Current checkout to start the task.",
        payload: { pendingWorktree: { projectCwd: "/project" } },
      });
    },
  );

  it("retries compaction with the same IDs and queues the saved prompt only after acknowledgement", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({ ...target(), compactBeforeSend: true });
    harness.online = true;
    harness.run.mockResolvedValueOnce(AsyncResult.fail({ _tag: "RpcClientError" }));
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenCalledTimes(1);
    const compact = harness.run.mock.calls[0]![2];
    expect(compact.input).toMatchObject({
      commandId: "stable-command:compact",
      message: { messageId: "message:compact", text: "/compact", attachments: [] },
      dispatchMode: "queue",
    });
    const saved = harness.records.get("message")!;
    expect(saved.payload.input.message.text).toBe("Saved prompt");
    expect(saved.payload.compactAccepted).toBeUndefined();
    harness.records.set("message", { ...saved, retryAt: 0 });
    await webThreadOutbox.drain();
    expect(harness.run.mock.calls[1]![2]).toEqual(compact);
    expect(harness.run.mock.calls[2]![2].input).toMatchObject({
      commandId: "stable-command",
      message: { messageId: "message", text: "Saved prompt" },
      dispatchMode: "queue",
    });
    expect(harness.records.size).toBe(0);
  });

  it("does not compact again when a failed prompt is retried after compaction was accepted", async () => {
    const { enqueueThreadOutboxTurn, replaceThreadOutboxTurn, webThreadOutbox } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn({ ...target(), compactBeforeSend: true });
    harness.online = true;
    harness.run
      .mockResolvedValueOnce(AsyncResult.success({ sequence: 1 }))
      .mockImplementationOnce(async () => {
        expect(harness.records.get("message")?.payload.compactAccepted).toBe(true);
        return AsyncResult.fail({
          _tag: "OrchestrationDispatchCommandError",
          message: "Prompt dispatch was rejected.",
        });
      });

    await webThreadOutbox.drain();

    expect(harness.run).toHaveBeenCalledTimes(2);
    const failed = webThreadOutbox.getSnapshot()[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.payload.compactBeforeSend).toBe(true);
    expect(failed.payload.compactAccepted).toBe(true);
    expect(harness.run.mock.calls[0]![2].input.message.text).toBe("/compact");
    expect(harness.run.mock.calls[1]![2].input.message.text).toBe("Saved prompt");

    await replaceThreadOutboxTurn(failed, failed.payload);
    await webThreadOutbox.drain();

    expect(harness.run).toHaveBeenCalledTimes(3);
    expect(harness.run.mock.calls[2]![2].input).toMatchObject({
      commandId: "generated-command",
      message: { messageId: "message", text: "Saved prompt" },
      dispatchMode: "queue",
    });
    expect(harness.run.mock.calls[2]![2].input.message.text).not.toBe("/compact");
    expect(harness.records.size).toBe(0);
  });

  it.each([
    { instanceId: "different-provider", text: "Edited prompt" },
    { instanceId: "codex", text: "/compact" },
  ])("drops automatic compaction when an edit changes its target: %j", async (edit) => {
    const { enqueueThreadOutboxTurn, webThreadOutbox, replaceThreadOutboxTurn } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn({ ...target(), compactBeforeSend: true });
    await webThreadOutbox.pause("message", true);
    const entry = webThreadOutbox.getSnapshot()[0]!;
    await replaceThreadOutboxTurn(entry, {
      ...entry.payload,
      compactAccepted: true,
      input: {
        ...entry.payload.input,
        modelSelection: {
          instanceId: ProviderInstanceId.make(edit.instanceId),
          model: "test-model",
        },
        message: { ...entry.payload.input.message, text: edit.text },
      },
    });
    expect(webThreadOutbox.getSnapshot()[0]?.payload.compactAccepted).toBeUndefined();
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.run.mock.calls[0]![2].input.message.text).toBe(edit.text);
    expect(harness.records.size).toBe(0);
  });

  it("persists an edited message with a new command ID before delivering it", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox, replaceThreadOutboxTurn } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    await webThreadOutbox.pause("message", true);
    const entry = webThreadOutbox.getSnapshot()[0]!;
    await replaceThreadOutboxTurn(entry, {
      ...entry.payload,
      input: {
        ...entry.payload.input,
        message: { ...entry.payload.input.message, text: "Edited in the composer" },
      },
    });
    expect(harness.records.get("message")?.payload.input).toMatchObject({
      commandId: "generated-command",
      message: { messageId: "message", text: "Edited in the composer" },
    });
    expect(harness.records.get("message")?.paused).toBe(false);
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "generated-command",
          message: expect.objectContaining({
            messageId: "message",
            text: "Edited in the composer",
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("applies saved thread settings before delivering a plan follow-up", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    const original = target();
    await enqueueThreadOutboxTurn({
      ...original,
      branch: "main",
      input: {
        ...original.input,
        sourceProposedPlan: { threadId: ThreadId.make("thread"), planId: PlanId.make("plan") },
      },
    });
    harness.existingThread = true;
    harness.online = true;
    await webThreadOutbox.drain();
    expect(harness.run.mock.calls.map((call) => call[1].label)).toEqual([
      "branch",
      "runtime",
      "interaction",
      "send",
    ]);
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          runtimeMode: "full-access",
          interactionMode: "default",
          sourceProposedPlan: { threadId: "thread", planId: "plan" },
        }),
      }),
      expect.anything(),
    );
  });

  it("sends a restored offline message with its original command and message IDs", async () => {
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    vi.resetModules();
    const recovered = (await import("./threadOutbox")).webThreadOutbox;
    harness.online = true;
    await recovered.drain();
    expect(harness.run).toHaveBeenCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          message: expect.objectContaining({ messageId: "message", text: "Saved prompt" }),
        }),
      }),
      expect.anything(),
    );
    expect(harness.records.size).toBe(0);
  });

  it("retains local image bytes across reload and prepares the legacy upload only at delivery", async () => {
    const { enqueueThreadOutboxTurn } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({
      ...target(),
      localAttachments: [
        {
          id: "local-image",
          type: "image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 5,
          bytes: new Blob(["image"], { type: "image/png" }),
        },
      ],
    });
    vi.resetModules();
    harness.online = true;
    await (await import("./threadOutbox")).webThreadOutbox.drain();
    expect(harness.run).toHaveBeenCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          message: expect.objectContaining({
            attachments: [
              expect.objectContaining({
                id: "local-image",
                dataUrl: "data:image/png;base64,aW1hZ2U=",
              }),
            ],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("persists an uploaded file reference before dispatch and reuses it after a transport failure", async () => {
    harness.supportsUploads = true;
    harness.online = true;
    const transfer = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transfer);
    harness.run.mockImplementation(async (_registry: unknown, operation: { label: string }) =>
      operation.label === "upload"
        ? AsyncResult.success({ attachmentId: "uploaded-file", relativeUrl: "/signed-upload" })
        : AsyncResult.fail({ _tag: "RpcClientError" }),
    );
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({
      ...target(),
      localAttachments: [
        {
          id: "local-file",
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          bytes: new Blob(["notes"]),
        },
      ],
    });
    await webThreadOutbox.drain();
    const saved = harness.records.get("message");
    expect(saved?.payload.localAttachments[0]?.uploaded?.id).toBe("uploaded-file");
    expect(transfer).toHaveBeenCalledWith(
      "https://environment.example/signed-upload",
      expect.objectContaining({ method: "POST", body: expect.any(Blob) }),
    );
    vi.resetModules();
    harness.run.mockResolvedValue(AsyncResult.success({ sequence: 1 }));
    // Reconnect after the retry backoff without using timers or polling.
    if (!saved) throw new Error("Expected the retained pending message");
    harness.records.set("message", { ...saved, retryAt: 0 });
    await (await import("./threadOutbox")).webThreadOutbox.drain();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(harness.verify).toHaveBeenCalled();
    expect(harness.run).toHaveBeenLastCalledWith(
      expect.anything(),
      { label: "send" },
      expect.objectContaining({
        input: expect.objectContaining({
          commandId: "stable-command",
          message: expect.objectContaining({
            attachments: [expect.objectContaining({ id: "uploaded-file", type: "file" })],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("retains an oversized attachment as a failed pending message", async () => {
    harness.supportsUploads = true;
    harness.online = true;
    const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
    await enqueueThreadOutboxTurn({
      ...target(),
      localAttachments: [
        {
          id: "file",
          type: "file",
          name: "large.txt",
          mimeType: "text/plain",
          sizeBytes: 1_001,
          bytes: new Blob(["content"]),
        },
      ],
    });
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.records.get("message")?.status).toBe("failed");
    expect(harness.records.get("message")?.payload.localAttachments[0]?.bytes).toBeInstanceOf(Blob);
  });

  it("clears only the removed environment's pending messages", async () => {
    const { enqueueThreadOutboxTurn, clearThreadOutboxEnvironment } =
      await import("./threadOutbox");
    await enqueueThreadOutboxTurn(target());
    const other = target();
    await enqueueThreadOutboxTurn({
      ...other,
      environmentId: EnvironmentId.make("other"),
      input: {
        ...other.input,
        message: { ...other.input.message, messageId: MessageId.make("other-message") },
      },
    });
    await clearThreadOutboxEnvironment(EnvironmentId.make("environment"));
    expect([...harness.records.keys()]).toEqual(["other-message"]);
  });

  it("recovers separate pending threads in the same project without mixing their messages", async () => {
    const { enqueueThreadOutboxTurns, webThreadOutbox } = await import("./threadOutbox");
    const base = target();
    const creation = {
      projectId: ProjectId.make("project"),
      title: "Offline task",
      modelSelection: base.input.modelSelection,
      runtimeMode: base.input.runtimeMode,
      interactionMode: base.input.interactionMode,
      branch: "main",
      worktreePath: null,
      createdAt: "2026-10-06T00:00:00Z",
    };
    await enqueueThreadOutboxTurns(
      ["first", "second"].map((id) => ({
        ...base,
        input: {
          ...base.input,
          threadId: ThreadId.make(id),
          commandId: CommandId.make(id),
          message: { ...base.input.message, messageId: MessageId.make(id), text: id },
          bootstrap: { createThread: { ...creation, title: id } },
        },
      })),
    );
    await webThreadOutbox.drain();
    expect(harness.run).not.toHaveBeenCalled();
    vi.resetModules();
    const recovered = await import("./threadOutbox");
    await recovered.webThreadOutbox.load();
    expect(recovered.webThreadOutbox.isLoaded()).toBe(true);
    const first = recovered.readPendingThreadCreation({
      environmentId: base.environmentId,
      threadId: ThreadId.make("first"),
    });
    const second = recovered.readPendingThreadCreation({
      environmentId: base.environmentId,
      threadId: ThreadId.make("second"),
    });
    expect(first?.payload.input.message.text).toBe("first");
    expect(second?.payload.input.message.text).toBe("second");
    expect(first?.scope).not.toBe(second?.scope);
  });

  it("returns the replacement pending thread when retrying a rejected creation without a draft", async () => {
    const { enqueueThreadOutboxTurn, replaceThreadOutboxTurn, webThreadOutbox } =
      await import("./threadOutbox");
    const original = target();
    await enqueueThreadOutboxTurn({
      ...original,
      input: {
        ...original.input,
        bootstrap: {
          createThread: {
            projectId: ProjectId.make("project"),
            title: "Task",
            modelSelection: original.input.modelSelection,
            runtimeMode: original.input.runtimeMode,
            interactionMode: original.input.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt: "2026-10-06T00:00:00Z",
          },
        },
      },
    });
    harness.online = true;
    harness.run.mockResolvedValueOnce(
      AsyncResult.fail({ _tag: "OrchestrationDispatchCommandError", message: "Rejected." }),
    );
    await webThreadOutbox.drain();
    const failed = webThreadOutbox.getSnapshot()[0]!;
    expect(failed.status).toBe("failed");
    harness.online = false;
    expect(await replaceThreadOutboxTurn(failed, failed.payload)).toEqual({
      environmentId: "environment",
      threadId: "replacement-thread",
    });
    expect(webThreadOutbox.getSnapshot()[0]).toMatchObject({
      scope: "environment:replacement-thread",
      status: "pending",
      attempted: false,
      payload: {
        input: { threadId: "replacement-thread", commandId: "generated-command" },
      },
    });
  });

  it.each(["arrived", "archived"])(
    "keeps an acknowledged creation until the server snapshot confirms it %s",
    async (state) => {
      const { enqueueThreadOutboxTurn, webThreadOutbox } = await import("./threadOutbox");
      const original = target();
      await enqueueThreadOutboxTurn({
        ...original,
        draftId: DraftId.make("draft"),
        input: {
          ...original.input,
          bootstrap: {
            createThread: {
              projectId: ProjectId.make("project"),
              title: "Task",
              modelSelection: original.input.modelSelection,
              runtimeMode: original.input.runtimeMode,
              interactionMode: original.input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: "2026-10-06T00:00:00Z",
            },
          },
        },
      });
      harness.online = true;
      await webThreadOutbox.drain();
      expect(harness.marked).toHaveBeenCalled();
      expect(harness.finalized).not.toHaveBeenCalled();
      expect(webThreadOutbox.getSnapshot()[0]?.status).toBe("delivered");
      const recovered = (await import("./pendingThreadCreation")).pendingThreadCreation(
        webThreadOutbox.getSnapshot()[0]!,
      );
      expect(recovered?.message.shell).toMatchObject({
        id: "thread",
        title: "Task",
        projectId: "project",
      });
      await webThreadOutbox.drain();
      expect(harness.run).toHaveBeenCalledTimes(1);
      harness.existingThread = state === "arrived";
      harness.archivedThread = state === "archived";
      await webThreadOutbox.drain();
      expect(webThreadOutbox.getSnapshot()).toEqual([]);
      expect(harness.run).toHaveBeenCalledTimes(1);
    },
  );
});
