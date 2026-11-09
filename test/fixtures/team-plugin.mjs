import { definePreset, defineReporter, defineRule } from '../../src/plugin/index.ts';

export const noTodoSummary = defineRule({
  id: 'team-no-todo-summary',
  title: 'Summaries must not contain unfinished markers',
  description: 'An unfinished marker ships incomplete documentation.',
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
    return `team report: ${report.summary.total} findings\n`;
  },
});

export const teamPreset = definePreset({
  name: 'team',
  rules: ['team-no-todo-summary'],
  severity: 'warn',
});
