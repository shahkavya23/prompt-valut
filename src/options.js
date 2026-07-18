const PromptVault = window.PromptVault;
const PrompttoraSupabase = window.PrompttoraSupabase;
const $ = (id) => document.getElementById(id);

const els = {
  count: $("count"),
  cloudStatus: $("cloudStatus"),
  supabaseKey: $("supabaseKey"),
  email: $("email"),
  password: $("password"),
  login: $("login"),
  signup: $("signup"),
  sync: $("sync"),
  logout: $("logout"),
  title: $("title"),
  category: $("category"),
  text: $("text"),
  refined: $("refined"),
  refine: $("refine"),
  save: $("save"),
  reset: $("reset"),
  search: $("search"),
  filter: $("filter"),
  list: $("list")
};

let prompts = [];
let editingId = null;
let promptStorageKey = PromptVault.STORAGE_KEY;

PromptVault.DEFAULT_CATEGORIES.forEach((category) => {
  els.category.appendChild(new Option(category, category));
  els.filter.appendChild(new Option(category, category));
});

load();
hydrateAuth();
els.refine.addEventListener("click", () => {
  els.refined.value = PromptVault.refinePrompt(els.text.value);
  if (!els.title.value.trim()) els.title.value = PromptVault.titleFromPrompt(els.text.value);
  els.category.value = PromptVault.inferCategory(els.text.value);
});
els.save.addEventListener("click", save);
els.reset.addEventListener("click", resetForm);
els.search.addEventListener("input", render);
els.filter.addEventListener("change", render);
els.login.addEventListener("click", () => authenticate("login"));
els.signup.addEventListener("click", () => authenticate("signup"));
els.sync.addEventListener("click", () => syncNow());
els.logout.addEventListener("click", logout);

async function load() {
  promptStorageKey = await PromptVault.getActivePromptStorageKey();
  const data = await chrome.storage.local.get(promptStorageKey);
  prompts = data[promptStorageKey] || [];
  render();
}

async function persist() {
  prompts = prompts.slice(0, PromptVault.MAX_PROMPTS);
  await chrome.storage.local.set({ [promptStorageKey]: prompts });
}

async function hydrateAuth() {
  const config = await PrompttoraSupabase.getConfig();
  if (config.anonKey) els.supabaseKey.value = config.anonKey;
  await renderAuth();
  const user = await PrompttoraSupabase.getUser();
  promptStorageKey = await PromptVault.setActivePromptStorageKey(user?.id);
  await load();
  if (user) await syncNow(true);
}

async function renderAuth() {
  const user = await PrompttoraSupabase.getUser();
  els.cloudStatus.textContent = user ? `Signed in as ${user.email || "user"}` : "Login or sign up to sync.";
  els.logout.hidden = !user;
}

async function saveAuthConfig() {
  const config = await PrompttoraSupabase.getConfig();
  const anonKey = els.supabaseKey.value.trim() || config.anonKey || PrompttoraSupabase.DEFAULT_PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("Supabase publishable key is missing from this build.");
  await PrompttoraSupabase.setConfig({ anonKey });
}

async function authenticate(mode) {
  try {
    await saveAuthConfig();
    const email = els.email.value.trim();
    const password = els.password.value;
    if (!email || password.length < 6) throw new Error("Enter email and a 6+ character password.");
    if (mode === "signup") {
      const signup = await PrompttoraSupabase.signUp(email, password);
      if (!signup?.access_token) {
        els.cloudStatus.textContent = "Signup created. Confirm your email, then login here.";
        return;
      }
    } else {
      await PrompttoraSupabase.signIn(email, password);
    }
    const user = await PrompttoraSupabase.getUser();
    promptStorageKey = await PromptVault.setActivePromptStorageKey(user?.id);
    await load();
    await syncNow(true);
    await renderAuth();
  } catch (error) {
    const message = error.message || "Supabase login failed.";
    els.cloudStatus.textContent = authFriendlyMessage(message);
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
  await load();
  await renderAuth();
}

async function syncNow(silent = false) {
  try {
    if (els.supabaseKey.value.trim()) await saveAuthConfig();
    const result = await PrompttoraSupabase.mergeAndSync(prompts);
    if (result.synced) {
      prompts = result.prompts;
      await persist();
      render();
      if (!silent) els.cloudStatus.textContent = "Cloud sync complete.";
    } else if (!silent) {
      els.cloudStatus.textContent = "Login to enable cloud sync.";
    }
    await renderAuth();
  } catch (error) {
    if (!silent) els.cloudStatus.textContent = error.message || "Cloud sync failed.";
  }
}

async function save() {
  const text = PromptVault.normalizeText(els.text.value);
  const existing = prompts.find((prompt) => prompt.id === editingId);
  if (!text && !existing?.screenshotData) return;
  if (!editingId && prompts.length >= PromptVault.MAX_PROMPTS) return;
  const prompt = PromptVault.buildPrompt({
    ...existing,
    id: editingId || undefined,
    title: els.title.value,
    category: els.category.value,
    text: text || els.title.value || "Screenshot prompt",
    refined: els.refined.value || PromptVault.refinePrompt(text),
    screenshotData: existing?.screenshotData || "",
    screenshotTakenAt: existing?.screenshotTakenAt || ""
  });
  prompts = editingId
    ? prompts.map((item) => item.id === editingId ? prompt : item)
    : [prompt, ...prompts];
  await persist();
  await syncPrompt(prompt, editingId ? "prompt_updated" : "prompt_created");
  resetForm();
  render();
}

function resetForm() {
  editingId = null;
  els.title.value = "";
  els.category.value = "Other";
  els.text.value = "";
  els.refined.value = "";
  els.save.textContent = "Save prompt";
}

function render() {
  els.count.textContent = `${prompts.length}/${PromptVault.MAX_PROMPTS}`;
  const query = PromptVault.normalizeText(els.search.value).toLowerCase();
  const category = els.filter.value;
  const filtered = prompts.filter((prompt) => {
    const q = `${prompt.title} ${prompt.text} ${prompt.refined} ${prompt.category}`.toLowerCase();
    return (category === "All" || prompt.category === category) && (!query || q.includes(query));
  });
  els.list.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = prompts.length ? "No prompts match this filter." : "Your prompt library is empty.";
    els.list.appendChild(empty);
    return;
  }
  filtered.forEach((prompt) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <span class="tag"></span>
        <span class="uses"></span>
      </div>
      <h2></h2>
      <p></p>
      <div class="card-actions">
        <button data-action="copy">Copy</button>
        <button data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div>
    `;
    card.querySelector(".tag").textContent = prompt.category;
    card.querySelector(".uses").textContent = `${prompt.useCount || 0} uses`;
    card.querySelector("h2").textContent = prompt.title;
    if (prompt.screenshotData) {
      const img = document.createElement("img");
      img.className = "shot";
      img.src = prompt.screenshotData;
      img.alt = "Prompt screenshot";
      card.insertBefore(img, card.querySelector("p"));
    }
    card.querySelector("p").textContent = prompt.text
      ? (prompt.text.length > 220 ? `${prompt.text.slice(0, 217)}...` : prompt.text)
      : "Screenshot prompt";
    card.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => act(button.dataset.action, prompt));
    });
    els.list.appendChild(card);
  });
}

async function act(action, prompt) {
  if (action === "copy") await navigator.clipboard.writeText(preparePromptText(prompt.refined || prompt.text));
  if (action === "copy") {
    prompts = prompts.map((item) => item.id === prompt.id ? { ...item, useCount: (item.useCount || 0) + 1 } : item);
    await persist();
    const updated = prompts.find((item) => item.id === prompt.id);
    if (updated) await syncPrompt(updated, "prompt_copied");
  }
  if (action === "edit") {
    editingId = prompt.id;
    els.title.value = prompt.title;
    els.category.value = prompt.category;
    els.text.value = prompt.text;
    els.refined.value = prompt.refined;
    els.save.textContent = "Update prompt";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (action === "delete") {
    prompts = prompts.filter((item) => item.id !== prompt.id);
    await persist();
    await deleteRemotePrompt(prompt.id);
  }
  render();
}

function preparePromptText(text) {
  if (!PromptVault.templateVariables(text).length) return text;
  return PromptVault.fillTemplate(text, (name) => window.prompt(`Value for ${name}`));
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
