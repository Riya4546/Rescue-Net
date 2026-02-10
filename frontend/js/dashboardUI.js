import {
  submitHelpRequest,
  loadDashboard
} from "./dashboardClient.js";

// DEV USER (until auth is ready)
const DEV_USER_ID = "local-dev-user";

const submitBtn = document.getElementById("submitRequest");
const list = document.getElementById("requestsList");

async function refreshDashboard() {
  const data = await loadDashboard(DEV_USER_ID);

  if (data.myRequests.length === 0) {
    list.innerHTML = "You haven't submitted any requests yet.";
    return;
  }

  list.innerHTML = data.myRequests.map(r => `
    <div class="request">
      <strong>${r.title}</strong><br/>
      <span class="urgency ${r.urgency}">${r.urgency}</span>
      <div>${r.location}</div>
    </div>
  `).join("");
}

submitBtn.onclick = async () => {
  await submitHelpRequest(
    {
      title: title.value,
      urgency: urgency.value,
      location: location.value,
      description: description.value
    },
    DEV_USER_ID
  );

  refreshDashboard();
};

// Initial load
refreshDashboard();
