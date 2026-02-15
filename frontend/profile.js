import { getMyProfile } from "../../backend/profile/profileService.js";

async function loadProfile() {
    try {
        const profile = await getMyProfile();

        document.getElementById("user-name").innerText = profile.full_name;
        document.getElementById("user-location").innerText = profile.location;
        document.getElementById("user-role").innerText = profile.user_role;
        document.getElementById("user-initial").innerText =
            profile.full_name.charAt(0).toUpperCase();
    } catch {
        window.location.href = "login.html";
    }
}

loadProfile();
