#!/usr/bin/env bash
# Installs or updates Supadesign from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/mubarakmarafa/supadesign/main/scripts/install-supadesign.sh | bash
set -euo pipefail

repo="mubarakmarafa/supadesign"
app_name="Supadesign"
target="/Applications/${app_name}.app"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Supadesign builds are for Apple Silicon Macs only." >&2
  exit 1
fi

work="$(mktemp -d)"
mount_point="${work}/mount"
cleanup() {
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "Finding the latest release..."
# Follow the releases/latest redirect instead of asking the GitHub API, which
# allows only 60 anonymous requests an hour per network and then fails.
latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${repo}/releases/latest")"
tag="${latest_url##*/tag/}"
if [[ -z "$tag" || "$tag" == "$latest_url" ]]; then
  echo "Couldn't find the latest release." >&2
  exit 1
fi
dmg_url="https://github.com/${repo}/releases/download/${tag}/supadesign-${tag#v}-arm64.dmg"

echo "Downloading ${tag}..."
curl -fL --progress-bar -o "${work}/${app_name}.dmg" "$dmg_url"

is_running() {
  [[ "$(osascript -e "application \"${app_name}\" is running")" == "true" ]]
}

was_running=false
if is_running; then
  was_running=true
  echo "Quitting ${app_name}..."
  osascript -e "quit app \"${app_name}\"" || true
  for _ in $(seq 1 30); do
    is_running || break
    sleep 1
  done
fi

echo "Installing to ${target}..."
mkdir -p "$mount_point"
hdiutil attach "${work}/${app_name}.dmg" -nobrowse -readonly -mountpoint "$mount_point" -quiet
rm -rf "$target"
ditto "${mount_point}/${app_name}.app" "$target"
# The build is unsigned, so Gatekeeper would otherwise block the first launch.
xattr -dr com.apple.quarantine "$target" 2>/dev/null || true

echo "Installed ${app_name} ${tag}."
if [[ "$was_running" == true ]]; then
  open "$target"
fi
