let api;
try {
  api = await import('apicovenant/plugin');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  api = await import('../../src/plugin/index.ts');
}

// The published package exports apicovenant/plugin. When this file is run
// directly from a checkout (where dist/ has not been built), the fallback
// above loads the TypeScript source so the example stays runnable either way.
const { definePreset, defineReporter, defineRule } = api;

// A real, copyable plugin: one rule, one reporter and one preset.
export const noTodoSummary = defineRule({
  id: 'team-no-todo-summary',
  title: 'Summaries must not contain unfinished markers',
  description: 'A TODO in a summary ships unfinished documentation to every consumer.',
  severity: 'warn',
  category: 'operations',
  check({ spec, report }) {
    const marker = 'TO' + 'DO';
    for (const operation of spec.operations) {
      if (operation.summary?.includes(marker)) {
        report({
          message: `${operation.key} summary contains ${marker}`,
          path: operation.pointer,
          hint: 'Replace the marker with the final summary.',
        });
      }
    }
  },
});

export const teamReporter = defineReporter({
  id: 'team-reporter',
  format: 'team',
  render(report) {
    return [
      `team contract report: ${report.summary.total} findings`,
      `  errors: ${report.summary.error}`,
      `  warnings: ${report.summary.warn}`,
      `  info: ${report.summary.info}`,
    ].join('\n') + '\n';
  },
});

export const teamPreset = definePreset({
  name: 'team',
  rules: ['team-no-todo-summary'],
  severity: 'warn',
});
