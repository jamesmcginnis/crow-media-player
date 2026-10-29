/*
 * Crow Media Player — Library, radio, podcasts and audiobooks
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.library) return;
const { crowFetch, crowMediaAppleLegacyMap, crowMediaAppleLegacyUrl, crowMediaRelays } = K.kit;


Object.assign(K.Card.prototype, {
  // ── iOS-style Library View ──────────────────────────────────────────────

  _syncMAViewToggle() {
    const r = this.shadowRoot;
    const iosView    = r.getElementById('maIosView');
    const maContent  = r.getElementById('maContent');
    const maTabs     = r.getElementById('maTabs');
    const searchRow  = r.querySelector('.ma-search-row');
    const iosSearchBar = r.getElementById('maIosSearchBar');
    if (!iosView) return;

    iosView.classList.remove('hidden');
    maContent.style.display = 'none';
    if (maTabs)       maTabs.style.display       = 'none';
    if (searchRow)    searchRow.style.display    = 'none';
    if (iosSearchBar) iosSearchBar.classList.add('hidden'); // hidden on category list
    this._renderMAIosView();
  },

  // Recent Searches — a flat, capped-at-50, most-recent-first log of actual
  // searches performed anywhere in the library (per-tab MA search, the
  // AI-interpreted per-tab search, and the standalone AI Search panel).
  // Persisted to localStorage so it survives reloads, matching every other
  // "recent"/"pinned" list in the card.
  _maGetRecentSearches() {
    try {
      const list = JSON.parse(localStorage.getItem('crow_media_ma_recent_searches') || '[]');
      // lyrics searches came from a feature that has since been removed
      return Array.isArray(list) ? list.filter(e => e && e.tab !== 'lyrics') : [];
    } catch (_) { return []; }
  },

  _maRecordRecentSearch(tab, query) {
    if (!query || !query.trim()) return;
    const q = query.trim();
    let list = this._maGetRecentSearches();
    // Re-searching something already in the list moves it to the top
    // instead of creating a duplicate entry.
    list = list.filter(e => !(e.tab === tab && (e.query || '').toLowerCase() === q.toLowerCase()));
    list.unshift({ tab, query: q, ts: Date.now() });
    if (list.length > 50) list = list.slice(0, 50);
    try { localStorage.setItem('crow_media_ma_recent_searches', JSON.stringify(list)); } catch (_) {}
  },

  _maClearRecentSearches() {
    try { localStorage.removeItem('crow_media_ma_recent_searches'); } catch (_) {}
  },

  _renderRecentSearchesTab(content) {
    if (!content) return;
    const _recent = this._maGetRecentSearches();
    const esc = s => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (!_recent.length) {
      content.innerHTML = this._psEmpty(
        'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
        'No recent searches',
        'Searches you run anywhere in the library will show up here.'
      );
      return;
    }

    const _tabLabels = {
      track: 'Songs', artist: 'Artists', album: 'Albums', playlist: 'Playlists',
      recently_added: 'Recently Added', radio: 'Radio', podcast: 'Podcasts',
      audiobook: 'Audiobooks', movie_tv: 'Movies & TV',
      ai_track: 'AI · Songs', ai_artist: 'AI · Artists', ai_album: 'AI · Albums',
      ai_search: 'AI Search',
    };

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:flex-end;padding:2px 4px 8px;">
        <span id="recentSearchesClearBtn" style="font-size:12px;color:#63b3ed;cursor:pointer;-webkit-tap-highlight-color:transparent;">Clear</span>
      </div>
      <div id="recentSearchesList"></div>`;

    const list = content.querySelector('#recentSearchesList');
    _recent.forEach((e, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'ma-item-wrap';
      const el = document.createElement('div');
      el.className = 'ma-item';
      el.innerHTML =
        `<div class="ma-item-art" style="position:relative;background:${this._pt("bg")};display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>
        </div>
        <div class="ma-item-info"><div class="ma-item-title">${esc(e.query)}</div>
          <div class="ma-item-sub">${esc(_tabLabels[e.tab] || e.tab)}</div>
        </div>`;
      wrap.appendChild(el);
      const _again = () => {
        if (e.tab.startsWith('ai_') && e.tab !== 'ai_search') {
          const _realTab = e.tab.slice(3);
          this._maCurrentTab = _realTab;
          this._doAiLibrarySearch(_realTab, e.query);
        } else if (e.tab === 'ai_search') {
          this._showAISearchPanel(e.query);
        } else {
          this._maCurrentTab = e.tab;
          this._searchMA(e.query);
        }
      };
      wrap.addEventListener('click', _again);
      this._wireRowMenu(el, wrap, () => [
        { id: 'rsAgain', label: 'Search Again', icon: 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z', run: _again },
        { id: 'rsRemove', label: 'Remove', danger: true, icon: 'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z', run: () => {
          const q = (e.query || '').toLowerCase();
          const rest = this._maGetRecentSearches().filter(x => !(x.tab === e.tab && (x.query || '').toLowerCase() === q));
          try { localStorage.setItem('crow_media_ma_recent_searches', JSON.stringify(rest)); } catch (_) {}
          this._renderRecentSearchesTab(content);
        } },
      ], { right: ['rsAgain'], left: ['rsRemove', 'more'] });
      list.appendChild(wrap);
    });

    content.querySelector('#recentSearchesClearBtn')?.addEventListener('click', async () => {
      const ok = await this._iosConfirm({
        title: 'Clear Recent Searches?',
        message: 'This permanently deletes your search history. This can\u2019t be undone.',
        confirmLabel: 'Clear', destructive: true,
      });
      if (!ok) return;
      this._maClearRecentSearches();
      this._renderRecentSearchesTab(content);
    });
  },

  // Countries with an Apple Music storefront (and so a chart)
  _chartAppleCountries() {
    return ('ae ag ai am ao ar at au az ba bb be bg bh bj bm bn bo br bs bt bw by bz ca cd cg ch ci cl cm cn co cr cv cy cz de dk dm do dz ec ee eg es fi fj fm fr ga gb gd ge gh gm gr gt gw gy hk hn hr hu id ie il in iq is it jm jo jp ke kg kh kn kr kw ky kz la lb lc lk lr lt lu lv ly ma md me mg mk ml mm mn mo mr ms mt mu mv mw mx my mz na ne ng ni nl no np nr nz om pa pe pg ph pl pt pw py qa ro rs ru rw sa sb sc se sg si sk sl sn sr sv sz tc td th tj tm tn to tr tt tw tz ua ug us uy uz vc ve vg vn vu xk ye za zm zw').split(' ');
  },

  _chartCountryName(cc) {
    try { return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(String(cc).toUpperCase()) || cc.toUpperCase(); }
    catch (_) { return String(cc).toUpperCase(); }
  },

  // The chart country: the user's own (Home Assistant's country, then the browser's)
  _chartCountry() {
    const ok = new Set(this._chartAppleCountries());
    const ha = String(this._hass?.config?.country || '').toLowerCase();
    if (ok.has(ha)) return ha;
    const nav = String((navigator.language || '').split('-')[1] || '').toLowerCase();
    if (ok.has(nav)) return nav;
    return 'us';
  },

  _chartIcons() {
    return {
      trophy: 'M18,2C17.1,2 16,3 16,4H8C8,3 6.9,2 6,2H2V11C2,12 3,13 4,13H6.2C6.6,15 7.9,16.7 11,17V19.08C8,19.54 8,22 8,22H16C16,22 16,19.54 13,19.08V17C16.1,16.7 17.4,15 17.8,13H20C21,13 22,12 22,11V2H18M6,11H4V4H6V11M20,11H18V4H20V11Z',
      medal: 'M12,4A6,6 0 0,1 18,10C18,13.31 15.31,16 12,16C8.69,16 6,13.31 6,10A6,6 0 0,1 12,4M12,6A4,4 0 0,0 8,10A4,4 0 0,0 12,14A4,4 0 0,0 16,10A4,4 0 0,0 12,6M7,18A1,1 0 0,1 6,17A1,1 0 0,1 7,16H17A1,1 0 0,1 18,17A1,1 0 0,1 17,18H16V22H8V18H7Z',
      globe: 'M17.9,17.39C17.64,16.59 16.89,16 16,16H15V13A1,1 0 0,0 14,12H8V10H10A1,1 0 0,0 11,9V7H13A2,2 0 0,0 15,5V4.59C17.93,5.77 20,8.64 20,12C20,14.08 19.2,15.97 17.9,17.39M11,19.93C7.05,19.44 4,16.08 4,12C4,11.38 4.08,10.78 4.21,10.21L9,15V16A2,2 0 0,0 11,18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
      mic: 'M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z',
      trend: 'M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z',
      list: 'M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A4,4 0 0,0 12,18A4,4 0 0,0 16,22A4,4 0 0,0 20,18V8H23V6H17Z',
      person: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
      disc: 'M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12,16.5C9.5,16.5 7.5,14.5 7.5,12C7.5,9.5 9.5,7.5 12,7.5C14.5,7.5 16.5,9.5 16.5,12C16.5,14.5 14.5,16.5 12,16.5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
      note: 'M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z',
    };
  },

  _chartAppleDef(cc) {
    const P = this._chartIcons();
    return { id: 'apple:' + cc, kind: 'apple', country: cc, label: 'Top Songs', color: '#FA2D48', path: P.trophy };
  },

  // Deezer's front-page sections. The named charts are Deezer's own playlists (found by their exact
  // titles, for the chart country); the last three are Deezer's live charts for where you are.
  _chartSections(cc) {
    const P = this._chartIcons();
    const n = { gb: 'UK', us: 'USA' }[cc] || this._chartCountryName(cc);
    const S = [];
    if (cc === 'gb') S.push({ id: 'official', label: 'Official Charts', color: '#5E5CE6', path: P.medal,
      find: [{ names: ['The Official Chart Top 40'] }, { prefix: 'Official Chart Number 1s', newest: true }] });
    S.push({ id: 'charts', label: 'Charts', color: '#0A84FF', path: P.globe,
      find: [{ names: ['Top Worldwide'] }, { names: cc === 'gb' ? ['Top UK', 'Top United Kingdom'] : ['Top ' + n] }, ...(cc !== 'us' ? [{ names: ['Top USA'] }] : [])] });
    S.push({ id: 'trending', label: 'Trending', color: '#30D158', path: P.trend,
      find: [{ names: ['Trending ' + n] }, ...(cc !== 'us' ? [{ names: ['Trending USA'] }] : []), { names: ['Trending Worldwide'] }] });
    S.push({ id: 'popular', label: 'Popular Playlists', color: '#FF9F0A', path: P.list, api: '/chart/0/playlists?limit=20', kind: 'playlist' });
    S.push({ id: 'artists', label: 'Most-streamed Artists', color: '#BF5AF2', path: P.person, api: '/chart/0/artists?limit=20', kind: 'artist' });
    S.push({ id: 'albums', label: 'Most-streamed Albums', color: '#64D2FF', path: P.disc, api: '/chart/0/albums?limit=20', kind: 'album' });
    return S;
  },

  // ── Day cache: everything opened in Charts is kept on this device until midnight, through page
  // reloads and closing / reopening the app. Saved in the browser's database (IndexedDB, which has
  // room for every chart), with a copy in localStorage as a fallback where that isn't available.
  _chartDayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },

  _chartIdb() {
    if (this._chartIdbP) return this._chartIdbP;
    this._chartIdbP = new Promise(resolve => {
      try {
        const req = indexedDB.open('crow_media_charts', 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch (_) {} };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
        setTimeout(() => resolve(null), 3000);
      } catch (_) { resolve(null); }
    });
    return this._chartIdbP;
  },

  async _chartIdbGet(k) {
    const db = await this._chartIdb();
    if (!db) return undefined;
    return new Promise(resolve => {
      try { const r = db.transaction('kv', 'readonly').objectStore('kv').get(k); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); }
      catch (_) { resolve(undefined); }
    });
  },

  async _chartIdbPut(k, v) {
    const db = await this._chartIdb();
    if (!db) return false;
    return new Promise(resolve => {
      try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => resolve(true); tx.onerror = tx.onabort = () => resolve(false); }
      catch (_) { resolve(false); }
    });
  },

  // Today's store, loaded once from the device: localStorage first (instant), then the database,
  // and whichever has more of today's charts wins (so nothing saved earlier today is fetched again)
  async _chartStoreLoad() {
    const day = this._chartDayKey();
    if (this._chartStoreMem?.day === day) return this._chartStoreMem;
    if (this._chartStoreLoading?.day === day) return this._chartStoreLoading.p;
    const p = (async () => {
      const today = v => (v && v.day === day && v.items && typeof v.items === 'object' ? v : null);
      let ls = null;
      try { ls = today(JSON.parse(localStorage.getItem('crow_media_chart_day') || 'null')); } catch (_) {}
      const db = today(await this._chartIdbGet('day').catch(() => undefined));
      let st = { day, items: {} };
      [db, ls].forEach(v => { if (v) Object.entries(v.items).forEach(([k, x]) => { if (x != null && (st.items[k] == null || st.items[k].fallback)) st.items[k] = x; }); });
      // a page that already fetched something while this was loading keeps it
      if (this._chartStoreMem?.day === day) Object.assign(st.items, this._chartStoreMem.items);
      this._chartStoreMem = st;
      return st;
    })();
    this._chartStoreLoading = { day, p };
    return p;
  },

  _chartStoreSet(key, value) {
    const st = this._chartStoreMem?.day === this._chartDayKey() ? this._chartStoreMem : (this._chartStoreMem = { day: this._chartDayKey(), items: {} });
    st.items[key] = value;
    const keys = Object.keys(st.items);
    while (keys.length > 150) delete st.items[keys.shift()];
    // written straight away (not on a timer) to both places, so closing the app right after can't
    // lose it, and one of them being unavailable or full doesn't either
    this._chartIdbPut('day', st);
    try { localStorage.setItem('crow_media_chart_day', JSON.stringify(st)); }
    catch (_) {
      // localStorage full: keep the most recent charts that fit rather than nothing
      const ks = Object.keys(st.items);
      for (let cut = Math.ceil(ks.length / 2); cut < ks.length; cut = Math.ceil((cut + ks.length) / 2)) {
        const keep = { day: st.day, items: {} };
        ks.slice(cut).forEach(k => { keep.items[k] = st.items[k]; });
        try { localStorage.setItem('crow_media_chart_day', JSON.stringify(keep)); break; } catch (_) {}
        if (ks.length - cut <= 1) break;
      }
    }
  },

  // Fetch once a day and keep it until midnight. A stand-in (Deezer's chart while Apple Music
  // couldn't be reached) is kept too, so it isn't fetched again; Apple is quietly retried in the
  // background at most once an hour and replaces it when it answers. A failure isn't kept, and is
  // tried again after two minutes (or straight away with Try Again).
  async _chartCached(key, fn) {
    const st = await this._chartStoreLoad();
    if (this._chartRetryAll) { this._chartMiss?.clear(); this._chartRetryAll = false; }
    const have = st.items[key];
    if (have != null) {
      if (have.fallback && Date.now() - (have.tried || 0) > 3600e3 && !this._chartInflight?.has(key)) {
        have.tried = Date.now();
        this._chartStoreSet(key, have);
        if (!this._chartInflight) this._chartInflight = new Map();
        const bg = Promise.resolve().then(fn).then(v => { if (v && !v.fallback) this._chartStoreSet(key, v); }, () => {}).finally(() => this._chartInflight.delete(key));
        this._chartInflight.set(key, bg.then(() => st.items[key]));
      }
      return have;
    }
    if (!this._chartMiss) this._chartMiss = new Map();
    const miss = this._chartMiss.get(key);
    if (miss && Date.now() - miss.ts < 120e3) return miss.value;
    if (!this._chartInflight) this._chartInflight = new Map();
    if (this._chartInflight.has(key)) return this._chartInflight.get(key);
    const p = (async () => {
      let v = null;
      try { v = await fn(); } catch (_) { v = null; }
      if (v) { if (v.fallback) v.tried = Date.now(); this._chartStoreSet(key, v); this._chartMiss.delete(key); }
      else this._chartMiss.set(key, { ts: Date.now(), value: v });
      return v;
    })().finally(() => this._chartInflight.delete(key));
    this._chartInflight.set(key, p);
    return p;
  },

  // JSON from Apple's public feed. Apple doesn't let web pages read it directly, so relays are tried in turn.
  // Apple doesn't let web pages read its feeds directly, so relays are tried in turn (the one that
  // worked last time first). An answer only counts if it passes valid(), so a relay's error page doesn't.
  async _chartFetchJson(url, valid = null, { what = 'Apple Music', onlyKnownRoute = false, directOnly = false, preferDirect = false } = {}) {
    const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
    const get = async (u, ms) => { const r = await Promise.race([crowFetch(u), timeout(ms)]); if (!r.ok) throw new Error('HTTP ' + r.status); return Promise.race([r.json(), timeout(ms)]); };
    const ok = j => (j && typeof j === 'object' && (!valid || valid(j)) ? j : null);
    const enc = encodeURIComponent(url);
    const routes = [
      () => get(url, 7000),
      ...crowMediaRelays().map(r => () => get(r.url(url), 10000).then(j => (r.unwrap ? r.unwrap(j) : j))),
    ];
    // the route that worked last time (kept on this device), so a feed that needs a relay doesn't try the dead ones first
    if (this._chartRoute == null) { try { const k = +localStorage.getItem('crow_media_chart_route'); if (k > 0 && k < routes.length) this._chartRoute = k; } catch (_) {} }
    if (directOnly) { try { return ok(await get(url, 8000)); } catch (_) { return null; } }
    const tryRoute = i => routes[i]().then(j => { const v = ok(j); if (!v) throw new Error('bad'); if (!preferDirect) { this._chartRoute = i; try { localStorage.setItem('crow_media_chart_route', String(i)); } catch (_) {} } return v; });
    const first = preferDirect ? 0 : (this._chartRoute || 0);
    this._chartSay('Contacting ' + what + '\u2026');
    try { return await tryRoute(first); } catch (_) {}
    if (onlyKnownRoute) return null;
    // the rest all at once: whichever answers properly first is used, so one slow or broken relay can't hold it up
    const rest = [...routes.keys()].filter(i => i !== first);
    this._chartSay(what + ' didn\u2019t answer directly \u2014 trying ' + rest.length + ' other routes at once\u2026');
    try { return await Promise.any(rest.map(tryRoute)); } catch (_) { return null; }
  },

  // The loading screen: a centred spinner with a line underneath saying what's happening right now
  _chartLoadingHTML(msg) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="chart-loading" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;height:100%;min-height:300px;padding:0 28px;box-sizing:border-box;text-align:center;">
        <div style="width:26px;height:26px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;flex-shrink:0;"></div>
        <div id="chartLoadMsg" style="font-size:13px;color:${this._pt('dim')};line-height:1.45;max-width:300px;">${esc(msg)}</div>
      </div>`;
  },

  // A failed chart screen: what went wrong, and a Try Again button that fetches it afresh
  _chartFailHTML(path, title, body) {
    return this._psEmpty(path, title, body, 'Try Again', 'chartRetryBtn');
  },

  _chartWireRetry(content, again) {
    content.querySelector('#chartRetryBtn')?.addEventListener('click', () => { this._chartRetryAll = true; again(); });
  },

  _chartSay(msg) {
    const el = this.shadowRoot?.getElementById('chartLoadMsg');
    if (el) el.textContent = msg;
  },

  // One of Apple's chart feeds (validated). Apple's servers sometimes fail one size of a feed, so the
  // other sizes are tried too, and the first that answers is used (trimmed to the size asked for).
  async _chartAppleFeed(path, size) {
    const valid = j => Array.isArray(j?.feed?.results) && j.feed.results.length > 0;
    // Apple couldn't be reached from this device recently: straight to the fallback rather than waiting on every route
    // again (tried afresh after three hours, or when a chart is refreshed by hand)
    let downAt = 0; try { downAt = +localStorage.getItem('crow_media_apple_down') || 0; } catch (_) {}
    if (downAt && Date.now() - downAt < 3 * 3600e3 && !this._chartRetryAll) return null;
    const res = await this._chartAppleFeedTry(path, size, valid);
    try { if (res) localStorage.removeItem('crow_media_apple_down'); else localStorage.setItem('crow_media_apple_down', String(Date.now())); } catch (_) {}
    return res;
  },

  async _chartAppleFeedTry(path, size, valid) {
    // Apple's newer feed straight from the device, then its older iTunes feed (also direct), and only then the relays
    if (this._chartRoute == null || this._chartRoute === 0) {
      const d = await this._chartFetchJson('https://rss.marketingtools.apple.com/api/v2/' + path.replace('{n}', size), valid, { directOnly: true }).catch(() => null);
      if (d) { d.feed.results = d.feed.results.slice(0, size); return d; }
    }
    const legUrl = crowMediaAppleLegacyUrl(path, size);
    if (legUrl) {
      const lj = await this._chartFetchJson(legUrl, j => !!j?.feed, { directOnly: true }).catch(() => null);
      const mapped = crowMediaAppleLegacyMap(lj);
      if (mapped) { mapped.feed.results = mapped.feed.results.slice(0, size); return mapped; }
    }
    const sizes = [size, ...[100, 50, 25].filter(x => x !== size)];
    for (let k = 0; k < sizes.length; k++) {
      // other sizes only go through the route that's been working, so a real outage doesn't take minutes
      if (k > 0) { if (this._chartRoute == null) break; this._chartSay('Apple Music had a problem with that list \u2014 trying another version of it\u2026'); }
      const j = await this._chartFetchJson('https://rss.marketingtools.apple.com/api/v2/' + path.replace('{n}', sizes[k]), valid, { onlyKnownRoute: k > 0, what: this._chartSayWhat || 'Apple Music' });
      if (j) { j.feed.results = j.feed.results.slice(0, size); return j; }
    }
    return null;
  },

  // Deezer's API can't be read by a web page directly, so it's loaded the way Deezer supports
  // for that (a script callback). It runs from this device, so the live charts follow its location.
  // Apple Podcasts' chart couldn't be reached from this device: Deezer's podcast chart, each one found on
  // Apple Podcasts by name (the iTunes search answers the browser directly), so it opens with its episodes as usual
  async _pcChartFromDeezer() {
    this._chartSay('Apple Podcasts can\u2019t be reached \u2014 getting Deezer\u2019s podcast chart instead\u2026');
    const dz = await this._chartDeezer('/chart/0/podcasts?limit=30');
    const list = (dz?.data || []).filter(x => x?.title);
    if (!list.length) return null;
    const norm = v => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    const out = new Array(list.length).fill(null);
    let i = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (i < list.length) {
        const k = i++, t = list[k].title;
        try {
          const r = await crowFetch('https://itunes.apple.com/search?media=podcast&entity=podcast&limit=3&term=' + encodeURIComponent(t));
          const j = r.ok ? await r.json() : null;
          const hit = (j?.results || []).find(x => norm(x.collectionName) === norm(t)) || (j?.results || [])[0];
          if (hit?.collectionId && norm(hit.collectionName).slice(0, 12) === norm(t).slice(0, 12)) out[k] = hit;
        } catch (_) {}
      }
    }));
    const items = out.filter(Boolean).map(x => ({ collectionId: x.collectionId, collectionName: x.collectionName, artistName: x.artistName || '', primaryGenreName: x.primaryGenreName || '',
      artworkUrl100: x.artworkUrl600 || x.artworkUrl100 || '', artworkUrl600: x.artworkUrl600 || '', feedUrl: x.feedUrl || '' }));
    return items.length ? { items, updated: Date.now(), fallback: true } : null;
  },

  _chartDeezer(path) {
    this._chartSay(/^\/search\//.test(path) ? 'Looking up Deezer\u2019s charts\u2026' : 'Contacting Deezer\u2026');
    return new Promise(resolve => {
      const cb = '__crowMediaDz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const s = document.createElement('script');
      let done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(t); try { delete window[cb]; } catch (_) { window[cb] = undefined; } s.remove(); resolve(v); };
      const t = setTimeout(() => finish(null), 10000);
      window[cb] = d => finish(d && !d.error ? d : null);
      s.onerror = () => finish(null);
      s.src = 'https://api.deezer.com' + path + (path.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
      (document.head || document.documentElement).appendChild(s);
    });
  },

  _chartMapDzTracks(list, fallbackArt) {
    return (list || []).map(x => ({ title: x.title_short || x.title || '', artist: x.artist?.name || '', album: x.album?.title || '', art: x.album?.cover_medium || fallbackArt || '' })).filter(t => t.title);
  },

  // Deezer's own playlist with this exact title (the most popular match, Deezer's or the Official Charts' first)
  async _chartFindPlaylist(rule) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const official = p => /deezer|official/i.test(p.user?.name || '');
    for (const q of (rule.names || [rule.prefix])) {
      const r = await this._chartDeezer('/search/playlist?q=' + encodeURIComponent(q) + '&limit=50');
      this._chartSay('Finding \u201c' + q + '\u201d on Deezer\u2026');
      let hits = (r?.data || []).filter(p => rule.prefix ? norm(p.title).startsWith(norm(rule.prefix)) : norm(p.title) === norm(q));
      if (!hits.length) continue;
      if (rule.newest) {
        const yr = p => +((String(p.title).match(/(19|20)\d\d/) || [0])[0]);
        const top = Math.max(...hits.map(yr));
        hits = hits.filter(p => yr(p) === top);
      }
      return hits.find(official) || hits[0];
    }
    return null;
  },

  // The charts inside one Deezer section, as drill-in rows
  _chartSectionItems(sec, cc) {
    return this._chartCached('sec|' + sec.id + '|' + cc, async () => {
      const pl = p => ({ id: 'dz:playlist:' + p.id, kind: 'playlist', dzId: p.id, label: p.title, sub: (p.nb_tracks ? p.nb_tracks + ' songs' : 'Playlist'), art: p.picture_medium || p.picture || '' });
      let items = [];
      if (sec.appleFeed) {
        const j = await this._chartAppleFeed(cc + '/music/most-played/{n}/' + sec.appleFeed + '.json', 50);
        const big = u => String(u || '').replace(/\/\d+x\d+(bb|cc)?\./, '/300x300bb.');
        items = (j?.feed?.results || []).map(x => ({ id: 'am:album:' + x.id, kind: 'am-album', amId: x.id, country: cc, label: x.name, sub: x.artistName || '', art: big(x.artworkUrl100) }));
        if (!items.length && sec.appleFeed === 'albums') {
          // Apple Music couldn't be reached from this device: Deezer's album chart for where you are instead
          this._chartSay('Apple Music can\u2019t be reached \u2014 getting Deezer\u2019s album chart instead\u2026');
          const dz = await this._chartDeezer('/chart/0/albums?limit=50');
          items = (dz?.data || []).map(a => ({ id: 'dz:album:' + a.id, kind: 'album', dzId: a.id, label: a.title, sub: (a.artist?.name || '') + ' \u00b7 Deezer', art: a.cover_medium || a.cover || '' }));
        }
      } else if (sec.api) {
        const r = await this._chartDeezer(sec.api);
        const d = r?.data || [];
        if (sec.kind === 'playlist') items = d.map(pl);
        else if (sec.kind === 'artist') items = d.map(a => ({ id: 'dz:artist:' + a.id, kind: 'artist', dzId: a.id, label: a.name, sub: 'Top songs', art: a.picture_medium || a.picture || '' }));
        else items = d.map(a => ({ id: 'dz:album:' + a.id, kind: 'album', dzId: a.id, label: a.title, sub: a.artist?.name || '', art: a.cover_medium || a.cover || '' }));
      } else {
        const found = await Promise.all(sec.find.map(rule => this._chartFindPlaylist(rule).catch(() => null)));
        const seen = new Set();
        items = found.filter(p => p && !seen.has(p.id) && seen.add(p.id)).map(pl);
      }
      return items.length ? items : null;
    });
  },

  // One chart's songs: { tracks: [{ title, artist, album, art }], updated, fallback? } or null
  _chartTracks(def) {
    return this._chartCached('tracks|' + def.id, async () => {
      if (def.kind === 'apple') {
        const j = await this._chartAppleFeed(def.country + '/music/most-played/{n}/songs.json', 100);
        const res = j?.feed?.results;
        if (Array.isArray(res) && res.length) return {
          tracks: res.map(x => ({ title: x.name || '', artist: x.artistName || '', album: '', art: String(x.artworkUrl100 || '').replace(/\/\d+x\d+(bb)?\./, '/300x300bb.') })).filter(t => t.title),
          updated: Date.parse(j.feed.updated) || Date.now(),
        };
        // Apple Music couldn't be reached at all: Deezer's top chart for where you are, labelled as such
        this._chartSay('Apple Music can\u2019t be reached \u2014 getting Deezer\u2019s chart instead\u2026');
        const dz = await this._chartDeezer('/chart/0/tracks?limit=100');
        const list = this._chartMapDzTracks(dz?.data);
        return list.length ? { tracks: list, updated: Date.now(), fallback: true } : null;
      }
      if (def.kind === 'am-album') {
        const j = await this._chartFetchJson('https://itunes.apple.com/lookup?id=' + def.amId + '&entity=song&limit=200&country=' + (def.country || this._chartCountry()), j => Array.isArray(j?.results) && j.results.some(x => x.wrapperType === 'track'), { what: 'Apple Music for the album\u2019s songs' });
        const rows = (j?.results || []).filter(x => x.wrapperType === 'track' && x.kind === 'song')
          .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
        const list = rows.map(x => ({ title: x.trackName || '', artist: x.artistName || def.sub || '', album: x.collectionName || def.label, art: String(x.artworkUrl100 || '').replace(/\/\d+x\d+(bb)?\./, '/300x300bb.') || def.art })).filter(t => t.title);
        return list.length ? { tracks: list, updated: Date.now() } : null;
      }
      const path = def.kind === 'playlist' ? '/playlist/' + def.dzId + '/tracks?limit=100'
        : def.kind === 'artist' ? '/artist/' + def.dzId + '/top?limit=100'
        : '/album/' + def.dzId + '/tracks?limit=100';
      const r = await this._chartDeezer(path);
      const list = this._chartMapDzTracks(r?.data, def.kind === 'album' ? def.art : '');
      return list.length ? { tracks: list, updated: Date.now() } : null;
    });
  },

  // Where a chart comes from, for the subtitle lines
  _chartSourceLine(def) {
    if (def.kind === 'apple') return 'Apple Music · ' + this._chartCountryName(def.country);
    if (def.kind === 'artist') return 'Deezer · most-streamed artist';
    if (def.kind === 'album') return 'Deezer · ' + (def.sub || 'album');
    if (def.kind === 'am-album') return 'Apple Music · ' + (def.sub || 'album');
    return 'Deezer';
  },

  _chartIsAlbum(def) { return def?.kind === 'album' || def?.kind === 'am-album'; },

  // Apple Music's other chart, shown under Top Songs (each album opens its songs)
  _chartAppleSections() {
    const P = this._chartIcons();
    return [
      { id: 'am-albums', label: 'Top Albums', color: '#FF375F', path: P.disc, appleFeed: 'albums' },
    ];
  },

  // Header ⋯ button (shared with Music History / Pins): shown only inside a chart with more than 10 songs
  _chartSetMenuBtn(show) {
    const btn = this.shadowRoot?.getElementById('recentPlaysMenuBtn');
    if (!btn) return;
    btn.classList.toggle('hidden', !show);
    btn.onclick = show ? () => this._showChartMenu(btn) : null;
  },

  _chartRowGlow(content) {
    if (this._config?.row_glow !== true) return;
    content.querySelectorAll('.ma-ios-cat-row').forEach(r => {
      const hex = r.dataset.color;
      r.style.background = `linear-gradient(90deg, ${hex}20 0%, transparent 60%)`;
      r.style.boxShadow = `inset 0 0 0 1px ${hex}25`;
      r.style.borderRadius = '12px'; r.style.marginBottom = '4px'; r.style.borderBottom = 'none';
    });
  },

  // Library → Charts: Top Songs, then Deezer's sections, laid out like the Library list itself
  _renderChartsList(content) {
    content = content || this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    this._chartsState = { level: 'list' };
    this._chartTok = (this._chartTok || 0) + 1;
    this._chartSetMenuBtn(false);
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = 'Charts';
    if (!this._chartsOn()) {
      content.innerHTML = '<div class="ma-empty">Charts are switched off in the card editor (Discover).</div>';
      return;
    }
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cc = this._chartCountry();
    const apple = this._chartAppleDef(cc);
    const amSecs = this._chartAppleSections();
    const secs = [...amSecs, ...this._chartSections(cc)];
    const row = (key, d, value) => `<div class="ma-ios-cat-row" data-key="${key}" data-color="${d.color}">
        <div class="ma-ios-cat-icon" style="background:${d.color}"><svg viewBox="0 0 24 24"><path d="${d.path}"/></svg></div>
        <span class="ma-ios-cat-label">${esc(d.label)}</span>
        ${value ? `<span style="font-size:13px;color:${this._pt('dim')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42%;">${esc(value)}</span>` : ''}
        <div class="ma-ios-cat-chevron"></div>
      </div>`;
    const head = (t, top) => `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:${top}px 16px 2px;">${t}</div>`;
    const aOn = this._chartAppleOn(), dOn = this._chartDeezerOn();
    content.innerHTML = `${aOn ? `${head('Apple Music', 4)}
      <div class="ma-ios-categories" style="padding-bottom:6px;">${row('apple', apple)}${amSecs.map(s => row('sec:' + s.id, s)).join('')}</div>` : ''}
      ${dOn ? `${head('Deezer', aOn ? 14 : 4)}
      <div class="ma-ios-categories">${secs.filter(s => !s.appleFeed).map(s => row('sec:' + s.id, s)).join('')}</div>` : ''}
`;
    this._chartRowGlow(content);
    content.querySelectorAll('.ma-ios-cat-row').forEach(r => r.addEventListener('click', () => {
      const k = r.dataset.key;
      if (k === 'apple') this._openChart(apple, { from: 'list' });
      else { const s = secs.find(x => 'sec:' + x.id === k); if (s) this._openChartSection(s); }
    }));
  },

  // A Deezer section: one drill-in row per chart / playlist / artist / album
  async _openChartSection(sec) {
    const content = this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    const cc = this._chartCountry();
    this._chartsState = { level: 'section', sec };
    const _loadMsg = 'Checking today\u2019s saved ' + sec.label + '\u2026';
    const tok = (this._chartTok = (this._chartTok || 0) + 1);
    this._chartSetMenuBtn(false);
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = sec.label;
    // the loading screen only if it isn't instant (a chart saved earlier today just appears)
    const _lt = setTimeout(() => { if (tok === this._chartTok) { content.innerHTML = this._chartLoadingHTML(_loadMsg); content.scrollTop = 0; } }, 150);
    const items = await this._chartSectionItems(sec, cc).catch(() => null);
    clearTimeout(_lt);
    content.scrollTop = 0;
    if (tok !== this._chartTok || this._chartsState?.level !== 'section') return;
    if (!items?.length) {
      content.innerHTML = this._chartFailHTML(sec.path, 'Couldn\u2019t load ' + sec.label, (sec.appleFeed ? 'Apple Music' : 'Deezer') + ' didn\u2019t answer just now. Check your connection, then try again.');
      this._chartWireRetry(content, () => this._openChartSection(sec));
      return;
    }
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const note = sec.appleFeed ? 'Top ' + items.length + ' \u00b7 Apple Music \u00b7 ' + this._chartCountryName(cc) : sec.api ? 'Deezer \u00b7 based on your location' : 'Deezer';
    content.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">${esc(note)}</div><div id="chartSecList"></div>`;
    const list = content.querySelector('#chartSecList');
    items.forEach(it => {
      const wrap = document.createElement('div');
      wrap.className = 'ma-item-wrap';
      const round = it.kind === 'artist' ? 'border-radius:50%;' : '';
      wrap.innerHTML = `<div class="ma-item">
          <div class="ma-item-art" style="position:relative;background:${this._pt('bg')};${round}"><svg viewBox="0 0 24 24"><path d="${sec.path}"/></svg>${it.art ? `<img src="${esc(it.art)}" alt="" loading="lazy" style="position:absolute;inset:0;" onerror="this.remove()">` : ''}</div>
          <div class="ma-item-info"><div class="ma-item-title">${esc(it.label)}</div><div class="ma-item-sub">${esc(it.sub || '')}</div></div>
          <div class="ma-item-chevron"></div>
        </div>`;
      wrap.addEventListener('click', () => this._openChart(it, { from: 'section', sec }));
      this._wireRowMenu(wrap.firstElementChild, wrap, () => {
        const pinned = this._chartIsPinned(it);
        return [
          { id: 'chOpen', label: 'Open Chart', icon: this._chartIcons().trend, run: () => this._openChart(it, { from: 'section', sec }) },
          { id: 'chPin', label: pinned ? 'Unpin' : 'Pin', danger: pinned, icon: 'M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z', run: () => this._chartTogglePin(it) },
        ];
      }, { right: ['chPin'], left: ['more'] });
      list.appendChild(wrap);
      if (this._config?.row_glow === true && it.art) this._observeRowGlow(it.art, wrap, null);
    });
  },

  // One chart: its songs (Top 10 / 50 / 100) with the standard action bar
  async _openChart(def, { from = 'list', sec = null, limit = null } = {}) {
    const content = this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    if (!this._chartLimit) { let n = 10; try { n = +localStorage.getItem('crow_media_chart_limit') || 10; } catch (_) {} this._chartLimit = [10, 50, 100].includes(n) ? n : 10; }
    const size = limit || this._chartLimit;
    this._chartsState = { level: 'chart', from, sec, def, limit: size };
    const tok = (this._chartTok = (this._chartTok || 0) + 1);
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = def.label;
    this._chartSetMenuBtn(false);
    // the loading screen only if it isn't instant (a chart saved earlier today just appears)
    const _lt = setTimeout(() => { if (tok === this._chartTok) { content.innerHTML = this._chartLoadingHTML('Checking today\u2019s saved copy of ' + def.label + '\u2026'); content.scrollTop = 0; } }, 150);
    const data = await this._chartTracks(def).catch(() => null);
    clearTimeout(_lt);
    content.scrollTop = 0;
    if (tok !== this._chartTok || this._chartsState?.level !== 'chart') return;
    if (!data) {
      content.innerHTML = this._chartFailHTML(this._chartIcons().trend, 'Couldn\u2019t load ' + def.label,
        this._chartSourceLine(def).split(' \u00b7 ')[0] + ' didn\u2019t answer just now. Check your connection, then try again.');
      this._chartWireRetry(content, () => this._openChart(def, { from, sec, limit }));
      return;
    }
    const total = data.tracks.length;
    // the ⋯ menu only when there's more than a Top 10 to choose from
    this._chartsState.total = total;
    // an album is shown whole; charts start at the chosen Top 10 / 50 / 100
    this._chartSetMenuBtn(!this._chartIsAlbum(def) && total > 10);
    const tracks = this._chartIsAlbum(def) ? data.tracks : data.tracks.slice(0, size);
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pinned = this._chartIsPinned(def);
    const day = new Date(data.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const srcLine = data.fallback ? 'Deezer · based on your location (Apple Music unavailable)' : this._chartSourceLine(def);
    const countLine = this._chartIsAlbum(def) ? tracks.length + ' song' + (tracks.length === 1 ? '' : 's') : 'Top ' + tracks.length;
    content.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">${esc(countLine)} · ${esc(srcLine)} · ${esc(day)}</div>
      <div class="ma-drill-actions" id="chartActions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn" data-action="replace"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>
        ${this._shuffleBtnHtml()}
        <button class="ma-drill-action-btn" data-action="add"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button>
        <button class="ma-drill-action-btn" data-action="next"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>
        <button class="ma-drill-action-btn" data-action="pin"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24" style="${pinned ? 'fill:#FFD60A' : ''}"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">${pinned ? 'Unpin' : 'Pin'}</span></button>
        <button class="ma-drill-action-btn" data-action="pdf" data-pdf="lists"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
      </div>
      <div id="chartList"></div>`;
    if (!this._pdfOn('lists')) content.querySelector('[data-action="pdf"]')?.remove();
    const list = content.querySelector('#chartList');
    const noteIcon = `<svg viewBox="0 0 24 24"><path d="${this._chartIcons().note}"/></svg>`;
    tracks.forEach(t => {
      const wrap = document.createElement('div');
      wrap.className = 'ma-item-wrap';
      wrap.innerHTML = `<div class="ma-item">
          <div class="ma-item-art" style="position:relative;background:${this._pt('bg')};">${noteIcon}${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy" style="position:absolute;inset:0;" onerror="this.remove()">` : ''}</div>
          <div class="ma-item-info"><div class="ma-item-title">${esc(t.title)}</div><div class="ma-item-sub">${esc(t.artist)}</div></div>
        </div>`;
      const item = { uri: 'title-artist://' + t.title.toLowerCase().trim() + '|' + t.artist.toLowerCase().trim(), name: t.title, title: t.title, artist: t.artist, artists: [{ name: t.artist }], album: t.album || '', image: t.art || '', media_type: 'track' };
      let lpTimer = null, lpFired = false;
      wrap.addEventListener('contextmenu', e => e.preventDefault());
      wrap.addEventListener('pointerdown', () => { lpFired = false; lpTimer = setTimeout(() => { lpFired = true; this._showEnqueueMenu(item, 'track', wrap); }, 480); }, { passive: true });
      wrap.addEventListener('pointerup', () => clearTimeout(lpTimer), { passive: true });
      wrap.addEventListener('pointercancel', () => { clearTimeout(lpTimer); lpFired = false; }, { passive: true });
      wrap.addEventListener('pointermove', () => clearTimeout(lpTimer), { passive: true });
      wrap.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        // the song's info panel, same as tapping a song in Music History
        this._showAITrackInfo(t.title, t.artist, {});
      });
      this._rowSwipe(wrap.firstElementChild, { menu: (h) => this._showEnqueueMenu(item, 'track', wrap, {}, h), right: ['add', 'next'], left: ['play_all', 'pin', 'more'] }, wrap);
      list.appendChild(wrap);
      if (this._config?.row_glow === true && t.art) this._observeRowGlow(t.art, wrap, null);
    });
    content.querySelectorAll('#chartActions .ma-drill-action-btn').forEach(btn => btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'pin') {
        this._chartTogglePin(def).then(now => {
          if (now === null) return;
          const lab = btn.querySelector('.ma-drill-btn-label');
          if (lab) lab.textContent = now ? 'Unpin' : 'Pin';
          // the pin turns yellow while pinned, like everywhere else
          const svg = btn.querySelector('svg');
          if (svg) svg.style.fill = now ? '#FFD60A' : '';
        });
      } else if (a === 'pdf') this._exportChartPDF(def, tracks, data.updated, srcLine);
      else if (a === 'shuffle') this._crowShufflePlay(tracks);
      else this._chartPlayList(tracks, a);
    }));
  },

  _mtTmdbKey() { return this._tmdbKey(); },

  _mtChartGroups() {
    const P = this._chartIcons();
    const film = 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z';
    const tv = 'M21,17H3V5H21M21,3H3A2,2 0 0,0 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5A2,2 0 0,0 21,3Z';
    const star = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z';
    const cal = 'M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z';
    const mk = (src, feed, label, color, path, extra = {}) => ({ id: 'mt:' + src + ':' + feed, kind: 'mt', src, feed, label, color, path, ...extra });
    const groups = [
      { head: 'Apple TV', items: [mk('itunes', 'topmovies', 'Top Movies', '#FA2D48', film), mk('itunes', 'toptvseasons', 'Top TV Shows', '#FF9500', tv)] },
      { head: 'TVmaze', items: [mk('tvmaze', 'tonight', 'TV Tonight', '#0A84FF', tv), mk('tvmaze', 'streaming', 'New on Streaming', '#BF5AF2', P.trend)] },
    ];
    if (this._mtTmdbKey()) groups.push({ head: 'TMDB', items: [
      mk('tmdb', 'trending/all/week', 'Trending This Week', '#01B4E4', P.trend),
      mk('tmdb', 'movie/popular', 'Popular Movies', '#FF2D55', film),
      mk('tmdb', 'movie/now_playing', 'Now in Cinemas', '#FF9F0A', film),
      mk('tmdb', 'movie/upcoming', 'Coming Soon', '#30D158', cal),
      mk('tmdb', 'movie/top_rated', 'Top Rated Movies', '#FFD60A', star),
      mk('tmdb', 'tv/popular', 'Popular TV', '#5856D6', tv),
    ] });
    return groups;
  },

  _mtChartSourceLine(def, cc) {
    const where = this._chartCountryName(cc || this._chartCountry());
    if (def.src === 'itunes') return 'Apple TV · ' + where;
    if (def.src === 'tvmaze') return 'TVmaze · ' + where;
    return 'TMDB' + (/^movie\/(popular|now_playing|upcoming|top_rated)/.test(def.feed) ? ' · ' + where : '');
  },

  // A chart's titles as Movies & TV rows: { items: [{ id, kind, title, subtitle, artworkUrl100 }], updated }
  _mtChartItems(def, cc) {
    const ukTonight = this._ukTonightOn(def, cc);
    return this._chartCached('mt|' + def.feed + '|' + (ukTonight ? 'freeview' : def.src) + '|' + cc, async () => {
      // UK TV Tonight: the Freeview guide, channel by channel (TVmaze if the guide can't be reached)
      if (ukTonight) {
        const epg = await this._ukTonightLoad().catch(() => null);
        if (epg) return epg;
        this._chartSay('The Freeview guide can’t be reached — getting TVmaze’s listings instead…');
      }
      const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
      if (def.src === 'itunes') {
        const isTv = def.feed !== 'topmovies';
        const j = await this._chartFetchJson('https://itunes.apple.com/' + cc + '/rss/' + def.feed + '/limit=50/json', x => Array.isArray(x?.feed?.entry) && x.feed.entry.length > 0, { what: 'Apple TV', preferDirect: true });
        const lbl = v => v?.label || '';
        const items = (j?.feed?.entry || []).map(e => {
          const img = (e['im:image'] || []).slice(-1)[0]?.label || '';
          const name = lbl(e['im:name']);
          const title = isTv ? name.replace(/,\s*(Season|Series|Staffel|Saison)\s*\d+.*$/i, '').replace(/\s*[-:]\s*(Season|Series)\s*\d+.*$/i, '') : name;
          const season = isTv ? (name.match(/(Season|Series)\s*(\d+)/i) || [])[0] || '' : '';
          const yr = (lbl(e['im:releaseDate']).match(/\d{4}/) || [])[0] || '';
          return { id: (isTv ? 'tv_' : 'movie_') + (e.id?.attributes?.['im:id'] || title), kind: isTv ? 'tv' : 'movie', title, year: yr,
            subtitle: [season, e.category?.attributes?.label || '', yr].filter(Boolean).join(' · '),
            artworkUrl100: img.replace(/\/\d+x\d+(bb|cc)?\./, '/100x100bb.') };
        }).filter(x => x.title);
        return items.length ? { items, updated: Date.parse(lbl(j.feed.updated)) || Date.now() } : null;
      }
      if (def.src === 'tvmaze') {
        const url = def.feed === 'tonight'
          ? 'https://api.tvmaze.com/schedule?country=' + cc.toUpperCase() + '&date=' + today
          : 'https://api.tvmaze.com/schedule/web?date=' + today + '&country=' + cc.toUpperCase();
        const j = await this._chartFetchJson(url, x => Array.isArray(x), { what: 'TVmaze', preferDirect: true });
        const seen = new Map();
        (j || []).forEach(ep => {
          const show = ep.show || ep._embedded?.show;
          if (!show?.id || seen.has(show.id)) return;
          const net = show.network?.name || show.webChannel?.name || '';
          const se = ep.season && ep.number ? 'S' + ep.season + ' E' + ep.number : '';
          seen.set(show.id, { id: 'tv_tvmaze_' + show.id, kind: 'tv', title: show.name || '',
            subtitle: [def.feed === 'tonight' ? (ep.airtime || '') : '', net, se].filter(Boolean).join(' · '),
            artworkUrl100: show.image?.medium || show.image?.original || '', _air: ep.airtime || '', _w: show.weight || 0 });
        });
        let items = [...seen.values()].filter(x => x.title);
        // tonight in time order (evening first, as a TV guide would); streaming by popularity
        items.sort((a, b) => def.feed === 'tonight' ? String(a._air).localeCompare(String(b._air)) : b._w - a._w);
        items = items.map(({ _air, _w, ...x }) => x);
        return items.length ? { items, updated: Date.now() } : null;
      }
      // TMDB: two pages (40 titles), with the country where it matters
      const region = /^movie\/(popular|now_playing|upcoming|top_rated)/.test(def.feed) ? '&region=' + cc.toUpperCase() : '';
      const isTvFeed = def.feed.startsWith('tv/');
      const all = [];
      for (const page of [1, 2]) {
        this._chartSay('Contacting TMDB…');
        try {
          const r = await this._tmdbFetch('https://api.themoviedb.org/3/' + def.feed + '?language=en-GB&page=' + page + region);
          if (!r.ok) break;
          const d = await r.json();
          all.push(...(d.results || []));
          if (!d.total_pages || d.total_pages <= page) break;
        } catch (_) { break; }
      }
      const fmt = ds => { const t = Date.parse(ds); return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
      const items = all.filter(r => r.media_type !== 'person').map(r => {
        const kind = r.media_type === 'tv' || (isTvFeed && r.media_type !== 'movie') ? 'tv' : 'movie';
        const date = r.release_date || r.first_air_date || '';
        const when = def.feed === 'movie/upcoming' ? 'Out ' + fmt(date) : (date.match(/\d{4}/) || [''])[0];
        const score = r.vote_average ? '★ ' + (Math.round(r.vote_average * 10) / 10) : '';
        return { id: kind + '_tmdb_' + r.id, kind, title: r.title || r.name || '', subtitle: [when, score].filter(Boolean).join(' · '),
          artworkUrl100: r.poster_path ? 'https://image.tmdb.org/t/p/w342' + r.poster_path : '' };
      }).filter(x => x.title);
      return items.length ? { items, updated: Date.now() } : null;
    });
  },

  // ── TV Tonight (UK): the free Freeview guide (an open XMLTV listings feed),
  // channel by channel with each channel's logo. Tap a programme for its details, Info and where to watch.
  // the TV Guide switch in the editor (on by default): off, TV Tonight uses TVmaze's listings everywhere
  _ukTonightOn(def, cc) { return this._featOn('tv_guide') && def?.src === 'tvmaze' && def?.feed === 'tonight' && String(cc || '').toLowerCase() === 'gb'; },

  // The channels shown, in Freeview order. tv_tonight_channels in the card's YAML swaps in your own
  // (listings feed channel ids, e.g. BBCOneNorthWest.uk for a regional BBC One).
  _ukTonightChannels() {
    const own = this._config?.tv_tonight_channels;
    if (Array.isArray(own) && own.length) return own.map(c => typeof c === 'string' ? { id: c, name: '' } : { id: c?.id, name: c?.name || '' }).filter(c => c.id);
    return [
      ['BBCOneLondonHD.uk', 'BBC One'], ['BBCTwoHD.uk', 'BBC Two'], ['ITV1London.uk', 'ITV1'], ['Channel4London.uk', 'Channel 4'],
      ['5.uk', 'Channel 5'], ['ITV2.uk', 'ITV2'], ['BBCThreeHD.uk', 'BBC Three'], ['BBCFourHD.uk', 'BBC Four'], ['ITV3.uk', 'ITV3'],
      ['SkyMix.uk', 'Sky Mix'], ['ITV4.uk', 'ITV4'], ['UAndW.uk', 'U&W'], ['E4.uk', 'E4'], ['Film4.uk', 'Film4'], ['More4.uk', 'More4'],
      ['UAndDave.uk', 'U&Dave'], ['UAndDrama.uk', 'U&Drama'], ['UAndYesterday.uk', 'U&Yesterday'], ['5USA.uk', '5USA'], ['5Star.uk', '5STAR'],
      ['QuestHD.uk', 'Quest'], ['QuestRed.uk', 'Quest Red'], ['DMAX.uk', 'DMAX'], ['Really.uk', 'Really'], ['SkyArts.uk', 'Sky Arts'],
      ['Challenge.uk', 'Challenge'], ['TalkingPicturesTV.uk', 'Talking Pictures TV'], ['GreatTV.uk', 'GREAT! tv'],
      ['CBBC.uk', 'CBBC'], ['CBeebies.uk', 'CBeebies'], ['BBCNews.uk', 'BBC News'], ['SkyNews.uk', 'Sky News'], ['GBNews.uk', 'GB News'],
    ].map(([id, name]) => ({ id, name }));
  },

  // Downloads the guide (about 20 MB, rebuilt twice a day) and keeps only today's programmes on the
  // chosen channels (until 6am tomorrow), so what's saved for the day is small.
  async _ukTonightLoad() {
    const want = this._ukTonightChannels();
    const ids = new Set(want.map(c => c.id));
    this._chartSay('Downloading the Freeview TV guide…');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90000);
    let text;
    try {
      // straight from GitHub: the guide is about 20 MB, more than Home Assistant passes on for the card
      const r = await crowFetch('https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml', { signal: ctrl.signal, crowDirect: true });
      if (!r.ok) return null;
      text = await r.text();
    } catch (_) { return null; } finally { clearTimeout(t); }
    this._chartSay('Reading tonight’s listings…');
    await new Promise(r => setTimeout(r, 30));   // let that line show before the (brief) busy spell
    const dec = s => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const attr = (s, n) => dec((String(s).match(new RegExp('\\b' + n + '="([^"]*)"')) || [])[1] || '');
    const tag = (s, n) => { const m = String(s).match(new RegExp('<' + n + '\\b[^>]*>([\\s\\S]*?)</' + n + '>')); return m ? dec(m[1]).trim() : ''; };
    const when = v => {
      const m = String(v || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/);
      if (!m) return 0;
      const off = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) : 0;
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60000;
    };
    const epOf = b => {
      const on = (b.match(/<episode-num[^>]*system="onscreen"[^>]*>([^<]*)</) || [])[1];
      if (on && on.trim()) return on.trim();
      const ns = (b.match(/<episode-num[^>]*system="xmltv_ns"[^>]*>([^<]*)</) || [])[1];
      if (ns) { const p = ns.split('.'); const s = parseInt(p[0], 10), e = parseInt(p[1], 10); if (!isNaN(s) && !isNaN(e)) return 'S' + (s + 1) + 'E' + (e + 1); }
      return '';
    };
    const meta = {};
    const chRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
    let m;
    while ((m = chRe.exec(text))) {
      const id = attr(m[1], 'id');
      if (ids.has(id)) meta[id] = { icon: attr((m[2].match(/<icon\b[^>]*>/) || [''])[0], 'src'), name: tag(m[2], 'display-name') };
    }
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const from = day0.getTime(), to = from + 30 * 3600e3;
    const progs = {};
    want.forEach(c => { progs[c.id] = []; });
    const pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    while ((m = pRe.exec(text))) {
      const id = attr(m[1], 'channel');
      if (!ids.has(id)) continue;
      const s = when(attr(m[1], 'start')), e = when(attr(m[1], 'stop'));
      if (!s || !e || e <= from || s >= to) continue;
      const b = m[2];
      let d = tag(b, 'desc');
      if (d.length > 420) d = d.slice(0, 417).replace(/\s+\S*$/, '') + '…';
      progs[id].push({ s, e, t: tag(b, 'title') || 'Unknown programme', sub: tag(b, 'sub-title'), d, ep: epOf(b), img: attr((b.match(/<icon\b[^>]*>/) || [''])[0], 'src') });
    }
    text = null;
    const channels = want.filter(c => progs[c.id].length).map(c => ({
      id: c.id, name: c.name || String(meta[c.id]?.name || c.id).replace(/\s+HD$/i, ''), icon: meta[c.id]?.icon || '',
      progs: progs[c.id].sort((a, b) => a.s - b.s),
    }));
    return channels.length ? { freeview: true, channels, items: [], updated: Date.now() } : null;
  },

  // Where a channel can be watched: its live page where there's a reliable one, otherwise the
  // broadcaster's site or app. +1 channels have no stream of their own.
  _ukWatchLink(name) {
    const n = String(name || '').trim();
    if (!n || /\+\s*1\b/.test(n)) return null;
    const L = [
      [/^bbc one\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcone', 1], [/^bbc two\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbctwo', 1],
      [/^bbc three\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcthree', 1], [/^bbc four\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcfour', 1],
      [/^bbc news\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcnews', 1], [/^bbc parliament\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcparliament', 1],
      [/^cbbc\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/cbbc', 1], [/^cbeebies\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/cbeebies', 1],
      [/^bbc scotland\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcscotland', 1], [/^bbc alba\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcalba', 1],
      [/^s4c\b/i, 'BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/s4c', 1],
      [/^itv1\b/i, 'ITVX', 'https://www.itv.com/watch?channel=itv', 1], [/^itv\s*2\b/i, 'ITVX', 'https://www.itv.com/watch?channel=itv2', 1],
      [/^itv\s*3\b/i, 'ITVX', 'https://www.itv.com/watch?channel=itv3', 1], [/^itv\s*4\b/i, 'ITVX', 'https://www.itv.com/watch?channel=itv4', 1],
      [/^itvbe\b/i, 'ITVX', 'https://www.itv.com/watch?channel=itvbe', 1], [/^itv quiz\b|^utv\b/i, 'ITVX', 'https://www.itv.com/', 0],
      [/^stv\b/i, 'STV Player', 'https://player.stv.tv/', 0],
      [/^e4 extra\b/i, 'Channel 4', 'https://www.channel4.com/', 0], [/^channel ?4\b/i, 'Channel 4', 'https://www.channel4.com/now/c4', 1],
      [/^e4\b/i, 'Channel 4', 'https://www.channel4.com/now/e4', 1], [/^more4\b/i, 'Channel 4', 'https://www.channel4.com/now/m4', 1],
      [/^film4\b/i, 'Channel 4', 'https://www.channel4.com/now/f4', 1], [/^4seven\b/i, 'Channel 4', 'https://www.channel4.com/now/4s', 1],
      [/^(channel\s*)?5(\s*hd)?$|^5\s*(usa|star|action|select|drama)\b|^five\b/i, '5', 'https://www.channel5.com/', 0],
      [/^u\s*&\s*(dave|drama|w|yesterday|eden|alibi|gold)\b|^u&|^gold$/i, 'U', 'https://u.co.uk/', 0],
      [/^(quest|quest red|dmax|food network|really|tlc|hgtv)\b/i, 'discovery+', 'https://www.discoveryplus.com/gb', 0],
      [/^sky news\b/i, 'Sky News', 'https://news.sky.com/watch-live', 1], [/^gb news\b/i, 'GB News', 'https://www.gbnews.com/watch/live', 1],
      [/^talking pictures\b/i, 'Talking Pictures TV', 'https://talkingpicturestv.co.uk/', 0], [/^together tv\b/i, 'Together TV', 'https://www.togethertv.com/', 0],
    ];
    for (const [re, service, url, live] of L) if (re.test(n)) return { service, url, live: !!live };
    return null;
  },

  // The TV Tonight screen: one block per channel (logo, name, then what's on from now until midnight)
  _ukTonightRender(content, def, data, cc) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmt = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const now = Date.now();
    const mid = new Date(); mid.setHours(24, 0, 0, 0);
    // after midnight "tonight" runs on to 6am
    const end = new Date().getHours() < 5 ? new Date().setHours(6, 0, 0, 0) : mid.getTime();
    const chans = data.channels.map(ch => ({ ...ch, list: ch.progs.filter(p => p.e > now && p.s < end) })).filter(ch => ch.list.length);
    const pinned = this._chartIsPinned(def);
    const day = new Date(data.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const count = chans.length + ' channel' + (chans.length === 1 ? '' : 's');
    const src = 'Freeview · ' + this._chartCountryName(cc);
    const FIRST = 4;
    const row = (p, ci, pi, hidden) => {
      const on = p.s <= now && p.e > now;
      const pct = on ? Math.round(((now - p.s) / Math.max(1, p.e - p.s)) * 100) : 0;
      const sub = [p.ep, p.sub].filter(Boolean).join(' · ');
      return `<div class="tvt-prog" data-c="${ci}" data-p="${pi}" style="display:${hidden ? 'none' : 'flex'};align-items:flex-start;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;${on ? 'background:' + this._pt('bgA') + ';' : ''}">
          <div style="width:42px;flex-shrink:0;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:${on ? '#0A84FF' : this._pt('dim')};padding-top:1px;">${on ? 'NOW' : fmt(p.s)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:${this._pt('text')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.t)}</div>
            ${sub || on ? `<div style="font-size:11px;color:${this._pt('dim')};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${on ? 'Until ' + fmt(p.e) + (sub ? ' · ' : '') : ''}${esc(sub)}</div>` : ''}
            ${on ? `<div style="height:3px;border-radius:2px;background:${this._pt('border')};margin-top:6px;overflow:hidden;"><i style="display:block;height:100%;width:${pct}%;background:#0A84FF;border-radius:2px;"></i></div>` : ''}
          </div>
        </div>`;
    };
    const logo = ch => ch.icon
      ? `<div style="width:46px;height:32px;border-radius:8px;background:${this._pt('bgA')};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;"><img src="${esc(ch.icon)}" alt="" loading="lazy" style="max-width:38px;max-height:24px;object-fit:contain;" onerror="this.style.display='none'"></div>`
      : `<div style="width:46px;height:32px;border-radius:8px;background:${this._pt('bgA')};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:700;color:${this._pt('dim')};">${esc((ch.name || '?')[0])}</div>`;
    content.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">${esc(count)} · ${esc(src)} · ${esc(day)}</div>
      <div class="ma-drill-actions" id="mtChartActions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn" data-action="pin"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24" style="${pinned ? 'fill:#FFD60A' : ''}"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">${pinned ? 'Unpin' : 'Pin'}</span></button>
        <button class="ma-drill-action-btn" data-action="pdf" data-pdf="lists"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
      </div>
      ${chans.length ? chans.map((ch, ci) => `<div style="background:${this._pt('bg')};border:1px solid ${this._pt('border')};border-radius:14px;padding:8px 6px 6px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:10px;padding:2px 6px 6px;">${logo(ch)}<div style="font-size:14px;font-weight:700;color:${this._pt('text')};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ch.name)}</div></div>
          ${ch.list.map((p, pi) => row(p, ci, pi, pi >= FIRST)).join('')}
          ${ch.list.length > FIRST ? `<div class="tvt-more" data-c="${ci}" style="font-size:12px;font-weight:600;color:#0A84FF;padding:6px 10px 4px 62px;cursor:pointer;">${ch.list.length - FIRST} more tonight</div>` : ''}
        </div>`).join('') : `<div class="ma-empty">Nothing more on tonight.</div>`}`;
    if (!this._pdfOn('lists')) content.querySelector('#mtChartActions [data-action="pdf"]')?.remove();
    content.querySelectorAll('.tvt-prog').forEach(el => el.addEventListener('click', () => {
      const ch = chans[+el.dataset.c], p = ch?.list[+el.dataset.p];
      if (p) this._ukProgSheet(p, ch);
    }));
    content.querySelectorAll('.tvt-more').forEach(el => el.addEventListener('click', () => {
      const box = el.parentElement;
      const open = el.dataset.open === '1';
      box.querySelectorAll('.tvt-prog').forEach((r, i) => { if (i >= FIRST) r.style.display = open ? 'none' : 'flex'; });
      el.dataset.open = open ? '0' : '1';
      el.textContent = open ? (chans[+el.dataset.c].list.length - FIRST) + ' more tonight' : 'Show less';
    }));
    content.querySelectorAll('#mtChartActions .ma-drill-action-btn').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.action === 'pin') {
        this._chartTogglePin(def).then(on => {
          if (on === null) return;
          const lab = btn.querySelector('.ma-drill-btn-label');
          if (lab) lab.textContent = on ? 'Unpin' : 'Pin';
          const svg = btn.querySelector('svg');
          if (svg) svg.style.fill = on ? '#FFD60A' : '';
        });
      } else if (this._pdfOn('lists')) {
        this._exportListPDF(async () => ({
          title: def.label, subtitle: src,
          sections: chans.map(ch => ({ heading: ch.name, items: ch.list.map(p => ({ title: fmt(p.s) + '  ' + p.t, sub: [p.ep, p.sub].filter(Boolean).join(' · ') })) })),
          filename: 'tv-tonight',
        }));
      }
    }));
  },

  // A programme's details, over TV Tonight: the ✕ closes it and returns to the list where it was
  _ukProgSheet(p, ch) {
    const host = this.shadowRoot?.getElementById('maPopup');
    if (!host) return;
    host.querySelector('#tvtSheet')?.remove();
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmt = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const now = Date.now();
    const on = p.s <= now && p.e > now;
    const timing = p.e <= now ? 'Finished' : on ? 'Started ' + Math.round((now - p.s) / 60000) + ' min ago' : (() => { const m = Math.round((p.s - now) / 60000); return m >= 60 ? 'Starts in ' + Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : 'Starts in ' + m + ' min'; })();
    const pct = on ? Math.round(((now - p.s) / Math.max(1, p.e - p.s)) * 100) : 0;
    const epM = String(p.ep || '').match(/^S(\d+)\s*E(\d+)$/i);
    const epLabel = epM ? (+epM[1] > 1900 ? epM[1] + ' · Episode ' + +epM[2] : 'Series ' + +epM[1] + ' · Episode ' + +epM[2]) : p.ep;
    const link = this._ukWatchLink(ch.name);
    // a film's listing starts with its year, e.g. "(2003) …"
    const year = (String(p.d || '').match(/^\((\d{4})\)/) || [])[1] || '';
    const isFilm = !!year || /^film4\b|^great!\s*movies|^movies24|^talking pictures/i.test(ch.name);
    const btn = 'display:flex;align-items:center;justify-content:center;gap:7px;flex:1;min-width:0;padding:11px 12px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;';
    const sheet = document.createElement('div');
    sheet.id = 'tvtSheet';
    sheet.style.cssText = 'position:absolute;inset:0;z-index:60;background:var(--crow-panel-bg,#13131a);display:flex;flex-direction:column;opacity:0;transition:opacity 0.16s ease;';
    sheet.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:14px 14px 8px;flex-shrink:0;">
        <div style="flex:1;min-width:0;text-align:center;font-size:16px;font-weight:700;color:${this._pt('text')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:44px;">${esc(ch.name)}</div>
        <button id="tvtClose" aria-label="Close" style="width:34px;height:34px;border-radius:50%;border:none;background:${this._pt('btnBg')};display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:${this._pt('text')};"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></button>
      </div>
      <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 20px;">
        <div style="position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:${this._pt('bgA')};display:flex;align-items:center;justify-content:center;">
          ${ch.icon ? `<img src="${esc(ch.icon)}" alt="" style="max-width:40%;max-height:40%;object-fit:contain;opacity:0.9;" onerror="this.style.display='none'">` : ''}
          ${p.img ? `<img src="${esc(p.img)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">` : ''}
          ${ch.icon && p.img ? `<div style="position:absolute;left:10px;bottom:10px;width:52px;height:36px;border-radius:9px;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;"><img src="${esc(ch.icon)}" alt="" style="max-width:42px;max-height:26px;object-fit:contain;" onerror="this.parentElement.remove()"></div>` : ''}
          ${on ? `<span style="position:absolute;right:10px;top:10px;font-size:10px;font-weight:800;letter-spacing:0.5px;color:#fff;background:#FF3B30;border-radius:6px;padding:3px 7px;">ON NOW</span>` : ''}
        </div>
        <div style="font-size:20px;font-weight:700;color:${this._pt('text')};margin-top:14px;line-height:1.25;">${esc(p.t)}</div>
        ${p.sub ? `<div style="font-size:14px;color:${this._pt('text')};opacity:0.8;margin-top:3px;">${esc(p.sub)}</div>` : ''}
        <div style="font-size:12px;color:${this._pt('dim')};margin-top:6px;">${fmt(p.s)} – ${fmt(p.e)} · ${esc(ch.name)} · ${esc(timing)}</div>
        ${on ? `<div style="height:4px;border-radius:2px;background:${this._pt('border')};margin-top:8px;overflow:hidden;"><i style="display:block;height:100%;width:${pct}%;background:#0A84FF;border-radius:2px;"></i></div>` : ''}
        ${epLabel ? `<div style="font-size:12px;font-weight:600;color:#0A84FF;margin-top:8px;">${esc(epLabel)}</div>` : ''}
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button id="tvtInfo" style="${btn}border:1px solid ${this._pt('btnBdr')};background:${this._pt('btnBg')};color:${this._pt('text')};"><svg viewBox="0 0 24 24" style="width:17px;height:17px;fill:currentColor;flex-shrink:0;"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg><span>Info</span></button>
          ${link ? `<a href="${esc(link.url)}" target="_blank" rel="noopener" style="${btn}border:none;background:#0A84FF;color:#fff;"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;flex-shrink:0;"><path d="M8 5.5v13l11-6.5z"/></svg><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((link.live ? 'Watch on ' : 'Open ') + link.service.replace(/^BBC /, ''))}</span></a>` : ''}
        </div>
        <div style="font-size:14px;line-height:1.5;color:${this._pt('text')};opacity:${p.d ? 0.9 : 0.5};margin-top:16px;">${esc(p.d || 'No synopsis available.')}</div>
      </div>`;
    host.appendChild(sheet);
    requestAnimationFrame(() => { sheet.style.opacity = '1'; });
    sheet.querySelector('#tvtClose').addEventListener('click', () => this._ukProgSheetClose());
    sheet.querySelector('#tvtInfo').addEventListener('click', () => this._openMtInfo({ title: p.t, kind: isFilm ? 'movie' : 'tv', year, artworkUrl100: '' }));
  },

  _ukProgSheetClose() {
    const sheet = this.shadowRoot?.getElementById('tvtSheet');
    if (!sheet) return;
    sheet.style.opacity = '0';
    setTimeout(() => sheet.remove(), 170);
  },

  // Top of Movies & TV: a "Charts" row, opening the list of film and TV charts
  _mtInjectCharts(content) {
    content.querySelector('#mt-charts-section')?.remove();
    if (!this._mtChartsOn()) return;
    const sec = document.createElement('div');
    sec.id = 'mt-charts-section';
    const icon = this._chartIcons().trend;
    sec.innerHTML = `<div class="ma-ios-categories" style="padding-bottom:6px;"><div class="ma-ios-cat-row" data-color="#FA2D48">
        <div class="ma-ios-cat-icon" style="background:#FA2D48"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg></div>
        <span class="ma-ios-cat-label">Charts</span>
        <div class="ma-ios-cat-chevron"></div>
      </div></div>`;
    content.insertBefore(sec, content.firstChild);
    this._chartRowGlow(sec);
    sec.querySelector('.ma-ios-cat-row').addEventListener('click', () => this._renderMtChartsList());
  },

  _renderMtChartsList() {
    const content = this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    this._chartsState = { level: 'mt-list' };
    // the Movies & TV search box isn't for the charts, so it's hidden while they're open
    this.shadowRoot?.getElementById('maIosSearchBar')?.classList.add('hidden');
    this._chartTok = (this._chartTok || 0) + 1;
    this._chartSetMenuBtn(false);
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = 'Movie & TV Charts';
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const groups = this._mtChartGroups();
    const row = d => `<div class="ma-ios-cat-row" data-key="${d.id}" data-color="${d.color}">
        <div class="ma-ios-cat-icon" style="background:${d.color}"><svg viewBox="0 0 24 24"><path d="${d.path}"/></svg></div>
        <span class="ma-ios-cat-label">${esc(d.label)}</span>
        <div class="ma-ios-cat-chevron"></div>
      </div>`;
    content.innerHTML = groups.map((g, i) => `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:${i ? 14 : 4}px 16px 2px;">${esc(g.head)}</div>
      <div class="ma-ios-categories" style="padding-bottom:6px;">${g.items.map(row).join('')}</div>`).join('');
    content.scrollTop = 0;
    this._chartRowGlow(content);
    const all = groups.flatMap(g => g.items);
    content.querySelectorAll('.ma-ios-cat-row').forEach(r => r.addEventListener('click', () => {
      const d = all.find(x => x.id === r.dataset.key);
      if (d) this._openMtChart(d, { from: 'mt-list' });
    }));
  },

  async _openMtChart(def, { from = 'mt-list' } = {}) {
    const content = this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    const cc = this._chartCountry();
    this._chartsState = { level: 'mt-chart', def, from };
    this.shadowRoot?.getElementById('maIosSearchBar')?.classList.add('hidden');
    const tok = (this._chartTok = (this._chartTok || 0) + 1);
    this._chartSetMenuBtn(false);
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = def.label;
    const _lt = setTimeout(() => { if (tok === this._chartTok) { content.innerHTML = this._chartLoadingHTML('Checking today’s saved ' + def.label + '…'); content.scrollTop = 0; } }, 150);
    if (def.src === 'tmdb' && !this._mtTmdbKey()) { clearTimeout(_lt); content.innerHTML = this._psEmpty(def.path, 'TMDB key needed', 'Add a TMDB key in the card editor to see this chart.'); return; }
    const data = await this._mtChartItems(def, cc).catch(() => null);
    clearTimeout(_lt);
    content.scrollTop = 0;
    if (tok !== this._chartTok || this._chartsState?.level !== 'mt-chart') return;
    const srcName = def.src === 'itunes' ? 'Apple TV' : def.src === 'tvmaze' ? 'TVmaze' : 'TMDB';
    if (!data) {
      content.innerHTML = this._chartFailHTML(def.path, 'Couldn’t load ' + def.label, srcName + ' didn’t answer just now. Check your connection, then try again.');
      this._chartWireRetry(content, () => this._openMtChart(def, { from }));
      return;
    }
    if (data.freeview) { this._ukTonightRender(content, def, data, cc); return; }
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const day = new Date(data.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const pinned = this._chartIsPinned(def);
    const count = def.src === 'tvmaze' ? data.items.length + ' show' + (data.items.length === 1 ? '' : 's') : 'Top ' + data.items.length;
    content.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">${esc(count)} · ${esc(this._mtChartSourceLine(def, cc))} · ${esc(day)}</div>
      <div class="ma-drill-actions" id="mtChartActions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn" data-action="pin"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24" style="${pinned ? 'fill:#FFD60A' : ''}"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">${pinned ? 'Unpin' : 'Pin'}</span></button>
        <button class="ma-drill-action-btn" data-action="pdf" data-pdf="lists"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
      </div>
      <div id="mtChartList"></div>`;
    if (!this._pdfOn('lists')) content.querySelector('#mtChartActions [data-action="pdf"]')?.remove();
    const list = content.querySelector('#mtChartList');
    // same rows as the rest of Movies & TV: tap for Info, long-press to pin the title
    data.items.forEach(item => list.appendChild(this._mtMakeRow(item, false)));
    content.querySelectorAll('#mtChartActions .ma-drill-action-btn').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.action === 'pin') {
        this._chartTogglePin(def).then(now => {
          if (now === null) return;
          const lab = btn.querySelector('.ma-drill-btn-label');
          if (lab) lab.textContent = now ? 'Unpin' : 'Pin';
          const svg = btn.querySelector('svg');
          if (svg) svg.style.fill = now ? '#FFD60A' : '';
        });
      } else {
        if (!this._pdfOn('lists')) return;
        this._exportListPDF(async () => ({
          title: def.label, subtitle: this._mtChartSourceLine(def, cc),
          sections: [{ heading: count, thumbs: true, items: data.items.map((t, i) => ({ num: i + 1, title: t.title + (t.kind === 'tv' ? ' (TV)' : ''), sub: t.subtitle, thumb: t.artworkUrl100 || null })) }],
          filename: 'chart-' + def.label,
        }));
      }
    }));
  },

  // ── Podcast charts (Library → Podcasts; card editor → Lyrics & Discovery) ──
  // Apple Podcasts' Top Podcasts for the chart country, kept until midnight.
  _pcChartDefs() {
    const P = this._chartIcons();
    return [
      { id: 'pc-top', label: 'Top Podcasts', color: '#BF5AF2', path: 'M17,18.25V21.5H7V18.25C7,16.87 9.24,15.75 12,15.75C14.76,15.75 17,16.87 17,18.25M12,5.5A6.5,6.5 0 0,1 18.5,12C18.5,13.25 18.15,14.42 17.54,15.41L16,14.04C16.32,13.43 16.5,12.73 16.5,12C16.5,9.5 14.5,7.5 12,7.5C9.5,7.5 7.5,9.5 7.5,12C7.5,12.73 7.68,13.43 8,14.04L6.46,15.41C5.85,14.42 5.5,13.25 5.5,12A6.5,6.5 0 0,1 12,5.5M12,1.5A10.5,10.5 0 0,1 22.5,12C22.5,14.28 21.77,16.39 20.54,18.11L19.04,16.76C19.96,15.4 20.5,13.76 20.5,12A8.5,8.5 0 0,0 12,3.5A8.5,8.5 0 0,0 3.5,12C3.5,13.76 4.04,15.4 4.96,16.76L3.46,18.11C2.23,16.39 1.5,14.28 1.5,12A10.5,10.5 0 0,1 12,1.5M12,9.5A2.5,2.5 0 0,1 14.5,12A2.5,2.5 0 0,1 12,14.5A2.5,2.5 0 0,1 9.5,12A2.5,2.5 0 0,1 12,9.5Z', feed: 'podcasts' },
    ];
  },

  _pcChartItems(def, cc) {
    return this._chartCached('pc|' + def.feed + '|' + cc, async () => {
      if (def.feed === 'podcasts') {
        this._chartSay('Contacting Apple Podcasts\u2026');
        const L = await this._chartFetchJson('https://itunes.apple.com/' + cc + '/rss/toppodcasts/limit=50/json', j => Array.isArray(j?.feed?.entry) && j.feed.entry.length > 0, { what: 'Apple Podcasts', directOnly: true });
        const ent = L?.feed?.entry || [];
        if (ent.length) {
          const lbl = v => v?.label || '';
          const items = ent.map(e => {
            const img = (e['im:image'] || []).slice(-1)[0]?.label || '';
            return { collectionId: +(e.id?.attributes?.['im:id']) || 0, collectionName: lbl(e['im:name']), artistName: lbl(e['im:artist']), primaryGenreName: e.category?.attributes?.label || '',
              artworkUrl100: img.replace(/\/\d+x\d+(bb)?\./, '/200x200bb.'), artworkUrl600: img.replace(/\/\d+x\d+(bb)?\./, '/600x600bb.') };
          }).filter(p => p.collectionId && p.collectionName);
          if (items.length) return { items, updated: Date.parse(lbl(L.feed.updated)) || Date.now() };
        }
      }
      this._chartSayWhat = 'Apple Podcasts';
      const j = await this._chartAppleFeed(cc + '/podcasts/top/{n}/' + def.feed + '.json', 50).finally(() => { this._chartSayWhat = null; });
      const res = j?.feed?.results;
      if ((!Array.isArray(res) || !res.length) && def.feed === 'podcasts') return this._pcChartFromDeezer();
      if (!Array.isArray(res) || !res.length) return null;
      const art = (u, n) => String(u || '').replace(/\/\d+x\d+(bb)?\./, '/' + n + 'x' + n + 'bb.');
      const items = res.map(x => ({ collectionId: +x.id || x.id, collectionName: x.name || '', artistName: x.artistName || '', primaryGenreName: x.genres?.[0]?.name || '', artworkUrl100: art(x.artworkUrl100, 200), artworkUrl600: art(x.artworkUrl100, 600) }));
      return items.length ? { items, updated: Date.parse(j.feed.updated) || Date.now() } : null;
    });
  },

  // Top of the Podcasts tab: an Apple Podcasts heading with a drill-in row per chart
  _pcInjectCharts(content) {
    content.querySelector('#pc-charts-section')?.remove();
    if (!this._featOn('podcast_charts')) return;
    const cc = this._chartCountry();
    const defs = this._pcChartDefs();
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sec = document.createElement('div');
    sec.id = 'pc-charts-section';
    sec.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:4px 16px 2px;">Apple Podcasts</div>
      <div class="ma-ios-categories" style="padding-bottom:6px;">${defs.map((d, i) => `<div class="ma-ios-cat-row" data-key="${d.id}" data-color="${d.color}">
        <div class="ma-ios-cat-icon" style="background:${d.color}"><svg viewBox="0 0 24 24"><path d="${d.path}"/></svg></div>
        <span class="ma-ios-cat-label">${esc(d.label)}</span>
        ${i === 0 ? `<span style="font-size:13px;color:${this._pt('dim')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42%;">${esc(this._chartCountryName(cc))}</span>` : ''}
        <div class="ma-ios-cat-chevron"></div>
      </div>`).join('')}</div>`;
    content.insertBefore(sec, content.firstChild);
    this._chartRowGlow(sec);
    sec.querySelectorAll('.ma-ios-cat-row').forEach(r => r.addEventListener('click', () => {
      const d = defs.find(x => x.id === r.dataset.key);
      if (d) this._openPcChart(d);
    }));
    // fetched now in the background (and kept for the day) so opening one is instant; a failed fetch
    // never hides the row, it's simply tried again when it's opened
    defs.forEach(d => this._pcChartItems(d, cc).catch(() => {}));
  },

  async _openPcChart(def) {
    const content = this.shadowRoot?.getElementById('maContent');
    if (!content) return;
    const cc = this._chartCountry();
    this._chartsState = { level: 'pc', def };
    const tok = (this._chartTok = (this._chartTok || 0) + 1);
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = def.label;
    // the loading screen only if it isn't instant (a chart saved earlier today just appears)
    const _lt = setTimeout(() => { if (tok === this._chartTok) { content.innerHTML = this._chartLoadingHTML('Checking today\u2019s saved ' + def.label + '\u2026'); content.scrollTop = 0; } }, 150);
    const data = await this._pcChartItems(def, cc).catch(() => null);
    clearTimeout(_lt);
    content.scrollTop = 0;
    if (tok !== this._chartTok || this._chartsState?.level !== 'pc') return;
    if (!data) {
      content.innerHTML = this._chartFailHTML(def.path, 'Couldn\u2019t load ' + def.label, 'Apple Podcasts didn\u2019t answer just now. Check your connection, then try again.');
      this._chartWireRetry(content, () => this._openPcChart(def));
      return;
    }
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const day = new Date(data.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    content.innerHTML = `<div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">Top ${data.items.length} \u00b7 Apple Podcasts \u00b7 ${esc(this._chartCountryName(cc))} \u00b7 ${esc(day)}</div><div id="pcChartList"></div>`;
    const list = content.querySelector('#pcChartList');
    data.items.forEach(pod => list.appendChild(this._pcMakeRow(pod, false)));
  },

  // Back inside Charts: chart → its section (or Charts / Pins), section → Charts. False when not in Charts.
  _chartNavBack() {
    const st = this._chartsState;
    if (!st || st.level === 'list') return false;
    this._chartTok = (this._chartTok || 0) + 1;
    // a podcast chart: back to the Podcasts tab
    if (st.level === 'mt-chart') {
      if (st.from === 'pins') {
        this._chartsState = null;
        const b = this.shadowRoot?.getElementById('recentPlaysMenuBtn');
        if (b) { b.classList.remove('hidden'); b.onclick = () => this._showPinsMenu(b); }
        this._openPinnedCategoryDetail('charts');
      } else this._renderMtChartsList();
      return true;
    }
    if (st.level === 'mt-list') {
      this._chartsState = null;
      const t = this.shadowRoot?.getElementById('maTitle');
      if (t) t.textContent = 'Movies & TV';
      this.shadowRoot?.getElementById('maIosSearchBar')?.classList.remove('hidden');
      this._loadMATab('movie_tv');
      return true;
    }
    if (st.level === 'pc') {
      this._chartsState = null;
      const t = this.shadowRoot?.getElementById('maTitle');
      if (t) t.textContent = 'Podcasts';
      this._loadMATab('podcast');
      return true;
    }
    this.shadowRoot?.querySelectorAll('#chartMenu, #chartMenuBackdrop').forEach(e => e.remove());
    if (st.level === 'chart' && st.from === 'pins') {
      this._chartsState = null;
      const b = this.shadowRoot?.getElementById('recentPlaysMenuBtn');
      if (b) { b.classList.remove('hidden'); b.onclick = () => this._showPinsMenu(b); }
      this._openPinnedCategoryDetail('charts');
    } else if (st.level === 'chart' && st.from === 'section' && st.sec) this._openChartSection(st.sec);
    else this._renderChartsList();
    return true;
  },

  // Header ⋯ inside a chart: how many songs to show
  _showChartMenu(anchorEl) {
    const r = this.shadowRoot;
    const existing = r.getElementById('chartMenu');
    if (existing) { existing.remove(); r.getElementById('chartMenuBackdrop')?.remove(); return; }
    const st = this._chartsState;
    if (st?.level !== 'chart') return;
    const backdrop = document.createElement('div');
    backdrop.id = 'chartMenuBackdrop';
    backdrop.className = 'queue-dropdown-backdrop';
    const openedAt = Date.now();
    const menu = document.createElement('div');
    menu.id = 'chartMenu';
    menu.className = 'queue-dropdown-menu';
    const tick = 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z';
    const listIco = 'M7,13V11H21V13H7M7,19V17H21V19H7M7,7V5H21V7H7M3,8V5H2V4H4V8H3M2,17V16H5V20H2V19H4V18.5H3V17.5H4V17H2M4.25,10A0.75,0.75 0 0,1 5,10.75C5,10.95 4.92,11.14 4.79,11.27L3.12,13H5V14H2V13.08L4,11H2V10H4.25Z';
    const total = st.total || 100;
    // only the sizes this chart actually has (an album or a Top 40 stops where it ends)
    const opts = [10, 50, 100].filter((n, i, a) => i === 0 || total > a[i - 1]);
    const cur = opts.includes(st.limit) ? st.limit : opts.filter(n => n <= st.limit).pop() || 10;
    const label = n => (n >= total && total < 100 ? (total === n ? 'Top ' + n : 'All ' + total) : 'Top ' + n);
    menu.innerHTML = opts.map(n => `<div class="queue-dropdown-item" data-n="${n}" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="${cur === n ? tick : listIco}"/></svg><span class="queue-dropdown-label" style="${cur === n ? 'font-weight:700;' : ''}">${label(n)}</span></div>`).join('');
    const ar = anchorEl.getBoundingClientRect(), cr = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (ar.bottom - cr.top + 4) + 'px';
    menu.style.right = Math.max(4, cr.right - ar.right) + 'px';
    const host = this._menuHost(anchorEl);
    host.appendChild(backdrop);
    host.appendChild(menu);
    const close = () => { menu.remove(); backdrop.remove(); };
    backdrop.addEventListener('pointerdown', () => { if (Date.now() - openedAt > 200) close(); });
    menu.querySelectorAll('.queue-dropdown-item').forEach(el => el.addEventListener('click', () => {
      if (Date.now() - openedAt < 250) return;
      close();
      const n = +el.dataset.n;
      this._chartLimit = n;
      try { localStorage.setItem('crow_media_chart_limit', String(n)); } catch (_) {}
      const s = this._chartsState;
      if (s?.level === 'chart') this._openChart(s.def, { from: s.from, sec: s.sec, limit: n });
    }));
  },

  // Play All / Add / Play Next for the songs on screen, matched through Music Assistant by title and artist
  async _chartPlayList(tracks, action) {
    const target = this._maEntityIds?.has(this._entity) ? this._entity : (this._getValidMASpeakers(true)[0] || null);
    if (!target || !tracks?.length) { this._showToast('Music Assistant required'); return; }
    const queueLen = async () => {
      if (!this._hass?.services?.mass_queue?.get_queue_items) return null;
      try {
        const res = await this._hass.connection.sendMessagePromise({ type: 'call_service', domain: 'mass_queue', service: 'get_queue_items', service_data: { entity: target, limit_before: 9999, limit_after: 9999 }, return_response: true });
        const raw = res?.response?.[target] || res?.response || [];
        return Array.isArray(raw) ? raw.length : null;
      } catch (_) { return null; }
    };
    const call = (t, enqueue, extra = {}) => this._hass.connection.sendMessagePromise({
      type: 'call_service', domain: 'music_assistant', service: 'play_media',
      service_data: { entity_id: target, media_id: (t.title + ' ' + (t.artist || '')).trim(), media_type: 'track', enqueue, ...extra },
    }).then(() => true, () => false);
    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 60000);
    this._pillPulse(20000);
    this._showLoadingToast(action === 'replace' ? 'Starting playback…' : action === 'next' ? 'Queuing next…' : 'Adding to Queue…');
    let ok = 0;
    if (action === 'replace') {
      this._lastMAPlayTarget = target;
      this._recordMAPlayStart?.(target);
      this._closeMABrowser(true);
      let started = false;
      for (const t of tracks) {
        if (!started) { started = await call(t, 'replace', { radio_mode: false }); if (started) ok++; }
        else if (await call(t, 'add')) ok++;
      }
    } else {
      const before = await queueLen();
      // Play Next goes in reverse so the chart stays in order after the current song
      const order = action === 'next' ? [...tracks].reverse() : tracks;
      for (const t of order) if (await call(t, action === 'next' ? 'next' : 'add')) ok++;
      if (before !== null) { const after = await queueLen(); if (after !== null) ok = Math.max(0, Math.min(ok, after - before)); }
    }
    this._maBatchLoading = false;
    clearTimeout(this._maBatchLoadingTimer);
    this._pillPulse(0);
    const skipped = tracks.length - ok;
    const spk = this._entityDisplayName(target);
    if (!ok) this._showToast('⚠️ None of these songs were found in Music Assistant', 4000);
    else this._showToast((action === 'replace' ? 'Playing ' : action === 'next' ? 'Playing next — ' : 'Added ') + ok + ' song' + (ok === 1 ? '' : 's') + ' on ' + spk + (skipped > 0 ? ' · ' + skipped + ' not found' : ''), 4000);
  },

  _savePinnedCharts(list) {
    const k = this._chartPinsKey();
    if (!this._starredMemCache) this._starredMemCache = {};
    this._starredMemCache[k] = list;
    try { localStorage.setItem(k, JSON.stringify(list)); } catch (_) {}
    this._haStorageSavePins();
    this._updatePinnedIndicator?.();
  },

  _chartPinName(def) { return def.kind === 'mt' ? def.label : def.kind === 'apple' ? def.label + ' · ' + this._chartCountryName(def.country) : def.label; },

  _chartIsPinned(def) { return this._getPinnedCharts().some(p => p.id === def.id); },

  async _chartTogglePin(def) {
    const list = this._getPinnedCharts();
    const name = this._chartPinName(def);
    if (list.some(p => p.id === def.id)) {
      if (!(await this._confirmUnpin('chart', name))) return null;
      this._savePinnedCharts(list.filter(p => p.id !== def.id));
      this._showToast('Chart unpinned');
      return false;
    }
    // name it first, the same way as pinning a queue or a recap
    const chosen = await this._chartNameSheet({ title: 'Pin Chart', sub: def.kind === 'mt' ? this._mtChartSourceLine(def) : this._chartSourceLine(def), value: name, button: 'Pin' });
    if (chosen == null) return null;
    const { id, kind, dzId, amId, mbid, src, feed, label, sub, art, country } = def;
    const fresh = this._getPinnedCharts().filter(p => p.id !== id);
    fresh.unshift({ id, kind, dzId, amId, mbid, src, feed, label, sub, art, country, name: chosen, pinnedAt: Date.now() });
    this._savePinnedCharts(fresh);
    this._showToast('\ud83d\udccd Pinned \u201c' + chosen + '\u201d');
    return true;
  },

  // The naming sheet for a pinned chart (same look as Pin Queue as Playlist / Pin Music Recap).
  // Resolves to the name, or null if closed without saving.
  _chartNameSheet({ title, sub, value, button }) {
    return new Promise(resolve => {
      const _pt = k => this._pt(k);
      const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
      const sheet = document.createElement('div');
      sheet.className = 'crow-media-rb-tag-sheet';
      sheet.style.cssText = 'position:absolute;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);left:0;top:' + window.scrollY + 'px;width:' + document.documentElement.clientWidth + 'px;height:' + window.innerHeight + 'px;';
      sheet.innerHTML = '<div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
        + '<span style="font-size:15px;font-weight:700;color:' + _pt('text') + ';">' + esc(title) + '</span>'
        + '<button class="crow-media-rb-tag-sheet-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + _pt('text') + '"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>'
        + '</div>'
        + (sub ? '<div style="font-size:12px;color:' + _pt('dim') + ';margin-bottom:10px;">' + esc(sub) + '</div>' : '')
        + '<input id="chartPinNameInput" type="text" value="' + esc(value) + '" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 12px;font-size:14px;color:' + _pt('text') + ';font-family:inherit;margin-bottom:14px;" autocomplete="off" autocorrect="off" spellcheck="false">'
        + '<button id="chartPinSaveBtn" style="width:100%;padding:11px;background:#0A84FF;border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;">' + esc(button) + '</button>'
        + '</div>';
      this._bodyAppend(sheet);
      let done = false;
      const finish = v => { if (done) return; done = true; sheet.remove(); resolve(v); };
      sheet.addEventListener('click', e => { if (e.target === sheet) finish(null); });
      sheet.querySelector('.crow-media-rb-tag-sheet-close')?.addEventListener('click', () => finish(null));
      const input = sheet.querySelector('#chartPinNameInput');
      const save = () => finish((input?.value || '').trim() || value);
      sheet.querySelector('#chartPinSaveBtn')?.addEventListener('click', save);
      input?.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      input?.focus();
      input?.select();
    });
  },

  // A pinned entry back into a chart definition
  _chartPinDef(p) {
    if (p.kind === 'apple' || p.chart === 'apple:top') return this._chartAppleDef(p.country || this._chartCountry());
    if (p.kind === 'mt') { const d = this._mtChartGroups().flatMap(g => g.items).find(x => x.id === p.id); return d || null; }
    if (p.kind === 'am-album' && p.amId) return { id: p.id, kind: p.kind, amId: p.amId, country: p.country, label: p.label, sub: p.sub, art: p.art };
    if (p.kind && p.dzId) return { id: p.id, kind: p.kind, dzId: p.dzId, label: p.label, sub: p.sub, art: p.art };
    return null;
  },

  // A row in Pins → Charts
  _makePinnedChartRow(p) {
    const def = this._chartPinDef(p);
    const wrap = document.createElement('div');
    wrap.className = 'ma-item-wrap';
    if (!def) return wrap;
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const art = def.kind === 'apple' || def.kind === 'mt'
      ? `<div class="ma-item-art" style="background:${def.color};"><svg viewBox="0 0 24 24" style="fill:#fff;width:55%;height:55%;"><path d="${def.path}"/></svg></div>`
      : `<div class="ma-item-art" style="position:relative;background:${this._pt('bg')};${def.kind === 'artist' ? 'border-radius:50%;' : ''}"><svg viewBox="0 0 24 24"><path d="${this._chartIcons().list}"/></svg>${def.art ? `<img src="${esc(def.art)}" alt="" loading="lazy" style="position:absolute;inset:0;" onerror="this.remove()">` : ''}</div>`;
    wrap.innerHTML = `<div class="ma-item">${art}
        <div class="ma-item-info"><div class="ma-item-title">${esc(p.name || def.label)}</div><div class="ma-item-sub">${esc(def.kind === 'mt' ? this._mtChartSourceLine(def) : this._chartSourceLine(def))}</div></div>
        <div class="ma-item-chevron"></div>
      </div>`;
    const el = wrap.firstElementChild;
    let lpTimer = null, lpFired = false;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', () => { lpFired = false; lpTimer = setTimeout(() => { lpFired = true; this._showPinnedChartMenu(el, p, def); }, 480); }, { passive: true });
    el.addEventListener('pointerup', () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('pointercancel', () => { clearTimeout(lpTimer); lpFired = false; }, { passive: true });
    el.addEventListener('pointermove', () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }
      // opens under the name it was pinned with
      if (def.kind === 'mt') this._openMtChart({ ...def, label: p.name || def.label }, { from: 'pins' });
      else this._openChart({ ...def, label: p.name || def.label }, { from: 'pins' });
    });
    this._rowSwipe(el, { menu: (h) => this._showPinnedChartMenu(el, p, def, h), left: ['unpin', 'more'] }, wrap);
    return wrap;
  },

  _showPinnedChartMenu(anchor, p, def, headless = false) {
    const r = this.shadowRoot;
    const backdrop = document.createElement('div');
    backdrop.className = 'queue-dropdown-backdrop';
    const menu = document.createElement('div');
    menu.className = 'queue-dropdown-menu';
    menu.innerHTML =
      `<div class="queue-dropdown-item" data-a="open" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="${this._chartIcons().trend}"/></svg><span class="queue-dropdown-label">Open Chart</span></div>` +
      '<div class="queue-dropdown-item" data-a="rename" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04Z"/></svg><span class="queue-dropdown-label">Rename</span></div>' +
      '<div class="queue-dropdown-item danger" data-a="unpin" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg><span class="queue-dropdown-label">Unpin</span></div>';
    const ar = anchor.getBoundingClientRect(), cr = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (ar.bottom - cr.top + 4) + 'px';
    const host = this._menuHost(anchor);
    if (!headless) { host.appendChild(backdrop); host.appendChild(menu); }
    const openedAt = Date.now(), ready = () => headless || Date.now() - openedAt > 320;
    const close = () => { menu.remove(); backdrop.remove(); };
    backdrop.addEventListener('pointerdown', () => { if (ready()) close(); });
    menu.querySelectorAll('.queue-dropdown-item').forEach(el => el.addEventListener('click', async e => {
      e.stopPropagation();
      if (!ready()) return;
      close();
      if (el.dataset.a === 'open') { if (def.kind === 'mt') this._openMtChart({ ...def, label: p.name || def.label }, { from: 'pins' }); else this._openChart(def, { from: 'pins' }); return; }
      if (el.dataset.a === 'rename') {
        const nn = await this._chartNameSheet({ title: 'Rename Chart', sub: def.kind === 'mt' ? this._mtChartSourceLine(def) : this._chartSourceLine(def), value: p.name || def.label, button: 'Save' });
        if (nn == null) return;
        this._savePinnedCharts(this._getPinnedCharts().map(x => x.id === p.id ? { ...x, name: nn } : x));
        this._showToast('Renamed to \u201c' + nn + '\u201d');
        if (this._pinnedDetailActive && this._pinnedDetailCategory === 'charts') this._openPinnedCategoryDetail('charts');
        return;
      }
      if (!(await this._confirmUnpin('chart', p.name || def.label))) return;
      this._savePinnedCharts(this._getPinnedCharts().filter(x => x.id !== p.id));
      this._showToast('Chart unpinned');
      if (this._pinnedDetailActive && this._pinnedDetailCategory === 'charts') this._openPinnedCategoryDetail('charts');
    }));
    if (headless) return this._menuHeadless(menu);
  },

  // Export: the chart as a list PDF (rank, title, artist, artwork)
  _exportChartPDF(def, tracks, updated, srcLine) {
    if (!this._pdfOn('lists')) return;
    this._exportListPDF(async () => {
      if (!tracks?.length) return null;
      return {
        title: def.label, subtitle: srcLine || this._chartSourceLine(def),
        sections: [{ heading: (this._chartIsAlbum(def) ? '' : 'Top ') + tracks.length + (this._chartIsAlbum(def) ? ' songs' : ''), thumbs: true, items: tracks.map((t, i) => ({ num: i + 1, title: t.title, sub: t.artist, thumb: t.art || null })) }],
        filename: 'chart-' + this._chartPinName(def),
      };
    });
  },

  // how many plays Music History shows: the last 10, 50, 100, 250 or 500
  _rpLimit() {
    const v = this._recentPlaysExpanded;
    return [10, 50, 100, 250, 500].includes(v) ? v : v ? 50 : 10;
  },

  _renderRecentPlaysTab(content) {
    if (!content) return;
    const esc = s => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const _limit = this._rpLimit();
    // mediaType is 'music' for everything _logListenEntry writes (the log
    // itself is meant to be music-only, filtered at write time by
    // _recapShouldExclude) — checked again explicitly here as a second
    // layer, since that's the same defense-in-depth approach already used
    // elsewhere rather than trusting a single filter point.
    const entries = this._getListenLogEntries()
      .filter(e => e.title && e.artist && (e.mediaType || 'music') === 'music')
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, _limit);

    const _relTime = ts => {
      const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return diffMin + 'm ago';
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return diffHr + 'h ago';
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 7) return diffDay + 'd ago';
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    content.innerHTML = entries.length
      ? `<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);letter-spacing:0.6px;text-transform:uppercase;margin:2px 4px 10px;text-align:center;">${entries.length} Recent Play${entries.length === 1 ? '' : 's'}</div>
        <div class="ma-drill-actions" id="recentPlaysActions" style="margin-bottom:14px;">
          <button class="ma-drill-action-btn" data-action="replace"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>
          ${this._shuffleBtnHtml()}
          <button class="ma-drill-action-btn" data-action="add"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add All</span></button>
          <button class="ma-drill-action-btn" data-action="next"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>
          <button class="ma-drill-action-btn" data-action="pdf" data-pdf="history"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
        </div>
        <div id="recentPlaysList"></div>`
      : `<div id="recentPlaysList"></div>`;

    const list = content.querySelector('#recentPlaysList');
    if (!entries.length) {
      list.innerHTML = this._psEmpty(
        'M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z',
        'No recent plays yet',
        'Songs you play will show up here.'
      );
    } else {
      const _fallbackNoteIcon = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z"/></svg>';
      entries.forEach(e => {
        const wrap = document.createElement('div');
        wrap.className = 'ma-item-wrap';
        const el = document.createElement('div');
        el.className = 'ma-item';

        // Same iTunes lookup/fetch pattern already used by Recently Listened
        // To's own track rows — history entries never store an artwork URL,
        // just title/artist/album, so this is the same situation. Checks
        // the shared cache first (instant if any other view already fetched
        // this same track), and if not cached, kicks off a fetch; a global
        // mechanism keyed by data-itunes-key patches this exact element
        // once that resolves, so no extra re-render wiring is needed here.
        const itunesKey = (e.artist || e.album || e.title)
          ? [e.artist, e.album || e.title].filter(Boolean).join('|').toLowerCase()
          : '';
        const cachedArt = itunesKey ? (this._itunesArtCache?.[itunesKey] || '') : '';
        const keyAttr = itunesKey ? ' data-itunes-key="' + itunesKey.replace(/"/g, '&quot;') + '"' : '';
        const artInner = cachedArt
          ? _fallbackNoteIcon + '<img src="' + cachedArt + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">'
          : _fallbackNoteIcon;

        el.innerHTML =
          `<div class="ma-item-art"${keyAttr} style="position:relative;background:${this._pt("bg")};display:flex;align-items:center;justify-content:center;">
            ${artInner}
          </div>
          <div class="ma-item-info"><div class="ma-item-title">${esc(e.title)}</div>
            <div class="ma-item-sub">${esc(e.artist)} · ${_relTime(e.ts)}</div>
          </div>`;
        if (!cachedArt && itunesKey) this._fetchItunesArt(e.artist, e.album, e.title, { skipStaleGuard: true });
        wrap.appendChild(el);
        // Same structure and technique the Songs tab's own rows use — glow
        // applied to the outer .ma-item-wrap, with .ma-item's own
        // near-opaque background (from the shared CSS class) shielding the
        // text so it reads as a soft edge tint rather than overpowering it.
        // Only fires here on a cache hit; _patchQueueArt applies the same
        // treatment once a fetch resolves for the common case where this
        // track isn't cached yet.
        if (this._config?.row_glow === true && cachedArt) this._observeRowGlow(cachedArt, wrap, null);

        // Fuzzy identity — history entries only ever store title/artist/album,
        // never a real media URI, same situation as AI-suggested tracks
        // elsewhere in the card. Same title-artist:// fallback used by
        // double-tap-to-pin and the AI Info panel's own pin button, so
        // pinning here and pinning there always agree on identity.
        const item = {
          uri: 'title-artist://' + e.title.toLowerCase().trim() + '|' + e.artist.toLowerCase().trim(),
          name: e.title, title: e.title, artist: e.artist,
          artists: [{ name: e.artist }],
          album: e.album || '', media_type: 'track',
        };

        wrap.addEventListener('click', () => {
          this._showAITrackInfo(e.title, e.artist, {});
        });

        // the song's menu: Remove from History and the rest (the hold and the swipes share it)
        const _histMenu = (h) => {
            const _trash = '<path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>';
            const _mute  = '<path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M4,12A8,8 0 0,1 12,4C13.85,4 15.55,4.63 16.9,5.69L5.69,16.9C4.63,15.55 4,13.85 4,12M12,20C10.15,20 8.45,19.37 7.1,18.31L18.31,7.1C19.37,8.45 20,10.15 20,12A8,8 0 0,1 12,20Z"/>';
            return this._showEnqueueMenu(item, 'track', wrap, {
              extraItems: [
                { mode: 'history_remove', label: 'Remove from History', icon: _trash, danger: true,
                  onClick: async () => {
                    const ok = await this._iosConfirm({
                      title: 'Remove from History?',
                      message: 'This play of \u201c' + e.title + '\u201d by ' + e.artist
                        + ' will be removed from Music History and Music Recap. This can\u2019t be undone.',
                      confirmLabel: 'Remove', destructive: true,
                    });
                    if (!ok) return;
                    this._removeListenEntries([e._key].filter(Boolean));
                    this._showToast('Removed from History');
                    const _scroll = content.scrollTop;
                    this._renderRecentPlaysTab(content);
                    content.scrollTop = _scroll;
                  } },
                // Every play of this song, not just this row — only offered
                // when there's more than one, otherwise it's the same as
                // Remove from History above.
                ...(() => {
                  const _norm = v => (v || '').toString().toLowerCase().trim();
                  const _same = this._getListenLogEntries()
                    .filter(x => _norm(x.title) === _norm(e.title) && _norm(x.artist) === _norm(e.artist));
                  if (_same.length < 2) return [];
                  return [{ mode: 'history_remove_all', label: 'Remove All Plays', icon: _trash, danger: true,
                    onClick: async () => {
                      const ok = await this._iosConfirm({
                        title: 'Remove All Plays?',
                        message: 'This removes all ' + _same.length + ' plays of \u201c' + e.title + '\u201d by ' + e.artist
                          + ' from Music History and Music Recap. This can\u2019t be undone.',
                        confirmLabel: 'Remove All',
                        cancelLabel: 'Cancel',
                        destructive: true,
                      });
                      if (!ok) return;
                      // Re-read at confirm time so plays logged while the
                      // dialog was open are included too.
                      const keys = this._getListenLogEntries()
                        .filter(x => _norm(x.title) === _norm(e.title) && _norm(x.artist) === _norm(e.artist))
                        .map(x => x._key).filter(Boolean);
                      this._removeListenEntries(keys);
                      this._showToast('Removed ' + keys.length + ' plays');
                      const _scroll = content.scrollTop;
                      this._renderRecentPlaysTab(content);
                      content.scrollTop = _scroll;
                    } }];
                })(),
                { mode: 'history_mute', label: 'Never Log This Artist', icon: _mute, danger: true,
                  onClick: () => this._confirmMuteArtist(e.artist, content) },
              ],
            }, h);
        };
        let _lpTimer = null, _lpFired = false;
        wrap.addEventListener('pointerdown', () => {
          _lpFired = false;
          _lpTimer = setTimeout(() => {
            _lpFired = true;
            _histMenu(false);
          }, 480);
        }, { passive: true });
        wrap.addEventListener('pointerup',     () => clearTimeout(_lpTimer), { passive: true });
        wrap.addEventListener('pointercancel', () => { clearTimeout(_lpTimer); _lpFired = false; }, { passive: true });
        wrap.addEventListener('pointermove',   () => clearTimeout(_lpTimer), { passive: true });
        wrap.addEventListener('click', (e) => { if (_lpFired) { e.stopPropagation(); e.preventDefault(); } }, true);
        this._rowSwipe(el, { menu: _histMenu, right: ['add', 'next'], left: ['play_all', 'history_remove', 'more'] }, wrap);

        list.appendChild(wrap);
      });
    }

    // Play All / Add All / Play Next — same batching pattern as the AI
    // Search panel's own action bar, since these entries are the same shape
    // (title/artist only, no real media URI, resolved via MA's own fuzzy
    // search on a plain "title artist" string). Deliberately wired against
    // `entries` — whichever count (10 or 50) is actually on screen right
    // now — rather than always the full history, so the bar always acts on
    // exactly what it looks like it will.
    if (entries.length) {
      const self = this;
      const _barTarget = (() => {
        const _allMA = self._getValidMASpeakers ? self._getValidMASpeakers(true) : [];
        if (self._lastMAPlayTarget && _allMA.includes(self._lastMAPlayTarget)) return self._lastMAPlayTarget;
        if (_allMA.length) return _allMA[0];
        return self._entity;
      })();
      const _mediaId = e => `${e.title} ${e.artist || ''}`.trim();

      content.querySelector('#recentPlaysActions')?.querySelectorAll('.ma-drill-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (action === 'pdf') { self._exportHistoryReport('music', 30); return; }
          if (action === 'shuffle') { self._crowShufflePlay(entries, { target: _barTarget }); return; }
          self._maBatchLoading = true;
          clearTimeout(self._maBatchLoadingTimer);
          self._maBatchLoadingTimer = setTimeout(() => { self._maBatchLoading = false; }, 20000);
          self._pillPulse(20000);
          let successCount = 0;
          if (action === 'replace') {
            (typeof self?._showLoadingToast === 'function' ? self : this)._showLoadingToast('Starting playback\u2026');
            const [first, ...rest] = entries;
            try {
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _barTarget, media_id: _mediaId(first), media_type: 'track', enqueue: 'replace' }
              });
              successCount++;
            } catch (_) {}
            for (const e of rest) {
              try {
                await self._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: _barTarget, media_id: _mediaId(e), media_type: 'track', enqueue: 'add' }
                });
                successCount++;
              } catch (_) {}
            }
            self._closeMABrowser(true);
          } else {
            const enqueueMode = action === 'next' ? 'next' : 'add';
            for (const e of entries) {
              try {
                await self._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: _barTarget, media_id: _mediaId(e), media_type: 'track', enqueue: enqueueMode }
                });
                successCount++;
              } catch (_) {}
            }
          }
          self._maBatchLoading = false;
          clearTimeout(self._maBatchLoadingTimer);
          self._pillPulse(0);
          const _spkName = self._entityDisplayName(_barTarget);
          if (successCount === 0 && action !== 'replace') {

            self._showToast('\u26a0\ufe0f Couldn\u2019t add to queue \u2014 check Music Assistant.', 4000);

          } else if (action !== 'replace') {
            const label = action === 'next' ? 'Playing next' : 'Added to queue';
            self._showToast(`${label} — ${successCount} track${successCount === 1 ? '' : 's'} on ${_spkName}`, 3000);
          }
        });
      });
    }
  },

  // Small dropdown for the 3-dot button — same visual pattern as the Queue
  // panel's own 3-dot menu. Just one toggle: expand this same view to the
  // last 50 plays instead of 10, or collapse back.
  // Pins' 3-dot menu (shared header button) — just the catalogue export.
  _showPinsMenu(anchorEl) {
    const r = this.shadowRoot;
    const existing = r.getElementById('pinsMenu');
    if (existing) { existing.remove(); r.getElementById('pinsMenuBackdrop')?.remove(); return; }
    const backdrop = document.createElement('div');
    backdrop.id = 'pinsMenuBackdrop';
    backdrop.className = 'queue-dropdown-backdrop';
    const _openedAt = Date.now();
    const menu = document.createElement('div');
    menu.id = 'pinsMenu';
    menu.className = 'queue-dropdown-menu';
    menu.innerHTML = '<div class="queue-dropdown-item" id="pinsExport" data-pdf="pins" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg><span class="queue-dropdown-label">Export Pins to PDF</span></div>';
    const anchorRect = anchorEl.getBoundingClientRect();
    const cardRect = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (anchorRect.bottom - cardRect.top + 4) + 'px';
    menu.style.right = Math.max(4, cardRect.right - anchorRect.right) + 'px';
    const host = this._menuHost(anchorEl);
    host.appendChild(backdrop);
    host.appendChild(menu);
    const closeMenu = () => { menu.remove(); backdrop.remove(); };
    backdrop.addEventListener('pointerdown', () => { if (Date.now() - _openedAt > 200) closeMenu(); });
    menu.querySelector('#pinsExport')?.addEventListener('click', () => { closeMenu(); this._exportPinsPDF(); });
  },

  _showRecentPlaysMenu(anchorEl) {
    const r = this.shadowRoot;
    // Toggle-close — same pattern the Queue panel's own "⋮" menu uses:
    // pressing the button again while the menu's already open closes it,
    // rather than tearing it down and immediately rebuilding an identical
    // one in its place.
    const existing = r.getElementById('rpMenu');
    if (existing) { existing.remove(); r.getElementById('rpMenuBackdrop')?.remove(); return; }

    const backdrop = document.createElement('div');
    backdrop.id = 'rpMenuBackdrop';
    backdrop.className = 'queue-dropdown-backdrop';
    const _openedAt = Date.now();
    backdrop.addEventListener('pointerdown', () => { if (Date.now() - _openedAt > 200) closeMenu(); });

    const menu = document.createElement('div');
    menu.id = 'rpMenu';
    menu.className = 'queue-dropdown-menu';
    // the other lengths on offer (the one showing is left out)
    const _limitNow = this._rpLimit();
    menu.innerHTML =
      `${[10, 50, 100, 250, 500].filter(n => n !== _limitNow).map(n => `<div class="queue-dropdown-item rp-limit" data-limit="${n}" role="button">
        <svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/></svg>
        <span class="queue-dropdown-label">Show last ${n}</span>
      </div>`).join('')}
      ${Object.keys(this._getMutedArtists()).length ? `<div class="queue-dropdown-item" id="rpMutedArtists" role="button">
        <svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M4,12A8,8 0 0,1 12,4C13.85,4 15.55,4.63 16.9,5.69L5.69,16.9C4.63,15.55 4,13.85 4,12M12,20C10.15,20 8.45,19.37 7.1,18.31L18.31,7.1C19.37,8.45 20,10.15 20,12A8,8 0 0,1 12,20Z"/></svg>
        <span class="queue-dropdown-label">Muted Artists</span>
      </div>` : ''}
<div class="queue-dropdown-item" id="rpExportReport" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z"/></svg><span class="queue-dropdown-label">Export to PDF</span></div>
      <div class="queue-dropdown-item danger" id="rpClearHistory" role="button">
        <svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
        <span class="queue-dropdown-label">Clear History</span>
      </div>`;

    const anchorRect = anchorEl.getBoundingClientRect();
    const cardRect = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (anchorRect.bottom - cardRect.top + 4) + 'px';
    menu.style.right = Math.max(4, cardRect.right - anchorRect.right) + 'px';

    const host = this._menuHost(anchorEl);
    host.appendChild(backdrop);
    host.appendChild(menu);

    const closeMenu = () => { menu.remove(); backdrop.remove(); };
    menu.querySelectorAll('.rp-limit').forEach(el => el.addEventListener('click', () => {
      closeMenu();
      this._recentPlaysExpanded = +el.dataset.limit;
      const content = this.shadowRoot?.getElementById('maContent');
      this._renderRecentPlaysTab(content);
    }));
    menu.querySelector('#rpClearHistory')?.addEventListener('click', () => {
      closeMenu();
      this._confirmClearRecentPlays();
    });
    if (!['history', 'month', 'recent'].some(t => this._pdfOn(t))) menu.querySelector('#rpExportReport')?.remove();
    menu.querySelector('#rpExportReport')?.addEventListener('click', async () => {
      closeMenu();
      const _rpOpts = [
        { label: 'Listening report', value: 'report', pdf: 'history' },
        { label: 'Your month in music', value: 'month', pdf: 'month' },
        { label: 'Recently played on a speaker', value: 'recent', pdf: 'recent' },
      ].filter(o => this._pdfOn(o.pdf));
      if (!_rpOpts.length) return;
      const which = _rpOpts.length === 1 ? _rpOpts[0].value
        : await this._iosChoose({ title: 'Export to PDF', message: 'Which report would you like?', options: _rpOpts, selected: _rpOpts[0].value });
      if (which === 'report') this._exportHistoryReport('music', 30);
      else if (which === 'month') this._exportMonthReport();
      else if (which === 'recent') this._exportRecentlyPlayedPDF();
    });
    menu.querySelector('#rpMutedArtists')?.addEventListener('click', () => {
      closeMenu();
      this._showMutedArtistsView(this.shadowRoot?.getElementById('maContent'));
    });
  },

  _renderMAIosView() {
    const r = this.shadowRoot;
    const el = r.getElementById('maIosView');
    if (!el) return;
    this._saveLibraryOpenState('__ios_root__');
    this._chartsState = null;
    // Remove any stray lightbox — the root view is the safest catch-all since
    // every navigation path that lands here eventually calls this function.
    r.getElementById('cardOuter')?.querySelectorAll('.crow-bio-lightbox').forEach(e => e.remove());
    // Remove any stray dropdown menu/backdrop too — several context menus
    // across the app (queue options, pinned recap/watch-recap/movie-TV
    // context menus) create a transparent, absolutely-positioned backdrop
    // at whatever position they were last anchored to. If one of those
    // isn't dismissed before navigating away (e.g. the popup gets closed
    // entirely while the menu is still open), it's left stuck in the DOM —
    // invisible, but still there — and can end up sitting on top of part of
    // this completely unrelated screen, silently blocking clicks on
    // whatever happens to be underneath it.
    r.querySelectorAll('.queue-dropdown-menu, .queue-dropdown-backdrop').forEach(e => e.remove());

    const CATS = [
      { tab: 'recent_searches', label: 'Recent Searches', color: '#8E8E93', path: 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z' },
      { tab: 'recent_plays', label: 'Music History', color: '#64D2FF', path: 'M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z' },
      { tab: 'recently_watched', label: 'Watch History', color: '#A78BFA', path: 'M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z' },
      { tab: 'recently_added', label: 'Recently Added', color: '#00C7BE', path: 'M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,19.99 10.52,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3M14,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8H14Z' },
      { tab: 'pinned',         label: 'Pins',           color: '#FFD60A', path: 'M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z' },
      { tab: 'favourites',  label: 'Favourites',    color: '#FF9500', path: 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z' },
      ...(this._chartsOn() ? [{ tab: 'charts', label: 'Charts', color: '#FA2D48', path: 'M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z' }] : []),
      { tab: 'recommended', label: 'Made for You',  color: '#FF3B30', path: 'M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z' },
      { tab: 'playlist',    label: 'Playlists',     color: '#FF9F0A', path: 'M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A4,4 0 0,0 12,18A4,4 0 0,0 16,22A4,4 0 0,0 20,18V8H23V6H17Z' },
      { tab: 'artist',      label: 'Artists',       color: '#FF2D55', path: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z' },
      { tab: 'album',       label: 'Albums',        color: '#5856D6', path: 'M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12,16.5C9.5,16.5 7.5,14.5 7.5,12C7.5,9.5 9.5,7.5 12,7.5C14.5,7.5 16.5,9.5 16.5,12C16.5,14.5 14.5,16.5 12,16.5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z' },
      { tab: 'track',       label: 'Songs',         color: '#34C759', path: 'M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z' },
      { tab: 'radio',       label: 'Radio',         color: '#FF9F0A', path: 'M19,6.41L4.86,2.28L4.29,4.2L7,5V7H5A2,2 0 0,0 3,9V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V9A2,2 0 0,0 19,7H9V5.75L19,8.55V6.41M7,9A2,2 0 0,1 9,11A2,2 0 0,1 7,13A2,2 0 0,1 5,11A2,2 0 0,1 7,9M17,18H7V16H17V18M19,14H11V10H19V14Z' },
      { tab: 'podcast',     label: 'Podcasts',      color: '#BF5AF2', path: 'M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,7A5,5 0 0,0 7,12C7,14.76 8.58,17.15 11,18.27V16.06C9.8,15.16 9,13.68 9,12A3,3 0 0,1 12,9A3,3 0 0,1 15,12C15,13.68 14.2,15.16 13,16.06V18.27C15.42,17.15 17,14.76 17,12A5,5 0 0,0 12,7M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11Z' },
      { tab: 'audiobook',   label: 'Audiobooks',    color: '#32ADE6', path: 'M18,22A2,2 0 0,0 20,20V4C20,2.89 19.1,2 18,2H12V9L9.5,7.5L7,9V2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18Z' },
      { tab: 'movie_tv',    label: 'Movies & TV',   color: '#FF453A', path: 'M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z' },
    ];

    const glowOn = this._config?.row_glow === true;
    const catHtml = CATS.map(c =>
      `<div class="ma-ios-cat-row" data-tab="${c.tab}" data-color="${c.color}">
        <div class="ma-ios-cat-icon" style="background:${c.color}"><svg viewBox="0 0 24 24"><path d="${c.path}"/></svg></div>
        <span class="ma-ios-cat-label">${c.label}</span>
        ${c.value ? `<span style="font-size:13px;color:${this._pt('dim')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42%;">${c.value}</span>` : ''}
        <div class="ma-ios-cat-chevron"></div>
      </div>`
    ).join('');

    // AI Search box — same feature already reachable via the media player's
    // long-press context menu (qm_ai_search), just surfaced here too so it
    // doesn't require leaving the library to get to it. MA-only, same gating
    // as the context menu entry. The plain library-search icon button next
    // to it reuses the same input for a non-AI music_assistant.search call
    // (mixed across artists/albums/tracks/playlists) — mirrors the existing
    // reverse pattern (plain search bar + small AI-search button) used once
    // you're inside a category tab, just flipped, so there's no second
    // search box on screen.
    const _hasMA = this._maEntityIds?.size > 0;
    const _aiOn = this._aiFeatureOn('discover') && _hasMA;
    const aiSearchHtml = _hasMA ? `
      <div style="padding:8px 10px 6px;flex-shrink:0;display:flex;align-items:center;gap:6px;">
        <div style="position:relative;display:flex;align-items:center;flex:1;min-width:0;">
          <svg viewBox="0 0 24 24" style="position:absolute;left:10px;width:14px;height:14px;fill:${this._pt("dim")};pointer-events:none;"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <input id="maIosAiSearchInput" type="text" placeholder="Search…"
            style="width:100%;background:${this._pt("btnBg")};border:1px solid ${this._pt("border")};border-radius:10px;padding:8px 32px 8px 32px;color:${this._pt("text")};font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;outline:none;box-sizing:border-box;"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
          <button id="maIosAiSearchClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.2);border:none;cursor:pointer;align-items:center;justify-content:center;padding:0;">
            <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:${this._pt("text")};display:block;"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
          </button>
        </div>
        ${_aiOn ? `<button id="maIosLibSearchBtn" title="Search Library" style="flex-shrink:0;width:34px;height:34px;border-radius:10px;background:${this._pt("btnBg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:0;">
          <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:${this._pt("dim")};"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>
        </button>` : ''}
      </div>` : '';

    el.innerHTML = `
      ${aiSearchHtml}
      <div class="ma-ios-categories" id="maIosCatList">${catHtml}</div>`;

    if (_hasMA) {
      const _aiInput = el.querySelector('#maIosAiSearchInput');
      const _aiClear = el.querySelector('#maIosAiSearchClear');
      const _libBtn  = el.querySelector('#maIosLibSearchBtn');
      const _runLibSearch = () => {
        const q = (_aiInput?.value || '').trim();
        if (!q) { _aiInput?.focus(); return; }
        this._maNavigateToLibrarySearch(q);
      };
      const _runAiSearch = () => {
        const q = (_aiInput?.value || '').trim();
        if (!q) { _aiInput?.focus(); return; }
        if (_aiOn) this._showAISearchPanel(q);
        else _runLibSearch();
      };
      _aiInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _runAiSearch(); });
      _aiInput?.addEventListener('input', () => {
        if (_aiClear) _aiClear.style.display = _aiInput.value ? 'flex' : 'none';
      });
      _aiClear?.addEventListener('click', () => {
        _aiInput.value = '';
        _aiClear.style.display = 'none';
        _aiInput.focus();
      });
      _libBtn?.addEventListener('click', _runLibSearch);
    }

    // Apply glow to rows
    if (glowOn) {
      el.querySelectorAll('.ma-ios-cat-row').forEach(row => {
        const hex = row.dataset.color;
        row.style.background    = `linear-gradient(90deg, ${hex}20 0%, transparent 60%)`;
        row.style.boxShadow     = `inset 0 0 0 1px ${hex}25`;
        row.style.borderRadius  = '12px';
        row.style.marginBottom  = '4px';
        row.style.borderBottom  = 'none';
      });
    }

    // Wire category rows: push to nav stack, hide iOS view, load tab
    el.querySelectorAll('.ma-ios-cat-row').forEach(row => {
      row.addEventListener('click', () => {
        // Ghost-tap guard. The long-press menu opens the library on
        // pointerup, and iOS then fires the matching click a moment later
        // at the same spot — which, with the library now open, lands on
        // whichever category row happens to sit under the finger (e.g.
        // Recent Searches), jumping straight into it. Any click this soon
        // after opening can only be that leftover tap, never a real one.
        if (Date.now() - (this._maBrowserOpenedAt || 0) < 450) return;
        const tab   = row.dataset.tab;
        const label = row.querySelector('.ma-ios-cat-label')?.textContent || tab;
        this._maNavigateToTab(tab, label, el);
      });
    });
  },

  // Shared navigation logic for "leave the root category list and load a
  // specific tab" — used both by tapping a category row and by restoring
  // the library to where it was left off after a full app close/reopen
  // (see _saveLibraryOpenState / connectedCallback).
  _maNavigateToTab(tab, label, iosRootEl) {
    const rr = this.shadowRoot;
    this._watchDetailActive = false;
    this._watchDetailKey = null;
    const el = iosRootEl || rr.getElementById('maIosView');

    // Push a sentinel so _maNavBack knows to return to iOS list
    if (!this._maBrowserNavStack) this._maBrowserNavStack = [];
    this._maBrowserNavStack.push({ tab: '__ios_root__', label: 'Discover' });

    // Hide iOS view, keep tabs/search hidden, but keep iOS search bar visible
    el?.classList.add('hidden');
    rr.getElementById('maTabs')?.setAttribute('style', 'display:none');
    rr.querySelector('.ma-search-row')?.setAttribute('style', 'display:none');
    // Only show iOS search bar for the four main searchable types
    const _searchableTabs = new Set(['artist', 'album', 'track', 'playlist', 'radio', 'podcast', 'audiobook', 'movie_tv', 'recently_added']);
    const _iosBar = rr.getElementById('maIosSearchBar');
    if (_iosBar) _iosBar.classList.toggle('hidden', !_searchableTabs.has(tab));
    // Update placeholder to reflect whether full search is available
    const _iosInput = rr.getElementById('maIosSearchInput');
    if (_iosInput) {
      _iosInput.placeholder = tab === 'radio' ? 'Search radio stations…' : tab === 'podcast' ? 'Search podcasts…' : tab === 'audiobook' ? 'Search audiobooks…' : tab === 'movie_tv' ? 'Search movies & TV…' : 'Search…';
      _iosInput._fullSearchEnabled = _searchableTabs.has(tab);
    }
    rr.getElementById('maIosAiSearchBtn')?.classList.toggle('hidden', !['track', 'artist', 'album'].includes(tab));
    if (_iosBar) _iosBar.classList.remove('hidden');
    // Pinned is a pure category browser (like this root list itself) —
    // no search makes sense at this level, so keep it hidden regardless
    // of the general toggle above.
    if (tab === 'pinned' && _iosBar) _iosBar.classList.add('hidden');
    // Charts is a list of charts, nothing to search
    if (tab === 'charts' && _iosBar) _iosBar.classList.add('hidden');
    this._chartsState = null;

    // Show content + back button — clear first to avoid stale content flash
    const maContent = rr.getElementById('maContent');
    const backBtn   = rr.getElementById('maBackBtn');
    const titleEl   = rr.getElementById('maTitle');
    if (maContent) { maContent.innerHTML = ''; maContent.style.display = ''; }
    if (titleEl)   titleEl.textContent = label || tab;
    if (backBtn)   backBtn.classList.remove('hidden');

    // Recently Played's and Movies & TV's 3-dot menus both live in the
    // shared header (next to the close button) rather than inline in the
    // content, so this needs the same per-tab show/hide treatment as
    // everything else here. onclick (not addEventListener) is deliberate —
    // this runs on every navigation, and a plain property assignment
    // overwrites cleanly instead of stacking up duplicate listeners each
    // time one of these tabs is re-entered.
    const _rpMenuBtn = rr.getElementById('recentPlaysMenuBtn');
    if (_rpMenuBtn) {
      const _showsMenu = tab === 'recent_plays' || tab === 'recently_watched' || tab === 'pinned';
      _rpMenuBtn.classList.toggle('hidden', !_showsMenu);
      if (tab === 'recent_plays') _rpMenuBtn.onclick = () => this._showRecentPlaysMenu(_rpMenuBtn);
      else if (tab === 'recently_watched') _rpMenuBtn.onclick = () => this._showMtWatchOptionsMenu(_rpMenuBtn);
      else if (tab === 'pinned') _rpMenuBtn.onclick = () => this._showPinsMenu(_rpMenuBtn);
      else _rpMenuBtn.onclick = null;
    }

    this._maCurrentTab = tab;
    rr.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    this._loadMATab(tab);
  },

  // Cross-category library search from the root Library screen — same DOM
  // transition as _maNavigateToTab (leave the root list, reveal the content
  // area, push a back-to-root sentinel) but skips _loadMATab and leaves no
  // tab marked active, so _searchMA's media_type filter stays unset and
  // results come back grouped across artists/albums/tracks/playlists in one
  // call instead of being scoped to a single category.
  // fromAISearch: reached from AI Search's blue Search button — Back then reopens
  // AI Search with the same words in the box.
  _maNavigateToLibrarySearch(query, { fromAISearch = false } = {}) {
    const rr = this.shadowRoot;
    const el = rr.getElementById('maIosView');

    // Ensure the MA library browser popup is actually visible — this
    // function only used to update the browser's internal DOM state and
    // assumed _openMABrowser() had already been called to reveal it. That's
    // true when reached from the Library's own root search box (browser
    // already open), but not when reached from elsewhere, like the AI
    // Search panel opened via the queue overflow menu or quick-actions menu
    // (the browser popup was never opened there) — in that case everything
    // below was silently updating hidden DOM and nothing appeared on screen.
    const maPopup = rr.getElementById('maPopup');
    // Reached from outside the library (e.g. Search in the player's menu → AI Search →
    // the blue Search button): Back then closes the library and returns to the player,
    // rather than landing on the library's Discover screen, which was never opened.
    const _fromOutside = !!(maPopup && !maPopup.classList.contains('visible'));
    if (_fromOutside) {
      this._maNavReset();                   // start clean, not on top of an old browse
      this._maBrowserOpenedAt = Date.now(); // matches _openMABrowser's backdrop-guard bookkeeping
      maPopup.classList.add('visible');
    }

    if (!this._maBrowserNavStack) this._maBrowserNavStack = [];
    const _aiSearch = fromAISearch ? query : null;
    this._maBrowserNavStack.push(_fromOutside ? { tab: '__close__', aiSearch: _aiSearch } : { tab: '__ios_root__', label: 'Discover', aiSearch: _aiSearch });

    el?.classList.add('hidden');
    rr.getElementById('maTabs')?.setAttribute('style', 'display:none');
    rr.querySelector('.ma-search-row')?.setAttribute('style', 'display:none');
    // No per-tab search bar here — the root screen's own search box already
    // captured the query, and a cross-category result set has no single
    // "search within this" scope to hand it off to.
    rr.getElementById('maIosSearchBar')?.classList.add('hidden');

    const maContent = rr.getElementById('maContent');
    const backBtn   = rr.getElementById('maBackBtn');
    const titleEl   = rr.getElementById('maTitle');
    if (maContent) { maContent.innerHTML = ''; maContent.style.display = ''; }
    if (titleEl)   titleEl.textContent = 'Search';
    if (backBtn)   backBtn.classList.remove('hidden');
    rr.getElementById('recentPlaysMenuBtn')?.classList.add('hidden');

    this._maCurrentTab = null;
    rr.querySelectorAll('.ma-tab').forEach(t => t.classList.remove('active'));

    this._searchMA(query);
  },

  _maNavReset() {
    this._maBrowserNavStack = [];
    this._maCurrentTab = 'recently_played';
    this._maErrorShowing = false; // reset so stale tab value can't affect drill-in logic
    this._maInSearchResults = false;
    this._maLastSearch = null;
    this._haRbActive = false;
    this._haRbStack = [];
    this._mtLocalActive = false;
    this._mtLocalStack = [];
    this._pinnedDetailActive = false;
    this._pinnedDetailCategory = null;
    this._watchDetailActive = false;
    this._watchDetailKey = null;
    const maSearchInput = this.shadowRoot?.getElementById('maSearchInput');
    const maSearchClear = this.shadowRoot?.getElementById('maSearchClear');
    const maIosInput    = this.shadowRoot?.getElementById('maIosSearchInput');
    const maIosClear    = this.shadowRoot?.getElementById('maIosSearchClear');
    if (maSearchInput) maSearchInput.value = '';
    if (maSearchClear) maSearchClear.classList.add('hidden');
    if (maIosInput) maIosInput.value = '';
    if (maIosClear) maIosClear.style.display = 'none';
    const backBtn = this.shadowRoot?.getElementById('maBackBtn');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    const tabsEl  = this.shadowRoot?.getElementById('maTabs');
    const searchRow = this.shadowRoot?.querySelector('.ma-search-row');
    if (backBtn) backBtn.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'Discover';
    // iOS view mode is the only mode — tabs and the classic search row stay
    // permanently hidden; _syncMAViewToggle manages the rest.
    const _iosMode = true;
    if (tabsEl)    tabsEl.style.display    = _iosMode ? 'none' : '';
    if (searchRow) searchRow.style.display = _iosMode ? 'none' : '';
  },

  _maNavBack() {
    // The HA Radio Browser browse tree uses its own stack, layered on top of
    // the same shared back button/title — handle it first and return before
    // touching the regular MA library nav stack below.
    if (this._haRbActive) {
      this._haRbClearSearchInputs();
      const entity = this._resolveMATargetEntity() || this._entity;
      if (this._haRbStack && this._haRbStack.length > 0) {
        const prev = this._haRbStack.pop();
        this._haRbBrowse(entity, prev.mediaContentId, prev.mediaContentType, prev.title);
      } else {
        this._haRbExitToRadioTab();
      }
      return;
    }
    // Local HA media browse tree (Movies & TV → Browse Home Assistant
    // Media) — same layered-stack pattern as the Radio Browser above.
    if (this._mtLocalActive) {
      if (this._mtLocalStack && this._mtLocalStack.length > 0) {
        const prev = this._mtLocalStack.pop();
        this._mtBrowseLocal(prev.mediaContentId, prev.mediaContentType, prev.title);
      } else {
        this._mtLocalActive = false;
        this._loadMATab('movie_tv');
      }
      return;
    }
    // Watch History title drill-in — one level only, back returns to the
    // grouped list (at the same scroll position).
    if (this._watchDetailActive && this._maCurrentTab === 'recently_watched') {
      this._closeWatchGroupDetail();
      return;
    }
    // Inside Charts: chart → section → Charts (or back to Pins → Charts)
    if (this._chartNavBack()) return;
    // Pinned category drill-in — one level only, so back always returns to
    // the category list rather than needing its own stack.
    if (this._pinnedDetailActive) {
      const content = this.shadowRoot?.getElementById('maContent');
      this._renderPinnedOverview(content);
      return;
    }
    // Remove any stray artwork/bio lightbox before navigating back
    this.shadowRoot?.getElementById('cardOuter')?.querySelectorAll('.crow-bio-lightbox').forEach(el => el.remove());
    // Cancel any in-flight drill-in fetch
    this._drillInToken = (this._drillInToken || 0) + 1;
    if (!this._maBrowserNavStack || !this._maBrowserNavStack.length) return;
    const _wasInResults = !!this._maInSearchResults;
    const prev = this._maBrowserNavStack.pop();
    const backBtn   = this.shadowRoot?.getElementById('maBackBtn');
    const tabsEl    = this.shadowRoot?.getElementById('maTabs');
    const searchRow = this.shadowRoot?.querySelector('.ma-search-row');
    // Clear any active filter text so it doesn't persist on the restored content
    const _si = this.shadowRoot?.getElementById('maSearchInput');
    const _sc = this.shadowRoot?.getElementById('maSearchClear');
    if (_si) _si.value = '';
    if (_sc) _sc.classList.add('hidden');
    this._maLastSearch = null;
    this._maInSearchResults = false;
    this._maSavedSearch = null; // back = starting fresh, don't restore on next open
    // Opened from outside the library (the player's menu): back returns to the player
    if (prev.tab === '__close__') {
      // Search from the menu with results showing: back to the empty search box first
      if (prev.searchBox && _wasInResults) {
        this._maBrowserNavStack.push(prev);
        this._showLibrarySearchPrompt();
        return;
      }
      this._closeMABrowser();
      // came from AI Search's blue Search button: back to AI Search, words still in the box
      if (prev.aiSearch != null) this._showAISearchPanel(prev.aiSearch, { run: false });
      return;
    }
    // When returning to root level
    if (!this._maBrowserNavStack.length) {
      // Return to iOS category list instead of showing tabs
      if (backBtn) backBtn.classList.add('hidden');
      const maContent = this.shadowRoot?.getElementById('maContent');
      const iosView   = this.shadowRoot?.getElementById('maIosView');
      if (maContent) maContent.style.display = 'none';
      if (tabsEl)    tabsEl.style.display    = 'none';
      if (searchRow) searchRow.style.display = 'none';
      if (iosView)   iosView.classList.remove('hidden');
      this.shadowRoot?.getElementById('maIosSearchBar')?.classList.add('hidden');
      // Clear iOS search bar when returning to category list
      const _iosInput = this.shadowRoot?.getElementById('maIosSearchInput');
      const _iosClear = this.shadowRoot?.getElementById('maIosSearchClear');
      if (_iosInput) _iosInput.value = '';
      if (_iosClear) _iosClear.style.display = 'none';
      this._maInSearchResults = false;
      this._maLastSearch = null;
      const titleEl2 = this.shadowRoot?.getElementById('maTitle');
      if (titleEl2) titleEl2.textContent = 'Discover';
      return;
    }
    // Re-render the previous tab fresh (not from a DOM clone) so event
    // listeners are live. _loadMATab sets _maCurrentTab and title internally.
    // If the sentinel is the ios_root, return to iOS list instead of loading a tab
    if (prev.tab === '__ios_root__') {
      if (backBtn) backBtn.classList.add('hidden');
      this.shadowRoot?.getElementById('recentPlaysMenuBtn')?.classList.add('hidden');
      const maContent2 = this.shadowRoot?.getElementById('maContent');
      const iosView2   = this.shadowRoot?.getElementById('maIosView');
      if (maContent2) maContent2.style.display = 'none';
      if (tabsEl)     tabsEl.style.display     = 'none';
      if (searchRow)  searchRow.style.display  = 'none';
      this.shadowRoot?.getElementById('maIosSearchBar')?.classList.add('hidden');
      // Clear iOS search bar when returning to category list
      const _iosInput = this.shadowRoot?.getElementById('maIosSearchInput');
      const _iosClear = this.shadowRoot?.getElementById('maIosSearchClear');
      if (_iosInput) _iosInput.value = '';
      if (_iosClear) _iosClear.style.display = 'none';
      this._maInSearchResults = false;
      this._maLastSearch = null;
      const titleEl3 = this.shadowRoot?.getElementById('maTitle');
      if (titleEl3) titleEl3.textContent = 'Discover';
      // Re-render (not just unhide) so anything that changed while browsing
      // — a newly recorded search, a newly pinned item, etc. — shows up
      // immediately instead of waiting for the library to be fully closed
      // and reopened.
      this._renderMAIosView();
      if (iosView2) iosView2.classList.remove('hidden');
      // came from AI Search's blue Search button: back to AI Search, words still in the box
      if (prev.aiSearch != null) this._showAISearchPanel(prev.aiSearch, { run: false });
      return;
    }
    // Sentinel for returning to a specific Pinned category (e.g. Queues)
    // rather than a normal tab — same pattern as __ios_root__ above.
    if (prev.tab === '__pinned_category__') {
      this._pinnedDetailActive = true;
      this._openPinnedCategoryDetail(prev._pinnedCategory);
      return;
    }
    // If we drilled in from search results, restore them directly — don't load the tab
    if (prev.inSearchResults && prev.searchQuery) {
      this._maLastSearch = prev.searchQuery;
      this._maInSearchResults = true;
      const _iosInput2 = this.shadowRoot?.getElementById('maIosSearchInput');
      const _iosClear2 = this.shadowRoot?.getElementById('maIosSearchClear');
      if (_iosInput2) _iosInput2.value = prev.searchQuery;
      if (_iosClear2) _iosClear2.style.display = 'flex';
      this._searchMA(prev.searchQuery);
      return;
    }
    // Ensure search inputs are cleared when going back to a normal tab
    const _iosInputBack = this.shadowRoot?.getElementById('maIosSearchInput');
    const _iosClearBack = this.shadowRoot?.getElementById('maIosSearchClear');
    const _mainInputBack = this.shadowRoot?.getElementById('maSearchInput');
    const _mainClearBack = this.shadowRoot?.getElementById('maSearchClear');
    if (_iosInputBack) _iosInputBack.value = '';
    if (_iosClearBack) _iosClearBack.style.display = 'none';
    if (_mainInputBack) _mainInputBack.value = '';
    if (_mainClearBack) _mainClearBack.classList.add('hidden');
    this._maLastSearch = null;
    this._maInSearchResults = false;
    this._loadMATab(prev.tab);
    // Re-inject pinned section after loadMATab settles (covers async grid render)
    setTimeout(() => {
      const _content = this.shadowRoot?.getElementById('maContent');
      if (_content) this._maLibInjectStarred(prev.tab, _content);
    }, 300);
  },

  // ── Home Assistant "Radio Browser" integration browsing (Option A) ──────────
  // HA's own Radio Browser integration exposes stations as a media source
  // (media-source://radio_browser) that's browsed by category (Popular, By
  // Category, By Language, Country List, Local Stations) rather than searched
  // by free text — so this is a separate "Browse" entry point next to the
  // existing search, not merged into the search results.

  // Inserts a single tappable row at the very top of the radio tab that opens
  // the HA Radio Browser category tree. Safe to call repeatedly — replaces
  // any existing entry first.
  // Clears the search bar(s) without triggering a reload — used whenever we
  // navigate to a different level of the HA Radio Browser tree, so text
  // typed to filter one level (e.g. "Germany" in a country list) doesn't
  // stay in the box and silently hide everything in the next level, which
  // won't contain that text at all.
  // ── Persistent flag/thumbnail cache for the HA Radio Browser folder tree ──
  // Country flags (and other category thumbnails) never change, so once one
  // has successfully loaded we cache it as a base64 data URI. Synced to HA's
  // own storage (same crow_media_ai_local convention/mechanism as every other AI
  // cache) rather than kept local-only — a purely local cache gets wiped by
  // WKWebView storage eviction, which was exactly why flags that loaded
  // right after a Home Assistant restart would stop loading again over
  // time: nothing ever stuck around permanently, so a fresh eviction meant
  // starting the whole cache over from empty.
  _haRbFlagCacheKey() { return 'crow_media_ai_local_rbFlagCache'; },

  _haRbMigrateFlagCache() {
    if (this._haRbFlagCacheMigrated) return;
    this._haRbFlagCacheMigrated = true;
    try {
      const oldKey = 'crow_media_ha_rb_flag_cache';
      const old = localStorage.getItem(oldKey);
      if (old && !localStorage.getItem(this._haRbFlagCacheKey())) {
        localStorage.setItem(this._haRbFlagCacheKey(), old);
        localStorage.removeItem(oldKey);
      }
    } catch (_) {}
  },

  _haRbGetCachedFlag(url) {
    if (!url) return null;
    this._haRbMigrateFlagCache();
    try {
      const cache = JSON.parse(localStorage.getItem(this._haRbFlagCacheKey()) || '{}');
      return cache[url] || null;
    } catch (_) { return null; }
  },

  _haRbCacheFlag(url, dataUri) {
    if (!url || !dataUri) return;
    this._haRbMigrateFlagCache();
    try {
      const key = this._haRbFlagCacheKey();
      const cache = JSON.parse(localStorage.getItem(key) || '{}');
      cache[url] = dataUri;
      // Simple size guard — flags are small and bounded (~250 countries), but
      // cap the cache so it can't grow unbounded across sessions. Kept a bit
      // lower than a typical cache cap since these are base64 data URIs, not
      // small metadata — the payload adds up when synced to HA.
      const keys = Object.keys(cache);
      if (keys.length > 250) {
        keys.slice(0, keys.length - 250).forEach(k => delete cache[k]);
      }
      localStorage.setItem(key, JSON.stringify(cache));
      this._haStorageSaveAI('rbFlagCache');
    } catch (_) {
      // Storage full/unavailable — non-fatal, just skip caching this time.
    }
  },

  _haRbClearSearchInputs() {
    if (this._maFilterDebounce) { clearTimeout(this._maFilterDebounce); this._maFilterDebounce = null; }
    // IMPORTANT: live-filtering only runs while this is false (a full Enter
    // search sets it true, on purpose, so typing afterward doesn't fight
    // with real search results). Nothing else in the browse-tree navigation
    // resets it, so after doing one full search it stayed stuck true forever
    // afterward — silently disabling live-filtering everywhere, which is
    // exactly the regression this was causing.
    this._maInSearchResults = false;
    const r = this.shadowRoot;
    const maSearchInput = r?.getElementById('maSearchInput');
    const maSearchClear = r?.getElementById('maSearchClear');
    if (maSearchInput) maSearchInput.value = '';
    if (maSearchClear) maSearchClear.classList.add('hidden');
    const iosInput = r?.getElementById('maIosSearchInput');
    const iosClear = r?.getElementById('maIosSearchClear');
    if (iosInput) iosInput.value = '';
    if (iosClear) iosClear.style.display = 'none';
  },

  // Leaves the HA Radio Browser browse tree entirely and returns to the plain
  // radio tab — restores the shared header (back button hidden, title back
  // to "Radio") since we've been repurposing it while browsing.
  _haRbExitToRadioTab() {
    this._haRbActive = false;
    this._haRbStack = [];
    this._haRbClearSearchInputs();
    const backBtn = this.shadowRoot?.getElementById('maBackBtn');
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (backBtn) backBtn.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'Radio';
    this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'radio'));
    this._loadMATab('radio');
  },

  _haRbInjectBrowseEntry(content) {
    if (!content) return;
    content.querySelector('#ha-rb-browse-entry')?.remove();
    const rbEntity = this._resolveMATargetEntity() || this._entity;
    const row = document.createElement('div');
    row.id = 'ha-rb-browse-entry';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 4px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;';
    row.innerHTML =
      '<div style="width:40px;height:40px;border-radius:8px;background:rgba(3,169,244,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:19px;height:19px;fill:#03A9F4"><path d="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z"/></svg></div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:var(--primary-text-color,#fff);">Browse Home Assistant Radio</div><div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:1px;">Popular · By Category · By Language · Country</div></div>' +
      '';
    row.addEventListener('click', () => {
      this._haRbStack = [];
      this._haRbActive = true;
      this._haRbClearSearchInputs();
      this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
      // The root of a media source is browsed as media_content_type "app" —
      // matching what HA's own media browser dialog sends for the first level.
      this._haRbBrowse(rbEntity, 'media-source://radio_browser', 'app', 'Radio Browser');
    });
    content.insertBefore(row, content.firstChild);
  },

  // Browse a single level of HA's Radio Browser media source using the raw
  // media_player/browse_media WebSocket command. That command's schema
  // requires media_content_type and media_content_id to be supplied together,
  // so mediaContentType must be threaded through at every level — the root
  // call uses "app", and every level after that reuses the media_content_type
  // that the previous browse response reported for that child.
  async _haRbBrowse(entity, mediaContentId, mediaContentType, title) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content) return;
    if (!this._haRbStack) this._haRbStack = [];
    this._haRbActive = true;
    // Repurpose the shared header (used everywhere else for MA library
    // browsing) while we're in the HA browse tree — back button visible,
    // title reflecting the current level.
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const _titleEl = this.shadowRoot?.getElementById('maTitle');
    if (_titleEl) _titleEl.textContent = title || 'Radio Browser';
    // Guards against a race with other async flows (like a search) writing
    // into the same #maContent — if something newer has started by the time
    // this resolves, this one silently backs off instead of clobbering it.
    this._maContentGen = (this._maContentGen || 0) + 1;
    const _myGen = this._maContentGen;
    content.innerHTML = this._psLoading('Browsing Home Assistant Radio Browser…');
    try {
      // IMPORTANT: media_player.browse_media (the service/action) calls the
      // target entity's own async_browse_media() directly — Music Assistant's
      // entity only understands its own library URIs, so calling it with a
      // media-source://radio_browser id throws. The raw WebSocket command
      // media_player/browse_media (what HA's own media browser dialog uses)
      // has separate logic that detects media-source:// ids and hands them
      // straight to the media_source integration, independent of what the
      // target entity supports — so that's the one we need here.
      const result = await this._hass.connection.sendMessagePromise({
        type: 'media_player/browse_media',
        entity_id: entity,
        media_content_id: mediaContentId,
        media_content_type: mediaContentType,
      });
      if (this._maContentGen !== _myGen) return;
      const children = result?.children || [];
      if (_titleEl && !title && result?.title) _titleEl.textContent = result.title;
      this._haRbRenderBrowse(entity, mediaContentId, mediaContentType, title || result?.title || 'Radio Browser', children);
    } catch (e) {
      if (this._maContentGen !== _myGen) return;
      console.error('[HA Radio Browser] browse failed:', e);
      content.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
      const _errMsg = (e && (e.message || e.code)) ? String(e.message || e.code) : '';
      errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">📻 Can\'t browse Home Assistant Radio</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Make sure the <strong>Radio Browser</strong> integration is added under Settings → Devices &amp; services in Home Assistant.' +
        (_errMsg ? '<br><span style="font-family:monospace;font-size:10px;opacity:0.7;">' + _errMsg.replace(/</g,'&lt;') + '</span>' : '') +
        '</div>';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Back to search';
      closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
      closeBtn.addEventListener('click', () => this._haRbExitToRadioTab());
      errDiv.appendChild(closeBtn);
      content.appendChild(errDiv);
    }
  },

  // Render one level of the HA Radio Browser tree — folders (can_expand) drill
  // deeper, playable leaves (can_play) call the standard media_player.play_media
  // service with the media source's own content id/type, letting HA resolve
  // the actual stream URL server-side.
  _haRbRenderBrowse(entity, currentId, currentType, currentTitle, children) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content) return;
    content.innerHTML = '';

    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'ma-empty';
      empty.textContent = 'Nothing to show here.';
      content.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;';

    // Some categories (a common language, "Popular", etc.) can return
    // thousands of stations in a single browse response. Rendering that many
    // rows — each with several event listeners and a favicon image load —
    // can make touch handling (tap, long-press) unreliable in WKWebView even
    // though the per-row logic itself is fine. Cap it and point at the
    // search bar, which filters whatever's actually rendered. Set well above
    // the full country list (~245 entries — a small, world-fixed number that
    // won't grow dramatically) so that list always renders in full, while
    // still protecting against genuinely huge station lists.
    const MAX_RENDERED = 300;
    const _truncated = children.length > MAX_RENDERED;
    const _renderList = _truncated ? children.slice(0, MAX_RENDERED) : children;

    _renderList.forEach(child => {
      if (child.can_expand) {
        // Folder — drills deeper into the category tree.
        const row = document.createElement('div');
        row.dataset.haRbTitle = (child.title || '').toLowerCase();
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;';

        const _folderFallbackIcon = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/></svg>';
        const _cachedFlag = child.thumbnail ? this._haRbGetCachedFlag(child.thumbnail) : null;
        let thumb;
        if (_cachedFlag) {
          // Already cached — renders instantly, no network dependency at all.
          thumb = '<img src="' + _cachedFlag + '" alt="" style="width:100%;height:100%;object-fit:cover;">';
        } else {
          // Always render the fallback icon underneath, then layer the real
          // thumbnail on top if one exists — a failed/slow load reveals the
          // icon instead of a blank box (same fix already applied to station
          // favicons, which had the identical bug).
          thumb = _folderFallbackIcon + (child.thumbnail
            ? '<img class="ha-rb-flag-img" data-flag-url="' + child.thumbnail.replace(/"/g, '&quot;') + '" src="' + child.thumbnail + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">'
            : '');
        }

        row.innerHTML =
          '<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,0.08);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;">' + thumb + '</div>' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:var(--primary-text-color,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (child.title || 'Untitled') + '</div></div>' +
          '';

        // If we just rendered a fresh (uncached) flag, cache it as a data URI
        // once it successfully loads so next time it's instant.
        const _flagImg = row.querySelector('.ha-rb-flag-img');
        if (_flagImg) {
          _flagImg.addEventListener('load', () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = _flagImg.naturalWidth || 40;
              canvas.height = _flagImg.naturalHeight || 40;
              canvas.getContext('2d').drawImage(_flagImg, 0, 0);
              this._haRbCacheFlag(_flagImg.dataset.flagUrl, canvas.toDataURL('image/png'));
            } catch (_) {
              // Cross-origin canvas taint or similar — non-fatal, the image
              // still displays fine, it just won't be cached this time.
            }
          }, { once: true });
        }

        row.addEventListener('click', () => {
          this._haRbClearSearchInputs();
          this._haRbStack.push({ mediaContentId: currentId, mediaContentType: currentType, title: currentTitle });
          this._haRbBrowse(entity, child.media_content_id, child.media_content_type, child.title);
        });
        list.appendChild(row);
      } else if (child.can_play) {
        // Playable station — reuse the shared station row so tap opens the
        // same more-info panel (with a working Play button) and long-press
        // opens the same context menu (Play Now / Pin / Share / More Info)
        // that every other radio station row in the app already has.
        const st = this._haBrowseItemToStation(child);
        const row = this._rbMakeStationRow(st, entity, false);
        row.dataset.haRbTitle = (child.title || '').toLowerCase();
        list.appendChild(row);
      }
    });
    content.appendChild(list);

    if (_truncated) {
      const note = document.createElement('div');
      note.style.cssText = 'padding:12px 8px;font-size:11px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.5;';
      note.textContent = 'Showing the first ' + MAX_RENDERED + ' of ' + children.length + ' results — use the search bar above to filter this list down.';
      content.appendChild(note);
    }
  },

  // Cache a radio-browser station object keyed by its stream URLs.
  // Called whenever we have a full st object — on long-press or on play.
  // Persisted to localStorage with a 30-day TTL.
  _rbCacheStation(st) {
    if (!st || !st.name) return;
    // Also keep in-memory for fast lookups this session
    if (!this._rbStationCache) this._rbStationCache = new Map();
    const urls = [st.url_resolved, st.url, st._maUri, st._haMediaContentId].filter(Boolean);
    urls.forEach(u => this._rbStationCache.set(u.toLowerCase(), st));
    // Persist to localStorage
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_rb_station_cache') || '{}');
      const entry = { st, ts: Date.now() };
      urls.forEach(u => { store[u.toLowerCase()] = entry; });
      // Prune entries older than 30 days to avoid unbounded growth
      const TTL = 30 * 24 * 3600 * 1000;
      Object.keys(store).forEach(k => { if (Date.now() - (store[k].ts || 0) > TTL) delete store[k]; });
      localStorage.setItem('crow_media_rb_station_cache', JSON.stringify(store));
    } catch (_) {}
  },

  // Adapt a playable ("can_play") leaf from HA's Radio Browser browse tree
  // into the same station shape used everywhere else, so it can reuse
  // _rbMakeStationRow (tap → more-info panel, long-press → context menu),
  // pinning, and caching completely unchanged.
  _haBrowseItemToStation(child) {
    return {
      name: child.title || 'Unknown Station',
      favicon: child.thumbnail || '',
      tags: 'Home Assistant Radio Browser',
      countrycode: '',
      country: '',
      language: '',
      codec: '',
      bitrate: '',
      votes: '',
      homepage: '',
      stationuuid: null,
      url: null,
      url_resolved: null,
      _haMediaContentId: child.media_content_id,
      _haMediaContentType: child.media_content_type || 'music',
    };
  },

  // Remember the station we just told a specific entity to play, persisted to
  // localStorage (not just in-memory) so the LIVE pill can still identify it
  // correctly after the app reloads. This matters because many stations
  // overwrite media_title/media_album_name with the currently playing song
  // once tuned in — permanently hiding the station's own name from HA's state
  // — so an in-memory-only tracker works right after pressing Play, but goes
  // blank (and falls back to a much less reliable name search) the moment
  // WKWebView reloads the page.
  //
  // contentId (the entity's media_content_id at save time) is stored
  // alongside the station and re-checked on read — without this, switching
  // to a different station on the same entity would keep returning the
  // previous station's info/artwork forever, since nothing else here would
  // ever notice the content had changed underneath it.
  _rbSaveLastPlayed(entityId, st, contentId) {
    if (!entityId || !st) return;
    if (!this._lastPlayedRbMem) this._lastPlayedRbMem = {};
    this._lastPlayedRbMem[entityId] = { st, contentId: contentId || '' };
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_rb_last_played') || '{}');
      store[entityId] = { st, ts: Date.now(), contentId: contentId || '' };
      localStorage.setItem('crow_media_rb_last_played', JSON.stringify(store));
    } catch (_) {}
  },

  _mtSaveStarred(list) {
    const k = this._mtStarredKey();
    if (!this._starredMemCache) this._starredMemCache = {};
    this._starredMemCache[k] = list;
    try { localStorage.setItem(k, JSON.stringify(list)); } catch (_) {}
    this._haStorageSavePins();
  },

  // Searches iTunes for both movies and TV shows in one call, combining the
  // two result sets into a single list. TV shows come back from iTunes as
  // one entry per SEASON (entity=tvSeason) — deduped down to one
  // representative entry per show, preferring the lowest season number,
  // since a search shouldn't show "Show Name Season 1", "Show Name Season
  // 2", etc. as separate results.
  async _mtSearch(query) {
    let _movieFailed = false, _tvFailed = false;
    const [movieRes, tvRes] = await Promise.all([
      crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&media=movie&entity=movie&limit=15&country=gb')
        .then(r => { if (!r.ok) { _movieFailed = true; return { results: [] }; } return r.json(); })
        .catch(() => { _movieFailed = true; return { results: [] }; }),
      crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&media=tvShow&entity=tvSeason&limit=50&country=gb')
        .then(r => { if (!r.ok) { _tvFailed = true; return { results: [] }; } return r.json(); })
        .catch(() => { _tvFailed = true; return { results: [] }; }),
    ]);

    const movies = (movieRes.results || []).map(m => ({
      id: 'movie_' + m.trackId,
      kind: 'movie',
      title: m.trackName || 'Unknown',
      subtitle: [m.primaryGenreName, (m.releaseDate || '').slice(0, 4)].filter(Boolean).join(' · '),
      artworkUrl100: m.artworkUrl100 || '',
    }));

    const tvByShow = new Map();
    (tvRes.results || []).forEach(t => {
      // iTunes' collectionName for a tvSeason result includes the season
      // number baked in (e.g. "Star Trek: The Next Generation, Season 4"),
      // so grouping by that string doesn't actually dedupe anything — every
      // season of the same show gets its own distinct key. Group by the
      // cleaned name (season marker stripped) instead. Note: artistId is
      // NOT safe to use here — it turns out to represent the studio/
      // franchise (e.g. every Star Trek show shares the same artistId),
      // not the individual show, so grouping by it merges genuinely
      // different shows together and silently drops real results.
      const rawName = t.collectionName || t.artistName || '';
      if (!rawName) return;
      const cleanShowName = rawName.replace(/,?\s*Season\s*\d+\s*$/i, '').trim() || rawName;
      const groupKey = cleanShowName.toLowerCase();
      const existing = tvByShow.get(groupKey);
      if (!existing || (t.season != null && (existing._season == null || t.season < existing._season))) {
        tvByShow.set(groupKey, {
          id: 'tv_' + groupKey,
          kind: 'tv',
          title: cleanShowName,
          subtitle: [t.primaryGenreName, (t.releaseDate || '').slice(0, 4)].filter(Boolean).join(' · '),
          artworkUrl100: t.artworkUrl100 || '',
          _season: t.season,
        });
      }
    });

    const combined = [...movies, ...tvByShow.values()];
    // Both requests failing (e.g. iTunes' well-documented, IP-based 403
    // rate-limiting — see Apple Developer Forums, this has been an
    // ongoing issue on their end for years) looks identical to a genuine
    // zero-match search unless flagged separately. Surface it as an error
    // instead so the UI can tell "nothing matched" apart from "couldn't
    // even ask the question."
    if (!combined.length && _movieFailed && _tvFailed) {
      const err = new Error('iTunes search unreachable');
      err.mtApiFailure = true;
      throw err;
    }
    return combined;
  },

  // ── Browse Home Assistant's own local media folder ──────────────────────
  // Reuses the same media_player/browse_media WebSocket command already
  // used for HA's Radio Browser — that raw command hands media-source://
  // ids off to the media_source integration directly, independent of
  // whatever entity is passed, unlike calling the entity's own
  // media_player.browse_media service (which Music Assistant, for example,
  // can't resolve media-source:// ids through).
  async _mtBrowseLocal(mediaContentId, mediaContentType, title) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content) return;
    if (!this._mtLocalStack) this._mtLocalStack = [];
    this._mtLocalActive = true;
    this.shadowRoot?.getElementById('maBackBtn')?.classList.remove('hidden');
    const _titleEl = this.shadowRoot?.getElementById('maTitle');
    if (_titleEl) _titleEl.textContent = title || 'Home Assistant Media';
    this._maContentGen = (this._maContentGen || 0) + 1;
    const _myGen = this._maContentGen;
    content.innerHTML = this._psLoading('Browsing your media folder…');
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: 'media_player/browse_media',
        entity_id: this._entity,
        ...(mediaContentId ? { media_content_id: mediaContentId, media_content_type: mediaContentType } : {}),
      });
      if (this._maContentGen !== _myGen) return;
      const children = result?.children || [];
      if (_titleEl && !title && result?.title) _titleEl.textContent = result.title;
      this._mtRenderLocalBrowse(mediaContentId, mediaContentType, title || result?.title || 'Home Assistant Media', children);
    } catch (e) {
      if (this._maContentGen !== _myGen) return;
      content.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
      const _errMsg = (e && (e.message || e.code)) ? String(e.message || e.code) : '';
      errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">📁 Can\'t browse media</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Make sure Home Assistant\'s <strong>media_source</strong> integration is set up and this entity can browse media.' +
        (_errMsg ? '<br><span style="font-family:monospace;font-size:10px;opacity:0.7;">' + _errMsg.replace(/</g,'&lt;') + '</span>' : '') +
        '</div>';
      const backBtn = document.createElement('button');
      backBtn.textContent = 'Back';
      backBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
      backBtn.addEventListener('click', () => { this._mtLocalActive = false; this._loadMATab('movie_tv'); });
      errDiv.appendChild(backBtn);
      content.appendChild(errDiv);
    }
  },

  _mtRenderLocalBrowse(currentId, currentType, currentTitle, children) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content) return;
    content.innerHTML = '';

    // Keep all folders (can't know what's inside without drilling in — a
    // "Movies" folder needs to stay navigable regardless of its own
    // media_class). For playable leaves, only keep ones that look like
    // video — otherwise every non-video file in the same media directory
    // shows up too (automation sound clips, TTS output, etc.), which isn't
    // useful in a Movies & TV browser and, worse, can genuinely fail to
    // play on a video-only target like an Apple TV.
    const _videoExt = /\.(mp4|mkv|avi|mov|m4v|webm|ts|wmv|flv|mpg|mpeg)$/i;
    const _audioExt  = /\.(mp3|wav|m4a|flac|ogg|aac|wma)$/i;
    children = children.filter(child => {
      if (child.can_expand) return true;
      if (!child.can_play) return false;
      const mc = (child.media_class || '').toLowerCase();
      if (mc === 'video' || mc === 'movie' || mc === 'tv_show' || mc === 'episode') return true;
      if (mc === 'music' || mc === 'audio' || mc === 'podcast' || mc === 'track') return false;
      const name = child.title || child.media_content_id || '';
      if (_videoExt.test(name)) return true;
      if (_audioExt.test(name)) return false;
      // Unknown extension/class — err toward showing it rather than
      // silently hiding something that might genuinely be a video.
      return true;
    });

    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'ma-empty';
      empty.textContent = 'Nothing found in this folder.';
      content.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;';
    const self = this;

    children.forEach(child => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;';

      const _folderIcon = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/></svg>';
      const _fileIcon   = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z"/></svg>';
      const thumb = child.thumbnail
        ? _fileIcon + '<img src="' + child.thumbnail + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">'
        : (child.can_expand ? _folderIcon : _fileIcon);

      row.innerHTML =
        '<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,0.08);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;">' + thumb + '</div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:var(--primary-text-color,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (child.title || 'Untitled') + '</div></div>' +
        (child.can_expand
          ? ''
          : '');

      if (child.can_expand) {
        row.addEventListener('click', () => {
          self._mtLocalStack.push({ mediaContentId: currentId, mediaContentType: currentType, title: currentTitle });
          self._mtBrowseLocal(child.media_content_id, child.media_content_type, child.title);
        });
      } else if (child.can_play) {
        row.addEventListener('click', () => self._mtShowLocalFileInfo(child));
      }
      list.appendChild(row);
    });
    content.appendChild(list);
  },

  _mtShowLocalFileInfo(child) {
    // Best-effort title cleanup — local filenames are often not a clean
    // "just the title" string (extensions, resolution tags, etc.), so this
    // AI lookup may not always resolve. Not guaranteed like it is for
    // iTunes search results, which come with real, clean titles.
    const _guessTitle = (child.title || '')
      .replace(/\.(mkv|mp4|avi|m4v|mov)$/i, '')
      .replace(/[\.\_]/g, ' ')
      .replace(/\s*\(?\b(1080p|720p|2160p|4k|x264|x265|hevc|bluray|web[- ]?dl|webrip|hdtv)\b\)?/gi, '')
      .trim();
    const infoPopup = this.shadowRoot?.getElementById('infoPopup');
    const infoContent = this.shadowRoot?.getElementById('infoContent');
    const infoTitleEl = this.shadowRoot?.getElementById('infoPopupTitle');
    if (infoPopup) {
      infoPopup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
      infoPopup.style.setProperty('backdrop-filter', 'none');
      infoPopup.style.setProperty('-webkit-backdrop-filter', 'none');
      infoPopup.classList.add('visible');
    }
    if (infoContent) infoContent.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    if (infoTitleEl) infoTitleEl.textContent = 'Info';
    this._infoPopupOpenedAt = Date.now();
    this._activeInfoPanelKind = null;
    this.shadowRoot?.getElementById('queueMenuBtn')?.classList.add('hidden');
    const _ext = (child.title || child.media_content_id || '').match(/\.([a-z0-9]{2,4})$/i)?.[1] || '';
    const localFileMeta = {
      rawFilename: child.title || '',
      extension: _ext,
      thumbnail: child.thumbnail || '',
      mediaContentType: child.media_content_type || '',
    };
    this._fetchVideoInfo(_guessTitle || child.title, undefined, localFileMeta);
  },

  // Opens the shared Info panel for a movie/TV item — pulled out of
  // _mtMakeRow's tap handler so Watch History's drill-in (its Info button,
  // episode rows) opens exactly the same panel the same way.
  _openMtInfo(item, opts = {}) {
    const infoPopup = this.shadowRoot?.getElementById('infoPopup');
    const infoContent = this.shadowRoot?.getElementById('infoContent');
    const infoTitleEl = this.shadowRoot?.getElementById('infoPopupTitle');
    if (infoPopup) {
      infoPopup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
      infoPopup.style.setProperty('backdrop-filter', 'none');
      infoPopup.style.setProperty('-webkit-backdrop-filter', 'none');
      infoPopup.classList.add('visible');
    }
    if (infoContent) infoContent.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    if (infoTitleEl) infoTitleEl.textContent = 'Info';
    this._infoPopupOpenedAt = Date.now();
    this._activeInfoPanelKind = null;
    this.shadowRoot?.getElementById('queueMenuBtn')?.classList.add('hidden');
    // iTunes' search thumbnail is only 100x100 — upgrade to a larger size
    // for the detail panel using the same URL-substitution pattern iTunes
    // artwork URLs support.
    this._videoInfoArtOverride = (item.artworkUrl100 || '').replace('100x100bb', '600x600bb') || null;
    // Watch History passes the cover it is already showing; that exact cover
    // is then kept for this title in the Info panel (see _renderVideoInfoDetail),
    // instead of whatever poster the info lookup or picker comes back with.
    this._watchInfoArt = opts.forceArt ? { title: item.title, url: opts.forceArt } : null;
    // what the row already knows, so exact matching can settle the title (a TMDB chart row carries TMDB's own ID)
    const _tm = String(item.id || '').match(/_tmdb_(\d+)$/);
    const _yr = item.year || (String(item.subtitle || '').match(/\b(19|20)\d{2}\b/) || [])[0] || null;
    this._videoMatchHint = { type: item.kind === 'tv' ? 'tv' : item.kind === 'movie' ? 'movie' : null, year: _yr, tmdbId: _tm ? _tm[1] : null };
    this._fetchVideoInfo(item.title, item.kind === 'tv');
  },

  _maLibSaveStarred(tab, list) {
    const k = this._maLibStarredKey(tab);
    if (!this._starredMemCache) this._starredMemCache = {};
    this._starredMemCache[k] = list;
    try { localStorage.setItem(k, JSON.stringify(list)); } catch(_) {}
    this._haStorageSavePins();
  },

  _maLibRefreshPinnedUI(tab) {
    const maContent = this.shadowRoot?.getElementById('maContent');
    if (!maContent) return;
    const _t = tab === 'favourites' ? 'track' : tab;
    if (this._pinnedDetailActive && this._pinnedDetailCategory === _t) {
      this._openPinnedCategoryDetail(_t);
      return;
    }
    const sectionId = 'malib-starred-' + _t;
    const existing  = maContent.querySelector('#' + sectionId);
    if (this._config?.show_pins_in_sections === false) { existing?.remove(); return; }
    const newSection = this._maLibRenderStarredSection(_t);
    if (existing) {
      if (newSection) existing.replaceWith(newSection);
      else existing.remove();
    } else if (newSection) {
      const grid = maContent.querySelector('.ma-grid');
      maContent.insertBefore(newSection, grid || maContent.firstChild);
    }
  },

  // Builds one pinned-item row for track/artist/album/playlist — extracted so
  // it can be reused both by the per-tab pinned section and the consolidated
  // Pinned overview, matching the same pattern already used for
  // _rbMakeStationRow/_pcMakeRow/_abMakeRow.
  _maLibMakeRow(item, tab, opts = {}) {
    const self = this;
    const imgUrl = self._maImgUrl(item);
    const title  = item.name || item.title || '';
    const artistName = (item.artists && item.artists[0] && item.artists[0].name) || '';
    const sub    = (item.artists ? item.artists.map(a => a.name).join(', ') : '') || '';

    // Same title+artist cache key and lookup helper the rest of the app
    // already uses for non-currently-playing tracks (AI Info hero art,
    // Similar Tracks, Recommendations) — _fetchItunesArtForTrack always
    // skips the "does this match what's live?" guard internally, unlike
    // calling _fetchItunesArt directly. Reusing it here means a pin whose
    // art was already resolved elsewhere (e.g. tapped into AI Info once)
    // shows immediately from cache, and a pin that's never been looked up
    // gets the same reliable live fetch instead of sitting on the note icon.
    const itunesCacheKey = (artistName || title) ? [artistName, title].filter(Boolean).join('|').toLowerCase() : '';
    const cachedItunesArt = (!imgUrl && itunesCacheKey) ? (self._itunesArtCache?.[itunesCacheKey] || '') : '';
    const artSrc = imgUrl || cachedItunesArt;

    const wrap = document.createElement('div');
    wrap.className = 'ma-item-wrap';
    const el = document.createElement('div');
    el.className = 'ma-item';
    el.innerHTML =
      '<div class="ma-item-art">' +
        (artSrc ? '<img src="' + artSrc + '">' : '') +
        '<svg viewBox="0 0 24 24" style="display:' + (artSrc ? 'none' : 'flex') + '">' + self._maItemSvg(tab) + '</svg>' +
      '</div>' +
      '<div class="ma-item-info"><div class="ma-item-title">' + title + '</div>' +
        (sub ? '<div class="ma-item-sub">' + sub + '</div>' : '') +
      '</div>' +
      '<div class="ma-item-chevron" style="' + (['artist','album','playlist'].includes(tab) ? '' : 'visibility:hidden') + '"></div>';
    wrap.appendChild(el);
    if (this._config?.row_glow === true && artSrc) this._observeRowGlow(artSrc, wrap, null);

    // Live fallback: iTunes first, then Music Assistant's own library search
    // (same chain _showAITrackInfo uses). Restricted to track pins — the
    // only shape a title-based search makes sense for. Triggered in two
    // cases: (1) there was no stored art at all, or (2) there WAS a stored
    // URL but it 404s at render time — pins created from a track's live
    // entity_picture capture a session-scoped URL that stops resolving once
    // that playback session ends, which onerror alone can't recover from.
    const _tryLiveArtFallback = () => {
      if (!itunesCacheKey || tab !== 'track') return;
      self._fetchItunesArtForTrack(artistName, title).then(async img => {
        const finalImg = img || await self._fetchMaLibraryTrackArt(artistName, title);
        if (!finalImg) return;
        const artDiv = el.querySelector('.ma-item-art');
        if (!artDiv) return;
        const existingImg = artDiv.querySelector('img');
        if (existingImg) {
          const isWorking = existingImg.complete && existingImg.naturalWidth > 0 && existingImg.style.display !== 'none';
          if (isWorking) return; // something already resolved (e.g. onerror + no-art path both firing)
          existingImg.remove();
        }
        const imgEl = document.createElement('img');
        imgEl.src = finalImg;
        imgEl.addEventListener('error', () => { imgEl.style.display = 'none'; });
        artDiv.insertBefore(imgEl, artDiv.firstChild);
        const svg = artDiv.querySelector('svg');
        if (svg) svg.style.display = 'none';
        if (self._config?.row_glow === true) self._observeRowGlow(finalImg, wrap, null);
      });
    };

    if (artSrc) {
      // Stored/cached art exists but may be a dead session-scoped URL —
      // wire the fallback to fire if it actually fails to load.
      const artImgEl = el.querySelector('.ma-item-art img');
      if (artImgEl) {
        artImgEl.addEventListener('error', () => {
          artImgEl.style.display = 'none';
          const svg = el.querySelector('.ma-item-art svg');
          if (svg) svg.style.display = 'flex';
          _tryLiveArtFallback();
        }, { once: true });
      }
    } else {
      _tryLiveArtFallback();
    }

    self._attachMAItemSwipe(wrap, item, tab, opts);
    return wrap;
  },

  _maLibRenderStarredSection(tab) {
    const starred = this._maLibGetStarred(tab);
    if (!starred.length) return null;

    const label = tab === 'track' ? 'Songs' : tab === 'artist' ? 'Artists' : tab === 'playlist' ? 'Playlists' : 'Albums';
    const section = document.createElement('div');
    section.id = 'malib-starred-' + tab;
    section.style.cssText = 'margin-bottom:4px;';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
    heading.textContent = '\ud83d\udccd Pinned ' + label;
    section.appendChild(heading);

    starred.forEach(item => section.appendChild(this._maLibMakeRow(item, tab)));

    return section;
  },

  _saveSavedQueuesList(list) {
    const k = this._savedQueuesKey();
    if (!this._starredMemCache) this._starredMemCache = {};
    this._starredMemCache[k] = list;
    try { localStorage.setItem(k, JSON.stringify(list)); } catch (_) {}
    this._haStorageSavePins();
  },

  _savePinnedRecapsList(list) {
    const k = this._pinnedRecapsKey();
    if (!this._starredMemCache) this._starredMemCache = {};
    this._starredMemCache[k] = list;
    try { localStorage.setItem(k, JSON.stringify(list)); } catch (_) {}
    this._haStorageSavePins();
  },

  // Builds one pinned-recap row for the Pinned overview / category list.
  _makePinnedRecapRow(recap) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'ma-item-wrap';
    const el = document.createElement('div');
    el.className = 'ma-item';
    const trackCount = recap.topTracks?.length || 0;
    el.innerHTML =
      '<div class="ma-item-art"><svg viewBox="0 0 24 24" style="display:flex;fill:rgba(255,255,255,0.35)"><path d="M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z"/></svg></div>' +
      '<div class="ma-item-info"><div class="ma-item-title">' + (recap.name || 'Pinned Music Recap') + '</div>' +
        '<div class="ma-item-sub">' + (recap.dateRangeLabel || (trackCount + ' track' + (trackCount === 1 ? '' : 's'))) + '</div>' +
      '</div>' +
      '<div class="ma-item-chevron"></div>';
    wrap.appendChild(el);

    let lpTimer = null, lpFired = false;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', () => {
      lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; self._showPinnedRecapContextMenu(el, recap); }, 480);
    }, { passive: true });
    el.addEventListener('pointerup',     () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('pointercancel', () => { clearTimeout(lpTimer); lpFired = false; }, { passive: true });
    el.addEventListener('pointermove',   () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }
      self._openPinnedRecapDetail(recap);
    });
    this._rowSwipe(el, { menu: (h) => self._showPinnedRecapContextMenu(el, recap, h), left: ['recapDelete', 'more'] }, wrap);

    return wrap;
  },

  _showPinnedRecapContextMenu(anchor, recap, headless = false) {
    const r = this.shadowRoot;
    if (!headless) document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
    const backdrop = document.createElement('div');
    backdrop.className = 'queue-dropdown-backdrop';
    const menu = document.createElement('div');
    menu.className = 'queue-dropdown-menu';
    menu.innerHTML =
      '<div class="queue-dropdown-item" id="recapRename" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04Z"/></svg><span class="queue-dropdown-label">Rename</span></div>' +
      '<div class="queue-dropdown-item" id="recapExport" data-pdf="recap" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg><span class="queue-dropdown-label">Export to PDF</span></div>' +
      '<div class="queue-dropdown-item danger" id="recapDelete" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg><span class="queue-dropdown-label">Unpin</span></div>';
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (anchorRect.bottom - cardRect.top + 4) + 'px';
    const host = this._menuHost(anchor);
    if (!headless) { host.appendChild(backdrop); host.appendChild(menu); }
    const _menuOpenedAt = Date.now();
    const _menuReady = () => headless || (Date.now() - _menuOpenedAt) > 320;
    const closeMenu = () => { menu.remove(); backdrop.remove(); };
    backdrop.addEventListener('pointerdown', () => { if (!_menuReady()) return; closeMenu(); });
    menu.querySelector('#recapRename')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu();
      this._showRenameRecapSheet(recap, () => {
        const content = this.shadowRoot?.getElementById('maContent');
        if (!content) return;
        if (this._pinnedDetailActive && this._pinnedDetailCategory === 'recaps') this._openPinnedCategoryDetail('recaps');
      });
    });
    menu.querySelector('#recapExport')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu(); this._exportRecapSnapshotPDF(recap); });
    menu.querySelector('#recapDelete')?.addEventListener('click', async e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu();
      if (!(await this._confirmUnpin('recap', recap.name || recap.title || '', { snapshot: true }))) return;
      const list = this._getPinnedRecaps().filter(rc => rc.id !== recap.id);
      this._savePinnedRecapsList(list);
      this._showToast('Music Recap unpinned');
      const content = this.shadowRoot?.getElementById('maContent');
      if (!content) return;
      if (this._pinnedDetailActive && this._pinnedDetailCategory === 'recaps') this._openPinnedCategoryDetail('recaps');
    });
    if (headless) return this._menuHeadless(menu);
  },

  _showRenameRecapSheet(recap, onRenamed) {
    const _pt = (k) => this._pt(k);
    document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
    const sheet = document.createElement('div');
    sheet.className = 'crow-media-rb-tag-sheet';
    sheet.style.cssText = 'position:absolute;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);left:0;top:' + window.scrollY + 'px;width:' + document.documentElement.clientWidth + 'px;height:' + window.innerHeight + 'px;';
    sheet.innerHTML = '<div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      + '<span style="font-size:15px;font-weight:700;color:' + _pt('text') + ';">Rename Music Recap</span>'
      + '<button class="crow-media-rb-tag-sheet-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + _pt('text') + '"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>'
      + '</div>'
      + '<input id="recapRenameInput" type="text" value="' + (recap.name || '').replace(/"/g, '&quot;') + '" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 12px;font-size:14px;color:' + _pt('text') + ';font-family:inherit;margin-bottom:14px;" autocomplete="off" autocorrect="off" spellcheck="false">'
      + '<button id="recapRenameBtn" style="width:100%;padding:11px;background:#0A84FF;border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;">Save</button>'
      + '</div>';
    this._bodyAppend(sheet);
    const _close = () => sheet.remove();
    sheet.addEventListener('click', e => { if (e.target === sheet) _close(); });
    sheet.querySelector('.crow-media-rb-tag-sheet-close')?.addEventListener('click', _close);
    const _input = sheet.querySelector('#recapRenameInput');
    _input?.focus();
    _input?.select();
    sheet.querySelector('#recapRenameBtn')?.addEventListener('click', () => {
      const newName = (_input?.value || '').trim();
      if (!newName) { this._showToast('Name cannot be empty'); return; }
      const list = this._getPinnedRecaps();
      const target = list.find(rc => rc.id === recap.id);
      if (!target) { _close(); return; }
      target.name = newName;
      this._savePinnedRecapsList(list);
      _close();
      this._showToast('Renamed to "' + newName + '"');
      if (typeof onRenamed === 'function') onRenamed(target);
    });
  },

  // Renders a static, frozen view of a pinned recap — same layout as the
  // live Listening Recap panel, but sourced entirely from the saved
  // snapshot rather than live-aggregated data. Tracks/artists stay tappable
  // (AI Info / bio) for consistency with the rest of the app.
  _openPinnedRecapDetail(recap, skipNavPush = false) {
    const content = this.shadowRoot?.getElementById('maContent');
    const titleEl  = this.shadowRoot?.getElementById('maTitle');
    const backBtn  = this.shadowRoot?.getElementById('maBackBtn');
    const tabsEl    = this.shadowRoot?.getElementById('maTabs');
    const searchRow = this.shadowRoot?.querySelector('.ma-search-row');
    if (!content) return;

    const openedFromPinned = this._pinnedDetailActive === true;
    if (!skipNavPush) {
      this._pinnedDetailActive = false;
      if (!this._maBrowserNavStack) this._maBrowserNavStack = [];
      this._maBrowserNavStack.push(openedFromPinned
        ? { tab: '__pinned_category__', _pinnedCategory: 'recaps', searchQuery: null, inSearchResults: false }
        : { tab: this._maCurrentTab || 'playlist', searchQuery: null, inSearchResults: false }
      );
    }

    if (tabsEl)    tabsEl.style.display    = 'none';
    if (searchRow) searchRow.style.display = 'none';
    if (backBtn)   backBtn.classList.remove('hidden');
    if (titleEl)   titleEl.textContent = recap.name || 'Pinned Music Recap';

    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const topArtists = recap.topArtists || [];
    const topTracks  = recap.topTracks || [];

    content.innerHTML = `
      <div style="padding:4px 2px 16px;">
        ${topTracks.length ? `
        <div class="ma-drill-actions" style="margin-bottom:14px;">
          <button class="ma-drill-action-btn" id="pinnedRecapPlayAll"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>
          ${this._shuffleBtnHtml('id="pinnedRecapShuffle"')}
          <button class="ma-drill-action-btn" id="pinnedRecapAdd"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button>
          <button class="ma-drill-action-btn" id="pinnedRecapPlayNext"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>
          <button class="ma-drill-action-btn" id="pinnedRecapExport" data-pdf="recap"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
          <button class="ma-drill-action-btn" id="pinnedRecapUnpin"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24" style="fill:#FFD60A"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">Unpin</span></button>
        </div>` : ''}
        ${recap.dateRangeLabel ? `<div style="font-size:11px;color:${this._pt('dim')};margin-bottom:10px;">${esc(recap.dateRangeLabel)}</div>` : ''}
        ${recap.narrative ? `<div style="font-size:14px;line-height:1.5;color:${this._pt('text')};margin-bottom:18px;">${esc(recap.narrative)}</div>` : ''}
        ${topArtists.length ? `
        <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.8);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">Top Artists</div>
        <div id="pinnedRecapArtistList" style="margin-bottom:16px;"></div>` : ''}
        ${topTracks.length ? `
        <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.8);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">Top Tracks</div>
        <div id="pinnedRecapTrackList"></div>` : ''}
      </div>`;

    content.querySelector('#pinnedRecapPlayAll')?.addEventListener('click', () => this._playRecapTracks(topTracks, 'replace'));
    content.querySelector('#pinnedRecapShuffle')?.addEventListener('click', () => this._crowShufflePlay(topTracks));
    content.querySelector('#pinnedRecapAdd')?.addEventListener('click', () => this._playRecapTracks(topTracks, 'add'));
    content.querySelector('#pinnedRecapPlayNext')?.addEventListener('click', () => this._playRecapTracks(topTracks, 'next'));
    content.querySelector('#pinnedRecapExport')?.addEventListener('click', () => this._exportRecapSnapshotPDF(recap));
    content.querySelector('#pinnedRecapUnpin')?.addEventListener('click', async () => {
      if (!(await this._confirmUnpin('recap', recap.name || recap.title || '', { snapshot: true }))) return;
      const list = this._getPinnedRecaps().filter(rc => rc.id !== recap.id);
      this._savePinnedRecapsList(list);
      this._showToast('Music Recap unpinned');
      this._maNavBack();
    });

    const artistListEl = content.querySelector('#pinnedRecapArtistList');
    if (artistListEl) {
      topArtists.forEach((a, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;';
        row.innerHTML = `
          <div style="width:20px;font-size:12px;color:${this._pt('dim')};">${i + 1}</div>
          <div style="flex:1;font-size:13px;color:${this._pt('text')};">${esc(a.name)}</div>
          <div style="font-size:11px;color:${this._pt('dim')};">${a.count} plays</div>`;
        row.addEventListener('click', () => this._showCastBio(content, a.name, '', '', () => this._openPinnedRecapDetail(recap, true)));
        artistListEl.appendChild(row);
      });
    }

    const trackListEl = content.querySelector('#pinnedRecapTrackList');
    if (trackListEl) {
      const _fallbackNoteIcon = '<svg viewBox="0 0 24 24" style="display:flex;fill:rgba(255,255,255,0.3)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
      topTracks.forEach(t => {
        const item = {
          name: t.title,
          artists: t.artist ? [{ name: t.artist }] : [],
          album: t.album ? { name: t.album } : null,
          _tab: 'track',
        };
        const wrap = document.createElement('div');
        wrap.className = 'ma-item-wrap';
        const el = document.createElement('div');
        el.className = 'ma-item';
        const itunesKey = (t.artist || t.album || t.title)
          ? [t.artist, t.album || t.title].filter(Boolean).join('|').toLowerCase()
          : '';
        const cachedArt = t.artUrl || (itunesKey ? (this._itunesArtCache?.[itunesKey] || '') : '');
        const artInner = cachedArt
          ? _fallbackNoteIcon + '<img src="' + cachedArt + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">'
          : _fallbackNoteIcon;
        el.innerHTML =
          '<div class="ma-item-art" style="position:relative;">' + artInner + '</div>' +
          '<div class="ma-item-info"><div class="ma-item-title">' + esc(t.title) + '</div>' +
            (t.artist ? '<div class="ma-item-sub">' + esc(t.artist) + '</div>' : '') +
          '</div>';
        wrap.appendChild(el);
        this._attachMAItemSwipe(wrap, item, 'track');
        trackListEl.appendChild(wrap);
        if (!cachedArt && itunesKey) this._fetchItunesArt(t.artist, t.album, t.title, { skipStaleGuard: true });
      });
    }
  },

  // Builds one pinned-queue row — extracted so it can be reused both by the
  // per-tab pinned section and the consolidated Pinned overview.
  _makeSavedQueueRow(sq) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'ma-item-wrap';
    const el = document.createElement('div');
    el.className = 'ma-item';
    const count = sq.tracks?.length || 0;
    el.innerHTML =
      '<div class="ma-item-art"><svg viewBox="0 0 24 24" style="display:flex;fill:rgba(255,255,255,0.35)"><path d="M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A3,3 0 0,0 13,17A3,3 0 0,0 16,20A3,3 0 0,0 19,17V8H22V6H17Z"/></svg></div>' +
      '<div class="ma-item-info"><div class="ma-item-title">' + (sq.name || 'Pinned Queue') + '</div>' +
        '<div class="ma-item-sub">' + count + ' track' + (count === 1 ? '' : 's') + '</div>' +
      '</div>' +
      '<div class="ma-item-chevron"></div>';
    wrap.appendChild(el);

    let lpTimer = null, lpFired = false;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', () => {
      lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; self._showSavedQueueContextMenu(el, sq); }, 480);
    }, { passive: true });
    el.addEventListener('pointerup',     () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('pointercancel', () => { clearTimeout(lpTimer); lpFired = false; }, { passive: true });
    el.addEventListener('pointermove',   () => clearTimeout(lpTimer), { passive: true });
    el.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }
      self._openSavedQueueDetail(sq);
    });
    this._rowSwipe(el, { menu: (h) => self._showSavedQueueContextMenu(el, sq, h), right: ['sqRename'], left: ['sqPlay', 'sqDelete', 'more'] }, wrap);

    return wrap;
  },

  _renderSavedQueuesSection() {
    const saved = this._getSavedQueues();
    if (!saved.length) return null;

    const section = document.createElement('div');
    section.id = 'saved-queues-section';
    section.style.cssText = 'margin-bottom:4px;';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
    heading.textContent = '\ud83d\udccd Pinned Queues';
    section.appendChild(heading);

    saved.forEach(sq => section.appendChild(this._makeSavedQueueRow(sq)));

    return section;
  },

  _makePinnedCategoryRow(item, key, entity) {
    switch (key) {
      case 'track': case 'artist': case 'album': case 'playlist': {
        // A pinned item is a stored snapshot — its own media_type/_tab can be
        // stale, missing, or wrong even though the category it's filed under
        // (key) is always correct. Since _attachMAItemSwipe's dispatch logic
        // prioritizes item.media_type over the tab parameter, a bad stored
        // value here would cause it to mis-dispatch (e.g. play an artist
        // directly instead of showing its track list). Normalize both fields
        // to match key so dispatch is always correct regardless of what the
        // original snapshot contains.
        const _normalizedItem = { ...item, media_type: key, _tab: key };
        return this._maLibMakeRow(_normalizedItem, key, { noRadioMode: true });
      }
      case 'queues':     return this._makeSavedQueueRow(item);
      case 'stations':   return this._rbMakeStationRow(item, entity, true);
      case 'podcasts':   return this._pcMakeRow(item, true);
      case 'audiobooks': return this._abMakeRow(item, true);
      case 'movies_tv':  return this._mtMakeRow(item, true);
      case 'recaps':     return this._makePinnedRecapRow(item);
      case 'charts':     return this._makePinnedChartRow(item);
      default: return document.createElement('div');
    }
  },

  _renderPinnedOverview(content) {
    if (!content) return;
    content.innerHTML = '';
    this._pinnedDetailActive = false;
    this._pinnedDetailCategory = null;
    const titleEl = this.shadowRoot?.getElementById('maTitle');
    if (titleEl) titleEl.textContent = 'Pins';

    const rows = this._pinnedCategoryDefs()
      .map(cat => ({ cat, count: this._getPinnedCategoryItems(cat.key).length }));

    const catHtml = rows.map(({ cat }) =>
      `<div class="ma-ios-cat-row" data-key="${cat.key}" data-color="${cat.color}">
        <div class="ma-ios-cat-icon" style="background:${cat.color}"><svg viewBox="0 0 24 24"><path d="${cat.path}"/></svg></div>
        <span class="ma-ios-cat-label">${cat.label}</span>
        <div class="ma-ios-cat-chevron"></div>
      </div>`
    ).join('');
    content.innerHTML = `<div class="ma-ios-categories">${catHtml}</div>`;

    // Apply glow to rows — same icon-colour-based treatment as the Music
    // Library root list, since these are colour-tile category shortcuts
    // rather than individual items with real artwork.
    if (this._config?.row_glow === true) {
      content.querySelectorAll('.ma-ios-cat-row').forEach(row => {
        const hex = row.dataset.color;
        row.style.background    = `linear-gradient(90deg, ${hex}20 0%, transparent 60%)`;
        row.style.boxShadow     = `inset 0 0 0 1px ${hex}25`;
        row.style.borderRadius  = '12px';
        row.style.marginBottom  = '4px';
        row.style.borderBottom  = 'none';
      });
    }

    content.querySelectorAll('.ma-ios-cat-row').forEach(row => {
      row.addEventListener('click', () => this._openPinnedCategoryDetail(row.dataset.key));
    });
  },

  _openPinnedCategoryDetail(key) {
    const content = this.shadowRoot?.getElementById('maContent');
    const titleEl  = this.shadowRoot?.getElementById('maTitle');
    const backBtn  = this.shadowRoot?.getElementById('maBackBtn');
    if (!content) return;

    const cat = this._pinnedCategoryDefs().find(c => c.key === key);
    if (!cat) return;

    this._pinnedDetailActive = true;
    this._pinnedDetailCategory = key;
    if (backBtn) backBtn.classList.remove('hidden');
    if (titleEl) titleEl.textContent = cat.label;

    const items = this._getPinnedCategoryItems(key);
    const entity = this._resolveMATargetEntity() || this._entity;
    content.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'ma-empty';
      empty.textContent = 'Nothing pinned in this category yet.';
      content.appendChild(empty);
      return;
    }

    // Pinned Songs is a finite, curated flat list of individual tracks —
    // same shape as a playlist's own drill-in, so it gets the same Play
    // All/Add bar. The other categories (artists/albums/playlists/queues)
    // are lists of separate collections, each with its own drill-in that
    // already has its own Play All specific to that one item — an aggregate
    // "play everything across all of them" would be a different, bigger
    // feature, not just this same pattern reused. Radio/podcasts/audiobooks
    // play individually, matching how their normal tabs already behave.
    if (key === 'track') {
      const bar = document.createElement('div');
      bar.className = 'ma-drill-actions';
      bar.innerHTML =
        '<button class="ma-drill-action-btn" id="pinnedSongsPlayAll"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>' +
        this._shuffleBtnHtml('id="pinnedSongsShuffle"') +
        '<button class="ma-drill-action-btn" id="pinnedSongsAdd"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button>' +
        '<button class="ma-drill-action-btn" id="pinnedSongsNext"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>' +
        '<button class="ma-drill-action-btn" id="pinnedSongsExport" data-pdf="pins"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>';
      content.appendChild(bar);
      bar.querySelector('#pinnedSongsExport')?.addEventListener('click', () => this._exportPinnedSongsPDF(items));

      const _getQueueLength = async (targetEntity) => {
        try {
          const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items);
          if (!hasMassQueue) return null; // can't verify without this — caller falls back to trusting the call
          const mqRes = await this._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
            service_data: { entity: targetEntity, limit_before: 9999, limit_after: 9999 },
            return_response: true
          });
          const raw = mqRes?.response?.[targetEntity] || mqRes?.response || [];
          return Array.isArray(raw) ? raw.length : null;
        } catch (_) {
          return null;
        }
      };

      const _playPinnedSongs = async (mode) => {
        const targetEntity = this._maEntityIds?.has(this._entity) ? this._entity : (this._getValidMASpeakers(true)[0] || null);
        if (!targetEntity) { this._showToast('Music Assistant required'); return; }
        // Only "Play All" (replace) leaves the library — Add/Play Next keep
        // it open so more items can be queued without re-navigating back in.
        if (mode === 'replace') this._closeMABrowser(true);
        this._showLoadingToast(mode === 'add' ? 'Adding to Queue…' : mode === 'next' ? 'Queuing next…' : 'Starting playback…');

        // For "Add"/"Play Next", verify against real queue length — MA's
        // play_media can report success at the service-call level even when
        // a fuzzy title+artist search fails to resolve a match and nothing
        // actually gets enqueued, so a clean call here isn't proof anything
        // happened. "Play All" (replace) starts a fresh queue, so this check
        // doesn't apply there the same way.
        const _queueLenBefore = (mode === 'add' || mode === 'next') ? await _getQueueLength(targetEntity) : null;

        let calledOk = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const _name   = it.name || it.title || '';
          const _artist = (it.artists && it.artists[0]?.name) || '';
          if (!_name) continue;
          try {
            await this._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: {
                entity_id: targetEntity,
                media_id: (_name + (_artist ? ' ' + _artist : '')).trim(),
                media_type: 'track',
                enqueue: mode === 'next' ? 'next' : (mode === 'replace' && i === 0) ? 'replace' : 'add',
                // Pinned Songs is a deliberately curated, finite list — see
                // the same reasoning in _playSavedQueue.
                ...(mode === 'replace' && i === 0 ? { radio_mode: false } : {})
              }
            });
            calledOk++;
          } catch (_) {}
        }

        let added = calledOk;
        if ((mode === 'add' || mode === 'next') && _queueLenBefore !== null) {
          const _queueLenAfter = await _getQueueLength(targetEntity);
          if (_queueLenAfter !== null) {
            added = Math.max(0, Math.min(calledOk, _queueLenAfter - _queueLenBefore));
          }
        }

        this._hideLoadingToast();
        if (added > 0) {
          this._showToast(mode === 'add'
            ? '✓ Added ' + added + ' pinned songs'
            : mode === 'next'
              ? '✓ Playing ' + added + ' pinned songs next'
              : '✓ Playing ' + added + ' pinned songs', 3500);
        } else if (calledOk > 0 && (mode === 'add' || mode === 'next')) {
          // The calls didn't throw, but the queue genuinely didn't grow —
          // tell the truth instead of a false success toast.
          this._showToast('Nothing was actually added — Music Assistant couldn\'t match these songs', 4000);
        } else {
          this._showToast('Could not play pinned songs — check Music Assistant');
        }
      };
      bar.querySelector('#pinnedSongsPlayAll')?.addEventListener('click', () => _playPinnedSongs('replace'));
      bar.querySelector('#pinnedSongsShuffle')?.addEventListener('click', () => this._crowShufflePlay(items));
      bar.querySelector('#pinnedSongsAdd')?.addEventListener('click', () => _playPinnedSongs('add'));
      bar.querySelector('#pinnedSongsNext')?.addEventListener('click', () => _playPinnedSongs('next'));
    }

    // Search bar — filters this category's pinned items by name.
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:2px 2px 12px;';
    searchWrap.innerHTML = '<input type="search" id="pinnedCatSearch" placeholder="Search ' + cat.label.toLowerCase() + '…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:9px 12px;font-size:14px;color:var(--primary-text-color,#fff);font-family:inherit;">';
    content.appendChild(searchWrap);

    const list = document.createElement('div');
    content.appendChild(list);

    const renderList = (query) => {
      list.innerHTML = '';
      const q = (query || '').trim().toLowerCase();
      const filtered = q
        ? items.filter(item => this._pinnedItemDisplayName(item, key).toLowerCase().includes(q))
        : items;
      if (!filtered.length) {
        const noRes = document.createElement('div');
        noRes.className = 'ma-empty';
        noRes.textContent = 'No matches.';
        list.appendChild(noRes);
        return;
      }
      filtered.forEach(item => list.appendChild(this._makePinnedCategoryRow(item, key, entity)));
    };
    renderList('');

    searchWrap.querySelector('#pinnedCatSearch')?.addEventListener('input', (e) => renderList(e.target.value));
  },

  // Small context menu for a saved queue row — Play or Delete.
  _showSavedQueueContextMenu(anchor, sq, headless = false) {
    const r = this.shadowRoot;
    if (!headless) document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
    const backdrop = document.createElement('div');
    backdrop.className = 'queue-dropdown-backdrop';
    const menu = document.createElement('div');
    menu.className = 'queue-dropdown-menu';
    menu.innerHTML =
      '<div class="queue-dropdown-item" id="sqPlay" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span class="queue-dropdown-label">Play</span></div>' +
      (!sq.maUri && this._maCmdOn?.() ? '<div class="queue-dropdown-item" id="sqToMA" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A3,3 0 0,0 13,17A3,3 0 0,0 16,20A3,3 0 0,0 19,17V8H22V6H17Z"/></svg><span class="queue-dropdown-label">Save to Music Assistant</span></div>' : '') +
      '<div class="queue-dropdown-item" id="sqRename" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04Z"/></svg><span class="queue-dropdown-label">Rename</span></div>' +
      '<div class="queue-dropdown-item" id="sqExport" data-pdf="lists" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg><span class="queue-dropdown-label">Export to PDF</span></div>' +
      '<div class="queue-dropdown-item danger" id="sqDelete" role="button"><svg class="queue-dropdown-icon" viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg><span class="queue-dropdown-label">Unpin</span></div>';
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = r.host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (anchorRect.bottom - cardRect.top + 4) + 'px';
    // Not setting .left here — the CSS class already fixes this menu's
    // horizontal position via "right: 14px", matching the exact pattern the
    // proven working context menus use (only .top is set dynamically from
    // the anchor; horizontal position stays fixed). Setting .left as well
    // conflicted with that baked-in "right" value on an absolutely
    // positioned element, which could render it off-screen or collapsed —
    // looking exactly like "instantly disappeared".
    // Both popups stay in the DOM while hidden, so _menuHost picks the one that's showing.
    const host = this._menuHost(anchor);
    if (!headless) { host.appendChild(backdrop); host.appendChild(menu); }
    const _menuOpenedAt = Date.now();
    const _menuReady = () => headless || (Date.now() - _menuOpenedAt) > 320;
    const closeMenu = () => { menu.remove(); backdrop.remove(); };
    // pointerdown, not click — click gets synthesized as a trailing event of
    // the same long-press gesture that opened this menu, so a click-based
    // dismiss handler fires almost immediately and closes what it just
    // opened. pointerdown only fires once per physical touch, so the same
    // gesture can't retrigger it — only a genuine subsequent tap can. This
    // matches the exact pattern every other working context menu in the app
    // already uses.
    backdrop.addEventListener('pointerdown', () => { if (!_menuReady()) return; closeMenu(); });
    menu.querySelector('#sqPlay')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu(); this._playSavedQueue(sq); });
    menu.querySelector('#sqToMA')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu(); this._sqSaveToMA(sq); });
    menu.querySelector('#sqRename')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu();
      this._showRenameQueueSheet(sq, () => {
        const content = this.shadowRoot?.getElementById('maContent');
        if (!content) return;
        if ((this._pinnedDetailActive && this._pinnedDetailCategory === 'queues') || content.querySelector('#pinnedCatSearch')) {
          this._openPinnedCategoryDetail('queues');
        } else {
          this._maLibInjectStarred('playlist', content);
        }
      });
    });
    menu.querySelector('#sqExport')?.addEventListener('click', e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu(); this._exportSavedQueuePDF(sq); });
    menu.querySelector('#sqDelete')?.addEventListener('click', async e => { e.stopPropagation(); if (!_menuReady()) return; closeMenu();
      if (!(await this._confirmUnpin('queue', sq.name || '', { snapshot: true }))) return;
      const list = this._getSavedQueues().filter(s => s.id !== sq.id);
      this._saveSavedQueuesList(list);
      this._showToast('Queue unpinned');
      const content = this.shadowRoot?.getElementById('maContent');
      if (!content) return;
      // Refresh whichever view is actually showing this row right now.
      if ((this._pinnedDetailActive && this._pinnedDetailCategory === 'queues') || content.querySelector('#pinnedCatSearch')) {
        this._openPinnedCategoryDetail('queues');
      } else {
        this._maLibInjectStarred('playlist', content);
      }
    });
    if (headless) return this._menuHeadless(menu);
  },

  // Replays a saved queue: clears the current queue, then re-adds every track
  // via the same fuzzy title+artist search used everywhere else in the app
  // (Add Similar Songs, pinned tracks, etc.) — there's no stored direct URI,
  // so an exact remaster/version match isn't guaranteed, just very likely.
  async _playSavedQueue(sq, mode = 'replace') {
    const tracks = sq.tracks || [];
    if (!tracks.length) { this._showToast('This pinned queue is empty'); return; }
    const targetEntity = this._maEntityIds?.has(this._entity) ? this._entity : (this._getValidMASpeakers(true)[0] || null);
    if (!targetEntity) { this._showToast('Music Assistant required'); return; }
    if (mode === 'replace') this._closeMABrowser(true);
    this._showLoadingToast(mode === 'add' ? 'Adding to queue…' : 'Starting playback…');
    if (sq.maUri) {
      try {
        await this._hass.connection.sendMessagePromise({ type: 'call_service', domain: 'music_assistant', service: 'play_media',
          service_data: { entity_id: targetEntity, media_id: sq.maUri, media_type: 'playlist', enqueue: mode === 'add' ? 'add' : mode === 'next' ? 'next' : 'replace', ...(mode === 'replace' ? { radio_mode: false } : {}) } });
        this._hideLoadingToast();
        this._showToast(mode === 'add' ? '\u2713 Added "' + (sq.name || 'Pinned Queue') + '"' : '\u2713 Playing "' + (sq.name || 'Pinned Queue') + '"', 3000);
        return;
      } catch (_) { /* the playlist may have been deleted in Music Assistant: play the songs one by one instead */ }
    }
    let added = 0;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      try {
        await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'play_media',
          service_data: {
            entity_id: targetEntity,
            media_id: (t.title || '') + ' ' + (t.artist || ''),
            media_type: 'track',
            enqueue: (mode === 'replace' && i === 0) ? 'replace' : 'add',
            // A pinned queue is a deliberately curated, finite list — it
            // should never auto-continue into unrelated tracks once it ends,
            // regardless of any radio-mode state left over from something
            // else entirely (MA's radio_mode can persist at the queue level
            // rather than being purely per-call).
            ...(mode === 'replace' && i === 0 ? { radio_mode: false } : {})
          }
        });
        added++;
      } catch (_) {}
    }
    this._hideLoadingToast();
    if (added > 0) {
      this._showToast(mode === 'add'
        ? '✓ Added ' + added + ' tracks from "' + (sq.name || 'Pinned Queue') + '"'
        : '✓ Playing "' + (sq.name || 'Pinned Queue') + '" (' + added + ' tracks)', 3500);
    } else {
      this._showToast('Could not play pinned queue — check Music Assistant');
    }
  },

  // Drills into a Saved Queue and shows its tracks with full interaction
  // parity with any other track list — tap opens the same hero-art info
  // panel (_showAITrackInfo), long-press opens the same context menu
  // (_showEnqueueMenu via _attachMAItemSwipe). There's no real backing MA
  // object here (it's a frozen snapshot with no uri), so this can't reuse
  // _maOpenCollectionTracks, which requires one — this is a lightweight,
  // purpose-built equivalent for synthetic track lists. Uses the same shared
  // back-button/nav-stack pattern as every other library drill-in.
  _openSavedQueueDetail(sq, skipNavPush = false) {
    const content   = this.shadowRoot?.getElementById('maContent');
    const titleEl   = this.shadowRoot?.getElementById('maTitle');
    const backBtn   = this.shadowRoot?.getElementById('maBackBtn');
    const tabsEl    = this.shadowRoot?.getElementById('maTabs');
    const searchRow = this.shadowRoot?.querySelector('.ma-search-row');
    if (!content) return;

    // This can be reached from either the normal Playlists tab's Saved
    // Queues section, or the consolidated Pinned tab's Queues category —
    // remember which, so the back button returns to the right place instead
    // of the pinned-category shortcut intercepting it and skipping a level.
    const openedFromPinned = this._pinnedDetailActive === true;
    if (!skipNavPush) {
      this._pinnedDetailActive = false;
      if (!this._maBrowserNavStack) this._maBrowserNavStack = [];
      this._maBrowserNavStack.push(openedFromPinned
        ? { tab: '__pinned_category__', _pinnedCategory: 'queues', searchQuery: null, inSearchResults: false }
        : { tab: this._maCurrentTab || 'playlist', searchQuery: null, inSearchResults: false }
      );
    }

    if (tabsEl)    tabsEl.style.display    = 'none';
    if (searchRow) searchRow.style.display = 'none';
    if (backBtn)   backBtn.classList.remove('hidden');
    if (titleEl)   titleEl.textContent = sq.name || 'Saved Queue';

    const tracks = sq.tracks || [];
    content.innerHTML =
      '<div class="ma-drill-actions" style="margin-bottom:14px;">' +
        '<button class="ma-drill-action-btn" id="sqDetailPlayAll"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>' +
        this._shuffleBtnHtml('id="sqDetailShuffle"') +
        '<button class="ma-drill-action-btn" id="sqDetailAdd"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button>' +
        '<button class="ma-drill-action-btn" id="sqDetailRename"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04Z"/></svg></div><span class="ma-drill-btn-label">Rename</span></button>' +
        '<button class="ma-drill-action-btn" id="sqDetailExport" data-pdf="lists"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>' +
        '<button class="ma-drill-action-btn" id="sqDetailDelete"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">Unpin</span></button>' +
      '</div>' +
      '<div id="sqDetailList"></div>';

    const list = content.querySelector('#sqDetailList');
    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'ma-empty';
      empty.textContent = 'This pinned queue is empty.';
      list.appendChild(empty);
    } else {
      const _fallbackNoteIcon = '<svg viewBox="0 0 24 24" style="display:flex;fill:rgba(255,255,255,0.3)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
      tracks.forEach((t, _tIdx) => {
        // Same shape _showAITrackInfo/_showEnqueueMenu already expect — no
        // uri, so playback and pinning fall back to fuzzy title+artist
        // search, exactly like a pinned non-MA track.
        const item = {
          name:    t.title || '',
          artists: t.artist ? [{ name: t.artist }] : [],
          album:   t.album ? { name: t.album } : null,
          _tab:    'track',
        };
        const wrap = document.createElement('div');
        wrap.className = 'ma-item-wrap';
        const el = document.createElement('div');
        el.className = 'ma-item';

        // Artwork: the thumbnail captured when the queue was saved (best —
        // no lookup needed) → already-cached iTunes art from anywhere else
        // in the app → fall back to the note icon and kick off a live
        // iTunes lookup, same mechanism the Queue panel itself uses, which
        // will patch this exact element in once it resolves.
        const itunesKey = (t.artist || t.album || t.title)
          ? [t.artist, t.album || t.title].filter(Boolean).join('|').toLowerCase()
          : '';
        const cachedArt = itunesKey ? (this._itunesArtCache?.[itunesKey] || '') : '';
        const artSrc = t.image || cachedArt || '';
        const keyAttr = itunesKey ? ' data-itunes-key="' + itunesKey.replace(/"/g, '&quot;') + '"' : '';
        const artInner = artSrc
          ? _fallbackNoteIcon + '<img src="' + artSrc + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">'
          : _fallbackNoteIcon;

        el.innerHTML =
          '<div class="ma-item-art"' + keyAttr + ' style="position:relative;">' + artInner + '</div>' +
          '<div class="ma-item-info"><div class="ma-item-title">' + (t.title || 'Unknown') + '</div>' +
            (t.artist ? '<div class="ma-item-sub">' + t.artist + '</div>' : '') +
          '</div>' +
          '<div class="ma-item-chevron"></div>';
        wrap.appendChild(el);
        this._attachMAItemSwipe(wrap, item, 'track', { savedQueueRemove: { sqId: sq.id, trackIndex: _tIdx } });
        list.appendChild(wrap);

        if (!artSrc && itunesKey) this._fetchItunesArt(t.artist, t.album, t.title, { skipStaleGuard: true });
      });
    }

    content.querySelector('#sqDetailPlayAll')?.addEventListener('click', () => this._playSavedQueue(sq, 'replace'));
    content.querySelector('#sqDetailShuffle')?.addEventListener('click', () => this._crowShufflePlay(sq.tracks || []));
    content.querySelector('#sqDetailAdd')?.addEventListener('click', () => this._playSavedQueue(sq, 'add'));
    content.querySelector('#sqDetailRename')?.addEventListener('click', () => {
      this._showRenameQueueSheet(sq, (updatedSq) => {
        this._openSavedQueueDetail(updatedSq, true);
      });
    });
    content.querySelector('#sqDetailExport')?.addEventListener('click', () => this._exportSavedQueuePDF(sq));
    content.querySelector('#sqDetailDelete')?.addEventListener('click', async () => {
      if (!(await this._confirmUnpin('queue', sq.name || '', { snapshot: true }))) return;
      const list2 = this._getSavedQueues().filter(s => s.id !== sq.id);
      this._saveSavedQueuesList(list2);
      this._showToast('Queue unpinned');
      this._maNavBack();
    });
  },

  // Reads the full current queue (previous, current, and upcoming) and opens
  // the naming sheet. Uses mass_queue.get_queue_items if that companion
  // integration is installed (gives the complete queue); otherwise falls back
  // to music_assistant.get_queue, which only exposes the current + next item.
  // every song in a Music Assistant speaker's queue (page by page), or null when Music Assistant can't be asked
  async _maAllQueueItems(eid) {
    const qid = this._maQueueId?.(eid);
    if (!qid || !this._maCmdOn?.()) return null;
    const all = [];
    for (let off = 0; off < 5000; off += 500) {
      const list = await this._maCmd('player_queues/items', { queue_id: qid, limit: 500, offset: off });
      if (!Array.isArray(list) || !list.length) break;
      all.push(...list);
      if (list.length < 500) break;
    }
    return all;
  },
  // a new playlist in Music Assistant's own library with these songs: { uri }
  async _maMakePlaylist(name, uris) {
    const pl = await this._maCmd('music/playlists/create_playlist', { name });
    const id = pl?.item_id;
    if (id === undefined || id === null || id === '') throw new Error('The playlist wasn\u2019t created');
    for (let i = 0; i < uris.length; i += 100) {
      await this._maCmd('music/playlists/add_playlist_tracks', { db_playlist_id: id, uris: uris.slice(i, i + 100) });
    }
    return { uri: pl.uri || ('library://playlist/' + id) };
  },
  // remember which Music Assistant playlist a pinned queue is
  _sqLinkPlaylist(sqId, uri) {
    const list = this._getSavedQueues();
    const e = list.find(x => x.id === sqId);
    if (!e) return;
    e.maUri = uri;
    this._saveSavedQueuesList(list);
  },
  // an older pinned queue (saved before it could be a playlist): find each song in Music Assistant and make it one
  async _sqSaveToMA(sq) {
    if (!this._maCmdOn?.()) { this._showToast('Install Queue Actions to save pinned queues to Music Assistant', 4000); return; }
    const tracks = sq.tracks || [];
    if (!tracks.length) return;
    this._showLoadingToast('Finding the songs in Music Assistant\u2026');
    const uris = [];
    let missing = 0;
    for (const t of tracks) {
      let uri = t.uri && !/^https?:/i.test(t.uri) ? t.uri : '';
      if (!uri) {
        try {
          const res = await this._maCmd('music/search', { search_query: [t.artist, t.title].filter(Boolean).join(' '), media_types: ['track'], limit: 5 });
          const list = res?.tracks || [];
          const n = x => String(x || '').toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/[^a-z0-9]+/g, '');
          const hit = list.find(x => n(x.name) === n(t.title) && (!t.artist || (x.artists || []).some(a => n(a.name) === n(t.artist.split(',')[0])))) || null;
          uri = hit?.uri || '';
        } catch (_) { uri = ''; }
      }
      if (uri) uris.push(uri); else missing++;
    }
    if (!uris.length) { this._hideLoadingToast(); this._showToast('None of these songs could be found in Music Assistant'); return; }
    try {
      const pl = await this._maMakePlaylist(sq.name || 'Pinned Queue', uris);
      this._sqLinkPlaylist(sq.id, pl.uri);
      this._hideLoadingToast();
      this._showToast('Saved "' + (sq.name || 'Pinned Queue') + '" to Music Assistant' + (missing ? ' (' + missing + ' song' + (missing === 1 ? '' : 's') + ' couldn\u2019t be found)' : ''), 4000);
    } catch (_) { this._hideLoadingToast(); this._showToast('Couldn\u2019t save it to Music Assistant'); }
  },

  async _promptSaveQueueAsPlaylist() {
    const targetEntity = this._entity;
    if (!targetEntity) return;

    let tracks = [];
    try {
      // Music Assistant's own queue, every page, with each song's id (so it can become a real playlist)
      const _all = await this._maAllQueueItems(targetEntity).catch(() => null);
      if (Array.isArray(_all) && _all.length) {
        tracks = _all.map(it => { const m = this._maItem(it, 0, -1); return { title: m.title, artist: m.artist, album: m.album, image: m.thumbnail || '', uri: m.uri || '' }; })
          .filter(t => t.title && t.title !== 'Unknown Track');
      }
      const hasMassQueue = !tracks.length && !!(this._hass?.services?.mass_queue?.get_queue_items);
      if (tracks.length) { /* read from Music Assistant */ }
      else if (hasMassQueue) {
        const mqRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: targetEntity, limit_before: 9999, limit_after: 9999 },
          return_response: true
        });
        const raw = mqRes?.response?.[targetEntity] || mqRes?.response || [];
        if (Array.isArray(raw)) {
          tracks = raw.map(item => ({
            title:  item.media_title || item.name || '',
            artist: item.media_artist || item.artist || '',
            album:  item.media_album_name || item.album || '',
            image:  item.thumbnail || '',
          })).filter(t => t.title);
        }
      } else {
        const qRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: targetEntity }, return_response: true
        });
        const qData = qRes?.response?.[targetEntity] || qRes?.response || null;
        [qData?.current_item, qData?.next_item].forEach(item => {
          const title = item?.name || item?.media_item?.name || '';
          if (title) tracks.push({
            title,
            artist: item?.media_item?.artists?.[0]?.name || '',
            album:  item?.media_item?.album?.name || '',
            image:  item?.image || item?.media_item?.metadata?.images?.[0]?.url || '',
          });
        });
        if (tracks.length) {
          this._showToast('Only the current + next track could be read — install the mass_queue integration to save the full queue', 5000);
        }
      }
    } catch (_) {
      this._showToast('Could not read the queue — try again');
      return;
    }

    if (!tracks.length) { this._showToast('Queue is empty — nothing to save'); return; }
    this._showSaveQueueNameSheet(tracks);
  },

  // Naming bottom-sheet for a queue snapshot — same visual pattern as the
  // radio/podcast genre-pill sheet elsewhere in the app.
  _showSaveQueueNameSheet(tracks) {
    const _pt = (k) => this._pt(k);
    document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
    const sheet = document.createElement('div');
    sheet.className = 'crow-media-rb-tag-sheet';
    sheet.style.cssText = 'position:absolute;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);left:0;top:' + window.scrollY + 'px;width:' + document.documentElement.clientWidth + 'px;height:' + window.innerHeight + 'px;';
    const _defaultName = 'Queue \u2013 ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    sheet.innerHTML = '<div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      + '<span style="font-size:15px;font-weight:700;color:' + _pt('text') + ';">Pin Queue</span>'
      + '<button class="crow-media-rb-tag-sheet-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + _pt('text') + '"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>'
      + '</div>'
      + '<div style="font-size:12px;color:' + _pt('dim') + ';margin-bottom:10px;">' + tracks.length + ' track' + (tracks.length === 1 ? '' : 's') + ' will be pinned' + (this._maCmdOn?.() && tracks.some(t => t.uri) ? ', and saved as a playlist in Music Assistant' : '') + '.</div>'
      + '<input id="sqNameInput" type="text" value="' + _defaultName.replace(/"/g, '&quot;') + '" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 12px;font-size:14px;color:' + _pt('text') + ';font-family:inherit;margin-bottom:14px;" autocomplete="off" autocorrect="off" spellcheck="false">'
      + '<button id="sqSaveBtn" style="width:100%;padding:11px;background:#0A84FF;border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;">Pin</button>'
      + '</div>';
    this._bodyAppend(sheet);
    const _close = () => sheet.remove();
    sheet.addEventListener('click', e => { if (e.target === sheet) _close(); });
    sheet.querySelector('.crow-media-rb-tag-sheet-close')?.addEventListener('click', _close);
    const _input = sheet.querySelector('#sqNameInput');
    _input?.focus();
    _input?.select();
    if (_input) {
      const _sampleTracks = tracks.slice(0, 12).map(t => t.title + (t.artist ? ' by ' + t.artist : '')).join('; ');
      this._wireAiPinNameSuggestion(sheet, _input, _defaultName,
        'Suggest a short, catchy playlist name (3-6 words, no quotes, no hashtags) for a queue containing these tracks: ' + _sampleTracks + '. Reply with ONLY the name, nothing else.');
    }
    sheet.querySelector('#sqSaveBtn')?.addEventListener('click', () => {
      const name = (_input?.value || '').trim() || _defaultName;
      const list = this._getSavedQueues();
      const entry = { id: 'sq_' + Date.now(), name, createdAt: Date.now(), tracks };
      list.unshift(entry);
      this._saveSavedQueuesList(list);
      _close();
      // a real Music Assistant playlist too, so it's in the Music Assistant app and plays exactly these songs
      const uris = tracks.map(t => t.uri).filter(u => u && !/^https?:/i.test(u));
      if (this._maCmdOn?.() && uris.length) {
        this._showToast('\ud83d\udccd Pinned "' + name + '" \u2014 saving it to Music Assistant\u2026', 2500);
        this._maMakePlaylist(name, uris).then(pl => {
          this._sqLinkPlaylist(entry.id, pl.uri);
          this._showToast('Pinned "' + name + '" and saved it as a playlist in Music Assistant', 3500);
        }).catch(() => this._showToast('Pinned "' + name + '" (it couldn\u2019t be saved to Music Assistant)', 3500));
      } else {
        this._showToast('\ud83d\udccd Pinned "' + name + '"');
      }
      const content = this.shadowRoot?.getElementById('maContent');
      if (content) this._maLibInjectStarred('playlist', content);
    });
  },

  // Renames an existing Saved Queue. Takes an onRenamed callback rather than
  // guessing at how to refresh internally — the list's context menu and the
  // drill-in detail view each need to refresh themselves differently, and
  // the caller already knows which context it's being invoked from.
  _showRenameQueueSheet(sq, onRenamed) {
    const _pt = (k) => this._pt(k);
    document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
    const sheet = document.createElement('div');
    sheet.className = 'crow-media-rb-tag-sheet';
    sheet.style.cssText = 'position:absolute;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);left:0;top:' + window.scrollY + 'px;width:' + document.documentElement.clientWidth + 'px;height:' + window.innerHeight + 'px;';
    sheet.innerHTML = '<div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      + '<span style="font-size:15px;font-weight:700;color:' + _pt('text') + ';">Rename Queue</span>'
      + '<button class="crow-media-rb-tag-sheet-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + _pt('text') + '"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>'
      + '</div>'
      + '<input id="sqRenameInput" type="text" value="' + (sq.name || '').replace(/"/g, '&quot;') + '" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 12px;font-size:14px;color:' + _pt('text') + ';font-family:inherit;margin-bottom:14px;" autocomplete="off" autocorrect="off" spellcheck="false">'
      + '<button id="sqRenameBtn" style="width:100%;padding:11px;background:#0A84FF;border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;">Save</button>'
      + '</div>';
    this._bodyAppend(sheet);
    const _close = () => sheet.remove();
    sheet.addEventListener('click', e => { if (e.target === sheet) _close(); });
    sheet.querySelector('.crow-media-rb-tag-sheet-close')?.addEventListener('click', _close);
    const _input = sheet.querySelector('#sqRenameInput');
    _input?.focus();
    _input?.select();
    sheet.querySelector('#sqRenameBtn')?.addEventListener('click', () => {
      const newName = (_input?.value || '').trim();
      if (!newName) { this._showToast('Name cannot be empty'); return; }
      const list = this._getSavedQueues();
      const target = list.find(s => s.id === sq.id);
      if (!target) { _close(); return; }
      target.name = newName;
      this._saveSavedQueuesList(list);
      _close();
      this._showToast('Renamed to "' + newName + '"');
      if (typeof onRenamed === 'function') onRenamed(target);
    });
  },

  _maLibInjectStarred(tab, content) {
    if (!['track','artist','album','favourites','playlist'].includes(tab)) return;
    const _t = tab === 'favourites' ? 'track' : tab;
    const grid = content.querySelector('.ma-grid');

    content.querySelector('#malib-starred-' + _t)?.remove();
    content.querySelector('#saved-queues-section')?.remove();
    content.querySelector('#malib-starred-divider')?.remove();

    let section = null, sqSection = null;
    if (this._config?.show_pins_in_sections !== false) {
      section = this._maLibRenderStarredSection(_t);
      if (section) content.insertBefore(section, grid || content.firstChild);

      if (_t === 'playlist') {
        sqSection = this._renderSavedQueuesSection();
        if (sqSection) content.insertBefore(sqSection, grid || content.firstChild);
      }
    }

    // Single shared "Library" divider after whichever of the two sections
    // above actually rendered, so there's never more than one shown.
    if (section || sqSection) {
      const divider = document.createElement('div');
      divider.id = 'malib-starred-divider';
      divider.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
      divider.textContent = 'Library';
      content.insertBefore(divider, grid || content.firstChild);
    }
  },

  _abSaveStarred(list) { const k = this._abStarredKey(); if (!this._starredMemCache) this._starredMemCache = {}; this._starredMemCache[k] = list; try { localStorage.setItem(k, JSON.stringify(list)); } catch(_) {} this._haStorageSavePins(); },

  // Asks the AI for a short, punchy name given a plain-language description
  // of what's being pinned (e.g. a track listing, or a recap's top artists).
  // Shared by Pin Queue and Pin Music Recap so both
  // suggest a name instead of defaulting straight to a date/time stamp.
  async _aiSuggestPinName(prompt) {
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return null;
    try {
      const raw = await this._aiConverseQuiet(prompt);
      if (!raw) return null;
      let name = raw.trim()
        .replace(/^["'“‘]+|["'”’]+$/g, '') // strip wrapping quotes the model likes to add
        .replace(/\.$/, '')                 // strip a trailing period
        .replace(/\s+/g, ' ')
        .trim();
      if (name.length > 60) name = name.slice(0, 60).trim();
      return name || null;
    } catch (_) { return null; }
  },

  // Wires an AI name suggestion into an already-open naming sheet. Only
  // swaps the suggestion in if the sheet is still open and the user hasn't
  // already started editing away from the passed-in default — never
  // overwrites something the user typed themselves. Shows a small spinner
  // on the right edge of the input while the suggestion is in flight.
  _wireAiPinNameSuggestion(sheet, input, fallbackName, prompt) {
    if (!input) return;
    if (!this._aiEnabled()) return; // no AI configured — nothing to wait on, skip the spinner entirely

    // Wrap the input in a relative container (only once) so the spinner can
    // sit absolutely positioned on its right edge regardless of where this
    // sheet places the input.
    let wrap = input.parentElement;
    if (!wrap || !wrap.classList.contains('ai-name-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'ai-name-wrap';
      wrap.style.cssText = 'position:relative;';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      input.style.paddingRight = '34px'; // room for the spinner so typed text never sits under it
    }
    const spinner = document.createElement('div');
    spinner.className = 'ai-name-spinner';
    spinner.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;border:2px solid rgba(255,255,255,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.7s linear infinite;pointer-events:none;';
    wrap.appendChild(spinner);

    this._aiSuggestPinName(prompt).then(suggestion => {
      if (!suggestion) return;
      if (!sheet.isConnected) return;
      if (input.value.trim() !== fallbackName.trim()) return;
      input.value = suggestion;
      input.select();
    }).finally(() => spinner.remove());
  },

  // AI query interpretation — extracts title/author from natural language
  async _abInterpretQuery(rawQuery) {
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return { mode: 'all', query: rawQuery, suggestion: null };
    try {
      const raw = await this._aiConverseF('discover', 
        'The user is searching LibriVox for a public domain audiobook. Their query is: "' + rawQuery + '". ' +
        'LibriVox only has pre-1928 public domain works. ' +
        'Respond ONLY with JSON, no markdown: ' +
        '{"title":"the most likely book title to search for","author":"author name if identifiable or empty string","q":"best general search term if neither title nor author is clear","suggestion":"corrected or full title to show user if query looks like a typo or partial title"} ' +
        'Always populate suggestion with the most likely intended title. Example: "wind of worlds" -> suggestion: "War of the Worlds".'
      );
      const clean = (raw || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      const suggestion = parsed.suggestion && parsed.suggestion.toLowerCase() !== rawQuery.toLowerCase() ? parsed.suggestion : null;
      if (parsed.title && !parsed.author) return { mode: 'title', query: parsed.title, suggestion };
      if (parsed.author && !parsed.title) return { mode: 'author', query: parsed.author, suggestion };
      if (parsed.title && parsed.author)  return { mode: 'both', titleQuery: parsed.title, authorQuery: parsed.author, suggestion };
      return { mode: 'all', query: parsed.q || rawQuery, suggestion };
    } catch(_) {
      return { mode: 'all', query: rawQuery, suggestion: null };
    }
  },

  async _abFetchBooks(mode, query) {
    const _t = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

    // Use Internet Archive search API — full keyword search, open CORS, same data the LibriVox
    // website uses. The native librivox.org API only does prefix/starts-with matching which
    // returns nothing for queries like "Sherlock Holmes" (books start with "The Adventures of...").
    let q;
    if (mode === 'author') {
      q = 'creator:(' + query + ') collection:librivoxaudio';
    } else if (mode === 'title') {
      q = 'title:(' + query + ') collection:librivoxaudio';
    } else {
      q = query + ' collection:librivoxaudio';
    }

    const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
      '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&fl[]=subject' +
      '&output=json&rows=20&page=1';

    let docs = [];
    try {
      const res = await Promise.race([crowFetch(url, { cache: 'no-store' }), _t(10000)]);
      if (res.ok) {
        const d = await Promise.race([res.json(), _t(10000)]);
        docs = d?.response?.docs || [];
      }
    } catch(_) {}

    return docs.map(b => ({
      id:           b.identifier,
      title:        b.title || 'Unknown Title',
      author:       Array.isArray(b.creator) ? b.creator.join(', ') : (b.creator || ''),
      description:  Array.isArray(b.description)
                      ? b.description[0].replace(/<[^>]+>/g, '').trim().slice(0, 200)
                      : (b.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 200),
      url_rss:      'https://librivox.org/rss/' + b.identifier,
      url_librivox: 'https://librivox.org/' + b.identifier,
      // Archive.org's standard per-item cover thumbnail — reliable, no extra
      // API call needed, works directly off the identifier.
      artUrl:       'https://archive.org/services/img/' + b.identifier,
      language:     null,
      totaltime:    null,
      // real subjects ("Science fiction"), not LibriVox's own catalogue tags ("librivox", "audiobook")
      genres:       this._abCleanGenres(b.subject),
      num_sections: null,
    }));
  },

  _abCleanGenres(subject) {
    const list = (Array.isArray(subject) ? subject : subject ? [subject] : [])
      .flatMap(x => String(x || '').split(/[;,]/)).map(x => x.trim()).filter(Boolean);
    const skip = /^(librivox|audio ?books?|audio|books?|literature|fiction|english|public domain|mp3|podcasts?|readings?|recordings?|librivoxaudio)$/i;
    const seen = new Set();
    return list.filter(x => !skip.test(x) && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
      .map(x => x.charAt(0).toUpperCase() + x.slice(1));
  },

  async _abSearch(query) {
    // Search by title first, then author, then suggest via AI if nothing found
    const titleResults = await this._abFetchBooks('title', query);
    if (titleResults.length) return titleResults;

    const authorResults = await this._abFetchBooks('author', query);
    if (authorResults.length) return authorResults;

    // Nothing found — ask AI for a suggestion
    let suggestion = null;
    try {
      const hasAI = await this._aiCheckAvailable();
      if (hasAI) {
        const raw = await this._aiConverseF('discover', 
          'The user searched LibriVox for "' + query + '" but found nothing. ' +
          'LibriVox only has public domain audiobooks. ' +
          'Suggest the most likely intended public domain title in 1-5 words only. ' +
          'Reply with ONLY the title, nothing else.'
        );
        const s = (raw || '').trim().replace(/^["']|["']$/g, '');
        if (s && s.toLowerCase() !== query.toLowerCase()) suggestion = s;
      }
    } catch(_) {}

    // Final fallback: try searching with the most unique word (prefer last words, skip common names/words)
    const stopWords2 = new Set(['the','of','and','in','a','an','to','for','by','with','at','from','as',
      'autobiography','volume','complete','adventures','story','tales','collection','selected','works',
      'john','james','william','george','henry','charles','edward','thomas','robert','richard',
      'mary','anne','elizabeth','jane','sarah','margaret','alice']);
    const words2 = query.split(/\s+/).filter(w => w.length > 3 && !stopWords2.has(w.toLowerCase()));
    // Try from the end — last words tend to be most specific (e.g. "Spurgeon" in "Charles H. Spurgeon")
    const keyWords = [...words2].reverse();
    for (const kw of keyWords) {
      if (kw.toLowerCase() === query.toLowerCase()) continue;
      const kwResults = await this._abFetchBooks('title', kw);
      if (kwResults.length) return kwResults;
      const kwAuthor = await this._abFetchBooks('author', kw);
      if (kwAuthor.length) return kwAuthor;
    }

    return { empty: true, originalQuery: query, suggestion };
  },

  async _abFetchChapters(identifier, limit) {
    limit = limit || 50;
    const _t = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

    // Use Archive.org metadata API — returns all files for an item as JSON.
    // This is more reliable than LibriVox RSS (which uses a numeric ID we don't have)
    // and Archive.org has open CORS headers so no proxy needed.
    const metaUrl = 'https://archive.org/metadata/' + encodeURIComponent(identifier);
    let files = [];
    try {
      const res = await Promise.race([crowFetch(metaUrl, { cache: 'no-store' }), _t(10000)]);
      if (res.ok) {
        const data = await Promise.race([res.json(), _t(10000)]);
        files = (data?.files || []).filter(f =>
          f.name && f.name.toLowerCase().endsWith('.mp3') &&
          // Skip the 64kb and other derivative formats — prefer 128kb originals
          !f.name.includes('_64kb') && !f.name.includes('_128kb') ||
          // But if only derivatives exist, keep 128kb as fallback
          (f.name.includes('_128kb'))
        );
        // Prefer original MP3s; if we have both originals and 128kb, keep originals
        const originals = files.filter(f => !f.name.includes('_128kb') && !f.name.includes('_64kb'));
        if (originals.length) files = originals;
        // Sort by track number embedded in filename, then alphabetically
        files.sort((a, b) => {
          const numA = parseInt((a.name.match(/(\d+)/) || [])[1] || '0', 10);
          const numB = parseInt((b.name.match(/(\d+)/) || [])[1] || '0', 10);
          return numA !== numB ? numA - numB : a.name.localeCompare(b.name);
        });
      }
    } catch(_) {}

    if (!files.length) throw new Error('Could not fetch chapters');

    return files.slice(0, limit).map((f, i) => {
      // The chapter's own title from the recording's details ("The Eve of the War"), without a leading number;
      // otherwise "Chapter 3" rather than the file's name ("waroftheworlds 03 wells")
      const own = String(f.title || '').replace(/^\s*\d+\s*[-.:)]\s*/, '').trim();
      const raw = f.name.replace(/\.mp3$/i, '').replace(/^[\d_\-]+/, '').replace(/_/g, ' ').trim();
      const slug = !raw || (/^[a-z0-9]+( [a-z0-9]+)*$/.test(raw) && /\d/.test(raw));
      const title = own || (slug ? 'Chapter ' + (i + 1) : raw);
      // Format duration from seconds
      let durFmt = '';
      if (f.length) {
        const s = String(f.length).includes(':')
          ? String(f.length).split(':').reduce((t, x) => t * 60 + (parseFloat(x) || 0), 0)
          : parseFloat(f.length);
        if (!isNaN(s)) { const m = Math.floor(s/60), h = Math.floor(m/60); durFmt = h > 0 ? h+'h '+(m%60)+'m' : m+' min'; }
      }
      return {
        title,
        url: 'https://archive.org/download/' + identifier + '/' + encodeURIComponent(f.name),
        duration: durFmt,
        num: i + 1,
        file: f.name,   // its file's name (full screen finds the chapter playing by the numbers in it)
      };
    }).filter(ch => ch.url);
  },

  _abRememberChapters(urls, book) {
    if (!book) return;
    if (!this._abChapterCache) this._abChapterCache = new Map();
    urls.forEach(u => this._abChapterCache.set(u, book));
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ab_chapter_cache') || '{}');
      urls.forEach(u => { store[u] = { book, ts: Date.now() }; });
      const TTL = 30*24*3600*1000;
      Object.keys(store).forEach(k => { if (Date.now()-(store[k].ts||0) > TTL) delete store[k]; });
      localStorage.setItem('crow_media_ab_chapter_cache', JSON.stringify(store));
    } catch(_) {}
  },
  // the chapter of this book last played on this device (its link), or ''
  _abLastChapter(book) {
    if (!book?.id) return '';
    if (this._abNowPlaying?.url && this._abCachedBook(this._abNowPlaying.url)?.id === book.id) return this._abNowPlaying.url;
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ab_played') || '{}');
      return store[book.id]?.url || '';
    } catch(_) { return ''; }
  },

  _abPlayChapter(chapterUrl, title, entity, book) {
    entity = entity || this._resolveMATargetEntity() || this._entity;
    this._playMediaDirect(entity, chapterUrl, 'music', title);
    this._abNowPlaying = { url: chapterUrl, title, ts: Date.now() };
    try { localStorage.setItem('crow_media_ab_now_playing', JSON.stringify(this._abNowPlaying)); } catch(_) {}
    // …and the other way round
    this._pcClearNowPlaying();
    if (book) {
      this._abRememberChapters([chapterUrl], book);
      // the chapter last played for each book (for Continue)
      try {
        const played = JSON.parse(localStorage.getItem('crow_media_ab_played') || '{}');
        if (book.id) played[book.id] = { url: chapterUrl, ts: Date.now() };
        const keep = Object.entries(played).sort((x, y) => (y[1].ts || 0) - (x[1].ts || 0)).slice(0, 100);
        localStorage.setItem('crow_media_ab_played', JSON.stringify(Object.fromEntries(keep)));
      } catch(_) {}
    }
    this._closeInfoPopup();
    this._closeMABrowser(true);
    setTimeout(() => { this._updateAudiobookBadge(); }, 300);
  },

  // Forget the card's own "an audiobook / podcast is playing" flags — used
  // when something else starts so the info panel, pills and pin follow what's
  // actually playing instead of what was playing before.
  _abClearNowPlaying() {
    if (!this._abNowPlaying) return;
    this._abNowPlaying = null;
    try { localStorage.removeItem('crow_media_ab_now_playing'); } catch (_) {}
    const b = this.shadowRoot?.getElementById('audiobookBadge');
    if (b) b.style.display = 'none';
  },

  _pcClearNowPlaying() {
    if (!this._pcNowPlaying) return;
    this._pcNowPlaying = null;
    try { localStorage.removeItem('crow_media_pc_now_playing'); } catch (_) {}
    const b = this.shadowRoot?.getElementById('podcastBadge');
    if (b) b.style.display = 'none';
  },

  _abMakeRow(book, isStarred) {
    const self = this;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;position:relative;';
    const sub = [book.author, book.language, book.totaltime].filter(Boolean).join(' \u00b7 ');
    // Fallback URL construction for audiobooks pinned before artUrl was
    // stored — those snapshots still have `id` (the Archive.org identifier),
    // which is all the standard cover endpoint needs.
    const _artUrl = book.artUrl || (book.id ? ('https://archive.org/services/img/' + book.id) : '');
    const _fallbackIcon = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#FF9500;"><path d="M21,5C19.89,4.65 18.67,4.5 17.5,4.5C15.55,4.5 13.45,4.9 12,6C10.55,4.9 8.45,4.5 6.5,4.5C4.55,4.5 2.45,4.9 1,6V20.65C1,20.9 1.25,21.15 1.5,21.15C1.6,21.15 1.65,21.1 1.75,21.1C3.1,20.45 5.05,20 6.5,20C8.45,20 10.55,20.4 12,21.5C13.35,20.65 15.8,20 17.5,20C19.15,20 20.85,20.3 22.25,21.1C22.35,21.15 22.4,21.15 22.5,21.15C22.75,21.15 23,20.9 23,20.65V6C22.4,5.55 21.75,5.25 21,5M21,18.5C19.9,18.15 18.7,18 17.5,18C15.8,18 13.35,18.65 12,19.5V8C13.35,7.15 15.8,6.5 17.5,6.5C18.7,6.5 19.9,6.65 21,7V18.5Z"/></svg>';
    const artHtml = _artUrl
      ? '<img src="' + _artUrl + '" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<span style="display:none;width:40px;height:40px;align-items:center;justify-content:center;">' + _fallbackIcon + '</span>'
      : _fallbackIcon;
    row.innerHTML =
      '<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,149,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + artHtml + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;color:var(--primary-text-color,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (book.title||'Unknown') + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>' +
      '</div>';
    let _lpTimer = null, _lpFired = false;
    row.addEventListener('contextmenu', e => e.preventDefault());
    row.addEventListener('pointerdown', () => { _lpFired = false; _lpTimer = setTimeout(() => { _lpFired = true; self._showAbContextMenu(row, book); }, 480); }, { passive: true });
    row.addEventListener('pointerup',     () => clearTimeout(_lpTimer), { passive: true });
    row.addEventListener('pointercancel', () => { clearTimeout(_lpTimer); _lpFired = false; }, { passive: true });
    row.addEventListener('pointermove',   () => clearTimeout(_lpTimer), { passive: true });
    row.addEventListener('click', () => { if (_lpFired) { _lpFired = false; return; } self._showAbMoreInfo(book); });
    return this._rowSwipe(row, { menu: (h) => self._showAbContextMenu(row, book, h), right: ['more_info'], left: ['more'] });
  },

  _abRenderStarredSection() {
    const starred = this._abGetStarred();
    if (!starred.length) return null;
    const section = document.createElement('div');
    section.id = 'ab-starred-section';
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
    heading.textContent = '\ud83d\udccd Pinned Audiobooks';
    section.appendChild(heading);
    starred.forEach(book => section.appendChild(this._abMakeRow(book, true)));
    const divider = document.createElement('div');
    divider.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
    divider.textContent = 'Search Results';
    section.appendChild(divider);
    return section;
  },

  _abRefreshPinnedUI() {
    const maContent = this.shadowRoot?.getElementById('maContent');
    if (!maContent) return;
    if (this._pinnedDetailActive && this._pinnedDetailCategory === 'audiobooks') {
      this._openPinnedCategoryDetail('audiobooks');
      return;
    }
    const existing = maContent.querySelector('#ab-starred-section');
    if (this._config?.show_pins_in_sections === false) { existing?.remove(); return; }
    const newSection = this._abRenderStarredSection();
    if (existing) { if (newSection) existing.replaceWith(newSection); else existing.remove(); }
    else if (newSection) maContent.insertBefore(newSection, maContent.firstChild);
  },

  _abInjectSections(content) {
    if (!content) return;
    content.querySelector('#ab-starred-section')?.remove();
    content.querySelector('#ab-search-prompt')?.remove();
    if (this._config?.show_pins_in_sections !== false) {
      const starredSection = this._abRenderStarredSection();
      if (starredSection) content.insertBefore(starredSection, content.firstChild);
    }
    const prompt = document.createElement('div');
    prompt.id = 'ab-search-prompt';
    prompt.style.cssText = 'padding:20px 4px;text-align:center;';
    prompt.innerHTML = '<div style="font-size:13px;color:rgba(255,255,255,0.4);line-height:1.8;">Search above for free public domain audiobooks.</div>';
    content.appendChild(prompt);
  },

  _showAbContextMenu(anchor, book, headless = false) {
    const r = this.shadowRoot;
    r.querySelectorAll('.enqueue-backdrop').forEach(el => el.remove());
    r.querySelectorAll('.enqueue-menu').forEach(el => el.remove());
    const backdrop = document.createElement('div');
    backdrop.className = 'enqueue-backdrop';
    const _oa = Date.now();
    backdrop.addEventListener('pointerdown', () => { if (Date.now()-_oa < 200) return; backdrop.remove(); menu.remove(); });
    if (!headless) r.appendChild(backdrop);
    const menu = document.createElement('div');
    menu.className = 'enqueue-menu';
    const isPinned = this._abIsStarred(book);
    const strategies = [
      { mode: 'more_info', label: 'Browse Chapters',                              icon: '<path d="M8 5v14l11-7z"/>' },
      { mode: 'pin',       danger: isPinned, label: isPinned ? 'Unpin Audiobook' : 'Pin Audiobook', icon: '<path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>' },
      { mode: 'share',     label: 'Share',                                         icon: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>' },
    ];
    menu.innerHTML = strategies.map(s => '<div class="enqueue-menu-item' + (s.danger ? ' enqueue-menu-item--danger' : '') + '" data-mode="' + s.mode + '"><svg class="enqueue-menu-icon" viewBox="0 0 24 24">' + s.icon + '</svg><div class="enqueue-menu-label">' + s.label + '</div></div>').join('');
    if (!headless) r.appendChild(menu);
    const aR = anchor.getBoundingClientRect(), cR = r.host.getBoundingClientRect();
    menu.style.top = Math.min(aR.bottom - cR.top + 4, cR.height - 160) + 'px';
    menu.style.right = '12px';
    const _mOA = Date.now(), _mr = () => headless || Date.now()-_mOA > 350;
    menu.querySelectorAll('.enqueue-menu-item').forEach(el => {
      el.addEventListener('click', async e => {
        e.stopPropagation(); if (!_mr()) return;
        backdrop.remove(); menu.remove();
        if (el.dataset.mode === 'more_info') { this._showAbMoreInfo(book); }
        else if (el.dataset.mode === 'pin') {
          if (this._abIsStarred(book) && !(await this._confirmUnpin('audiobook', book.title || ''))) return;
          const nowPinned = this._abToggleStar(book);
          if (nowPinned === null) return;
          this._showToast(nowPinned ? '\ud83d\udccd Audiobook pinned' : 'Audiobook unpinned');
          this._abRefreshPinnedUI();
        } else if (el.dataset.mode === 'share') {
          const parts = [book.title];
          if (book.author) parts.push('by ' + book.author);
          if (book.url_librivox) parts.push(book.url_librivox);
          this._copyToClipboard(parts.join('\n'));
        }
      });
    });
    if (headless) return this._menuHeadless(menu);
  },

  async _showAbMoreInfo(book) {
    const r = this.shadowRoot;
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    const titleEl = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    if (titleEl) titleEl.textContent = book.title || 'Audiobook';
    this._activeInfoPanelKind = null;
    r.getElementById('queueMenuBtn')?.classList.add('hidden');
    const _abShareBtn = r.getElementById('infoShareBtn');
    if (_abShareBtn) {
      _abShareBtn.classList.remove('hidden');
      _abShareBtn.onclick = () => this._showInfoShareMenu(_abShareBtn, () => {
        const parts = [book.title];
        if (book.author) parts.push('by ' + book.author);
        if (book.url_librivox) parts.push(book.url_librivox);
        this._copyToClipboard(parts.join('\n'));
      });
    }
    r.getElementById('infoYoutubeBtn')?.classList.add('hidden');
    const _abPin = r.getElementById('infoPinBtn'), _abPinSvg = r.getElementById('infoPinSvg');
    const _updatePinBtn = () => {
      if (!_abPin || !_abPinSvg) return;
      _abPinSvg.style.fill = this._abIsStarred(book) ? '#FFD60A' : 'rgba(255,255,255,0.5)';
      _abPin.title = this._abIsStarred(book) ? 'Unpin Audiobook' : 'Pin Audiobook';
    };
    if (_abPin) {
      _abPin.classList.remove('hidden'); this._heroPinWatch(); _updatePinBtn();
      _abPin.onclick = async () => {
        if (this._abIsStarred(book) && !(await this._confirmUnpin('audiobook', book.title || ''))) return;
        const nowPinned = this._abToggleStar(book);
        if (nowPinned === null) return;
        _updatePinBtn();
        this._showToast(nowPinned ? '\ud83d\udccd Audiobook pinned' : 'Audiobook unpinned');
        this._abRefreshPinnedUI();
      };
    }
    const _pt = k => this._pt(k);
    // (books pinned before genres were cleaned up may still carry "librivox": cleaned here too)
    const _genre = this._abCleanGenres(book.genres)[0] || '';
    const metaItems = [
      book.num_sections && ['Chapters', String(book.num_sections)],
      book.totaltime    && ['Duration', book.totaltime],
      book.language     && ['Language', book.language.charAt(0).toUpperCase() + book.language.slice(1)],
      _genre            && ['Genre',  _genre],
    ].filter(Boolean);
    // the cover: LibriVox's own for every recording (books pinned before had none saved), else the book icon
    const _cover = book.artUrl || (book.id ? 'https://archive.org/services/img/' + encodeURIComponent(book.id) : '');
    const _bookIcon = '<svg viewBox="0 0 24 24" style="width:36px;height:36px;fill:#FF9500;"><path d="M21,5C19.89,4.65 18.67,4.5 17.5,4.5C15.55,4.5 13.45,4.9 12,6C10.55,4.9 8.45,4.5 6.5,4.5C4.55,4.5 2.45,4.9 1,6V20.65C1,20.9 1.25,21.15 1.5,21.15C1.6,21.15 1.65,21.1 1.75,21.1C3.1,20.45 5.05,20 6.5,20C8.45,20 10.55,20.4 12,21.5C13.35,20.65 15.8,20 17.5,20C19.15,20 20.85,20.3 22.25,21.1C22.35,21.15 22.4,21.15 22.5,21.15C22.75,21.15 23,20.9 23,20.65V6C22.4,5.55 21.75,5.25 21,5M21,18.5C19.9,18.15 18.7,18 17.5,18C15.8,18 13.35,18.65 12,19.5V8C13.35,7.15 15.8,6.5 17.5,6.5C18.7,6.5 19.9,6.65 21,7V18.5Z"/></svg>';
    // the round buttons under the top section (Pin joins them, at the end)
    const _lastUrl = this._abLastChapter(book);
    const _abtn = (id, path, label, hide) => '<button class="ma-drill-action-btn" id="' + id + '"' + (hide ? ' style="display:none"' : '') + '><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="' + path + '"/></svg></div><span class="ma-drill-btn-label">' + label + '</span></button>';
    const _webPath = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z';
    const _moon = window.CrowMediaKit?.kit?.CROW_MEDIA_FS_ICONS?.moon || 'M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09Z';
    const _actionsHtml = '<div class="ma-drill-actions" id="ab-actions" style="margin-bottom:14px;">' +
      _abtn('ab-act-play', 'M8,5.14V19.14L19,12.14L8,5.14Z', _lastUrl ? 'Continue' : 'Play') +
      _abtn('ab-act-addall', 'M2,16H10V14H2M18,14V10H16V14H12V16H16V20H18V16H22V14M14,6H2V8H14M14,10H2V12H14V10Z', 'Add All') +
      _abtn('ab-act-sleep', _moon, 'Sleep') +
      _abtn('ab-act-web', _webPath, 'LibriVox', !book.url_librivox) +
      '</div>';
    // the details (chapters, length, language, genre) as one quiet line under the author, like the rest of the top
    // section, rather than boxes
    const _metaLine = metaItems.map(([l, v]) => l === 'Chapters' ? v + ' chapter' + (v === '1' ? '' : 's') : v).join(' \u00b7 ');
    content.innerHTML =
      '<div data-hero-pin style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">' +
        '<div class="ab-cover" style="width:72px;height:72px;border-radius:12px;background:rgba(255,149,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
          (_cover ? '<img src="' + _cover + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">' : _bookIcon) +
        '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:16px;font-weight:700;color:' + _pt('text') + ';line-height:1.3;margin-bottom:4px;">' + (book.title||'') + '</div>' +
          (book.author ? '<div style="font-size:12px;color:' + _pt('dim') + ';margin-bottom:' + (_metaLine ? '3px' : '8px') + ';">' + book.author + '</div>' : '') +
          (_metaLine ? '<div style="font-size:12px;color:' + _pt('dim') + ';opacity:0.8;margin-bottom:8px;">' + _metaLine + '</div>' : '') +
        '</div>' +
      '</div>' +
      _actionsHtml +
      (book.description ? '<div style="font-size:12px;color:' + _pt('dim') + ';line-height:1.6;margin-bottom:14px;">' + book.description + '\u2026</div>' : '') +
      '<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Chapters</div>' +
      '<div id="ab-chapter-list"><div style="display:flex;align-items:center;gap:8px;padding:10px 0;opacity:0.5;"><div style="width:12px;height:12px;border:1.5px solid rgba(255,149,0,0.3);border-top-color:#FF9500;border-radius:50%;animation:ma-spin 0.8s linear infinite;flex-shrink:0;"></div><span style="font-size:12px;color:' + _pt('dim') + ';">Loading chapters\u2026</span></div></div>';
    // a cover that won't load: the book icon instead
    content.querySelector('.ab-cover img')?.addEventListener('error', e => { const box = e.target.parentNode; if (box) box.innerHTML = _bookIcon; });
    const entity = this._resolveMATargetEntity() || this._entity;
    // Play (chapter 1) or Continue (the chapter last played), Add All (every chapter, in order), Sleep, LibriVox
    let _chapters = null;
    content.querySelector('#ab-act-play')?.addEventListener('click', () => {
      if (!_chapters?.length) { this._showToast('The chapters are still loading', 1800); return; }
      const ch = (_lastUrl && _chapters.find(c => c.url === _lastUrl)) || _chapters[0];
      this._abPlayChapter(ch.url, ch.title, entity, book);
    });
    content.querySelector('#ab-act-addall')?.addEventListener('click', async () => {
      if (!_chapters?.length) { this._showToast('The chapters are still loading', 1800); return; }
      this._abRememberChapters(_chapters.map(c => c.url), book);
      await this._queueLinks(entity, _chapters.map(c => ({ url: c.url, title: c.title })), 'chapters');
    });
    content.querySelector('#ab-act-sleep')?.addEventListener('click', () => this._chooseSleepTimer());
    content.querySelector('#ab-act-web')?.addEventListener('click', () => { if (book.url_librivox) window.open(book.url_librivox, '_blank'); });
    const chList = content.querySelector('#ab-chapter-list');
    if (!book.url_rss) { if (chList) chList.innerHTML = '<div style="font-size:12px;color:' + _pt('dim') + ';padding:8px 0;">No chapter feed available.</div>'; return; }
    try {
      const chapters = await this._abFetchChapters(book.id, 50);
      _chapters = chapters;
      if (!chList || !chList.isConnected) return;
      if (!chapters.length) { chList.innerHTML = '<div style="font-size:12px;color:' + _pt('dim') + ';padding:8px 0;">No chapters found.</div>'; return; }
      chList.innerHTML = '';
      chapters.forEach(ch => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;';
        const metaHtml = ch.duration ? '<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px;">' + ch.duration + '</div>' : '';
        row.innerHTML =
          '<div style="width:22px;text-align:center;flex-shrink:0;font-size:12px;font-weight:700;color:rgba(255,255,255,0.25);">' + ch.num + '</div>' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:' + _pt('text') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ch.title + '</div>' + metaHtml + '</div>' +
          '<div style="flex-shrink:0;width:30px;height:30px;border-radius:50%;background:rgba(255,149,0,0.15);border:1px solid rgba(255,149,0,0.3);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:#FF9500;margin-left:1px;"><path d="M8 5v14l11-7z"/></svg></div>';
        // Read as one line by Export Info to PDF
        row.dataset.pdfRow = '1';
        row.dataset.pdfNum = String(ch.num ?? '');
        row.dataset.pdfTitle = String(ch.title ?? '');
        row.dataset.pdfSub = String(ch.duration ?? '');
        row.addEventListener('click', () => { this._abPlayChapter(ch.url, ch.title, entity, book); });
        chList.appendChild(row);
      });
    } catch(err) {
      if (!chList || !chList.isConnected) return;
      chList.innerHTML = '<div style="font-size:12px;color:' + _pt('dim') + ';padding:8px 0;">Sorry, this audiobook isn\u2019t available right now.</div>';
    }
  },

  // Resolves the currently-playing audiobook and opens its detail panel —
  // shared by the AUDIOBOOK pill's own click and by an artwork tap while the
  // AUDIOBOOK pill is showing (see artClick.onclick), so both entry points agree.
  async _resolveAndShowAudiobook() {
    const _cached = this._abCachedBook(this._abNowPlaying?.url);
    if (_cached) { this._showAbMoreInfo(_cached); return; }
    const _attrs = this._hass?.states[this._entity]?.attributes || {};
    const bookName = _attrs.media_album_name || _attrs.media_title || '';
    if (!bookName) { this._showToast('Search for this audiobook in the Audiobooks tab'); return; }
    const pinned = this._abGetStarred();
    const pinnedMatch = pinned.find(b => (b.title||'').toLowerCase() === bookName.toLowerCase());
    if (pinnedMatch) { this._showAbMoreInfo(pinnedMatch); return; }
    this._showLoadingToast('Looking up audiobook\u2026');
    try {
      const results = await this._abSearch(bookName);
      this._hideLoadingToast();
      const match = results.find(b => (b.title||'').toLowerCase() === bookName.toLowerCase()) || results[0];
      if (match) { this._showAbMoreInfo(match); return; }
    } catch(_) { this._hideLoadingToast(); }
    this._showToast('Audiobook not found \u2014 search for it in the Audiobooks tab');
  },

  async _showRbMoreInfo(st) {
    const r       = this.shadowRoot;
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    const titleEl = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;

    // Open the info popup
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    if (titleEl) titleEl.textContent = st.name || 'Station Info';
    const _rbo = r.getElementById('queueMenuBtn');
    if (_rbo) _rbo.classList.add('hidden');

    // HA Radio Browser stations arrive with only a name/thumbnail/media id —
    // no stream URL, homepage, codec, country, etc. HA's leaf station ids use
    // the exact same UUID scheme as radio-browser.info itself, so we can look
    // up the full record from that same public database and merge it in,
    // giving this panel everything a normal station's panel already shows.
    if (st._haMediaContentId && !st.url_resolved && !st.url) {
      const _uuid = String(st._haMediaContentId).split('/').pop();
      if (_uuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_uuid)) {
        content.innerHTML = this._psLoading('Loading station details…');
        try {
          const _rbDetailRes = await crowFetch('https://de1.api.radio-browser.info/json/stations/byuuid/' + _uuid);
          if (_rbDetailRes.ok) {
            const _rbDetailArr = await _rbDetailRes.json();
            const _real = _rbDetailArr?.[0];
            if (_real) {
              // Merge in everything except the identifiers that drive
              // playback — those must keep pointing at the HA media source,
              // not the raw stream URL, or playback would go through the
              // wrong service (see _rbStationPlayCall).
              const { _haMediaContentId, _haMediaContentType } = st;
              Object.assign(st, _real);
              st._haMediaContentId = _haMediaContentId;
              st._haMediaContentType = _haMediaContentType;
              this._rbCacheStation(st);
            }
          }
        } catch (_) {
          // Non-fatal — panel still works fine with just the name/artwork we already had.
        }
      }
    }

    // Show share button in header
    const _rbShare = r.getElementById('infoShareBtn');
    if (_rbShare) {
      _rbShare.classList.remove('hidden');
      _rbShare.onclick = () => this._showInfoShareMenu(_rbShare, () => {
        const parts = [st.name];
        if (st.homepage) parts.push(st.homepage);
        if (st.url_resolved || st.url) parts.push('Stream: ' + (st.url_resolved || st.url));
        this._copyToClipboard(parts.join('\n'));
      });
    }
    r.getElementById('infoYoutubeBtn')?.classList.add('hidden');

    // Show pin button in header
    const _rbPin = r.getElementById('infoPinBtn');
    const _rbPinSvg = r.getElementById('infoPinSvg');
    const _updatePinBtn = () => {
      if (!_rbPin || !_rbPinSvg) return;
      const _pinned = this._rbIsStarred(st);
      _rbPinSvg.style.fill = _pinned ? '#FFD60A' : 'rgba(255,255,255,0.5)';
      _rbPin.title = _pinned ? 'Unpin Station' : 'Pin Station';
    };
    if (_rbPin) {
      _rbPin.classList.remove('hidden'); this._heroPinWatch();
      _updatePinBtn();
      _rbPin.onclick = async () => {
        if (this._rbIsStarred(st) && !(await this._confirmUnpin('station', st.name || ''))) return;
        const nowPinned = this._rbToggleStar(st);
        if (nowPinned === null) return;
        _updatePinBtn();
        this._showToast(nowPinned ? '📍 Station pinned' : 'Station unpinned');
        this._rbRefreshPinnedUI();
        this._updatePinnedIndicator();
      };
    }

    const _pt = (k) => this._pt(k);

    // Build tag pills HTML
    const allTags = (st.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const tagsHtml = allTags.length ? allTags.map(tag =>
      `<button class="rb-tag-pill ip-tag" data-tag="${tag.replace(/"/g,'&quot;')}">${tag}</button>`
    ).join('') : '';

    // Country flag from countrycode
    const _flag = (cc) => {
      if (!cc || cc.length !== 2) return '';
      return cc.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397));
    };

    const faviconHtml = `<div style="width:72px;height:72px;border-radius:12px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">` +
      `<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:rgba(255,255,255,0.3)"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>` +
      (st.favicon ? `<img src="${st.favicon}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">` : '') +
      `</div>`;

    // the details as one quiet line under the country (no boxes), like the audiobook panel and the full screen view
    const _rbVotes = Number(st.votes) || 0;
    const metaLine = [
      st.codec ? st.codec + (st.bitrate ? ' ' + st.bitrate + 'kbps' : '') : '',
      st.language ? st.language.charAt(0).toUpperCase() + st.language.slice(1) : '',
      _rbVotes ? _rbVotes.toLocaleString() + (_rbVotes === 1 ? ' vote' : ' votes') : '',
    ].filter(Boolean).join(' · ');

    const streamUrl = st.url_resolved || st.url || '';
    // the station's website: a round Website button in the bar under the artwork, between Play and Pin
    const homepageHtml = st.homepage ? `
        <button class="ma-drill-action-btn rb-homepage-btn" title="${String(st.homepage).replace(/"/g, '&quot;')}"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg></div><span class="ma-drill-btn-label">Website</span></button>` : '';

    const streamHtml = streamUrl ? `
      <div style="margin-bottom:16px;">
        <div class="ip-sec">Stream URL</div>
        <button class="rb-stream-copy-btn ip-tag" style="display:flex;align-items:center;gap:8px;width:100%;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${_pt('dim')};flex-shrink:0"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          <span class="rb-stream-url-text" style="font-size:10px;color:${_pt('dim')};font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${streamUrl}</span>
        </button>
      </div>` : '';

    const _rbPlayTarget = this._resolveMATargetEntity() || this._entity;
    const _rbHasMA = !!(this._maEntityIds?.has(_rbPlayTarget) || (this._maEntityIds?.size > 0));

    content.innerHTML = `
      <div data-hero-pin style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">
        ${faviconHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:700;color:${_pt('text')};line-height:1.3;margin-bottom:4px;">${st.name || ''}</div>
          ${st.country ? `<div style="font-size:12px;color:${_pt('dim')}">${_flag(st.countrycode)} ${st.country}</div>` : ''}
          ${metaLine ? `<div style="font-size:12px;color:${_pt('dim')};opacity:0.8;margin-top:3px;">${metaLine}</div>` : ''}
        </div>
      </div>
      <div class="ma-drill-actions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn" id="rb-info-play-btn"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play</span></button>${homepageHtml}
      </div>
      ${streamHtml}
      ${tagsHtml ? `
        <div class="ip-sec">Tags</div>
        <div id="rb-tags-wrap" class="ip-tags" style="margin-bottom:16px;position:relative;">${tagsHtml}</div>` : ''}
      <div id="rb-ai-bio" style="margin-top:4px;">
        <div style="display:flex;align-items:center;gap:7px;opacity:0.5;padding:4px 0;">
          <div style="width:12px;height:12px;border:1.5px solid rgba(99,179,237,0.3);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;flex-shrink:0;"></div>
          <span style="font-size:12px;color:${_pt('dim')};">Loading station info…</span>
        </div>
      </div>`;

    // Wire Play Now button
    content.querySelector('#rb-info-play-btn')?.addEventListener('click', () => {
      const playCall = this._rbStationPlayCall(st, _rbPlayTarget);
      if (!playCall) { this._showToast('No stream URL for this station'); return; }
      this._showLoadingToast('Starting playback…');
      // Poll briefly for confirmation, then save with the real contentId —
      // saving blind before playback started (with no contentId to verify
      // against) let this station permanently masquerade as whatever plays
      // next on this entity, since a stored entry with no contentId used
      // to be trusted unconditionally.
      const _rbInfoPlayEntity = _rbPlayTarget;
      let _rbInfoPlayChecks = 0;
      const _rbInfoPlayInterval = setInterval(() => {
        _rbInfoPlayChecks++;
        const _s = this._hass?.states[_rbInfoPlayEntity]?.state;
        if (_s === 'playing') {
          clearInterval(_rbInfoPlayInterval);
          const _freshAttrs = this._hass?.states[_rbInfoPlayEntity]?.attributes || {};
          this._rbSaveLastPlayed(_rbInfoPlayEntity, st, this._rbStreamKey(_freshAttrs));
          return;
        }
        if (_rbInfoPlayChecks >= 8) clearInterval(_rbInfoPlayInterval);
      }, 500);
      // HA media-source stations always go through the core service — it
      // works on any media_player entity and doesn't need MA at all.
      if (playCall.domain === 'media_player' || _rbHasMA) {
        this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: playCall.domain, service: playCall.service,
          service_data: playCall.service_data
        }).then(() => {
          this._closeInfoPopup();
          this._closeMABrowser(true);
        }).catch(() => {
          // Only fall back to a direct-URL play for real stream URLs — an MA
          // library URI or HA media-source id isn't a playable URL on its own.
          if (!st._maUri && !st._haMediaContentId) this._playMediaDirect(_rbPlayTarget, (st.url_resolved || st.url), 'music', st.name);
          else this._showToast('\u26a0\ufe0f Could not play ' + st.name);
          this._closeInfoPopup();
          this._closeMABrowser(true);
        });
      } else {
        this._playMediaDirect(this._entity, (st.url_resolved || st.url), 'music', st.name);
        this._closeInfoPopup();
        this._closeMABrowser(true);
      }
    });

    // Wire homepage button
    content.querySelector('.rb-homepage-btn')?.addEventListener('click', () => {
      if (st.homepage) window.open(st.homepage, '_blank');
    });

    // Wire stream URL copy
    content.querySelector('.rb-stream-copy-btn')?.addEventListener('click', () => {
      this._copyToClipboard(streamUrl);
      const lbl = content.querySelector('.rb-stream-url-text');
      if (lbl) { const orig = lbl.textContent; lbl.textContent = '\u2713 Copied!'; setTimeout(() => { lbl.textContent = orig; }, 1500); }
    });

    // Wire tag pills — bottom-sheet popup style (matches content warning pills)
    const tagsWrap = content.querySelector('#rb-tags-wrap');
    if (tagsWrap) {
      if (!this._rbTagCache) this._rbTagCache = new Map();
      tagsWrap.querySelectorAll('.rb-tag-pill').forEach(pill => {
        pill.addEventListener('click', async () => {
          const tag = pill.dataset.tag;
          const _pt2 = (k) => this._pt(k);
          // Show bottom sheet immediately with spinner
          document.querySelectorAll('.crow-media-rb-tag-sheet').forEach(el => el.remove());
          const sheet = document.createElement('div');
          sheet.className = 'crow-media-rb-tag-sheet';
          sheet.style.cssText = 'position:absolute;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);left:0;top:' + window.scrollY + 'px;width:' + document.documentElement.clientWidth + 'px;height:' + window.innerHeight + 'px;';
          sheet.innerHTML = '<div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 40px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
            + '<span style="font-size:15px;font-weight:700;color:' + _pt2('text') + ';">' + tag + '</span>'
            + '<button class="crow-media-rb-tag-sheet-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + _pt2('text') + '"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>'
            + '</div>'
            + '<div class="crow-media-rb-tag-sheet-body" style="font-size:13px;color:' + _pt2('text') + ';line-height:1.6;display:flex;align-items:center;gap:8px;opacity:0.6;"><div style="width:14px;height:14px;border:2px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;flex-shrink:0;"></div>Loading…</div>'
            + '</div>';
          this._bodyAppend(sheet);
          const _closeSheet = () => sheet.remove();
          sheet.addEventListener('click', e => { if (e.target === sheet) _closeSheet(); });
          sheet.querySelector('.crow-media-rb-tag-sheet-close')?.addEventListener('click', _closeSheet);

          // Fetch description
          let desc = this._rbTagCache.get(tag);
          if (!desc) {
            const hasAI = await this._aiCheckAvailable();
            if (sheet.isConnected && hasAI) {
              const raw = await this._aiConverseQuietF('info', 'In 1-2 sentences, describe the "' + tag + '" radio/music genre or category. Be concise and factual.');
              desc = raw || 'No description available.';
              this._rbTagCache.set(tag, desc);
            } else {
              desc = 'No description available.';
            }
          }
          const bodyEl = sheet.querySelector('.crow-media-rb-tag-sheet-body');
          if (bodyEl && sheet.isConnected) bodyEl.innerHTML = desc;
        });
      });
    }

    // AI bio — lazy loaded
    const bioCacheKey = 'rbbio|' + (st.name || '').toLowerCase();
    const _bioEl = content.querySelector('#rb-ai-bio');
    let cachedBio = this._rbTagCache?.get(bioCacheKey) || this._aiLocalGet('rbBio', bioCacheKey) || this._aiSessionGet('rbBio', bioCacheKey);
    if (cachedBio) {
      if (_bioEl) _bioEl.innerHTML = '<div style="font-size:12px;color:' + _pt('dim') + ';line-height:1.6;">' + cachedBio + '</div>';
    } else {
      const hasAI = await this._aiCheckAvailable();
      if (_bioEl && _bioEl.isConnected) {
        if (hasAI) {
          const countryCtx = st.country ? ' based in ' + st.country : '';
          const tagCtx = allTags.slice(0, 3).join(', ');
          const bioProm = await this._aiConverseQuietF('info', 'In 2 sentences, describe the radio station "' + (st.name || '') + '"' + countryCtx + (tagCtx ? ' known for ' + tagCtx : '') + '. Be factual and concise — if you don\'t know this specific station, describe it based on its genre tags only.');
          if (!this._rbTagCache) this._rbTagCache = new Map();
          this._rbTagCache.set(bioCacheKey, bioProm || '');
          if (bioProm) { this._aiSessionSet('rbBio', bioCacheKey, bioProm); this._aiLocalSet('rbBio', bioCacheKey, bioProm, { ttlDays: 30, max: 200 }); }
          if (_bioEl && _bioEl.isConnected) {
            _bioEl.innerHTML = bioProm ? '<div style="font-size:12px;color:' + _pt('dim') + ';line-height:1.6;">' + bioProm + '</div>' : '';
          }
        } else {
          _bioEl.innerHTML = '';
        }
      }
    }
  },

  async _searchMA(query, libraryOnly = false) {
    if (!query) return;
    this._maLastSearch = query;
    this._maInSearchResults = true;
    const content = this.shadowRoot.getElementById('maContent');
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // Guards against overlapping searches — typing quickly (debounced call
    // pending) then pressing Enter immediately (fires a search right away)
    // can leave an older, slower-to-resolve request racing a newer one.
    // Whichever happens to finish last would otherwise win regardless of
    // which one is actually current, which was silently replacing search
    // results with a stale render (in the worst case, the default
    // unfiltered library list from an earlier empty-query state).
    this._maSearchGen = (this._maSearchGen || 0) + 1;
    const _mySearchGen = this._maSearchGen;

    // Remember which tab is active before deactivating them
    const activeTabEl = this.shadowRoot.querySelector('.ma-tab.active');
    const activeTabKey = activeTabEl ? activeTabEl.dataset.tab : (this._maCurrentTab || null);

    // Only record deliberate (Enter-triggered) searches, not the 500ms
    // live-filter debounce calls that also flow through here with
    // libraryOnly=true on every few keystrokes.
    if (!libraryOnly) this._maRecordRecentSearch(activeTabKey || 'search', query);

    // Radio tab: search radio-browser.info directly.
    if (activeTabKey === 'radio' || this._maCurrentTab === 'radio') {
      // Clear the action bar — it doesn't apply to a radio station list
      this.shadowRoot?.getElementById('maContent')?.querySelector('.ma-drill-actions')?.remove();
      // Guards against a race with other async flows (like HA browse tree
      // navigation) writing into the same #maContent — if something newer
      // has started by the time this resolves, this backs off silently
      // instead of clobbering it (or getting silently clobbered itself).
      const _myGen = _mySearchGen;
      content.innerHTML = this._psLoading('Searching radio stations…');
      try {
        // A bounded timeout guarantees this always resolves to something
        // visible (results, "no results", or this error) rather than a
        // spinner that can hang indefinitely if the request stalls.
        const _rbAbort = new AbortController();
        const _rbTimeout = setTimeout(() => _rbAbort.abort(), 12000);
        let rbRes;
        try {
          rbRes = await crowFetch('https://de1.api.radio-browser.info/json/stations/search?name=' + encodeURIComponent(query) + '&limit=30&hidebroken=true&order=votes&reverse=true', { signal: _rbAbort.signal });
        } finally {
          clearTimeout(_rbTimeout);
        }
        if (!rbRes.ok) throw new Error('HTTP ' + rbRes.status);
        const stations = await rbRes.json();
        if (this._maSearchGen !== _myGen) return;
        if (!stations?.length) {
          content.innerHTML = this._psAutoClose(this._psEmpty('M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z', 'No stations found', 'Nothing matched "' + query + '" — try a different search'), null, 8000, 'rbNoResBtn', 'rbNoResRing');
          this._psAutoCloseStart(this.shadowRoot, null, () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'radio')); this._loadMATab('radio'); }, 8000, 'rbNoResBtn', 'rbNoResRing');
          return;
        }
        this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'radio'));
        const rbEntity = this._resolveMATargetEntity() || this._entity;
        content.innerHTML = '';
        const rbList = document.createElement('div');
        rbList.style.cssText = 'display:flex;flex-direction:column;';

        const heading = document.createElement('div');
        heading.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
        heading.textContent = 'Search Results';
        rbList.appendChild(heading);

        stations.forEach(st => rbList.appendChild(this._rbMakeStationRow(st, rbEntity, false)));

        // Prepend starred section above search results
        const starredSection = this._config?.show_pins_in_sections !== false ? this._rbRenderStarredSection(rbEntity) : null;
        if (starredSection) content.appendChild(starredSection);
        content.appendChild(rbList);
        this._haRbInjectBrowseEntry(content);
      } catch(e) {
        if (this._maSearchGen !== _myGen) return;
        console.error('[Radio search] failed:', e);
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        const _isTimeout = e?.name === 'AbortError';
        const _errMsg = _isTimeout ? 'Timed out after 12s waiting for a response.' : (e?.message ? String(e.message) : '');
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">📡 Can\'t reach Radio Browser</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Radio search uses <strong>radio-browser.info</strong>. Your device can\'t reach it right now.' +
          (_errMsg ? '<br><span style="font-family:monospace;font-size:10px;opacity:0.7;">' + _errMsg.replace(/</g,'&lt;') + '</span>' : '') +
          '</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Go back';
        closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
        closeBtn.addEventListener('click', () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'radio')); this._loadMATab('radio'); });
        errDiv.appendChild(closeBtn);
        content.appendChild(errDiv);
      }
      return;
    }

    // Podcast tab: search iTunes instead of MA library
    if (activeTabKey === 'podcast' || this._maCurrentTab === 'podcast') {
      this.shadowRoot?.getElementById('maContent')?.querySelector('.ma-drill-actions')?.remove();
      content.innerHTML = this._psLoading('Searching podcasts…');
      try {
        const results = await this._pcSearch(query);
        if (this._maSearchGen !== _mySearchGen) return; // superseded by a newer search
        if (!results.length) {
          content.innerHTML = this._psAutoClose(this._psEmpty('M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z', 'No podcasts found', 'Nothing matched "' + query + '" — try a different search'), null, 8000, 'pcNoResBtn', 'pcNoResRing');
          this._psAutoCloseStart(this.shadowRoot, null, () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'podcast')); this._loadMATab('podcast'); }, 8000, 'pcNoResBtn', 'pcNoResRing');
          return;
        }
        this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'podcast'));
        content.innerHTML = '';

        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;';
        results.forEach(pod => list.appendChild(this._pcMakeRow(pod, false)));

        // Prepend starred section above search results — same pattern as radio
        const starredSection = this._config?.show_pins_in_sections !== false ? this._pcRenderStarredSection() : null;
        if (starredSection) content.appendChild(starredSection);
        content.appendChild(list);
      } catch(e) {
        if (this._maSearchGen !== _mySearchGen) return;
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">🎙 Can\'t reach iTunes</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Podcast search uses the iTunes Search API. Your device can\'t reach it right now.</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Go back';
        closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
        closeBtn.addEventListener('click', () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'podcast')); this._loadMATab('podcast'); });
        errDiv.appendChild(closeBtn);
        content.appendChild(errDiv);
      }
      return;
    }

    // Movie/TV tab: search iTunes instead of MA library
    if (activeTabKey === 'movie_tv' || this._maCurrentTab === 'movie_tv') {
      this.shadowRoot?.getElementById('maContent')?.querySelector('.ma-drill-actions')?.remove();
      content.innerHTML = this._psLoading('Searching movies & TV…');
      try {
        const results = await this._mtSearch(query);
        if (this._maSearchGen !== _mySearchGen) return; // superseded by a newer search
        if (!results.length) {
          content.innerHTML = this._psAutoClose(this._psEmpty('M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z', 'Nothing found', 'Nothing matched "' + query + '" — try a different search'), null, 8000, 'mtNoResBtn', 'mtNoResRing');
          this._psAutoCloseStart(this.shadowRoot, null, () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'movie_tv')); this._loadMATab('movie_tv'); }, 8000, 'mtNoResBtn', 'mtNoResRing');
          return;
        }
        this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'movie_tv'));
        content.innerHTML = '';

        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;';
        results.forEach(item => list.appendChild(this._mtMakeRow(item, false)));

        const starredSection = this._config?.show_pins_in_sections !== false ? this._mtRenderStarredSection() : null;
        if (starredSection) content.appendChild(starredSection);
        content.appendChild(list);
      } catch(e) {
        if (this._maSearchGen !== _mySearchGen) return;
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">🎬 iTunes search unavailable</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Movie & TV search uses the iTunes Search API, which is currently rejecting requests. This is a known issue on Apple\'s end (undocumented rate-limiting) rather than a problem with your connection — it usually resolves on its own after a few minutes.</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Go back';
        closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
        closeBtn.addEventListener('click', () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'movie_tv')); this._loadMATab('movie_tv'); });
        errDiv.appendChild(closeBtn);
        content.appendChild(errDiv);
      }
      return;
    }

    // Audiobook tab: search LibriVox instead of MA library
    if (activeTabKey === 'audiobook' || this._maCurrentTab === 'audiobook') {
      this.shadowRoot?.getElementById('maContent')?.querySelector('.ma-drill-actions')?.remove();
      content.innerHTML = this._psLoading('Searching audiobooks…');
      const _abGoBack = () => { this._maInSearchResults = false; this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'audiobook')); this._loadMATab('audiobook'); };
      try {
        const results = await this._abSearch(query);
        if (this._maSearchGen !== _mySearchGen) return; // superseded by a newer search

        // Handle "did you mean" signal from _abSearch
        if (results && results.empty) {
          const suggestedQuery = results.suggestion
            || (results.interpreted?.mode === 'both' ? (results.interpreted.titleQuery || results.interpreted.authorQuery) : null)
            || (results.interpreted?.query && results.interpreted.query.toLowerCase() !== query.toLowerCase() ? results.interpreted.query : null);
          content.innerHTML = '';
          const noRes = document.createElement('div');
          noRes.style.cssText = 'padding:16px 4px;';
          noRes.innerHTML = '<div style="font-size:14px;font-weight:600;color:var(--primary-text-color,#fff);margin-bottom:8px;">No audiobooks found</div>' +
            '<div style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:' + (suggestedQuery ? '14px' : '0') + ';">LibriVox only has public domain titles.</div>';
          if (suggestedQuery) {
            const dym = document.createElement('div');
            dym.style.cssText = 'background:rgba(255,149,0,0.08);border:1px solid rgba(255,149,0,0.25);border-radius:12px;padding:12px;';
            dym.innerHTML =
              '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px;">Did you mean…</div>' +
              '<button id="ab-dym-btn" style="font-size:14px;font-weight:600;color:#FF9500;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;-webkit-tap-highlight-color:transparent;">' + suggestedQuery + '</button>';
            noRes.appendChild(dym);
          }
          content.appendChild(noRes);
          content.querySelector('#ab-dym-btn')?.addEventListener('click', async () => {
            // Update search box to show the corrected query
            const _si = this.shadowRoot?.getElementById('maIosSearchInput') || this.shadowRoot?.getElementById('maSearchInput');
            if (_si) _si.value = suggestedQuery;
            content.innerHTML = this._psLoading('Searching audiobooks…');
            try {
              // Route through _abSearch which has validation built in
              const dymResults = await this._abSearch(suggestedQuery);
              if (!dymResults || dymResults.empty || !dymResults.length) {
                content.innerHTML = '';
                const nr = document.createElement('div');
                nr.style.cssText = 'padding:16px 4px;';
                nr.innerHTML = '<div style="font-size:14px;font-weight:600;color:var(--primary-text-color,#fff);margin-bottom:8px;">No audiobooks found</div><div style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;">LibriVox only has public domain titles.</div>';
                content.appendChild(nr);
                return;
              }
              this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'audiobook'));
              content.innerHTML = '';
              const list2 = document.createElement('div');
              list2.style.cssText = 'display:flex;flex-direction:column;';
              dymResults.forEach(book => list2.appendChild(this._abMakeRow(book, false)));
              const ss2 = this._config?.show_pins_in_sections !== false ? this._abRenderStarredSection() : null;
              if (ss2) content.appendChild(ss2);
              content.appendChild(list2);
            } catch(e) {
              content.innerHTML = '<div style="padding:16px 4px;font-size:13px;color:rgba(255,255,255,0.55);">Could not reach LibriVox. Please try again.</div>';
            }
          });
          return;
        }

        if (!results.length) {
          content.innerHTML = '';
          const noRes2 = document.createElement('div');
          noRes2.style.cssText = 'padding:16px 4px;';
          noRes2.innerHTML =
            '<div style="font-size:14px;font-weight:600;color:var(--primary-text-color,#fff);margin-bottom:8px;">No audiobooks found</div>' +
            '<div style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;">LibriVox only has public domain titles. Try a classic like Sherlock Holmes or War of the Worlds.</div>';
          content.appendChild(noRes2);
          return;
        }

        this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'audiobook'));
        content.innerHTML = '';
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;';
        results.forEach(book => list.appendChild(this._abMakeRow(book, false)));
        const starredSection = this._config?.show_pins_in_sections !== false ? this._abRenderStarredSection() : null;
        if (starredSection) content.appendChild(starredSection);
        // "Search Results" divider is baked into _abRenderStarredSection when pinned items exist
        // Add it ourselves only when there are no pinned items
        if (!starredSection) {
          const rh = document.createElement('div');
          rh.style.cssText = 'font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.6px;padding:10px 4px 6px;';
          rh.textContent = 'Search Results';
          list.insertBefore(rh, list.firstChild);
        }
        content.appendChild(list);
      } catch(e) {
        if (this._maSearchGen !== _mySearchGen) return;
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">📚 Can’t reach LibriVox</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Audiobook search uses the LibriVox API.</div>';
        content.appendChild(errDiv);
      }
      return;
    }

    content.innerHTML = this._psLoading('Searching…');
    this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.remove('active'));

    // Map tab key → MA search response key(s)
    const tabToResponseKey = { playlist: 'playlists', artist: 'artists', album: 'albums', track: 'tracks', radio: 'radio', podcast: 'podcasts', audiobook: 'audiobooks', favourites: 'tracks', recently_added: 'tracks' };
    const filterKey = activeTabKey ? (tabToResponseKey[activeTabKey] || null) : null;

    const configEntryId = await this._getMAConfigEntryId();
    if (!configEntryId) {
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = this._psAutoClose(this._psError('Music Assistant not found', 'Check that the Music Assistant integration is installed and running.'), null, 10000, 'maBrowserErrBtn', 'maBrowserErrRing');
      this._psAutoCloseStart(this.shadowRoot, null, this._closeMABrowser.bind(this), 10000, 'maBrowserErrBtn', 'maBrowserErrRing');
      return;
    }
    try {
      const _libraryOnlyTabs = new Set(['tracks', 'albums', 'artists', 'playlists', 'recently_added']);
      const msg = {
        type: 'call_service',
        domain: 'music_assistant',
        service: 'search',
        service_data: {
          config_entry_id: configEntryId,
          name: query,
          limit: filterKey === 'tracks' ? 50 : 25,
          library_only: libraryOnly && (filterKey ? _libraryOnlyTabs.has(filterKey) : false),
        },
        return_response: true
      };
      const res = await this._hass.connection.sendMessagePromise(msg);
      if (this._maSearchGen !== _mySearchGen) return;
      // MA returns results grouped by media type: { artists: [...], albums: [...], tracks: [...], ... }
      // Handle both res.response and res.response.items (newer MA versions)
      const response = res?.response?.items ? res.response : res?.response;

      // Normalise a string for matching: lowercase, strip accents, normalise apostrophes
      const _norm = (s) => (s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u02bc\u0060]/g, "'")
        .replace(/[^a-z0-9' ]/g, ' ')
        .replace(/\s+/g, ' ').trim();

      // Split query into meaningful tokens
      const _stopWords = new Set(['a','an','the','of','in','on','at','to','by','ft','feat','and','or','vs']);
      const _queryNorm = _norm(query);
      const _queryTokens = _queryNorm.split(' ').filter(t => t.length > 1);
      const _queryTokensFiltered = _queryTokens.filter(t => !_stopWords.has(t));
      const _tokens = _queryTokensFiltered.length ? _queryTokensFiltered : _queryTokens;

      // Per-type: which field to match the query against
      const _matchField = {
        tracks:   (item) => _norm(item.name || item.title || ''),
        track:    (item) => _norm(item.name || item.title || ''),
        albums:   (item) => _norm(item.name || item.title || ''),
        album:    (item) => _norm(item.name || item.title || ''),
        artists:  (item) => _norm(item.name || ''),
        artist:   (item) => _norm(item.name || ''),
        playlists:(item) => _norm(item.name || item.title || ''),
        playlist: (item) => _norm(item.name || item.title || ''),
      };

      const grouped = {};
      let _anyFiltered = false;

      if (response && typeof response === 'object') {
        Object.entries(response).forEach(([mediaType, items]) => {
          // If a tab was active, only include its result type
          if (filterKey && mediaType !== filterKey) return;
          if (Array.isArray(items) && items.length) {
            // Deduplicate — MA searches multiple providers and returns
            // duplicates. Two passes:
            // 1) Collapse exact duplicates by stable item id/uri first — the
            //    strongest possible signal, catching cases where a
            //    provider-mapping quirk returns the literal same library
            //    object twice.
            // 2) Fall back to a fuzzy title+primary-artist match for
            //    genuinely separate provider entries of the same content.
            //    This reuses the same _norm() normaliser used for query-token
            //    matching above (strips accents, normalises curly vs straight
            //    apostrophes, strips other punctuation) instead of a plain
            //    lowercase+trim — that inconsistency was the main reason
            //    near-identical duplicates from different providers weren't
            //    being caught (e.g. a curly apostrophe from one provider vs a
            //    straight one from another).
            const _seenIds = new Set();
            const _idDeduped = items.filter(item => {
              const _id = item.uri || item.item_id || item.media_content_id || null;
              if (!_id) return true; // no stable id to key on — let the fuzzy pass handle it
              if (_seenIds.has(_id)) return false;
              _seenIds.add(_id);
              return true;
            });

            const _seen = new Set();
            const _deduped = _idDeduped.filter(item => {
              const _title  = _norm(item.name || item.title || '');
              const _artist = _norm(item.artists?.[0]?.name || item.artist?.name || item.owner?.name || '');
              const _key = _title + '|' + _artist;
              if (_seen.has(_key)) return false;
              _seen.add(_key);
              return true;
            });

            // Post-filter: keep only items whose relevant field contains ALL query tokens.
            // Strips out results MA returned only because artist/album/tag matched.
            const _getField = _matchField[mediaType];
            const _filtered = _getField && _tokens.length
              ? _deduped.filter(item => {
                  const _field = _getField(item);
                  return _tokens.every(t => _field.includes(t));
                })
              : _deduped;

            if (_filtered.length < _deduped.length) _anyFiltered = true;

            // Use filtered if any survived; fall back to full deduped list so results aren't empty
            const _final = _filtered.length ? _filtered : _deduped;
            if (_final.length) {
              grouped[mediaType] = _final.map(item => Object.assign({}, item, { _tab: mediaType }));
              grouped[mediaType]._unfiltered = _deduped.map(item => Object.assign({}, item, { _tab: mediaType }));
              grouped[mediaType]._wasFiltered = _filtered.length < _deduped.length;
            }
          }
        });
      }

      const totalCount = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);
      if (!totalCount) {
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        const _stayOpenKeys = new Set(['tracks', 'albums', 'artists', 'playlists', 'recently_added']);
        if (filterKey && _stayOpenKeys.has(filterKey)) {
          // Library tabs — stay open so the user can immediately try a different query.
          this._maInSearchResults = false;
          const _noResLabel = filterKey === 'tracks' ? 'No songs found'
            : filterKey === 'albums'          ? 'No albums found'
            : filterKey === 'artists'         ? 'No artists found'
            : filterKey === 'recently_added'  ? 'No recently added songs found'
            : 'No playlists found';
          content.innerHTML = this._psEmpty(
            'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
            _noResLabel,
            'Nothing matched \u201c' + query + '\u201d \u2014 try a different search'
          );
        } else {
          content.innerHTML = this._psAutoClose(this._psEmpty('M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z', 'No results', 'Nothing matched "' + query + '" — try a different search'), null, 10000, 'maNoResBtn', 'maNoResRing');
          this._psAutoCloseStart(this.shadowRoot, null, this._closeMABrowser.bind(this), 10000, 'maNoResBtn', 'maNoResRing');
        }
        return;
      }

      // Re-highlight the active tab
      if (activeTabKey) {
        this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTabKey));
      }

      this._renderMASearchResults(grouped, content, _anyFiltered ? query : null);
    } catch(e) {
      console.error('[MA] search error:', e);
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = this._psEmpty(
        'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
        'Search unavailable',
        'Could not reach your music library. Check your Music Assistant connection and try again.'
      );
      this._maLastSearch = null; this._maInSearchResults = false; this._maErrorShowing = true;
      this._psAutoCloseStart(this.shadowRoot, null, () => { this._maErrorShowing = false; }, 10000, 'maSearchErrBtn', 'maSearchErrRing');
    }
  },

  // AI-interpreted search for the Songs/Artists/Albums library tabs — same
  // underlying idea as the standalone AI Search panel (_showAISearchPanel),
  // but scoped to one media type at a time and rendered inline in the
  // library tab itself (matching how Radio/Podcasts/Movies & TV search
  // already render inline) rather than as a separate popup.
  async _doAiLibrarySearch(tab, query) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content || !query) return;
    this._maLastSearch = query;
    this._maInSearchResults = true;
    this._maRecordRecentSearch('ai_' + tab, query);
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.querySelector('.ma-drill-actions')?.remove();

    // Shared with _searchMA — pressing Enter for a literal MA/Apple Music
    // search while an AI search is still in flight (or the reverse) should
    // cancel whichever one is now stale rather than letting both race and
    // having the slower one clobber the faster one's results.
    this._maSearchGen = (this._maSearchGen || 0) + 1;
    const _myGen = this._maSearchGen;

    const _goBack = () => {
      this._maInSearchResults = false;
      this.shadowRoot?.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      this._loadMATab(tab);
    };

    if (!this._aiLibSearchCache) this._aiLibSearchCache = new Map();
    const cacheKey = (tab + '|' + query).toLowerCase();
    if (!this._aiLibSearchCache.has(cacheKey)) {
      const _ls = this._aiLocalGet('libSearch', cacheKey);
      if (_ls) this._aiLibSearchCache.set(cacheKey, _ls);
    }
    if (!this._aiLibSearchCache.has(cacheKey)) {
      const _ss = this._aiSessionGet('libSearch', cacheKey);
      if (_ss) this._aiLibSearchCache.set(cacheKey, _ss);
    }

    let items = this._aiLibSearchCache.get(cacheKey);
    if (!items) {
      const _loadingLabel = tab === 'artist' ? 'Finding artists…' : tab === 'album' ? 'Finding albums…' : 'Finding tracks…';
      content.innerHTML = this._psLoading(_loadingLabel);

      const hasAI = await this._aiCheckAvailable();
      if (this._maSearchGen !== _myGen) return; // superseded by a newer search
      if (!hasAI) {
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">No AI Found</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Add an AI integration (for example Google Generative AI) via <strong style="color:#63b3ed">Settings → Devices &amp; Services</strong>, then choose it in the card settings.</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Go back';
        closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
        closeBtn.addEventListener('click', _goBack);
        errDiv.appendChild(closeBtn);
        content.appendChild(errDiv);
        return;
      }

      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const prompt = tab === 'artist'
        ? `You are a music search assistant. The user wants: "${query}". Suggest 18 specific artists that match this description. Be varied — mix well-known and lesser-known acts, different eras if appropriate. Respond ONLY with a JSON array: [{"name":"Artist Name","reason":"5 word max reason"}]`
        : tab === 'album'
        ? `You are a music search assistant. The user wants: "${query}". Suggest 18 specific albums (with artist) that match this description. Be varied across artists and eras. Respond ONLY with a JSON array: [{"title":"Album Title","artist":"Artist Name","reason":"5 word max reason"}]`
        : `You are a music search assistant. The user wants: "${query}". Suggest 18 specific tracks that match this description. Be varied across artists and eras. Respond ONLY with a JSON array: [{"title":"Track Title","artist":"Artist Name","reason":"5 word max reason"}]`;

      try {
        const resp = await this._aiProcess({ _crowFeature: 'discover',
          type: 'conversation/process', text: prompt,
          agent_id: agentId, language: navigator.language || 'en'
        });
        if (this._maSearchGen !== _myGen) return;
        const raw = resp?.response?.speech?.plain?.speech || '';
        const s = raw.indexOf('['), e = raw.lastIndexOf(']');
        if (s === -1 || e <= s) throw new Error('No JSON');
        items = JSON.parse(raw.slice(s, e + 1));
        if (!Array.isArray(items) || !items.length) throw new Error('Empty');
        this._aiLibSearchCache.set(cacheKey, items);
        this._aiSessionSet('libSearch', cacheKey, items);
        this._aiLocalSet('libSearch', cacheKey, items);
      } catch (err) {
        if (this._maSearchGen !== _myGen) return;
        content.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'margin:16px 4px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;';
        errDiv.innerHTML = '<div style="font-size:13px;font-weight:600;color:rgba(255,165,0,0.9);margin-bottom:6px;">🤖 AI search failed</div><div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5;">Try rephrasing your search, or check your AI conversation agent.</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Go back';
        closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:12px;font-family:inherit;cursor:pointer;';
        closeBtn.addEventListener('click', _goBack);
        errDiv.appendChild(closeBtn);
        content.appendChild(errDiv);
        return;
      }
    }

    if (this._maSearchGen !== _myGen) return;
    this._renderAiLibSearchResults(tab, query, items);
  },

  // Music info panel extras (card editor → Info Panels): an Audio Quality box when this is the
  // song playing on a Music Assistant speaker, and New Releases from this artist (MusicBrainz).
  async _fillTrackInfoExtras(content, trackTitle, artistName, reopen) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const norm = s => String(s || '').toLowerCase().replace(/\s*[(\[].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    const aqSlot = content.querySelector('#info-audio-quality');
    const nrSlot = content.querySelector('#info-new-releases');
    const st = this._hass?.states[this._entity];
    const playingThis = st && (st.state === 'playing' || st.state === 'paused') && norm(st.attributes?.media_title) === norm(trackTitle);
    if (aqSlot && this._featOn('audio_quality') && playingThis) {
      this._audioQualityNow().then(q => {
        if (!q || !aqSlot.isConnected) return;
        const wave = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;flex-shrink:0;"><path d="M22,12L20,13L19,14L18,13L17,16L16,13L15,21L14,13L13,15L12,13L11,17L10,13L9,22L8,13L7,19L6,13L5,14L4,13L2,12L4,11L5,10L6,11L7,5L8,11L9,2L10,11L11,7L12,11L13,9L14,11L15,3L16,11L17,8L18,11L19,10L20,11L22,12Z"/></svg>';
        aqSlot.innerHTML = `<div style="margin:0 0 14px;">
          <div class="ip-sec">Audio Quality</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${q.head ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:${q.hiRes ? '#FFD60A' : 'var(--crow-info-link,#63b3ed)'};">${wave}${esc(q.head)}</span>` : ''}
            <span style="font-size:12px;color:${this._pt('text')};font-weight:500;">${esc([q.detail, q.source].filter(Boolean).join(' · '))}</span>
          </div>
        </div>`;
      }).catch(() => {});
    }
    const artist = String(artistName || '').split(/\s*(?:[,;\/&]|\bfeat\.?\s|\bft\.?\s|\bfeaturing\b)\s*/i)[0].trim();
    if (!nrSlot || !this._featOn('new_releases') || !artist || /^various/i.test(artist)) return;
    const items = await this._sessionMemo('nrArtist2', artist.toLowerCase(), () => this._artistNewReleases(artist), { keep: v => Array.isArray(v) }).catch(() => null);
    // only this artist's own releases (a lookup can include collaborators' records)
    const mine = (items || []).filter(it => { const a = norm(it.artist), b = norm(artist); return a && b && (a === b || a.includes(b) || b.includes(a)); });
    if (!mine.length || !nrSlot.isConnected) return;
    const now = Date.now(), thisYear = new Date().getFullYear();
    // always with the year, so a date can't be mistaken for an old record's
    const fmt = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const shown = mine.slice(0, 6);
    nrSlot.innerHTML = `<div style="margin-top:14px;">
      <div style="font-size:10px;font-weight:700;color:${this._pt('dim')};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">New Releases</div>
      ${shown.map((it, i) => `<div class="ai-sim-wrap info-nr-wrap" data-i="${i}" style="position:relative;overflow:hidden;border-radius:10px;margin-bottom:4px;">
        <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;background:${this._pt('bg')};cursor:pointer;">
          <div style="position:relative;width:36px;height:36px;border-radius:6px;overflow:hidden;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.18);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#63b3ed;opacity:0.7"><path d="M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12,16.5C9.5,16.5 7.5,14.5 7.5,12C7.5,9.5 9.5,7.5 12,7.5C14.5,7.5 16.5,9.5 16.5,12C16.5,14.5 14.5,16.5 12,16.5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>
            ${it.art ? `<img src="${esc(it.art)}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()">` : ''}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:${this._pt('text')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</div>
            <div style="font-size:11px;color:${this._pt('dim')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([it.kind, (it.ts > now ? 'Out ' : '') + fmt(it.ts)].join(' · '))}</div>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
    // tap: the release and its songs (Back returns here); long-press: Play, Add to Queue and the rest
    nrSlot.querySelectorAll('.info-nr-wrap').forEach(wrap => {
      const it = shown[+wrap.dataset.i];
      this._rowSwipe(wrap.firstElementChild, { menu: (h) => this._showAiLibItemEnqueueMenu(wrap, 'album', it.name, it.artist, h), right: ['add', 'next'], left: ['replace', 'more'] }, wrap);
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      wrap.addEventListener('pointerdown', () => { lpFired = false; lpTimer = setTimeout(() => { cancelLP(); lpFired = true; this._showAiLibItemEnqueueMenu(wrap, 'album', it.name, it.artist); }, 480); }, { passive: true });
      wrap.addEventListener('pointerup', cancelLP, { passive: true });
      wrap.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      wrap.addEventListener('pointermove', cancelLP, { passive: true });
      wrap.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        this._showAIAlbumTracks(content, it.name, it.artist, it.art || '', reopen);
      });
    });
  },

  // An artist's genuinely new records for the music info panel: MusicBrainz release groups (albums, EPs and
  // singles, not compilations, live albums or remixes), dated by when each record FIRST came out, so a
  // 1995 album re-released on a streaming service last month doesn't count as new. Released in the last
  // year, or due out soon; newest first. [] when there's nothing new (most older bands), null if unreachable.
  async _artistNewReleases(artist) {
    const nf = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
    const lq = s => String(s).replace(/[\\"]/g, '\\$&');
    const found = await this._cdJson('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"' + lq(artist) + '"') + '&limit=8&fmt=json', { gap: 1100 });
    if (!found) return null;
    const list = (found.artists || []).filter(a => nf(a.name) === nf(artist) || (a.aliases || []).some(x => nf(x.name) === nf(artist)));
    // the best-known of the exact name matches (MusicBrainz's own score, then how much is known about them)
    const who = list.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!who?.id) return [];
    const rg = await this._cdJson('https://musicbrainz.org/ws/2/release-group?artist=' + who.id + '&type=album|ep|single&limit=100&fmt=json', { gap: 1100 });
    if (!rg) return null;
    const now = Date.now(), oldest = now - 365 * 864e5, newest = now + 120 * 864e5;
    const skip = /^(compilation|live|remix|dj-mix|mixtape\/street|demo|interview|audiobook|spokenword)$/i;
    const out = [];
    (rg['release-groups'] || []).forEach(g => {
      const d = String(g['first-release-date'] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;   // a full date is needed to call it new
      const ts = Date.parse(d + 'T12:00:00Z');
      if (!ts || ts < oldest || ts > newest) return;
      if ((g['secondary-types'] || []).some(x => skip.test(x))) return;
      const kind = g['primary-type'] === 'EP' ? 'EP' : g['primary-type'] === 'Single' ? 'Single' : 'Album';
      out.push({ name: g.title || '', artist: who.name || artist, kind, ts, art: 'https://coverartarchive.org/release-group/' + g.id + '/front-250' });
    });
    out.sort((a, b) => b.ts - a.ts);
    return out;
  },

  _renderAiLibSearchResults(tab, query, items) {
    const content = this.shadowRoot.getElementById('maContent');
    if (!content) return;
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    this.shadowRoot.querySelectorAll('.ma-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    const _label = tab === 'artist' ? 'artists' : tab === 'album' ? 'albums' : 'tracks';
    const esc = s => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    content.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.5);letter-spacing:0.6px;text-transform:uppercase;margin:6px 4px 10px;text-align:center;">
        <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:#63b3ed;vertical-align:middle;margin-right:3px"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        ${items.length} ${_label} for "${esc(query)}"
      </div>
      <div class="ma-drill-actions" id="aiLibSearchActions" style="margin-bottom:10px;">
        <button class="ma-drill-action-btn" data-action="replace"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>
        ${tab !== 'artist' && tab !== 'album' ? this._shuffleBtnHtml() : ''}
        <button class="ma-drill-action-btn" data-action="add"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add All</span></button>
        <button class="ma-drill-action-btn" data-action="next"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>
        <button class="ma-drill-action-btn" data-action="pdf" data-pdf="lists"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
      </div>
      <div id="aiLibSearchList"></div>`;

    const list = content.querySelector('#aiLibSearchList');
    const self = this;

    if (tab === 'artist') {
      items.forEach((a, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'ai-rec-wrap';
        wrap.style.cssText = 'position:relative;overflow:hidden;border-radius:12px;margin-bottom:6px;';
        wrap.innerHTML =
          `<div class="artist-radio-row" data-idx="${i}" data-artist="${esc(a.name)}"
            style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${this._pt("bg")};cursor:pointer;">
            <div class="artist-radio-art" data-art-idx="${i}"
              style="width:40px;height:40px;border-radius:50%;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#63b3ed;opacity:0.7"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
              ${a.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.reason)}</div>` : ''}
            </div>
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("dim")};flex-shrink:0"><path d="M8 5v14l11-7z"/></svg>
          </div>`;
        list.appendChild(wrap);
        setTimeout(() => {
          this._fetchWikipediaThumb(a.name).then(blobUrl => {
            if (!blobUrl) return;
            const artEl = content.querySelector(`.artist-radio-art[data-art-idx="${i}"]`);
            if (!artEl || artEl.querySelector('img')) return;
            const img = document.createElement('img');
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
            img.src = blobUrl;
            artEl.innerHTML = '';
            artEl.appendChild(img);
          });
        }, i * 700);
      });

      content.querySelectorAll('.artist-radio-row').forEach(row => {
        self._rowSwipe(row, { extra: [
          { id: 'arRadio', label: 'Radio', color: '#AF52DE', icon: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', run: () => self._playArtistRadio(row.dataset.artist) },
          { id: 'arInfo', label: 'Info', color: '#32ADE6', icon: '<svg viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg>', run: () => self._showAITrackInfo('', row.dataset.artist) },
        ], right: ['arRadio'], left: ['arInfo'] }, row.closest('.ai-rec-wrap'));
        let lpTimer = null, lpFired = false;
        const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        row.addEventListener('pointerdown', () => {
          lpFired = false;
          lpTimer = setTimeout(() => { cancelLP(); lpFired = true; self._showAITrackInfo('', row.dataset.artist); }, 480);
        }, { passive: true });
        row.addEventListener('pointerup', () => cancelLP(), { passive: true });
        row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
        row.addEventListener('pointermove', () => cancelLP(), { passive: true });
        row.addEventListener('click', () => {
          if (lpFired) { lpFired = false; return; }
          self._playArtistRadio(row.dataset.artist);
        });
      });
    } else {
      // Tracks and albums both use the same square-art list-row look already
      // established for Watch Recap / library rows.
      items.forEach((it, i) => {
        const title  = tab === 'album' ? it.title : it.title;
        const artist = it.artist || '';
        const wrap = document.createElement('div');
        wrap.className = 'ma-item-wrap';
        const el = document.createElement('div');
        el.className = 'ma-item';
        el.innerHTML =
          `<div class="ma-item-art" data-ai-lib-art-idx="${i}" style="position:relative;background:${this._pt("bg")};display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,255,255,0.35)"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z"/></svg>
          </div>
          <div class="ma-item-info"><div class="ma-item-title">${esc(title)}</div>
            <div class="ma-item-sub">${esc(artist)}</div>
            ${it.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.reason)}</div>` : ''}
          </div>`;
        wrap.appendChild(el);
        list.appendChild(wrap);

        setTimeout(() => {
          this._fetchItunesArtForTrack(artist, tab === 'album' ? '' : title).then(img => {
            if (!img) return;
            const artEl = content.querySelector(`[data-ai-lib-art-idx="${i}"]`);
            if (!artEl || artEl.querySelector('img')) return;
            artEl.innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
          });
        }, i * 700);

        wrap.addEventListener('click', () => {
          if (tab === 'album') {
            this._showAIAlbumTracks(content, title, artist, '', () => this._renderAiLibSearchResults(tab, query, items));
          } else {
            self._showAITrackInfo(title, artist, { fromSearch: true });
          }
        });

        let lpTimer = null, lpFired = false;
        const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        wrap.addEventListener('pointerdown', () => {
          lpFired = false;
          lpTimer = setTimeout(() => {
            cancelLP(); lpFired = true;
            self._showAiLibItemEnqueueMenu(wrap, tab, title, artist);
          }, 480);
        }, { passive: true });
        wrap.addEventListener('pointerup', () => cancelLP(), { passive: true });
        wrap.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
        wrap.addEventListener('pointermove', () => cancelLP(), { passive: true });
        self._rowSwipe(el, { menu: (h) => self._showAiLibItemEnqueueMenu(wrap, tab, title, artist, h), right: ['add', 'next'], left: ['replace', 'more'] }, wrap);
      });
    }

    // Play All / Add All / Play Next — same batching pattern as the AI
    // Search panel's own action bar, scoped to this tab's media type.
    const _barTarget = (() => {
      const _allMA = self._getValidMASpeakers ? self._getValidMASpeakers(true) : [];
      if (self._lastMAPlayTarget && _allMA.includes(self._lastMAPlayTarget)) return self._lastMAPlayTarget;
      if (_allMA.length) return _allMA[0];
      return self._entity;
    })();
    const _mediaType = tab === 'artist' ? 'artist' : tab === 'album' ? 'album' : 'track';
    const _mediaId = it => tab === 'artist' ? it.name : `${it.title} ${it.artist || ''}`.trim();

    content.querySelector('#aiLibSearchActions')?.querySelectorAll('.ma-drill-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (!items.length) return;
        if (action === 'shuffle') { self._crowShufflePlay(items, { target: _barTarget }); return; }
        if (action === 'pdf') {
          self._exportResultsPDF('AI Search', '"' + query + '"', items.map(it => ({ title: it.title || it.name, artist: it.artist || (it.artists || []).map(a => a?.name || a).join(', '), reason: it.reason })));
          return;
        }
        self._maBatchLoading = true;
        clearTimeout(self._maBatchLoadingTimer);
        self._maBatchLoadingTimer = setTimeout(() => { self._maBatchLoading = false; }, 20000);
        self._pillPulse(20000);
        let successCount = 0;
        if (action === 'replace') {
            (typeof self?._showLoadingToast === 'function' ? self : this)._showLoadingToast('Starting playback\u2026');
          const [first, ...rest] = items;
          try {
            await self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: { entity_id: _barTarget, media_id: _mediaId(first), media_type: _mediaType, enqueue: 'replace' }
            });
            successCount++;
          } catch (_) {}
          for (const it of rest) {
            try {
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _barTarget, media_id: _mediaId(it), media_type: _mediaType, enqueue: 'add' }
              });
              successCount++;
            } catch (_) {}
          }
          self._closeMABrowser(true);
        } else {
          const enqueueMode = action === 'next' ? 'next' : 'add';
          for (const it of items) {
            try {
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _barTarget, media_id: _mediaId(it), media_type: _mediaType, enqueue: enqueueMode }
              });
              successCount++;
            } catch (_) {}
          }
        }
        self._maBatchLoading = false;
        clearTimeout(self._maBatchLoadingTimer);
        self._pillPulse(0);
        const _spkName = self._entityDisplayName(_barTarget);
        if (successCount === 0 && action !== 'replace') {

          self._showToast('\u26a0\ufe0f Couldn\u2019t add to queue \u2014 check Music Assistant.', 4000);

        } else if (action !== 'replace') {
          const label = action === 'next' ? 'Playing next' : 'Added to queue';
          self._showToast(`${label} — ${successCount} ${_label} on ${_spkName}`, 3000);
        }
      });
    });
  },

  // Minimal Play Now / Add / Play Next menu for AI album & artist search
  // rows — the full _showEnqueueMenu expects real library items (pinning,
  // Discogs links, etc.); these are AI suggestions with no verified library
  // URI, so a lighter purpose-built menu avoids relying on data we don't have.
  _showAiLibItemEnqueueMenu(anchorEl, tab, title, artist, headless = false) {
    this._closeEnqueueMenu?.();
    const r = this.shadowRoot;
    const backdrop = document.createElement('div');
    backdrop.className = 'enqueue-backdrop';
    backdrop.id = 'enqueueBackdrop';
    const _openedAt = Date.now();
    backdrop.addEventListener('pointerdown', () => { if (Date.now() - _openedAt > 200) this._closeEnqueueMenu?.(); });
    if (!headless) r.appendChild(backdrop);

    const menu = document.createElement('div');
    menu.className = 'enqueue-menu';
    menu.id = 'enqueueMenu';
    const _mediaType = tab === 'artist' ? 'artist' : 'album';
    const _mediaId = tab === 'artist' ? title : `${title} ${artist || ''}`.trim();
    const _label = _mediaType === 'artist' ? 'Play All' : 'Play All';
    const strategies = [
      { mode: 'replace', label: _label, icon: '<path d="M8 5v14l11-7z"/>' },
      { mode: 'next',    label: 'Play Next', icon: '<path d="M3,5L8.5,8.5L3,12Z M11,7.5H21V9.5H11Z M3,14H21V16H3Z M3,18.5H21V20.5H3Z"/>' },
      { mode: 'add',      label: 'Add to Queue', icon: '<path d="M3,3.5H21V5.5H3Z M3,8H21V10H3Z M3,12L8.5,15.5L3,19Z M11,14.5H21V16.5H11Z"/>' },
    ];
    menu.innerHTML = strategies.map(s =>
      `<button class="enqueue-menu-item" data-mode="${s.mode}"><svg viewBox="0 0 24 24">${s.icon}</svg><span>${s.label}</span></button>`
    ).join('');
    if (!headless) r.appendChild(menu);

    const anchorRect = anchorEl.getBoundingClientRect();
    const cardRect = r.host.getBoundingClientRect();
    menu.style.top = (anchorRect.bottom - cardRect.top + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(anchorRect.left - cardRect.left, cardRect.width - 220)) + 'px';

    menu.querySelectorAll('.enqueue-menu-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        this._closeEnqueueMenu?.();
        const targetEntity = this._maEntityIds?.has(this._entity) ? this._entity : (this._getValidMASpeakers(true)[0] || null);
        if (!targetEntity) { this._showToast('Music Assistant required'); return; }
        if (mode === 'replace' || mode === 'play') this._showLoadingToast('Starting playback\u2026');
        try {
          await this._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: targetEntity, media_id: _mediaId, media_type: _mediaType, enqueue: mode === 'replace' ? 'replace' : mode }
          });
          if (mode === 'replace') {
            if (this.shadowRoot?.getElementById('infoPopup')?.classList.contains('visible')) this._closeInfoPopup();
            this._closeMABrowser(true);
          }
          else this._showToast(mode === 'next' ? 'Playing next' : 'Added to queue', 2500);
        } catch (_) {
          this._showToast('Could not play — check Music Assistant');
        }
      });
    });
    if (headless) return this._menuHeadless(menu);
  },

  _showTrackConfirm(trackTitle, artistName) {
    const r = this.shadowRoot;
    const overlay = r.getElementById('trackConfirm');
    if (!overlay) return;

    r.getElementById('trackConfirmTitle').textContent  = trackTitle;
    r.getElementById('trackConfirmArtist').textContent = artistName || '';

    // MA speakers = entities explicitly marked with the MA speaker toggle in the visual editor.
    const maSpeakers = Array.isArray(this._config.ma_entities) ? this._config.ma_entities : [];

    // Build the effective speaker list — prioritising the entity that is actually
    // driving the current playback so "Add to Queue" / "Play Next" target the
    // correct active queue rather than a potentially different speaker.
    // IMPORTANT: only entities already in maSpeakers are ever included — we must not
    // pull in entities from _maEntityIds (the full HA registry) as that caused
    // speakers not configured in the visual editor to appear in the picker.
    const currentIsMA = !!(this._knownMaEntities?.has(this._entity) || this._maEntityIds?.has(this._entity));
    let effectiveSpeakers;
    if (currentIsMA && maSpeakers.includes(this._entity)) {
      // Current entity is itself an explicitly configured MA speaker — put it first.
      effectiveSpeakers = [this._entity, ...maSpeakers.filter(e => e !== this._entity)];
    } else {
      // Non-MA entity (e.g. HomePod, AirPlay target): auto-detect the MA entity that
      // is driving this speaker by finding one playing the same track title —
      // but only promote it if it's already in maSpeakers.
      const currentTitle = (this._hass?.states[this._entity]?.attributes?.media_title || '').trim().toLowerCase();
      let drivingMA = null;
      if (currentTitle) {
        for (const maEid of maSpeakers) {
          const maState = this._hass?.states[maEid];
          if (!maState || maState.state !== 'playing') continue;
          const maTitle = (maState.attributes?.media_title || '').trim().toLowerCase();
          if (maTitle === currentTitle) { drivingMA = maEid; break; }
        }
      }
      effectiveSpeakers = drivingMA
        ? [drivingMA, ...maSpeakers.filter(e => e !== drivingMA)]
        : maSpeakers;
    }

    const speakerEl = r.getElementById('trackConfirmSpeaker');

    if (effectiveSpeakers.length === 0) {
      // No MA speakers found on this card — show a friendly message
      speakerEl.innerHTML = `<span class="track-confirm-speaker-name" style="color:rgba(255,165,0,0.85)">No MA speaker found</span>`;
      r.getElementById('trackConfirmBody').innerHTML = `
        <div style="font-size:12px;color:${this._pt("dim")};text-align:center;line-height:1.5;margin-bottom:14px;">
          Add a Music Assistant speaker to this card in the visual editor so tracks can be played via Music Assistant.
        </div>
        <div class="track-confirm-btns">
          <button class="track-confirm-cancel" id="trackConfirmCancel">Close</button>
        </div>`;
      r.getElementById('trackConfirmCancel').onclick = () => this._hideTrackConfirm();
      overlay.classList.add('visible');
      return;
    }

    if (effectiveSpeakers.length === 1) {
      const name = this._entityDisplayName(effectiveSpeakers[0]);
      speakerEl.innerHTML = `<span class="track-confirm-speaker-name">${name}</span>`;
    } else {
      // Multiple MA speakers available — let the user pick (current entity shown first)
      const opts = effectiveSpeakers.map(e => {
        const name = this._entityDisplayName(e);
        return `<option value="${e}">${name}</option>`;
      }).join('');
      speakerEl.innerHTML = `<select class="track-confirm-speaker-select" id="trackConfirmSpeakerSelect">${opts}</select>`;
    }

    // Reset body — show four enqueue options
    r.getElementById('trackConfirmBody').innerHTML = `
      <div class="track-confirm-enqueue-list" id="trackConfirmEnqueueList">
        <button class="track-confirm-eq-btn" data-mode="replace">
          <div class="track-confirm-eq-text"><span class="track-confirm-eq-label">Play Now</span></div>
        </button>
        <button class="track-confirm-eq-btn" data-mode="add">
          <div class="track-confirm-eq-text"><span class="track-confirm-eq-label">Add to Queue</span></div>
        </button>
        <button class="track-confirm-eq-btn" data-mode="next">
          <div class="track-confirm-eq-text"><span class="track-confirm-eq-label">Play Next</span></div>
        </button>
      </div>
      <div class="track-confirm-btns" style="margin-top:10px;">
        <button class="track-confirm-cancel" id="trackConfirmCancel">Cancel</button>
      </div>`;
    r.getElementById('trackConfirmCancel').onclick = () => this._hideTrackConfirm();
    r.getElementById('trackConfirmEnqueueList').querySelectorAll('.track-confirm-eq-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        const sel = r.getElementById('trackConfirmSpeakerSelect');
        const target = sel ? sel.value : effectiveSpeakers[0];
        this._searchAndPlayTrackViaMA(trackTitle, artistName, target, mode);
      });
    });

    overlay.classList.add('visible');
  },

  async _searchAndPlayTrackViaMA(trackTitle, artistName, targetEntityId, enqueueMode = 'replace') {
    if (enqueueMode === 'replace' || enqueueMode === 'play') this._showLoadingToast('Starting playback\u2026');
    this._pillPulse(8000); // Pulse while searching + playing
    const r = this.shadowRoot;
    const body = r.getElementById('trackConfirmBody');
    if (!body) return;

    // Show searching state
    body.innerHTML = this._psLoading('Searching Music Assistant…');

    const configEntryId = await this._getMAConfigEntryId();
    if (!configEntryId) {
      body.innerHTML = this._psAutoClose(this._psError('Music Assistant not found', 'Check that the integration is installed and running.'), null, 10000, 'tcErrBtn1', 'tcErrRing1');
      this._psAutoCloseStart(r, null, this._hideTrackConfirm.bind(this), 10000, 'tcErrBtn1', 'tcErrRing1');
      return;
    }

    try {
      const query = artistName ? `${trackTitle} ${artistName}` : trackTitle;
      const msg = {
        type: 'call_service',
        domain: 'music_assistant',
        service: 'search',
        service_data: { config_entry_id: configEntryId, name: query, media_type: 'track', limit: 10 },
        return_response: true
      };
      const res = await this._hass.connection.sendMessagePromise(msg);
      const response = res?.response || {};

      // Extract tracks from response (could be flat array or grouped object)
      let tracks = [];
      if (Array.isArray(response)) {
        tracks = response;
      } else if (Array.isArray(response.tracks)) {
        tracks = response.tracks;
      } else {
        // Search all keys for track-like items
        Object.values(response).forEach(v => {
          if (Array.isArray(v)) tracks.push(...v);
        });
      }

      // Score results: prefer exact or close title + artist match
      const norm = s => (s || '').toLowerCase().replace(/[''`]/g, "'").trim();
      const normTitle  = norm(trackTitle);
      const normArtist = norm(artistName);

      const scored = tracks.map(t => {
        const tTitle  = norm(t.name || t.title || '');
        const tArtist = norm((t.artists && t.artists[0]?.name) || (t.artist?.name) || '');
        let score = 0;
        if (tTitle === normTitle) score += 4;
        else if (tTitle.includes(normTitle) || normTitle.includes(tTitle)) score += 2;
        if (normArtist && tArtist) {
          if (tArtist === normArtist) score += 3;
          else if (tArtist.includes(normArtist) || normArtist.includes(tArtist)) score += 1;
        }
        return { t, score };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0]?.t;

      if (!best) {
        body.innerHTML = this._psAutoClose(this._psError('Track not found', `“${trackTitle}” isn't available in Music Assistant. It may not be in any of your connected sources.`), null, 10000, 'tcErrBtn2', 'tcErrRing2');
        this._psAutoCloseStart(r, null, this._hideTrackConfirm.bind(this), 10000, 'tcErrBtn2', 'tcErrRing2');
        return;
      }

      // Play the matched track on the chosen MA speaker
      const uri = best.uri || best.media_content_id;
      const playTarget = targetEntityId || this._entity;
      // Stamp play-start so auto_switch and startup-volume guards protect the
      // AirPlay/HomePod stream during its negotiation + buffering phase.
      if (enqueueMode === 'replace') this._recordMAPlayStart(playTarget);
      await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'music_assistant', service: 'play_media',
        service_data: { entity_id: playTarget, media_id: uri, media_type: 'track', enqueue: enqueueMode, ...(enqueueMode === 'replace' && this._radioModeLegacy?.() ? { radio_mode: true } : {}) }
      });

      const _autoCloseDuration = 4000;
      const _successLabel = enqueueMode === 'replace' ? 'Playing now'
        : enqueueMode === 'add' ? 'Added to queue' : 'Play Next';
      const _successBody = enqueueMode === 'replace' ? null
        : enqueueMode === 'add' ? 'Added to the end of the queue'
        : 'Added as next track';
      body.innerHTML = this._psSuccess(_successLabel, _successBody, _autoCloseDuration, 'tcRing', 'Done', 'trackConfirmDone');
      this._psSuccessStartRing(r, 'tcRing', _autoCloseDuration);

      const _doneBtn = r.getElementById('trackConfirmDone');
      const _autoCloseTimer = setTimeout(() => {
        this._hideTrackConfirm();
        this._closeInfoPopup();
      }, _autoCloseDuration);

      _doneBtn.onclick = () => {
        clearTimeout(_autoCloseTimer);
        this._hideTrackConfirm();
        this._closeInfoPopup();
      };
    } catch (err) {
      const errMsg = (err?.message || err?.error?.message || String(err)).toLowerCase();
      const friendly = errMsg.includes('no playable') || errMsg.includes('playable items')
        ? 'Nothing to play — this track may not be in your library'
        : errMsg.includes('unavailable') ? 'Speaker is unavailable'
        : 'Something went wrong playing this track';
      body.innerHTML = this._psAutoClose(this._psError(friendly), null, 10000, 'tcErrBtn3', 'tcErrRing3');
      this._psAutoCloseStart(r, null, this._hideTrackConfirm.bind(this), 10000, 'tcErrBtn3', 'tcErrRing3');
    }
  },

  // Queue panel — opened by long-pressing the prev or next button
  async _showQueuePanel(direction, _userInitiated = false) {
    const r = this.shadowRoot;
    const state = this._hass?.states[this._entity];
    if (!state) return;
    // Songs are still being added: don't show a half-built queue — unless the
    // job builds it live (vibes), in which case the queue fills in as it grows.
    if (this._queueGated()) {
      if (this._queuePanelOpen()) { this._syncQueueBuilding(); return; }
      if (_userInitiated) {
        this._queueWaiting = true;
        this._showToast('Still adding your songs \u2014 we\u2019ll let you know when they\u2019re ready.', 3500);
      }
      return;
    }
    this._activeInfoPanelKind = 'queue';
    // Hide queue building overlay in case it was left open from a previous panel
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // If the queue was just cleared, suppress any auto-refresh for 5 seconds
    if (!_userInitiated && this._queueJustCleared && (Date.now() - this._queueJustCleared) < 5000) return;

    this._queuePanelDirection = direction; // track for auto-refresh on track change
    const popup = r.getElementById('infoPopup');
    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    this._infoNavStack = [];
    popup.querySelectorAll('.info-popup-back').forEach(b => b.remove());
    r.getElementById('infoPopupTitle').textContent = 'Queue';
    const _menuBtn = r.getElementById('queueMenuBtn');
    if (_menuBtn) _menuBtn.classList.remove('hidden');
    const _qSearchRow = r.getElementById('queueSearchRow');
    const _qSearchInput = r.getElementById('queueSearchInput');
    if (_qSearchRow) { _qSearchRow.classList.remove('hidden'); }
    if (_qSearchInput) { _qSearchInput.value = ''; }
    const content = r.getElementById('infoContent');
    // Reflect the actual current reorder-mode state rather than always clearing
    // it — this function also runs as a mid-reorder refresh (after a drag
    // syncs to MA) where _queueReorderMode is still true and the visual state
    // needs to stay on, not get silently stripped out of sync with the flag.
    content.classList.toggle('queue-reorder-mode', !!this._queueReorderMode);
    r.getElementById('queueReorderDoneBtn')?.classList.toggle('hidden', !this._queueReorderMode);

    const attrs = state.attributes || {};
    const escAttr = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Full MA detection — same logic as _isMaEntity()
    const isMaByAttrs    = 'mass_player_id' in attrs || 'mass_is_group' in attrs ||
      'mass_queue_index' in attrs ||
      !!(attrs.platform && String(attrs.platform).toLowerCase().includes('music_assistant'));
    const isMaByEntityId = (this._entity || '').startsWith('media_player.mass_');
    const isMaByRegistry = this._maEntityIds !== null && this._maEntityIds?.has(this._entity);
    const isMaByConfig   = Array.isArray(this._config?.ma_entities) && this._config.ma_entities.includes(this._entity);
    const isMaByKnown    = this._knownMaEntities?.has(this._entity);
    const isMa = isMaByAttrs || isMaByEntityId || isMaByRegistry || isMaByConfig || isMaByKnown;
    content._queueIsMa = isMa;

    // ── In-memory queue cache ─────────────────────────────────────────────
    const _cacheKey  = this._entity + '|' + (attrs.media_title || '') + '|' + (attrs.media_artist || '');
    const _cached    = this._queueDataCache;
    const _cacheAge  = _cached ? (Date.now() - _cached.ts) : Infinity;
    const _cacheHit  = !!(_cached && _cached.key === _cacheKey && _cached.items?.length);

    // Preserve scroll position when this is a refresh (panel already visible)
    const _isRefresh = popup.classList.contains('visible') && content.scrollTop > 0;
    const _savedScroll = _isRefresh ? content.scrollTop : 0;

    // Skip fetch entirely if cache is fresh on auto-refresh
    if (_cacheHit && _isRefresh && _cacheAge < 8000) return;

    let queueItems = _cacheHit ? [..._cached.items] : [];

    // Show loading spinner only if no cache available
    if (!_isRefresh && !_cacheHit) content.innerHTML = this._psLoading('Loading queue…');

    try {
      if (isMa) {
        // ── Music Assistant ─────────────────────────────────────────────────────────────────
        const configEntryId = await this._getMAConfigEntryId();
        if (!configEntryId) throw new Error('MA config entry not found');

        // First choice: Music Assistant's own queue, read in pages starting just before the song playing,
        // with Music Assistant's own record of which item that is (no guessing, and no ~500-song limit)
        var _maNative = null;
        const _mqid = this._maQueueId?.(this._entity);
        if (this._maCmdOn?.() && _mqid) {
          try {
            const q = await this._maQueueGet(_mqid, { fresh: true });
            const ci = typeof q?.current_index === 'number' ? q.current_index : null;
            if (ci !== null && ci >= 0) {
              const off = Math.max(0, ci - (direction === 'prev' ? 20 : 5));
              const list = await this._maCmd('player_queues/items', { queue_id: _mqid, limit: 200, offset: off });
              if (Array.isArray(list) && list.length) {
                queueItems = list.map((it, i) => this._maItem(it, off + i, ci));
                _maNative = { qid: _mqid, next: off + list.length, total: +q.items || 0, current: ci, loading: false };
              }
            }
          } catch (_) { _maNative = null; }
        }
        const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items) && !_maNative;
        if (hasMassQueue) {
          try {
            // Request as many items as possible. MA enforces an internal server-side
            // cap (~500 items) regardless of limit_after — offset-based pagination is
            // not supported by the get_queue_items API. Items beyond the cap are still
            // in MA's queue and will play; they just can't all be fetched for display.
            const mqRes = await this._hass.connection.sendMessagePromise({
              type: 'call_service',
              domain: 'mass_queue',
              service: 'get_queue_items',
              service_data: {
                entity: this._entity,
                limit_before: direction === 'prev' ? 20 : 5,
                limit_after:  9999
              },
              return_response: true
            });
            const raw = mqRes?.response?.[this._entity] || mqRes?.response || [];
            // A real (but empty) answer replaces anything shown from the cache;
            // get_queue below then has the final say.
            if (Array.isArray(raw) && !raw.length) queueItems = [];
            if (Array.isArray(raw) && raw.length) {
              // Detect which item is currently playing.
              // Strategy 1: explicit active/state flag on the item
              let activeIdx = raw.findIndex(item => item.active === true || item.state === 'playing');
              // Strategy 2: match media_content_id from entity state
              if (activeIdx === -1) {
                const currentId = attrs.media_content_id || null;
                if (currentId) activeIdx = raw.findIndex(item =>
                  (item.media_content_id || item.uri) === currentId);
              }
              // Strategy 3: match title from entity state
              if (activeIdx === -1) {
                const currentTitle = (attrs.media_title || '').trim().toLowerCase();
                if (currentTitle) activeIdx = raw.findIndex(item =>
                  (item.media_title || item.name || '').trim().toLowerCase() === currentTitle);
              }
              // Strategy 4: with limit_before > 0, current item won't be index 0,
              // so don't assume first item — leave activeIdx as -1 if not found
              queueItems = raw.map((item, i) => ({
                title:       item.media_title      || item.name   || 'Unknown Track',
                artist:      item.media_artist     || item.artist || '',
                album:       item.media_album_name || item.album  || '',
                thumbnail:   item.media_image      || item.image  || null,
                uri:         item.media_content_id || item.uri    || null,
                active:      i === activeIdx,
                queueItemId: item.queue_item_id != null ? item.queue_item_id : null,
                queueIndex:  i,
                mediaType:   item.media_type       || null,
                duration:    item.duration         ?? null
              }));
            }
          } catch (_) { /* fall through to get_queue */ }
        }

        if (!queueItems.length) {
          const qRes = await this._hass.connection.sendMessagePromise({
            type: 'call_service',
            domain: 'music_assistant',
            service: 'get_queue',
            service_data: { entity_id: this._entity },
            return_response: true
          });
          const qData = qRes?.response?.[this._entity] || qRes?.response || null;
          const curr  = qData?.current_item;
          const next  = qData?.next_item;
          if (curr) queueItems.push({
            title:     curr.name || curr.media_item?.name || 'Current Track',
            artist:    curr.media_item?.artists?.[0]?.name || '',
            album:     curr.media_item?.album?.name || '',
            thumbnail: curr.media_item?.image || null,
            uri:       curr.media_item?.uri || null,
            active:    true,
            queueIndex: 0
          });
          // Only add next_item if it's genuinely different from current — after a
          // clear_playlist MA still echoes the playing track as next_item, which
          // causes a phantom "Coming Up" entry.
          const currUri = curr?.media_item?.uri || null;
          const nextUri = next?.media_item?.uri || null;
          if (next && nextUri && nextUri !== currUri) queueItems.push({
            title:     next.name || next.media_item?.name || 'Next Track',
            artist:    next.media_item?.artists?.[0]?.name || '',
            album:     next.media_item?.album?.name || '',
            thumbnail: next.media_item?.image || null,
            uri:       nextUri,
            active:    false,
            queueIndex: 1
          });
        }

      } else {
        // ── Non-MA (Alexa, Sonos, Chromecast, etc.) ─────────────────────────
        // Strategy 1: browse_media (standard HA queue API)
        const browseTypes = ['playlist', 'queue', 'track'];
        for (const btype of browseTypes) {
          try {
            const res = await this._hass.connection.sendMessagePromise({
              type: 'call_service',
              domain: 'media_player',
              service: 'browse_media',
              service_data: {
                entity_id: this._entity,
                media_content_type: btype,
                media_content_id: ''
              },
              return_response: true
            });
            const children = res?.response?.children || res?.response?.items || [];
            if (Array.isArray(children) && children.length) {
              const currentId = attrs.media_content_id || null;
              queueItems = children.map((item, i) => {
                const id = item.media_content_id || item.uri || null;
                return {
                  title:     item.title || item.name || 'Unknown Track',
                  artist:    item.media_artist || item.artist || attrs.media_artist || '',
                  album:     item.media_album_name || item.album || '',
                  thumbnail: item.thumbnail || item.image || null,
                  uri:       id,
                  active:    currentId ? id === currentId : i === 0,
                  queueIndex: i
                };
              });
              break;
            }
          } catch (_) { /* not supported — try next */ }
        }

        // Strategy 2: queue-related attributes (some Sonos/Spotify integrations)
        if (!queueItems.length) {
          const attrQueue = attrs.queue_items || attrs.media_queue || attrs.queue || null;
          if (Array.isArray(attrQueue) && attrQueue.length) {
            const currentId = attrs.media_content_id || null;
            queueItems = attrQueue.map((item, i) => ({
              title:     item.title || item.name || item.media_title || 'Unknown Track',
              artist:    item.artist || item.media_artist || '',
              album:     item.album  || item.media_album_name || '',
              thumbnail: item.thumbnail || item.image || null,
              uri:       item.uri || item.media_content_id || null,
              active:    currentId
                ? (item.uri === currentId || item.media_content_id === currentId)
                : i === 0,
              queueIndex: i
            }));
          }
        }

        // Strategy 3: no queue data found — look for a matching MA entity playing
        // the same track (e.g. HomePod or AirPlay target driven by Music Assistant).
        // This covers the common case where the native device entity has no queue API
        // but an MA speaker entity is the real source.
        if (!queueItems.length) {
          const currentTitle = (attrs.media_title || '').trim().toLowerCase();
          let maFallbackEntity = null;

          if (this._maEntityIds && this._maEntityIds.size) {
            for (const maEid of this._maEntityIds) {
              if (maEid === this._entity) continue;
              const maState = this._hass?.states[maEid];
              if (!maState || maState.state !== 'playing') continue;
              const maTitle = (maState.attributes?.media_title || '').trim().toLowerCase();
              if (currentTitle && maTitle && maTitle === currentTitle) {
                maFallbackEntity = maEid;
                break;
              }
            }
          }

          if (maFallbackEntity) {
            // Transparently re-run using the matched MA entity
            const savedEntity = this._entity;
            this._entity = maFallbackEntity;
            await this._showQueuePanel(direction);
            this._entity = savedEntity;
            return;
          }

          // Nothing worked — show a friendly message; no auto-close, no close button
          const deviceName = this._entityDisplayName(this._entity);
          r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          content.innerHTML = this._psEmpty('M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z', escHtml(deviceName) + " doesn't support queue browsing", "Queue browsing isn't available for this device. Use the ⋮ menu above to access Announce and other options, or switch to a Music Assistant speaker for full queue support.");
          return;
        }

        // Strategy 4: single entry from current state (lets single-track message fire correctly)
        if (!queueItems.length && (attrs.media_title || attrs.media_artist)) {
          queueItems = [{
            title:     attrs.media_title  || 'Current Track',
            artist:    attrs.media_artist || '',
            album:     attrs.media_album_name || '',
            thumbnail: attrs.entity_picture_local || attrs.entity_picture || attrs.album_art || null,
            uri:       attrs.media_content_id || null,
            active:    true,
            queueIndex: 0
          }];
        }

        // If queue is still empty, silently turn off radio mode if active
        if (!queueItems.length && attrs.shuffle) {
          try {
            await this._call('media_player', 'shuffle_set', {
              entity_id: this._entity, shuffle: false
            });
          } catch(_) {}
        }
      }

      // ── Filter out system notification clips ─────────────────────────────────────
      // Items played by automations via media-source://media_source/local/... are
      // transient sound clips. MA may transform these to HTTP paths or internal URIs
      // before storing them in the queue — catch all common forms.
      // Home Assistant's own address(es): notification sounds and TTS are served from there
      const _haHosts = new Set([location.host, (() => { try { return new URL(this._hass?.auth?.data?.hassUrl || '').host; } catch (_) { return ''; } })()].filter(Boolean).map(h => h.toLowerCase()));
      const _isSystemClip = (item) => {
        const uri   = (item.uri || '').toLowerCase();
        const title = (item.title || '').toLowerCase();

        // MA explicit announcement/alert type (now preserved from the raw item)
        const mType = (item.mediaType || '').toLowerCase();
        if (mType === 'announcement' || mType === 'alert') return true;

        // A podcast episode or an audiobook chapter is never a notification, even though it's usually a plain
        // .mp3 link (a podcast's own server, archive.org): Music Assistant's own types and addresses, and any
        // link the card played from a podcast or a book
        if (/podcast|episode|audiobook|chapter/.test(mType)) return false;
        // notifications are short: anything over a minute is real listening
        if (+item.duration > 60) return false;
        if (/^[a-z0-9_]+:\/\/(podcast(_episode)?|audiobook)\//.test(uri)) return false;
        try { if (item.uri && (this._pcCachedPod?.(item.uri) || this._abCachedBook?.(item.uri))) return false; } catch (_) {}

        // Original HA media-source paths
        if (uri.startsWith('media-source://')) return true;

        // TTS — both path-only and full HTTP URL forms
        if (uri.startsWith('tts://') || uri.includes('/tts/') || uri.includes('/api/tts_proxy/')) return true;

        // MA-transformed HTTP paths pointing to /local/ or /media/ on HA
        if (/\/local\/audio\//i.test(uri)) return true;
        if (/\/local\/sounds\//i.test(uri)) return true;
        if (/\/media\/local\//i.test(uri)) return true;

        // Raw /local/ or /media/ paths (no protocol)
        if (uri.startsWith('/local/') || uri.startsWith('/media/')) return true;

        // Full HTTP URLs pointing to local HA instance paths
        if (/https?:\/\/[^/]+(:\d+)?\/local\//i.test(uri)) return true;
        if (/https?:\/\/[^/]+(:\d+)?\/media\//i.test(uri)) return true;
        if (/https?:\/\/[^/]+(:\d+)?\/api\/tts/i.test(uri)) return true;

        // A sound file on Home Assistant itself (or with no web address at all) — that's where notification sounds
        // live. A sound file on another server (a podcast host, archive.org, a stream) is real listening.
        if (/\.(mp3|wav|ogg|flac|aac|m4a|opus)(\?|$)/i.test(uri)) {
          let host = '';
          try { host = /^https?:\/\//.test(uri) ? new URL(uri).host.toLowerCase() : ''; } catch (_) { host = ''; }
          const onHA = !host || _haHosts.has(host) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local(:\d+)?$|homeassistant/.test(host);
          const isStream = /spotify|tidal|qobuz|deezer|apple|soundcloud|youtube|tunein|radio/i.test(uri);
          if (onHA && !isStream) return true;
        }

        // Titles that look like raw filenames (underscores/hyphens, audio extension)
        if (/^[a-z0-9_\-\s]+\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(title)) return true;

        // No artist, no album, very short duration — likely a notification even if
        // none of the URI patterns matched (e.g. an external announcement URL)
        // (a length of 0 means Music Assistant doesn't know it yet, as with a podcast link: not short)
        if (!item.artist && !item.album && +item.duration > 0 && +item.duration <= 15) return true;

        return false;
      };

      // Preserve active flag when filtering so the current-track detection survives. What's playing now only counts
      // as a notification when Home Assistant agrees it's short (a minute or less, or no length): a 54-minute
      // podcast episode is never "playing a notification", whatever its queue entry looks like.
      const _nowLong = +attrs.media_duration > 60;
      const filtered = queueItems.filter(i => (i.active && _nowLong) || !_isSystemClip(i));
      const activeWasClip = queueItems.some(i => i.active) && !filtered.some(i => i.active);
      if (activeWasClip) { try { console.info('[Crow Media Player] queue: treating what\u2019s playing as a notification', queueItems.find(i => i.active), { media_duration: attrs.media_duration, media_content_id: attrs.media_content_id }); } catch (_) {} }
      if (activeWasClip) {
        // Nothing to show — current playback is a notification clip
        r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = this._psAutoClose(this._psEmpty('M7.58 4.08L6.15 2.65C3.75 4.48 2.17 7.3 2.03 10.5h2c.15-2.65 1.51-4.97 3.55-6.42zm12.39 6.42h2c-.15-3.2-1.73-6.02-4.12-7.85l-1.42 1.43c2.02 1.45 3.39 3.77 3.54 6.42zM18 11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2v-5zm-6 11c.14 0 .27-.01.4-.04.65-.14 1.18-.58 1.44-1.18.1-.24.16-.5.16-.78h-4c0 1.1.9 2 2 2z', 'Playing a notification', 'Your music queue will appear here once the notification finishes playing.'), null, 10000, 'queueNotifBtn', 'queueNotifRing');
        this._psAutoCloseStart(this.shadowRoot, null, this._closeInfoPopup.bind(this), 10000, 'queueNotifBtn', 'queueNotifRing');
        return;
      }
      queueItems = filtered;
      // Drop items the user removed this session — a fresh fetch can race the
      // server-side removal and still include them; the enqueue-menu remove
      // handler stamps ids into _removedQueueItemIds (ids rotate in MA, so
      // stale entries age out naturally; the set is capped at 50).
      if (this._removedQueueItemIds?.size) {
        queueItems = queueItems.filter(i =>
          !(i.queueItemId != null && this._removedQueueItemIds.has(String(i.queueItemId))));
      }

      // Save to in-memory cache for instant re-open and skip-if-unchanged
      this._queueDataCache = { key: _cacheKey, items: queueItems, ts: Date.now() };

      // ── Render ───────────────────────────────────────────────────────────────────────
      let currentIdx = queueItems.findIndex(i => i.active);

      // Last-resort: match on entity state title if no active flag was resolved
      if (currentIdx === -1) {
        const stateTitle = (attrs.media_title || '').trim().toLowerCase();
        if (stateTitle) currentIdx = queueItems.findIndex(i =>
          (i.title || '').trim().toLowerCase() === stateTitle);
        if (currentIdx !== -1) queueItems[currentIdx].active = true;
      }
      // If no active item was found but there's only one item, it must be the
      // currently playing track — treat it as current rather than letting it
      // fall into 'after' (which causes a phantom Coming Up entry after a clear).
      if (currentIdx === -1 && queueItems.length === 1) {
        currentIdx = 0;
        queueItems[0].active = true;
      }
      const before  = currentIdx > 0  ? queueItems.slice(0, currentIdx)  : [];
      const current = currentIdx >= 0 ? queueItems[currentIdx]            : null;
      // Also filter any items in 'after' that share the same URI as current —
      // MA sometimes echoes the playing track as the next queued item.
      const currentUri = current?.uri || null;
      const afterRaw   = currentIdx >= 0 ? queueItems.slice(currentIdx + 1) : queueItems;
      const after      = currentUri ? afterRaw.filter(i => i.uri !== currentUri) : afterRaw;

      // If only the current track remains (nothing before or after), show empty state
      if (after.length === 0 && before.length === 0) {
        content.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:12px;text-align:center;">
            <svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:rgba(255,255,255,0.15)"><path d="M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A3,3 0 0,0 13,17A3,3 0 0,0 16,20A3,3 0 0,0 19,17V8H22V6H17Z"/></svg>
            <div style="font-size:15px;font-weight:600;color:rgba(255,255,255,0.4);">Queue is empty</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.25);">Add songs to get started</div>
          </div>`;
        return;
      }

      const artSvg  = '<svg viewBox="0 0 24 24"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>';
      const playSvg = '<svg viewBox="8 5 11 14"><path d="M8 5v14l11-7z"/></svg>';

      const makeArt = (item) => {
        if (!this._itunesArtCache) this._itunesArtCache = {};
        const itunesKey = (item.artist || item.album || item.title)
          ? [item.artist, item.album || item.title].filter(Boolean).join('|').toLowerCase()
          : '';
        const cachedArt = itunesKey ? (this._itunesArtCache[itunesKey] || '') : '';
        const artSrc = item.thumbnail || cachedArt || '';
        // Always stamp data-itunes-key so _patchQueueArt can inject iTunes art
        // even when a thumbnail URL exists but fails to load in the browser.
        const keyAttr = itunesKey ? ' data-itunes-key="' + itunesKey.replace(/"/g, '&quot;') + '"' : '';
        return artSrc
          ? '<div class="queue-row-art"' + keyAttr + '><img src="' + artSrc + '" alt="" loading="lazy" oncontextmenu="return false" onerror="this.style.display=\'none\'">' + artSvg + '</div>'
          : '<div class="queue-row-art"' + keyAttr + '>' + artSvg + '</div>';
      };

      const makeRow = (item, isCurrent) => {
        const badge = isCurrent
          ? (state.state === 'playing'
              ? '<div class="queue-now-bars"><span></span><span></span><span></span></div>'
              : '')
          : '';
        const sub = [item.artist, item.album].filter(Boolean).join(' \u2022 ');
        const dq  = [item.artist, item.title].filter(Boolean).join(' ');
        const discogsBtn = dq
          ? '<button class="info-track-info-btn queue-discogs-btn" data-title="' + escAttr(item.title || '') + '" data-artist="' + escAttr(item.artist || '') + '" title="More Info" onclick="event.stopPropagation()">' +
            '<svg viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg></button>'
          : '';
        const infoSvg = '<svg viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg>';
        const trashSvg = '<svg viewBox="0 0 24 24"><path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/></svg>';
        const infoPanel = '';
        const deletePanel = '';
        return '<div class="queue-row-wrap' + (isCurrent ? ' is-current' : '') + '" style="max-height:80px;">' +
          '<div class="queue-row' + (isCurrent ? ' current-track' : '') +
          '" data-uri="' + escAttr(item.uri) +
          '" data-title="' + escAttr(item.title) +
          '" data-artist="' + escAttr(item.artist || '') +
          '" data-queue-item-id="' + escAttr(item.queueItemId || '') +
          '" data-queue-index="' + (item.queueIndex ?? '') +
          '" data-current="' + isCurrent +
          '" data-is-history="false">' +
          '<div class="queue-drag-handle" title="Drag to reorder">' +
          '<svg viewBox="0 0 24 24"><path d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V19Z"/></svg>' +
          '</div>' +
          makeArt(item) +
          '<div class="queue-row-info">' +
            '<div class="queue-row-title">' + escHtml(item.title || 'Unknown Track') + '</div>' +
            (sub ? '<div class="queue-row-sub">' + escHtml(sub) + '</div>' : '') +
          '</div>' + badge + '</div>' +
        '</div>';
      };

      // ── Build full item lists (no truncation) ─────────────────────────
      // Render in pages as the user scrolls, exactly like the Music Library tab.
      const PAGE_SIZE = 40; // items rendered per scroll batch

      let html = '';
      if (before.length) {
        html += '<div class="queue-section-label">Previous</div>';
        html += before.map(i => makeRow(i, false)
          .replace('data-is-history="false"', 'data-is-history="true"')
          .replace('class="queue-row-wrap"', 'class="queue-row-wrap is-history"')
          .replace('class="queue-row-wrap is-current"', 'class="queue-row-wrap is-history is-current"')
        ).join('');
      }
      if (current) {
        if (before.length || after.length) html += '<div class="queue-section-label">Now Playing</div>';
        html += makeRow(current, true);
      }
      if (after.length) {
        // MA's get_queue_items API caps responses at ~500 items server-side.
        const MA_CAP = 490;
        const afterTruncated = isMa && !_maNative && after.length >= MA_CAP;
        html += '<div class="queue-section-label">Coming Up</div>';
        // Render first page immediately; remaining items are loaded on scroll
        const firstPage = after.slice(0, PAGE_SIZE);
        html += firstPage.map(i => makeRow(i, false)).join('');
        if (after.length > PAGE_SIZE || (_maNative && _maNative.next < _maNative.total)) {
          html += '<div id="queueLoadMore" style="height:1px;pointer-events:none;"></div>';
        }
        if (afterTruncated) {
          html += '<div class="queue-cap-notice">' +
            '<div class="queue-cap-notice-icon"><svg viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg></div>' +
            '<div class="queue-cap-notice-text">Music Assistant limits queue previews to ~500 tracks. Your remaining songs are queued and will play \u2014 they just can\'t all be shown here at once.</div>' +
            '</div>';
        }
      }

      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = html;

      // ── Incremental DOM update for auto-refresh ──────────────────────────
      // If this was an auto-refresh and the queue structure matches what's already
      // rendered (same items, same count), just update the now-playing highlight
      // instead of replacing the entire DOM — preserves scroll, avoids flicker.
      // (Full rebuild already done above via content.innerHTML = html)
      // We do the full rebuild once then cache, subsequent same-key refreshes
      // are skipped entirely via the cache age check at the top.

      // Restore scroll position if this was a refresh (remove, track change etc)
      // Double rAF ensures rows have painted and have their heights before restoring
      if (_savedScroll > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => { content.scrollTop = _savedScroll; }));
      }
      // Music Assistant's queue already carries each song's picture, so a cover is only
      // looked up for songs without one, or when a picture fails to load.
      const _qLook = item => this._fetchItunesArt(item.artist || '', item.album || '', item.title || '', { skipStaleGuard: true });
      const _qByKey = new Map();
      queueItems.forEach(item => {
        if (!(item.artist || item.title)) return;
        _qByKey.set([item.artist, item.album || item.title].filter(Boolean).join('|').toLowerCase(), item);
        if (!item.thumbnail) _qLook(item);
      });
      this._wireQueueArtErrorHandlers(content, key => { const it = _qByKey.get(key); if (it) _qLook(it); });

      // ── Cache queue as stable URI list ──────────────────────────────────────
      // URIs are stable MA library identifiers — unlike queue_item_ids which
      // rotate as MA processes state updates. Reordering rebuilds from URIs only.
      content._queueItemsFull = { current, before, after };
      content._queueCache = {
        entity:  this._entity,
        current: current ? (current.uri || null) : null,
        before:  before.map(i => i.uri).filter(Boolean),
        after:   after.map(i => i.uri).filter(Boolean)
      };

      // ── Infinite scroll: load remaining "Coming Up" items on demand ────────
      const _maMore = () => !!(_maNative && _maNative.next < _maNative.total);
      if (after.length > PAGE_SIZE || _maMore()) {
        let rendered = Math.min(PAGE_SIZE, after.length);
        const sentinel = content.querySelector('#queueLoadMore');
        const loadMoreItems = () => {
          if (!sentinel?.isConnected) return;
          if (rendered >= after.length) {
            // the rest of Music Assistant's queue, the next page at a time
            if (_maMore() && !_maNative.loading) {
              _maNative.loading = true;
              this._maCmd('player_queues/items', { queue_id: _maNative.qid, limit: 200, offset: _maNative.next }).then(list => {
                _maNative.loading = false;
                if (!Array.isArray(list) || !list.length) { _maNative.next = _maNative.total; sentinel.remove(); return; }
                const from = _maNative.next;
                _maNative.next += list.length;
                const more = list.map((it, i) => this._maItem(it, from + i, _maNative.current)).filter(i => !_isSystemClip(i) && (!currentUri || i.uri !== currentUri));
                after.push(...more);
                content._queueCache?.after?.push(...more.map(i => i.uri).filter(Boolean));
                loadMoreItems();
              }).catch(() => { _maNative.loading = false; sentinel.remove(); });
              return;
            }
            if (!_maMore()) sentinel.remove();
            return;
          }
          const batch = after.slice(rendered, rendered + PAGE_SIZE);
          const frag  = document.createDocumentFragment();
          batch.forEach(item => {
            const tmp = document.createElement('div');
            tmp.innerHTML = makeRow(item, false);
            while (tmp.firstChild) frag.appendChild(tmp.firstChild);
          });
          sentinel.before(frag);
          rendered += batch.length;
          if (rendered >= after.length && !_maMore()) sentinel.remove();
          // still in view (a short page): carry on, as the observer only tells us when it comes into view
          requestAnimationFrame(() => {
            if (sentinel.isConnected && sentinel.getBoundingClientRect().top < content.getBoundingClientRect().bottom + 100) loadMoreItems();
          });
          // Wire up swipe/click handlers and iTunes error fallback for new rows
          wireQueueRows(content.querySelectorAll('.queue-row-wrap:not([data-wired])'));
          batch.forEach(item => {
            if (!(item.artist || item.title)) return;
            _qByKey.set([item.artist, item.album || item.title].filter(Boolean).join('|').toLowerCase(), item);
            if (!item.thumbnail) _qLook(item);
          });
          this._wireQueueArtErrorHandlers(content, key => { const it = _qByKey.get(key); if (it) _qLook(it); });
        };
        const io = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) loadMoreItems();
        }, { root: content, rootMargin: '100px' });
        io.observe(sentinel);
        // Store reference so it can be disconnected when popup closes
        content._queueScrollObserver = io;
      }

      // Block pointer-events briefly so the pointerup from the long-press
      // doesn't immediately fire a row tap.
      content.style.pointerEvents = 'none';
      setTimeout(() => { content.style.pointerEvents = ''; }, 600);

      const self = this;
      const hasMassQueueRemove = !!(self._hass?.services?.mass_queue?.remove_queue_item);

      // ── Swipe-to-remove + play-next gesture (shared function for initial + lazy rows) ──
      const wireQueueRows = (wraps) => {
        wraps.forEach(wrap => {
          if (wrap.dataset.wired) return;
          wrap.dataset.wired = '1';
          const row = wrap.querySelector('.queue-row');
          if (!row || row.dataset.current === 'true') return;

          let _lpTimer = null, _lpFired = false;
          let _startX = 0, _startY = 0, _moved = false;
          const LP_MS = 480;
          const _cancelLP = () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } };

          row.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });

          row.addEventListener('pointerdown', e => {
            if (e.target.closest('.queue-discogs-btn')) return;
            if (content.classList.contains('queue-reorder-mode')) return;
            const _qsi = self.shadowRoot?.getElementById('queueSearchInput');
            if (_qsi && document.activeElement === _qsi) _qsi.blur();
            _lpFired = false; _moved = false;
            _startX = e.clientX; _startY = e.clientY;
            _lpTimer = setTimeout(() => {
              _cancelLP(); _lpFired = true;
              const uri=row.dataset.uri, title=row.dataset.title, artist=row.dataset.artist||'', queueItemId=row.dataset.queueItemId;
              const isHistory = row.dataset.isHistory === 'true';
              if (!uri) return;
              const queueItem = { uri, media_content_id:uri, name:title, artist, media_type:'track',
                _queueItemId:queueItemId, _isHistory:isHistory, _isMa:isMa,
                _hasMassQueueRemove:hasMassQueueRemove,
                _hasMoveNext:!!(self._hass?.services?.mass_queue?.move_queue_item_next) };
              self._showQueueRowEnqueueMenu(queueItem, row, content);
            }, LP_MS);
          }, { passive: true });

          row.addEventListener('pointermove', e => {
            if (Math.abs(e.clientX - _startX) > 8 || Math.abs(e.clientY - _startY) > 8) {
              _moved = true;
              _cancelLP();
            }
          }, { passive: true });

          row.addEventListener('pointercancel', () => { _cancelLP(); _lpFired = false; _moved = true; }, { passive: true });

          row.addEventListener('touchstart', e => {
            _lpFired = false; _moved = false;
            _startX = e.touches[0].clientX; _startY = e.touches[0].clientY;
          }, { passive: true });
          row.addEventListener('touchmove', e => {
            if (Math.abs(e.touches[0].clientX - _startX) > 10 ||
                Math.abs(e.touches[0].clientY - _startY) > 10) _moved = true;
          }, { passive: true });
          row.addEventListener('touchend', e => {
            if (_lpFired || _moved) return;
            if (content.classList.contains('queue-reorder-mode')) return;
            if (e.target.closest('.queue-discogs-btn')) return;
            const title  = row.dataset.title;
            const artist = row.dataset.artist;
            const uri    = row.dataset.uri;
            if (!title && !artist) return;
            // Pass queue context so Play Now uses next+skip instead of replace
            self._showAITrackInfo(title, artist, { queueUri: uri, queueEntity: self._entity, queueItemId: row.dataset.queueItemId || '' });
          }, { passive: true });

          // swipes: right Move to Top, left Remove / More (none while reordering)
          self._rowSwipe(row, {
            menu: (h) => {
              const uri = row.dataset.uri;
              if (!uri) return null;
              const queueItem = { uri, media_content_id: uri, name: row.dataset.title, artist: row.dataset.artist || '', media_type: 'track',
                _queueItemId: row.dataset.queueItemId, _isHistory: row.dataset.isHistory === 'true', _isMa: isMa,
                _hasMassQueueRemove: hasMassQueueRemove,
                _hasMoveNext: !!(self._hass?.services?.mass_queue?.move_queue_item_next) };
              return self._showQueueRowEnqueueMenu(queueItem, row, content, h);
            },
            right: ['move_top'], left: ['replace', 'remove', 'more'],
            disabled: () => content.classList.contains('queue-reorder-mode'),
          }, wrap);
        });
      }; // end wireQueueRows


      // Wire all initially rendered rows
      wireQueueRows(content.querySelectorAll('.queue-row-wrap'));

      // ── Long-press on Now Playing (current) row ───────────────────────────
      // The current row is excluded from wireQueueRows (no swipe/drag), but it
      // should still support a long-press to open the enqueue/More Info menu.
      const _curWrap = content.querySelector('.queue-row-wrap.is-current');
      const _curRow  = _curWrap?.querySelector('.queue-row');
      if (_curRow) {
        let _curLpTimer = null, _curLpFired = false;
        _curRow.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
        _curRow.addEventListener('pointerdown', () => {

          _curLpFired = false;
          _curLpTimer = setTimeout(() => {
            _curLpTimer = null; _curLpFired = true;
            const uri         = _curRow.dataset.uri;
            const title       = _curRow.dataset.title;
            const artist      = _curRow.dataset.artist || '';
            const queueItemId = _curRow.dataset.queueItemId;
            if (!uri) return;
            const queueItem = {
              uri, media_content_id: uri, name: title, artist, media_type: 'track',
              _queueItemId: queueItemId, _isHistory: false, _isMa: isMa,
              _hasMassQueueRemove: hasMassQueueRemove,
              _hasMoveNext: !!(self._hass?.services?.mass_queue?.move_queue_item_next)
            };
            self._showQueueRowEnqueueMenu(queueItem, _curRow, content);
          }, 480);
        }, { passive: true });
        _curRow.addEventListener('pointerup',     () => { if (_curLpTimer) { clearTimeout(_curLpTimer); _curLpTimer = null; } }, { passive: true });
        _curRow.addEventListener('pointercancel', () => { if (_curLpTimer) { clearTimeout(_curLpTimer); _curLpTimer = null; } _curLpFired = false; }, { passive: true });
        _curRow.addEventListener('pointermove',   () => { if (_curLpTimer) { clearTimeout(_curLpTimer); _curLpTimer = null; } }, { passive: true });
        _curRow.addEventListener('click', e => {
          if (_curLpFired) { _curLpFired = false; e.stopPropagation(); return; }
          const title  = _curRow.dataset.title  || '';
          const artist = _curRow.dataset.artist || '';
          if (title || artist) self._showAITrackInfo(title, artist);
        });
      }

      // ── Queue search filter ───────────────────────────────────────────────
      const _filterQueue = (query) => {

        const q = (query || '').toLowerCase().trim();
        content.querySelectorAll('.queue-row-wrap').forEach(wrap => {
          if (!q) { wrap.style.display = ''; return; }
          const title  = (wrap.querySelector('.queue-row-title')?.textContent || '').toLowerCase();
          const sub    = (wrap.querySelector('.queue-row-sub')?.textContent   || '').toLowerCase();
          wrap.style.display = (title.includes(q) || sub.includes(q)) ? '' : 'none';
        });
        // Also hide section labels that have no visible rows after them
        content.querySelectorAll('.queue-section-label').forEach(label => {
          let next = label.nextElementSibling;
          let hasVisible = false;
          while (next && !next.classList.contains('queue-section-label')) {
            if (next.style.display !== 'none' && next.classList.contains('queue-row-wrap')) hasVisible = true;
            next = next.nextElementSibling;
          }
          label.style.display = hasVisible ? '' : 'none';
        });
        // Hide the MA queue cap notice while a search query is active — it's
        // irrelevant when the user is filtering and would just add visual noise
        const _capNotice = content.querySelector('.queue-cap-notice');
        if (_capNotice) _capNotice.style.display = q ? 'none' : '';
      };
      const _qsi = r.getElementById('queueSearchInput');
      const _qsc = r.getElementById('queueSearchClear');
      if (_qsi) {
        _qsi.oninput = () => {
          if (_qsc) _qsc.classList.toggle('hidden', !_qsi.value);
          _filterQueue(_qsi.value);
        };
      }
      if (_qsc) {
        _qsc.onclick = () => {
          if (_qsi) _qsi.value = '';
          _qsc.classList.add('hidden');
          _filterQueue('');
        };
      }

    } catch (e) {
      console.error('[Queue] error:', e);
      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = this._psAutoClose(this._psError('Could not load the queue', escHtml(e && e.message ? e.message : String(e))), null, 10000, 'queueErrBtn', 'queueErrRing');
      this._psAutoCloseStart(this.shadowRoot, null, this._closeInfoPopup.bind(this), 10000, 'queueErrBtn', 'queueErrRing');
    }
  },

  _showYouTubeInfo(attrs) { return this._showAppAIInfo(attrs, 'creator'); },

  async _showAppAIInfo(attrs, kind) {
    const r = this.shadowRoot, content = r?.getElementById('infoContent');
    if (!content) return;
    const app = String(attrs.app_name || '').trim() || 'the app';
    const isApp = kind === 'app';
    const title = isApp ? app : String(attrs.media_title || '').trim();
    const who = String(attrs.media_artist || attrs.media_channel || '').trim();
    const thumb = attrs.entity_picture_local || attrs.entity_picture || '';
    const titleEl = r.getElementById('infoPopupTitle');
    if (titleEl) titleEl.textContent = kind === 'personal' ? 'Info' : 'AI Info';
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const myGen = (this._ytInfoGen = (this._ytInfoGen || 0) + 1);
    const stale = () => this._ytInfoGen !== myGen || !r.getElementById('infoPopup')?.classList.contains('visible');
    const low = (app + ' ' + (attrs.app_id || '')).toLowerCase();
    // the app's colour and a search link for "Find on …"
    const brand = low.includes('youtube') ? ['#FF0033', 'YouTube', q => this._buildYoutubeUrl(q)]
      : low.includes('vimeo') ? ['#1AB7EA', 'Vimeo', q => 'https://vimeo.com/search?q=' + encodeURIComponent(q)]
      : low.includes('tiktok') ? ['#FE2C55', 'TikTok', q => 'https://www.tiktok.com/search?q=' + encodeURIComponent(q)]
      : low.includes('dailymotion') ? ['#0D0D0D', 'Dailymotion', q => 'https://www.dailymotion.com/search/' + encodeURIComponent(q)]
      : low.includes('twitch') ? ['#9146FF', 'Twitch', q => /^\w+$/.test(who) ? 'https://www.twitch.tv/' + who : 'https://www.twitch.tv/search?term=' + encodeURIComponent(q)]
      : ['#0A84FF', null, q => 'https://www.google.com/search?q=' + encodeURIComponent(q)];
    const [colour, brandName, findUrl] = brand;
    const dot = '<span style="width:10px;height:10px;border-radius:50%;background:' + colour + ';flex-shrink:0;display:inline-block;"></span>';
    const ytIcon = low.includes('youtube') ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0;"><path fill="#FF0033" d="M21.58,7.19C21.35,6.33 20.67,5.65 19.81,5.42C18.25,5 12,5 12,5C12,5 5.75,5 4.19,5.42C3.33,5.65 2.65,6.33 2.42,7.19C2,8.75 2,12 2,12C2,12 2,15.25 2.42,16.81C2.65,17.67 3.33,18.35 4.19,18.58C5.75,19 12,19 12,19C12,19 18.25,19 19.81,18.58C20.67,18.35 21.35,17.67 21.58,16.81C22,15.25 22,12 22,12C22,12 22,8.75 21.58,7.19Z"/><path fill="#fff" d="M10,15L15.2,12L10,9V15Z"/></svg>' : dot;
    const sub = isApp ? '' : (who ? who + (kind === 'creator' || kind === 'twitch' ? '' : ' · ' + app) : app);
    // The artwork spot, like a film's poster: the video's own thumbnail when the app shares one
    // (with the app's icon in the corner), otherwise the app's icon (Netflix, YouTube…) beside the
    // title. Shows a coloured letter tile until the icon arrives.
    const appName = String(attrs.app_name || '').trim();
    const _iconCached = appName ? this._appIconCache?.[appName] : null;
    const _tileBg = (() => { let h = 0; for (const ch of (appName || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360; return _iconCached ? 'transparent' : 'linear-gradient(145deg, hsl(' + h + ',62%,52%), hsl(' + ((h + 28) % 360) + ',62%,38%))'; })();
    const _iconInner = (size) => _iconCached
      ? '<img src="' + esc(_iconCached) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
      : '<span style="font-size:' + size + 'px;font-weight:700;color:#fff;">' + esc((appName || '?').charAt(0).toUpperCase()) + '</span>';
    const titleHtml = '<div style="font-size:17px;font-weight:700;line-height:1.3;color:' + this._pt('text') + ';">' + esc(title) + '</div>';
    const subHtml = sub ? '<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:' + this._pt('dim') + ';">' + ytIcon + '<span>' + esc(sub) + '</span></div>' : '';
    const hero = thumb
      ? '<div style="position:relative;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:16/9;margin-bottom:12px;box-shadow:0 6px 20px rgba(0,0,0,0.35);"><img src="' + esc(thumb) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
          + (appName ? '<div class="app-info-icon" role="button" style="cursor:pointer;-webkit-tap-highlight-color:transparent;position:absolute;left:10px;bottom:10px;width:34px;height:34px;border-radius:9px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:' + _tileBg + ';box-shadow:0 2px 10px rgba(0,0,0,0.45);">' + _iconInner(15) + '</div>' : '')
          + '</div>'
          + '<div style="margin-bottom:6px;">' + titleHtml + '</div>'
          + (subHtml ? '<div style="margin-bottom:14px;">' + subHtml + '</div>' : '<div style="height:8px;"></div>')
      : '<div class="info-hero" style="align-items:center;">'
          + '<div class="app-info-icon" role="button" style="cursor:pointer;-webkit-tap-highlight-color:transparent;width:96px;height:96px;flex-shrink:0;border-radius:22px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:' + _tileBg + ';box-shadow:0 6px 20px rgba(0,0,0,0.3);">' + _iconInner(40) + '</div>'
          + '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;">' + titleHtml + subHtml + '</div>'
        + '</div>';
    // fetch the icon once, then drop it into whichever artwork spot is showing; tapping it offers
    // to open the app's website
    const _fillIcon = () => {
      // look the website up now, so the tap can open it straight away (browsers block a window
      // opened after a wait)
      let _site = null;
      if (appName) this._appWebsite(appName).then(u => { _site = u; }).catch(() => {});
      if (appName) content.querySelectorAll('.app-info-icon').forEach(el => {
        el.onclick = async (e) => {
          e.stopPropagation();
          el.style.opacity = '0.55'; setTimeout(() => { el.style.opacity = ''; }, 140);
          const ok = await this._iosConfirm({ title: 'Open ' + appName + '?', message: 'This opens the ' + appName + ' website in your browser.', confirmLabel: 'Open', confirmFirst: true });
          if (!ok) return;
          window.open(_site || 'https://www.google.com/search?q=' + encodeURIComponent(appName + ' official website'), '_blank');
        };
      });
      if (!appName || _iconCached) return;
      this._atvAppIcon(appName).then(url => {
        if (!url || stale()) return;
        content.querySelectorAll('.app-info-icon').forEach(el => { el.style.background = 'transparent'; el.innerHTML = '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'; });
      }).catch(() => {});
    };
    // personal videos: just what's playing, no lookup (it isn't a film or show)
    if (kind === 'personal') {
      content.innerHTML = '<div data-app-ai="1" style="padding:4px 2px 16px;">' + hero + '<div style="font-size:13px;line-height:1.5;color:' + this._pt('dim') + ';">A personal video playing in ' + esc(app) + '.</div></div>';
      this._infoGlass(true);
      _fillIcon();
      return;
    }
    content.innerHTML = '<div data-app-ai="1" style="padding:4px 2px 16px;">' + hero + '<div id="ytAiBody">' + this._psLoading('Loading…') + '</div></div>';
    this._infoGlass(true);
    _fillIcon();
    // what to ask, and what to call each section, for each kind of app
    const K = {
      creator: { ask: 'A ' + (brandName || 'video') + ' video is playing. Title: "' + title + '"' + (who ? '. Channel: "' + who + '"' : '') + '.', s: 'About this video', a: 'About ' + (who || 'the channel'), aHint: 'about the channel or creator', topics: 'Topics', rel: 'You might also like', relHint: 'real videos, each {"title":"","by":"channel"}' },
      twitch: { ask: 'A Twitch stream is playing. Stream title: "' + title + '"' + (who ? '. Streamer: "' + who + '"' : '') + '.', s: 'About this stream', a: 'About ' + (who || 'the streamer'), aHint: 'about the streamer and what they are known for', topics: 'Game & category', rel: 'Similar streamers', relHint: 'real streamers, each {"title":"streamer name","by":"what they stream"}' },
      sport: { ask: 'Sport is playing in ' + app + '. Title: "' + title + '"' + (who ? ' (' + who + ')' : '') + '. Give background only: you have no live scores, results or current form.', s: 'About this event', a: 'Background', aHint: 'background on the teams or competitors (history, rivalry, notable facts), no current-season claims', topics: 'Teams & competition', rel: '', relHint: '', note: 'Background only: the AI has no live scores or this season’s form.' },
      news: { ask: 'A news channel is playing in ' + app + '. Programme: "' + title + '"' + (who ? ' (' + who + ')' : '') + '. Describe the channel and programme only. You have no live headlines, so do not mention any current events.', s: 'About this programme', a: 'About the channel', aHint: 'about the news channel, its owner and what it is known for', topics: 'Covers', rel: '', relHint: '', note: 'About the channel and programme only: the AI has no live headlines.' },
      fitness: { ask: 'A workout is playing in ' + app + '. Title: "' + title + '"' + (who ? '. Instructor or series: "' + who + '"' : '') + '.', s: 'About this workout', a: who ? 'About ' + who : 'Tips', aHint: who ? 'about the instructor or series' : 'two short tips for this kind of workout', topics: 'Works', rel: 'Try next', relHint: 'workout types or classes to try next, each {"title":"","by":"why"}' },
      podcast: { ask: 'A podcast is playing in ' + app + '. Episode: "' + title + '"' + (who ? '. Podcast or host: "' + who + '"' : '') + '.', s: 'About this episode', a: 'About ' + (who || 'the podcast'), aHint: 'about the podcast and its hosts', topics: 'Topics', rel: 'You might also like', relHint: 'real podcasts, each {"title":"podcast name","by":"host"}' },
      app: { ask: 'An app or game called "' + app + '" is open on an Apple TV.', s: 'About ' + app, a: 'Tips', aHint: 'two or three short tips for getting the most out of it', topics: 'Genre & developer', rel: null },
    }[kind] || null;
    if (!K) return;
    const key = (kind + '|' + title + '|' + who + '|' + app).toLowerCase();
    if (!this._ytAiCache) this._ytAiCache = new Map();
    let info = this._aiCachedRead(this._ytAiCache, 'appinfo', key);
    if (!info) {
      const prompt = K.ask + '\nUsing what you know (or, if you don\'t know this exact one, what the title suggests), reply ONLY with JSON (no markdown):\n'
        + '{"summary":"2-3 sentences ' + K.s.toLowerCase() + '","about":"1-3 sentences ' + K.aHint + '","category":"one or two words","category_note":"one short sentence on why","topics":[{"t":"3 to 5 short items for ' + K.topics.toLowerCase() + '","note":"one short sentence on how it relates to this"}]'
        + (K.rel ? ',"related":[up to 4 ' + K.relHint + ']' : '') + ',"known":true}\n'
        + 'Set "known" to false if you don\'t recognise this exact one and are going by the title. Never make up statistics, dates, scores or quotes.';
      try {
        const raw = await this._aiConverse(prompt, { feature: 'info' });
        const txt = String(raw || ''), i1 = txt.indexOf('{'), i2 = txt.lastIndexOf('}');
        info = JSON.parse(i1 >= 0 && i2 > i1 ? txt.slice(i1, i2 + 1) : txt);
        if (!info || typeof info !== 'object' || !info.summary) throw Object.assign(new Error('unreadable'), { kind: 'unreadable' });
        this._aiCachedWrite(this._ytAiCache, 'appinfo', key, info);
      } catch (e) {
        if (stale()) return;
        const body = r.getElementById('ytAiBody');
        if (body) this._aiShowFail(body, () => this._showAppAIInfo(attrs, kind), e?.kind || (e instanceof SyntaxError ? 'unreadable' : null));
        return;
      }
    }
    if (stale()) return;
    const body = r.getElementById('ytAiBody');
    if (!body) return;
    const label = t => '<div style="font-size:10px;font-weight:700;color:' + (this._panelIsLight ? '#1f6fb5' : 'rgba(99,179,237,0.85)') + ';letter-spacing:0.6px;text-transform:uppercase;margin:16px 0 6px;">' + esc(t) + '</div>';
    const para = t => '<div style="font-size:14px;line-height:1.55;color:' + this._pt('text') + ';">' + esc(t) + '</div>';
    // tappable pills: each shows a short note about itself in a message at the bottom of the screen
    const chip = (t, i) => '<span class="ai-pill" role="button" data-pill="' + i + '" style="font-size:13px;font-weight:500;color:' + this._pt('text') + ';cursor:pointer;-webkit-tap-highlight-color:transparent;">' + esc(t) + '</span>';
    const topics = (Array.isArray(info.topics) ? info.topics : []).filter(Boolean).slice(0, 6).map(x => typeof x === 'string' ? { t: x } : { t: x.t || x.name || '', note: x.note || '' }).filter(x => x.t);
    const pills = [{ t: info.category || '', note: info.category_note || '', cat: true }, ...topics];
    const related = K.rel ? (Array.isArray(info.related) ? info.related : []).filter(x => x && x.title).slice(0, 4) : [];
    const about = info.about || info.channel || '';
    body.innerHTML = ''
      + (info.category ? '<div style="margin-bottom:4px;">' + chip(info.category, 0) + '</div>' : '')
      + label(K.s) + para(info.summary)
      + (info.known === false ? '<div style="font-size:11px;color:' + this._pt('dim') + ';margin-top:6px;">Going by the title - the AI doesn’t know this exact one.</div>' : '')
      + (K.note ? '<div style="font-size:11px;color:' + this._pt('dim') + ';margin-top:6px;">' + esc(K.note) + '</div>' : '')
      + (about ? label(K.a) + para(about) : '')
      + (topics.length ? label(K.topics) + '<div class="ip-tags">' + topics.map((x, i) => chip(x.t, i + 1)).join('') + '</div>' : '')
      + (related.length ? label(K.rel) + related.map((v, i) => '<div class="yt-rel" data-i="' + i + '" role="button" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid ' + this._pt('div') + ';cursor:pointer;">' + ytIcon + '<div style="min-width:0;flex:1;"><div style="font-size:13px;font-weight:600;color:' + this._pt('text') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(v.title) + '</div>' + ((v.by || v.channel) ? '<div style="font-size:11px;color:' + this._pt('dim') + ';">' + esc(v.by || v.channel) + '</div>' : '') + '</div></div>').join('') : '')
      // same style as the Ask / Mood Match / Trivia buttons in the film and TV panel
      + (!brandName ? '' : '<div style="display:flex;flex-wrap:wrap;justify-content:flex-start;gap:6px 24px;margin:18px 0 8px;"><button id="ytOpenBtn" type="button" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:' + this._pt('text') + ';font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">'
        + (low.includes('youtube')
          ? '<svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path fill="#FF0033" d="M21.58,7.19C21.35,6.33 20.67,5.65 19.81,5.42C18.25,5 12,5 12,5C12,5 5.75,5 4.19,5.42C3.33,5.65 2.65,6.33 2.42,7.19C2,8.75 2,12 2,12C2,12 2,15.25 2.42,16.81C2.65,17.67 3.33,18.35 4.19,18.58C5.75,19 12,19 12,19C12,19 18.25,19 19.81,18.58C20.67,18.35 21.35,17.67 21.58,16.81C22,15.25 22,12 22,12C22,12 22,8.75 21.58,7.19Z"/><path fill="#fff" d="M10,15L15.2,12L10,9V15Z"/></svg>'
          : '<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:' + (brandName ? colour : 'rgba(99,179,237,0.8)') + ';flex-shrink:0"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>')
        + 'Find on ' + brandName + '</button></div>');
    body.querySelectorAll('.ai-pill').forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const p = pills[+el.dataset.pill];
        if (!p || !p.t) return;
        el.style.opacity = '0.55'; setTimeout(() => { el.style.opacity = ''; }, 140);
        let note = p.note;
        let sheet = null;
        if (!note) {
          // an older answer without notes: ask for one line, and keep it
          const nk = key + '|pill|' + p.t.toLowerCase();
          note = this._aiCachedRead(this._ytAiCache, 'appinfo', nk);
          if (!note) {
            sheet = this._showNoteSheet(p.t, '', { loading: true });
            try {
              const raw = await this._aiConverse('In one short sentence (under 25 words), say how "' + p.t + '" relates to "' + title + '"' + (who && !isApp ? ' by ' + who : '') + '. Reply with the sentence only.', { feature: 'info', silent: true });
              note = String(raw || '').trim().replace(/^"|"$/g, '');
              if (note) this._aiCachedWrite(this._ytAiCache, 'appinfo', nk, note);
            } catch (_) { note = ''; }
          }
          p.note = note;
        }
        const msg = note || 'No more detail on this one.';
        if (sheet) sheet.setBody(msg); else this._showNoteSheet(p.t, msg);
      };
    });
    const q = title + (who && !isApp ? ' ' + who : '');
    // leaving the card for YouTube (or Twitch…) asks first, in the same popup as elsewhere
    // (glass when Glass is on)
    const _askOpen = async (url, what) => {
      const ok = await this._iosConfirm({ title: 'Open ' + (brandName || 'the web') + '?', message: what, confirmLabel: 'Open' });
      if (ok) window.open(url, '_blank');
    };
    const _openBtn = body.querySelector('#ytOpenBtn');
    if (_openBtn) _openBtn.onclick = () => _askOpen(findUrl(q), 'This searches ' + (brandName || 'the web') + ' for \u201c' + title + '\u201d in your browser.');
    body.querySelectorAll('.yt-rel').forEach(el => { el.onclick = () => { const v = related[+el.dataset.i]; _askOpen(findUrl(v.title + (v.by && kind === 'creator' ? ' ' + v.by : '')), 'This searches ' + (brandName || 'the web') + ' for \u201c' + v.title + '\u201d in your browser.'); }; });
  },

  _switchEntity(selectedVal) {
    // Auto-disable radio mode when switching to a non-MA entity
    if (selectedVal && this._config?.ma_radio_mode) {
      const isMaNew = Array.isArray(this._config?.ma_entities) && this._config.ma_entities.includes(selectedVal);
      const isMaByKnown = this._knownMaEntities?.has(selectedVal);
      const isMaByAttr = (this._hass?.states?.[selectedVal]?.attributes?.platform || '').toLowerCase().includes('music_assistant');
      const isMaByEid = selectedVal.startsWith('media_player.mass_');
      if (!isMaNew && !isMaByKnown && !isMaByAttr && !isMaByEid) {
        this._config = { ...this._config, ma_radio_mode: false };
        try { localStorage.setItem('crow_media_radio_mode', '0'); } catch (_) {}
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...this._config } }, bubbles: true, composed: true }));
        this._updateRadioIndicator(); this._updateLiveStationBadge(); this._updatePodcastBadge(); this._updateAudiobookBadge();
      }
    }
    if (!selectedVal || selectedVal === '__multicast__') return;

    const _curGroupMembers = this._getGroupMembers();
    const _destIsMA = !!(
      (Array.isArray(this._config?.ma_entities) && this._config.ma_entities.includes(selectedVal)) ||
      this._knownMaEntities?.has(selectedVal) ||
      this._maEntityIds?.has(selectedVal)
    );
    if (_curGroupMembers?.length > 1 && _destIsMA) {
      if (_curGroupMembers.includes(selectedVal)) {
        this._entity = selectedVal;
        this._invalidateArtwork({ clearFailed: true });
        this._manualSelection = true;
        this._updateMulticastPills();
        return;
      }
      _curGroupMembers.forEach(eid => {
        const resolvedEid = this._resolveMAEntity(eid);
        const _groupAttrs = this._hass?.states[resolvedEid]?.attributes || {};
        // Skip unjoin for static group members — they can't be removed and the call throws
        if (_groupAttrs.group_members && !Array.isArray(_groupAttrs.group_members)) return;
        const _parentGroup = Object.values(this._hass?.states || {}).find(s =>
          Array.isArray(s.attributes?.group_members) &&
          s.attributes.group_members.includes(resolvedEid) &&
          s.entity_id !== resolvedEid
        );
        if (_parentGroup) return; // static member of another group — skip
        this._call('media_player', 'unjoin', { entity_id: resolvedEid }).catch(() => {});
      });
    } else if (_curGroupMembers?.length > 1 && !_destIsMA) {
      // Switching to non-MA entity (e.g. Apple TV) — leave MA group alone
    }

    this._entity = selectedVal;
    this._manualSelection = true;
    this._lastMAPlayingTime = 0;
    this._maPlayStartTime   = 0;
    this._manualSelectPlayingSet = new Set();
    for (const ent of (this._config.entities || [])) {
      const st = this._hass?.states[ent]?.state;
      if (st === 'playing' || st === 'buffering') this._manualSelectPlayingSet.add(ent);
    }
    if (this._manualSelectPlayingSet.size === 0) this._manualSelectPlayingSet = null;
    if (this._config.remember_last_entity && !this._config.auto_switch) {
      localStorage.setItem('crow_media_last_entity_' + (this._config.entities[0] || ''), this._entity);
    }
    this._lastVolume      = null;
    this._historySeeding  = false;
    this._lastSliderInput = 0;
    this._volLastFired    = null;
    this._maRootCache     = null;
    this._itunesArtCache  = {};
    if (this._volDebounce) { clearTimeout(this._volDebounce); this._volDebounce = null; }
    if (this._remoteMode) this._toggleRemote();
    this._invalidateArtwork();
  },

  // Shows the Announce panel inside the queue panel content area.
  // Lets the user type a message and choose which HA speakers to announce on
  // using the configured TTS service.
  _showAnnouncePanel() {
    const r = this.shadowRoot;
    let infoContent = r.getElementById('infoContent');
    if (!infoContent) return;
    const self = this;

    const _qsr = r.getElementById('queueSearchRow');
    if (_qsr) _qsr.classList.add('hidden');
    const _savedQueueDir = this._queuePanelDirection;
    this._queuePanelDirection = null;

    const allPlayers = Object.entries(this._hass.states)
      .filter(([eid, s]) => {
        const name = (s.attributes?.friendly_name || '').toLowerCase();
        if (!eid.startsWith('media_player.')) return false;
        if (s.state === 'unavailable' || s.state === 'unknown') return false;
        if (!s.attributes?.friendly_name) return false;
        if (name === 'this device' || eid.includes('this_device')) return false;
        if (s.attributes?.device_class === 'tv') return false;
        if (eid.includes('_tv') || eid.includes('apple_tv') || eid.includes('samsung_tv') ||
            eid.includes('lg_tv') || eid.includes('shield') || eid.includes('fire_tv') ||
            eid.includes('playstation') || eid.includes('xbox') || eid.includes('roku')) return false;
        return true;
      })
      .sort((a, b) => this._entityDisplayName(a[0]).localeCompare(this._entityDisplayName(b[0])));

    // Resolve TTS from config (set in visual editor) or auto-detect from HA services
    const _resolveTTS = () => {
      const saved = this._config?.announce_tts_service;
      if (saved) {
        const [domain, service] = String(saved).includes('|') ? String(saved).split('|') : String(saved).split('.');
        // only while Home Assistant still has it; otherwise auto-detect below
        if (domain && service && this._hass?.services?.[domain]?.[service]) return { domain, service, label: domain + '.' + service };
      }
      // Auto-detect: prefer tts.speak, then first available
      const ttsDomain = this._hass?.services?.tts;
      if (!ttsDomain) return null;
      if (ttsDomain.speak) return { domain: 'tts', service: 'speak', label: 'tts.speak' };
      const first = Object.keys(ttsDomain).find(s => s !== 'clear_cache' && s !== 'reload');
      return first ? { domain: 'tts', service: first, label: 'tts.' + first } : null;
    };
    const selectedTTS = _resolveTTS();

    const selectedSpeakers = new Set();
    const announceVolumes  = {};
    const modifiedVolumes  = new Set(); // tracks which speakers had volume explicitly changed
    let _speakerFilter = '';
    let _areaMap = {};

    // ── Announcement history (localStorage) ─────────────────────────
    const HIST_KEY = 'crow_media_announce_history';
    const _loadHistory = () => {
      try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (_) { return []; }
    };
    const _saveHistory = (hist) => {
      try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (_) {}
    };
    const _addToHistory = (text) => {
      let hist = _loadHistory();
      // Remove duplicates (same text, case-insensitive)
      const existing = hist.find(h => h.text.toLowerCase() === text.toLowerCase());
      const fav = existing?.favourite || false;
      hist = hist.filter(h => h.text.toLowerCase() !== text.toLowerCase());
      hist.unshift({ text, favourite: fav, ts: Date.now() });
      // Keep max 10 non-favourite + all favourites
      const favs = hist.filter(h => h.favourite);
      const recents = hist.filter(h => !h.favourite).slice(0, 10);
      _saveHistory([...favs, ...recents]);
    };
    const _toggleFavourite = (text) => {
      const hist = _loadHistory();
      const item = hist.find(h => h.text === text);
      if (item) { item.favourite = !item.favourite; _saveHistory(hist); }
      return item?.favourite ?? false;
    };

    const _loadAreas = async () => {
      try {
        const [entities, devices, areas] = await Promise.all([
          this._getEntityRegistry(),
          this._getDeviceRegistry(),
          this._getAreaRegistry()
        ]);
        const areaById = {};
        areas.forEach(a => { areaById[a.area_id] = a.name; });
        const devAreaById = {};
        devices.forEach(d => { if (d.id && d.area_id && areaById[d.area_id]) devAreaById[d.id] = areaById[d.area_id]; });
        entities.forEach(e => {
          if (!e.entity_id) return;
          const n = (e.area_id && areaById[e.area_id]) ? areaById[e.area_id]
            : (e.device_id && devAreaById[e.device_id]) ? devAreaById[e.device_id] : null;
          if (n) _areaMap[e.entity_id] = n;
        });
        _renderSpeakerList();
      } catch (_) {}
    };

    const _getCurrentVol = (eid) => {
      const v = this._hass?.states[eid]?.attributes?.volume_level;
      return v != null ? Math.round(v * 100) : null;
    };

    const _getSpeakers = () => allPlayers.filter(([eid, s]) => {
      if (!_speakerFilter) return true;
      // Match against the display name (what the row actually shows), the
      // real HA friendly name, and the area — a user may reasonably type
      // any of the three, e.g. an alias like "Bathroom" or the underlying
      // "Downstairs Bathroom HomePod".
      const f = _speakerFilter.toLowerCase();
      const n = (s.attributes.friendly_name || eid).toLowerCase();
      const d = this._entityDisplayName(eid).toLowerCase();
      const a = (_areaMap[eid] || '').toLowerCase();
      return n.includes(f) || d.includes(f) || a.includes(f);
    });

    const _groupByArea = (players) => {
      const groups = {};
      players.forEach(([eid, s]) => {
        const a = _areaMap[eid] || '';
        if (!groups[a]) groups[a] = [];
        groups[a].push([eid, s]);
      });
      const named = Object.keys(groups).filter(a => a).sort();
      if (groups['']) named.push('');
      return named.map(area => ({ area: area || 'Other', players: groups[area] }));
    };

    const _updateSendBtn = () => {
      const btn = infoContent.querySelector('#ann-send');
      if (!btn) return;
      const active = selectedSpeakers.size > 0;
      btn.style.background = active ? '#007AFF' : 'rgba(255,255,255,0.12)';
      btn.style.cursor = active ? 'pointer' : 'default';
      const svg = btn.querySelector('svg');
      if (svg) svg.style.fill = active ? '#fff' : 'rgba(255,255,255,0.25)';
    };

    const _updateGlobalVol = () => {
      const row = infoContent.querySelector('#ann-global-vol-row');
      if (row) row.style.display = selectedSpeakers.size > 0 ? 'flex' : 'none';
    };

    const _renderHistory = () => {
      const hist = _loadHistory();
      if (!hist.length) return '';
      const favs    = hist.filter(h => h.favourite);
      const recents = hist.filter(h => !h.favourite);
      let html = '<div style="padding:0 16px 4px;flex-shrink:0;">' +
        '<label style="font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${this._pt("dim")};display:block;margin-bottom:6px;">Recent</label>' +
        '<div id="ann-history-list" style="display:flex;flex-direction:column;gap:4px;">';

      const renderItem = (item) => {
        const preview = item.text.length > 48 ? item.text.slice(0, 48) + '\u2026' : item.text;
        const safeText = item.text.replace(/"/g, '&quot;');
        return '<div class="ann-hist-item" data-text="' + safeText + '" style="' +
          'display:flex;align-items:center;gap:8px;padding:8px 10px;' +
          'background:${this._pt("bg")};border:1px solid ${this._pt("div")};' +
          'border-radius:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
          'user-select:none;">' +
          // iOS-style × delete button (left side, red circle)
          '<div class="ann-hist-delete" data-text="' + safeText + '" style="' +
            'width:18px;height:18px;border-radius:50%;background:rgba(255,59,48,0.85);' +
            'display:flex;align-items:center;justify-content:center;flex-shrink:0;' +
            '-webkit-tap-highlight-color:transparent;">' +
            '<svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:${this._pt("text")};pointer-events:none;">' +
              '<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
            '</svg>' +
          '</div>' +
          '<span style="flex:1;font-size:13px;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">' +
            preview +
          '</span>' +
          '<div class="ann-hist-star" data-text="' + safeText + '" style="' +
            'padding:4px;flex-shrink:0;-webkit-tap-highlight-color:transparent;">' +
            '<svg viewBox="0 0 24 24" style="width:18px;height:18px;pointer-events:none;fill:' +
              (item.favourite ? '#FFD60A' : 'rgba(255,255,255,0.2)') + ';">' +
              '<path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/>' +
            '</svg>' +
          '</div>' +
        '</div>';
      };

      if (favs.length) {
        html += favs.map(renderItem).join('');
        if (recents.length) html += '<div style="height:4px;"></div>';
      }
      html += recents.map(renderItem).join('');
      html += '</div></div>';
      return html;
    };

    const _deleteFromHistory = (text) => {
      const hist = _loadHistory().filter(h => h.text !== text);
      _saveHistory(hist);
    };

    const _wireHistory = () => {
      const histList = infoContent.querySelector('#ann-history-list');
      if (!histList) return;

      const _rerender = () => {
        const histSection = infoContent.querySelector('#ann-history-section');
        if (histSection) { histSection.innerHTML = _renderHistory(); _wireHistory(); }
      };

      // Tap row to fill textarea (exclude star and delete)
      histList.querySelectorAll('.ann-hist-item').forEach(item => {
        let _sy = 0, _scrolled = false;
        item.addEventListener('pointerdown', e => { _sy = e.clientY; _scrolled = false; }, { passive: true });
        item.addEventListener('pointermove', e => { if (Math.abs(e.clientY - _sy) > 6) _scrolled = true; }, { passive: true });
        item.addEventListener('pointerup', e => {
          if (_scrolled) return;
          if (e.target.closest('.ann-hist-star') || e.target.closest('.ann-hist-delete')) return;
          const textEl = infoContent.querySelector('#ann-text');
          if (textEl) { textEl.value = item.dataset.text; textEl.focus(); }
        }, { passive: true });
      });

      // Delete button
      histList.querySelectorAll('.ann-hist-delete').forEach(btn => {
        btn.addEventListener('pointerdown', e => { e.stopPropagation(); }, { passive: true });
        btn.addEventListener('pointerup', e => {
          e.stopPropagation();
          _deleteFromHistory(btn.dataset.text);
          // Animate the row out before re-rendering
          const row = btn.closest('.ann-hist-item');
          if (row) {
            row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            row.style.opacity = '0';
            row.style.transform = 'translateX(-10px)';
            setTimeout(_rerender, 210);
          } else {
            _rerender();
          }
        }, { passive: true });
      });

      // Star toggle
      histList.querySelectorAll('.ann-hist-star').forEach(star => {
        star.addEventListener('pointerdown', e => { e.stopPropagation(); }, { passive: true });
        star.addEventListener('pointerup', e => {
          e.stopPropagation();
          const nowFav = _toggleFavourite(star.dataset.text);
          const svg = star.querySelector('svg');
          if (svg) svg.style.fill = nowFav ? '#FFD60A' : 'rgba(255,255,255,0.2)';
          _rerender();
        }, { passive: true });
      });
    };

        const _renderSpeakerRow = (eid, s) => {
      const sel    = selectedSpeakers.has(eid);
      const name   = this._entityDisplayName(eid);
      const annVol = announceVolumes[eid] != null ? announceVolumes[eid] : (_getCurrentVol(eid) != null ? _getCurrentVol(eid) : 50);
      const circBg = sel ? 'rgba(0,122,255,0.2)' : this._pt('btnBg');
      const circFl = sel ? '#007AFF' : this._pt('iconDim');
      const txtCol = sel ? this._pt('text') : this._pt('dim');

      let checkHtml = sel
        ? '<div style="width:22px;height:22px;border-radius:50%;background:#007AFF;flex-shrink:0;display:flex;align-items:center;justify-content:center;pointer-events:none;"><svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:${this._pt("text")};pointer-events:none;"><path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/></svg></div>'
        : '<div style="width:22px;height:22px;border-radius:50%;border:1.5px solid ${this._pt("border")};flex-shrink:0;pointer-events:none;"></div>';

      let volHtml = '';
      if (sel) {
        volHtml = '<div class="ann-vol-row" style="display:flex;align-items:center;gap:10px;padding:2px 0 12px 44px;">' +
          '<div class="ann-minus" data-eid="' + eid + '" style="width:26px;height:26px;border-radius:50%;background:${this._pt("btnBg")};display:flex;align-items:center;justify-content:center;font-size:18px;color:${this._pt("dim")};cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;user-select:none;">&#8722;</div>' +
          '<input type="range" class="ann-vol-slider" data-eid="' + eid + '" min="0" max="100" step="1" value="' + annVol + '" style="flex:1;height:3px;accent-color:#007AFF;cursor:pointer;" />' +
          '<div class="ann-plus" data-eid="' + eid + '" style="width:26px;height:26px;border-radius:50%;background:${this._pt("btnBg")};display:flex;align-items:center;justify-content:center;font-size:18px;color:${this._pt("dim")};cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;user-select:none;">+</div>' +
          '<span class="ann-vol-pct" data-eid="' + eid + '" style="font-size:12px;color:${this._pt("dim")};width:30px;text-align:right;flex-shrink:0;">' + annVol + '%</span>' +
          '</div>';
      }

      return '<div class="ann-speaker-wrap" data-eid="' + eid + '" style="border-bottom:1px solid ${this._pt("div")};">' +
        '<div class="ann-speaker-row" data-eid="' + eid + '" style="display:flex;align-items:center;gap:12px;padding:10px 0;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;">' +
          '<div style="width:32px;height:32px;border-radius:50%;flex-shrink:0;background:' + circBg + ';display:flex;align-items:center;justify-content:center;transition:background 0.15s ease;">' +
            '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + circFl + ';pointer-events:none;"><path d="M17,2H7A2,2 0 0,0 5,4V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V4A2,2 0 0,0 17,2M12,19A2,2 0 0,1 10,17A2,2 0 0,1 12,15A2,2 0 0,1 14,17A2,2 0 0,1 12,19M15,9H9V4H15V9Z"/></svg>' +
          '</div>' +
          '<span style="flex:1;font-size:14px;color:' + txtCol + ';pointer-events:none;">' + name + '</span>' +
          checkHtml +
        '</div>' +
        volHtml +
      '</div>';
    };

    const _renderSpeakerList = () => {
      const listEl = infoContent.querySelector('#ann-speaker-list');
      if (!listEl) return;
      const visible = _getSpeakers();
      const groups  = _groupByArea(visible);
      const hasAreas = groups.some(g => g.area !== 'Other');
      let html = '';
      groups.forEach(g => {
        if (hasAreas) html += `<div style="font-size:11px;font-weight:600;color:${this._pt("dim")};text-transform:uppercase;letter-spacing:0.6px;padding:10px 0 5px;">` + g.area + '</div>';
        g.players.forEach(([eid, s]) => { html += _renderSpeakerRow(eid, s); });
      });
      if (!html) html = `<div style="text-align:center;padding:24px;color:${this._pt("dim")};font-size:13px;">No speakers match</div>`;
      listEl.innerHTML = html;
      _wireList(listEl);
    };

    const _wireList = (listEl) => {
      listEl.querySelectorAll('.ann-speaker-row').forEach(row => {
        let _sy = 0, _scrolled = false;
        row.addEventListener('pointerdown', e => { _sy = e.clientY; _scrolled = false; }, { passive: true });
        row.addEventListener('pointermove', e => { if (Math.abs(e.clientY - _sy) > 8) _scrolled = true; }, { passive: true });
        row.addEventListener('pointerup', () => {
          if (_scrolled) return;
          const eid = row.dataset.eid;
          if (selectedSpeakers.has(eid)) { selectedSpeakers.delete(eid); delete announceVolumes[eid]; }
          else { selectedSpeakers.add(eid); const v = _getCurrentVol(eid); if (v != null) announceVolumes[eid] = v; }
          _renderSpeakerList();
          _updateSendBtn();
          _updateGlobalVol();
        }, { passive: true });
      });
      listEl.querySelectorAll('.ann-vol-slider').forEach(sl => {
        sl.addEventListener('input', () => {
          const val = parseInt(sl.value, 10);
          announceVolumes[sl.dataset.eid] = val;
          modifiedVolumes.add(sl.dataset.eid);
          const pct = listEl.querySelector('.ann-vol-pct[data-eid="' + sl.dataset.eid + '"]');
          if (pct) pct.textContent = val + '%';
        });
      });
      listEl.querySelectorAll('.ann-minus').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
          e.stopPropagation();
          const eid = btn.dataset.eid; const cur = announceVolumes[eid] != null ? announceVolumes[eid] : 50;
          const nv = Math.max(0, cur - 5); announceVolumes[eid] = nv; modifiedVolumes.add(eid);
          const sl = listEl.querySelector('.ann-vol-slider[data-eid="' + eid + '"]');
          const pct = listEl.querySelector('.ann-vol-pct[data-eid="' + eid + '"]');
          if (sl) sl.value = nv; if (pct) pct.textContent = nv + '%';
        }, { passive: true });
      });
      listEl.querySelectorAll('.ann-plus').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
          e.stopPropagation();
          const eid = btn.dataset.eid; const cur = announceVolumes[eid] != null ? announceVolumes[eid] : 50;
          const nv = Math.min(100, cur + 5); announceVolumes[eid] = nv; modifiedVolumes.add(eid);
          const sl = listEl.querySelector('.ann-vol-slider[data-eid="' + eid + '"]');
          const pct = listEl.querySelector('.ann-vol-pct[data-eid="' + eid + '"]');
          if (sl) sl.value = nv; if (pct) pct.textContent = nv + '%';
        }, { passive: true });
      });
    };

    const _doAnnounce = () => {
      const textEl = infoContent.querySelector('#ann-text');
      const text = (textEl?.value || '').trim();
      if (!text || selectedSpeakers.size === 0) return;
      const tts = selectedTTS;
      if (!tts) { self._showToast('No TTS service found.', 3000); return; }
      const targets = [...selectedSpeakers];
      // Music Assistant speakers: Music Assistant plays the announcement itself, pausing its music and
      // restoring it the moment the announcement ends (no guessing how long it takes). Needs Home
      // Assistant's music_assistant.play_announcement with a message (newer Home Assistant) and a
      // text-to-speech entity (tts.speak); everything else is announced the way it always was.
      const _maAnnSvc = self._hass?.services?.music_assistant?.play_announcement;
      const _ttsEntity = tts.service === 'speak'
        ? (Object.keys(self._hass.states).find(e => e.startsWith('tts.') && self._hass.states[e].state !== 'unavailable') || null) : null;
      const _maAnnOk = !!(_maAnnSvc && _maAnnSvc.fields && ('message' in _maAnnSvc.fields) && _ttsEntity);
      const maTargets = _maAnnOk ? targets.filter(eid => !!self._maQueueId?.(eid)) : [];
      const legacyTargets = targets.filter(eid => !maTargets.includes(eid));
      maTargets.forEach(eid => {
        const data = { message: text, tts_entity_id: _ttsEntity };
        const annVol = announceVolumes[eid];
        if (modifiedVolumes.has(eid) && annVol != null) data.announce_volume = Math.max(1, Math.min(100, Math.round(annVol)));
        self._call('music_assistant', 'play_announcement', data, { entity_id: eid }).catch(() => {
          // Music Assistant couldn't: say it the ordinary way on that speaker
          self._call('tts', 'speak', { entity_id: _ttsEntity, media_player_entity_id: eid, message: text }, undefined, { fail: 'Couldn\u2019t play the announcement' }).catch(() => {});
        });
      });
      const savedStates = {};
      legacyTargets.forEach(eid => {
        const s = self._hass?.states[eid];
        savedStates[eid] = { wasPlaying: s?.state === 'playing', volume: s?.attributes?.volume_level != null ? s.attributes.volume_level : null };
        if (savedStates[eid].wasPlaying) self._call('media_player', 'media_pause', { entity_id: eid }).catch(() => {});
        const annVol = announceVolumes[eid];
        if (modifiedVolumes.has(eid) && annVol != null && savedStates[eid].volume != null && Math.abs(annVol / 100 - savedStates[eid].volume) > 0.01)
          self._call('media_player', 'volume_set', { entity_id: eid, volume_level: annVol / 100 }).catch(() => {});
      });
      // Delay 1 second after pausing to let speakers fully stop before TTS fires
      setTimeout(() => {
        const isSpeak = tts.service === 'speak';
        const ttsEid = isSpeak ? (Object.keys(self._hass.states).find(e => e.startsWith('tts.') && self._hass.states[e].state !== 'unavailable') || null) : null;
        legacyTargets.forEach(eid => {
          if (isSpeak) {
            self._call('tts', 'speak', { entity_id: ttsEid || 'tts.home_assistant_cloud', media_player_entity_id: eid, message: text })
              .catch(() => { self._call('tts', 'speak', { entity_id: eid, message: text }, undefined, { fail: 'Couldn\u2019t play the announcement' }).catch(() => {}); });
          } else {
            self._call(tts.domain, tts.service, { entity_id: eid, message: text }, undefined, { fail: 'Couldn\u2019t play the announcement' }).catch(() => {});
          }
        });
        const ms = Math.max(4000, text.length * 80 + 3000);
        setTimeout(() => {
          legacyTargets.forEach(eid => {
            const saved = savedStates[eid];
            const annVol = announceVolumes[eid];
            if (modifiedVolumes.has(eid) && annVol != null && saved.volume != null && Math.abs(annVol / 100 - saved.volume) > 0.01)
              self._call('media_player', 'volume_set', { entity_id: eid, volume_level: saved.volume }).catch(() => {});
            if (saved.wasPlaying)
              self._call('media_player', 'media_play', { entity_id: eid }).catch(() => {});
          });
          self._announceActive = false;
          self._updateMulticastPills();
          // Show confirmation popup on the artwork panel
          self._showAnnounceConfirmation(text, targets);
        }, ms);
      }, 1200);
      self._announceActive = true;
      {
        const _annNames = targets.map(eid => self._entityDisplayName ? self._entityDisplayName(eid) : (self._hass?.states[eid]?.attributes?.friendly_name || eid));
        const _annList = _annNames.length <= 2 ? _annNames.join(' and ') : `${_annNames.slice(0, 2).join(', ')} and ${_annNames.length - 2} more`;
        self._showToast(`Announcing on ${_annList}\u2026`, 3000);
      }
      // Blur the textarea to dismiss the iOS keyboard before the panel closes
      annOverlay.querySelector('#ann-text')?.blur();
      
      _addToHistory(text);
      self._queuePanelDirection = _savedQueueDir;
      if (_qsr) _qsr.classList.remove('hidden');
      annOverlay.remove();
      maPopup.classList.remove('visible');
    };

    // Inject announce as an absolutely-positioned overlay inside maPopup so the
    // library's static HTML is never overwritten. Removing annOverlay fully restores
    // the library without any re-render needed.
    const maPopup = r.getElementById('maPopup');
    if (!maPopup) return;

    // Remove any existing announce overlay
    maPopup.querySelector('#annOverlay')?.remove();
    const annOverlay = document.createElement('div');
    annOverlay.id = 'annOverlay';
    annOverlay.style.cssText = `position:absolute;inset:0;z-index:61;background:${this._pt('panelBg')};display:flex;flex-direction:column;border-radius:24px;overflow:hidden;-webkit-mask-image:-webkit-radial-gradient(white,black);`;
    maPopup.appendChild(annOverlay);

    const ttsHtml = selectedTTS
      ? '<span style="font-size:11px;color:${this._pt("dim")};letter-spacing:0.3px;">Via ' + selectedTTS.label + '</span>'
      : '<span style="font-size:12px;color:rgba(255,165,0,0.8);">\u26a0 No TTS service — configure in the visual editor</span>';

    annOverlay.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 10px;flex-shrink:0;border-bottom:1px solid ${this._pt("div")};"><div style="display:flex;flex-direction:column;"><span style="font-size:16px;font-weight:700;color:${this._pt("text")};letter-spacing:-0.3px;">Announce</span><span style="font-size:11px;margin-top:1px;">${selectedTTS ? `<span style="color:${this._pt("dim")};">Via ${selectedTTS.label}</span>` : `<span style="color:rgba(255,165,0,0.8);">\u26a0 No TTS \u2014 configure in visual editor</span>`}</span></div><button class="ma-close" id="annClose" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")};"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></button></div><div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px 4px;flex-shrink:0;"><span style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${this._pt("dim")};">Speakers</span><div id="ann-global-vol-row" style="display:none;align-items:center;gap:8px;"><svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:${this._pt("dim")};flex-shrink:0;"><path d="M3,9V15H7L12,20V4L7,9H3M16.5,12C16.5,10.23 15.48,8.71 14,7.97V16.02C15.48,15.29 16.5,13.77 16.5,12Z"/></svg><input type="range" id="ann-global-vol" min="0" max="100" step="1" value="50" style="width:72px;height:3px;accent-color:#007AFF;cursor:pointer;" /><span id="ann-global-vol-pct" style="font-size:11px;color:${this._pt("dim")};width:28px;">50%</span></div></div><div style="display:flex;align-items:center;gap:8px;margin:0 16px 6px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};border-radius:10px;padding:7px 12px;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${this._pt("dim")};flex-shrink:0;"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg><input id="ann-search" type="text" placeholder="Search speakers\u2026" style="background:none;border:none;outline:none;color:${this._pt("text")};font-size:14px;font-family:inherit;flex:1;-webkit-appearance:none;" /><div id="ann-search-clear" style="display:none;cursor:pointer;padding:2px;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${this._pt("dim")};display:block;"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></div></div><div id="ann-speaker-list" style="flex:1;overflow-y:auto;padding:0 16px 8px;"></div><div id="ann-history-section" style="flex-shrink:0;max-height:120px;overflow-y:auto;border-top:1px solid ${this._pt('div')};"></div><div style="display:flex;align-items:flex-end;gap:8px;padding:10px 12px 14px;border-top:1px solid rgba(255,255,255,0.08);flex-shrink:0;background:${this._pt('panelBg')};"><div style="flex:1;position:relative;"><textarea id="ann-text" placeholder="Announcement\u2026" rows="1" style="width:100%;box-sizing:border-box;background:${this._pt("btnBg")};border:1.5px solid ${this._pt("border")};border-radius:20px;color:${this._pt("text")};font-size:15px;font-family:inherit;padding:9px 16px 9px 40px;resize:none;outline:none;-webkit-appearance:none;line-height:1.4;max-height:96px;overflow-y:auto;display:block;"></textarea><button id="ann-ai-improve" title="AI: improve announcement" style="position:absolute;left:10px;bottom:9px;background:none;border:none;cursor:pointer;padding:3px;-webkit-tap-highlight-color:transparent;opacity:0.6;transition:opacity 0.15s;"><svg viewBox="0 0 24 24" style="width:17px;height:17px;fill:#63b3ed;display:block;"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg></button></div><div id="ann-send" style="width:34px;height:34px;border-radius:50%;background:${this._pt("btnBg")};display:flex;align-items:center;justify-content:center;cursor:default;transition:background 0.15s ease;-webkit-tap-highlight-color:transparent;flex-shrink:0;margin-bottom:1px;"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._pt("dim")};transition:fill 0.15s ease;pointer-events:none;"><path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M10,16.5V7.5L16,12L10,16.5Z"/></svg></div></div>`;

    // Reassign infoContent to maPopup so all functions above and wiring below
    // query the correct element (maPopup instead of the old infoContent).
    infoContent = annOverlay;

    // Close button
    annOverlay.querySelector('#annClose')?.addEventListener('click', () => {
      annOverlay.remove();
      maPopup.classList.remove('visible');
      if (_qsr) _qsr.classList.remove('hidden');
      self._queuePanelDirection = _savedQueueDir;
    });

    // AI Improve button — only when AI features are on; otherwise remove it
    // and give the textarea back the left padding the button sat in.
    if (!this._aiEnabled()) {
      annOverlay.querySelector('#ann-ai-improve')?.remove();
      const _annTa = annOverlay.querySelector('#ann-text');
      if (_annTa) _annTa.style.paddingLeft = '16px';
    } else {
      const annAiBtn = annOverlay.querySelector('#ann-ai-improve');
      if (annAiBtn) {
        annAiBtn.addEventListener('click', async () => {
          const textEl = annOverlay.querySelector('#ann-text');
          const raw = (textEl?.value || '').trim();
          if (!raw) { self._showToast('Type a message first'); return; }
          annAiBtn.style.opacity = '0.3';
          annAiBtn.style.pointerEvents = 'none';
          try {
            const improved = await self._aiImproveAnnouncement(raw);
            if (improved && textEl) {
              textEl.value = improved;
              textEl.style.height = 'auto';
              textEl.style.height = Math.min(textEl.scrollHeight, 96) + 'px';
            }
          } catch (e) {
            self._aiFailToast(e);
          } finally {
            annAiBtn.style.opacity = '0.6';
            annAiBtn.style.pointerEvents = '';
          }
        });
      }
    }

    maPopup.classList.add('visible');

    _renderSpeakerList();
    _wireHistory();

    // Send button
    infoContent.querySelector('#ann-send')?.addEventListener('pointerup', () => {
      if (selectedSpeakers.size > 0) _doAnnounce();
    });

    // Global volume
    const _gvSl  = infoContent.querySelector('#ann-global-vol');
    const _gvPct = infoContent.querySelector('#ann-global-vol-pct');
    _gvSl?.addEventListener('input', () => {
      const val = parseInt(_gvSl.value, 10);
      if (_gvPct) _gvPct.textContent = val + '%';
      selectedSpeakers.forEach(eid => {
        announceVolumes[eid] = val; modifiedVolumes.add(eid);
        const sl  = infoContent.querySelector('.ann-vol-slider[data-eid="' + eid + '"]');
        const pct = infoContent.querySelector('.ann-vol-pct[data-eid="' + eid + '"]');
        if (sl)  sl.value = val;
        if (pct) pct.textContent = val + '%';
      });
    });

    // Search
    const _srchIn = infoContent.querySelector('#ann-search');
    const _srchCl = infoContent.querySelector('#ann-search-clear');
    _srchIn?.addEventListener('input', e => {
      _speakerFilter = e.target.value;
      if (_srchCl) _srchCl.style.display = _speakerFilter ? 'block' : 'none';
      _renderSpeakerList();
    });
    _srchCl?.addEventListener('pointerdown', e => {
      e.preventDefault();
      _speakerFilter = ''; if (_srchIn) _srchIn.value = '';
      _srchCl.style.display = 'none';
      _renderSpeakerList();
    });

    // Mark announce as open
    self._announceOpen = true;
    _loadAreas();
  },

  // Shows a confirmation overlay on the artwork panel after an announcement

  // ── Send Message panel ───────────────────────────────────────────────────
  _showSendMessagePanel() {
    const r = this.shadowRoot;
    const self = this;
    const _qsr = r.getElementById('queueSearchRow');
    if (_qsr) _qsr.classList.add('hidden');
    const _savedQueueDir = this._queuePanelDirection;
    this._queuePanelDirection = null;

    // Guard against the pointerup/click from the menu item that opened this panel
    // falling through onto the first rendered device row — same pattern used by
    // crowMediaQuickMenuPopup and the queue dropdown menu. Without this, if device names
    // load quickly (e.g. from cache) the row can already be in the DOM by the time
    // the trailing event from the menu tap arrives, silently pre-selecting it.
    const _smOpenedAt = Date.now();
    const _smReady = () => (Date.now() - _smOpenedAt) > 350;

    const _getNotifyTargets = () => {
      const notify = this._hass?.services?.notify || {};
      return Object.keys(notify)
        .filter(svc => svc.startsWith('mobile_app_'))
        .sort()
        .map(svc => ({ svc, label: svc })); // placeholder until registry loads
    };

    // Load device registry to resolve proper friendly names for mobile app devices
    const _loadMobileDeviceNames = async (container) => {
      try {
        const [entities, devices] = await Promise.all([
          this._getEntityRegistry(),
          this._getDeviceRegistry()
        ]);

        // Build device id → friendly name map
        const deviceNames = {};
        devices.forEach(d => { deviceNames[d.id] = d.name_by_user || d.name || null; });

        // Build service slug → device name by matching mobile_app entities
        // HA mobile app entities have platform='mobile_app' and device_id on the device
        // The notify service name is notify.mobile_app_<webhook_id_slug>
        // Most reliable: match by finding the device whose name slug matches the service slug
        const mobileEntities = entities.filter(e => e.platform === 'mobile_app' && e.device_id);
        const deviceIdToName = {};
        mobileEntities.forEach(e => {
          if (e.device_id && deviceNames[e.device_id]) {
            deviceIdToName[e.device_id] = deviceNames[e.device_id];
          }
        });

        // For each notify target, find matching device by slugifying device name
        // and comparing to the service slug
        targets.forEach(t => {
          const svcSlug = t.svc.replace(/^mobile_app_/, '').toLowerCase();
          // Try to find a device whose name slugifies to match the service slug
          for (const [devId, devName] of Object.entries(deviceIdToName)) {
            const nameSlug = devName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            if (nameSlug === svcSlug || svcSlug.includes(nameSlug) || nameSlug.includes(svcSlug)) {
              t.label = devName;
              break;
            }
          }
          // Fallback: find any mobile_app entity on a device whose id appears in the slug
          if (t.label === t.svc) {
            const match = mobileEntities.find(e =>
              e.device_id && svcSlug.includes(e.device_id.toLowerCase().slice(0, 8))
            );
            if (match?.device_id && deviceIdToName[match.device_id]) {
              t.label = deviceIdToName[match.device_id];
            }
          }
          // Last resort: clean up the slug into something readable
          if (t.label === t.svc) {
            t.label = svcSlug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        });

        _renderTargets(container);
      } catch (_) {
        // On error, show cleaned-up slug names
        targets.forEach(t => {
          if (t.label === t.svc) {
            t.label = t.svc.replace(/^mobile_app_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        });
        _renderTargets(container);
      }
    };

    const targets = _getNotifyTargets();
    const selectedTargets = new Set();

    const _renderTargets = (container) => {
      if (!targets.length) {
        container.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:${this._pt("dim")};line-height:1.6;">No mobile devices found.<br>Install the Home Assistant Companion App<br>on your phones and tablets,<br>then log in to see them here.</div>`;
        return;
      }
      container.innerHTML = targets.map(t => {
        const active = selectedTargets.has(t.svc);
        return `<div class="sm-target-row" data-svc="${t.svc}"
          style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;cursor:pointer;
          background:${active ? 'rgba(0,122,255,0.12)' : this._pt('bg')};
          border:1px solid ${active ? 'rgba(0,122,255,0.3)' : this._pt('border')};
          margin-bottom:6px;transition:all 0.12s ease;-webkit-tap-highlight-color:transparent;">
          <div style="width:32px;height:32px;border-radius:8px;background:${this._pt("btnBg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${active ? '#007AFF' : this._pt('iconDim')};">
              <path d="M17,12V3A1,1 0 0,0 16,2H3A1,1 0 0,0 2,3V17L6,13H16A1,1 0 0,0 17,12M21,6H19V15H6V17A1,1 0 0,0 7,18H18L22,22V7A1,1 0 0,0 21,6Z"/>
            </svg></div>
          <span style="flex:1;font-size:14px;font-weight:500;color:${active ? this._pt('text') : this._pt('dim')};">${t.label}</span>
          ${active ? `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#007AFF;flex-shrink:0;"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>` : ''}
        </div>`;
      }).join('');
      container.querySelectorAll('.sm-target-row').forEach(row => {
        row.addEventListener('click', () => {
          if (!_smReady()) return;
          const svc = row.dataset.svc;
          if (selectedTargets.has(svc)) selectedTargets.delete(svc);
          else selectedTargets.add(svc);
          _renderTargets(container);
          _updateSendBtn();
        });
      });
    };

    const _updateSendBtn = () => {
      const btn = msgOverlay.querySelector('#sm-send');
      if (!btn) return;
      const ready = !!(msgOverlay.querySelector('#sm-message')?.value.trim()) && selectedTargets.size > 0;
      btn.style.background = ready ? '#007AFF' : this._pt('btnBg');
      btn.querySelector('svg').style.fill = ready ? '#fff' : this._pt('iconDim');
      btn.style.cursor = ready ? 'pointer' : 'default';
    };

    const _doSend = () => {
      const title   = msgOverlay.querySelector('#sm-title')?.value.trim()   || '';
      const message = msgOverlay.querySelector('#sm-message')?.value.trim() || '';
      if (!message || !selectedTargets.size) return;
      const targetArr = [...selectedTargets];
      targetArr.forEach(svc => {
        const svcData = { message };
        if (title) svcData.title = title;
        this._call('notify', svc, svcData, undefined, { fail: 'Couldn\u2019t send the message' }).catch(() => {});
      });
      msgOverlay.remove();
      maPopup.classList.remove('visible');
      if (_qsr) _qsr.classList.remove('hidden');
      self._queuePanelDirection = _savedQueueDir;
      self._showSendMessageConfirmation(title || message,
        targetArr.map(svc => targets.find(t => t.svc === svc)?.label || svc));
    };

    const maPopup = r.getElementById('maPopup');
    if (!maPopup) return;
    maPopup.querySelector('#msgOverlay')?.remove();
    const msgOverlay = document.createElement('div');
    msgOverlay.id = 'msgOverlay';
    msgOverlay.style.cssText = `position:absolute;inset:0;z-index:2;background:${this._pt('panelBg')};display:flex;flex-direction:column;border-radius:24px;overflow:hidden;-webkit-mask-image:-webkit-radial-gradient(white,black);`;
    maPopup.appendChild(msgOverlay);

    msgOverlay.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 10px;flex-shrink:0;border-bottom:1px solid ${this._pt("div")};"><div style="display:flex;flex-direction:column;"><span style="font-size:16px;font-weight:700;color:${this._pt("text")};letter-spacing:-0.3px;">Send a Message</span><span style="font-size:11px;color:${this._pt("dim")};margin-top:1px;">Home Assistant Companion App</span></div><button class="ma-close" id="smClose" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")};"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></button></div><div style="padding:10px 16px 4px;flex-shrink:0;"><span style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${this._pt("dim")};">To</span></div><div style="display:flex;align-items:center;gap:8px;margin:0 16px 6px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};border-radius:10px;padding:7px 12px;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${this._pt("dim")};flex-shrink:0;"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg><input id="sm-search" type="text" placeholder="Search devices\u2026" style="background:none;border:none;outline:none;color:${this._pt("text")};font-size:14px;font-family:inherit;flex:1;-webkit-appearance:none;" /><div id="sm-search-clear" style="display:none;cursor:pointer;padding:2px;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${this._pt("dim")};display:block;"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></div></div><div id="sm-target-list" style="flex:1;overflow-y:auto;padding:0 16px 8px;"></div>${targets.length ? '' : `<div style="padding:0 16px 8px;flex-shrink:0;"><div style="padding:10px 12px;background:rgba(255,149,0,0.1);border:1px solid rgba(255,149,0,0.2);border-radius:10px;font-size:12px;color:rgba(255,180,50,0.9);line-height:1.5;">\u26a0 No mobile devices found. Install the HA Companion App on your devices and log in.</div></div>`}<div style="padding:10px 16px 6px;flex-shrink:0;border-top:1px solid ${this._pt("div")};"><input id="sm-title" type="text" value="Message" placeholder="Message" style="width:100%;box-sizing:border-box;background:${this._pt("btnBg")};border:1.5px solid ${this._pt("border")};border-radius:12px;color:${this._pt("text")};font-size:15px;font-weight:500;font-family:inherit;padding:10px 14px;outline:none;-webkit-appearance:none;transition:border-color 0.15s ease;"></div><div style="display:flex;align-items:flex-end;gap:8px;padding:8px 12px 14px;flex-shrink:0;background:${this._pt("panelBg")};"><div style="flex:1;position:relative;"><textarea id="sm-message" placeholder="Message\u2026" rows="1" style="width:100%;box-sizing:border-box;background:${this._pt("btnBg")};border:1.5px solid ${this._pt("border")};border-radius:20px;color:${this._pt("text")};font-size:15px;font-family:inherit;padding:9px 16px 9px 40px;resize:none;outline:none;-webkit-appearance:none;line-height:1.4;max-height:96px;overflow-y:auto;display:block;"></textarea><button id="sm-ai-improve" title="AI: improve message" style="position:absolute;left:10px;bottom:9px;background:none;border:none;cursor:pointer;padding:3px;-webkit-tap-highlight-color:transparent;opacity:0.6;transition:opacity 0.15s;"><svg viewBox="0 0 24 24" style="width:17px;height:17px;fill:#63b3ed;display:block;"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg></button></div><div id="sm-send" style="width:34px;height:34px;border-radius:50%;background:${this._pt("btnBg")};display:flex;align-items:center;justify-content:center;cursor:default;transition:background 0.15s ease;-webkit-tap-highlight-color:transparent;flex-shrink:0;margin-bottom:1px;"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._pt("dim")};transition:fill 0.15s ease;pointer-events:none;"><path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M10,16.5V7.5L16,12L10,16.5Z"/></svg></div></div>`;

    maPopup.classList.add('visible');
    const _smTargetListEl = msgOverlay.querySelector('#sm-target-list');
    if (targets.length) {
      _smTargetListEl.innerHTML = `<div style="padding:20px;text-align:center;"><div style="width:20px;height:20px;border:2px solid rgba(255,255,255,0.15);border-top-color:${this._pt("text")};border-radius:50%;animation:ma-spin 0.75s linear infinite;display:inline-block;"></div></div>`;
    }
    _loadMobileDeviceNames(_smTargetListEl);

    msgOverlay.querySelector('#smClose')?.addEventListener('click', () => {
      msgOverlay.remove();
      maPopup.classList.remove('visible');
      if (_qsr) _qsr.classList.remove('hidden');
      self._queuePanelDirection = _savedQueueDir;
    });

    // Device search filter
    const smSearch      = msgOverlay.querySelector('#sm-search');
    const smSearchClear = msgOverlay.querySelector('#sm-search-clear');
    let _smFilter = '';
    smSearch?.addEventListener('input', () => {
      _smFilter = smSearch.value.toLowerCase();
      smSearchClear.style.display = _smFilter ? 'block' : 'none';
      _smTargetListEl.querySelectorAll('.sm-target-row').forEach(row => {
        const name = row.querySelector('span')?.textContent.toLowerCase() || '';
        row.style.display = (!_smFilter || name.includes(_smFilter)) ? '' : 'none';
      });
    });
    smSearchClear?.addEventListener('click', () => {
      smSearch.value = ''; _smFilter = '';
      smSearchClear.style.display = 'none';
      _smTargetListEl.querySelectorAll('.sm-target-row').forEach(row => { row.style.display = ''; });
    });

    msgOverlay.querySelector('#sm-send')?.addEventListener('pointerup', () => {
      if (selectedTargets.size > 0 && msgOverlay.querySelector('#sm-message')?.value.trim()) _doSend();
    });

    // AI improve button — same as announce panel (removed when AI is off)
    if (!this._aiEnabled()) {
      msgOverlay.querySelector('#sm-ai-improve')?.remove();
      const _smTa = msgOverlay.querySelector('#sm-message');
      if (_smTa) _smTa.style.paddingLeft = '16px';
    }
    const smAiBtn = msgOverlay.querySelector('#sm-ai-improve');
    if (smAiBtn) {
      smAiBtn.addEventListener('click', async () => {
        const textEl = msgOverlay.querySelector('#sm-message');
        const raw = (textEl?.value || '').trim();
        if (!raw) { self._showToast('Type a message first'); return; }
        smAiBtn.style.opacity = '0.3';
        smAiBtn.style.pointerEvents = 'none';
        try {
          const improved = await self._aiImproveAnnouncement(raw);
          if (improved && textEl) {
            textEl.value = improved;
            textEl.style.height = 'auto';
            textEl.style.height = Math.min(textEl.scrollHeight, 96) + 'px';
            textEl.dispatchEvent(new Event('input'));
          }
        } catch(e) {
          self._aiFailToast(e);
        } finally {
          smAiBtn.style.opacity = '0.6';
          smAiBtn.style.pointerEvents = '';
        }
      });
    }


    ['#sm-title', '#sm-message'].forEach(sel => {
      msgOverlay.querySelector(sel)?.addEventListener('input', _updateSendBtn);
    });

  },

  _copyToClipboard(text, serviceLabel) {
    const _msg = serviceLabel ? ('\u2713 Copied ' + serviceLabel + ' link') : '\u2713 Copied to clipboard';
    // navigator.clipboard requires HTTPS — use execCommand as universal fallback
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => this._showToast(_msg))
        .catch(() => this._execCopy(text, serviceLabel));
    } else {
      this._execCopy(text, serviceLabel);
    }
  },

  _execCopy(text, serviceLabel) {
    const _msg = serviceLabel ? ('\u2713 Copied ' + serviceLabel + ' link') : '\u2713 Copied to clipboard';
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
      const ok = document.execCommand('copy');
      this._showToast(ok ? _msg : 'Could not copy');
    } catch(e) {
      this._showToast('Could not copy');
    }
    document.body.removeChild(el);
  },

  // Optimistically update the card title/artist display before HA confirms state.
  // Cleared automatically when updateContent next runs with real HA state.
  _setOptimisticMedia(title, artist) {
    const r = this.shadowRoot;
    const titleEl  = r?.getElementById('tTitle');
    const artistEl = r?.getElementById('tArtist');
    if (titleEl)  this._applyScrollText(titleEl,  title);
    if (artistEl) this._applyScrollText(artistEl, artist);
    // Flag so updateContent clears this once HA state arrives
    this._optimisticMediaExpiry = Date.now() + 12000; // clear after 12s max
  },

  _showSendMessageConfirmation(preview, targetNames, hasPhoto) {
    const cardOuter = this.shadowRoot?.getElementById('cardOuter');
    if (!cardOuter) return;
    this._expandFromCompact();
    const DURATION_MS = 6000;
    const safePreview = preview.length > 100 ? preview.slice(0, 100) + '\u2026' : preview;
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:absolute;inset:0;z-index:50;pointer-events:all;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:inherit;transition:opacity 0.3s ease;';
    overlay.innerHTML =
      '<div style="width:52px;height:52px;border-radius:50%;background:rgba(0,122,255,0.2);border:1px solid rgba(0,122,255,0.4);display:flex;align-items:center;justify-content:center;margin-bottom:16px;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#007AFF;"><path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6V9M14,14H6V12H14V14M18,8H6V6H18V8Z"/></svg></div><div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${this._pt("dim")};margin-bottom:10px;">Message Sent</div><div style="font-size:15px;font-weight:600;color:${this._pt("text")};text-align:center;line-height:1.4;max-width:260px;margin-bottom:10px;">\u201c' + safePreview + '\u201d</div>' +
      (hasPhoto ? '<div style="font-size:12px;color:${this._pt("dim")};margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${this._pt("dim")};"><path d="M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z"/></svg>Photo attached</div>' : '') +
      '<div style="font-size:12px;color:${this._pt("dim")};text-align:center;margin-bottom:24px;max-width:260px;line-height:1.5;">' + targetNames.join(', ') + '</div><button id="smConfirmClose" class="panel-state-btn ps-counting" style="--ps-duration:' + (DURATION_MS / 1000) + 's;">Close</button>';
    cardOuter.style.position = 'relative';
    cardOuter.appendChild(overlay);
    const _close = () => {
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 320);
    };
    overlay.querySelector('#smConfirmClose')?.addEventListener('click', _close);
    setTimeout(_close, DURATION_MS);
  },

  // Proactive counterpart to the LIVE pill's manual lookup — same MA-queue /
  // pinned / radio-browser name-search strategies, fired automatically once
  // per stream (see the call site in updateContent) instead of requiring a
  // tap first. Deliberately skips the pill's Strategy 0/1 (those are plain
  // synchronous cache reads already done inline before this gets called) and
  // only does the async ones that can discover a station for the first time.
  async _rbAutoResolveStationArt(entityId) {
    try {
      const attrs = this._hass?.states[entityId]?.attributes || {};
      let _stationName = '';
      if (this._maEntityIds?.has(entityId)) {
        try {
          const qRes = await this._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'get_queue',
            service_data: { entity_id: entityId }, return_response: true
          });
          const qData = qRes?.response?.[entityId] || qRes?.response || null;
          _stationName = qData?.current_item?.name || qData?.current_item?.media_item?.name || '';
        } catch (_) {}
      }
      if (!_stationName) _stationName = attrs.media_album_name || attrs.media_title || '';
      if (!_stationName) return;
      const _nl = _stationName.toLowerCase();

      // Pinned stations first — instant, no network.
      let best = this._rbGetStarred().find(s => s.name?.toLowerCase() === _nl) || null;

      if (!best) {
        const res = await crowFetch(
          'https://de1.api.radio-browser.info/json/stations/search?name='
          + encodeURIComponent(_stationName) + '&limit=30&hidebroken=true&order=votes&reverse=true'
        );
        if (!res.ok) return;
        const stations = await res.json();
        if (!stations || !stations.length) return;
        best = stations.find(s => s.name.toLowerCase() === _nl)
            || stations.find(s => s.name.toLowerCase().startsWith(_nl))
            || stations.find(s => _nl.startsWith(s.name.toLowerCase()))
            || stations[0];
        this._rbCacheStation(best);
      }
      if (!best) return;
      this._rbSaveLastPlayed(entityId, best, this._rbStreamKey(attrs));

      // Only refresh if this entity is still the one showing — avoid
      // clobbering a UI that's moved on to something else while this
      // lookup was in flight.
      if (this._entity === entityId && this._hass?.states[entityId]) {
        this.updateContent(this._hass.states[entityId]);
      }
    } catch (_) { /* best-effort — the manual LIVE pill remains a fallback */ }
  },

  // Resolves the currently-playing live station and opens its detail panel —
  // shared by the LIVE pill's own click and by an artwork tap while the LIVE
  // pill is showing (see artClick.onclick), so both entry points agree.
  async _resolveAndShowLiveStation() {
    const _attrs = this._hass?.states[this._entity]?.attributes || {};
    const _streamKey = this._rbStreamKey(_attrs);

    // Strategy 0: the station we ourselves most recently asked this
    // specific entity to play, from this card's own UI (persisted, so it
    // survives an app reload). This is what makes the pill work reliably
    // for HA Radio Browser stations — MA can end up reporting a
    // media_content_id for the entity that doesn't match anything we
    // cached it under — and for any station that overwrites media_title
    // with the currently playing song once tuned in (very common), which
    // otherwise permanently hides the station's own name from HA's state.
    const _lastPlayed = this._rbGetLastPlayed(this._entity, _streamKey);
    if (_lastPlayed) { this._showRbMoreInfo(_lastPlayed); return; }

    // Strategy 1: check pinned stations by name — instant, no network
    // and check the session station cache by stream URL — populated when
    // user plays or long-presses a station from the radio search results.
    const _rawId = _attrs.media_content_id || '';
    const _streamUrl = _rawId.replace(/^builtin:\/\/radio\//i, '');
    if (_streamUrl) {
      const _cached = this._rbCachedStation(_streamUrl);
      if (_cached) {
        // Also save under the entity-keyed cache — the artwork fallback
        // checks that one first, and it isn't tied to matching MA's
        // exact media_content_id format the way the URL-keyed cache is,
        // so this closes the gap for stations played outside this
        // card's own Play button (Siri, HomeKit, etc.) but identified
        // here via the LIVE pill.
        this._rbSaveLastPlayed(this._entity, _cached, _streamKey);
        this.updateContent(this._hass.states[this._entity]);
        this._showRbMoreInfo(_cached);
        return;
      }
    }

    // Strategy 2: check pinned stations by name
    let _stationName = '';
    let _maStationUri = '';
    let _maStationImg = '';
    try {
      const qRes = await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'music_assistant', service: 'get_queue',
        service_data: { entity_id: this._entity }, return_response: true
      });
      const qData = qRes?.response?.[this._entity] || qRes?.response || null;
      _stationName = qData?.current_item?.name || qData?.current_item?.media_item?.name || '';
      // Also keep the MA library uri + artwork of the current queue item —
      // if every lookup below misses (station played straight from the MA
      // library and unknown to radio-browser.info), these are enough to
      // build a fully functional station object of our own (Strategy 4).
      _maStationUri = qData?.current_item?.media_item?.uri || '';
      _maStationImg = qData?.current_item?.image
                   || qData?.current_item?.media_item?.metadata?.images?.[0]?.path
                   || '';
    } catch (_) {}

    if (!_stationName) {
      // media_title is only a trustworthy station-name fallback when the
      // stream is NOT broadcasting track metadata — with a real artist
      // present, the title is the currently playing song ('YOU GOT WHAT IT
      // TAKES'), and searching radio-browser for a song name can
      // confidently match a completely unrelated station.
      const _artistPresent = !!(_attrs.media_artist || '').trim();
      _stationName = _attrs.media_album_name || (_artistPresent ? '' : _attrs.media_title) || '';
    }

    if (_stationName) {
      const _pinned = this._rbGetStarred();
      const _pinnedMatch = _pinned.find(s => s.name?.toLowerCase() === _stationName.toLowerCase());
      if (_pinnedMatch) {
        this._rbSaveLastPlayed(this._entity, _pinnedMatch, _streamKey);
        this.updateContent(this._hass.states[this._entity]);
        this._showRbMoreInfo(_pinnedMatch);
        return;
      }
    }

    // Strategy 3: radio-browser name search — same as the search results long-press
    if (_stationName) {
      try {
        const res = await crowFetch(
          'https://de1.api.radio-browser.info/json/stations/search?name='
          + encodeURIComponent(_stationName) + '&limit=30&hidebroken=true&order=votes&reverse=true'
        );
        if (res.ok) {
          const stations = await res.json();
          if (stations && stations.length) {
            const _nl = _stationName.toLowerCase();
            const best = stations.find(s => s.name.toLowerCase() === _nl)
                      || stations.find(s => s.name.toLowerCase().startsWith(_nl))
                      || stations.find(s => _nl.startsWith(s.name.toLowerCase()))
                      || stations[0];
            this._rbCacheStation(best); // cache for next time
            this._rbSaveLastPlayed(this._entity, best, _streamKey); // also key by entity — see note above
            this.updateContent(this._hass.states[this._entity]);
            this._showRbMoreInfo(best);
            return;
          }
        }
      } catch (_) {}
    }

    // Strategy 4: MA-library station that radio-browser.info doesn't know —
    // build the station object ourselves from what MA already told us
    // (queue item name + library uri + artwork), in the same shape
    // _haBrowseItemToStation produces. _rbStationPlayCall already plays
    // _maUri stations via music_assistant.play_media, and pin matching in
    // _rbToggleStar keys on _maUri too, so this panel is fully functional
    // (playable, pinnable), not an info-only stub. Cached + saved as
    // lastPlayed so the next tap resolves instantly via Strategy 0 without
    // re-fetching the queue. The _maUri requirement is deliberate: a
    // name-only object couldn't play, and would pin as an unmatchable
    // duplicate-prone entry.
    if (_stationName && _maStationUri) {
      const _synth = {
        name: _stationName,
        favicon: _maStationImg || _attrs.entity_picture || '',
        tags: 'Music Assistant Library',
        countrycode: '', country: '', language: '', codec: '',
        bitrate: 0, votes: 0, homepage: '',
        _maUri: _maStationUri,
      };
      this._rbCacheStation(_synth);
      this._rbSaveLastPlayed(this._entity, _synth, _streamKey);
      this.updateContent(this._hass.states[this._entity]);
      this._showRbMoreInfo(_synth);
      return;
    }

    this._showToast('Station not found — search for it in the Radio tab first');
  },

  // Resolves the currently-playing podcast and opens its detail panel —
  // shared by the PODCAST pill's own click and by an artwork tap while the
  // PODCAST pill is showing (see artClick.onclick), so both entry points agree.
  async _resolveAndShowPodcast() {
    // Strategy 1: use cached pod from episode play — instant, exact match
    const _nowUrl = this._pcNowPlaying?.url;
    const _cached = this._pcCachedPod(_nowUrl);
    if (_cached) { this._showPcMoreInfo(_cached); return; }

    // Strategy 2: check pinned podcasts by name
    const _attrs = this._hass?.states[this._entity]?.attributes || {};
    let podName = _attrs.media_album_name || _attrs.media_artist || _attrs.media_title || '';
    if (podName) {
      const pinned = this._pcGetStarred();
      const pinnedMatch = pinned.find(p => (p.collectionName || '').toLowerCase() === podName.toLowerCase());
      if (pinnedMatch) { this._showPcMoreInfo(pinnedMatch); return; }
    }

    // Strategy 3: search iTunes by name
    if (!podName) { this._showToast('Search for this podcast in the Podcasts tab'); return; }
    this._showLoadingToast('Looking up podcast…');
    try {
      const results = await this._pcSearch(podName);
      this._hideLoadingToast();
      const match = results.find(p => (p.collectionName || '').toLowerCase() === podName.toLowerCase()) || results[0];
      if (match) { this._showPcMoreInfo(match); return; }
    } catch(_) { this._hideLoadingToast(); }
    this._showToast('Podcast not found — search for it in the Podcasts tab');
  },

  _showAnnounceConfirmation(text, speakerEids) {
    // Ensure card is expanded so the overlay is fully visible
    this._expandFromCompact();
    // Clean up any existing overlay using stored reference — no getElementById needed
    if (this._annConfirmOverlay) {
      try { this._annConfirmOverlay.remove(); } catch (_) {}
      this._annConfirmOverlay = null;
    }
    if (this._annConfirmTimer) { clearTimeout(this._annConfirmTimer); this._annConfirmTimer = null; }

    const cardOuter = this.shadowRoot?.getElementById('cardOuter');
    if (!cardOuter) return;

    const speakerNames = speakerEids
      .map(eid => this._entityDisplayName(eid))
      .join(', ');

    const DURATION_MS = 8000;
    const safeText = text.length > 120 ? text.slice(0, 120) + '\u2026' : text;

    const overlay = document.createElement('div');
    overlay.id = 'annConfirmOverlay';
    overlay.style.cssText =
      'position:absolute;inset:0;z-index:50;pointer-events:all;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:inherit;transition:opacity 0.3s ease;';

    overlay.innerHTML =
      '<div style="width:52px;height:52px;border-radius:50%;background:rgba(0,122,255,0.2);border:1px solid rgba(0,122,255,0.4);display:flex;align-items:center;justify-content:center;margin-bottom:16px;flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#007AFF;"><path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.66 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z"/></svg></div><div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${this._pt("dim")};margin-bottom:10px;">Announced</div><div style="font-size:15px;font-weight:600;color:${this._pt("text")};text-align:center;line-height:1.4;max-width:260px;margin-bottom:10px;">\u201c' + safeText + '\u201d</div><div style="font-size:12px;color:${this._pt("dim")};text-align:center;margin-bottom:24px;max-width:260px;line-height:1.5;">' + speakerNames + '</div><button id="annConfirmClose" class="panel-state-btn ps-counting" style="--ps-duration:' + (DURATION_MS / 1000) + 's;">Close</button>';

    cardOuter.style.position = 'relative';
    cardOuter.appendChild(overlay);
    this._annConfirmOverlay = overlay;

    // _close uses direct reference to overlay — never getElementById
    const self = this;
    const _close = () => {
      if (self._annConfirmTimer) { clearTimeout(self._annConfirmTimer); self._annConfirmTimer = null; }
      if (!overlay.parentNode) return;
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
        if (self._annConfirmOverlay === overlay) self._annConfirmOverlay = null;
      }, 320);
    };

    // Wire close button via overlay.querySelector — reliable on dynamically appended elements
    const closeBtn = overlay.querySelector('#annConfirmClose');
    if (closeBtn) {
      // Restart the CSS drain animation (remove+reinsert trick used elsewhere in the card)
      const parent = closeBtn.parentNode;
      const next   = closeBtn.nextSibling;
      parent.removeChild(closeBtn);
      void parent.offsetWidth; // force reflow
      parent.insertBefore(closeBtn, next);
      closeBtn.addEventListener('click', _close, { once: true });
    }

    // Tap backdrop to dismiss
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) _close();
    });

    // Auto-close timer
    this._annConfirmTimer = setTimeout(_close, DURATION_MS);
  }
});

K.ready.library = true;
})();
