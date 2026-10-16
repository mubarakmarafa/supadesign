import { createEnvironmentProjectAtoms } from "@supaterm/client-runtime/state/projects";
import { createProjectEnvironmentAtoms } from "@supaterm/client-runtime/state/projects";
import { createEnvironmentRpcQueryAtomFamily } from "@supaterm/client-runtime/state/runtime";
import { WS_METHODS } from "@supaterm/contracts";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";
import { serverEnvironment } from "./server";

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});
export const projectEnvironment = createProjectEnvironmentAtoms(connectionAtomRuntime, {
  projectAtom: environmentProjects.projectAtom,
  projectsAtom: environmentProjects.projectsAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});
export const projectContentSearch = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:projects:search-contents",
  tag: WS_METHODS.projectsSearchContents,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});
