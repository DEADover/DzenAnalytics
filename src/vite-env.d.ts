/// <reference types="vite/client" />

// Injected at build time from package.json (see `define` in vite.config.ts).
declare const __APP_VERSION__: string;
/** Однофайловая сборка из релиза (`npm run build:standalone`). */
declare const __STANDALONE__: boolean;

interface ImportMetaEnv {
  readonly VITE_OAUTH_PROVIDER_URL?: string;
}
