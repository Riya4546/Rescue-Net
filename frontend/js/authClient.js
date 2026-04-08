// Legacy fallback auth helper for older pages.
const supabaseUrl = "https://cmefmcawnugopzrotrem.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZWZtY2F3bnVnb3B6cm90cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzY3NTIsImV4cCI6MjA4NjMxMjc1Mn0.KJu4XNLPdDp3Zs_fQpzPu-x7scdvoZ0IwMHMUKUGMgI";
const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

async function hashPassword(password) {
  if (!window.crypto?.subtle) return String(password || "");
  const bytes = new TextEncoder().encode(String(password || ""));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function signUp() {
  const full_name = (document.getElementById("full_name")?.value || "").trim();
  const country = (document.getElementById("country")?.value || "").trim();
  const email = (document.getElementById("email")?.value || "").trim().toLowerCase();
  const password = document.getElementById("password")?.value || "";

  if (!email || !password) {
    alert("Email and password are required.");
    return;
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    alert(error.message);
    return;
  }

  const password_hash = await hashPassword(password);
  const profilePayload = {
    id: data?.user?.id,
    email,
    full_name: full_name || email.split("@")[0] || "Member",
    user_role: "Volunteer",
    location: country || null,
    password_hash,
    last_login_at: new Date().toISOString()
  };

  const { error: profileError } = await supabase.from("profiles").upsert(profilePayload);
  if (profileError) {
    alert(profileError.message);
    return;
  }

  // Keep member_records as progress mirror (no credential fields).
  const memberPayload = {
    id: data?.user?.id,
    profile_id: data?.user?.id || null,
    email,
    full_name: profilePayload.full_name,
    user_role: "Volunteer",
    location: country || null
  };
  await supabase.from("member_records").upsert(memberPayload);

  alert("Signup successful!");
}
