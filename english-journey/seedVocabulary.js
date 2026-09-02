/**
 * A0 kezdő szókincs feltöltése a vocabulary_words táblába.
 * Használat (böngésző konzol, bejelentkezés után):
 *   await seedA0Vocabulary()
 */
const A0_VOCABULARY = [
  { english_word: "hello", hungarian_translation: "helló, szia", phonetic: "/həˈləʊ/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Hello! How are you?", example_sentence_hu: "Szia! Hogy vagy?", audio_url: null },
  { english_word: "hi", hungarian_translation: "szia", phonetic: "/haɪ/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Hi, I am Anna.", example_sentence_hu: "Szia, Anna vagyok.", audio_url: null },
  { english_word: "goodbye", hungarian_translation: "viszlát", phonetic: "/ˌɡʊdˈbaɪ/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Goodbye, my friend.", example_sentence_hu: "Viszlát, barátom.", audio_url: null },
  { english_word: "good morning", hungarian_translation: "jó reggelt", phonetic: "/ɡʊd ˈmɔː.nɪŋ/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Good morning, Mum!", example_sentence_hu: "Jó reggelt, anya!", audio_url: null },
  { english_word: "good night", hungarian_translation: "jó éjszakát", phonetic: "/ɡʊd naɪt/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Good night, Dad.", example_sentence_hu: "Jó éjszakát, apa.", audio_url: null },
  { english_word: "please", hungarian_translation: "kérem", phonetic: "/pliːz/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Water, please.", example_sentence_hu: "Vizet, kérem.", audio_url: null },
  { english_word: "thank you", hungarian_translation: "köszönöm", phonetic: "/θæŋk juː/", category: "greetings", difficulty_level: "A0", example_sentence_en: "Thank you very much.", example_sentence_hu: "Nagyon köszönöm.", audio_url: null },
  { english_word: "sorry", hungarian_translation: "bocsánat", phonetic: "/ˈsɒr.i/", category: "greetings", difficulty_level: "A0", example_sentence_en: "I am sorry.", example_sentence_hu: "Bocsánatot kérek.", audio_url: null },
  { english_word: "yes", hungarian_translation: "igen", phonetic: "/jes/", category: "basics", difficulty_level: "A0", example_sentence_en: "Yes, I am happy.", example_sentence_hu: "Igen, boldog vagyok.", audio_url: null },
  { english_word: "no", hungarian_translation: "nem", phonetic: "/nəʊ/", category: "basics", difficulty_level: "A0", example_sentence_en: "No, thank you.", example_sentence_hu: "Nem, köszönöm.", audio_url: null },
  { english_word: "I", hungarian_translation: "én", phonetic: "/aɪ/", category: "people", difficulty_level: "A0", example_sentence_en: "I am a student.", example_sentence_hu: "Diák vagyok.", audio_url: null },
  { english_word: "you", hungarian_translation: "te, ön", phonetic: "/juː/", category: "people", difficulty_level: "A0", example_sentence_en: "You are my friend.", example_sentence_hu: "Te a barátom vagy.", audio_url: null },
  { english_word: "friend", hungarian_translation: "barát", phonetic: "/frend/", category: "people", difficulty_level: "A0", example_sentence_en: "She is my friend.", example_sentence_hu: "Ő a barátom.", audio_url: null },
  { english_word: "family", hungarian_translation: "család", phonetic: "/ˈfæm.əl.i/", category: "people", difficulty_level: "A0", example_sentence_en: "I love my family.", example_sentence_hu: "Szeretem a családom.", audio_url: null },
  { english_word: "mum", hungarian_translation: "anya", phonetic: "/mʌm/", category: "people", difficulty_level: "A0", example_sentence_en: "This is my mum.", example_sentence_hu: "Ez az anyukám.", audio_url: null },
  { english_word: "dad", hungarian_translation: "apa", phonetic: "/dæd/", category: "people", difficulty_level: "A0", example_sentence_en: "This is my dad.", example_sentence_hu: "Ez az apukám.", audio_url: null },
  { english_word: "boy", hungarian_translation: "fiú", phonetic: "/bɔɪ/", category: "people", difficulty_level: "A0", example_sentence_en: "The boy is happy.", example_sentence_hu: "A fiú boldog.", audio_url: null },
  { english_word: "girl", hungarian_translation: "lány", phonetic: "/ɡɜːl/", category: "people", difficulty_level: "A0", example_sentence_en: "The girl is kind.", example_sentence_hu: "A lány kedves.", audio_url: null },
  { english_word: "cat", hungarian_translation: "macska", phonetic: "/kæt/", category: "animals", difficulty_level: "A0", example_sentence_en: "The cat is cute.", example_sentence_hu: "A macska aranyos.", audio_url: null },
  { english_word: "dog", hungarian_translation: "kutya", phonetic: "/dɒɡ/", category: "animals", difficulty_level: "A0", example_sentence_en: "The dog is big.", example_sentence_hu: "A kutya nagy.", audio_url: null },
  { english_word: "apple", hungarian_translation: "alma", phonetic: "/ˈæp.əl/", category: "food", difficulty_level: "A0", example_sentence_en: "I eat an apple.", example_sentence_hu: "Eszem egy almát.", audio_url: null },
  { english_word: "bread", hungarian_translation: "kenyér", phonetic: "/bred/", category: "food", difficulty_level: "A0", example_sentence_en: "I eat bread.", example_sentence_hu: "Kenyeret eszem.", audio_url: null },
  { english_word: "water", hungarian_translation: "víz", phonetic: "/ˈwɔː.tə/", category: "food", difficulty_level: "A0", example_sentence_en: "I drink water.", example_sentence_hu: "Vizet iszom.", audio_url: null },
  { english_word: "tea", hungarian_translation: "tea", phonetic: "/tiː/", category: "food", difficulty_level: "A0", example_sentence_en: "I drink tea.", example_sentence_hu: "Teát iszom.", audio_url: null },
  { english_word: "milk", hungarian_translation: "tej", phonetic: "/mɪlk/", category: "food", difficulty_level: "A0", example_sentence_en: "I drink milk.", example_sentence_hu: "Tejet iszom.", audio_url: null },
  { english_word: "eat", hungarian_translation: "enni", phonetic: "/iːt/", category: "verbs", difficulty_level: "A0", example_sentence_en: "I eat bread.", example_sentence_hu: "Kenyeret eszem.", audio_url: null },
  { english_word: "drink", hungarian_translation: "inni", phonetic: "/drɪŋk/", category: "verbs", difficulty_level: "A0", example_sentence_en: "I drink tea.", example_sentence_hu: "Teát iszom.", audio_url: null },
  { english_word: "house", hungarian_translation: "ház", phonetic: "/haʊs/", category: "home", difficulty_level: "A0", example_sentence_en: "This is my house.", example_sentence_hu: "Ez az én házam.", audio_url: null },
  { english_word: "book", hungarian_translation: "könyv", phonetic: "/bʊk/", category: "school", difficulty_level: "A0", example_sentence_en: "I read a book.", example_sentence_hu: "Könyvet olvasok.", audio_url: null },
  { english_word: "school", hungarian_translation: "iskola", phonetic: "/skuːl/", category: "school", difficulty_level: "A0", example_sentence_en: "I go to school.", example_sentence_hu: "Iskolába megyek.", audio_url: null },
  { english_word: "read", hungarian_translation: "olvasni", phonetic: "/riːd/", category: "verbs", difficulty_level: "A0", example_sentence_en: "I read a book.", example_sentence_hu: "Könyvet olvasok.", audio_url: null },
  { english_word: "go", hungarian_translation: "menni", phonetic: "/ɡəʊ/", category: "verbs", difficulty_level: "A0", example_sentence_en: "I go to school.", example_sentence_hu: "Iskolába megyek.", audio_url: null },
  { english_word: "love", hungarian_translation: "szeretni", phonetic: "/lʌv/", category: "verbs", difficulty_level: "A0", example_sentence_en: "I love my family.", example_sentence_hu: "Szeretem a családom.", audio_url: null },
  { english_word: "sun", hungarian_translation: "nap", phonetic: "/sʌn/", category: "nature", difficulty_level: "A0", example_sentence_en: "The sun is bright.", example_sentence_hu: "A nap fényes.", audio_url: null },
  { english_word: "big", hungarian_translation: "nagy", phonetic: "/bɪɡ/", category: "adjectives", difficulty_level: "A0", example_sentence_en: "The dog is big.", example_sentence_hu: "A kutya nagy.", audio_url: null },
  { english_word: "happy", hungarian_translation: "boldog", phonetic: "/ˈhæp.i/", category: "adjectives", difficulty_level: "A0", example_sentence_en: "I am happy.", example_sentence_hu: "Boldog vagyok.", audio_url: null },
  { english_word: "cute", hungarian_translation: "aranyos", phonetic: "/kjuːt/", category: "adjectives", difficulty_level: "A0", example_sentence_en: "The cat is cute.", example_sentence_hu: "A macska aranyos.", audio_url: null },
  { english_word: "one", hungarian_translation: "egy", phonetic: "/wʌn/", category: "numbers", difficulty_level: "A0", example_sentence_en: "I have one book.", example_sentence_hu: "Egy könyvem van.", audio_url: null },
  { english_word: "two", hungarian_translation: "kettő", phonetic: "/tuː/", category: "numbers", difficulty_level: "A0", example_sentence_en: "I have two cats.", example_sentence_hu: "Két macskám van.", audio_url: null },
  { english_word: "three", hungarian_translation: "három", phonetic: "/θriː/", category: "numbers", difficulty_level: "A0", example_sentence_en: "I see three dogs.", example_sentence_hu: "Három kutyát látok.", audio_url: null },
  { english_word: "red", hungarian_translation: "piros", phonetic: "/red/", category: "colours", difficulty_level: "A0", example_sentence_en: "The apple is red.", example_sentence_hu: "Az alma piros.", audio_url: null },
  { english_word: "blue", hungarian_translation: "kék", phonetic: "/bluː/", category: "colours", difficulty_level: "A0", example_sentence_en: "The book is blue.", example_sentence_hu: "A könyv kék.", audio_url: null }
];

async function seedA0Vocabulary() {
  const db = window.supabaseClient;
  if (!db?.isConfigured()) {
    throw new Error("Supabase nincs beállítva. Töltsd ki a supabaseConfig.js URL-t és anon kulcsot.");
  }

  const user = await db.getUser();
  if (!user) {
    throw new Error("Jelentkezz be a profil lapon, mielőtt feltöltöd a szókincset.");
  }

  const existing = await db.listVocabularyWords({ difficulty_level: "A0" });
  const have = new Set(existing.map((row) => String(row.english_word).toLowerCase()));
  const fresh = A0_VOCABULARY.filter((word) => !have.has(word.english_word.toLowerCase()));

  if (!fresh.length) {
    const result = { inserted: 0, skipped: A0_VOCABULARY.length, total: existing.length };
    console.info("A0 szókincs már bent van.", result);
    return result;
  }

  const inserted = await db.insertVocabularyWords(fresh);
  const result = {
    inserted: inserted.length,
    skipped: A0_VOCABULARY.length - fresh.length,
    total: have.size + inserted.length
  };
  console.info("A0 szókincs feltöltve.", result);
  return result;
}

window.A0_VOCABULARY = A0_VOCABULARY;
window.seedA0Vocabulary = seedA0Vocabulary;
