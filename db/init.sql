CREATE DATABASE IF NOT EXISTS jokesdb;
USE jokesdb;

CREATE TABLE IF NOT EXISTS types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS jokes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setup TEXT NOT NULL,
  punchline TEXT NOT NULL,
  type_id INT NOT NULL,
  CONSTRAINT fk_jokes_type FOREIGN KEY (type_id) REFERENCES types(id)
);

INSERT IGNORE INTO types (name) VALUES
  ('Pun'),
  ('Dad'),
  ('Knock-knock'),
  ('One-liner'),
  ('Programming'),
  ('Animal');

INSERT INTO jokes (setup, punchline, type_id)
SELECT 'I used to be a banker,', 'but I lost interest.', id FROM types WHERE name = 'Pun'
UNION ALL
SELECT 'I only know 25 letters of the alphabet.', 'I don''t know y.', id FROM types WHERE name = 'Dad'
UNION ALL
SELECT 'Knock knock. Who''s there? Cow says. Cow says who?', 'No, a cow says mooooo!', id FROM types WHERE name = 'Knock-knock'
UNION ALL
SELECT 'I told my computer I needed a break,', 'and it said no problem, it would go to sleep.', id FROM types WHERE name = 'Programming'
UNION ALL
SELECT 'Why do Java developers wear glasses?', 'Because they don''t C#.', id FROM types WHERE name = 'Programming'
UNION ALL
SELECT 'I''m reading a book on anti-gravity.', 'It''s impossible to put down.', id FROM types WHERE name = 'One-liner'
UNION ALL
SELECT 'What do you call a fish wearing a bowtie?', 'Sofishticated.', id FROM types WHERE name = 'Animal'
UNION ALL
SELECT 'Why did the scarecrow win an award?', 'He was outstanding in his field.', id FROM types WHERE name = 'Dad'
UNION ALL
SELECT 'Time flies like an arrow;', 'fruit flies like a banana.', id FROM types WHERE name = 'Pun'
UNION ALL
SELECT 'Why don''t scientists trust atoms?', 'Because they make up everything.', id FROM types WHERE name = 'One-liner'
UNION ALL
SELECT 'What do you call a pile of cats?', 'A meowtain.', id FROM types WHERE name = 'Animal';
