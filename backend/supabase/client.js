export const LOCAL_DEV_MODE = true; // set to false when Supabase access is ready
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cmefmcawnugopzrotrem.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZWZtY2F3bnVnb3B6cm90cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzY3NTIsImV4cCI6MjA4NjMxMjc1Mn0.KJu4XNLPdDp3Zs_fQpzPu-x7scdvoZ0IwMHMUKUGMgI";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);