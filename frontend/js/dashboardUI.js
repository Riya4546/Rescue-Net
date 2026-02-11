import { BackendService } from "./backendService.js";

// DOM Elements
const form = document.getElementById("helpForm");
const listQueue = document.getElementById("listQueue");
const listActive = document.getElementById("listActive");
const statsUrgent = document.getElementById("statsUrgent");
const statsActive = document.getElementById("statsActive");

// 1. INPUT LOGIC: Handle Dynamic Fields (Medicine/Blood)
// Call this function when the "Category" dropdown changes in HTML
window.handleCategoryChange = (category) => {
    const medSection = document.getElementById("medical-inputs"); // ID from your teammate's HTML
    const bloodSection = document.getElementById("blood-inputs"); // ID from your teammate's HTML
    
    // Reset visibility
    if(medSection) medSection.style.display = 'none';
    if(bloodSection) bloodSection.style.display = 'none';

    if (category === 'medical') {
        if(medSection) medSection.style.display = 'block';
    } else if (category === 'blood') {
        if(bloodSection) bloodSection.style.display = 'block';
    }
};

// 2. INPUT LOGIC: Auto-complete Location
window.searchLocation = async (query) => {
    const suggestions = await BackendService.getLocationSuggestions(query);
    // Logic to show suggestions dropdown would go here
    // For now, we just log it to prove API works
    console.log("Location Suggestions:", suggestions);
};

// 3. SUBMIT FORM (Connecting to your Backend)
if (form) {
    form.onsubmit = async (e) => {
        e.preventDefault();
        try {
            // Collect Basic Data
            const input = {
                title: document.getElementById("reqTitle").value,
                urgency: document.getElementById("reqUrgency").value,
                category: document.getElementById("reqCategory").value,
                location: document.getElementById("reqLocation").value,
                description: document.getElementById("reqDescription").value,
                
                // Collect Conditional Data
                medicalType: document.getElementById("medType")?.value,
                medicineName: document.getElementById("medName")?.value,
                medicineQty: document.getElementById("medQty")?.value,
                bloodGroup: document.getElementById("bloodGroup")?.value,
                bloodQty: document.getElementById("bloodQty")?.value
            };

            await BackendService.createHelpRequest(input);
            
            alert("Request Submitted Successfully!");
            form.reset();
            loadDashboard(); // Refresh data

        } catch (err) {
            alert("Error: " + err.message);
        }
    };
}

// 4. LOAD DASHBOARD DATA
async function loadDashboard() {
    try {
        const data = await BackendService.getInitialData();

        // Update Stats
        if(statsUrgent) statsUrgent.innerText = data.urgentCount;
        if(statsActive) statsActive.innerText = data.requests.filter(r => r.status === 'on_progress').length;

        // Render Lists (Simple view)
        renderList(listQueue, data.requests.filter(r => r.status === 'queued'));
        renderList(listActive, data.requests.filter(r => r.status === 'on_progress'));

    } catch (err) { console.error(err); }
}

// Helper
function renderList(container, items) {
    if (!container) return;
    container.innerHTML = items.length ? items.map(r => `
        <div class="card">
            <strong>${r.title}</strong> 
            <span class="badge ${r.urgency}">${r.urgency}</span>
            <br><small>📍 ${r.location_text}</small>
        </div>
    `).join('') : '<p>No requests.</p>';
}

// Initialize
document.addEventListener("DOMContentLoaded", loadDashboard);