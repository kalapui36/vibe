import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(resolve(dataDir, 'thumbnails'), { recursive: true });
export const db = new DatabaseSync(resolve(dataDir, 'vibe.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS apps (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL,
 category TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL,
 thumbnail TEXT, capture TEXT, capture_status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string' || password.length > 1024) return false;
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function getPassword() {
  return db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
}
export function setPassword(password) {
  db.prepare("INSERT OR REPLACE INTO settings VALUES ('password', ?)").run(hashPassword(password));
  db.exec('DELETE FROM sessions');
}
