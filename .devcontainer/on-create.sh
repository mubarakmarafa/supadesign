#!/usr/bin/env bash
set -euo pipefail

if ! command -v mise >/dev/null 2>&1; then
  curl -fsSL https://mise.run | sh
fi

export PATH="$HOME/.local/bin:$PATH"
sudo ln -sf "$(command -v mise)" /usr/local/bin/mise
mise install --locked
mise reshim

activation='eval "$(mise activate bash)"'
if ! grep -Fqx "$activation" "$HOME/.bashrc" 2>/dev/null; then
  printf '%s\n' "$activation" >> "$HOME/.bashrc"
fi

# First-run terminal notice, rendered by the devcontainers base image.
sudo mkdir -p /usr/local/etc/vscode-dev-containers
sudo tee /usr/local/etc/vscode-dev-containers/first-run-notice.txt >/dev/null <<'EOF'
Supaterm devcontainer

  vp run dev            start server + web, then open the pairing URL it
                        prints (the bare forwarded port will not authenticate)

Details: docs/internals/devcontainer.md
EOF
