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


export function renderPrivacy(app) {
  document.title = 'Privacy Policy - Vivid';
  app.innerHTML = `
    <article class="privacy-page">
      <h1>Privacy Policy</h1>
      <p>This page explains which data this instance receives from you, why it is needed, where it is kept and how you can get rid of it.</p>

      <h2>Account data</h2>
      <p>Creating an account is optional. If you do, the following is stored in this instance's database until you delete it:</p>
      <ul>
        <li>your username</li>
        <li>a salted hash of your password (never the password itself)</li>
        <li>your synced channel subscriptions</li>
        <li>your synced playlists</li>
        <li>the time your account was created</li>
        <li>a random session token for every device you are logged in on</li>
      </ul>
      <p>This data is only used to run the sync feature and is not passed on to anyone.</p>

      <h2>Server logs</h2>
      <p>Every request to this instance produces one line of output in the server console. It contains only:</p>
      <ul>
        <li>the time of the request</li>
        <li>the response status code</li>
        <li>the request method</li>
        <li>the requested URL</li>
        <li>how long the response took</li>
      </ul>
      <p>IP addresses, cookies and user agents are not logged. The console output is not written to files by this software.</p>
      <p>Example: <code>2026-01-01 12:00:00 +00:00 200 GET /api/v1/videos/xxxxxxxxxxx 120.52ms</code></p>

      <h2>Tracking</h2>
      <p>There are no advertisements, no analytics and no fingerprinting. Content from YouTube is fetched and proxied by the instance so that your browser does not contact Google directly for it.</p>

      <h2>Data in your browser</h2>
      <p>Settings, subscriptions, playlists and your login token are kept in your browser's local storage. Nothing is stored there unless you use the matching feature, and it never leaves your device except for the account sync you trigger yourself.</p>

      <h2>Removing your data</h2>
      <ul>
        <li>Local data: log out and clear this site's storage in your browser settings.</li>
        <li>Server data: open Account and choose Delete Account. This removes your user entry and all sessions from the database.</li>
      </ul>
    </article>
  `;
}
