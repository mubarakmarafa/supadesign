# Dev container

> For maintainers. Using Supaterm? See [docs/user](../user/).

`.devcontainer/` gives you a ready-to-code Linux environment matching CI: Ubuntu 24.04, Mise-managed Node, pnpm, `vp`, Rust stable, and the GitHub CLI. Open the repo in VS Code and "Reopen in Container", or create a GitHub Codespace. Mise installation, dependency install, the Electron exec-bit repair, and the Vite dep-cache warmup all run automatically before you attach.

## What works in the container

- The full dev stack: `mise exec -- vp run dev`, then open the pairing URL it prints through the forwarded web port (5733). The bare origin is useless without the pairing token. In VS Code the forwarded port is a true localhost, so the printed URL works as-is; in browser Codespaces the forwarded origin differs, and if the server rejects it, pass the forwarded origin via `SUPATERM_DEV_ALLOWED_ORIGINS`.
- Everything the Linux CI jobs run: focused `mise exec -- vp test run <files>`, `mise exec -- vp lint <files>`, package typechecks, `mise exec -- vp run build:desktop`, and the resource-monitor cargo build and tests. Use `mise exec -- vpr` for the Vite+ package runner.

## State and safety

`SUPATERM_HOME` points at the workspace's gitignored `.supaterm`, so all runtime state stays inside the container workspace, mirroring the worktree default. There is no live install to damage inside a container, but the test-data rule from AGENTS.md still holds: copy data in, never point at shared state.

## Caching

Two named volumes keep rebuilds fast and installs off the slow macOS/Windows bind mount: the pnpm store (shared across checkouts, mounted where `mise exec -- vp i` keeps it) and root `node_modules` (per-container, which covers the whole `.pnpm` virtual store since workspace packages just symlink into it). Deleting a container and recreating it reuses both, so a rebuild's `mise exec -- vp i` is seconds, not minutes. The host sees an empty `node_modules`; run host-side tooling inside the container.

## Out of scope

- Windowed Electron development is host-only. Building and verifying the desktop bundle works fine in the container (CI does exactly that, headless); launching the app needs a display.
- Mobile native builds are host-only (Xcode for iOS, Android SDK for Android). Typecheck, lint, and the mobile static checks run fine.
- `mise exec -- vp run dev --share` needs a tailscale binary and a tailnet; not provisioned here.

## Prebuilds

Container creation from scratch does a full `mise exec -- vp i` plus toolchain installs, which is worth prebuilding. Codespaces prebuilds are configured in repo settings, not files, and pick this config up as-is: the heavy steps live in `onCreateCommand` and `updateContentCommand`, which prebuilds bake in. Restrict prebuilds to one region and one retained version; storage bills per region per version. Note that prebuild snapshots exclude the caching volumes, so a prebuild-first workflow may prefer dropping the mounts. Outside Codespaces, the Dev Container CLI can push a prebuilt image:

```bash
devcontainer build --workspace-folder . --push true --image-name <registry>/supaterm-devcontainer:latest
```
