export interface JunitCase {
  name: string;
  classname: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  message?: string;
  details?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * JUnit XML as consumed by Jenkins, GitLab, GitHub and most test reporters.
 * A skipped case becomes <skipped/>, a failed one carries the first violation
 * in message= and the full list in the element body.
 */
export function renderJunit(suiteName: string, cases: JunitCase[]): string {
  const failures = cases.filter((entry) => entry.status === 'fail').length;
  const skipped = cases.filter((entry) => entry.status === 'skip').length;
  const time = (cases.reduce((total, entry) => total + entry.durationMs, 0) / 1000).toFixed(3);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${time}">`,
  );
  lines.push(
    `  <testsuite name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${time}">`,
  );

  for (const entry of cases) {
    lines.push(
      `    <testcase classname="${escapeXml(entry.classname)}" name="${escapeXml(entry.name)}" time="${(entry.durationMs / 1000).toFixed(3)}">`,
    );
    if (entry.status === 'fail') {
      const message = entry.message ?? 'contract test failed';
      lines.push(`      <failure message="${escapeXml(message)}">${escapeXml(entry.details ?? message)}</failure>`);
    } else if (entry.status === 'skip') {
      lines.push(`      <skipped message="${escapeXml(entry.message ?? 'skipped')}"/>`);
    }
    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}
