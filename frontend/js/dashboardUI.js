import { BackendService } from "./backendService.js";
import { apiService } from "./apiService.js";

// DOM Elements
const form = document.getElementById("helpForm");
const listQueue = document.getElementById("listQueue");
const listActive = document.getElementById("listActive");
const listHistory = document.getElementById("listHistory"); // NEW: History Column
const locationInput = document.getElementById("reqLocation");
const suggestionsList = document.getElementById("location-suggestions");

// ==========================================
// 1. INPUT LOGIC: CATEGORIES & FORMS
// ==========================================

window.handleCategoryChange = (category) => {
    const medSection = document.getElementById("medical-inputs");
    const bloodSection = document.getElementById("blood-inputs");
    
    if(medSection) medSection.style.display = (category === 'medical') ? 'block' : 'none';
    if(bloodSection) bloodSection.style.display = (category === 'blood') ? 'block' : 'none';
};

window.handleMedicalType = (type) => {
    const docFields = document.getElementById("doctor-fields");
    const medFields = document.getElementById("medicine-fields");
    if (!docFields || !medFields) return;

    docFields.style.display = (type === 'assistance') ? 'block' : 'none';
    medFields.style.display = (type === 'medicine') ? 'block' : 'none';
};

// ==========================================
// 2. LOCATION LOGIC: GPS & AUTOCOMPLETE
// ==========================================

window.getLocation = () => {
    if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
    }
    locationInput.value = "Locating you...";
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const address = await apiService.getAddressFromCoords(pos.coords.latitude, pos.coords.longitude);
            locationInput.value = address;
        } catch (err) { locationInput.value = ""; alert("Could not fetch address."); }
    }, () => {
        alert("Permission denied.");
        locationInput.value = "";
    });
};

if (locationInput) {
    locationInput.addEventListener("input", async (e) => {
        const query = e.target.value;
        if (query.length < 3) { suggestionsList.style.display = 'none'; return; }
        
        const results = await apiService.searchLocation(query);
        suggestionsList.innerHTML = results.map(place => `
            <li onclick="window.selectLocation('${place.display_name.replace(/'/g, "\\'")}')">
                <i class="fas fa-map-marker-alt"></i> ${place.display_name}
            </li>
        `).join('');
        suggestionsList.style.display = results.length ? 'block' : 'none';
    });
}

window.selectLocation = (address) => {
    locationInput.value = address;
    suggestionsList.style.display = 'none';
};

// ==========================================
// 3. DATA & RENDERING: ROADMAPS & LISTS
// ==========================================

async function loadDashboard() {
    try {
        const data = await BackendService.getInitialData();
        
        // Render 3 Columns
        renderList(listQueue, data.requests.filter(r => r.status === 'queued'));
        renderList(listActive, data.requests.filter(r => r.status === 'on_progress'));
        renderList(listHistory, data.requests.filter(r => r.status === 'completed'));
    } catch (err) { console.error("Load Error:", err); }
}

function renderList(container, items) {
    if (!container) return;
    container.innerHTML = items.length ? items.map(r => `
        <div class="card" onclick='window.openRoadmap(${JSON.stringify(r)})' style="cursor:pointer; border-left: 4px solid ${getStatusColor(r.status)}; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${r.title}</strong> 
                <span class="badge ${r.urgency}">${r.urgency}</span>
            </div>
            <div style="font-size:0.85em; color:#666; margin-top:5px;">📍 ${r.location_text}</div>
            ${renderSpecifics(r)}
        </div>
    `).join('') : '<p style="color:#bbb; text-align:center; padding:10px;">No requests.</p>';
}

function getStatusColor(status) {
    if (status === 'queued') return '#e74c3c';
    if (status === 'on_progress') return '#3498db';
    return '#2ecc71';
}

function renderSpecifics(req) {
    const details = req.specific_details;
    if (!details) return '';
    if (details.department) return `<div style="font-size:0.8em; color:var(--blue);">🩺 ${details.department}</div>`;
    if (details.group) return `<div style="font-size:0.8em; color:var(--danger);">🩸 Group: ${details.group}</div>`;
    return '';
}

// ==========================================
// 4. MODAL & ROADMAP LOGIC
// ==========================================

window.openRoadmap = (req) => {
    document.getElementById("modalTitle").innerText = req.title;
    document.getElementById("modalDesc").innerText = req.description;
    
    // Build Stepper UI
    const roadmap = req.roadmap || [{ stage: "Request Created", completed: true, timestamp: req.created_at }];
    const roadmapHtml = roadmap.map(step => `
        <div class="step ${step.completed ? 'done' : ''}">
            <div class="step-label">${step.stage}</div>
            <div class="step-time">${step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : 'Awaiting...'}</div>
        </div>
    `).join('');

    document.getElementById("roadmapContent").innerHTML = roadmapHtml;
    document.getElementById("detailsModal").style.display = "block";
};

window.closeModal = () => {
    document.getElementById("detailsModal").style.display = "none";
};

// ==========================================
// 5. FORM SUBMISSION
// ==========================================

if (form) {
    form.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const input = {
                title: document.getElementById("reqTitle").value,
                urgency: document.getElementById("reqUrgency").value,
                category: document.getElementById("reqCategory").value,
                location: document.getElementById("reqLocation").value,
                description: document.getElementById("reqDescription").value,
                medicalType: document.getElementById("medType")?.value,
                docDept: document.getElementById("docDept")?.value,
                medicineName: document.getElementById("medName")?.value,
                medicineQty: document.getElementById("medQty")?.value,
                bloodGroup: document.getElementById("bloodGroup")?.value,
                bloodQty: document.getElementById("bloodQty")?.value
            };

            await BackendService.createHelpRequest(input);
            alert("Request Submitted!");
            form.reset();
            loadDashboard();
        } catch (err) { alert(err.message); }
    };
}

// Initialize
document.addEventListener("DOMContentLoaded", loadDashboard);
// Close modal on outside click
window.onclick = (event) => {
    const modal = document.getElementById("detailsModal");
    if (event.target == modal) closeModal();
};