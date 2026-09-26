/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CHAIN_ID?: "10143" | "31337";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
