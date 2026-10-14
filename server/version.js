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


import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'Youtube-Hackers/vivid';

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

const fullHash = git('rev-parse', 'HEAD');

export const version = git('rev-parse', '--short', 'HEAD')
  || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  || '1.0.0';

export const status = { behind: null };

export async function checkForUpdates() {
  if (!fullHash) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${fullHash}...main`, {
      headers: { 'User-Agent': 'Vivid', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    status.behind = (await res.json()).ahead_by ?? null;
    console.log(status.behind ? `Update available: ${status.behind} commit${status.behind === 1 ? '' : 's'} behind` : 'Vivid is up to date');
  } catch {}
}
