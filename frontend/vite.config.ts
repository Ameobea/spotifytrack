import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseURL = env.REACT_APP_API_BASE_URL ?? 'http://localhost:8000';
  const siteURL = env.REACT_APP_SITE_URL ?? 'http://localhost:9000';

  return {
    plugins: [react(), wasm()],
    resolve: {
      alias: [
        { find: 'src', replacement: path.resolve(__dirname, 'src') },
        {
          find: /^ameo-utils$/,
          replacement: path.resolve(__dirname, 'node_modules/ameo-utils/dist/index.js'),
        },
      ],
    },
    define: {
      'process.env.REACT_APP_API_BASE_URL': JSON.stringify(apiBaseURL),
      'process.env.REACT_APP_SITE_URL': JSON.stringify(siteURL),
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    },
    server: {
      host: '0.0.0.0',
      port: 9050,
    },
    worker: {
      format: 'es',
      plugins: () => [wasm()],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      target: 'esnext',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),
          graph: path.resolve(__dirname, 'graph.html'),
          artistAverager: path.resolve(__dirname, 'artist-averager.html'),
          musicGalaxy: path.resolve(__dirname, 'music-galaxy.html'),
        },
      },
    },
  };
});
