import { BackendService } from "./backendService.js";

// Global Store to keep track of requests locally
window.volunteerData = {
    urgent: [],
    active: [],
    history: []
};

// ==============================================
// 1. INITIALIZATION & TABS
// ==============================================
async function initVolunteerDashboard() {
    try {
        console.log("Loading Volunteer Dashboard...");
        const data = await BackendService.getVolunteerDashboard();

        // Store data globally
        window.volunteerData.urgent = data.urgentNeeds;
        window.volunteerData.active = data.currentResolves;
        window.volunteerData.history = data.completedResolves;

        // Render all lists
        renderUrgentNeeds();
        renderActiveResolves();
        renderHistory();

    } catch (err) {
        console.error("Dashboard Load Error:", err);
        document.getElementById("urgentList").innerHTML = `<p style="color:red">Error loading data.</p>`;
    }
}

// Tab Switcher Logic
window.switchTab = (tabName) => {
    // 1. Remove active class from all buttons
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    // 2. Add active to clicked button (using event.target)
    if(event && event.target) event.target.classList.add('active');
    
    // 3. Hide all content
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // 4. Show target content
    document.getElementById(`view-${tabName}`).classList.add('active');
};

// ==============================================
// 2. RENDER FUNCTIONS
// ==============================================

// A. Urgent / Queue (Opens Modal on Click)
function renderUrgentNeeds() {
    const container = document.getElementById("urgentList");
    const requests = window.volunteerData.urgent;

    if (requests.length === 0) {
        container.innerHTML = "<p style='color:#999; text-align:center; padding:20px;'>No urgent missions available.</p>";
        return;
    }

    container.innerHTML = requests.map(m => `
        <div class="feed-item" style="border-left: 4px solid var(--accent); background:white; padding:15px; margin-bottom:10px; border-radius:6px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div>
                    <h4 style="margin:0; font-size:1.1rem;">${m.title}</h4>
                    <div style="font-size:0.8rem; color:#666; margin-top:5px;"><i class="fas fa-map-marker-alt"></i> ${m.location_text}</div>
                </div>
                <span class="badge ${m.urgency === 'critical' ? 'badge-critical' : 'badge-low'}">${m.urgency}</span>
            </div>
            <p style="margin: 10px 0; font-size: 0.9rem; color: #555;">${m.description ? m.description.substring(0, 80) + '...' : 'No description.'}</p>
            <button class="btn btn-blue" style="font-size: 0.8rem; padding: 6px 12px;" onclick="window.openModal('${m.id}')">View & Claim</button>
        </div>
    `).join('');
}

// B. Active / In Progress (Shows Progress & Update Button)
function renderActiveResolves() {
    const container = document.getElementById("activeList");
    const requests = window.volunteerData.active;

    if (requests.length === 0) {
        container.innerHTML = "<p style='color:#999; text-align:center; padding:20px;'>You have no active missions.</p>";
        return;
    }

    container.innerHTML = requests.map(req => {
        const roadmap = req.roadmap || [];
        const currentStep = roadmap.length > 0 ? roadmap[roadmap.length - 1].stage : "Started";
        
        // Calculate rough progress percentage (assuming ~6 steps avg)
        const progressPct = Math.min((roadmap.length / 6) * 100, 95); 

        return `
        <div class="active-card">
            <div style="display:flex; justify-content:space-between;">
                <h3 style="margin:0; font-size:1.2rem;">${req.title}</h3>
                <span style="font-size:0.8rem; color:var(--blue); font-weight:bold;">IN PROGRESS</span>
            </div>
            
            <div style="margin-top:10px;">
                <div style="font-size:0.85rem; color:#666; margin-bottom:5px;">
                    Current Status: <strong style="color:#333;">${currentStep}</strong>
                </div>
                <div class="roadmap-progress">
                    <div class="roadmap-bar" style="width: ${progressPct}%"></div>
                </div>
            </div>

            <div style="margin-top:15px; display:flex; justify-content:flex-end;">
                <button onclick="window.updateStatus('${req.id}')" class="btn" style="background: var(--blue); color: white; padding: 8px 15px; border-radius: 4px; font-size: 0.9rem;">
                    Update Status <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `}).join('');
}

// C. History (Simple List)
function renderHistory() {
    const container = document.getElementById("historyList");
    const requests = window.volunteerData.history;

    if (requests.length === 0) {
        container.innerHTML = "<p style='color:#999; text-align:center; padding:20px;'>No completed history yet.</p>";
        return;
    }

    container.innerHTML = requests.map(m => `
        <div style="padding:15px; border-bottom:1px solid #eee; opacity:0.7;">
            <div style="display:flex; justify-content:space-between;">
                <strong>${m.title}</strong>
                <span style="color:var(--success); font-weight:bold;"><i class="fas fa-check-circle"></i> Done</span>
            </div>
            <div style="font-size:0.8rem; color:#888;">${new Date(m.created_at).toLocaleDateString()}</div>
        </div>
    `).join('');
}

// ==============================================
// 3. MODAL & ACTIONS
// ==============================================

// Open Modal (Reads from Global Store)
window.openModal = (id) => {
    // Find request in the 'urgent' list
    const req = window.volunteerData.urgent.find(r => r.id == id);
    if(!req) return;

    // Populate Modal
    document.getElementById("modalTitle").innerText = req.title;
    document.getElementById("modalDesc").innerText = req.description || "No description provided.";
    
    // Draw Preview Roadmap
    const roadmap = req.roadmap || [{stage: "Request Created", completed: true, timestamp: req.created_at}];
    document.getElementById("roadmapContent").innerHTML = roadmap.map(step => `
        <div style="display:flex; align-items:center; margin-bottom:10px;">
            <div style="width:10px; height:10px; background:var(--success); border-radius:50%; margin-right:10px;"></div>
            <div>
                <div style="font-weight:bold; font-size:0.9rem;">${step.stage}</div>
                <div style="font-size:0.7rem; color:#888;">${new Date(step.timestamp).toLocaleTimeString()}</div>
            </div>
        </div>
    `).join('');

    // Setup Claim Button
    const btn = document.getElementById("btnClaim");
    // We attach the click event dynamically
    btn.onclick = () => handleClaim(req);
    
    document.getElementById("detailsModal").style.display = "block";
};

// Handle Claim
async function handleClaim(req) {
    if(!confirm(`Accept mission: ${req.title}?`)) return;
    
    const btn = document.getElementById("btnClaim");
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        await BackendService.acceptRequest(req.id, req.category, req.specific_details);
        alert("Mission Accepted! It has been moved to your 'Active' tab.");
        document.getElementById("detailsModal").style.display = "none";
        
        // Refresh Data
        initVolunteerDashboard();
        // Switch to Active Tab automatically
        window.switchTab('active');

    } catch(e) { 
        alert("Error: " + e.message); 
    } finally {
        btn.innerText = "Claim This Mission";
        btn.disabled = false;
    }
}

// Handle Status Update
window.updateStatus = async (id) => {
    // Find request in Active list
    const req = window.volunteerData.active.find(r => r.id == id);
    if(!req) return;

    if(!confirm("Update to the next stage in the roadmap?")) return;

    try {
        const result = await BackendService.updateRoadmapStep(id, req.roadmap, req.category, req.specific_details);
        
        if(result.nextStage) {
            alert(`Status updated! Next step: ${result.nextStage}`);
        } else {
            alert("Mission Completed! Good job.");
        }
        initVolunteerDashboard();

    } catch (err) { alert("Error: " + err.message); }
};

// Start
document.addEventListener("DOMContentLoaded", initVolunteerDashboard);

// Close Modal Logic
window.onclick = (event) => {
    if (event.target == document.getElementById("detailsModal")) {
        document.getElementById("detailsModal").style.display = "none";
    }
};