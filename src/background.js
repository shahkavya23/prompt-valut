importScripts("shared.js", "supabase.js");

if (chrome?.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "promptvault-save-selection",
      title: "Save selection to Prompttora",
      contexts: ["selection"]
    });
  });
}

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "start-snap") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const result = await startSnapOnTab(tab.id);
  if (!result.ok) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "PROMPTVAULT_SNAP_FAILED", reason: result.reason || "Shortcut cannot run on this page. Try the popup Snap button." });
    } catch {}
  }
});

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId !== "promptvault-save-selection" || !info.selectionText) return;
  await chrome.tabs.sendMessage(tab.id, {
    type: "PROMPTVAULT_SAVE_TEXT",
    text: info.selectionText
  });
});

chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message.type === "PROMPTVAULT_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "PROMPTVAULT_START_SNAP_TOP") {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, reason: "No active tab found" });
      return false;
    }
    startSnapOnTab(tabId).then(sendResponse);
    return true;
  }

  if (message.type !== "PROMPTVAULT_SAVE_SNAP") return false;
  saveSnapPrompt(message, sender.tab)
    .then(() => {
      if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: "PROMPTVAULT_SNAP_SAVED" }).catch(() => {});
      sendResponse({ ok: true });
    })
    .catch((error) => {
      if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: "PROMPTVAULT_SNAP_FAILED", reason: error.message }).catch(() => {});
      sendResponse({ ok: false, reason: error.message });
    });
  return true;
});

async function startSnapOnTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PROMPTVAULT_START_SNAP" });
    return { ok: true, source: "content" };
  } catch {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/snapper.js"]
    });
    return { ok: true, source: "injected" };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function saveSnapPrompt(message, tab) {
  if (!tab?.windowId) throw new Error("No active tab found");
  const snappedText = normalizeText(message.snappedText);
  let promptText = snappedText;
  if (!promptText) {
    const fullShot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const cropped = await cropDataUrl(fullShot, message.rect, message.dpr || 1);
    promptText = normalizeText(await detectTextFromImage(cropped));
  }
  if (!promptText) {
    throw new Error("No readable text found in snap");
  }
  const promptStorageKey = await PromptVault.getActivePromptStorageKey();
  const data = await chrome.storage.local.get(promptStorageKey);
  const prompts = data[promptStorageKey] || [];
  if (prompts.length >= 100) throw new Error("Prompt limit reached");
  const now = new Date().toISOString();
  const prompt = {
    id: `pv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    title: titleFromPrompt(promptText),
    text: promptText,
    refined: refinePrompt(promptText),
    category: message.category || "Other",
    sourceUrl: message.sourceUrl || tab.url || "",
    sourceTitle: message.sourceTitle || tab.title || "",
    screenshotData: "",
    screenshotTakenAt: "",
    createdAt: now,
    updatedAt: now,
    useCount: 0
  };
  prompts.unshift(prompt);
  await chrome.storage.local.set({ [promptStorageKey]: prompts.slice(0, 100) });
  if (self.PrompttoraSupabase) {
    try {
      await self.PrompttoraSupabase.pushPrompt(prompt);
      await self.PrompttoraSupabase.track("snap_saved", prompt.id, { source_url: prompt.sourceUrl });
    } catch {}
  }
}

async function cropDataUrl(dataUrl, rect, dpr) {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("Snap crop is not supported in this Chrome worker");
  }
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(rect.width * dpr)), Math.max(1, Math.round(rect.height * dpr)));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    Math.round(rect.left * dpr),
    Math.round(rect.top * dpr),
    Math.round(rect.width * dpr),
    Math.round(rect.height * dpr),
    0,
    0,
    canvas.width,
    canvas.height
  );
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.78 });
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}

async function detectTextFromImage(dataUrl) {
  if (typeof TextDetector === "undefined") return "";
  const detector = new TextDetector();
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const results = await detector.detect(image);
  return results.map((item) => item.rawValue || "").join(" ");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleFromPrompt(text) {
  const clean = normalizeText(text);
  if (!clean) return "Snapped prompt";
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

function refinePrompt(text) {
  const clean = normalizeText(text);
  if (!clean) return "";
  return [
    "Act as an expert assistant for this task.",
    clean,
    "Return a clear, structured answer with actionable next steps."
  ].join("\n\n");
}
