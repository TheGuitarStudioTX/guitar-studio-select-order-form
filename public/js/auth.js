// Authentication: invite-only login gate (Supabase Auth).
// Public sign-up is disabled in the Supabase dashboard; there is no
// sign-up UI here. Users log in with email + password, or request a
// one-time magic link.
import { supabase, configured } from "./supabase.js";
import { withTimeout } from "./util.js";

export async function currentUser() {
  if (!configured) return null;
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), 8000, "Session check");
    return data.session?.user ?? null;
  } catch (e) {
    // Auth subsystem stuck (e.g. corrupted stored session) — clear it so the
    // login gate works on a clean slate.
    try { Object.keys(localStorage).filter(k => k.startsWith("sb-")).forEach(k => localStorage.removeItem(k)); } catch (_) {}
    return null;
  }
}

export function onAuthChange(cb) {
  if (!configured) return;
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function sendMagicLink(email) {
  // shouldCreateUser:false keeps it invite-only — links only work for
  // already-invited accounts.
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function myProfile() {
  const u = await currentUser();
  if (!u) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
  return data || { id: u.id, email: u.email, full_name: u.email };
}
