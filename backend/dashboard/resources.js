import { supabase } from "../supabase/client.js";

export async function offerResource(data) {
  const { data: inserted, error } = await supabase
    .from("resources")
    .insert([data])
    .select()
    .single();

  if (error) throw error;
  return inserted;
}

export async function getResources() {
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}
