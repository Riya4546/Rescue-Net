import { LOCAL_DEV_MODE } from "../supabase/client.js";

// LOCAL IN-MEMORY STORE (O(1))
const localResources = new Map();

/**
 * Offer a resource (volunteer side)
 */
export async function offerResource({
  title,
  type,
  quantity,
  pickupLocation,
  userId
}) {
  if (!userId) throw new Error("User not authenticated");
  if (!title || !quantity || !pickupLocation)
    throw new Error("Missing required fields");

  const resource = {
    id: Date.now().toString(),
    title,
    type,
    quantity,
    pickupLocation,
    offered_by: userId,
    created_at: new Date().toISOString()
  };

  if (LOCAL_DEV_MODE) {
    localResources.set(resource.id, resource);
    return resource;
  }

  // Supabase mode (tomorrow)
  // return await supabase.from("resources").insert([resource]).select();
}

/**
 * Get all available resources
 */
export async function getAllResources() {
  if (LOCAL_DEV_MODE) {
    return Array.from(localResources.values());
  }

  // Supabase mode
}
