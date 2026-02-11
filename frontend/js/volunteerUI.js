import { BackendService } from "./backendService.js";

// DOM Elements
const urgentList = document.getElementById("urgentList");
const activeList = document.getElementById("activeList");
const historyList = document.getElementById("historyList");

// 1. INITIALIZE DASHBOARD
async function initVolunteerDashboard() {
    try {
        console.log("Loading Volunteer Dashboard...");
        const data = await BackendService.getVolunteerDashboard();

        renderUrgentNeeds(data.urgentNeeds);
        renderActiveResolves(data.currentResolves);
        renderHistory(data.completedResolves);
    } catch (err) {
        console.error("Dashboard Load Error:", err);
    }
}

// 2. RENDER URGENT NEEDS (The "Open" Requests)
function renderUrgentNeeds(requests) {
    if (!urgentList) return;
    urgentList.innerHTML = requests.map(req => `
        <div class="card urgent-card">
            <div class="card-header">
                <span class="badge ${req.urgency}">${req.urgency}</span>
                <span class="time">${new Date(req.created_at).toLocaleTimeString()}</span>
            </div>
            <h3>${req.title}</h3>
            <p>${req.description}</p>
            <div class="card-meta">📍 ${req.location_text}</div>
            <button onclick="window.acceptHelp('${req.id}', '${req.category}')" class="btn-primary">
                Accept & Help
            </button>
        </div>
    `).join('') || '<p class="empty-msg">No urgent needs nearby.</p>';
}

// 3. RENDER ACTIVE RESOLVES (My Current Jobs)
function renderActiveResolves(requests) {
    if (!activeList) return;
    activeList.innerHTML = requests.map(req => {
        // Get current status from the last item in the roadmap array
        const currentStep = req.roadmap[req.roadmap.length - 1].stage;
        
        return `
        <div class="card active-card">
            <h3>${req.title}</h3>
            <div class="roadmap-status">
                <div class="step-indicator">⚡ Current Step: <strong>${currentStep}</strong></div>
                <div class="progress-bar"><div class="fill" style="width: ${req.roadmap.length * 20}%"></div></div>
            </div>
            <button onclick="window.updateStatus('${req.id}', '${req.category}')" class="btn-action">
                Mark "${currentStep}" as Done
            </button>
        </div>
    `}).join('') || '<p class="empty-msg">You have no active tasks.</p>';
}

// 4. GLOBAL WINDOW FUNCTIONS (For Button Clicks)
window.acceptHelp = async (id, category) => {
    if(!confirm("Are you sure you can respond to this request?")) return;
    try {
        await BackendService.acceptRequest(id, category);
        alert("Request Accepted! Moving to your active list.");
        initVolunteerDashboard(); // Refresh UI
    } catch (err) { alert(err.message); }
};

window.updateStatus = async (id, category) => {
    try {
        // In a real app, we'd pass the full roadmap object, 
        // but for now we re-fetch or pass it via data-attribute.
        // Simplified for this demo:
        const data = await BackendService.getVolunteerDashboard();
        const req = data.currentResolves.find(r => r.id === id);
        
        const result = await BackendService.updateRoadmapStep(id, req.roadmap, category, req.specific_details);
        
        if(result.nextStage) {
            alert(`Status updated! Next step: ${result.nextStage}`);
        } else {
            alert("Mission Complete! Great work.");
        }
        initVolunteerDashboard(); // Refresh UI
    } catch (err) { alert(err.message); }
};

// Start
document.addEventListener("DOMContentLoaded", initVolunteerDashboard);