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

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

const SENTENCES = [
  { id: "eat-apple", prompt: "Eszem egy almát.", words: ["I", "eat", "an", "apple"], extras: ["a"], icon: "🍏" },
  { id: "drink-water", prompt: "Vizet iszom.", words: ["I", "drink", "water"], extras: ["a"], icon: "💧" },
  { id: "my-house", prompt: "Ez az én házam.", words: ["This", "is", "my", "house"], extras: [], icon: "🏠" },
  { id: "cute-cat", prompt: "A macska aranyos.", words: ["The", "cat", "is", "cute"], extras: ["a"], icon: "🐱" },
  { id: "go-school", prompt: "Iskolába megyek.", words: ["I", "go", "to", "school"], extras: ["the"], icon: "🏫" },
  { id: "my-friend", prompt: "Ő a barátom.", words: ["She", "is", "my", "friend"], extras: ["He"], icon: "🤝" },
  { id: "love-family", prompt: "Szeretem a családom.", words: ["I", "love", "my", "family"], extras: [], icon: "👨‍👩‍👧" },
  { id: "big-dog", prompt: "A kutya nagy.", words: ["The", "dog", "is", "big"], extras: ["small"], icon: "🐶" },
  { id: "read-book", prompt: "Könyvet olvasok.", words: ["I", "read", "a", "book"], extras: ["an"], icon: "📖" },
  { id: "thank-you", prompt: "Nagyon köszönöm.", words: ["Thank", "you", "very", "much"], extras: [], icon: "🙏" },
  { id: "bright-sun", prompt: "A nap fényes.", words: ["The", "sun", "is", "bright"], extras: [], icon: "☀️" },
  { id: "drink-tea", prompt: "Teát iszom.", words: ["I", "drink", "tea"], extras: ["coffee"], icon: "🍵" }
];

const els = {
  subtitle: document.getElementById("header-subtitle"),
  streakCount: document.getElementById("streak-count"),
  todayCount: document.getElementById("today-count"),
  profileBtn: document.getElementById("profile-btn"),
  profileAvatar: document.getElementById("profile-avatar"),
  profileModal: document.getElementById("profile-modal"),
  profileClose: document.getElementById("profile-close"),
  learnerName: document.getElementById("learner-name"),
  learnerEmail: document.getElementById("learner-email"),
  learnerPassword: document.getElementById("learner-password"),
  saveProfile: document.getElementById("save-profile"),
  authStatus: document.getElementById("auth-status"),
  authFields: document.getElementById("auth-fields"),
  authPrimary: document.getElementById("auth-primary"),
  authRegister: document.getElementById("auth-register"),
  authSignout: document.getElementById("auth-signout"),
  profileLevel: document.getElementById("profile-level"),
  profilePoints: document.getElementById("profile-points"),
  profileHint: document.getElementById("profile-hint"),
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
  chatThread: document.getElementById("chat-thread"),
  chatSuggestions: document.getElementById("chat-suggestions"),
  knownPercent: document.getElementById("known-percent"),
  progressArc: document.getElementById("progress-arc"),
  weekRow: document.getElementById("week-row"),
  streakCopy: document.getElementById("streak-copy"),
  statKnown: document.getElementById("stat-known"),
  statPractice: document.getElementById("stat-practice"),
  statSentences: document.getElementById("stat-sentences"),
  statToday: document.getElementById("stat-today"),
  builderPosition: document.getElementById("builder-position"),
  builderTotal: document.getElementById("builder-total"),
  builderProgress: document.getElementById("builder-progress"),
  builderStage: document.getElementById("builder-stage"),
  builderComplete: document.getElementById("builder-complete"),
  builderCard: document.getElementById("builder-card"),
  builderIcon: document.getElementById("builder-icon"),
  builderPrompt: document.getElementById("builder-prompt"),
  builderSentence: document.getElementById("builder-sentence"),
  builderBank: document.getElementById("builder-bank"),
  builderFeedback: document.getElementById("builder-feedback"),
  builderCheck: document.getElementById("builder-check"),
  builderClear: document.getElementById("builder-clear"),
  builderSpeak: document.getElementById("builder-speak"),
  builderNext: document.getElementById("builder-next"),
  builderRestart: document.getElementById("builder-restart")
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
    solvedSentences: {},
    activeDays: [],
    points: 0,
    email: "",
    currentLevel: "A0"
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
    if (!parsed.solvedSentences || typeof parsed.solvedSentences !== "object") {
      parsed.solvedSentences = {};
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
let remoteUser = null;
let deck = [...VOCABULARY];
let index = 0;
let flipped = false;
let builderIndex = 0;
let builderTiles = [];
let selectedIds = [];
let builderLocked = false;
let wrongTries = 0;

function db() {
  return window.supabaseClient;
}

function dbReady() {
  return Boolean(db()?.isConfigured());
}

async function syncQuiet(task) {
  try {
    await task();
  } catch (error) {
    console.warn("Supabase szinkron hiba:", error.message || error);
  }
}

function nextReviewDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function syncProfileToCloud() {
  if (!dbReady() || !remoteUser) return;
  await db().ensureProfile(remoteUser, {
    full_name: state.name,
    email: remoteUser.email,
    streak_count: state.streak,
    last_active_date: state.lastActiveDate || null,
    points: state.points || 0,
    current_level: state.currentLevel || "A0"
  });
}

async function syncWordToCloud(card, known) {
  if (!dbReady() || !remoteUser || !card) return;
  const row = await db().findWordByEnglish(card.word);
  if (!row) return;
  const interval = known ? Math.max(3, 1) : 1;
  await db().upsertUserVocabulary({
    userId: remoteUser.id,
    wordId: row.id,
    status: known ? "known" : "learning",
    reviewInterval: known ? 3 : 1,
    nextReviewDate: nextReviewDate(interval),
    correctDelta: known ? 1 : 0,
    incorrectDelta: known ? 0 : 1
  });
}

async function syncSentenceToCloud(sentence, completed, attempts) {
  if (!dbReady() || !remoteUser || !sentence) return;
  const row = await db().findSentenceByHungarian(sentence.prompt);
  if (!row) return;
  await db().upsertSentenceProgress({
    userId: remoteUser.id,
    sentenceId: row.id,
    isCompleted: completed,
    attempts
  });
}

async function applyCloudProfile(user) {
  remoteUser = user;
  if (!user) {
    renderAuth();
    return;
  }
  const profile = await db().getProfile(user.id);
  if (profile) {
    if (profile.full_name) state.name = profile.full_name;
    if (profile.streak_count != null) state.streak = profile.streak_count;
    if (profile.last_active_date) state.lastActiveDate = profile.last_active_date;
    if (profile.points != null) state.points = profile.points;
    if (profile.current_level) state.currentLevel = profile.current_level;
    if (profile.email) state.email = profile.email;
    saveState();
  } else {
    await db().ensureProfile(user, { full_name: state.name });
  }
  renderHeader();
  renderProgress();
  renderAuth();
}

async function initSupabase() {
  renderAuth();
  if (!dbReady()) return;
  const user = await db().getUser();
  await applyCloudProfile(user);
  db().onAuthChange((nextUser) => {
    syncQuiet(() => applyCloudProfile(nextUser));
  });
}

function currentCard() {
  return deck[index];
}

function speakEnglish(text, button) {
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
  if (button) {
    button.classList.add("is-speaking");
    const clear = () => button.classList.remove("is-speaking");
    utterance.addEventListener("end", clear, { once: true });
    utterance.addEventListener("error", clear, { once: true });
    setTimeout(clear, 2500);
  }
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

function recordActivity(points) {
  const today = todayKey();
  if (state.lastActiveDate !== today) {
    state.streak = state.lastActiveDate === yesterdayKey() ? state.streak + 1 : 1;
    state.lastActiveDate = today;
    if (!state.activeDays.includes(today)) state.activeDays.push(today);
    if (state.activeDays.length > 60) state.activeDays = state.activeDays.slice(-60);
  }
  state.todayDate = today;
  state.todayCount += 1;
  state.points = (state.points || 0) + (points || 5);
  saveState();
  renderHeader();
  renderProgress();
  syncQuiet(syncProfileToCloud);
}

function markCard(status) {
  const card = currentCard();
  if (!card) return;
  const known = status === "known";
  if (known) {
    state.known[card.id] = true;
    delete state.practicing[card.id];
  } else {
    state.practicing[card.id] = true;
    delete state.known[card.id];
  }
  recordActivity(known ? 10 : 4);
  syncQuiet(() => syncWordToCloud(card, known));
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

function currentSentence() {
  return SENTENCES[builderIndex];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function setupBuilderTiles(sentence) {
  const pool = [...sentence.words, ...(sentence.extras || [])];
  let tiles = pool.map((word, idx) => ({ id: `${sentence.id}-${idx}-${word}`, word }));
  tiles = shuffle(tiles);
  const original = pool.join(" ");
  if (tiles.map((tile) => tile.word).join(" ") === original && tiles.length > 1) {
    tiles = shuffle(tiles);
  }
  return tiles;
}

function selectedWords() {
  return selectedIds
    .map((id) => builderTiles.find((tile) => tile.id === id)?.word)
    .filter(Boolean);
}

function expectedText(sentence = currentSentence()) {
  return sentence ? sentence.words.join(" ") : "";
}

function renderBuilderChips() {
  const sentence = currentSentence();
  if (!sentence) return;

  const selectedSet = new Set(selectedIds);
  if (!selectedIds.length) {
    els.builderSentence.innerHTML = `<p class="self-center text-sm font-medium text-slate-400">Koppints a szavakra a helyes sorrendben.</p>`;
  } else {
    els.builderSentence.innerHTML = selectedIds.map((id) => {
      const tile = builderTiles.find((item) => item.id === id);
      if (!tile) return "";
      const chipClass = builderLocked ? "word-chip is-correct" : "word-chip is-selected";
      return `<button type="button" class="${chipClass}" data-place="sentence" data-id="${tile.id}" ${builderLocked ? "disabled" : ""}>${escapeHtml(tile.word)}</button>`;
    }).join("");
  }

  const remaining = builderTiles.filter((tile) => !selectedSet.has(tile.id));
  els.builderBank.innerHTML = remaining.length
    ? remaining.map((tile) => `<button type="button" class="word-chip is-bank" data-place="bank" data-id="${tile.id}" ${builderLocked ? "disabled" : ""}>${escapeHtml(tile.word)}</button>`).join("")
    : `<p class="text-sm font-medium text-slate-400">Minden szó a mondatban van.</p>`;

  const complete = selectedIds.length >= sentence.words.length;
  els.builderCheck.disabled = builderLocked || !complete;
  els.builderClear.disabled = builderLocked || !selectedIds.length;
  els.builderSpeak.disabled = !builderLocked;
  els.builderNext.disabled = !builderLocked;
}

function renderBuilder() {
  const sentence = currentSentence();
  if (!sentence) {
    els.builderStage.classList.add("hidden");
    els.builderComplete.classList.remove("hidden");
    els.builderPosition.textContent = String(SENTENCES.length);
    els.builderProgress.style.width = "100%";
    return;
  }

  els.builderStage.classList.remove("hidden");
  els.builderComplete.classList.add("hidden");
  els.builderIcon.textContent = sentence.icon;
  els.builderPrompt.textContent = sentence.prompt;
  els.builderPosition.textContent = String(builderIndex + 1);
  els.builderTotal.textContent = String(SENTENCES.length);
  els.builderProgress.style.width = `${(builderIndex / SENTENCES.length) * 100}%`;
  els.builderFeedback.textContent = "";
  els.builderFeedback.className = "mt-4 min-h-[1.25rem] text-sm font-semibold";
  els.builderCard.classList.remove("shake-x", "ring-emerald-200");
  renderBuilderChips();
}

function startSentence() {
  const sentence = currentSentence();
  if (!sentence) {
    renderBuilder();
    return;
  }
  builderTiles = setupBuilderTiles(sentence);
  selectedIds = [];
  builderLocked = false;
  wrongTries = 0;
  renderBuilder();
}

function pickTile(id) {
  if (builderLocked || selectedIds.includes(id)) return;
  selectedIds.push(id);
  renderBuilderChips();
}

function returnTile(id) {
  if (builderLocked) return;
  selectedIds = selectedIds.filter((item) => item !== id);
  els.builderFeedback.textContent = "";
  renderBuilderChips();
}

function clearBuilder() {
  if (builderLocked) return;
  selectedIds = [];
  els.builderFeedback.textContent = "";
  renderBuilderChips();
}

function checkBuilder() {
  const sentence = currentSentence();
  if (!sentence || builderLocked) return;
  const answer = selectedWords().join(" ");
  if (answer === expectedText(sentence)) {
    builderLocked = true;
    state.solvedSentences[sentence.id] = true;
    recordActivity(15);
    syncQuiet(() => syncSentenceToCloud(sentence, true, wrongTries + 1));
    els.builderFeedback.textContent = "Ügyes! Ez a helyes szórend.";
    els.builderFeedback.className = "mt-4 min-h-[1.25rem] text-sm font-semibold text-emerald-700";
    els.builderProgress.style.width = `${((builderIndex + 1) / SENTENCES.length) * 100}%`;
    renderBuilderChips();
    speakEnglish(`${expectedText(sentence)}.`);
    return;
  }

  wrongTries += 1;
  els.builderCard.classList.remove("shake-x");
  void els.builderCard.offsetWidth;
  els.builderCard.classList.add("shake-x");
  const grammar = sentence.grammarTip ? ` ${sentence.grammarTip}` : "";
  const hint = wrongTries >= 2 ? ` Tipp: „${sentence.words[0]}” a kezdet.${grammar}` : "";
  els.builderFeedback.textContent = `Még nem jó. Próbáld más sorrendben.${hint}`;
  els.builderFeedback.className = "mt-4 min-h-[1.25rem] text-sm font-semibold text-amber-700";
  syncQuiet(() => syncSentenceToCloud(sentence, false, wrongTries));
}

function nextSentence() {
  if (!builderLocked) return;
  builderIndex += 1;
  startSentence();
}

function restartBuilder() {
  builderIndex = 0;
  startSentence();
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
  els.profileAvatar.textContent = remoteUser ? "🙂" : state.name ? "🙂" : "🌱";
  els.learnerName.value = state.name;
  if (els.learnerEmail && !els.learnerEmail.value) els.learnerEmail.value = state.email || remoteUser?.email || "";
  if (els.profileLevel) els.profileLevel.textContent = `${state.currentLevel || "A0"} – A1 kezdő`;
  if (els.profilePoints) els.profilePoints.textContent = `${state.points || 0} pont`;
}

function renderAuth() {
  if (!els.authStatus) return;
  const configured = dbReady();
  if (!configured) {
    els.authStatus.textContent = "Helyi mód — állítsd be a Supabase URL-t a supabaseConfig.js-ben.";
    if (els.authPrimary) els.authPrimary.disabled = true;
    if (els.authRegister) els.authRegister.disabled = true;
    if (els.authSignout) els.authSignout.classList.add("hidden");
    return;
  }
  if (remoteUser) {
    els.authStatus.textContent = `Bejelentkezve: ${remoteUser.email}`;
    if (els.authFields) els.authFields.classList.add("hidden");
    if (els.authPrimary) els.authPrimary.classList.add("hidden");
    if (els.authRegister) els.authRegister.classList.add("hidden");
    if (els.authSignout) els.authSignout.classList.remove("hidden");
  } else {
    els.authStatus.textContent = "Supabase kész. Jelentkezz be a felhős mentéshez.";
    if (els.authFields) els.authFields.classList.remove("hidden");
    if (els.authPrimary) {
      els.authPrimary.disabled = false;
      els.authPrimary.classList.remove("hidden");
    }
    if (els.authRegister) {
      els.authRegister.disabled = false;
      els.authRegister.classList.remove("hidden");
    }
    if (els.authSignout) els.authSignout.classList.add("hidden");
  }
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
  const sentenceCount = Object.keys(state.solvedSentences || {}).length;
  els.statKnown.textContent = String(knownCount);
  els.statPractice.textContent = String(practiceCount);
  els.statSentences.textContent = String(sentenceCount);
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
  if (targetBtn.id === "tab-builder") renderBuilderChips();
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
  if (els.learnerEmail) state.email = els.learnerEmail.value.trim();
  saveState();
  renderHeader();
  syncQuiet(syncProfileToCloud);
  closeProfile();
}

async function handleSignIn() {
  const email = els.learnerEmail?.value.trim();
  const password = els.learnerPassword?.value || "";
  if (!email || password.length < 6) {
    els.authStatus.textContent = "Adj meg emailt és legalább 6 karakteres jelszót.";
    return;
  }
  try {
    els.authStatus.textContent = "Belépés…";
    await db().signIn(email, password);
  } catch (error) {
    els.authStatus.textContent = error.message || "Belépés sikertelen.";
  }
}

async function handleRegister() {
  const email = els.learnerEmail?.value.trim();
  const password = els.learnerPassword?.value || "";
  const fullName = els.learnerName.value.trim();
  if (!email || password.length < 6) {
    els.authStatus.textContent = "Adj meg emailt és legalább 6 karakteres jelszót.";
    return;
  }
  try {
    els.authStatus.textContent = "Regisztráció…";
    await db().signUp(email, password, fullName);
    els.authStatus.textContent = "Sikeres. Ha kell, erősítsd meg az emailed.";
  } catch (error) {
    els.authStatus.textContent = error.message || "Regisztráció sikertelen.";
  }
}

async function handleSignOut() {
  try {
    await db().signOut();
    remoteUser = null;
    renderAuth();
    renderHeader();
  } catch (error) {
    els.authStatus.textContent = error.message || "Kilépés sikertelen.";
  }
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
  if (card) speakEnglish(card.word, els.speakBtn);
});

els.knowBtn.addEventListener("click", () => markCard("known"));
els.practiceBtn.addEventListener("click", () => markCard("practice"));
els.restartBtn.addEventListener("click", restartDeck);

els.builderBank.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  pickTile(button.dataset.id);
});

els.builderSentence.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  returnTile(button.dataset.id);
});

els.builderCheck.addEventListener("click", checkBuilder);
els.builderClear.addEventListener("click", clearBuilder);
els.builderSpeak.addEventListener("click", () => {
  const sentence = currentSentence();
  if (sentence && builderLocked) speakEnglish(`${expectedText(sentence)}.`);
});
els.builderNext.addEventListener("click", nextSentence);
els.builderRestart.addEventListener("click", restartBuilder);

els.profileBtn.addEventListener("click", openProfile);
els.profileClose.addEventListener("click", closeProfile);
els.saveProfile.addEventListener("click", saveProfile);
els.authPrimary?.addEventListener("click", () => syncQuiet(handleSignIn));
els.authRegister?.addEventListener("click", () => syncQuiet(handleRegister));
els.authSignout?.addEventListener("click", () => syncQuiet(handleSignOut));
els.profileModal.addEventListener("click", (event) => {
  if (event.target === els.profileModal) closeProfile();
});

function beginnerReply(value) {
  const text = value.toLowerCase();
  if (text.includes("hello") || text.includes("hi")) return "Hello! I am Miss Willow. How are you?";
  if (text.includes("how are you")) return "I am happy, thank you. Are you happy?";
  if (text.includes("happy")) return "Great! Happy is a good word. Can you say: I am happy.";
  if (text.includes("thank")) return "You are welcome. Let’s try: I eat an apple.";
  return "Nice try! Keep it short. Try: Hello! or I am happy.";
}

function appendChat(value) {
  const thread = els.chatThread || document.getElementById("chat-thread");
  if (!thread) return;
  const userRow = document.createElement("div");
  userRow.className = "flex justify-end";
  userRow.innerHTML = `<div class="max-w-[85%] rounded-2xl rounded-tr-md bg-slate-800 px-3.5 py-2.5 text-sm leading-relaxed text-white">${escapeHtml(value)}</div>`;
  const reply = document.createElement("div");
  reply.className = "flex items-start gap-2";
  reply.innerHTML = `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-100 text-lg">🤖</div>
    <div class="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">${escapeHtml(beginnerReply(value))}</div>`;
  thread.append(userRow, reply);
  thread.scrollTop = thread.scrollHeight;
}

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = els.chatInput.value.trim();
  if (!value) return;
  els.chatInput.value = "";
  appendChat(value);
});

els.chatSuggestions?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-chat]");
  if (!chip) return;
  appendChat(chip.dataset.chat);
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
startSentence();
renderProgress();
showTab(tabs[0].btn);
syncQuiet(initSupabase);
