const navbar = document.getElementById("navbar");

navbar.innerHTML = `
  <nav style="
    padding: 14px 24px;
    background: white;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  ">
    <strong style="color:#2563eb">RescueNet</strong>
    <div>
      <a href="../index.html">Home</a>
      <a href="./dashboard.html" style="margin-left:16px">Dashboard</a>
      <a href="#" style="margin-left:16px">Live Map</a>
    </div>
  </nav>
`;
