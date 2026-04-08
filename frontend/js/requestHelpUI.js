import { BackendService } from "./backendService.js";
import { apiService } from "./apiService.js";
import { supabase, disableOfflineMode, isOfflineModeEnabled } from "./supabaseClient.js";

// GLOBAL STORE
window.allRequests = [];
let isSubmittingRequest = false;
let locationSearchController = null;
let medicineSearchController = null;
let specialistSearchController = null;
const cancelInFlightIds = new Set();

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDateTime(iso) {
    if (!iso) return "Not available";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not available";
    return date.toLocaleString();
}

function getSafetySummary(req) {
    const meta = req?.safety_meta || {};
    if (meta.emergencyActive) {
        return {
            text: `Emergency alert active (${meta.responderStatusLabel || "Responder status unavailable"})`,
            color: "var(--danger)"
        };
    }
    if (meta.isCheckInOverdue) {
        return {
            text: `Responder check-in overdue (${meta.responderStatusLabel || "Live status unavailable"})`,
            color: "#d35400"
        };
    }
    if (meta.responderStatusLabel) {
        return {
            text: `Responder ${meta.responderStatusLabel} | Last check-in: ${formatDateTime(meta.lastCheckInAt)}`,
            color: "var(--success)"
        };
    }
    return {
        text: "Safety updates will appear once a volunteer is assigned.",
        color: "#888"
    };
}

function getTimelineClass(step, isLast) {
    const type = String(step?.event_type || "");
    if (type === "responder_emergency") return "alert";
    if (type.startsWith("safety_") || type.startsWith("responder_")) return "safety";
    return isLast ? "active" : "done";
}

function debounce(fn, delay = 300) {
    let timerId = null;
    return (...args) => {
        clearTimeout(timerId);
        timerId = setTimeout(() => fn(...args), delay);
    };
}

function hideSuggestionList(listEl) {
    if (!listEl) return;
    listEl.innerHTML = "";
    listEl.style.display = "none";
}

function renderSuggestions(listEl, values, onSelect) {
    hideSuggestionList(listEl);
    (values || []).forEach((label) => {
        if (!label) return;
        const li = document.createElement("li");
        li.textContent = label;
        li.addEventListener("click", () => onSelect(label));
        listEl.appendChild(li);
    });
    listEl.style.display = listEl.children.length ? "block" : "none";
}

function clearField(id) {
    const field = document.getElementById(id);
    if (field) field.value = "";
}

function clearMedicalFields() {
    clearField("medType");
    clearField("docDept");
    clearField("medName");
    clearField("medQty");
    if (medicineSearchController) medicineSearchController.abort();
    if (specialistSearchController) specialistSearchController.abort();
    const doctorFields = document.getElementById("doctor-fields");
    const medicineFields = document.getElementById("medicine-fields");
    if (doctorFields) doctorFields.style.display = "none";
    if (medicineFields) medicineFields.style.display = "none";
    hideSuggestionList(document.getElementById("specialist-suggestions"));
    hideSuggestionList(document.getElementById("medicine-suggestions"));
}

function clearBloodFields() {
    clearField("bloodGroup");
    clearField("bloodQty");
}

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

bindLogoutLink();

// --- 1. MODAL & DETAILS LOGIC ---
window.openDetails = (id) => {
    // Find the request object from memory
    const req = window.allRequests.find(r => String(r.id) === String(id));
    
    if (!req) {
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

    const requesterEl = document.getElementById("d-requester");
    if (requesterEl) {
        requesterEl.innerText = req.requester_name || "Unknown requester";
    }

    const volEl = document.getElementById("d-volunteer");
    const volunteerName = req.volunteer_name || req.assigned_volunteer || "";
    volEl.innerText = volunteerName ? `Assigned (${volunteerName})` : "Waiting for Volunteer";
    volEl.style.color = volunteerName ? "var(--blue)" : "#999";

    const safetyEl = document.getElementById("d-safety");
    if (safetyEl) {
        const safety = getSafetySummary(req);
        safetyEl.innerText = safety.text;
        safetyEl.style.color = safety.color;
    }

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
            const statusClass = getTimelineClass(step, isLast);
            const noteHtml = step.note ? `<div class="t-note">${esc(step.note)}</div>` : "";
            return `
                <div class="timeline-step ${statusClass}">
                    <div class="t-title">${esc(step.stage)}</div>
                    <div class="t-time">${esc(formatDateTime(step.timestamp))}</div>
                    ${noteHtml}
                </div>
            `;
        }).join('');
    }

    document.getElementById("detailModal").style.display = 'block';
};

window.cancelRequest = async (id, event, buttonEl = null) => {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const requestId = String(id);
    if (cancelInFlightIds.has(requestId)) return;

    const req = window.allRequests.find((item) => String(item?.id) === requestId);
    if (!req) return;

    const confirmationText = req.status === "on_progress"
        ? "Cancel this active request? Assigned volunteers will lose this mission."
        : "Cancel this request?";
    if (!confirm(confirmationText)) return;

    const reason = prompt("Optional cancellation reason:", "");
    if (reason === null) return;

    cancelInFlightIds.add(requestId);
    const originalText = buttonEl ? buttonEl.textContent : "";
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = "Cancelling...";
    }

    try {
        await BackendService.cancelHelpRequest(requestId, reason);
        alert("Request cancelled successfully.");
        window.location.reload();
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        cancelInFlightIds.delete(requestId);
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = originalText;
        }
    }
};

// Close Modal on Outside Click
window.addEventListener("click", (event) => {
    const modal = document.getElementById("detailModal");
    if (event.target === modal) {
        modal.style.display = "none";
    }
});

// --- 2. INITIALIZATION & RENDERING ---
(async () => {
    try {
        const data = await BackendService.getInitialData({ caseView: "requester" });
        window.allRequests = data.requests; 

        const queued = window.allRequests.filter(r => r.status === 'queued');
        const progress = window.allRequests.filter(r => r.status === 'on_progress');
        const completed = window.allRequests.filter(r => r.status === 'completed' || r.status === 'cancelled');

        const createCard = (r, type) => `
            <div class="status-card ${type}" onclick="window.openDetails('${r.id}')">
                <div class="click-hint">Click for details <i class="fas fa-external-link-alt"></i></div>
                <div style="display:flex; justify-content:space-between;">
                    <strong>${esc(r.title)}</strong>
                    <span class="badge ${r.urgency === 'critical' ? 'badge-critical' : 'badge-low'}">${esc(r.urgency)}</span>
                </div>
                <div style="font-size:0.8rem; color:#666; margin-top:5px;">
                    <i class="fas fa-map-marker-alt"></i> ${esc((r.location_text || "").substring(0, 30))}...
                </div>
                ${type === 'on_progress' ? `<div style="font-size:0.75rem; color:var(--blue); margin-top:5px; font-weight:bold;"><i class="fas fa-cog fa-spin"></i> Active Mission</div>` : ''}
                ${r?.safety_meta?.emergencyActive ? `<div style="font-size:0.75rem; color:var(--danger); margin-top:5px; font-weight:bold;"><i class="fas fa-triangle-exclamation"></i> Responder Emergency Alert</div>` : ''}
                ${r?.can_cancel ? `<div style="margin-top:8px; display:flex; justify-content:flex-end;"><button class="btn" style="font-size:0.72rem; padding:6px 10px; background:#fbe9e7; color:#a33e32;" onclick="window.cancelRequest('${r.id}', event, this)">Cancel Request</button></div>` : ""}
            </div>
        `;

        document.getElementById("listQueue").innerHTML = queued.length ? queued.map(r => createCard(r, 'queued')).join('') : '<p style="text-align:center;color:#ccc">Queue Empty</p>';
        document.getElementById("listProgress").innerHTML = progress.length ? progress.map(r => createCard(r, 'on_progress')).join('') : '<p style="text-align:center;color:#ccc">No Active Missions</p>';
        document.getElementById("listCompleted").innerHTML = completed.length ? completed.map(r => createCard(r, 'completed')).join('') : '<p style="text-align:center;color:#ccc">No History</p>';

    } catch (err) {
        if (isAuthFailure(err)) {
            alert("Your session has expired. Please log in again.");
            window.location.href = "login.html";
            return;
        }
        console.error("Error loading data:", err);
    }
})();

// --- 3. UI UTILITIES ---
window.switchTab = (tabName, ev) => {
    const tabOrder = ["queue", "progress", "completed"];
    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    buttons.forEach(b => b.classList.remove('active'));
    const eventRef = ev || (typeof window !== "undefined" ? window.event : null);
    if (eventRef?.target) {
        eventRef.target.closest('.tab-btn')?.classList.add('active');
    } else {
        const idx = tabOrder.indexOf(tabName);
        if (idx !== -1 && buttons[idx]) buttons[idx].classList.add("active");
    }
    
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`view-${tabName}`);
    if(target) target.classList.add('active');
};

window.handleCategoryChange = () => {
    const cat = document.getElementById("reqCategory").value;
    const medicalInputs = document.getElementById("medical-inputs");
    const bloodInputs = document.getElementById("blood-inputs");

    if (medicalInputs) medicalInputs.style.display = (cat === 'medical') ? 'block' : 'none';
    if (bloodInputs) bloodInputs.style.display = (cat === 'blood') ? 'block' : 'none';

    if (cat !== "medical") {
        clearMedicalFields();
    }
    if (cat !== "blood") {
        clearBloodFields();
    }
};

window.handleMedicalType = () => {
    const medTypeEl = document.getElementById("medType");
    const type = medTypeEl ? medTypeEl.value : "";
    const doctorFields = document.getElementById("doctor-fields");
    const medicineFields = document.getElementById("medicine-fields");

    if (doctorFields) doctorFields.style.display = (type === 'assistance') ? 'block' : 'none';
    if (medicineFields) medicineFields.style.display = (type === 'medicine') ? 'block' : 'none';

    if (type !== "assistance") {
        clearField("docDept");
        hideSuggestionList(document.getElementById("specialist-suggestions"));
    }
    if (type !== "medicine") {
        clearField("medName");
        clearField("medQty");
        hideSuggestionList(document.getElementById("medicine-suggestions"));
    }
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
        if (isSubmittingRequest) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : "";
        isSubmittingRequest = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Broadcasting...";
        }

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
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            isSubmittingRequest = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    };
}

// Auto-suggestions logic
const locInput = document.getElementById("reqLocation");
const locList = document.getElementById("location-suggestions");
if (locInput && locList) {
    let queryToken = 0;
    const runLocationSearch = debounce(async (rawValue) => {
        const val = rawValue.trim();
        if (val.length < 3) {
            queryToken += 1;
            if (locationSearchController) locationSearchController.abort();
            hideSuggestionList(locList);
            return;
        }

        const token = ++queryToken;
        if (locationSearchController) locationSearchController.abort();
        locationSearchController = new AbortController();

        let results = [];
        try {
            results = await apiService.searchLocation(val, { signal: locationSearchController.signal });
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("Location search failed:", error);
            }
            results = [];
        }
        if (token !== queryToken) return;

        const labels = (results || []).slice(0, 8).map((item) => item?.display_name || "");
        renderSuggestions(locList, labels, (label) => {
            locInput.value = label;
            hideSuggestionList(locList);
        });
    }, 300);

    locInput.addEventListener("input", (e) => runLocationSearch(e.target.value || ""));
    locInput.addEventListener("focus", () => {
        if (locList.children.length) locList.style.display = "block";
    });
    locInput.addEventListener("blur", () => {
        setTimeout(() => { locList.style.display = "none"; }, 120);
    });
}

const medInput = document.getElementById("medName");
const medList = document.getElementById("medicine-suggestions");

if (medInput && medList) {
    let queryToken = 0;
    const runMedicineSearch = debounce(async (rawValue) => {
        const val = rawValue.trim();
        if (val.length < 2) {
            queryToken += 1;
            if (medicineSearchController) medicineSearchController.abort();
            hideSuggestionList(medList);
            return;
        }

        const token = ++queryToken;
        if (medicineSearchController) medicineSearchController.abort();
        medicineSearchController = new AbortController();

        let results = [];
        try {
            results = await BackendService.getMedicineSuggestions(val, { signal: medicineSearchController.signal });
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("Medicine search failed:", error);
            }
            results = [];
        }
        if (token !== queryToken) return;

        const labels = (results || [])
            .slice(0, 8)
            .map((item) => (item?.display_name || item?.name || "").trim())
            .filter(Boolean);

        renderSuggestions(medList, labels, (label) => {
            medInput.value = label;
            hideSuggestionList(medList);
        });
    }, 300);

    medInput.addEventListener("input", (e) => runMedicineSearch(e.target.value || ""));

    medInput.addEventListener("focus", () => {
        if (medList.children.length) medList.style.display = "block";
    });

    medInput.addEventListener("blur", () => {
        setTimeout(() => { medList.style.display = "none"; }, 120);
    });
}

const specialistInput = document.getElementById("docDept");
const specialistList = document.getElementById("specialist-suggestions");

if (specialistInput && specialistList) {
    let queryToken = 0;
    const runSpecialistSearch = debounce(async (rawValue) => {
        const val = rawValue.trim();
        if (val.length < 2) {
            queryToken += 1;
            if (specialistSearchController) specialistSearchController.abort();
            hideSuggestionList(specialistList);
            return;
        }

        const token = ++queryToken;
        if (specialistSearchController) specialistSearchController.abort();
        specialistSearchController = new AbortController();

        let results = [];
        try {
            results = await BackendService.getSpecialistSuggestions(val, { signal: specialistSearchController.signal });
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("Specialist search failed:", error);
            }
            results = [];
        }
        if (token !== queryToken) return;

        const labels = (results || [])
            .slice(0, 8)
            .map((item) => (item?.display_name || item?.name || "").trim())
            .filter(Boolean);

        renderSuggestions(specialistList, labels, (label) => {
            specialistInput.value = label;
            hideSuggestionList(specialistList);
        });
    }, 300);

    specialistInput.addEventListener("input", (e) => runSpecialistSearch(e.target.value || ""));

    specialistInput.addEventListener("focus", () => {
        if (specialistList.children.length) specialistList.style.display = "block";
    });

    specialistInput.addEventListener("blur", () => {
        setTimeout(() => { specialistList.style.display = "none"; }, 120);
    });
}
