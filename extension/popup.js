
const timerDisplay = document.getElementById("timer");
const timerStatus = document.getElementById("timerStatus");
const accountForm = document.getElementById("accountForm");
const accountEmail = document.getElementById("accountEmail");
const accountPassword = document.getElementById("accountPassword");
const connectAccountBtn = document.getElementById("connectAccountBtn");
const disconnectAccountBtn = document.getElementById("disconnectAccountBtn");
const accountUser = document.getElementById("accountUser");
const accountStatus = document.getElementById("accountStatus");
const syncGroupPicker = document.getElementById("syncGroupPicker");
const syncGroupSelect = document.getElementById("syncGroupSelect");
const subjectSelect = document.getElementById("subject");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");

const autoStatus = document.getElementById("autoStatus");
const siteDomainInput = document.getElementById("siteDomain");
const siteSubjectSelect = document.getElementById("siteSubject");
const addSiteBtn = document.getElementById("addSiteBtn");
const siteStatus = document.getElementById("siteStatus");
const sitesList = document.getElementById("sitesList");

const captureBtn = document.getElementById("captureBtn");
const noteTitle = document.getElementById("noteTitle");
const noteText = document.getElementById("noteText");
const noteSubject = document.getElementById("noteSubject");
const noteDomain = document.getElementById("noteDomain");
const newNoteDomain = document.getElementById("newNoteDomain");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const noteStatus = document.getElementById("noteStatus");
const notesList = document.getElementById("notesList");

let timerState = {
  status: "idle",
  subject: "DSA",
  elapsedMs: 0,
  startedAt: null,
  sessionStartedAt: null
};

let activeWebsiteSession = null;
let trackedSites = [];
let refreshInProgress = false;
let notebookTopics = [];
const CREATE_DOMAIN_OPTION = "__studytrack_create_domain__";

// -------------------- Utilities --------------------

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function formatDuration(milliseconds) {
  return formatTime(
    Math.floor(Math.max(0, milliseconds) / 1000)
  );
}

function setStatus(element, message, isError = false) {
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("error", isError);
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.success) {
    throw new Error(response?.error || "StudyTrack request failed.");
  }

  return response;
}

function renderAccount(user, groups = [], selectedGroupId = "") {
  const connected = Boolean(user);
  accountForm.hidden = connected;
  disconnectAccountBtn.hidden = !connected;
  accountUser.hidden = !connected;
  syncGroupPicker.hidden = !connected;
  accountUser.textContent = connected
    ? `Connected as ${user.email}`
    : "";

  syncGroupSelect.replaceChildren(
    new Option("Personal workspace", "")
  );
  groups.forEach(group => {
    syncGroupSelect.appendChild(new Option(group.name, String(group.id)));
  });
  syncGroupSelect.value = groups.some(
    group => String(group.id) === String(selectedGroupId)
  ) ? String(selectedGroupId) : "";
}

accountForm.addEventListener("submit", async event => {
  event.preventDefault();
  connectAccountBtn.disabled = true;

  try {
    const result = await sendMessage({
      action: "CONNECT_ACCOUNT",
      email: accountEmail.value.trim(),
      password: accountPassword.value
    });
    const [groups, account] = await Promise.all([
      sendMessage({ action: "GET_ACCOUNT_GROUPS" }),
      sendMessage({ action: "GET_ACCOUNT_STATE" })
    ]);
    accountPassword.value = "";
    renderAccount(result.user, groups.groups, account.groupId);
    setStatus(accountStatus, "Account connected.");
    await refreshAutomaticTracking();
  } catch (error) {
    setStatus(accountStatus, error.message, true);
  } finally {
    connectAccountBtn.disabled = false;
  }
});

disconnectAccountBtn.addEventListener("click", async () => {
  try {
    await sendMessage({ action: "DISCONNECT_ACCOUNT" });
    await sendMessage({ action: "SET_SYNC_GROUP", groupId: null });
    renderAccount(null);
    setStatus(accountStatus, "Account disconnected.");
  } catch (error) {
    setStatus(accountStatus, error.message, true);
  }
});

syncGroupSelect.addEventListener("change", async () => {
  try {
    await sendMessage({
      action: "SET_SYNC_GROUP",
      groupId: syncGroupSelect.value || null
    });
    setStatus(accountStatus, "Session workspace updated.");
  } catch (error) {
    setStatus(accountStatus, error.message, true);
  }
});

// -------------------- Topics --------------------

async function loadTopics() {
  const response = await sendMessage({
    action: "GET_NOTEBOOK_OPTIONS"
  });

  notebookTopics = Array.isArray(response.topics) ? response.topics : [];
  const topics = notebookTopics.map(topic => topic.name);

  populateSelect(subjectSelect, topics, timerState.subject || "DSA");
  populateSelect(
    siteSubjectSelect,
    topics,
    siteSubjectSelect.value || "DSA"
  );
  populateSelect(
    noteSubject,
    topics,
    noteSubject.value || "DSA"
  );
  populateNoteDomains();
}

function populateNoteDomains(preferredDomain = noteDomain.value) {
  const selectedTopic = notebookTopics.find(
    topic => topic.name === noteSubject.value
  );
  const domains = [...new Set(["General", ...(selectedTopic?.domains || [])])];
  const creatingDomain = preferredDomain === CREATE_DOMAIN_OPTION;
  const domainValue = creatingDomain
    ? newNoteDomain.value
    : preferredDomain;
  domains.push(CREATE_DOMAIN_OPTION);
  const labels = new Map(domains.map(domain => [
    domain,
    domain === CREATE_DOMAIN_OPTION ? "+ Create a new domain..." : domain
  ]));
  populateSelect(
    noteDomain,
    domains,
    domains.includes(domainValue) ? domainValue : "General"
  );
  [...noteDomain.options].forEach(option => {
    option.textContent = labels.get(option.value) || option.value;
  });
  newNoteDomain.hidden = noteDomain.value !== CREATE_DOMAIN_OPTION;
}

noteSubject.addEventListener("change", () => {
  populateNoteDomains("General");
});

noteDomain.addEventListener("change", () => {
  const creating = noteDomain.value === CREATE_DOMAIN_OPTION;
  newNoteDomain.hidden = !creating;
  if (creating) newNoteDomain.focus();
});

async function resolveNoteDomain(topic) {
  if (noteDomain.value !== CREATE_DOMAIN_OPTION) {
    return noteDomain.value || "General";
  }
  const name = newNoteDomain.value.trim();
  if (!name) {
    newNoteDomain.focus();
    throw new Error("Enter a domain name.");
  }
  const result = await sendMessage({
    action: "CREATE_NOTE_DOMAIN",
    topic,
    domain: name
  });
  await loadTopics();
  noteSubject.value = topic;
  populateNoteDomains(result.domain);
  return result.domain;
}

function populateSelect(select, topics, selectedValue) {
  if (!select) return;

  const previousValue = selectedValue || select.value;
  select.replaceChildren();

  topics.forEach(topic => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    select.appendChild(option);
  });

  if (
    previousValue &&
    !topics.some(topic => topic === previousValue)
  ) {
    const option = document.createElement("option");
    option.value = previousValue;
    option.textContent = previousValue;
    select.appendChild(option);
  }

  if (previousValue) {
    select.value = previousValue;
  }
}

// -------------------- Manual timer --------------------

function getDisplayedElapsedMs() {
  if (
    timerState.status === "running" &&
    timerState.startedAt
  ) {
    return timerState.elapsedMs +
      Math.max(0, Date.now() - timerState.startedAt);
  }

  return timerState.elapsedMs || 0;
}

function renderTimer() {
  if (!timerDisplay) return;

  timerDisplay.textContent = formatDuration(
    getDisplayedElapsedMs()
  );

  const running = timerState.status === "running";
  const paused = timerState.status === "paused";

  if (startBtn) startBtn.disabled = running;
  if (pauseBtn) pauseBtn.disabled = !running;
  if (stopBtn) stopBtn.disabled = timerState.status === "idle";

  if (subjectSelect) {
    subjectSelect.disabled = running || paused;
  }

  if (timerStatus) {
    if (running) {
      timerStatus.textContent = `Studying ${timerState.subject}`;
    } else if (paused) {
      timerStatus.textContent = "Manual study session paused";
    } else {
      timerStatus.textContent = "Ready to study?";
    }
  }
}

async function sendTimerAction(action, extra = {}) {
  const response = await sendMessage({
    action,
    ...extra
  });

  timerState = response.state;
  renderTimer();

  return response;
}

async function initializeTimer() {
  const response = await sendMessage({
    action: "GET_TIMER_STATE"
  });

  timerState = response.state;
  subjectSelect.value = timerState.subject || "DSA";

  renderTimer();
}

startBtn.addEventListener("click", async () => {
  try {
    await sendTimerAction("START_TIMER", {
      subject: subjectSelect.value
    });
  } catch (error) {
    setStatus(timerStatus, error.message, true);
  }
});

pauseBtn.addEventListener("click", async () => {
  try {
    await sendTimerAction("PAUSE_TIMER");
  } catch (error) {
    setStatus(timerStatus, error.message, true);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    const response = await sendTimerAction("STOP_TIMER");

    timerDisplay.textContent = "00:00:00";

    setStatus(
      timerStatus,
      response.completedDurationMs > 0
        ? `Session saved: ${formatDuration(response.completedDurationMs)}`
        : "Session stopped."
    );
  } catch (error) {
    setStatus(timerStatus, error.message, true);
  }
});

// -------------------- Automatic website tracking --------------------

function getLiveWebsiteElapsedMs() {
  if (!activeWebsiteSession) {
    return 0;
  }

  const accumulated = activeWebsiteSession.accumulatedMs || 0;

  // Important: never add time while the website session is paused.
  if (activeWebsiteSession.isPaused) {
    return accumulated;
  }

  const checkpoint = activeWebsiteSession.lastCheckpointAt;

  if (!checkpoint) {
    return accumulated;
  }

  return accumulated + Math.max(0, Date.now() - checkpoint);
}

function renderAutomaticStatus() {
  if (!autoStatus) return;

  if (activeWebsiteSession) {
    const paused = activeWebsiteSession.isPaused === true;

    autoStatus.textContent = paused
      ? `Paused ${activeWebsiteSession.hostname} · ` +
        `${activeWebsiteSession.subject} · ` +
        formatDuration(getLiveWebsiteElapsedMs())
      : `Tracking ${activeWebsiteSession.hostname} · ` +
        `${activeWebsiteSession.subject} · ` +
        formatDuration(getLiveWebsiteElapsedMs());

    return;
  }

  if (trackedSites.length > 0) {
    autoStatus.textContent =
      "Not tracking right now. Open a configured study website " +
      "in a focused browser window.";
  } else {
    autoStatus.textContent =
      "Add a study website below to enable automatic tracking.";
  }
}

async function refreshAutomaticTracking() {
  if (refreshInProgress) return;

  refreshInProgress = true;

  try {
    const response = await sendMessage({
      action: "GET_WEBSITE_TRACKING_DATA"
    });

    activeWebsiteSession = response.active || null;
    trackedSites = response.sites || [];

    renderAutomaticStatus();
    renderStudySites();
  } catch (error) {
    setStatus(
      autoStatus,
      "Could not refresh tracking status.",
      true
    );

    console.error(
      "StudyTrack tracking refresh failed:",
      error
    );
  } finally {
    refreshInProgress = false;
  }
}

function renderStudySites() {
  if (!sitesList) return;

  sitesList.replaceChildren();

  if (trackedSites.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No study websites added yet.";
    sitesList.appendChild(empty);
    return;
  }

  trackedSites.forEach(site => {
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "site-row";

    const info = document.createElement("div");
    info.className = "site-info";

    const domain = document.createElement("div");
    domain.className = "site-domain";
    domain.textContent = site.domain;

    const subject = document.createElement("div");
    subject.className = "site-subject";
    subject.textContent = `Topic: ${site.subject}`;

    info.append(domain, subject);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-btn";
    removeButton.textContent = "Remove";
    removeButton.type = "button";

    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;

      try {
        await sendMessage({
          action: "REMOVE_STUDY_SITE",
          domain: site.domain
        });

        setStatus(siteStatus, `Removed ${site.domain}.`);
        await refreshAutomaticTracking();
      } catch (error) {
        setStatus(siteStatus, error.message, true);
      } finally {
        removeButton.disabled = false;
      }
    });

    row.append(info, removeButton);
    item.appendChild(row);
    sitesList.appendChild(item);
  });
}

addSiteBtn.addEventListener("click", async () => {
  const domain = siteDomainInput.value.trim();

  if (!domain) {
    setStatus(siteStatus, "Enter a website domain.", true);
    return;
  }

  addSiteBtn.disabled = true;

  try {
    await sendMessage({
      action: "ADD_STUDY_SITE",
      domain,
      subject: siteSubjectSelect.value
    });

    siteDomainInput.value = "";

    setStatus(
      siteStatus,
      "Study website added successfully."
    );

    await refreshAutomaticTracking();
  } catch (error) {
    setStatus(siteStatus, error.message, true);
  } finally {
    addSiteBtn.disabled = false;
  }
});

siteDomainInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    addSiteBtn.click();
  }
});

// -------------------- Notes --------------------

captureBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      setStatus(noteStatus, "No active tab found.", true);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || ""
    });

    const selectedText = results[0]?.result || "";

    if (!selectedText.trim()) {
      setStatus(
        noteStatus,
        "Select some text on the webpage first.",
        true
      );
      return;
    }

    noteText.value = selectedText;

    setStatus(
      noteStatus,
      "Text captured. Save it when ready."
    );
  } catch (error) {
    setStatus(
      noteStatus,
      "Cannot capture text from this page.",
      true
    );
  }
});

async function renderNotes() {
  const { studyNotes = [] } =
    await chrome.storage.local.get("studyNotes");

  notesList.replaceChildren();

  if (studyNotes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No notes saved yet.";
    notesList.appendChild(empty);
    return;
  }

  studyNotes.slice(0, 30).forEach(note => {
    const item = document.createElement("li");
    const info = document.createElement("div");
    info.className = "note-info";

    const title = document.createElement("div");
    title.className = "note-title";
    title.textContent = note.title || "Untitled note";

    const meta = document.createElement("div");
    meta.className = "note-meta";
    meta.textContent =
      `${note.subject || note.topic || "Other"} · ` +
      `${note.pageTitle || note.url || "No source"}`;

    const content = document.createElement("div");
    content.className = "note-text";
    content.textContent = note.text;

    info.append(title, meta, content);
    item.appendChild(info);
    notesList.appendChild(item);
  });
}

saveNoteBtn.addEventListener("click", async () => {
  const text = noteText.value.trim();

  if (!text) {
    setStatus(
      noteStatus,
      "Enter or capture some text first.",
      true
    );
    return;
  }

  saveNoteBtn.disabled = true;

  try {
    const topic = noteSubject.value || subjectSelect.value;
    const domain = await resolveNoteDomain(topic);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const saved = await sendMessage({
      action: "SAVE_NOTE_FROM_PAGE",
      text,
      title: noteTitle.value.trim() || tab?.title || "Untitled note",
      pageTitle: tab?.title || "",
      url: tab?.url || "",
      topic,
      domain
    });

    noteText.value = "";
    noteTitle.value = "";

    setStatus(noteStatus, saved.note?.synced
      ? "Added to the topic notebook."
      : "Saved locally. Sync will retry when connected.");

    await loadTopics();
    await renderNotes();
  } catch (error) {
    setStatus(noteStatus, error.message, true);
  } finally {
    saveNoteBtn.disabled = false;
  }
});

// -------------------- Initialization --------------------

async function initialize() {
  try {
    let account = await sendMessage({ action: "GET_ACCOUNT_STATE" });
    let groups = [];
    if (account.user) {
      try {
        const response = await sendMessage({ action: "GET_ACCOUNT_GROUPS" });
        groups = response.groups;
      } catch (error) {
        account = await sendMessage({ action: "GET_ACCOUNT_STATE" });
        setStatus(accountStatus, error.message, true);
      }
    }
    renderAccount(account.user, groups, account.groupId);
    await initializeTimer();
    await loadTopics();
    await renderNotes();
    await refreshAutomaticTracking();

    // Refresh automatic tracking state from the background.
    setInterval(refreshAutomaticTracking, 2000);

    // Update the displayed clocks smoothly.
    setInterval(() => {
      renderTimer();
      renderAutomaticStatus();
    }, 250);
  } catch (error) {
    console.error(
      "StudyTrack initialization failed:",
      error
    );

    setStatus(
      autoStatus,
      "Could not initialize StudyTrack.",
      true
    );
  }
}

initialize();
