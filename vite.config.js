import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    minify: 'esbuild',
  },
  server: {
    port: 8080,
    open: true
  },
  preview: {
    port: 8080
  },
  // Handle WASM files
  assetsInclude: ['**/*.wasm'],
});
