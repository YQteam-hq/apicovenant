import { defineRule } from '../../src/plugin/index.ts';

export const collides = defineRule({
  id: 'path-no-trailing-slash',
  title: 'Plugin rule that shadows a built-in',
  description: 'Used to prove that plugin ids cannot override core rules.',
  severity: 'warn',
  category: 'paths',
  check() {
    // no-op
  },
});
