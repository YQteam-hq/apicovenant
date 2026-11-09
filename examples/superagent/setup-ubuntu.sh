#!/usr/bin/env bash
#
# Set up dsh-superagent for YQteam-hq/apicovenant on this Ubuntu machine.
#
#   bash setup-ubuntu.sh
#
# The script does everything it can and stops where your own hands are
# needed: signing the agent's GitHub CLI in, and giving DeepSeek Harness a
# model provider. No secret is ever passed to it, and none is written into
# it.
#
# Phases:
#   1  prerequisites
#   2  the dsh-superagent bundle and the DSH profile
#   3  YOURS: sign in the agent CLI, configure a model provider
#   4  machine configuration, the clone, the settings, the service
#
set -euo pipefail

DSH_VERSION="${DSH_VERSION:-0.2.1-rc.3}"
REPO="https://github.com/YQteam-hq/apicovenant.git"
BUNDLE="https://github.com/deepseek-ai/dsh-superagent-prototype.git"
BRANCH="${DSH_SUPERAGENT_BRANCH:-feat/dsh-superagent}"
STATE_DIR="${HOME}/.dsh/state/superagent"
CLONE_DIR="${HOME}/src/apicovenant"
BUNDLE_DIR="${HOME}/dsh-superagent"
PORT="${DSH_SUPERAGENT_PORT:-3082}"
PROFILE="superagent"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- phase 1

say "1/4  prerequisites"

missing=()
for tool in tmux jq git python3 node npm; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [ ${#missing[@]} -gt 0 ]; then
  note "installing: ${missing[*]}"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends tmux jq git python3 ca-certificates curl build-essential
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 24 ]; then
  note "node $(node -v) is too old, installing Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
note "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  note "installing pnpm"
  corepack enable 2>/dev/null || true
  corepack prepare pnpm@latest --activate 2>/dev/null || sudo npm install -g pnpm
fi
note "pnpm $(pnpm -v)"

gh_version="$(gh --version 2>/dev/null | head -1 | awk '{print $3}' || echo 0)"
gh_major="${gh_version%%.*}"
gh_minor="$(printf '%s' "$gh_version" | cut -d. -f2)"
if [ "${gh_major:-0}" -lt 2 ] || { [ "${gh_major:-0}" -eq 2 ] && [ "${gh_minor:-0}" -lt 48 ]; }; then
  note "installing the GitHub CLI from cli.github.com"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi
note "gh $(gh --version | head -1)"

if ! command -v dsh >/dev/null 2>&1; then
  note "installing DeepSeek Harness ${DSH_VERSION}"
  sudo npm install -g "@deepseek-ai/dsh@${DSH_VERSION}"
fi
note "dsh $(dsh --version 2>/dev/null | head -1)"

# ---------------------------------------------------------------- phase 2

say "2/4  the dsh-superagent bundle"

if [ ! -d "$BUNDLE_DIR/.git" ]; then
  git clone "$BUNDLE" "$BUNDLE_DIR"
fi
cd "$BUNDLE_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

if [ ! -d "${HOME}/.dsh/profiles/${PROFILE}" ]; then
  note "creating the ${PROFILE} profile"
  dsh superagent --from-default-profile web --dump-config > /dev/null
  dsh plugin --profile "$PROFILE" add "link:${BUNDLE_DIR}"
else
  note "the ${PROFILE} profile exists, keeping its cordis.patch.yml"
  dsh plugin --profile "$PROFILE" add "link:${BUNDLE_DIR}" 2>/dev/null || true
fi

# ---------------------------------------------------------------- phase 3

say "3/4  the parts only you can do"

if [ ! -x "${HOME}/.local/bin/gh-agent" ]; then
  note "creating the agent's own GitHub CLI wrapper"
  mkdir -p "${HOME}/.local/bin"
  cat > "${HOME}/.local/bin/gh-agent" <<'WRAPPER'
#!/bin/sh
GH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"
WRAPPER
  chmod +x "${HOME}/.local/bin/gh-agent"
fi

if ! "${HOME}/.local/bin/gh-agent" api user --jq .login >/dev/null 2>&1; then
  cat <<'STEPS'

   Run this in your terminal, and sign in as the AGENT account
   (YQteam-Iris) - not as yourself:

     ~/.local/bin/gh-agent auth login
     ~/.local/bin/gh-agent api user --jq .login      # must print YQteam-Iris

   Then give DeepSeek Harness a model provider. Run the host once and
   follow its prompt:

     dsh --profile superagent

   The API key is entered by you, in your terminal. It is never given to
   this script, to the agent, or to anyone else.

STEPS
  die "phase 3 is not done yet - finish the two steps above and run this script again"
fi

note "agent CLI is signed in as $("${HOME}/.local/bin/gh-agent" api user --jq .login)"

# ---------------------------------------------------------------- phase 4

say "4/4  configuration, settings and the service"

mkdir -p "${HOME}/.dsh/profiles/${PROFILE}" "$(dirname "$STATE_DIR")"
if [ ! -f "${HOME}/.dsh/profiles/${PROFILE}/cordis.patch.yml" ]; then
  note "writing the machine configuration"
fi

if [ ! -d "$CLONE_DIR/.git" ]; then
  mkdir -p "$(dirname "$CLONE_DIR")"
  git clone "$REPO" "$CLONE_DIR"
fi
cd "$CLONE_DIR"
git fetch --quiet origin
if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  git checkout -B "$BRANCH" "origin/$BRANCH"
else
  git checkout main
  git pull --quiet --ff-only origin main
fi

if [ ! -f "${HOME}/.dsh/profiles/${PROFILE}/cordis.patch.yml" ] \
   || ! grep -q 'stateDir' "${HOME}/.dsh/profiles/${PROFILE}/cordis.patch.yml" 2>/dev/null; then
  sed -e "s|/home/<you>|${HOME}|g" -e "s|port: 3082|port: ${PORT}|" \
    examples/superagent/profile.cordis.patch.yml \
    > "${HOME}/.dsh/profiles/${PROFILE}/cordis.patch.yml"
  note "wrote ${HOME}/.dsh/profiles/${PROFILE}/cordis.patch.yml"
fi

DSH_SUPERAGENT_HOME="$BUNDLE_DIR" node scripts/superagent.mjs start || true
sleep 5
DSH_SUPERAGENT_HOME="$BUNDLE_DIR" node scripts/superagent.mjs status || true

DSH_SUPERAGENT_HOME="$BUNDLE_DIR" node examples/superagent/apply-settings.mjs || true

DSH_SUPERAGENT_HOME="$BUNDLE_DIR" node scripts/superagent.mjs status || true

cat <<'DONE'

   The panel is at http://127.0.0.1:3082 - open it and pick Superagent
   in the sidebar.

   Try it: on any issue in YQteam-hq/apicovenant, comment

     @YQteam-Iris add a summary line to the README

   and a Ticket appears on the overview within about a minute.

DONE
