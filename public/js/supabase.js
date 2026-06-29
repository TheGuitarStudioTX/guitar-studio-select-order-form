// Supabase client singleton.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.GCS_CONFIG || {};
const url = cfg.SUPABASE_URL;
const key = cfg.SUPABASE_ANON_KEY;

export const configured =
  !!url && !!key && !url.includes("%%") && !key.includes("%%");

export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
