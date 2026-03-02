/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['**/tests/**/*.test.js'],
  modulePaths: ['<rootDir>/server/node_modules'],
  testTimeout: 10000,
  setupFiles: ['<rootDir>/tests/setup.js'],
};
