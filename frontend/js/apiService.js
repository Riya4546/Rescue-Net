import { buildServiceUrl, getServiceConfig } from "./appConfig.js";

const serviceConfig = getServiceConfig();

export const apiService = {

    // 1. AUTO-COMPLETE (Search by Name)
    async searchLocation(query, options = {}) {
        if (!query || query.length < 3) return [];
        
        try {
            // Using OpenStreetMap (Nominatim) - FREE
            const url = buildServiceUrl(serviceConfig.geocodingSearchUrl, { query });
            const response = await fetch(url, { signal: options.signal });
            if (response.ok) {
                const data = await response.json();
                const mapped = data.map(place => ({
                    display_name: place.display_name,
                    lat: place.lat,
                    lon: place.lon
                }));
                if (mapped.length) return mapped;
            }

            // Fallback provider: Photon (no API key)
            const fallbackUrl = buildServiceUrl(serviceConfig.geocodingSearchFallbackUrl, { query });
            const fallbackResponse = await fetch(fallbackUrl, { signal: options.signal });
            if (!fallbackResponse.ok) return [];
            const fallbackData = await fallbackResponse.json();
            const features = Array.isArray(fallbackData?.features) ? fallbackData.features : [];
            return features.map((feature) => {
                const props = feature?.properties || {};
                const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
                const lon = coords[0];
                const lat = coords[1];
                const parts = [
                    props.name,
                    props.street,
                    props.city,
                    props.state,
                    props.country
                ].filter(Boolean);
                return {
                    display_name: parts.join(", ") || "Unknown location",
                    lat,
                    lon
                };
            });
        } catch (error) {
            if (error?.name === "AbortError") return [];
            console.error("Map Error:", error);
            return [];
        }
    },

    // 1b. MEDICINE AUTO-COMPLETE (By Name)
    async searchMedicine(query, options = {}) {
        const q = (query || "").trim();
        if (q.length < 2) return [];

        const qLower = q.toLowerCase();
        const fallbackNames = [
            "Paracetamol", "Ibuprofen", "Amoxicillin", "Azithromycin", "Cetirizine",
            "Metformin", "Insulin", "ORS", "Aspirin", "Dolo 650"
        ];

        const fallbackResults = fallbackNames
            .filter((name) => name.toLowerCase().includes(qLower))
            .slice(0, 10)
            .map((name) => ({ name, display_name: name, source: "fallback" }));

        const names = new Set();
        const addName = (value) => {
            const name = String(value || "").trim();
            if (!name) return;
            if (name.length > 80) return;
            names.add(name);
        };

        const rxUrl = buildServiceUrl(serviceConfig.medicineLookupUrl, { query: q });
        const fdaSearch = `openfda.brand_name:${q}* OR openfda.generic_name:${q}*`;
        const fdaUrl = buildServiceUrl(serviceConfig.medicineLabelUrl, { search: fdaSearch });

        const [rxResult, fdaResult] = await Promise.allSettled([
            fetch(rxUrl, { signal: options.signal }).then((r) => r.json()),
            fetch(fdaUrl, { signal: options.signal }).then((r) => r.json())
        ]);

        if (rxResult.status === "fulfilled") {
            const conceptGroups = rxResult.value?.drugGroup?.conceptGroup || [];
            conceptGroups.forEach((group) => {
                const props = group?.conceptProperties || [];
                props.forEach((item) => addName(item?.name));
            });
        } else {
            if (rxResult.reason?.name !== "AbortError") {
                console.error("RxNav Medicine Search Error:", rxResult.reason);
            }
        }

        if (fdaResult.status === "fulfilled") {
            const rows = fdaResult.value?.results || [];
            rows.forEach((row) => {
                const openfda = row?.openfda || {};
                (openfda.brand_name || []).forEach(addName);
                (openfda.generic_name || []).forEach(addName);
                (openfda.substance_name || []).forEach(addName);
            });
        } else {
            if (fdaResult.reason?.name !== "AbortError") {
                console.error("OpenFDA Medicine Search Error:", fdaResult.reason);
            }
        }

        const score = (name) => {
            const n = name.toLowerCase();
            if (n === qLower) return 100;
            if (n.startsWith(qLower)) return 60;
            if (n.includes(qLower)) return 30;
            return 0;
        };

        const remoteResults = Array.from(names)
            .filter((name) => name.toLowerCase().includes(qLower))
            .sort((a, b) => score(b) - score(a) || a.localeCompare(b))
            .slice(0, 20)
            .map((name) => ({ name, display_name: name, source: "api" }));

        return remoteResults.length ? remoteResults : fallbackResults;
    },

    // 1c. SPECIALIST AUTO-COMPLETE (Department / Specialty)
    async searchSpecialist(query, options = {}) {
        const q = (query || "").trim();
        if (q.length < 2) return [];

        const qLower = q.toLowerCase();
        const fallbackSpecialties = [
            "General Medicine",
            "Internal Medicine",
            "Emergency Medicine",
            "Cardiovascular Disease (Cardiology)",
            "Neurology",
            "Nephrology",
            "Pulmonary Disease",
            "Orthopaedic Surgery",
            "Dermatology",
            "Pediatrics",
            "Obstetrics & Gynecology",
            "Psychiatry",
            "General Surgery",
            "Anesthesiology",
            "Oncology"
        ];

        const fallbackResults = fallbackSpecialties
            .filter((name) => name.toLowerCase().includes(qLower))
            .slice(0, 10)
            .map((name) => ({ name, display_name: name, source: "fallback" }));

        try {
            // NIH ClinicalTables NPI dataset: [total, ids, extras, rows]
            const url = buildServiceUrl(serviceConfig.specialistLookupUrl, { query: q });
            const response = await fetch(url, { signal: options.signal });
            const data = await response.json();

            const rows = Array.isArray(data?.[3]) ? data[3] : [];
            const names = new Set();

            rows.forEach((row) => {
                // row format: [provider_name, npi, taxonomy_description, address]
                const specialty = String(row?.[2] || "").trim();
                if (!specialty) return;
                if (specialty.length > 100) return;
                names.add(specialty);
            });

            const remoteResults = Array.from(names)
                .filter((name) => name.toLowerCase().includes(qLower))
                .sort((a, b) => {
                    const aScore = a.toLowerCase().startsWith(qLower) ? 1 : 0;
                    const bScore = b.toLowerCase().startsWith(qLower) ? 1 : 0;
                    return bScore - aScore || a.localeCompare(b);
                })
                .slice(0, 20)
                .map((name) => ({ name, display_name: name, source: "api" }));

            return remoteResults.length ? remoteResults : fallbackResults;
        } catch (error) {
            if (error?.name === "AbortError") return [];
            console.error("Specialist Search Error:", error);
            return fallbackResults;
        }
    },

    // 2. REVERSE GEOCODE (Get Address from Lat/Lon)
    // This is needed for the "Current Location" button
    async getAddressFromCoords(lat, lon) {
        try {
            const url = buildServiceUrl(serviceConfig.geocodingReverseUrl, { lat, lon });
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data?.display_name) return data.display_name;
            }

            // Fallback provider: Photon reverse
            const fallbackUrl = buildServiceUrl(serviceConfig.geocodingReverseFallbackUrl, { lat, lon });
            const fallbackResponse = await fetch(fallbackUrl);
            if (!fallbackResponse.ok) return "Unknown Location";
            const fallbackData = await fallbackResponse.json();
            const feature = Array.isArray(fallbackData?.features) ? fallbackData.features[0] : null;
            const props = feature?.properties || {};
            const parts = [
                props.name,
                props.street,
                props.city,
                props.state,
                props.country
            ].filter(Boolean);
            return parts.join(", ") || "Unknown Location";
        } catch (error) {
            console.error("Geocoding Error:", error);
            return "Locating failed.";
        }
    }
};
