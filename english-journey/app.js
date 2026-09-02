const STORAGE_KEY = "my-english-journey-v1";

const VOCABULARY = [
  { id: "hello", word: "hello", phonetic: "/həˈləʊ/", meaning: "helló, szia", example: "Hello! How are you?", exampleHu: "Szia! Hogy vagy?", icon: "👋", color: "from-sky-50 to-teal-50" },
  { id: "apple", word: "apple", phonetic: "/ˈæp.əl/", meaning: "alma", example: "I eat an apple.", exampleHu: "Eszem egy almát.", icon: "🍏", color: "from-emerald-50 to-lime-50" },
  { id: "cat", word: "cat", phonetic: "/kæt/", meaning: "macska", example: "The cat is cute.", exampleHu: "A macska aranyos.", icon: "🐱", color: "from-orange-50 to-amber-50" },
  { id: "water", word: "water", phonetic: "/ˈwɔː.tə/", meaning: "víz", example: "I drink water.", exampleHu: "Vizet iszom.", icon: "💧", color: "from-sky-50 to-blue-50" },
  { id: "house", word: "house", phonetic: "/haʊs/", meaning: "ház", example: "This is my house.", exampleHu: "Ez az én házam.", icon: "🏠", color: "from-amber-50 to-yellow-50" },
  { id: "book", word: "book", phonetic: "/bʊk/", meaning: "könyv", example: "I read a book.", exampleHu: "Könyvet olvasok.", icon: "📖", color: "from-indigo-50 to-violet-50" },
  { id: "sun", word: "sun", phonetic: "/sʌn/", meaning: "nap", example: "The sun is bright.", exampleHu: "A nap fényes.", icon: "☀️", color: "from-yellow-50 to-orange-50" },
  { id: "friend", word: "friend", phonetic: "/frend/", meaning: "barát", example: "She is my friend.", exampleHu: "Ő a barátom.", icon: "🤝", color: "from-rose-50 to-orange-50" },
  { id: "family", word: "family", phonetic: "/ˈfæm.əl.i/", meaning: "család", example: "I love my family.", exampleHu: "Szeretem a családom.", icon: "👨‍👩‍👧", color: "from-pink-50 to-rose-50" },
  { id: "thank-you", word: "thank you", phonetic: "/θæŋk juː/", meaning: "köszönöm", example: "Thank you very much.", exampleHu: "Nagyon köszönöm.", icon: "🙏", color: "from-teal-50 to-emerald-50" },
  { id: "good-morning", word: "good morning", phonetic: "/ɡʊd ˈmɔː.nɪŋ/", meaning: "jó reggelt", example: "Good morning, Mum!", exampleHu: "Jó reggelt, anya!", icon: "🌅", color: "from-orange-50 to-sky-50" },
  { id: "eat", word: "eat", phonetic: "/iːt/", meaning: "enni", example: "I eat bread.", exampleHu: "Kenyeret eszem.", icon: "🍞", color: "from-amber-50 to-stone-50" },
  { id: "drink", word: "drink", phonetic: "/drɪŋk/", meaning: "inni", example: "I drink tea.", exampleHu: "Teát iszom.", icon: "🍵", color: "from-green-50 to-lime-50" },
  { id: "school", word: "school", phonetic: "/skuːl/", meaning: "iskola", example: "I go to school.", exampleHu: "Iskolába megyek.", icon: "🏫", color: "from-blue-50 to-indigo-50" },
  { id: "dog", word: "dog", phonetic: "/dɒɡ/", meaning: "kutya", example: "The dog is big.", exampleHu: "A kutya nagy.", icon: "🐶", color: "from-yellow-50 to-amber-50" },
  { id: "yes", word: "yes", phonetic: "/jes/", meaning: "igen", example: "Yes, I am happy.", exampleHu: "Igen, boldog vagyok.", icon: "✅", color: "from-emerald-50 to-teal-50" }
];

const WEEKDAYS = ["H", "K", "Sz", "Cs", "P", "Sz", "V"];

const els = {
  subtitle: document.getElementById("header-subtitle"),
  streakCount: document.getElementById("streak-count"),
  todayCount: document.getElementById("today-count"),
  profileBtn: document.getElementById("profile-btn"),
  profileAvatar: document.getElementById("profile-avatar"),
  profileModal: document.getElementById("profile-modal"),
  profileClose: document.getElementById("profile-close"),
  learnerName: document.getElementById("learner-name"),
  saveProfile: document.getElementById("save-profile"),
  cardPosition: document.getElementById("card-position"),
  cardTotal: document.getElementById("card-total"),
  deckProgress: document.getElementById("deck-progress"),
  flashcardStage: document.getElementById("flashcard-stage"),
  deckComplete: document.getElementById("deck-complete"),
  flashcard: document.getElementById("flashcard"),
  cardIcon: document.getElementById("card-icon"),
  cardWord: document.getElementById("card-word"),
  cardPhonetic: document.getElementById("card-phonetic"),
  cardMeaning: document.getElementById("card-meaning"),
  cardExample: document.getElementById("card-example"),
  cardExampleHu: document.getElementById("card-example-hu"),
  speakBtn: document.getElementById("speak-btn"),
  knowBtn: document.getElementById("know-btn"),
  practiceBtn: document.getElementById("practice-btn"),
  restartBtn: document.getElementById("restart-btn"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  knownPercent: document.getElementById("known-percent"),
  progressArc: document.getElementById("progress-arc"),
  weekRow: document.getElementById("week-row"),
  streakCopy: document.getElementById("streak-copy"),
  statKnown: document.getElementById("stat-known"),
  statPractice: document.getElementById("stat-practice"),
  statToday: document.getElementById("stat-today")
};

const tabs = [
  { btn: document.getElementById("tab-flashcards"), panel: document.getElementById("panel-flashcards") },
  { btn: document.getElementById("tab-builder"), panel: document.getElementById("panel-builder") },
  { btn: document.getElementById("tab-chat"), panel: document.getElementById("panel-chat") },
  { btn: document.getElementById("tab-progress"), panel: document.getElementById("panel-progress") }
];

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

function defaultState() {
  return {
    name: "",
    streak: 0,
    lastActiveDate: "",
    todayCount: 0,
    todayDate: todayKey(),
    known: {},
    practicing: {},
    activeDays: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
    if (parsed.todayDate !== todayKey()) {
      parsed.todayCount = 0;
      parsed.todayDate = todayKey();
    }
    if (parsed.lastActiveDate && parsed.lastActiveDate !== todayKey() && parsed.lastActiveDate !== yesterdayKey()) {
      parsed.streak = 0;
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
let deck = [...VOCABULARY];
let index = 0;
let flipped = false;

function currentCard() {
  return deck[index];
}

function speakEnglish(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = 0.86;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => voice.lang.startsWith("en-GB")) ||
    voices.find((voice) => voice.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

function renderCard() {
  const card = currentCard();
  if (!card) {
    els.flashcardStage.classList.add("hidden");
    els.deckComplete.classList.remove("hidden");
    els.cardPosition.textContent = String(deck.length);
    els.deckProgress.style.width = "100%";
    return;
  }

  els.flashcardStage.classList.remove("hidden");
  els.deckComplete.classList.add("hidden");
  flipped = false;
  els.flashcard.classList.remove("is-flipped");
  els.cardIcon.className = `mb-4 grid h-24 w-24 place-items-center rounded-[1.75rem] bg-gradient-to-br ${card.color} text-5xl shadow-inner ring-1 ring-teal-100`;
  els.cardIcon.textContent = card.icon;
  els.cardWord.textContent = card.word;
  els.cardPhonetic.textContent = card.phonetic;
  els.cardMeaning.textContent = card.meaning;
  els.cardExample.textContent = card.example;
  els.cardExampleHu.textContent = card.exampleHu;
  els.cardPosition.textContent = String(index + 1);
  els.cardTotal.textContent = String(deck.length);
  const percent = deck.length ? (index / deck.length) * 100 : 0;
  els.deckProgress.style.width = `${percent}%`;
}

function recordActivity() {
  const today = todayKey();
  if (state.lastActiveDate !== today) {
    state.streak = state.lastActiveDate === yesterdayKey() ? state.streak + 1 : 1;
    state.lastActiveDate = today;
    if (!state.activeDays.includes(today)) state.activeDays.push(today);
    if (state.activeDays.length > 60) state.activeDays = state.activeDays.slice(-60);
  }
  state.todayDate = today;
  state.todayCount += 1;
  saveState();
  renderHeader();
  renderProgress();
}

function markCard(status) {
  const card = currentCard();
  if (!card) return;
  if (status === "known") {
    state.known[card.id] = true;
    delete state.practicing[card.id];
  } else {
    state.practicing[card.id] = true;
    delete state.known[card.id];
  }
  recordActivity();
  index += 1;
  renderCard();
}

function restartDeck() {
  const practicingIds = Object.keys(state.practicing);
  deck = practicingIds.length
    ? VOCABULARY.filter((card) => practicingIds.includes(card.id))
    : [...VOCABULARY];
  if (!deck.length) deck = [...VOCABULARY];
  index = 0;
  renderCard();
}

function greeting() {
  if (state.name) return `Szia, ${state.name}! Folytasd a mai utat.`;
  if (state.todayCount > 0) return "Szép ritmus. Még egy kártya?";
  return "Kezdd a mai mini-leckét.";
}

function renderHeader() {
  els.streakCount.textContent = String(state.streak || 0);
  els.todayCount.textContent = String(state.todayCount || 0);
  els.subtitle.textContent = greeting();
  els.profileAvatar.textContent = state.name ? "🙂" : "🌱";
  els.learnerName.value = state.name;
}

function mondayOfWeek(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function renderProgress() {
  const knownCount = Object.keys(state.known).length;
  const practiceCount = Object.keys(state.practicing).length;
  const percent = Math.round((knownCount / VOCABULARY.length) * 100);
  els.statKnown.textContent = String(knownCount);
  els.statPractice.textContent = String(practiceCount);
  els.statToday.textContent = String(state.todayCount || 0);
  els.knownPercent.textContent = `${percent}%`;
  els.progressArc.setAttribute("stroke-dasharray", `${percent} 100`);
  els.streakCopy.textContent = state.streak
    ? `${state.streak} napos streak. Csak így tovább!`
    : "Még nincs streak. Tanulj ma egyet!";

  const start = mondayOfWeek();
  const today = todayKey();
  els.weekRow.innerHTML = WEEKDAYS.map((label, idx) => {
    const date = new Date(start);
    date.setDate(start.getDate() + idx);
    const key = todayKey(date);
    const active = state.activeDays.includes(key);
    const isToday = key === today;
    return `<div class="flex flex-col items-center gap-1">
      <span class="text-[10px] font-bold text-slate-400">${label}</span>
      <span class="week-dot h-7 w-7 rounded-full ${active ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-400"} ${isToday ? "is-today" : ""} grid place-items-center text-[11px] font-bold">${active ? "✓" : "·"}</span>
    </div>`;
  }).join("");
}

function showTab(targetBtn) {
  tabs.forEach(({ btn, panel }) => {
    const selected = btn === targetBtn;
    panel.hidden = !selected;
    if (selected) {
      btn.setAttribute("aria-current", "page");
      panel.classList.remove("animate-pop");
      void panel.offsetWidth;
      panel.classList.add("animate-pop");
    } else {
      btn.removeAttribute("aria-current");
    }
  });
  if (targetBtn.id === "tab-progress") renderProgress();
}

function openProfile() {
  els.profileModal.classList.remove("hidden");
  els.profileModal.classList.add("flex");
  els.learnerName.focus();
}

function closeProfile() {
  els.profileModal.classList.add("hidden");
  els.profileModal.classList.remove("flex");
}

function saveProfile() {
  state.name = els.learnerName.value.trim().slice(0, 24);
  saveState();
  renderHeader();
  closeProfile();
}

tabs.forEach(({ btn }) => {
  btn.addEventListener("click", () => showTab(btn));
});

function toggleFlip() {
  if (!currentCard()) return;
  flipped = !flipped;
  els.flashcard.classList.toggle("is-flipped", flipped);
}

els.flashcard.addEventListener("click", toggleFlip);
els.flashcard.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleFlip();
  }
});

els.speakBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const card = currentCard();
  if (card) speakEnglish(card.word);
});

els.knowBtn.addEventListener("click", () => markCard("known"));
els.practiceBtn.addEventListener("click", () => markCard("practice"));
els.restartBtn.addEventListener("click", restartDeck);

els.profileBtn.addEventListener("click", openProfile);
els.profileClose.addEventListener("click", closeProfile);
els.saveProfile.addEventListener("click", saveProfile);
els.profileModal.addEventListener("click", (event) => {
  if (event.target === els.profileModal) closeProfile();
});

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = els.chatInput.value.trim();
  if (!value) return;
  els.chatInput.value = "";
  const thread = els.chatForm.previousElementSibling;
  const userRow = document.createElement("div");
  userRow.className = "flex justify-end";
  userRow.innerHTML = `<div class="max-w-[85%] rounded-2xl rounded-tr-md bg-slate-800 px-3.5 py-2.5 text-sm leading-relaxed text-white">${escapeHtml(value)}</div>`;
  const reply = document.createElement("div");
  reply.className = "flex items-start gap-2";
  reply.innerHTML = `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-100 text-lg">🤖</div>
    <div class="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">Nice try! The full AI teacher arrives in the next step. For now, practise a flashcard. 🌿</div>`;
  thread.append(userRow, reply);
  thread.scrollTop = thread.scrollHeight;
});

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {};
}

renderHeader();
renderCard();
renderProgress();
showTab(tabs[0].btn);
