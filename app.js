'use strict';

/* ════════════════════════════════════════════════════════════════
   CineStream v4.1 – Updated 18 July 2026
   Modern UI inspired by StreamIMDB – fully functional
═══════════════════════════════════════════════════════════════ */

// ── CONFIG ────────────────────────────────────────────────────
const CFG = {
  OMDB_KEY: '4b251b1e',
  OMDB: 'https://www.omdbapi.com/',
  STREAM_MOVIE: 'https://streamimdb.ru/embed/movie/',
  STREAM_TV: 'https://streamimdb.ru/embed/tv/',
  HERO_MS: 7000,
  CACHE_TTL_MS: 48 * 60 * 60 * 1000,
  CACHE_MAX: 120,
  BATCH_SIZE: 3,
  DEMO_USER: { uid: 'guest', name: 'Guest', email: 'guest@cinestream.app', photo: '' },
  STORE_VER: 3,
  FETCH_RETRIES: 2,
};

// ── JULY 2026 MOVIES (updated 18/07/2026) ────────────────────
const MOVIES_2026 = [
  'tt33764258', // The Odyssey (Christopher Nolan)
  'tt22084616', // Spider-Man: Brand New Day
  'tt12042730', // Project Hail Mary
  'tt33612209', // The Devil Wears Prada 2
  'tt32278481', // Enola Holmes 3
  'tt33071426', // The Drama
  'tt31170389', // Evil Dead Burn
  'tt36304003', // 72 Hours
];

// ── JULY 2026 SERIES (updated 18/07/2026) ────────────────────
const SERIES_2026 = [
  'tt14452776', // The Bear (Season 5, series finale)
  'tt34866681', // Lucky (Apple TV)
  'tt27550719', // The Hawk (Will Ferrell, Netflix)
  'tt2431250',  // Little House on the Prairie (2026 reboot)
  'tt11737520', // House of the Dragon (Season 3)
  'tt4574334',  // Stranger Things (Season 5)
  'tt9253284',  // Severance (Season 2)
  'tt11198330', // The Boys (Season 5)
];

// ── HERO SLIDER LINEUP (updated 18/07/2026) ───────────────────
// Pulled live from OMDb at load time — keep this list current and
// the hero banner stays current automatically, no hardcoded images.
const HERO_IDS = [
  'tt33764258', // The Odyssey
  'tt22084616', // Spider-Man: Brand New Day
  'tt14452776', // The Bear (Season 5)
  'tt12042730', // Project Hail Mary
  'tt33612209', // The Devil Wears Prada 2
];
const HERO_BADGES = [
  '<i class="bi bi-fire"></i> Trending Now',
  '<i class="bi bi-lightning-fill"></i> Coming Soon',
  '<i class="bi bi-tv"></i> Series · Final Season',
  '<i class="bi bi-film"></i> Now Streaming',
  '<i class="bi bi-star-fill"></i> New Release',
];

// ── VALIDATION ──────────────────────────────────────────────
const IMDB_RE = /^tt\d{7,8}$/;
function validId(id) { return typeof id === 'string' && IMDB_RE.test(id); }
function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ── STORE ──────────────────────────────────────────────────
const Store = (() => {
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      try { localStorage.removeItem(key); } catch (_) {}
      return fallback;
    }
  }
  function write(key, value) {
    const str = JSON.stringify(value);
    try { localStorage.setItem(key, str); }
    catch (e) {
      try { localStorage.removeItem('cs_cache'); localStorage.setItem(key, str); }
      catch (_) { console.error('[Store] Write failed.'); }
    }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  return { read, write, remove };
})();

// ── CACHE ──────────────────────────────────────────────────
const MovieCache = (() => {
  let _store = Store.read('cs_cache', {});
  let _dirty = false, _flush = null;

  (function evict() {
    const now = Date.now();
    Object.keys(_store).forEach(id => {
      if (now - (_store[id].ts || 0) > CFG.CACHE_TTL_MS) delete _store[id];
    });
    const keys = Object.keys(_store);
    if (keys.length > CFG.CACHE_MAX) {
      keys.sort((a, b) => (_store[a].ts || 0) - (_store[b].ts || 0))
        .slice(0, keys.length - CFG.CACHE_MAX)
        .forEach(id => delete _store[id]);
    }
  })();

  function scheduleSave() {
    _dirty = true;
    clearTimeout(_flush);
    _flush = setTimeout(() => { if (_dirty) { Store.write('cs_cache', _store); _dirty = false; } }, 2000);
  }
  window.addEventListener('beforeunload', () => { if (_dirty) Store.write('cs_cache', _store); });

  return {
    get(id) {
      const e = _store[id];
      if (!e) return null;
      if (Date.now() - (e.ts || 0) > CFG.CACHE_TTL_MS) { delete _store[id]; scheduleSave(); return null; }
      return e.data;
    },
    set(id, data) {
      _store[id] = { data, ts: Date.now() };
      const keys = Object.keys(_store);
      if (keys.length > CFG.CACHE_MAX) {
        keys.sort((a, b) => (_store[a].ts || 0) - (_store[b].ts || 0))
          .slice(0, keys.length - CFG.CACHE_MAX)
          .forEach(k => delete _store[k]);
      }
      scheduleSave();
    },
  };
})();

// ── STATE ──────────────────────────────────────────────────
const S = {
  user: null,
  appBooted: false,
  watchlist: Store.read('cs_wl', []),
  history: Store.read('cs_cw', []),
  ratings: Store.read('cs_stars', {}),
  searches: Store.read('cs_sq', []),
  searchTimer: null,
  searchToken: 0,
  _inflight: {},
};

// ── HELPERS ──────────────────────────────────────────────
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function toast(msg, ms = 3000) {
  const c = $('#toasts'); if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms + 300);
}

// ── API ──────────────────────────────────────────────────
async function fetchWithRetry(url, retries = CFG.FETCH_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      if (i === retries || !navigator.onLine) throw e;
      await new Promise(res => setTimeout(res, 700 * (i + 1)));
    }
  }
}

const _searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

async function fetchMovie(id) {
  if (!validId(id)) return null;
  const cached = MovieCache.get(id);
  if (cached) return cached;
  if (S._inflight[id]) return S._inflight[id];

  const p = (async () => {
    try {
      const r = await fetchWithRetry(CFG.OMDB + '?i=' + id + '&plot=full&apikey=' + CFG.OMDB_KEY);
      const d = await r.json();
      if (d.Response === 'True') { MovieCache.set(id, d); return d; }
      return null;
    } catch (e) {
      console.warn('[API] fetchMovie(' + id + '):', e.message);
      return null;
    } finally {
      delete S._inflight[id];
    }
  })();

  S._inflight[id] = p;
  return p;
}

async function fetchBatch(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += CFG.BATCH_SIZE) {
    const chunk = ids.slice(i, i + CFG.BATCH_SIZE);
    const batch = await Promise.allSettled(chunk.map(id => fetchMovie(id)));
    results.push(...batch);
    if (i + CFG.BATCH_SIZE < ids.length) await new Promise(r => setTimeout(r, 120));
  }
  return results;
}

async function searchOMDb(q, page = 1) {
  const cacheKey = q + '|' + page;
  const hit = _searchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return { movies: hit.movies, total: hit.total };

  try {
    const r = await fetchWithRetry(CFG.OMDB + '?s=' + encodeURIComponent(q) + '&page=' + page + '&apikey=' + CFG.OMDB_KEY);
    const d = await r.json();
    if (d.Response === 'True') {
      (d.Search || []).forEach(m => { if (validId(m.imdbID) && !MovieCache.get(m.imdbID)) MovieCache.set(m.imdbID, m); });
      const result = { movies: d.Search || [], total: +d.totalResults || 0 };
      _searchCache.set(cacheKey, { ...result, ts: Date.now() });
      return result;
    }
    return { movies: [], total: 0 };
  } catch (e) {
    console.warn('[API] searchOMDb:', e.message);
    return { movies: [], total: 0 };
  }
}

// ── WATCHLIST ─────────────────────────────────────────────
const isWL = id => S.watchlist.some(m => m.imdbID === id);

function toggleWatchlist(movie) {
  if (!movie?.imdbID) return;
  const idx = S.watchlist.findIndex(m => m.imdbID === movie.imdbID);
  if (idx >= 0) {
    S.watchlist.splice(idx, 1);
    toast('Removed from watchlist');
  } else {
    S.watchlist.unshift({
      imdbID: movie.imdbID, Title: movie.Title, Year: movie.Year,
      Poster: movie.Poster, Type: movie.Type, imdbRating: movie.imdbRating,
    });
    toast('✅ Added "' + movie.Title + '" to watchlist');
  }
  Store.write('cs_wl', S.watchlist);
  refreshWLBtns(movie.imdbID);
  refreshWatchlistView();
}

function refreshWLBtns(id) {
  const inWL = isWL(id);
  $$('[data-wl="' + id + '"]').forEach(btn => {
    btn.classList.toggle('liked', inWL);
    btn.classList.toggle('added', inWL);
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'bi bi-bookmark' + (inWL ? '-fill' : '');
    const tn = [...btn.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
    if (tn) tn.textContent = ' ' + (inWL ? 'In My List' : 'Add to List');
  });
}

// ── HISTORY ──────────────────────────────────────────────
function addHistory(movie) {
  if (!movie?.imdbID) return;
  const idx = S.history.findIndex(m => m.imdbID === movie.imdbID);
  const prevProgress = idx >= 0 ? (S.history[idx].progress || 0) : 0;
  if (idx >= 0) S.history.splice(idx, 1);
  S.history.unshift({
    imdbID: movie.imdbID, Title: movie.Title, Year: movie.Year,
    Poster: movie.Poster, Type: movie.Type, imdbRating: movie.imdbRating,
    progress: prevProgress || 30, ts: Date.now(),
  });
  S.history = S.history.slice(0, 12);
  Store.write('cs_cw', S.history);
}

// ── CARD (StreamIMDB style) ──────────────────────────────
function buildCard(movie, opts = {}) {
  const { cw = false, openFn = null } = opts;
  const card = document.createElement('div');
  card.className = 'cb-card' + (cw ? ' cb-card-cw' : '');
  card.dataset.id = movie.imdbID;
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', movie.Title);

  const poster = document.createElement('div');
  poster.className = 'cb-card-poster';

  const img = document.createElement('img');
  img.alt = movie.Title || '';
  img.loading = 'lazy';
  img.src = movie.Poster && movie.Poster !== 'N/A' ? movie.Poster : '';
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => { img.style.display = 'none'; };
  poster.appendChild(img);

  // Rating badge always visible
  if (movie.imdbRating && movie.imdbRating !== 'N/A') {
    const badge = document.createElement('div');
    badge.className = 'cb-card-rating';
    badge.innerHTML = `<i class="bi bi-star-fill"></i> ${esc(movie.imdbRating)}`;
    poster.appendChild(badge);
  }

  // Type badge
  if (movie.Type === 'series') {
    const typeBadge = document.createElement('div');
    typeBadge.className = 'cb-card-type';
    typeBadge.textContent = 'TV';
    poster.appendChild(typeBadge);
  }

  const overlay = document.createElement('div');
  overlay.className = 'cb-card-overlay';
  overlay.innerHTML = `
    <div class="cb-card-play"><i class="bi bi-play-fill"></i></div>
    <div class="cb-card-overlay-info">
      <div class="cb-card-overlay-title">${esc(movie.Title)}</div>
      <div class="cb-card-overlay-meta">
        ${movie.Year ? esc(movie.Year) : ''}
        ${movie.Genre ? ' · ' + esc(movie.Genre.split(',')[0]) : ''}
      </div>
    </div>
  `;
  poster.appendChild(overlay);

  if (cw) {
    const prog = document.createElement('div');
    prog.className = 'cb-cw-progress';
    prog.innerHTML = `<div class="cb-cw-bar" style="width:${Math.min(movie.progress || 30, 100)}%"></div>`;
    poster.appendChild(prog);
  }

  card.appendChild(poster);

  const info = document.createElement('div');
  info.className = 'cb-card-info';
  info.innerHTML = `
    <h3 class="cb-card-title">${esc(movie.Title)}</h3>
    <p class="cb-card-meta">${esc(movie.Year || '')}${movie.Genre ? ' · ' + esc(movie.Genre.split(',')[0]) : ''}</p>
  `;
  card.appendChild(info);

  const handler = () => { if (openFn) openFn(movie.imdbID); else openModal(movie.imdbID); };
  card.addEventListener('click', handler);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  return card;
}

function buildSkel() {
  const el = document.createElement('div');
  el.className = 'cb-card skel';
  el.innerHTML = `
    <div class="cb-card-poster">
      <div class="skel-img" style="aspect-ratio:2/3;border-radius:8px;width:100%;"></div>
    </div>
    <div class="cb-card-info">
      <div class="skel-text" style="height:11px;width:80%;margin-bottom:4px;border-radius:4px;"></div>
      <div class="skel-text" style="height:9px;width:40%;border-radius:4px;"></div>
    </div>
  `;
  return el;
}

// ── HERO SLIDER ───────────────────────────────────────────
function buildHeroSlideHTML(m, idx) {
  const type = m.Type === 'series' ? 'tv' : 'movie';
  const genres = (m.Genre && m.Genre !== 'N/A') ? m.Genre.split(', ').slice(0, 2) : [];
  const tagsHtml = genres.map(g => `<span class="cb-tag">${esc(g)}</span>`).join('');
  const rating = (m.imdbRating && m.imdbRating !== 'N/A')
    ? `<span class="cb-slide-dot">·</span><span><i class="bi bi-star-fill" style="color:#fbbf24"></i> ${esc(m.imdbRating)}</span>`
    : '';
  const plot = (m.Plot && m.Plot !== 'N/A') ? m.Plot : '';
  const desc = plot.length > 170 ? plot.slice(0, 167).trimEnd() + '…' : plot;
  const bg = (m.Poster && m.Poster !== 'N/A') ? `style="background-image:url('${esc(m.Poster)}')"` : '';
  const badge = HERO_BADGES[idx] || '<i class="bi bi-film"></i> Featured';
  return `
    <div class="cb-slide${idx === 0 ? ' active' : ''}">
      <div class="cb-slide-bg" ${bg}></div>
      <div class="cb-slide-gradient"></div>
      <div class="cb-slide-content">
        <div class="cb-slide-badge">${badge}</div>
        <h1 class="cb-slide-title">${esc(m.Title)}</h1>
        <div class="cb-slide-meta">
          ${tagsHtml}
          <span class="cb-slide-dot">·</span>
          <span>${esc(m.Year)}</span>
          ${rating}
        </div>
        ${desc ? `<p class="cb-slide-desc">${esc(desc)}</p>` : ''}
        <div class="cb-slide-actions">
          <button class="cb-btn cb-btn-play cb-slide-play" data-embed="/embed/${type}/${m.imdbID}"><i class="bi bi-play-fill"></i> Play Now</button>
          <button class="cb-btn cb-btn-ghost-sm cb-slide-info" data-id="${m.imdbID}"><i class="bi bi-info-circle"></i> More Info</button>
        </div>
      </div>
    </div>`;
}

async function initHero() {
  const hero = document.getElementById('cbHero');
  const slidesWrap = document.getElementById('cbSlides');
  const dotsWrap = document.getElementById('cbSliderDots');
  if (!hero || !slidesWrap) return;

  const results = await fetchBatch(HERO_IDS);
  const movies = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  if (!movies.length) { hero.style.display = 'none'; return; }

  slidesWrap.innerHTML = movies.map((m, i) => buildHeroSlideHTML(m, i)).join('');
  if (dotsWrap) {
    dotsWrap.innerHTML = movies.map((_, i) => `<span class="cb-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`).join('');
  }

  const slides = hero.querySelectorAll('.cb-slide');
  const dots = hero.querySelectorAll('.cb-dot');
  if (!slides.length) return;
  let current = 0, timer = null;

  function show(idx) {
    slides.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    current = idx;
  }
  function next() { show((current + 1) % slides.length); }
  function prev() { show((current - 1 + slides.length) % slides.length); }
  function resetTimer() { clearInterval(timer); if (slides.length > 1) timer = setInterval(next, CFG.HERO_MS); }

  document.getElementById('cbSliderPrev')?.addEventListener('click', () => { prev(); resetTimer(); });
  document.getElementById('cbSliderNext')?.addEventListener('click', () => { next(); resetTimer(); });
  dots.forEach(d => d.addEventListener('click', function () { show(parseInt(this.dataset.idx) || 0); resetTimer(); }));

  // Touch swipe
  let tx = 0, ty = 0;
  hero.addEventListener('touchstart', e => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  hero.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); resetTimer(); }
  }, { passive: true });

  resetTimer();

  // Play / Info buttons inside hero
  hero.querySelectorAll('.cb-slide-play').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const src = this.getAttribute('data-embed');
      if (src) openPlayerFromEmbed(src);
    });
  });
  hero.querySelectorAll('.cb-slide-info').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const id = this.getAttribute('data-id');
      if (id) openModal(id);
    });
  });
}

// ── ROW POPULATION ──────────────────────────────────────
async function populateRow(containerId, ids, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < Math.min(ids.length, 6); i++) container.appendChild(buildSkel());

  const results = await fetchBatch(ids);
  container.innerHTML = '';
  const valid = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  valid.forEach(m => container.appendChild(buildCard(m, options)));
  if (!valid.length) {
    container.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:0.85rem;">No titles available.</div>';
  }
}

// ── TOP 10 ───────────────────────────────────────────────
async function renderTop10() {
  const container = document.getElementById('cbTop10');
  if (!container) return;
  const ids = MOVIES_2026.slice(0, 10);
  const movies = await fetchBatch(ids);
  container.innerHTML = '';
  movies.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).forEach((m, i) => {
    const item = document.createElement('a');
    item.className = 'cb-top10-item';
    item.href = '#';
    item.setAttribute('aria-label', m.Title);
    item.innerHTML = `
      <span class="cb-top10-number">${i + 1}</span>
      <div class="cb-top10-poster">
        <img src="${m.Poster !== 'N/A' ? esc(m.Poster) : ''}" alt="${esc(m.Title)}" width="120" height="180" loading="lazy">
        <div class="cb-top10-poster-overlay"><i class="bi bi-play-fill"></i></div>
      </div>
    `;
    item.addEventListener('click', e => { e.preventDefault(); openModal(m.imdbID); });
    container.appendChild(item);
  });
}

// ── TABS ──────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.cb-tab').forEach(btn => {
    btn.addEventListener('click', function () {
      const group = this.closest('.cb-tabs');
      group.querySelectorAll('.cb-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      const target = document.getElementById(this.dataset.tab);
      const parent = group.parentElement;
      parent.querySelectorAll('.cb-tab-content').forEach(c => c.classList.remove('active'));
      if (target) target.classList.add('active');
    });
  });
}

// ── CONTINUE WATCHING ──────────────────────────────────
function renderContinueWatching() {
  const section = document.getElementById('cbContinueWatching');
  const grid = document.getElementById('cbCwGrid');
  if (!section || !grid) return;
  if (!S.history.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  grid.innerHTML = '';
  S.history.slice(0, 8).forEach(m => grid.appendChild(buildCard(m, { cw: true })));
}

// ── WATCHLIST VIEW ────────────────────────────────────────
function refreshWatchlistView() {
  const c = document.getElementById('watchlistContent');
  if (!c) return;
  if (!S.watchlist.length) {
    c.innerHTML = `
      <div class="empty-page">
        <i class="bi bi-bookmark" style="font-size:3.5rem;opacity:0.25;display:block;margin-bottom:1rem;"></i>
        <h3 style="font-size:1.1rem;margin-bottom:0.5rem;">Your watchlist is empty</h3>
        <p style="color:var(--text3);font-size:0.9rem;">Tap the bookmark icon on any title to save it here.</p>
      </div>`;
    return;
  }
  c.innerHTML = '';
  const g = document.createElement('div');
  g.className = 'page-grid';
  S.watchlist.forEach(m => g.appendChild(buildCard(m)));
  c.appendChild(g);
}

// ── MODAL ────────────────────────────────────────────────
async function openModal(id, push = true) {
  if (!validId(id)) return;

  const bg = document.getElementById('cbPlayerModal');
  const modal = document.querySelector('.cb-player-modal-body');
  if (!bg || !modal) return;

  bg.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Show loading state
  const wrap = modal.querySelector('#cbModalWrap');
  if (wrap) {
    wrap.innerHTML = '<div class="modal-loading"><div class="spinner"></div><span>Loading…</span></div>';
  }

  const m = MovieCache.get(id) || await fetchMovie(id);
  if (!m) {
    toast('Could not load title.');
    bg.style.display = 'none';
    document.body.style.overflow = '';
    return;
  }

  addHistory(m);
  renderContinueWatching();

  if (wrap) {
    const inWL = isWL(id);
    const poster = m.Poster && m.Poster !== 'N/A' ? m.Poster : '';
    wrap.innerHTML = `
      <div class="modal-detail">
        <div class="modal-detail-bg" ${poster ? `style="background-image:url('${poster}')"` : ''}></div>
        <div class="modal-detail-content">
          <div class="modal-detail-poster">
            ${poster ? `<img src="${poster}" alt="${esc(m.Title)}" />` : '<div class="modal-no-poster"><i class="bi bi-film"></i></div>'}
          </div>
          <div class="modal-detail-info">
            <h2 class="modal-detail-title">${esc(m.Title)}</h2>
            <div class="modal-detail-meta">
              ${m.imdbRating && m.imdbRating !== 'N/A' ? `<span class="modal-rating"><i class="bi bi-star-fill"></i> ${esc(m.imdbRating)}</span>` : ''}
              ${m.Year ? `<span>${esc(m.Year)}</span>` : ''}
              ${m.Runtime && m.Runtime !== 'N/A' ? `<span>${esc(m.Runtime)}</span>` : ''}
              ${m.Rated && m.Rated !== 'N/A' ? `<span class="modal-rated">${esc(m.Rated)}</span>` : ''}
            </div>
            ${m.Genre && m.Genre !== 'N/A' ? `<div class="modal-genres">${m.Genre.split(',').map(g => `<span class="modal-genre-tag">${esc(g.trim())}</span>`).join('')}</div>` : ''}
            ${m.Plot && m.Plot !== 'N/A' ? `<p class="modal-plot">${esc(m.Plot)}</p>` : ''}
            ${m.Director && m.Director !== 'N/A' ? `<p class="modal-credit"><strong>Director:</strong> ${esc(m.Director)}</p>` : ''}
            ${m.Actors && m.Actors !== 'N/A' ? `<p class="modal-credit"><strong>Cast:</strong> ${esc(m.Actors)}</p>` : ''}
            <div class="modal-actions">
              <button class="cb-btn cb-btn-play modal-play-btn" data-id="${esc(id)}"><i class="bi bi-play-fill"></i> Play Now</button>
              <button class="cb-btn cb-btn-ghost-sm modal-wl-btn" data-wl="${esc(id)}">
                <i class="bi bi-bookmark${inWL ? '-fill' : ''}"></i> ${inWL ? 'In My List' : 'Add to List'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    wrap.querySelector('.modal-play-btn')?.addEventListener('click', () => {
      closePlayer();
      openPlayer(id, m.Type === 'series');
    });
    wrap.querySelector('.modal-wl-btn')?.addEventListener('click', async function () {
      const full = MovieCache.get(id) || await fetchMovie(id) || m;
      toggleWatchlist(full);
      const inWL2 = isWL(id);
      this.innerHTML = `<i class="bi bi-bookmark${inWL2 ? '-fill' : ''}"></i> ${inWL2 ? 'In My List' : 'Add to List'}`;
    });
  }

  // Close handlers
  const closeModal = () => { bg.style.display = 'none'; document.body.style.overflow = ''; };
  document.getElementById('cbPlayerModalClose')?.addEventListener('click', closeModal, { once: true });
  document.getElementById('cbPlayerModalX')?.addEventListener('click', closeModal, { once: true });
}

// ── PLAYER ──────────────────────────────────────────────
function openPlayer(id, isSeries = false) {
  const bg = document.getElementById('cbPlayerModal');
  const wrap = document.getElementById('cbModalWrap');
  if (!bg || !wrap) return;

  bg.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const embedUrl = (isSeries ? CFG.STREAM_TV : CFG.STREAM_MOVIE) + id;
  wrap.innerHTML = `
    <div style="position:relative;width:100%;padding-top:56.25%;background:#000;">
      <div class="modal-loading" style="position:absolute;inset:0;z-index:2;" id="playerLoader">
        <div class="spinner"></div><span>Loading player…</span>
      </div>
      <iframe
        src="${embedUrl}"
        style="position:absolute;inset:0;width:100%;height:100%;border:none;"
        allow="autoplay; fullscreen; picture-in-picture"
        title="Video Player"
        id="cbModalPlayer"
      ></iframe>
    </div>
  `;
  document.getElementById('cbModalPlayer')?.addEventListener('load', () => {
    document.getElementById('playerLoader')?.remove();
  });

  const closeModal = () => {
    const iframe = document.getElementById('cbModalPlayer');
    if (iframe) iframe.src = 'about:blank';
    bg.style.display = 'none';
    document.body.style.overflow = '';
  };
  document.getElementById('cbPlayerModalClose')?.addEventListener('click', closeModal, { once: true });
  document.getElementById('cbPlayerModalX')?.addEventListener('click', closeModal, { once: true });
}

function openPlayerFromEmbed(src) {
  const bg = document.getElementById('cbPlayerModal');
  const wrap = document.getElementById('cbModalWrap');
  if (!bg || !wrap) return;
  bg.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  wrap.innerHTML = `
    <div style="position:relative;width:100%;padding-top:56.25%;background:#000;">
      <iframe
        src="${src}"
        style="position:absolute;inset:0;width:100%;height:100%;border:none;"
        allow="autoplay; fullscreen; picture-in-picture"
        title="Video Player"
        id="cbModalPlayer"
      ></iframe>
    </div>
  `;
  const closeModal = () => {
    const iframe = document.getElementById('cbModalPlayer');
    if (iframe) iframe.src = 'about:blank';
    bg.style.display = 'none';
    document.body.style.overflow = '';
  };
  document.getElementById('cbPlayerModalClose')?.addEventListener('click', closeModal, { once: true });
  document.getElementById('cbPlayerModalX')?.addEventListener('click', closeModal, { once: true });
}

function closePlayer() {
  const bg = document.getElementById('cbPlayerModal');
  const iframe = document.getElementById('cbModalPlayer');
  if (iframe) iframe.src = 'about:blank';
  if (bg) bg.style.display = 'none';
  document.body.style.overflow = '';
}

// ── SEARCH ──────────────────────────────────────────────
function openSearch() {
  const overlay = document.getElementById('searchOverlay');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
}

function closeSearch() {
  const overlay = document.getElementById('searchOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  const inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
  const res = document.getElementById('searchResults');
  if (res) res.innerHTML = '';
  const st = document.getElementById('searchStatus');
  if (st) st.textContent = '';
}

async function doSearch(q) {
  const statusEl = document.getElementById('searchStatus');
  const resEl = document.getElementById('searchResults');
  if (!statusEl || !resEl) return;
  if (!q || q.length < 2) { statusEl.textContent = ''; resEl.innerHTML = ''; return; }

  statusEl.innerHTML = '<i class="bi bi-hourglass-split"></i> Searching…';
  resEl.innerHTML = '';
  for (let i = 0; i < 6; i++) resEl.appendChild(buildSkel());

  const { movies } = await searchOMDb(q);
  resEl.innerHTML = '';
  if (movies.length) {
    statusEl.textContent = movies.length + ' results for "' + q + '"';
    movies.forEach(m => resEl.appendChild(buildCard(m, {
      openFn: id => { closeSearch(); openModal(id); },
    })));
  } else {
    statusEl.textContent = 'No results for "' + q + '"';
    resEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text3)"><i class="bi bi-search" style="font-size:2rem;display:block;margin-bottom:0.5rem;"></i>Try a different keyword</div>';
  }
}

// ── AUTH ──────────────────────────────────────────────────
const LocalAuth = (() => {
  const KEY = 'cs_users';
  function all() { return Store.read(KEY, {}); }
  function save(users) { Store.write(KEY, users); }
  function hashPass(pass) {
    const salt = 'cinestream_salt_2026';
    let h1 = 0, h2 = 0;
    const str = salt + pass;
    for (let i = 0; i < str.length; i++) {
      h1 = Math.imul(31, h1) + str.charCodeAt(i) | 0;
      h2 = Math.imul(17, h2) + (str.charCodeAt(i) ^ (i % 31)) | 0;
    }
    return 'sh' + Math.abs(h1).toString(36) + Math.abs(h2).toString(36);
  }
  return {
    register(email, pass, name) {
      const users = all();
      if (users[email]) throw new Error('email-exists');
      users[email] = { pass: hashPass(pass), name };
      save(users);
    },
    login(email, pass) {
      const users = all();
      const u = users[email];
      if (!u) throw new Error('not-found');
      if (u.pass !== hashPass(pass)) throw new Error('wrong-password');
      return { uid: btoa(email), name: u.name || email.split('@')[0], email, photo: '' };
    },
  };
})();

function setupAuthUI() {
  function showErr(msg) { const el = document.getElementById('authError'); if (!el) return; el.textContent = msg; el.classList.add('show'); }
  function clearErr() { const el = document.getElementById('authError'); if (!el) return; el.textContent = ''; el.classList.remove('show'); }

  document.getElementById('btnGuest')?.addEventListener('click', () => {
    S.user = { ...CFG.DEMO_USER };
    Store.write('cs_user', S.user);
    const authEl = document.getElementById('authScreen');
    if (authEl) authEl.style.display = 'none';
    bootApp();
  });

  const doAuth = () => {
    const email = document.getElementById('authEmail')?.value.trim();
    const pass = document.getElementById('authPassword')?.value;
    if (!email || !pass) { showErr('Please enter email and password.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Please enter a valid email.'); return; }
    if (pass.length < 6) { showErr('Password must be at least 6 characters.'); return; }
    clearErr();
    try {
      const user = LocalAuth.login(email, pass);
      S.user = user;
      Store.write('cs_user', user);
      const authEl = document.getElementById('authScreen');
      if (authEl) authEl.style.display = 'none';
      bootApp();
    } catch (e) {
      if (e.message === 'not-found') {
        try {
          const name = email.split('@')[0];
          LocalAuth.register(email, pass, name);
          S.user = { uid: btoa(email), name, email, photo: '' };
          Store.write('cs_user', S.user);
          toast('✅ Welcome to CineStream, ' + name + '!');
          const authEl = document.getElementById('authScreen');
          if (authEl) authEl.style.display = 'none';
          bootApp();
        } catch (e2) {
          showErr('Error creating account. Please try again.');
        }
      } else {
        showErr('Incorrect password.');
      }
    }
  };

  document.getElementById('btnAuth')?.addEventListener('click', doAuth);
  document.getElementById('authPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
}

// ── BOOT ──────────────────────────────────────────────────
function bootApp() {
  if (S.appBooted) return;
  S.appBooted = true;

  const authEl = document.getElementById('authScreen');
  const appEl  = document.getElementById('app');
  if (authEl) authEl.style.display = 'none';
  if (appEl)  appEl.style.display  = 'block';

  // Update user display
  if (S.user?.name) {
    const nameEl = document.getElementById('cbMobileUserName');
    if (nameEl) nameEl.textContent = S.user.name;
    const avatar = document.getElementById('cbUserAvatar');
    if (avatar) avatar.title = S.user.name;
  }

  // Init sections
  initHero();
  renderTop10();
  populateRow('trendingMoviesRow', MOVIES_2026.slice(0, 8));
  populateRow('trendingSeriesRow', SERIES_2026.slice(0, 8));
  populateRow('popularRow', [...MOVIES_2026].reverse().slice(0, 8));
  populateRow('latestEpisodesRow', SERIES_2026.slice(0, 8));
  populateRow('latestTVRow', SERIES_2026.slice(0, 8));
  populateRow('topRatedRow', MOVIES_2026.slice(0, 8));
  initTabs();
  renderContinueWatching();

  // ── Event listeners ──
  document.getElementById('cbSearchToggle')?.addEventListener('click', openSearch);
  document.getElementById('searchCancel')?.addEventListener('click', closeSearch);
  document.getElementById('searchInput')?.addEventListener('input', function () {
    clearTimeout(S.searchTimer);
    const q = this.value.trim();
    S.searchTimer = setTimeout(() => doSearch(q), 400);
  });

  document.getElementById('cbHamburger')?.addEventListener('click', () => {
    document.getElementById('cbMobilePanel')?.classList.add('open');
    document.getElementById('cbMobileOverlay')?.classList.add('open');
    document.getElementById('cbMobilePanel')?.setAttribute('aria-hidden', 'false');
  });
  const closeMobile = () => {
    document.getElementById('cbMobilePanel')?.classList.remove('open');
    document.getElementById('cbMobileOverlay')?.classList.remove('open');
    document.getElementById('cbMobilePanel')?.setAttribute('aria-hidden', 'true');
  };
  document.getElementById('cbMobileClose')?.addEventListener('click', closeMobile);
  document.getElementById('cbMobileOverlay')?.addEventListener('click', closeMobile);

  document.getElementById('cbCwClear')?.addEventListener('click', () => {
    S.history = [];
    Store.write('cs_cw', []);
    renderContinueWatching();
    toast('Watch history cleared');
  });

  document.getElementById('cbBackTop')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Watchlist nav
  document.getElementById('cbWatchlistNav')?.addEventListener('click', e => {
    e.preventDefault();
    showWatchlistView();
  });
  document.getElementById('cbMobileWatchlist')?.addEventListener('click', e => {
    e.preventDefault();
    closeMobile();
    showWatchlistView();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('cbPlayerModal')?.style.display === 'flex') closePlayer();
      else if (document.getElementById('searchOverlay')?.classList.contains('open')) closeSearch();
      else if (document.getElementById('cbMobilePanel')?.classList.contains('open')) closeMobile();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  // Header scroll
  window.addEventListener('scroll', () => {
    document.getElementById('cbHeader')?.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(r => console.log('[SW] registered', r.scope))
      .catch(e => console.warn('[SW] failed:', e.message));
  }

  // PWA install
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    S.installEvt = e;
  });
}

// ── WATCHLIST VIEW ────────────────────────────────────────
function showWatchlistView() {
  // Scroll to watchlist section
  const main = document.querySelector('.cb-container');
  const wlSection = document.getElementById('watchlistSection');
  if (!wlSection) return;

  // Hide all sections, show watchlist
  const sections = document.querySelectorAll('.cb-container > .cb-section');
  sections.forEach(s => { if (s !== wlSection) s.style.display = 'none'; });
  wlSection.style.display = '';
  refreshWatchlistView();
  wlSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Add back button functionality
  if (!document.getElementById('wlBackBtn')) {
    const header = wlSection.querySelector('.cb-section-header');
    if (header) {
      const backBtn = document.createElement('button');
      backBtn.id = 'wlBackBtn';
      backBtn.className = 'cb-btn cb-btn-ghost';
      backBtn.innerHTML = '<i class="bi bi-arrow-left"></i> Back';
      backBtn.style.fontSize = '0.85rem';
      backBtn.addEventListener('click', () => {
        sections.forEach(s => { s.style.removeProperty('display'); });
        wlSection.style.display = 'none';
        backBtn.remove();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      header.prepend(backBtn);
    }
  }
}

// ── ENTRY ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Toast container
  const toasts = document.createElement('div');
  toasts.id = 'toasts';
  toasts.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
  document.body.appendChild(toasts);

  const saved = Store.read('cs_user', null);
  if (saved?.uid) {
    S.user = saved;
    bootApp();
    return;
  }

  // Show auth screen
  const authEl = document.getElementById('authScreen');
  if (authEl) authEl.style.display = 'flex';
  setupAuthUI();
});
