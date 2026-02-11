import {
  createHelpRequest,
  getMyRequests,
  getUrgentRequests,
  resolveRequest
} from "./requests.js";

import {
  offerResource,
  getAllResources
} from "./resources.js";

const DEV_USER_ID = "local-dev-user";

(async () => {
  console.log("\n--- Creating Requests ---");

  const r1 = await createHelpRequest({
    title: "Need medical help",
    type: "Medical",
    urgency: "critical",
    description: "Accident case",
    location: "Zone A",
    userId: DEV_USER_ID
  });

  const r2 = await createHelpRequest({
    title: "Need food supplies",
    type: "Food",
    urgency: "low",
    description: "Family support",
    location: "Zone B",
    userId: DEV_USER_ID
  });

  console.log("My Requests:", await getMyRequests(DEV_USER_ID));
  console.log("Urgent Requests:", await getUrgentRequests());

  console.log("\n--- Resolving Request ---");
  await resolveRequest(r1.id, DEV_USER_ID);
  console.log("After Resolve:", await getMyRequests(DEV_USER_ID));

  console.log("\n--- Offering Resources ---");
  await offerResource({
    title: "Medical Kit",
    type: "Medical",
    quantity: 3,
    pickupLocation: "Hospital Gate",
    userId: DEV_USER_ID
  });

  console.log("All Resources:", await getAllResources());
})();
import { getDashboardSummary, getDashboardData } from "./dashboardService.js";

console.log("\n--- Dashboard Summary ---");
console.log(await getDashboardSummary(DEV_USER_ID));

console.log("\n--- Dashboard Full Data ---");
console.log(await getDashboardData(DEV_USER_ID));
