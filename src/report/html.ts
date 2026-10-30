import type { Finding, Severity } from '../lint/types.ts';

export interface HtmlReportOptions {
  tool: string;
  version: string;
  document: string;
  findings: Finding[];
  generatedAt?: string;
  title?: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderHtmlReport(options: HtmlReportOptions): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of options.findings) counts[finding.severity] += 1;

  const rows = options.findings
    .map((finding) => {
      const location = finding.operation ? escapeHtml(finding.operation) : '<span class="muted">document</span>';
      const hint = finding.hint
        ? `<div class="hint"><span class="arrow">&rarr;</span> ${escapeHtml(finding.hint)}</div>`
        : '';
      return `      <tr class="severity-${finding.severity}" data-severity="${finding.severity}">
        <td><span class="pill pill-${finding.severity}">${escapeHtml(finding.severity)}</span></td>
        <td class="rule">${escapeHtml(finding.ruleId)}</td>
        <td class="location">${location}<div class="path">${escapeHtml(finding.path)}</div></td>
        <td class="message">${escapeHtml(finding.message)}${hint}</td>
      </tr>`;
    })
    .join('\n');

  const emptyState = options.findings.length === 0
    ? '      <tr><td colspan="4" class="empty">No findings. The contract looks clean.</td></tr>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title ?? `${options.tool} report`)}</title>
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
    --info: #7dcfff;
    --ok: #9ece6a;
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
      --info: #1971c2;
      --ok: #2f9e44;
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
  .card {
    flex: 1 1 140px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: .9rem 1.1rem;
  }
  .card .n { font-size: 1.7rem; font-weight: 650; line-height: 1.1; }
  .card .l { color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .06em; }
  .card.error .n { color: var(--error); }
  .card.warn .n { color: var(--warn); }
  .card.info .n { color: var(--info); }
  .card.total .n { color: var(--accent); }
  .filters { display: flex; gap: .4rem; margin-bottom: .9rem; flex-wrap: wrap; }
  button {
    font: inherit;
    font-size: .8rem;
    padding: .35rem .8rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--muted);
    cursor: pointer;
  }
  button:hover { color: var(--text); border-color: var(--accent); }
  button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: .7rem .85rem; vertical-align: top; border-bottom: 1px solid var(--border); }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); background: var(--panel-2); font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  td.rule { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; color: var(--accent); white-space: nowrap; }
  td.location { white-space: nowrap; font-size: .84rem; }
  td.message { font-size: .86rem; }
  .path { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .74rem; margin-top: .2rem; }
  .muted { color: var(--muted); }
  .pill { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .7rem; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
  .pill-error { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }
  .pill-warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
  .pill-info { background: color-mix(in srgb, var(--info) 18%, transparent); color: var(--info); }
  .hint { color: var(--muted); margin-top: .35rem; font-size: .8rem; }
  .arrow { color: var(--accent); }
  .empty { text-align: center; color: var(--muted); padding: 2.5rem; }
  footer { margin-top: 1.5rem; color: var(--muted); font-size: .78rem; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(options.title ?? `${options.tool} report`)}</h1>
    <div class="meta">
      <code>${escapeHtml(options.document)}</code> &middot; generated ${escapeHtml(generatedAt)} &middot; ${escapeHtml(options.tool)} v${escapeHtml(options.version)}
    </div>
  </header>

  <section class="cards">
    <div class="card total"><div class="n">${options.findings.length}</div><div class="l">findings</div></div>
    <div class="card error"><div class="n">${counts.error}</div><div class="l">errors</div></div>
    <div class="card warn"><div class="n">${counts.warn}</div><div class="l">warnings</div></div>
    <div class="card info"><div class="n">${counts.info}</div><div class="l">info</div></div>
  </section>

  <div class="filters">
    <button class="active" data-filter="all">All</button>
    <button data-filter="error">Errors</button>
    <button data-filter="warn">Warnings</button>
    <button data-filter="info">Info</button>
  </div>

  <table>
    <thead>
      <tr><th>Severity</th><th>Rule</th><th>Location</th><th>Message</th></tr>
    </thead>
    <tbody id="rows">
${rows}
${emptyState}
    </tbody>
  </table>

  <footer>
    Generated by ${escapeHtml(options.tool)} v${escapeHtml(options.version)} &mdash; an OpenAPI contract guardian.
  </footer>
</div>
<script>
  (function () {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.filters button'));
    var rows = Array.prototype.slice.call(document.querySelectorAll('#rows tr'));
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var filter = button.getAttribute('data-filter');
        buttons.forEach(function (other) { other.classList.toggle('active', other === button); });
        rows.forEach(function (row) {
          var severity = row.getAttribute('data-severity');
          row.classList.toggle('hidden', filter !== 'all' && severity !== filter);
        });
      });
    });
  })();
</script>
</body>
</html>
`;
}
