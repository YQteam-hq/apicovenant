import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_VERSION = '1.0.2';

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = path.resolve(here, '..', 'package.json');
    const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: string };
    return parsed.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const VERSION = readVersion();
export const TOOL_NAME = 'apicovenant';
