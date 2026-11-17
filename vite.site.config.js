import { cp } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(projectRoot, 'deep-csc-site');
const outputRoot = resolve(projectRoot, 'dist');

export default defineConfig({
  root: siteRoot,
  publicDir: false,
  plugins: [{
    name: 'copy-punjab-csc-static-site-files',
    async closeBundle() {
      await cp(siteRoot, outputRoot, {
        recursive: true,
        filter(source) {
          const relativePath = relative(siteRoot, source);
          if (!relativePath) return true;
          const rootEntry = relativePath.split(sep)[0];
          return rootEntry !== 'site-entry.js';
        },
      });
    },
  }],
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(siteRoot, 'site-entry.js'),
      output: { entryFileNames: 'speed-insights.js' },
    },
  },
});
