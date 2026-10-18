/*
 * Vivid - A privacy focused alternative YouTube frontend inspired by Invidious and Nitter
 * Copyright (C) 2026  TheErrorExe, zUnpaid
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  if (!fs.existsSync(USERS_FILE)) {
    return { users: {}, sessions: {} };
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { users: parsed.users || {}, sessions: parsed.sessions || {} };
  } catch {
    return { users: {}, sessions: {} };
  }
}

function saveDb(db) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function registerUser(username, password) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 32) {
    throw new Error('Username must be between 3 and 32 characters');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
    throw new Error('Username may only contain letters, numbers, underscores, and dashes');
  }
  if (!password || String(password).length < 4) {
    throw new Error('Password must be at least 4 characters');
  }

  const db = loadDb();
  if (db.users[cleanUsername]) {
    throw new Error('Username already exists');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const now = new Date().toISOString();

  db.users[cleanUsername] = {
    username: cleanUsername,
    salt,
    hash,
    subscriptions: [],
    playlists: [],
    createdAt: now,
  };

  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = {
    username: cleanUsername,
    createdAt: now,
  };

  saveDb(db);

  return {
    token,
    user: {
      username: cleanUsername,
      subscriptions: [],
      playlists: [],
    }
  };
}

export function loginUser(username, password) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const db = loadDb();
  const user = db.users[cleanUsername];
  if (!user) {
    throw new Error('Invalid username or password');
  }

  const hash = hashPassword(password, user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'))) {
    throw new Error('Invalid username or password');
  }

  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = {
    username: cleanUsername,
    createdAt: new Date().toISOString(),
  };
  saveDb(db);

  return {
    token,
    user: {
      username: cleanUsername,
      subscriptions: user.subscriptions || [],
      playlists: user.playlists || [],
    }
  };
}

export function getUserByToken(token) {
  if (!token) return null;
  const db = loadDb();
  const session = db.sessions[token];
  if (!session) return null;
  const user = db.users[session.username];
  if (!user) return null;
  return {
    username: user.username,
    subscriptions: user.subscriptions || [],
    playlists: user.playlists || [],
  };
}

export function logoutUser(token) {
  if (!token) return;
  const db = loadDb();
  if (db.sessions[token]) {
    delete db.sessions[token];
    saveDb(db);
  }
}

export function deleteUser(token, password) {
  if (!token) throw new Error('Unauthorized');
  const db = loadDb();
  const session = db.sessions[token];
  if (!session) throw new Error('Unauthorized');
  const user = db.users[session.username];
  if (!user) throw new Error('User not found');

  const hash = hashPassword(String(password || ''), user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'))) {
    throw new Error('Invalid password');
  }

  delete db.users[user.username];
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.username === user.username) delete db.sessions[t];
  }
  saveDb(db);
}

export function syncUserData(token, { subscriptions = [], playlists = [] }) {
  if (!token) throw new Error('Unauthorized');
  const db = loadDb();
  const session = db.sessions[token];
  if (!session) throw new Error('Unauthorized');
  const user = db.users[session.username];
  if (!user) throw new Error('User not found');

  const mergedSubs = Array.from(new Set([...(user.subscriptions || []), ...subscriptions]));
  user.subscriptions = mergedSubs;

  const existingPlaylists = user.playlists || [];
  const playlistMap = new Map();
  for (const pl of existingPlaylists) {
    playlistMap.set(pl.id, pl);
  }
  for (const pl of playlists) {
    if (!pl || !pl.id) continue;
    if (playlistMap.has(pl.id)) {
      const existing = playlistMap.get(pl.id);
      const videoMap = new Map();
      for (const v of existing.videos || []) videoMap.set(v.videoId || v.id, v);
      for (const v of pl.videos || []) videoMap.set(v.videoId || v.id, v);
      playlistMap.set(pl.id, {
        ...existing,
        name: pl.name || existing.name,
        videos: Array.from(videoMap.values()),
      });
    } else {
      playlistMap.set(pl.id, pl);
    }
  }
  user.playlists = Array.from(playlistMap.values());

  saveDb(db);

  return {
    username: user.username,
    subscriptions: user.subscriptions,
    playlists: user.playlists,
  };
}
