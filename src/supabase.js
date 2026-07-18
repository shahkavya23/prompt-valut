(function () {
  const PROJECT_REF = "egxezgbulobcofnonysk";
  const DEFAULT_URL = `https://${PROJECT_REF}.supabase.co`;
  const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_XJLzB7oaI-DGqTjGAda9Bg_6UyfEMQz";
  const CONFIG_KEY = "prompttora.supabase.config";
  const SESSION_KEY = "prompttora.supabase.session";
  const LAST_SYNC_KEY = "prompttora.supabase.lastSyncAt";

  function normalizeConfig(config = {}) {
    return {
      url: String(config.url || DEFAULT_URL).replace(/\/+$/, ""),
      anonKey: String(config.anonKey || DEFAULT_PUBLISHABLE_KEY).trim()
    };
  }

  async function getConfig() {
    const data = await chrome.storage.local.get(CONFIG_KEY);
    return normalizeConfig(data[CONFIG_KEY]);
  }

  async function setConfig(config) {
    const normalized = normalizeConfig(config);
    await chrome.storage.local.set({ [CONFIG_KEY]: normalized });
    return normalized;
  }

  async function getSession() {
    const data = await chrome.storage.local.get(SESSION_KEY);
    const session = data[SESSION_KEY] || null;
    if (!session?.access_token) return null;
    if (session.expires_at && Date.now() > (session.expires_at - 60) * 1000) {
      try {
        return await refreshSession(session.refresh_token);
      } catch {
        await signOut();
        return null;
      }
    }
    return session;
  }

  async function saveSession(session) {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return session;
  }

  async function request(path, options = {}) {
    const config = await getConfig();
    if (!config.anonKey) throw new Error("Add your Supabase anon key first.");
    const session = options.session === false ? null : await getSession();
    const headers = {
      apikey: config.anonKey,
      Authorization: `Bearer ${session?.access_token || config.anonKey}`,
      "Content-Type": "application/json",
      ...options.headers
    };
    const response = await fetch(`${config.url}${path}`, {
      ...options,
      headers
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseError(body) || `${response.status} ${response.statusText}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function parseError(body) {
    try {
      const parsed = JSON.parse(body);
      return parsed.error_description || parsed.msg || parsed.message || parsed.error;
    } catch {
      return body;
    }
  }

  async function signUp(email, password) {
    const session = await request("/auth/v1/signup", {
      method: "POST",
      session: false,
      body: JSON.stringify({ email, password })
    });
    if (session?.access_token) await saveSession(session);
    return session;
  }

  async function signIn(email, password) {
    const session = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      session: false,
      body: JSON.stringify({ email, password })
    });
    await saveSession(session);
    await upsertProfile();
    return session;
  }

  async function refreshSession(refreshToken) {
    if (!refreshToken) throw new Error("Missing refresh token");
    const session = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      session: false,
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    return saveSession(session);
  }

  async function signOut() {
    try {
      await request("/auth/v1/logout", { method: "POST" });
    } catch {}
    await chrome.storage.local.remove(SESSION_KEY);
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  async function upsertProfile() {
    const user = await getUser();
    if (!user) return;
    await request("/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: user.id,
        email: user.email || "",
        updated_at: new Date().toISOString()
      })
    });
  }

  function toRemotePrompt(prompt, user) {
    return {
      id: prompt.id,
      user_id: user.id,
      title: prompt.title || "Untitled prompt",
      text: prompt.text || "",
      refined: prompt.refined || "",
      category: prompt.category || "Other",
      source_url: prompt.sourceUrl || "",
      source_title: prompt.sourceTitle || "",
      use_count: prompt.useCount || 0,
      created_at: prompt.createdAt || new Date().toISOString(),
      updated_at: prompt.updatedAt || new Date().toISOString(),
      deleted_at: prompt.deletedAt || null
    };
  }

  function fromRemotePrompt(row) {
    return {
      id: row.id,
      title: row.title || "Untitled prompt",
      text: row.text || "",
      refined: row.refined || "",
      category: row.category || "Other",
      sourceUrl: row.source_url || "",
      sourceTitle: row.source_title || "",
      screenshotData: "",
      screenshotTakenAt: "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      useCount: row.use_count || 0
    };
  }

  async function pullPrompts() {
    const rows = await request("/rest/v1/prompts?select=*&deleted_at=is.null&order=updated_at.desc&limit=100");
    return (rows || []).map(fromRemotePrompt);
  }

  async function pushPrompt(prompt) {
    const user = await getUser();
    if (!user) return null;
    await request("/rest/v1/prompts?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(toRemotePrompt(prompt, user))
    });
    return true;
  }

  async function deletePrompt(id) {
    await request(`/rest/v1/prompts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function track(eventType, promptId, metadata = {}) {
    const user = await getUser();
    if (!user) return;
    await request("/rest/v1/usage_events", {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        event_type: eventType,
        prompt_id: promptId || null,
        metadata
      })
    });
  }

  async function mergeAndSync(localPrompts) {
    const user = await getUser();
    if (!user) return { prompts: localPrompts, synced: false };
    await upsertProfile();
    const remote = await pullPrompts();
    const byId = new Map();
    [...remote, ...localPrompts].forEach((prompt) => {
      const previous = byId.get(prompt.id);
      if (!previous || new Date(prompt.updatedAt || 0) >= new Date(previous.updatedAt || 0)) {
        byId.set(prompt.id, prompt);
      }
    });
    const merged = Array.from(byId.values())
      .filter((prompt) => !prompt.deletedAt)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, globalThis.PromptVault?.MAX_PROMPTS || 100);
    await Promise.all(merged.map((prompt) => pushPrompt(prompt)));
    await chrome.storage.local.set({ [LAST_SYNC_KEY]: new Date().toISOString() });
    return { prompts: merged, synced: true };
  }

  async function isConfigured() {
    const config = await getConfig();
    return Boolean(config.url && config.anonKey);
  }

  globalThis.PrompttoraSupabase = {
    PROJECT_REF,
    DEFAULT_URL,
    DEFAULT_PUBLISHABLE_KEY,
    CONFIG_KEY,
    SESSION_KEY,
    LAST_SYNC_KEY,
    deletePrompt,
    getConfig,
    getSession,
    getUser,
    isConfigured,
    mergeAndSync,
    pullPrompts,
    pushPrompt,
    refreshSession,
    setConfig,
    signIn,
    signOut,
    signUp,
    track
  };
})();
