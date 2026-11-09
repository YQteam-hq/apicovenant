#!/usr/bin/env node
/**
 * Write the dsh-superagent settings for this repository.
 *
 *   node examples/superagent/apply-settings.mjs
 *
 * The service exposes a management API on the panel's port. A save replaces
 * one whole block, so the script reads the current settings first and merges
 * into them: a key this installation defines and examples/superagent/
 * settings.json does not mention keeps its value.
 *
 * Environment:
 *   DSH_SUPERAGENT_PORT   panel port, default 3082
 *   DSH_SUPERAGENT_HOME   home directory used to resolve <you> in the paths
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DSH_SUPERAGENT_PORT ?? '3082';
const HOME = process.env.DSH_SUPERAGENT_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
const BASE = `http://127.0.0.1:${PORT}/orchestrator/api`;

function say(line = '') {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function call(method, route, body) {
  const response = await fetch(`${BASE}/${route}`, {
    method,
    headers: {
      'x-orchestrator-request': '1',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${method} ${route} -> ${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

function expand(value) {
  if (typeof value !== 'string') return value;
  return value.replaceAll('/home/<you>', HOME);
}

/** Find the key a form uses for something that matches the pattern. */
function fieldKey(form, pattern) {
  if (!Array.isArray(form)) return undefined;
  for (const field of form) {
    const name = field?.name ?? field?.key ?? field?.id;
    if (typeof name === 'string' && pattern.test(name)) return name;
  }
  return undefined;
}

function merge(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const base = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key], value)
      : expand(value);
  }
  return out;
}

async function main() {
  const wanted = JSON.parse(readFileSync(path.join(HERE, 'settings.json'), 'utf8'));

  let state;
  try {
    state = await call('GET', 'state');
  } catch (error) {
    fail(`the dsh-superagent service is not answering on ${BASE}: ${error.message}`);
    fail('start it first: scripts/dsh-superagent start');
    return;
  }
  say(`service answered on ${BASE}`);
  if (state?.setup) {
    say(`  setup problem: ${state.setup.code ?? ''} ${state.setup.detail ?? ''}`.trimEnd());
  }
  if (state?.paused === true) {
    say('  the service is paused; the agent takes no work until it is resumed');
  }

  const settings = await call('GET', 'settings');

  // ---------------------------------------------------------------- source
  const instances = settings.sources ?? [];
  const github = instances.find((entry) => entry.kind === 'github' || entry.id === 'github');
  if (!github) {
    fail('no GitHub source is installed in this profile');
    return;
  }
  const form = github.form;
  const repoKey = fieldKey(form, /repo/i) ?? 'repository';
  const cliKey = fieldKey(form, /cli/i) ?? 'agentCli';
  const sourceValue = merge(github.value ?? github.config ?? {}, {
    enabled: wanted.source.enabled,
    config: {
      [repoKey]: wanted.source.config.repository,
      [cliKey]: expand(wanted.source.config.agentCli),
      observeIssues: wanted.source.config.observeIssues,
      observePulls: wanted.source.config.observePulls,
      observeComments: wanted.source.config.observeComments,
      observeCi: wanted.source.config.observeCi,
    },
  });
  const sourceRevision = github.revision;
  let saved = await call('PUT', `settings/sources/${github.id}`, {
    value: sourceValue,
    revision: sourceRevision,
  });
  say(`source ${github.id}: repository=${wanted.source.config.repository}, cli=${expand(wanted.source.config.agentCli)} (revision ${saved.revision ?? sourceRevision})`);
  say(`  observing: issues=${wanted.source.config.observeIssues} pulls=${wanted.source.config.observePulls} comments=${wanted.source.config.observeComments} ci=${wanted.source.config.observeCi}`);

  // ---------------------------------------------------------------- policy
  const policyBlock = settings.blocks?.policy;
  if (!policyBlock) {
    fail('the policy block is not exposed by this version');
    return;
  }
  const policyValue = merge(policyBlock.value ?? {}, {
    rules: wanted.policy.rules,
    sources: {
      [github.id]: merge(policyBlock.value?.sources?.[github.id] ?? {}, wanted.policy.sources.github),
    },
  });
  saved = await call('PUT', 'settings/policy', { value: policyValue, revision: policyBlock.revision });
  say(`policy: rules = ${wanted.policy.rules.map((rule) => rule.id).join(', ')} (revision ${saved.revision ?? policyBlock.revision})`);
  say(`  allowed = ${wanted.policy.sources.github.allowed.map((entry) => entry.id).join(', ')}`);

  // ------------------------------------------------------------------ eval
  const evalBlock = settings.blocks?.eval;
  if (evalBlock) {
    const evalValue = merge(evalBlock.value ?? {}, wanted.eval);
    saved = await call('PUT', 'settings/eval', { value: evalValue, revision: evalBlock.revision });
    say(`eval: mode=${wanted.eval.mode}, timeout=${wanted.eval.timeoutSeconds}s (revision ${saved.revision ?? evalBlock.revision})`);
  } else {
    fail('the eval block is not exposed by this version - set the accept mode to "auto" by hand');
  }

  // -------------------------------------------------------------- executor
  const executorBlock = settings.blocks?.executor;
  if (executorBlock) {
    const executorValue = merge(executorBlock.value ?? {}, wanted.executor);
    saved = await call('PUT', 'settings/executor', { value: executorValue, revision: executorBlock.revision });
    say(`executor: directory=${expand(wanted.executor.directory)} (revision ${saved.revision ?? executorBlock.revision})`);
  } else {
    fail('the executor block is not exposed by this version - set the directory and prepare command by hand');
  }

  // --------------------------------------------------------------- prompts
  try {
    const promptState = await call('GET', 'prompts');
    const current = promptState.current ?? promptState;
    const baseRevision = current.revision ?? promptState.revision;
    const config = current.config ?? {};
    const promptValue = {
      ...config,
      communication: wanted.prompts.communication,
      scope: wanted.prompts.scope,
      delivery: wanted.prompts.delivery,
      skills: merge(config.skills ?? {}, wanted.prompts.skills ?? {}),
    };
    saved = await call('PUT', 'prompts', { config: promptValue, baseRevision });
    say(`prompts: communication, scope, delivery and ${Object.keys(wanted.prompts.skills ?? {}).length} team skill(s) (revision ${saved.revision ?? baseRevision})`);
  } catch (error) {
    fail(`the team sections were not written: ${error.message}`);
    fail('set them by hand on the panel: Communication, Ticket scope, Delivery requirements');
  }

  say('');
  say('done. run: scripts/dsh-superagent status');
}

main().catch((error) => {
  fail(error.message);
});
