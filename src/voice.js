const PromptVault = window.PromptVault;
const PrompttoraSupabase = window.PrompttoraSupabase;
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const transcriptEl = document.getElementById("transcript");
const statusEl = document.getElementById("status");
const noticeEl = document.getElementById("notice");

let recognition = null;
let finalText = "";

startBtn.addEventListener("click", startListening);
stopBtn.addEventListener("click", stopListening);
saveBtn.addEventListener("click", savePrompt);
clearBtn.addEventListener("click", () => {
  finalText = "";
  transcriptEl.value = "";
  notice("");
});

async function startListening() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    notice("Speech recognition is not available in this Chrome build.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    notice("Microphone permission was blocked. Click the page settings icon and allow microphone.");
    return;
  }

  if (recognition) recognition.stop();
  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = true;
  recognition.interimResults = true;
  statusEl.textContent = "Listening";
  notice("Listening...");

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText = PromptVault.normalizeText(`${finalText} ${text}`);
      else interim += text;
    }
    transcriptEl.value = PromptVault.normalizeText(`${finalText} ${interim}`);
  };

  recognition.onerror = (event) => {
    notice(event.error === "not-allowed"
      ? "Microphone permission was blocked. Allow microphone and try again."
      : `Voice stopped: ${event.error || "unknown error"}`);
  };

  recognition.onend = () => {
    recognition = null;
    statusEl.textContent = "Idle";
  };

  recognition.start();
}

function stopListening() {
  if (recognition) recognition.stop();
}

async function savePrompt() {
  const text = PromptVault.normalizeText(transcriptEl.value);
  if (!text) {
    notice("Nothing to save yet.");
    return;
  }
  const promptStorageKey = await PromptVault.getActivePromptStorageKey();
  const data = await chrome.storage.local.get(promptStorageKey);
  const prompts = data[promptStorageKey] || [];
  if (prompts.length >= PromptVault.MAX_PROMPTS) {
    notice("Prompt limit reached. Delete one to save another.");
    return;
  }
  const prompt = PromptVault.buildPrompt({
    title: PromptVault.titleFromPrompt(text),
    text,
    category: PromptVault.inferCategory(text),
    sourceTitle: "Voice prompt"
  });
  prompts.unshift(prompt);
  await chrome.storage.local.set({ [promptStorageKey]: prompts.slice(0, PromptVault.MAX_PROMPTS) });
  try {
    await PrompttoraSupabase.pushPrompt(prompt);
    await PrompttoraSupabase.track("voice_saved", prompt.id);
  } catch {}
  notice("Saved to Prompttora.");
}

function notice(message) {
  noticeEl.textContent = message;
}
