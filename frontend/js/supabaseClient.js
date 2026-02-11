import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://cmefmcawnugopzrotrem.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZWZtY2F3bnVnb3B6cm90cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzY3NTIsImV4cCI6MjA4NjMxMjc1Mn0.KJu4XNLPdDp3Zs_fQpzPu-x7scdvoZ0IwMHMUKUGMgI";

export const supabase = createClient(supabaseUrl, supabaseKey);