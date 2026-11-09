# dsh-superagent for this repository

`dsh-superagent` is a proactive coding agent for **one** GitHub repository,
packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/).
It listens to GitHub, evaluates requests under a Policy, turns the authorised
ones into Tickets, and executes each in its own DSH Session and directory -
answering in the original conversation with a pull request.

This file is the runbook for running it against `YQteam-hq/apicovenant`. The
machine it runs on is not prepared yet; everything that can be written down
in advance is, and the two files under `examples/superagent/` hold the
configuration.

> The upstream project calls itself a research prototype: *"Review and adapt
> it before using it in your own environment."* Read
> [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
> before widening who may ask it for work.

---

## 快速开始（中文）

1. 在一台 **Linux** 机器上装好 `tmux` / `pnpm` / `gh` 2.48+ / Node 24.9+
2. `npm install -g @deepseek-ai/dsh@0.2.1-rc.3`，再把 bundle 装进 `superagent` profile
3. 用 **YQteam-Iris** 登录一份独立的 `gh-agent`，并把它加进本仓库（写权限）
4. 复制 `examples/superagent/profile.cordis.patch.yml` 到
   `~/.dsh/profiles/superagent/cordis.patch.yml`，改掉里面的占位路径
5. 跑 `node examples/superagent/apply-settings.mjs`，把下面的设置写进去
6. `scripts/dsh-superagent start`，面板在 <http://127.0.0.1:3082>

派活方式：在本仓库任意 issue 下评论 `@YQteam-Iris <要做的事>`。

---

## The decisions

Taken from the setup flow in the upstream
[SETUP.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/SETUP.md),
with the recommended defaults wherever a default existed.

| Decision | Value | Why |
| --- | --- | --- |
| Sources | GitHub only | The team works on GitHub; a Feishu source would add a bot app and a second CLI for no gain today. |
| Repository | `YQteam-hq/apicovenant` | This repository. |
| Agent account | `YQteam-Iris` | A dedicated account, so everything the agent writes is visibly its own. It must be a **user** account: the agent reads the account's notifications, so a GitHub App cannot be the agent. |
| Who may ask for work | `YQteam-dyq`, `YQteam-Theodore` | Start narrow. The upstream guidance is to widen the list only once what the agent would have done looks right. |
| Accept mode | `observe` | Proactive work is recorded but not carried out, so the first weeks cannot produce unwanted pull requests. |
| Auto-merge | off | People merge. The agent never enables auto-merge as its own account. |
| Branch prefix | `agent/` | The branch each Ticket's work lands on. |
| Profile | `superagent` | A copy of the Web profile, so a restart does not close the Sessions in the profile we work in. |
| Port | `3082` | The panel. |
| State directory | `~/.dsh/state/superagent` | The database, the lock, the command shims and the Ticket directories. Back it up before upgrades. |
| Checkout | a clone under `~/src/apicovenant` | One clone per repository; each Ticket gets a worktree from it. |

---

## Prerequisites

The agent service is a long-running process supervised by `tmux`, and `tmux`
does not exist on Windows. The whole thing therefore runs on Linux - a server,
a workstation, or a WSL distribution that stays alive.

- Node.js 24.9 or later (`@deepseek-ai/dsh` requires it)
- `pnpm`, `git` 2.32 or later, Python 3.8 or later, `tmux`
- GitHub CLI (`gh`) 2.48 or later. The Source's CLI field must point at a
  `gh` wrapper; the host relies on its subcommands and output formats.
- `git-lfs` if the repository uses Git LFS. This one does not.
- A model provider configured for DeepSeek Harness. The agent uses the
  profile's default model unless the Eval or Execution settings name another.

Check them with:

```sh
node -v; pnpm -v; git --version; tmux -V; python3 --version; gh --version | head -1; dsh --version
```

---

## Operator steps

These need the repository owner's own hands.

1. **The agent account.** `YQteam-Iris` needs write access to this
   repository. Invite it as a collaborator.
2. **Its own GitHub CLI.** The agent must never use the operator's
   credentials, so it gets a wrapper with a separate configuration
   directory:

   ```sh
   mkdir -p ~/.local/bin
   cat > ~/.local/bin/gh-agent <<'EOF'
   #!/bin/sh
   GH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"
   EOF
   chmod +x ~/.local/bin/gh-agent
   gh-agent auth login
   gh-agent api user --jq .login    # must print YQteam-Iris
   ```

3. **A model provider** for DeepSeek Harness. Run DSH once and configure
   the provider it should use.
4. **A clone to work from**, which the Executor turns into per-Ticket
   worktrees:

   ```sh
   git clone https://github.com/YQteam-hq/apicovenant.git ~/src/apicovenant
   ```

Nothing above asks for a secret in a chat. `gh-agent auth login` and the
model provider are both done in a terminal.

---

## Install

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git dsh-superagent
cd dsh-superagent && pnpm install && pnpm build
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
```

`dsh superagent --from-default-profile` creates the profile. Run it **only**
for a new installation: on an existing profile it replaces the profile and
deletes its `cordis.patch.yml`, machine configuration included. Upgrades
edit that file instead.

> Install `@deepseek-ai/dsh`, not the package named `dsh` on npm - that one
> is an unrelated JavaScript shell.

---

## Machine configuration

Copy `examples/superagent/profile.cordis.patch.yml` to
`~/.dsh/profiles/superagent/cordis.patch.yml` and replace the placeholder
paths.

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082
- id: dsh-superagent
  config:
    stateDir: /home/<you>/.dsh/state/superagent
```

`stateDir` must be an absolute path. It holds the database, the lock, the
command shims in `worker-bin`, the agent's git configuration and, by
default, the Ticket directories. Invalid values or unknown keys stop the
service, and the log names the key.

---

## Settings

Four blocks decide what the agent does. They are saved through the
Management API of the panel, which runs on `127.0.0.1:<port>`:

| Block | What it holds for this repository |
| --- | --- |
| `sources` | The GitHub source: repository `YQteam-hq/apicovenant`, agent CLI `~/.local/bin/gh-agent`. |
| `policy` | The allowed senders: `YQteam-dyq` and `YQteam-Theodore`. Until a list has someone, no request can become a Ticket. |
| `executor` | The directory root (`~/src/apicovenant`) and the prepare command that gives each Ticket a worktree. |
| prompts | The team sections: the GitHub disclosure line, the commit author and the auto-merge condition. |

`examples/superagent/apply-settings.mjs` writes them. It reads the current
settings first and merges into them, so the block keeps every key the
installed version defines:

```sh
node examples/superagent/apply-settings.mjs
```

The script refuses to write when the service is not answering, prints what
it changed, and says which block needs a restart.

The prepare command it writes is:

```sh
git -C ~/src/apicovenant fetch --no-tags "https://github.com/$DSH_SUPERAGENT_GITHUB_REPOSITORY.git" "${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/$DSH_SUPERAGENT_TICKET" &&
git -C ~/src/apicovenant worktree add -b "agent/$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_DIR" "refs/dsh-superagent/$DSH_SUPERAGENT_TICKET"
```

---

## Start, status, stop

```sh
scripts/dsh-superagent start
scripts/dsh-superagent status
```

`start` runs `dsh --profile superagent` in the tmux session `dsh-superagent`
and waits up to a minute for the runtime to report a setup requirement.
`status` exits `0` when the service runs, `1` when it does not, `2` when a
Source or a Policy sync reports an error, and `3` when it runs but waits for
setup. `stop` and `restart` ask for a graceful shutdown and never touch
another tmux session.

The panel is at <http://127.0.0.1:3082>; the **Superagent** entry in its
sidebar is the one to look at.

### An hourly check

Create it in the profile you normally use, not in `superagent`, so it keeps
running while the agent service is down. The prompt is in
[006 Deployment](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md#hourly-check).

---

## Trying it

From an account on the allowed list, comment on an issue in this repository:

```text
@YQteam-Iris add a summary line to the README
```

A Ticket appears on the panel within about a minute. The agent works in its
own worktree on an `agent/` branch and answers in that thread, usually with
a pull request.

A mention added by editing an existing issue body does **not** arrive -
post a new comment instead.

---

## When a request does not arrive

The agent reads the notifications of its own account, and it polls them once a
minute. A request therefore arrives only when all of these hold at the same
time: the service runs, the sender is on the allowed list, the Source is on,
processing is not paused, and the request is a **new comment** that mentions
the agent account. Check them in this order.

1. **The service runs.**

   ```sh
   scripts/dsh-superagent status
   ```

   Exit 0 means it runs. Exit 1 means it does not run, runs twice, does not
   answer, or the runtime reports an error - the output names the reason.
   Exit 2 means a Source or a Policy sync reports an error, and `errors` names
   each part. Exit 3 means setup waits, and `setup` says what is missing.

2. **The agent CLI reads its own account.**

   ```sh
   ~/.local/bin/gh-agent api user --jq .login    # must print YQteam-Iris
   ```

   The wrapper must be signed in, and it must never read the operator's
   account. A wrapper that is not signed in makes the Source sync fail, and
   the symptom is that no request is ever seen.

3. **The sender is on the allowed list.** The panel shows it on the Policy
   card: `policy.sources.github.allowed` holds GitHub accounts as
   `[{"id": "<login>"}]`, and it must contain `YQteam-dyq` and
   `YQteam-Theodore`. A request from anyone else is dropped silently.

4. **The request was a new comment.** Editing an issue body to add a mention
   is not received. Post a new comment that mentions `YQteam-Iris`.

5. **Processing is not paused.** The panel shows it; `POST executor/pause`
   sets it, and the settings page clears it.

6. **The log explains the rest.**

   ```sh
   ls -t ~/dsh-superagent/.artifacts/*.log ~/.dsh/profiles/superagent/.artifacts/*.log 2>/dev/null | head -3
   ```

   Each profile keeps its logs under `.artifacts/`, named
   `dsh-superagent-<profile>-<date>-<time>-<pid>.log`. The troubleshooting
   table in the upstream
   [006 Deployment](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md#troubleshooting)
   maps every message to its fix.

A request that is refused is not lost: the panel lists it, and the overview
links to the setting that would let it through.

---

## Stopping it

```sh
scripts/dsh-superagent stop
```

That pauses automatic recovery as well. The hourly check reports
`manually_stopped` and leaves it stopped.

To remove the agent for good: stop the service, remove the `superagent`
profile directory, and drop the `YQteam-Iris` collaborator from the
repository. Nothing it wrote lives in this repository except the pull
requests it opened.

---

## What it can and cannot do

- It writes **under `YQteam-Iris`**. Every comment and pull request carries
  that name, not the operator's.
- It acts **only for `YQteam-dyq` and `YQteam-Theodore`**, until the allowed
  list is widened on purpose.
- In `observe` mode it records the proactive work it would have done and
  does not do it.
- It never merges its own pull requests.
- It runs with the operator's credentials removed: the environment setup
  drops `GH_TOKEN` and `GITHUB_TOKEN`, and the worker's git configuration
  uses only the agent's credentials for github.com.
