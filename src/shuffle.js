const storageKey = (listId) => `vivid_shuffle_${listId}`;

export function getShuffleOrder(listId) {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(listId))) || null;
  } catch {
    return null;
  }
}

export function startShuffle(listId, videos, firstId = null) {
  const pool = videos.filter(v => v.videoId || v.id);
  const first = firstId ? pool.find(v => (v.videoId || v.id) === firstId) : null;
  const rest = pool.filter(v => v !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const order = first ? [first, ...rest] : rest;
  try {
    sessionStorage.setItem(storageKey(listId), JSON.stringify(order));
  } catch {}
  return order;
}

export function stopShuffle(listId) {
  sessionStorage.removeItem(storageKey(listId));
}
