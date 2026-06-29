// Supabase client singleton.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.GCS_CONFIG || {};
const url = cfg.SUPABASE_URL;
const key = cfg.SUPABASE_ANON_KEY;

export const configured =
  !!url && !!key && !url.includes("%%") && !key.includes("%%");

// Pass a pass-through lock: the default uses the Web Locks API
// (navigator.locks), which can deadlock in sandboxed iframes and some
// private-browsing contexts. A 3-user app doesn't need cross-tab refresh
// coordination, so running the callback directly is safe and robust.
const passthroughLock = async (_name, _acquireTimeout, fn) => fn();

export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, lock: passthroughLock },
    })
  : null;
