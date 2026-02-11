import { createHelpRequest, getMyRequests } from "./dashboard/requests.js";

async function run() {
  const req = await createHelpRequest({
    title: "Test Request",
    urgency: "high",
    location: "Chennai",
    description: "Testing Supabase",
    created_by: "local-dev-user"
  });

  console.log("Inserted:", req);

  const mine = await getMyRequests("local-dev-user");
  console.log("My Requests:", mine);
}

run();
