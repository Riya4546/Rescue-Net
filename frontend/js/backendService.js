import { supabase } from "./supabaseClient.js";
import { apiService } from "./apiService.js"; 

// ==========================================
// 🚦 ROADMAP DEFINITIONS (Strictly matched to your prompt)
// ==========================================
const ROADMAP_TEMPLATES = {
    // 1. Medical Assistance
    'medical_assistance': [
        "Volunteer Assigned", "Contact Established", "Send Dispatch Unit", 
        "Dispatch Unit Live", "Patients Retrieval", "Return to Base", "COMPLETED"
    ],
    // 2. Medicine Needs
    'medical_medicine': [
        "Volunteer Assigned", "Arrange the Medicine", "Send in Transportation", 
        "Transport Live", "Medicine Delivered", "COMPLETED"
    ],
    // 3. Blood Services
    'blood': [
        "Volunteer Assigned", "Arrange the Blood", "Send in Transportation", 
        "Transport Live", "Blood Delivered", "COMPLETED"
    ],
    // 4. Disaster Response
    'disaster': [
        "Volunteer Assigned", "Arrange Rescue Team", "Send Rescue Team", 
        "Rescue Team Live", "Rescued the Injured", "Admitted to Hospitals", "Returned to Relief Camps", "COMPLETED"
    ],
    // 5. Food & Water
    'food_water': [
        "Volunteer Assigned", "Arrange Food/Essentials", "Send Team", 
        "Team Live", "Deliver Resources", "COMPLETED"
    ],
    // 6. Shelter
    'shelter': [
        "Volunteer Assigned", "CrossCheck Genuine Need", "Check Available Shelters", 
        "Arrange Transportation", "Provide Shelter", "COMPLETED"
    ],
    // Fallback
    'general': ["Volunteer Assigned", "In Progress", "Resolved", "COMPLETED"]
};

const SYSTEM_USER = "local-dev-user"; 

export const BackendService = {

    // ============================================================
    // 1. FETCH DASHBOARD (User View)
    // ============================================================
    async getInitialData() {
        // Optimized: Fetching stats via 'count' instead of downloading rows
        const [requests, urgentStat, resourceStat] = await Promise.all([
            supabase.from('help_requests').select('*').order('created_at', { ascending: false }),
            supabase.from('help_requests').select('id', { count: 'exact', head: true }).or('urgency.eq.high,urgency.eq.critical').eq('status', 'queued'),
            supabase.from('resources').select('id', { count: 'exact', head: true })
        ]);

        const cleanRequests = (requests.data || []).map(req => ({
            ...req,
            location: req.location_text
        }));

        return { 
            requests: cleanRequests, 
            urgentCount: urgentStat.count || 0,
            resourceCount: resourceStat.count || 0
        };
    },

    // ============================================================
    // 2. SUBMIT REQUEST (Strict Validation Logic)
    // ============================================================
    async createHelpRequest(input) {
        console.log("[BACKEND] Validating Inputs...", input);

        // --- A. GENERAL VALIDATION ---
        if (!input.title || input.title.length < 4) throw new Error("Title is too short.");
        if (!input.location) throw new Error("Location is mandatory.");
        
        // Anti-Gibberish (Regex: Prevents 'aaaaa' or 'asdfasdf')
        if (/(.)\1{4,}/.test(input.title)) throw new Error("Title looks like gibberish.");
        
        // Description Logic: Nullable ONLY if High/Critical
        const isUrgent = input.urgency === 'high' || input.urgency === 'critical';
        if (!isUrgent && (!input.description || input.description.length < 5)) {
            throw new Error("Description is required for Low/Medium urgency.");
        }

        // --- B. CATEGORY SPECIFIC VALIDATION ---
        const category = input.category;
        let specificDetails = {};

        switch (category) {
            case 'medical':
                if (input.medicalType === 'medicine') {
                    if (!input.medicineName) throw new Error("Medicine Name is required.");
                    // Limit check: Max 500
                    if (!input.medicineQty || isNaN(input.medicineQty) || input.medicineQty > 500) {
                        throw new Error("Invalid Quantity (Max 500).");
                    }
                    specificDetails = { sub_type: 'medicine', name: input.medicineName, qty: input.medicineQty };
                } else {
                    specificDetails = { sub_type: 'assistance' };
                }
                break;

            case 'blood':
                const validGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
                if (!validGroups.includes(input.bloodGroup)) throw new Error("Invalid Blood Group.");
                if (!input.bloodQty) throw new Error("Blood quantity (ml) is required.");
                specificDetails = { group: input.bloodGroup, qty_ml: input.bloodQty };
                break;

            case 'disaster':
            case 'food_water':
            case 'shelter':
                // No internal inputs specified in prompt
                break;

            default:
                throw new Error("Invalid Category.");
        }

        // --- C. DATABASE INSERT ---
        const { data, error } = await supabase
            .from('help_requests')
            .insert([{ 
                title: input.title,
                urgency: input.urgency,
                category: category,
                location_text: input.location, 
                description: input.description,
                specific_details: specificDetails, 
                status: 'queued',
                created_by: SYSTEM_USER,
                roadmap: [{ stage: "Request Created", timestamp: new Date() }]
            }])
            .select();

        if (error) throw error;
        return data[0];
    },

    // ============================================================
    // 3. VOLUNTEER DASHBOARD (Supply Side)
    // ============================================================
    async getVolunteerDashboard() {
        // Optimized: Parallel execution
        const [urgent, active, history] = await Promise.all([
            // a) Urgent Needs (Queued, Unassigned)
            supabase.from('help_requests')
                .select('*')
                .eq('status', 'queued')
                .order('created_at', { ascending: false }),

            // b) Current Resolves (Assigned to ME, In Progress)
            supabase.from('help_requests')
                .select('*')
                .eq('status', 'on_progress')
                .eq('assigned_volunteer', SYSTEM_USER),

            // c) Completed (Assigned to ME, Completed)
            supabase.from('help_requests')
                .select('*')
                .eq('status', 'completed')
                .eq('assigned_volunteer', SYSTEM_USER)
        ]);

        return {
            urgentNeeds: urgent.data || [],
            currentResolves: active.data || [],
            completedResolves: history.data || []
        };
    },

    // ============================================================
    // 4. ROADMAP LOGIC (State Machine)
    // ============================================================
    async acceptRequest(requestId, category, specificDetails) {
        // Determine Roadmap Template based on inputs
        let templateKey = category;
        if (category === 'medical') {
            templateKey = (specificDetails?.sub_type === 'medicine') ? 'medical_medicine' : 'medical_assistance';
        }
        
        const template = ROADMAP_TEMPLATES[templateKey] || ROADMAP_TEMPLATES['general'];

        const initialRoadmap = [{
            stage: template[0], // "Volunteer Assigned"
            timestamp: new Date().toISOString(),
            completed: true
        }];

        const { error } = await supabase
            .from('help_requests')
            .update({ 
                status: 'on_progress',
                assigned_volunteer: SYSTEM_USER,
                roadmap: initialRoadmap
            })
            .eq('id', requestId);

        if (error) throw error;
        return { success: true };
    },

    async updateRoadmapStep(requestId, currentRoadmap, category, specificDetails) {
        // 1. Identify Template
        let templateKey = category;
        if (category === 'medical') {
            templateKey = (specificDetails?.sub_type === 'medicine') ? 'medical_medicine' : 'medical_assistance';
        }
        const template = ROADMAP_TEMPLATES[templateKey] || ROADMAP_TEMPLATES['general'];
        
        // 2. Find Next Step
        const currentStageName = currentRoadmap[currentRoadmap.length - 1].stage;
        const currentIndex = template.indexOf(currentStageName);
        
        if (currentIndex === -1 || currentIndex >= template.length - 1) {
            throw new Error("Roadmap is already at the end.");
        }

        const nextStageName = template[currentIndex + 1];
        
        // 3. Build New Roadmap
        const newStep = {
            stage: nextStageName,
            timestamp: new Date().toISOString(),
            completed: true
        };
        const updatedRoadmap = [...currentRoadmap, newStep];

        // 4. Check Completion
        let newStatus = 'on_progress';
        if (nextStageName === 'COMPLETED') {
            newStatus = 'completed';
        }

        // 5. Update DB
        const { error } = await supabase
            .from('help_requests')
            .update({ 
                roadmap: updatedRoadmap,
                status: newStatus
            })
            .eq('id', requestId);

        if (error) throw error;
        return { success: true, nextStage: nextStageName };
    },

    // --- Helpers ---
    async getLocationSuggestions(text) { return await apiService.searchLocation(text); },
    async getMedicineSuggestions(text) { return await apiService.searchMedicine(text); }
};