const STORAGE_KEY = "holdmese.apiKey";
const FORM_KEY = "holdmese.form";
const MODEL = "gemini-2.5-flash";
const CATEGORY_LABELS = {
  mese: "Esti mese",
  vers: "Rímes vers / Ének",
  talalos: "Találós kérdések",
  unnep: "Ünnepi / Télapó / Karácsony",
};
const LENGTH_LABELS = {
  short: "Rövid · 2 perc",
  medium: "Közepes · 5 perc",
};

const SYSTEM_INSTRUCTION = `Te egy gyengéd, magyar nyelvű esti mesemondó vagy. Olyan szövegeket írsz, amelyeket szülők felolvashatnak gyerekeknek lefekvés előtt.

Szabályok:
- Mindig magyarul írj, helyes magyar nyelvtannal és természetes ritmussal.
- A tartalom legyen életkornak megfelelő, meleg, megnyugtató. Ijesztő, durva, erőszakos vagy túl izgalmas elemek tilosak.
- A gyerek nevét sződd bele természetesen, ha megadták.
- Formázd a szöveget tiszta bekezdésekkel. A tetején legyen egy rövid, szép cím (# címsor).
- Ne írj előszót, magyarázatot, metadiszclaimert, utószót a szülőnek — csak a kész, felolvasható tartalmat add.
- Kerüld a markdown táblázatokat. Dőlt és félkövér jelölés megengedett.`;

const els = {
  form: document.getElementById("story-form"),
  generateBtn: document.getElementById("generate-btn"),
  btnLabel: document.querySelector(".btn-label"),
  btnLoading: document.querySelector(".btn-loading"),
  hint: document.getElementById("api-hint"),
  resultEmpty: document.getElementById("result-empty"),
  resultBody: document.getElementById("result-body"),
  resultMeta: document.getElementById("result-meta"),
  storyOutput: document.getElementById("story-output"),
  speakBtn: document.getElementById("speak-btn"),
  copyBtn: document.getElementById("copy-btn"),
  regenBtn: document.getElementById("regen-btn"),
  toast: document.getElementById("toast"),
  settingsDialog: document.getElementById("settings-dialog"),
  settingsForm: document.getElementById("settings-form"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  apiKey: document.getElementById("api-key"),
  toggleKey: document.getElementById("toggle-key"),
};

let lastPlainText = "";
let speaking = false;
let hungarianVoice = null;

function getApiKey() {
  return (localStorage.getItem(STORAGE_KEY) || "").trim();
}

function setApiKey(value) {
  const key = value.trim();
  if (key) localStorage.setItem(STORAGE_KEY, key);
  else localStorage.removeItem(STORAGE_KEY);
}

function readForm() {
  const data = new FormData(els.form);
  return {
    childName: String(data.get("childName") || "").trim(),
    childAge: Number(data.get("childAge") || 5),
    category: String(data.get("category") || "mese"),
    theme: String(data.get("theme") || "").trim(),
    length: String(data.get("length") || "short"),
  };
}

function persistForm() {
  localStorage.setItem(FORM_KEY, JSON.stringify(readForm()));
}

function restoreForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) || "null");
    if (!saved) return;
    if (saved.childName) els.form.childName.value = saved.childName;
    if (saved.childAge) els.form.childAge.value = saved.childAge;
    if (saved.theme) els.form.theme.value = saved.theme;
    if (CATEGORY_LABELS[saved.category]) {
      const category = els.form.querySelector(`input[name="category"][value="${saved.category}"]`);
      if (category) category.checked = true;
    }
    if (LENGTH_LABELS[saved.length]) {
      const length = els.form.querySelector(`input[name="length"][value="${saved.length}"]`);
      if (length) length.checked = true;
    }
  } catch {
    /* ignore broken storage */
  }
}

function setHint(message, type = "") {
  els.hint.textContent = message || "";
  els.hint.className = `form-hint${type ? ` ${type}` : ""}`;
}

function showToast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function setLoading(isLoading) {
  els.generateBtn.disabled = isLoading;
  els.regenBtn.disabled = isLoading;
  els.btnLabel.hidden = isLoading;
  els.btnLoading.hidden = !isLoading;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function renderMarkdown(raw) {
  const escaped = escapeHtml(raw.trim());
  const blocks = escaped.split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines.map((line) => `<li>${inlineFormat(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const items = lines.map((line) => `<li>${inlineFormat(line.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("");
      return `<ol>${items}</ol>`;
    }
    const first = lines[0];
    const heading = first.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const rest = lines.slice(1).join("<br>");
      return `<h${level}>${inlineFormat(heading[2])}</h${level}>${rest ? `<p>${inlineFormat(rest)}</p>` : ""}`;
    }
    return `<p>${inlineFormat(lines.join("<br>"))}</p>`;
  }).join("");
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function toSpeechText(raw) {
  return raw
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ageGuidance(age) {
  if (age <= 3) return "Nagyon egyszerű, rövid mondatok, ismétlések, ringató ritmus. Mintha egy 2-3 évesnek mesélnél.";
  if (age <= 6) return "Klasszikus, mesés nyelvezet, könnyen követhető cselekmény, meleg zárás.";
  if (age <= 9) return "Gazdagabb szókincs, enyhe humor, még mindig megnyugtató, nem ijesztő.";
  return "Kicsit költőibb, okos humorral, de továbbra is gyengéd, esti hangulatú.";
}

function categoryGuidance(category, length) {
  const minutes = length === "medium" ? "körülbelül 5 perc felolvasás (kb. 450-650 szó)" : "körülbelül 2 perc felolvasás (kb. 180-280 szó)";
  if (category === "vers") {
    return `Írj rímes, énekelhető, magyar gyermekverset vagy altatódalt. Tiszta rímek, dalos ritmus. Terjedelem: ${minutes}.`;
  }
  if (category === "talalos") {
    const count = length === "medium" ? "8-10" : "5-6";
    return `Írj ${count} játékos, életkornak megfelelő találós kérdést. Minden kérdés után külön sorban add meg a választ így: **Válasz:** ... A hangulat maradjon esti, vidám, nem ijesztő.`;
  }
  if (category === "unnep") {
    return `Írj ünnepi, téli, Télapós vagy karácsonyi hangulatú esti mesét. Csillogás, hó, gyertyafény, kedvesség. Terjedelem: ${minutes}.`;
  }
  return `Írj kerek, megnyugtató esti mesét, békés zárlattal, hogy a gyerek álomba szenderülhessen. Terjedelem: ${minutes}.`;
}

function buildPrompt(input) {
  const theme = input.theme || "csillagok, erdei állatok és egy kis holdfény";
  return [
    `Gyerek neve: ${input.childName}`,
    `Életkor: ${input.childAge} év`,
    `Kategória: ${CATEGORY_LABELS[input.category]}`,
    `Téma / kedvenc hősök: ${theme}`,
    `Terjedelem: ${LENGTH_LABELS[input.length]}`,
    "",
    ageGuidance(input.childAge),
    categoryGuidance(input.category, input.length),
    "A gyerek legyen a történet/vers/játék hőse vagy megszólítottja, de ne erőltesd túl.",
  ].join("\n");
}

function showResult(input, text) {
  lastPlainText = text;
  els.resultEmpty.hidden = true;
  els.resultBody.hidden = false;
  els.resultMeta.innerHTML = [
    `<span class="badge">${escapeHtml(input.childName)}</span>`,
    `<span class="badge">${input.childAge} év</span>`,
    `<span class="badge">${escapeHtml(CATEGORY_LABELS[input.category])}</span>`,
    `<span class="badge">${escapeHtml(LENGTH_LABELS[input.length])}</span>`,
  ].join("");
  els.storyOutput.innerHTML = renderMarkdown(text);
}

function extractErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

async function generateWithSdk(apiKey, prompt) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.95,
      maxOutputTokens: 4096,
    },
  });
  const text = (response.text || "").trim();
  if (!text) throw new Error("A modell üres választ adott.");
  return text;
}

async function generateWithFetch(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.95,
        maxOutputTokens: 4096,
      },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(extractErrorMessage(payload, `A Gemini API hibát jelzett (${res.status}).`));
  }
  const text = (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) {
    const blocked = payload.promptFeedback?.blockReason;
    throw new Error(blocked ? `A kérést a modell biztonsági szűrője blokkolta (${blocked}).` : "A modell üres választ adott.");
  }
  return text;
}

async function generateStory(input) {
  const apiKey = getApiKey();
  if (!apiKey) {
    openSettings();
    throw new Error("Először add meg a Gemini API kulcsot a beállításokban.");
  }
  const prompt = buildPrompt(input);
  try {
    return await generateWithSdk(apiKey, prompt);
  } catch (sdkError) {
    const message = sdkError instanceof Error ? sdkError.message : String(sdkError);
    const sdkMissing = /Failed to fetch|Failed to resolve|Cannot find|import|NetworkError|Load failed|ERR_MODULE/i.test(message)
      || sdkError instanceof TypeError;
    if (!sdkMissing) throw sdkError instanceof Error ? sdkError : new Error(message);
    return generateWithFetch(apiKey, prompt);
  }
}

async function handleGenerate() {
  persistForm();
  const input = readForm();
  if (!input.childName) {
    setHint("Add meg a gyerek nevét.", "error");
    els.form.childName.focus();
    return;
  }
  stopSpeech();
  setLoading(true);
  setHint("A holdfény sző…", "");
  try {
    const text = await generateStory(input);
    showResult(input, text);
    setHint("Kész a mai esti mese.", "ok");
  } catch (error) {
    setHint(error instanceof Error ? error.message : "Nem sikerült a generálás.", "error");
  } finally {
    setLoading(false);
  }
}

function pickHungarianVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  hungarianVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith("hu")) ||
    voices.find((voice) => /hungarian|magyar/i.test(voice.name)) ||
    null;
}

function stopSpeech() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  speaking = false;
  els.speakBtn.classList.remove("speaking");
  els.speakBtn.innerHTML = `<span class="action-icon" aria-hidden="true">🔊</span> Hangos felolvasás`;
}

function toggleSpeech() {
  if (!window.speechSynthesis) {
    showToast("Ez a böngésző nem tud felolvasni.");
    return;
  }
  if (!lastPlainText) return;
  if (speaking) {
    stopSpeech();
    return;
  }
  pickHungarianVoice();
  const utterance = new SpeechSynthesisUtterance(toSpeechText(lastPlainText));
  utterance.lang = "hu-HU";
  utterance.rate = 0.92;
  utterance.pitch = 1.02;
  if (hungarianVoice) utterance.voice = hungarianVoice;
  utterance.onend = () => stopSpeech();
  utterance.onerror = () => stopSpeech();
  speaking = true;
  els.speakBtn.classList.add("speaking");
  els.speakBtn.innerHTML = `<span class="action-icon" aria-hidden="true">⏹</span> Felolvasás leállítása`;
  window.speechSynthesis.speak(utterance);
}

async function copyStory() {
  if (!lastPlainText) return;
  try {
    await navigator.clipboard.writeText(lastPlainText);
    showToast("A szöveg a vágólapra került.");
  } catch {
    showToast("A másolás nem sikerült.");
  }
}

function openSettings() {
  els.apiKey.value = getApiKey();
  els.settingsDialog.showModal();
  els.apiKey.focus();
}

function refreshKeyHint() {
  if (getApiKey()) setHint("Az API kulcs el van mentve ezen az eszközön.", "ok");
  else setHint("A generáláshoz Gemini API kulcs kell. Nyisd meg a beállításokat.", "");
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleGenerate();
});
els.form.addEventListener("change", persistForm);
els.form.addEventListener("input", persistForm);
els.regenBtn.addEventListener("click", handleGenerate);
els.speakBtn.addEventListener("click", toggleSpeech);
els.copyBtn.addEventListener("click", copyStory);
els.openSettings.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", () => els.settingsDialog.close());
els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setApiKey(els.apiKey.value);
  els.settingsDialog.close();
  refreshKeyHint();
  showToast("Beállítások elmentve.");
});
els.toggleKey.addEventListener("click", () => {
  const hidden = els.apiKey.type === "password";
  els.apiKey.type = hidden ? "text" : "password";
  els.toggleKey.textContent = hidden ? "Rejt" : "Mutat";
});

if (window.speechSynthesis) {
  pickHungarianVoice();
  window.speechSynthesis.addEventListener("voiceschanged", pickHungarianVoice);
}

restoreForm();
refreshKeyHint();
