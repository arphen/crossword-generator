/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  mutate: ['packages/construction/src/csp.ts'],
  vitest: {
    dir: 'packages/construction',
    related: true
  },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  disableTypeChecks: false,
  ignorePatterns: [
    '.venv',
    'node_modules',
    'apps/web/dist',
    'reports',
    'src/crossword/static/lib'
  ],
  htmlReporter: {
    fileName: 'reports/mutation/index.html'
  },
  jsonReporter: {
    fileName: 'reports/mutation/report.json'
  },
  thresholds: {
    high: 80,
    low: 70,
    break: 0
  },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true
};
