// 🔑 Connect Supabase
const supabaseUrl = "https://cmefmcawnugopzrotrem.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZWZtY2F3bnVnb3B6cm90cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzY3NTIsImV4cCI6MjA4NjMxMjc1Mn0.KJu4XNLPdDp3Zs_fQpzPu-x7scdvoZ0IwMHMUKUGMgI";

const supabase = window.supabase.createClient(
  supabaseUrl,
  supabaseAnonKey
);

// 📝 Signup function
async function signUp() {
  const full_name = document.getElementById("full_name").value;
  const username = document.getElementById("username").value;
  const phone = document.getElementById("phone").value;
  const country = document.getElementById("country").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  // 1️⃣ Create auth user
  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    alert(error.message);
    return;
  }

  // 2️⃣ Save extra details
  const { error: profileError } = await supabase
    .from("profiles")
    .insert({
      id: data.user.id,
      full_name: full_name,
      username: username,
      phone: phone,
      country: country,
      email: email,
    });

  if (profileError) {
    alert(profileError.message);
  } else {
    alert("Signup successful!");
  }
}

