const STORAGE_KEY = "holdmese.apiKey";
const FORM_KEY = "holdmese.form";
const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
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
let lastCategory = "mese";
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

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
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

function parseRiddles(raw) {
  const titleMatch = raw.match(/^#{1,3}\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const riddles = [];
  const tagged = [...raw.matchAll(/KERDES:\s*([\s\S]*?)\s*VALASZ:\s*([\s\S]*?)(?=\s*(?:TALALOS\s*\d+|KERDES:)|$)/gi)];
  tagged.forEach((match) => {
    const question = match[1].replace(/\s+/g, " ").trim();
    const answer = match[2].replace(/\s+/g, " ").trim();
    if (question && answer) riddles.push({ question, answer });
  });
  if (riddles.length) return { title, riddles: riddles.slice(0, 3) };

  const fallback = [...raw.matchAll(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s*(.+?)\n+\s*(?:\*\*)?Válasz:?\s*(?:\*\*)?\s*(.+)/gi)];
  fallback.forEach((match) => {
    const question = match[1].replace(/\s+/g, " ").trim();
    const answer = match[2].replace(/\s+/g, " ").trim();
    if (question && answer) riddles.push({ question, answer });
  });
  return { title, riddles: riddles.slice(0, 3) };
}

function renderRiddles(raw) {
  const parsed = parseRiddles(raw);
  if (!parsed.riddles.length) {
    return renderMarkdown(raw).replace(
      /<p>(?:<strong>)?Válasz:?\s*(?:<\/strong>)?\s*(.+?)<\/p>/gi,
      '<details class="answer-reveal"><summary>Mutasd a választ</summary><p class="answer">$1</p></details>',
    );
  }
  const heading = parsed.title ? `<h2>${escapeHtml(parsed.title)}</h2>` : "<h2>Találós kérdések</h2>";
  const cards = parsed.riddles.map((riddle, index) => `
    <article class="riddle">
      <p class="riddle-q"><strong>${index + 1}.</strong> ${inlineFormat(escapeHtml(riddle.question))}</p>
      <details>
        <summary>Mutasd a választ</summary>
        <p class="answer">${inlineFormat(escapeHtml(riddle.answer))}</p>
      </details>
    </article>
  `).join("");
  return heading + cards;
}

function renderContent(raw, category) {
  return category === "talalos" ? renderRiddles(raw) : renderMarkdown(raw);
}

function toSpeechText(raw, category = lastCategory) {
  if (category === "talalos") {
    const parsed = parseRiddles(raw);
    if (parsed.riddles.length) {
      const title = parsed.title ? `${parsed.title}. ` : "";
      return title + parsed.riddles.map((riddle, index) => `${index + 1}. találós. ${riddle.question}`).join(" ");
    }
  }
  return raw
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^\s*(?:TALALOS\s*\d+|KERDES:|VALASZ:).*$/gim, (line) => (
      /^\s*VALASZ:/i.test(line) ? "" : line.replace(/^\s*(?:TALALOS\s*\d+|KERDES:)\s*/i, "")
    ))
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ageGuidance(age) {
  if (age <= 3) return "A gyerek 1-3 éves: nagyon egyszerű, rövid mondatok, ismétlések, ringató ritmus.";
  if (age <= 6) return "A gyerek óvodás (4-6 év): klasszikus mesés nyelvezet, könnyen követhető cselekmény, meleg zárás.";
  if (age <= 9) return "A gyerek kisiskolás (7-9 év): gazdagabb szókincs, enyhe humor, még mindig megnyugtató.";
  return "A gyerek nagyobb (10+ év): kicsit költőibb, okos humorral, de továbbra is gyengéd, esti hangulatú.";
}

function categoryInstruction(category, length) {
  const minutes = length === "medium"
    ? "körülbelül 5 perc felolvasás (kb. 450-650 szó)"
    : "körülbelül 2 perc felolvasás (kb. 180-280 szó)";

  if (category === "mese") {
    return [
      "Kategória: Esti mese.",
      "Írj megnyugtató, altató hangulatú, kedves mesét.",
      "A ritmus legyen lassú, a hangulat meleg, a zárlat békés, hogy a gyerek álomba szenderülhessen.",
      "Kerüld a ijesztő fordulatokat, üldözést, veszélyt.",
      `Terjedelem: ${minutes}.`,
    ].join(" ");
  }
  if (category === "vers") {
    return [
      "Kategória: Rímes vers / Ének.",
      "Írj dallamos, ritmikus, könnyen énekelhető vagy szavalható rímes magyar gyermekverset.",
      "Tiszta rímek, dalos lüktetés, ismétlődő refrén, ha illik.",
      "Olyan legyen, mintha altatódalt vagy játékos mondókát hallanánk.",
      `Terjedelem: ${minutes}.`,
    ].join(" ");
  }
  if (category === "talalos") {
    return [
      "Kategória: Találós kérdések.",
      "Pontosan 3 darab, a korosztálynak megfelelő, játékos találós kérdést írj.",
      "A kérdések legyenek vidámak, nem ijesztőek, és kapcsolódjanak a megadott témához, ha van.",
      "A válaszokat SOHA ne írd a kérdés után olvashatóan. Pontosan ezt a formátumot használd, semmi mást:",
      "Először egy rövid # cím, utána három blokk:",
      "TALALOS 1",
      "KERDES: a találós kérdés teljes szövege",
      "VALASZ: a megoldás egy rövid mondatban",
      "TALALOS 2",
      "KERDES: ...",
      "VALASZ: ...",
      "TALALOS 3",
      "KERDES: ...",
      "VALASZ: ...",
    ].join("\n");
  }
  return [
    "Kategória: Ünnepi / Télapó / Karácsony.",
    "Írj varázslatos, meleg hangulatú mesét a Télapóról vagy a karácsonyi csodákról.",
    "Hó, gyertyafény, ajándék, kedvesség, családi melegség — ijesztő elem nélkül.",
    `Terjedelem: ${minutes}.`,
  ].join(" ");
}

function buildSystemInstruction(input) {
  const theme = input.theme || "csillagok, erdei állatok és egy kis holdfény";
  return [
    "Te egy gyengéd, magyar nyelvű esti mesemondó vagy. Olyan szövegeket írsz, amelyeket szülők felolvashatnak gyerekeknek lefekvés előtt.",
    "Mindig magyarul írj, helyes magyar nyelvtannal és természetes ritmussal.",
    "A tartalom legyen életkornak megfelelő, meleg, megnyugtató. Ijesztő, durva, erőszakos vagy túl izgalmas elemek tilosak.",
    `A gyerek neve: ${input.childName}. Sződd bele természetesen, de ne erőltesd túl.`,
    `Életkor: ${input.childAge} év. ${ageGuidance(input.childAge)}`,
    `Téma / kedvenc hősök: ${theme}.`,
    categoryInstruction(input.category, input.length),
    "Formázd a szöveget tiszta bekezdésekkel. Mese és vers esetén a tetején legyen egy rövid, szép cím (# címsor).",
    "Ne írj előszót, magyarázatot, metadiszclaimert, utószót a szülőnek — csak a kész, felolvasható tartalmat add.",
    "Kerüld a markdown táblázatokat. Dőlt és félkövér jelölés megengedett, találósoknál viszont tartsd a megadott KERDES/VALASZ formátumot.",
  ].join("\n");
}

function buildUserPrompt(input) {
  if (input.category === "talalos") {
    return `Készítsd el most a 3 korosztálynak megfelelő találós kérdést ${input.childName} számára, a megadott formátumban.`;
  }
  if (input.category === "vers") {
    return `Írd meg most a dallamos, rímes verset vagy éneket ${input.childName} számára.`;
  }
  if (input.category === "unnep") {
    return `Írd meg most a varázslatos, meleg hangulatú ünnepi mesét ${input.childName} számára.`;
  }
  return `Írd meg most a megnyugtató, altató esti mesét ${input.childName} számára.`;
}

function showResult(input, text) {
  lastPlainText = text;
  lastCategory = input.category;
  els.resultEmpty.hidden = true;
  els.resultBody.hidden = false;
  els.resultMeta.innerHTML = [
    `<span class="badge">${escapeHtml(input.childName)}</span>`,
    `<span class="badge">${input.childAge} év</span>`,
    `<span class="badge">${escapeHtml(CATEGORY_LABELS[input.category])}</span>`,
    `<span class="badge">${escapeHtml(LENGTH_LABELS[input.length])}</span>`,
  ].join("");
  els.storyOutput.innerHTML = renderContent(text, input.category);
}

function extractErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

function friendlyError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const payload = extractJsonObject(raw);
  const parsed = payload ? extractErrorMessage(payload, raw) : raw;
  if (/api key not valid|invalid api key|api_key_invalid|API_KEY_INVALID/i.test(parsed + raw)) {
    return "A Gemini API kulcs érvénytelen. Ellenőrizd a beállításokban.";
  }
  if (/quota|resource exhausted|rate limit/i.test(parsed)) {
    return "A Gemini API kvótája betelt, vagy túl sok a kérés. Próbáld később.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(parsed)) {
    return "Nem sikerült kapcsolódni a Gemini API-hoz. Ellenőrizd az internetet.";
  }
  return parsed;
}

function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    if (raw[i] === "{") depth += 1;
    else if (raw[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function storyText() {
  return lastPlainText || (els.storyOutput.innerText || "").trim();
}

async function generateWithFetch(apiKey, input) {
  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemInstruction(input) }] },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
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
  return generateWithFetch(apiKey, input);
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
    setHint(friendlyError(error), "error");
  } finally {
    setLoading(false);
  }
}

function pickHungarianVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  hungarianVoice = voices.find((voice) => voice.lang === "hu-HU") || null;
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
  const text = storyText();
  if (!text) return;
  if (speaking) {
    stopSpeech();
    return;
  }
  pickHungarianVoice();
  const utterance = new SpeechSynthesisUtterance(toSpeechText(text, lastCategory));
  utterance.lang = "hu-HU";
  utterance.rate = 0.9;
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
  const text = storyText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
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
