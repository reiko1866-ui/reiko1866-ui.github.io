-- My English Journey — Supabase / Postgres séma
-- Futtasd a Supabase SQL Editorben (Authentication már legyen bekapcsolva).

-- 1. Profilok tábla
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  streak_count INT DEFAULT 0,
  last_active_date DATE,
  current_level TEXT DEFAULT 'A0',
  points INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Szókincs törzsatábla
CREATE TABLE IF NOT EXISTS public.vocabulary_words (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  english_word TEXT NOT NULL,
  hungarian_translation TEXT NOT NULL,
  phonetic TEXT,
  category TEXT NOT NULL,
  difficulty_level TEXT DEFAULT 'A0',
  example_sentence_en TEXT,
  example_sentence_hu TEXT,
  audio_url TEXT
);

-- 3. Felhasználói szókincs & SRS
CREATE TABLE IF NOT EXISTS public.user_vocabulary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  word_id UUID REFERENCES public.vocabulary_words(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'learning',
  review_interval INT DEFAULT 1,
  next_review_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  correct_count INT DEFAULT 0,
  incorrect_count INT DEFAULT 0,
  UNIQUE(user_id, word_id)
);

-- 4. Mondatépítő törzstábla
CREATE TABLE IF NOT EXISTS public.sentences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  level INT NOT NULL,
  hungarian_sentence TEXT NOT NULL,
  correct_order JSONB NOT NULL,
  distractor_words JSONB DEFAULT '[]'::jsonb,
  grammar_tip_hu TEXT
);

-- 5. Mondatépítő haladás
CREATE TABLE IF NOT EXISTS public.user_sentence_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  sentence_id UUID REFERENCES public.sentences(id) ON DELETE CASCADE,
  is_completed BOOLEAN DEFAULT FALSE,
  attempts INT DEFAULT 1,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, sentence_id)
);

CREATE INDEX IF NOT EXISTS vocabulary_words_category_idx
  ON public.vocabulary_words (category, difficulty_level);

CREATE INDEX IF NOT EXISTS user_vocabulary_review_idx
  ON public.user_vocabulary (user_id, next_review_date);

CREATE INDEX IF NOT EXISTS user_vocabulary_word_idx
  ON public.user_vocabulary (word_id);

CREATE INDEX IF NOT EXISTS sentences_level_idx
  ON public.sentences (level);

CREATE INDEX IF NOT EXISTS user_sentence_progress_user_idx
  ON public.user_sentence_progress (user_id, is_completed);

-- Új Auth user → automatikus profil
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sentence_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "vocabulary_words_read" ON public.vocabulary_words;
CREATE POLICY "vocabulary_words_read"
  ON public.vocabulary_words FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "vocabulary_words_insert_authenticated" ON public.vocabulary_words;
CREATE POLICY "vocabulary_words_insert_authenticated"
  ON public.vocabulary_words FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "sentences_read" ON public.sentences;
CREATE POLICY "sentences_read"
  ON public.sentences FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "user_vocabulary_own" ON public.user_vocabulary;
CREATE POLICY "user_vocabulary_own"
  ON public.user_vocabulary FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_sentence_progress_own" ON public.user_sentence_progress;
CREATE POLICY "user_sentence_progress_own"
  ON public.user_sentence_progress FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
