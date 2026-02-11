import { dashboardClient } from "./dashboardClient.js";

// --- DOM ELEMENTS (Matching your new Minimal Design) ---
const tabNeedHelp = document.getElementById("tabNeedHelp");
const tabCanHelp = document.getElementById("tabCanHelp");
const needHelpSection = document.getElementById("needHelpSection");
const canHelpSection = document.getElementById("canHelpSection");

const viewMyRequests = document.getElementById("viewMyRequests");
const viewVolunteer = document.getElementById("viewVolunteer");

// The specific lists where data will go
const listMyActive = document.getElementById("listMyActive");
const listMyHistory = document.getElementById("listMyHistory");
const listQueue = document.getElementById("listQueue");
const listHistory = document.getElementById("listHistory");

const activeCount = document.getElementById("activeCount");
const urgentCount = document.getElementById("urgentCount");

// Temporary User ID for Dev
const USER_ID = "local-dev-user"; 

/* --- 1. TOGGLE LOGIC --- */
tabNeedHelp.onclick = () => {
    // Buttons
    tabNeedHelp.classList.add("active");
    tabCanHelp.classList.remove("active");
    
    // Forms
    needHelpSection.style.display = "block";
    canHelpSection.style.display = "none";

    // Feed Views
    viewMyRequests.style.display = "block";
    viewVolunteer.style.display = "none";
};

tabCanHelp.onclick = () => {
    // Buttons
    tabCanHelp.classList.add("active");
    tabNeedHelp.classList.remove("active");

    // Forms
    canHelpSection.style.display = "block";
    needHelpSection.style.display = "none";

    // Feed Views
    viewVolunteer.style.display = "block";
    viewMyRequests.style.display = "none";
};

/* --- 2. DATA RENDERING --- */
async function refreshDisplay() {
    try {
        console.log("Fetching data..."); // Debug log
        const data = await dashboardClient.getInitialData();
        const allRequests = data.requests;

        // FILTER: Split data into "Mine" vs "Others"
        const myActive = allRequests.filter(r => r.created_by === USER_ID && r.status === 'open');
        const myHistory = allRequests.filter(r => r.created_by === USER_ID && r.status !== 'open');
        
        // Queue: Everything that is Open (for volunteers to see)
        const queue = allRequests.filter(r => r.status === 'open'); 
        const history = allRequests.filter(r => r.status === 'resolved');

        // UPDATE STATS
        activeCount.innerText = queue.length;
        urgentCount.innerText = data.urgentCount;

        // RENDER LISTS
        renderList(listMyActive, myActive, "You have no active requests.");
        renderList(listMyHistory, myHistory, "No past history.");
        renderList(listQueue, queue, "All clear! No pending requests.");
        renderList(listHistory, history, "No community history yet.");

    } catch (err) {
        console.error("Connection Error:", err);
        alert("Lost connection to Backend. Check console.");
    }
}

// Helper to draw the clean Minimal cards
function renderList(container, items, emptyMsg) {
    if (!container) return; // Safety check
    
    if (items.length === 0) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #aaa; font-size: 0.9rem;">${emptyMsg}</div>`;
        return;
    }
    
    container.innerHTML = items.map(req => `
        <div class="request-item">
            <div class="item-top">
                <span class="item-title">${req.title}</span>
                <span class="badge ${req.urgency}">${req.urgency}</span>
            </div>
            <div class="item-desc">${req.description || 'No details provided.'}</div>
            <div class="item-meta">
                <span>📍 ${req.location}</span>
                <span>•</span>
                <span>${new Date(req.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
}

/* --- 3. FORM SUBMISSIONS --- */
document.getElementById("helpForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitRequestBtn");
    btn.disabled = true; btn.innerText = "Broadcasting...";

    try {
        await dashboardClient.postRequest({
            title: document.getElementById("reqTitle").value,
            urgency: document.getElementById("reqUrgency").value,
            location: document.getElementById("reqLocation").value,
            description: document.getElementById("reqDescription").value
        });
        e.target.reset();
        await refreshDisplay();
    } catch (err) { alert(err.message); } 
    finally { btn.disabled = false; btn.innerText = "Broadcast Request"; }
};

document.getElementById("resourceForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitResourceBtn");
    btn.disabled = true; btn.innerText = "Registering...";

    try {
        await dashboardClient.offerResource({
            title: document.getElementById("resTitle").value,
            type: document.getElementById("resType").value,
            quantity: document.getElementById("resQty").value,
            location: document.getElementById("resLocation").value
        });
        e.target.reset();
        await refreshDisplay();
    } catch (err) { alert(err.message); } 
    finally { btn.disabled = false; btn.innerText = "Register Resource"; }
};

// Initialize
document.addEventListener("DOMContentLoaded", refreshDisplay);