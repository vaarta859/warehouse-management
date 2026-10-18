import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL;

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error(
    "SUPABASE_URL is missing in .env"
  );
}

if (!supabaseSecretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY is missing in .env"
  );
}

export const supabase =
  createClient(
    supabaseUrl,
    supabaseSecretKey
  );

export const SUPABASE_BUCKET =
  process.env.SUPABASE_BUCKET ||
  "warehouse-documents";