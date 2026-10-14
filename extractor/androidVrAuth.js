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
import fetch from 'node-fetch';

const OAUTH_CLIENT_ID = '652469312169-4lvs9bnhr9lpns9v451j5oivd81vjvu1.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '3fTWrBJI5Uojm1TK7_iJCW5Z';
const OAUTH_TOKEN_URL = 'https://www.youtube.com/o/oauth2/token';
const OAUTH_UA = 'com.google.android.apps.youtube.vr.pico/1.73.21(Linux; U; Android 10; en_US; A8110 Build/5.13.7) gzip';

function getTokenFilePath() {
  const localFile = path.resolve(process.cwd(), 'oauth2.json');
  if (fs.existsSync(localFile)) return localFile;
  const homeConfig = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'yt_vr_player', 'oauth.json');
  if (fs.existsSync(homeConfig)) return homeConfig;
  return localFile;
}

export function hasOAuthFile() {
  const file = getTokenFilePath();
  return fs.existsSync(file);
}

export async function getVrAuthorization() {
  const filePath = getTokenFilePath();
  if (!fs.existsSync(filePath)) return null;

  let tokenData;
  try {
    tokenData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }

  const refreshToken = tokenData.refresh_token;
  if (!refreshToken) return null;

  const now = Date.now() / 1000;
  if (tokenData.access_token && tokenData.expires_at && now < tokenData.expires_at - 60) {
    return `Bearer ${tokenData.access_token}`;
  }

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': OAUTH_UA,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      })
    });

    const data = await res.json();
    if (res.ok && data.access_token) {
      tokenData.access_token = data.access_token;
      tokenData.token_type = data.token_type || 'Bearer';
      tokenData.expires_at = now + Number(data.expires_in || 3600);
      try {
        fs.writeFileSync(filePath, JSON.stringify(tokenData, null, 2), 'utf-8');
      } catch {}
      return `Bearer ${data.access_token}`;
    }
  } catch {}

  return null;
}
