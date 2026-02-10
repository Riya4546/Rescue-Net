// Simple script to handle button clicks or navigation highlights
document.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
        console.log("Action triggered: " + button.innerText);
    });
});

// Example: Change navbar background on scroll
window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    if (window.scrollY > 50) {
        header.style.background = '#f8f8f8';
    } else {
        header.style.background = '#fff';
    }
});
