# Brief for the agent that installs dsh-superagent

Hand this whole file to an AI agent that has shell access to the Ubuntu
machine. It is written to be read top to bottom and followed.

---

You are configuring **dsh-superagent** on this Ubuntu machine, so that it
works on the GitHub repository `YQteam-hq/apicovenant`.

`dsh-superagent` is a proactive coding agent for one GitHub repository,
packaged as a bundle for DeepSeek Harness (DSH). It listens to GitHub,
evaluates requests under a Policy, turns the authorised ones into Tickets,
and executes each in its own agent session and directory, answering in the
original conversation with a pull request.

## The decisions, already made — do not change them

| Decision | Value |
| --- | --- |
| Sources | GitHub only. Do not set up Feishu. |
| Repository | `YQteam-hq/apicovenant` |
| Agent account (the one that writes and opens PRs) | `YQteam-Iris` |
| Who may ask for work | `YQteam-dyq` and `YQteam-Theodore` |
| Proactive work | `observe` only: record what it would have done, do not do it |
| Auto-merge | never. The agent must not merge its own pull requests. |
| Branch prefix for the agent's work | `agent/` |
| DSH profile | `superagent` |
| Panel port | `3082` |
| State directory | `~/.dsh/state/superagent` |
| Clone the agent works from | `~/src/apicovenant` |

## Secrets

Two things need a human's hands. **Do not ask for a secret in the chat and
do not accept one.** Put both in one message with the exact commands, and
let the human run them in their own terminal:

```sh
# 1. sign the agent's own GitHub CLI in, as YQteam-Iris (not as the operator)
~/.local/bin/gh-agent auth login
~/.local/bin/gh-agent api user --jq .login      # must print YQteam-Iris

# 2. give DeepSeek Harness a model provider
dsh --profile superagent
```

The API key is typed by the human, in their terminal, by the provider's own
prompt. It is never passed to you, never written into a file you create,
and never pasted into a chat.

## What to do

1. **Prerequisites.** `tmux`, `jq`, `git`, `python3`, `curl`, `build-essential`;
   Node 24.9 or later (the DSH host requires it); `pnpm`; the GitHub CLI 2.48 or
   later. Install with `apt`, and `gh` from `https://cli.github.com/packages`
   rather than from the Ubuntu archive, which is too old.

2. **The DSH host and the bundle.**

   ```sh
   sudo npm install -g @deepseek-ai/dsh@0.2.1-rc.3
   git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git ~/dsh-superagent
   cd ~/dsh-superagent && pnpm install && pnpm build
   dsh superagent --from-default-profile web --dump-config > /dev/null
   dsh plugin --profile superagent add "link:$HOME/dsh-superagent"
   ```

   Install `@deepseek-ai/dsh`. The package named `dsh` on npm is an unrelated
   JavaScript shell.

   `dsh superagent --from-default-profile` creates the profile. Run it only
   when the profile does not exist yet: on an existing profile it replaces it
   and deletes its `cordis.patch.yml`, machine configuration included.

3. **This repository's configuration.** Clone it and take the branch that
   holds the configuration:

   ```sh
   git clone -b feat/dsh-superagent https://github.com/YQteam-hq/apicovenant.git ~/src/apicovenant
   cd ~/src/apicovenant
   ```

   It carries `examples/superagent/`, which holds the machine configuration,
   the settings and the scripts. Read `docs/superagent.md` in that checkout
   for the full runbook.

4. **The machine configuration.** Copy
   `examples/superagent/profile.cordis.patch.yml` to
   `~/.dsh/profiles/superagent/cordis.patch.yml` and replace the
   placeholder paths: `/home/<you>` becomes the home directory, and
   `stateDir` must be an absolute path.

5. **Start the service, then write the settings.** The settings have to be
   written while the service answers, so start it first:

   ```sh
   cd ~/src/apicovenant
   DSH_SUPERAGENT_HOME=~/dsh-superagent node scripts/superagent.mjs start
   DSH_SUPERAGENT_HOME=~/dsh-superagent node scripts/superagent.mjs status
   DSH_SUPERAGENT_HOME=~/dsh-superagent node examples/superagent/apply-settings.mjs
   ```

   `apply-settings.mjs` reads the current settings from the panel's
   management API and merges into them, so a key the installed version
   defines and `settings.json` does not mention keeps its value. It prints
   what it changed and which block needs a restart. A save that comes back
   `restarting: true` restarts the agent: wait until `status` stops exiting
   1 before the next request.

6. **Verify.**

   ```sh
   DSH_SUPERAGENT_HOME=~/dsh-superagent node scripts/superagent.mjs status
   ```

   Exit 0 means the service runs normally. Exit 1 means it does not run, runs
   twice, does not answer, or the runtime reports an error - a restart may
   fix it. Exit 2 means a Source or a Policy sync reports an error. Exit 3
   means it runs but waits for setup, and `status` prints what setup needs.

   Then open the panel at `http://127.0.0.1:3082` and pick **Superagent**
   in the sidebar.

## How to try it

From an account on the allowed list, comment on an issue in
`YQteam-hq/apicovenant`:

```text
@YQteam-Iris add a summary line to the README
```

A Ticket appears on the overview within about a minute. The agent works in
its own worktree on an `agent/` branch and answers in that thread.

A mention added by editing an existing issue body does **not** arrive. Post
a new comment instead.

## If a save is refused

The response body names the setup problem. Fix it and continue:

- **the agent CLI is not signed in** - the human has to run
  `~/.local/bin/gh-agent auth login` themselves
- **the repository is not reachable from the machine** - check the network
  and that `gh-agent api repos/YQteam-hq/apicovenant` answers
- **`YQteam-Iris` has no write access** - a human has to invite it to the
  repository
- **no model provider** - the human has to configure one in their terminal

Do not ask the human for anything you can fix yourself.

## Report back

When it runs, say in under 300 words:

- the panel URL, and that the **Superagent** entry in the sidebar is where
  to look
- how to try it: comment `@YQteam-Iris <request>` on an issue
- the output of `scripts/dsh-superagent status`
- what is still missing, if anything

Three rules for the operator, from the upstream philosophy: start narrow,
tune for less noise, own what the agent says.
