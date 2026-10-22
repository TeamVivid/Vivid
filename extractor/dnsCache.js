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

import dns from 'node:dns';
import net from 'node:net';

const TTL = parseInt(process.env.DNS_CACHE_TTL, 10) * 1000 || 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map();
const pending = new Map();
const originalLookup = dns.lookup.bind(dns);

function resolve(hostname, options) {
    return new Promise((resolve, reject) => {
        originalLookup(hostname, { ...options, all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
    });
}

function cachedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    } else if (typeof options === 'number') {
        options = { family: options };
    }
    options = options || {};

    if (typeof hostname !== 'string' || !hostname || net.isIP(hostname) || hostname === 'localhost') {
        return originalLookup(hostname, options, callback);
    }

    const key = `${hostname}|${options.family || 0}|${options.hints || 0}|${options.order || ''}|${options.verbatim ?? ''}`;
    const entry = cache.get(key);

    const respond = (addresses) => {
        if (options.all) return callback(null, addresses.map(a => ({ ...a })));
        callback(null, addresses[0].address, addresses[0].family);
    };

    if (entry && entry.expires > Date.now()) return process.nextTick(respond, entry.addresses);

    let request = pending.get(key);
    if (!request) {
        request = resolve(hostname, options)
        .then((addresses) => {
            if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
            cache.set(key, { addresses, expires: Date.now() + TTL });
            return addresses;
        })
        .finally(() => pending.delete(key));
        pending.set(key, request);
    }

    request.then(respond, (err) => (entry ? respond(entry.addresses) : callback(err)));
}

dns.lookup = Object.assign(cachedLookup, { __promisify__: dns.lookup.__promisify__ });

export function clearDnsCache() {
    cache.clear();
}
