/// <reference types="vite/client" />

// Build-time injected by Vite (vite.config.ts). See M0.2.
interface ImportMetaEnv {
  readonly VITE_BUILD_VERSION?: string;
  readonly VITE_BUILD_COMMIT?: string;
  readonly VITE_BUILD_DATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
