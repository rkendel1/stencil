import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          // Split large dependencies into separate chunks
          'opencv': ['opencv.js'],
        }
      }
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 2000,
    // Enable source maps for debugging
    sourcemap: false,
    // Minify for production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  },
  server: {
    port: 8080,
    open: true
  },
  preview: {
    port: 8080
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['opencv.js', 'potrace', 'jimp'],
    exclude: []
  },
  // Handle WASM files
  assetsInclude: ['**/*.wasm']
});
