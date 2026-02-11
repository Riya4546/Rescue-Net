import { supabase } from "./supabaseClient.js";

const DEV_USER_ID = "local-dev-user"; 

export const dashboardClient = {
    async getInitialData() {
        const [requests, urgent, resources] = await Promise.all([
            supabase.from('help_requests').select('*').order('created_at', { ascending: false }),
            supabase.from('help_requests').select('id', { count: 'exact', head: true }).eq('urgency', 'critical').eq('status', 'open'),
            supabase.from('resources').select('*', { count: 'exact' })
        ]);

        return { 
            requests: requests.data || [], 
            urgentCount: urgent.count || 0,
            resourceCount: resources.count || 0
        };
    },

    async postRequest(formData) {
        const { error } = await supabase
            .from('help_requests')
            .insert([{ 
                ...formData, 
                created_by: DEV_USER_ID,
                status: 'open' 
            }]);
        if (error) throw error;
    },

    async offerResource(data) {
        const { error } = await supabase
            .from('resources')
            .insert([{
                title: data.title,
                type: data.type,
                quantity: data.quantity,
                pickup_location: data.location,
                offered_by: DEV_USER_ID
            }]);
        if (error) throw error;
    }
};