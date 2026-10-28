
(() => {
  if (document.getElementById("studytrack-selection-host")) return;

  const CREATE_NEW_TOPIC = "__studytrack_create_new_topic__";

  const host = document.createElement("div");
  host.id = "studytrack-selection-host";

  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483647",
    pointerEvents: "none"
  });

  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }

      .st-bubble, .st-panel {
        position: fixed;
        pointer-events: auto;
        font-family: Arial, sans-serif;
        color: #202124;
        font-size: 13px;
      }

      .st-bubble {
        display: none;
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #202124;
        color: white;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 16px #0003;
        white-space: nowrap;
      }

      .st-panel {
        display: none;
        width: 300px;
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
        overflow-y: auto;
        padding: 16px;
        background: white;
        border: 1px solid #dadce0;
        border-radius: 12px;
        box-shadow: 0 8px 32px #0003;
      }

      .st-heading {
        margin: 0 0 5px;
        font-size: 16px;
        font-weight: 700;
      }

      .st-description {
        margin: 0 0 12px;
        color: #5f6368;
        line-height: 1.4;
      }

      .st-preview {
        max-height: 90px;
        overflow: auto;
        padding: 9px;
        margin-bottom: 12px;
        background: #f1f3f4;
        border-radius: 7px;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        line-height: 1.4;
      }

      .st-label {
        display: block;
        margin: 10px 0 5px;
        font-weight: 600;
      }

      .st-select, .st-input {
        display: block;
        width: 100%;
        min-width: 0;
        min-height: 38px;
        padding: 9px;
        border: 1px solid #dadce0;
        border-radius: 7px;
        background: white;
        color: #202124;
        font: inherit;
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
        position: relative;
      }

      .st-select:focus, .st-input:focus {
        border-color: #1967d2;
        outline: 2px solid #d2e3fc;
      }

      .st-input {
        margin-top: 8px;
      }

      .st-hidden {
        display: none !important;
      }

      .st-button {
        border: 0;
        border-radius: 7px;
        padding: 9px 11px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        pointer-events: auto;
      }

      .st-primary {
        background: #1967d2;
        color: white;
      }

      .st-primary:hover:not(:disabled) {
        background: #185abc;
      }

      .st-secondary {
        background: #e8eaed;
        color: #202124;
      }

      .st-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }

      .st-actions .st-button {
        flex: 1;
      }

      .st-status {
        min-height: 18px;
        margin: 10px 0 0;
        color: #137333;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }

      .st-error {
        color: #b3261e;
      }

      .st-button:disabled,
      .st-select:disabled,
      .st-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    </style>

    <button class="st-bubble" type="button">
      Save to StudyTrack
    </button>

    <section class="st-panel" aria-label="Save study note">
      <h2 class="st-heading">Save study note</h2>
      <p class="st-description">
        Choose where this selection belongs.
      </p>

      <div class="st-preview"></div>

      <label class="st-label" for="st-topic">
        Study topic
      </label>

      <select class="st-select" id="st-topic" disabled>
        <option value="">Loading topics...</option>
      </select>

      <input
        class="st-input st-hidden"
        id="st-new-topic"
        type="text"
        maxlength="50"
        placeholder="Enter a new topic name"
        autocomplete="off"
        aria-label="New study topic"
      />

      <div class="st-actions">
        <button class="st-button st-primary" id="st-save" type="button">
          Save note
        </button>

        <button class="st-button st-secondary" id="st-cancel" type="button">
          Cancel
        </button>
      </div>

      <p class="st-status" role="status" aria-live="polite"></p>
    </section>
  `;

  document.documentElement.appendChild(host);

  const bubble = shadow.querySelector(".st-bubble");
  const panel = shadow.querySelector(".st-panel");
  const preview = shadow.querySelector(".st-preview");
  const topicSelect = shadow.querySelector("#st-topic");
  const newTopicInput = shadow.querySelector("#st-new-topic");
  const saveButton = shadow.querySelector("#st-save");
  const cancelButton = shadow.querySelector("#st-cancel");
  const status = shadow.querySelector(".st-status");

  let selectedText = "";
  let selectionPosition = { left: 20, top: 20 };
  let topics = ["DSA", "C++", "System Design", "Other"];
  let selectedTopic = "DSA";
  let pageTitle = document.title;
  let pageUrl = window.location.href;
  let busy = false;
  let topicsLoaded = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("st-error", isError);
  }

  function setBusy(value) {
    busy = value;
    saveButton.disabled = value || !topicsLoaded;
    cancelButton.disabled = value;
    topicSelect.disabled = value || !topicsLoaded;
    newTopicInput.disabled = value || !topicsLoaded;
  }

  async function sendMessage(message) {
    let response;

    try {
      response = await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw new Error(
        `StudyTrack connection failed: ${
          error?.message || "Please reload the extension."
        }`
      );
    }

    if (!response || !response.success) {
      throw new Error(
        response?.error || "StudyTrack could not complete this action."
      );
    }

    return response;
  }

  function positionElement(element, left, top) {
    const margin = 10;

    const maxLeft = Math.max(
      margin,
      window.innerWidth - element.offsetWidth - margin
    );

    const maxTop = Math.max(
      margin,
      window.innerHeight - element.offsetHeight - margin
    );

    element.style.left =
      `${Math.max(margin, Math.min(left, maxLeft))}px`;

    element.style.top =
      `${Math.max(margin, Math.min(top, maxTop))}px`;
  }

  function hideUI() {
    bubble.style.display = "none";
    panel.style.display = "none";
  }

  function updateTopicInput() {
    const creating = topicSelect.value === CREATE_NEW_TOPIC;

    newTopicInput.classList.toggle("st-hidden", !creating);

    if (!creating) {
      newTopicInput.value = "";
    }
  }

  function renderTopics(preferredTopic) {
    topicSelect.replaceChildren();

    const normalizedTopics = [
      ...new Set(
        topics
          .filter(topic => typeof topic === "string")
          .map(topic => topic.trim())
          .filter(Boolean)
      )
    ];

    topics = normalizedTopics;

    if (topics.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No existing topics";
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

    const match = topics.find(
      topic =>
        topic.toLowerCase() ===
        String(preferredTopic || "").trim().toLowerCase()
    );

    topicSelect.value = match || topics[0] || CREATE_NEW_TOPIC;

    updateTopicInput();
  }

  async function loadTopics(preferredTopic = selectedTopic) {
    const response = await sendMessage({
      action: "GET_NOTE_TOPICS"
    });

    topics = Array.isArray(response.topics)
      ? response.topics
      : ["DSA", "C++", "System Design", "Other"];

    renderTopics(preferredTopic);

    topicsLoaded = true;
    setBusy(busy);
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

      selectedTopic = selected;
      return selected;
    }

    const name = newTopicInput.value.trim();

    if (!name) {
      newTopicInput.focus();
      throw new Error("Enter a name for your new topic.");
    }

    const response = await sendMessage({
      action: "CREATE_NOTE_TOPIC",
      topic: name
    });

    const createdTopic = String(response.topic || name).trim();

    // Reload from the extension's saved topic list.
    await loadTopics(createdTopic);

    selectedTopic = createdTopic;
    topicSelect.value = createdTopic;
    newTopicInput.value = "";
    updateTopicInput();

    return createdTopic;
  }

  function showBubble() {
    bubble.style.display = "block";
    positionElement(
      bubble,
      selectionPosition.left,
      selectionPosition.top
    );
  }

  async function openPanel() {
    bubble.style.display = "none";
    panel.style.display = "block";

    preview.textContent = selectedText;
    status.textContent = "";
    status.classList.remove("st-error");

    topicSelect.disabled = true;
    saveButton.disabled = true;

    positionElement(
      panel,
      selectionPosition.left,
      selectionPosition.top + 38
    );

    try {
      await loadTopics(selectedTopic);
      positionElement(
        panel,
        selectionPosition.left,
        selectionPosition.top + 38
      );
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function inspectSelection() {
    const selection = window.getSelection();

    if (
      !selection ||
      selection.isCollapsed ||
      !selection.toString().trim()
    ) {
      if (panel.style.display !== "block") {
        bubble.style.display = "none";
      }
      return;
    }

    const anchorNode = selection.anchorNode;

    if (anchorNode && host.contains(anchorNode)) return;

    selectedText = selection.toString().trim();
    pageTitle = document.title;
    pageUrl = window.location.href;

    const rect = selection.getRangeAt(0).getBoundingClientRect();

    selectionPosition = {
      left: Math.max(
        10,
        Math.min(rect.left, window.innerWidth - 200)
      ),
      top: Math.min(
        rect.bottom + 8,
        window.innerHeight - 60
      )
    };

    if (panel.style.display !== "block") {
      showBubble();
    }
  }

  topicSelect.addEventListener("change", () => {
    updateTopicInput();

    if (topicSelect.value === CREATE_NEW_TOPIC) {
      setStatus("Enter a name for your new topic.");
      newTopicInput.focus();
    } else {
      selectedTopic = topicSelect.value;
      setStatus(`Selected topic: ${selectedTopic}`);
    }

    positionElement(
      panel,
      selectionPosition.left,
      selectionPosition.top + 38
    );
  });

  newTopicInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });

  document.addEventListener("mouseup", event => {
    if (event.composedPath().includes(host)) return;
    setTimeout(inspectSelection, 10);
  });

  document.addEventListener("keyup", event => {
    if (
      event.key === "Shift" ||
      event.key.startsWith("Arrow") ||
      event.key === "End" ||
      event.key === "Home"
    ) {
      setTimeout(inspectSelection, 10);
    }
  });

  bubble.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openPanel();
  });

  saveButton.addEventListener("click", async () => {
    if (busy) return;

    if (!selectedText.trim()) {
      setStatus("Select some text first.", true);
      return;
    }

    setBusy(true);
    setStatus("Saving note...");

    try {
      const topic = await resolveSelectedTopic();

      const response = await sendMessage({
        action: "SAVE_NOTE_FROM_PAGE",
        text: selectedText,
        title: pageTitle || "Saved selection",
        pageTitle,
        url: pageUrl,
        topic
      });

      selectedTopic = response.note?.topic || topic;

      setStatus(`Saved to "${selectedTopic}".`);

      setTimeout(hideUI, 1100);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  cancelButton.addEventListener("click", hideUI);

  document.addEventListener("mousedown", event => {
    if (
      !event.composedPath().includes(host) &&
      panel.style.display === "block"
    ) {
      hideUI();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (panel.style.display !== "block") {
        bubble.style.display = "none";
      }
    },
    true
  );
})();
