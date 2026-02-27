import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
  },
});
