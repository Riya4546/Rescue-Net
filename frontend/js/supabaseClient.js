import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://cmefmcawnugopzrotrem.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZWZtY2F3bnVnb3B6cm90cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzY3NTIsImV4cCI6MjA4NjMxMjc1Mn0.KJu4XNLPdDp3Zs_fQpzPu-x7scdvoZ0IwMHMUKUGMgI";

export const OFFLINE_MODE_KEY = "rescuenet_offline_mode";
export const OFFLINE_AUTH_KEY = "rescuenet_offline_user";
const OFFLINE_DB_KEY = "rescuenet_offline_db";
const DEFAULT_OFFLINE_EMAIL = "existing.user@rescuenet.local";

const canUseBrowserStorage = typeof window !== "undefined" && typeof localStorage !== "undefined";

function isOfflineMode() {
    return canUseBrowserStorage && localStorage.getItem(OFFLINE_MODE_KEY) === "1";
}

function safeJsonParse(raw, fallback) {
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function toTitleCase(text) {
    return (text || "")
        .replace(/[._-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildOfflineUser(email = DEFAULT_OFFLINE_EMAIL) {
    const normalizedEmail = String(email || DEFAULT_OFFLINE_EMAIL).toLowerCase();
    const name = toTitleCase(normalizedEmail.split("@")[0]) || "Existing User";
    return {
        id: `offline_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`,
        email: normalizedEmail,
        user_metadata: { full_name: name }
    };
}

function getOfflineUser() {
    if (!canUseBrowserStorage) {
        return buildOfflineUser();
    }

    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    const parsed = raw ? safeJsonParse(raw, null) : null;
    if (parsed && parsed.email) {
        return parsed;
    }
    return buildOfflineUser();
}

function persistOfflineUser(user) {
    if (!canUseBrowserStorage) {
        return;
    }
    localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(user));
}

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getIsoFromNow(deltaDays = 0) {
    const date = new Date();
    if (deltaDays !== 0) {
        date.setDate(date.getDate() + deltaDays);
    }
    return date.toISOString();
}

function createDefaultOfflineDb(userEmail) {
    const defaultPasswordHash = "offline_demo_password_hash";
    return {
        profiles: [
            {
                id: generateId("profile"),
                email: userEmail,
                full_name: toTitleCase(userEmail.split("@")[0]) || "Existing User",
                user_role: "Volunteer",
                location: "Kochi, Kerala",
                password_hash: defaultPasswordHash
            }
        ],
        help_requests: [
            {
                id: generateId("req"),
                title: "Need O+ Blood in Kochi",
                urgency: "critical",
                category: "blood",
                location_text: "Kochi, Kerala",
                description: "Immediate donor support required.",
                specific_details: { group: "O+", qty_ml: 450 },
                status: "queued",
                created_by: userEmail,
                assigned_volunteer: null,
                roadmap: [],
                created_at: getIsoFromNow(-1)
            },
            {
                id: generateId("req"),
                title: "Emergency Medicine Delivery",
                urgency: "high",
                category: "medical",
                location_text: "Ernakulam, Kerala",
                description: "Need insulin stock urgently.",
                specific_details: { sub_type: "medicine", name: "Insulin", qty: 4 },
                status: "on_progress",
                created_by: userEmail,
                assigned_volunteer: "local-dev-user",
                roadmap: [
                    {
                        stage: "Volunteer Assigned",
                        timestamp: getIsoFromNow(-1),
                        completed: true
                    }
                ],
                created_at: getIsoFromNow(-2)
            }
        ],
        resources: [
            { id: generateId("res"), name: "Ambulance" },
            { id: generateId("res"), name: "First Aid Kit" }
        ],
        member_records: [
            {
                id: generateId("member"),
                profile_id: null,
                email: userEmail,
                full_name: toTitleCase(userEmail.split("@")[0]) || "Existing User",
                location: "Kochi, Kerala",
                user_role: "Volunteer",
                requested_total: 0,
                requested_active: 0,
                requested_resolved: 0,
                volunteered_total: 0,
                volunteered_active: 0,
                volunteered_resolved: 0
            }
        ],
        work_history: [
            {
                id: generateId("work"),
                user_email: userEmail,
                task_name: "Demo Relief Coordination",
                task_status: "Completed",
                created_at: getIsoFromNow(-3)
            }
        ]
    };
}

function getOfflineDb() {
    const user = getOfflineUser();

    if (!canUseBrowserStorage) {
        return createDefaultOfflineDb(user.email);
    }

    const raw = localStorage.getItem(OFFLINE_DB_KEY);
    const parsed = raw ? safeJsonParse(raw, null) : null;
    const db = parsed && typeof parsed === "object" ? parsed : createDefaultOfflineDb(user.email);

    db.profiles = Array.isArray(db.profiles) ? db.profiles : [];
    db.help_requests = Array.isArray(db.help_requests) ? db.help_requests : [];
    db.resources = Array.isArray(db.resources) ? db.resources : [];
    db.member_records = Array.isArray(db.member_records) ? db.member_records : [];
    db.work_history = Array.isArray(db.work_history) ? db.work_history : [];

    const memberExists = db.member_records.some((row) => row.email === user.email);
    if (!memberExists) {
        db.member_records.push({
            id: generateId("member"),
            profile_id: null,
            email: user.email,
            full_name: user.user_metadata?.full_name || "Existing User",
            location: "Kochi, Kerala",
            user_role: "Volunteer",
            requested_total: 0,
            requested_active: 0,
            requested_resolved: 0,
            volunteered_total: 0,
            volunteered_active: 0,
            volunteered_resolved: 0
        });
    }

    localStorage.setItem(OFFLINE_DB_KEY, JSON.stringify(db));
    return db;
}

function saveOfflineDb(db) {
    if (!canUseBrowserStorage) {
        return;
    }
    localStorage.setItem(OFFLINE_DB_KEY, JSON.stringify(db));
}

function toError(message) {
    return { message };
}

function buildEqFilter(column, value) {
    return (row) => row?.[column] === value;
}

function parseOrFilters(expression) {
    if (!expression || typeof expression !== "string") {
        return [];
    }

    return expression
        .split(",")
        .map((part) => part.trim())
        .map((part) => {
            const chunks = part.split(".");
            if (chunks.length < 3) {
                return null;
            }
            const [column, operator, ...valueParts] = chunks;
            const value = valueParts.join(".");
            if (operator !== "eq") {
                return null;
            }
            return (row) => String(row?.[column]) === value;
        })
        .filter(Boolean);
}

class MockQueryBuilder {
    constructor(tableName, getDb, saveDb) {
        this.tableName = tableName;
        this.getDb = getDb;
        this.saveDb = saveDb;

        this.op = "select";
        this.selectOptions = {};
        this.filters = [];
        this.orFilters = [];
        this.orderBy = null;
        this.singleResult = false;
        this.insertRows = [];
        this.updateValues = {};
    }

    select(_columns = "*", options = {}) {
        this.selectOptions = options || {};
        return this;
    }

    eq(column, value) {
        this.filters.push(buildEqFilter(column, value));
        return this;
    }

    is(column, value) {
        if (value === null) {
            this.filters.push((row) => row?.[column] === null || row?.[column] === undefined);
        } else {
            this.filters.push((row) => row?.[column] === value);
        }
        return this;
    }

    or(expression) {
        this.orFilters.push(...parseOrFilters(expression));
        return this;
    }

    order(column, options = {}) {
        this.orderBy = {
            column,
            ascending: options.ascending !== false
        };
        return this;
    }

    single() {
        this.singleResult = true;
        return this;
    }

    insert(rows) {
        this.op = "insert";
        this.insertRows = Array.isArray(rows) ? rows : [rows];
        return this;
    }

    update(values) {
        this.op = "update";
        this.updateValues = values || {};
        return this;
    }

    applyFilters(rows) {
        let result = [...rows];

        if (this.filters.length > 0) {
            result = result.filter((row) => this.filters.every((f) => f(row)));
        }

        if (this.orFilters.length > 0) {
            result = result.filter((row) => this.orFilters.some((f) => f(row)));
        }

        if (this.orderBy) {
            const { column, ascending } = this.orderBy;
            result.sort((a, b) => {
                const left = a?.[column];
                const right = b?.[column];
                if (left === right) return 0;
                if (left == null) return ascending ? 1 : -1;
                if (right == null) return ascending ? -1 : 1;
                if (left > right) return ascending ? 1 : -1;
                return ascending ? -1 : 1;
            });
        }

        return result;
    }

    async execute() {
        try {
            const db = this.getDb();
            db[this.tableName] = Array.isArray(db[this.tableName]) ? db[this.tableName] : [];
            const table = db[this.tableName];

            if (this.op === "insert") {
                const createdRows = this.insertRows.map((row) => ({
                    id: row?.id || generateId(this.tableName),
                    created_at: row?.created_at || new Date().toISOString(),
                    ...row
                }));
                table.push(...createdRows);
                this.saveDb(db);
                return { data: createdRows, error: null };
            }

            if (this.op === "update") {
                const rowsToUpdate = this.applyFilters(table);
                rowsToUpdate.forEach((row) => Object.assign(row, this.updateValues));
                this.saveDb(db);
                return { data: rowsToUpdate, error: null };
            }

            const selectedRows = this.applyFilters(table);
            const count = this.selectOptions?.count === "exact" ? selectedRows.length : null;

            if (this.singleResult) {
                if (selectedRows.length === 0) {
                    return { data: null, error: toError("No rows found"), count };
                }
                if (selectedRows.length > 1) {
                    return { data: null, error: toError("Multiple rows found"), count };
                }
                return { data: selectedRows[0], error: null, count };
            }

            if (this.selectOptions?.head) {
                return { data: null, error: null, count };
            }

            return { data: selectedRows, error: null, count };
        } catch (error) {
            return { data: null, error: toError(error?.message || "Offline query failed"), count: null };
        }
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }
}

function createMockSupabase() {
    return {
        auth: {
            async getUser() {
                return { data: { user: getOfflineUser() }, error: null };
            },
            async getSession() {
                return { data: { session: { user: getOfflineUser() } }, error: null };
            },
            async signInWithPassword({ email }) {
                const user = buildOfflineUser(email || DEFAULT_OFFLINE_EMAIL);
                persistOfflineUser(user);
                return { data: { user, session: { user } }, error: null };
            },
            async signUp({ email }) {
                const user = buildOfflineUser(email || DEFAULT_OFFLINE_EMAIL);
                persistOfflineUser(user);
                return { data: { user, session: { user } }, error: null };
            },
            async signOut() {
                if (canUseBrowserStorage) {
                    localStorage.removeItem(OFFLINE_AUTH_KEY);
                }
                return { error: null };
            }
        },
        from(tableName) {
            return new MockQueryBuilder(tableName, getOfflineDb, saveOfflineDb);
        }
    };
}

export function enableOfflineMode(email = DEFAULT_OFFLINE_EMAIL) {
    if (!canUseBrowserStorage) {
        return;
    }
    localStorage.setItem(OFFLINE_MODE_KEY, "1");
    persistOfflineUser(buildOfflineUser(email));
    saveOfflineDb(getOfflineDb());
}

export function disableOfflineMode() {
    if (!canUseBrowserStorage) {
        return;
    }
    localStorage.removeItem(OFFLINE_MODE_KEY);
    localStorage.removeItem(OFFLINE_AUTH_KEY);
}

export function isOfflineModeEnabled() {
    return isOfflineMode();
}

const realSupabase = createClient(supabaseUrl, supabaseKey);

const LOCAL_AUTH_KEY = "rescuenet_local_auth_session_v1";
const AUTH_RESOURCE_TYPE = "__auth_user__";

function getLocalAuthSession() {
    if (!canUseBrowserStorage) return null;
    const raw = localStorage.getItem(LOCAL_AUTH_KEY);
    const parsed = raw ? safeJsonParse(raw, null) : null;
    if (!parsed?.user?.email) return null;
    return parsed;
}

function setLocalAuthSession(session) {
    if (!canUseBrowserStorage || !session) return;
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(session));
}

function clearLocalAuthSession() {
    if (!canUseBrowserStorage) return;
    localStorage.removeItem(LOCAL_AUTH_KEY);
}

function generateUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function makeAuthError(message, status = 400) {
    return { message, status };
}

async function hashPassword(password) {
    if (typeof TextEncoder === "undefined" || !globalThis.crypto?.subtle) {
        return password;
    }
    const encoded = new TextEncoder().encode(password);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function buildUserFromMember(member) {
    const email = String(member?.email || "").toLowerCase();
    const fullName = member?.full_name || toTitleCase(email.split("@")[0]) || "Member";
    return {
        id: String(member?.id || generateUuid()),
        email,
        user_metadata: { full_name: fullName }
    };
}

function buildSessionFromMember(member) {
    const user = buildUserFromMember(member);
    return {
        access_token: `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        token_type: "bearer",
        expires_in: 60 * 60 * 24 * 30,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        user
    };
}

function isMissingColumnError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("column") && msg.includes("does not exist");
}

function isMissingRelationError(error, relationName) {
    const msg = String(error?.message || "").toLowerCase();
    const relation = String(relationName || "").toLowerCase();
    if (!relation) return false;
    return msg.includes("relation") && msg.includes(relation) && msg.includes("does not exist");
}

function isDuplicateKeyError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return error?.code === "23505" || msg.includes("duplicate key") || msg.includes("already exists");
}

function extractPasswordHash(row) {
    return row?.password_hash || row?.password || row?.pickup_location || null;
}

function toAuthRecord(row, source, fallback = {}) {
    const fallbackEmail = String(fallback?.email || "").trim().toLowerCase();
    const email = String(row?.email || fallbackEmail || "").trim().toLowerCase();
    const fullName = row?.full_name
        || fallback?.full_name
        || toTitleCase(email.split("@")[0])
        || "Member";

    return {
        id: row?.id || fallback?.id || generateUuid(),
        email,
        full_name: fullName,
        user_role: row?.user_role || fallback?.user_role || "Volunteer",
        location: row?.location ?? fallback?.location ?? null,
        password_hash: extractPasswordHash(row) || fallback?.password_hash || null,
        _auth_source: source
    };
}

function getMemberProfilePayload(email, profile = {}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    return {
        id: profile?.id || generateUuid(),
        profile_id: profile?.id || null,
        email: normalizedEmail,
        full_name: profile?.full_name || toTitleCase(normalizedEmail.split("@")[0]) || "Member",
        user_role: profile?.user_role || "Volunteer",
        location: profile?.location ?? null
    };
}

async function ensureMemberRecordMirror(client, authRecord) {
    const normalizedEmail = String(authRecord?.email || "").trim().toLowerCase();
    if (!normalizedEmail) return;

    const nowIso = new Date().toISOString();
    const base = getMemberProfilePayload(normalizedEmail, authRecord);
    const lookup = await client
        .from("member_records")
        .select("*")
        .eq("email", normalizedEmail)
        .limit(1);

    if (lookup.error && !isMissingRelationError(lookup.error, "member_records")) {
        return;
    }

    const existing = Array.isArray(lookup.data) && lookup.data.length ? lookup.data[0] : null;

    if (existing) {
        const updateCandidates = [
            {
                profile_id: base.profile_id,
                full_name: base.full_name,
                user_role: base.user_role,
                location: base.location,
                last_login_at: nowIso
            },
            {
                full_name: base.full_name,
                user_role: base.user_role,
                location: base.location,
                last_login_at: nowIso
            },
            {
                full_name: base.full_name,
                user_role: base.user_role,
                location: base.location
            }
        ];

        for (const payload of updateCandidates) {
            const updateResult = await client
                .from("member_records")
                .update(payload)
                .eq("email", normalizedEmail);

            if (!updateResult.error) return;
            if (!isMissingColumnError(updateResult.error)) return;
        }
        return;
    }

    const insertCandidates = [
        {
            ...base,
            requested_total: 0,
            requested_active: 0,
            requested_resolved: 0,
            volunteered_total: 0,
            volunteered_active: 0,
            volunteered_resolved: 0,
            last_login_at: nowIso
        },
        { ...base, last_login_at: nowIso },
        { ...base },
        {
            id: base.id,
            email: base.email,
            full_name: base.full_name
        },
        {
            email: base.email,
            full_name: base.full_name
        }
    ];

    for (const payload of insertCandidates) {
        const insertResult = await client
            .from("member_records")
            .insert(payload)
            .select("*")
            .limit(1);

        if (!insertResult.error) return;
        if (!isMissingColumnError(insertResult.error)) return;
    }
}

async function findMemberByEmail(client, email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();

    const profileLookup = await client
        .from("profiles")
        .select("*")
        .eq("email", normalizedEmail)
        .limit(1);

    if (!profileLookup.error && Array.isArray(profileLookup.data) && profileLookup.data.length) {
        return { member: toAuthRecord(profileLookup.data[0], "profiles"), error: null };
    }

    const profileLookupError = profileLookup.error && !isMissingRelationError(profileLookup.error, "profiles")
        ? profileLookup.error
        : null;

    const memberLookup = await client
        .from("member_records")
        .select("*")
        .eq("email", normalizedEmail)
        .limit(1);

    if (!memberLookup.error && Array.isArray(memberLookup.data) && memberLookup.data.length) {
        return { member: toAuthRecord(memberLookup.data[0], "member_records"), error: null };
    }

    const fallbackLookup = await client
        .from("resources")
        .select("*")
        .eq("type", AUTH_RESOURCE_TYPE)
        .eq("offered_by", normalizedEmail)
        .limit(1);

    if (fallbackLookup.error) {
        return { member: null, error: profileLookupError || memberLookup.error || fallbackLookup.error };
    }

    const row = Array.isArray(fallbackLookup.data) && fallbackLookup.data.length ? fallbackLookup.data[0] : null;
    if (!row) {
        return { member: null, error: profileLookupError || null };
    }

    return {
        member: toAuthRecord(
            {
                id: row.id,
                email: normalizedEmail,
                full_name: toTitleCase(normalizedEmail.split("@")[0]) || "Member",
                pickup_location: row.pickup_location
            },
            "resources"
        ),
        error: null
    };
}

async function insertMemberRecord(client, email, passwordHash, profile = {}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const payloadBase = {
        id: profile?.id || generateUuid(),
        email: normalizedEmail,
        full_name: profile?.full_name || toTitleCase(normalizedEmail.split("@")[0]) || "Member",
        user_role: profile?.user_role || "Volunteer",
        location: profile?.location ?? null
    };
    const nowIso = new Date().toISOString();

    const profileInsertCandidates = [
        { ...payloadBase, password_hash: passwordHash, auth_provider: "local", last_login_at: nowIso },
        { ...payloadBase, password: passwordHash, auth_provider: "local", last_login_at: nowIso },
        { ...payloadBase, password_hash: passwordHash, last_login_at: nowIso },
        { ...payloadBase, password: passwordHash, last_login_at: nowIso },
        { ...payloadBase, password_hash: passwordHash },
        { ...payloadBase, password: passwordHash },
        {
            id: payloadBase.id,
            email: payloadBase.email,
            full_name: payloadBase.full_name,
            password_hash: passwordHash
        },
        {
            id: payloadBase.id,
            email: payloadBase.email,
            password_hash: passwordHash
        }
    ];

    for (const payload of profileInsertCandidates) {
        const insertAttempt = await client
            .from("profiles")
            .insert(payload)
            .select("*")
            .limit(1);

        if (!insertAttempt.error) {
            const row = Array.isArray(insertAttempt.data) && insertAttempt.data.length ? insertAttempt.data[0] : payload;
            const member = toAuthRecord(row, "profiles", payloadBase);
            await ensureMemberRecordMirror(client, member);
            return { member, error: null };
        }

        if (isDuplicateKeyError(insertAttempt.error)) {
            const existing = await findMemberByEmail(client, normalizedEmail);
            if (existing.member) {
                await updateMemberPassword(client, normalizedEmail, passwordHash);
                await ensureMemberRecordMirror(client, existing.member);
                return { member: existing.member, error: null };
            }
            return { member: null, error: insertAttempt.error };
        }

        if (!isMissingColumnError(insertAttempt.error) && !isMissingRelationError(insertAttempt.error, "profiles")) {
            return { member: null, error: insertAttempt.error };
        }
    }

    let { data, error } = await client
        .from("member_records")
        .insert({ ...payloadBase, password_hash: passwordHash })
        .select("*")
        .limit(1);

    if (error && /password_hash/i.test(error.message || "")) {
        ({ data, error } = await client
            .from("member_records")
            .insert({ ...payloadBase, password: passwordHash })
            .select("*")
            .limit(1));
    }

    if (!error) {
        const member = Array.isArray(data) && data.length ? toAuthRecord(data[0], "member_records", payloadBase) : null;
        return { member, error: null };
    }

    const fallbackInsert = await client
        .from("resources")
        .insert({
            title: normalizedEmail,
            type: AUTH_RESOURCE_TYPE,
            quantity: 1,
            pickup_location: passwordHash,
            offered_by: normalizedEmail
        })
        .select("*")
        .limit(1);

    if (fallbackInsert.error) {
        return { member: null, error: fallbackInsert.error };
    }

    const row = Array.isArray(fallbackInsert.data) && fallbackInsert.data.length ? fallbackInsert.data[0] : null;
    if (!row) {
        return { member: null, error: makeAuthError("Unable to create account.") };
    }

    return {
        member: toAuthRecord(
            {
                id: row.id,
                email: normalizedEmail,
                full_name: payloadBase.full_name,
                pickup_location: row.pickup_location
            },
            "resources"
        ),
        error: null
    };
}

async function updateMemberPassword(client, email, passwordHash) {
    const normalizedEmail = String(email || "").trim().toLowerCase();

    let { error } = await client
        .from("profiles")
        .update({ password_hash: passwordHash, last_login_at: new Date().toISOString() })
        .eq("email", normalizedEmail);

    if (error && /password_hash/i.test(error.message || "")) {
        ({ error } = await client
            .from("profiles")
            .update({ password: passwordHash, last_login_at: new Date().toISOString() })
            .eq("email", normalizedEmail));
    }

    if (error && isMissingColumnError(error)) {
        ({ error } = await client
            .from("profiles")
            .update({ password_hash: passwordHash })
            .eq("email", normalizedEmail));
    }

    if (error && isMissingColumnError(error)) {
        ({ error } = await client
            .from("profiles")
            .update({ password: passwordHash })
            .eq("email", normalizedEmail));
    }

    if (!error) return null;

    if (!isMissingRelationError(error, "profiles")) {
        return error;
    }

    let legacyError;
    ({ error: legacyError } = await client
        .from("member_records")
        .update({ password_hash: passwordHash })
        .eq("email", normalizedEmail));

    if (legacyError && /password_hash/i.test(legacyError.message || "")) {
        ({ error: legacyError } = await client
            .from("member_records")
            .update({ password: passwordHash })
            .eq("email", normalizedEmail));
    }

    if (!legacyError) return null;

    const fallbackUpdate = await client
        .from("resources")
        .update({ pickup_location: passwordHash })
        .eq("type", AUTH_RESOURCE_TYPE)
        .eq("offered_by", normalizedEmail);

    return fallbackUpdate.error || null;
}

async function ensureCredentialsInProfiles(client, member, passwordHash) {
    const normalizedEmail = String(member?.email || "").trim().toLowerCase();
    if (!normalizedEmail) return member;

    const lookup = await findMemberByEmail(client, normalizedEmail);
    if (lookup.member?._auth_source === "profiles") {
        await updateMemberPassword(client, normalizedEmail, passwordHash);
        await ensureMemberRecordMirror(client, lookup.member);
        return lookup.member;
    }

    const inserted = await insertMemberRecord(client, normalizedEmail, passwordHash, {
        id: member?.id,
        full_name: member?.full_name,
        user_role: member?.user_role || "Volunteer",
        location: member?.location ?? null
    });

    if (!inserted.error && inserted.member) {
        return inserted.member;
    }

    await ensureMemberRecordMirror(client, member);
    return member;
}

async function ensureMemberFromSupabaseAuth(client, authUser, email, passwordHash) {
    const normalizedEmail = String(email || authUser?.email || "").trim().toLowerCase();
    if (!normalizedEmail) return null;

    const found = await findMemberByEmail(client, normalizedEmail);
    if (found.member) {
        await updateMemberPassword(client, normalizedEmail, passwordHash);
        const member = await ensureCredentialsInProfiles(client, found.member, passwordHash);
        await ensureMemberRecordMirror(client, member);
        return member;
    }

    const inserted = await insertMemberRecord(client, normalizedEmail, passwordHash, {
        id: authUser?.id || generateUuid(),
        full_name: authUser?.user_metadata?.full_name || toTitleCase(normalizedEmail.split("@")[0]) || "Member",
        user_role: "Volunteer",
        location: null
    });
    if (inserted.member) {
        await ensureMemberRecordMirror(client, inserted.member);
    }
    return inserted.member || null;
}

function createTraditionalAuthSupabase(client) {
    const nativeAuth = client.auth;

    const traditionalAuth = {
        async signUp({ email, password }) {
            const normalizedEmail = String(email || "").trim().toLowerCase();
            if (!normalizedEmail || !password) {
                return { data: { user: null, session: null }, error: makeAuthError("Email and password are required.") };
            }
            if (password.length < 6) {
                return { data: { user: null, session: null }, error: makeAuthError("Password must be at least 6 characters.") };
            }

            const existing = await findMemberByEmail(client, normalizedEmail);
            if (existing.error) {
                return { data: { user: null, session: null }, error: existing.error };
            }
            if (existing.member) {
                return { data: { user: null, session: null }, error: makeAuthError("User already exists. Please log in.") };
            }

            const passwordHash = await hashPassword(password);
            const inserted = await insertMemberRecord(client, normalizedEmail, passwordHash);
            if (inserted.error || !inserted.member) {
                return { data: { user: null, session: null }, error: inserted.error || makeAuthError("Unable to create account.") };
            }

            const profileRecord = await ensureCredentialsInProfiles(client, inserted.member, passwordHash);
            await ensureMemberRecordMirror(client, profileRecord || inserted.member);

            const session = buildSessionFromMember(profileRecord || inserted.member);
            setLocalAuthSession(session);
            return { data: { user: session.user, session }, error: null };
        },

        async signInWithPassword({ email, password }) {
            const normalizedEmail = String(email || "").trim().toLowerCase();
            if (!normalizedEmail || !password) {
                return { data: { user: null, session: null }, error: makeAuthError("Email and password are required.") };
            }

            const lookup = await findMemberByEmail(client, normalizedEmail);
            if (lookup.error) {
                return { data: { user: null, session: null }, error: lookup.error };
            }

            const member = lookup.member;
            if (member) {
                const stored = member.password_hash || member.password || null;
                const supplied = await hashPassword(password);
                if (!stored || stored !== supplied) {
                    return { data: { user: null, session: null }, error: makeAuthError("Invalid login credentials.") };
                }

                const syncedMember = await ensureCredentialsInProfiles(client, member, supplied);
                await ensureMemberRecordMirror(client, syncedMember || member);

                const session = buildSessionFromMember(syncedMember || member);
                setLocalAuthSession(session);
                return { data: { user: session.user, session }, error: null };
            }

            // Fallback path for legacy Supabase-auth users.
            const fallback = await nativeAuth.signInWithPassword({ email: normalizedEmail, password });
            if (fallback.error || !fallback.data?.user) {
                return {
                    data: { user: null, session: null },
                    error: fallback.error || makeAuthError("Invalid login credentials.")
                };
            }

            const passwordHash = await hashPassword(password);
            const linkedMember = await ensureMemberFromSupabaseAuth(client, fallback.data.user, normalizedEmail, passwordHash);
            const session = buildSessionFromMember(linkedMember || {
                id: fallback.data.user.id,
                email: normalizedEmail,
                full_name: fallback.data.user.user_metadata?.full_name
            });
            setLocalAuthSession(session);
            return { data: { user: session.user, session }, error: null };
        },

        async getUser() {
            const localSession = getLocalAuthSession();
            if (localSession?.user) {
                return { data: { user: localSession.user }, error: null };
            }
            return nativeAuth.getUser();
        },

        async getSession() {
            const localSession = getLocalAuthSession();
            if (localSession) {
                return { data: { session: localSession }, error: null };
            }
            if (typeof nativeAuth.getSession === "function") {
                return nativeAuth.getSession();
            }
            return { data: { session: null }, error: null };
        },

        async resetPasswordForEmail() {
            return {
                data: null,
                error: makeAuthError("Password reset email is unavailable for this project right now.")
            };
        },

        async signOut() {
            clearLocalAuthSession();
            try {
                await nativeAuth.signOut();
            } catch {
                // Ignore fallback signout errors from legacy auth state.
            }
            return { error: null };
        }
    };

    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === "auth") {
                return traditionalAuth;
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
}

export const supabase = createTraditionalAuthSupabase(realSupabase);
