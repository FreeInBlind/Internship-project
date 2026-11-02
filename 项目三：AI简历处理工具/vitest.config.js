import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  esbuild: {
    loader: 'jsx',
    include: /\.[jt]sx?$/,
    exclude: [],
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './test/setup.js',
    exclude: [...configDefaults.exclude, '.offline-resume-*/**', '.stage4a-*/**'],
  },
});
