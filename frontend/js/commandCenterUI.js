import { BackendService } from "./backendService.js";
import { supabase, disableOfflineMode, isOfflineModeEnabled } from "./supabaseClient.js";

const state = {
    actor: null,
    queue: [],
    active: [],
    history: [],
    responders: [],
    stats: {
        queueCount: 0,
        activeCount: 0,
        historyCount: 0,
        criticalUnassigned: 0,
        overdueQueue: 0
    },
    dispatchEnabled: false
};

const actionLocks = new Set();

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeRole(value) {
    return String(value || "").trim().toLowerCase();
}

function isDispatchRole(value) {
    const role = normalizeRole(value);
    if (!role) return false;
    return ["dispatcher", "coordinator", "admin", "command"].some((token) => role.includes(token));
}

function formatDateTime(iso) {
    if (!iso) return "Not recorded";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return date.toLocaleString();
}

function toCaseId(rawId) {
    return String(rawId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function urgencyBadgeClass(value) {
    const urgency = String(value || "").toLowerCase();
    if (urgency === "critical") return "badge badge-critical";
    if (urgency === "high") return "badge badge-high";
    return "badge badge-low";
}

function bindLogoutLink() {
    const logoutLink = document.querySelector(".nav-link.logout");
    if (!logoutLink) return;

    logoutLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
            if (isOfflineModeEnabled()) {
                disableOfflineMode();
            } else {
                await supabase.auth.signOut();
            }
        } catch (error) {
            console.error("Logout failed:", error);
        } finally {
            window.location.href = "index.html";
        }
    });
}

function setMetric(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value ?? "0");
}

function renderStats() {
    setMetric("kpi-queue", state.stats.queueCount || 0);
    setMetric("kpi-active", state.stats.activeCount || 0);
    setMetric("kpi-critical", state.stats.criticalUnassigned || 0);
    setMetric("kpi-overdue", state.stats.overdueQueue || 0);
    setMetric("kpi-role", state.actor?.role || "Volunteer");
}

function renderDispatchNotice() {
    const el = document.getElementById("dispatchNotice");
    if (!el) return;

    if (state.dispatchEnabled) {
        el.className = "notice";
        el.innerHTML = "Dispatcher actions enabled. You can assign and handover cases from this console.";
        return;
    }

    el.className = "notice warn";
    el.innerHTML = "Read-only mode: your role is not Dispatcher/Admin. Update <code>profiles.user_role</code> to enable dispatch actions.";
}

function responderOptionLabel(responder) {
    const name = responder?.full_name || responder?.email || responder?.identity || "Responder";
    const email = responder?.email ? ` (${responder.email})` : "";
    const load = Number(responder?.active_missions || 0);
    const max = Number(responder?.max_active_missions || 3);
    return `${name}${email} • ${load}/${max} active`;
}

function respondersOptions({
    selected = "",
    forQueue = false,
    skipIdentity = ""
} = {}) {
    const selectedKey = String(selected || "").trim().toLowerCase();
    const skipKey = String(skipIdentity || "").trim().toLowerCase();

    const options = state.responders
        .filter((responder) => {
            const key = String(responder.identity || responder.email || "").toLowerCase();
            if (!key) return false;
            if (skipKey && (key === skipKey || (Array.isArray(responder.aliases) && responder.aliases.includes(skipKey)))) {
                return false;
            }
            return true;
        })
        .map((responder) => {
            const key = responder.identity || responder.email;
            const isSelected = selectedKey && responder.aliases?.includes(selectedKey);
            const max = Number(responder.max_active_missions || 3);
            const isAtCapacity = Number(responder.active_missions || 0) >= max;
            const disableForAssignment = isAtCapacity || (forQueue && Number(responder.active_missions || 0) >= max);
            return `<option value="${esc(key)}" ${isSelected ? "selected" : ""} ${disableForAssignment ? "disabled" : ""}>${esc(responderOptionLabel(responder))}</option>`;
        });

    return [`<option value="">Select responder...</option>`, ...options].join("");
}

function renderResponderDirectory() {
    const el = document.getElementById("responderList");
    if (!el) return;

    if (!state.responders.length) {
        el.innerHTML = `<p style="color:#7a8ea1;font-size:0.84rem;">No responder profiles found in <code>profiles/member_records</code>.</p>`;
        return;
    }

    el.innerHTML = state.responders.map((responder) => {
        const availability = String(responder.availability || "available").replace(/_/g, " ");
        const load = Number(responder.active_missions || 0);
        const max = Number(responder.max_active_missions || 3);
        const remaining = Number(responder.remaining_capacity || Math.max(0, max - load));
        return `
            <div class="responder-item">
                <p class="responder-name">${esc(responder.full_name || responder.email || responder.identity)}</p>
                <div class="responder-meta">${esc(responder.user_role || "Volunteer")}${responder.email ? ` • ${esc(responder.email)}` : ""}</div>
                <div class="responder-meta">${load}/${max} active missions • ${remaining} slot${remaining === 1 ? "" : "s"} left</div>
                <span class="status-pill ${esc(responder.availability || "available")}">${esc(availability)}</span>
            </div>
        `;
    }).join("");
}

function queueSlaSummary(item) {
    const dispatch = item?.dispatch_meta || {};
    if (dispatch.isOverdue) {
        return `<span class="sla-overdue"><i class="fas fa-triangle-exclamation"></i> Escalation overdue</span>`;
    }

    if (Number.isFinite(Number(dispatch.minutesToEscalation))) {
        const minutes = Number(dispatch.minutesToEscalation);
        const label = minutes <= 0 ? "Escalation due now" : `Escalation in ${minutes} min`;
        return `<span><i class="fas fa-clock"></i> ${esc(label)}</span>`;
    }

    return `<span><i class="fas fa-clock"></i> SLA window not set</span>`;
}

function renderQueue() {
    const el = document.getElementById("queueList");
    if (!el) return;

    if (!state.queue.length) {
        el.innerHTML = `<p style="color:#7a8ea1; text-align:center; padding:20px;">Queue clear. No unassigned requests.</p>`;
        return;
    }

    el.innerHTML = state.queue.map((item) => {
        const key = toCaseId(item.id);
        const buttonDisabled = !state.dispatchEnabled || !state.responders.length;
        return `
            <article class="case-card queue">
                <div class="case-head">
                    <h3 class="case-title">${esc(item.title || "Untitled Case")}</h3>
                    <span class="${urgencyBadgeClass(item.urgency)}">${esc(item.urgency || "low")}</span>
                </div>
                <div class="case-sub"><i class="fas fa-user"></i> ${esc(item.requester_name || "Unknown requester")}</div>
                <div class="case-sub"><i class="fas fa-location-dot"></i> ${esc(item.location_text || "Unknown location")}</div>
                <div class="case-sub"><i class="fas fa-calendar"></i> ${esc(formatDateTime(item.created_at))}</div>
                <div class="sla-row">${queueSlaSummary(item)}</div>
                <div class="dispatch-row">
                    <select id="dispatch-select-${key}">${respondersOptions({ forQueue: true })}</select>
                    <button ${buttonDisabled ? "disabled" : ""} onclick="window.dispatchQueueCase('${esc(item.id)}','${key}')">Dispatch</button>
                </div>
            </article>
        `;
    }).join("");
}

function currentVolunteerIdentity(caseItem) {
    return String(caseItem?.volunteer_id || caseItem?.assigned_volunteer || "").trim().toLowerCase();
}

function renderActive() {
    const el = document.getElementById("activeList");
    if (!el) return;

    if (!state.active.length) {
        el.innerHTML = `<p style="color:#7a8ea1; text-align:center; padding:20px;">No active missions.</p>`;
        return;
    }

    el.innerHTML = state.active.map((item) => {
        const key = toCaseId(item.id);
        const assigned = item.volunteer_name || item.assigned_volunteer || "Unassigned";
        const skipIdentity = currentVolunteerIdentity(item);
        const buttonDisabled = !state.dispatchEnabled || !state.responders.length;

        return `
            <article class="case-card active">
                <div class="case-head">
                    <h3 class="case-title">${esc(item.title || "Untitled Case")}</h3>
                    <span class="${urgencyBadgeClass(item.urgency)}">${esc(item.urgency || "low")}</span>
                </div>
                <div class="case-sub"><i class="fas fa-user"></i> Requester: ${esc(item.requester_name || "Unknown")}</div>
                <div class="case-sub"><i class="fas fa-hand-holding-heart"></i> Assigned: ${esc(assigned)}</div>
                <div class="case-sub"><i class="fas fa-calendar"></i> ${esc(formatDateTime(item.created_at))}</div>
                <div class="dispatch-row">
                    <select id="handover-select-${key}">${respondersOptions({ skipIdentity })}</select>
                    <button class="handover" ${buttonDisabled ? "disabled" : ""} onclick="window.handoverActiveCase('${esc(item.id)}','${key}')">Handover</button>
                </div>
            </article>
        `;
    }).join("");
}

function renderHistory() {
    const el = document.getElementById("historyList");
    if (!el) return;

    if (!state.history.length) {
        el.innerHTML = `<p style="color:#7a8ea1; text-align:center; padding:20px;">No closed history yet.</p>`;
        return;
    }

    el.innerHTML = state.history.map((item) => {
        const status = String(item.status || "updated").toLowerCase();
        const label = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : status;
        return `
            <article class="case-card">
                <div class="case-head">
                    <h3 class="case-title">${esc(item.title || "Untitled Case")}</h3>
                    <span class="badge badge-low">${esc(label)}</span>
                </div>
                <div class="case-sub"><i class="fas fa-user"></i> Requester: ${esc(item.requester_name || "Unknown")}</div>
                <div class="case-sub"><i class="fas fa-calendar"></i> ${esc(formatDateTime(item.created_at))}</div>
            </article>
        `;
    }).join("");
}

function renderAll() {
    renderStats();
    renderDispatchNotice();
    renderResponderDirectory();
    renderQueue();
    renderActive();
    renderHistory();
}

async function withActionLock(lockKey, task) {
    if (actionLocks.has(lockKey)) return;
    actionLocks.add(lockKey);
    try {
        await task();
    } finally {
        actionLocks.delete(lockKey);
    }
}

window.dispatchQueueCase = async (requestId, caseKey) => {
    if (!state.dispatchEnabled) {
        alert("Dispatch actions require Dispatcher/Admin role.");
        return;
    }

    const select = document.getElementById(`dispatch-select-${caseKey}`);
    const responder = select?.value || "";
    if (!responder) {
        alert("Select a responder before dispatching.");
        return;
    }

    const note = prompt("Optional dispatch note:", "Assigning via command center queue triage.");
    if (note === null) return;

    await withActionLock(`dispatch:${requestId}`, async () => {
        try {
            await BackendService.dispatchMission(requestId, responder, { note });
            alert("Case dispatched successfully.");
            await loadDashboard();
        } catch (error) {
            alert("Dispatch failed: " + (error?.message || "Unknown error"));
        }
    });
};

window.handoverActiveCase = async (requestId, caseKey) => {
    if (!state.dispatchEnabled) {
        alert("Dispatch actions require Dispatcher/Admin role.");
        return;
    }

    const select = document.getElementById(`handover-select-${caseKey}`);
    const responder = select?.value || "";
    if (!responder) {
        alert("Select a responder for handover.");
        return;
    }

    const note = prompt("Handover reason:", "Reassigning mission from command center.");
    if (note === null) return;

    await withActionLock(`handover:${requestId}`, async () => {
        try {
            await BackendService.dispatchMission(requestId, responder, { note });
            alert("Mission handover completed.");
            await loadDashboard();
            window.switchCommandTab("active");
        } catch (error) {
            alert("Handover failed: " + (error?.message || "Unknown error"));
        }
    });
};

window.switchCommandTab = (tabName, ev) => {
    const tabOrder = ["queue", "active", "history"];
    const buttons = Array.from(document.querySelectorAll(".tab-btn"));
    buttons.forEach((button) => button.classList.remove("active"));

    const eventRef = ev || (typeof window !== "undefined" ? window.event : null);
    if (eventRef?.target) {
        eventRef.target.classList.add("active");
    } else {
        const idx = tabOrder.indexOf(tabName);
        if (idx !== -1 && buttons[idx]) buttons[idx].classList.add("active");
    }

    document.querySelectorAll(".tab-content").forEach((panel) => panel.classList.remove("active"));
    const target = document.getElementById(`view-${tabName}`);
    if (target) target.classList.add("active");
};

async function loadDashboard() {
    try {
        const data = await BackendService.getCommandCenterDashboard();
        state.actor = data.actor || null;
        state.queue = Array.isArray(data.queue) ? data.queue : [];
        state.active = Array.isArray(data.active) ? data.active : [];
        state.history = Array.isArray(data.history) ? data.history : [];
        state.responders = Array.isArray(data.responders) ? data.responders : [];
        state.stats = data.stats || state.stats;
        state.dispatchEnabled = isDispatchRole(state.actor?.role);
        renderAll();
    } catch (error) {
        const msg = String(error?.message || "").toLowerCase();
        if (msg.includes("not authenticated") || msg.includes("log in")) {
            alert("Session expired. Please log in again.");
            window.location.href = "login.html";
            return;
        }

        console.error("Command center load failed:", error);
        const queueEl = document.getElementById("queueList");
        if (queueEl) {
            queueEl.innerHTML = `<p style="color:#b33d30;">Failed to load command center data. ${esc(error?.message || "Unknown error")}</p>`;
        }
    }
}

bindLogoutLink();
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadDashboard);
} else {
    loadDashboard();
}
