(() => {
  if (document.getElementById("studytrack-study-prompt-host")) return;

  let currentUrl;
  try {
    currentUrl = new URL(window.location.href);
  } catch {
    return;
  }

  if (!["http:", "https:"].includes(currentUrl.protocol)) return;

  const domain = currentUrl.hostname.toLowerCase();
  if (!domain) return;

  const host = document.createElement("div");
  host.id = "studytrack-study-prompt-host";

  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    width: "0",
    height: "0",
    zIndex: "2147483647",
    pointerEvents: "none"
  });

  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }

      .logo {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        border: 0;
        border-radius: 50%;
        background: #1967d2;
        color: #fff;
        box-shadow: 0 4px 18px #0004;
        font: 700 20px Arial, sans-serif;
        cursor: pointer;
        pointer-events: auto;
      }

      .logo:hover { background: #185abc; }

      .card {
        position: fixed;
        right: 18px;
        bottom: 76px;
        width: 326px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 100px);
        overflow: auto;
        padding: 17px;
        border: 1px solid #dfe3e8;
        border-radius: 16px;
        background: #fff;
        color: #202124;
        box-shadow: 0 8px 32px #0003;
        font: 14px/1.45 Arial, sans-serif;
        pointer-events: auto;
      }

      .hidden { display: none !important; }

      .header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .mark {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 38px;
        height: 38px;
        border-radius: 11px;
        background: #e8f0fe;
        color: #174ea6;
        font-size: 20px;
        font-weight: 700;
      }

      .heading { margin: 0 0 5px; font-size: 17px; }
      .description { margin: 0; color: #5f6368; overflow-wrap: anywhere; }

      .close {
        margin-left: auto;
        border: 0;
        background: transparent;
        color: #5f6368;
        font-size: 21px;
        cursor: pointer;
      }

      .domain {
        margin: 13px 0 4px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      .timer {
        margin: 12px 0 4px;
        font-size: 25px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .label {
        display: block;
        margin: 13px 0 6px;
        font-weight: 600;
      }

      .topic {
        width: 100%;
        padding: 10px;
        border: 1px solid #dadce0;
        border-radius: 8px;
        background: #fff;
        color: #202124;
        font: inherit;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .button {
        flex: 1 1 42%;
        min-width: 0;
        padding: 10px 8px;
        border: 0;
        border-radius: 8px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .primary { background: #1967d2; color: #fff; }
      .primary:hover { background: #185abc; }
      .secondary { background: #f1f3f4; color: #202124; }
      .danger { background: #fce8e6; color: #b3261e; }
      .button:disabled { opacity: .6; cursor: not-allowed; }

      .status {
        min-height: 18px;
        margin: 10px 0 0;
        color: #137333;
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .error { color: #b3261e; }
      .small { margin-top: 6px; color: #5f6368; font-size: 12px; }
    </style>

    <button
      class="logo hidden"
      type="button"
      title="Open StudyTrack"
      aria-label="Open StudyTrack"
    >S</button>

    <section class="card hidden" aria-label="StudyTrack controls">
      <div class="header">
        <div class="mark">S</div>
        <div>
          <h2 class="heading">StudyTrack</h2>
          <p class="description">Make time for focused learning.</p>
        </div>
        <button class="close" type="button" aria-label="Minimize">−</button>
      </div>

      <p class="domain"></p>
      <div class="timer hidden">00:00:00</div>
      <p class="small session-label hidden">Study session in progress</p>

      <label class="label" for="studytrack-topic">
        What are you studying?
      </label>

      <select class="topic" id="studytrack-topic">
        <option value="">Loading topics...</option>
      </select>

      <div class="actions">
        <button class="button primary start" type="button" disabled>
          Start studying
        </button>
        <button class="button secondary add" type="button" disabled>
          Add to study list
        </button>
        <button class="button danger stop hidden" type="button">
          Stop session
        </button>
        <button class="button danger remove hidden" type="button">
          Remove from study list
        </button>
        <button class="button secondary not-now" type="button">
          Not now
        </button>
      </div>

      <p class="status" role="status" aria-live="polite"></p>
    </section>
  `;

  document.documentElement.appendChild(host);

  const logo = shadow.querySelector(".logo");
  const card = shadow.querySelector(".card");
  const closeButton = shadow.querySelector(".close");
  const domainLabel = shadow.querySelector(".domain");
  const timer = shadow.querySelector(".timer");
  const sessionLabel = shadow.querySelector(".session-label");
  const topicSelect = shadow.querySelector(".topic");
  const startButton = shadow.querySelector(".start");
  const addButton = shadow.querySelector(".add");
  const stopButton = shadow.querySelector(".stop");
  const removeButton = shadow.querySelector(".remove");
  const notNowButton = shadow.querySelector(".not-now");
  const status = shadow.querySelector(".status");

  domainLabel.textContent = domain;

  let topics = [];
  let siteConfig = null;
  let activeSession = null;
  let elapsedMs = 0;
  let cardMode = "invitation";
  let refreshInProgress = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function showLogo() {
    card.classList.add("hidden");
    logo.classList.remove("hidden");
  }

  function showCard() {
    logo.classList.add("hidden");
    card.classList.remove("hidden");
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(
      Math.floor((totalSeconds % 3600) / 60)
    ).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  }

  function findMatchingSite(sites) {
    return (sites || [])
      .filter(site => {
        const siteDomain = String(site.domain || "")
          .toLowerCase()
          .replace(/\.$/, "");

        return domain === siteDomain || domain.endsWith("." + siteDomain);
      })
      .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
  }

  async function sendMessage(message) {
    const response = await chrome.runtime.sendMessage(message);

    if (!response || !response.success) {
      throw new Error(
        response?.error || "StudyTrack could not complete this action."
      );
    }

    return response;
  }

  async function loadTopics(preferredTopic) {
    const response = await sendMessage({ action: "GET_NOTE_TOPICS" });
    topics = response.topics || [];

    topicSelect.replaceChildren();

    for (const topic of topics) {
      const option = document.createElement("option");
      option.value = topic;
      option.textContent = topic;
      topicSelect.appendChild(option);
    }

    if (!topics.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Create a topic first";
      topicSelect.appendChild(option);

      startButton.disabled = true;
      addButton.disabled = true;
      return;
    }

    const match = topics.find(
      topic =>
        topic.toLowerCase() ===
        String(preferredTopic || "").toLowerCase()
    );

    topicSelect.value = match || topics[0];
    startButton.disabled = false;
    addButton.disabled = false;
  }

  function renderState() {
    const hasSession = Boolean(
      activeSession && activeSession.hostname === domain
    );
    const isListed = Boolean(siteConfig);

    timer.classList.toggle("hidden", !hasSession);
    sessionLabel.classList.toggle("hidden", !hasSession);
    stopButton.classList.toggle("hidden", !hasSession);
    removeButton.classList.toggle("hidden", !isListed);
    startButton.classList.toggle("hidden", hasSession);
    addButton.classList.toggle("hidden", isListed);
    topicSelect.disabled = hasSession;

    if (hasSession) {
      cardMode = activeSession.isPaused ? "paused" : "active";
      timer.textContent = formatDuration(elapsedMs);

      sessionLabel.textContent = activeSession.isPaused
        ? `Paused · ${activeSession.subject || "Other"}`
        : `Studying ${activeSession.subject || "Other"}`;

      startButton.textContent = "Start studying";
      notNowButton.textContent = "Minimize";

      setStatus(
        activeSession.isPaused
          ? "Tracking is paused. It will resume when you return to this website."
          : "Your study time is being recorded."
      );
    } else if (isListed) {
      cardMode = "listed";
      startButton.textContent = "Start studying";
      notNowButton.textContent = "Not now";
      setStatus("This website is in your study list.");
    } else {
      cardMode = "invitation";
      startButton.textContent = "Start studying";
      notNowButton.textContent = "Not now";
      setStatus("Choose a topic to begin, or add this site for later.");
    }
  }

  async function refreshState() {
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      const data = await sendMessage({
        action: "GET_WEBSITE_TRACKING_DATA"
      });

      siteConfig = findMatchingSite(data.sites);

      activeSession = data.active && (
        data.active.hostname === domain ||
        domain.endsWith("." + data.active.hostname)
      ) ? data.active : null;

      elapsedMs = activeSession ? (data.elapsedMs || 0) : 0;

      // Important: refreshing data must not change panel visibility.
      // The panel closes only when the user clicks Minimize or Not now.
      renderState();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      refreshInProgress = false;
    }
  }

  async function initialize() {
    try {
      const data = await sendMessage({
        action: "GET_WEBSITE_TRACKING_DATA"
      });

      siteConfig = findMatchingSite(data.sites);

      activeSession = data.active && (
        data.active.hostname === domain ||
        domain.endsWith("." + data.active.hostname)
      ) ? data.active : null;

      elapsedMs = activeSession ? (data.elapsedMs || 0) : 0;

      await loadTopics(activeSession?.subject || siteConfig?.subject);

      // On first load, show the invitation on a new site.
      // For listed sites or an existing session, start minimized.
      if (activeSession || siteConfig) {
        cardMode = activeSession
          ? (activeSession.isPaused ? "paused" : "active")
          : "listed";
        showLogo();
      } else {
        cardMode = "invitation";
        showCard();
      }

      renderState();
    } catch (error) {
      showCard();
      setStatus(error.message, true);
    }
  }

  logo.addEventListener("click", async () => {
    await refreshState();

    if (activeSession?.subject) {
      await loadTopics(activeSession.subject);
    } else if (siteConfig?.subject) {
      await loadTopics(siteConfig.subject);
    }

    renderState();
    showCard();
  });

  closeButton.addEventListener("click", showLogo);

  notNowButton.addEventListener("click", () => {
    cardMode = siteConfig ? "listed" : "dismissed";
    showLogo();
  });

  startButton.addEventListener("click", async () => {
    const subject = topicSelect.value;

    if (!subject) {
      setStatus("Please select a study topic.", true);
      return;
    }

    startButton.disabled = true;
    addButton.disabled = true;
    setStatus("Starting your study session...");

    try {
      const response = await sendMessage({
        action: "START_WEBSITE_SESSION",
        domain,
        subject
      });

      siteConfig = findMatchingSite(response.sites);
      activeSession = response.active;
      elapsedMs = 0;
      cardMode = "active";

      renderState();

      // Keep the panel open after starting. The user can minimize it manually.
      showCard();
    } catch (error) {
      setStatus(error.message, true);
      startButton.disabled = false;
      addButton.disabled = false;
    }
  });

  addButton.addEventListener("click", async () => {
    const subject = topicSelect.value;

    if (!subject) {
      setStatus("Please select a study topic.", true);
      return;
    }

    addButton.disabled = true;
    startButton.disabled = true;
    setStatus("Adding website to your study list...");

    try {
      const response = await sendMessage({
        action: "ADD_STUDY_SITE",
        domain,
        subject
      });

      siteConfig = findMatchingSite(response.sites);
      activeSession = null;
      cardMode = "listed";

      renderState();

      // Keep the panel open after adding the site.
      showCard();
    } catch (error) {
      setStatus(error.message, true);
      addButton.disabled = false;
      startButton.disabled = false;
    }
  });

  stopButton.addEventListener("click", async () => {
    stopButton.disabled = true;
    setStatus("Saving your study session...");

    try {
      await sendMessage({
        action: "STOP_WEBSITE_SESSION",
        domain
      });

      activeSession = null;
      elapsedMs = 0;
      await refreshState();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      stopButton.disabled = false;
    }
  });

  removeButton.addEventListener("click", async () => {
    removeButton.disabled = true;
    setStatus("Removing website from your study list...");

    try {
      const response = await sendMessage({
        action: "REMOVE_STUDY_SITE",
        domain
      });

      siteConfig = findMatchingSite(response.sites);
      activeSession = null;
      cardMode = "invitation";

      await refreshState();
      showCard();
    } catch (error) {
      setStatus(error.message, true);
      removeButton.disabled = false;
    }
  });

  initialize();

  // Only advance the displayed clock while the session is running.
  setInterval(() => {
    if (activeSession && !activeSession.isPaused) {
      elapsedMs += 1000;
      timer.textContent = formatDuration(elapsedMs);
    }
  }, 1000);

  // Refresh session data without changing whether the panel is open.
  setInterval(refreshState, 3000);
})();