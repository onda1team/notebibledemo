CREATE TABLE chapter_sync(
  owner TEXT NOT NULL,
  chapter TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  updated_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(owner,chapter)
);
