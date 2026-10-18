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


import { Router } from 'express';
import { registerUser, loginUser, getUserByToken, logoutUser, syncUserData, deleteUser } from '../auth.js';

const router = Router();

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

router.post('/register', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = registerUser(username, password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = loginUser(username, password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/me', (req, res) => {
  const token = getBearerToken(req);
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user });
});

router.post('/sync', (req, res) => {
  try {
    const token = getBearerToken(req);
    const { subscriptions, playlists } = req.body || {};
    const updated = syncUserData(token, { subscriptions, playlists });
    res.json({ user: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) logoutUser(token);
  res.json({ success: true });
});

router.post('/delete', (req, res) => {
  try {
    const token = getBearerToken(req);
    const { password } = req.body || {};
    deleteUser(token, password);
    res.json({ success: true });
  } catch (e) {
    res.status(e.message === 'Unauthorized' ? 401 : 400).json({ error: e.message });
  }
});

export default router;
