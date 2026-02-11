import {
  submitHelpRequest,
  loadDashboard,
  resolveRequest,
  offerResource
} from "./dashboardClient.js";

// DEV USER (until auth is ready)
const DEV_USER_ID = "local-dev-user";

/* ---------------- DOM ---------------- */

// Stats
const activeCount = document.getElementById("activeCount");
const urgentCount = document.getElementById("urgentCount");
const resourceCount = document.getElementById("resourceCount");

// Toggle
const needHelpBtn = document.getElementById("needHelpBtn");
const canHelpBtn = document.getElementById("canHelpBtn");

const needHelpSection = document.getElementById("needHelpSection");
const canHelpSection = document.getElementById("canHelpSection");

// Request form
const submitBtn = document.getElementById("submitRequest");
const list = document.getElementById("requestsList");

const titleInput = document.getElementById("title");
const urgencySelect = document.getElementById("urgency");
const locationInput = document.getElementById("location");
const descriptionInput = document.getElementById("description");

// Resource form
const resourceTitle = document.getElementById("resourceTitle");
const resourceType = document.getElementById("resourceType");
const resourceQuantity = document.getElementById("resourceQuantity");
const resourceLocation = document.getElementById("resourceLocation");
const offerResourceBtn = document.getElementById("offerResourceBtn");

/* ---------------- UI LOGIC ---------------- */

// Toggle logic
needHelpBtn.onclick = () => {
  needHelpBtn.classList.add("active");
  canHelpBtn.classList.remove("active");
  needHelpSection.style.display = "block";
  canHelpSection.style.display = "none";
};

canHelpBtn.onclick = () => {
  canHelpBtn.classList.add("active");
  needHelpBtn.classList.remove("active");
  needHelpSection.style.display = "none";
  canHelpSection.style.display = "block";
};

// Refresh dashboard
async function refreshDashboard() {
  const data = await loadDashboard(DEV_USER_ID);

  activeCount.textContent =
    data.myRequests.filter(r => r.status === "open").length;

  urgentCount.textContent = data.urgentRequests.length;
  resourceCount.textContent = data.resources.length;

  if (data.myRequests.length === 0) {
    list.innerHTML = "You haven't submitted any requests yet.";
    return;
  }

  list.innerHTML = data.myRequests.map(r => `
    <div class="request">
      <strong>${r.title}</strong><br/>
      <span class="urgency ${r.urgency}">${r.urgency}</span>
      <div>${r.location}</div>

      ${
        r.status === "open"
          ? `<button data-id="${r.id}" class="resolve-btn">Resolve</button>`
          : `<em>Resolved</em>`
      }
    </div>
  `).join("");
}

// Submit help request
submitBtn.onclick = async () => {
  try {
    await submitHelpRequest(
      {
        title: titleInput.value,
        urgency: urgencySelect.value,
        location: locationInput.value,
        description: descriptionInput.value
      },
      DEV_USER_ID
    );

    titleInput.value = "";
    urgencySelect.value = "low";
    locationInput.value = "";
    descriptionInput.value = "";

    refreshDashboard();
  } catch (e) {
    console.error(e);
    alert("Failed to submit request");
  }
};

// Resolve request
list.onclick = async (e) => {
  if (e.target.classList.contains("resolve-btn")) {
    await resolveRequest(e.target.dataset.id, DEV_USER_ID);
    refreshDashboard();
  }
};

// Offer resource
offerResourceBtn.onclick = async () => {
  try {
    await offerResource(
      {
        title: resourceTitle.value,
        type: resourceType.value,
        quantity: Number(resourceQuantity.value),
        location: resourceLocation.value
      },
      DEV_USER_ID
    );

    resourceTitle.value = "";
    resourceQuantity.value = "";
    resourceLocation.value = "";

    refreshDashboard();
  } catch (e) {
    console.error(e);
    alert("Failed to register resource");
  }
};

// Init
refreshDashboard();
