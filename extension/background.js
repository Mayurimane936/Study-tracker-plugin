importScripts("deployment-config.js");

const DEFAULT_STATE = {
  status: "idle",
  subject: "DSA",
  elapsedMs: 0,
  startedAt: null,
  sessionStartedAt: null,
  groupId: null
};

const DEFAULT_TOPICS = ["DSA", "C++", "System Design", "Other"];
const SAVE_SELECTION_MENU_ID = "studytrack-save-selection";
const CHECKPOINT_ALARM = "studytrack-website-checkpoint";
const MAX_SAVED_WEBSITE_SESSIONS = 2000;

// Must match the backend address used by your local StudyTrack server.
const BACKEND_URL = globalThis.STUDYTRACK_API_URL || "http://127.0.0.1:8000";

let eventQueue = Promise.resolve();
let websiteSyncPromise = null;
let manualSyncPromise = null;

async function selectedGroupId() {
  const { studyTrackGroupId } =
    await chrome.storage.local.get("studyTrackGroupId");
  return studyTrackGroupId ? Number(studyTrackGroupId) : null;
}

async function authenticatedFetch(path, options = {}) {
  const { studyTrackAuth } =
    await chrome.storage.local.get("studyTrackAuth");

  if (!studyTrackAuth?.token) {
    throw new Error("Connect your StudyTrack account to sync data.");
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${studyTrackAuth.token}`
    }
  });

  if (response.status === 401) {
    await chrome.storage.local.remove("studyTrackAuth");
    throw new Error("StudyTrack login expired. Reconnect your account in the extension popup.");
  }

  return response;
}

async function connectAccount(email, password) {
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.token || !data.user) {
    throw new Error(data.detail || "Could not connect to StudyTrack.");
  }

  await chrome.storage.local.set({
    studyTrackAuth: { token: data.token, user: data.user }
  });

  void syncWebsiteSessionsToBackend();
  void syncManualStudySessionsToBackend();
  void syncLocalNotesToBackend();
  const groupId = await selectedGroupId();
  if (groupId) {
    void refreshGroupStudySites(true).then(() => enqueue(syncActiveTab)).catch(error => {
      console.warn("StudyTrack: Could not load shared study sites after login.", error);
    });
  }

  return data.user;
}

async function syncManualStudySessionsToBackend() {
  if (manualSyncPromise) return manualSyncPromise;

  manualSyncPromise = (async () => {
    const { studyTrackAuth, studySessions = [] } =
      await chrome.storage.local.get([
        "studyTrackAuth",
        "studySessions"
      ]);

    if (!studyTrackAuth?.token || !Array.isArray(studySessions)) return;

    for (const item of studySessions) {
      const response = await authenticatedFetch("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_session_id: item.id,
          group_id: item.groupId ?? await selectedGroupId(),
          topic: item.subject || "General",
          duration_seconds: item.durationSeconds,
          started_at: item.startedAt,
          ended_at: item.endedAt
        })
      });

      if (!response.ok) {
        if (response.status === 410) {
          const { studySessions: current = [] } =
            await chrome.storage.local.get("studySessions");
          await chrome.storage.local.set({
            studySessions: current.filter(session => session.id !== item.id)
          });
          continue;
        }
        throw new Error(`Manual session sync failed (${response.status}).`);
      }

      const { studySessions: current = [] } =
        await chrome.storage.local.get("studySessions");
      await chrome.storage.local.set({
        studySessions: current.filter(session => session.id !== item.id)
      });
    }
  })();

  try {
    await manualSyncPromise;
  } catch (error) {
    console.warn("StudyTrack: Manual session sync will retry later.", error);
  } finally {
    manualSyncPromise = null;
  }
}

async function syncLocalNotesToBackend() {
  const { studyTrackAuth, studyNotes = [] } =
    await chrome.storage.local.get(["studyTrackAuth", "studyNotes"]);
  if (!studyTrackAuth?.token || !Array.isArray(studyNotes)) return new Set();

  const syncedKey = `studyTrackSyncedNotes_${studyTrackAuth.user.id}`;
  const stored = await chrome.storage.local.get(syncedKey);
  const syncedIds = new Set(stored[syncedKey] || []);

  for (const note of studyNotes) {
    if (!note?.id || syncedIds.has(note.id)) continue;

    try {
      const response = await authenticatedFetch("/notes/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_note_id: note.id,
          title: note.pageTitle || note.title || "Saved selection",
          content: note.text || note.content || "",
          topic: note.topic || note.subject || "General",
          domain: note.domain || "General",
          source_url: note.url || null,
          group_id: note.groupId ?? await selectedGroupId()
        })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Note sync failed (${response.status}). ${detail}`);
      }

      syncedIds.add(note.id);
      await chrome.storage.local.set({
        [syncedKey]: [...syncedIds]
      });
    } catch (error) {
      if (error.message.includes("login expired")) break;
      console.warn("StudyTrack: Note remains saved locally and will retry.", error);
      break;
    }
  }

  return syncedIds;
}

function enqueue(task) {
  eventQueue = eventQueue.then(task).catch(error => {
    console.error("StudyTrack background error:", error);
  });
  return eventQueue;
}

// --------------------------------------------------
// Extension lifecycle and browser events
// --------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_SELECTION_MENU_ID,
      title: "Save selection to StudyTrack",
      contexts: ["selection"]
    });
  });

  chrome.alarms.create(CHECKPOINT_ALARM, {
    periodInMinutes: 1
  });

  chrome.storage.local.get(["studyTopics", "studySites"], result => {
    const values = {};

    if (!Array.isArray(result.studyTopics)) {
      values.studyTopics = DEFAULT_TOPICS;
    }

    if (!Array.isArray(result.studySites)) {
      values.studySites = [];
    }

    if (Object.keys(values).length) {
      chrome.storage.local.set(values);
    }
  });

  enqueue(async () => {
    await syncActiveTab();
    await syncWebsiteSessionsToBackend();
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const { activeWebsiteSession: active } =
      await chrome.storage.local.get("activeWebsiteSession");

    // Do not count time while the browser was closed.
    if (active) {
      await finalizeActiveSession(
        active.lastCheckpointAt || active.startedAt
      );
    }

    try {
      await refreshGroupStudySites(true);
    } catch (error) {
      console.warn("StudyTrack: Startup group-site refresh failed.", error);
    }
    await syncActiveTab();
    await syncWebsiteSessionsToBackend();
  });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECKPOINT_ALARM) {
    enqueue(async () => {
      await checkpointActiveSession(Date.now());
      try {
        await refreshGroupStudySites(true);
      } catch (error) {
        console.warn("StudyTrack: Group study sites refresh failed.", error);
      }
      await syncActiveTab();
      await syncWebsiteSessionsToBackend();
      await syncManualStudySessionsToBackend();
      await syncLocalNotesToBackend();
    });
  }
});

chrome.tabs.onActivated.addListener(() => {
  enqueue(syncActiveTab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete" || tab.active) {
    enqueue(syncActiveTab);
  }
});

chrome.tabs.onRemoved.addListener(() => {
  enqueue(syncActiveTab);
});

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

// --------------------------------------------------
// Manual timer helpers
// --------------------------------------------------

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

// --------------------------------------------------
// Website tracking helpers
// --------------------------------------------------

function normalizeDomain(value) {
  const input = String(value || "").trim();

  if (!input) {
    throw new Error("Enter a website domain.");
  }

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

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

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

function normalizeGroupSiteRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.sites)) return payload.sites;
  if (Array.isArray(payload?.study_sites)) return payload.study_sites;
  return [];
}

function getGroupSiteStatus(site) {
  return String(site?.status || site?.approval_status || "pending")
    .trim()
    .toLowerCase();
}

async function fetchGroupStudySites(groupId) {
  if (!groupId) return [];

  const response = await authenticatedFetch(
    `/groups/${encodeURIComponent(groupId)}/study-sites`
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Could not load group study websites (${response.status}). ${detail.slice(0, 250)}`
    );
  }

  return normalizeGroupSiteRows(await response.json());
}

/**
 * Refreshes the selected group's shared sites from the backend.
 * The backend is authoritative; local storage is only an approved-site cache.
 */
async function refreshGroupStudySites(force = false) {
  const groupId = await selectedGroupId();

  if (!groupId) {
    return { all: [], pending: [] };
  }

  const { studyTrackAuth, studyTrackGroupSitesCache = {} } =
    await chrome.storage.local.get([
      "studyTrackAuth",
      "studyTrackGroupSitesCache"
    ]);

  if (!studyTrackAuth?.token) {
    return {
      all: studyTrackGroupSitesCache[String(groupId)]?.items || [],
      pending: (studyTrackGroupSitesCache[String(groupId)]?.items || [])
        .filter(site => getGroupSiteStatus(site) === "pending")
    };
  }

  const cache = studyTrackGroupSitesCache[String(groupId)];
  const cacheIsFresh = cache?.fetchedAt &&
    Date.now() - cache.fetchedAt < 30000;

  if (!force && cacheIsFresh) {
    const rows = Array.isArray(cache.items) ? cache.items : [];
    return {
      all: rows,
      pending: rows.filter(site => getGroupSiteStatus(site) === "pending")
    };
  }

  const rows = await fetchGroupStudySites(groupId);
  const nextCache = {
    ...studyTrackGroupSitesCache,
    [String(groupId)]: {
      fetchedAt: Date.now(),
      items: rows
    }
  };

  const { studySites = [] } =
    await chrome.storage.local.get("studySites");

  // Replace only this group's cache; keep personal and other-group sites intact.
  const retained = (Array.isArray(studySites) ? studySites : [])
    .filter(site => Number(site?.groupId || 0) !== Number(groupId));

  const { studyTrackGroupSiteSubjects = {} } =
    await chrome.storage.local.get("studyTrackGroupSiteSubjects");
  const approved = rows
    .filter(site => getGroupSiteStatus(site) === "approved")
    .map(site => {
      const domain = normalizeDomain(site.domain);
      const savedSubject = studyTrackGroupSiteSubjects[
        `${groupId}:${domain}`
      ];
      return ({
      domain,
      subject: String(site.subject || savedSubject || "DSA").trim() || "DSA",
      enabled: true,
      groupId: Number(groupId),
      backendSiteId: site.id ?? null,
      approvalStatus: "approved",
      scope: "group"
    });
    });

  await chrome.storage.local.set({
    studyTrackGroupSitesCache: nextCache,
    studySites: [...retained, ...approved]
  });

  return {
    all: rows,
    pending: rows.filter(site => getGroupSiteStatus(site) === "pending")
  };
}

async function getWebsiteSites() {
  const { studySites = [] } =
    await chrome.storage.local.get("studySites");

  const groupId = await selectedGroupId();
  const allSites = Array.isArray(studySites) ? studySites : [];

  // Keep personal workspace sites isolated from each group's approved sites.
  return allSites.filter(site =>
    groupId
      ? Number(site?.groupId || 0) === Number(groupId)
      : !site?.groupId
  );
}

async function getPendingGroupStudySites() {
  const groupId = await selectedGroupId();
  if (!groupId) return [];

  const { studyTrackGroupSitesCache = {} } =
    await chrome.storage.local.get("studyTrackGroupSitesCache");

  const rows = studyTrackGroupSitesCache[String(groupId)]?.items || [];
  return rows.filter(site => getGroupSiteStatus(site) === "pending");
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

  await chrome.storage.local.set({
    activeWebsiteSession: active
  });
}

// --------------------------------------------------
// Sync completed website sessions to the backend
// --------------------------------------------------

async function syncWebsiteSessionsToBackend() {
  // Prevent overlapping sync requests.
  if (websiteSyncPromise) {
    return websiteSyncPromise;
  }

  websiteSyncPromise = (async () => {
    const { studyTrackAuth } =
      await chrome.storage.local.get("studyTrackAuth");

    if (!studyTrackAuth?.token) {
      return {
        success: false,
        error: "Connect your StudyTrack account to sync website sessions."
      };
    }

    const { studyWebsiteSessions = [] } =
      await chrome.storage.local.get("studyWebsiteSessions");

    if (
      !Array.isArray(studyWebsiteSessions) ||
      studyWebsiteSessions.length === 0
    ) {
      return {
        success: true,
        synced: 0,
        message: "No website sessions to sync."
      };
    }

    // The backend accepts up to 2000 items per request.
    const sessions = studyWebsiteSessions
      .filter(item =>
        item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.domain === "string" &&
        item.startedAt &&
        item.endedAt
      )
      .slice(0, MAX_SAVED_WEBSITE_SESSIONS);

    if (sessions.length === 0) {
      return {
        success: true,
        synced: 0,
        message: "No valid website sessions to sync."
      };
    }

    let synced = 0;

    // Use batches so the extension remains safe if the storage limit changes.
    for (let index = 0; index < sessions.length; index += 200) {
      const batch = sessions.slice(index, index + 200);
      const currentGroupId = await selectedGroupId();

      const response = await authenticatedFetch("/sessions/website-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(batch.map(item => ({
          id: item.id,
          domain: item.domain,
          subject: item.subject || "General",
          group_id: item.groupId ?? currentGroupId,
          durationSeconds: Math.max(
            0,
            Math.floor(Number(item.durationSeconds) || 0)
          ),
          startedAt: item.startedAt,
          endedAt: item.endedAt
        }))
        )
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(
          `Website session sync failed (${response.status}). ` +
          responseText.slice(0, 300)
        );
      }

      const result = await response.json();
      synced += Number(result.inserted ?? result.saved ?? 0);
    }

    const syncedIds = new Set(sessions.map(item => item.id));
    const { studyWebsiteSessions: currentSessions = [] } =
      await chrome.storage.local.get("studyWebsiteSessions");
    await chrome.storage.local.set({
      studyWebsiteSessions: currentSessions.filter(
        item => !syncedIds.has(item.id)
      )
    });

    console.log(
      `StudyTrack: Website session sync finished. ` +
      `${sessions.length} records checked; ${synced} new records inserted.`
    );

    return {
      success: true,
      checked: sessions.length,
      inserted: synced
    };
  })();

  try {
    return await websiteSyncPromise;
  } catch (error) {
    // Do not remove local history on failure. A future checkpoint retries it.
    console.warn("StudyTrack: Website session sync will retry later.", error);

    return {
      success: false,
      error: error.message || "Website session sync failed."
    };
  } finally {
    websiteSyncPromise = null;
  }
}

// --------------------------------------------------
// Finish and pause website sessions
// --------------------------------------------------

async function finalizeActiveSession(
  endTime = Date.now(),
  expectedDomain = null
) {
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
      groupId: active.groupId || null,
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

    // Start syncing after local history has been saved.
    // Local history remains available if the backend is offline.
    void syncWebsiteSessionsToBackend();
  }

  await chrome.storage.local.remove("activeWebsiteSession");

  return {
    ...active,
    durationMs,
    endedAt: safeEndTime
  };
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

  await chrome.storage.local.set({
    activeWebsiteSession: active
  });
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

  if (!hostname || hostname !== active.hostname) {
    return active;
  }

  active.tabId = tab.id;
  active.windowId = tab.windowId;
  active.lastCheckpointAt = Date.now();
  active.isPaused = false;

  await chrome.storage.local.set({
    activeWebsiteSession: active
  });

  return active;
}

/**
 * Automatically track whichever configured study website is currently active.
 *
 * - A configured site in the focused browser window starts tracking.
 * - Switching to another configured study website completes the old session.
 * - Switching to a non-configured website or losing browser focus pauses tracking.
 */
async function syncActiveTab() {
  let tabs;

  try {
    tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
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

  // After Stop, do not restart on the same tab until the user leaves it.
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
    if (active) {
      await pauseActiveSession(Date.now());
    }
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
    if (active.isPaused) {
      await resumeActiveSession(active, tab);
    }
    return;
  }

  // Finish the previous website before tracking the new one.
  if (active) {
    await finalizeActiveSession(Date.now());
  }

  const now = Date.now();

  const newActiveSession = {
    tabId: tab.id,
    windowId: tab.windowId,
    hostname,
    subject: String(siteConfig.subject || "DSA").trim() || "DSA",
    groupId: await selectedGroupId(),
    startedAt: now,
    lastCheckpointAt: now,
    accumulatedMs: 0,
    isPaused: false
  };

  await chrome.storage.local.set({
    activeWebsiteSession: newActiveSession
  });
}

// --------------------------------------------------
// Notes and topics
// --------------------------------------------------

async function getNotebookOptions() {
  const { studyTopics = [], studyNotes = [] } =
    await chrome.storage.local.get(["studyTopics", "studyNotes"]);

  const topicMap = new Map();
  try {
    const groupId = await selectedGroupId();
    const response = await authenticatedFetch(
      `/topics${groupId ? `?group_id=${groupId}` : ""}`
    );
    if (response.ok) {
      const backendTopics = await response.json();
      for (const topic of backendTopics) {
        topicMap.set(topic.name, [
          "General",
          ...(topic.domains || []).map(domain => domain.name)
        ]);
      }
    }
  } catch (error) {
    if (!error.message.includes("Connect your StudyTrack account")) {
      console.warn("StudyTrack: Could not refresh topics from backend.", error);
    }
  }

  const localTopics = [
    ...DEFAULT_TOPICS,
    ...studyTopics,
    ...(Array.isArray(studyNotes)
      ? studyNotes.map(note => note.subject || note.topic)
      : [])
  ];

  for (const topic of localTopics) {
    if (typeof topic === "string" && topic.trim() && !topicMap.has(topic.trim())) {
      topicMap.set(topic.trim(), ["General"]);
    }
  }

  return [...topicMap.entries()]
    .map(([name, domains]) => ({ name, domains: [...new Set(domains)] }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function createNoteDomain(topicName, domainName) {
  const topicLabel = String(topicName || "").trim();
  const name = String(domainName || "").trim();
  if (!topicLabel) throw new Error("Select a topic before adding a domain.");
  if (!name) throw new Error("Enter a domain name.");
  if (name.length > 100) throw new Error("Domain names must be 100 characters or fewer.");

  const groupId = await selectedGroupId();
  const query = groupId ? `?group_id=${groupId}` : "";
  const topicsResponse = await authenticatedFetch(`/topics${query}`);
  if (!topicsResponse.ok) throw new Error("Could not load backend topics.");
  const topics = await topicsResponse.json();
  const topic = topics.find(
    item => item.name.toLowerCase() === topicLabel.toLowerCase()
  );
  if (!topic) throw new Error("Topic not found in the selected workspace.");

  const existing = (topic.domains || []).find(
    domain => domain.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.name;

  const response = await authenticatedFetch(`/topics/${topic.id}/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not create domain (${response.status}). ${detail}`);
  }

  if (response.status === 409) {
    return (await response.json()).name || name;
  }
  return (await response.json()).name;
}

async function getNoteTopics() {
  return (await getNotebookOptions()).map(topic => topic.name);
}

async function createNoteTopic(topicName) {
  const name = String(topicName || "").trim();

  if (!name) {
    throw new Error("Enter a topic name.");
  }

  if (name.length > 80) {
    throw new Error("Topic names must be 80 characters or fewer.");
  }

  const topics = await getNoteTopics();

  const existing = topics.find(
    topic => topic.toLowerCase() === name.toLowerCase()
  );

  const { studyTrackAuth } =
    await chrome.storage.local.get("studyTrackAuth");
  if (studyTrackAuth?.token) {
    const groupId = await selectedGroupId();
    const query = groupId ? `?group_id=${groupId}` : "";
    const topicsResponse = await authenticatedFetch(`/topics${query}`);
    if (!topicsResponse.ok) {
      throw new Error("Could not load backend topics.");
    }
    const backendTopics = await topicsResponse.json();
    const backendMatch = backendTopics.find(
      topic => topic.name.toLowerCase() === name.toLowerCase()
    );
    if (backendMatch) return backendMatch.name;

    const response = await authenticatedFetch("/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        group_id: groupId
      })
    });
    if (!response.ok && response.status !== 409) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Could not create topic (${response.status}). ${detail}`);
    }
  }

  if (existing) return existing;

  topics.push(name);

  await chrome.storage.local.set({
    studyTopics: topics
  });

  return name;
}


async function saveStudyNote({ text, title, url, pageTitle, topic, domain }) {
  const noteText = String(text || "").trim();

  if (!noteText) {
    throw new Error("There is no text to save.");
  }

  if (noteText.length > 50000) {
    throw new Error("This note is too long to save.");
  }

  const chosenTopic = await createNoteTopic(topic || "DSA");
  const chosenDomain = String(domain || "General").trim() || "General";
  const { studyNotes = [] } =
    await chrome.storage.local.get("studyNotes");

  const safePageTitle = String(pageTitle || "").slice(0, 500);

  const note = {
    id: crypto.randomUUID(),
    title: String(title || safePageTitle || "Untitled note")
      .trim()
      .slice(0, 200),
    text: noteText,
    subject: chosenTopic,
    topic: chosenTopic,
    domain: chosenDomain,
    groupId: await selectedGroupId(),
    url: String(url || "").slice(0, 2000),
    pageTitle: safePageTitle,
    createdAt: new Date().toISOString()
  };

  // Save locally first so the extension keeps its existing behavior.
  studyNotes.unshift(note);
  await chrome.storage.local.set({ studyNotes });

  const syncedIds = await syncLocalNotesToBackend();
  return { ...note, synced: syncedIds.has(note.id) };
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

// --------------------------------------------------
// Messages from popup and content scripts
// --------------------------------------------------

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
    case "GET_ACCOUNT_STATE": {
      const { studyTrackAuth, studyTrackGroupId } =
        await chrome.storage.local.get([
          "studyTrackAuth",
          "studyTrackGroupId"
        ]);

      return {
        success: true,
        user: studyTrackAuth?.user || null,
        groupId: studyTrackGroupId || ""
      };
    }

    case "GET_ACCOUNT_GROUPS": {
      const response = await authenticatedFetch("/groups");
      if (!response.ok) throw new Error("Could not load your groups.");
      return { success: true, groups: await response.json() };
    }

    case "SET_SYNC_GROUP": {
      const groupId = message.groupId ? Number(message.groupId) : null;
      if (groupId !== null && (!Number.isInteger(groupId) || groupId <= 0)) {
        throw new Error("Choose a valid StudyTrack group.");
      }

      // Finish the current session under the workspace where it started.
      await finalizeActiveSession(Date.now());
      await chrome.storage.local.set({ studyTrackGroupId: groupId });

      if (groupId) {
        await refreshGroupStudySites(true);
      }

      await enqueue(syncActiveTab);
      return { success: true, groupId };
    }

    case "CONNECT_ACCOUNT":
      return {
        success: true,
        user: await connectAccount(message.email, message.password)
      };

    case "DISCONNECT_ACCOUNT":
      await chrome.storage.local.remove("studyTrackAuth");
      return { success: true };

    case "GET_NOTE_TOPICS":
      return {
        success: true,
        topics: await getNoteTopics()
      };

    case "GET_NOTEBOOK_OPTIONS":
      return {
        success: true,
        topics: await getNotebookOptions()
      };

    case "CREATE_NOTE_TOPIC": {
      const topic = await createNoteTopic(message.topic);

      return {
        success: true,
        topic,
        topics: await getNoteTopics()
      };
    }

    case "CREATE_NOTE_DOMAIN": {
      const domain = await createNoteDomain(message.topic, message.domain);
      return {
        success: true,
        domain,
        topics: await getNotebookOptions()
      };
    }

    case "SAVE_NOTE_FROM_PAGE": {
      const note = await saveStudyNote({
        text: message.text,
        title: message.title,
        url: message.url,
        pageTitle: message.pageTitle,
        topic: message.topic,
        domain: message.domain
      });

      return {
        success: true,
        note
      };
    }

    case "GET_WEBSITE_TRACKING_DATA": {
      let pendingSites = [];
      try {
        const groupSites = await refreshGroupStudySites(false);
        pendingSites = groupSites.pending;
      } catch (error) {
        console.warn("StudyTrack: Could not refresh shared study sites.", error);
        pendingSites = await getPendingGroupStudySites();
      }

      await enqueue(syncActiveTab);

      // Try syncing existing history when the popup opens too.
      void syncWebsiteSessionsToBackend();

      const {
        activeWebsiteSession: active,
        stoppedWebsiteSession: stopped
      } = await chrome.storage.local.get([
        "activeWebsiteSession",
        "stoppedWebsiteSession"
      ]);

      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      }).catch(() => []);

      const currentTab = tabs?.[0];
      const currentHostname = getHostname(currentTab?.url);

      const isStoppedHere = Boolean(
        stopped &&
        currentTab &&
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
        pendingSites,
        active: active || null,
        elapsedMs,
        stopped: isStoppedHere
      };
    }

    // Kept for compatibility with older popup scripts.
    // The popup no longer shows an Add Website form.
    case "ADD_STUDY_SITE": {
      const domain = normalizeDomain(message.domain);
      const subject = String(message.subject || "DSA").trim() || "DSA";
      const groupId = await selectedGroupId();

      // Group sites must be reviewed by another group member before tracking.
      if (groupId) {
        const response = await authenticatedFetch(
          `/groups/${encodeURIComponent(groupId)}/study-sites`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain })
          }
        );

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          if (response.status === 409) {
            await refreshGroupStudySites(true).catch(() => {});
            throw new Error(
              `${domain} is already submitted or configured for this group. Check Study Sites in the dashboard.`
            );
          }
          throw new Error(
            `Could not submit ${domain} for approval (${response.status}). ${detail.slice(0, 250)}`
          );
        }

        const proposal = await response.json().catch(() => null);
        const { studyTrackGroupSiteSubjects = {} } =
          await chrome.storage.local.get("studyTrackGroupSiteSubjects");
        await chrome.storage.local.set({
          studyTrackGroupSiteSubjects: {
            ...studyTrackGroupSiteSubjects,
            [`${groupId}:${domain}`]: subject
          }
        });
        const refreshed = await refreshGroupStudySites(true);
        const matching = refreshed.all.find(item => {
          try {
            return normalizeDomain(item.domain) === domain;
          } catch {
            return false;
          }
        }) || proposal;

        await chrome.storage.local.remove("stoppedWebsiteSession");

        return {
          success: true,
          submittedForApproval: true,
          pendingSite: matching || {
            domain,
            status: "pending",
            subject
          },
          pendingSites: refreshed.pending,
          sites: await getWebsiteSites(),
          active: null
        };
      }

      // Personal workspace sites remain local and do not need group approval.
      const { studySites: allSites = [] } =
        await chrome.storage.local.get("studySites");
      const sites = (Array.isArray(allSites) ? allSites : [])
        .filter(site => site?.groupId || site.domain !== domain);

      let site = null;

      if (!site) {
        site = {
          domain,
          subject,
          enabled: true,
          groupId: null,
          scope: "personal",
          approvalStatus: "approved"
        };
        sites.push(site);
      } else {
        site.subject = subject;
      }

      await chrome.storage.local.set({ studySites: sites });
      await chrome.storage.local.remove("stoppedWebsiteSession");
      await enqueue(syncActiveTab);

      const { activeWebsiteSession: active } =
        await chrome.storage.local.get("activeWebsiteSession");

      return {
        success: true,
        submittedForApproval: false,
        sites: await getWebsiteSites(),
        site,
        active: active || null
      };
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

      if (!existing) {
        const groupId = await selectedGroupId();
        throw new Error(
          groupId
            ? "This website is not approved for your group yet. Submit it for approval in StudyTrack."
            : "Add this website to your personal study list before starting."
        );
      }

      existing.subject = subject;
      existing.enabled = true;

      const now = Date.now();

      const active = {
        tabId: tab.id,
        windowId: tab.windowId,
        hostname: senderDomain,
        subject,
        groupId: await selectedGroupId(),
        startedAt: now,
        lastCheckpointAt: now,
        accumulatedMs: 0,
        isPaused: false
      };

      await chrome.storage.local.remove("stoppedWebsiteSession");

      const { studySites: allStoredSites = [] } =
        await chrome.storage.local.get("studySites");
      const updatedAllSites = (Array.isArray(allStoredSites) ? allStoredSites : [])
        .map(site => {
          const sameScope = Number(site?.groupId || 0) === Number(existing.groupId || 0);
          return site?.domain === domain && sameScope
            ? { ...site, subject, enabled: true }
            : site;
        });

      await chrome.storage.local.set({
        studySites: updatedAllSites,
        activeWebsiteSession: active
      });

      return {
        success: true,
        sites,
        active
      };
    }

    case "STOP_WEBSITE_SESSION": {
      const domain = normalizeDomain(message.domain);

      const { activeWebsiteSession: current } =
        await chrome.storage.local.get("activeWebsiteSession");

      const tab = sender?.tab;
      const stoppedHostname =
        current?.hostname || getHostname(tab?.url) || domain;

      const completed = await finalizeActiveSession(Date.now(), domain);

      // Prevent tracking from restarting on the same tab immediately.
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

      // Also attempt to sync immediately after Stop.
      void syncWebsiteSessionsToBackend();

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
      const groupId = await selectedGroupId();

      if (groupId) {
        throw new Error(
          "Shared group websites are managed from the StudyTrack dashboard. Only approved sites can be used for group tracking."
        );
      }

      // Save active time before removing the personal site.
      await finalizeActiveSession(Date.now(), domain);

      const { studySites: allSites = [] } =
        await chrome.storage.local.get("studySites");
      const sites = (Array.isArray(allSites) ? allSites : [])
        .filter(site => site?.groupId || site.domain !== domain);

      await chrome.storage.local.set({ studySites: sites });

      const { stoppedWebsiteSession: stopped } =
        await chrome.storage.local.get("stoppedWebsiteSession");

      if (
        stopped &&
        (
          stopped.hostname === domain ||
          stopped.hostname.endsWith(`.${domain}`)
        )
      ) {
        await chrome.storage.local.remove("stoppedWebsiteSession");
      }

      void syncWebsiteSessionsToBackend();

      return {
        success: true,
        sites: await getWebsiteSites()
      };
    }

    // --------------------------------------------------
    // Manual timer actions
    // --------------------------------------------------

    case "GET_TIMER_STATE": {
      void syncManualStudySessionsToBackend();
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
        const selectedGroup = await selectedGroupId();

        state = {
          ...state,
          status: "running",
          subject: message.subject || state.subject,
          startedAt: Date.now(),
          sessionStartedAt: isNewSession
            ? new Date().toISOString()
            : state.sessionStartedAt || new Date().toISOString(),
          groupId: isNewSession
            ? selectedGroup
            : state.groupId ?? selectedGroup
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
          groupId: state.groupId || null,
          subject: state.subject,
          durationSeconds: Math.floor(durationMs / 1000),
          startedAt: state.sessionStartedAt,
          endedAt: new Date().toISOString()
        });

        await chrome.storage.local.set({
          studySessions
        });
        void syncManualStudySessionsToBackend();
      }

      state = {
        ...DEFAULT_STATE,
        subject: state.subject
      };

      await saveTimerState(state);

      return {
        success: true,
        state,
        elapsedMs: 0,
        completedDurationMs: durationMs
      };
    }

    default:
      return {
        success: false,
        error: "Unknown action"
      };
  }
}