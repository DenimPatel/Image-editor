/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Image-editor/',
  optimizeDeps: {
    // onnxruntime-web ships an optional WASM entry point; let it resolve at
    // runtime instead of being pre-bundled by esbuild.
    exclude: ['onnxruntime-web'],
  },
  worker: {
    // ES workers so `comlink` and dynamic imports work in every browser.
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@imgly/background-removal') || id.includes('onnxruntime-web')) return 'matting';
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('purify')) return 'pdf';
          if (id.includes('@use-gesture') || id.includes('zustand')) return 'vendor-ui';
          if (id.includes('react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
