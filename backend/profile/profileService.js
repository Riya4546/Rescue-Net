import { supabase } from "../supabase/client.js";

export async function getMyProfile() {
    // 1️⃣ Get authenticated user
    const { data: { user }, error } =
        await supabase.auth.getUser();

    if (!user) {
        throw new Error("Not authenticated");
    }

    const email = String(user.email || "").trim().toLowerCase();
    if (!email) {
        throw new Error("Authenticated user email is missing");
    }

    // 2️⃣ Read segmented data from the respective tables.
    const [profileResult, memberResult, historyResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("email", email).limit(1),
        supabase.from("member_records").select("*").eq("email", email).limit(1),
        supabase
            .from("work_history")
            .select("*")
            .eq("user_email", email)
            .order("created_at", { ascending: false })
    ]);

    if (profileResult.error) throw profileResult.error;
    if (memberResult.error) throw memberResult.error;
    if (historyResult.error) throw historyResult.error;

    const profile = Array.isArray(profileResult.data) ? profileResult.data[0] || null : null;
    const memberRecord = Array.isArray(memberResult.data) ? memberResult.data[0] || null : null;
    const history = Array.isArray(historyResult.data) ? historyResult.data : [];

    return {
        email,
        profile,
        member_record: memberRecord,
        work_history: history,
        full_name: profile?.full_name || memberRecord?.full_name || user.user_metadata?.full_name || "Member",
        user_role: profile?.user_role || memberRecord?.user_role || "Volunteer",
        location: profile?.location || memberRecord?.location || null
    };
}
