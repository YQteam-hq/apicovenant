/** A compact unified diff: enough to review a migration or a fix before writing it. */
export function unifiedDiff(before: string, after: string, from: string, to: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const lines = [`--- ${from}`, `+++ ${to}`];

  // Longest common subsequence table, bounded so that a large file cannot turn
  // a dry run into a memory problem.
  const limit = 800;
  const rows = Math.min(oldLines.length, limit);
  const columns = Math.min(newLines.length, limit);
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i] as number[];
    const next = table[i + 1] as number[];
    for (let j = columns - 1; j >= 0; j -= 1) {
      row[j] =
        oldLines[i] === newLines[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      lines.push(`  ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (((table[i + 1] as number[])[j] ?? 0) >= ((table[i] as number[])[j + 1] ?? 0)) {
      lines.push(`- ${oldLines[i]}`);
      i += 1;
    } else {
      lines.push(`+ ${newLines[j]}`);
      j += 1;
    }
  }
  while (i < rows) {
    lines.push(`- ${oldLines[i]}`);
    i += 1;
  }
  while (j < columns) {
    lines.push(`+ ${newLines[j]}`);
    j += 1;
  }
  if (oldLines.length > limit || newLines.length > limit) {
    lines.push(`  (diff truncated at ${limit} lines)`);
  }
  return `${lines.join('\n')}\n`;
}
