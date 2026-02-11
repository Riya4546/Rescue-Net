const navbar = document.getElementById("navbar");

navbar.innerHTML = `
  <nav style="
    background: #ffffff;
    border-bottom: 1px solid #e1e4e8;
    padding: 15px 0;
  ">
    <div style="
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <div style="font-weight: 800; font-size: 1.2rem; color: #2c3e50;">
        Rescue<span style="color: #ff7f50;">Net</span>
      </div>
      <a href="index.html" style="
        text-decoration: none;
        color: #555;
        font-size: 0.9rem;
        font-weight: 600;
        padding: 8px 16px;
        border-radius: 6px;
        background: #f8f9fa;
        transition: background 0.2s;
      " onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
        &larr; Exit Dashboard
      </a>
    </div>
  </nav>
`;