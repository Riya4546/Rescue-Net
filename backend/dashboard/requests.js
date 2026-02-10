import { LOCAL_DEV_MODE } from "../supabase/client.js";

// LOCAL IN-MEMORY STORE (O(1) inserts, fast iteration)
const localRequests = new Map();
export async function createHelpRequest({
  title,
  type,
  urgency,
  description,
  location,
  userId
}) {
  if (!userId) throw new Error("User not authenticated");
  if (!title || !urgency || !location)
    throw new Error("Missing required fields");

  const request = {
    id: Date.now().toString(), // O(1), unique enough for dev
    title,
    type,
    urgency,
    description,
    location,
    status: "open",
    created_by: userId,
    created_at: new Date().toISOString()
  };

  // 🔹 LOCAL MODE
  if (LOCAL_DEV_MODE) {
    localRequests.set(request.id, request);
    return request;
  }

  // 🔹 SUPABASE MODE (tomorrow)
  const { data, error } = await supabase
    .from("help_requests")
    .insert([request])
    .select();

  if (error) throw error;
  return data[0];
}


/**
 * Fetch requests created by logged-in user
 */
export async function getMyRequests(userId) {
  if (!userId) throw new Error("User not authenticated");

  if (LOCAL_DEV_MODE) {
    const result = [];
    for (const req of localRequests.values()) {
      if (req.created_by === userId) result.push(req);
    }
    return result;
  }

  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}


/**
 * Fetch urgent open requests (for volunteers)
 */
export async function getUrgentRequests() {
  if (LOCAL_DEV_MODE) {
    const result = [];
    for (const req of localRequests.values()) {
      if (
        req.status === "open" &&
        (req.urgency === "high" || req.urgency === "critical")
      ) {
        result.push(req);
      }
    }
    return result;
  }

  const { data, error } = await supabase
    .from("help_requests")
    .select("*")
    .in("urgency", ["high", "critical"])
    .eq("status", "open");

  if (error) throw error;
  return data;
}
/**
 * Resolve a help request
 */
export async function resolveRequest(requestId, userId) {
  if (!requestId) throw new Error("Request ID required");
  if (!userId) throw new Error("User not authenticated");

  if (LOCAL_DEV_MODE) {
    const request = localRequests.get(requestId);
    if (!request) throw new Error("Request not found");

    if (request.created_by !== userId)
      throw new Error("Not authorized to resolve this request");

    request.status = "resolved";
    request.resolved_at = new Date().toISOString();

    localRequests.set(requestId, request);
    return request;
  }

  // Supabase mode (tomorrow)
}

