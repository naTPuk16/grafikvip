import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

if (!supabaseConfigured) {
  console.warn(
    "Supabase env vars отсутствуют. Проверьте .env.local (локально) или Environment Variables (на Vercel)."
  );
}

export const supabase = createClient(url, key);
