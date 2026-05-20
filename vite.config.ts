import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { '~': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    // Single-page app: no code-splitting overhead for the cockpit (one user,
    // long-lived session, instant subsequent navigations). One bundle.
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
  server: {
    port: 4173,
    // Daemon defaults to localhost:5570; we don't proxy because the daemon's
    // CORS allows http://localhost:* origins directly.
  },
});
