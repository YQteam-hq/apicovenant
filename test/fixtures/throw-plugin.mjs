import { defineRule } from '../../src/plugin/index.ts';

export const exploding = defineRule({
  id: 'team-exploding',
  title: 'Rule that always throws',
  description: 'Used to verify that plugin failures name the plugin file.',
  severity: 'error',
  category: 'operations',
  check() {
    throw new Error('boom from the plugin');
  },
});
