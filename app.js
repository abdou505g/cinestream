'use strict';
/* ═══════════════════════════════════════════════════════════════
   CineStream v3.2 — app.js  (FULLY DEBUGGED)
   Fixes applied: 28 bugs / performance / security / structural
═══════════════════════════════════════════════════════════════ */

// ── POLYFILLS — cross-browser compatibility ──────────────────────
// Promise.allSettled: not available in Safari < 13, Chrome < 76
if (typeof Promise.allSettled !== 'function') {
  Promise.allSettled = function(promises) {
    return Promise.all(promises.map(p =>
      Promise.resolve(p).then(
        value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason })
      )
    ));
  };
}

// ── APP CONFIG ───────────────────────────────────────────────────
const CFG = {
  OMDB_KEY:     '4b251b1e',
  OMDB:         'https://www.omdbapi.com/',
  PLAY:         'https://www.playimdb.com/title/',
  HERO_MS:      7000,
  CACHE_TTL_MS: 48 * 60 * 60 * 1000,   // 48 h
  CACHE_MAX:    120,
  BATCH_SIZE:   3,                       // FIX #11: rate-limit concurrent fetches
  DEMO_USER:    { uid:'guest', name:'Guest', email:'guest@cinestream.app', photo:'' },
  STORE_VER:    2,                       // bump when storage schema changes
  FETCH_RETRIES: 2,                      // retry failed API calls
};

const ROWS = [

  // ── 0. Continue Watching ────────────────────────────────────────
  { id:'cw', title:'▶ Continue Watching', ids:[], cw:true },

  // ── 1. NOW IN THEATERS (صدر فعلاً في 2026) ─────────────────────
  { id:'now2026', title:'🎬 Now in Theaters',
    ids:[
      'tt32141377', // 28 Years Later: The Bone Temple  (Jan 16)  ⭐7.5
      'tt12042730', // Project Hail Mary  (Mar 20)                ⭐8.7
      'tt28650488', // The Super Mario Galaxy Movie  (Apr 1)
      'tt14539740', // Mickey 17  (2025)
      'tt15474026', // Captain America: Brave New World  (2025)
      'tt21692408', // Thunderbolts  (2025)
    ]},

  // ── 2. COMING SOON (لم يصدر بعد — May 2026 فصاعداً) ───────────
  { id:'soon2026', title:'📅 Coming Soon',
    ids:[
      'tt30825738', // The Mandalorian & Grogu     May 22
      'tt29355505', // Toy Story 5                 Jun 19
      'tt33764258', // The Odyssey — Nolan          Jul 17
      'tt22084616', // Spider-Man: Brand New Day    Jul 31
      'tt21357150', // Avengers: Doomsday           Dec 18
      'tt31378509', // Dune: Part Three             Dec 18
    ]},

  // ── 3. MOST POPULAR THIS WEEK ──────────────────────────────────
  { id:'popular', title:'🔥 Most Popular This Week',
    ids:[
      'tt12042730', // Project Hail Mary
      'tt28650488', // Super Mario Galaxy Movie
      'tt30825738', // Mandalorian & Grogu
      'tt21823606', // Dune: Part Two
      'tt9603212',  // Deadpool & Wolverine
      'tt22687790', // Gladiator II
      'tt11198330', // The Last of Us S2
      'tt21276558', // Severance S2
    ]},

  // ── 4. MOST POPULAR ON TV ──────────────────────────────────────
  { id:'popularTV', title:'📺 Most Popular on TV',
    ids:[
      'tt11198330', // The Last of Us S2
      'tt21276558', // Severance S2
      'tt21255044', // Shōgun  ⭐8.6
      'tt15398776', // Fallout
      'tt13560574', // 3 Body Problem
      'tt10234724', // The Boys S4
      'tt14544192', // House of the Dragon S2
      'tt20766284', // Ripley
    ]},

  // ── 5. FAN FAVORITES (تقييم 8.0+) ─────────────────────────────
  { id:'fanfav', title:'⭐ Fan Favorites',
    ids:[
      'tt0111161',  // The Shawshank Redemption  9.3
      'tt0468569',  // The Dark Knight           9.0
      'tt1375666',  // Inception                 8.8
      'tt0816692',  // Interstellar              8.7
      'tt12042730', // Project Hail Mary         8.7
      'tt21255044', // Shōgun                    8.6
      'tt4154796',  // Avengers: Endgame         8.4
      'tt21823606', // Dune: Part Two            8.5
    ]},

  // ── 6. TOP RATED ALL TIME (IMDb Top 250) ───────────────────────
  { id:'top250', title:'🏆 Top Rated All Time',
    ids:[
      'tt0111161',  // The Shawshank Redemption  9.3
      'tt0068646',  // The Godfather             9.2
      'tt0071562',  // The Godfather Part II     9.0
      'tt0468569',  // The Dark Knight           9.0
      'tt0050083',  // 12 Angry Men              9.0
      'tt0108052',  // Schindler's List          9.0
      'tt0137523',  // Fight Club                8.8
      'tt1375666',  // Inception                 8.8
    ]},

  // ── 7. BY GENRE ────────────────────────────────────────────────
  { id:'action', title:'🎭 Action',
    ids:['tt0468569','tt21823606','tt9603212','tt22687790',
         'tt4154796','tt1877832','tt3498820','tt2015381'] },

  { id:'drama',  title:'🎭 Drama',
    ids:['tt0111161','tt0068646','tt0050083','tt0108052',
         'tt12042730','tt20766284','tt0993846','tt0167260'] },

  { id:'comedy', title:'😂 Comedy',
    ids:['tt0120382','tt0910970','tt6263850','tt28650488',
         'tt1853728','tt2562232','tt4154756','tt6751668'] },

  { id:'scifi',  title:'🚀 Sci-Fi',
    ids:['tt0133093','tt1375666','tt0816692','tt31378509',
         'tt21823606','tt15398776','tt13560574','tt12042730'] },

  { id:'horror', title:'👻 Horror',
    ids:['tt32141377','tt5052448','tt7784604','tt6644200',
         'tt1457767','tt8772262','tt1396484','tt0081505'] },

  // ── 8. DRAMA SERIES ────────────────────────────────────────────
  { id:'drama_series', title:'🎭 Drama Series',
    ids:[
      'tt0944947', // Game of Thrones
      'tt0903747', // Breaking Bad
      'tt2356777', // True Detective
      'tt4574334', // Stranger Things
      'tt11198330',// The Last of Us
      'tt21255044',// Shōgun 2024
      'tt20766284',// Ripley 2024
      'tt0386676',  // The Office
    ]},

  // ── 9. NATURE & EXPLORATION ────────────────────────────────────
  { id:'nature', title:'🌍 Nature & Exploration',
    ids:[
      'tt39298503', // Wild London — Attenborough (2026)    ⭐8.1
      'tt32869282', // Asia — BBC/Attenborough (2024)        ⭐8.6
      'tt31971270', // Mammals — BBC/Attenborough (2024)     ⭐8.5
      'tt0469049',  // Planet Earth (2006)                   ⭐9.4
      'tt6760304',  // Blue Planet II (2017)                 ⭐9.3
      'tt8110460',  // Our Planet — Netflix (2019)           ⭐9.3
      'tt10001378', // Seven Worlds One Planet (2019)        ⭐9.1
      'tt5491994',  // Planet Earth II (2016)                ⭐9.4
    ]},

  // ── 10. DOCUMENTARY ────────────────────────────────────────────
  { id:'docs', title:'🎬 Documentary',
    ids:[
      'tt12888462', // My Octopus Teacher (2020)   Oscar
      'tt7775622',  // Free Solo (2018)            Oscar ⭐8.2
      'tt8420184',  // The Last Dance (2020)        ⭐9.1
      'tt5189670',  // Making a Murderer (2015)     ⭐8.6
      'tt3288592',  // The Jinx (2015)              ⭐8.7
      'tt2234222',  // Blackfish (2013)             ⭐8.1
      'tt1517451',  // Exit Through the Gift Shop   ⭐7.9
      'tt0816575',  // An Inconvenient Truth        ⭐7.4
    ]},

  // ── 11. TRUE CRIME ─────────────────────────────────────────────
  { id:'truecrime', title:'🔍 True Crime',
    ids:[
      'tt5189670',  // Making a Murderer
      'tt3288592',  // The Jinx
      'tt11823076', // Tiger King (2020)
      'tt11455292', // Don't F**k with Cats (2019)
      'tt9174558',  // The Keepers (2017)           ⭐8.2
      'tt4878800',  // Amanda Knox (2016)
      'tt8364978',  // Evil Genius (2018)
      'tt31556143', // Homicide (2024–2026)          ⭐8.4
    ]},

  // ── 12. SCIENCE & SPACE ────────────────────────────────────────
  { id:'science', title:'🔭 Science & Space',
    ids:[
      'tt2395695',  // Cosmos: A Spacetime Odyssey (2014)   ⭐9.3
      'tt0081846',  // Cosmos — Carl Sagan (1980)           ⭐9.3
      'tt14216232', // Life on Our Planet (2023)
      'tt8110460',  // Our Planet
      'tt0103984',  // A Brief History of Time (1991)
      'tt1302814',  // Into the Universe with Stephen Hawking
      'tt12042730', // Project Hail Mary (2026)
      'tt0816692',  // Interstellar
    ]},

  // ── 13. REALITY & SURVIVAL ─────────────────────────────────────
  { id:'reality', title:'🏕️ Reality & Survival',
    ids:[
      'tt4803766',  // Alone (2015–)                 ⭐8.2
      'tt0382650',  // Man vs. Wild (2006–)
      'tt0364784',  // Survivor (2000–)
      'tt0363307',  // MythBusters (2003–)
      'tt1843323',  // The Amazing Race
      'tt6741278',  // Dark (Germany)
      'tt0285331',  // The Amazing Race
      'tt3107288',  // Chef's Table (2015)           ⭐8.6
    ]},
];

const MOVIE_IDS = [
  'tt32141377','tt12042730','tt28650488', // 2026 — released
  'tt30825738','tt33764258','tt21357150', // 2026 — coming
  'tt21823606','tt9603212','tt6263850',   // 2024
  'tt14539740','tt15474026','tt21692408', // 2025
  'tt0468569','tt0111161','tt1375666',    // classics
];
const SERIES_IDS = [
  'tt11198330','tt21276558',               // 2025
  'tt21255044','tt15398776','tt13560574',  // 2024
  'tt10234724','tt14544192','tt20766284',
  'tt0944947','tt0903747','tt4574334',     // drama classics
  'tt5491994','tt0386676','tt2861424',
  'tt32869282','tt31971270','tt39298503',  // nature
  'tt0469049','tt6760304','tt8110460',
  'tt5189670','tt3288592','tt11823076',    // true crime
  'tt2395695','tt4803766','tt3107288',     // science / reality
];
const GENRES     = ['All','Action','Adventure','Comedy','Crime','Drama','Fantasy','Horror','Romance','Sci-Fi','Thriller','Animation'];

// ── VALID IMDb ID ────────────────────────────────────────────────
// FIX #20: validate all IMDb IDs before using in URLs
const IMDB_RE = /^tt\d{7,8}$/;
function validId(id) { return typeof id === 'string' && IMDB_RE.test(id); }
function safePlayUrl(id) { return validId(id) ? CFG.PLAY + id : '#'; }

/* ══════════════════════════════════════════════════════
   SMART STORAGE  — safe reads, LRU+TTL cache, quota guard
══════════════════════════════════════════════════════ */
const Store = (() => {
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      console.warn('[Store] Corrupted "' + key + '", resetting.', e);
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

/* ── STORAGE VERSION MIGRATION ──────────────────────────────────── */
(function migrateStore() {
  const ver = Store.read('cs_ver', 0);
  if (ver < CFG.STORE_VER) {
    // On version bump: evict stale API cache & search history only
    if (ver < 2) { Store.remove('cs_cache'); Store.remove('cs_sq'); }
    Store.write('cs_ver', CFG.STORE_VER);
    console.info('[Store] Migrated to v' + CFG.STORE_VER);
  }
})();

/* ── LRU + TTL Movie Cache ───────────────────────────────────── */
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
      // FIX #12: enforce CACHE_MAX on every write, not just at boot
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

/* ── STATE ─────────────────────────────────────────────────────── */
const S = {
  user: null,
  appBooted: false,
  watchlist: Store.read('cs_wl',    []),
  history:   Store.read('cs_cw',    []),
  ratings:   Store.read('cs_stars', {}),
  searches:  Store.read('cs_sq',    []),
  heroMovies: [], heroIdx: 0, heroInterval: null,
  activeView: 'home', activeGenre: 'All',
  installEvt: null,
  searchTimer: null,
  searchToken: 0,          // FIX #1: token to discard stale search results
  confirmResult: null, recaptcha: null,
  _inflight: {},
  _visHandler: null,       // FIX #2: store handler ref to remove on logout
};

/* ── HELPERS ───────────────────────────────────────────────────── */
const $  = (s, c=document) => c.querySelector(s);
const $$ = (s, c=document) => [...c.querySelectorAll(s)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// XSS-safe escape for innerHTML insertion
function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function toast(msg, ms=3000) {
  const c = $('#toasts'); if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms + 300);
}

function loadImg(img, src, cls='on') {
  if (!img) return;
  if (!src || src === 'N/A') { img.style.display = 'none'; return; }
  img.src = src;
  img.onload  = () => {
    img.classList.add(cls);
    const ph = img.previousElementSibling;
    if (ph?.classList.contains('card-ph')) ph.style.display = 'none';
  };
  img.onerror = () => { img.style.display = 'none'; };
}

/* ── API ───────────────────────────────────────────────────────── */
// Retry helper: exponential back-off, respects offline state
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

// In-memory search cache: avoids re-fetching identical queries
const _searchCache = new Map(); // query → { movies, total, ts }
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 min

// Promise dedup: concurrent calls for same id share one fetch
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

// FIX #11: batch fetches to avoid overwhelming the API
async function fetchBatch(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += CFG.BATCH_SIZE) {
    const chunk  = ids.slice(i, i + CFG.BATCH_SIZE);
    const batch  = await Promise.allSettled(chunk.map(id => fetchMovie(id)));
    results.push(...batch);
    if (i + CFG.BATCH_SIZE < ids.length) await new Promise(r => setTimeout(r, 120));
  }
  return results;
}

async function searchOMDb(q, page=1) {
  const cacheKey = q + '|' + page;
  const hit = _searchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return { movies: hit.movies, total: hit.total };

  try {
    const r = await fetchWithRetry(CFG.OMDB + '?s=' + encodeURIComponent(q) + '&page=' + page + '&apikey=' + CFG.OMDB_KEY);
    const d = await r.json();
    if (d.Response === 'True') {
      // FIX #20: only cache valid IMDb IDs from search results
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

/* ── WATCHLIST ─────────────────────────────────────────────────── */
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

// FIX #9: manipulate DOM nodes safely without innerHTML
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

/* ── HISTORY ───────────────────────────────────────────────────── */
function addHistory(movie) {
  if (!movie?.imdbID) return;
  const idx = S.history.findIndex(m => m.imdbID === movie.imdbID);
  if (idx >= 0) S.history.splice(idx, 1);
  S.history.unshift({
    imdbID: movie.imdbID, Title: movie.Title, Year: movie.Year,
    Poster: movie.Poster, Type: movie.Type, imdbRating: movie.imdbRating,
    progress: Math.floor(Math.random() * 75) + 15, ts: Date.now(),
  });
  S.history = S.history.slice(0, 12);
  Store.write('cs_cw', S.history);
}

/* ── CARD ──────────────────────────────────────────────────────── */
function buildCard(movie, opts={}) {
  const { wide=false, cw=false, openFn=null } = opts;
  const card = document.createElement('div');
  card.className = 'card' + (wide ? ' w' : '');
  card.dataset.id = movie.imdbID;

  // Poster wrapper
  const poster = document.createElement('div');
  poster.className = 'card-poster';

  // Placeholder
  const ph = document.createElement('div');
  ph.className = 'card-ph';
  ph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const phSpan = document.createElement('span');
  phSpan.textContent = movie.Title || '';    // FIX #10: textContent not innerHTML
  ph.appendChild(phSpan);

  const img = document.createElement('img');
  img.alt = movie.Title || '';
  img.loading = 'lazy';
  loadImg(img, movie.Poster);
  poster.appendChild(ph);
  poster.appendChild(img);

  // Rating badge
  if (movie.imdbRating && movie.imdbRating !== 'N/A') {
    const badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.innerHTML = '<svg viewBox="0 0 16 16" fill="#f5c518"><path d="M8 1l1.854 3.756 4.146.602-3 2.924.708 4.128L8 10.25l-3.708 2.16L5 8.282 2 5.358l4.146-.602z"/></svg>';
    badge.appendChild(document.createTextNode(movie.imdbRating));
    poster.appendChild(badge);
  }

  // Heart / watchlist
  const in_wl = isWL(movie.imdbID);
  const heart = document.createElement('button');
  heart.className = 'card-heart' + (in_wl ? ' liked' : '');
  heart.dataset.wl = movie.imdbID;
  heart.setAttribute('aria-label', isWL(movie.imdbID) ? 'Remove from watchlist' : 'Add to watchlist');
  const hSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  hSvg.setAttribute('viewBox', '0 0 24 24');
  hSvg.setAttribute('fill', in_wl ? 'currentColor' : 'none');
  hSvg.setAttribute('stroke', 'currentColor');
  hSvg.setAttribute('stroke-width', '2');
  hSvg.innerHTML = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>';
  heart.appendChild(hSvg);
  heart.addEventListener('click', async e => {
    e.stopPropagation();
    const m = MovieCache.get(movie.imdbID) || await fetchMovie(movie.imdbID) || movie;
    toggleWatchlist(m);
    heart.setAttribute('aria-label', isWL(movie.imdbID) ? 'Remove from watchlist' : 'Add to watchlist');
  });
  poster.appendChild(heart);

  // Hover overlay
  const over = document.createElement('div');
  over.className = 'card-over';
  over.innerHTML =
    '<div class="card-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>'
    + '<div class="card-over-title">' + esc(movie.Title) + '</div>'
    + '<div class="card-over-meta">'
    + (movie.imdbRating && movie.imdbRating !== 'N/A' ? '<span class="card-over-rating">⭐ ' + esc(movie.imdbRating) + '</span>' : '')
    + '<span>' + esc(movie.Year) + '</span></div>';
  poster.appendChild(over);

  // Continue-watching extras
  if (cw) {
    const prog = document.createElement('div'); prog.className = 'card-prog';
    const bar  = document.createElement('div'); bar.className  = 'card-prog-bar';
    bar.style.width = (movie.progress || 30) + '%';
    prog.appendChild(bar); poster.appendChild(prog);
    const cwBadge = document.createElement('div');
    cwBadge.className = 'card-cw-badge'; cwBadge.textContent = 'Continue';
    poster.appendChild(cwBadge);
  }

  card.appendChild(poster);
  const info = document.createElement('div'); info.className = 'card-info';
  const nm = document.createElement('div'); nm.className = 'card-name';
  nm.title = movie.Title || ''; nm.textContent = movie.Title || 'Unknown';
  const yr = document.createElement('div'); yr.className = 'card-year';
  yr.textContent = movie.Year || '';
  info.appendChild(nm); info.appendChild(yr);
  card.appendChild(info);

  card.addEventListener('click', () => { if (openFn) openFn(movie.imdbID); else openModal(movie.imdbID); });
  return card;
}

function buildSkel(wide=false) {
  const el = document.createElement('div');
  el.className = 'card-skel' + (wide ? ' w' : '');
  el.innerHTML =
    '<div class="img-skel skel" style="aspect-ratio:' + (wide ? '16/9' : '2/3') + ';margin-bottom:8px;border-radius:8px;"></div>'
    + '<div class="t-skel skel" style="height:11px;width:80%;border-radius:4px;margin-bottom:5px;"></div>'
    + '<div class="y-skel skel" style="height:9px;width:40%;border-radius:4px;"></div>';
  return el;
}

/* ── ROW ───────────────────────────────────────────────────────── */
function buildRow(row) {
  const sec = document.createElement('div');
  sec.className = 'row'; sec.id = 'row-' + row.id;

  // FIX #13: use textContent for title to avoid any injection risk
  const header = document.createElement('div'); header.className = 'row-header';
  const h2 = document.createElement('h2'); h2.className = 'row-title';
  h2.textContent = row.title;
  header.appendChild(h2); sec.appendChild(header);

  const wrap = document.createElement('div'); wrap.className = 'slider-wrap';
  const btnR = document.createElement('button'); btnR.className = 'arr r'; btnR.setAttribute('aria-label', 'Previous');
  btnR.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>';
  const slider = document.createElement('div'); slider.className = 'slider'; slider.id = 'slider-' + row.id;
  const btnL = document.createElement('button'); btnL.className = 'arr l'; btnL.setAttribute('aria-label', 'Next');
  btnL.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>';

  if (!row.cw) for (let i = 0; i < 6; i++) slider.appendChild(buildSkel());
  btnR.addEventListener('click', () => slider.scrollBy({ left: -440, behavior: 'smooth' }));
  btnL.addEventListener('click', () => slider.scrollBy({ left:  440, behavior: 'smooth' }));
  wrap.appendChild(btnR); wrap.appendChild(slider); wrap.appendChild(btnL);
  sec.appendChild(wrap);
  return sec;
}

async function populateRow(row) {
  const slider = $('#slider-' + row.id); if (!slider) return;

  if (row.cw) {
    slider.innerHTML = '';
    if (!S.history.length) { $('#row-cw')?.classList.add('hidden'); return; }
    $('#row-cw')?.classList.remove('hidden');
    S.history.forEach(m => slider.appendChild(buildCard(m, { wide: true, cw: true })));
    return;
  }

  try {
    // FIX #11: use batched fetch instead of all-at-once
    const res   = await fetchBatch(row.ids);
    const valid = res.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    slider.innerHTML = '';
    if (!valid.length) {
      slider.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;">Could not load titles.</div>';
      return;
    }
    valid.forEach(m => slider.appendChild(buildCard(m)));
  } catch(e) {
    console.error('[Row]', row.id, e);
    slider.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;">Error loading titles.</div>';
  }
}

/* ── HERO ──────────────────────────────────────────────────────── */
async function initHero() {
  // 2025 first, then 2024, then a classic fallback
  const ids = [
    'tt12042730', // Project Hail Mary (2026)        ⭐8.7
    'tt32141377', // 28 Years Later: The Bone Temple (2026)
    'tt28650488', // The Super Mario Galaxy Movie (2026)
    'tt30825738', // The Mandalorian & Grogu (Coming May 2026)
    'tt33764258', // The Odyssey — Nolan (Coming Jul 2026)
    'tt21357150', // Avengers: Doomsday (Coming Dec 2026)
  ];
  const res  = await Promise.allSettled(ids.map(id => fetchMovie(id)));
  S.heroMovies = res.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  if (!S.heroMovies.length) return;

  renderHero(0); buildDots(); startHeroTimer();

  // FIX #2: store handler ref so we can remove it cleanly on logout
  if (S._visHandler) document.removeEventListener('visibilitychange', S._visHandler);
  S._visHandler = () => {
    if (document.hidden) clearInterval(S.heroInterval);
    else startHeroTimer();
  };
  document.addEventListener('visibilitychange', S._visHandler);
}

function renderHero(idx) {
  const m = S.heroMovies[idx]; if (!m) return;
  const bg = $('#heroBgImg');
  if (bg) { bg.classList.remove('on'); bg.style.opacity = ''; setTimeout(() => loadImg(bg, m.Poster, 'on'), 60); }

  const tags = $('#heroTags');
  if (tags) {
    tags.innerHTML = '';
    const t1 = document.createElement('span'); t1.className = 'hero-tag'; t1.textContent = '#1 Today'; tags.appendChild(t1);
    if (m.Type) { const t2 = document.createElement('span'); t2.className = 'hero-tag type'; t2.textContent = m.Type === 'series' ? 'Series' : 'Movie'; tags.appendChild(t2); }
  }

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v || ''; };
  set('#heroTitle',   m.Title);
  set('#heroYear',    m.Year);
  set('#heroRuntime', m.Runtime && m.Runtime !== 'N/A' ? m.Runtime : '');
  set('#heroPlot',    m.Plot    && m.Plot    !== 'N/A' ? m.Plot    : '');
  set('#heroRating',  m.imdbRating && m.imdbRating !== 'N/A' ? '⭐ ' + m.imdbRating : '');

  // FIX #20: validate ID before building URL
  const pb = $('#heroPlay');
  if (pb) pb.href = safePlayUrl(m.imdbID);
  // FIX #17: add noreferrer to external link
  if (pb) pb.rel = 'noopener noreferrer';

  const ib = $('#heroInfo'); if (ib) ib.dataset.id = m.imdbID;
  const lb = $('#heroLike'); if (lb) { lb.dataset.id = m.imdbID; lb.classList.toggle('liked', isWL(m.imdbID)); }
  updateDots();
}

function buildDots() {
  const c = $('#heroDots'); if (!c) return; c.innerHTML = '';
  S.heroMovies.forEach((_, i) => {
    const b = document.createElement('button');
    b.className = 'hero-dot' + (i === 0 ? ' on' : '');
    b.setAttribute('aria-label', 'Slide ' + (i + 1));
    b.addEventListener('click', () => { S.heroIdx = i; renderHero(i); resetHeroTimer(); });
    c.appendChild(b);
  });
}

function updateDots() { $$('.hero-dot').forEach((d, i) => d.classList.toggle('on', i === S.heroIdx)); }

function startHeroTimer() {
  let elapsed = 0; clearInterval(S.heroInterval);
  S.heroInterval = setInterval(() => {
    if (document.hidden) return;
    elapsed += 100;
    const bar = $('#heroProgressBar'); if (bar) bar.style.width = Math.min(elapsed / CFG.HERO_MS * 100, 100) + '%';
    if (elapsed >= CFG.HERO_MS) {
      elapsed = 0;
      S.heroIdx = (S.heroIdx + 1) % S.heroMovies.length;
      renderHero(S.heroIdx);
    }
  }, 100);
}

function resetHeroTimer() { const b = $('#heroProgressBar'); if (b) b.style.width = '0%'; startHeroTimer(); }

/* ── GENRE FILTER ──────────────────────────────────────────────── */
function buildGenreBar() {
  const bar = $('#genreBar'); if (!bar) return;
  GENRES.forEach(g => {
    const c = document.createElement('button');
    c.className = 'genre-chip' + (g === 'All' ? ' active' : '');
    c.textContent = g;
    c.addEventListener('click', () => {
      $$('.genre-chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active'); S.activeGenre = g; filterRows(g);
    });
    bar.appendChild(c);
  });
}

// FIX #14: only filter rows where we have cached data; skip CW row
function filterRows(genre) {
  $$('.row').forEach(row => {
    if (row.id === 'row-cw') return;
    if (genre === 'All') { row.style.display = ''; return; }
    const cards = $$('.card', row);
    // FIX #14: only count cards with cached data — unloaded cards are hidden
    const any = cards.some(card => {
      const m = MovieCache.get(card.dataset.id);
      return m && m.Genre && m.Genre.toLowerCase().includes(genre.toLowerCase());
    });
    row.style.display = any ? '' : 'none';
  });
}

/* ── MODAL ─────────────────────────────────────────────────────── */
async function openModal(id, push = true) {
  if (!validId(id)) return;  // FIX #20
  if (push && S.appBooted) history.pushState({ modal: id, prevView: S.activeView }, '', '#title/' + id);
  const bg = $('#modalBg'), modal = $('#modal');
  if (!bg || !modal) return;

  // FIX #3: session token to discard stale async callbacks
  const session = Symbol();
  modal._session = session;

  modal.innerHTML = '<div style="min-height:300px;display:flex;align-items:center;justify-content:center;"><div style="text-align:center;color:var(--text2)"><div class="skel" style="width:48px;height:48px;border-radius:50%;margin:0 auto 1rem;"></div>Loading…</div></div>';
  bg.classList.add('open');
  document.body.style.overflow = 'hidden';

  const m = MovieCache.get(id) || await fetchMovie(id);
  if (modal._session !== session) return; // modal was replaced

  if (!m) {
    modal.innerHTML = '<div style="padding:3rem;text-align:center;color:var(--text2)">Could not load data.<br><button id="mcb" style="margin-top:1rem;background:var(--red);border:none;color:white;padding:8px 20px;border-radius:8px;cursor:pointer;font-family:inherit;">Close</button></div>';
    $('#mcb')?.addEventListener('click', closeModal);
    return;
  }

  addHistory(m); populateRow(ROWS[0]);

  const genres = m.Genre ? m.Genre.split(', ') : [];
  const stars  = S.ratings[id] || 0;
  const inWL   = isWL(id);
  const playUrl = safePlayUrl(id); // FIX #20: validated URL

  modal.innerHTML =
    '<div class="modal-hero">'
    + '<img id="modalImg" alt="' + esc(m.Title) + '"/>'
    + '<div class="modal-hero-grad"></div>'
    + '<button class="modal-close" id="modalCloseBtn" aria-label="Close">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>'
    + '<div class="modal-body">'
    + '<h2 class="modal-title">' + esc(m.Title) + '</h2>'
    + '<div class="modal-meta">'
    + (m.imdbRating && m.imdbRating !== 'N/A' ? '<span class="tag-rating"><svg viewBox="0 0 16 16" fill="#f5c518" width="12"><path d="M8 1l1.854 3.756 4.146.602-3 2.924.708 4.128L8 10.25l-3.708 2.16L5 8.282 2 5.358l4.146-.602z"/></svg>' + esc(m.imdbRating) + '</span>' : '')
    + (m.Year     ? '<span class="tag-year">'    + esc(m.Year)    + '</span>' : '')
    + (m.Runtime  && m.Runtime  !== 'N/A' ? '<span class="tag-runtime">' + esc(m.Runtime)  + '</span>' : '')
    + (m.Rated    && m.Rated    !== 'N/A' ? '<span class="tag-rated">'   + esc(m.Rated)    + '</span>' : '')
    + (m.Type     ? '<span class="tag-rated">' + (m.Type === 'series' ? 'Series' : 'Movie') + '</span>' : '')
    + '</div>'
    + (m.Plot && m.Plot !== 'N/A' ? '<p class="modal-plot">' + esc(m.Plot) + '</p>' : '')
    + (genres.length ? '<div class="modal-genres">' + genres.map(g => '<span class="genre-tag">' + esc(g) + '</span>').join('') + '</div>' : '')
    + '<div class="modal-info">'
    + (m.Director  && m.Director  !== 'N/A' ? '<div><div class="info-label">Director</div><div class="info-val">'   + esc(m.Director)  + '</div></div>' : '')
    + (m.Actors    && m.Actors    !== 'N/A' ? '<div><div class="info-label">Cast</div><div class="info-val">'       + esc(m.Actors)    + '</div></div>' : '')
    + (m.Country   && m.Country   !== 'N/A' ? '<div><div class="info-label">Country</div><div class="info-val">'    + esc(m.Country)   + '</div></div>' : '')
    + (m.Language  && m.Language  !== 'N/A' ? '<div><div class="info-label">Language</div><div class="info-val">'   + esc(m.Language)  + '</div></div>' : '')
    + (m.Awards    && m.Awards    !== 'N/A' ? '<div><div class="info-label">Awards</div><div class="info-val">'     + esc(m.Awards)    + '</div></div>' : '')
    + (m.BoxOffice && m.BoxOffice !== 'N/A' ? '<div><div class="info-label">Box Office</div><div class="info-val">' + esc(m.BoxOffice) + '</div></div>' : '')
    + '</div>'
    + '<div class="modal-rate"><div class="rate-label">Your Rating</div>'
    + '<div class="stars" id="modalStars" role="group" aria-label="Rate this title">'
    + [1,2,3,4,5].map(n => '<span class="star' + (n <= stars ? ' on' : '') + '" data-n="' + n + '" role="button" tabindex="0" aria-label="' + n + ' star' + (n>1?'s':'') + '">★</span>').join('')
    + '</div></div>'
    + '<div class="modal-actions">'
    // FIX #17: rel="noopener noreferrer" on external link
    + '<a href="' + playUrl + '" target="_blank" rel="noopener noreferrer" class="modal-play-btn" id="modalPlayBtn">'
    + '<svg viewBox="0 0 24 24" fill="currentColor" width="20"><path d="M8 5v14l11-7z"/></svg> Play Now</a>'
    + '<button class="modal-secondary-btn' + (inWL ? ' added' : '') + '" id="modalWlBtn" data-wl="' + esc(id) + '">'
    + '<svg viewBox="0 0 24 24" fill="' + (inWL ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" width="18"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
    + ' ' + (inWL ? 'In My List' : 'Add to List') + '</button>'
    + '<button class="modal-secondary-btn" id="modalShareBtn">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>'
    + ' Share</button>'
    + '</div>'
    + '<div class="similar-row" id="similarRow"><div class="similar-title">More Like This</div>'
    + '<div class="similar-grid" id="similarGrid"></div></div>'
    + '</div>';

  loadImg($('#modalImg'), m.Poster, 'on');

  // FIX #16: no onclick=closeModal() global, use event listener
  $('#modalCloseBtn')?.addEventListener('click', closeModal);

  // Stars — keyboard accessible too
  $$('.star', modal).forEach(s => {
    const handler = () => {
      const n = +s.dataset.n; S.ratings[id] = n; Store.write('cs_stars', S.ratings);
      $$('.star', modal).forEach((x, i) => x.classList.toggle('on', i < n));
      toast('Rated "' + m.Title + '" ' + n + '★');
    };
    s.addEventListener('click', handler);
    s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });

  const wlBtn = $('#modalWlBtn');
  if (wlBtn) {
    wlBtn.addEventListener('click', async () => {
      const full = MovieCache.get(id) || await fetchMovie(id) || m;
      toggleWatchlist(full); refreshWLBtns(id);
    });
  }

  $('#modalShareBtn')?.addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: m.Title, text: 'Watch "' + m.Title + '" on CineStream', url: playUrl }); }
      catch(e) { /* user cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(playUrl); toast('🔗 Link copied!'); }
      catch(e) { toast('Link: ' + playUrl); }
    }
  });

  $('#modalPlayBtn')?.addEventListener('click', () => { addHistory(m); toast('▶ Playing "' + m.Title + '"'); });

  loadSimilar(m, genres[0], session);
}

async function loadSimilar(movie, genre, session) {
  if (!genre) return;
  const { movies } = await searchOMDb(genre);
  const modal = $('#modal'); if (!modal || modal._session !== session) return;
  const grid = $('#similarGrid'); if (!grid) return;
  const similar = movies.filter(x => x.imdbID !== movie.imdbID).slice(0, 6);
  grid.innerHTML = '';
  similar.forEach(x => {
    grid.appendChild(buildCard(x, {
      openFn: id => { closeModal(); setTimeout(() => openModal(id), 200); },
    }));
  });
}

// FIX #16: not exposed on window — called via event listener only
function closeModal(goBack = true) {
  if (goBack && history.state?.modal) { history.back(); return; }
  _doCloseModal();
}
function _doCloseModal() {
  $('#modalBg')?.classList.remove('open');
  document.body.style.overflow = '';
  const m = $('#modal'); if (m) m._session = null;
}
// Minimal global exposure needed for fallback close button only
window._csCloseModal = closeModal;

/* ── VIEWS ─────────────────────────────────────────────────────── */
function showView(name, push = true) {
  if (push && S.appBooted) history.pushState({ view: name }, '', '#' + name);
  S.activeView = name;
  $$('.nav-pill').forEach(p => p.classList.toggle('active', p.dataset.view === name));
  $('#viewHome')?.classList.toggle('hidden', name !== 'home');

  // FIX #15: explicit mapping instead of fragile string manipulation
  const viewMap = { movies:'viewMovies', series:'viewSeries', watchlist:'viewWatchlist' };
  ['viewMovies','viewSeries','viewWatchlist'].forEach(vid => {
    $(('#' + vid))?.classList.toggle('active', vid === viewMap[name]);
  });

  if (name === 'watchlist') refreshWatchlistView();
  if (name === 'movies')    populatePageGrid('moviesGrid', MOVIE_IDS);
  if (name === 'series')    populatePageGrid('seriesGrid', SERIES_IDS);
}

async function populatePageGrid(gridId, ids) {
  const g = $(('#' + gridId)); if (!g || g.dataset.loaded) return;
  g.dataset.loaded = '1';
  ids.forEach(() => g.appendChild(buildSkel()));
  // FIX #11: batched fetching
  const res = await fetchBatch(ids);
  g.innerHTML = '';
  res.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).forEach(m => g.appendChild(buildCard(m)));
}

function refreshWatchlistView() {
  const c = $('#watchlistContent'); if (!c) return;
  if (!S.watchlist.length) {
    c.innerHTML = '<div class="empty-page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><h3>Your list is empty</h3><p>Tap the bookmark icon on any title to save it here.</p></div>';
    return;
  }
  c.innerHTML = '';
  const g = document.createElement('div'); g.className = 'page-grid';
  S.watchlist.forEach(m => g.appendChild(buildCard(m)));
  c.appendChild(g);
}

/* ── SEARCH ────────────────────────────────────────────────────── */
function openSearch() {
  $('#searchOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#searchInput')?.focus(), 100);
  renderHistoryTags();
}

// FIX #4: clear pending debounce timer when search is closed
function closeSearch() {
  clearTimeout(S.searchTimer); // FIX #4
  S.searchTimer = null;
  $('#searchOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
  const inp = $('#searchInput'); if (inp) inp.value = '';
  const res = $('#searchResults'); if (res) res.innerHTML = '';
  const st  = $('#searchStatus');  if (st)  st.textContent = '';
}

function renderHistoryTags() {
  const c = $('#historyTags'); if (!c) return;
  c.innerHTML = '';
  if (!S.searches.length) { $('#searchHistory')?.classList.add('hidden'); return; }
  $('#searchHistory')?.classList.remove('hidden');
  S.searches.slice(0, 8).forEach(q => {
    const tag = document.createElement('div'); tag.className = 'history-tag';
    tag.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    tag.appendChild(document.createTextNode(q)); // FIX #10: safe text insertion
    tag.addEventListener('click', () => { const i = $('#searchInput'); if (i) i.value = q; doSearch(q); });
    c.appendChild(tag);
  });
}

// FIX #1: token-based race condition prevention for search
async function doSearch(q) {
  const statusEl = $('#searchStatus'), resEl = $('#searchResults'), histEl = $('#searchHistory');
  if (!statusEl || !resEl) return;
  if (!q || q.length < 2) return;

  // Increment token — any earlier async call with a smaller token is stale
  const token = ++S.searchToken;

  statusEl.textContent = 'Searching…'; resEl.innerHTML = ''; histEl?.classList.add('hidden');
  S.searches = [q, ...S.searches.filter(x => x !== q)].slice(0, 10);
  Store.write('cs_sq', S.searches);

  const { movies, total } = await searchOMDb(q);

  // FIX #1: discard stale result
  if (token !== S.searchToken) return;
  // FIX #1: discard if overlay was closed
  if (!$('#searchOverlay')?.classList.contains('open')) return;

  statusEl.textContent = total ? total.toLocaleString() + ' results for "' + q + '"' : 'No results for "' + q + '"';
  resEl.innerHTML = '';

  if (!movies.length) {
    resEl.innerHTML = '<div class="empty-page" style="grid-column:1/-1;padding:2rem 0;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>Nothing found</h3><p>Try a different term.</p></div>';
    return;
  }

  movies.forEach(m => resEl.appendChild(buildCard(m, {
    openFn: id => { closeSearch(); openModal(id); },
  })));
}

// ── AUTH (Local only) ─────────────────────────────────────────────
// Simple local users stored in localStorage — no Firebase needed
const LocalAuth = (() => {
  const KEY = 'cs_users';
  function all() { return Store.read(KEY, {}); }
  function save(users) { Store.write(KEY, users); }
  // Simple hash to avoid plaintext passwords in localStorage
  function hashPass(pass) {
    let h = 0;
    for (let i = 0; i < pass.length; i++) { h = Math.imul(31, h) + pass.charCodeAt(i) | 0; }
    return 'h' + Math.abs(h).toString(36);
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

/* ── AUTH UI ────────────────────────────────────────────────────── */
function setupAuthUI() {
  function showErr(msg) { const el = $('#authError'); if (!el) return; el.textContent = msg; el.classList.add('show'); }
  function clearErr()   { const el = $('#authError'); if (!el) return; el.textContent = ''; el.classList.remove('show'); }

  // Auto-focus email field
  setTimeout(() => $('#authEmail')?.focus(), 300);

  // Password toggle
  $('#passwordToggle')?.addEventListener('click', () => {
    const input = $('#authPassword');
    const btn = $('#passwordToggle');
    if (!input || !btn) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.querySelector('.eye-open')?.classList.toggle('hidden', isPassword);
    btn.querySelector('.eye-closed')?.classList.toggle('hidden', !isPassword);
  });

  // Guest button - primary action
  $('#btnGuest')?.addEventListener('click', () => {
    S.user = { ...CFG.DEMO_USER };
    Store.write('cs_user', S.user);
    bootApp();
    _handleInitialHash();
  });

  // Smart auth button - handles both login and signup
  const btn = $('#btnAuth');
  const origText = btn?.textContent || 'Continue';
  
  function setLoading(on) {
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? 'Please wait…' : origText;
  }

  $('#btnAuth')?.addEventListener('click', () => {
    const email = $('#authEmail')?.value.trim();
    const pass = $('#authPassword')?.value;
    
    if (!email || !pass) {
      showErr('Please enter both email and password.');
      return;
    }
    if (pass.length < 6) {
      showErr('Password must be at least 6 characters.');
      return;
    }
    
    clearErr();
    setLoading(true);
    
    try {
      // Try login first
      const user = LocalAuth.login(email, pass);
      S.user = user;
      Store.write('cs_user', user);
      bootApp();
      _handleInitialHash();
    } catch(e) {
      if (e.message === 'not-found') {
        // Account doesn't exist - create it automatically
        try {
          const name = email.split('@')[0];
          LocalAuth.register(email, pass, name);
          const user = { uid: btoa(email), name, email, photo: '' };
          S.user = user;
          Store.write('cs_user', user);
          toast('✅ Account created! Welcome to CineStream.');
          bootApp();
          _handleInitialHash();
        } catch(e2) {
          showErr('Error creating account: ' + ferr(e2.message));
          setLoading(false);
        }
      } else {
        showErr(ferr(e.message));
        setLoading(false);
      }
    }
  });

  // Enter key handler
  $$('#authEmail, #authPassword').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#btnAuth')?.click();
    });
  });
}

function ferr(code) {
  const map = {
    'email-exists':    'Email already registered.',
    'not-found':       'No account found with this email.',
    'wrong-password':  'Incorrect password.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

/* ── BOOT ──────────────────────────────────────────────────────── */
function bootApp() {
  if (S.appBooted) return;
  S.appBooted = true;

  $('#authScreen')?.classList.add('hidden');
  $('#app')?.classList.remove('hidden');

  // Update user UI
  const u = S.user, av = $('#userAvatar');
  if (av && u) {
    if (u.photo) {
      const img = document.createElement('img');
      img.src = u.photo; img.alt = u.name;
      img.onerror = () => { av.textContent = u.name.charAt(0).toUpperCase(); };
      av.innerHTML = ''; av.appendChild(img);
    } else {
      av.textContent = u.name.charAt(0).toUpperCase();
    }
  }
  const dn = $('#ddName');  if (dn && u) dn.textContent  = u.name;
  const de = $('#ddEmail'); if (de && u) de.textContent = u.email;

  setupAppEvents();
  buildGenreBar();
  const content = $('#content');
  if (content) {
    ROWS.forEach(row => {
      const s = buildRow(row);
      if (row.cw && !S.history.length) s.classList.add('hidden');
      content.appendChild(s);
    });
  }
  initHero();
  // Use IntersectionObserver to load rows only when they scroll into view
  // Falls back to immediate load if IO not supported
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const rowEl = entry.target;
        const row   = ROWS.find(r => 'row-' + r.id === rowEl.id);
        if (row && !rowEl.dataset.loaded) { rowEl.dataset.loaded = '1'; populateRow(row); }
        obs.unobserve(rowEl);
      });
    }, { rootMargin: '300px' });
    ROWS.filter(r => !r.cw).forEach(row => {
      const el = $('#row-' + row.id);
      if (el) io.observe(el);
    });
  } else {
    ROWS.filter(r => !r.cw).forEach((row, i) => setTimeout(() => populateRow(row), i * 300));
  }
  populateRow(ROWS[0]);
}

function setupAppEvents() {
  $$('.nav-pill').forEach(p => p.addEventListener('click', () => showView(p.dataset.view)));
  $('#logoHome')?.addEventListener('click', e => { e.preventDefault(); showView('home'); });
  $$('.dropdown-item[data-view]').forEach(el => el.addEventListener('click', () => { showView(el.dataset.view); $('#userDropdown')?.classList.remove('open'); }));
  $('#userAvatar')?.addEventListener('click', e => { e.stopPropagation(); $('#userDropdown')?.classList.toggle('open'); });
  document.addEventListener('click', () => $('#userDropdown')?.classList.remove('open'));

  $('#logoutBtn')?.addEventListener('click', () => {
    Store.remove('cs_user');
    S.user = null; S.appBooted = false;
    // FIX #2: remove visibilitychange listener on logout
    if (S._visHandler) { document.removeEventListener('visibilitychange', S._visHandler); S._visHandler = null; }
    clearInterval(S.heroInterval); S.heroInterval = null;
    // FIX #5: reset hero state fully
    S.heroMovies = []; S.heroIdx = 0;
    // FIX #4: cancel any pending search
    clearTimeout(S.searchTimer); S.searchTimer = null;
    // Reset loaded grids so they reload on next login
    ['moviesGrid','seriesGrid'].forEach(id => { const g = $(('#' + id)); if (g) { g.innerHTML = ''; delete g.dataset.loaded; } });
    const c = $('#content'); if (c) c.innerHTML = '';
    $('#app')?.classList.add('hidden');
    $('#authScreen')?.classList.remove('hidden');
    toast('Signed out successfully.');
  });

  $('#searchBtn')?.addEventListener('click', openSearch);
  $('#searchClose')?.addEventListener('click', closeSearch);
  $('#searchInput')?.addEventListener('input', e => {
    clearTimeout(S.searchTimer);
    const q = e.target.value.trim();
    const res = $('#searchResults'), st = $('#searchStatus');
    if (!q) { renderHistoryTags(); if (res) res.innerHTML = ''; if (st) st.textContent = ''; return; }
    S.searchTimer = setTimeout(() => doSearch(q), 400);
  });

  $('#heroInfo')?.addEventListener('click', () => { const id = $('#heroInfo')?.dataset.id; if (id) openModal(id); });
  $('#heroLike')?.addEventListener('click', async () => {
    const id = $('#heroLike')?.dataset.id; if (!id) return;
    const m = MovieCache.get(id) || await fetchMovie(id);
    if (m) toggleWatchlist(m);
  });
  $('#modalBg')?.addEventListener('click', e => { if (e.target === $('#modalBg')) closeModal(); });

  $('#shareApp')?.addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title:'CineStream', url }); } catch(e) { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(url); toast('🔗 App link copied!'); } catch(e) { /* fallback */ } }
    $('#userDropdown')?.classList.remove('open');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#modalBg')?.classList.contains('open')) closeModal();
      else if ($('#searchOverlay')?.classList.contains('open')) closeSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  window.addEventListener('scroll', () => $('#nav')?.classList.toggle('scrolled', window.scrollY > 50), { passive: true });

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; $('#installBtn')?.classList.add('show'); });
  $('#installBtn')?.addEventListener('click', async () => {
    if (!S.installEvt) return; S.installEvt.prompt();
    const { outcome } = await S.installEvt.userChoice;
    if (outcome === 'accepted') toast('🎉 CineStream installed!');
    S.installEvt = null; $('#installBtn')?.classList.remove('show');
  });
  window.addEventListener('appinstalled', () => { toast('✅ App installed!'); $('#installBtn')?.classList.remove('show'); });

  // ── iOS Safari install hint ─────────────────────────────────────
  // iOS doesn't support beforeinstallprompt — show a manual hint instead
  const isIOS    = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && isSafari && !isStandalone) {
    const banner    = $('#iosInstallBanner');
    const dismissed = localStorage.getItem('cs_ios_banner') === '1';
    if (banner && !dismissed) {
      // Show after a 3-second delay so it doesn't distract on first load
      setTimeout(() => { banner.style.display = 'flex'; }, 3000);
      $('#iosInstallClose')?.addEventListener('click', () => {
        banner.style.display = 'none';
        localStorage.setItem('cs_ios_banner', '1');
      });
    }
  }

  // ── BACK / FORWARD NAVIGATION ──────────────────────────────────
  window.addEventListener('popstate', e => {
    if (!S.appBooted) return;
    const st = e.state;
    if (st?.modal) {
      _doCloseModal(); // close current if any, then open target
      openModal(st.modal, false);
    } else if (st?.view) {
      _doCloseModal();
      showView(st.view, false);
    } else {
      _doCloseModal();
      showView('home', false);
    }
  });

  // ── NETWORK STATUS ─────────────────────────────────────────────
  window.addEventListener('offline', () => toast('⚠️ You\'re offline — showing cached content'));
  window.addEventListener('online',  () => {
    toast('✅ Back online!');
    // Re-attempt hero if it failed while offline
    if (!S.heroMovies.length) initHero();
  });

}

/* ── ENTRY ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // ── SERVICE WORKER — register immediately, before auth ───────────
  // Runs on ALL browsers that support SW (Chrome, Firefox, Edge, Samsung, Safari 11.1+)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => {
        console.log('[SW] registered', reg.scope);

        // Listen for a new SW waiting to take over
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            // New SW installed and old one is still controlling the page
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // Tell the new SW to skip waiting and activate immediately
              newSW.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(e => console.warn('[SW] registration failed:', e.message));

    // When the new SW takes control, reload once so users get fresh content
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
  setupAuthUI();

  // Restore persisted session
  const saved = Store.read('cs_user', null);
  if (saved?.uid) { S.user = saved; bootApp(); _handleInitialHash(); return; }
});

// Handle hash-based deep links on first load (e.g. shared #title/tt0111161)
function _handleInitialHash() {
  const hash = location.hash.replace('#', '');
  if (!hash) { history.replaceState({ view: 'home' }, '', '#home'); return; }
  if (hash.startsWith('title/')) {
    const id = hash.split('/')[1];
    if (validId(id)) { history.replaceState({ view: 'home' }, '', '#home'); openModal(id); return; }
  }
  const view = ['home','movies','series','watchlist'].includes(hash) ? hash : 'home';
  history.replaceState({ view }, '', '#' + view);
  if (view !== 'home') showView(view, false);
}
