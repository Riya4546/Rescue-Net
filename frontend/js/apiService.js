/**
 * API SERVICE (Optimized)
 * Features: Debouncing support structure & Response Caching
 * Time Complexity: O(1) for cached hits.
 */

const requestCache = new Map();

export const apiService = {

    // --- 1. MAPS API (OpenStreetMap) ---
    async searchLocation(query) {
        if (!query || query.length < 3) return [];
        
        // Cache Check O(1)
        const cacheKey = `loc_${query.toLowerCase()}`;
        if (requestCache.has(cacheKey)) return requestCache.get(cacheKey);
        
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
            const response = await fetch(url);
            const data = await response.json();
            
            const results = data.map(place => ({
                display_name: place.display_name,
                lat: parseFloat(place.lat),
                lon: parseFloat(place.lon)
            }));

            // Store in Cache
            requestCache.set(cacheKey, results);
            return results;
        } catch (error) {
            console.error("Map API Error:", error);
            return [];
        }
    },

    // --- 2. MEDICINE API (OpenFDA) ---
    async searchMedicine(query) {
        if (!query || query.length < 3) return [];

        const cacheKey = `med_${query.toLowerCase()}`;
        if (requestCache.has(cacheKey)) return requestCache.get(cacheKey);

        try {
            const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${query}"*&limit=5`;
            const response = await fetch(url);
            const data = await response.json();

            if (!data.results) return [];

            const results = data.results.map(drug => ({
                name: drug.openfda.brand_name ? drug.openfda.brand_name[0] : "Unknown",
                generic: drug.openfda.generic_name ? drug.openfda.generic_name[0] : ""
            }));

            requestCache.set(cacheKey, results);
            return results;
        } catch (error) {
            return [];
        }
    }
};