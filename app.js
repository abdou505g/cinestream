'use strict';

/* ════════════════════════════════════════════════════════════════
   CineStream v3.2 – FINAL (May 2026)
   Modern UI inspired by StreamIMDB – fully functional
═══════════════════════════════════════════════════════════════ */

// ── CONFIG ────────────────────────────────────────────────────
const CFG = {
  OMDB_KEY: '4b251b1e',
  OMDB: 'https://www.omdbapi.com/',
  PLAY: 'https://www.playimdb.com/title/',
  STREAM_MOVIE: 'https://streamimdb.ru/embed/movie/',
  STREAM_TV: 'https://streamimdb.ru/embed/tv/',
  VAPLAYER_API: 'https://streamdata.vaplayer.ru/api.php',
  HERO_MS: 7000,
  CACHE_TTL_MS: 48 * 60 * 60 * 1000,
  CACHE_MAX: 120,
  BATCH_SIZE: 3,
  DEMO_USER: { uid:'guest', name:'Guest', email:'guest@cinestream.app', photo:'' },
  STORE_VER: 2,
  FETCH_RETRIES: 2,
};

// ── 2026 MOVIES & SERIES ─────────────────────────────────────
const MOVIES_2026 = [
  'tt32141377', // The Punisher: One Last Kill
  'tt1314481',  // The Devil Wears Prada 2
  'tt1325734',  // The Drama
  'tt1317448',  // No Place to Be Single
  'tt1007757',  // Swapped
  'tt1226863',  // Super Mario Galaxy
  'tt687163',   // Project Hail Mary
  'tt1439930',  // Apex
  'tt1214931',  // Nuremberg
  'tt21692408', // My Dearest Assassin
  'tt22084616', // Ready or Not: Here I Come
];

const SERIES_2026 = [
  'tt11198330', // The Boys
  'tt21276558', // FROM
  'tt823a8',    // Daredevil: Born Again
  'tt52fl4',    // Citadel
  'tt4xc7q',    // Legends
  'tt71xh8',    // Off Campus
  'tt3nbq5',    // Devil May Cry
  'tt3nthr',    // House of the Spirits
  'tt4sab5',    // Perfect Crown
  'tt1s4yc',    // My Royal Nemesis
];

const GENRES = ['All', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Thriller'];

// ── VALIDATION ──────────────────────────────────────────────
const IMDB_RE = /^tt\d{7,8}$/;
function validId(id) { return typeof id === 'string' && IMDB_RE.test(id); }
function safePlayUrl(id) { return validId(id) ? CFG.PLAY + id : '#'; }
function sanitizeUrl(url) {
  if (typeof url !== 'string') return '#';
  url = url.trim();
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return '#';
}
function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

// ── STORE ──────────────────────────────────────────────────
const Store = (() => {
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      console.warn('[Store] Corrupted "' + key + '", resetting.');
      try { localStorage.removeItem(key); } catch(_) {}
      return fallback;
    }
  }
  function write(key, value) {
    const str = JSON.stringify(value);
    try { localStorage.setItem(key, str); }
    catch(e) {
      console.warn('[Store] Quota exceeded, evicting cache…');
      try { localStorage.removeItem('cs_cache'); localStorage.setItem(key, str); }
      catch(_) { console.error('[Store] Write failed after eviction.'); }
    }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch(_) {} }
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
  heroMovies: [], heroIdx: 0, heroInterval: null,
  activeView: 'home', activeGenre: 'All',
  installEvt: null,
  searchTimer: null,
  searchToken: 0,
  _inflight: {},
  _visHandler: null,
  playerStartTime: null,
  playerMovieId: null,
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

function loadImg(img, src, cls = 'on') {
  if (!img) return;
  if (!src || src === 'N/A') { img.style.display = 'none'; return; }
  img.src = src;
  img.onload = () => {
    img.classList.add(cls);
    const ph = img.previousElementSibling;
    if (ph?.classList.contains('card-ph')) ph.style.display = 'none';
  };
  img.onerror = () => { img.style.display = 'none'; };
}

// ── API ──────────────────────────────────────────────────
async function fetchWithRetry(url, retries = CFG.FETCH_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch(e) {
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
    } catch(e) {
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
  } catch(e) {
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
    toast('Removed "' + movie.Title + '" from watchlist');
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
  const in_ = isWL(id);
  $$('[data-wl="' + id + '"]').forEach(btn => {
    btn.classList.toggle('liked', in_);
    btn.classList.toggle('added', in_);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', in_ ? 'currentColor' : 'none');
    const tn = [...btn.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
    if (tn) tn.textContent = ' ' + (in_ ? 'In My List' : 'Add to List');
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
    progress: prevProgress, ts: Date.now(),
  });
  S.history = S.history.slice(0, 12);
  Store.write('cs_cw', S.history);
}

// ── CARD (StreamIMDB style) ──────────────────────────────
function buildCard(movie, opts = {}) {
  const { wide = false, cw = false, openFn = null } = opts;
  const card = document.createElement('div');
  card.className = 'cb-card';
  card.dataset.id = movie.imdbID;

  const poster = document.createElement('div');
  poster.className = 'cb-card-poster';

  const img = document.createElement('img');
  img.alt = movie.Title || '';
  img.loading = 'lazy';
  img.src = movie.Poster && movie.Poster !== 'N/A' ? movie.Poster : '';
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => { img.style.display = 'none'; };
  poster.appendChild(img);

  const overlay = document.createElement('div');
  overlay.className = 'cb-card-overlay';
  overlay.innerHTML = `
    <div class="cb-card-play"><i class="bi bi-play-fill"></i></div>
    <div class="cb-card-overlay-title">${esc(movie.Title)}</div>
    <div class="cb-card-overlay-meta">
      ${movie.imdbRating && movie.imdbRating !== 'N/A' ? '⭐ ' + esc(movie.imdbRating) : ''}
      ${movie.Year ? ' · ' + esc(movie.Year) : ''}
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
    <p class="cb-card-meta">${esc(movie.Year || '')}</p>
  `;
  card.appendChild(info);

  const handler = () => { if (openFn) openFn(movie.imdbID); else openModal(movie.imdbID); };
  card.addEventListener('click', handler);
  return card;
}

function buildSkel() {
  const el = document.createElement('div');
  el.className = 'cb-card skel';
  el.innerHTML = `
    <div class="cb-card-poster">
      <div class="skel-img" style="aspect-ratio:2/3;border-radius:8px;"></div>
    </div>
    <div class="cb-card-info">
      <div class="skel-text" style="height:11px;width:80%;margin-bottom:4px;"></div>
      <div class="skel-text" style="height:9px;width:40%;"></div>
    </div>
  `;
  return el;
}

// ── HERO SLIDER ───────────────────────────────────────────
async function initHero() {
  const hero = document.getElementById('cbHero');
  if (!hero) return;
  const slides = hero.querySelectorAll('.cb-slide');
  const dots = hero.querySelectorAll('.cb-dot');
  if (!slides.length) return;
  let current = 0, timer = null;

  function show(idx) {
    slides.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    current = idx;
  }
  function next() { if (slides.length) show((current + 1) % slides.length); }
  function prev() { if (slides.length) show((current - 1 + slides.length) % slides.length); }
  function resetTimer() { clearInterval(timer); if (slides.length > 1) timer = setInterval(next, CFG.HERO_MS); }

  document.getElementById('cbSliderPrev')?.addEventListener('click', () => { prev(); resetTimer(); });
  document.getElementById('cbSliderNext')?.addEventListener('click', () => { next(); resetTimer(); });
  dots.forEach(d => d.addEventListener('click', function() { show(parseInt(this.dataset.idx) || 0); resetTimer(); }));

  // Touch swipe
  let tx = 0, ty = 0;
  hero.addEventListener('touchstart', e => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  hero.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? next() : prev();
      resetTimer();
    }
  }, { passive: true });

  resetTimer();

  // Play buttons inside hero
  hero.querySelectorAll('.cb-slide-play').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const src = this.getAttribute('data-embed');
      if (src) openPlayerFromEmbed(src);
    });
  });
}

// ── ROW POPULATION ──────────────────────────────────────
async function populateRow(containerId, ids, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  // Show skeletons
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
    item.innerHTML = `
      <span class="cb-top10-number">${i + 1}</span>
      <div class="cb-top10-poster">
        <img src="${m.Poster !== 'N/A' ? m.Poster : ''}" alt="${esc(m.Title)}" width="120" height="180" loading="lazy">
      </div>
    `;
    item.addEventListener('click', e => { e.preventDefault(); openModal(m.imdbID); });
    container.appendChild(item);
  });
}

// ── TABS ──────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.cb-tab').forEach(btn => {
    btn.addEventListener('click', function() {
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

// ── MODAL ────────────────────────────────────────────────
async function openModal(id, push = true) {
  if (!validId(id)) return;
  if (push && S.appBooted) history.pushState({ modal: id, prevView: S.activeView }, '', '#title/' + id);

  const bg = document.getElementById('cbPlayerModal');
  const modal = document.querySelector('.cb-player-modal-body');
  if (!bg || !modal) return;

  bg.style.display = '';
  document.body.style.overflow = 'hidden';

  const m = MovieCache.get(id) || await fetchMovie(id);
  if (!m) {
    toast('Could not load title.');
    bg.style.display = 'none';
    return;
  }

  addHistory(m);
  renderContinueWatching();

  // Build modal content
  const wrap = modal.querySelector('.cb-player-modal-wrap');
  if (wrap) {
    wrap.innerHTML = `
      <div style="padding:2rem;max-width:600px;margin:0 auto;">
        <img src="${m.Poster !== 'N/A' ? m.Poster : ''}" alt="${esc(m.Title)}" style="width:100%;border-radius:12px;margin-bottom:1rem;">
        <h2 style="font-size:1.8rem;font-weight:700;">${esc(m.Title)}</h2>
        <div style="display:flex;gap:12px;margin:8px 0;color:var(--text2);">
          ${m.imdbRating && m.imdbRating !== 'N/A' ? '<span>⭐ ' + esc(m.imdbRating) + '</span>' : ''}
          <span>${esc(m.Year || '')}</span>
          <span>${esc(m.Runtime || '')}</span>
        </div>
        <p style="line-height:1.6;color:rgba(255,255,255,0.8);">${esc(m.Plot || '')}</p>
        <div style="display:flex;gap:12px;margin-top:1.5rem;">
          <button class="cb-btn cb-btn-play" data-id="${esc(id)}" style="flex:1;"><i class="bi bi-play-fill"></i> Play</button>
          <button class="cb-btn cb-btn-ghost-sm" data-wl="${esc(id)}"><i class="bi bi-bookmark${isWL(id) ? '-fill' : ''}"></i> ${isWL(id) ? 'In List' : 'Add to List'}</button>
        </div>
      </div>
    `;
    wrap.querySelector('.cb-btn-play')?.addEventListener('click', () => { closePlayer(); openPlayer(id); });
    wrap.querySelector('[data-wl]')?.addEventListener('click', async function() {
      const full = MovieCache.get(id) || await fetchMovie(id) || m;
      toggleWatchlist(full);
      this.innerHTML = `<i class="bi bi-bookmark${isWL(id) ? '-fill' : ''}"></i> ${isWL(id) ? 'In List' : 'Add to List'}`;
    });
  }

  document.getElementById('cbPlayerModalClose')?.addEventListener('click', () => { bg.style.display = 'none'; document.body.style.overflow = ''; });
  document.getElementById('cbPlayerModalX')?.addEventListener('click', () => { bg.style.display = 'none'; document.body.style.overflow = ''; });
}

// ── PLAYER ──────────────────────────────────────────────
function openPlayer(id) {
  const bg = document.getElementById('cbPlayerModal');
  const wrap = document.querySelector('.cb-player-modal-wrap');
  const iframe = document.getElementById('cbModalPlayer');
  if (!bg || !wrap || !iframe) return;

  bg.style.display = '';
  document.body.style.overflow = 'hidden';

  // Use the embed URL
  const embedUrl = CFG.STREAM_MOVIE + id;
  iframe.src = embedUrl;

  // Update modal content to show just the iframe
  wrap.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'width:100%;height:100%;min-height:60vh;position:relative;';
  const loader = document.createElement('div');
  loader.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  loader.innerHTML = '<div class="spinner"></div>';
  container.appendChild(loader);
  container.appendChild(iframe);
  wrap.appendChild(container);

  iframe.onload = () => { loader.style.display = 'none'; };

  document.getElementById('cbPlayerModalClose')?.addEventListener('click', closePlayer);
  document.getElementById('cbPlayerModalX')?.addEventListener('click', closePlayer);
}

function openPlayerFromEmbed(src) {
  const bg = document.getElementById('cbPlayerModal');
  const iframe = document.getElementById('cbModalPlayer');
  if (!bg || !iframe) return;
  bg.style.display = '';
  document.body.style.overflow = 'hidden';
  iframe.src = src;
  document.getElementById('cbPlayerModalClose')?.addEventListener('click', closePlayer);
  document.getElementById('cbPlayerModalX')?.addEventListener('click', closePlayer);
}

function closePlayer() {
  const bg = document.getElementById('cbPlayerModal');
  const iframe = document.getElementById('cbModalPlayer');
  if (bg) bg.style.display = 'none';
  if (iframe) iframe.src = 'about:blank';
  document.body.style.overflow = '';
}

// ── WATCHLIST VIEW ────────────────────────────────────────
function refreshWatchlistView() {
  const c = document.getElementById('watchlistContent');
  if (!c) return;
  if (!S.watchlist.length) {
    c.innerHTML = '<div class="empty-page"><i class="bi bi-bookmark" style="font-size:3rem;opacity:0.3;"></i><h3>Your list is empty</h3><p>Tap the bookmark icon on any title to save it here.</p></div>';
    return;
  }
  c.innerHTML = '';
  const g = document.createElement('div');
  g.className = 'page-grid';
  S.watchlist.forEach(m => g.appendChild(buildCard(m)));
  c.appendChild(g);
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
  if (!q || q.length < 2) return;

  statusEl.textContent = 'Searching…';
  resEl.innerHTML = '';

  const { movies } = await searchOMDb(q);
  statusEl.textContent = movies.length ? movies.length + ' results for "' + q + '"' : 'No results for "' + q + '"';
  movies.forEach(m => resEl.appendChild(buildCard(m, {
    openFn: id => { closeSearch(); openModal(id); },
  })));
}

// ── AUTH ──────────────────────────────────────────────────
const LocalAuth = (() => {
  const KEY = 'cs_users';
  function all() { return Store.read(KEY, {}); }
  function save(users) { Store.write(KEY, users); }
  function hashPass(pass) {
    const salt = 'cinestream_salt_2024';
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
    bootApp();
  });

  document.getElementById('btnAuth')?.addEventListener('click', () => {
    const email = document.getElementById('authEmail')?.value.trim();
    const pass = document.getElementById('authPassword')?.value;
    if (!email || !pass) { showErr('Please enter both email and password.'); return; }
    if (pass.length < 6) { showErr('Password must be at least 6 characters.'); return; }
    clearErr();
    try {
      const user = LocalAuth.login(email, pass);
      S.user = user;
      Store.write('cs_user', user);
      bootApp();
    } catch(e) {
      if (e.message === 'not-found') {
        try {
          const name = email.split('@')[0];
          LocalAuth.register(email, pass, name);
          S.user = { uid: btoa(email), name, email, photo: '' };
          Store.write('cs_user', S.user);
          toast('✅ Account created! Welcome to CineStream.');
          bootApp();
        } catch(e2) {
          showErr('Error creating account.');
        }
      } else {
        showErr('Incorrect password.');
      }
    }
  });
}

// ── BOOT ──────────────────────────────────────────────────
function bootApp() {
  if (S.appBooted) return;
  S.appBooted = true;

  document.getElementById('authScreen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');

  initHero();
  renderTop10();
  populateRow('trendingMoviesRow', MOVIES_2026.slice(0, 6));
  populateRow('trendingSeriesRow', SERIES_2026.slice(0, 6));
  populateRow('popularRow', MOVIES_2026.slice(0, 8));
  populateRow('latestEpisodesRow', SERIES_2026.slice(0, 6));
  populateRow('latestTVRow', SERIES_2026.slice(0, 8));
  populateRow('topRatedRow', MOVIES_2026.slice(0, 6));
  initTabs();
  renderContinueWatching();

  // ── Event listeners ──
  document.getElementById('cbSearchToggle')?.addEventListener('click', openSearch);
  document.getElementById('cbHamburger')?.addEventListener('click', () => {
    document.getElementById('cbMobilePanel')?.classList.toggle('open');
  });
  document.getElementById('cbMobileClose')?.addEventListener('click', () => {
    document.getElementById('cbMobilePanel')?.classList.remove('open');
  });
  document.getElementById('cbBackTop')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('cbPlayerModal')?.style.display === '') closePlayer();
      else if (document.getElementById('searchOverlay')?.classList.contains('open')) closeSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  // Scroll effect on header
  window.addEventListener('scroll', () => {
    document.getElementById('cbHeader')?.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(r => console.log('[SW] registered', r.scope))
      .catch(e => console.warn('[SW] failed:', e.message));
  }
}

// ── ENTRY ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Create toast container
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
  document.getElementById('authScreen')?.classList.remove('hidden');
  setupAuthUI();
});