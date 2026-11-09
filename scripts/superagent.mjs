#!/usr/bin/env node
/**
 * Forward to the dsh-superagent bundle that runs this repository.
 *
 *   node scripts/superagent.mjs start
 *   node scripts/superagent.mjs status
 *   node scripts/superagent.mjs stop
 *   node scripts/superagent.mjs restart
 *
 * The bundle lives outside this repository - it is DeepSeek's code, not
 * ours. DSH_SUPERAGENT_HOME says where it was cloned; the default is
 * ~/dsh-superagent.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = process.env.DSH_SUPERAGENT_HOME ?? path.join(os.homedir(), 'dsh-superagent');
const script = path.join(home, 'scripts', 'dsh-superagent');

if (!existsSync(script)) {
  process.stderr.write(
    `the dsh-superagent bundle is not at ${home}\n` +
      'clone it and point DSH_SUPERAGENT_HOME at the checkout:\n' +
      '  git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git dsh-superagent\n',
  );
  process.exit(1);
}

const child = spawn(script, process.argv.slice(2), { stdio: 'inherit' });
child.on('exit', (code) => {
  process.exit(code ?? 0);
});
