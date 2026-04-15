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
          'opencv': ['@techstark/opencv-js'],
        }
      }
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 2000,
    // Enable source maps for debugging
    sourcemap: false,
    // Minify for production - use esbuild instead of terser for Node.js modules
    minify: 'esbuild',
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
    include: ['@techstark/opencv-js'],
    exclude: [],
    esbuildOptions: {
      // Treat Node.js built-ins as external in browser context
      platform: 'browser'
    }
  },
  // Handle WASM files
  assetsInclude: ['**/*.wasm'],
  // Resolve configuration
  resolve: {
    alias: {
      // Polyfills for Node.js modules (optional, if needed)
    }
  }
});
