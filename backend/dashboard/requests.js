import { supabase } from "../supabase/client.js";

/* CREATE */
export async function createHelpRequest(data) {
  const { error, data: inserted } = await supabase
    .from("help_requests")
    .insert([data])
    .select()
    .single();

  if (error) throw error;
  return inserted;
}

/* READ */
export async function getMyRequests(userId) {
  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getUrgentRequests() {
  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .in("urgency", ["high", "critical"])
    .eq("status", "open");

  if (error) throw error;
  return data;
}

/* UPDATE */
export async function resolveRequest(requestId, userId) {
  const { data, error } = await supabase
    .from("help_requests")
    .update({ status: "resolved" })
    .eq("id", requestId)
    .eq("created_by", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
