import { loadDashboardData, submitHelpRequest, resolveRequest } from "./dashboardClient.js";

const DEV_USER_ID = "local-dev-user";

// DOM Elements
const listContainer = document.getElementById("requestsList");
const activeStat = document.getElementById("activeCount");

async function refreshUI() {
    const data = await loadDashboardData(DEV_USER_ID);
    if (!data) return;

    // Update Stats
    activeStat.innerText = data.myRequests.filter(r => r.status === 'open').length;
    document.getElementById("urgentCount").innerText = data.urgentCount;
    document.getElementById("resourceCount").innerText = data.resourceCount;

    // Render List (O(N) complexity)
    listContainer.innerHTML = data.myRequests.map(req => `
        <div class="request-card ${req.status}">
            <h4>${req.title} <span class="badge ${req.urgency}">${req.urgency}</span></h4>
            <p>${req.description}</p>
            ${req.status === 'open' 
                ? `<button class="resolve-btn" data-id="${req.id}">Mark Resolved</button>` 
                : '<span class="resolved-tag">Done</span>'}
        </div>
    `).join('');
}

// Event Delegation (Efficient: 1 listener for N items)
listContainer.addEventListener('click', async (e) => {
    if (e.target.classList.contains('resolve-btn')) {
        const id = e.target.dataset.id;
        const { error } = await resolveRequest(id);
        if (!error) refreshUI();
    }
});

// Initialization
document.addEventListener('DOMContentLoaded', refreshUI);