import { supabase } from "./supabaseClient.js";

/**
 * Fetches all dashboard data in a single parallel burst (O(1) sequential time)
 */
export async function loadDashboardData(userId) {
    try {
        const [myReqs, urgentReqs, resources] = await Promise.all([
            supabase.from("help_requests").select("*").eq("created_by", userId).order("created_at", { ascending: false }),
            supabase.from("help_requests").select("*", { count: 'exact', head: true }).in("urgency", ["high", "critical"]).eq("status", "open"),
            supabase.from("resources").select("*", { count: 'exact', head: true })
        ]);

        return {
            myRequests: myReqs.data || [],
            urgentCount: urgentReqs.count || 0,
            resourceCount: resources.count || 0
        };
    } catch (err) {
        console.error("Data fetch error:", err);
        return null;
    }
}

export async function submitHelpRequest(data, userId) {
    return await supabase.from("help_requests").insert([{ ...data, created_by: userId }]);
}

export async function resolveRequest(requestId) {
    return await supabase.from("help_requests").update({ status: "resolved" }).eq("id", requestId);
}