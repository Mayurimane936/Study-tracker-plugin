const DEFAULT_STATE = {
  status: "idle",
  subject: "DSA",
  elapsedMs: 0,
  startedAt: null,
  sessionStartedAt: null
};

const DEFAULT_TOPICS = ["DSA", "C++", "System Design", "Other"];
const SAVE_SELECTION_MENU_ID = "studytrack-save-selection";
const CHECKPOINT_ALARM = "studytrack-website-checkpoint";
const MAX_SAVED_WEBSITE_SESSIONS = 2000;

let eventQueue = Promise.resolve();

function enqueue(task) {
  eventQueue = eventQueue.then(task).catch(error => {
    console.error("StudyTrack background error:", error);
  });
  return eventQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_SELECTION_MENU_ID,
      title: "Save selection to StudyTrack",
      contexts: ["selection"]
    });
  });

  chrome.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 1 });

  chrome.storage.local.get(["studyTopics", "studySites"], result => {
    const values = {};
    if (!Array.isArray(result.studyTopics)) values.studyTopics = DEFAULT_TOPICS;
    if (!Array.isArray(result.studySites)) values.studySites = [];
    if (Object.keys(values).length) chrome.storage.local.set(values);
  });

  enqueue(syncActiveTab);
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const { activeWebsiteSession: active } =
      await chrome.storage.local.get("activeWebsiteSession");

    // Do not count time while the browser was closed.
    if (active) {
      await finalizeActiveSession(active.lastCheckpointAt || active.startedAt);
    }

    await syncActiveTab();
  });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECKPOINT_ALARM) {
    enqueue(() => checkpointActiveSession(Date.now()));
  }
});

chrome.tabs.onActivated.addListener(() => enqueue(syncActiveTab));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete" || tab.active) {
    enqueue(syncActiveTab);
  }
});

chrome.tabs.onRemoved.addListener(() => enqueue(syncActiveTab));

chrome.windows.onFocusChanged.addListener(windowId => {
  enqueue(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await pauseActiveSession(Date.now());
    } else {
      await syncActiveTab();
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.studySites) {
    enqueue(syncActiveTab);
  }
});

async function getTimerState() {
  const { timerState } = await chrome.storage.local.get("timerState");
  return timerState
    ? { ...DEFAULT_STATE, ...timerState }
    : { ...DEFAULT_STATE };
}

function getElapsedMs(state) {
  if (state.status === "running" && state.startedAt) {
    return state.elapsedMs + (Date.now() - state.startedAt);
  }
  return state.elapsedMs;
}

async function saveTimerState(state) {
  await chrome.storage.local.set({ timerState: state });
}

function normalizeDomain(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Enter a website domain.");

  let url;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error("Enter a valid domain, such as leetcode.com.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites can be tracked.");
  }

  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function getHostname(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function findSiteConfig(hostname, sites) {
  if (!hostname) return null;

  const matches = sites
    .filter(site => site && typeof site.domain === "string")
    .filter(site =>
      hostname === site.domain ||
      hostname.endsWith(`.${site.domain}`)
    )
    .sort((a, b) => b.domain.length - a.domain.length);

  return matches[0] || null;
}

async function getWebsiteSites() {
  const { studySites = [] } = await chrome.storage.local.get("studySites");
  return Array.isArray(studySites) ? studySites : [];
}

async function checkpointActiveSession(endTime = Date.now()) {
  const { activeWebsiteSession: active } =
    await chrome.storage.local.get("activeWebsiteSession");

  if (!active || active.isPaused) return;

  const lastCheckpointAt =
    active.lastCheckpointAt || active.startedAt || endTime;
  const safeEndTime = Math.max(lastCheckpointAt, endTime);

  active.accumulatedMs = (active.accumulatedMs || 0) +
    Math.max(0, safeEndTime - lastCheckpointAt);
  active.lastCheckpointAt = safeEndTime;

  await chrome.storage.local.set({ activeWebsiteSession: active });
}

async function finalizeActiveSession(endTime = Date.now(), expectedDomain = null) {
  const { activeWebsiteSession: active } =
    await chrome.storage.local.get("activeWebsiteSession");

  if (!active) return null;

  if (
    expectedDomain &&
    active.hostname !== expectedDomain &&
    !active.hostname.endsWith(`.${expectedDomain}`)
  ) {
    return null;
  }

  const lastCheckpointAt =
    active.lastCheckpointAt || active.startedAt || endTime;
  const safeEndTime = active.isPaused
    ? lastCheckpointAt
    : Math.max(lastCheckpointAt, endTime);

  const durationMs = Math.max(
    0,
    (active.accumulatedMs || 0) +
      (active.isPaused ? 0 : safeEndTime - lastCheckpointAt)
  );

  if (durationMs >= 1000) {
    const { studyWebsiteSessions = [] } =
      await chrome.storage.local.get("studyWebsiteSessions");

    studyWebsiteSessions.unshift({
      id: crypto.randomUUID(),
      domain: active.hostname,
      subject: active.subject || "DSA",
      durationSeconds: Math.floor(durationMs / 1000),
      startedAt: new Date(active.startedAt).toISOString(),
      endedAt: new Date(safeEndTime).toISOString()
    });

    await chrome.storage.local.set({
      studyWebsiteSessions: studyWebsiteSessions.slice(
        0,
        MAX_SAVED_WEBSITE_SESSIONS
      )
    });
  }

  await chrome.storage.local.remove("activeWebsiteSession");
  return { ...active, durationMs, endedAt: safeEndTime };
}

async function pauseActiveSession(pauseTime = Date.now()) {
  const { activeWebsiteSession: active } =
    await chrome.storage.local.get("activeWebsiteSession");

  if (!active || active.isPaused) return;

  const lastCheckpointAt =
    active.lastCheckpointAt || active.startedAt || pauseTime;
  const safePauseTime = Math.max(lastCheckpointAt, pauseTime);

  active.accumulatedMs = (active.accumulatedMs || 0) +
    Math.max(0, safePauseTime - lastCheckpointAt);
  active.lastCheckpointAt = safePauseTime;
  active.isPaused = true;

  await chrome.storage.local.set({ activeWebsiteSession: active });
}

async function resumeActiveSession(active, tab) {
  if (
    !active ||
    !active.isPaused ||
    !tab ||
    tab.id == null ||
    tab.windowId == null
  ) {
    return active;
  }

  const hostname = getHostname(tab.url);
  if (!hostname || hostname !== active.hostname) return active;

  active.tabId = tab.id;
  active.windowId = tab.windowId;
  active.lastCheckpointAt = Date.now();
  active.isPaused = false;

  await chrome.storage.local.set({ activeWebsiteSession: active });
  return active;
}

/**
 * Automatically track whichever configured study website is currently active.
 * - A configured site in the focused browser window starts tracking.
 * - Switching to another configured site closes the previous session and starts
 *   a new one for the new site.
 * - Switching to a non-configured site or losing browser focus pauses tracking.
 */
async function syncActiveTab() {
  let tabs;

  try {
    tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    await pauseActiveSession(Date.now());
    return;
  }

  const tab = tabs?.[0];
  if (!tab || tab.id == null || tab.windowId == null) {
    await pauseActiveSession(Date.now());
    return;
  }

  let windowInfo;
  try {
    windowInfo = await chrome.windows.get(tab.windowId);
  } catch {
    await pauseActiveSession(Date.now());
    return;
  }

  const hostname = getHostname(tab.url);
  const focused = Boolean(windowInfo.focused);
  const sites = await getWebsiteSites();
  const siteConfig = focused ? findSiteConfig(hostname, sites) : null;
  const stored = await chrome.storage.local.get([
    "activeWebsiteSession",
    "stoppedWebsiteSession"
  ]);
  const active = stored.activeWebsiteSession || null;
  const stopped = stored.stoppedWebsiteSession || null;

  // After the user presses Stop, don't auto-start again while they remain
  // on the same tab. Leaving the tab/site clears this one-session suppression.
  const isSameStoppedTab = Boolean(
    stopped &&
    stopped.hostname === hostname &&
    stopped.tabId === tab.id &&
    stopped.windowId === tab.windowId
  );

  if (stopped && !isSameStoppedTab) {
    await chrome.storage.local.remove("stoppedWebsiteSession");
  }

  if (isSameStoppedTab) {
    if (active) await pauseActiveSession(Date.now());
    return;
  }

  if (!siteConfig) {
    await pauseActiveSession(Date.now());
    return;
  }

  const isSameSession = Boolean(
    active &&
    active.hostname === hostname &&
    active.tabId === tab.id &&
    active.windowId === tab.windowId
  );

  if (isSameSession) {
    if (active.isPaused) await resumeActiveSession(active, tab);
    return;
  }

  // Switching to another configured study website completes the old session.
  if (active) await finalizeActiveSession(Date.now());

  const now = Date.now();
  const newActiveSession = {
    tabId: tab.id,
    windowId: tab.windowId,
    hostname,
    subject: String(siteConfig.subject || "DSA").trim() || "DSA",
    startedAt: now,
    lastCheckpointAt: now,
    accumulatedMs: 0,
    isPaused: false
  };

  await chrome.storage.local.set({ activeWebsiteSession: newActiveSession });
}

async function getNoteTopics() {
  const { studyTopics = [], studyNotes = [] } =
    await chrome.storage.local.get(["studyTopics", "studyNotes"]);

  const topics = [
    ...DEFAULT_TOPICS,
    ...studyTopics,
    ...(Array.isArray(studyNotes)
      ? studyNotes.map(note => note.subject || note.topic)
      : [])
  ];

  return [...new Set(
    topics
      .filter(topic => typeof topic === "string")
      .map(topic => topic.trim())
      .filter(Boolean)
  )];
}

async function createNoteTopic(topicName) {
  const name = String(topicName || "").trim();

  if (!name) throw new Error("Enter a topic name.");
  if (name.length > 50) {
    throw new Error("Topic names must be 50 characters or fewer.");
  }

  const topics = await getNoteTopics();
  const existing = topics.find(
    topic => topic.toLowerCase() === name.toLowerCase()
  );

  if (existing) return existing;

  topics.push(name);
  await chrome.storage.local.set({ studyTopics: topics });
  return name;
}

async function saveStudyNote({ text, title, url, pageTitle, topic }) {
  const noteText = String(text || "").trim();

  if (!noteText) throw new Error("There is no text to save.");
  if (noteText.length > 50000) {
    throw new Error("This note is too long to save.");
  }

  const chosenTopic = await createNoteTopic(topic || "DSA");
  const { studyNotes = [] } = await chrome.storage.local.get("studyNotes");
  const safePageTitle = String(pageTitle || "").slice(0, 500);

  const note = {
    id: crypto.randomUUID(),
    title: String(title || safePageTitle || "Untitled note")
      .trim()
      .slice(0, 200),
    text: noteText,
    subject: chosenTopic,
    topic: chosenTopic,
    url: String(url || "").slice(0, 2000),
    pageTitle: safePageTitle,
    createdAt: new Date().toISOString()
  };

  studyNotes.unshift(note);
  await chrome.storage.local.set({ studyNotes });
  return note;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== SAVE_SELECTION_MENU_ID) return;

  try {
    const timerState = await getTimerState();

    await saveStudyNote({
      text: info.selectionText,
      title: tab?.title || "Saved selection",
      url: tab?.url || "",
      pageTitle: tab?.title || "",
      topic: timerState.subject || "DSA"
    });

    console.log("StudyTrack: Selection saved successfully.");
  } catch (error) {
    console.error("StudyTrack: Could not save selection.", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error("StudyTrack background error:", error);
      sendResponse({
        success: false,
        error: error.message || "Something went wrong."
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case "GET_NOTE_TOPICS":
      return {
        success: true,
        topics: await getNoteTopics()
      };

    case "CREATE_NOTE_TOPIC": {
      const topic = await createNoteTopic(message.topic);
      return {
        success: true,
        topic,
        topics: await getNoteTopics()
      };
    }

    case "SAVE_NOTE_FROM_PAGE": {
      const note = await saveStudyNote({
        text: message.text,
        title: message.title,
        url: message.url,
        pageTitle: message.pageTitle,
        topic: message.topic
      });

      return { success: true, note };
    }

    case "GET_WEBSITE_TRACKING_DATA": {
      // Re-check the active tab whenever the popup asks for tracking status.
      await enqueue(syncActiveTab);

      const { activeWebsiteSession: active, stoppedWebsiteSession: stopped } =
        await chrome.storage.local.get(["activeWebsiteSession", "stoppedWebsiteSession"]);

      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
      const currentTab = tabs?.[0];
      const currentHostname = getHostname(currentTab?.url);
      const isStoppedHere = Boolean(
        stopped && currentTab &&
        stopped.hostname === currentHostname &&
        stopped.tabId === currentTab.id &&
        stopped.windowId === currentTab.windowId
      );

      const elapsedMs = active
        ? (active.accumulatedMs || 0) +
          (
            active.isPaused
              ? 0
              : Math.max(
                  0,
                  Date.now() - (active.lastCheckpointAt || Date.now())
                )
          )
        : 0;

      return {
        success: true,
        sites: await getWebsiteSites(),
        active: active || null,
        elapsedMs,
        stopped: isStoppedHere
      };
    }

    // Kept for compatibility with older popup scripts or other extension files.
    // The popup no longer shows an Add Website form.
    case "ADD_STUDY_SITE": {
      const domain = normalizeDomain(message.domain);
      const subject = String(message.subject || "DSA").trim();
      const sites = await getWebsiteSites();
      const existing = sites.find(site => site.domain === domain);

      let site = sites.find(item => item.domain === domain);

      if (site) {
        site.subject = subject || site.subject || "DSA";
      } else {
        site = {
          domain,
          subject: subject || "DSA",
          enabled: true
        };
        sites.push(site);
      }

      await chrome.storage.local.set({ studySites: sites });
      await chrome.storage.local.remove("stoppedWebsiteSession");
      await enqueue(syncActiveTab);
      const { activeWebsiteSession: active } =
        await chrome.storage.local.get("activeWebsiteSession");
      return { success: true, sites, site, active: active || null };
    }

    case "START_WEBSITE_SESSION": {
      const domain = normalizeDomain(message.domain);
      const subject = String(message.subject || "").trim();

      if (!subject) {
        throw new Error("Choose a study topic before starting.");
      }

      const tab = sender?.tab;

      if (!tab || tab.id == null || tab.windowId == null) {
        throw new Error("Please start the session from the website itself.");
      }

      const senderDomain = getHostname(tab.url);

      if (
        !senderDomain ||
        (
          senderDomain !== domain &&
          !senderDomain.endsWith(`.${domain}`)
        )
      ) {
        throw new Error("The current website changed. Please try again.");
      }

      let windowInfo;

      try {
        windowInfo = await chrome.windows.get(tab.windowId);
      } catch {
        throw new Error("Could not verify the browser window.");
      }

      if (!windowInfo.focused) {
        throw new Error("Focus this browser window before starting.");
      }

      await finalizeActiveSession(Date.now());

      const sites = await getWebsiteSites();
      const existing = sites.find(site => site.domain === domain);

      if (existing) {
        existing.subject = subject;
        existing.enabled = true;
      } else {
        sites.push({ domain, subject, enabled: true });
      }

      const now = Date.now();

      const active = {
        tabId: tab.id,
        windowId: tab.windowId,
        hostname: senderDomain,
        subject,
        startedAt: now,
        lastCheckpointAt: now,
        accumulatedMs: 0,
        isPaused: false
      };

      await chrome.storage.local.remove("stoppedWebsiteSession");
      await chrome.storage.local.set({
        studySites: sites,
        activeWebsiteSession: active
      });

      return { success: true, sites, active };
    }

    case "STOP_WEBSITE_SESSION": {
      const domain = normalizeDomain(message.domain);
      const { activeWebsiteSession: current } =
        await chrome.storage.local.get("activeWebsiteSession");
      const tab = sender?.tab;
      const stoppedHostname = current?.hostname || getHostname(tab?.url) || domain;
      const completed = await finalizeActiveSession(Date.now(), domain);

      // Prevent syncActiveTab from immediately creating another session on
      // the same tab after Stop. Switching away clears this flag.
      if (tab?.id != null && tab?.windowId != null) {
        await chrome.storage.local.set({
          stoppedWebsiteSession: {
            hostname: stoppedHostname,
            tabId: tab.id,
            windowId: tab.windowId,
            stoppedAt: Date.now()
          }
        });
      }

      return {
        success: true,
        completed: completed
          ? {
              domain: completed.hostname,
              subject: completed.subject,
              durationSeconds: Math.floor(completed.durationMs / 1000)
            }
          : null,
        sites: await getWebsiteSites()
      };
    }

    case "REMOVE_STUDY_SITE": {
      const domain = normalizeDomain(message.domain);

      // Save any active time before removing the site from the list.
      await finalizeActiveSession(Date.now(), domain);

      const sites = (await getWebsiteSites())
        .filter(site => site.domain !== domain);
      await chrome.storage.local.set({ studySites: sites });

      const { stoppedWebsiteSession: stopped } =
        await chrome.storage.local.get("stoppedWebsiteSession");
      if (stopped && (
        stopped.hostname === domain || stopped.hostname.endsWith(`.${domain}`)
      )) {
        await chrome.storage.local.remove("stoppedWebsiteSession");
      }

      return { success: true, sites };
    }

    case "GET_TIMER_STATE": {
      const state = await getTimerState();

      return {
        success: true,
        state,
        elapsedMs: getElapsedMs(state)
      };
    }

    case "START_TIMER": {
      let state = await getTimerState();

      if (state.status !== "running") {
        const isNewSession = state.status === "idle";

        state = {
          ...state,
          status: "running",
          subject: message.subject || state.subject,
          startedAt: Date.now(),
          sessionStartedAt: isNewSession
            ? new Date().toISOString()
            : state.sessionStartedAt || new Date().toISOString()
        };

        await saveTimerState(state);
      }

      return {
        success: true,
        state,
        elapsedMs: getElapsedMs(state)
      };
    }

    case "PAUSE_TIMER": {
      const state = await getTimerState();

      if (state.status === "running") {
        state.elapsedMs = getElapsedMs(state);
        state.status = "paused";
        state.startedAt = null;
        await saveTimerState(state);
      }

      return {
        success: true,
        state,
        elapsedMs: getElapsedMs(state)
      };
    }

    case "STOP_TIMER": {
      let state = await getTimerState();
      const durationMs = getElapsedMs(state);

      if (state.status !== "idle" && durationMs > 0) {
        const { studySessions = [] } =
          await chrome.storage.local.get("studySessions");

        studySessions.unshift({
          id: crypto.randomUUID(),
          subject: state.subject,
          durationSeconds: Math.floor(durationMs / 1000),
          startedAt: state.sessionStartedAt,
          endedAt: new Date().toISOString()
        });

        await chrome.storage.local.set({ studySessions });
      }

      state = { ...DEFAULT_STATE, subject: state.subject };
      await saveTimerState(state);

      return {
        success: true,
        state,
        elapsedMs: 0,
        completedDurationMs: durationMs
      };
    }

    default:
      return { success: false, error: "Unknown action" };
  }
}