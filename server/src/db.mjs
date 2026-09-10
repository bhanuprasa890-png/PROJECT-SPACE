/**
 * Database layer: node:sqlite (bundled with Node >= 22.5, zero native deps).
 * Everything runs inside IMMEDIATE transactions so concurrent writes can't
 * half-apply a session or a hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  avatar_url         TEXT,
  provider           TEXT NOT NULL CHECK (provider IN ('google', 'password')),
  google_sub         TEXT UNIQUE,
  password_hash      TEXT,
  demo_code_hash     TEXT,
  created_at         TEXT NOT NULL,
  last_login_at      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  email      TEXT,
  ok         INTEGER NOT NULL,
  reason     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_events_email_idx ON auth_events(email, created_at);

CREATE TABLE IF NOT EXISTS recipe_state (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id  TEXT NOT NULL,
  favorite   INTEGER NOT NULL DEFAULT 0,
  cooked_at  TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS pantry (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient  TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, ingredient)
);
`;

let db = null;

export function getDb(dbPath = config.dbPath) {
  if (db) return db;
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

/** Test hook: point the module at a fresh in-memory DB. */
export function resetDbForTests(dbPath = ':memory:') {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
  }
  db = null;
  return getDb(dbPath);
}

export function tx(fn) {
  const handle = getDb();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(handle);
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    try { handle.exec('ROLLBACK'); } catch { /* rollback of a dead tx */ }
    throw error;
  }
}

export const nowIso = () => new Date().toISOString();

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url ?? null,
    provider: row.provider,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}
