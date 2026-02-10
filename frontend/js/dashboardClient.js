import {
  createHelpRequest,
  getMyRequests,
  getUrgentRequests
} from "../../backend/dashboard/requests.js";

/**
 * Example: submit help request
 */
export async function submitHelpRequest(formData, userId) {
  return await createHelpRequest({
    ...formData,
    userId
  });
}

/**
 * Example: load dashboard data
 */
export async function loadDashboard(userId) {
  const myRequests = await getMyRequests(userId);
  const urgentRequests = await getUrgentRequests();

  return { myRequests, urgentRequests };
}
