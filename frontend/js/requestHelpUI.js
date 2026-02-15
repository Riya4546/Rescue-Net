import { BackendService } from "./backendService.js";
import { apiService } from "./apiService.js";

// GLOBAL STORE
window.allRequests = [];

// --- 1. MODAL & DETAILS LOGIC ---
window.openDetails = (id) => {
    console.log("Opening details for ID:", id); 

    // Find the request object from memory
    const req = window.allRequests.find(r => r.id == id);
    
    if (!req) {
        console.error("Request not found in memory for ID:", id);
        return;
    }

    // Fill Text Fields
    document.getElementById("d-title").innerText = req.title || "No Title";
    document.getElementById("d-status").innerText = (req.status || "").replace('_', ' ').toUpperCase();
    document.getElementById("d-category").innerText = (req.category || "").toUpperCase();
    document.getElementById("d-date").innerText = new Date(req.created_at).toLocaleString();
    document.getElementById("d-desc").innerText = req.description || "No specific description provided.";
    
    const locEl = document.getElementById("d-location").querySelector('span');
    if (locEl) locEl.innerText = req.location_text || "Unknown Location";

    const volEl = document.getElementById("d-volunteer");
    volEl.innerText = req.assigned_volunteer ? `Assigned (${req.assigned_volunteer})` : "Waiting for Volunteer";
    volEl.style.color = req.assigned_volunteer ? "var(--blue)" : "#999";

    // Format Specifics
    let specText = "None";
    if (req.specific_details) {
        const s = req.specific_details;
        if (req.category === 'blood') {
            specText = `Group: ${s.group || '?'}, Qty: ${s.qty_ml || '?'}ml`;
        } else if (req.category === 'medical') {
            specText = s.sub_type === 'medicine' 
                ? `Medicine: ${s.name} (x${s.qty})` 
                : `Doctor: ${s.department}`;
        }
    }
    document.getElementById("d-specifics").innerText = specText;

    // Render Roadmap
    const roadmapDiv = document.getElementById("d-roadmap");
    const roadmap = req.roadmap || [];
    
    if (roadmap.length === 0) {
        roadmapDiv.innerHTML = `<div style="color:#999; font-style:italic; padding-left:10px;">Request created. Pending volunteer action.</div>`;
    } else {
        roadmapDiv.innerHTML = roadmap.map((step, index) => {
            const isLast = index === roadmap.length - 1;
            const statusClass = isLast ? 'active' : 'done'; 
            return `
                <div class="timeline-step ${statusClass}">
                    <div class="t-title">${step.stage}</div>
                    <div class="t-time">${new Date(step.timestamp).toLocaleString()}</div>
                </div>
            `;
        }).join('');
    }

    document.getElementById("detailModal").style.display = 'block';
};

// Close Modal on Outside Click
window.onclick = (event) => {
    const modal = document.getElementById("detailModal");
    if (event.target == modal) {
        modal.style.display = "none";
    }
};

// --- 2. INITIALIZATION & RENDERING ---
(async () => {
    try {
        const data = await BackendService.getInitialData();
        window.allRequests = data.requests; 
        console.log("Loaded Requests:", window.allRequests); 

        const queued = window.allRequests.filter(r => r.status === 'queued');
        const progress = window.allRequests.filter(r => r.status === 'on_progress');
        const completed = window.allRequests.filter(r => r.status === 'completed');

        const createCard = (r, type) => `
            <div class="status-card ${type}" onclick="window.openDetails('${r.id}')">
                <div class="click-hint">Click for details <i class="fas fa-external-link-alt"></i></div>
                <div style="display:flex; justify-content:space-between;">
                    <strong>${r.title}</strong>
                    <span class="badge ${r.urgency === 'critical' ? 'badge-critical' : 'badge-low'}">${r.urgency}</span>
                </div>
                <div style="font-size:0.8rem; color:#666; margin-top:5px;">
                    <i class="fas fa-map-marker-alt"></i> ${(r.location_text || "").substring(0, 30)}...
                </div>
                ${type === 'on_progress' ? `<div style="font-size:0.75rem; color:var(--blue); margin-top:5px; font-weight:bold;"><i class="fas fa-cog fa-spin"></i> Active Mission</div>` : ''}
            </div>
        `;

        document.getElementById("listQueue").innerHTML = queued.length ? queued.map(r => createCard(r, 'queued')).join('') : '<p style="text-align:center;color:#ccc">Queue Empty</p>';
        document.getElementById("listProgress").innerHTML = progress.length ? progress.map(r => createCard(r, 'on_progress')).join('') : '<p style="text-align:center;color:#ccc">No Active Missions</p>';
        document.getElementById("listCompleted").innerHTML = completed.length ? completed.map(r => createCard(r, 'completed')).join('') : '<p style="text-align:center;color:#ccc">No History</p>';

    } catch (err) { console.error("Error loading data:", err); }
})();

// --- 3. UI UTILITIES ---
window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event && event.target) event.target.closest('.tab-btn').classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`view-${tabName}`);
    if(target) target.classList.add('active');
};

window.handleCategoryChange = () => {
    const cat = document.getElementById("reqCategory").value;
    document.getElementById("medical-inputs").style.display = (cat === 'medical') ? 'block' : 'none';
    document.getElementById("blood-inputs").style.display = (cat === 'blood') ? 'block' : 'none';
};

window.handleMedicalType = () => {
    const type = document.getElementById("medType").value;
    document.getElementById("doctor-fields").style.display = (type === 'assistance') ? 'block' : 'none';
    document.getElementById("medicine-fields").style.display = (type === 'medicine') ? 'block' : 'none';
};

window.getLocation = () => {
    if (!navigator.geolocation) return alert("GPS not supported");
    document.getElementById("reqLocation").value = "Locating...";
    navigator.geolocation.getCurrentPosition(async pos => {
        const addr = await apiService.getAddressFromCoords(pos.coords.latitude, pos.coords.longitude);
        document.getElementById("reqLocation").value = addr;
    });
};

// --- 4. FORM SUBMISSION ---
const form = document.getElementById("helpForm");
if(form) {
    form.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const input = {
                title: document.getElementById("reqTitle").value,
                category: document.getElementById("reqCategory").value,
                urgency: document.getElementById("reqUrgency").value,
                location: document.getElementById("reqLocation").value,
                description: document.getElementById("reqDescription").value,
                medicalType: document.getElementById("medType").value,
                docDept: document.getElementById("docDept").value,
                medicineName: document.getElementById("medName").value,
                medicineQty: document.getElementById("medQty").value,
                bloodGroup: document.getElementById("bloodGroup").value,
                bloodQty: document.getElementById("bloodQty").value
            };
            await BackendService.createHelpRequest(input);
            alert("Request Broadcasted Successfully!");
            window.location.reload();
        } catch (err) { alert("Error: " + err.message); }
    };
}

// Auto-suggestions logic
const locInput = document.getElementById("reqLocation");
if(locInput) {
    locInput.addEventListener('input', async (e) => {
        const val = e.target.value;
        const list = document.getElementById("location-suggestions");
        if(val.length < 3) { list.style.display = 'none'; return; }
        const results = await apiService.searchLocation(val);
        list.innerHTML = results.map(r => `<li onclick="document.getElementById('reqLocation').value = '${r.display_name.replace(/'/g,"")}'; this.parentElement.style.display='none'">${r.display_name}</li>`).join('');
        list.style.display = 'block';
    });
}