import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

// M0.2 — Health endpoint plugin. Writes `dist/health.json` at
// `closeBundle` time with the package version, the short git SHA,
// and an ISO timestamp. Audit §4.4 requires this — a curl-readable
// endpoint that proves what's deployed without reading the bundle.
function healthJsonPlugin(): Plugin {
  return {
    name: 'meshkore-health-json',
    apply: 'build',
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
        name: string;
        version: string;
      };
      let commit = 'unknown';
      try {
        commit = execSync('git rev-parse --short HEAD', { cwd: __dirname })
          .toString()
          .trim();
      } catch {
        // git not available in the build env — leave 'unknown'.
      }
      const body = {
        name: pkg.name,
        version: pkg.version,
        commit,
        built_at: new Date().toISOString(),
      };
      mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
      writeFileSync(
        resolve(__dirname, 'dist/health.json'),
        JSON.stringify(body, null, 2) + '\n',
        'utf-8',
      );
    },
  };
}

// Surface the same build-time facts to runtime via Vite's `define`.
// `src/lib/log.ts` and any future about-modal read these from
// `import.meta.env`. The types live in `src/vite-env.d.ts`.
function buildEnvDefine(): Record<string, string> {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim();
  } catch {
    /* ignore */
  }
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string;
  };
  const built = new Date().toISOString();
  return {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(commit),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(built),
  };
}

export default defineConfig({
  plugins: [solid(), healthJsonPlugin()],
  define: buildEnvDefine(),
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
