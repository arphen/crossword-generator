/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  mutate: ['packages/construction/src/csp.ts'],
  vitest: {
    dir: 'packages/construction',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  disableTypeChecks: false,
  ignorePatterns: [
    'node_modules',
    'artifacts',
    'coverage',
    'reports',
    '.stryker-tmp',
  ],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/report.json',
  },
  thresholds: {
    high: 80,
    low: 55,
    break: 55,
  },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
