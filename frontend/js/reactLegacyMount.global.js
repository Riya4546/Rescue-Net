(function () {
  const REACT_URLS = [
    "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js",
    "https://unpkg.com/react@18/umd/react.production.min.js"
  ];

  const REACT_DOM_URLS = [
    "https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js",
    "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const selector = 'script[data-react-runtime="' + src + '"]';
      const existing = document.querySelector(selector);
      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("Failed to load " + src)), { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.reactRuntime = src;
      script.onload = () => {
        script.dataset.loaded = "1";
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(script);
    });
  }

  async function loadFromCandidates(urls) {
    let lastError = null;
    for (const src of urls) {
      try {
        await loadScript(src);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to load script runtime.");
  }

  async function ensureReactRuntime() {
    if (window.React && window.ReactDOM && typeof window.ReactDOM.createRoot === "function") return;
    await loadFromCandidates(REACT_URLS);
    await loadFromCandidates(REACT_DOM_URLS);
    if (!window.React || !window.ReactDOM || typeof window.ReactDOM.createRoot !== "function") {
      throw new Error("React runtime is unavailable.");
    }
  }

  function LegacyMarkup(props) {
    return window.React.createElement("div", {
      id: "legacy-react-page",
      dangerouslySetInnerHTML: { __html: props.html }
    });
  }

  function EventBridge(props) {
    const eventStatsRef = window.React.useRef({
      clicks: 0,
      changes: 0,
      inputs: 0,
      submits: 0
    });

    const publishStats = () => {
      window.__rescuenetReactEventStats = {
        ...eventStatsRef.current
      };
    };

    const handleClick = () => {
      eventStatsRef.current.clicks += 1;
      publishStats();
    };

    const handleChange = () => {
      eventStatsRef.current.changes += 1;
      publishStats();
    };

    const handleInput = () => {
      eventStatsRef.current.inputs += 1;
      publishStats();
    };

    const handleSubmit = () => {
      eventStatsRef.current.submits += 1;
      publishStats();
    };

    return window.React.createElement(
      "div",
      {
        id: "legacy-event-bridge",
        style: { display: "contents" },
        onClick: handleClick,
        onChange: handleChange,
        onInput: handleInput,
        onSubmit: handleSubmit
      },
      props.children
    );
  }

  function RuntimeBridge(props) {
    window.React.useEffect(() => {
      const mountedAt = new Date().toISOString();
      window.__rescuenetReactBridgeMountedAt = mountedAt;
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("rescuenet:react-bridge-mounted", {
          detail: { mountedAt: mountedAt }
        }));
      }
    }, []);

    return window.React.createElement(window.React.Fragment, null, props.children);
  }

  function LegacyPageApp(props) {
    return window.React.createElement(
      RuntimeBridge,
      null,
      window.React.createElement(
        EventBridge,
        null,
        window.React.createElement(LegacyMarkup, { html: props.html })
      )
    );
  }

  function applyLayoutPassthrough(rootEl, pageContainer) {
    if (rootEl) {
      rootEl.style.display = "contents";
      rootEl.style.width = "100%";
      rootEl.style.flex = "1 1 auto";
      rootEl.style.minWidth = "0";
    }
    if (pageContainer) {
      pageContainer.style.display = "contents";
    }
  }

  function copyAttributes(sourceEl, targetEl) {
    const attrs = Array.from(sourceEl.attributes || []);
    for (const attr of attrs) {
      targetEl.setAttribute(attr.name, attr.value);
    }
  }

  function executeInlineScript(oldScript, newScript) {
    newScript.textContent = oldScript.textContent || "";
    if (oldScript.parentNode) {
      oldScript.parentNode.replaceChild(newScript, oldScript);
    }
  }

  function executeExternalScript(oldScript, newScript) {
    return new Promise((resolve) => {
      newScript.onload = () => resolve();
      newScript.onerror = () => resolve();
      if (oldScript.parentNode) {
        oldScript.parentNode.replaceChild(newScript, oldScript);
      } else {
        resolve();
      }
    });
  }

  async function executeScriptsInOrder(container) {
    const scripts = Array.from(container.querySelectorAll("script"));
    for (const oldScript of scripts) {
      const newScript = document.createElement("script");
      copyAttributes(oldScript, newScript);

      if (oldScript.src) {
        await executeExternalScript(oldScript, newScript);
      } else {
        executeInlineScript(oldScript, newScript);
      }
    }
  }

  async function mountLegacyPage(options) {
    if (window.__rescuenetLegacyReactMounted) return;
    window.__rescuenetLegacyReactMounted = true;

    const config = options || {};
    const templateId = config.templateId || "legacy-page-template";
    const rootId = config.rootId || "react-root";

    const template = document.getElementById(templateId);
    const mountRoot = document.getElementById(rootId);
    if (!template || !mountRoot) return;

    try {
      await ensureReactRuntime();
    } catch (error) {
      console.error("RescueNet React runtime load failed:", error);
      mountRoot.innerHTML = '<div id="legacy-react-page">' + template.innerHTML + "</div>";
      const fallbackContainer = document.getElementById("legacy-react-page");
      applyLayoutPassthrough(mountRoot, fallbackContainer);
      if (fallbackContainer) await executeScriptsInOrder(fallbackContainer);
      return;
    }

    const markup = template.innerHTML;
    applyLayoutPassthrough(mountRoot, null);
    const root = window.ReactDOM.createRoot(mountRoot);
    root.render(window.React.createElement(LegacyPageApp, { html: markup }));

    requestAnimationFrame(async () => {
      const container = document.getElementById("legacy-react-page");
      if (!container) return;
      applyLayoutPassthrough(mountRoot, container);
      await executeScriptsInOrder(container);
    });
  }

  window.mountLegacyPage = mountLegacyPage;
})();
