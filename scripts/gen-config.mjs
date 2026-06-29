// Runs during the Netlify build. Replaces the %%PLACEHOLDERS%% in
// public/config.js with the SUPABASE_URL / SUPABASE_ANON_KEY env vars
// configured in the Netlify dashboard. The anon key is public by design.
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_ANON_KEY || "";

if (!url || !key) {
  console.warn("⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — config.js left with placeholders.");
}

const path = new URL("../public/config.js", import.meta.url);
let src = readFileSync(path, "utf8");
src = src.replace("%%SUPABASE_URL%%", url).replace("%%SUPABASE_ANON_KEY%%", key);
writeFileSync(path, src);
console.log("config.js generated for", url ? new URL(url).host : "(unset)");
