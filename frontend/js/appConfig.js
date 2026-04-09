const DEFAULT_CONFIG = {
    services: {
        geocodingSearchUrl: "https://nominatim.openstreetmap.org/search?format=json&q={query}",
        geocodingSearchFallbackUrl: "https://photon.komoot.io/api/?q={query}&limit=8",
        geocodingReverseUrl: "https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}",
        geocodingReverseFallbackUrl: "https://photon.komoot.io/reverse?lon={lon}&lat={lat}",
        medicineLookupUrl: "https://rxnav.nlm.nih.gov/REST/drugs.json?name={query}",
        medicineLabelUrl: "https://api.fda.gov/drug/label.json?search={search}&limit=25",
        specialistLookupUrl: "https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search?terms={query}&maxList=40"
    }
};

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
    const result = { ...base };

    Object.entries(override || {}).forEach(([key, value]) => {
        if (isPlainObject(value) && isPlainObject(base?.[key])) {
            result[key] = deepMerge(base[key], value);
            return;
        }
        result[key] = value;
    });

    return result;
}

async function loadFileConfig() {
    if (typeof fetch !== "function") {
        return {};
    }

    try {
        const response = await fetch(new URL("../app.config.json", import.meta.url));
        if (!response.ok) {
            return {};
        }

        const data = await response.json();
        return isPlainObject(data) ? data : {};
    } catch {
        return {};
    }
}

const windowConfig = typeof window !== "undefined" && isPlainObject(window.RESCUENET_CONFIG)
    ? window.RESCUENET_CONFIG
    : {};

const fileConfig = await loadFileConfig();

export const appConfig = deepMerge(DEFAULT_CONFIG, deepMerge(fileConfig, windowConfig));

export function getSupabaseConfig() {
    const url = String(appConfig?.supabase?.url || "").trim();
    const anonKey = String(appConfig?.supabase?.anonKey || "").trim();

    if (!url || !anonKey) {
        throw new Error(
            "Supabase config is missing. Add frontend/app.config.json or set window.RESCUENET_CONFIG.supabase."
        );
    }

    return { url, anonKey };
}

export function getServiceConfig() {
    return appConfig.services;
}

export function buildServiceUrl(template, values = {}) {
    return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => {
        const value = values[key];
        return encodeURIComponent(value == null ? "" : String(value));
    });
}
