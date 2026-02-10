// LOCAL DEV STORE (browser-safe)
const localRequests = [];

/**
 * Submit help request (LOCAL MODE)
 */
export async function submitHelpRequest(formData, userId) {
  const request = {
    id: Date.now().toString(),
    ...formData,
    status: "open",
    created_by: userId,
    created_at: new Date().toISOString()
  };

  localRequests.push(request);
  return request;
}

/**
 * Load dashboard data (LOCAL MODE)
 */
export async function loadDashboard(userId) {
  return {
    myRequests: localRequests.filter(r => r.created_by === userId),
    urgentRequests: localRequests.filter(
      r =>
        r.status === "open" &&
        (r.urgency === "high" || r.urgency === "critical")
    )
  };
}
