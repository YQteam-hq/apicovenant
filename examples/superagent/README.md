# dsh-superagent configuration for this repository

Everything here is for the agent that runs against `YQteam-hq/apicovenant`.
The runbook is [docs/superagent.md](../../docs/superagent.md); these files are
the configuration it refers to.

| File | What it is |
| --- | --- |
| `profile.cordis.patch.yml` | The machine configuration. Copy it to `~/.dsh/profiles/superagent/cordis.patch.yml` and replace the placeholder paths. |
| `settings.json` | The settings the agent should run with. `apply-settings.mjs` merges these into the blocks the installed version holds. |
| `apply-settings.mjs` | Writes the settings through the panel's management API. |

```sh
node examples/superagent/apply-settings.mjs
node scripts/superagent.mjs start
```

The agent takes work from a comment that mentions it on an issue in this
repository, and answers there with a pull request. Only `YQteam-dyq` may ask
for work, and the agent writes as `YQteam-Iris`.
