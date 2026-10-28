
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

  const CREATE_NEW_TOPIC = "__studytrack_create_new_topic__";

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
      *, *::before, *::after {
        box-sizing: border-box;
      }

      .logo {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: #1967d2;
        color: #fff;
        box-shadow: 0 4px 18px #0004;
        font: 700 20px Arial, sans-serif;
        cursor: pointer;
        pointer-events: auto;
      }

      .logo:hover {
        background: #185abc;
      }

      .card {
        position: fixed;
        right: 18px;
        bottom: 76px;
        width: 340px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 100px);
        overflow: auto;
        padding: 18px;
        border: 1px solid #dfe3e8;
        border-radius: 16px;
        background: #fff;
        color: #202124;
        box-shadow: 0 8px 32px #0003;
        font: 14px/1.45 Arial, sans-serif;
        pointer-events: auto;
        isolation: isolate;
      }

      .card button,
      .card input,
      .card select {
        box-sizing: border-box;
        max-width: 100%;
        font-family: Arial, sans-serif;
      }

      .hidden {
        display: none !important;
      }

      .header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .mark {
        display: flex;
        flex: 0 0 38px;
        align-items: center;
        justify-content: center;
        height: 38px;
        border-radius: 11px;
        background: #e8f0fe;
        color: #174ea6;
        font-size: 20px;
        font-weight: 700;
      }

      .heading {
        margin: 0 0 5px;
        color: #202124;
        font-size: 17px;
        font-weight: 700;
      }

      .description {
        margin: 0;
        color: #5f6368;
        overflow-wrap: anywhere;
      }

      .close {
        flex: 0 0 auto;
        margin-left: auto;
        padding: 0 5px;
        border: 0;
        background: transparent;
        color: #5f6368;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
      }

      .domain {
        margin: 14px 0 4px;
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
        margin: 15px 0 7px;
        color: #202124;
        font-weight: 600;
      }

      .topic,
      .new-topic {
        display: block;
        width: 100%;
        min-width: 0;
        min-height: 40px;
        margin: 0;
        padding: 9px 10px;
        border: 1px solid #dadce0;
        border-radius: 8px;
        background: #fff;
        color: #202124;
        font-size: 14px;
        line-height: 1.4;
      }

      .topic {
        cursor: pointer;
      }

      .topic:focus,
      .new-topic:focus {
        border-color: #1967d2;
        outline: 2px solid #d2e3fc;
      }

      .new-topic {
        margin-top: 8px;
      }

      .actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        margin-top: 15px;
      }

      .button {
        display: block;
        width: 100%;
        min-width: 0;
        min-height: 40px;
        margin: 0;
        padding: 9px 8px;
        border: 0;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 600;
        text-align: center;
        overflow-wrap: anywhere;
        cursor: pointer;
      }

      .primary {
        background: #1967d2;
        color: #fff;
      }

      .primary:hover:not(:disabled) {
        background: #185abc;
      }

      .secondary {
        background: #f1f3f4;
        color: #202124;
      }

      .danger {
        background: #fce8e6;
        color: #b3261e;
      }

      .button:disabled,
      .topic:disabled,
      .new-topic:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .status {
        min-height: 18px;
        margin: 11px 0 0;
        color: #137333;
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .error {
        color: #b3261e;
      }

      .small {
        margin: 6px 0 0;
        color: #5f6368;
        font-size: 12px;
      }
    </style>

    <button class="logo hidden" type="button"
      title="Open StudyTrack" aria-label="Open StudyTrack">S</button>

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

      <select class="topic" id="studytrack-topic" disabled>
        <option value="">Loading topics...</option>
      </select>

      <input class="new-topic hidden" type="text" maxlength="50"
        placeholder="Enter a new topic name"
        aria-label="New study topic">

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
  const newTopicInput = shadow.querySelector(".new-topic");
  const startButton = shadow.querySelector(".start");
  const addButton = shadow.querySelector(".add");
  const stopButton = shadow.querySelector(".stop");
  const removeButton = shadow.querySelector(".remove");
  const notNowButton = shadow.querySelector(".not-now");
  const status = shadow.querySelector(".status");

  domainLabel.textContent = domain;

  let topics = [];
  let topicsLoaded = false;
  let busy = false;
  let siteConfig = null;
  let activeSession = null;
  let elapsedMs = 0;
  let stoppedSession = false;
  let cardMode = "invitation";
  let refreshInProgress = false;
  let clockInterval = null;
  let refreshInterval = null;

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
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  }

  function findMatchingSite(sites) {
    return (Array.isArray(sites) ? sites : [])
      .filter(site => {
        const siteDomain = String(site?.domain || "")
          .toLowerCase()
          .replace(/\.$/, "");

        return siteDomain &&
          (domain === siteDomain || domain.endsWith("." + siteDomain));
      })
      .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
  }

  async function sendMessage(message) {
    let response;

    try {
      response = await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw new Error(
        `StudyTrack connection failed: ${error?.message || "Please reload the extension."}`
      );
    }

    if (!response || !response.success) {
      throw new Error(
        response?.error || "StudyTrack could not complete this action."
      );
    }

    return response;
  }

  // All action-button disabled states are managed in one place.
  // This prevents a successful action from leaving the other button disabled.
  function updateControls() {
    const isActive = Boolean(
      activeSession && activeSession.hostname === domain
    );

    topicSelect.disabled = busy || isActive || !topicsLoaded;
    newTopicInput.disabled = busy || isActive || !topicsLoaded;

    startButton.disabled = busy || isActive || !topicsLoaded;
    addButton.disabled = busy || isActive || !topicsLoaded;
    stopButton.disabled = busy;
    removeButton.disabled = busy;
    notNowButton.disabled = busy;
    closeButton.disabled = busy;
  }

  function setBusy(value) {
    busy = value;
    updateControls();
  }

  async function loadTopics(preferredTopic) {
    const response = await sendMessage({
      action: "GET_NOTE_TOPICS"
    });

    const receivedTopics = Array.isArray(response.topics)
      ? response.topics
      : [];

    topics = [...new Set(
      receivedTopics
        .filter(topic => typeof topic === "string")
        .map(topic => topic.trim())
        .filter(Boolean)
    )];

    topicSelect.replaceChildren();

    if (topics.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No topics available";
      topicSelect.appendChild(emptyOption);
    }

    for (const topic of topics) {
      const option = document.createElement("option");
      option.value = topic;
      option.textContent = topic;
      topicSelect.appendChild(option);
    }

    const createOption = document.createElement("option");
    createOption.value = CREATE_NEW_TOPIC;
    createOption.textContent = "+ Create a new topic...";
    topicSelect.appendChild(createOption);

    const preferred = topics.find(topic =>
      topic.toLowerCase() === String(preferredTopic || "").toLowerCase()
    );

    topicSelect.value = preferred || topics[0] || CREATE_NEW_TOPIC;

    newTopicInput.classList.toggle(
      "hidden",
      topicSelect.value !== CREATE_NEW_TOPIC
    );

    topicsLoaded = true;
    updateControls();
  }

  async function resolveSelectedTopic() {
    if (!topicsLoaded) {
      throw new Error("Topics are still loading. Please try again.");
    }

    if (topicSelect.value !== CREATE_NEW_TOPIC) {
      const selected = String(topicSelect.value || "").trim();

      if (!selected) {
        throw new Error("Please select a study topic.");
      }

      return selected;
    }

    const name = String(newTopicInput.value || "").trim();

    if (!name) {
      newTopicInput.focus();
      throw new Error("Enter a name for your new topic.");
    }

    const response = await sendMessage({
      action: "CREATE_NOTE_TOPIC",
      topic: name
    });

    await loadTopics(response.topic);

    topicSelect.value = response.topic;
    newTopicInput.value = "";
    newTopicInput.classList.add("hidden");

    return response.topic;
  }

  topicSelect.addEventListener("change", () => {
    const creating = topicSelect.value === CREATE_NEW_TOPIC;

    newTopicInput.classList.toggle("hidden", !creating);

    if (creating) newTopicInput.focus();

    setStatus(
      creating
        ? "Enter a name for your new topic."
        : `Selected topic: ${topicSelect.value}`
    );
  });

  function renderState() {
    const isActive = Boolean(
      activeSession && activeSession.hostname === domain
    );

    const isListed = Boolean(siteConfig);

    timer.classList.toggle("hidden", !isActive && !stoppedSession);
    sessionLabel.classList.toggle("hidden", !isActive && !stoppedSession);

    stopButton.classList.toggle("hidden", !isActive);
    removeButton.classList.toggle("hidden", !isListed);

    startButton.classList.toggle("hidden", isActive);
    addButton.classList.toggle("hidden", isListed);

    if (isActive) {
      cardMode = "active";
      timer.textContent = formatDuration(elapsedMs);
      sessionLabel.textContent = `Studying ${activeSession.subject || "Other"}`;
      notNowButton.textContent = "Minimize";

      if (!busy) {
        setStatus(activeSession.isPaused
          ? "Study timer paused. Return to this website to resume."
          : "Your study time is being recorded.");
      }
    } else if (isListed) {
      cardMode = "listed";
      notNowButton.textContent = "Minimize";

      if (stoppedSession) {
        timer.textContent = "00:00:00";
        sessionLabel.textContent = "Session stopped";

        if (!busy) {
          setStatus("Session saved. Click Start studying to begin again.");
        }
      } else {
        timer.classList.add("hidden");
        sessionLabel.classList.add("hidden");

        if (!busy) {
          setStatus("This website is in your study list.");
        }
      }
    } else {
      cardMode = "invitation";
      notNowButton.textContent = "Not now";

      if (!busy && topicsLoaded) {
        setStatus("Choose a topic, then add this site to start tracking.");
      }
    }

    updateControls();
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

      stoppedSession = Boolean(data.stopped && siteConfig);
      elapsedMs = activeSession ? (data.elapsedMs || 0) : 0;

      renderState();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      refreshInProgress = false;
    }
  }

  async function initialize() {
    setBusy(true);

    try {
      const data = await sendMessage({
        action: "GET_WEBSITE_TRACKING_DATA"
      });

      siteConfig = findMatchingSite(data.sites);

      activeSession = data.active && (
        data.active.hostname === domain ||
        domain.endsWith("." + data.active.hostname)
      ) ? data.active : null;

      stoppedSession = Boolean(data.stopped && siteConfig);
      elapsedMs = activeSession ? (data.elapsedMs || 0) : 0;

      await loadTopics(activeSession?.subject || siteConfig?.subject);

      renderState();

      if (activeSession || siteConfig) {
        showLogo();
      } else {
        showCard();
      }
    } catch (error) {
      showCard();
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  }

  logo.addEventListener("click", async () => {
    showCard();
    setBusy(true);

    try {
      await refreshState();

      await loadTopics(
        activeSession?.subject || siteConfig?.subject || topicSelect.value
      );

      renderState();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  });

  closeButton.addEventListener("click", showLogo);

  notNowButton.addEventListener("click", () => {
    showLogo();
  });

  startButton.addEventListener("click", async () => {
    if (busy) return;

    setBusy(true);
    setStatus("Starting your study session...");

    try {
      const subject = await resolveSelectedTopic();

      const response = await sendMessage({
        action: "START_WEBSITE_SESSION",
        domain,
        subject
      });

      siteConfig = findMatchingSite(response.sites);
      activeSession = response.active;
      stoppedSession = false;
      elapsedMs = 0;

      renderState();
      setStatus(`Study session started: ${subject}`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  });

  addButton.addEventListener("click", async () => {
    if (busy) return;

    setBusy(true);
    setStatus("Adding website to your study list...");

    try {
      const subject = await resolveSelectedTopic();

      const response = await sendMessage({
        action: "ADD_STUDY_SITE",
        domain,
        subject
      });

      siteConfig = findMatchingSite(response.sites);

      activeSession = response.active &&
        response.active.hostname === domain
        ? response.active
        : null;

      stoppedSession = false;
      elapsedMs = 0;

      renderState();

      setStatus(activeSession
        ? `Study session started: ${subject}`
        : `Website added to your study list under ${subject}.`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  });

  stopButton.addEventListener("click", async () => {
    if (busy) return;

    setBusy(true);
    setStatus("Saving your study session...");

    try {
      await sendMessage({
        action: "STOP_WEBSITE_SESSION",
        domain
      });

      activeSession = null;
      elapsedMs = 0;
      stoppedSession = true;

      await refreshState();
      renderState();

      setStatus("Session saved. Click Start studying to begin again.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  });

  removeButton.addEventListener("click", async () => {
    if (busy) return;

    setBusy(true);
    setStatus("Removing website from your study list...");

    try {
      const response = await sendMessage({
        action: "REMOVE_STUDY_SITE",
        domain
      });

      siteConfig = findMatchingSite(response.sites);
      activeSession = null;
      stoppedSession = false;
      elapsedMs = 0;

      await refreshState();
      renderState();
      showCard();

      setStatus("Website removed from your study list.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      updateControls();
    }
  });

  initialize();

  // Keep the timer moving locally while a session is running.
  clockInterval = setInterval(() => {
    if (activeSession && !activeSession.isPaused) {
      elapsedMs += 1000;
      timer.textContent = formatDuration(elapsedMs);
    }
  }, 1000);

  // Refresh tracking state in case it changes in another tab or popup.
  refreshInterval = setInterval(() => {
    refreshState();
  }, 3000);
})();
