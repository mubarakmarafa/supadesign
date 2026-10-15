import { createEnvironmentProjectAtoms } from "@supaterm/client-runtime/state/projects";
import { createProjectEnvironmentAtoms } from "@supaterm/client-runtime/state/projects";

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
