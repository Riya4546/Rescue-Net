import { BackendService } from "./backendService.js";
import { supabase, disableOfflineMode, isOfflineModeEnabled } from "./supabaseClient.js";

// Global Store to keep track of requests locally
window.volunteerData = {
    urgent: [],
    active: [],
    history: []
};
const actionLocks = new Set();

function isAuthFailure(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("not authenticated") || msg.includes("log in");
}

function bindLogoutLink() {
    const logoutLink = document.querySelector(".nav-link.logout");
    if (!logoutLink) return;

    logoutLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
            if (isOfflineModeEnabled()) {
                disableOfflineMode();
            } else {
                await supabase.auth.signOut();
            }
        } catch (error) {
            console.error("Logout failed:", error);
        } finally {
            window.location.href = "index.html";
        }
    });
}

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDateTime(iso) {
    if (!iso) return "Not recorded";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return date.toLocaleString();
}

function isSafetyEvent(step) {
    const eventType = String(step?.event_type || "");
    const stage = String(step?.stage || "");
    return eventType.startsWith("safety_")
        || eventType.startsWith("responder_")
        || stage.startsWith("Responder Live Status")
        || stage.startsWith("Responder Safety Check-In")
        || stage.startsWith("EMERGENCY")
        || stage.startsWith("Emergency Cleared");
}

function getWorkflowRoadmap(roadmap) {
    return (Array.isArray(roadmap) ? roadmap : []).filter((step) => !isSafetyEvent(step));
}

function getCurrentWorkflowStage(roadmap) {
    const list = Array.isArray(roadmap) ? roadmap : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (!isSafetyEvent(list[i])) {
            return list[i].stage;
        }
    }
    return list.length ? list[list.length - 1].stage : "Started";
}

function getSafetyState(meta = {}) {
    if (meta.emergencyActive) {
        return { cls: "critical", label: "EMERGENCY" };
    }
    if (meta.isCheckInOverdue) {
        return { cls: "warning", label: "CHECK-IN OVERDUE" };
    }
    return { cls: "safe", label: "SAFE" };
}

function setButtonPending(buttonEl, isPending, pendingText = "") {
    if (!buttonEl) return;
    if (isPending) {
        buttonEl.dataset.originalText = buttonEl.innerHTML;
        buttonEl.disabled = true;
        if (pendingText) buttonEl.textContent = pendingText;
        return;
    }
    buttonEl.disabled = false;
    if (buttonEl.dataset.originalText) {
        buttonEl.innerHTML = buttonEl.dataset.originalText;
        delete buttonEl.dataset.originalText;
    }
}

async function withActionLock(lockKey, buttonEl, pendingText, task) {
    if (actionLocks.has(lockKey)) return false;
    actionLocks.add(lockKey);
    setButtonPending(buttonEl, true, pendingText);
    try {
        await task();
        return true;
    } finally {
        actionLocks.delete(lockKey);
        setButtonPending(buttonEl, false);
    }
}

// ==============================================
// 1. INITIALIZATION & TABS
// ==============================================
async function initVolunteerDashboard() {
    try {
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
        if (isAuthFailure(err)) {
            alert("Your session has expired. Please log in again.");
            window.location.href = "login.html";
            return;
        }
        document.getElementById("urgentList").innerHTML = `<p style="color:red">Error loading data.</p>`;
    }
}

// Tab Switcher Logic
window.switchTab = (tabName, ev) => {
    const tabOrder = ["urgent", "active", "history"];
    // 1. Remove active class from all buttons
    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    buttons.forEach(b => b.classList.remove('active'));
    // 2. Add active to clicked button (using event.target)
    const eventRef = ev || (typeof window !== "undefined" ? window.event : null);
    if (eventRef?.target) {
        eventRef.target.classList.add('active');
    } else {
        const idx = tabOrder.indexOf(tabName);
        if (idx !== -1 && buttons[idx]) buttons[idx].classList.add("active");
    }
    
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
                    <h4 style="margin:0; font-size:1.1rem;">${esc(m.title)}</h4>
                    <div style="font-size:0.78rem; color:#2f6da4; margin-top:4px;"><i class="fas fa-user"></i> Requester: ${esc(m.requester_name || "Unknown")}</div>
                    <div style="font-size:0.8rem; color:#666; margin-top:5px;"><i class="fas fa-map-marker-alt"></i> ${esc(m.location_text)}</div>
                </div>
                <span class="badge ${m.urgency === 'critical' ? 'badge-critical' : 'badge-low'}">${esc(m.urgency)}</span>
            </div>
            <p style="margin: 10px 0; font-size: 0.9rem; color: #555;">${esc(m.description ? `${m.description.substring(0, 80)}...` : "No description.")}</p>
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
        const roadmap = Array.isArray(req.roadmap) ? req.roadmap : [];
        const workflowRoadmap = getWorkflowRoadmap(roadmap);
        const currentStep = getCurrentWorkflowStage(roadmap);
        const safetyMeta = req.safety_meta || {};
        const safetyState = getSafetyState(safetyMeta);
        
        // Calculate rough progress percentage (assuming ~6 steps avg)
        const progressPct = Math.min((workflowRoadmap.length / 6) * 100, 95); 

        return `
        <div class="active-card">
            <div style="display:flex; justify-content:space-between;">
                <h3 style="margin:0; font-size:1.2rem;">${esc(req.title)}</h3>
                <span style="font-size:0.8rem; color:var(--blue); font-weight:bold;">IN PROGRESS</span>
            </div>
            <div style="margin-top:6px; font-size:0.82rem; color:#335d84;">
                <i class="fas fa-user"></i> Requester: ${esc(req.requester_name || "Unknown")}
            </div>
            
            <div style="margin-top:10px;">
                <div style="font-size:0.85rem; color:#666; margin-bottom:5px;">
                    Current Status: <strong style="color:#333;">${esc(currentStep)}</strong>
                </div>
                <div class="roadmap-progress">
                    <div class="roadmap-bar" style="width: ${progressPct}%"></div>
                </div>
            </div>

            <div class="safety-panel ${safetyState.cls}">
                <div class="safety-row">
                    <div class="safety-chip ${safetyState.cls}">${safetyState.label}</div>
                    <div class="safety-live">Live: ${esc(safetyMeta.responderStatusLabel || "Unknown")}</div>
                </div>
                <div class="safety-grid">
                    <div><strong>Last check-in:</strong> ${esc(formatDateTime(safetyMeta.lastCheckInAt))}</div>
                    <div><strong>Next due:</strong> ${esc(formatDateTime(safetyMeta.nextCheckInDueAt))}</div>
                </div>
                ${safetyMeta.emergencyActive && safetyMeta.emergencyNote ? `<div class="safety-alert-note"><i class="fas fa-triangle-exclamation"></i> ${esc(safetyMeta.emergencyNote)}</div>` : ""}
            </div>

            <div style="margin-top:15px; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                <button onclick="window.handleSafetyCheckIn('${req.id}', this)" class="btn btn-safety-secondary">
                    Check-In
                </button>
                <button onclick="window.handleLiveStatus('${req.id}', this)" class="btn btn-safety-secondary">
                    Live Status
                </button>
                <button onclick="window.triggerSafetySOS('${req.id}', this)" class="btn btn-safety-danger">
                    SOS
                </button>
                ${safetyMeta.emergencyActive ? `<button onclick="window.clearSafetySOS('${req.id}', this)" class="btn btn-safety-clear">Clear SOS</button>` : ""}
                <button onclick="window.updateStatus('${req.id}', this)" class="btn btn-safety-primary">
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

    container.innerHTML = requests.map(m => {
        const isCancelled = String(m?.status || "") === "cancelled";
        const statusIcon = isCancelled ? "fa-ban" : "fa-check-circle";
        const statusLabel = isCancelled ? "Cancelled" : "Done";
        const statusColor = isCancelled ? "#c0392b" : "var(--success)";
        return `
            <div style="padding:15px; border-bottom:1px solid #eee; opacity:0.7;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>${esc(m.title)}</strong>
                    <span style="color:${statusColor}; font-weight:bold;"><i class="fas ${statusIcon}"></i> ${statusLabel}</span>
                </div>
                <div style="font-size:0.78rem; color:#5a6b7e; margin-top:4px;"><i class="fas fa-user"></i> Requester: ${esc(m.requester_name || "Unknown")}</div>
                <div style="font-size:0.8rem; color:#888;">${esc(formatDateTime(m.created_at))}</div>
            </div>
        `;
    }).join('');
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
    document.getElementById("modalTitle").innerText = req.title || "Mission";
    document.getElementById("modalDesc").innerText = req.description || "No description provided.";
    const tags = document.getElementById("modalTags");
    if (tags) {
        const requester = req.requester_name || "Unknown requester";
        const volunteer = req.volunteer_name || req.assigned_volunteer || "Not assigned";
        tags.innerHTML = `
            <span class="badge" style="margin-right:6px;"><i class="fas fa-user"></i> Requester: ${esc(requester)}</span>
            <span class="badge"><i class="fas fa-hand-holding-heart"></i> Volunteer: ${esc(volunteer)}</span>
        `;
    }
    
    // Draw Preview Roadmap
    const roadmap = req.roadmap || [{stage: "Request Created", completed: true, timestamp: req.created_at}];
    document.getElementById("roadmapContent").innerHTML = roadmap.map(step => `
        <div style="display:flex; align-items:center; margin-bottom:10px;">
            <div style="width:10px; height:10px; background:var(--success); border-radius:50%; margin-right:10px;"></div>
            <div>
                <div style="font-weight:bold; font-size:0.9rem;">${esc(step.stage)}</div>
                <div style="font-size:0.7rem; color:#888;">${esc(formatDateTime(step.timestamp))}</div>
                ${step.note ? `<div style="font-size:0.75rem; color:#666; margin-top:2px;">${esc(step.note)}</div>` : ""}
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
window.updateStatus = async (id, buttonEl = null) => {
    // Find request in Active list
    const req = window.volunteerData.active.find(r => r.id == id);
    if(!req) return;

    if(!confirm("Update to the next stage in the roadmap?")) return;

    await withActionLock(`update-status:${id}`, buttonEl, "Updating...", async () => {
        try {
            const result = await BackendService.updateRoadmapStep(id);
            if(result.nextStage) {
                alert(`Status updated! Next step: ${result.nextStage}`);
            } else {
                alert("Mission Completed! Good job.");
            }
            await initVolunteerDashboard();
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
};

window.handleSafetyCheckIn = async (id, buttonEl = null) => {
    const note = prompt("Optional check-in note (visible to requester):", "Responder safe and continuing mission.");
    if (note === null) return;
    await withActionLock(`checkin:${id}`, buttonEl, "Saving...", async () => {
        try {
            await BackendService.recordSafetyCheckIn(id, note);
            alert("Safety check-in recorded.");
            await initVolunteerDashboard();
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
};

window.handleLiveStatus = async (id, buttonEl = null) => {
    const catalog = BackendService.getResponderLiveStatusCatalog();
    const list = catalog.map((item, idx) => `${idx + 1}. ${item.label}`).join("\n");
    const pick = prompt(`Select responder live status:\n${list}\n\nEnter a number (1-${catalog.length}).`, "2");
    if (pick === null) return;

    const index = Number(pick) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= catalog.length) {
        alert("Invalid status selection.");
        return;
    }

    const note = prompt("Optional note for this live status:", "");
    if (note === null) return;

    await withActionLock(`live-status:${id}`, buttonEl, "Saving...", async () => {
        try {
            await BackendService.updateResponderLiveStatus(id, catalog[index].value, note);
            alert("Live status updated.");
            await initVolunteerDashboard();
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
};

window.triggerSafetySOS = async (id, buttonEl = null) => {
    const note = prompt("Emergency details (shared to requester):", "Need immediate backup support.");
    if (note === null) return;
    if (!confirm("Trigger emergency fail-safe for this mission now?")) return;

    await withActionLock(`trigger-sos:${id}`, buttonEl, "Triggering...", async () => {
        try {
            await BackendService.triggerEmergencyFailSafe(id, note);
            alert("Emergency fail-safe triggered.");
            await initVolunteerDashboard();
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
};

window.clearSafetySOS = async (id, buttonEl = null) => {
    const note = prompt("Resolution note:", "Responder safe. Situation stabilized.");
    if (note === null) return;

    await withActionLock(`clear-sos:${id}`, buttonEl, "Clearing...", async () => {
        try {
            await BackendService.clearEmergencyFailSafe(id, note);
            alert("Emergency state cleared.");
            await initVolunteerDashboard();
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
};

// Start
bindLogoutLink();
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVolunteerDashboard);
} else {
    initVolunteerDashboard();
}

// Close Modal Logic
window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("detailsModal")) {
        document.getElementById("detailsModal").style.display = "none";
    }
});
