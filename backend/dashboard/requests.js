import { supabase } from "../supabase/client.js";

/**
 * Create a help request
 */
export async function createHelpRequest({
  title,
  type,
  urgency,
  description,
  location,
  userId
}) {
  const { data, error } = await supabase
    .from("help_requests")
    .insert([
      {
        title,
        type,
        urgency,
        description,
        location,
        status: "open",
        created_by: userId
      }
    ])
    .select();

  if (error) {
    console.error("Create request error:", error);
    throw error;
  }

  return data[0];
}

/**
 * Fetch requests created by logged-in user
 */
export async function getMyRequests(userId) {
  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch my requests error:", error);
    throw error;
  }

  return data;
}

/**
 * Fetch urgent open requests (for volunteers)
 */
export async function getUrgentRequests() {
  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .in("urgency", ["high", "critical"])
    .eq("status", "open");

  if (error) {
    console.error("Fetch urgent requests error:", error);
    throw error;
  }

  return data;
}
