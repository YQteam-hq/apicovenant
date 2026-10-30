import { readTextFile, writeTextFile } from './util/fs.ts';
import type { Finding } from './lint/types.ts';

export const BASELINE_FORMAT_VERSION = 1;

export interface BaselineEntry {
  ruleId: string;
  path: string;
  message: string;
}

export interface BaselineFile {
  apicovenant: number;
  createdAt: string;
  updatedAt: string;
  findings: BaselineEntry[];
}


export function findingFingerprint(finding: { ruleId: string; path: string; message: string }): string {
  return `${finding.ruleId}|${finding.path}|${finding.message}`;
}


export function buildBaseline(findings: Finding[], createdAt?: string): BaselineFile {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const entries: BaselineEntry[] = [];

  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    entries.push({ ruleId: finding.ruleId, path: finding.path, message: finding.message });
  }

  entries.sort((a, b) =>
    a.ruleId === b.ruleId
      ? a.path === b.path
        ? a.message.localeCompare(b.message)
        : a.path.localeCompare(b.path)
      : a.ruleId.localeCompare(b.ruleId),
  );

  return {
    apicovenant: BASELINE_FORMAT_VERSION,
    createdAt: createdAt ?? now,
    updatedAt: now,
    findings: entries,
  };
}


export function parseBaseline(text: string, filePath = '<baseline>'): BaselineFile {
  let parsed: unknown;
  try {

    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON (${(error as Error).message})`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath}: a baseline must be a JSON object`);
  }

  const file = parsed as Partial<BaselineFile>;
  if (file.apicovenant !== BASELINE_FORMAT_VERSION) {
    throw new Error(
      `${filePath}: unsupported baseline format ${String(file.apicovenant)} (expected ${BASELINE_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(file.findings)) {
    throw new Error(`${filePath}: a baseline must contain a "findings" array`);
  }

  return {
    apicovenant: BASELINE_FORMAT_VERSION,
    createdAt: typeof file.createdAt === 'string' ? file.createdAt : new Date().toISOString(),
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : new Date().toISOString(),
    findings: file.findings.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error(`${filePath}: findings[${index}] must be an object`);
      }
      return {
        ruleId: String(entry.ruleId ?? ''),
        path: String(entry.path ?? ''),
        message: String(entry.message ?? ''),
      };
    }),
  };
}


export async function loadBaseline(filePath: string): Promise<BaselineFile> {
  let text: string;
  try {
    text = await readTextFile(filePath);
  } catch {
    return { apicovenant: BASELINE_FORMAT_VERSION, createdAt: '', updatedAt: '', findings: [] };
  }
  return parseBaseline(text, filePath);
}


export async function saveBaseline(filePath: string, baseline: BaselineFile): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

export interface BaselineResult {

  fresh: Finding[];

  suppressed: Finding[];
}


export function applyBaseline(findings: Finding[], baseline: BaselineFile): BaselineResult {
  const known = new Set(baseline.findings.map(findingFingerprint));
  const fresh: Finding[] = [];
  const suppressed: Finding[] = [];

  for (const finding of findings) {
    if (known.has(findingFingerprint(finding))) suppressed.push(finding);
    else fresh.push(finding);
  }

  return { fresh, suppressed };
}
