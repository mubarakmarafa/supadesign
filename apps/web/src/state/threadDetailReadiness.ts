import { parseScopedThreadKey, scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { useComposerDraftStore } from "../composerDraftStore";
import { readPendingThreadCreation, webThreadOutbox } from "./threadOutbox";

export function createThreadDetailReadiness(
  threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>,
) {
  const family = Atom.family((key: string) => {
    const ref = parseScopedThreadKey(key)!;
    return Atom.make((get) => {
      if (get(threadShellAtom(ref)) !== null) return true;
      const readReady = () => {
        if (!webThreadOutbox.isLoaded()) return false;
        const pending = readPendingThreadCreation(ref);
        if (pending !== null) return pending.status === "delivered";
        return useComposerDraftStore.getState().getDraftSessionByRef(ref) === null;
      };
      const update = () => get.setSelf(readReady());
      get.addFinalizer(webThreadOutbox.subscribe(update));
      get.addFinalizer(useComposerDraftStore.subscribe(update));
      return readReady();
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`web-thread-detail-ready:${key}`));
  });

  return (ref: ScopedThreadRef) => family(scopedThreadKey(ref));
}
