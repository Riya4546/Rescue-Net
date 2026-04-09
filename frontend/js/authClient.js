// Legacy fallback auth helper for older pages.
const configUrl = new URL("../app.config.json", document.currentScript?.src || window.location.href);
let supabasePromise;

async function getSupabaseClient() {
  if (supabasePromise) {
    return supabasePromise;
  }

  supabasePromise = (async () => {
    let fileConfig = {};

    try {
      const response = await fetch(configUrl);
      if (response.ok) {
        fileConfig = await response.json();
      }
    } catch {
      fileConfig = {};
    }

    const supabaseUrl = String(
      window.RESCUENET_CONFIG?.supabase?.url || fileConfig?.supabase?.url || ""
    ).trim();
    const supabaseAnonKey = String(
      window.RESCUENET_CONFIG?.supabase?.anonKey || fileConfig?.supabase?.anonKey || ""
    ).trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase config. Add frontend/app.config.json or window.RESCUENET_CONFIG.");
    }

    return window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  })();

  return supabasePromise;
}

async function signUp() {
  const supabase = await getSupabaseClient();
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

  const profilePayloads = [
    {
      id: data?.user?.id,
      email,
      full_name: full_name || email.split("@")[0] || "Member",
      user_role: "Volunteer",
      location: country || null,
      last_login_at: new Date().toISOString()
    },
    {
      id: data?.user?.id,
      email,
      full_name: full_name || email.split("@")[0] || "Member",
      user_role: "Volunteer",
      location: country || null
    },
    {
      id: data?.user?.id,
      email,
      full_name: full_name || email.split("@")[0] || "Member"
    },
    {
      id: data?.user?.id,
      email
    }
  ];

  let profileSaved = false;
  for (const profilePayload of profilePayloads) {
    const cleanPayload = { ...profilePayload };
    if (!cleanPayload.id) delete cleanPayload.id;
    const { error: profileError } = await supabase.from("profiles").upsert(cleanPayload);
    if (!profileError) {
      profileSaved = true;
      break;
    }
    const msg = String(profileError?.message || "").toLowerCase();
    const details = String(profileError?.details || "").toLowerCase();
    const hint = String(profileError?.hint || "").toLowerCase();
    const combined = `${msg} ${details} ${hint}`;
    if (!((combined.includes("column") && combined.includes("does not exist")) || (combined.includes("could not find") && combined.includes("column") && combined.includes("schema cache")))) {
      alert(profileError.message);
      return;
    }
  }

  if (!profileSaved) {
    alert("Unable to save the public profile row.");
    return;
  }

  // Keep member_records as progress mirror (no credential fields).
  const memberPayloads = [
    {
      id: data?.user?.id,
      profile_id: data?.user?.id || null,
      email,
      full_name: full_name || email.split("@")[0] || "Member",
      user_role: "Volunteer",
      location: country || null
    },
    {
      id: data?.user?.id,
      email,
      full_name: full_name || email.split("@")[0] || "Member",
      user_role: "Volunteer",
      location: country || null
    },
    {
      email,
      full_name: full_name || email.split("@")[0] || "Member",
      user_role: "Volunteer",
      location: country || null
    }
  ];

  for (const memberPayload of memberPayloads) {
    const cleanPayload = { ...memberPayload };
    if (!cleanPayload.id) delete cleanPayload.id;
    const { error: memberError } = await supabase.from("member_records").upsert(cleanPayload);
    if (!memberError) break;
    const msg = String(memberError?.message || "").toLowerCase();
    const details = String(memberError?.details || "").toLowerCase();
    const hint = String(memberError?.hint || "").toLowerCase();
    const combined = `${msg} ${details} ${hint}`;
    if (!((combined.includes("column") && combined.includes("does not exist")) || (combined.includes("could not find") && combined.includes("column") && combined.includes("schema cache")))) {
      break;
    }
  }

  alert("Signup successful!");
}
