import { dashboardClient } from "./dashboardClient.js";

// DOM Elements
const tabNeedHelp = document.getElementById("tabNeedHelp");
const tabCanHelp = document.getElementById("tabCanHelp");
const needHelpSection = document.getElementById("needHelpSection");
const canHelpSection = document.getElementById("canHelpSection");

const requestsList = document.getElementById("requestsList");
const activeCount = document.getElementById("activeCount");
const urgentCount = document.getElementById("urgentCount");
const resourceCount = document.getElementById("resourceCount");

/* --- TOGGLE LOGIC --- */
tabNeedHelp.onclick = () => {
    tabNeedHelp.classList.add("active");
    tabCanHelp.classList.remove("active");
    needHelpSection.style.display = "block";
    canHelpSection.style.display = "none";
};

tabCanHelp.onclick = () => {
    tabCanHelp.classList.add("active");
    tabNeedHelp.classList.remove("active");
    canHelpSection.style.display = "block";
    needHelpSection.style.display = "none";
};

/* --- DATA SYNC --- */
async function refreshDisplay() {
    try {
        // Correctly calling the method on the imported object
        const data = await dashboardClient.getInitialData();
        
        activeCount.innerText = data.requests.length;
        urgentCount.innerText = data.urgentCount;
        resourceCount.innerText = data.resourceCount;

        if (data.requests.length === 0) {
            requestsList.innerHTML = "<p>No active requests found.</p>";
            return;
        }

        requestsList.innerHTML = data.requests.map(req => `
            <div class="request-item">
                <span class="badge ${req.urgency}">${req.urgency}</span>
                <h4>${req.title}</h4>
                <p>${req.description || ''}</p>
                <small>📍 ${req.location}</small>
            </div>
        `).join('');
    } catch (err) {
        console.error("UI Sync Error:", err);
    }
}

/* --- FORM SUBMISSIONS --- */
document.getElementById("helpForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitRequestBtn");
    const payload = {
        title: document.getElementById("reqTitle").value,
        urgency: document.getElementById("reqUrgency").value,
        location: document.getElementById("reqLocation").value,
        description: document.getElementById("reqDescription").value
    };

    btn.disabled = true;
    btn.innerText = "Posting...";

    try {
        await dashboardClient.postRequest(payload);
        e.target.reset();
        await refreshDisplay();
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Post Request";
    }
};

document.getElementById("resourceForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitResourceBtn");
    const payload = {
        title: document.getElementById("resTitle").value,
        type: document.getElementById("resType").value,
        quantity: document.getElementById("resQty").value,
        location: document.getElementById("resLocation").value
    };

    btn.disabled = true;
    btn.innerText = "Registering...";

    try {
        await dashboardClient.offerResource(payload);
        e.target.reset();
        await refreshDisplay();
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Offer Resource";
    }
};

document.addEventListener("DOMContentLoaded", refreshDisplay);