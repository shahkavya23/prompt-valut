const PromptVault = window.PromptVault;
const PrompttoraSupabase = window.PrompttoraSupabase;

const els = {
  countText: document.getElementById("countText"),
  newBtn: document.getElementById("newBtn"),
  searchInput: document.getElementById("searchInput"),
  categoryFilter: document.getElementById("categoryFilter"),
  saveSelectionBtn: document.getElementById("saveSelectionBtn"),
  screenshotBtn: document.getElementById("screenshotBtn"),
  authStatus: document.getElementById("authStatus"),
  authForm: document.getElementById("authForm"),
  supabaseKeyInput: document.getElementById("supabaseKeyInput"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  loginBtn: document.getElementById("loginBtn"),
  signupBtn: document.getElementById("signupBtn"),
  syncBtn: document.getElementById("syncBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  voiceBtn: document.getElementById("voiceBtn"),
  toggleFloatingBtn: document.getElementById("toggleFloatingBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFileInput: document.getElementById("importFileInput"),
  limitNotice: document.getElementById("limitNotice"),
  editor: document.getElementById("editor"),
  titleInput: document.getElementById("titleInput"),
  categoryInput: document.getElementById("categoryInput"),
  screenshotPreviewWrap: document.getElementById("screenshotPreviewWrap"),
  screenshotPreview: document.getElementById("screenshotPreview"),
  clearScreenshotBtn: document.getElementById("clearScreenshotBtn"),
  promptInput: document.getElementById("promptInput"),
  refinedInput: document.getElementById("refinedInput"),
  refineBtn: document.getElementById("refineBtn"),
  saveBtn: document.getElementById("saveBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  promptList: document.getElementById("promptList"),
  promptTemplate: document.getElementById("promptTemplate")
};

let prompts = [];
let editingId = null;
let promptStorageKey = PromptVault.STORAGE_KEY;
let screenshotData = "";
let floatingPaused = false;
let undoDelete = null;

init();

async function init() {
  fillCategories();
  await loadPrompts();
  await hydrateAuth();
  bindEvents();
  render();
}

function fillCategories() {
  PromptVault.DEFAULT_CATEGORIES.forEach((category) => {
    const filterOption = new Option(category, category);
    const inputOption = new Option(category, category);
    els.categoryFilter.appendChild(filterOption);
    els.categoryInput.appendChild(inputOption);
  });
}

function bindEvents() {
  els.newBtn.addEventListener("click", () => openEditor());
  els.cancelBtn.addEventListener("click", closeEditor);
  els.refineBtn.addEventListener("click", () => {
    els.refinedInput.value = PromptVault.refinePrompt(els.promptInput.value);
    if (!els.titleInput.value.trim()) els.titleInput.value = PromptVault.titleFromPrompt(els.promptInput.value);
    els.categoryInput.value = PromptVault.inferCategory(els.promptInput.value);
  });
  els.saveBtn.addEventListener("click", saveFromEditor);
  els.searchInput.addEventListener("input", render);
  els.categoryFilter.addEventListener("change", render);
  els.saveSelectionBtn.addEventListener("click", saveSelectionFromActiveTab);
  els.screenshotBtn.addEventListener("click", captureScreenshotPrompt);
  els.loginBtn.addEventListener("click", () => authenticate("login"));
  els.signupBtn.addEventListener("click", () => authenticate("signup"));
  els.syncBtn.addEventListener("click", syncNow);
  els.logoutBtn.addEventListener("click", logout);
  els.voiceBtn.addEventListener("click", toggleVoicePrompt);
  els.toggleFloatingBtn.addEventListener("click", toggleFloatingUi);
  els.exportBtn.addEventListener("click", exportPrompts);
  els.importBtn.addEventListener("click", () => els.importFileInput.click());
  els.importFileInput.addEventListener("change", importPrompts);
  els.clearScreenshotBtn.addEventListener("click", clearScreenshot);
  els.promptInput.addEventListener("input", updateSaveState);
  els.titleInput.addEventListener("input", updateSaveState);
  els.screenshotPreview.addEventListener("error", () => {
    screenshotData = "";
    renderScreenshotPreview();
    showNotice("Screenshot preview failed. Try Screenshot prompt again.");
  });
}

async function setPageUiSnooze(shouldHide) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const type = shouldHide ? "PROMPTVAULT_SNOOZE_PAGE_UI" : "PROMPTVAULT_WAKE_PAGE_UI";
  try {
    await chrome.tabs.sendMessage(tab.id, { type, minutes: 60 });
  } catch {
    if (shouldHide) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.querySelectorAll(".pv-suggest-button,.pv-dismiss-button,.pv-selection-save,.pv-panel").forEach((el) => el.remove());
          }
        });
      } catch {}
    }
  }
  showNotice(shouldHide ? "Prompttora page UI hidden for 1 hour." : "Prompttora page UI is active again.");
}

async function toggleFloatingUi() {
  floatingPaused = !floatingPaused;
  await setPageUiSnooze(floatingPaused);
  els.toggleFloatingBtn.textContent = floatingPaused ? "Resume floating button" : "Pause floating button";
}

async function toggleVoicePrompt() {
  await chrome.windows.create({
    url: chrome.runtime.getURL("src/voice.html"),
    type: "popup",
    width: 440,
    height: 620,
    focused: true
  });
}

async function loadPrompts() {
  promptStorageKey = await PromptVault.getActivePromptStorageKey();
  const data = await chrome.storage.local.get(promptStorageKey);
  prompts = data[promptStorageKey] || [];
}

async function persist() {
  prompts = prompts.slice(0, PromptVault.MAX_PROMPTS);
  await chrome.storage.local.set({ [promptStorageKey]: prompts });
}

async function hydrateAuth() {
  const config = await PrompttoraSupabase.getConfig();
  if (config.anonKey) els.supabaseKeyInput.value = config.anonKey;
  await renderAuth();
  const user = await PrompttoraSupabase.getUser();
  promptStorageKey = await PromptVault.setActivePromptStorageKey(user?.id);
  await loadPrompts();
  if (user) await syncNow({ silent: true });
}

async function renderAuth() {
  const user = await PrompttoraSupabase.getUser();
  els.authStatus.textContent = user ? `Signed in as ${user.email || "user"}` : "Login or sign up to sync";
  els.authForm.hidden = Boolean(user);
  els.logoutBtn.hidden = !user;
  els.syncBtn.disabled = false;
}

async function saveAuthConfig() {
  const config = await PrompttoraSupabase.getConfig();
  const anonKey = els.supabaseKeyInput.value.trim() || config.anonKey || PrompttoraSupabase.DEFAULT_PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("Supabase publishable key is missing from this build.");
  await PrompttoraSupabase.setConfig({ anonKey });
}

async function authenticate(mode) {
  try {
    await saveAuthConfig();
    const email = els.emailInput.value.trim();
    const password = els.passwordInput.value;
    if (!email || password.length < 6) throw new Error("Enter email and a 6+ character password.");
    if (mode === "signup") {
      const signup = await PrompttoraSupabase.signUp(email, password);
      if (!signup?.access_token) {
        showNotice("Signup created. Confirm your email, then login here.");
        return;
      }
    } else {
      await PrompttoraSupabase.signIn(email, password);
    }
    const user = await PrompttoraSupabase.getUser();
    promptStorageKey = await PromptVault.setActivePromptStorageKey(user?.id);
    await loadPrompts();
    await syncNow({ silent: true });
    await renderAuth();
    showNotice("Prompttora cloud sync is ready.");
  } catch (error) {
    const message = error.message || "Supabase login failed.";
    showNotice(authFriendlyMessage(message));
  }
}

function authFriendlyMessage(message) {
  if (message.includes("Invalid login credentials")) {
    return "Login failed. Confirm your email first, then check email/password.";
  }
  if (message.toLowerCase().includes("rate limit")) {
    return "Email limit reached. Wait a few minutes, then try login or signup again.";
  }
  return message;
}

async function logout() {
  await PrompttoraSupabase.signOut();
  promptStorageKey = await PromptVault.setActivePromptStorageKey(null);
  await loadPrompts();
  render();
  await renderAuth();
  showNotice("Logged out. Local prompts stay on this Chrome profile.");
}

async function syncNow(options = {}) {
  try {
    if (els.supabaseKeyInput.value.trim()) await saveAuthConfig();
    const result = await PrompttoraSupabase.mergeAndSync(prompts);
    if (result.synced) {
      prompts = result.prompts;
      await persist();
      render();
      if (!options.silent) showNotice("Cloud sync complete.");
    } else if (!options.silent) {
      showNotice("Login to enable cloud sync.");
    }
    await renderAuth();
  } catch (error) {
    if (!options.silent) showNotice(error.message || "Cloud sync failed.");
  }
}

function render() {
  const query = PromptVault.normalizeText(els.searchInput.value).toLowerCase();
  const category = els.categoryFilter.value;
  const filtered = prompts.filter((prompt) => {
    const categoryOk = category === "All" || prompt.category === category;
    const queryOk = !query || `${prompt.title} ${prompt.text} ${prompt.refined} ${prompt.category}`.toLowerCase().includes(query);
    return categoryOk && queryOk;
  });

  els.countText.textContent = `${prompts.length}/${PromptVault.MAX_PROMPTS}`;
  els.limitNotice.hidden = prompts.length < PromptVault.MAX_PROMPTS || editingId;
  els.promptList.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = prompts.length ? "No prompts match this search." : "Save a prompt to start building your reusable prompt library.";
    els.promptList.appendChild(empty);
    return;
  }

  filtered.forEach((prompt) => {
    const node = els.promptTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".tag").textContent = prompt.category;
    node.querySelector(".uses").textContent = `${prompt.useCount || 0} uses`;
    node.querySelector("h2").textContent = prompt.title;
    if (prompt.screenshotData) {
      const img = document.createElement("img");
      img.className = "card-shot";
      img.src = prompt.screenshotData;
      img.alt = "Prompt screenshot";
      node.insertBefore(img, node.querySelector("p"));
    }
    node.querySelector("p").textContent = prompt.text
      ? (prompt.text.length > 90 ? `${prompt.text.slice(0, 87)}...` : prompt.text)
      : "Screenshot prompt";
    node.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => handleCardAction(button.dataset.action, prompt.id));
    });
    els.promptList.appendChild(node);
  });
}

function openEditor(prompt = null) {
  if (!prompt && prompts.length >= PromptVault.MAX_PROMPTS) {
    els.limitNotice.hidden = false;
    return;
  }
  editingId = prompt?.id || null;
  screenshotData = prompt?.screenshotData || "";
  els.titleInput.value = prompt?.title || "";
  els.categoryInput.value = prompt?.category || "Other";
  els.promptInput.value = prompt?.text || "";
  els.refinedInput.value = prompt?.refined || "";
  renderScreenshotPreview();
  els.editor.hidden = false;
  updateSaveState();
  els.promptInput.focus();
}

function closeEditor() {
  editingId = null;
  els.editor.hidden = true;
  els.titleInput.value = "";
  els.promptInput.value = "";
  els.refinedInput.value = "";
  screenshotData = "";
  renderScreenshotPreview();
  updateSaveState();
}

function updateSaveState() {
  const hasContent = Boolean(PromptVault.normalizeText(els.promptInput.value) || screenshotData || PromptVault.normalizeText(els.titleInput.value));
  els.saveBtn.disabled = !hasContent;
}

async function saveFromEditor() {
  const text = PromptVault.normalizeText(els.promptInput.value);
  if (!text && !screenshotData) return;
  if (!editingId && prompts.length >= PromptVault.MAX_PROMPTS) {
    els.limitNotice.hidden = false;
    return;
  }
  const existing = prompts.find((prompt) => prompt.id === editingId);
  const prompt = PromptVault.buildPrompt({
    ...existing,
    id: editingId || undefined,
    title: els.titleInput.value,
    category: els.categoryInput.value,
    text: text || els.titleInput.value || "Screenshot prompt",
    refined: els.refinedInput.value || PromptVault.refinePrompt(text),
    screenshotData,
    screenshotTakenAt: screenshotData ? new Date().toISOString() : existing?.screenshotTakenAt
  });

  if (editingId) {
    prompts = prompts.map((item) => item.id === editingId ? prompt : item);
  } else {
    prompts.unshift(prompt);
  }
  await persist();
  await syncPrompt(prompt, editingId ? "prompt_updated" : "prompt_created");
  closeEditor();
  render();
}

async function handleCardAction(action, id) {
  const prompt = prompts.find((item) => item.id === id);
  if (!prompt) return;
  if (action === "copy") {
    const copyText = preparePromptText(prompt.refined || prompt.text);
    await navigator.clipboard.writeText(copyText);
    await bumpUse(id);
    showNotice("Copied prompt.");
  }
  if (action === "edit") openEditor(prompt);
  if (action === "delete") {
    const index = prompts.findIndex((item) => item.id === id);
    undoDelete = { prompt, index };
    prompts = prompts.filter((item) => item.id !== id);
    await persist();
    await deleteRemotePrompt(id);
    showUndoNotice("Prompt deleted.");
  }
  render();
}

function preparePromptText(text) {
  if (!PromptVault.templateVariables(text).length) return text;
  return PromptVault.fillTemplate(text, (name) => window.prompt(`Value for ${name}`));
}

async function restoreDeletedPrompt() {
  if (!undoDelete) return;
  const restored = undoDelete.prompt;
  prompts.splice(Math.max(0, undoDelete.index), 0, undoDelete.prompt);
  undoDelete = null;
  await persist();
  await syncPrompt(restored, "prompt_restored");
  showNotice("Prompt restored.");
  render();
}

async function bumpUse(id) {
  prompts = prompts.map((prompt) => prompt.id === id ? { ...prompt, useCount: (prompt.useCount || 0) + 1, updatedAt: new Date().toISOString() } : prompt);
  await persist();
  const updated = prompts.find((prompt) => prompt.id === id);
  if (updated) await syncPrompt(updated, "prompt_copied");
}

async function saveSelectionFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection() : "").trim()
    });
  } catch {
    showNotice("Chrome blocked this page. Try selecting text on a normal website tab.");
    return;
  }
  const text = results?.[0]?.result || "";
  if (!text) {
    showNotice("Select prompt text on the page first, then click Save selected text.");
    return;
  }
  await addPrompt({ text, sourceUrl: tab.url, sourceTitle: tab.title });
}

async function captureScreenshotPrompt() {
  if (prompts.length >= PromptVault.MAX_PROMPTS) {
    showNotice("Prompt limit reached. Delete one to save another.");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const response = await chrome.runtime.sendMessage({ type: "PROMPTVAULT_START_SNAP_TOP", tabId: tab.id });
    showNotice(response?.ok ? "Drag over the prompt area on the page." : (response?.reason || "Snap tool cannot run here."));
  } catch {
    showNotice("Snap tool cannot run here. Refresh the page or try a normal website tab.");
  }
}

function compressScreenshot(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function clearScreenshot() {
  screenshotData = "";
  renderScreenshotPreview();
}

function renderScreenshotPreview() {
  const hasScreenshot = Boolean(screenshotData && screenshotData.startsWith("data:image/"));
  els.screenshotPreviewWrap.hidden = !hasScreenshot;
  if (hasScreenshot) {
    els.screenshotPreview.src = screenshotData;
  } else {
    els.screenshotPreview.removeAttribute("src");
  }
}

async function addPrompt(data) {
  if (prompts.length >= PromptVault.MAX_PROMPTS) {
    showNotice("Prompt limit reached. Delete one to save another.");
    return;
  }
  const text = PromptVault.normalizeText(data.text);
  if (!text) return;
  const existingIndex = prompts.findIndex((prompt) => prompt.text.toLowerCase() === text.toLowerCase());
  const prompt = PromptVault.buildPrompt(data);
  if (existingIndex >= 0) {
    prompts[existingIndex] = { ...prompts[existingIndex], ...prompt, id: prompts[existingIndex].id, createdAt: prompts[existingIndex].createdAt };
  } else {
    prompts.unshift(prompt);
  }
  await persist();
  await syncPrompt(prompt, existingIndex >= 0 ? "prompt_updated" : "prompt_created");
  showNotice("Saved. Prompttora sorted it automatically.");
  render();
}

async function syncPrompt(prompt, eventType) {
  try {
    await PrompttoraSupabase.pushPrompt(prompt);
    await PrompttoraSupabase.track(eventType, prompt.id, { source_url: prompt.sourceUrl || "" });
  } catch {}
}

async function deleteRemotePrompt(id) {
  try {
    await PrompttoraSupabase.deletePrompt(id);
    await PrompttoraSupabase.track("prompt_deleted", id);
  } catch {}
}

function exportPrompts() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), prompts }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "promptvault-prompts.json";
  a.click();
  URL.revokeObjectURL(url);
  showNotice("Export downloaded.");
}

async function importPrompts() {
  const file = els.importFileInput.files?.[0];
  els.importFileInput.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.prompts;
    if (!Array.isArray(incoming)) throw new Error("Invalid file");
    const existing = new Set(prompts.map((prompt) => prompt.text.toLowerCase()));
    incoming.forEach((item) => {
      const prompt = PromptVault.buildPrompt(item);
      if (!existing.has(prompt.text.toLowerCase()) && prompts.length < PromptVault.MAX_PROMPTS) {
        prompts.push(prompt);
        existing.add(prompt.text.toLowerCase());
      }
    });
    await persist();
    await syncNow({ silent: true });
    showNotice("Prompts imported.");
    render();
  } catch {
    showNotice("Import failed. Use a Prompttora JSON export.");
  }
}

function showNotice(message) {
  els.limitNotice.textContent = message;
  els.limitNotice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    els.limitNotice.hidden = prompts.length < PromptVault.MAX_PROMPTS || editingId;
    els.limitNotice.textContent = "Prompt limit reached. Delete one to save another.";
  }, 2400);
}

function showUndoNotice(message) {
  els.limitNotice.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = `${message} `;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.className = "inline-undo";
  undo.addEventListener("click", restoreDeletedPrompt);
  els.limitNotice.append(span, undo);
  els.limitNotice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    undoDelete = null;
    els.limitNotice.hidden = prompts.length < PromptVault.MAX_PROMPTS || editingId;
    els.limitNotice.textContent = "Prompt limit reached. Delete one to save another.";
  }, 8000);
}
