// ================================
// LOCAL DEV DATA STORE (BROWSER SAFE)
// ================================
const localRequests = [];
const localResources = [];

// ---------- REQUESTS ----------

export async function submitHelpRequest(data, userId) {
  const request = {
    id: crypto.randomUUID(),
    title: data.title,
    urgency: data.urgency,
    location: data.location,
    description: data.description,
    status: "open",
    created_by: userId,
    created_at: new Date().toISOString()
  };

  localRequests.push(request);
  return request;
}

export async function getMyRequests(userId) {
  return localRequests.filter(r => r.created_by === userId);
}

export async function getUrgentRequests() {
  return localRequests.filter(
    r =>
      r.status === "open" &&
      (r.urgency === "high" || r.urgency === "critical")
  );
}

export async function resolveRequest(requestId, userId) {
  const req = localRequests.find(r => r.id === requestId);
  if (!req) throw new Error("Request not found");
  if (req.created_by !== userId) throw new Error("Unauthorized");

  req.status = "resolved";
  return req;
}

// ---------- RESOURCES ----------

export async function offerResource(data, userId) {
  const resource = {
    id: crypto.randomUUID(),
    title: data.title,
    type: data.type,
    quantity: data.quantity,
    pickupLocation: data.location,
    offered_by: userId,
    created_at: new Date().toISOString()
  };

  localResources.push(resource);
  return resource;
}

export async function getResources() {
  return localResources;
}

// ---------- DASHBOARD ----------

export async function loadDashboard(userId) {
  return {
    myRequests: await getMyRequests(userId),
    urgentRequests: await getUrgentRequests(),
    resources: await getResources()
  };
}
