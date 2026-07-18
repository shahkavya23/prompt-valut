(function () {
  const PromptVault = window.PromptVault;
  const storage = chrome?.storage?.local;
  let activeEditable = null;
  let suggestionButton = null;
  let dismissButton = null;
  let selectionSaveButton = null;
  let panel = null;
  let candidateCache = [];
  let candidateTimer = null;
  let snapLayer = null;
  let snapStart = null;
  let snapBox = null;
  let pageUiSnoozedUntil = 0;
  let pendingSnap = null;
  let snapHotkeyArmed = true;
  let dragState = null;

  function extensionAlive() {
    try {
      return Boolean(chrome?.runtime?.id && chrome?.storage?.local);
    } catch {
      return false;
    }
  }

  function getAssetUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return "";
    }
  }

  function sendRuntimeMessage(message, callback) {
    if (!extensionAlive()) {
      callback?.({ ok: false, reason: "Extension was reloaded." });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch {
      callback?.({ ok: false, reason: "Extension was reloaded." });
    }
  }

  function getPrompts() {
    if (!extensionAlive()) return Promise.resolve([]);
    return PromptVault.getActivePromptStorageKey()
      .then((key) => storage.get(key).then((data) => data[key] || []))
      .catch(() => []);
  }

  async function setPrompts(prompts) {
    if (!extensionAlive()) return Promise.resolve();
    const key = await PromptVault.getActivePromptStorageKey();
    return storage.set({ [key]: prompts.slice(0, PromptVault.MAX_PROMPTS) })
      .catch(() => {});
  }

  async function savePrompt(text, meta = {}) {
    if (!extensionAlive()) {
      showToast("Refresh this page to reconnect Prompttora");
      return { ok: false, reason: "Extension was reloaded." };
    }
    const clean = PromptVault.normalizeText(text);
    if (!clean) return { ok: false, reason: "No prompt text found." };
    const prompts = await getPrompts();
    const existingIndex = prompts.findIndex((p) => p.text.toLowerCase() === clean.toLowerCase());
    const prompt = PromptVault.buildPrompt({
      text: clean,
      sourceUrl: meta.sourceUrl || location.href,
      sourceTitle: meta.sourceTitle || document.title
    });
    if (existingIndex >= 0) {
      prompts[existingIndex] = { ...prompts[existingIndex], ...prompt, id: prompts[existingIndex].id, createdAt: prompts[existingIndex].createdAt };
    } else {
      prompts.unshift(prompt);
    }
    await setPrompts(prompts);
    showToast(existingIndex >= 0 ? "Updated in Prompttora" : "Saved to Prompttora");
    return { ok: true };
  }

  function editableText(el) {
    if (!el) return "";
    if ("value" in el) return el.value;
    return el.innerText || el.textContent || "";
  }

  function writeToEditable(el, text) {
    if (!el) return;
    el.focus();
    if ("value" in el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    document.execCommand("insertText", false, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function isEditable(el) {
    return el && (el.matches?.("textarea, input[type='text'], input[type='search']") || el.isContentEditable || el.getAttribute?.("role") === "textbox");
  }

  function ensureUi() {
    const mount = document.body || document.documentElement;
    if (!suggestionButton) {
      suggestionButton = document.createElement("button");
      suggestionButton.className = "pv-suggest-button";
      const logo = document.createElement("img");
      logo.src = getAssetUrl("assets/icon-48.png");
      logo.alt = "";
      logo.addEventListener("error", () => {
        logo.remove();
        suggestionButton.textContent = "P";
      }, { once: true });
      suggestionButton.appendChild(logo);
      suggestionButton.title = "Show saved prompt suggestions";
      suggestionButton.addEventListener("pointerdown", onFloatingPointerDown);
      suggestionButton.addEventListener("mousedown", (event) => event.preventDefault());
      suggestionButton.addEventListener("click", showFloatingMenu);
      mount.appendChild(suggestionButton);
    }
    if (!dismissButton) {
      dismissButton = document.createElement("button");
      dismissButton.className = "pv-dismiss-button";
      dismissButton.textContent = "×";
      dismissButton.title = "Hide Prompttora on this page for a while";
      dismissButton.addEventListener("mousedown", (event) => event.preventDefault());
      dismissButton.addEventListener("click", () => snoozePageUi(60));
      mount.appendChild(dismissButton);
    }
    if (!selectionSaveButton) {
      selectionSaveButton = document.createElement("button");
      selectionSaveButton.className = "pv-selection-save";
      selectionSaveButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H6V5h9v4Z"/>
        </svg>
      `;
      selectionSaveButton.title = "Save selected prompt to Prompttora";
      selectionSaveButton.setAttribute("aria-label", "Save selected prompt to Prompttora");
      selectionSaveButton.addEventListener("mousedown", (event) => event.preventDefault());
      selectionSaveButton.addEventListener("click", saveCurrentSelection);
      mount.appendChild(selectionSaveButton);
    }
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "pv-panel";
      panel.hidden = true;
      mount.appendChild(panel);
    }
  }

  function positionSuggestionButton(el) {
    if (!suggestionButton || !dismissButton || !el || isPageUiSnoozed()) return;
    const saved = getFloatingPosition();
    if (saved) {
      applyFloatingPosition(saved.left, saved.top);
      return;
    }
    const rect = el.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 44, Math.max(8, rect.right - 42));
    const top = Math.min(window.innerHeight - 42, Math.max(8, rect.bottom + 6));
    applyFloatingPosition(left, top);
  }

  function applyFloatingPosition(left, top) {
    suggestionButton.style.left = `${left}px`;
    suggestionButton.style.top = `${top}px`;
    suggestionButton.style.display = "flex";
    dismissButton.style.left = `${Math.min(window.innerWidth - 26, left + 26)}px`;
    dismissButton.style.top = `${Math.max(8, top - 10)}px`;
    dismissButton.style.display = "flex";
  }

  function floatingStorageKey() {
    return `promptvault.floating.${location.hostname}`;
  }

  function getFloatingPosition() {
    try {
      const parsed = JSON.parse(localStorage.getItem(floatingStorageKey()) || "null");
      if (!parsed) return null;
      return {
        left: Math.min(window.innerWidth - 44, Math.max(8, parsed.left)),
        top: Math.min(window.innerHeight - 44, Math.max(8, parsed.top))
      };
    } catch {
      return null;
    }
  }

  function saveFloatingPosition(left, top) {
    try {
      localStorage.setItem(floatingStorageKey(), JSON.stringify({ left, top }));
    } catch {}
  }

  function onFloatingPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const rect = suggestionButton.getBoundingClientRect();
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    suggestionButton.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onFloatingPointerMove, true);
    window.addEventListener("pointerup", onFloatingPointerUp, true);
  }

  function onFloatingPointerMove(event) {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
    const left = Math.min(window.innerWidth - 44, Math.max(8, dragState.left + dx));
    const top = Math.min(window.innerHeight - 44, Math.max(8, dragState.top + dy));
    applyFloatingPosition(left, top);
  }

  function onFloatingPointerUp(event) {
    if (!dragState) return;
    const rect = suggestionButton.getBoundingClientRect();
    saveFloatingPosition(rect.left, rect.top);
    if (dragState.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
    dragState = null;
    window.removeEventListener("pointermove", onFloatingPointerMove, true);
    window.removeEventListener("pointerup", onFloatingPointerUp, true);
  }

  function hideSuggestionButtons() {
    if (suggestionButton) suggestionButton.style.display = "none";
    if (dismissButton) dismissButton.style.display = "none";
  }

  function isPageUiSnoozed() {
    return Date.now() < pageUiSnoozedUntil;
  }

  function snoozePageUi(minutes) {
    pageUiSnoozedUntil = Date.now() + minutes * 60 * 1000;
    hideSuggestionButtons();
    hideSelectionSaveButton();
    if (panel) panel.hidden = true;
    showToast(`Prompttora hidden for ${minutes} min`);
  }

  function extractPromptCandidates() {
    const selected = PromptVault.normalizeText(window.getSelection?.().toString());
    const scored = [];
    const nodes = Array.from(document.querySelectorAll("article, main, section, div, p, li, pre, code, textarea"))
      .slice(0, 1200);
    nodes.forEach((node) => {
      const text = PromptVault.normalizeText(node.innerText || node.textContent || node.value);
      if (!PromptVault.looksLikePrompt(text)) return;
      scored.push({
        text,
        score: promptCandidateScore(text, node)
      });
    });
    if (selected && PromptVault.looksLikePrompt(selected)) {
      scored.unshift({ text: selected, score: 100 });
    }
    const unique = new Map();
    scored
      .sort((a, b) => b.score - a.score)
      .forEach((item) => {
        const key = item.text.toLowerCase();
        if (!unique.has(key)) unique.set(key, item.text);
      });
    return Array.from(unique.values()).slice(0, 8);
  }

  function extractVisiblePromptCandidates() {
    const scored = [];
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const selectors = "article, main, section, div, p, li, pre, code, blockquote, textarea, [role='article'], [data-testid], [class*='message'], [class*='prompt'], [class*='post']";
    const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 1600);

    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (!rect || rect.width < 80 || rect.height < 18) return;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) return;
      const text = PromptVault.normalizeText(node.innerText || node.textContent || node.value);
      if (!PromptVault.looksLikePrompt(text)) return;

      const visibleArea = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)) *
        Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const area = Math.max(1, rect.width * rect.height);
      const visibility = visibleArea / area;
      if (visibility < 0.45) return;

      scored.push({
        text,
        score: promptCandidateScore(text, node) + Math.round(visibility * 20) + visualPromptScore(text, rect),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    });

    const unique = new Map();
    scored
      .sort((a, b) => b.score - a.score)
      .forEach((item) => {
        const normalized = item.text.toLowerCase();
        const duplicate = Array.from(unique.keys()).some((key) => key.includes(normalized) || normalized.includes(key));
        if (!duplicate) unique.set(normalized, item);
      });
    return Array.from(unique.values()).slice(0, 5);
  }

  function promptCandidateScore(text, node) {
    const lower = text.toLowerCase();
    let score = 0;
    if (/\b(act as|you are|write|generate|create|explain|summarize|build|debug|analyze|rewrite)\b/i.test(text)) score += 20;
    if (lower.includes("prompt")) score += 16;
    if (text.length >= 80 && text.length <= 800) score += 12;
    if (node.matches?.("pre, code, textarea, article")) score += 8;
    if (/[.!?]$/.test(text)) score += 4;
    return score;
  }

  function visualPromptScore(text, rect) {
    const lower = text.toLowerCase();
    let score = 0;
    if (lower.includes("prompt")) score += 22;
    if (/\b(act as|role|task|context|output|format|instructions?)\b/i.test(text)) score += 16;
    if (text.length >= 90 && text.length <= 1000) score += 10;
    if (rect.width > 280 && rect.height > 45) score += 8;
    if (rect.top > 20 && rect.top < window.innerHeight - 80) score += 6;
    return score;
  }

  function refreshCandidateCache() {
    candidateCache = extractPromptCandidates();
  }

  function scheduleCandidateRefresh() {
    window.clearTimeout(candidateTimer);
    candidateTimer = window.setTimeout(() => {
      refreshCandidateCache();
      updateSelectionSaveButton();
    }, 180);
  }

  async function saveBestCandidate() {
    ensureUi();
    const selected = PromptVault.normalizeText(window.getSelection?.().toString());
    if (selected) {
      await savePrompt(selected);
      return;
    }
    if (!candidateCache.length) refreshCandidateCache();
    if (candidateCache.length) {
      await savePrompt(candidateCache[0]);
      return;
    }
    await showCapturePanel();
  }

  async function saveCurrentSelection() {
    const selected = PromptVault.normalizeText(window.getSelection?.().toString());
    if (!selected) {
      hideSelectionSaveButton();
      return;
    }
    await savePrompt(selected);
    hideSelectionSaveButton();
    window.getSelection?.().removeAllRanges();
  }

  function updateSelectionSaveButton() {
    ensureUi();
    const selection = window.getSelection?.();
    const selected = PromptVault.normalizeText(selection?.toString());
    if (isPageUiSnoozed() || !selection || selection.rangeCount === 0 || selected.length < 3) {
      hideSelectionSaveButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const rect = rects[rects.length - 1] || range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideSelectionSaveButton();
      return;
    }

    const left = Math.min(window.innerWidth - 42, Math.max(8, rect.right - 14));
    const top = Math.min(window.innerHeight - 44, Math.max(8, rect.top - 42));
    selectionSaveButton.style.left = `${left}px`;
    selectionSaveButton.style.top = `${top}px`;
    selectionSaveButton.style.setProperty("display", "flex", "important");
  }

  function hideSelectionSaveButton() {
    if (selectionSaveButton) selectionSaveButton.style.setProperty("display", "none", "important");
  }

  function updateSelectionSoon() {
    updateSelectionSaveButton();
    window.setTimeout(updateSelectionSaveButton, 80);
    window.setTimeout(updateSelectionSaveButton, 220);
  }

  async function showCapturePanel() {
    ensureUi();
    const candidates = extractPromptCandidates();
    panel.hidden = false;
    panel.innerHTML = "";
    const title = document.createElement("h3");
    title.textContent = "Save from this page";
    panel.appendChild(title);
    if (!candidates.length) {
      const p = document.createElement("p");
      p.textContent = "No prompt-like text found. Select the text you want, then right-click and save it.";
      panel.appendChild(p);
      return;
    }
    candidates.forEach((candidate) => {
      const row = document.createElement("div");
      row.className = "pv-row";
      row.innerHTML = `<span class="pv-row-title">${escapeHtml(PromptVault.titleFromPrompt(candidate))}</span><div class="pv-row-text">${escapeHtml(candidate.slice(0, 220))}</div>`;
      const actions = document.createElement("div");
      actions.className = "pv-actions";
      const save = document.createElement("button");
      save.textContent = "Save";
      save.addEventListener("click", () => savePrompt(candidate));
      actions.append(save);
      row.appendChild(actions);
      panel.appendChild(row);
    });
  }

  async function showSuggestionPanel() {
    if (dragState?.moved) return;
    ensureUi();
    const current = editableText(activeEditable);
    const prompts = await getPrompts();
    const ranked = prompts
      .map((prompt) => ({ prompt, score: PromptVault.similarityScore(current, prompt) }))
      .sort((a, b) => b.score - a.score || b.prompt.useCount - a.prompt.useCount)
      .slice(0, 5);
    panel.hidden = false;
    panel.innerHTML = "<h3>Prompt suggestions</h3>";
    if (!ranked.length) {
      const p = document.createElement("p");
      p.textContent = "No saved prompts yet. Save one from the popup or this page.";
      panel.appendChild(p);
      return;
    }
    ranked.forEach(({ prompt }) => {
      const row = document.createElement("div");
      row.className = "pv-row";
      row.innerHTML = `<span class="pv-row-title">${escapeHtml(prompt.title)}</span>`;
      const actions = document.createElement("div");
      actions.className = "pv-actions";
      const insert = document.createElement("button");
      insert.textContent = "Insert";
      insert.addEventListener("click", () => {
        const text = PromptVault.fillTemplate(prompt.refined || prompt.text, (name) => window.prompt(`Value for ${name}`));
        writeToEditable(activeEditable, text);
        incrementUse(prompt.id);
        panel.hidden = true;
      });
      actions.append(insert);
      row.appendChild(actions);
      panel.appendChild(row);
    });
  }

  async function showFloatingMenu() {
    if (dragState?.moved) return;
    ensureUi();
    panel.hidden = false;
    panel.innerHTML = `
      <h3>Prompttora</h3>
      <div class="pv-actions pv-menu-actions">
        <button data-action="snap" title="Snap prompt from page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1v3m14-4h3a1 1 0 0 1 1 1v3M7 21H4a1 1 0 0 1-1-1v-3m18 0v3a1 1 0 0 1-1 1h-3M8 12h8m-4-4v8"/></svg>
          <span>Snap</span>
        </button>
        <button data-action="save-selection" title="Save selected text">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
          <span>Save selected</span>
        </button>
        <button data-action="history" title="Open prompt history">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/></svg>
          <span>History</span>
        </button>
        <button data-action="hide" title="Hide Prompttora for a while">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><path d="m4 4 16 16"/></svg>
          <span>Hide</span>
        </button>
      </div>
    `;
    panel.querySelector('[data-action="snap"]').addEventListener("click", () => {
      panel.hidden = true;
      sendRuntimeMessage({ type: "PROMPTVAULT_START_SNAP_TOP" }, (response) => {
        if (!response?.ok) startSnapMode();
      });
    });
    panel.querySelector('[data-action="save-selection"]').addEventListener("click", async () => {
      await saveCurrentSelection();
      panel.hidden = true;
    });
    panel.querySelector('[data-action="history"]').addEventListener("click", () => {
      sendRuntimeMessage({ type: "PROMPTVAULT_OPEN_OPTIONS" });
      panel.hidden = true;
    });
    panel.querySelector('[data-action="hide"]').addEventListener("click", () => {
      snoozePageUi(60);
      panel.hidden = true;
    });
  }

  async function incrementUse(id) {
    const prompts = await getPrompts();
    const next = prompts.map((prompt) => prompt.id === id ? { ...prompt, useCount: (prompt.useCount || 0) + 1, updatedAt: new Date().toISOString() } : prompt);
    await setPrompts(next);
  }

  function showToast(message) {
    ensureUi();
    const old = document.querySelector(".pv-toast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.className = "pv-panel pv-toast";
    toast.style.width = "220px";
    toast.style.bottom = "62px";
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[char]);
  }

  document.addEventListener("focusin", (event) => {
    if (!isEditable(event.target)) return;
    ensureUi();
    activeEditable = event.target;
    positionSuggestionButton(activeEditable);
  });

  document.addEventListener("input", (event) => {
    if (!isEditable(event.target)) return;
    activeEditable = event.target;
    ensureUi();
    positionSuggestionButton(activeEditable);
    scheduleCandidateRefresh();
  }, true);

  document.addEventListener("selectionchange", scheduleCandidateRefresh);
  document.addEventListener("mouseup", updateSelectionSoon, true);
  document.addEventListener("pointerup", updateSelectionSoon, true);
  document.addEventListener("keyup", updateSelectionSoon, true);
  document.addEventListener("touchend", updateSelectionSoon, true);

  window.addEventListener("scroll", updateSelectionSaveButton, true);
  window.addEventListener("resize", updateSelectionSaveButton);

  window.addEventListener("keydown", handleSnapHotkey, true);
  document.addEventListener("keydown", handleSnapHotkey, true);
  window.addEventListener("keyup", resetSnapHotkey, true);
  document.addEventListener("keyup", resetSnapHotkey, true);

  document.addEventListener("click", (event) => {
    if (panel && !panel.hidden && !panel.contains(event.target) && event.target !== suggestionButton) {
      panel.hidden = true;
    }
    if (selectionSaveButton && event.target !== selectionSaveButton && !PromptVault.normalizeText(window.getSelection?.().toString())) {
      hideSelectionSaveButton();
    }
  }, true);

  if (!extensionAlive()) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PROMPTVAULT_START_SNAP") {
      startSnapMode();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PROMPTVAULT_SNOOZE_PAGE_UI") {
      snoozePageUi(message.minutes || 60);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PROMPTVAULT_WAKE_PAGE_UI") {
      pageUiSnoozedUntil = 0;
      if (activeEditable) positionSuggestionButton(activeEditable);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PROMPTVAULT_SNAP_SAVED") {
      showToast("Snapped prompt saved");
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PROMPTVAULT_SNAP_FAILED") {
      showToast(message.reason || "Snap failed");
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PROMPTVAULT_SAVE_TEXT") {
      savePrompt(message.text).then(sendResponse);
      return true;
    }
    if (message.type === "PROMPTVAULT_EXTRACT_CANDIDATES") {
      sendResponse({ candidates: extractPromptCandidates(), url: location.href, title: document.title });
    }
    if (message.type === "PROMPTVAULT_EXTRACT_VISIBLE_CANDIDATES") {
      sendResponse({
        candidates: extractVisiblePromptCandidates(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        url: location.href,
        title: document.title
      });
    }
    return false;
  });

  ensureUi();
  scheduleCandidateRefresh();

  function startSnapMode() {
    stopSnapMode();
    snapStart = null;
    snapLayer = document.createElement("div");
    snapLayer.className = "pv-snap-layer";
    snapLayer.innerHTML = `<div class="pv-snap-tip">Drag around the prompt. Press Esc to cancel.</div>`;
    snapBox = document.createElement("div");
    snapBox.className = "pv-snap-box";
    snapBox.style.display = "none";
    snapLayer.appendChild(snapBox);
    document.body.appendChild(snapLayer);
    snapLayer.addEventListener("pointerdown", onSnapPointerDown);
    snapLayer.addEventListener("pointermove", onSnapPointerMove);
    snapLayer.addEventListener("pointerup", onSnapPointerUp);
    document.addEventListener("keydown", onSnapKeyDown, true);
  }

  function handleSnapHotkey(event) {
    const isP = event.code === "KeyP" || String(event.key || "").toLowerCase() === "p";
    if (!isP || !event.altKey || !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (!snapHotkeyArmed) return;
    snapHotkeyArmed = false;
    sendRuntimeMessage({ type: "PROMPTVAULT_START_SNAP_TOP" }, (response) => {
      if (!response?.ok) {
        showToast("Shortcut could not start Snap. Try the popup Snap button.");
      }
    });
  }

  function resetSnapHotkey(event) {
    const isP = !event || event.code === "KeyP" || String(event.key || "").toLowerCase() === "p";
    if (isP) snapHotkeyArmed = true;
  }

  function stopSnapMode() {
    if (snapLayer) snapLayer.remove();
    snapLayer = null;
    snapStart = null;
    snapBox = null;
    document.removeEventListener("keydown", onSnapKeyDown, true);
  }

  function onSnapPointerDown(event) {
    event.preventDefault();
    snapStart = { x: event.clientX, y: event.clientY };
    snapBox.style.display = "block";
    drawSnapBox(event.clientX, event.clientY);
  }

  function onSnapPointerMove(event) {
    if (!snapStart) return;
    event.preventDefault();
    drawSnapBox(event.clientX, event.clientY);
  }

  function onSnapPointerUp(event) {
    if (!snapStart) return;
    event.preventDefault();
    const rect = normalizeSnapRect(snapStart.x, snapStart.y, event.clientX, event.clientY);
    stopSnapMode();
    if (rect.width < 24 || rect.height < 24) {
      showToast("Snap area too small");
      return;
    }
    const snappedText = textFromRect(rect);
    pendingSnap = {
      rect,
      dpr: window.devicePixelRatio || 1,
      snappedText,
      sourceUrl: location.href,
      sourceTitle: document.title
    };
    showCategoryDialog(snappedText);
  }

  function onSnapKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopSnapMode();
      showToast("Snap cancelled");
    }
  }

  function drawSnapBox(x, y) {
    const rect = normalizeSnapRect(snapStart.x, snapStart.y, x, y);
    snapBox.style.left = `${rect.left}px`;
    snapBox.style.top = `${rect.top}px`;
    snapBox.style.width = `${rect.width}px`;
    snapBox.style.height = `${rect.height}px`;
  }

  function normalizeSnapRect(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(window.innerWidth, Math.max(x1, x2));
    const bottom = Math.min(window.innerHeight, Math.max(y1, y2));
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(Math.max(0, right - left)),
      height: Math.round(Math.max(0, bottom - top))
    };
  }

  function textFromRect(rect) {
    const pieces = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = PromptVault.normalizeText(node.nodeValue);
        if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        const intersects = Array.from(range.getClientRects()).some((r) => intersectsRect(r, rect));
        range.detach();
        return intersects ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) {
      pieces.push(PromptVault.normalizeText(walker.currentNode.nodeValue));
    }
    return Array.from(new Set(pieces)).join(" ").trim();
  }

  function intersectsRect(a, b) {
    return a.right >= b.left && a.left <= b.left + b.width && a.bottom >= b.top && a.top <= b.top + b.height;
  }

  function showCategoryDialog(snappedText) {
    const old = document.querySelector(".pv-category-dialog");
    if (old) old.remove();
    const dialog = document.createElement("div");
    dialog.className = "pv-category-dialog";
    dialog.innerHTML = `
      <h3>Save snapped prompt</h3>
      <p>${escapeHtml(snappedText ? PromptVault.titleFromPrompt(snappedText) : "Choose a category before saving.")}</p>
      <div class="pv-category-grid"></div>
      <div class="pv-category-actions"><button data-cancel="true">Cancel</button></div>
    `;
    const grid = dialog.querySelector(".pv-category-grid");
    PromptVault.DEFAULT_CATEGORIES.forEach((category) => {
      const button = document.createElement("button");
      button.textContent = category;
      button.addEventListener("click", () => savePendingSnap(category, dialog));
      grid.appendChild(button);
    });
    dialog.querySelector("[data-cancel]").addEventListener("click", () => {
      pendingSnap = null;
      dialog.remove();
      showToast("Snap cancelled");
    });
    document.body.appendChild(dialog);
  }

  function savePendingSnap(category, dialog) {
    if (!pendingSnap) return;
    sendRuntimeMessage({
      type: "PROMPTVAULT_SAVE_SNAP",
      ...pendingSnap,
      category
    }, (response) => {
      if (!response?.ok) {
        showToast(response?.reason || "Refresh this page to reconnect Prompttora");
        return;
      }
      pendingSnap = null;
      dialog.remove();
      showToast(`Saved to ${category}`);
    });
  }
})();
