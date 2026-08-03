/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_FLOWCONTEXT_PROVIDER?: string;
  readonly VITE_FLOWCONTEXT_API_URL?: string;
  readonly VITE_FLOWCONTEXT_DEVICE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
