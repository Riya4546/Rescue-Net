import { supabase } from "../supabase/client.js";

export async function getMyProfile() {
    // 1️⃣ Get authenticated user
    const { data: { user }, error } =
        await supabase.auth.getUser();

    if (!user) {
        throw new Error("Not authenticated");
    }

    // 2️⃣ Query profile using THAT user's email
    const { data, error: dbError } = await supabase
        .from("member_records")
        .select("*")
        .eq("email", user.email)
        .single();

    if (dbError) {
        throw dbError;
    }

    return data;
}
