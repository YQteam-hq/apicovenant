import type { DiffReport } from '../diff/compare.ts';
import { escapeHtml } from './html.ts';

export interface DiffHtmlOptions {
  report: DiffReport;

  goldenFile: string;
  title?: string;
}

function renderInteraction(interaction: DiffReport['interactions'][number]): string {
  const rows: string[] = [];

  if (interaction.error) {
    rows.push(`      <div class="line error"><span class="tag">failed</span>${escapeHtml(interaction.error)}</div>`);
  }

  if (interaction.status.changed) {
    rows.push(
      `      <div class="line error"><span class="tag">status</span>${interaction.status.before} → <strong>${interaction.status.after}</strong></div>`,
    );
  } else {
    rows.push(`      <div class="line"><span class="tag">status</span>${interaction.status.before}</div>`);
  }

  for (const header of interaction.headers) {
    if (!header.changed) continue;
    rows.push(
      `      <div class="line warn"><span class="tag">header</span>${escapeHtml(header.name)}: ${escapeHtml(header.before ?? '(absent)')} → <strong>${escapeHtml(header.after ?? '(absent)')}</strong></div>`,
    );
  }

  for (const violation of interaction.schemaViolations) {
    rows.push(
      `      <div class="line error"><span class="tag">schema</span><code>${escapeHtml(violation.path || '/')}</code> ${escapeHtml(violation.message)}</div>`,
    );
  }

  for (const violation of interaction.mockViolations) {
    rows.push(
      `      <div class="line warn"><span class="tag">mock</span><code>${escapeHtml(violation.path || '/')}</code> ${escapeHtml(violation.message)}</div>`,
    );
  }

  for (const difference of interaction.body.differences) {
    rows.push(
      `      <div class="line"><span class="tag ${difference.kind}">${escapeHtml(difference.kind)}</span><code>${escapeHtml(difference.path)}</code> ${escapeHtml(JSON.stringify(difference.before) ?? '(absent)')} → <strong>${escapeHtml(JSON.stringify(difference.after) ?? '(absent)')}</strong></div>`,
    );
  }

  const drifted =
    interaction.status.changed ||
    interaction.body.changed ||
    interaction.headers.some((h) => h.changed) ||
    interaction.schemaViolations.length > 0;
  const state = interaction.skipped
    ? 'skipped'
    : interaction.error
      ? 'changed'
      : drifted
        ? 'changed'
        : interaction.mockViolations.length > 0
          ? 'warn'
          : 'same';

  return `    <article class="interaction ${state}">
      <header><span class="method">${escapeHtml(interaction.method)}</span><span class="path">${escapeHtml(interaction.path)}</span></header>
${rows.length > 0 ? rows.join('\n') : '      <div class="line muted">No differences.</div>'}
    </article>`;
}


export function renderDiffHtmlReport(options: DiffHtmlOptions): string {
  const { report } = options;
  const summary = report.summary;

  const interactions = report.interactions.map(renderInteraction).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title ?? 'Contract drift report')}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1117;
    --panel: #161923;
    --panel-2: #1c2030;
    --border: #262b3a;
    --text: #e6e9ef;
    --muted: #8b93a7;
    --accent: #7aa2f7;
    --error: #f7768e;
    --warn: #e0af68;
    --ok: #9ece6a;
    --info: #7dcfff;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f7f8fa;
      --panel: #ffffff;
      --panel-2: #f0f2f6;
      --border: #dfe3ec;
      --text: #1a1d26;
      --muted: #626b80;
      --accent: #3b5bdb;
      --error: #c92a2a;
      --warn: #b8860b;
      --ok: #2f9e44;
      --info: #1971c2;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 1.5rem 4rem;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 1.75rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .meta { color: var(--muted); font-size: .82rem; }
  .meta code { background: var(--panel-2); padding: .1rem .35rem; border-radius: 4px; }
  .cards { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 1.5rem; }
  .card { flex: 1 1 130px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: .9rem 1.1rem; }
  .card .n { font-size: 1.7rem; font-weight: 650; line-height: 1.1; }
  .card .l { color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .06em; }
  .card.changed .n { color: var(--error); }
  .card.same .n { color: var(--ok); }
  .card.failed .n { color: var(--error); }
  .card.skipped .n { color: var(--warn); }
  .card.total .n { color: var(--accent); }
  .interaction {
    background: var(--panel);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: 10px;
    padding: .9rem 1.1rem;
    margin-bottom: .75rem;
  }
  .interaction.changed { border-left-color: var(--error); }
  .interaction.same { border-left-color: var(--ok); }
  .interaction.warn { border-left-color: var(--warn); }
  .interaction.skipped { border-left-color: var(--warn); }
  .interaction > header { margin-bottom: .5rem; display: flex; gap: .6rem; align-items: baseline; }
  .method { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; font-weight: 700; color: var(--accent); }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88rem; }
  .line { font-size: .84rem; padding: .18rem 0; color: var(--text); }
  .line.error { color: var(--error); }
  .line.warn { color: var(--warn); }
  .line.muted { color: var(--muted); }
  .tag {
    display: inline-block;
    min-width: 4.6rem;
    margin-right: .6rem;
    padding: .05rem .45rem;
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    font-size: .68rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: .05em;
    text-align: center;
  }
  .tag.added { color: var(--ok); }
  .tag.removed { color: var(--error); }
  .tag.changed { color: var(--warn); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--panel-2); padding: .05rem .3rem; border-radius: 4px; font-size: .82rem; }
  footer { margin-top: 1.5rem; color: var(--muted); font-size: .78rem; }
  .empty { text-align: center; color: var(--muted); padding: 2.5rem; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(options.title ?? 'Contract drift report')}</h1>
    <div class="meta">
      golden <code>${escapeHtml(options.goldenFile)}</code> &rarr; source <code>${escapeHtml(report.source)}</code>
    </div>
  </header>

  <section class="cards">
    <div class="card total"><div class="n">${summary.total}</div><div class="l">interactions</div></div>
    <div class="card changed"><div class="n">${summary.changed}</div><div class="l">changed</div></div>
    <div class="card same"><div class="n">${summary.unchanged}</div><div class="l">unchanged</div></div>
    <div class="card failed"><div class="n">${summary.failed}</div><div class="l">failed</div></div>
    <div class="card skipped"><div class="n">${summary.skipped}</div><div class="l">skipped</div></div>
  </section>

  ${
    report.interactions.length === 0
      ? '<div class="empty">Nothing to compare.</div>'
      : interactions
  }

  <footer>
    Generated by apicovenant &mdash; an OpenAPI contract guardian.
  </footer>
</div>
</body>
</html>
`;
}
