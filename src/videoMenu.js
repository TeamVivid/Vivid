import { openSavePlaylistModal } from './pages/watch.js';

const videos = new Map();

export function videoMenuButton(v, thumbnailUrl) {
  const id = v.videoId || v.id;
  if (!id) return '';
  videos.set(id, {
    videoId: id,
    title: v.title || '',
    author: v.author || '',
    authorId: v.authorId || '',
    authorUrl: v.authorUrl || '',
    views: v.views || '',
    publishDate: v.publishDate || '',
    thumbnailUrl,
    duration: v.duration || '',
  });
  return `<button type="button" class="video-menu-btn" data-vid="${id}" aria-label="More options">⋮</button>`;
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('.video-menu [data-act]');
  const btn = e.target.closest('.video-menu-btn');
  const open = document.querySelector('.video-menu');

  if (item) {
    const v = videos.get(item.parentElement.dataset.vid);
    open.remove();
    if (item.dataset.act === 'audio') {
      location.hash = `#/watch?v=${v.videoId}&audio=1`;
    } else if (item.dataset.act === 'playlist') {
      openSavePlaylistModal(v);
    } else {
      const url = `${location.origin}${location.pathname}#/watch?v=${v.videoId}`;
      if (navigator.share) navigator.share({ title: v.title, url }).catch(() => {});
      else navigator.clipboard.writeText(url);
    }
    return;
  }

  const reopen = btn && open?.parentElement !== btn.parentElement;
  open?.remove();
  if (reopen) {
    btn.insertAdjacentHTML('afterend', `
      <div class="video-menu" data-vid="${btn.dataset.vid}">
        <button type="button" data-act="audio">Audio only</button>
        <button type="button" data-act="playlist">Add to playlist</button>
        <button type="button" data-act="share">Share</button>
      </div>`);
  }
});
