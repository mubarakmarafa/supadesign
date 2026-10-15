# AUR packaging

This directory maintains the [`supaterm-bin`](https://aur.archlinux.org/packages/supaterm-bin) and
[`supaterm-nightly-bin`](https://aur.archlinux.org/packages/supaterm-nightly-bin) packages. Both
repackage the official x86_64 AppImage from GitHub Releases.

## Publishing

The release workflow calls `.github/workflows/publish-aur.yml` after publishing a GitHub release;
the workflow can also be run manually for a specific tag. It selects the stable or nightly
package, then updates its version and checksums, builds it, regenerates `.SRCINFO`, and pushes it
to the AUR.

To validate a release on Arch Linux:

```bash
sudo pacman -Syu --needed base-devel github-cli jq namcap
GH_TOKEN=$(gh auth token) RELEASE_TAG=v0.0.33 \
  packaging/aur/scripts/release.sh
```
