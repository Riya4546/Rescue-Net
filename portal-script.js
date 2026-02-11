document.addEventListener('DOMContentLoaded', () => {
    const requestBtn = document.getElementById('requestBtn');
    const volunteerBtn = document.getElementById('volunteerBtn');

    // Click Animations/Transitions
    requestBtn.addEventListener('click', () => {
        // Here you will link to your actual help form
        alert("Navigating to Emergency Request Form...");
        // window.location.href = "request-form.html";
    });

    volunteerBtn.addEventListener('click', () => {
        // Here you will link to your volunteer dashboard
        alert("Navigating to Volunteer Mission List...");
        // window.location.href = "volunteer-missions.html";
    });
});