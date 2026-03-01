import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'chrome-extension',
      closeBundle() {
        const root = __dirname;
        const dist = resolve(root, 'dist');

        // Copy manifest.json (already has correct output paths)
        cpSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));

        // Copy and patch popup.html (.ts → .js)
        let popupHtml = readFileSync(resolve(root, 'src/popup/popup.html'), 'utf-8');
        popupHtml = popupHtml.replace('src="popup.ts"', 'src="popup.js"');
        writeFileSync(resolve(dist, 'popup.html'), popupHtml);

        // Copy and patch options.html (.ts → .js)
        let optionsHtml = readFileSync(resolve(root, 'src/options/options.html'), 'utf-8');
        optionsHtml = optionsHtml.replace('src="options.ts"', 'src="options.js"');
        writeFileSync(resolve(dist, 'options.html'), optionsHtml);

        // Copy CSS files
        cpSync(resolve(root, 'src/popup/popup.css'), resolve(dist, 'popup.css'));
        cpSync(resolve(root, 'src/options/options.css'), resolve(dist, 'options.css'));
        cpSync(resolve(root, 'src/content/content.css'), resolve(dist, 'content.css'));

        // Copy _locales
        cpSync(resolve(root, '_locales'), resolve(dist, '_locales'), { recursive: true });

        // Copy icons
        mkdirSync(resolve(dist, 'assets/icons'), { recursive: true });
        cpSync(resolve(root, 'assets/icons'), resolve(dist, 'assets/icons'), { recursive: true });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
        popup: resolve(__dirname, 'src/popup/popup.ts'),
        options: resolve(__dirname, 'src/options/options.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
