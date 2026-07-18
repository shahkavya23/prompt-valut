(function () {
  const MAX_PROMPTS = 100;
  const DEFAULT_CATEGORIES = ["Coding", "Study", "Writing", "Research", "Design", "Other"];
  const STORAGE_KEY = "promptvault.prompts";
  const ACTIVE_STORAGE_KEY = "prompttora.activePromptStorageKey";

  const CATEGORY_KEYWORDS = {
    Coding: ["code", "bug", "debug", "api", "component", "react", "python", "javascript", "typescript", "sql", "repo", "test", "error", "function"],
    Study: ["study", "explain", "learn", "quiz", "notes", "chapter", "exam", "summarize", "concept", "flashcard", "teacher"],
    Writing: ["write", "rewrite", "caption", "email", "blog", "story", "copy", "tone", "grammar", "linkedin"],
    Research: ["research", "compare", "source", "cite", "market", "analysis", "paper", "evidence"],
    Design: ["design", "ui", "ux", "layout", "color", "brand", "figma", "wireframe", "landing"]
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId() {
    return `pv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function titleFromPrompt(text) {
    const clean = normalizeText(text);
    if (!clean) return "Untitled prompt";
    return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
  }

  function inferCategory(text) {
    const lower = normalizeText(text).toLowerCase();
    let best = { category: "Other", score: 0 };
    for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = words.reduce((count, word) => count + (lower.includes(word) ? 1 : 0), 0);
      if (score > best.score) best = { category, score };
    }
    return best.category;
  }

  function refinePrompt(text) {
    const clean = normalizeText(text);
    if (!clean) return "";
    const hasRole = /\b(act as|you are|pretend|role)\b/i.test(clean);
    const hasOutput = /\b(format|output|return|table|json|bullet|steps)\b/i.test(clean);
    const hasContext = /\b(context|given|for|based on|using)\b/i.test(clean);
    const lines = [];
    if (!hasRole) lines.push("Act as an expert assistant for this task.");
    if (!hasContext) lines.push("Use the context I provide and ask clarifying questions only if required.");
    lines.push(clean);
    if (!hasOutput) lines.push("Return a clear, structured answer with actionable next steps.");
    lines.push("Keep the response concise, accurate, and practical.");
    return lines.join("\n\n");
  }

  function similarityScore(query, prompt) {
    const q = new Set(normalizeText(query).toLowerCase().split(/\W+/).filter(Boolean));
    const p = new Set(normalizeText(`${prompt.title} ${prompt.text} ${prompt.category}`).toLowerCase().split(/\W+/).filter(Boolean));
    if (!q.size || !p.size) return 0;
    let hits = 0;
    q.forEach((word) => {
      if (p.has(word)) hits += 1;
    });
    return hits / Math.sqrt(q.size * p.size);
  }

  function looksLikePrompt(text) {
    const clean = normalizeText(text);
    if (clean.length < 35 || clean.length > 1800) return false;
    const lower = clean.toLowerCase();
    const cueCount = [
      "write", "create", "generate", "explain", "summarize", "act as", "you are", "make", "build",
      "analyze", "improve", "rewrite", "debug", "prompt", "give me", "help me"
    ].filter((cue) => lower.includes(cue)).length;
    return cueCount > 0 || clean.endsWith("?") || clean.includes(":");
  }

  function buildPrompt(data) {
    const text = normalizeText(data.text);
    const refined = normalizeText(data.refined || refinePrompt(text));
    const category = data.category || inferCategory(text);
    const createdAt = data.createdAt || nowIso();
    return {
      id: data.id || makeId(),
      title: normalizeText(data.title) || titleFromPrompt(text),
      text,
      refined,
      category,
      sourceUrl: data.sourceUrl || "",
      sourceTitle: data.sourceTitle || "",
      screenshotData: data.screenshotData || "",
      screenshotTakenAt: data.screenshotTakenAt || "",
      createdAt,
      updatedAt: nowIso(),
      useCount: data.useCount || 0
    };
  }

  function templateVariables(text) {
    const matches = normalizeText(text).match(/\{\{\s*[\w -]+\s*\}\}/g) || [];
    return Array.from(new Set(matches.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean)));
  }

  function fillTemplate(text, ask) {
    let output = String(text || "");
    templateVariables(output).forEach((name) => {
      const value = ask(name);
      if (value == null) return;
      output = output.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, "g"), value);
    });
    return output;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function storageKeyForUser(userId) {
    return userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
  }

  async function getActivePromptStorageKey() {
    try {
      const data = await chrome.storage.local.get(ACTIVE_STORAGE_KEY);
      return data[ACTIVE_STORAGE_KEY] || STORAGE_KEY;
    } catch {
      return STORAGE_KEY;
    }
  }

  async function setActivePromptStorageKey(userId) {
    const key = storageKeyForUser(userId);
    try {
      await chrome.storage.local.set({ [ACTIVE_STORAGE_KEY]: key });
    } catch {}
    return key;
  }

  globalThis.PromptVault = {
    MAX_PROMPTS,
    DEFAULT_CATEGORIES,
    ACTIVE_STORAGE_KEY,
    STORAGE_KEY,
    buildPrompt,
    fillTemplate,
    getActivePromptStorageKey,
    inferCategory,
    looksLikePrompt,
    normalizeText,
    refinePrompt,
    setActivePromptStorageKey,
    similarityScore,
    storageKeyForUser,
    titleFromPrompt,
    templateVariables
  };
})();
