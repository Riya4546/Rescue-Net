import { BackendService } from "./backendService.js";

// Hardcoded user to match backendService.js defaults
const CURRENT_USER = "local-dev-user"; 

async function initDashboard() {
    console.log("Initializing Dashboard Stats...");
    
    try {
        // 1. Get All Requests
        const data = await BackendService.getInitialData();
        const allRequests = data.requests; // This is the raw array of requests

        // ===============================================
        // COUNTER LOGIC
        // ===============================================

        // 1. Urgent Needs
        // Definition: Status is 'queued' AND Urgency is 'high' or 'critical'
        const urgentCount = allRequests.filter(r => 
            r.status === 'queued' && 
            (r.urgency === 'high' || r.urgency === 'critical')
        ).length;

        // 2. Total on Queue
        // Definition: Status is 'queued' (Waiting for volunteer)
        const queueCount = allRequests.filter(r => 
            r.status === 'queued'
        ).length;

        // 3. In Progress (My Active Missions)
        // Definition: Status is 'on_progress' AND assigned_volunteer is ME
        const myActiveCount = allRequests.filter(r => 
            r.status === 'on_progress' && 
            r.assigned_volunteer === CURRENT_USER
        ).length;

        // ===============================================
        // UPDATE UI
        // ===============================================
        updateText("stat-urgent", urgentCount);
        updateText("stat-queue", queueCount);
        updateText("stat-active", myActiveCount);

    } catch (err) {
        console.error("Dashboard Error:", err);
    }
}

// Helper to format numbers (e.g., turn 5 into 05)
function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        // If value is less than 10, add a leading zero
        el.innerText = value < 10 ? `0${value}` : value;
    }
}

// Run when page loads
document.addEventListener("DOMContentLoaded", initDashboard);