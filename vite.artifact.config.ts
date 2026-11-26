// Builds the shareable, server-free version of the app (published as a Claude artifact).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = path.resolve(here, 'artifact/node-shims.ts');

/** Assets are published next to the page, so root paths (/brand, /fonts) become relative. */
const relativeAssets = (): Plugin => ({
  name: 'relative-assets',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.(tsx?|css)$/.test(id) || id.includes('node_modules')) return null;
    return code.replace(/(["'(])\/(brand|fonts)\//g, '$1./$2/');
  },
  transformIndexHtml: (html) => html.replace(/(["'])\/(brand|fonts)\//g, '$1./$2/').replace(/<link rel="manifest"[^>]*>\n?/, ''),
});

export default defineConfig({
  base: './',
  plugins: [relativeAssets(), react(), tailwindcss()],
  define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(here, 'src') },
      { find: /^node:(fs|url|path)$/, replacement: shim },
    ],
  },
  build: { outDir: 'dist-artifact', emptyOutDir: true },
});
