-- My English Journey — A0 kezdő szókincs
-- Futtasd a schema.sql után a Supabase SQL Editorben.

INSERT INTO public.vocabulary_words (
  english_word,
  hungarian_translation,
  phonetic,
  category,
  difficulty_level,
  example_sentence_en,
  example_sentence_hu,
  audio_url
)
SELECT
  v.english_word,
  v.hungarian_translation,
  v.phonetic,
  v.category,
  v.difficulty_level,
  v.example_sentence_en,
  v.example_sentence_hu,
  v.audio_url
FROM (
  VALUES
    -- Greetings
    ('hello', 'helló, szia', '/həˈləʊ/', 'greetings', 'A0', 'Hello! How are you?', 'Szia! Hogy vagy?', NULL::text),
    ('hi', 'szia', '/haɪ/', 'greetings', 'A0', 'Hi, I am Anna.', 'Szia, Anna vagyok.', NULL),
    ('goodbye', 'viszlát', '/ˌɡʊdˈbaɪ/', 'greetings', 'A0', 'Goodbye, my friend.', 'Viszlát, barátom.', NULL),
    ('good morning', 'jó reggelt', '/ɡʊd ˈmɔː.nɪŋ/', 'greetings', 'A0', 'Good morning, Mum!', 'Jó reggelt, anya!', NULL),
    ('good night', 'jó éjszakát', '/ɡʊd naɪt/', 'greetings', 'A0', 'Good night, Dad.', 'Jó éjszakát, apa.', NULL),
    ('please', 'kérem', '/pliːz/', 'greetings', 'A0', 'Water, please.', 'Vizet, kérem.', NULL),
    ('thank you', 'köszönöm', '/θæŋk juː/', 'greetings', 'A0', 'Thank you very much.', 'Nagyon köszönöm.', NULL),
    ('sorry', 'bocsánat', '/ˈsɒr.i/', 'greetings', 'A0', 'I am sorry.', 'Bocsánatot kérek.', NULL),
    ('yes', 'igen', '/jes/', 'basics', 'A0', 'Yes, I am happy.', 'Igen, boldog vagyok.', NULL),
    ('no', 'nem', '/nəʊ/', 'basics', 'A0', 'No, thank you.', 'Nem, köszönöm.', NULL),

    -- People
    ('I', 'én', '/aɪ/', 'people', 'A0', 'I am a student.', 'Diák vagyok.', NULL),
    ('you', 'te, ön', '/juː/', 'people', 'A0', 'You are my friend.', 'Te a barátom vagy.', NULL),
    ('friend', 'barát', '/frend/', 'people', 'A0', 'She is my friend.', 'Ő a barátom.', NULL),
    ('family', 'család', '/ˈfæm.əl.i/', 'people', 'A0', 'I love my family.', 'Szeretem a családom.', NULL),
    ('mum', 'anya', '/mʌm/', 'people', 'A0', 'This is my mum.', 'Ez az anyukám.', NULL),
    ('dad', 'apa', '/dæd/', 'people', 'A0', 'This is my dad.', 'Ez az apukám.', NULL),
    ('boy', 'fiú', '/bɔɪ/', 'people', 'A0', 'The boy is happy.', 'A fiú boldog.', NULL),
    ('girl', 'lány', '/ɡɜːl/', 'people', 'A0', 'The girl is kind.', 'A lány kedves.', NULL),

    -- Animals
    ('cat', 'macska', '/kæt/', 'animals', 'A0', 'The cat is cute.', 'A macska aranyos.', NULL),
    ('dog', 'kutya', '/dɒɡ/', 'animals', 'A0', 'The dog is big.', 'A kutya nagy.', NULL),

    -- Food & drink
    ('apple', 'alma', '/ˈæp.əl/', 'food', 'A0', 'I eat an apple.', 'Eszem egy almát.', NULL),
    ('bread', 'kenyér', '/bred/', 'food', 'A0', 'I eat bread.', 'Kenyeret eszem.', NULL),
    ('water', 'víz', '/ˈwɔː.tə/', 'food', 'A0', 'I drink water.', 'Vizet iszom.', NULL),
    ('tea', 'tea', '/tiː/', 'food', 'A0', 'I drink tea.', 'Teát iszom.', NULL),
    ('milk', 'tej', '/mɪlk/', 'food', 'A0', 'I drink milk.', 'Tejet iszom.', NULL),
    ('eat', 'enni', '/iːt/', 'verbs', 'A0', 'I eat bread.', 'Kenyeret eszem.', NULL),
    ('drink', 'inni', '/drɪŋk/', 'verbs', 'A0', 'I drink tea.', 'Teát iszom.', NULL),

    -- Home & school
    ('house', 'ház', '/haʊs/', 'home', 'A0', 'This is my house.', 'Ez az én házam.', NULL),
    ('book', 'könyv', '/bʊk/', 'school', 'A0', 'I read a book.', 'Könyvet olvasok.', NULL),
    ('school', 'iskola', '/skuːl/', 'school', 'A0', 'I go to school.', 'Iskolába megyek.', NULL),
    ('read', 'olvasni', '/riːd/', 'verbs', 'A0', 'I read a book.', 'Könyvet olvasok.', NULL),
    ('go', 'menni', '/ɡəʊ/', 'verbs', 'A0', 'I go to school.', 'Iskolába megyek.', NULL),
    ('love', 'szeretni', '/lʌv/', 'verbs', 'A0', 'I love my family.', 'Szeretem a családom.', NULL),

    -- World
    ('sun', 'nap', '/sʌn/', 'nature', 'A0', 'The sun is bright.', 'A nap fényes.', NULL),
    ('big', 'nagy', '/bɪɡ/', 'adjectives', 'A0', 'The dog is big.', 'A kutya nagy.', NULL),
    ('happy', 'boldog', '/ˈhæp.i/', 'adjectives', 'A0', 'I am happy.', 'Boldog vagyok.', NULL),
    ('cute', 'aranyos', '/kjuːt/', 'adjectives', 'A0', 'The cat is cute.', 'A macska aranyos.', NULL),

    -- Numbers & colours
    ('one', 'egy', '/wʌn/', 'numbers', 'A0', 'I have one book.', 'Egy könyvem van.', NULL),
    ('two', 'kettő', '/tuː/', 'numbers', 'A0', 'I have two cats.', 'Két macskám van.', NULL),
    ('three', 'három', '/θriː/', 'numbers', 'A0', 'I see three dogs.', 'Három kutyát látok.', NULL),
    ('red', 'piros', '/red/', 'colours', 'A0', 'The apple is red.', 'Az alma piros.', NULL),
    ('blue', 'kék', '/bluː/', 'colours', 'A0', 'The book is blue.', 'A könyv kék.', NULL)
) AS v(
  english_word,
  hungarian_translation,
  phonetic,
  category,
  difficulty_level,
  example_sentence_en,
  example_sentence_hu,
  audio_url
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vocabulary_words existing
  WHERE existing.english_word = v.english_word
    AND existing.difficulty_level = v.difficulty_level
);
