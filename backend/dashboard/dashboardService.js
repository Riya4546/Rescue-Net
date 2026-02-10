import { getMyRequests, getUrgentRequests } from "./requests.js";
import { getAllResources } from "./resources.js";

/**
 * Get dashboard summary numbers
 * Optimized: single pass counts where possible
 */
export async function getDashboardSummary(userId) {
  if (!userId) throw new Error("User not authenticated");

  const myRequests = await getMyRequests(userId);
  const urgentRequests = await getUrgentRequests();
  const resources = await getAllResources();

  let activeCount = 0;
  for (const req of myRequests) {
    if (req.status === "open") activeCount++;
  }

  return {
    myActiveRequests: activeCount,
    urgentRequests: urgentRequests.length,
    availableResources: resources.length
  };
}

/**
 * Get full dashboard data (for initial page load)
 */
export async function getDashboardData(userId) {
  if (!userId) throw new Error("User not authenticated");

  const [myRequests, urgentRequests, resources] = await Promise.all([
    getMyRequests(userId),
    getUrgentRequests(),
    getAllResources()
  ]);

  return {
    myRequests,
    urgentRequests,
    resources
  };
}
