import { supabase } from "./supabaseClient.js";
import { apiService } from "./apiService.js"; 

// ==========================================
// 🚦 ROADMAP DEFINITIONS (Strictly matched to your prompt)
// ==========================================
const ROADMAP_TEMPLATES = {
    // 1. Medical Assistance
    'medical_assistance': [
        "Volunteer Assigned", "Contact Established", "Send Dispatch Unit", 
        "Dispatch Unit Live", "Patients Retrieval", "Return to Base", "COMPLETED"
    ],
    // 2. Medicine Needs
    'medical_medicine': [
        "Volunteer Assigned", "Arrange the Medicine", "Send in Transportation", 
        "Transport Live", "Medicine Delivered", "COMPLETED"
    ],
    // 3. Blood Services
    'blood': [
        "Volunteer Assigned", "Arrange the Blood", "Send in Transportation", 
        "Transport Live", "Blood Delivered", "COMPLETED"
    ],
    // 4. Disaster Response
    'disaster': [
        "Volunteer Assigned", "Arrange Rescue Team", "Send Rescue Team", 
        "Rescue Team Live", "Rescued the Injured", "Admitted to Hospitals", "Returned to Relief Camps", "COMPLETED"
    ],
    // 5. Food & Water
    'food_water': [
        "Volunteer Assigned", "Arrange Food/Essentials", "Send Team", 
        "Team Live", "Deliver Resources", "COMPLETED"
    ],
    // 6. Shelter
    'shelter': [
        "Volunteer Assigned", "CrossCheck Genuine Need", "Check Available Shelters", 
        "Arrange Transportation", "Provide Shelter", "COMPLETED"
    ],
    // Fallback
    'general': ["Volunteer Assigned", "In Progress", "Resolved", "COMPLETED"]
};
const SYSTEM_USER = "local-dev-user";
const DEFAULT_CHECKIN_INTERVAL_MIN = 15;
const LIVE_STATUS_LABELS = {
    contacting: "Contacting requester",
    en_route: "En route",
    on_site: "On site",
    transporting: "Transporting patient/resources",
    coordinating: "Coordinating support",
    returning_base: "Returning to base",
    paused: "Temporarily paused (safe)",
    sos_triggered: "Emergency fail-safe active",
    checked_out: "Mission checked out",
    waiting_assignment: "Waiting assignment"
};
const LIVE_STATUS_OPTIONS = [
    { value: "contacting", label: LIVE_STATUS_LABELS.contacting },
    { value: "en_route", label: LIVE_STATUS_LABELS.en_route },
    { value: "on_site", label: LIVE_STATUS_LABELS.on_site },
    { value: "transporting", label: LIVE_STATUS_LABELS.transporting },
    { value: "coordinating", label: LIVE_STATUS_LABELS.coordinating },
    { value: "returning_base", label: LIVE_STATUS_LABELS.returning_base },
    { value: "paused", label: LIVE_STATUS_LABELS.paused }
];

function throwIfQueryFailed(context, result) {
    if (result?.error) {
        const details = result.error?.message || result.error?.details || "Unknown database error";
        throw new Error(`${context} failed: ${details}`);
    }
}

function getNowIso() {
    return new Date().toISOString();
}

function addMinutes(iso, minutes) {
    const base = new Date(iso).getTime();
    if (Number.isNaN(base)) return null;
    const offset = Number(minutes) * 60 * 1000;
    return new Date(base + offset).toISOString();
}

function clampInterval(rawValue) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) return DEFAULT_CHECKIN_INTERVAL_MIN;
    if (n < 5) return 5;
    if (n > 120) return 120;
    return Math.round(n);
}

function sanitizeNote(text, maxLen = 180) {
    if (typeof text !== "string") return "";
    return text.trim().slice(0, maxLen);
}

function normalizeIdentity(value) {
    return String(value || "").trim().toLowerCase();
}

function toTitleWords(text) {
    return String(text || "")
        .replace(/[._-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveDisplayName(identityValue) {
    const value = String(identityValue || "").trim();
    if (!value) return "Member";
    if (value.includes("@")) {
        const local = value.split("@")[0];
        return toTitleWords(local) || "Member";
    }
    return toTitleWords(value) || "Member";
}

function hasMissingColumnError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("column") && msg.includes("does not exist");
}

function hasMissingRelationError(error, relationName = "") {
    const msg = String(error?.message || "").toLowerCase();
    const relation = String(relationName || "").toLowerCase();
    return msg.includes("relation")
        && msg.includes("does not exist")
        && (!relation || msg.includes(relation));
}

function getRequesterContext(requestLike) {
    const participants = getParticipantsStore(requestLike?.specific_details);
    const requesterIdentity = normalizeIdentity(
        requestLike?.created_by || participants.requester_id || participants.requester_email
    );
    const requesterEmail = normalizeIdentity(
        participants.requester_email
        || (String(participants.requester_id || "").includes("@") ? participants.requester_id : null)
        || (String(requestLike?.created_by || "").includes("@") ? requestLike.created_by : null)
    );
    const requesterAuthId = String(participants.requester_id || "").includes("@")
        ? null
        : normalizeIdentity(participants.requester_id);
    const requesterName = String(participants.requester_name || "").trim()
        || deriveDisplayName(requesterEmail || requesterIdentity);

    return {
        participants,
        requesterIdentity,
        requesterEmail: requesterEmail || null,
        requesterAuthId: requesterAuthId || null,
        requesterName
    };
}

function uniqueNormalized(list) {
    return Array.from(new Set((Array.isArray(list) ? list : []).map(normalizeIdentity).filter(Boolean)));
}

function actorOwnsIdentity(identityValue, actor) {
    const target = normalizeIdentity(identityValue);
    if (!target || !actor) return false;
    const aliases = uniqueNormalized(actor.aliases);
    if (aliases.includes(target)) return true;
    if (normalizeIdentity(actor.email) === target) return true;
    return false;
}

function applyIdentityFilter(queryBuilder, column, aliases) {
    const cleanAliases = uniqueNormalized(aliases);
    if (!cleanAliases.length) {
        return queryBuilder.eq(column, SYSTEM_USER);
    }
    if (cleanAliases.length === 1) {
        return queryBuilder.eq(column, cleanAliases[0]);
    }
    const expression = cleanAliases.map((value) => `${column}.eq.${value}`).join(",");
    return queryBuilder.or(expression);
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getParticipantsStore(specificDetails) {
    const safeSpecifics = ensureObject(specificDetails);
    return ensureObject(safeSpecifics.participants);
}

function mergeParticipantsIntoSpecificDetails(specificDetails, patch) {
    const safeSpecifics = ensureObject(specificDetails);
    const currentParticipants = getParticipantsStore(safeSpecifics);
    return {
        ...safeSpecifics,
        participants: {
            ...currentParticipants,
            ...patch
        }
    };
}

async function getCurrentActorProfile() {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
        throw new Error(error.message || "Unable to read current session.");
    }

    const user = data?.user || null;
    if (!user) {
        throw new Error("Not authenticated. Please log in.");
    }
    const authId = normalizeIdentity(user?.id || "");
    const email = normalizeIdentity(user?.email || "");
    const identity = authId || email;
    if (!identity) {
        throw new Error("Authenticated identity is missing.");
    }

    let profileRecord = null;
    let memberRecord = null;

    if (email) {
        const profileByEmail = await supabase
            .from("profiles")
            .select("id, email, full_name, user_role, location")
            .eq("email", email);
        if (!profileByEmail?.error && Array.isArray(profileByEmail?.data) && profileByEmail.data[0]) {
            profileRecord = profileByEmail.data[0];
        }

        const memberByEmail = await supabase
            .from("member_records")
            .select("id, profile_id, email, full_name, user_role, location")
            .eq("email", email);
        if (!memberByEmail?.error && Array.isArray(memberByEmail?.data) && memberByEmail.data[0]) {
            memberRecord = memberByEmail.data[0];
        }
    }

    if (!profileRecord && authId) {
        const profileById = await supabase
            .from("profiles")
            .select("id, email, full_name, user_role, location")
            .eq("id", authId);
        if (!profileById?.error && Array.isArray(profileById?.data) && profileById.data[0]) {
            profileRecord = profileById.data[0];
        }
    }

    if (!memberRecord && authId) {
        const profileById = await supabase
            .from("member_records")
            .select("id, profile_id, email, full_name, user_role, location")
            .eq("id", authId);
        if (!profileById?.error && Array.isArray(profileById?.data) && profileById.data[0]) {
            memberRecord = profileById.data[0];
        }
    }

    let fullName = String(user?.user_metadata?.full_name || "").trim();
    if (!fullName && profileRecord?.full_name) {
        fullName = String(profileRecord.full_name).trim();
    }
    if (!fullName && memberRecord?.full_name) {
        fullName = String(memberRecord.full_name).trim();
    }
    fullName = fullName || deriveDisplayName(identity);

    const role = String(profileRecord?.user_role || memberRecord?.user_role || "").trim() || "Volunteer";
    const location = String(profileRecord?.location || memberRecord?.location || "").trim() || null;

    if (memberRecord && profileRecord?.id && !memberRecord?.profile_id) {
        try {
            await supabase
                .from("member_records")
                .update({ profile_id: profileRecord.id, full_name: fullName, user_role: role, location })
                .eq("email", email);
        } catch {
            // Best-effort sync; no auth flow interruption.
        }
    }

    if (!memberRecord) {
        const bootstrapProfile = {
            full_name: fullName,
            user_role: role,
            location
        };
        if (profileRecord?.id) bootstrapProfile.profile_id = profileRecord.id;
        if (authId && !profileRecord?.id) bootstrapProfile.id = authId;
        if (email) bootstrapProfile.email = email;
        try {
            await supabase.from("member_records").insert([bootstrapProfile]);
        } catch {
            // Best-effort profile bootstrap; auth flow should not fail if this insert is blocked by policy.
        }
    }

    const aliases = uniqueNormalized([authId, profileRecord?.id, email, identity]);

    return {
        identity,
        email: email || null,
        authId: authId || null,
        fullName,
        role,
        location,
        aliases
    };
}

function getTemplateKey(category, specificDetails) {
    if (category === "medical") {
        return specificDetails?.sub_type === "medicine" ? "medical_medicine" : "medical_assistance";
    }
    return category;
}

function stageToLiveStatus(stageName) {
    const stage = String(stageName || "").toLowerCase();
    if (!stage) return null;
    if (stage.includes("assigned") || stage.includes("contact")) return "contacting";
    if (stage.includes("send") || stage.includes("live")) return "en_route";
    if (stage.includes("retrieval") || stage.includes("rescued") || stage.includes("arrange")) return "on_site";
    if (stage.includes("deliver") || stage.includes("admitted") || stage.includes("transport")) return "transporting";
    if (stage.includes("return")) return "returning_base";
    if (stage.includes("complete")) return "checked_out";
    return null;
}

function getLatestTemplateIndex(roadmap, template) {
    const list = ensureArray(roadmap);
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const idx = template.indexOf(list[i]?.stage);
        if (idx !== -1) return idx;
    }
    return -1;
}

function appendRoadmapEvent(roadmap, { stage, eventType, note, severity, actor = SYSTEM_USER }) {
    const cleanRoadmap = ensureArray(roadmap);
    const event = {
        stage,
        timestamp: getNowIso(),
        completed: true,
        event_type: eventType,
        actor: normalizeIdentity(actor) || SYSTEM_USER
    };
    if (note) event.note = note;
    if (severity) event.severity = severity;
    return [...cleanRoadmap, event];
}

function getSafetyStore(specificDetails) {
    const safeSpecifics = ensureObject(specificDetails);
    return ensureObject(safeSpecifics.safety);
}

function mergeSafetyIntoSpecificDetails(specificDetails, patch) {
    const safeSpecifics = ensureObject(specificDetails);
    const currentSafety = getSafetyStore(safeSpecifics);
    return {
        ...safeSpecifics,
        safety: {
            ...currentSafety,
            ...patch
        }
    };
}

function getDispatchStore(specificDetails) {
    const safeSpecifics = ensureObject(specificDetails);
    return ensureObject(safeSpecifics.dispatch);
}

function mergeDispatchIntoSpecificDetails(specificDetails, patch) {
    const safeSpecifics = ensureObject(specificDetails);
    const currentDispatch = getDispatchStore(safeSpecifics);
    return {
        ...safeSpecifics,
        dispatch: {
            ...currentDispatch,
            ...patch
        }
    };
}

function normalizeRole(value) {
    return String(value || "").trim().toLowerCase();
}

function isResponderRole(value) {
    const role = normalizeRole(value);
    if (!role) return true;
    return [
        "volunteer",
        "responder",
        "paramedic",
        "medic",
        "doctor",
        "nurse",
        "driver",
        "field"
    ].some((token) => role.includes(token));
}

function isDispatchRole(value) {
    const role = normalizeRole(value);
    if (!role) return false;
    return [
        "dispatcher",
        "coordinator",
        "admin",
        "command"
    ].some((token) => role.includes(token));
}

function getDispatchMeta(request) {
    const dispatch = getDispatchStore(request?.specific_details);
    const dueAt = dispatch.escalation_due_at || null;
    const dueMs = dueAt ? new Date(dueAt).getTime() : Number.NaN;
    const nowMs = Date.now();
    const isQueued = String(request?.status || "") === "queued";
    const isOverdue = isQueued && Number.isFinite(dueMs) && dueMs < nowMs;
    const minutesToEscalation = Number.isFinite(dueMs)
        ? Math.round((dueMs - nowMs) / (60 * 1000))
        : null;

    return {
        priorityScore: Number(dispatch.priority_score || 0) || getUrgencyRank(request?.urgency),
        dispatchWindowMin: Number(dispatch.dispatch_window_min || 0) || null,
        escalationDueAt: dueAt,
        isOverdue,
        minutesToEscalation
    };
}

function enrichForCommandCenter(request) {
    return {
        ...enrichRequest(request),
        dispatch_meta: getDispatchMeta(request)
    };
}

function buildSafetyMeta(request) {
    const safety = getSafetyStore(request?.specific_details);
    const interval = clampInterval(safety.check_in_interval_min);
    const roadmap = ensureArray(request?.roadmap);
    const lastRoadmapStatus = stageToLiveStatus(roadmap[roadmap.length - 1]?.stage);

    const responderStatus = request?.status === "queued"
        ? "waiting_assignment"
        : request?.status === "completed"
            ? "checked_out"
            : (safety.responder_status || lastRoadmapStatus || "contacting");

    const lastCheckInAt = safety.last_check_in || null;
    const nextCheckInDueAt = safety.next_check_in_due || (lastCheckInAt ? addMinutes(lastCheckInAt, interval) : null);
    const now = Date.now();
    const dueMs = nextCheckInDueAt ? new Date(nextCheckInDueAt).getTime() : Number.NaN;
    const overdue = request?.status === "on_progress"
        && !safety.emergency_active
        && Number.isFinite(dueMs)
        && now > dueMs;

    return {
        responderStatus,
        responderStatusLabel: LIVE_STATUS_LABELS[responderStatus] || responderStatus.replace(/_/g, " "),
        emergencyActive: Boolean(safety.emergency_active),
        emergencyNote: safety.emergency_note || "",
        emergencyTriggeredAt: safety.emergency_triggered_at || null,
        checkInIntervalMin: interval,
        checkInCount: Number.isFinite(Number(safety.check_in_count)) ? Number(safety.check_in_count) : 0,
        lastCheckInAt,
        nextCheckInDueAt,
        isCheckInOverdue: overdue
    };
}

function enrichRequest(request) {
    const specificDetails = ensureObject(request?.specific_details);
    const participants = getParticipantsStore(specificDetails);
    const requesterId = normalizeIdentity(request?.created_by || participants.requester_id || participants.requester_email);
    const volunteerId = normalizeIdentity(request?.assigned_volunteer || participants.volunteer_id || participants.volunteer_email);
    const requesterName = String(participants.requester_name || "").trim() || deriveDisplayName(requesterId);
    const volunteerName = String(participants.volunteer_name || "").trim() || (volunteerId ? deriveDisplayName(volunteerId) : "");

    return {
        ...request,
        location: request?.location_text,
        safety_meta: buildSafetyMeta(request),
        requester_id: requesterId || null,
        volunteer_id: volunteerId || null,
        requester_name: requesterName || null,
        volunteer_name: volunteerName || null
    };
}

function canActorCancelRequest(request, actor) {
    if (!actor) return false;
    const specificDetails = ensureObject(request?.specific_details);
    const participants = getParticipantsStore(specificDetails);
    const requesterIdentity = normalizeIdentity(
        request?.created_by || participants.requester_id || participants.requester_email
    );
    if (!requesterIdentity) return false;
    const isRequester = actorOwnsIdentity(requesterIdentity, actor);
    const isCancelableStatus = ["queued", "on_progress"].includes(String(request?.status || ""));
    return isRequester && isCancelableStatus;
}

function enrichRequestForActor(request, actor = null) {
    const enriched = enrichRequest(request);
    return {
        ...enriched,
        can_cancel: canActorCancelRequest(enriched, actor)
    };
}

function identityBelongsToAliases(identityValue, aliases) {
    const target = normalizeIdentity(identityValue);
    if (!target) return false;
    const normalizedAliases = uniqueNormalized(aliases);
    return normalizedAliases.includes(target);
}

function isRequesterForActor(request, actorLike) {
    const participants = getParticipantsStore(request?.specific_details);
    const candidates = [
        request?.created_by,
        participants.requester_id,
        participants.requester_email
    ];
    return candidates.some((value) => identityBelongsToAliases(value, actorLike?.aliases));
}

function isVolunteerForActor(request, actorLike) {
    const participants = getParticipantsStore(request?.specific_details);
    const candidates = [
        request?.assigned_volunteer,
        participants.volunteer_id,
        participants.volunteer_email
    ];
    return candidates.some((value) => identityBelongsToAliases(value, actorLike?.aliases));
}

function getLatestRequestActivityAt(request) {
    const createdMs = new Date(request?.created_at || 0).getTime();
    const roadmap = ensureArray(request?.roadmap);
    const latestRoadmapMs = roadmap.reduce((latest, step) => {
        const stepMs = new Date(step?.timestamp || 0).getTime();
        if (!Number.isFinite(stepMs)) return latest;
        return Math.max(latest, stepMs);
    }, 0);
    const latestMs = Math.max(createdMs || 0, latestRoadmapMs || 0);
    if (!Number.isFinite(latestMs) || latestMs <= 0) return null;
    return new Date(latestMs).toISOString();
}

function getUrgencyRank(value) {
    const urgency = String(value || "").toLowerCase();
    if (urgency === "critical") return 3;
    if (urgency === "high") return 2;
    if (urgency === "medium") return 1;
    return 0;
}

function sortRequestsByUrgencyThenOldest(rows) {
    const safeRows = ensureArray(rows);
    return [...safeRows].sort((a, b) => {
        const urgencyDiff = getUrgencyRank(b?.urgency) - getUrgencyRank(a?.urgency);
        if (urgencyDiff !== 0) return urgencyDiff;
        const aMs = new Date(a?.created_at || 0).getTime();
        const bMs = new Date(b?.created_at || 0).getTime();
        return aMs - bMs;
    });
}

function normalizeShortText(value, maxLen = 140) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
}

function normalizeLocationText(value) {
    return normalizeShortText(value, 180).toLowerCase();
}

function mergeRequestsById(requestGroups) {
    const merged = new Map();
    (Array.isArray(requestGroups) ? requestGroups : []).forEach((group) => {
        ensureArray(group).forEach((row) => {
            const key = String(row?.id || "");
            if (!key) return;
            if (!merged.has(key)) merged.set(key, row);
        });
    });
    return Array.from(merged.values());
}

function computeMemberProgressMetrics(rows, actorLike) {
    const safeRows = ensureArray(rows);
    const requesterRows = safeRows.filter((row) => isRequesterForActor(row, actorLike));
    const volunteerRows = safeRows.filter((row) => isVolunteerForActor(row, actorLike));

    const countStatus = (list, status) => list.filter((item) => String(item?.status || "") === status).length;

    const requestedTotal = requesterRows.length;
    const requestedActive = requesterRows.filter((item) => ["queued", "on_progress"].includes(String(item?.status || ""))).length;
    const requestedResolved = countStatus(requesterRows, "completed");
    const requestedCancelled = countStatus(requesterRows, "cancelled");

    const volunteeredTotal = volunteerRows.length;
    const volunteeredActive = countStatus(volunteerRows, "on_progress");
    const volunteeredResolved = countStatus(volunteerRows, "completed");
    const volunteeredCancelled = countStatus(volunteerRows, "cancelled");

    const latestIso = mergeRequestsById([requesterRows, volunteerRows]).reduce((latest, row) => {
        const value = getLatestRequestActivityAt(row);
        if (!value) return latest;
        if (!latest) return value;
        return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, null);

    return {
        requestedTotal,
        requestedActive,
        requestedResolved,
        requestedCancelled,
        volunteeredTotal,
        volunteeredActive,
        volunteeredResolved,
        volunteeredCancelled,
        totalCases: requestedTotal + volunteeredTotal,
        activeCases: requestedActive + volunteeredActive,
        resolvedCases: requestedResolved + volunteeredResolved,
        lastActivityAt: latestIso
    };
}

async function fetchRequestsForAliases(aliases) {
    const cleanAliases = uniqueNormalized(aliases);
    if (!cleanAliases.length) return [];

    let requesterQuery = supabase.from("help_requests").select("*");
    requesterQuery = applyIdentityFilter(requesterQuery, "created_by", cleanAliases);

    let volunteerQuery = supabase.from("help_requests").select("*");
    volunteerQuery = applyIdentityFilter(volunteerQuery, "assigned_volunteer", cleanAliases);

    const [requesterResult, volunteerResult] = await Promise.all([requesterQuery, volunteerQuery]);
    throwIfQueryFailed("Loading requester progress", requesterResult);
    throwIfQueryFailed("Loading volunteer progress", volunteerResult);

    return mergeRequestsById([requesterResult.data, volunteerResult.data]);
}

async function upsertMemberRecordProgress(actorLike, metrics) {
    const normalizedEmail = normalizeIdentity(actorLike?.email);
    if (!normalizedEmail) return;

    const displayName = String(actorLike?.fullName || "").trim() || deriveDisplayName(normalizedEmail);
    const fullPayload = {
        profile_id: actorLike?.authId || null,
        full_name: displayName,
        requested_total: metrics.requestedTotal,
        requested_active: metrics.requestedActive,
        requested_resolved: metrics.requestedResolved,
        requested_cancelled: metrics.requestedCancelled,
        volunteered_total: metrics.volunteeredTotal,
        volunteered_active: metrics.volunteeredActive,
        volunteered_resolved: metrics.volunteeredResolved,
        volunteered_cancelled: metrics.volunteeredCancelled,
        total_cases: metrics.totalCases,
        active_cases: metrics.activeCases,
        resolved_cases: metrics.resolvedCases,
        last_activity_at: metrics.lastActivityAt
    };

    const lookup = await supabase
        .from("member_records")
        .select("*")
        .eq("email", normalizedEmail)
        .limit(1);
    throwIfQueryFailed("Loading member profile", lookup);
    const existing = Array.isArray(lookup.data) && lookup.data.length ? lookup.data[0] : null;

    const updateCandidates = [
        fullPayload,
        {
            full_name: displayName,
            requested_total: metrics.requestedTotal,
            requested_active: metrics.requestedActive,
            requested_resolved: metrics.requestedResolved,
            volunteered_total: metrics.volunteeredTotal,
            volunteered_active: metrics.volunteeredActive,
            volunteered_resolved: metrics.volunteeredResolved,
            total_cases: metrics.totalCases,
            active_cases: metrics.activeCases,
            resolved_cases: metrics.resolvedCases,
            last_activity_at: metrics.lastActivityAt
        },
        {
            full_name: displayName,
            requested_total: metrics.requestedTotal,
            requested_active: metrics.requestedActive,
            requested_resolved: metrics.requestedResolved,
            volunteered_total: metrics.volunteeredTotal,
            volunteered_active: metrics.volunteeredActive,
            volunteered_resolved: metrics.volunteeredResolved
        },
        {
            full_name: displayName
        }
    ];

    const insertCandidates = [
        {
            id: actorLike?.authId || undefined,
            email: normalizedEmail,
            ...fullPayload
        },
        {
            email: normalizedEmail,
            ...fullPayload
        },
        {
            email: normalizedEmail,
            full_name: displayName,
            requested_total: metrics.requestedTotal,
            requested_active: metrics.requestedActive,
            requested_resolved: metrics.requestedResolved,
            volunteered_total: metrics.volunteeredTotal,
            volunteered_active: metrics.volunteeredActive,
            volunteered_resolved: metrics.volunteeredResolved
        },
        {
            email: normalizedEmail,
            full_name: displayName
        }
    ];

    if (existing) {
        for (const payload of updateCandidates) {
            const updateResult = await supabase
                .from("member_records")
                .update(payload)
                .eq("email", normalizedEmail);
            if (!updateResult.error) return;
            const msg = String(updateResult.error?.message || "").toLowerCase();
            if (!(msg.includes("column") && msg.includes("does not exist"))) {
                return;
            }
        }
        return;
    }

    for (const payload of insertCandidates) {
        const cleanPayload = { ...payload };
        if (!cleanPayload.id) delete cleanPayload.id;
        const insertResult = await supabase.from("member_records").insert([cleanPayload]);
        if (!insertResult.error) return;
        const msg = String(insertResult.error?.message || "").toLowerCase();
        if (!(msg.includes("column") && msg.includes("does not exist"))) {
            return;
        }
    }
}

async function syncMemberProgressFromAliases({ aliases = [], email = null, fullName = null, authId = null } = {}) {
    const mergedAliases = uniqueNormalized([...(aliases || []), email, authId]);
    if (!mergedAliases.length) return null;

    const actorLike = {
        aliases: mergedAliases,
        email: normalizeIdentity(email) || null,
        fullName: String(fullName || "").trim() || deriveDisplayName(email || authId || mergedAliases[0]),
        authId: normalizeIdentity(authId) || null
    };

    const rows = await fetchRequestsForAliases(mergedAliases);
    const metrics = computeMemberProgressMetrics(rows, actorLike);
    await upsertMemberRecordProgress(actorLike, metrics);
    return metrics;
}

async function appendWorkHistoryEntries(entries = []) {
    const rows = ensureArray(entries)
        .filter((entry) => normalizeIdentity(entry?.user_email))
        .map((entry) => ({
            user_email: normalizeIdentity(entry.user_email),
            task_name: String(entry.task_name || "").trim() || "RescueNet activity",
            task_status: String(entry.task_status || "").trim() || "Updated",
            created_at: entry.created_at || getNowIso(),
            request_id: entry.request_id ? String(entry.request_id) : null,
            actor_identity: normalizeIdentity(entry.actor_identity || entry.user_email),
            actor_role: String(entry.actor_role || "").trim() || null,
            event_type: String(entry.event_type || "").trim() || null,
            meta: entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)
                ? entry.meta
                : {}
        }));

    if (!rows.length) return;
    let insertResult = await supabase.from("work_history").insert(rows);

    if (insertResult?.error && hasMissingColumnError(insertResult.error)) {
        const fallbackRows = rows.map((row) => ({
            user_email: row.user_email,
            task_name: row.task_name,
            task_status: row.task_status,
            created_at: row.created_at
        }));
        insertResult = await supabase.from("work_history").insert(fallbackRows);
    }

    if (insertResult?.error) {
        console.warn("Work history write skipped:", insertResult.error.message || insertResult.error);
    }
}

async function loadAssignedActiveMissionOrThrow(requestId, actor = null) {
    const currentActor = actor || await getCurrentActorProfile();
    let query = supabase
        .from("help_requests")
        .select("id, title, status, assigned_volunteer, created_by, category, specific_details, roadmap")
        .eq("id", requestId)
        .eq("status", "on_progress");
    query = applyIdentityFilter(query, "assigned_volunteer", currentActor.aliases);

    const { data: mission, error } = await query.single();

    if (error || !mission) {
        throw new Error("Mission not found or not assigned to you.");
    }
    return mission;
}

async function selectAllOrEmpty(tableName) {
    const result = await supabase.from(tableName).select("*");
    if (result?.error) {
        if (hasMissingRelationError(result.error, tableName)) {
            return [];
        }
        throw new Error(`Loading ${tableName} failed: ${result.error.message || result.error}`);
    }
    return ensureArray(result.data);
}

function buildResponderIdentity(profileRow, memberRow, fallbackEmail = "") {
    return normalizeIdentity(
        profileRow?.id
        || memberRow?.profile_id
        || memberRow?.id
        || fallbackEmail
    );
}

async function loadResponderDirectory() {
    const [profileRows, memberRows] = await Promise.all([
        selectAllOrEmpty("profiles"),
        selectAllOrEmpty("member_records")
    ]);

    const profileByEmail = new Map();
    profileRows.forEach((row) => {
        const key = normalizeIdentity(row?.email);
        if (!key) return;
        if (!profileByEmail.has(key)) profileByEmail.set(key, row);
    });

    const memberByEmail = new Map();
    memberRows.forEach((row) => {
        const key = normalizeIdentity(row?.email);
        if (!key) return;
        if (!memberByEmail.has(key)) memberByEmail.set(key, row);
    });

    const mergedKeys = new Set([
        ...profileByEmail.keys(),
        ...memberByEmail.keys()
    ]);

    const responders = Array.from(mergedKeys).map((emailKey) => {
        const profileRow = profileByEmail.get(emailKey) || null;
        const memberRow = memberByEmail.get(emailKey) || null;

        const fullName = String(profileRow?.full_name || memberRow?.full_name || "").trim()
            || deriveDisplayName(emailKey);
        const userRole = String(profileRow?.user_role || memberRow?.user_role || "").trim() || "Volunteer";
        const identity = buildResponderIdentity(profileRow, memberRow, emailKey);
        const aliases = uniqueNormalized([
            identity,
            emailKey,
            profileRow?.id,
            memberRow?.profile_id,
            memberRow?.id
        ]);

        return {
            identity,
            email: emailKey || null,
            full_name: fullName,
            user_role: userRole,
            location: profileRow?.location || memberRow?.location || null,
            aliases
        };
    }).filter((row) => row.identity || row.email);

    return responders
        .filter((row) => isResponderRole(row.user_role))
        .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
}

function resolveResponderFromDirectory(directory, selectedIdentityOrEmail) {
    const selected = normalizeIdentity(selectedIdentityOrEmail);
    if (!selected) return null;
    return ensureArray(directory).find((row) => {
        if (normalizeIdentity(row?.identity) === selected) return true;
        if (normalizeIdentity(row?.email) === selected) return true;
        return uniqueNormalized(row?.aliases).includes(selected);
    }) || null;
}

async function syncProgressForActorLike(actorLike) {
    if (!actorLike?.email) return;
    try {
        await syncMemberProgressFromAliases({
            aliases: actorLike.aliases || [],
            email: actorLike.email,
            fullName: actorLike.fullName || actorLike.full_name,
            authId: actorLike.authId || actorLike.identity || null
        });
    } catch (syncError) {
        console.warn("Member metrics sync skipped:", syncError?.message || syncError);
    }
}

export const BackendService = {

    // ============================================================
    // 1. FETCH DASHBOARD (User View)
    // ============================================================
    async getInitialData(options = {}) {
        const scope = String(options?.scope || "actor").toLowerCase() === "network" ? "network" : "actor";
        const caseView = String(options?.caseView || "all").toLowerCase();

        let actor = null;
        if (scope === "actor") {
            actor = await getCurrentActorProfile();
        } else {
            try {
                actor = await getCurrentActorProfile();
            } catch {
                actor = null;
            }
        }

        let requestRows = [];
        if (scope === "network") {
            const requests = await supabase.from("help_requests").select("*").order("created_at", { ascending: false });
            throwIfQueryFailed("Loading help requests", requests);
            requestRows = ensureArray(requests.data);
        } else {
            requestRows = await fetchRequestsForAliases(actor.aliases);
            requestRows.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
            if (caseView === "requester") {
                requestRows = requestRows.filter((row) => isRequesterForActor(row, actor));
            } else if (caseView === "volunteer") {
                requestRows = requestRows.filter((row) => isVolunteerForActor(row, actor));
            }
        }

        const cleanRequests = requestRows.map((row) => enrichRequestForActor(row, actor));
        const urgentCount = cleanRequests.filter((row) => row?.status === "queued" && getUrgencyRank(row?.urgency) >= 2).length;

        let resourceCount = 0;
        const resourceStat = await supabase.from("resources").select("id", { count: "exact", head: true });
        if (resourceStat?.error) {
            if (!hasMissingRelationError(resourceStat.error, "resources")) {
                throw new Error(`Loading resource count failed: ${resourceStat.error.message || resourceStat.error}`);
            }
        } else {
            resourceCount = resourceStat.count || 0;
        }

        if (actor) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: actor.aliases,
                    email: actor.email,
                    fullName: actor.fullName,
                    authId: actor.authId
                });
            } catch (error) {
                console.warn("Member progress sync skipped:", error?.message || error);
            }
        }

        return {
            requests: cleanRequests,
            urgentCount,
            resourceCount
        };
    },

    // ============================================================
    // 2. SUBMIT REQUEST (Strict Validation Logic)
    // ============================================================
    async createHelpRequest(input) {
        const actor = await getCurrentActorProfile();
        const title = normalizeShortText(input?.title, 110);
        const category = String(input?.category || "").trim();
        const urgency = String(input?.urgency || "low").trim().toLowerCase();
        const location = normalizeShortText(input?.location, 180);
        const description = normalizeShortText(input?.description, 1200);

        // --- A. GENERAL VALIDATION ---
        if (!title || title.length < 4) throw new Error("Title is too short.");
        if (!location) throw new Error("Location is mandatory.");
        if (!["low", "medium", "high", "critical"].includes(urgency)) {
            throw new Error("Invalid urgency selected.");
        }
        
        // Anti-Gibberish (Regex: Prevents 'aaaaa' or 'asdfasdf')
        if (/(.)\1{4,}/.test(title)) throw new Error("Title looks like gibberish.");
        
        // Description Logic: Nullable ONLY if High/Critical
        const isUrgent = urgency === "high" || urgency === "critical";
        if (!isUrgent && description.length < 5) {
            throw new Error("Description is required for Low/Medium urgency.");
        }

        // --- B. CATEGORY SPECIFIC VALIDATION ---
        let specificDetails = {};

        switch (category) {
            case 'medical':
                // Sub-Type: Medicine
                if (input.medicalType === 'medicine') {
                    const medicineName = normalizeShortText(input.medicineName, 80);
                    const medicineQty = Number(input.medicineQty);
                    if (!medicineName) throw new Error("Medicine Name is required.");
                    if (!Number.isFinite(medicineQty) || medicineQty <= 0 || medicineQty > 500) {
                        throw new Error("Invalid Quantity (Max 500).");
                    }
                    specificDetails = { sub_type: "medicine", name: medicineName, qty: Math.round(medicineQty) };
                
                // Sub-Type: Assistance (Doctor)
                } else if (input.medicalType === 'assistance') {
                    const department = normalizeShortText(input.docDept, 90);
                    if (!department) throw new Error("Please select the Department/Specialist required.");
                    specificDetails = { sub_type: "assistance", department };
                
                } else {
                    throw new Error("Please select a valid Medical Service Type.");
                }
                break;

            case "blood":
                const validGroups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
                const bloodQty = Number(input.bloodQty);
                if (!validGroups.includes(input.bloodGroup)) throw new Error("Invalid Blood Group.");
                if (!Number.isFinite(bloodQty) || bloodQty < 100 || bloodQty > 5000) {
                    throw new Error("Blood quantity must be between 100ml and 5000ml.");
                }
                specificDetails = { group: input.bloodGroup, qty_ml: Math.round(bloodQty) };
                break;

            case 'disaster':
            case 'food_water':
            case 'shelter':
                // No internal inputs specified in prompt
                break;

            default:
                throw new Error("Invalid Category.");
        }

        // Prevent rapid duplicate requests from the same requester.
        const candidateRows = await fetchRequestsForAliases(actor.aliases);
        const recentWindowMs = Date.now() - (20 * 60 * 1000);
        const normalizedTitle = title.toLowerCase();
        const normalizedLocation = normalizeLocationText(location);
        const duplicate = candidateRows.find((row) => {
            if (!isRequesterForActor(row, actor)) return false;
            if (!["queued", "on_progress"].includes(String(row?.status || ""))) return false;
            const createdAtMs = new Date(row?.created_at || 0).getTime();
            if (!Number.isFinite(createdAtMs) || createdAtMs < recentWindowMs) return false;
            if (String(row?.category || "") !== category) return false;

            const rowTitle = normalizeShortText(row?.title, 110).toLowerCase();
            const rowLocation = normalizeLocationText(row?.location_text);
            if (!rowTitle || !rowLocation) return false;

            const titleSimilar = rowTitle === normalizedTitle
                || rowTitle.includes(normalizedTitle)
                || normalizedTitle.includes(rowTitle);
            const locationSimilar = rowLocation === normalizedLocation
                || rowLocation.includes(normalizedLocation)
                || normalizedLocation.includes(rowLocation);

            return Boolean(titleSimilar && locationSimilar);
        });

        if (duplicate) {
            throw new Error(`Similar active request already exists (Case ${duplicate.id}). Track that case instead of creating a duplicate.`);
        }

        const nowIso = getNowIso();
        const dispatchWindowMin = urgency === "critical" ? 5 : urgency === "high" ? 15 : urgency === "medium" ? 30 : 60;
        const finalDescription = description || (isUrgent ? "Urgent assistance requested via portal." : "");
        specificDetails = {
            ...specificDetails,
            dispatch: {
                priority_score: getUrgencyRank(urgency),
                dispatch_window_min: dispatchWindowMin,
                escalation_due_at: addMinutes(nowIso, dispatchWindowMin),
                intake_channel: "web_portal"
            }
        };

        specificDetails = mergeParticipantsIntoSpecificDetails(specificDetails, {
            requester_id: actor.identity,
            requester_email: actor.email,
            requester_name: actor.fullName,
            volunteer_id: null,
            volunteer_email: null,
            volunteer_name: null
        });

        // --- C. DATABASE INSERT ---
        const { data, error } = await supabase
            .from('help_requests')
            .insert([{ 
                title,
                urgency,
                category: category,
                location_text: location, 
                description: finalDescription,
                specific_details: specificDetails, 
                status: 'queued',
                created_by: actor.identity,
                roadmap: [{
                    stage: "Request Created",
                    timestamp: nowIso,
                    completed: true,
                    event_type: "request_created",
                    actor: actor.identity
                }]
            }])
            .select();

        if (error) throw error;
        const created = enrichRequest(data[0]);

        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Created help request: ${created.title || input.title || "Untitled request"}`,
                task_status: "Queued",
                created_at: nowIso,
                request_id: created.id,
                actor_identity: actor.identity,
                actor_role: "requester",
                event_type: "request_created",
                meta: {
                    category: created.category || category,
                    urgency: created.urgency || urgency,
                    location: created.location_text || location,
                    dispatch_window_min: dispatchWindowMin
                }
            }
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
        }

        return created;
    },

    async cancelHelpRequest(requestId, reason = "") {
        const actor = await getCurrentActorProfile();
        const cleanReason = sanitizeNote(reason, 240);

        const { data: request, error: fetchError } = await supabase
            .from("help_requests")
            .select("id, title, status, created_by, assigned_volunteer, specific_details, roadmap")
            .eq("id", requestId)
            .single();

        if (fetchError || !request) {
            throw new Error("Request not found.");
        }

        const participants = getParticipantsStore(request.specific_details);
        const requesterIdentity = normalizeIdentity(
            request.created_by || participants.requester_id || participants.requester_email
        );
        if (!requesterIdentity || !actorOwnsIdentity(requesterIdentity, actor)) {
            throw new Error("Only the requester can cancel this request.");
        }

        const currentStatus = String(request.status || "");
        if (currentStatus === "completed" || currentStatus === "cancelled") {
            throw new Error("This request can no longer be cancelled.");
        }
        if (currentStatus === "on_progress" && !cleanReason) {
            throw new Error("Please provide a short cancellation reason for active missions.");
        }

        const nowIso = getNowIso();
        const cancelNote = cleanReason || "Requester cancelled this help request.";
        const updatedRoadmap = appendRoadmapEvent(request.roadmap, {
            stage: "Request Cancelled by Requester",
            eventType: "request_cancelled",
            note: cancelNote,
            severity: "warning",
            actor: actor.identity
        });

        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(request.specific_details, {
            emergency_active: false,
            last_event_at: nowIso,
            cancelled_at: nowIso,
            cancellation_note: cancelNote,
            cancelled_by: actor.identity
        });
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            requester_id: requesterIdentity,
            requester_email: participants.requester_email || (requesterIdentity.includes("@") ? requesterIdentity : null),
            requester_name: String(participants.requester_name || "").trim() || actor.fullName,
            volunteer_id: normalizeIdentity(request.assigned_volunteer || participants.volunteer_id || participants.volunteer_email) || null,
            volunteer_email: participants.volunteer_email || null,
            volunteer_name: String(participants.volunteer_name || "").trim() || null
        });

        let updateQuery = supabase
            .from("help_requests")
            .update({
                status: "cancelled",
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", currentStatus);
        const { data, error } = await updateQuery.select("id, status, specific_details, roadmap");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Request status changed. Refresh and try again.");
        }

        const volunteerEmail = normalizeIdentity(
            participants.volunteer_email
            || (String(participants.volunteer_id || "").includes("@") ? participants.volunteer_id : null)
            || (String(request.assigned_volunteer || "").includes("@") ? request.assigned_volunteer : null)
        );

        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Cancelled help request: ${request.title || request.id}`,
                task_status: "Cancelled",
                created_at: nowIso,
                request_id: request.id,
                actor_identity: actor.identity,
                actor_role: "requester",
                event_type: "request_cancelled",
                meta: {
                    note: cancelNote
                }
            },
            volunteerEmail
                ? {
                    user_email: volunteerEmail,
                    task_name: `Mission cancelled by requester: ${request.title || request.id}`,
                    task_status: "Cancelled",
                    created_at: nowIso,
                    request_id: request.id,
                    actor_identity: actor.identity,
                    actor_role: "requester",
                    event_type: "request_cancelled",
                    meta: {
                        note: cancelNote
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
        }

        if (volunteerEmail && volunteerEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [request.assigned_volunteer, participants.volunteer_id, volunteerEmail],
                    email: volunteerEmail,
                    fullName: participants.volunteer_name || deriveDisplayName(volunteerEmail),
                    authId: String(participants.volunteer_id || "").includes("@") ? null : normalizeIdentity(participants.volunteer_id)
                });
            } catch (syncError) {
                console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, request: enrichRequest(data[0]) };
    },

    // ============================================================
    // 3. VOLUNTEER DASHBOARD (Supply Side)
    // ============================================================
    async getVolunteerDashboard() {
        const actor = await getCurrentActorProfile();
        let activeQuery = supabase.from("help_requests").select("*").eq("status", "on_progress");
        activeQuery = applyIdentityFilter(activeQuery, "assigned_volunteer", actor.aliases);

        let completedHistoryQuery = supabase.from("help_requests").select("*").eq("status", "completed");
        completedHistoryQuery = applyIdentityFilter(completedHistoryQuery, "assigned_volunteer", actor.aliases);

        let cancelledHistoryQuery = supabase.from("help_requests").select("*").eq("status", "cancelled");
        cancelledHistoryQuery = applyIdentityFilter(cancelledHistoryQuery, "assigned_volunteer", actor.aliases);

        // Optimized: Parallel execution
        const [urgent, active, completedHistory, cancelledHistory] = await Promise.all([
            // a) Urgent Needs (Queued, Unassigned)
            supabase.from('help_requests')
                .select('*')
                .eq('status', 'queued')
                .is('assigned_volunteer', null)
                .order('created_at', { ascending: false }),

            // b) Current Resolves (Assigned to ME, In Progress)
            activeQuery,

            // c) Completed (Assigned to ME, Completed)
            completedHistoryQuery,

            // d) Cancelled (Assigned to ME, Cancelled by requester)
            cancelledHistoryQuery
        ]);

        throwIfQueryFailed("Loading urgent missions", urgent);
        throwIfQueryFailed("Loading active missions", active);
        throwIfQueryFailed("Loading completed missions", completedHistory);
        throwIfQueryFailed("Loading cancelled missions", cancelledHistory);

        const urgentNeeds = sortRequestsByUrgencyThenOldest((urgent.data || [])
            .filter((row) => {
                const participants = getParticipantsStore(row?.specific_details);
                const requesterIdentity = normalizeIdentity(
                    row?.created_by || participants.requester_id || participants.requester_email
                );
                return !requesterIdentity || !actorOwnsIdentity(requesterIdentity, actor);
            })
            .map(enrichRequest));
        const historyRows = [...(completedHistory.data || []), ...(cancelledHistory.data || [])]
            .sort((a, b) => {
                const left = new Date(a?.created_at || 0).getTime();
                const right = new Date(b?.created_at || 0).getTime();
                return right - left;
            })
            .map(enrichRequest);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        return {
            urgentNeeds,
            currentResolves: (active.data || []).map(enrichRequest),
            completedResolves: historyRows
        };
    },

    // ============================================================
    // 3b. COMMAND CENTER (Dispatcher View)
    // ============================================================
    async getCommandCenterDashboard() {
        const actor = await getCurrentActorProfile();
        const [requestsResult, responderDirectory] = await Promise.all([
            supabase.from("help_requests").select("*").order("created_at", { ascending: true }),
            loadResponderDirectory()
        ]);
        throwIfQueryFailed("Loading command center cases", requestsResult);

        const rows = ensureArray(requestsResult.data).map(enrichForCommandCenter);
        const queue = sortRequestsByUrgencyThenOldest(
            rows.filter((row) => String(row?.status || "") === "queued" && !normalizeIdentity(row?.assigned_volunteer))
        );
        const active = rows
            .filter((row) => String(row?.status || "") === "on_progress")
            .sort((a, b) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime());
        const history = rows
            .filter((row) => ["completed", "cancelled"].includes(String(row?.status || "")))
            .sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());

        const responders = responderDirectory.map((responder) => {
            const actorLike = { aliases: responder.aliases, email: responder.email };
            const activeMissions = active.filter((row) => isVolunteerForActor(row, actorLike)).length;
            return {
                ...responder,
                active_missions: activeMissions,
                availability: activeMissions > 0 ? "engaged" : "available"
            };
        });

        const stats = {
            queueCount: queue.length,
            activeCount: active.length,
            historyCount: history.length,
            criticalUnassigned: queue.filter((row) => getUrgencyRank(row?.urgency) >= 3).length,
            overdueQueue: queue.filter((row) => row?.dispatch_meta?.isOverdue).length
        };

        return {
            actor,
            queue,
            active,
            history,
            responders,
            stats
        };
    },

    async dispatchMission(requestId, responderIdentityOrEmail, options = {}) {
        const actor = await getCurrentActorProfile();
        if (!isDispatchRole(actor.role)) {
            throw new Error("Dispatch actions require Dispatcher/Admin role.");
        }
        const selectedResponder = normalizeIdentity(responderIdentityOrEmail);
        if (!selectedResponder) {
            throw new Error("Select a responder before dispatching.");
        }

        const responders = await loadResponderDirectory();
        const responder = resolveResponderFromDirectory(responders, selectedResponder);
        if (!responder) {
            throw new Error("Selected responder profile was not found.");
        }

        const { data: mission, error: missionError } = await supabase
            .from("help_requests")
            .select("id, title, status, created_by, assigned_volunteer, category, specific_details, roadmap")
            .eq("id", requestId)
            .single();
        if (missionError || !mission) {
            throw new Error("Case not found.");
        }

        const currentStatus = String(mission.status || "");
        if (!["queued", "on_progress"].includes(currentStatus)) {
            throw new Error("Only queued or active cases can be dispatched/handovered.");
        }

        const currentParticipants = getParticipantsStore(mission.specific_details);
        const currentVolunteerIdentity = normalizeIdentity(
            mission.assigned_volunteer || currentParticipants.volunteer_id || currentParticipants.volunteer_email
        );
        const responderIdentity = normalizeIdentity(responder.identity || responder.email);
        if (!responderIdentity) {
            throw new Error("Responder identity is invalid.");
        }

        if (currentStatus === "on_progress" && currentVolunteerIdentity === responderIdentity) {
            throw new Error("Case is already assigned to this responder.");
        }
        if (currentStatus === "queued" && normalizeIdentity(mission.assigned_volunteer)) {
            throw new Error("Case is already assigned. Refresh the dashboard.");
        }

        const safetyState = getSafetyStore(mission.specific_details);
        if (currentStatus === "on_progress" && safetyState.emergency_active) {
            throw new Error("Cannot handover while emergency fail-safe is active. Clear SOS first.");
        }

        const nowIso = getNowIso();
        const note = normalizeShortText(options?.note || "", 220);
        const requesterContext = getRequesterContext(mission);
        const responderName = responder.full_name || deriveDisplayName(responder.email || responder.identity);

        let updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(mission.specific_details, {
            requester_id: requesterContext.requesterIdentity || currentParticipants.requester_id || mission.created_by || null,
            requester_email: requesterContext.requesterEmail || currentParticipants.requester_email || null,
            requester_name: requesterContext.requesterName || currentParticipants.requester_name || null,
            volunteer_id: responder.identity || responderIdentity,
            volunteer_email: responder.email || (responderIdentity.includes("@") ? responderIdentity : null),
            volunteer_name: responderName
        });

        if (currentStatus === "queued") {
            updatedSpecificDetails = mergeSafetyIntoSpecificDetails(updatedSpecificDetails, {
                responder_status: "contacting",
                emergency_active: false,
                check_in_interval_min: clampInterval(safetyState.check_in_interval_min),
                check_in_count: Number(safetyState.check_in_count) || 0,
                last_event_at: nowIso
            });
        } else {
            updatedSpecificDetails = mergeSafetyIntoSpecificDetails(updatedSpecificDetails, {
                responder_status: "contacting",
                emergency_active: false,
                last_event_at: nowIso
            });
        }

        updatedSpecificDetails = mergeDispatchIntoSpecificDetails(updatedSpecificDetails, {
            last_dispatched_at: nowIso,
            dispatched_by: actor.identity,
            dispatch_channel: "command_center",
            escalation_due_at: null,
            dispatch_note: note || null
        });

        const roadmap = ensureArray(mission.roadmap);
        let updatedRoadmap = [...roadmap];
        if (currentStatus === "queued") {
            const templateKey = getTemplateKey(mission.category, mission.specific_details);
            const template = ROADMAP_TEMPLATES[templateKey] || ROADMAP_TEMPLATES.general;
            updatedRoadmap.push({
                stage: template[0],
                timestamp: nowIso,
                completed: true,
                event_type: "assignment",
                actor: actor.identity
            });
            updatedRoadmap = appendRoadmapEvent(updatedRoadmap, {
                stage: `Dispatcher Assigned: ${responderName}`,
                eventType: "dispatcher_assignment",
                note: note || "Assigned by command center.",
                actor: actor.identity
            });
        } else {
            updatedRoadmap = appendRoadmapEvent(updatedRoadmap, {
                stage: `Mission Handover: ${responderName}`,
                eventType: "dispatcher_handover",
                note: note || "Reassigned by command center.",
                actor: actor.identity
            });
        }

        let updateQuery = supabase
            .from("help_requests")
            .update({
                status: "on_progress",
                assigned_volunteer: responder.identity || responderIdentity,
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId);

        if (currentStatus === "queued") {
            updateQuery = updateQuery.eq("status", "queued").is("assigned_volunteer", null);
        } else {
            updateQuery = updateQuery.eq("status", "on_progress");
            if (normalizeIdentity(mission.assigned_volunteer)) {
                updateQuery = updateQuery.eq("assigned_volunteer", mission.assigned_volunteer);
            }
        }

        const { data: updatedRows, error: updateError } = await updateQuery.select("id, status, assigned_volunteer, specific_details, roadmap");
        if (updateError) throw updateError;
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error("Case changed while dispatching. Refresh and try again.");
        }

        const previousVolunteerEmail = normalizeIdentity(
            currentParticipants.volunteer_email
            || (String(currentParticipants.volunteer_id || "").includes("@") ? currentParticipants.volunteer_id : null)
            || (String(mission.assigned_volunteer || "").includes("@") ? mission.assigned_volunteer : null)
        );
        const actionVerb = currentStatus === "queued" ? "Dispatched" : "Handover";

        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `${actionVerb}: ${mission.title || mission.id} -> ${responderName}`,
                task_status: "On Progress",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "dispatcher",
                event_type: currentStatus === "queued" ? "dispatcher_assignment" : "dispatcher_handover",
                meta: {
                    responder_identity: responder.identity || responderIdentity,
                    responder_email: responder.email || null,
                    note: note || null
                }
            },
            responder.email
                ? {
                    user_email: responder.email,
                    task_name: `Assigned by command center: ${mission.title || mission.id}`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "dispatcher",
                    event_type: currentStatus === "queued" ? "dispatcher_assignment" : "dispatcher_handover",
                    meta: { note: note || null }
                }
                : null,
            requesterContext.requesterEmail
                ? {
                    user_email: requesterContext.requesterEmail,
                    task_name: `Responder assigned by command center: ${mission.title || mission.id}`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "dispatcher",
                    event_type: currentStatus === "queued" ? "dispatcher_assignment" : "dispatcher_handover",
                    meta: {
                        responder_name: responderName
                    }
                }
                : null,
            currentStatus === "on_progress"
            && previousVolunteerEmail
            && previousVolunteerEmail !== responder.email
                ? {
                    user_email: previousVolunteerEmail,
                    task_name: `Mission handover by command center: ${mission.title || mission.id}`,
                    task_status: "Reassigned",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "dispatcher",
                    event_type: "dispatcher_handover",
                    meta: { note: note || null }
                }
                : null
        ]);

        await syncProgressForActorLike({
            aliases: responder.aliases,
            email: responder.email,
            full_name: responder.full_name,
            identity: responder.identity
        });
        await syncProgressForActorLike({
            aliases: [mission.created_by, requesterContext.participants.requester_id, requesterContext.requesterEmail],
            email: requesterContext.requesterEmail,
            full_name: requesterContext.requesterName,
            identity: requesterContext.requesterAuthId
        });
        if (currentStatus === "on_progress" && previousVolunteerEmail && previousVolunteerEmail !== responder.email) {
            await syncProgressForActorLike({
                aliases: [mission.assigned_volunteer, currentParticipants.volunteer_id, previousVolunteerEmail],
                email: previousVolunteerEmail,
                full_name: currentParticipants.volunteer_name || deriveDisplayName(previousVolunteerEmail),
                identity: currentParticipants.volunteer_id
            });
        }

        return {
            success: true,
            mode: currentStatus === "queued" ? "dispatch" : "handover",
            request: enrichForCommandCenter(updatedRows[0])
        };
    },

    // ============================================================
    // 4. ROADMAP LOGIC (State Machine)
    // ============================================================
    async acceptRequest(requestId, _category, _specificDetails) {
        const actor = await getCurrentActorProfile();

        // Operational safeguard: in this build, a responder can hold only one active mission.
        let activeMissionQuery = supabase.from("help_requests").select("id").eq("status", "on_progress");
        activeMissionQuery = applyIdentityFilter(activeMissionQuery, "assigned_volunteer", actor.aliases);
        const activeMissionResult = await activeMissionQuery;
        throwIfQueryFailed("Loading responder active mission", activeMissionResult);
        const existingActive = ensureArray(activeMissionResult.data).find((row) => String(row?.id || "") !== String(requestId));
        if (existingActive) {
            throw new Error("You already have an active mission. Complete it before claiming a new one.");
        }

        // Fetch queued mission from DB (do not trust category/details from client)
        const { data: mission, error: missionError } = await supabase
            .from("help_requests")
            .select("id, title, status, created_by, assigned_volunteer, category, specific_details")
            .eq("id", requestId)
            .single();

        if (missionError || !mission) {
            throw new Error("Mission not found.");
        }

        const missionParticipants = getParticipantsStore(mission.specific_details);
        const missionCreator = normalizeIdentity(
            mission.created_by || missionParticipants.requester_id || missionParticipants.requester_email
        );
        if (missionCreator && actorOwnsIdentity(missionCreator, actor)) {
            throw new Error("You cannot volunteer for your own help request.");
        }

        // Determine Roadmap Template based on DB values
        const templateKey = getTemplateKey(mission.category, mission.specific_details);
        const template = ROADMAP_TEMPLATES[templateKey] || ROADMAP_TEMPLATES['general'];
        const nowIso = getNowIso();
        const initialSafety = {
            responder_status: "contacting",
            emergency_active: false,
            check_in_interval_min: DEFAULT_CHECKIN_INTERVAL_MIN,
            check_in_count: 1,
            last_check_in: nowIso,
            next_check_in_due: addMinutes(nowIso, DEFAULT_CHECKIN_INTERVAL_MIN),
            last_event_at: nowIso
        };

        const existingRoadmap = ensureArray(mission.roadmap);
        const initialRoadmap = [
            ...existingRoadmap,
            {
                stage: template[0],
                timestamp: nowIso,
                completed: true,
                event_type: "assignment",
                actor: actor.identity
            },
            {
                stage: "Responder Safety Check-In",
                timestamp: nowIso,
                completed: true,
                event_type: "safety_check_in",
                note: "Automatic check-in at mission claim.",
                actor: actor.identity
            }
        ];

        const existingParticipants = getParticipantsStore(mission.specific_details);
        const requesterIdentity = normalizeIdentity(existingParticipants.requester_id || existingParticipants.requester_email || mission.created_by);
        const requesterName = String(existingParticipants.requester_name || "").trim() || deriveDisplayName(requesterIdentity);
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(mission.specific_details, initialSafety);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            requester_id: requesterIdentity || null,
            requester_email: existingParticipants.requester_email || (requesterIdentity.includes("@") ? requesterIdentity : null),
            requester_name: requesterName,
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        const { data, error } = await supabase
            .from('help_requests')
            .update({ 
                status: 'on_progress',
                assigned_volunteer: actor.identity,
                roadmap: initialRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq('id', requestId)
            .eq('status', 'queued')
            .is('assigned_volunteer', null)
            .select('id');

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("This mission was already claimed by another volunteer.");
        }

        const requesterEmail = normalizeIdentity(
            existingParticipants.requester_email
            || (missionCreator.includes("@") ? missionCreator : null)
        );

        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Accepted mission: ${mission.title || mission.id}`,
                task_status: "On Progress",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: "request_assigned",
                meta: {
                    requester_identity: requesterIdentity || null,
                    requester_email: requesterEmail || null
                }
            },
            requesterEmail
                ? {
                    user_email: requesterEmail,
                    task_name: `Volunteer assigned: ${mission.title || mission.id}`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: "request_assigned",
                    meta: {
                        volunteer_identity: actor.identity,
                        volunteer_email: actor.email
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterEmail && requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, existingParticipants.requester_id, requesterEmail],
                    email: requesterEmail,
                    fullName: requesterName,
                    authId: String(existingParticipants.requester_id || "").includes("@") ? null : normalizeIdentity(existingParticipants.requester_id)
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true };
    },

    async updateRoadmapStep(requestId) {
        const actor = await getCurrentActorProfile();
        // 1. Fetch latest mission from DB (do not trust client-sent roadmap/category/details)
        const mission = await loadAssignedActiveMissionOrThrow(requestId, actor);

        const category = mission.category;
        const specificDetails = ensureObject(mission.specific_details);
        const currentRoadmap = ensureArray(mission.roadmap);
        const currentSafety = getSafetyStore(specificDetails);

        if (currentRoadmap.length === 0) {
            throw new Error("Roadmap is not initialized yet.");
        }
        if (currentSafety.emergency_active) {
            throw new Error("Clear the active emergency fail-safe before progressing workflow steps.");
        }

        // 2. Identify template from DB values
        const templateKey = getTemplateKey(category, specificDetails);
        const template = ROADMAP_TEMPLATES[templateKey] || ROADMAP_TEMPLATES['general'];

        // 3. Find next workflow step (ignore safety events in roadmap)
        const currentIndex = getLatestTemplateIndex(currentRoadmap, template);

        if (currentIndex === -1 || currentIndex >= template.length - 1) {
            throw new Error("Roadmap is already at the end.");
        }

        const nextStageName = template[currentIndex + 1];

        // 4. Build updated roadmap
        const newStep = {
            stage: nextStageName,
            timestamp: getNowIso(),
            completed: true,
            event_type: "workflow_progress",
            actor: actor.identity
        };
        const updatedRoadmap = [...currentRoadmap, newStep];

        // 5. Compute new status
        const newStatus = nextStageName === "COMPLETED" ? "completed" : "on_progress";
        const safetyPatch = {
            responder_status: newStatus === "completed"
                ? "checked_out"
                : (stageToLiveStatus(nextStageName) || currentSafety.responder_status || "coordinating"),
            emergency_active: newStatus === "completed" ? false : Boolean(currentSafety.emergency_active),
            checked_out_at: newStatus === "completed" ? getNowIso() : currentSafety.checked_out_at || null,
            last_event_at: getNowIso()
        };
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(specificDetails, safetyPatch);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        // 6. Atomic guarded update
        let updateQuery = supabase
            .from("help_requests")
            .update({
                roadmap: updatedRoadmap,
                status: newStatus,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", "on_progress");
        updateQuery = applyIdentityFilter(updateQuery, "assigned_volunteer", actor.aliases);
        const { data, error } = await updateQuery.select("id");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Mission status changed. Refresh and try again.");
        }

        const participants = getParticipantsStore(specificDetails);
        const requesterEmail = normalizeIdentity(
            participants.requester_email
            || (String(participants.requester_id || "").includes("@") ? participants.requester_id : null)
            || (String(mission.created_by || "").includes("@") ? mission.created_by : null)
        );
        const eventTime = getNowIso();
        const taskStatus = newStatus === "completed" ? "Completed" : "On Progress";

        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `${newStatus === "completed" ? "Completed mission" : "Updated mission step"}: ${mission.title || mission.id} (${nextStageName})`,
                task_status: taskStatus,
                created_at: eventTime,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: newStatus === "completed" ? "request_completed" : "roadmap_progress",
                meta: {
                    stage: nextStageName,
                    status: newStatus
                }
            },
            requesterEmail
                ? {
                    user_email: requesterEmail,
                    task_name: `${newStatus === "completed" ? "Help request resolved" : "Mission progress update"}: ${mission.title || mission.id} (${nextStageName})`,
                    task_status: taskStatus,
                    created_at: eventTime,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: newStatus === "completed" ? "request_completed" : "roadmap_progress",
                    meta: {
                        stage: nextStageName,
                        status: newStatus
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterEmail && requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, participants.requester_id, requesterEmail],
                    email: requesterEmail,
                    fullName: participants.requester_name || deriveDisplayName(requesterEmail),
                    authId: String(participants.requester_id || "").includes("@") ? null : normalizeIdentity(participants.requester_id)
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, nextStage: nextStageName };
    },

    async recordSafetyCheckIn(requestId, note = "") {
        const actor = await getCurrentActorProfile();
        const mission = await loadAssignedActiveMissionOrThrow(requestId, actor);
        const safeSpecifics = ensureObject(mission.specific_details);
        const currentSafety = getSafetyStore(safeSpecifics);
        const nowIso = getNowIso();
        const interval = clampInterval(currentSafety.check_in_interval_min);
        const cleanNote = sanitizeNote(note);

        const safetyPatch = {
            responder_status: currentSafety.responder_status || "coordinating",
            check_in_interval_min: interval,
            check_in_count: (Number(currentSafety.check_in_count) || 0) + 1,
            last_check_in: nowIso,
            next_check_in_due: addMinutes(nowIso, interval),
            last_event_at: nowIso
        };

        const updatedRoadmap = appendRoadmapEvent(mission.roadmap, {
            stage: "Responder Safety Check-In",
            eventType: "safety_check_in",
            note: cleanNote || "Responder reported safe.",
            actor: actor.identity
        });
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(safeSpecifics, safetyPatch);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        let updateQuery = supabase
            .from("help_requests")
            .update({
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", "on_progress");
        updateQuery = applyIdentityFilter(updateQuery, "assigned_volunteer", actor.aliases);
        const { data, error } = await updateQuery.select("id, status, specific_details, roadmap");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Mission status changed. Refresh and try again.");
        }

        const requesterContext = getRequesterContext(mission);
        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Safety check-in: ${mission.title || mission.id}`,
                task_status: "On Progress",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: "safety_check_in",
                meta: {
                    note: cleanNote || "Responder reported safe."
                }
            },
            requesterContext.requesterEmail
                ? {
                    user_email: requesterContext.requesterEmail,
                    task_name: `Volunteer safety update: ${mission.title || mission.id}`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: "safety_check_in",
                    meta: {
                        note: cleanNote || "Responder reported safe."
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterContext.requesterEmail && requesterContext.requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, requesterContext.participants.requester_id, requesterContext.requesterEmail],
                    email: requesterContext.requesterEmail,
                    fullName: requesterContext.requesterName,
                    authId: requesterContext.requesterAuthId
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, safetyMeta: buildSafetyMeta(data[0]) };
    },

    async updateResponderLiveStatus(requestId, nextStatus, note = "") {
        const normalizedStatus = String(nextStatus || "").trim();
        if (!LIVE_STATUS_OPTIONS.some((item) => item.value === normalizedStatus)) {
            throw new Error("Invalid live status selected.");
        }

        const actor = await getCurrentActorProfile();
        const mission = await loadAssignedActiveMissionOrThrow(requestId, actor);
        const safeSpecifics = ensureObject(mission.specific_details);
        const currentSafety = getSafetyStore(safeSpecifics);
        const nowIso = getNowIso();
        const cleanNote = sanitizeNote(note);

        const safetyPatch = {
            responder_status: normalizedStatus,
            live_status_note: cleanNote || "",
            last_event_at: nowIso
        };
        if (!currentSafety.last_check_in) {
            safetyPatch.last_check_in = nowIso;
            safetyPatch.next_check_in_due = addMinutes(nowIso, clampInterval(currentSafety.check_in_interval_min));
            safetyPatch.check_in_count = (Number(currentSafety.check_in_count) || 0) + 1;
        }

        const updatedRoadmap = appendRoadmapEvent(mission.roadmap, {
            stage: `Responder Live Status: ${LIVE_STATUS_LABELS[normalizedStatus]}`,
            eventType: "responder_live_status",
            note: cleanNote,
            actor: actor.identity
        });
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(safeSpecifics, safetyPatch);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        let updateQuery = supabase
            .from("help_requests")
            .update({
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", "on_progress");
        updateQuery = applyIdentityFilter(updateQuery, "assigned_volunteer", actor.aliases);
        const { data, error } = await updateQuery.select("id, status, specific_details, roadmap");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Mission status changed. Refresh and try again.");
        }

        const requesterContext = getRequesterContext(mission);
        const statusLabel = LIVE_STATUS_LABELS[normalizedStatus] || normalizedStatus;
        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Live status update: ${mission.title || mission.id} (${statusLabel})`,
                task_status: "On Progress",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: "responder_live_status",
                meta: {
                    status: normalizedStatus,
                    note: cleanNote || ""
                }
            },
            requesterContext.requesterEmail
                ? {
                    user_email: requesterContext.requesterEmail,
                    task_name: `Volunteer status update: ${mission.title || mission.id} (${statusLabel})`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: "responder_live_status",
                    meta: {
                        status: normalizedStatus,
                        note: cleanNote || ""
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterContext.requesterEmail && requesterContext.requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, requesterContext.participants.requester_id, requesterContext.requesterEmail],
                    email: requesterContext.requesterEmail,
                    fullName: requesterContext.requesterName,
                    authId: requesterContext.requesterAuthId
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, safetyMeta: buildSafetyMeta(data[0]) };
    },

    async triggerEmergencyFailSafe(requestId, note = "") {
        const actor = await getCurrentActorProfile();
        const mission = await loadAssignedActiveMissionOrThrow(requestId, actor);
        const safeSpecifics = ensureObject(mission.specific_details);
        const currentSafety = getSafetyStore(safeSpecifics);
        const nowIso = getNowIso();
        const cleanNote = sanitizeNote(note);

        if (currentSafety.emergency_active) {
            throw new Error("Emergency fail-safe is already active for this mission.");
        }

        const emergencyNote = cleanNote || "Responder triggered emergency fail-safe.";
        const safetyPatch = {
            responder_status: "sos_triggered",
            emergency_active: true,
            emergency_note: emergencyNote,
            emergency_triggered_at: nowIso,
            last_event_at: nowIso
        };

        const updatedRoadmap = appendRoadmapEvent(mission.roadmap, {
            stage: "EMERGENCY: Responder fail-safe triggered",
            eventType: "responder_emergency",
            note: emergencyNote,
            severity: "critical",
            actor: actor.identity
        });
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(safeSpecifics, safetyPatch);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        let updateQuery = supabase
            .from("help_requests")
            .update({
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", "on_progress");
        updateQuery = applyIdentityFilter(updateQuery, "assigned_volunteer", actor.aliases);
        const { data, error } = await updateQuery.select("id, status, specific_details, roadmap");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Mission status changed. Refresh and try again.");
        }

        const requesterContext = getRequesterContext(mission);
        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Emergency fail-safe triggered: ${mission.title || mission.id}`,
                task_status: "Critical",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: "responder_emergency",
                meta: {
                    note: emergencyNote
                }
            },
            requesterContext.requesterEmail
                ? {
                    user_email: requesterContext.requesterEmail,
                    task_name: `Volunteer emergency alert: ${mission.title || mission.id}`,
                    task_status: "Critical",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: "responder_emergency",
                    meta: {
                        note: emergencyNote
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterContext.requesterEmail && requesterContext.requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, requesterContext.participants.requester_id, requesterContext.requesterEmail],
                    email: requesterContext.requesterEmail,
                    fullName: requesterContext.requesterName,
                    authId: requesterContext.requesterAuthId
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, safetyMeta: buildSafetyMeta(data[0]) };
    },

    async clearEmergencyFailSafe(requestId, note = "") {
        const actor = await getCurrentActorProfile();
        const mission = await loadAssignedActiveMissionOrThrow(requestId, actor);
        const safeSpecifics = ensureObject(mission.specific_details);
        const currentSafety = getSafetyStore(safeSpecifics);
        const nowIso = getNowIso();
        const cleanNote = sanitizeNote(note);

        if (!currentSafety.emergency_active) {
            throw new Error("No active emergency fail-safe found for this mission.");
        }

        const resolutionNote = cleanNote || "Emergency marked as resolved by responder.";
        const safetyPatch = {
            responder_status: "coordinating",
            emergency_active: false,
            emergency_cleared_at: nowIso,
            emergency_resolution_note: resolutionNote,
            last_event_at: nowIso
        };

        const updatedRoadmap = appendRoadmapEvent(mission.roadmap, {
            stage: "Emergency Cleared: Responder marked safe",
            eventType: "responder_emergency_clear",
            note: resolutionNote,
            actor: actor.identity
        });
        let updatedSpecificDetails = mergeSafetyIntoSpecificDetails(safeSpecifics, safetyPatch);
        updatedSpecificDetails = mergeParticipantsIntoSpecificDetails(updatedSpecificDetails, {
            volunteer_id: actor.identity,
            volunteer_email: actor.email,
            volunteer_name: actor.fullName
        });

        let updateQuery = supabase
            .from("help_requests")
            .update({
                roadmap: updatedRoadmap,
                specific_details: updatedSpecificDetails
            })
            .eq("id", requestId)
            .eq("status", "on_progress");
        updateQuery = applyIdentityFilter(updateQuery, "assigned_volunteer", actor.aliases);
        const { data, error } = await updateQuery.select("id, status, specific_details, roadmap");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("Mission status changed. Refresh and try again.");
        }

        const requesterContext = getRequesterContext(mission);
        await appendWorkHistoryEntries([
            {
                user_email: actor.email,
                task_name: `Emergency cleared: ${mission.title || mission.id}`,
                task_status: "On Progress",
                created_at: nowIso,
                request_id: mission.id,
                actor_identity: actor.identity,
                actor_role: "volunteer",
                event_type: "responder_emergency_clear",
                meta: {
                    note: resolutionNote
                }
            },
            requesterContext.requesterEmail
                ? {
                    user_email: requesterContext.requesterEmail,
                    task_name: `Volunteer marked emergency safe: ${mission.title || mission.id}`,
                    task_status: "On Progress",
                    created_at: nowIso,
                    request_id: mission.id,
                    actor_identity: actor.identity,
                    actor_role: "volunteer",
                    event_type: "responder_emergency_clear",
                    meta: {
                        note: resolutionNote
                    }
                }
                : null
        ]);

        try {
            await syncMemberProgressFromAliases({
                aliases: actor.aliases,
                email: actor.email,
                fullName: actor.fullName,
                authId: actor.authId
            });
        } catch (syncError) {
            console.warn("Volunteer metrics sync skipped:", syncError?.message || syncError);
        }

        if (requesterContext.requesterEmail && requesterContext.requesterEmail !== actor.email) {
            try {
                await syncMemberProgressFromAliases({
                    aliases: [mission.created_by, requesterContext.participants.requester_id, requesterContext.requesterEmail],
                    email: requesterContext.requesterEmail,
                    fullName: requesterContext.requesterName,
                    authId: requesterContext.requesterAuthId
                });
            } catch (syncError) {
                console.warn("Requester metrics sync skipped:", syncError?.message || syncError);
            }
        }

        return { success: true, safetyMeta: buildSafetyMeta(data[0]) };
    },

    getResponderLiveStatusCatalog() {
        return LIVE_STATUS_OPTIONS.map((entry) => ({ ...entry }));
    },

    // --- Helpers ---
    async getLocationSuggestions(text, options = {}) { return await apiService.searchLocation(text, options); },
    async getMedicineSuggestions(text, options = {}) { return await apiService.searchMedicine(text, options); },
    async getSpecialistSuggestions(text, options = {}) { return await apiService.searchSpecialist(text, options); }
};
