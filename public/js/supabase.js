// Supabase client singleton.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.GCS_CONFIG || {};
const url = cfg.SUPABASE_URL;
const key = cfg.SUPABASE_ANON_KEY;

export const configured =
  !!url && !!key && !url.includes("%%") && !key.includes("%%");

// Use the default Web Locks API for auth — it coordinates token refresh
// across tabs so a single-use refresh token isn't clobbered (which would
// corrupt the stored session and hang getSession()). Boot is made resilient
// to a bad/expired session in app.js instead.
export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
