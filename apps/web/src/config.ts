export const env = {
  apiUrl: (import.meta.env.VITE_API_URL ?? "http://localhost:3333").replace(/\/$/, ""),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  devApiToken: import.meta.env.VITE_DEV_API_TOKEN ?? "",
};
