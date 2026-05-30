/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCORE_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
