// ============================================================
// Supabase connection config.
//
// For LOCAL use: paste your project URL + anon (public) key below.
// For NETLIFY:   leave the %%PLACEHOLDERS%% — the build step
//                (scripts/gen-config.mjs, see netlify.toml) replaces
//                them from the SUPABASE_URL / SUPABASE_ANON_KEY env vars.
//
// The anon key is a *public* key and is safe to ship to the browser;
// data is protected by Row Level Security + invite-only login.
// ============================================================
window.GCS_CONFIG = {
  SUPABASE_URL: "%%SUPABASE_URL%%",
  SUPABASE_ANON_KEY: "%%SUPABASE_ANON_KEY%%"
};
