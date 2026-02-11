export const apiService = {

    // 1. AUTO-COMPLETE (Search by Name)
    async searchLocation(query) {
        if (!query || query.length < 3) return [];
        
        try {
            // Using OpenStreetMap (Nominatim) - FREE
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
            const response = await fetch(url);
            const data = await response.json();
            
            return data.map(place => ({
                display_name: place.display_name,
                lat: place.lat,
                lon: place.lon
            }));
        } catch (error) {
            console.error("Map Error:", error);
            return [];
        }
    },

    // 2. REVERSE GEOCODE (Get Address from Lat/Lon)
    // This is needed for the "Current Location" button
    async getAddressFromCoords(lat, lon) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
            const response = await fetch(url);
            const data = await response.json();
            return data.display_name || "Unknown Location";
        } catch (error) {
            console.error("Geocoding Error:", error);
            return "Locating failed.";
        }
    }
};