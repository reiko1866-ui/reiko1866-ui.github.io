/**
 * My English Journey — Supabase client
 * Töltsd ki a URL-t és az anon (publishable) kulcsot a projekt Settings → API oldaláról.
 * Ne nevezd a példányt `supabase`-nak: a CDN UMD build már foglalja ezt a nevet.
 */
const SUPABASE_URL = window.ENGLISH_JOURNEY_SUPABASE?.url || "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = window.ENGLISH_JOURNEY_SUPABASE?.anonKey || "YOUR_ANON_KEY";

function isPlaceholder(url, key) {
  return !url || !key || url.includes("YOUR_PROJECT") || key.includes("YOUR_ANON_KEY");
}

function createEnglishJourneyClient() {
  const sdk = window.supabase;
  if (!sdk?.createClient) {
    console.warn("Supabase SDK nem töltődött be.");
    return null;
  }
  if (isPlaceholder(SUPABASE_URL, SUPABASE_ANON_KEY)) {
    console.info("Supabase nincs beállítva. A tanulás localStorage-ban fut, amíg a URL és az anon kulcs megvan a supabaseClient.js-ben.");
    return null;
  }
  return sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

const client = createEnglishJourneyClient();

async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

const supabaseClient = {
  client,
  url: SUPABASE_URL,

  isConfigured() {
    return Boolean(client);
  },

  async getSession() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session || null;
  },

  async getUser() {
    const session = await this.getSession();
    return session?.user || null;
  },

  onAuthChange(callback) {
    if (!client) return { data: { subscription: { unsubscribe() {} } } };
    return client.auth.onAuthStateChange((_event, session) => {
      callback(session?.user || null, session);
    });
  },

  async signUp(email, password, fullName = "") {
    if (!client) throw new Error("Supabase nincs beállítva.");
    return unwrap(client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    }));
  },

  async signIn(email, password) {
    if (!client) throw new Error("Supabase nincs beállítva.");
    return unwrap(client.auth.signInWithPassword({ email, password }));
  },

  async signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  },

  async ensureProfile(user, extras = {}) {
    if (!client || !user) return null;
    const row = {
      id: user.id,
      email: user.email || extras.email || "",
      full_name: extras.full_name ?? user.user_metadata?.full_name ?? "",
      current_level: extras.current_level || "A0"
    };
    const { data: existing } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (existing) {
      const patch = {};
      if (extras.full_name) patch.full_name = extras.full_name;
      if (extras.streak_count != null) patch.streak_count = extras.streak_count;
      if (extras.last_active_date) patch.last_active_date = extras.last_active_date;
      if (extras.points != null) patch.points = extras.points;
      if (extras.current_level) patch.current_level = extras.current_level;
      if (!Object.keys(patch).length) return existing;
      return unwrap(client.from("profiles").update(patch).eq("id", user.id).select().single());
    }
    return unwrap(client.from("profiles").upsert(row).select().single());
  },

  async getProfile(userId) {
    if (!client || !userId) return null;
    const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listVocabularyWords(filters = {}) {
    if (!client) return [];
    let query = client.from("vocabulary_words").select("*").order("english_word");
    if (filters.difficulty_level) query = query.eq("difficulty_level", filters.difficulty_level);
    if (filters.category) query = query.eq("category", filters.category);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async findWordByEnglish(englishWord) {
    if (!client || !englishWord) return null;
    const { data, error } = await client
      .from("vocabulary_words")
      .select("*")
      .eq("english_word", englishWord)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async insertVocabularyWords(rows) {
    if (!client) throw new Error("Supabase nincs beállítva.");
    if (!rows?.length) return [];
    return unwrap(client.from("vocabulary_words").insert(rows).select());
  },

  async upsertUserVocabulary({ userId, wordId, status, reviewInterval, nextReviewDate, correctDelta = 0, incorrectDelta = 0 }) {
    if (!client || !userId || !wordId) return null;
    const { data: existing } = await client
      .from("user_vocabulary")
      .select("*")
      .eq("user_id", userId)
      .eq("word_id", wordId)
      .maybeSingle();

    if (existing) {
      const patch = {
        status: status || existing.status,
        review_interval: reviewInterval ?? existing.review_interval,
        next_review_date: nextReviewDate || existing.next_review_date,
        correct_count: existing.correct_count + correctDelta,
        incorrect_count: existing.incorrect_count + incorrectDelta
      };
      return unwrap(
        client.from("user_vocabulary").update(patch).eq("id", existing.id).select().single()
      );
    }

    return unwrap(client.from("user_vocabulary").insert({
      user_id: userId,
      word_id: wordId,
      status: status || "learning",
      review_interval: reviewInterval ?? 1,
      next_review_date: nextReviewDate || new Date().toISOString(),
      correct_count: Math.max(0, correctDelta),
      incorrect_count: Math.max(0, incorrectDelta)
    }).select().single());
  },

  async listUserVocabulary(userId) {
    if (!client || !userId) return [];
    const { data, error } = await client
      .from("user_vocabulary")
      .select("*, vocabulary_words(*)")
      .eq("user_id", userId);
    if (error) throw error;
    return data || [];
  },

  async listSentences(level) {
    if (!client) return [];
    let query = client.from("sentences").select("*").order("level");
    if (level != null) query = query.eq("level", level);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async findSentenceByHungarian(hungarianSentence) {
    if (!client || !hungarianSentence) return null;
    const { data, error } = await client
      .from("sentences")
      .select("*")
      .eq("hungarian_sentence", hungarianSentence)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsertSentenceProgress({ userId, sentenceId, isCompleted, attempts }) {
    if (!client || !userId || !sentenceId) return null;
    const { data: existing } = await client
      .from("user_sentence_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("sentence_id", sentenceId)
      .maybeSingle();

    if (existing) {
      return unwrap(client.from("user_sentence_progress").update({
        is_completed: isCompleted ?? existing.is_completed,
        attempts: attempts ?? existing.attempts + 1,
        completed_at: isCompleted ? new Date().toISOString() : existing.completed_at
      }).eq("id", existing.id).select().single());
    }

    return unwrap(client.from("user_sentence_progress").insert({
      user_id: userId,
      sentence_id: sentenceId,
      is_completed: Boolean(isCompleted),
      attempts: attempts ?? 1,
      completed_at: new Date().toISOString()
    }).select().single());
  }
};

window.supabaseClient = supabaseClient;
