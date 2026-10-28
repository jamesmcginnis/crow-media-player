/*
 * Crow Media Player — Movies, TV and Discogs
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.video) return;
const { crowFetch } = K.kit;


Object.assign(K.Card.prototype, {
  _videoChoiceSet(titles, data) {
    if (!data?.title) return;
    const s = this._videoChoiceStore();
    const keep = Object.assign({}, data);
    delete keep._tvmazeFilled;
    [].concat(titles || []).forEach(t => { const k = this._videoChoiceKey(t); if (k) s[k] = { data: keep, t: Date.now() }; });
    Object.keys(s).sort((a, b) => (s[b].t || 0) - (s[a].t || 0)).slice(80).forEach(k => delete s[k]);
    try { localStorage.setItem('crow_media_video_choice_v1', JSON.stringify(s)); } catch (_) {}
  },

  // Films and shows matching a search, for the chooser: TMDB with a key, otherwise TVmaze (shows) and
  // the iTunes Store (films). Best name matches first. null if nothing could be reached.
  async _discMatchSearch(q) {
    q = String(q || '').trim();
    if (!q) return [];
    const norm = v => String(v || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
    const want = norm(q);
    const score = name => { const n = norm(name); return n === want ? 4 : (n.startsWith(want) || want.startsWith(n)) ? 3 : (n.includes(want) || want.includes(n)) ? 2 : 1; };
    const enc = encodeURIComponent(q.replace(/\s*\(\d{4}\)\s*$/, ''));
    const out = [];
    let reached = false;
    if (this._tmdbKey()) {
      try {
        const base = 'https://api.themoviedb.org/3';
        const [tv, mv] = await Promise.all([this._tmdbFetch(base + '/search/tv?query=' + enc + '&page=1'), this._tmdbFetch(base + '/search/movie?query=' + enc + '&page=1')]);
        if (tv.ok || mv.ok) reached = true;
        const tvr = tv.ok ? ((await tv.json()).results || []) : [];
        const mvr = mv.ok ? ((await mv.json()).results || []) : [];
        tvr.slice(0, 10).forEach(r => out.push({ type: 'tv', title: r.name || '', year: String(r.first_air_date || '').slice(0, 4), poster: r.poster_path ? 'https://image.tmdb.org/t/p/w185' + r.poster_path : '', tmdbId: r.id, pop: r.popularity || 0 }));
        mvr.slice(0, 10).forEach(r => out.push({ type: 'movie', title: r.title || '', year: String(r.release_date || '').slice(0, 4), poster: r.poster_path ? 'https://image.tmdb.org/t/p/w185' + r.poster_path : '', tmdbId: r.id, pop: r.popularity || 0 }));
      } catch (_) {}
    }
    if (!out.length) {
      const region = ((String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1] || 'gb').toLowerCase();
      const get = async url => { try { const r = await crowFetch(url); return r.ok ? await r.json() : null; } catch (_) { return null; } };
      const [shows, films] = await Promise.all([
        get('https://api.tvmaze.com/search/shows?q=' + enc),
        get('https://itunes.apple.com/search?term=' + enc + '&media=movie&entity=movie&limit=12&country=' + region),
      ]);
      if (shows || films) reached = true;
      (Array.isArray(shows) ? shows : []).slice(0, 10).forEach(x => { const s = x?.show; if (s?.name) out.push({ type: 'tv', title: s.name, year: String(s.premiered || '').slice(0, 4), poster: s.image?.medium || '', tvmazeId: s.id, pop: (x.score || 0) * 10 + (s.weight || 0) / 10 }); });
      (films?.results || []).forEach(x => { if (x?.trackName) out.push({ type: 'movie', title: x.trackName, year: String(x.releaseDate || '').slice(0, 4), poster: (x.artworkUrl100 || '').replace(/\d+x\d+bb/, '200x200bb'), itunes: { longDescription: x.longDescription || '', primaryGenreName: x.primaryGenreName || '', artistName: x.artistName || '' }, pop: 0 }); });
    }
    if (!reached) return null;
    const seen = new Set();
    return out
      .map(x => Object.assign(x, { s: score(x.title) }))
      .sort((a, b) => b.s - a.s || b.pop - a.pop)
      .filter(x => { const k = x.type + '|' + norm(x.title) + '|' + x.year; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 14);
  },

  // Full details for a match chosen in the chooser, in the same shape the info panel uses
  async _discDataFromMatch(m) {
    if (!m) return null;
    if (m.tmdbId) {
      const d = await this._discTmdbById(m.type, m.tmdbId).catch(() => null);
      if (d) return d;
    }
    if (m.type === 'tv') {
      const d = m.tvmazeId ? await this._discTvmazeById(m.tvmazeId).catch(() => null) : await this._lookupTVmazeShow(m.title).catch(() => null);
      return d || { type: 'tv', title: m.title, year: m.year || '' };
    }
    // a film without TMDB: the iTunes Store blurb, plus Wikipedia when it's the same film
    const it = m.itunes || {};
    let w = null;
    if (m.year) w = await this._fetchWikipediaVideoFallback(m.title + ' (' + m.year + ' film)').catch(() => null);
    if (!w) w = await this._fetchWikipediaVideoFallback(m.title, false).catch(() => null);
    const overview = String(it.longDescription || '').trim() || String(w?.extract || '').trim();
    return {
      type: 'movie', title: m.title, year: m.year || '', overview,
      genres: it.primaryGenreName ? [it.primaryGenreName] : [],
      director: it.artistName || '', cast: [], rating: '',
    };
  },

  async _discTmdbById(type, id) {
    const base = 'https://api.themoviedb.org/3', img = 'https://image.tmdb.org/t/p/w500';
    const isTv = type === 'tv';
    const r = await this._tmdbFetch(base + '/' + type + '/' + id + '?append_to_response=' + (isTv ? 'aggregate_credits' : 'credits'));
    if (!r.ok) return null;
    const d = await r.json();
    const cast = isTv
      ? (d.aggregate_credits?.cast || []).slice().sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0))
      : (d.credits?.cast || []);
    return {
      type: isTv ? 'tv' : 'movie',
      title: (isTv ? d.name : d.title) || '',
      year: String((isTv ? d.first_air_date : d.release_date) || '').split('-')[0] || '',
      genres: (d.genres || []).map(g => g.name).filter(Boolean),
      rating: d.vote_average ? d.vote_average.toFixed(1) : '', votes: d.vote_count || 0,
      overview: d.overview || '',
      cast: cast.slice(0, 15).map(c => c.name).filter(Boolean),
      director: isTv ? null : ((d.credits?.crew || []).find(c => c.job === 'Director')?.name || null),
      seasons: isTv ? ((d.seasons || []).filter(s => s.season_number > 0).length || d.number_of_seasons || 0) : undefined,
      status: d.status || '',
      similar: [],
      _fromTmdb: true,
      _tmdbPoster: d.poster_path ? img + d.poster_path : '',
      _tmdbUrl: 'https://www.themoviedb.org/' + (isTv ? 'tv' : 'movie') + '/' + id,
    };
  },

  // A TVmaze show by its id (so the exact show chosen is used, not the closest name), with its episode guide
  async _discTvmazeById(id) {
    const r = await crowFetch('https://api.tvmaze.com/shows/' + encodeURIComponent(id) + '?embed[]=episodes&embed[]=cast');
    if (!r.ok) return null;
    const show = await r.json();
    const plain = html => { const d = document.createElement('div'); d.innerHTML = String(html || ''); return (d.textContent || '').trim(); };
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const eps = (show._embedded?.episodes || []).filter(e => e && e.season > 0 && e.number != null);
    const list = eps.map(e => ({ season: e.season, ep: e.number, title: esc(e.name || ('Episode ' + e.number)), airdate: e.airdate || '', overview: esc(plain(e.summary)) }));
    if (list.length && show.name) {
      // the case's episode guide looks shows up by name: give it this show's episodes
      if (!this._tvmazeCache) this._tvmazeCache = new Map();
      this._tvmazeCache.set(String(show.name).toLowerCase().trim(), list);
    }
    return {
      type: 'tv',
      title: show.name || '',
      year: String(show.premiered || '').split('-')[0] || '',
      genres: Array.isArray(show.genres) ? show.genres : [],
      rating: show.rating?.average ? Number(show.rating.average).toFixed(1) : '',
      votes: 0,
      overview: plain(show.summary),
      cast: (show._embedded?.cast || []).slice(0, 15).map(c => c?.person?.name).filter(Boolean),
      seasons: list.reduce((mx, e) => Math.max(mx, e.season), 0),
      status: show.status || '',
      network: show.network?.name || show.webChannel?.name || '',
      similar: [],
      _fromTvmaze: true,
      _tmdbPoster: show.image?.original || show.image?.medium || '',
      _tvmazeUrl: show.url || '',
    };
  },

  // opts.origTitles: the title(s) this case was asked for, so a "Not this one?" choice is remembered against them
  async _exportDiscCase(data, artUrl, opts = {}) {
    if (!this._pdfOn('disc')) return;   // switched off in the card editor
    if (this._pdfBusy || !data) return;
    const kind = await this._iosChoose({
      title: 'Case Printables',
      message: 'Which case is it for?',
      options: [
        { label: 'DVD case (273 x 183 mm)', value: 'dvd' },
        { label: 'Blu-ray case (272 x 149 mm)', value: 'bluray' },
      ],
    });
    if (kind !== 'dvd' && kind !== 'bluray') return;
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    const origTitles = (opts.origTitles || []).filter(Boolean);
    let cur = (data && typeof data === 'object') ? data : null;   // the details the case is made from
    const make = async (d, art) => {
      if (this._pdfFromSession('disc|' + kind + '|' + JSON.stringify([d?.type, d?.title, d?.year, art || '']), preview)) return;
      await this._buildDiscCase({ data: d, artUrl: art, kind }, preview);
    };
    // "Not this one?": pick the right film or show, then the case is made again in the same preview
    preview.offerMatch(async () => {
      if (this._pdfBusy || preview.closed) return;
      const same = (a, b) => !!a && !!b && (a.type || 'movie') === (b.type || 'movie') && this._videoChoiceKey(a.title) === this._videoChoiceKey(b.title)
        && (!a.year || !b.year || String(a.year).slice(0, 4) === String(b.year).slice(0, 4));
      const m = await preview.pickMatch({
        title: 'Not This One?',
        message: 'Choose the right film or TV show.',
        query: origTitles[0] || cur?.title || '',
        placeholder: 'Search films & TV shows',
        thumb: 'poster',
        search: async q => {
          const res = await this._discMatchSearch(q);
          return res && res.map(x => ({ value: x, label: x.title, sub: [x.type === 'tv' ? 'TV Show' : 'Film', x.year].filter(Boolean).join(' \u00B7 '), img: x.poster, current: same(x, cur) }));
        },
      });
      if (!m || preview.closed || this._pdfBusy) return;
      this._pdfBusy = true;
      preview.reset();
      try {
        preview.status('Looking up \u201C' + m.title + '\u201D\u2026');
        const d = await this._discDataFromMatch(m);
        if (preview.closed) return;
        if (!d?.title) { preview.fail('Couldn\u2019t find the details for this title.'); return; }
        // remembered for the title(s) it was asked for, as written and as looked up
        const titles = origTitles.length ? origTitles.slice() : (cur?.title ? [cur.title] : []);
        for (const t0 of titles.slice()) {
          const c = await this._videoLookupTitle(t0, d.type === 'tv').catch(() => null);
          if (c?.title) titles.push(c.title);
        }
        this._videoChoiceSet(titles, d);
        cur = d;
        await make(d, d._tmdbPoster || m.poster || '');
      }
      catch (e) { console.warn('[Crow Media Player] Disc case printables failed', e); preview.fail('Couldn\u2019t create the case printables. Please try again.'); }
      finally { this._pdfBusy = false; }
    }, 'Choose a Different Title');
    try {
      if (typeof data === 'function') {   // only a title to go on: look its details up now
        data = await data(preview);
        if (preview.closed) return;
        if (!data?.title) { preview.fail('Couldn\u2019t find the details for this title.'); return; }
      }
      cur = data;
      await make(data, artUrl);
    }
    catch (e) { console.warn('[Crow Media Player] Disc case printables failed', e); preview.fail('Couldn\u2019t create the case printables. Please try again.'); }
    finally { this._pdfBusy = false; }
  },

  // Runtime, tagline and creators from TMDB. Needs the card's TMDB key.
  // Returns null with no key; { error } if TMDB says no.
  async _mvTmdbExtras(data) {
    if (!this._tmdbKey()) return null;
    const key = [data?.type, data?.title, data?.year, data?._tmdbUrl].join('|');
    return this._sessionMemo('tmdbx', key, () => this._mvTmdbExtrasFresh(data), { keep: v => v && !v.error });
  },

  async _mvTmdbExtrasFresh(data) {
    if (!this._tmdbKey()) return null;
    try {
      const base = 'https://api.themoviedb.org/3';
      const isTv = data.type === 'tv';
      let type = isTv ? 'tv' : 'movie', id = null;
      const m = String(data._tmdbUrl || '').match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
      if (m) { type = m[1]; id = m[2]; }
      if (!id) {
        const yr = (String(data.year || '').match(/\d{4}/) || [])[0];
        const resp = await this._tmdbFetch(base + '/search/' + type + '?query=' + encodeURIComponent(data.title || '')
          + (yr ? (type === 'tv' ? '&first_air_date_year=' : '&year=') + yr : ''));
        if (resp.status === 401) return { error: 'rejected' };
        if (!resp.ok) return { error: 'http ' + resp.status };
        const n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const results = (await resp.json()).results || [];
        const hit = results.find(r => n(r.title || r.name) === n(data.title)) || results[0];
        if (!hit) return { error: 'no match' };
        id = hit.id;
      }
      const isMovie = type === 'movie';
      const dr = await this._tmdbFetch(base + '/' + type + '/' + id
        + (isMovie ? '?append_to_response=credits,release_dates' : '?append_to_response=content_ratings'));
      if (dr.status === 401) return { error: 'rejected' };
      if (!dr.ok) return { error: 'http ' + dr.status };
      const d = await dr.json();
      const out = {
        posterPath: d.poster_path || '',
        runtime: isMovie ? (d.runtime || 0) : ((d.episode_run_time || [])[0] || 0),
        tagline: d.tagline || '',
        creators: type === 'tv' ? (d.created_by || []).map(c => c.name).filter(Boolean) : [],
      };
      if (!isMovie) {
        // TV: the age rating in the viewer's country (then UK, then US)
        const reg = (String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1]?.toUpperCase() || 'GB';
        const crs = d.content_ratings?.results || [];
        for (const r of [reg, 'GB', 'US']) {
          const hit = crs.find(x => x.iso_3166_1 === r && String(x.rating || '').trim());
          if (hit) { out.certificate = String(hit.rating).trim(); out.certRegion = r === 'GB' ? 'UK' : r; break; }
        }
        return out;
      }
      // Films: the extra details for the back of the case
      const crew = d.credits?.crew || [];
      const people = jobs => [...new Set(crew.filter(c => jobs.includes(c.job)).map(c => c.name).filter(Boolean))];
      const region = (String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1]?.toUpperCase() || 'GB';
      const certFor = r => ((d.release_dates?.results || []).find(x => x.iso_3166_1 === r)?.release_dates || [])
        .slice().sort((a, b) => (a.type || 9) - (b.type || 9)).map(x => String(x.certification || '').trim()).find(Boolean) || '';
      let certRegion = '', certificate = '';
      for (const r of [region, 'GB', 'US']) { certificate = certFor(r); if (certificate) { certRegion = r; break; } }
      const shortCountry = { 'United States of America': 'USA', 'United Kingdom': 'UK' };
      return Object.assign(out, {
        releaseDate: d.release_date || '',
        certificate, certRegion: certRegion === 'GB' ? 'UK' : certRegion,
        languages: (d.spoken_languages || []).map(l => l.english_name || l.name).filter(Boolean),
        countries: (d.production_countries || []).map(c => shortCountry[c.name] || c.name).filter(Boolean),
        studios: (d.production_companies || []).map(c => c.name).filter(Boolean),
        budget: d.budget || 0,
        revenue: d.revenue || 0,
        collection: d.belongs_to_collection?.name || '',
        directors: people(['Director']),
        writers: people(['Screenplay', 'Writer', 'Story', 'Novel', 'Author']),
        composers: people(['Original Music Composer', 'Music']),
        cinematographers: people(['Director of Photography']),
        editors: people(['Editor']),
        producers: people(['Producer']),
        castChars: (d.credits?.cast || []).slice(0, 20).map(c => ({ name: c.name || '', character: c.character || '' })).filter(c => c.name),
      });
    } catch (_) { return { error: 'network' }; }
  },

  // Key-free film lookup on the iTunes Store (in the viewer's own country, so the certificate is local):
  // poster, store blurb, certificate and runtime.
  async _mvItunesMovie(title, year) {
    return this._sessionMemo('itm', title + '|' + (year || ''), () => this._mvItunesMovieFresh(title, year));
  },

  async _mvItunesMovieFresh(title, year) {
    const region = ((String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1] || 'gb').toLowerCase();
    const n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const look = async country => {
      try {
        const r = await crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent(title) + '&media=movie&entity=movie&limit=8&country=' + country);
        if (!r.ok) return null;
        const list = ((await r.json()).results || []).filter(x => n(x.trackName) === n(title));
        return (year && list.find(x => String(x.releaseDate || '').startsWith(year))) || (year ? null : list[0]) || null;
      } catch (_) { return null; }
    };
    const hit = (await look(region)) || (region !== 'us' ? await look('us') : null);
    if (!hit) return null;
    return {
      poster: hit.artworkUrl100 ? hit.artworkUrl100.replace(/\d+x\d+bb/, '1200x1200bb') : '',
      blurb: String(hit.longDescription || '').trim(),
      certificate: String(hit.contentAdvisoryRating || '').trim(),
      certRegion: String(hit.country || '').toUpperCase() === 'GBR' ? 'UK' : String(hit.country || '').toUpperCase() === 'USA' ? 'US' : '',
      runtime: hit.trackTimeMillis ? Math.round(hit.trackTimeMillis / 60000) : 0,
    };
  },

  // Key-free TV age rating from the iTunes Store (its season listings carry one), in the viewer's own country
  async _mvItunesTvCert(title) {
    return this._sessionMemo('itv', title, () => this._mvItunesTvCertFresh(title));
  },

  async _mvItunesTvCertFresh(title) {
    const region = ((String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1] || 'gb').toLowerCase();
    const n = s => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    for (const country of [...new Set([region, 'gb'])]) {
      try {
        const r = await crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent(title) + '&media=tvShow&entity=tvSeason&limit=25&country=' + country);
        if (!r.ok) continue;
        const hit = ((await r.json()).results || []).find(x => n(x.artistName) === n(title) && x.contentAdvisoryRating);
        if (hit) return { certificate: String(hit.contentAdvisoryRating).trim(), certRegion: country === 'gb' ? 'UK' : country.toUpperCase() };
      } catch (_) {}
    }
    return null;
  },

  // Key-free film facts from Wikidata (found through the English Wikipedia article):
  // crew, studio, country, language, release date, budget, box office, awards, filming and story locations.
  async _mvWikidataFilm(title, year) {
    return this._sessionMemo('wdf', title + '|' + (year || ''), () => this._mvWikidataFilmFresh(title, year));
  },

  async _mvWikidataFilmFresh(title, year) {
    const wp = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=';
    const wd = 'https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities&';
    const getJson = async url => {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      try { const r = await crowFetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
      catch (_) { return null; } finally { clearTimeout(t); }
    };
    try {
      const names = [year ? title + ' (' + year + ' film)' : '', title + ' (film)', title].filter(Boolean);
      const pj = await getJson(wp + encodeURIComponent(names.join('|')));
      const pages = Object.values(pj?.query?.pages || {});
      // keep the order of the names we asked for (redirects / normalised titles map back to them)
      const back = {};
      (pj?.query?.normalized || []).concat(pj?.query?.redirects || []).forEach(m => { back[m.to] = back[m.from] || m.from; });
      const qids = names.map(nm => pages.find(p => (back[p.title] || p.title) === nm || p.title === nm)?.pageprops?.wikibase_item).filter(Boolean);
      const uniq = [...new Set(qids)];
      if (!uniq.length) return null;
      const ej = await getJson(wd + 'props=claims&ids=' + uniq.join('|'));
      const ents = ej?.entities || {};
      const claims = (e, p) => (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
      const yearOf = e => claims(e, 'P577').map(c => String(c.mainsnak.datavalue.value.time || '').slice(1, 5));
      // the film: has a director and (when we know it) the right year
      const qid = uniq.find(q => claims(ents[q], 'P57').length && (!year || yearOf(ents[q]).includes(String(year))))
        || uniq.find(q => claims(ents[q], 'P57').length);
      if (!qid) return null;
      const e = ents[qid];
      const ids = p => [...new Set(claims(e, p).map(c => c.mainsnak.datavalue.value?.id).filter(Boolean))];
      const want = ['P57', 'P58', 'P86', 'P344', 'P1040', 'P162', 'P272', 'P495', 'P364', 'P166', 'P915', 'P840', 'P144', 'P179', 'P1657'];
      // cast members with their character (an item via P453, or plain text via P4633)
      const castRaw = claims(e, 'P161').slice(0, 40).map(c => ({
        id: c.mainsnak.datavalue.value?.id,
        roleIds: (c.qualifiers?.P453 || []).map(q => q.datavalue?.value?.id).filter(Boolean),
        roleTxt: (c.qualifiers?.P4633 || []).map(q => q.datavalue?.value).filter(v => typeof v === 'string'),
      })).filter(c => c.id);
      const allIds = [...new Set(want.flatMap(ids).concat(castRaw.flatMap(c => [c.id].concat(c.roleIds))))].slice(0, 200);
      const label = {};
      for (let i = 0; i < allIds.length; i += 50) {
        const lj = await getJson(wd + 'props=labels&languages=en&ids=' + allIds.slice(i, i + 50).join('|'));
        Object.entries(lj?.entities || {}).forEach(([k, v]) => { if (v.labels?.en?.value) label[k] = v.labels.en.value; });
      }
      const L = p => ids(p).map(q => label[q]).filter(Boolean);
      const cur = { Q4917: '$', Q25224: '\u00A3', Q4916: 'EUR ' };
      const money = p => {
        const vals = claims(e, p).map(c => c.mainsnak.datavalue.value).filter(v => v?.amount)
          .map(v => ({ n: Math.abs(parseFloat(v.amount)), sym: cur[String(v.unit || '').split('/').pop()] || '' }))
          .filter(v => v.n > 0 && v.sym);
        if (!vals.length) return null;
        return p === 'P2142' ? vals.sort((a, b) => b.n - a.n)[0] : vals[0];   // box office: the worldwide (largest) figure
      };
      const dates = claims(e, 'P577').map(c => c.mainsnak.datavalue.value).filter(v => (v.precision || 0) >= 11)
        .map(v => String(v.time).slice(1, 11)).sort();
      const dur = claims(e, 'P2047').map(c => parseFloat(c.mainsnak.datavalue.value?.amount)).find(v => v > 0) || 0;
      const shortCountry = { 'United States of America': 'USA', 'United States': 'USA', 'United Kingdom': 'UK' };
      return {
        directors: L('P57'), writers: L('P58'), composers: L('P86'), cinematographers: L('P344'), editors: L('P1040'),
        producers: L('P162'), studios: L('P272'), countries: L('P495').map(c => shortCountry[c] || c), languages: L('P364'),
        awards: L('P166'), filmedIn: L('P915'), setIn: L('P840'), basedOn: L('P144'), series: L('P179')[0] || '',
        mpaa: (L('P1657')[0] || '').replace(/^(MPA|MPAA)\s*(rating\s*)?/i, '').replace(/\s*rating$/i, ''),
        releaseDate: dates[0] || '', runtime: Math.round(dur),
        budget: money('P2130'), revenue: money('P2142'),
        castChars: castRaw.map(c => ({ name: label[c.id] || '', character: (c.roleTxt[0] || c.roleIds.map(q => label[q]).filter(Boolean)[0] || '') }))
          .filter(c => c.name),
      };
    } catch (_) { return null; }
  },

  // The poster's most vivid colour, lifted so it reads on a dark background, for section labels: [r, g, b] or null
  async _mvAccent(blob) {
    const bmp = await createImageBitmap(blob);
    const w = 48, h = Math.max(1, Math.round(48 * bmp.height / bmp.width));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch (_) {}
    const px = ctx.getImageData(0, 0, w, h).data;
    // 24 hue buckets, weighted by saturation and by being neither too dark nor washed out
    const bins = Array.from({ length: 24 }, () => ({ wt: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const l = (mx + mn) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s < 0.35 || l < 0.18 || l > 0.85) continue;
      let hh = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh = (hh * 60 + 360) % 360;
      const wt = s * s * (1 - Math.abs(l - 0.5));
      const bin = bins[Math.floor(hh / 15) % 24];
      bin.wt += wt; bin.r += px[i] * wt; bin.g += px[i + 1] * wt; bin.b += px[i + 2] * wt;
    }
    const best = bins.reduce((a, x) => x.wt > a.wt ? x : a, { wt: 0 });
    if (best.wt < (px.length / 4) * 0.01) return null;            // a grey / black-and-white poster: no accent
    let [r, g, b] = [best.r / best.wt, best.g / best.wt, best.b / best.wt];
    // lift towards a light tint so it stays readable as small text on the dark back
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const k = L < 0.62 ? (0.62 - L) / (1 - L) : 0;
    return [r, g, b].map(v => Math.round(v + (255 - v) * k));
  },

  // wm: an ImageBitmap of the front artwork, laid faintly over the back panel (not the spine)
  _cdGradientBg(backMm, spineMm, hMm, baseRgb, accentRgb, dpi = 110, wm = null) {
    const W = Math.round((backMm + spineMm) / 25.4 * dpi), H = Math.round(hMm / 25.4 * dpi);
    const bw = Math.round(backMm / (backMm + spineMm) * W);
    const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const capLum = (c, max) => { const l = lum(c); return l > max ? c.map(v => v * max / l) : c; };
    // top: the base lifted and nudged towards the accent hue; kept dark enough for white text
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    let top = mix(baseRgb.map(v => Math.min(255, v * 1.45 + 8)), accentRgb || baseRgb, accentRgb ? 0.16 : 0);
    top = capLum(top, 0.26);
    const bot = baseRgb.map(v => v * 0.5);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      const t = Math.pow(y / (H - 1), 0.9);
      const row = mix(top, bot, t);
      for (let x = 0; x < W; x++) {
        const k = x >= bw ? 0.8 : 1, n = (Math.random() - 0.5) * 3, i = (y * W + x) * 4;
        d[i] = row[0] * k + n; d[i + 1] = row[1] * k + n; d[i + 2] = row[2] * k + n; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (wm) { try { ctx.drawImage(this._cdFadedArt(wm, bw, H, { opacity: 0.13, focusY: 0.35 }), 0, 0); } catch (_) {} }   // stops at the spine
    return c.toDataURL('image/jpeg', 0.9);
  },

  // The poster's main colour, darkened so white text reads on it: [r, g, b]
  async _mvDominant(blob) {
    const bmp = await createImageBitmap(blob);
    const w = 40, h = Math.max(1, Math.round(40 * bmp.height / bmp.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch (_) {}
    const px = ctx.getImageData(0, 0, w, h).data;
    let R = 0, G = 0, B = 0, W = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0, lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const wt = 0.05 + sat * (1 - Math.abs(lum - 0.5));
      R += r * wt; G += g * wt; B += b * wt; W += wt;
    }
    R /= W; G /= W; B /= W;
    const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    const f = L > 0.22 ? 0.22 / L : (L > 0 && L < 0.07 ? Math.min(2.5, 0.07 / L) : 1);
    const q = v => Math.max(0, Math.min(255, Math.round(v * f)));
    return [q(R), q(G), q(B)];
  },

  async _buildDiscCase({ data, artUrl, kind }, preview) {
    const title = String(data.title || '').trim();
    if (!title) { preview.fail('There\u2019s no title to look up.'); return; }
    const isTv = data.type === 'tv';
    const hasKey = !!this._tmdbKey();

    // 1 — TMDB details (only with a key) and the poster
    preview.status(hasKey ? 'Checking TMDB\u2026' : 'Finding the poster\u2026');
    const tm = await this._mvTmdbExtras(data);
    const cands = [];
    if (tm?.posterPath) cands.push({ url: 'https://image.tmdb.org/t/p/original' + tm.posterPath, src: 'TMDB' });
    else if (hasKey && data._fromTmdb && data._tmdbPoster) cands.push({ url: String(data._tmdbPoster).replace('/w500/', '/original/'), src: 'TMDB' });
    if (isTv) {
      if (data._fromTvmaze && data._tmdbPoster) cands.push({ url: data._tmdbPoster, src: 'TVmaze' });
      else {
        const tv = await this._lookupTVmazeShow(title).catch(() => null);
        if (tv?._tmdbPoster) cands.push({ url: tv._tmdbPoster, src: 'TVmaze' });
      }
    }
    // Films: key-free extras for the back (iTunes Store + Wikidata), fetched together
    let itm = null, wdf = null;
    if (!isTv) {
      preview.status('Gathering film details…');
      const bare = title.replace(/\s*\(\d{4}\)\s*$/, ''), yr = (String(data.year || '').match(/\d{4}/) || [])[0];
      [itm, wdf] = await Promise.all([
        this._mvItunesMovie(bare, yr).catch(() => null),
        this._mvWikidataFilm(bare, yr).catch(() => null),
      ]);
      if (itm?.poster) cands.push({ url: itm.poster, src: 'iTunes' });
    }
    if (preview.closed) return;
    if (artUrl) {
      const up = String(artUrl)
        .replace(/\/\d+x\d+(bb|sr)?(-\d+)?\.(jpg|png|webp)/i, (m, a, b, c) => /mzstatic/i.test(artUrl) ? '/1200x1200bb.jpg' : m)
        .replace('/medium_portrait/', '/original_untouched/').replace(/\/w(185|342|500|780)\//, '/original/');
      cands.push({ url: up, src: 'the artwork in the info panel' });
      if (up !== artUrl) cands.push({ url: artUrl, src: 'the artwork in the info panel' });
    }
    let poster = null;
    for (let i = 0; i < cands.length && !poster; i++) {
      if (preview.closed) return;
      preview.progress('Downloading the poster\u2026', i + 1, cands.length);
      const blob = await this._cdLoadBlob(cands[i].url, 2000);
      if (blob) poster = { blob, src: cands[i].src };
    }
    if (preview.closed) return;
    if (!poster) {
      preview.fail('Couldn\u2019t find a poster for \u201C' + title + '\u201D.' + (hasKey ? '' : ' Adding a TMDB key in the card editor gives the best chance.'));
      return;
    }

    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }

    // 2 — artwork at print size
    preview.status('Sizing the artwork for print\u2026');
    const bluray = kind === 'bluray';
    const CW = bluray ? 272 : 273, CH = bluray ? 149 : 183, SP = 14, PW = (CW - SP) / 2, DD = 118, HOLE = 36;
    const caseName = bluray ? 'Blu-ray' : 'DVD';
    const base = await this._mvDominant(poster.blob).catch(() => [34, 34, 40]);
    const bgCss = 'rgb(' + base.join(',') + ')';
    const spineRgb = base.map(v => Math.round(v * 0.78));
    // an accent colour from the poster for headings and spine bands, and a gradient background for the back + spine
    const accentLbl = (await this._mvAccent(poster.blob).catch(() => null)) || [200, 200, 208];
    let backdrop = null;
    // a faint copy of the poster on the back (editor -> Export & PDF -> Cover on the Back)
    const wmBmp = this._pdfOn('back_art') ? await createImageBitmap(poster.blob).catch(() => null) : null;
    try { backdrop = this._cdGradientBg(PW, SP, CH, base, accentLbl, wmBmp ? 150 : 110, wmBmp); } catch (_) {}
    try { wmBmp?.close(); } catch (_) {}
    const yearTxt = (String(data.year || '').match(/\d{4}/) || [])[0] || '';
    const front = await this._cdRender(poster.blob, PW, CH, { bg: bgCss, fade: true, focusY: 0.35 });
    const disc = await this._cdRender(poster.blob, DD, DD, { shape: 'disc', hole: HOLE, fit: 'cover', focusY: 0.3, bg: bgCss, banner: { title: title, sub: yearTxt } });

    // 2b — extra back-panel content: the season / episode guide (TV) and your own viewing stats
    const bareTitle = title.replace(/\s*\(\d{4}\)\s*$/, '');
    let epList = null;
    let tvCert = null;
    if (isTv) {
      preview.status('Fetching the episode guide\u2026');
      [epList, tvCert] = await Promise.all([
        this._tvmazeEpisodes(bareTitle).catch(() => null),
        (tm && !tm.error && tm.certificate) ? Promise.resolve(null) : this._mvItunesTvCert(bareTitle).catch(() => null),
      ]);
    }
    let guideDrawn = false;

    let detailsDrawn = false, specDrawn = false, rolesDrawn = false;

    // 3 — the PDF
    preview.status('Building the PDF\u2026');
    const lang = String(navigator.languages?.[0] || navigator.language || '');
    const pref = String(this._config?.cd_paper_size || '').toLowerCase();
    const letter = pref ? pref === 'letter' : /-(US|CA|MX|PH)\b/i.test(lang);
    const doc = new JsPDFCtor({ unit: 'mm', format: letter ? 'letter' : 'a4', orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const tight = pageW - CW < 20;
    const clean = s => String(s || '')
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
      .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/[ \t]+/g, ' ').trim();
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], lineRgb = [150, 150, 150], accentRgb = [0, 122, 255];
    const marks = (x, y, w, h) => {
      doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
      const g = tight ? 0.8 : 1.5, L = tight ? 2.5 : 4;
      [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]].forEach(([cx, cy, sx, sy]) => {
        doc.line(cx + sx * g, cy, cx + sx * (g + L), cy);
        doc.line(cx, cy + sy * g, cx, cy + sy * (g + L));
      });
    };
    const caption = (txt, y) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...mutedRgb);
      doc.text(clean(txt), pageW / 2, y, { align: 'center' });
    };

    // — page 1: the wrap, back | spine | front
    const wx = (pageW - CW) / 2, wy = (pageH - CH) / 2;
    doc.setFillColor(...base); doc.rect(wx, wy, PW + 0.2, CH, 'F');                         // back (a hair of overlap avoids white seams)
    doc.setFillColor(...spineRgb); doc.rect(wx + PW, wy, SP + 0.2, CH, 'F');                 // spine
    if (backdrop) doc.addImage(backdrop, 'JPEG', wx, wy, PW + SP + 0.2, CH, undefined, 'FAST');   // gradient over both
    doc.addImage(front.data, 'JPEG', wx + PW + SP, wy, PW, CH, undefined, 'FAST');          // front

    // back panel
    const bx = wx + 9, bw = PW - 18, bottom = wy + CH - 9;
    let by = wy + 15;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(bluray ? 16 : 18);
    const tl = doc.splitTextToSize(clean(title), bw).slice(0, 3);
    tl.forEach(l => { doc.text(l, bx, by); by += bluray ? 7 : 7.8; });
    const num = parseFloat(String(data.rating || ''));
    const pick = (...vs) => vs.find(v => v?.length) || [];
    const T = tm && !tm.error ? tm : {};
    const usd = n => n > 0 ? { n, sym: '$' } : null;
    const fx = isTv ? {} : {
      writers: pick(T.writers, wdf?.writers), composers: pick(T.composers, wdf?.composers),
      cinematographers: pick(T.cinematographers, wdf?.cinematographers), editors: pick(T.editors, wdf?.editors),
      producers: pick(T.producers, wdf?.producers), studios: pick(T.studios, wdf?.studios),
      countries: pick(T.countries, wdf?.countries), languages: pick(T.languages, wdf?.languages),
      directors: pick(T.directors, wdf?.directors),
      releaseDate: T.releaseDate || wdf?.releaseDate || '',
      certificate: T.certificate || itm?.certificate || wdf?.mpaa || '',
      certRegion: T.certificate ? T.certRegion : itm?.certificate ? itm.certRegion : wdf?.mpaa ? 'US' : '',
      budget: usd(T.budget) || wdf?.budget || null, revenue: usd(T.revenue) || wdf?.revenue || null,
      collection: T.collection || wdf?.series || '',
      basedOn: wdf?.basedOn || [], setIn: wdf?.setIn || [], filmedIn: wdf?.filmedIn || [], awards: wdf?.awards || [],
    };
    const runMin = tm?.runtime || itm?.runtime || wdf?.runtime || 0;
    const rt = runMin ? (runMin >= 60 ? Math.floor(runMin / 60) + 'h ' + (runMin % 60) + 'm' : runMin + ' min') : '';
    // the iTunes store blurb is written for the back of a box - use it when it says more than the short synopsis
    const blurb = clean(itm?.blurb || '');
    const synopsis = !isTv && blurb.length > clean(data.overview || '').length + 40 ? blurb : clean(data.overview || '');

    // section heading: accent colour, underlined across the whole heading
    const heading = (txt, x, y) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...accentLbl); doc.text(txt, x, y);
      doc.setDrawColor(...accentLbl); doc.setLineWidth(0.3); doc.line(x, y + 0.9, x + doc.getTextWidth(txt), y + 0.9);
    };
    const fitW = (txt, w) => {
      txt = String(txt || ''); if (doc.getTextWidth(txt) <= w) return txt;
      while (txt.length > 1 && doc.getTextWidth(txt + '...') > w) txt = txt.slice(0, -1);
      return txt.replace(/[\s,.;:-]+$/, '') + '...';
    };

    // spec strip along the bottom (films and TV): certificate box, then label / value columns
    let tvYears = '';
    if (isTv && epList?.length) {
      const ys = epList.map(e => +(String(e.airdate || '').match(/^\d{4}/) || [])[0]).filter(Boolean);
      if (ys.length) { const a = Math.min(...ys), b = Math.max(...ys); tvYears = a === b ? String(a) : a + ' - ' + b; }
    }
    // count the seasons in the episode guide when there is one, so the strip always agrees with it (the stored count can be out of date)
    const tvSeasons = isTv ? ((epList?.length ? new Set(epList.map(e => e.season)).size : 0) || data.seasons || 0) : 0;
    const cert = clean(isTv ? ((T.certificate || tvCert?.certificate) || '') : (fx.certificate || ''));
    const specCols = (isTv ? [
      ['RUNTIME', runMin ? runMin + ' mins' : '', 0.18],
      ['YEARS', tvYears || yearTxt, 0.22],
      ['SEASONS', tvSeasons ? String(tvSeasons) : '', 0.15],
      ['RATING', num > 0 ? num.toFixed(1) + '/10' : '', 0.15],
      ['GENRE', clean((data.genres || []).slice(0, 3).join(', ')), 0],
    ] : [
      ['RUNNING TIME', runMin ? runMin + ' mins' : '', 0.24],
      ['YEAR', yearTxt, 0.14],
      ['RATING', num > 0 ? num.toFixed(1) + '/10' : '', 0.17],
      ['GENRE', clean((data.genres || []).slice(0, 3).join(', ')), 0],
    ]).filter(c => c[1]);
    const caseMk = this._caseMarksOn();
    const caseLines = bluray ? ['BLU-RAY', 'DISC'] : ['DVD', 'VIDEO'];
    const caseMkW = caseMk ? this._pdfFormatMark(doc, 0, 0, { r: 2.9, lines: caseLines, fs: 6.2, measure: true }) : 0;
    const STRIP = (cert || specCols.length || caseMk) ? 13.5 : 0;
    const textBottom = bottom - STRIP;
    const drawStrip = () => {
      if (!STRIP) return;
      doc.setDrawColor(...accentLbl); doc.setLineWidth(0.25);
      doc.line(bx, bottom - 10, bx + bw, bottom - 10);
      let cx0 = bx;
      if (cert) {
        let fsz = 11;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(fsz);
        while (fsz > 6 && doc.getTextWidth(cert) > 14) { fsz -= 0.5; doc.setFontSize(fsz); }
        const boxW = Math.max(8, doc.getTextWidth(cert) + 3.5);
        doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.45);
        doc.roundedRect(bx, bottom - 8, boxW, 8, 1, 1, 'S');
        doc.setTextColor(255, 255, 255);
        doc.text(cert, bx + boxW / 2, bottom - 4 + fsz * 0.353 * 0.36, { align: 'center' });
        cx0 = bx + boxW + 4;
      }
      // the format mark sits at the right-hand end of the strip
      const right = bx + bw - (caseMk ? caseMkW + 4 : 0);
      if (caseMk) this._pdfFormatMark(doc, bx + bw - caseMkW, bottom - 4, { r: 2.9, lines: caseLines, rgb: [255, 255, 255], fs: 6.2 });
      const W = right - cx0;
      specCols.forEach(([lab, val, frac]) => {
        const w = frac ? W * frac : (right - cx0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(200, 200, 208);
        doc.text(lab, cx0, bottom - 5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        doc.text(fitW(val, w - 2), cx0, bottom - 1);
        cx0 += w;
      });
      specDrawn = true;
    };

    if (isTv) {
      if (tm?.tagline) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
        doc.splitTextToSize(clean(tm.tagline), bw).slice(0, 2).forEach(l => { doc.text(l, bx, by); by += 4.4; });
        by += 3;
      }
      // cast and director anchor to the bottom of the panel
      const castTxt = (data.cast || []).slice(0, 8).join(', ');
      const dirTxt = data.director || (fx.directors || []).slice(0, 2).join(', ') || (tm?.creators || []).join(', ');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const castLines = castTxt ? doc.splitTextToSize(clean(castTxt), bw).slice(0, 3) : [];
      const dirLines = dirTxt ? doc.splitTextToSize(clean(dirTxt), bw).slice(0, 2) : [];
      const blockH = (castLines.length ? 5 + castLines.length * 4.2 + 3 : 0) + (dirLines.length ? 5 + dirLines.length * 4.2 : 0);

      if (synopsis) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
        const lines = doc.splitTextToSize(synopsis, bw);
        const room = Math.max(0, Math.floor((textBottom - blockH - 4 - by) / 4.5));
        const shown = lines.slice(0, room);
        if (lines.length > room && shown.length) {
          let last = shown[shown.length - 1];
          while (last.length > 1 && doc.getTextWidth(last + '...') > bw) last = last.slice(0, -1);
          shown[shown.length - 1] = last.replace(/[\s,.;:-]+$/, '') + '...';
        }
        shown.forEach(l => { doc.text(l, bx, by); by += 4.5; });
      }
      const castTop = textBottom - blockH + 4;

      // Season / episode guide (TV): fills the space between the synopsis and the cast
      if (isTv && epList?.length) {
        const unesc = t => String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const bySeason = new Map();
        epList.forEach(e => { if (!bySeason.has(e.season)) bySeason.set(e.season, []); bySeason.get(e.season).push(e); });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        // Episode titles are wrapped whole (a title only breaks when it's wider than the column on its own),
        // so no line starts with a dot or splits a title. Each line is a list of titles.
        const SEP = '  \u00B7  ';
        // Lines are balanced, like a book: the same number of lines as simply filling each one, but with the
        // breaks chosen so every line is close to full width, then justified edge to edge. The last line of
        // each season stays left-aligned.
        const wrapTitles = (titles, w, balanced = true) => {
          const sepW = doc.getTextWidth(SEP);
          const items = [];   // { t, w, brk } - brk: a long title's first part(s), which must end its line
          titles.forEach(ti => {
            const parts = doc.getTextWidth(ti) > w ? doc.splitTextToSize(ti, w) : [ti];
            parts.forEach((p, pi) => items.push({ t: p, w: doc.getTextWidth(p), brk: pi < parts.length - 1 }));
          });
          const n = items.length;
          if (!n) return [];
          const natural = (i, j) => { let s = 0; for (let k = i; k < j; k++) s += items[k].w; return s + (j - i - 1) * sepW; };
          const ok = (i, j) => { for (let k = i; k < j - 1; k++) if (items[k].brk) return false; return natural(i, j) <= w + 0.01 || j - i === 1; };
          // how many lines simply filling each one takes
          let lines = 0;
          for (let i = 0; i < n;) { let j = i + 1; while (j < n && !items[j - 1].brk && ok(i, j + 1)) j++; lines++; i = j; }
          if (!balanced) {   // a list that will be cut short: just fill each line, so the lines shown are full
            const out = [];
            for (let i = 0; i < n;) { let j = i + 1; while (j < n && !items[j - 1].brk && ok(i, j + 1)) j++; out.push(items.slice(i, j).map(x => x.t)); i = j; }
            return out;
          }
          // fewest "badness" (squared leftover space, last line free) in exactly that many lines
          const INF = 1e18;
          const best = Array.from({ length: n + 1 }, () => new Array(lines + 1).fill(INF));
          const from = Array.from({ length: n + 1 }, () => new Array(lines + 1).fill(-1));
          best[0][0] = 0;
          for (let j = 1; j <= n; j++) for (let L = 1; L <= lines; L++) for (let i = j - 1; i >= 0; i--) {
            if (!ok(i, j)) break;
            if (best[i][L - 1] >= INF) continue;
            const slack = w - natural(i, j);
            const c = best[i][L - 1] + (j === n ? 0 : slack * slack * (j - i === 1 ? 4 : 1));
            if (c < best[j][L]) { best[j][L] = c; from[j][L] = i; }
          }
          const out = [];
          if (best[n][lines] >= INF) {   // shouldn't happen; fill lines in order
            for (let i = 0; i < n;) { let j = i + 1; while (j < n && !items[j - 1].brk && ok(i, j + 1)) j++; out.push(items.slice(i, j).map(x => x.t)); i = j; }
            return out;
          }
          for (let j = n, L = lines; L > 0; L--) { const i = from[j][L]; out.unshift(items.slice(i, j).map(x => x.t)); j = i; }
          return out;
        };
        // Draws one line of titles, justified unless it's a season's last line: the leftover space is shared
        // between the gaps, with the dot centred in each. A line that would stretch too far stays as it is.
        const drawTitles = (titles, x, y, w, justify) => {
          const sepW = doc.getTextWidth(SEP), dotW = doc.getTextWidth('·');
          const widths = titles.map(ti => doc.getTextWidth(ti));
          const textW = widths.reduce((a, b) => a + b, 0);
          let gap = sepW;
          if (justify && titles.length > 1) {
            const g = (w - textW) / (titles.length - 1);
            if (g >= sepW && g <= sepW * 4) gap = g;
          }
          let cx = x;
          titles.forEach((ti, i) => {
            if (i) { doc.text('·', cx + (gap - dotW) / 2, y); cx += gap; }
            doc.text(ti, cx, y);
            cx += widths[i];
          });
        };
        const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => {
          list.sort((a, b) => a.ep - b.ep);
          const yr = ((list.find(e => e.airdate)?.airdate || '').match(/^\d{4}/) || [])[0] || '';
          const titleList = list.map(e => clean(unesc(e.title))).filter(Boolean);
          return { n, count: list.length, yr, titleList, lines: wrapTitles(titleList, bw) };
        });
        const gy0 = by + 5, headH = 7;
        const avail = (castTop - 6) - gy0 - headH;

        // Every episode title in full if at all possible: try one column with gradually smaller text,
        // then two columns of seasons, before falling back to shortened lines.
        const COLGAP = 5;
        const layout = (fs, ncol) => {
          const k = fs / 7, lh = 3.1 * k, hh = 3.9 * k, gap = 2.4 * k;
          const cw = ncol === 1 ? bw : (bw - COLGAP) / 2;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
          const blocks = seasons.map(x => ({ ...x, lines: wrapTitles(x.titleList, cw) }));
          const bh = x => hh + x.lines.length * lh + gap;
          const sum = arr => arr.reduce((t, x) => t + bh(x), 0);
          let cols = [blocks];
          if (ncol === 2 && blocks.length > 1) {
            let best = null;
            for (let i = 1; i < blocks.length; i++) {
              const h = Math.max(sum(blocks.slice(0, i)), sum(blocks.slice(i)));
              if (!best || h < best.h) best = { i, h };
            }
            cols = [blocks.slice(0, best.i), blocks.slice(best.i)];
          }
          return { fs, k, lh, hh, gap, cw, cols, h: Math.max(...cols.map(sum)) - gap };
        };
        const tries = [[7, 1], [6.6, 1], [6.2, 1], [6.4, 2], [5.8, 1], [6, 2], [5.6, 2], [5.3, 2]];
        let fit = null;
        if (avail >= 12) for (const [fs, nc] of tries) { const L = layout(fs, nc); if (L.h <= avail) { fit = L; break; } }
        // Too many episodes to list them all (long-running shows): every season still gets a shortened list,
        // its last line ending in "...". One or two columns, whichever shows the most.
        if (!fit && avail >= 12 && seasons.length) {
          let bestS = null;
          for (const [fs, nc] of [[6.6, 1], [6.2, 1], [6.2, 2], [5.8, 2], [5.4, 2]]) {
            if (nc === 2 && seasons.length < 2) continue;
            const k = fs / 7, lh = 3.1 * k, hh = 3.9 * k, gap = 2.4 * k;
            const cw = nc === 1 ? bw : (bw - COLGAP) / 2;
            const rows = Math.ceil(seasons.length / nc);
            const per = Math.floor((avail - rows * (hh + gap) + gap) / (rows * lh));
            if (per < 1) continue;
            const room = per * cw / fs;   // how much of each season's list fits, roughly
            if (!bestS || room > bestS.room) bestS = { fs, k, lh, hh, gap, cw, nc, rows, per, room };
          }
          if (bestS) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(bestS.fs);
            const blocks = seasons.map(x => {
              let lines = wrapTitles(x.titleList, bestS.cw);
              if (lines.length > bestS.per) {
                lines = wrapTitles(x.titleList, bestS.cw, false);
                const last = lines[bestS.per - 1].slice();
                const lw = arr => doc.getTextWidth(arr.join(SEP));
                while (last.length > 1 && lw(last.concat('...')) > bestS.cw) last.pop();
                lines = lines.slice(0, bestS.per - 1).concat([last.concat('...')]);
              }
              return { ...x, lines };
            });
            const cols = [];
            for (let i = 0; i < blocks.length; i += bestS.rows) cols.push(blocks.slice(i, i + bestS.rows));
            const sum = arr => arr.reduce((h, x) => h + bestS.hh + x.lines.length * bestS.lh + bestS.gap, 0);
            fit = { fs: bestS.fs, k: bestS.k, lh: bestS.lh, hh: bestS.hh, gap: bestS.gap, cw: bestS.cw, cols, h: Math.max(...cols.map(sum)) - bestS.gap };
          }
        }

        if (fit) {
          // Room to spare: open the lines and the gaps between seasons up a little (within limits), so the
          // guide sits evenly in the space instead of bunching at the top
          {
            const tall = fit.cols.reduce((a, c) => (c.reduce((s, x) => s + x.lines.length, 0) > a.reduce((s, x) => s + x.lines.length, 0) ? c : a), fit.cols[0]);
            const nLines = tall.reduce((s, x) => s + x.lines.length, 0), nGaps = Math.max(1, tall.length - 1);
            let spare = avail - fit.h;
            if (spare > 1) {
              const addL = Math.min(fit.lh * 0.22, (spare * 0.5) / Math.max(1, nLines));
              spare -= addL * nLines; fit.lh += addL;
              fit.gap += Math.min(3.5 * fit.k, Math.max(0, spare * 0.6) / nGaps);
            }
          }
          heading('EPISODE GUIDE', bx, gy0 + 2.5);
          fit.cols.forEach((col, ci) => {
            const cx = bx + ci * (fit.cw + COLGAP);
            let gy = gy0 + headH + 1.5;
            col.forEach(x => {
              const head = 'SEASON ' + x.n;
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5 * fit.k); doc.setTextColor(255, 255, 255);
              doc.text(head, cx, gy);
              const hw = doc.getTextWidth(head);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7 * fit.k); doc.setTextColor(200, 200, 208);
              doc.text('  ' + x.count + (x.count === 1 ? ' episode' : ' episodes') + (x.yr ? '  -  ' + x.yr : ''), cx + hw, gy);
              doc.setFontSize(fit.fs); doc.setTextColor(222, 222, 228);
              x.lines.forEach((l, j) => drawTitles(l, cx, gy + 3.5 * fit.k + j * fit.lh, fit.cw, j < x.lines.length - 1));
              gy += fit.hh + x.lines.length * fit.lh + fit.gap;
            });
          });
          guideDrawn = true;
        } else {
          const fullH = seasons.reduce((t, x) => t + 3.9 + x.lines.length * 3.1 + 2.4, 0);
          const shortH = seasons.length * (3.9 + 3.1 + 2.4);
          let ROW = 4.3;
          const mode = fullH <= avail ? 'full' : shortH <= avail ? 'short' : seasons.length * ROW <= avail ? 'compact' : 'cut';
          if (mode === 'compact') ROW = Math.min(6.5, avail / seasons.length);   // spread rows out to use the space
          const maxRows = Math.floor(avail / ROW);
          // as many lines per season as the space allows (at least one), the last one ending in ...
          const perSeason = Math.max(1, Math.floor((avail - seasons.length * (3.9 + 2.4)) / (seasons.length * 3.1)));
          if (mode === 'short') seasons.forEach(x => {
            if (x.lines.length > perSeason) {
              // the last line shown ends in "..." in place of the titles that don't fit
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
              const lineW = arr => doc.getTextWidth(arr.join(SEP));
              const last = x.lines[perSeason - 1].slice();
              while (last.length > 1 && lineW(last.concat('...')) > bw) last.pop();
              x.lines = x.lines.slice(0, perSeason - 1).concat([last.concat('...')]);
              x.cut = true;
            }
          });
          if (avail >= 12 && (mode !== 'cut' || maxRows >= 2)) {
            heading('EPISODE GUIDE', bx, gy0 + 2.5);
            let gy = gy0 + headH + 1.5;
            const shown = mode === 'cut' && seasons.length > maxRows ? seasons.slice(0, maxRows - 1) : seasons;
            shown.forEach(x => {
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
              const head = 'SEASON ' + x.n;
              doc.text(head, bx, gy);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(200, 200, 208);
              doc.text('  ' + x.count + (x.count === 1 ? ' episode' : ' episodes') + (x.yr ? '  -  ' + x.yr : ''), bx + (() => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); const w = doc.getTextWidth(head); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); return w; })(), gy);
              if (mode === 'full' || mode === 'short') {
                doc.setTextColor(222, 222, 228);
                x.lines.forEach((l, k) => drawTitles(l, bx, gy + 3.5 + k * 3.1, bw, k < x.lines.length - 1));
                gy += 3.9 + x.lines.length * 3.1 + 2.4;
              } else gy += ROW;
            });
            if (shown.length < seasons.length) {
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(200, 200, 208);
              const more = seasons.length - shown.length;
              doc.text('+ ' + more + ' more season' + (more === 1 ? '' : 's'), bx, gy);
            }
            guideDrawn = true;
          }
        }
      }

      let cy = castTop;
      if (castLines.length) {
        heading('STARRING', bx, cy); cy += 4.4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        castLines.forEach(l => { doc.text(l, bx, cy); cy += 4.2; });
        cy += 3;
      }
      if (dirLines.length) {
        heading('CREATED BY', bx, cy); cy += 4.4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        dirLines.forEach(l => { doc.text(l, bx, cy); cy += 4.2; });
      }
    } else {

      // ——— Films: synopsis, film details, a one-column cast with characters, director, then a spec strip ———
      if (tm?.tagline) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
        doc.splitTextToSize(clean(tm.tagline), bw).slice(0, 2).forEach(l => { doc.text(l, bx, by); by += 4.4; });
        by += 3;
      }
      const wrapN = (txt, w, n) => {
        const ls = doc.splitTextToSize(txt, w);
        if (ls.length <= n) return ls;
        let last = ls[n - 1];
        while (last.length > 1 && doc.getTextWidth(last + '...') > w) last = last.slice(0, -1);
        return ls.slice(0, n - 1).concat(last.replace(/[\s,.;:-]+$/, '') + '...');
      };
      const fit = (txt, w) => wrapN(txt, w, 1)[0] || '';
      const fmtMoney = m => !m?.n ? '' : m.sym + (m.n >= 1e9 ? (m.n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' billion' : m.n >= 1e6 ? Math.round(m.n / 1e6) + ' million' : Math.round(m.n).toLocaleString());
      const fmtDate = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
      const few = (a, n) => (a || []).slice(0, n).join(', ');
      const label = heading;


      // cast in one column, with the character each actor plays when it is known
      const nk = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const roleOf = new Map();
      [...(T.castChars || []), ...(wdf?.castChars || [])].forEach(c => {
        const role = String(c.character || '').replace(/\s*\((uncredited|voice)\)\s*/gi, ' ').trim();
        if (role && !roleOf.has(nk(c.name))) roleOf.set(nk(c.name), role);
      });
      const castNames = (data.cast || []).length ? data.cast : (T.castChars?.length ? T.castChars : (wdf?.castChars || [])).map(c => c.name);
      const castRows = castNames.slice(0, 8).map(n => ({ name: clean(n), role: clean(roleOf.get(nk(n)) || '') })).filter(r => r.name);
      const dirTxt = data.director || few(fx.directors, 2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const dirLines = dirTxt ? doc.splitTextToSize(clean(dirTxt), bw).slice(0, 2) : [];
      const castH = n => n ? 4.4 + n * 4.2 + 3 : 0;
      const dirH = dirLines.length ? 4.4 + dirLines.length * 4.2 : 0;
      const castTopFor = n => textBottom - castH(n) - dirH + 4;   // baseline of the STARRING label
      const minCast = Math.min(4, castRows.length);

      // synopsis (the fuller iTunes Store blurb when there is one)
      if (synopsis) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
        const lines = doc.splitTextToSize(synopsis, bw);
        const room = Math.max(0, Math.floor((castTopFor(minCast) - 8 - by) / 4.5));
        const shown = lines.slice(0, room);
        if (lines.length > room && shown.length) {
          let last = shown[shown.length - 1];
          while (last.length > 1 && doc.getTextWidth(last + '...') > bw) last = last.slice(0, -1);
          shown[shown.length - 1] = last.replace(/[\s,.;:-]+$/, '') + '...';
        }
        shown.forEach(l => { doc.text(l, bx, by); by += 4.5; });
      }

      // film details: two columns of label / value
      const items = [
        ['WRITTEN BY', few(fx.writers, 3)],
        ['MUSIC BY', few(fx.composers, 2)],
        ['CINEMATOGRAPHY', few(fx.cinematographers, 2)],
        ['PRODUCED BY', few(fx.producers, 3)],
        ['STUDIO', few(fx.studios, 3)],
        ['RELEASED', fmtDate(fx.releaseDate)],
        ['COUNTRY', few(fx.countries, 3)],
        ['LANGUAGE', few(fx.languages, 3)],
        ['BOX OFFICE', fmtMoney(fx.revenue)],
        ['BUDGET', fmtMoney(fx.budget)],
      ].filter(x => x[1]);
      const HEAD = 6, LH = 3.8, colW = bw / 2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const cells = items.map(([l, v]) => ({ l, lines: wrapN(clean(v), colW - 4, 2) }));
      const rows = [];
      for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
      const rowH = r => 2.3 + Math.max(...r.map(c => c.lines.length)) * LH + 2.4;
      const rowsH = n => n ? HEAD + rows.slice(0, n).reduce((t, r) => t + rowH(r), 0) : 0;
      const midTop = by + 5;
      const fitRows = space => { let n = 0; while (n < rows.length && rowsH(n + 1) <= space) n++; return n; };
      // the whole cast first, but give up cast lines (down to five) so at least two rows of details fit
      let castN = castRows.length;
      while (castN > minCast && castTopFor(castN) - 8 < midTop) castN--;
      let nRows = fitRows(castTopFor(castN) - 8 - midTop);
      while (nRows < Math.min(2, rows.length) && castN > Math.max(minCast, 5)) { castN--; nRows = fitRows(castTopFor(castN) - 8 - midTop); }
      const castTop = castTopFor(castN);

      if (nRows) {
        const avail = castTop - 8 - midTop, slack = Math.max(0, avail - rowsH(nRows));
        const rowPad = Math.min(1.6, slack * 0.4 / nRows);              // loosen the rows a little when there is room
        let y = midTop + Math.min(9, (slack - rowPad * nRows) / 2);      // and centre the panel in the gap
        label('FILM DETAILS', bx, y + 2.5);
        y += HEAD;
        rows.slice(0, nRows).forEach(r => {
          r.forEach((c, i) => {
            const cx = bx + i * colW;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(200, 200, 208);
            doc.text(c.l, cx, y + 2.3);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
            c.lines.forEach((l, k) => doc.text(l, cx, y + 2.3 + LH + k * LH));
          });
          y += rowH(r) + rowPad;
        });
        detailsDrawn = true;
      }

      let cy = castTop;
      if (castN) {
        label('STARRING', bx, cy); cy += 4.4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        const shownCast = castRows.slice(0, castN);
        // characters only when most of the cast have one - a lone character name looks stranded in its own column
        const anyRole = shownCast.filter(r => r.role).length >= Math.max(2, Math.ceil(shownCast.length * 0.6));
        if (!anyRole) shownCast.forEach(r => { r.role = ''; });
        const nameW = anyRole ? Math.min(bw * 0.5, Math.max(...shownCast.map(r => doc.getTextWidth(r.name))) + 6) : bw;
        shownCast.forEach(r => {
          doc.setTextColor(255, 255, 255);
          doc.text(fit(r.name, nameW - 2), bx, cy);
          if (r.role) { doc.setTextColor(200, 200, 208); doc.text(fit(r.role, bw - nameW), bx + nameW, cy); }
          cy += 4.2;
        });
        if (anyRole) rolesDrawn = true;
        cy += 3;
      }
      if (dirLines.length) {
        label('DIRECTED BY', bx, cy); cy += 4.4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        dirLines.forEach(l => { doc.text(l, bx, cy); cy += 4.2; });
      }

    }

    drawStrip();

    // spine: the title, reading top to bottom
    const spineMkLen = caseMk ? this._pdfSpineMark(doc, 0, 0, { label: bluray ? 'BLU-RAY' : 'DVD', r: 2.2, fs: 6.2, measure: true }) : 0;
    const bandT = 6, bandB = caseMk ? spineMkLen + 9 : 10;   // margins kept clear at the top and bottom of the spine (room for the format mark)
    let fs = 12;
    doc.setFont('helvetica', 'bold');
    const spineTxt = clean(title);
    doc.setFontSize(fs);
    while (fs > 6 && doc.getTextWidth(spineTxt) > CH - bandT - bandB - 10) { fs -= 0.5; doc.setFontSize(fs); }
    doc.setTextColor(255, 255, 255);
    doc.text(spineTxt, wx + PW + SP / 2 - fs * 0.353 * 0.36, wy + bandT + 5, { angle: -90 });
    if (caseMk) this._pdfSpineMark(doc, wx + PW + SP / 2, wy + CH - 6, { label: bluray ? 'BLU-RAY' : 'DVD', r: 2.2, fs: 6.2, rgb: accentLbl, dir: 'down' });

    marks(wx, wy, CW, CH);
    doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
    [wx + PW, wx + PW + SP].forEach(fx => { doc.line(fx, wy - 1.5, fx, wy - (tight ? 4 : 5.5)); doc.line(fx, wy + CH + 1.5, fx, wy + CH + (tight ? 4 : 5.5)); });
    const wrapNote = caseName + ' case wrap ' + CW + ' x ' + CH + ' mm  -  back | spine | front  -  fold at the ticks';

    // — page 2: the disc label
    doc.addPage();
    const dx = (pageW - DD) / 2, dy = (pageH - DD) / 2 - 3;
    doc.addImage(disc.data, 'JPEG', dx, dy, DD, DD, undefined, 'FAST');
    // below the title, over the label's own dark fade
    if (caseMk) this._pdfDiscMark(doc, dx + DD / 2, dy + DD / 2, DD / 2, bluray ? 'BLU-RAY' : 'DVD', { onArt: false, inset: 6.2 });
    doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
    doc.circle(dx + DD / 2, dy + DD / 2, DD / 2 + 0.4, 'S');
    doc.circle(dx + DD / 2, dy + DD / 2, HOLE / 2 - 0.3, 'S');
    caption('Disc label - 118 mm, centre hole 36 mm', dy + DD + 6);

    // — last page: what was used, and how to print
    doc.addPage();
    const mx = 18, cw = pageW - mx * 2;
    let ny = 22;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...inkRgb);
    doc.splitTextToSize(clean(title), cw).slice(0, 2).forEach(l => { doc.text(l, mx, ny); ny += 8; });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...accentRgb);
    doc.text(caseName + ' case printables' + (yearTxt ? '  -  ' + yearTxt : ''), mx, ny); ny += 5;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(0.6); doc.line(mx, ny, pageW - mx, ny); ny += 9;
    const para = (head, body) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
      doc.text(clean(head), mx, ny); ny += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 67);
      doc.splitTextToSize(clean(body), cw).forEach(l => { doc.text(l, mx, ny); ny += 4.6; });
      ny += 3.5;
    };
    const dpiNote = front.dpi && front.dpi < 200 ? ' The poster is low resolution (about ' + front.dpi + ' dpi at this size), so the print will look a little soft.' : '';
    para('Poster', 'From ' + poster.src + '.' + dpiNote
      + (front.mode === 'contain' ? ' The poster is narrower than the front panel, so it is shown whole and blended into the poster colour at the sides.' : ' The poster is slightly cropped at the edges to fill the front panel.'));
    if (poster.src !== 'TMDB') {
      if (!hasKey) para('Sharper posters', 'No TMDB key is set in the card editor, so TMDB was skipped and only key-free sources were used. Adding a free TMDB key gives high-resolution posters and the runtime and tagline on the back.');
      else if (tm?.error) para('TMDB', 'A TMDB key is set but the lookup failed (' + (tm.error === 'rejected' ? 'the key was rejected - check it in the card editor' : tm.error) + '), so another source was used.');
      else para('TMDB', 'TMDB did not have a poster for this title, so another source was used.');
    }
    para('Colours and text', 'The back and spine use a gradient built from the poster colours, and the headings use the poster\'s most vivid colour. The back is made from this title\'s details: ' + [synopsis ? (synopsis === blurb ? 'synopsis (iTunes Store)' : 'synopsis') : '', (data.cast || []).length ? 'cast' : '', (data.director || tm?.creators?.length) ? (isTv ? 'creator' : 'director') : '', rt ? 'runtime' : '', tm?.tagline ? 'tagline' : '', guideDrawn ? 'episode guide' : '', rolesDrawn ? 'character names' : '', detailsDrawn ? 'film details' : '', specDrawn ? 'certificate and running time' : ''].filter(Boolean).join(', ') + '.');
    if (detailsDrawn && (wdf || itm)) para('Film details', 'Gathered from ' + [tm && !tm.error ? 'TMDB' : '', wdf ? 'Wikidata' : '', itm ? 'the iTunes Store' : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') + '. Only the details that fit on the back are shown.');
    para('Printing', 'Print at 100% / "Actual size" - not "Fit to page" - so the wrap comes out at the real size. Paper: ' + (letter ? 'US Letter' : 'A4') + ', landscape. Cut along the corner marks and fold at the two small ticks so the spine sits on the case edge. The disc label has a circle and a centre hole to cut out.'
      + (tight ? ' US Letter is only a few millimetres wider than the wrap, so a printer that cannot print right to the edge may clip it - A4 or Legal paper is a safer fit.' : ''));
    para('Sizes', 'DVD (Amaray) wrap 273 x 183 mm and Blu-ray wrap 272 x 149 mm, both with a 14 mm spine. Slim and other case styles are different sizes.');

    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...mutedRgb);
      doc.text(p === 1 ? 'Print at 100% (Actual size)  -  ' + wrapNote : p < pageCount ? 'Print at 100% (Actual size)' : 'Crow Media Player', 12, pageH - 4);
      doc.text('Page ' + p + ' of ' + pageCount, pageW - 12, pageH - 4, { align: 'right' });
    }
    if (preview.closed) return;
    const slug = clean(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'title';
    this._showPDFPreview(doc, 'crow-media-' + kind + '-case-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // Lazily loads jsPDF from a CDN the first time a PDF is exported. Cached as a promise;
  // a failed load can be retried.
  _ensureJsPDF(preview = null) {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    preview?.status?.('Loading the PDF tools\u2026');
    if (this._jsPDFLoadPromise) return this._jsPDFLoadPromise;
    this._jsPDFLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
        else { this._jsPDFLoadPromise = null; reject(new Error('jsPDF failed to initialise')); }
      };
      script.onerror = () => { this._jsPDFLoadPromise = null; reject(new Error('Could not load the PDF library \u2014 check your internet connection')); };
      document.head.appendChild(script);
    });
    return this._jsPDFLoadPromise;
  },

  // ════════════════════════════════════════════════════════════════════════════
  // DISCOGS FALLBACK — optional, opt-in lookup used only when AI has nothing
  // (see _showAITrackInfo's _notFound branch). A match is converted into the
  // same shape as a genuine AI result and rendered through that exact same
  // template, so there's only ever one "AI Info" look — never a second,
  // differently-styled panel stacked underneath.
  // ════════════════════════════════════════════════════════════════════════════

  // Read a Discogs result from localStorage. Returns the cached entry or null.
  _discogsFbLocalGet(cacheKey) {
    try {
      const raw = localStorage.getItem('crow_media_discogs_fb_store_v3');
      if (!raw) return null;
      const store = JSON.parse(raw);
      const entry = store[cacheKey];
      if (!entry) return null;
      const ttlMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (Date.now() - (entry.ts || 0) > ttlMs) {
        delete store[cacheKey];
        try { localStorage.setItem('crow_media_discogs_fb_store_v3', JSON.stringify(store)); } catch (_) {}
        return null;
      }
      return entry.result;
    } catch (_) { return null; }
  },

  // Write a Discogs result to localStorage, keeping at most 50 entries (LRU eviction).
  _discogsFbLocalSet(cacheKey, result) {
    try {
      let store = {};
      try {
        const raw = localStorage.getItem('crow_media_discogs_fb_store_v3');
        if (raw) store = JSON.parse(raw);
      } catch (_) {}
      const keys = Object.keys(store);
      if (keys.length >= 50) {
        keys.sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0));
        keys.slice(0, keys.length - 49).forEach(k => delete store[k]);
      }
      store[cacheKey] = { result, ts: Date.now() };
      localStorage.setItem('crow_media_discogs_fb_store_v3', JSON.stringify(store));
    } catch (_) {}
  },

  // Looks up the given track's release on Discogs, returning the best-matching
  // release (with tracklist/community/images filled in) or null if nothing
  // scored above zero. Unlike a "confident match only" search, this picks the
  // top-scoring result even when ambiguous — there's no picker UI here, since
  // this only ever backs a fallback panel styled to look identical to AI Info,
  // and a good-enough answer beats another empty state.
  async _lookupDiscogsForAIData(artist, album, trackTitle) {
    if (!artist && !album && !trackTitle) return null;

    const clean = (s) => (s || '')
      .replace(/\s*[\(\[]\s*(\d{4}\s*)?(remaster(ed)?|re-?master(ed)?|live|deluxe|edition|version|anniversary|bonus|extended|explicit|radio edit|single)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*-\s*(\d{4}\s*)?(remaster(ed)?|live( version)?|single( version)?)$/gi, '')
      .trim();
    const cleanArtist = clean(artist);
    const cleanAlbum  = clean(album);
    const cleanTrack  = clean(trackTitle);
    if (!cleanArtist && !cleanAlbum && !cleanTrack) return null;

    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const isCoverRelease = (r) => /\b(cover|covers|tribute|tributes|karaoke|as made famous|in the style of)\b/.test((r.title || '').toLowerCase());
    // Discogs disambiguates same-named artists with a trailing "(3)" style
    // suffix on some releases but not others — stripping it before comparing
    // means an exact-artist match doesn't accidentally score lower on
    // whichever candidate happens to carry that suffix.
    const stripDisambig = (s) => (s || '').replace(/\s*\(\d+\)\s*$/, '');
    const resultArtists = (r) => {
      const fromTitle = stripDisambig((r.title || '').split(' - ')[0]);
      const fromArr = Array.isArray(r.artist) ? r.artist.map(a => stripDisambig(typeof a === 'string' ? a : a?.name || '')).filter(Boolean) : [];
      return [fromTitle, ...fromArr];
    };
    const scoreResult = (r) => {
      if (isCoverRelease(r)) return -5;
      const a = norm(cleanArtist);
      if (!a) return 1;
      const normed = resultArtists(r).map(norm);
      if (Array.isArray(r.artist) && r.artist.length) {
        const arrNormed = r.artist.map(x => norm(stripDisambig(typeof x === 'string' ? x : x?.name || '')));
        if (arrNormed.includes(a)) return 4;
        if (arrNormed.some(ra => ra.includes(a) || a.includes(ra))) return 3;
      }
      if (normed[0] === a) return 3;
      if (normed.some(ra => ra.includes(a) || a.includes(ra))) return 2;
      return 0;
    };
    const popularityBonus = (r) => {
      const have = r.community?.have ?? 0;
      return have > 5000 ? 0.9 : have > 1000 ? 0.6 : have > 200 ? 0.3 : 0;
    };
    // When there's no album to search by, artist+track alone often surfaces
    // a same-named single/EP ahead of the fuller album that also contains
    // this track — Discogs' own relevance ranking favors an exact title
    // match on the release itself. Nudge scoring back toward the album,
    // using the format descriptors search stubs already include (no extra
    // API call needed) as a cheap signal for release type.
    const formatBonus = (r) => {
      const fmts = (r.format || []).map(f => (f || '').toLowerCase());
      if (fmts.some(f => f.includes('album'))) return 0.75;
      if (fmts.some(f => f.includes('single') || f.includes('ep'))) return -0.75;
      return 0;
    };
    // Format descriptors are often useless for modern digital-only releases
    // (Discogs just says "File, MP3" for a single and an album alike), so
    // formatBonus alone doesn't reliably distinguish them. A release whose
    // own title (after the "Artist - " prefix) is literally the track name
    // we're searching for is very likely a single/promo named after that one
    // song — penalize that case regardless of format, which works whether
    // it's vinyl, CD, or digital.
    const selfTitledPenalty = (r) => {
      if (!cleanTrack) return 0;
      const relTitle = (r.title || '').split(' - ').slice(1).join(' - ') || r.title || '';
      return norm(relTitle) === norm(cleanTrack) ? -1.25 : 0;
    };

    // Without a known album, every track by this artist would otherwise share
    // one cache key — meaning whichever track got looked up first "wins" and
    // its (often wrong, single-release) match gets silently reused for every
    // other track by the same artist that also lacks album context. Fold the
    // track title in for that case so each gets its own cache entry.
    const cacheKey = (cleanAlbum ? `${cleanArtist}|${cleanAlbum}` : `${cleanArtist}|t:${cleanTrack}`).toLowerCase();
    if (!this._discogsFbCache) this._discogsFbCache = new Map();
    if (this._discogsFbCache.has(cacheKey)) return this._discogsFbCache.get(cacheKey);

    const persisted = this._discogsFbLocalGet(cacheKey);
    if (persisted) { this._discogsFbCache.set(cacheKey, persisted); return persisted; }

    // Post-rate-limit cooldown — ported from the v0.0.1 card's safeguard,
    // where a real 429 cached the rate-limit state for 10 seconds so rapid
    // retries made zero network calls. The 1100ms spacing below only
    // spreads requests out; without this, a user re-opening the panel
    // after each spacing window keeps firing full multi-strategy searches
    // at an API that has already told us to stop. Shared across every
    // Discogs call path (searches, release detail, library artwork).
    if (Date.now() < (this._discogsCooldownUntil || 0)) return 'rate_limited';

    // Per-instance throttle — Discogs allows ~60 req/min. If we asked too
    // recently, skip the network call entirely and report it as rate-limited
    // so the caller can tell the user, rather than silently looking like
    // Discogs simply had nothing.
    if (!this._discogsFbLastReq) this._discogsFbLastReq = 0;
    if (Date.now() - this._discogsFbLastReq < 1100) return 'rate_limited';

    const headers = { 'User-Agent': 'CrowMediaPlayerCard/1.0' };
    let _hitRateLimit = false;
    const discogsGet = async (url) => {
      this._discogsFbLastReq = Date.now();
      try {
        const resp = await crowFetch(url, { headers });
        if (resp.status === 429) {
          _hitRateLimit = true;
          this._discogsCooldownUntil = Date.now() + 10000;
          return null;
        }
        return resp.ok ? resp : null;
      } catch (_) {
        // Discogs' 429 responses often omit CORS headers, so the browser
        // blocks the response entirely and crowFetch() throws instead of
        // returning a response object — treat that the same as a 429.
        _hitRateLimit = true;
        this._discogsCooldownUntil = Date.now() + 10000;
        return null;
      }
    };

    const seen = new Set();
    const pool = [];
    const addToPool = (results) => {
      for (const r of (results || [])) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const s = scoreResult(r) + popularityBonus(r) + formatBonus(r) + selfTitledPenalty(r);
        if (s > 0) pool.push({ r, s });
      }
    };

    try {
      if (cleanArtist && cleanAlbum) {
        const resp = await discogsGet(`https://api.discogs.com/database/search?artist=${encodeURIComponent(cleanArtist)}&release_title=${encodeURIComponent(cleanAlbum)}&type=release&per_page=15`);
        if (resp) addToPool((await resp.json()).results);
      }
      if (!pool.length && cleanArtist && cleanTrack && norm(cleanTrack) !== norm(cleanAlbum)) {
        const resp = await discogsGet(`https://api.discogs.com/database/search?artist=${encodeURIComponent(cleanArtist)}&track=${encodeURIComponent(cleanTrack)}&type=release&per_page=15`);
        if (resp) addToPool((await resp.json()).results);
      }
      if (!pool.length && cleanArtist) {
        const resp = await discogsGet(`https://api.discogs.com/database/search?artist=${encodeURIComponent(cleanArtist)}&type=release&per_page=15`);
        if (resp) addToPool((await resp.json()).results);
      }
      if (!pool.length) {
        const q = [cleanArtist, cleanAlbum || cleanTrack].filter(Boolean).join(' ');
        if (q) {
          const resp = await discogsGet(`https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=10`);
          if (resp) {
            const data = await resp.json();
            addToPool((data.results || []).filter(r => !isCoverRelease(r)));
          }
        }
      }
      if (!pool.length) {
        if (_hitRateLimit) return 'rate_limited';
        this._discogsFbCache.set(cacheKey, null);
        return null;
      }

      pool.sort((a, b) => b.s - a.s);
      let result = pool[0].r;

      // Fetch full release detail if the search stub is missing tracklist,
      // community rating, or cover art — all three matter for the panel.
      const needsDetail = !result.tracklist?.length || !result.community || !(result.images?.length || result.cover_image || result.thumb);
      if (result.id && needsDetail) {
        const cachedRelease = this._discogsFbReleaseLocalGet(String(result.id));
        if (cachedRelease) {
          result = { ...result, ...cachedRelease };
        } else {
          try {
            const resourceUrl = result.resource_url || `https://api.discogs.com/releases/${result.id}`;
            // Through discogsGet, not a raw fetch — this call previously
            // bypassed the throttle timestamp and 429 detection entirely,
            // making every lookup one unthrottled request heavier than it
            // appeared. A rate-limited detail fetch just keeps the search
            // stub we already have, so the panel still renders.
            const resp = await discogsGet(resourceUrl);
            if (resp) {
              const full = await resp.json();
              const tracks = (full.tracklist || []).filter(t => !t.type_ || t.type_ === 'track' || t.type_ === 'index');
              const merged = { ...result };
              if (tracks.length) merged.tracklist = tracks;
              if (full.community) merged.community = full.community;
              if (full.images?.length) merged.images = full.images;
              result = merged;
              this._discogsFbReleaseLocalSet(String(result.id), { tracklist: merged.tracklist, community: merged.community, images: merged.images });
            }
          } catch (_) { /* keep the stub we already have */ }
        }
      }

      this._discogsFbCache.set(cacheKey, result);
      this._discogsFbLocalSet(cacheKey, result);
      return result;
    } catch (_) {
      return null;
    }
  },

  // Persisted full release detail (tracklist + community rating + images), keyed by release ID.
  _discogsFbReleaseLocalGet(releaseId) {
    try {
      const raw = localStorage.getItem('crow_media_discogs_fb_release_store_v3');
      if (!raw) return null;
      const store = JSON.parse(raw);
      const entry = store[releaseId];
      if (!entry) return null;
      if (Date.now() - (entry.ts || 0) > 30 * 86400000) {
        delete store[releaseId];
        try { localStorage.setItem('crow_media_discogs_fb_release_store_v3', JSON.stringify(store)); } catch (_) {}
        return null;
      }
      return entry.result;
    } catch (_) { return null; }
  },

  _discogsFbReleaseLocalSet(releaseId, result) {
    try {
      let store = {};
      try {
        const raw = localStorage.getItem('crow_media_discogs_fb_release_store_v3');
        if (raw) store = JSON.parse(raw);
      } catch (_) {}
      const keys = Object.keys(store);
      if (keys.length >= 100) {
        keys.sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0));
        keys.slice(0, keys.length - 99).forEach(k => delete store[k]);
      }
      store[releaseId] = { result, ts: Date.now() };
      localStorage.setItem('crow_media_discogs_fb_release_store_v3', JSON.stringify(store));
    } catch (_) {}
  },

  /**
   * AI Music Recommendations — opens info popup with swipeable/long-pressable recs
   */
  _showBioPhotoLightbox(imgSrc, name, content, isSquare = false) {
    if (!imgSrc) return;
    // Mount on the card outer element so overlay is constrained to the card
    const cardOuter = this.shadowRoot?.getElementById('cardOuter');
    if (!cardOuter) return;
    // Guard against a delayed/ghost click firing after the user has already
    // navigated away from the AI Info panel (e.g. to the Music Library) —
    // the hero-art tap listener that triggers this can still be sitting in
    // the DOM even once its panel is hidden, so a late-arriving synthetic
    // click can otherwise pop this lightbox up over whatever's open now.
    if (this.shadowRoot?.getElementById('maPopup')?.classList.contains('visible')) return;
    cardOuter.querySelectorAll('.crow-bio-lightbox').forEach(el => el.remove());

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'crow-bio-lightbox';
    backdrop.style.cssText = 'position:absolute;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;border-radius:inherit;';

    // Modal card
    const card = document.createElement('div');
    card.style.cssText = 'background:#1c1c1e;border-radius:20px;padding:16px 24px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:340px;width:85%;max-height:85%;box-sizing:border-box;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8);position:relative;';

    // Close button row — in normal document flow, above the image, so it
    // can never visually overlap the artwork regardless of image size
    const closeRow = document.createElement('div');
    closeRow.style.cssText = 'display:flex;justify-content:flex-end;width:100%;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;flex-shrink:0;';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); backdrop.remove(); });
    closeRow.appendChild(closeBtn);

    // Photo
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = name || '';
    img.style.cssText = isSquare === true
      ? 'width:min(280px, 100%);aspect-ratio:5/7;height:auto;border-radius:12px;object-fit:cover;'    // movie: tall rectangle
      : isSquare === 'square'
        ? 'width:min(280px, 100%);aspect-ratio:1/1;height:auto;border-radius:12px;object-fit:cover;'  // music: square
        : 'width:min(200px, 60%);aspect-ratio:1/1;height:auto;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.1);'; // person: circle

    card.appendChild(closeRow);
    card.appendChild(img);
    if (name) {
      const label = document.createElement('div');
      label.textContent = name;
      label.style.cssText = 'font-size:16px;font-weight:600;color:#fff;text-align:center;';
      card.appendChild(label);
    }

    backdrop.appendChild(card);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    cardOuter.style.position = 'relative';
    cardOuter.appendChild(backdrop);
  },

  // Header Export button for a results list (Recommendations, AI Search,
  // video suggestions). Pass null to hide it while results are loading.
  _setResultsExport(onExport) {
    if (!this._pdfOn('lists')) onExport = null;
    this._resultsExportFn = typeof onExport === 'function' ? onExport : null;
    const btn = this.shadowRoot?.getElementById('infoShareBtn');
    if (!btn) return;
    if (typeof onExport !== 'function') { btn.classList.add('hidden'); btn.onclick = null; return; }
    btn.classList.remove('hidden');
    btn.onclick = () => this._showInfoShareMenu(btn, null, { onExport, exportLabel: 'Export Results to PDF', exportPdf: 'lists' });
  },

  async _showAIRecommendations() {
    const r = this.shadowRoot;
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._showToast('Nothing playing'); return; }

    const attrs   = state.attributes;
    const artist  = attrs.media_artist     || '';
    const track   = attrs.media_title      || '';
    const album   = attrs.media_album_name || '';
    const isMa    = this._maEntityIds?.has(this._entity);
    const glassOn = this._config?.card_liquid_glass !== false;
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    const title   = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;

    // Force solid backgrounds — disable ha-card's backdrop-filter while popup is open
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.style.setProperty('isolation', 'isolate');
    popup.style.setProperty('transform', 'translateZ(0)');
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _haCard2 = r.querySelector('ha-card');
    if (_haCard2) {
      _haCard2?.style.setProperty('--crow-card-blur', 'none');
    }

    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    // Clear queue direction so state-change auto-refresh doesn't overwrite this panel
    this._queuePanelDirection = null;
    const _rbo = r.getElementById('queueMenuBtn');
    if (_rbo) _rbo.classList.add('hidden');
    if (title) title.textContent = 'Recommendations';
    this._setResultsExport(null);

    // Claim ownership of the panel generation counter — every other AI panel function
    // (_showAITrackInfo, _showAISearchPanel, etc.) does this so it can detect being
    // superseded mid-flight and bail out instead of overwriting newer content. This
    // function previously only bumped the counter for others' benefit without ever
    // checking it for itself, so a delayed AI Info call that fired after this one
    // started could win the race and silently replace Recommendations with AI Info.
    if (!this._aiPanelGeneration) this._aiPanelGeneration = 0;
    const _myGen = ++this._aiPanelGeneration;
    const _stale = () => this._aiPanelGeneration !== _myGen;

    // Clear content immediately so stale sub-panel HTML (e.g. from a previously
    // tapped track info view) is never visible during the async AI check.
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // ── Detect media type and branch to video recs if watching TV/movie ────
    const _recsMediaType = this._detectMediaType(state);
    const _isVideoRecs = _recsMediaType === 'tv' || _recsMediaType === 'movie';

    if (_isVideoRecs) {
      await this._showVideoRecommendations(content, r, popup, state, attrs);
      return;
    }

    const cacheKey = ('recs|' + artist + '|' + track).toLowerCase();
    if (!this._aiRecsCache) this._aiRecsCache = new Map();

    // Always fetch a fresh set on open rather than reusing whatever's
    // cached from a prior open or background prefetch — the point of
    // re-opening Recommendations is to see something new, not the same
    // list again. The cache is still written below purely so per-row
    // art lookups (_recCacheKey) elsewhere can reuse titles/artists.
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:24px;">
        <div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
        <div style="font-size:12px;color:${this._pt("dim")};">Finding similar music…</div>
      </div>`;

    let recs;
    {
      const hasAI = await this._aiCheckAvailable();
      if (_stale()) return;
      if (!hasAI) { this._aiShowNoAgentBanner(popup); return; }

      const parts = [track && `"${track}"`, artist && `by ${artist}`, album && `(album: ${album})`].filter(Boolean).join(' ');
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const prompt = `I'm listening to ${parts}. Suggest 18 similar tracks I might enjoy. Respond ONLY with JSON array (no markdown):
[{"title":"Track Name","artist":"Artist Name","reason":"10 word max reason"}]`;
      try {
        const resp = await this._aiProcess({ _crowFeature: 'discover',
          type: 'conversation/process', text: prompt,
          agent_id: agentId, language: navigator.language || 'en'
        });
        if (_stale()) return;
        const raw = resp?.response?.speech?.plain?.speech || '';
        if (!raw) throw new Error('no response');
        recs = JSON.parse(raw.replace(/```json?\s*/gi,'').replace(/```/g,'').trim());
        this._aiRecsCache.set(cacheKey, recs);
        this._aiSessionSet('recs', cacheKey, recs);
        this._aiLocalSet('recs', cacheKey, recs);
      } catch(e) {
        if (_stale()) return;
        r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        { const _k = e?.kind || (e instanceof SyntaxError ? 'unreadable' : this._aiErrorKind(e?.message)); const [_t, _b] = this._aiFriendlyReason(_k === 'error' && /no response/i.test(e?.message || '') ? 'unreadable' : _k); content.innerHTML = this._psError('Suggestions: ' + _t.charAt(0).toLowerCase() + _t.slice(1), _b); }
        return;
      }
    }

    if (_stale()) return;

    // Filter out any rec that matches the currently playing track — the AI sometimes
    // includes it with an "already listening" note, and it looks wrong on re-open.
    const _normRec = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    recs = recs.filter(rec =>
      !(_normRec(rec.title) === _normRec(track) && _normRec(rec.artist) === _normRec(artist))
    );

    // Build swipeable rec rows
    const artUrl = (() => {
      const a = attrs;
      const itunesKey = [(a.media_artist||''), (a.media_album_name||a.media_title||'')].filter(Boolean).join('|').toLowerCase();
      return ((a.entity_picture_local || a.entity_picture || a.album_art || (itunesKey && this._itunesArtCache?.[itunesKey]) || '')
        .replace(/^http:\/\//i, 'https://'));
    })();

    const _recsBarAllMA = (() => {
      let ma = this._getValidMASpeakers(true);
      return ma;
    })();
    const _recsBarTarget = (_recsBarAllMA.includes(this._lastMAPlayTarget) ? this._lastMAPlayTarget : null)
      || this._resolveMATargetEntity()
      || _recsBarAllMA[0]
      || this._entity;

    this._setResultsExport(() => this._exportResultsPDF('Recommendations', 'Similar to ' + (track ? track + (artist ? ' by ' + artist : '') : artist), recs));
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div id="ai-recs-action-bar" class="ma-drill-actions" style="margin-bottom:12px;">
        <button class="ma-drill-action-btn ai-recs-action-btn" data-action="replace">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
          <span class="ma-drill-btn-label">Play All</span>
        </button>
        ${this._shuffleBtnHtml('data-action="shuffle"', 'ai-recs-action-btn')}
        <button class="ma-drill-action-btn ai-recs-action-btn" data-action="add">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div>
          <span class="ma-drill-btn-label">Add All</span>
        </button>
        <button class="ma-drill-action-btn ai-recs-action-btn" data-action="next">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div>
          <span class="ma-drill-btn-label">Play Next</span>
        </button>
      </div>
      <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.8);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px;">
        <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:#63b3ed;vertical-align:middle;margin-right:3px"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        Similar to ${track || artist}
      </div>
      <div id="ai-recs-list">
        ${recs.map((rec, i) => `
          <div class="ai-rec-wrap" style="position:relative;overflow:hidden;border-radius:12px;margin-bottom:6px;">
            <div class="ai-rec-row" data-idx="${i}" data-title="${(rec.title||'').replace(/"/g,'&quot;')}" data-artist="${(rec.artist||'').replace(/"/g,'&quot;')}"
              style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${this._pt("bg")};cursor:pointer;will-change:transform;">
              <div class="ai-rec-art" data-rec-idx="${i}" style="width:40px;height:40px;border-radius:8px;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#63b3ed;opacity:0.7"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.title||''}</div>
                <div style="font-size:11px;color:${this._pt("dim")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.artist||''}</div>
                ${rec.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.reason}</div>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>`;

    // Fetch iTunes art for each rec — staggered with retry to handle rate limits
    const _applyRecArt = (i, img, isFinal = true) => {
      const row = content.querySelector(`.ai-rec-row[data-idx="${i}"]`);
      if (row) row.dataset.art = img; // store for click-through
      const artEl = content.querySelector(`.ai-rec-art[data-rec-idx="${i}"]`);
      if (!artEl) return;
      artEl.innerHTML = '';
      const _im = document.createElement('img');
      _im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      _im.addEventListener('error', () => { this._evictStaleWikiBlobBySrc(_im.src); _im.style.display = 'none'; });
      _im.src = img;
      artEl.appendChild(_im);
      artEl.style.border = 'none';
      if (isFinal) artEl.dataset.final = '1';
    };
    // Pre-fill rows immediately with the main panel art as a fallback.
    // If iTunes exhausts all retries, fall back to a Wikipedia artist photo (blob URL).
    const _fetchRecArtWithRetry = (rec, i, retriesLeft, delayMs) => {
      // If already cached, apply immediately without the stagger delay
      const _recCacheKey = [rec.artist || '', rec.title || ''].filter(Boolean).join('|').toLowerCase();
      if (this._itunesArtCache?.[_recCacheKey]) { _applyRecArt(i, this._itunesArtCache[_recCacheKey], true); return; }
      setTimeout(() => {
        this._fetchItunesArtForTrack(rec.artist || '', rec.title || '').then(img => {
          if (img) {
            _applyRecArt(i, img, true);
          } else if (retriesLeft > 0) {
            _fetchRecArtWithRetry(rec, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
          } else if (rec.artist) {
            // iTunes exhausted — try Wikipedia artist photo as a fallback
            this._fetchWikipediaThumb(rec.artist).then(blobUrl => {
              if (blobUrl) _applyRecArt(i, blobUrl, true);
            });
          }
        });
      }, delayMs);
    };
    recs.forEach((rec, i) => _fetchRecArtWithRetry(rec, i, 4, i * 600));

    // Background poller — keep retrying rows still showing a placeholder
    let _recPollCount = 0;
    const _recPollInterval = setInterval(() => {
      _recPollCount++;
      if (_recPollCount > 20) { clearInterval(_recPollInterval); return; } // max ~60s
      let allDone = true;
      recs.forEach((rec, i) => {
        const artEl = content.querySelector(`.ai-rec-art[data-rec-idx="${i}"]`);
        if (!artEl) { clearInterval(_recPollInterval); return; } // panel closed
        if (!artEl.querySelector('img')) {
          allDone = false;
          this._fetchItunesArtForTrack(rec.artist || '', rec.title || '').then(img => {
            if (img) {
              _applyRecArt(i, img);
            } else if (rec.artist && _recPollCount >= 3) {
              // After a few poller cycles with no iTunes result, try Wikipedia
              this._fetchWikipediaThumb(rec.artist).then(blobUrl => {
                if (blobUrl) _applyRecArt(i, blobUrl);
              });
            }
          });
        }
      });
      if (allDone) clearInterval(_recPollInterval);
    }, 3000);

    // Glass blur on rec rows
    if (glassOn && artUrl) {
      content.querySelectorAll('.ai-rec-wrap').forEach(wrap => {
        if (this._applyRowGlow && this._config?.row_glow) this._applyRowGlow(artUrl, wrap, null);
      });
    }

    // Wire action bar — batch play/add all recs
    content.querySelectorAll('.ai-recs-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (!_recsBarAllMA.length && !isMa) { this._showToast('Music Assistant required'); return; }
        if (action === 'play_album') {
          if (album) this._playAlbum(album, artist);
          return;
        }
        if (!recs.length) return;
        if (action === 'shuffle') { this._crowShufflePlay(recs, { target: _recsBarTarget }); return; }

        this._maBatchLoading = true;
        clearTimeout(this._maBatchLoadingTimer);
        this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 20000);
        this._pillPulse(20000);

        const _overlay = this.shadowRoot?.getElementById('queueBuildingOverlay');
        // Only show overlay if the queue panel is open — never bleed onto other panels
        const _infoPopup = this.shadowRoot?.getElementById('infoPopup');
        const _isQueueOpen = _infoPopup?.classList.contains('visible') && this._queuePanelDirection != null;
        if (_overlay && _isQueueOpen) _overlay.style.display = 'flex';

        let successCount = 0;
        if (action === 'replace') {
            (typeof self?._showLoadingToast === 'function' ? self : this)._showLoadingToast('Starting playback\u2026');
          const [first, ...rest] = recs;
          try {
            await this._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: { entity_id: _recsBarTarget, media_id: `${first.title} ${first.artist}`, media_type: 'track', enqueue: 'replace' }
            });
            successCount++;
          } catch(_) {}
          for (const rec of rest) {
            try {
              await this._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _recsBarTarget, media_id: `${rec.title} ${rec.artist}`, media_type: 'track', enqueue: 'add' }
              });
              successCount++;
            } catch(_) {}
          }
          this._closeInfoPopup();
        } else {
          const enqueueMode = action === 'next' ? 'next' : 'add';
          for (const rec of recs) {
            try {
              await this._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _recsBarTarget, media_id: `${rec.title} ${rec.artist}`, media_type: 'track', enqueue: enqueueMode }
              });
              successCount++;
            } catch(_) {}
          }
        }

        this._maBatchLoading = false;
        this._pillPulse(0);
        clearTimeout(this._maBatchLoadingTimer);
        this._pillPulse(0);
        this._pillPulse(0);
        if (_overlay) _overlay.style.display = 'none';
        if (action !== 'replace') {
          const label = action === 'next' ? 'Playing next' : 'Added to queue';
          this._showToast(`${label} — ${successCount} track${successCount !== 1 ? 's' : ''}`, 3000);
        }
      });
    });

    // (the action bar is wired once, above: a second copy here made Play All, Add All and Play Next queue every song twice)

    // Wire swipe + long-press
    const self = this;
    content.querySelectorAll('.ai-rec-row').forEach(row => {
      self._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ai-rec-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          self._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
        }, 480);
      }, { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
      row.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        self._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true, overrideArt: row.dataset.art || '' });
      });
    });
  },

  /**
   * Feature 5 — Mood-Based Queue Builder
   * Shows a vibe picker that builds a MA radio/search queue.
   */
  /**
   * _showAIAlbumTracks — fetches and shows album tracks with long-press enqueue menus.
   * Called when tapping the album name in the AI track info panel.
   */
  // Recently Played in the order Music Assistant played things. Each entry in its history is a short
  // record (no artists), so the full item comes from the library lists already fetched, or is asked for
  // by its address when it isn't in them (a song from a service that isn't in the library).
  async _maRecentFromHistory(history, chunks) {
    const byUri = new Map(), byId = new Map();
    chunks.forEach(c => c.forEach(it => {
      if (it.uri) byUri.set(it.uri, it);
      const mt = it.media_type || it._tab;
      if (it.item_id != null) byId.set(mt + '|' + it.item_id, it);
    }));
    const seen = new Set(), out = [], missing = [];
    for (const h of history) {
      const mt = h?.media_type;
      if (!h || !['track', 'album', 'artist', 'playlist', 'radio'].includes(mt)) continue;
      const k = h.uri || (mt + '|' + h.provider + '|' + h.item_id);
      if (seen.has(k)) continue;
      seen.add(k);
      const full = (h.uri && byUri.get(h.uri)) || (h.provider === 'library' && byId.get(mt + '|' + h.item_id)) || null;
      const row = full ? { ...full, _tab: mt } : { ...h, _tab: mt };
      if (!full && (mt === 'track' || mt === 'album') && h.uri) missing.push(row);
      out.push(row);
    }
    // the details for up to 20 that weren't in the library lists, a few at a time
    const todo = missing.slice(0, 20);
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(todo.slice(i, i + 5).map(async row => {
        const full = await this._maCmd('music/item_by_uri', { uri: row.uri }).catch(() => null);
        if (full && typeof full === 'object') Object.assign(row, full, { _tab: row._tab });
      }));
    }
    return out;
  },

  /**
   * Fetches a 100×100 iTunes artwork URL for a track+artist.
   * Uses scoring to find the best match (same logic as _fetchItunesArt).
   * Returns null on failure.
   */
  async _fetchItunesArtForTrack(artist, title) {
    if (!artist && !title) return null;

    // Reuse the main _fetchItunesArt pipeline which is proven to work.
    // Key format matches _itunesArtCache: "artist|title"
    const cacheKey = [artist, title].filter(Boolean).join('|').toLowerCase();
    if (!this._itunesArtCache) this._itunesArtCache = {};

    // Return immediately if already cached — positive hit OR confirmed miss
    if (cacheKey in this._itunesArtCache && this._itunesArtCache[cacheKey] !== null) {
      return this._itunesArtCache[cacheKey] || null;
    }

    // an in-flight mark with no lookup running (e.g. restored from an earlier visit) is cleared
    if (this._itunesArtCache[cacheKey] === null && !this._itunesInflight?.has(cacheKey)) delete this._itunesArtCache[cacheKey];
    // Fire the same fetch as _fetchItunesArt and wait for it to populate the cache
    this._fetchItunesArt(artist, '', title, { skipStaleGuard: true });

    // Poll _itunesArtCache until the fetch resolves (max 8s)
    for (let i = 0; i < 16; i++) {
      await new Promise(res => setTimeout(res, 500));
      if (cacheKey in this._itunesArtCache && this._itunesArtCache[cacheKey] !== null) {
        return this._itunesArtCache[cacheKey] || null;
      }
    }
    return this._itunesArtCache[cacheKey] || null;
  },

  /**
   * Searches Music Assistant's own library for a track and returns its
   * thumbnail — the same fallback _showAITrackInfo uses when iTunes has
   * nothing (local files, Tidal exclusives, tracks iTunes doesn't index).
   * Extracted so other art-fetch call sites (e.g. pinned-song rows) can
   * reuse the exact same fallback chain instead of stopping at iTunes alone.
   * Returns null on failure/no match.
   */
  async _fetchMaLibraryTrackArt(artist, title) {
    if (!title || !this._hass?.services?.mass_queue) return null;
    try {
      const _maConfigId = await this._getMAConfigEntryId();
      if (!_maConfigId) return null;
      const _maQuery = artist ? title + ' ' + artist : title;
      const _maRes = await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'music_assistant', service: 'search',
        service_data: { config_entry_id: _maConfigId, name: _maQuery, media_type: 'track', limit: 5 },
        return_response: true
      });
      const _maResponse = _maRes?.response || {};
      let _maTracks = [];
      if (Array.isArray(_maResponse)) _maTracks = _maResponse;
      else if (Array.isArray(_maResponse.tracks)) _maTracks = _maResponse.tracks;
      else Object.values(_maResponse).forEach(v => { if (Array.isArray(v)) _maTracks.push(...v); });

      // Score by title+artist match — same logic as _playTrackViaMAToast /
      // _showAITrackInfo's own MA fallback.
      const _norm = s => (s || '').toLowerCase().replace(/['’`]/g, "'").trim();
      const _nt = _norm(title), _na = _norm(artist);
      const _scored = _maTracks.map(t => {
        const tt = _norm(t.name || t.title || '');
        const ta = _norm((t.artists && t.artists[0]?.name) || '');
        let sc = 0;
        if (tt === _nt) sc += 4; else if (tt.includes(_nt) || _nt.includes(tt)) sc += 2;
        if (_na && ta) { if (ta === _na) sc += 3; else if (ta.includes(_na) || _na.includes(ta)) sc += 1; }
        return { t, sc };
      }).sort((a, b) => b.sc - a.sc);

      const _bestMA = _scored[0]?.sc > 0 ? _scored[0].t : null;
      const _maImgUrl = _bestMA
        ? (typeof _bestMA.image === 'string' ? _bestMA.image : (_bestMA.image?.path || _bestMA.thumbnail || ''))
        : '';
      if (!_maImgUrl) return null;
      return (await this._fetchMAImage(_maImgUrl)) || null;
    } catch (_) {
      return null;
    }
  },

  async _showAIAlbumTracks(body, albumName, artistName, artUrl, onBack = null, prefill = null) {
    const glassOn = this._config?.card_liquid_glass !== false;
    const isMa    = this._maEntityIds?.has(this._entity);

    // ── Immediate shell ──────────────────────────────────────────────────
    // Hero art + action bar need nothing but albumName/artistName/artUrl —
    // Play All/Add/Play Next below call _playAlbumViaMAToast directly by
    // name, not the AI-generated tracklist — so they render and become
    // usable right away, same pattern as the track AI Info panel's quick
    // shell. Only the tracklist/meta section actually depends on
    // the AI response, so that's the only part that stays behind a spinner,
    // scoped to its own sub-container below instead of blocking the whole
    // panel.
    const _albumBarAllMA = (() => { let ma = this._getValidMASpeakers(true); return ma; })();
    const _albumBarTarget = (_albumBarAllMA.includes(this._lastMAPlayTarget) ? this._lastMAPlayTarget : null) || this._resolveMATargetEntity() || _albumBarAllMA[0] || this._entity;

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;cursor:pointer;" id="ai-album-back">
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._pt("dim")};flex-shrink:0"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
        <span style="font-size:12px;color:${this._pt("dim")}">Back</span>
      </div>
      <div class="ma-drill-actions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn ai-album-action-btn" data-action="replace"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button>
        ${this._shuffleBtnHtml('id="ai-album-shuffle"')}
        <button class="ma-drill-action-btn ai-album-action-btn" data-action="add"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button>
        <button class="ma-drill-action-btn ai-album-action-btn" data-action="next"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>
        <button class="ma-drill-action-btn" id="ai-album-export"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg></div><span class="ma-drill-btn-label">Export</span></button>
      </div>
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;">
        <div style="width:64px;height:64px;border-radius:10px;overflow:hidden;flex-shrink:0;background:${this._pt("bg")};border:1px solid ${this._pt("border")};cursor:${artUrl ? 'zoom-in' : 'default'};" id="ai-album-art-thumb">
          ${artUrl ? `<img src="${artUrl}" class="info-hero-art-img" style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:auto;" onerror="this.style.display='none'">` : '<svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:${this._pt(\"dim\")};margin:18px auto;display:block"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:700;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">${albumName}</div>
          <div style="font-size:12px;color:${this._pt("dim")};margin-bottom:4px">${artistName}</div>
        </div>
      </div>
      <div id="ai-album-details">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:10px;">
          <div style="width:22px;height:22px;border:2px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
          <div style="font-size:12px;color:${this._pt("dim")}">Loading album details…</div>
        </div>
      </div>`;

    // Back button
    body.querySelector('#ai-album-back')?.addEventListener('click', () => {
      if (onBack) onBack();
      else this._closeInfoPopup();
    });

    // Pin button — wired to the album, not whatever the previous view (a
    // track, most likely) had it pointed at.
    const _albumPinItem = (albumName || artistName) ? {
      uri:        'album-artist://' + (albumName || '').toLowerCase().trim() + '|' + (artistName || '').toLowerCase().trim(),
      name:       albumName,
      artist:     artistName,
      artists:    artistName ? [{ name: artistName }] : [],
      image:      artUrl || '',
      media_type: 'album',
    } : null;
    this._wireInfoPinButton(_albumPinItem, 'album', 'Album');

    // Album art tap → lightbox
    const _albumArtOpenedAt = Date.now();
    const _albumArtImg = body.querySelector('#ai-album-art-thumb .info-hero-art-img');
    if (_albumArtImg) {
      _albumArtImg.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((Date.now() - _albumArtOpenedAt) < 500) return;
        this._showBioPhotoLightbox(_albumArtImg.src || artUrl, `${albumName}${artistName ? ' · ' + artistName : ''}`, body, 'square');
      });
    }

    // Action bar — plays/queues the album by name via MA, entirely
    // independent of the AI tracklist below, so it works immediately.
    if (!['lists', 'lyrics', 'cd'].some(t => this._pdfOn(t))) body.querySelector('#ai-album-export')?.remove();
    body.querySelector('#ai-album-export')?.addEventListener('click', async () => {
      let _ready = false;
      try { _ready = tracks.length > 0; } catch (_) { /* tracklist not reached yet */ }
      if (!_ready) { this._showToast('Still loading the tracklist'); return; }
      const _albOpts = [{ label: 'Tracklist', value: 'tracks', pdf: 'lists' }, { label: 'Lyrics booklet', value: 'lyrics', pdf: 'lyrics' }, { label: 'CD case printables', value: 'cd', pdf: 'cd' }]
        .filter(o => this._pdfOn(o.pdf));
      if (!_albOpts.length) return;
      const which = _albOpts.length === 1 ? _albOpts[0].value
        : await this._iosChoose({ title: 'Export Album', message: 'What would you like in the PDF?', options: _albOpts, selected: _albOpts[0].value });
      if (which === 'cd') { this._exportCdPrintables({ artist: artistName, title: tracks[0]?.title || albumName, album: albumName }); return; }
      if (which === 'lyrics') {
        this._exportAlbumLyricsPDF({ album: albumName, artist: artistName, heroSrc: artUrl || null,
          tracks: tracks.map((t, i) => ({ title: t.title || '', artist: artistName, num: t.position || i + 1 })) });
        return;
      }
      if (which !== 'tracks') return;
      this._exportListPDF(async () => ({
        title: albumName, subtitle: artistName, heroSrc: artUrl || null,
        rows: [['Year', albumMeta.year ? String(albumMeta.year) : ''], ['Label', albumMeta.label || ''],
          ['Genre', (Array.isArray(albumMeta.genre) ? albumMeta.genre : [albumMeta.genre]).filter(Boolean).slice(0, 3).join(', ')],
          ['Tracks', String(tracks.length)]],
        sections: [{ heading: 'Tracklist', items: tracks.map((t, i) => ({ num: t.position || i + 1, title: t.title || '' })) }],
        filename: 'album-' + albumName,
      }));
    });
    // Shuffle: the album's songs in a random order, once its tracklist has arrived
    body.querySelector('#ai-album-shuffle')?.addEventListener('click', () => {
      if (!_albumBarAllMA.length && !isMa) { this._showToast('Music Assistant required'); return; }
      let list = [];
      try { list = tracks; } catch (_) { list = []; }   // the tracklist isn't there yet
      if (!list?.length) { this._showToast('Still loading the tracklist'); return; }
      this._crowShufflePlay(list.map(t => ({ title: t.title || '', artist: artistName })), { target: _albumBarTarget });
    });
    body.querySelectorAll('.ai-album-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_albumBarAllMA.length && !isMa) { this._showToast('Music Assistant required'); return; }
        const mode = btn.dataset.action === 'add' ? 'add' : btn.dataset.action === 'next' ? 'next' : 'replace';
        if (mode === 'replace') this._pillPulse(15000);
        this._playAlbumViaMAToast(albumName, artistName, _albumBarTarget, mode);
        if (mode === 'replace') {
          // Exit back to the main artwork screen — playback has started.
          // Album view sits inside infoPopup with the library browser still
          // open underneath it, so both need closing, not just this panel.
          this._closeInfoPopup();
          this._closeMABrowser(true);
        }
      });
    });

    const details = body.querySelector('#ai-album-details');
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // Capture generation so we can detect if another panel opened while awaiting
    const _albumGen = this._aiPanelGeneration || 0;
    const _albumStale = () => (this._aiPanelGeneration || 0) !== _albumGen;

    // Cache keyed by album+artist — cleared automatically when the track changes
    if (!this._aiAlbumTracksCache) this._aiAlbumTracksCache = new Map();
    const _albumCacheKey = (albumName + '|' + artistName).toLowerCase();
    // Hydrate from sessionStorage if not in memory
    this._aiCachedRead(this._aiAlbumTracksCache, 'albumTracks', _albumCacheKey);
    // prefill: a tracklist the caller already has (e.g. from Discogs) — used
    // as-is instead of the cache or an AI lookup.
    const _cachedEntry = (prefill && Array.isArray(prefill.tracks) && prefill.tracks.length)
      ? prefill
      : this._aiAlbumTracksCache.get(_albumCacheKey);
    let tracks = Array.isArray(_cachedEntry) ? _cachedEntry : (_cachedEntry?.tracks || []);
    let albumMeta = Array.isArray(_cachedEntry) ? {} : (_cachedEntry?.meta || {});

    if (_cachedEntry?.empty) {
      // Already confirmed on a previous visit that this album has no data
      if (details) details.innerHTML = `
        <div style="padding:20px;text-align:center;font-size:12px;color:rgba(255,100,100,0.8)">
          Couldn't find a tracklist for this album.<br>
          <span style="color:${this._pt("dim")};font-size:11px;margin-top:6px;display:block">${albumName}</span>
        </div>`;
      return;
    }

    if (_cachedEntry) {
      // Skip the loading state and go straight to render
    } else {
    const prompt = `You are a music encyclopedia. For the album "${albumName}" by "${artistName}", respond ONLY with a JSON object (no markdown):
{"year":"release year or null","label":"record label or null","genre":["genre1","genre2"],"tracks":[{"position":"1","title":"Track Name"},{"position":"2","title":"Track Name"}]}
Include ALL tracks. Use null for unknown fields.`;
    try {
      const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      if (_albumStale()) return;
      const raw = resp?.response?.speech?.plain?.speech || '';
      const stripped = raw.replace(/```json?\s*/gi,'').replace(/```/g,'');
      const objStart = stripped.indexOf('{');
      const objEnd   = stripped.lastIndexOf('}');
      if (objStart === -1 || objEnd <= objStart) throw new Error('No JSON in response');
      const parsed = JSON.parse(stripped.slice(objStart, objEnd + 1));
      if (Array.isArray(parsed)) {
        tracks = parsed;
      } else {
        tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
        albumMeta = { year: parsed.year || null, label: parsed.label || null, genre: parsed.genre || [] };
      }
      if (!tracks.length) throw new Error('Empty track list');
      this._aiCachedWrite(this._aiAlbumTracksCache, 'albumTracks', _albumCacheKey, { tracks, meta: albumMeta }, { ttlDays: 30, max: 150 });
    } catch(e) {
      if (_albumStale()) return;
      // AI off or didn't know the album — try Discogs before giving up. Kept
      // in memory only, so the AI gets another go next session.
      let _dg = null;
      try { _dg = await this._lookupDiscogsForAIData(artistName, albumName, null); } catch (_) {}
      if (_albumStale()) return;
      const _dgTracks = (_dg && typeof _dg === 'object' && Array.isArray(_dg.tracklist))
        ? _dg.tracklist.filter(t => t?.title).map((t, i) => ({ title: t.title, position: t.position || String(i + 1) }))
        : [];
      if (_dgTracks.length) {
        tracks = _dgTracks;
        albumMeta = {
          year:  _dg.year || null,
          label: (Array.isArray(_dg.label) ? _dg.label[0] : _dg.label) || null,
          genre: [...(_dg.genre || []), ...(_dg.style || [])].slice(0, 5),
        };
        this._aiAlbumTracksCache.set(_albumCacheKey, { tracks, meta: albumMeta });
      } else {
      this._aiAlbumTracksCache.set(_albumCacheKey, { tracks: [], meta: {}, empty: true });
      if (details) details.innerHTML = `
        <div style="padding:20px;text-align:center;font-size:12px;color:rgba(255,100,100,0.8)">
          Couldn't find a tracklist for this album.<br>
          <span style="color:${this._pt("dim")};font-size:11px;margin-top:6px;display:block">${albumName}</span>
        </div>`;
      return;
      }
    }


    } // end if (!_cachedTracks)

    if (_albumStale()) return;
    if (!details) return;

    // Rich header variables
    const _genreHtml = (albumMeta.genre||[]).length
      ? `<div class="ip-tags" style="margin-bottom:6px;">${(albumMeta.genre||[]).map(g=>`<span class="bio-genre-tag" data-tag="${g.replace(/"/g,'&quot;')}">${g}</span>`).join('')}</div>`
      : '';
    // year and label as one quiet line (no boxes)
    const _metaCardsHtml = (albumMeta.year||albumMeta.label)
      ? `<div class="ip-meta" style="margin-bottom:12px;">${[albumMeta.year, albumMeta.label].filter(Boolean).join(' · ')}</div>`
      : '';
    

    details.innerHTML = `
      ${_genreHtml}${_metaCardsHtml}
      <div style="font-size:9px;font-weight:700;color:${this._pt("dim")};letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px">${tracks.length} Tracks</div>
      <div id="ai-album-tracklist">
        ${tracks.map((t, i) => `
          <div class="ai-album-wrap ma-item-wrap" style="margin-bottom:6px;">
            <div class="ai-alb-row ma-item" data-title="${(t.title||'').replace(/"/g,'&quot;')}" data-artist="${artistName.replace(/"/g,'&quot;')}" data-idx="${i}">
              <div class="ma-item-art ai-alb-art" data-idx="${i}" style="background:rgba(35,35,40,0.9);flex-shrink:0;">
                <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
              </div>
              <div class="ma-item-info"><div class="ma-item-title">${t.title||''}</div></div>
              <span style="font-size:11px;color:${this._pt("dim")};flex-shrink:0;margin-right:2px">${t.position || (i+1)}</span>
            </div>
          </div>`).join('')}
      </div>`;

    // Genre tag pills
    this._wireGenreTagClicks(details);

    // Fetch iTunes art for each track — staggered, with retry + Wikipedia
    // artist-photo fallback on confirmed misses (same pipeline as Similar Tracks
    // in AI Info and Known For in the cast bio panel).
    const _applyAlbArt = (i, img) => {
      const artEl = details.querySelector(`.ai-alb-art[data-idx="${i}"]`);
      if (!artEl || artEl.querySelector('img')) return;
      artEl.innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none'">`;
      artEl.style.border = 'none';
    };
    const _fetchAlbArtWithRetry = (t, i, retriesLeft, delayMs) => {
      const _albCacheKey = [artistName, t.title || ''].filter(Boolean).join('|').toLowerCase();
      const _albCached = this._itunesArtCache?.[_albCacheKey];
      if (_albCached) { _applyAlbArt(i, _albCached); return; }
      setTimeout(() => {
        this._fetchItunesArtForTrack(artistName, t.title || '').then(img => {
          if (img) {
            _applyAlbArt(i, img);
          } else if (retriesLeft > 0) {
            _fetchAlbArtWithRetry(t, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
          } else if (artistName) {
            // iTunes confirmed a miss — fall back to a Wikipedia artist photo
            this._fetchMusicPersonThumb(artistName, 2, 1500).then(blobUrl => {
              if (blobUrl) _applyAlbArt(i, blobUrl);
            });
          }
        });
      }, delayMs);
    };
    tracks.forEach((t, i) => _fetchAlbArtWithRetry(t, i, 5, i * 700));

    // Background poller — keep retrying rows still showing a placeholder
    let _albPollCount = 0;
    const _albPollInterval = setInterval(() => {
      _albPollCount++;
      if (_albPollCount > 20) { clearInterval(_albPollInterval); return; }
      let allDone = true;
      tracks.forEach((t, i) => {
        const artEl = details.querySelector(`.ai-alb-art[data-idx="${i}"]`);
        if (!artEl) { clearInterval(_albPollInterval); return; }
        if (!artEl.querySelector('img')) {
          allDone = false;
          this._fetchItunesArtForTrack(artistName, t.title || '').then(img => {
            if (img) {
              _applyAlbArt(i, img);
            } else if (artistName && _albPollCount >= 3) {
              const _albKey = [artistName, t.title || ''].filter(Boolean).join('|').toLowerCase();
              if (this._itunesArtCache?.[_albKey] === '') {
                this._fetchMusicPersonThumb(artistName, 2, 1500).then(blobUrl => {
                  if (blobUrl) _applyAlbArt(i, blobUrl);
                });
              }
            }
          });
        }
      });
      if (allDone) clearInterval(_albPollInterval);
    }, 3000);

    // Glass blur on rows
    if (glassOn && artUrl) {
      details.querySelectorAll('.ai-album-wrap').forEach(wrap => {
        if (this._applyRowGlow && this._config?.row_glow) this._applyRowGlow(artUrl, wrap, null);
      });
    }

    // Wire swipe + long-press on each track row
    const self = this;
    details.querySelectorAll('.ai-alb-row').forEach(row => {
      self._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ma-item-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          self._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
        }, 480);
      }, { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
      row.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        self._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true });
      });
    });
  },

  /**
   * Plays the album of the currently playing track (rest from current position).
   * When albumOverride/artistOverride are supplied (e.g. from AI Info), plays the
   * full album via MA search instead.
   */
  async _playAlbum(albumOverride, artistOverride, enqueueMode) {
    if (!this._maEntityIds?.has(this._entity)) { this._showToast('Music Assistant required'); return; }

    // When called from AI Info with an explicit album — use the fast MA search path
    if (albumOverride) {
      const _target = this._resolveMATargetEntity() || this._entity;
      this._queuePanelDirection = null;
      this._suppressArtTap = true;
      clearTimeout(this._suppressArtTapTimer);
      this._suppressArtTapTimer = setTimeout(() => { this._suppressArtTap = false; }, 3000);
      const _mode = enqueueMode || 'replace';
      await this._playAlbumViaMAToast(albumOverride, artistOverride || '', _target, _mode);
      // Exit back to the main artwork screen — only when this actually
      // started playback now, not when it silently added/queued.
      if (_mode === 'replace') { this._closeInfoPopup(); this._closeMABrowser(true); }
      return;
    }

    // Called from quick menu with no override — add the full current album via MA search
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._showToast('Nothing playing right now'); return; }
    const attrs  = state.attributes;
    const artist = attrs.media_artist || '';
    const album  = attrs.media_album_name || '';
    if (!album) { this._showToast('No album info for this track'); return; }

    const _target = this._resolveMATargetEntity() || this._entity;
    this._queuePanelDirection = null;
    this._suppressArtTap = true;
    clearTimeout(this._suppressArtTapTimer);
    this._suppressArtTapTimer = setTimeout(() => { this._suppressArtTap = false; }, 3000);
    await this._playAlbumViaMAToast(album, artist, _target, 'add');
  },

  /**
   * Adds AI-suggested similar songs to the queue silently with a friendly toast.
   * Dedupes against the live queue and against anything already added for this
   * same track in a previous press, then backfills with a fresh AI request
   * (excluding what's already been used) if dedup leaves us short of the
   * target count.
   */
  async _addSimilarSongsToQueue() { return this._busyJob(() => this.__addSimilarSongsToQueue()); },

  async __addSimilarSongsToQueue() {
    // AI-driven feature — its quick-menu entry is hidden when AI features
    // are off, but other entry points (queue panel shortcut) route here
    // too, so guard with a clearer message than the generic "no agent"
    // toast, which would misleadingly send the user to HA settings.
    if (!this._aiFeatureOn('discover')) { this._showToast('AI features are turned off in the card editor'); return; }
    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 15000);
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._maBatchLoading = false; this._showToast('Nothing playing right now'); return; }
    const attrs  = state.attributes;
    const artist = attrs.media_artist || '';
    const track  = attrs.media_title  || '';
    if (!artist && !track) { this._maBatchLoading = false; this._showToast('No track info available'); return; }
    if (!this._maEntityIds?.has(this._entity)) { this._maBatchLoading = false; this._showToast('Music Assistant required'); return; }

    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { this._maBatchLoading = false; this._showToast('\u26a0\ufe0f ' + this._aiErrorMessage('agent'), 5000); return; }

    const TARGET_COUNT = 18;
    const _normKey = (title, artistName) => (String(title || '').toLowerCase().trim() + '|' + String(artistName || '').toLowerCase().trim()).replace(/[^a-z0-9|]/g, '');

    // Read what's already queued while the AI is thinking (not before asking it).
    // ── Dedup source 1: what's already sitting in the live queue ──
    const _queueKeysP = (async () => {
    const _queueKeys = new Set();
    try {
      const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items);
      if (hasMassQueue) {
        const mqRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: this._entity, limit_before: 0, limit_after: 9999 },
          return_response: true
        });
        const raw = mqRes?.response?.[this._entity] || mqRes?.response || [];
        if (Array.isArray(raw)) raw.forEach(item => {
          const key = _normKey(item.media_title || item.name, item.media_artist || item.artist);
          if (key) _queueKeys.add(key);
        });
      } else {
        const qRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: this._entity }, return_response: true
        });
        const qData = qRes?.response?.[this._entity] || qRes?.response || null;
        [qData?.current_item, qData?.next_item].forEach(item => {
          const key = _normKey(item?.name || item?.media_item?.name, item?.media_item?.artists?.[0]?.name);
          if (key) _queueKeys.add(key);
        });
      }
    } catch (_) {
      // Non-fatal — if we can't read the queue this time, just skip queue dedup.
    }
    return _queueKeys;
    })();


    // ── Dedup source 2: what we've already added for this exact track before ──
    // (persisted, so pressing the button again later for the same song
    // doesn't just re-add the same batch it added last time)
    const cacheKey = ('addlike|' + artist + '|' + track).toLowerCase();
    if (!this._aiSimilarAdded) this._aiSimilarAdded = new Map();
    let _alreadyAdded = this._aiSimilarAdded.get(cacheKey);
    if (!_alreadyAdded) {
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_ai_similar_added') || '{}');
        _alreadyAdded = new Set(store[cacheKey] || []);
      } catch (_) { _alreadyAdded = new Set(); }
      this._aiSimilarAdded.set(cacheKey, _alreadyAdded);
    }

    // ── Base suggestions — reuses the existing session/localStorage cache,
    // so a repeat press for the same track doesn't re-hit the AI unless the
    // dedup pass below actually needs a backfill.
    if (!this._aiAddSimilarCache) this._aiAddSimilarCache = new Map();
    if (!this._aiAddSimilarCache.has(cacheKey)) {
      const persisted = this._aiSessionGet('addSimilar', cacheKey);
      if (persisted) this._aiAddSimilarCache.set(cacheKey, persisted);
    }

    const _askAI = async (excludeKeys) => {
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const excludeNote = excludeKeys?.size
        ? `\nDon't suggest any of these again: ${[...excludeKeys].slice(0, 20).join(', ')}`
        : '';
      const prompt = `I'm listening to "${track}" by "${artist}". Suggest ${TARGET_COUNT + 4} similar tracks to add to my queue.${excludeNote} Respond ONLY with a JSON array (no markdown):
[{"title":"Track Title","artist":"Artist Name"}]`;
      const resp = await this._aiProcess({ _crowFeature: 'discover',
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      // The list can arrive wrapped in text or in an object — find it either way.
      const list = this._aiCleanSongs(this._aiExtractList(raw));
      if (!list.length) { const e = new Error('empty AI answer'); e.kind = 'unreadable'; throw e; }
      return list;
    };

    let baseTracks = this._aiAddSimilarCache.get(cacheKey);
    // An answer cached by an older version may not be a usable list — drop it.
    if (baseTracks && !this._aiCleanSongs(baseTracks).length) baseTracks = null;
    if (!baseTracks) {
      try {
        baseTracks = await _askAI(null);
        this._aiAddSimilarCache.set(cacheKey, baseTracks);
        this._aiSessionSet('addSimilar', cacheKey, baseTracks);
      } catch (e) {
        this._maBatchLoading = false;
        this._aiFailToast(e); return;
      }
    }

    const _queueKeys = await _queueKeysP;

    // ── Filter out anything already queued, already added before, or
    // duplicated within the AI's own response ──
    const _seen = new Set();
    let candidates = (baseTracks || []).filter(t => {
      const key = _normKey(t.title, t.artist);
      if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });

    // ── Backfill: if dedup left us short of the target, ask once more with
    // everything already seen excluded, to top back up ──
    if (candidates.length < Math.ceil(TARGET_COUNT * 0.6)) {
      const excludeForRetry = new Set([..._queueKeys, ..._alreadyAdded, ..._seen]);
      try {
        const more = await _askAI(excludeForRetry);
        this._aiCleanSongs(more || []).forEach(t => {
          const key = _normKey(t.title, t.artist);
          if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return;
          _seen.add(key);
          candidates.push(t);
        });
      } catch (_) {
        // Backfill failing is non-fatal — proceed with whatever we already have.
      }
    }

    if (!candidates.length) {
      this._maBatchLoading = false;
      this._showToast('No new similar songs to add right now');
      return;
    }

    // Find the songs in Music Assistant in parallel and add them in order —
    // the first few straight away so the queue starts filling.
    const _enq = await this._enqueueTracksFast(candidates.slice(0, TARGET_COUNT), this._entity);
    const added = _enq.added, _missed = _enq.missed;
    _enq.addedTracks.forEach(t => _alreadyAdded.add(_normKey(t.title, t.artist)));

    // Persist the updated "already added for this track" set.
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ai_similar_added') || '{}');
      store[cacheKey] = [..._alreadyAdded];
      localStorage.setItem('crow_media_ai_similar_added', JSON.stringify(store));
    } catch (_) {}

    this._maBatchLoading = false;
    clearTimeout(this._maBatchLoadingTimer);
    this._pillPulse(0);
    if (added > 0) {
      this._showToast(_missed ? `Added ${added} of ${added + _missed} songs similar to "${track}" — ${_missed} couldn\u2019t be found in Music Assistant` : `✓ Added ${added} songs similar to "${track}"`, 4500);
    } else {
      this._showToast('\u26a0\ufe0f Couldn\u2019t find these songs in Music Assistant.', 5000);
    }
  },

  /**
   * Adds AI-suggested popular songs from the same release year as the
   * currently playing track. Same shape as _addSimilarSongsToQueue: dedupes
   * against the live queue and against anything already added for this same
   * year before, backfilling with a fresh AI request if dedup leaves us
   * short of the target count. The "already added" cache is keyed by year
   * (not by track+artist) so pressing this again later from a different
   * song that happens to share the same year still doesn't repeat suggestions.
   */
  async _addSameYearSongsToQueue() { return this._busyJob(() => this.__addSameYearSongsToQueue()); },

  async __addSameYearSongsToQueue() {
    if (!this._aiFeatureOn('discover')) { this._showToast('AI features are turned off in the card editor'); return; }
    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 15000);
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._maBatchLoading = false; this._showToast('Nothing playing right now'); return; }
    const attrs  = state.attributes;
    const artist = attrs.media_artist || '';
    const track  = attrs.media_title  || '';
    if (!artist && !track) { this._maBatchLoading = false; this._showToast('No track info available'); return; }
    if (!this._maEntityIds?.has(this._entity)) { this._maBatchLoading = false; this._showToast('Music Assistant required'); return; }

    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { this._maBatchLoading = false; this._showToast('\u26a0\ufe0f ' + this._aiErrorMessage('agent'), 5000); return; }

    const TARGET_COUNT = 18;
    const _normKey = (title, artistName) => (String(title || '').toLowerCase().trim() + '|' + String(artistName || '').toLowerCase().trim()).replace(/[^a-z0-9|]/g, '');

    // Read what's already queued while the AI is thinking (not before asking it).
    // ── Dedup source 1: what's already sitting in the live queue ──
    const _queueKeysP = (async () => {
    const _queueKeys = new Set();
    try {
      const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items);
      if (hasMassQueue) {
        const mqRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: this._entity, limit_before: 0, limit_after: 9999 },
          return_response: true
        });
        const raw = mqRes?.response?.[this._entity] || mqRes?.response || [];
        if (Array.isArray(raw)) raw.forEach(item => {
          const key = _normKey(item.media_title || item.name, item.media_artist || item.artist);
          if (key) _queueKeys.add(key);
        });
      } else {
        const qRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: this._entity }, return_response: true
        });
        const qData = qRes?.response?.[this._entity] || qRes?.response || null;
        [qData?.current_item, qData?.next_item].forEach(item => {
          const key = _normKey(item?.name || item?.media_item?.name, item?.media_item?.artists?.[0]?.name);
          if (key) _queueKeys.add(key);
        });
      }
    } catch (_) {
      // Non-fatal — if we can't read the queue this time, just skip queue dedup.
    }
    return _queueKeys;
    })();

    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // ── Resolve the release year — reuse AI Info's cache if this exact track's
    // panel has already been opened this session (same cache key/format as
    // _showAITrackInfo), avoiding a redundant AI round-trip just for the year.
    let year = null;
    const _trackInfoKey = ('trackinfo3|' + artist + '|' + track).toLowerCase();
    const _cachedInfo = this._aiTrackInfoCache?.get(_trackInfoKey);
    if (_cachedInfo?.year && /^\d{4}$/.test(String(_cachedInfo.year))) year = String(_cachedInfo.year);

    const _askAI = async (excludeKeys, knownYear) => {
      const excludeNote = excludeKeys?.size
        ? `\nDon't suggest any of these again: ${[...excludeKeys].slice(0, 20).join(', ')}`
        : '';
      const prompt = knownYear
        ? `Suggest ${TARGET_COUNT + 4} popular, well-known songs released in ${knownYear}.${excludeNote} Respond ONLY with a JSON object (no markdown): {"year":${knownYear},"songs":[{"title":"Track Title","artist":"Artist Name"}]}`
        : `What year was "${track}" by "${artist}" released? Then suggest ${TARGET_COUNT + 4} other popular, well-known songs from that same year.${excludeNote} If you can't confidently determine the release year, respond with {"year":null,"songs":[]}. Respond ONLY with a JSON object (no markdown): {"year":YYYY,"songs":[{"title":"Track Title","artist":"Artist Name"}]}`;
      const resp = await this._aiProcess({ _crowFeature: 'discover',
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
      const objStart = stripped.indexOf('{'), objEnd = stripped.lastIndexOf('}');
      if (objStart === -1 || objEnd <= objStart) throw new Error('No JSON in response');
      return JSON.parse(stripped.slice(objStart, objEnd + 1));
    };

    let baseSongs = [];
    try {
      const result = await _askAI(null, year);
      if (!year) year = result?.year ? String(result.year) : null;
      baseSongs = this._aiCleanSongs(Array.isArray(result?.songs) ? result.songs : []);
    } catch (e) {
      this._maBatchLoading = false;
      this._aiFailToast(e); return;
    }

    if (!year) {
      this._maBatchLoading = false;
      this._showToast("Couldn't determine a release year for this track");
      return;
    }

    const _queueKeys = await _queueKeysP;

    // ── Dedup source 2: what we've already added for this year in a previous
    // press — keyed by year, not track+artist, so a different same-year song
    // still won't repeat suggestions.
    const cacheKey = ('addyear|' + year).toLowerCase();
    if (!this._aiSameYearAdded) this._aiSameYearAdded = new Map();
    let _alreadyAdded = this._aiSameYearAdded.get(cacheKey);
    if (!_alreadyAdded) {
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_ai_same_year_added') || '{}');
        _alreadyAdded = new Set(store[cacheKey] || []);
      } catch (_) { _alreadyAdded = new Set(); }
      this._aiSameYearAdded.set(cacheKey, _alreadyAdded);
    }

    // ── Filter out anything already queued, already added before, or
    // duplicated within the AI's own response ──
    const _seen = new Set();
    let candidates = baseSongs.filter(t => {
      const key = _normKey(t.title, t.artist);
      if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });

    // ── Backfill: if dedup left us short of the target, ask once more with
    // everything already seen excluded, to top back up ──
    if (candidates.length < Math.ceil(TARGET_COUNT * 0.6)) {
      const excludeForRetry = new Set([..._queueKeys, ..._alreadyAdded, ..._seen]);
      try {
        const more = await _askAI(excludeForRetry, year);
        this._aiCleanSongs(more?.songs || []).forEach(t => {
          const key = _normKey(t.title, t.artist);
          if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return;
          _seen.add(key);
          candidates.push(t);
        });
      } catch (_) {
        // Backfill failing is non-fatal — proceed with whatever we already have.
      }
    }

    if (!candidates.length) {
      this._maBatchLoading = false;
      this._showToast(`No new songs from ${year} to add right now`);
      return;
    }

    // Find the songs in Music Assistant in parallel and add them in order —
    // the first few straight away so the queue starts filling.
    const _enq = await this._enqueueTracksFast(candidates.slice(0, TARGET_COUNT), this._entity);
    const added = _enq.added, _missed = _enq.missed;
    _enq.addedTracks.forEach(t => _alreadyAdded.add(_normKey(t.title, t.artist)));

    // Persist the updated "already added for this year" set.
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ai_same_year_added') || '{}');
      store[cacheKey] = [..._alreadyAdded];
      localStorage.setItem('crow_media_ai_same_year_added', JSON.stringify(store));
    } catch (_) {}

    this._maBatchLoading = false;
    clearTimeout(this._maBatchLoadingTimer);
    this._pillPulse(0);
    if (added > 0) {
      this._showToast(_missed ? `Added ${added} of ${added + _missed} songs from ${year} — ${_missed} couldn\u2019t be found in Music Assistant` : `✓ Added ${added} songs from ${year}`, 4500);
    } else {
      this._showToast('\u26a0\ufe0f Couldn\u2019t find these songs in Music Assistant.', 5000);
    }
  },

  /**
   * Adds AI-suggested popular songs matching both the genre AND release year
   * of the currently playing track. Same shape as _addSameYearSongsToQueue —
   * see that function's doc comment for the shared dedup/backfill approach.
   * The "already added" cache is keyed by normalized-genre + year together.
   */
  async _addSameGenreYearSongsToQueue() { return this._busyJob(() => this.__addSameGenreYearSongsToQueue()); },

  async __addSameGenreYearSongsToQueue() {
    if (!this._aiFeatureOn('discover')) { this._showToast('AI features are turned off in the card editor'); return; }
    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 15000);
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._maBatchLoading = false; this._showToast('Nothing playing right now'); return; }
    const attrs  = state.attributes;
    const artist = attrs.media_artist || '';
    const track  = attrs.media_title  || '';
    if (!artist && !track) { this._maBatchLoading = false; this._showToast('No track info available'); return; }
    if (!this._maEntityIds?.has(this._entity)) { this._maBatchLoading = false; this._showToast('Music Assistant required'); return; }

    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { this._maBatchLoading = false; this._showToast('\u26a0\ufe0f ' + this._aiErrorMessage('agent'), 5000); return; }

    const TARGET_COUNT = 18;
    const _normKey   = (title, artistName) => (String(title || '').toLowerCase().trim() + '|' + String(artistName || '').toLowerCase().trim()).replace(/[^a-z0-9|]/g, '');

    // Read what's already queued while the AI is thinking (not before asking it).
    // ── Dedup source 1: what's already sitting in the live queue ──
    const _queueKeysP = (async () => {
    const _queueKeys = new Set();
    try {
      const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items);
      if (hasMassQueue) {
        const mqRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: this._entity, limit_before: 0, limit_after: 9999 },
          return_response: true
        });
        const raw = mqRes?.response?.[this._entity] || mqRes?.response || [];
        if (Array.isArray(raw)) raw.forEach(item => {
          const key = _normKey(item.media_title || item.name, item.media_artist || item.artist);
          if (key) _queueKeys.add(key);
        });
      } else {
        const qRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: this._entity }, return_response: true
        });
        const qData = qRes?.response?.[this._entity] || qRes?.response || null;
        [qData?.current_item, qData?.next_item].forEach(item => {
          const key = _normKey(item?.name || item?.media_item?.name, item?.media_item?.artists?.[0]?.name);
          if (key) _queueKeys.add(key);
        });
      }
    } catch (_) {
      // Non-fatal — if we can't read the queue this time, just skip queue dedup.
    }
    return _queueKeys;
    })();

    // Genre labels can vary in phrasing between AI calls ("Punk" vs "Punk
    // Rock") — normalize before using as a cache key so repeat presses for
    // the same genre don't quietly split into separate dedup buckets.
    const _normGenre = g => String(g || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // ── Resolve genre + year — reuse AI Info's cache if this exact track's
    // panel has already been opened this session, avoiding a redundant AI
    // round-trip just for the metadata.
    let genre = null, year = null;
    const _trackInfoKey = ('trackinfo3|' + artist + '|' + track).toLowerCase();
    const _cachedInfo = this._aiTrackInfoCache?.get(_trackInfoKey);
    if (Array.isArray(_cachedInfo?.genre) && _cachedInfo.genre[0]) genre = _cachedInfo.genre[0];
    if (_cachedInfo?.year && /^\d{4}$/.test(String(_cachedInfo.year))) year = String(_cachedInfo.year);

    const _askAI = async (excludeKeys, knownGenre, knownYear) => {
      const excludeNote = excludeKeys?.size
        ? `\nDon't suggest any of these again: ${[...excludeKeys].slice(0, 20).join(', ')}`
        : '';
      const prompt = (knownGenre && knownYear)
        ? `Suggest ${TARGET_COUNT + 4} popular, well-known ${knownGenre} songs released in ${knownYear}.${excludeNote} Respond ONLY with a JSON object (no markdown): {"genre":"${knownGenre}","year":${knownYear},"songs":[{"title":"Track Title","artist":"Artist Name"}]}`
        : `What genre is "${track}" by "${artist}", and what year was it released? Then suggest ${TARGET_COUNT + 4} other popular, well-known songs matching that same genre AND released in that same year.${excludeNote} If you can't confidently determine both the genre and year, respond with {"genre":null,"year":null,"songs":[]}. Respond ONLY with a JSON object (no markdown): {"genre":"Genre Name","year":YYYY,"songs":[{"title":"Track Title","artist":"Artist Name"}]}`;
      const resp = await this._aiProcess({ _crowFeature: 'discover',
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
      const objStart = stripped.indexOf('{'), objEnd = stripped.lastIndexOf('}');
      if (objStart === -1 || objEnd <= objStart) throw new Error('No JSON in response');
      return JSON.parse(stripped.slice(objStart, objEnd + 1));
    };

    let baseSongs = [];
    try {
      const result = await _askAI(null, genre, year);
      if (!genre) genre = result?.genre || null;
      if (!year)  year  = result?.year ? String(result.year) : null;
      baseSongs = this._aiCleanSongs(Array.isArray(result?.songs) ? result.songs : []);
    } catch (e) {
      this._maBatchLoading = false;
      this._aiFailToast(e); return;
    }

    if (!genre || !year) {
      this._maBatchLoading = false;
      this._showToast("Couldn't determine this track's genre and year");
      return;
    }

    const _queueKeys = await _queueKeysP;

    // ── Dedup source 2: what we've already added for this genre+year combo
    // in a previous press ──
    const cacheKey = ('addgenreyear|' + _normGenre(genre) + '|' + year).toLowerCase();
    if (!this._aiSameGenreYearAdded) this._aiSameGenreYearAdded = new Map();
    let _alreadyAdded = this._aiSameGenreYearAdded.get(cacheKey);
    if (!_alreadyAdded) {
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_ai_same_genre_year_added') || '{}');
        _alreadyAdded = new Set(store[cacheKey] || []);
      } catch (_) { _alreadyAdded = new Set(); }
      this._aiSameGenreYearAdded.set(cacheKey, _alreadyAdded);
    }

    // ── Filter out anything already queued, already added before, or
    // duplicated within the AI's own response ──
    const _seen = new Set();
    let candidates = baseSongs.filter(t => {
      const key = _normKey(t.title, t.artist);
      if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });

    // ── Backfill: if dedup left us short of the target, ask once more with
    // everything already seen excluded, to top back up ──
    if (candidates.length < Math.ceil(TARGET_COUNT * 0.6)) {
      const excludeForRetry = new Set([..._queueKeys, ..._alreadyAdded, ..._seen]);
      try {
        const more = await _askAI(excludeForRetry, genre, year);
        this._aiCleanSongs(more?.songs || []).forEach(t => {
          const key = _normKey(t.title, t.artist);
          if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return;
          _seen.add(key);
          candidates.push(t);
        });
      } catch (_) {
        // Backfill failing is non-fatal — proceed with whatever we already have.
      }
    }

    if (!candidates.length) {
      this._maBatchLoading = false;
      this._showToast(`No new ${genre} songs from ${year} to add right now`);
      return;
    }

    // Find the songs in Music Assistant in parallel and add them in order —
    // the first few straight away so the queue starts filling.
    const _enq = await this._enqueueTracksFast(candidates.slice(0, TARGET_COUNT), this._entity);
    const added = _enq.added, _missed = _enq.missed;
    _enq.addedTracks.forEach(t => _alreadyAdded.add(_normKey(t.title, t.artist)));

    // Persist the updated "already added for this genre+year" set.
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ai_same_genre_year_added') || '{}');
      store[cacheKey] = [..._alreadyAdded];
      localStorage.setItem('crow_media_ai_same_genre_year_added', JSON.stringify(store));
    } catch (_) {}

    this._maBatchLoading = false;
    clearTimeout(this._maBatchLoadingTimer);
    this._pillPulse(0);
    if (added > 0) {
      this._showToast(_missed ? `Added ${added} of ${added + _missed} ${genre} songs from ${year} — ${_missed} couldn\u2019t be found in Music Assistant` : `✓ Added ${added} ${genre} songs from ${year}`, 4500);
    } else {
      this._showToast('\u26a0\ufe0f Couldn\u2019t find these songs in Music Assistant.', 5000);
    }
  },

  /**
   * Adds AI-suggested popular songs matching the genre of the currently
   * playing track (any year). Same shape as _addSameGenreYearSongsToQueue
   * minus the year constraint — see that function's doc comment for the
   * shared dedup/backfill approach. The "already added" cache is keyed by
   * normalized genre alone.
   */
  async _addSameGenreSongsToQueue() { return this._busyJob(() => this.__addSameGenreSongsToQueue()); },

  async __addSameGenreSongsToQueue() {
    if (!this._aiFeatureOn('discover')) { this._showToast('AI features are turned off in the card editor'); return; }
    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 15000);
    const state = this._hass?.states[this._entity];
    if (!state || state.state !== 'playing') { this._maBatchLoading = false; this._showToast('Nothing playing right now'); return; }
    const attrs  = state.attributes;
    const artist = attrs.media_artist || '';
    const track  = attrs.media_title  || '';
    if (!artist && !track) { this._maBatchLoading = false; this._showToast('No track info available'); return; }
    if (!this._maEntityIds?.has(this._entity)) { this._maBatchLoading = false; this._showToast('Music Assistant required'); return; }

    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { this._maBatchLoading = false; this._showToast('\u26a0\ufe0f ' + this._aiErrorMessage('agent'), 5000); return; }

    const TARGET_COUNT = 18;
    const _normKey   = (title, artistName) => (String(title || '').toLowerCase().trim() + '|' + String(artistName || '').toLowerCase().trim()).replace(/[^a-z0-9|]/g, '');

    // Read what's already queued while the AI is thinking (not before asking it).
    // ── Dedup source 1: what's already sitting in the live queue ──
    const _queueKeysP = (async () => {
    const _queueKeys = new Set();
    try {
      const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_queue_items);
      if (hasMassQueue) {
        const mqRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: this._entity, limit_before: 0, limit_after: 9999 },
          return_response: true
        });
        const raw = mqRes?.response?.[this._entity] || mqRes?.response || [];
        if (Array.isArray(raw)) raw.forEach(item => {
          const key = _normKey(item.media_title || item.name, item.media_artist || item.artist);
          if (key) _queueKeys.add(key);
        });
      } else {
        const qRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: this._entity }, return_response: true
        });
        const qData = qRes?.response?.[this._entity] || qRes?.response || null;
        [qData?.current_item, qData?.next_item].forEach(item => {
          const key = _normKey(item?.name || item?.media_item?.name, item?.media_item?.artists?.[0]?.name);
          if (key) _queueKeys.add(key);
        });
      }
    } catch (_) {
      // Non-fatal — if we can't read the queue this time, just skip queue dedup.
    }
    return _queueKeys;
    })();

    const _normGenre = g => String(g || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // ── Resolve genre — reuse AI Info's cache if this exact track's panel
    // has already been opened this session, avoiding a redundant AI
    // round-trip just for the genre.
    let genre = null;
    const _trackInfoKey = ('trackinfo3|' + artist + '|' + track).toLowerCase();
    const _cachedInfo = this._aiTrackInfoCache?.get(_trackInfoKey);
    if (Array.isArray(_cachedInfo?.genre) && _cachedInfo.genre[0]) genre = _cachedInfo.genre[0];

    const _askAI = async (excludeKeys, knownGenre) => {
      const excludeNote = excludeKeys?.size
        ? `\nDon't suggest any of these again: ${[...excludeKeys].slice(0, 20).join(', ')}`
        : '';
      const prompt = knownGenre
        ? `Suggest ${TARGET_COUNT + 4} popular, well-known ${knownGenre} songs.${excludeNote} Respond ONLY with a JSON object (no markdown): {"genre":"${knownGenre}","songs":[{"title":"Track Title","artist":"Artist Name"}]}`
        : `What genre is "${track}" by "${artist}"? Then suggest ${TARGET_COUNT + 4} other popular, well-known songs in that same genre.${excludeNote} If you can't confidently determine the genre, respond with {"genre":null,"songs":[]}. Respond ONLY with a JSON object (no markdown): {"genre":"Genre Name","songs":[{"title":"Track Title","artist":"Artist Name"}]}`;
      const resp = await this._aiProcess({ _crowFeature: 'discover',
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
      const objStart = stripped.indexOf('{'), objEnd = stripped.lastIndexOf('}');
      if (objStart === -1 || objEnd <= objStart) throw new Error('No JSON in response');
      return JSON.parse(stripped.slice(objStart, objEnd + 1));
    };

    let baseSongs = [];
    try {
      const result = await _askAI(null, genre);
      if (!genre) genre = result?.genre || null;
      baseSongs = this._aiCleanSongs(Array.isArray(result?.songs) ? result.songs : []);
    } catch (e) {
      this._maBatchLoading = false;
      this._aiFailToast(e); return;
    }

    if (!genre) {
      this._maBatchLoading = false;
      this._showToast("Couldn't determine a genre for this track");
      return;
    }

    const _queueKeys = await _queueKeysP;

    // ── Dedup source 2: what we've already added for this genre in a
    // previous press ──
    const cacheKey = ('addgenre|' + _normGenre(genre)).toLowerCase();
    if (!this._aiSameGenreAdded) this._aiSameGenreAdded = new Map();
    let _alreadyAdded = this._aiSameGenreAdded.get(cacheKey);
    if (!_alreadyAdded) {
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_ai_same_genre_added') || '{}');
        _alreadyAdded = new Set(store[cacheKey] || []);
      } catch (_) { _alreadyAdded = new Set(); }
      this._aiSameGenreAdded.set(cacheKey, _alreadyAdded);
    }

    // ── Filter out anything already queued, already added before, or
    // duplicated within the AI's own response ──
    const _seen = new Set();
    let candidates = baseSongs.filter(t => {
      const key = _normKey(t.title, t.artist);
      if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });

    // ── Backfill: if dedup left us short of the target, ask once more with
    // everything already seen excluded, to top back up ──
    if (candidates.length < Math.ceil(TARGET_COUNT * 0.6)) {
      const excludeForRetry = new Set([..._queueKeys, ..._alreadyAdded, ..._seen]);
      try {
        const more = await _askAI(excludeForRetry, genre);
        this._aiCleanSongs(more?.songs || []).forEach(t => {
          const key = _normKey(t.title, t.artist);
          if (!key || _queueKeys.has(key) || _alreadyAdded.has(key) || _seen.has(key)) return;
          _seen.add(key);
          candidates.push(t);
        });
      } catch (_) {
        // Backfill failing is non-fatal — proceed with whatever we already have.
      }
    }

    if (!candidates.length) {
      this._maBatchLoading = false;
      this._showToast(`No new ${genre} songs to add right now`);
      return;
    }

    // Find the songs in Music Assistant in parallel and add them in order —
    // the first few straight away so the queue starts filling.
    const _enq = await this._enqueueTracksFast(candidates.slice(0, TARGET_COUNT), this._entity);
    const added = _enq.added, _missed = _enq.missed;
    _enq.addedTracks.forEach(t => _alreadyAdded.add(_normKey(t.title, t.artist)));

    // Persist the updated "already added for this genre" set.
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_ai_same_genre_added') || '{}');
      store[cacheKey] = [..._alreadyAdded];
      localStorage.setItem('crow_media_ai_same_genre_added', JSON.stringify(store));
    } catch (_) {}

    this._maBatchLoading = false;
    clearTimeout(this._maBatchLoadingTimer);
    this._pillPulse(0);
    if (added > 0) {
      this._showToast(_missed ? `Added ${added} of ${added + _missed} ${genre} songs — ${_missed} couldn\u2019t be found in Music Assistant` : `✓ Added ${added} ${genre} songs`, 4500);
    } else {
      this._showToast('\u26a0\ufe0f Couldn\u2019t find these songs in Music Assistant.', 5000);
    }
  },

  _showAIMoodQueue() {
    const r = this.shadowRoot;
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    const maPopup = r.getElementById('maPopup');
    if (!maPopup) { this._showToast('Music Assistant required'); return; }

    const self = this;

    // Pre-warm the config entry ID so first tap has no extra latency
    this._getMAConfigEntryId();

    // Artist URI cache — keyed by artist name, persisted in sessionStorage + localStorage
    if (!this._moodArtistUriCache) {
      this._moodArtistUriCache = new Map();
      try {
        const stored = sessionStorage.getItem('crow_media_mood_uri_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          Object.entries(parsed).forEach(([k, v]) => this._moodArtistUriCache.set(k, v));
        }
      } catch(_) {}
      // Also load from localStorage for cross-session persistence
      try {
        const _lsStore = JSON.parse(localStorage.getItem('crow_media_ai_local_moodUriCache') || '{}');
        Object.entries(_lsStore).forEach(([k, entry]) => {
          if (entry?.data && !this._moodArtistUriCache.has(k)) this._moodArtistUriCache.set(k, entry.data);
        });
      } catch(_) {}
    }

    // Library tracks cache — keyed by artist list, persisted in sessionStorage
    // Always reset to force re-fetch with current CAP setting
    if (!this._moodLibraryCache) {
      this._moodLibraryCache = new Map();
      // Note: we intentionally don't restore from sessionStorage here so the
      // per-artist cap is always applied fresh (old cached data may be uncapped)
    }

    const moods = [
      { emoji:'⚡', label:'Energetic',   query:'upbeat energetic high-tempo music',              maSearch:['The Prodigy','Fatboy Slim','Chemical Brothers','Daft Punk'],              color:'#FF9F0A' },
      { emoji:'💪', label:'Workout',     query:'high energy workout power gym music',             maSearch:['AC/DC','Rage Against the Machine','Metallica','Eminem'],             color:'#FF375F' },
      { emoji:'🔥', label:'Hype',        query:'intense hype trap bass heavy music',              maSearch:['Travis Scott','Drake','Kendrick Lamar','Future'],              color:'#FF6B35' },
      { emoji:'🚀', label:'Epic',        query:'epic cinematic orchestral powerful music',        maSearch:['Hans Zimmer','John Williams','Ennio Morricone','Two Steps from Hell'],        color:'#FF453A' },
      { emoji:'🌙', label:'Chill',       query:'relaxing chill laid-back ambient music',          maSearch:['Norah Jones','Jack Johnson','Ben Harper','Bon Iver'],          color:'#5E5CE6' },
      { emoji:'🧘', label:'Meditate',    query:'meditation mindfulness zen ambient music',        maSearch:['Brian Eno','Moby','Sigur Ros','Max Richter'],        color:'#6E6CD5' },
      { emoji:'😴', label:'Sleep',       query:'soft peaceful sleep ambient lullaby music',       maSearch:['Brian Eno','Max Richter','Moby','Erik Satie'],       color:'#30B0C7' },
      { emoji:'🌊', label:'Calm',        query:'calm peaceful serene nature ambient music',       maSearch:['Norah Jones','Jack Johnson','Nick Drake','Jose Gonzalez'],       color:'#32ADE6' },
      { emoji:'🎯', label:'Focus',       query:'focus concentration deep work instrumental',      maSearch:['Brian Eno','Bonobo','Tycho','Explosions in the Sky'],      color:'#007AFF' },
      { emoji:'📖', label:'Study',       query:'study lo-fi hip hop calm background music',       maSearch:['Nujabes','J Dilla','Bonobo','Madlib'],       color:'#0A84FF' },
      { emoji:'💡', label:'Creative',    query:'creative inspiration uplifting background music', maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'], color:'#30D158' },
      { emoji:'❤️', label:'Romantic',   query:'romantic love songs tender ballads',              maSearch:['Frank Sinatra','Norah Jones','Michael Buble','Adele'],              color:'#FF2D55' },
      { emoji:'😢', label:'Melancholic', query:'sad melancholic emotional introspective music',   maSearch:['Elliott Smith','Nick Drake','Sufjan Stevens','Bon Iver'],   color:'#636366' },
      { emoji:'😂', label:'Happy',       query:'happy joyful feel-good uplifting pop music',      maSearch:['Pharrell Williams','Bruno Mars','Justin Timberlake','Katy Perry'],      color:'#FFD60A' },
      { emoji:'😤', label:'Angry',       query:'angry intense metal punk aggressive music',       maSearch:['The Clash','Sex Pistols','Ramones','Green Day'],       color:'#FF3B30' },
      { emoji:'🎉', label:'Party',       query:'Now That\'s What I Call Party|Party Anthems|Party Hits|Essential Party|Best Party Songs',                 maSearch:['Dua Lipa','Bruno Mars','Mark Ronson','Calvin Harris'],                 color:'#FF9F0A' },
      { emoji:'🕺', label:'Dance',       query:'Now That\'s What I Call Dance|Dance Anthems|Dance Classics|Essential Dance|Dance Hits',             maSearch:['Daft Punk','Calvin Harris','Disclosure','Basement Jaxx'],             color:'#BF5AF2' },
      { emoji:'🍻', label:'Pub Night',   query:'Pub Classics|Pub Anthems|Sing-Along Classics|Pub Songs|Classic Sing-Along Hits',             maSearch:['The Pogues','Thin Lizzy','The Kinks','Status Quo'],             color:'#AC8E68' },
      { emoji:'🎸', label:'Rock',        query:'Now That\'s What I Call Rock|Essential Rock|Rock Classics|Rock Anthems|Classic Rock Hits',              maSearch:'The Rolling Stones',              color:'#FF6B35' },
      { emoji:'🤘', label:'Metal',       query:'Now That\'s What I Call Metal|Essential Metal|Metal Classics|Heavy Metal Hits|Metal Anthems',      maSearch:'Metallica',      color:'#636366' },
      { emoji:'🎵', label:'Pop',         query:'Now That\'s What I Call Music|Pop Hits|Essential Pop|Pop Classics|Greatest Pop Hits',                    maSearch:'Taylor Swift',                    color:'#FF2D55' },
      { emoji:'🎷', label:'Jazz',        query:'Essential Jazz|Jazz Classics|Jazz Standards|Best Of Jazz|Smooth Jazz Hits',             maSearch:'Miles Davis',             color:'#FFD60A' },
      { emoji:'🎻', label:'Classical',   query:'Essential Classical|Classical Masterpieces|Best Of Classical|Classical Hits|BBC Classical',                maSearch:'Ludwig van Beethoven',                color:'#AC8E68' },
      { emoji:'🎤', label:'Hip Hop',     query:'Now That\'s What I Call Hip Hop|Essential Hip Hop|Hip Hop Classics|Best Of Hip Hop|Rap Hits',                  maSearch:'Kendrick Lamar',                  color:'#32ADE6' },
      { emoji:'🎹', label:'Electronic',  query:'Now That\'s What I Call Dance|Essential Electronic|Dance Classics|Electronic Hits|Dance Anthems',            maSearch:'Daft Punk',            color:'#5E5CE6' },
      { emoji:'🪕', label:'Country',     query:'Essential Country|Country Classics|Country Hits|Now Country|Best Of Country',    maSearch:'Johnny Cash',    color:'#AC8E68' },
      { emoji:'🎺', label:'Blues',       query:'Essential Blues|Blues Classics|Best Of Blues|Blues Hits|Electric Blues',        maSearch:'B.B. King',        color:'#1C7ED6' },
      { emoji:'🎙️', label:'Soul',       query:'Essential Soul|Soul Classics|Soul Hits|Best Of Soul|Motown Classics',            maSearch:'Aretha Franklin',            color:'#FF6B35' },
      { emoji:'🪗', label:'Folk',        query:'Essential Folk|Folk Classics|Folk Hits|Acoustic Folk|Best Of Folk',     maSearch:'Bob Dylan',     color:'#30D158' },
      { emoji:'🌍', label:'World',       query:'Essential World Music|World Music Classics|Global Hits|World Beats',         maSearch:'Buena Vista Social Club',         color:'#30D158' },
      { emoji:'🌅', label:'Morning',     query:'uplifting positive morning feel-good music',      maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'],      color:'#FFD60A' },
      { emoji:'🌇', label:'Evening',     query:'mellow evening wind-down relaxing music',         maSearch:['James Taylor','Paul Simon','Carole King','Cat Stevens'],         color:'#FF9F0A' },
      { emoji:'🌧️', label:'Rainy Day',  query:'cosy rainy day indie folk acoustic music',        maSearch:['Bon Iver','Fleet Foxes','Iron and Wine','Sufjan Stevens'],        color:'#636366' },
      { emoji:'☀️', label:'Summer',      query:'summer beach sunshine feel-good vibes',           maSearch:['The Beach Boys','Jack Johnson','Vampire Weekend','Weezer'],           color:'#FF9F0A' },
      { emoji:'🍂', label:'Autumn',      query:'warm autumn cosy indie folk songs',               maSearch:['Bon Iver','Fleet Foxes','Iron and Wine','Sufjan Stevens'],               color:'#AC8E68' },
      { emoji:'❄️', label:'Winter',      query:'winter cosy fireplace acoustic music',           maSearch:'James Taylor',           color:'#32ADE6' },
      { emoji:'🌸', label:'Spring',      query:'spring fresh uplifting new beginnings hopeful music', maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'], color:'#30D158' },
      { emoji:'🎙', label:'Acoustic',    query:'Acoustic Hits|Acoustic Classics|Unplugged|Acoustic Sessions|Acoustic Favourites', maSearch:'James Taylor', color:'#AC8E68' },
      { emoji:'🌿', label:'Indie',       query:'Now That\'s What I Call Indie|Essential Indie|Indie Classics|Indie Hits|Indie Anthems',     maSearch:'Radiohead',     color:'#30D158' },
      { emoji:'🎤', label:'R&B',         query:'Essential R&B|R&B Classics|Best Of R&B|R&B Hits|Soul R&B',       maSearch:['Marvin Gaye','D Angelo','Lauryn Hill','Frank Ocean'],       color:'#BF5AF2' },
      { emoji:'🌴', label:'Reggae',      query:'Essential Reggae|Reggae Classics|Reggae Hits|Best Of Reggae|Roots Reggae',        maSearch:'Bob Marley',        color:'#30D158' },
      { emoji:'💃', label:'Latin',       query:'Essential Latin|Latin Hits|Latin Classics|Best Of Latin|Latin Pop Hits',       maSearch:'Carlos Santana',       color:'#FF375F' },
      { emoji:'🎹', label:'Piano',       query:'Piano Classics|Essential Piano|Piano Hits|Best Of Piano|Classical Piano',   maSearch:'Bill Evans',   color:'#636366' },
      { emoji:'🎮', label:'Gaming',      query:'epic video game soundtrack cinematic electronic',  maSearch:['Nobuo Uematsu','Koji Kondo','Austin Wintory','Jesper Kyd'],  color:'#5E5CE6' },
      { emoji:'🍷', label:'Dinner',      query:'elegant dinner party sophisticated jazz soul',     maSearch:'Miles Davis',     color:'#AC8E68' },
      { emoji:'🚗', label:'Road Trip',   query:'road trip driving windows down feel good music',  maSearch:'The Rolling Stones',  color:'#FF9F0A' },
      { emoji:'📼', label:'Nostalgic',   query:'nostalgic retro throwback classic hits 70s 80s 90s', maSearch:['The Beatles','The Rolling Stones','Fleetwood Mac','The Eagles'], color:'#FFD60A' },
      { emoji:'💔', label:'Heartbreak',  query:'heartbreak breakup sad love songs emotional',     maSearch:['Elliott Smith','Nick Drake','Sufjan Stevens','Bon Iver'],     color:'#FF2D55' },
      { emoji:'👑', label:'Confidence',  query:'confidence empowerment anthems bold uplifting music', maSearch:['Queen','Bon Jovi','U2','Foo Fighters'], color:'#FF9F0A' },
      // 48+ new moods
      { emoji:'🎙️', label:'50s',         query:'UK Number 1s 1950s|Now That\'s What I Call The 50s|50s Greatest Hits|Rock And Roll Hits 1950s',  maSearch:['Chuck Berry','Elvis Presley','Bill Haley','Little Richard','Buddy Holly','Jerry Lee Lewis','Bo Diddley','The Everly Brothers','Fats Domino','Eddie Cochran'], color:'#FF6B35' },
      { emoji:'🕰️', label:'60s',         query:'UK Number 1s 1960s|Now That\'s What I Call The 60s|60s Greatest Hits|Swinging Sixties Hits',        maSearch:['The Rolling Stones','The Beatles','The Kinks','The Who','The Beach Boys','The Supremes','Otis Redding','Small Faces','The Animals','Dusty Springfield'], color:'#AC8E68' },
      { emoji:'🪩', label:'70s',          query:'UK Number 1s 1970s|Now That\'s What I Call The 70s|70s Greatest Hits|Top Of The Pops 1970s',       maSearch:['Queen','ABBA','David Bowie','The Clash','Donna Summer','Elton John','Led Zeppelin','The Bee Gees','Blondie','Electric Light Orchestra'], color:'#FF9F0A' },
      { emoji:'📼', label:'80s',          query:'UK Number 1s 1980s|Now That\'s What I Call The 80s|80s Greatest Hits|Top Of The Pops 1980s',            maSearch:['Duran Duran','Wham!','Depeche Mode','A-ha','Bananarama','Culture Club','Cyndi Lauper','Madness','The Human League','New Order','Frankie Goes to Hollywood','Kim Wilde'], color:'#BF5AF2' },
      { emoji:'💽', label:'90s',          query:'UK Number 1s 1990s|Now That\'s What I Call The 90s|90s Greatest Hits|Top Of The Pops 1990s',   maSearch:['Oasis','Blur','Pulp','Elastica','Spice Girls','TLC','Ace of Base','No Doubt','Alanis Morissette','Backstreet Boys','Supergrass','Shed Seven'],         color:'#30D158' },
      { emoji:'📱', label:'2000s',        query:'UK Number 1s 2000s|Now That\'s What I Call The 2000s|00s Greatest Hits|Top Of The Pops 2000s',                  maSearch:['The Killers','Coldplay','Arctic Monkeys','Kaiser Chiefs','Franz Ferdinand','Razorlight','Amy Winehouse','Justin Timberlake','Nelly Furtado','Kelly Clarkson','Keane','Snow Patrol'], color:'#32ADE6' },
      { emoji:'🎧', label:'2010s',        query:'UK Number 1s 2010s|Now That\'s What I Call The 2010s|2010s Greatest Hits|Best Of The 2010s',                  maSearch:['Arctic Monkeys','Dua Lipa','Bruno Mars','Pharrell Williams','Lorde','Tame Impala','The 1975','Disclosure','Years and Years','Mark Ronson','Bastille','Clean Bandit'], color:'#5E5CE6' },
      { emoji:'📲', label:'2020s',        query:'UK Number 1s 2020s|Now That\'s What I Call The 2020s|2020s Hits|Best Of 2020s', maSearch:['Dua Lipa','Harry Styles','Glass Animals','Olivia Rodrigo','The Weeknd','Silk Sonic','Doja Cat','Billie Eilish','Lizzo','Arlo Parks','Little Simz','Joy Crookes'], color:'#30D158' },
      { emoji:'🔊', label:'Power Up',     query:'powerful motivational pump-up anthems winning music',    maSearch:['Queen','Bon Jovi','U2','Foo Fighters'],    color:'#FF375F' },
      { emoji:'🌃', label:'Late Night',   query:'late night atmospheric dark ambient city music',          maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],          color:'#5E5CE6' },
      { emoji:'🎭', label:'Dramatic',     query:'dramatic orchestral cinematic emotional sweeping music',  maSearch:['Hans Zimmer','John Williams','Ludwig van Beethoven','Wolfgang Amadeus Mozart'],  color:'#FF453A' },
      { emoji:'🧊', label:'Ice Cold',     query:'minimal cold electronic dark ambient hypnotic music',    maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],    color:'#30B0C7' },
      { emoji:'🌸', label:'Gentle',       query:'gentle soft delicate tender calming music',              maSearch:'James Taylor',              color:'#FF2D55' },
      { emoji:'🧠', label:'Deep Work',    query:'deep focus flow state no lyrics ambient study music',    maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],    color:'#007AFF' },
      { emoji:'☕', label:'Morning Coffee', query:'relaxed morning coffee jazz bossa nova easy music',    maSearch:['Astrud Gilberto','Antonio Carlos Jobim','Stan Getz','João Gilberto'],    color:'#AC8E68' },
      { emoji:'🌙', label:'Midnight',     query:'late night slow introspective melancholic music',        maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],        color:'#636366' },
      { emoji:'🏖️', label:'Holiday',     query:'holiday vacation sunshine beach tropical music',          maSearch:['Harry Belafonte','Bob Marley','Buena Vista Social Club','Manu Chao'],          color:'#FFD60A' },
      { emoji:'🍕', label:'Friday Night', query:'Friday Night Anthems|Friday Feeling|Party Anthems|Weekend Hits|Friday Night Party',              maSearch:'Taylor Swift',              color:'#FF6B35' },
      { emoji:'😌', label:'Content',      query:'happy content satisfied everyday life feel good music',  maSearch:['Pharrell Williams','Bruno Mars','Justin Timberlake','Katy Perry'],  color:'#30D158' },
      { emoji:'🤔', label:'Thoughtful',   query:'thoughtful reflective introspective singer songwriter',  maSearch:['Nick Drake','Elliott Smith','Joni Mitchell','James Taylor'],  color:'#636366' },
      // Energy additions (68+)
      { emoji:'🏃', label:'Running',      query:'running jogging cardio upbeat motivational running music',    maSearch:'The Rolling Stones',    color:'#FF375F' },
      { emoji:'🔥', label:'Beast Mode',   query:'beast mode intense heavy aggressive high energy training',    maSearch:'Metallica',    color:'#FF9F0A' },
      { emoji:'⚡', label:'Adrenaline',   query:'adrenaline rush extreme high energy fast pumping music',      maSearch:'The Rolling Stones',      color:'#FFD60A' },
      { emoji:'💪', label:'Pump Up',      query:'pump up pre workout motivational lifting music',              maSearch:'The Rolling Stones',              color:'#30D158' },
      { emoji:'🥊', label:'Fierce',       query:'fierce aggressive powerful intense fight music',              maSearch:'Metallica',              color:'#FF453A' },
      // Focus additions (73+)
      { emoji:'💻', label:'Coding',       query:'coding programming focus lo-fi electronic ambient music',     maSearch:['Nujabes','J Dilla','Bonobo','Madlib'],     color:'#32ADE6' },
      { emoji:'📖', label:'Reading',      query:'reading calm quiet background instrumental acoustic music',   maSearch:'James Taylor',   color:'#AC8E68' },
      { emoji:'🌊', label:'Flow State',   query:'flow state deep concentration instrumental no lyrics music',  maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],  color:'#5E5CE6' },
      { emoji:'🎼', label:'Instrumental', query:'instrumental music no lyrics classical acoustic ambient',     maSearch:['Brian Eno','Explosions in the Sky','Godspeed You Black Emperor','Mogwai'],     color:'#636366' },
      { emoji:'🧘', label:'Mindful',      query:'mindful meditation calm peaceful gentle healing music',       maSearch:['Brian Eno','Moby','Sigur Ros','Max Richter'],       color:'#30B0C7' },
      { emoji:'🎸', label:'Classic Rock', query:'Classic Rock Anthems|Now That\'s What I Call Classic Rock|Essential Classic Rock|Rock Classics 70s 80s|Arena Rock Hits', color:'#FF6B35', maSearch:'AC/DC' },
      { emoji:'🪩', label:'Disco',        query:'Disco Classics|Essential Disco|Best Of Disco|Disco Hits|Disco Fever',      maSearch:'Donna Summer',      color:'#BF5AF2' },
      // New genre moods
      { emoji:'🌍', label:'Afrobeats',    query:'Essential Afrobeats|Afrobeats Hits|Best Of Afrobeats|Afrobeats Classics',         maSearch:'Burna Boy',         color:'#FF9F0A' },
      { emoji:'🎤', label:'K-Pop',        query:'Essential K-Pop|K-Pop Hits|Best Of K-Pop|K-Pop Classics',              maSearch:'BTS',              color:'#FF2D55' },
      { emoji:'🥁', label:'Drum & Bass',  query:'Essential Drum And Bass|Drum And Bass Hits|DNB Classics|Liquid Drum And Bass',              maSearch:'Pendulum',              color:'#5E5CE6' },
      { emoji:'🇬🇧', label:'UK Garage',   query:'Essential UK Garage|UK Garage Classics|UK Garage Hits|2 Step Classics',           maSearch:'Craig David',           color:'#BF5AF2' },
      { emoji:'🎙️', label:'Grime',        query:'Essential Grime|Grime Classics|Grime Hits|Best Of Grime|UK Grime',             maSearch:'Stormzy',             color:'#636366' },
      { emoji:'🎹', label:'Synthpop',     query:'Essential Synthpop|Synthpop Classics|New Wave Hits|Synth Pop Classics|80s Electronic Hits', maSearch:'Depeche Mode', color:'#5E5CE6' },
      { emoji:'😢', label:'Emo',          query:'Essential Emo|Emo Classics|Best Of Emo|Emo Hits|Post-Hardcore Classics',        maSearch:'My Chemical Romance',        color:'#636366' },
      // New activity moods
      { emoji:'🍖', label:'BBQ',          query:'BBQ Classics|Garden Party|Summer Party Hits|Outdoor Anthems|Feel Good Summer',      maSearch:['The Beach Boys','Jack Johnson','Vampire Weekend','Weezer'],      color:'#FF9F0A' },
      { emoji:'☕', label:'Sunday Morning', query:'lazy sunday morning slow mellow feel good music',             maSearch:'James Taylor',             color:'#FFD60A' },
      { emoji:'🥂', label:'Pre-Drinks',   query:'Pre-Drinks Anthems|Getting Ready Playlist|Pre-Party Hits|Pump Up Anthems|Getting Ready', maSearch:'Taylor Swift', color:'#FF375F' },
      { emoji:'🛁', label:'Bath / Spa',   query:'spa bath relaxing indulgent ambient calm luxury music',         maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'],         color:'#30B0C7' },
      { emoji:'🍳', label:'Cooking',      query:'Cooking Classics|Kitchen Vibes|Cooking Music|Happy Background Music|Cooking Playlist',       maSearch:'Taylor Swift',       color:'#FF6B35' },
      // New emotional moods
      { emoji:'🌟', label:'Euphoric',     query:'euphoric peak transcendent uplifting blissful music',          maSearch:'Daft Punk',          color:'#FFD60A' },
      { emoji:'🍂', label:'Bittersweet',  query:'bittersweet melancholic yet hopeful emotional warm music',     maSearch:'Radiohead',     color:'#AC8E68' },
      { emoji:'💫', label:'Empowered',    query:'empowerment anthems female empowerment bold modern uplifting',  maSearch:'Taylor Swift',  color:'#FF375F' },
      { emoji:'🌻', label:'Nostalgic (Warm)', query:'warm nostalgic reminiscent emotional personal memories music', maSearch:['The Beatles','The Rolling Stones','Fleetwood Mac','The Eagles'], color:'#FFD60A' },
      // ── Binaural & Noise (indices 97–105) ────────────────────────────────
      { emoji:'🤍', label:'White Noise',   query:'white noise sleep focus concentration ambient', maSearch:['White Noise','White Noise Sleep','White Noise Focus'], color:'#94A3B8' },
      { emoji:'🌸', label:'Pink Noise',    query:'pink noise sleep relaxation study calming', maSearch:['Pink Noise','Pink Noise Sleep','Pink Noise Relaxation'], color:'#F9A8D4' },
      { emoji:'🟤', label:'Brown Noise',   query:'brown noise deep focus ADHD sleep rumble', maSearch:['Brown Noise','Brown Noise Focus','Brown Noise ADHD'], color:'#92400E' },
      { emoji:'🌿', label:'Green Noise',   query:'green noise nature ambient calming outdoor sounds', maSearch:['Green Noise','Nature Sounds','Green Noise Relaxation'], color:'#34D399' },
      { emoji:'🧠', label:'Delta Waves',   query:'delta waves binaural beats deep sleep 0.5 4hz healing', maSearch:['Delta Waves','Delta Binaural Beats','Deep Sleep Binaural'], color:'#A78BFA' },
      { emoji:'💭', label:'Theta Waves',   query:'theta waves binaural beats meditation creativity 4 8hz', maSearch:['Theta Waves','Theta Binaural Beats','Meditation Binaural'], color:'#818CF8' },
      { emoji:'🎯', label:'Alpha Waves',   query:'alpha waves binaural beats calm focus relaxed alert 8 14hz', maSearch:['Alpha Waves','Alpha Binaural Beats','Focus Binaural'], color:'#60A5FA' },
      { emoji:'⚡', label:'Beta Waves',    query:'beta waves binaural beats concentration alertness 14 30hz', maSearch:['Beta Waves','Beta Binaural Beats','Concentration Binaural'], color:'#F59E0B' },
      { emoji:'🔮', label:'Gamma Waves',   query:'gamma waves binaural beats peak cognition 30 100hz high focus', maSearch:['Gamma Waves','Gamma Binaural Beats','Peak Focus Binaural'], color:'#C084FC' },
    ];

    // Apply user overrides from visual editor
    const _moodOverrides = this._config?.mood_overrides || {};
    const _queryOverrides = this._config?.mood_query_overrides || {};
    moods.forEach(m => {
      if (_moodOverrides[m.label] !== undefined) {
        const _ov = _moodOverrides[m.label].split(',').map(s => s.trim()).filter(Boolean);
        if (_ov.length) m.maSearch = _ov.length === 1 ? _ov[0] : _ov;
      }
      if (_queryOverrides[m.label] !== undefined) {
        m.query = _queryOverrides[m.label];
      }
    });

    const categories = [
      { label:'Energy',  indices:[0,1,2,3,57,69,70,71,72,73] },
      { label:'Calm',    indices:[4,5,6,7,61,91] },
      { label:'Focus',   indices:[8,9,10,62,74,75,76,77,78] },
      { label:'Mood',    indices:[93,94,11,12,13,14,46,47,48,95,96,59,67,68] },
      { label:'Social',  indices:[88,90,15,16,17,43,44,45,66] },
      { label:'Activity',indices:[89,92,64,65] },
      { label:'Decades', indices:[49,50,51,52,53,54,55,56] },
      { label:'Genre',   indices:[79,18,19,20,21,22,23,24,80,81,82,83,84,85,86,87,25,26,27,28,29,37,38,39,40,41,42] },
      { label:'Time',    indices:[30,31,58,63] },
      { label:'Seasons',        indices:[33,34,35,36,32,60] },
      { label:'Binaural & Noise', indices:[97,98,99,100,101,102,103,104,105] },
    ];

    // Get MA speakers — only use those explicitly configured in this card's ma_entities.
    // Never fall back to _maEntityIds which contains ALL MA speakers in HA.
    var allMA = self._getValidMASpeakers(true);
    if (!allMA.length) {
      self._showToast('No MA speakers configured — add one in the visual editor');
      return;
    }
    const friendlyName = eid => self._entityDisplayName(eid);

    // SVG icon paths keyed by mood index
    const moodSvg = [
      // 0 Energetic - lightning bolt
      'M7 2l-2 7h5l-3 13 11-11h-6l4-9z',
      // 1 Workout - dumbbell
      'M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 5.57 2 7.71 3.43 9.14 2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22 14.86 20.57 16.29 22 18.43 19.86 19.86 18.43 22 16.29 20.57 14.86Z',
      // 2 Hype - fire
      'M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-.95.23-1.78.75-2.49 1.32C8.62 6.25 7.27 9.58 7.33 12.8c.04.94.08 1.88.41 2.74.29.72.79 1.35 1.39 1.85.85.66 1.93 1.03 3.02 1.05 1.24.03 2.47-.39 3.46-1.17.86-.68 1.52-1.65 1.83-2.71.35-1.06.23-2.27-.78-3.36zM11.93 17c-1.2 0-2.18-.98-2.18-2.18 0-.56.22-1.1.62-1.49.8-.74 1.82-1.14 2.56-1.9.22-.23.42-.47.62-.73.24.64.38 1.31.38 1.99.01 2.38-1.57 4.31-3.5 4.31z',
      // 3 Epic - mountain/crown
      'M5 3l3.057-3 11.943 11-11.943 11-3.057-3 8.8-8L5 3zm-5 8l3 3 3-3-3-3-3 3z',
      // 4 Chill - moon
      'M17.75 4.09l-2.53 1.94.91 3.06-2.63-1.81-2.63 1.81.91-3.06-2.53-1.94 3.17-.13L12 1l1.38 2.96 3.17.13zm3.5 6.91l-1.64 1.25.59 1.98-1.7-1.17-1.7 1.17.59-1.98L15.75 11l2.06-.08.69-1.95.69 1.95 2.06.08zm-2.28 4.95c.83-.08 1.72 1.1 1.19 1.85-.32.45-.66.87-1.08 1.27C15.17 23 8.84 23 4.94 19.07c-3.91-3.93-3.91-10.26 0-14.19.4-.4.82-.76 1.27-1.08.75-.53 1.93.36 1.85 1.19-.27 2.86.69 5.83 2.89 8.02a9.96 9.96 0 0 0 8.02 2.89z',
      // 5 Meditate - lotus/peace
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm4-8c0 2.21-1.79 4-4 4s-4-1.79-4-4h2c0 1.1.9 2 2 2s2-.9 2-2h2zm-5-4h2v2h-2zm4 0h2v2h-2z',
      // 6 Sleep - zzz/star
      'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
      // 7 Calm - wave
      'M2 12c1.1 0 1.9-.4 2.8-.9 1.7-.9 3.7-2 6.7-.4 2.6 1.4 4.3 2 6.5 2s4-.6 4-2V7c0 1.4-1.8 2-4 2s-3.9-.6-6.5-2c-3-.4-5 .7-6.7 1.6C3.9 9 3.1 9 2 9v3z',
      // 8 Focus - target
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
      // 9 Study - book
      'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5-10-5-10 5zM2 12l10 5 10-5',
      // 10 Creative - lightbulb
      'M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7m0 2a5 5 0 0 0-5 5 5 5 0 0 0 3 4.58V16h4v-2.42A5 5 0 0 0 17 9a5 5 0 0 0-5-5m-1 13h2v1h-2v-1z',
      // 11 Romantic - heart
      'M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z',
      // 12 Melancholic - raindrop
      'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z',
      // 13 Happy - smile
      'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-5-8a5 5 0 0 0 10 0H7zm1.5-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
      // 14 Angry - storm
      'M6 19v-3H4.5c-2.5 0-4.5-2-4.5-4.5S2 7 4.5 7c.15 0 .3.01.44.03C5.78 4.65 8.22 3 11 3c3.31 0 6 2.69 6 6 0 .35-.03.69-.09 1.03C18.75 10.64 20 12.17 20 14c0 2.21-1.79 4-4 4h-2v-2h2c1.1 0 2-.9 2-2s-.9-2-2-2h-1.5v-1c0-2.76-2.24-5-5-5-2.45 0-4.5 1.77-4.93 4.09L4 15H6c1.65 0 3 1.35 3 3v1H6z',
      // 15 Party - confetti/star burst
      'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
      // 16 Dance - music note with rhythm
      'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
      // 17 Pub Night - beer mug (simplified)
      'M4 2h11l-3 7h3l-5 13-2-8H6L4 2zm14 5h2c1.1 0 2 .9 2 2v3c0 1.1-.9 2-2 2h-2V7z',
      // 18 Rock - electric guitar shape
      'M9.5 13.09l1.41 1.41-4.5 4.5-1.41-1.41 4.5-4.5m11.31-9.19c-.78-.78-2.05-.78-2.83 0l-3.19 3.2c-.33-.03-.66-.04-1 0l-3.22-3.2c-.78-.78-2.05-.78-2.83 0-.78.78-.78 2.05 0 2.83l3.2 3.2c-.04.34-.04.67 0 1l-3.2 3.19c-.78.78-.78 2.05 0 2.83.78.78 2.05.78 2.83 0l3.19-3.2c.33.04.66.04 1 0l3.22 3.2c.78.78 2.05.78 2.83 0 .78-.78.78-2.05 0-2.83l-3.2-3.19c.04-.34.04-.67 0-1l3.2-3.2c.78-.78.78-2.05 0-2.83z',
      // 19 Metal - fist/horns
      'M19 11h-2V9h-2v2h-2V7h-2v4H9V9H7v4H5v-2H3v2c0 2.97 2.16 5.43 5 5.91V21h8v-4.09c2.84-.48 5-2.94 5-5.91v-2h-2v2z',
      // 20 Pop - star
      'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
      // 21 Jazz - saxophone shape
      'M14 2h-4c-.55 0-1 .45-1 1s.45 1 1 1h4c.55 0 1-.45 1-1s-.45-1-1-1zm0 3h-4c-.55 0-1 .45-1 1v8c0 2.77-1.34 5.22-3.4 6.75L4 22h16l-1.6-1.25C16.34 19.22 15 16.77 15 14V6c0-.55-.45-1-1-1z',
      // 22 Classical - treble clef (simplified)
      'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V6z',
      // 23 Hip Hop - microphone
      'M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20h-3c-.55 0-1 .45-1 1s.45 1 1 1h8c.55 0 1-.45 1-1s-.45-1-1-1h-3v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z',
      // 24 Electronic - equalizer bars
      'M7 18H5V10h2v8zm4 0H9V6h2v12zm4 0h-2V9h2v9zm4 0h-2V3h2v15z',
      // 25 Country - guitar
      'M17 3H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-9H9V5h6v3z',
      // 26 Blues - wave/rhythm
      'M2 8h20v2H2V8zm3 4h14v2H5v-2zm2 4h10v2H7v-2z',
      // 27 Soul - music notes
      'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm4 0v2h-2V3h2z',
      // 28 Folk - leaf/acoustic
      'M17 8C8 10 5.9 16.17 3.82 20.77L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20c4 0 4-2 8-2s4 2 8 2v-2c-4 0-4-2-8-2-1.13 0-1.9.16-2.53.33C14.28 11.98 17 10 21 10V8c-1.5 0-2.9.3-4 .8V8z',
      // 29 World - globe
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
      // 30 Morning - sunrise
      'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
      // 31 Evening - sunset
      'M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.99 4.58l-1.4 1.4 1.41 1.41 1.41-1.41-1.42-1.4zm12.03 12.01l-1.41-1.41-1.41 1.41 1.41 1.41 1.41-1.41zm1.41-12.01l-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM5.99 16.59l-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41z',
      // 32 Rainy Day - rain cloud
      'M6 14v2h2v-2H6zm4 0v2h2v-2h-2zm4 0v2h2v-2h-2zM17.5 9A5.5 5.5 0 0 0 12 4a5.5 5.5 0 0 0-5.37 4.32A4 4 0 0 0 3 12a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4 4 4 0 0 0-3.5-3.95z',
      // 33 Summer - sun/beach
      'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2z',
      // 34 Winter - snowflake
      'M22 11h-4.17l3.24-3.24-1.41-1.41L15 11h-2V9l4.66-4.66-1.41-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.41L9 13h2v2l-4.66 4.66 1.41 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.41-1.41L13 15v-2h2l4.66 4.66 1.41-1.41L17.83 13H22v-2z',
      // 36 Spring - flower/blossom
      'M12 22q-1.25 0-2.125-.875T9 19q0-.575.2-1.075t.575-.9L8 15.4q-.85.35-1.637.488T5 16q-2.075 0-3.537-1.463T0 11q0-1.825 1.025-3.237T3.8 5.85q.35-.9.938-1.638T6.1 3.025Q6.9 2 8.2 2t2.1 1.025q.7.7 1.075 1.625T11.75 6.7q.125-.025.25-.012T12 6.7q.125 0 .25.013t.25-.013q.125-1.075.5-2.025T14.2 2.925Q15.1 2 16.4 2t2.1 1.025q.7.7 1.075 1.625T20.2 5.85q1.75.575 2.775 1.9T24 11q0 2.075-1.463 3.538T19 16q-.775 0-1.562-.125T15.8 15.4l-1.775 1.625q.375.4.575.9T14.8 19q0 1.25-.875 2.125T12 22zM12 20q.425 0 .713-.288T13 19q0-.425-.288-.712T12 18q-.425 0-.712.288T11 19q0 .425.288.713T12 20zm-2-5l2-1.8 2 1.8 1.55-1.425-2-1.825.45-2.1-.975.325-.625.2q-.2.05-.4.05-.425 0-.8-.15t-.65-.45q-.275.3-.65.45t-.8.15q-.2 0-.4-.05l-.625-.2-.975-.325.45 2.1-2 1.825L10 15z',
      // 35 Acoustic - guitar headstock
      'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm2 13.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-9c-.83 0-1.5-.67-1.5-1.5S13.17 4.5 14 4.5s1.5.67 1.5 1.5S14.83 7.5 14 7.5zM7 13.5c-.83 0-1.5-.67-1.5-1.5S6.17 10.5 7 10.5s1.5.67 1.5 1.5S7.83 13.5 7 13.5zm4-4c-.83 0-1.5-.67-1.5-1.5S10.17 6.5 11 6.5s1.5.67 1.5 1.5S11.83 9.5 11 9.5z',
      // 36 Indie - vinyl record
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
      // 37 R&B - musical note with pulse
      'M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z',
      // 38 Reggae - palm/island
      'M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
      // 39 Latin - maracas/music note
      'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm-2 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
      // 40 Piano - piano keys
      'M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 17H4v-5h7v5zm0-7H4V4h7v8zm9 7h-7v-5h7v5zm0-7h-7V4h7v8z',
      // 41 Gaming - gamepad
      'M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zM9 16.5V22h6v-5.5l-3-3-3 3zM16.5 9l-3 3 3 3H22V9h-5.5z',
      // 42 Dinner - wine glass
      'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
      // 43 Road Trip - car/route
      'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.08 3.11H5.77L6.85 7zM19 17H5v-5h14v5z',
      // 44 Nostalgic - clock/retro
      'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z',
      // 45 Late Night - crescent + stars
      'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9zm0 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm6-10h1v1h-1zm2 2h1v1h-1zm-1 2h1v1h-1z',
      // 46 Heartbreak - broken heart
      'M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402zM13 10l-2 4h3l-2 4',
      // 47 Confidence - crown
      'M5 16L3 5l5.5 5L12 2l3.5 8L21 5l-2 11H5zm2 4h10v-2H7v2z',
      // 49 50s - microphone/retro
      'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V5a3 3 0 0 1 3-3m7 9c0 3.53-2.61 6.44-6 6.93V20h-2v-2.07C7.61 17.44 5 14.53 5 11H7a5 5 0 0 0 5 5 5 5 0 0 0 5-5h2z',
      // 49 60s - vinyl
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
      // 50 70s - disco ball
      'M12 3C9.5 3 7.45 4.61 6.72 6.86L3 5v2l3.06 1.28C6.02 8.83 6 9.16 6 9.5c0 3.31 2.69 6 6 6s6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM3 19h18v2H3z',
      // 51 80s - cassette
      'M4 5C2.89 5 2 5.89 2 7v10c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V7c0-1.11-.89-2-2-2H4zm0 2h16v10H4V7zm2 1v2h3V8H6zm7 0v2h3V8h-3zm-4.5 3C7.12 11 6 12.12 6 13.5S7.12 16 8.5 16 11 14.88 11 13.5 9.88 11 8.5 11zm7 0c-1.38 0-2.5 1.12-2.5 2.5S14.12 16 15.5 16 18 14.88 18 13.5 16.88 11 15.5 11z',
      // 52 90s - cd
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5S10.62 9.5 12 9.5s2.5 1.12 2.5 2.5S13.38 14.5 12 14.5z',
      // 53 2000s - smartphone
      'M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-4.2-5.78v1.75l3.2-2.99L12.8 9v1.8c-3.1.43-4.35 2.56-4.8 4.7 1.11-1.49 2.71-2.22 4.8-2.28z',
      // 54 Power Up - fist
      'M7 16h2v3h2v-3h2v3h2v-5H7v5H5V9c0-.55.45-1 1-1h3V5.5C9 4.12 10.12 3 11.5 3S14 4.12 14 5.5V8h3c.55 0 1 .45 1 1v3h-2V9h-2.5v1H10V9H9v1h-.5V9H7v7z',
      // 55 Late Night - crescent moon
      'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
      // 56 Dramatic - theatre mask
      'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-6c.83 0 1.5-.67 1.5-1.5S16.33 11 15.5 11 14 11.67 14 12.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 11 8.5 11 7 11.67 7 12.5 7.67 14 8.5 14zm3.5 3c-1.96 0-3.67.74-4.94 1.94 1.27 1.23 3 2 4.94 2s3.67-.77 4.94-2C15.17 17.74 13.46 17 12 17z',
      // 57 Ice Cold - snowflake
      'M22 11h-4.17l3.24-3.24-1.41-1.41L15 11h-2V9l4.66-4.66-1.41-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.41L9 13h2v2l-4.66 4.66 1.41 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.41-1.41L13 15v-2h2l4.66 4.66 1.41-1.41L17.83 13H22v-2z',
      // 58 Gentle - feather/leaf
      'M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 2-8 2 1-1 4-3.5 4-3.5H14c-6 0-8 4-8 4 0-1 .17-2 .5-2.83C10 7 14.82 6 17 8z',
      // 59 Deep Work - brain
      'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
      // 60 Morning Coffee - coffee cup
      'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
      // 61 Midnight - moon and stars
      'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9zm0 0',
      // 62 Holiday - sun/beach
      'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
      // 63 Friday Night - star burst
      'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z',
      // 64 Content - smile
      'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-6c.83 0 1.5-.67 1.5-1.5S16.33 11 15.5 11 14 11.67 14 12.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 11 8.5 11 7 11.67 7 12.5 7.67 14 8.5 14zm3.5 3c-1.96 0-3.67.74-4.94 1.94 1.27 1.23 3 2 4.94 2s3.67-.77 4.94-2C15.17 17.74 13.46 17 12 17z',
      // 65 Thoughtful - thought bubble
      'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
      // 65 2010s - headphones
      'M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z',
      // 66 2020s - phone with streaming
      'M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5S10.67 19 11.5 19s1.5.67 1.5 1.5S12.33 22 11.5 22zm4.5-4H7V4h9v14z',
      // 67 Running - person running
      'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z',
      // 68 Beast Mode - lightning
      'M7 2v11h3v9l7-12h-4l4-8z',
      // 69 Adrenaline - flame
      'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
      // 70 Pump Up - dumbbell
      'M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z',
      // 71 Fierce - play/arrow
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
      // 72 Coding - brackets
      'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
      // 73 Reading - book
      'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
      // 74 Flow State - waves
      'M17 16.99c-1.35 0-2.2.42-2.95.8-.65.33-1.18.6-2.05.6-.9 0-1.4-.25-2.05-.6-.75-.38-1.57-.8-2.95-.8s-2.2.42-2.95.8c-.65.33-1.17.6-2.05.6v1.95c1.35 0 2.2-.42 2.95-.8.65-.33 1.17-.6 2.05-.6s1.4.25 2.05.6c.75.38 1.57.8 2.95.8s2.2-.42 2.95-.8c.65-.33 1.18-.6 2.05-.6.9 0 1.4.25 2.05.6.75.38 1.57.8 2.95.8v-1.95c-.9 0-1.4-.25-2.05-.6-.75-.38-1.58-.8-2.95-.8z',
      // 75 Instrumental - music note
      'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm-2 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
      // 76 Mindful - peace circle
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-5-8a5 5 0 0 0 10 0H7z',
      // 77 Instrumental - music staff
      'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
      // 78 Mindful (alias) - lotus
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-5-8a5 5 0 0 0 10 0H7z',
      // 79 Classic Rock - electric guitar
      'M22 5l-9.86 9.86-1.41-1.41-1.42 1.41 2.83 2.83L22 7.5V5zm-18 8.31V17h3.69l2.81-2.81-3.69-3.69L4 13.31zM3 18h3l8-8-3-3-8 8v3z',
      // 80 Disco - disco ball
      'M12 3C9.79 3 8 4.79 8 7s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zM4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0zM14 16h-4v-2.08c.33-.07.66-.12 1-.12s.67.05 1 .12V14h2v2zm4.5-9.625a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0z',
      // 81 Afrobeats - globe/world music
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
      // 82 K-Pop - star with sparkle
      'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6zM5 3l1 1-1 1-1-1zm14 0l1 1-1 1-1-1zM5 19l1 1-1 1-1-1zm14 0l1 1-1 1-1-1z',
      // 83 Drum & Bass - waveform/bass
      'M2 12h2v-2h2v4h2V8h2v8h2V6h2v12h2V10h2v4h2v-2h2v2h-2v2h-2v-2h-2V20h-2V4h-2v16h-2V8H8v8H6v-4H4v2H2z',
      // 84 UK Garage - vinyl with crown
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zM7 3.5l1.5 2h7L17 3.5 12 2z',
      // 85 Grime - microphone bolt
      'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V5a3 3 0 0 1 3-3m7 9c0 3.53-2.61 6.44-6 6.93V20h-2v-2.07C7.61 17.44 5 14.53 5 11H7a5 5 0 0 0 5 5 5 5 0 0 0 5-5h2zM10 7l2-5 2 5h-4z',
      // 86 Synthpop - synthesizer keys
      'M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 17H4v-5h7v5zm0-7H4V4h7v8zm9 7h-7v-5h7v5zm0-7h-7V4h7v8zM6 9h1v3H6zm2 0h1v3H8zm2 0h1v3h-1zm5 0h1v3h-1zm2 0h1v3h-1zm2 0h1v3h-1z',
      // 87 Emo - broken heart with music note
      'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05zM13 9h-2v2H9v2h2v2h2v-2h2v-2h-2z',
      // 88 BBQ - flame/grill
      'M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-.95.23-1.78.75-2.49 1.32C8.62 6.25 7.27 9.58 7.33 12.8c.04.94.08 1.88.41 2.74.29.72.79 1.35 1.39 1.85.85.66 1.93 1.03 3.02 1.05 1.24.03 2.47-.39 3.46-1.17.86-.68 1.52-1.65 1.83-2.71.35-1.06.23-2.27-.78-3.36zM4 19h16v2H4v-2z',
      // 89 Sunday Morning - sun with zzz
      'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
      // 90 Pre-Drinks - champagne/party
      'M9 3v1H4v2h1l1 7H5c-1.1 0-2 .9-2 2v1h9v-1c0-1.1-.9-2-2-2H9l1-7h1V4h-5V3H9zm8 0l-1 1 1 1-3 4 1 1 3-4 1 1V4l-2-1zm-3 8l-1 1 1 1h4l1-1-1-1h-4z',
      // 91 Bath/Spa - bathtub/water drop
      'M7 11h2v2H7zm0 4h2v2H7zm4-4h2v2h-2zm0 4h2v2h-2zm4-4h2v2h-2zm0 4h2v2h-2zM21 6.5A2.5 2.5 0 0 0 18.5 4c-.74 0-1.41.3-1.89.79L15 6.4V4h-2v5h5V7h-2.33l1.09-1.09c.27-.27.64-.41 1.04-.41A1.5 1.5 0 0 1 19 7v1h2V6.5zM3 9v11c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9H3zm16 11H5v-9h14v9z',
      // 92 Cooking - chef hat / utensils
      'M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-8-15.03-8-15.03 0h15.03zM1.02 17h15v2h-15z',
      // 93 Euphoric - star burst / radiant
      'M12 2l1.5 4.5h4.5l-3.5 2.5 1.5 4.5-4-3-4 3 1.5-4.5L5.5 6.5H10L12 2zm0 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 12h2M20 12h2M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
      // 94 Bittersweet - half smile half sad
      'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-4.5-6h4a2 2 0 0 0 2-2v-.5h-6V14zm4.5-5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-4 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 4H12v1.5h3V13z',
      // 95 Empowered - fist raised
      'M8 6.5C8 5.12 9.12 4 10.5 4c.93 0 1.73.5 2.17 1.24.27-.15.57-.24.9-.24C14.88 5 16 6.12 16 7.5v1c.55 0 1 .45 1 1V14c0 2.21-1.79 4-4 4h-2c-1.59 0-3.07-.95-3.71-2.4L5 11l1.32-.95c.42-.3.96-.33 1.41-.1L9 10.77V6.5H8zm2 0v5.61l-2.5-1.42L9 13h2c0 .55.45 1 1 1s1-.45 1-1h2V9.5h-1v-2c0-.28-.22-.5-.5-.5s-.5.22-.5.5v1h-1v-2c0-.28-.22-.5-.5-.5S10 6.22 10 6.5z',
      // 96 Nostalgic Warm - clock with heart
      'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7zM16 11c-.55 0-1 .16-1.41.42L12 13.5l-2.59-2.08C8.99 11.16 8.46 11 8 11c-1.1 0-2 .9-2 2s.9 2 2 2l4 3 4-3c1.1 0 2-.9 2-2s-.9-2-2-2z',
    ];

    // Vibes as a list, in the same style as the library's categories: a
    // coloured rounded-square icon and the name, grouped under headings.
    // With Row Glow on in the editor, rows get the same colour glow the
    // library rows use.
    const buildMoodGrid = () => {
      const wrap = document.createElement('div');
      const glowOn = this._config?.row_glow === true;
      categories.forEach(cat => {
        const sec = document.createElement('div');
        sec.style.cssText = 'margin-bottom:14px;';
        const catLabel = document.createElement('div');
        catLabel.style.cssText = `font-size:11px;font-weight:700;color:${this._pt("dim")};letter-spacing:0.8px;text-transform:uppercase;padding:10px 16px 4px;`;
        catLabel.dataset.catLabel = cat.label;
        catLabel.textContent = cat.label;
        const list = document.createElement('div');
        list.className = 'ma-ios-categories';
        list.style.padding = '0';
        cat.indices.forEach(i => {
          const m = moods[i];
          const hex = (m.color && m.color[0] === '#' && m.color.length === 7) ? m.color : '#007AFF';
          const row = document.createElement('div');
          row.className = 'ma-ios-cat-row ai-mood-btn';
          row.dataset.idx = String(i);
          row.setAttribute('role', 'button');
          const icon = document.createElement('div');
          icon.className = 'ma-ios-cat-icon';
          icon.style.background = hex;
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.style.fill = '#fff';
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', moodSvg[i] || 'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z');
          svg.appendChild(path);
          icon.appendChild(svg);
          const lbl = document.createElement('span');
          lbl.className = 'ma-ios-cat-label';
          lbl.textContent = m.label;
          // No › — a vibe plays straight away rather than opening another screen.
          row.appendChild(icon); row.appendChild(lbl);
          if (glowOn) {
            row.style.background   = `linear-gradient(90deg, ${hex}20 0%, transparent 60%)`;
            row.style.boxShadow    = `inset 0 0 0 1px ${hex}25`;
            row.style.borderRadius = '12px';
            row.style.marginBottom = '4px';
            row.style.borderBottom = 'none';
          }
          list.appendChild(row);
        });
        sec.appendChild(catLabel);
        sec.appendChild(list);
        wrap.appendChild(sec);
      });
      return wrap;
    };

    // Vibes respond to the touch itself — finger down and up on the same row
    // without scrolling — not to the browser's click. iPhone can send an
    // extra click a moment after a tap, landing on whatever has just appeared
    // under the finger: that used to pick a vibe the instant the list opened.
    // The card's library click guard also no longer swallows real taps here.
    const wireMoodBtns = container => {
      container.querySelectorAll('.ai-mood-btn').forEach(btn => {
        let sx = 0, sy = 0, moved = false, downAt = 0;
        btn.setAttribute('tabindex', '0');
        btn.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; downAt = Date.now(); }, { passive: true });
        btn.addEventListener('pointermove', (e) => { if (Math.abs(e.clientY - sy) > 8 || Math.abs(e.clientX - sx) > 8) moved = true; }, { passive: true });
        btn.addEventListener('pointercancel', () => { downAt = 0; });
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });   // extra clicks: ignored
        const choose = () => {
          const m = moods[parseInt(btn.dataset.idx)];
          const _ms = m.maSearch || m.query;
          const _seeds = Array.isArray(_ms) ? _ms : [_ms];
          // Optimistic UI — show mood label + primary seed artist instantly
          const _primarySeed = Array.isArray(_seeds) ? _seeds[0] : _seeds;
          self._setOptimisticMedia(m.label, _primarySeed);
          doMood(_seeds, m.label, m.query || '');
        };
        btn.addEventListener('pointerup', (e) => {
          const pressed = downAt; downAt = 0;
          if (!pressed || moved) return;                                     // a scroll, or a release with no press here
          if (Date.now() - (overlayRef.openedAt || 0) < 450) return;         // the tap that opened the list
          e.preventDefault(); e.stopPropagation();
          choose();
        });
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      });
    };

    const overlayRef = { el: null }; // allows playMoodOnSpeaker to remove overlay even when called before overlay is created
    const _playMoodInner = async (seeds, label, targetEntity, moodQuery, run = {}) => {
      overlayRef.el?.remove();
      maPopup.classList.remove('visible');

      // Straight back to the player screen. The tap that picked the vibe lands on
      // the artwork once the list disappears, and a single tap on the artwork opens
      // the AI Info panel — so cancel any pending art tap and block new ones for a
      // moment (same guard the other "start playing" actions use), and make sure no
      // info panel is left open behind the list.
      if (self._artTapTimer) { clearTimeout(self._artTapTimer); self._artTapTimer = null; }
      self._suppressArtTap = true;
      clearTimeout(self._suppressArtTapTimer);
      self._suppressArtTapTimer = setTimeout(() => { self._suppressArtTap = false; }, 1500);
      try { self._closeInfoPopup(); } catch (_) {}

      // Resolve MA entity
      let maEntity = targetEntity;
      const _isMAm = eid => !!(self._knownMaEntities?.has(eid) || self._maEntityIds?.has(eid));
      if (!_isMAm(maEntity)) {
        const _maList = self._getValidMASpeakers(true);
        if (_maList.length) maEntity = _maList[0];
      }

      // Debounce — cancel any previous in-flight mood request
      const _playId = Symbol();
      self._moodPlayPending = _playId;
      run.id = _playId;
      const _stale = () => self._moodPlayPending !== _playId;

      self._showLoadingToast('Starting ' + label + '…');
      self._pillPulse(10000);
      self._maBatchLoading = true;
      clearTimeout(self._maBatchLoadingTimer);
      self._maBatchLoadingTimer = setTimeout(() => { self._maBatchLoading = false; }, 30000);

      // seeds is always an array of artist names
      const seedArtists = Array.isArray(seeds) ? seeds : [seeds];
      const primarySeed = seedArtists[0];

      // ── FAST START — the first song plays now, the queue builds behind it ──
      // Music Assistant's radio_mode is slow: it has to build a whole queue of
      // similar tracks before anything plays (minutes on a streaming provider),
      // and 'replace' means nothing else plays until it's done. So a vibe never
      // leads with radio any more. Instead: one quick track search per seed
      // artist, all at once, and the FIRST track back is played straight away
      // (enqueue 'replace', no radio). Every other track found is then added in
      // one batch, and radio / playlists only EXTEND the queue afterwards
      // (enqueue 'add') — they can no longer wipe or delay what's playing.
      // If the fast start can't play anything, the original radio paths below
      // run exactly as before.
      const _fT0 = Date.now();
      // Timing for each phase, printed as one console.info line when the vibe finishes.
      const _tm = {};
      const _mark = k => { if (_tm[k] == null) _tm[k] = Date.now() - _fT0; };
      const _fDecade = (moodQuery && moodQuery.split('|')[0].match(/\b(19[5-9]0s|20[012]0s)\b/i)?.[0]) || '';
      const _fNoPipe = !moodQuery || (!moodQuery.includes('|') && !/\b(19[5-9]0s|20[012]0s)\b/i.test(moodQuery));
      const _fGenre = !_fNoPipe && !_fDecade && !!moodQuery;
      // Tracks taken from each seed artist (few artists → more from each).
      const _fCap = _fNoPipe ? Math.max(2, Math.ceil(20 / seedArtists.length)) : 3;
      const _fNorm = s => (s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
      const _fArtistOf = t => (t?.artists?.[0]?.name || t?.artist?.name || (typeof t?.artist === 'string' ? t.artist : '') || '');
      const _fKey = t => _fNorm(t?.name || t?.title) + '|' + _fNorm(_fArtistOf(t));
      const _fShuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
      // Only what's needed to queue a track and de-duplicate it — keeps the cache small.
      const _fSlim = t => {
        const uri = t?.uri || t?.media_content_id || null;
        if (!uri) return null;
        const artist = t?.artists?.[0]?.name || t?.artist?.name || t?.media_artist || (typeof t?.artist === 'string' ? t.artist : '') || '';
        return { uri, name: t?.name || t?.media_title || t?.title || '', artists: artist ? [{ name: artist }] : [] };
      };
      const _fSeen = new Set();            // URIs + title/artist keys this vibe has already queued
      const _perSeed = new Map();          // seed → tracks found for it
      let _fastOk = false, _claimed = false;
      const _fastCid = self._maConfigEntryId || await self._getMAConfigEntryId().catch(() => null);

      const _fSleep = ms => new Promise(res => setTimeout(res, ms));
      // Nothing may hang forever: every Music Assistant call gets a time limit.
      const _fTimed = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

      // ── Track-pool cache ──────────────────────────────────────────────────
      // What a vibe's searches found is kept for 24 hours, so playing the same
      // vibe again skips searching entirely (each play still shuffles it fresh).
      const _POOL_LS = 'crow_media_vibe_pool_v1', _POOL_TTL = 24 * 3600 * 1000;
      const _poolKey = [label, seedArtists.join(','), moodQuery || ''].join('|').toLowerCase();
      const _poolRead = () => { try { return JSON.parse(localStorage.getItem(_POOL_LS) || '{}') || {}; } catch (_) { return {}; } };
      const _poolWrite = (all) => {
        try {
          const now = Date.now();
          const keep = Object.entries(all).filter(([, v]) => v && now - v.ts < _POOL_TTL)
            .sort((a, b) => b[1].ts - a[1].ts).slice(0, 30);
          localStorage.setItem(_POOL_LS, JSON.stringify(Object.fromEntries(keep)));
        } catch (_) {}
      };
      const _poolDrop = () => { const all = _poolRead(); delete all[_poolKey]; _poolWrite(all); };
      let _cached = (() => {
        const e = _poolRead()[_poolKey];
        return (e && Date.now() - e.ts < _POOL_TTL && e.seeds && Object.values(e.seeds).some(l => l?.length)) ? e : null;
      })();

      // ── Seed search: your library first, streaming services only if needed ──
      // Library tracks come back as library:// URIs, which Music Assistant queues
      // straight from its own database instead of looking each one up online.
      const _fSearchRaw = async (q, libraryOnly, limit) => {
        try {
          const r = await _fTimed(self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'search',
            service_data: Object.assign({ config_entry_id: _fastCid, name: q, media_type: 'track', limit }, libraryOnly ? { library_only: true } : {}),
            return_response: true
          }), 20000);
          return (r?.response?.tracks || []).filter(t => t?.uri);
        } catch (_) { return []; }
      };
      const _fSearch = async (seed) => {
        const want = _fNorm(seed);
        const mineOf = list => list.filter(t => { const a = _fNorm(_fArtistOf(t)); return a && (a.includes(want) || want.includes(a)); });
        const limit = Math.max(8, _fCap + 4);
        let lib = [];
        if (!_fDecade) {                   // "Artist 1980s" never matches a library search
          lib = mineOf(await _fSearchRaw(seed, true, limit));
          if (lib.length >= _fCap) return lib;
        }
        const prov = await _fSearchRaw(seed + (_fDecade ? ' ' + _fDecade : ''), false, limit);
        const seen = new Set(lib.map(t => t.uri));
        const merged = [...lib, ...mineOf(prov).filter(t => !seen.has(t.uri))];
        return merged.length ? merged : prov.slice(0, 2);
      };

      const _fastPlay = async (track) => {
        try {
          await _fTimed(self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: track.uri, media_type: 'track', enqueue: 'replace' }
          }), 30000);
          _fastOk = true;
          _mark('firstPlay');
          _fSeen.add(track.uri.toLowerCase()); _fSeen.add(_fKey(track));
          if (_stale()) return;
          self._maBatchLoading = false;
          clearTimeout(self._maBatchLoadingTimer);
          // The spinner stays on (the whole vibe is a busy job) until the queue is built.
          self._showToast('\u{1F3B6} Adding more songs to your queue\u2026', 3500);
        } catch (_) { _claimed = false; }   // let another seed's result try instead
      };

      let _fBaseline = null;               // queue length right after the first song started
      let _fAttempted = 0;                 // add calls made
      let _fTimedOut = 0;                  // batches Music Assistant was still working on at the time limit
      const _fSent = [];                   // tracks Music Assistant accepted for the queue

      // How many songs Music Assistant says are in this speaker's queue (null = can't tell).
      const _fQueueCount = async () => {
        try {
          if (self._hass?.services?.mass_queue?.get_queue_items) {
            const r = await _fTimed(self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
              service_data: { entity: maEntity, limit_before: 5, limit_after: 9999 },
              return_response: true
            }), 6000);
            const raw = r?.response?.[maEntity] || r?.response;
            if (Array.isArray(raw)) return raw.length;
          }
        } catch (_) {}
        try {
          const r = await _fTimed(self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'get_queue',
            service_data: { entity_id: maEntity }, return_response: true
          }), 6000);
          const q = r?.response?.[maEntity] || r?.response;
          if (q && typeof q.items === 'number') return q.items;
        } catch (_) {}
        return null;
      };

      // Music Assistant runs play actions on a queue one at a time, so an 'add'
      // sent now simply waits until the 'replace' above has finished. A short wait
      // for the speaker to report 'playing' is kept as a guard for older builds.
      const _fSettle = async () => {
        for (let i = 0; i < 8; i++) {
          if (_stale()) return;
          if (self._hass?.states?.[maEntity]?.state === 'playing') break;
          await _fSleep(250);
        }
        if (_stale()) return;
        _fBaseline = await _fQueueCount();
      };

      // Adds a list of URIs in one call. Only if Home Assistant rejects the list
      // itself (an older version) are they sent one at a time — remembered for
      // next time. A call that is merely slow is NOT resent: Music Assistant is
      // still adding those songs, and resending them doubled the work and the songs.
      const _fAddBatch = async (uris, mediaType) => {
        if (!uris.length || _stale()) return 0;
        const _call = (id, ms) => _fTimed(self._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'play_media',
          service_data: Object.assign({ entity_id: maEntity, media_id: id, enqueue: 'add' }, mediaType ? { media_type: mediaType } : {})
        }), ms);
        _fAttempted++;
        if (!self._maListAddUnsupported) {
          const t = Date.now();
          try {
            await _call(uris, 90000);
            console.debug('[Crow Media Player] vibe "' + label + '": added ' + uris.length + ' ' + (mediaType || 'item') + '(s) in ' + (Date.now() - t) + 'ms');
            return uris.length;
          } catch (_e) {
            const msg = String(_e?.message || _e?.code || _e || '');
            if (/timed out/i.test(msg)) {
              _fTimedOut++;
              console.warn('[Crow Media Player] vibe "' + label + '": Music Assistant is still adding ' + uris.length + ' songs — not resending');
              return uris.length;
            }
            const listRejected = _e?.code === 'invalid_format' || /expected str|not a valid value|invalid_format/i.test(msg);
            if (!listRejected) { console.warn('[Crow Media Player] vibe "' + label + '": could not add batch', _e); return 0; }
            self._maListAddUnsupported = true;
            console.warn('[Crow Media Player] vibe "' + label + '": this Home Assistant only takes one song per call — adding one at a time');
          }
        }
        let ok = 0;
        for (const id of uris) {
          if (_stale()) break;
          try { await _call(id, 20000); ok++; }
          catch (_e) { console.warn('[Crow Media Player] vibe "' + label + '": could not add ' + id, _e); }
        }
        return ok;
      };
      // Tracks go in small batches: five straight away so the queue has real songs
      // within seconds, then the rest in chunks that each finish well within the limit.
      const _fAdd = async (tracks) => {
        const chunks = [];
        if (tracks.length) chunks.push(tracks.slice(0, 5));
        for (let i = 5; i < tracks.length; i += 15) chunks.push(tracks.slice(i, i + 15));
        for (const c of chunks) {
          if (_stale()) return;
          const n = await _fAddBatch(c.map(t => t.uri), 'track');
          if (n) _fSent.push(...c.slice(0, n));
          if (!_tm.firstBatch) _mark('firstBatch');
        }
      };

      // Runs once everything has been added. The message only ever reports what
      // Music Assistant's queue really holds — never what the card sent.
      const _fFinish = async () => {
        if (_stale() || !_fastOk) return;
        let n = await _fQueueCount();
        // The queue is read separately from the add, so give it a moment to catch up
        // (longer if a batch was still being added when its call timed out).
        const tries = _fTimedOut ? 15 : 4;
        for (let i = 0; i < tries && _fAttempted > 0 && n !== null && (_fBaseline === null ? n <= 1 : n <= _fBaseline); i++) {
          await _fSleep(_fTimedOut ? 1000 : 400);
          if (_stale()) return;
          n = await _fQueueCount();
        }
        if (_stale()) return;
        _mark('done');
        console.info('[Crow Media Player] vibe "' + label + '" timings (ms): ' +
          ['search', 'firstPlay', 'firstBatch', 'seedTracks', 'playlists', 'done'].map(k => k + '=' + (_tm[k] ?? '-')).join(' ') +
          ' | queue=' + (n ?? '?') + (_cached ? ' | from cache' : '') + (_fTimedOut ? ' | timeouts=' + _fTimedOut : ''));
        // Any open queue shows the finished list straight away.
        self._queueDataCache = null;
        const grew = n !== null && n > (_fBaseline ?? 1);
        if (grew) {
          self._showToast(`\u2713 Your queue is ready \u2014 ${n} songs lined up`, 3500);
        } else if (n === null && _fSent.length) {
          self._showToast(`\u2713 ${label} is playing \u2014 more songs are queued`, 3500);
        } else if (_fAttempted > 0) {
          self._showToast(`\u26a0\ufe0f ${label} is playing, but the rest of the queue didn\u2019t load. Try the vibe once more.`, 6000);
        } else {
          self._showToast(`\u2713 ${label} is playing`, 3000);
        }
      };

      // Everything found for the seeds, up to `cap` per artist, shuffled, minus what's
      // already queued. All seeds were searched in the one round above.
      const _fAddPool = async (cap) => {
        const pool = [];
        _perSeed.forEach(list => _fShuffle([...list]).slice(0, cap).forEach(t => pool.push(t)));
        _fShuffle(pool);
        const perArtist = new Map();
        const batch = pool.filter(t => {
          const u = t.uri.toLowerCase(), k = _fKey(t);
          if (_fSeen.has(u) || _fSeen.has(k)) return false;
          const a = _fNorm(_fArtistOf(t));
          if (a) { const c = perArtist.get(a) || 0; if (c >= cap) return false; perArtist.set(a, c + 1); }
          _fSeen.add(u); _fSeen.add(k);
          return true;
        });
        await _fAdd(batch);
      };

      // Radio, but only ever ADDED behind what's already playing (legacy fallback only).
      const _fRadioExtend = async (list) => {
        for (const seed of list) {
          if (_stale()) return;
          await self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: self._moodArtistUriCache?.get(seed) || seed, media_type: 'artist', enqueue: 'add', radio_mode: true }
          }).catch(() => {});
        }
      };

      // ── Genre / social vibes: a capped pick from matching playlists & albums ──
      // Adding a whole playlist makes Music Assistant fetch every track in it
      // (sometimes hundreds) first, so instead up to 8 random tracks are taken from
      // each of the best three. Started straight away, alongside the seed searches.
      const _fCompPick = async () => {
        const qs = moodQuery.split('|').map(q => q.trim()).filter(Boolean).slice(0, 3);
        const found = await Promise.all(qs.map(q => Promise.all(['playlist', 'album'].map(mt =>
          _fTimed(self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'search',
            service_data: { config_entry_id: _fastCid, name: q, media_type: mt, limit: mt === 'playlist' ? 3 : 2 },
            return_response: true
          }), 20000).then(r => (r?.response?.[mt + 's'] || []).map(i => Object.assign({ media_type: mt }, i))).catch(() => [])
        ))));
        const seen = new Set();
        const items = found.flat(2).filter(i => i?.uri && !seen.has(i.uri) && seen.add(i.uri)).slice(0, 3);
        if (!items.length) return [];
        const mqs = self._hass?.services?.mass_queue || {};
        const mqCid = (mqs.get_playlist_tracks || mqs.get_album_tracks) ? await self._getMassQueueConfigEntry().catch(() => null) : null;
        // Without mass_queue the tracks can't be listed — fall back to one whole collection.
        if (!mqCid) return { whole: items.slice(0, 1) };
        const _extract = (res) => {
          const r = res?.response;
          if (Array.isArray(r)) return r;
          if (Array.isArray(r?.items)) return r.items;
          if (Array.isArray(r?.tracks)) return r.tracks;
          if (r && typeof r === 'object') return Object.values(r).find(v => Array.isArray(v)) || [];
          return [];
        };
        const lists = await Promise.all(items.map(async item => {
          const isPl = item.media_type === 'playlist' || /\/playlist\//i.test(item.uri);
          const svc = isPl ? 'get_playlist_tracks' : 'get_album_tracks';
          if (!mqs[svc]) return [];
          try {
            const r = await _fTimed(self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'mass_queue', service: svc,
              service_data: { uri: item.uri, config_entry_id: mqCid }, return_response: true
            }), 20000);
            return _extract(r).map(_fSlim).filter(Boolean);
          } catch (_) { return []; }
        }));
        const picked = lists.map(l => _fShuffle([...l]).slice(0, 8)).flat();
        return picked.length ? picked : { whole: items.slice(0, 1) };
      };

      if (_fastCid) {
        // 1. A cached pool: play from it at once, no searching.
        if (_cached) {
          seedArtists.forEach(s => _perSeed.set(s, (_cached.seeds[s] || []).filter(t => t?.uri)));
          const all = [..._perSeed.values()].flat();
          _mark('search');
          if (all.length) { _claimed = true; await _fastPlay(all[Math.floor(Math.random() * all.length)]); }
          if (!_fastOk) {                  // the cached songs didn't play — search afresh
            console.debug('[Crow Media Player] vibe "' + label + '": cached pool failed — searching again');
            _poolDrop(); _cached = null; _perSeed.clear(); _claimed = false;
          }
        }
        // 2. Otherwise one round of searches for every seed, all at once. The first
        //    seed back with a track starts playing; the rest finish behind it.
        var _compP = _fGenre ? (_cached && _cached.comp ? Promise.resolve(_cached.comp) : _fCompPick().catch(() => [])) : null;
        if (!_cached) {
          const _plays = [];
          await Promise.all(seedArtists.map(async seed => {
            const tracks = await _fSearch(seed);
            _perSeed.set(seed, tracks);
            if (_claimed || _stale() || !tracks.length) return;
            _claimed = true;
            _plays.push(_fastPlay(tracks[Math.floor(Math.random() * tracks.length)]));
          }));
          _mark('search');
          if (_plays.length) await Promise.all(_plays);
        }
      }
      if (_stale()) return;
      if (_fastOk) {
        run.finish = _fFinish;
        await _fSettle();
        if (_stale()) return;

        await _fAddPool(_fGenre || _fDecade ? 3 : _fCap);
        _mark('seedTracks');
        if (_stale()) return;

        let _comp = null;
        if (_fGenre) {
          _comp = await _compP;
          if (_stale()) return;
          if (Array.isArray(_comp) && _comp.length) {
            const fresh = _fShuffle(_comp.filter(t => {
              const u = t.uri.toLowerCase(), k = _fKey(t);
              if (_fSeen.has(u) || _fSeen.has(k)) return false;
              _fSeen.add(u); _fSeen.add(k); return true;
            }));
            await _fAdd(fresh);
          } else if (_comp?.whole?.length) {
            for (const item of _comp.whole) {
              if (_stale()) return;
              await _fAddBatch([item.uri], item.media_type || (/\/playlist\//i.test(item.uri) ? 'playlist' : 'album'));
            }
          }
          _mark('playlists');
        }

        // Remember what was found (fresh searches only) for the next 24 hours.
        if (!_cached) {
          const seeds = {};
          _perSeed.forEach((list, s) => { seeds[s] = list.map(_fSlim).filter(Boolean).slice(0, 25); });
          if (Object.values(seeds).some(l => l.length)) {
            const all = _poolRead();
            all[_poolKey] = { ts: Date.now(), seeds, comp: Array.isArray(_comp) ? _comp.slice(0, 40) : null };
            _poolWrite(all);
          }
        }
        // No radio top-up: in current Music Assistant, adding a radio to a queue turns
        // it into a dynamic mix that throws away the songs just added. Music Assistant's
        // own Autoplay setting refills a normal queue near its end instead.
        return;
      } else {
        console.debug('[Crow Media Player] vibe "' + label + '": fast start found nothing to play — falling back to radio');
      }

      // ── No-pipe path: fire radio instantly, then silently upgrade with a track ──
      // Strategy: start playing artist radio immediately (< 1s feedback), then run
      // parallel searches across all seed artists. If any search returns a track,
      // upgrade the queue silently. This guarantees something always plays fast.
      const _isNoPipeMood = !moodQuery || (!moodQuery.includes('|') && !/\b(19[5-9]0s|20[012]0s)\b/i.test(moodQuery));
      if (_isNoPipeMood) {
        const _firstSeed = seedArtists[0];

        // ── Step 1: fire artist radio immediately — no waiting ────────────────
        let _radioStarted = false;
        const _fireRadio = async (seed, enqueue = 'replace') => {
          try {
            await self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: { entity_id: maEntity, media_id: self._moodArtistUriCache?.get(seed) || seed, media_type: 'artist', enqueue, radio_mode: true }
            });
            return true;
          } catch(_) { return false; }
        };

        // Fire primary seed radio immediately — don't await, let it run in background
        const _radioPromise = _fireRadio(_firstSeed).then(ok => {
          if (!ok && seedArtists[1]) return _fireRadio(seedArtists[1]);
          return ok;
        }).then(ok => {
          _radioStarted = ok;
          if (ok) {
            self._showLoadingToast(`✓ ${label} — loading…`);
            self._moodLoadingEntity = maEntity;
            self._moodLoadingLabel = label;
            setTimeout(() => {
              if (self._moodLoadingEntity === maEntity) {
                self._moodLoadingEntity = null;
                self._moodLoadingLabel = null;
                self._hideLoadingToast();
              }
            }, 8000);
          } else {
            self._hideLoadingToast();
            self._showToast(`Could not start ${label} — check Music Assistant`);
          }
          self._pillPulse(500);
          self._maBatchLoading = false;
          clearTimeout(self._maBatchLoadingTimer);
        });

        // ── Step 2: parallel track search across all seeds ────────────────────
        // Run in background — upgrade queue if a good track is found
        (async () => {
          // Wait for radio to be established before upgrading
          await _radioPromise;
          if (_stale() || !_radioStarted) return;

          const _cid = self._maConfigEntryId || await self._getMAConfigEntryId().catch(() => null);
          if (!_cid || _stale()) return;

          // Search all seeds in parallel
          const _searches = seedArtists.map(seed =>
            self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'search',
              service_data: { config_entry_id: _cid, name: seed, media_type: 'track', limit: 8 },
              return_response: true
            }).then(r => r?.response?.tracks || []).catch(() => [])
          );
          const _results = await Promise.all(_searches);
          if (_stale()) return;

          // Flatten, deduplicate by URI, pick a random track
          const _allTracks = _results.flat().filter((t, i, arr) => t?.uri && arr.findIndex(x => x.uri === t.uri) === i);
          if (!_allTracks.length) {
            // No tracks found — extend queue with remaining seeds as radio
            for (const _seed of seedArtists.slice(1)) {
              if (_stale()) return;
              await _fireRadio(_seed, 'add');
            }
            return;
          }

          // Deduplicate against current queue before adding
          const _qUris = self._getQueueUriSet();
          const _dedupedTracks = _allTracks.filter(t => t?.uri && !_qUris.has(t.uri.toLowerCase()));
          if (!_dedupedTracks.length) return;

          // Queue found track to play next — don't replace current track (avoids skip)
          const _pick = _dedupedTracks[Math.floor(Math.random() * _dedupedTracks.length)];
          _qUris.add(_pick.uri.toLowerCase());
          await self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: _pick.uri, media_type: 'track', enqueue: 'next' }
          }).catch(() => {}); // radio already playing — silent failure is fine

          if (_stale()) return;

          // Add all seed artists as radio behind the track
          await new Promise(res => setTimeout(res, 800));
          for (const _seed of seedArtists) {
            if (_stale()) return;
            await _fireRadio(_seed, 'add');
          }
        })();

        return;
      }

      // ── Pipe/decade mood: fire artist radio BEFORE awaiting config entry ────
      // This guarantees something plays in < 1s regardless of MA search latency.
      const _isDecadeMood = moodQuery && /\b(19[5-9]0s|20[012]0s)\b/i.test(moodQuery.split('|')[0]);
      if (!_isDecadeMood && !_fastOk) {
        self._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'music_assistant', service: 'play_media',
          service_data: { entity_id: maEntity,
            media_id: self._moodArtistUriCache?.get(primarySeed) || primarySeed,
            media_type: 'artist', enqueue: 'replace', radio_mode: true }
        }).then(() => {
          self._showLoadingToast(`✓ ${label} — finding tracks…`);
          self._moodLoadingEntity = maEntity;
          self._moodLoadingLabel = label;
          setTimeout(() => {
            if (self._moodLoadingEntity === maEntity) {
              self._moodLoadingEntity = null;
              self._moodLoadingLabel = null;
              self._hideLoadingToast();
            }
          }, 12000);
        }).catch(() => {
          self._hideLoadingToast();
          self._showToast(`Could not start ${label} — check Music Assistant`);
        });
        self._pillPulse(500);
        self._maBatchLoading = false;
        clearTimeout(self._maBatchLoadingTimer);
      }

      try {
        const configEntryId = await self._getMAConfigEntryId();
        if (!configEntryId) throw new Error('no config entry');
        if (_stale()) return;

        const MIN_LOCAL_TRACKS = 8;

        if (!self._moodLibraryCache) self._moodLibraryCache = new Map();
        const _libCacheKey = seedArtists.join('|').toLowerCase();

        let localTracks = self._moodLibraryCache.get(_libCacheKey);

        if (!localTracks && moodQuery && moodQuery.includes('|') && !_isDecadeMood) {
          // ── Genre/Social: run ALL pipe queries in parallel, use first results ──
          try {
            const _queries = moodQuery.split('|').map(q => q.trim()).filter(Boolean);

            // Fire all query searches simultaneously
            const _allQueryResults = await Promise.all(
              _queries.map(async _q => {
                const [_playlists, _albums] = await Promise.all([
                  self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'search',
                    service_data: { config_entry_id: configEntryId, name: _q, media_type: 'playlist', limit: 5 },
                    return_response: true
                  }).then(r => r?.response?.playlists || []).catch(() => []),
                  self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'search',
                    service_data: { config_entry_id: configEntryId, name: _q, media_type: 'album', limit: 5 },
                    return_response: true
                  }).then(r => r?.response?.albums || []).catch(() => []),
                ]);
                return [..._playlists, ..._albums];
              })
            );
            if (_stale()) return;

            // Flatten all found compilations, deduplicate by uri
            const _seen = new Set();
            const _compilations = _allQueryResults.flat().filter(item => {
              const key = item.uri || item.item_id || item.name || '';
              if (_seen.has(key)) return false;
              _seen.add(key); return true;
            });

            if (!_compilations.length) {
              // No compilations found in library — extend radio with all seeds and exit
              // Radio already fired above, so just add remaining seeds
              if (!_fastOk) (async () => { await _fRadioExtend(seedArtists.slice(1)); })();   // (fast start already queued seeds + radio)
              return;
            }

            if (_fastOk) {
              // get_library only sees items saved in the Music Assistant library, so a
              // playlist or album found on a streaming provider gave nothing. Adding
              // by URI lets Music Assistant resolve it itself.
              // Grouped by type, one call per group.
              const _byType = new Map();
              for (const item of _compilations.slice(0, 3)) {
                if (!item.uri) continue;
                const _mt = item.media_type || (/\/playlist\//i.test(item.uri) ? 'playlist' : 'album');
                if (!_byType.has(_mt)) _byType.set(_mt, []);
                _byType.get(_mt).push(item.uri);
              }
              for (const [_mt, _uris] of _byType) {
                if (_stale()) return;
                await _fAddBatch(_uris, _mt);
              }
              self._pillPulse(500);
              return;
            }

            if (_compilations.length) {
              // Fetch tracks for top compilations in parallel
              const _trackChunks = await Promise.all(
                _compilations.slice(0, 5).map(item =>
                  self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'get_library',
                    service_data: { config_entry_id: configEntryId, media_type: 'track', album: item.name, limit: 100 },
                    return_response: true
                  }).then(r => r?.response?.items || []).catch(() => [])
                )
              );
              if (_stale()) return;

              // Interleave tracks across compilations, deduplicate
              const _allTracks = [];
              const _uris = new Set();
              const _maxLen = Math.max(..._trackChunks.map(c => c.length), 0);
              for (let i = 0; i < _maxLen; i++) {
                for (const chunk of _trackChunks) {
                  if (!chunk[i]) continue;
                  const u = chunk[i].uri || chunk[i].item_id || '';
                  if (u && _uris.has(u)) continue;
                  if (u) _uris.add(u);
                  _allTracks.push(chunk[i]);
                }
              }

              // Shuffle
              for (let i = _allTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [_allTracks[i], _allTracks[j]] = [_allTracks[j], _allTracks[i]];
              }

              if (_allTracks.length) {
                // Deduplicate against current queue
                const _qUrisPipe = self._getQueueUriSet();
                const _seenPipe = new Set(_qUrisPipe);
                const _artistCountsPipe = new Map();
                const _getArtistPipe = t => { const a = t?.artists?.[0]?.name || t?.artist?.name || t?.artist || ''; return typeof a === 'string' ? a.toLowerCase().trim() : ''; };
                const _dedupedPipe = _allTracks.filter(t => {
                  if (!t?.uri) return false;
                  const k = t.uri.toLowerCase();
                  if (_seenPipe.has(k)) return false;
                  const artist = _getArtistPipe(t);
                  if (artist) { const cnt = _artistCountsPipe.get(artist) || 0; if (cnt >= 3) return false; _artistCountsPipe.set(artist, cnt + 1); }
                  _seenPipe.add(k); return true;
                });
                if (!_dedupedPipe.length) { localTracks = []; return; }

                // Queue first playlist track to play next — don't replace current
                const _first = _dedupedPipe.shift();
                self._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: maEntity, media_id: _first.uri, media_type: 'track', enqueue: 'next' }
                }).catch(() => {}); // artist radio already playing — silent failure fine

                // Add remaining deduplicated tracks in background
                (async () => {
                  for (const t of _dedupedPipe) {
                    if (_stale()) return;
                    await self._hass.connection.sendMessagePromise({
                      type: 'call_service', domain: 'music_assistant', service: 'play_media',
                      service_data: { entity_id: maEntity, media_id: t.uri, media_type: 'track', enqueue: 'add' }
                    }).catch(() => {});
                  }
                })();
                localTracks = [];
                return;
              }
            }
          } catch(_) {}
        }

        if (_isDecadeMood && !localTracks) {
          // ── Decade: fire multi-seed radio immediately, then enrich with specific tracks ──
          // Fire all seed artists as radio right away so something plays instantly
          self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity,
              media_id: self._moodArtistUriCache?.get(primarySeed) || primarySeed,
              media_type: 'artist', enqueue: 'replace', radio_mode: true }
          }).then(() => {
            self._showLoadingToast(`✓ ${label} — finding tracks…`);
            self._moodLoadingEntity = maEntity;
            self._moodLoadingLabel = label;
            setTimeout(() => {
              if (self._moodLoadingEntity === maEntity) {
                self._moodLoadingEntity = null;
                self._moodLoadingLabel = null;
                self._hideLoadingToast();
              }
            }, 12000);
          }).catch(() => {
            self._hideLoadingToast();
            self._showToast(`Could not start ${label} — check Music Assistant`);
          });
          self._pillPulse(500);
          self._maBatchLoading = false;
          clearTimeout(self._maBatchLoadingTimer);

          try {
            const _decade = moodQuery.split('|')[0].match(/\b(19[5-9]0s|20[012]0s)\b/i)?.[0] || '';
            let _firstPlayed = false;
            const _decadeBgTracks = [];

            // Fire all searches in parallel but process results as they arrive
            const _trackPromises = seedArtists.map(artist =>
              self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'search',
                service_data: { config_entry_id: configEntryId,
                  name: artist + (_decade ? ' ' + _decade : ''), media_type: 'track', limit: 5 },
                return_response: true
              }).then(r => {
                const tracks = r?.response?.tracks || [];
                const norm = s => (s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
                const artistNorm = norm(artist);
                const match = tracks.find(t => {
                  const tArtist = norm(t.artists?.[0]?.name || t.artist || '');
                  return tArtist.includes(artistNorm) || artistNorm.includes(tArtist);
                }) || tracks[0];
                return match || null;
              }).then(async (track) => {
                if (!track || _stale()) return;
                if (!_firstPlayed) {
                  // Play the very first track that resolves — fire and forget
                  _firstPlayed = true;
                  self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'play_media',
                    service_data: { entity_id: maEntity, media_id: track.uri, media_type: 'track', enqueue: 'next' }
                  }).catch(() => {});
                  self._pillPulse(500);
                  self._hideLoadingToast();
                  self._showToast(`✓ ${label}`, 3000);
                } else {
                  _decadeBgTracks.push(track);
                }
              }).catch(() => {})
            );

            await Promise.all(_trackPromises);
            if (_stale()) return;

            if (_firstPlayed) {
              // Shuffle and add remaining in background
              for (let i = _decadeBgTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [_decadeBgTracks[i], _decadeBgTracks[j]] = [_decadeBgTracks[j], _decadeBgTracks[i]];
              }
              const _qUrisDecade = self._getQueueUriSet();
              const _seenDecade = new Set(_qUrisDecade);
              const _artistCountsDecade = new Map();
              const _getArtistDecade = t => { const a = t?.artists?.[0]?.name || t?.artist?.name || t?.artist || ''; return typeof a === 'string' ? a.toLowerCase().trim() : ''; };
              const _dedupedDecade = _decadeBgTracks.filter(t => {
                if (!t?.uri) return false;
                const k = t.uri.toLowerCase();
                if (_seenDecade.has(k)) return false;
                const artist = _getArtistDecade(t);
                if (artist) { const cnt = _artistCountsDecade.get(artist) || 0; if (cnt >= 3) return false; _artistCountsDecade.set(artist, cnt + 1); }
                _seenDecade.add(k); return true;
              });
              (async () => {
                for (const t of _dedupedDecade) {
                  if (_stale()) return;
                  await self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'play_media',
                    service_data: { entity_id: maEntity, media_id: t.uri, media_type: 'track', enqueue: 'add' }
                  }).catch(() => {});
                }
              })();
              self._moodLoadingEntity = maEntity;
              setTimeout(() => {
                if (self._moodLoadingEntity === maEntity) {
                  self._moodLoadingEntity = null;
                  self._hideLoadingToast();
                }
              }, 15000);
              return;
            }
          } catch(_) {}
        }

        // ── Option 1: Fetch 1 track per seed artist — play first immediately ─
        if (!localTracks) localTracks = self._moodLibraryCache.get(_libCacheKey);
        if (!localTracks) {
          try {
            let _libFirstPlayed = false;
            const _libBgTracks = [];

            const fetches = seedArtists.map(artist =>
              self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'get_library',
                service_data: { config_entry_id: configEntryId, media_type: 'track',
                  artist, limit: 50 },
                return_response: true
              }).then(async r => {
                if (_stale()) return;
                const items = r?.response?.items || [];
                if (!items.length) return;
                const pick = items.length > 1 ? items[Math.floor(Math.random() * items.length)] : items[0];
                if (!_libFirstPlayed) {
                  _libFirstPlayed = true;
                  self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'play_media',
                    service_data: { entity_id: maEntity, media_id: pick.uri, media_type: 'track', enqueue: 'next' }
                  }).catch(() => {});
                  self._pillPulse(500);
                  self._hideLoadingToast();
                  self._showToast(`✓ ${label}`, 3000);
                } else {
                  _libBgTracks.push(pick);
                }
              }).catch(() => {})
            );

            await Promise.all(fetches);
            if (_stale()) return;

            if (_libFirstPlayed) {
              // Shuffle remaining and add in background
              for (let i = _libBgTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [_libBgTracks[i], _libBgTracks[j]] = [_libBgTracks[j], _libBgTracks[i]];
              }
              (async () => {
                for (const t of _libBgTracks) {
                  if (_stale()) return;
                  await self._hass.connection.sendMessagePromise({
                    type: 'call_service', domain: 'music_assistant', service: 'play_media',
                    service_data: { entity_id: maEntity, media_id: t.uri, media_type: 'track', enqueue: 'add' }
                  }).catch(() => {});
                }
              })();
              // Cache for this session
              const allTracks = _libBgTracks;
              self._moodLibraryCache.set(_libCacheKey, allTracks);
              try {
                const cacheStore = {};
                self._moodLibraryCache.forEach((v, k) => { cacheStore[k] = v; });
                sessionStorage.setItem('crow_media_mood_lib_cache', JSON.stringify(cacheStore));
              } catch(_) {}
              return;
            }

            // Nothing played — fall through to radio fallback with collected tracks
            localTracks = _libBgTracks;
            self._moodLibraryCache.set(_libCacheKey, localTracks);
            try {
              const cacheStore = {};
              self._moodLibraryCache.forEach((v, k) => { cacheStore[k] = v; });
              sessionStorage.setItem('crow_media_mood_lib_cache', JSON.stringify(cacheStore));
            } catch(_) {}
          } catch(_libErr) {
            localTracks = [];
          }
        }

        // ── De-duplicate by URI — within batch AND against current queue ────
        const _qUrisLocal = self._getQueueUriSet();
        const _seenUris = new Set(_qUrisLocal);
        const _uriDeduped = (localTracks || []).filter(t => {
          const _uri = t.uri || t.item_id || '';
          if (!_uri) return true;
          const _k = _uri.toLowerCase();
          if (_seenUris.has(_k)) return false;
          _seenUris.add(_k);
          return true;
        });
        if (_uriDeduped.length >= MIN_LOCAL_TRACKS) localTracks = _uriDeduped;

        // Shuffle (Fisher-Yates)
        const shuffled = [...localTracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        let usedLibrary = false;

        if (shuffled.length >= MIN_LOCAL_TRACKS) {
          // ── Option 2: Enough tracks — play first immediately, add rest in background
          const [first, ...rest] = shuffled;
          await self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: first.uri,
              media_type: 'track', enqueue: 'next' }
          });
          if (_stale()) return;
          usedLibrary = true;
          // Deduplicate and add remaining tracks in background
          const _opt1Rest = self._dedupeTracksForQueue(rest);
          (async () => {
            for (const t of _opt1Rest) {
              if (_stale()) return;
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: maEntity, media_id: t.uri,
                  media_type: 'track', enqueue: 'add' }
              }).catch(() => {});
            }
          })();
        } else if (shuffled.length > 0) {
          // ── Option 3: Some local tracks — play first immediately, add rest in background
          const [first, ...rest] = shuffled;
          await self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: first.uri,
              media_type: 'track', enqueue: 'next' }
          });
          if (_stale()) return;
          usedLibrary = true;
          // Deduplicate and add remaining local tracks in background
          const _opt3Rest = self._dedupeTracksForQueue(rest);
          (async () => {
            for (const t of _opt3Rest) {
              if (_stale()) return;
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: maEntity, media_id: t.uri,
                  media_type: 'track', enqueue: 'add' }
              }).catch(() => {});
            }
          })();
        }

        if (_stale()) return;

        // Get/cache primary artist URI for radio fallback/extension
        let artistUri = self._moodArtistUriCache?.get(primarySeed);
        if (!artistUri) {
          // Fire radio immediately using name search (no URI needed) — MA can search by name
          // Then resolve URI in background for caching
          if (!usedLibrary) {
            // No library tracks at all — play artist radio immediately by name
            self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: { entity_id: maEntity, media_id: primarySeed,
                media_type: 'artist', enqueue: 'replace', radio_mode: true }
            }).catch(() => {});
            self._pillPulse(500);
            self._moodLoadingEntity = maEntity;
            setTimeout(() => {
              if (self._moodLoadingEntity === maEntity) {
                self._moodLoadingEntity = null;
                self._hideLoadingToast();
              }
            }, 15000);
          }
          // Resolve URI in background for caching only
          try {
            const res = await self._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'search',
              service_data: { config_entry_id: configEntryId, name: primarySeed,
                media_type: 'artist', limit: 1 },
              return_response: true
            });
            if (_stale()) return;
            const artists = res?.response?.artists || (Array.isArray(res?.response) ? res.response : []);
            const artist  = Array.isArray(artists) ? artists[0] : null;
            if (artist?.uri) {
              artistUri = artist.uri;
              if (!self._moodArtistUriCache) self._moodArtistUriCache = new Map();
              self._moodArtistUriCache.set(primarySeed, artistUri);
              try {
                const cacheObj = {};
                self._moodArtistUriCache.forEach((v, k) => { cacheObj[k] = v; });
                sessionStorage.setItem('crow_media_mood_uri_cache', JSON.stringify(cacheObj));
              } catch(_) {}
              self._aiLocalSet('moodUriCache', primarySeed.toLowerCase(), artistUri);
            }
          } catch(_) {}
          if (!usedLibrary) return; // already playing radio by name, done
        }

        if (_stale()) return;

        if (!usedLibrary && artistUri) {
          // No local tracks at all — pure radio mode, fire without awaiting
          self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: artistUri,
              media_type: 'artist', enqueue: 'replace', radio_mode: true }
          }).catch(() => {});
        } else if (usedLibrary && shuffled.length < MIN_LOCAL_TRACKS && artistUri) {
          // Had some local tracks but not many — extend with radio in background
          // Don't await — let it extend while playback has already started
          self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: maEntity, media_id: artistUri,
              media_type: 'artist', enqueue: 'add', radio_mode: true }
          }).catch(() => {});
        }

        if (_stale()) return;
        // Toast and pulse already dismissed when radio fired — just ensure clean state
        self._hideLoadingToast();
        self._pillPulse(500);
        self._maBatchLoading = false;
        clearTimeout(self._maBatchLoadingTimer);
      } catch(_e) {
        if (_stale()) return;
        if (_fastOk) { console.warn('[Crow Media Player] vibe "' + label + '": extra playlists/albums failed', _e); return; }   // first song is playing; the final message covers the rest
        self._hideLoadingToast();
        self._pillPulse(0);
        self._maBatchLoading = false;
        clearTimeout(self._maBatchLoadingTimer);
        self._showToast('Could not start ' + label + ' — check Music Assistant');
      }
    };


    // A vibe runs as one "busy" job: the spinner in the mini artwork and the
    // pulsing speaker pill stay on until the queue has really been built, and the
    // queue can't be opened half-built meanwhile (it says "Still adding your
    // songs" instead). The friendly "ready" message is shown at the very end.
    const playMoodOnSpeaker = (seeds, label, targetEntity, moodQuery) =>
      self._busyJob(async () => {
        const run = { finish: null, id: null };
        // A vibe builds its queue in a couple of quick batches, so the queue can be
        // opened while it runs and simply fills in live (queue_updated events).
        self._liveQueueJobs = (self._liveQueueJobs || 0) + 1;
        self._syncQueueBuilding();
        // However slow Music Assistant is, the spinner is never left on for more than
        // 75 seconds: after that this vibe stops adding and reports what it managed.
        const _deadline = setTimeout(() => {
          if (run.id && self._moodPlayPending === run.id) {
            console.warn('[Crow Media Player] vibe "' + label + '": taking too long — stopping');
            self._moodPlayPending = null;
            self._showToast('\u2713 ' + label + ' is playing \u2014 the rest of the queue is still loading in the background', 4000);
          }
        }, 75000);
        try {
          const _work = (async () => {
            await _playMoodInner(seeds, label, targetEntity, moodQuery, run);
            if (run.finish) await run.finish();
          })();
          await Promise.race([_work, new Promise(res => { run.release = res; setTimeout(res, 76000); })]);
        } catch (_e) {
          console.warn('[Crow Media Player] vibe "' + label + '": stopped early', _e);
          self._hideLoadingToast();
        } finally {
          clearTimeout(_deadline);
          self._liveQueueJobs = Math.max(0, (self._liveQueueJobs || 1) - 1);
        }
      }, 90000);

    const doMood = (seeds, label, query) => {
      const _playFn = eid => playMoodOnSpeaker(seeds, label, eid, query);
      // If only one speaker available, play directly without picker
      if (allMA.length <= 1) {
        _playFn(allMA[0] || self._entity);
        return;
      }
      // Multiple speakers — show picker
      scrollDiv.innerHTML = '';
      const backRow = document.createElement('div');
      backRow.style.cssText = 'margin-bottom:14px;display:flex;align-items:center;gap:8px;';
      const backBtn = document.createElement('button');
      backBtn.style.cssText = `width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;`;
      backBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>`;
      backBtn.addEventListener('click', () => { scrollDiv.innerHTML = ''; const g = buildMoodGrid(); while(g.firstChild) scrollDiv.appendChild(g.firstChild); wireMoodBtns(scrollDiv); scrollDiv.scrollTop = 0; });
      const titleDiv = document.createElement('div');
      titleDiv.innerHTML = `<div style="font-size:14px;font-weight:700;color:${this._pt("text")};">` + label + ' Queue</div><div style="font-size:11px;color:${this._pt("dim")};">Choose a speaker</div>';
      backRow.appendChild(backBtn);
      backRow.appendChild(titleDiv);
      scrollDiv.appendChild(backRow);
      allMA.forEach(eid => {
        const spkBtn = document.createElement('button');
        spkBtn.className = 'ai-mood-speaker-btn';
        spkBtn.dataset.eid = eid;
        spkBtn.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px 14px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};border-radius:14px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;text-align:left;width:100%;margin-bottom:8px;`;
        spkBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:${this._pt("dim")};flex-shrink:0"><path d="M17,2H7A2,2 0 0,0 5,4V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V4A2,2 0 0,0 17,2M12,19A2,2 0 0,1 10,17A2,2 0 0,1 12,15A2,2 0 0,1 14,17A2,2 0 0,1 12,19M15,9H9V4H15V9Z"/></svg><div style="font-size:14px;font-weight:500;color:${this._pt("text")};">` + friendlyName(eid) + '</div>';
        spkBtn.addEventListener('click', () => _playFn(eid));
        scrollDiv.appendChild(spkBtn);
      });
    };

    // Build overlay using DOM API
    maPopup.querySelector('#crow-media-ai-mood-overlay')?.remove();
    const overlay = document.createElement('div');
    overlayRef.el = overlay;
    overlayRef.openedAt = Date.now();
    overlay.id = 'crow-media-ai-mood-overlay';
    // Sits below the library's own header (retitled "Vibe", with its one
    // close button) so there's no second title or × showing through.
    overlay.style.cssText = 'position:absolute;left:0;right:0;bottom:0;top:0;z-index:35;background:var(--crow-panel-bg, #13131a);display:flex;flex-direction:column;border-radius:0 0 24px 24px;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 18px 14px;flex-shrink:0;';
    const titleWrap = document.createElement('div');
    const t1 = document.createElement('div');
    t1.style.cssText = `font-size:17px;font-weight:700;color:${this._pt("text")};letter-spacing:-0.4px;`;
    t1.textContent = 'Choose your Vibe';
    titleWrap.appendChild(t1);
    const closeBtn = document.createElement('button');
    closeBtn.id = 'crow-media-ai-mood-close';
    closeBtn.style.cssText = `width:30px;height:30px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;font-size:16px;color:${this._pt("text")};`;
    closeBtn.textContent = '\u2715';
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // ── Search bar ───────────────────────────────────────────────────────────
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:0 14px 10px;flex-shrink:0;';
    const searchInner = document.createElement('div');
    searchInner.style.cssText = `display:flex;align-items:center;gap:8px;background:${this._pt("btnBg")};border:1px solid ${this._pt("border")};border-radius:12px;padding:8px 12px;`;
    const searchIcon = document.createElement('div');
    searchIcon.innerHTML = `<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:${this._pt("iconDim")};flex-shrink:0"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter vibes…';
    searchInput.style.cssText = `flex:1;background:none;border:none;outline:none;color:${this._pt("text")};font-size:14px;font-family:inherit;caret-color:${this._pt("text")};`;
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('autocorrect', 'off');
    searchInput.setAttribute('autocapitalize', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    const searchClear = document.createElement('button');
    searchClear.style.cssText = 'background:none;border:none;cursor:pointer;padding:0;display:none;line-height:1;-webkit-tap-highlight-color:transparent;';
    searchClear.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("iconDim")}"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    searchInner.appendChild(searchIcon);
    searchInner.appendChild(searchInput);
    searchInner.appendChild(searchClear);
    searchWrap.appendChild(searchInner);
    // ─────────────────────────────────────────────────────────────────────────

    const scrollDiv = document.createElement('div');
    scrollDiv.style.cssText = 'flex:1;overflow-y:auto;padding:0 14px 20px;';

    const grid = buildMoodGrid();
    while (grid.firstChild) scrollDiv.appendChild(grid.firstChild);

    overlay.appendChild(searchWrap);
    overlay.appendChild(scrollDiv);
    maPopup.appendChild(overlay);
    maPopup.classList.add('visible');
    scrollDiv.style.padding = '0 8px 20px';
    searchWrap.style.paddingTop = '4px';

    // Borrow the library header: "Vibe" + its close button. Put things back
    // when the Vibe screen goes away (closed, or the library reopened).
    const _maHeader = maPopup.querySelector('.ma-header');
    const _maTitle  = maPopup.querySelector('#maTitle');
    const _maClose  = maPopup.querySelector('#maClose');
    const _prevTitle = _maTitle ? _maTitle.textContent : null;
    const _hidden = [];
    if (_maHeader) {
      overlay.style.top = (_maHeader.offsetTop + _maHeader.offsetHeight) + 'px';
      // Hide anything else in the header (back button, view toggle…) while Vibe shows.
      [..._maHeader.querySelectorAll('button')].forEach(b => { if (b !== _maClose && b.style.display !== 'none') { _hidden.push([b, b.style.display]); b.style.display = 'none'; } });
    }
    if (_maTitle) _maTitle.textContent = 'Vibe';
    const _restoreHeader = () => {
      if (_maTitle && _prevTitle != null) _maTitle.textContent = _prevTitle;
      _hidden.forEach(([b, d]) => { b.style.display = d; });
    };
    const _closeVibe = () => { _restoreHeader(); overlay.remove(); };
    if (_maClose) _maClose.addEventListener('click', _closeVibe, { once: true });
    // Also restore if something else removes the overlay.
    new MutationObserver((_, obs) => { if (!overlay.isConnected) { _restoreHeader(); obs.disconnect(); } }).observe(maPopup, { childList: true });
    closeBtn.addEventListener('click', () => { _closeVibe(); maPopup.classList.remove('visible'); });
    wireMoodBtns(scrollDiv);

    // Option C: Pre-warm artist URIs while user browses the mood grid
    (async () => {
      const _cid = await this._getMAConfigEntryId().catch(() => null);
      if (!_cid || !this._moodArtistUriCache) return;
      const _uncached = [];
      const _seen = new Set();
      for (const m of moods) {
        const _seeds = Array.isArray(m.maSearch) ? m.maSearch : [m.maSearch || m.query];
        const _primary = _seeds[0];
        if (_primary && !this._moodArtistUriCache.has(_primary) && !_seen.has(_primary)) {
          _seen.add(_primary);
          _uncached.push(_primary);
        }
      }
      for (let i = 0; i < Math.min(_uncached.length, 8); i++) {
        const seed = _uncached[i];
        await new Promise(res => setTimeout(res, i * 300));
        if (!maPopup.classList.contains('visible')) return;
        try {
          const res = await self._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'search',
            service_data: { config_entry_id: _cid, name: seed, media_type: 'artist', limit: 1 },
            return_response: true
          });
          const artists = res?.response?.artists || (Array.isArray(res?.response) ? res.response : []);
          const uri = Array.isArray(artists) ? artists[0]?.uri : null;
          if (uri) {
            this._moodArtistUriCache.set(seed, uri);
            this._aiLocalSet('moodUriCache', seed.toLowerCase(), uri);
          }
        } catch(_) {}
      }
      try {
        const cacheObj = {};
        this._moodArtistUriCache.forEach((v, k) => { cacheObj[k] = v; });
        sessionStorage.setItem('crow_media_mood_uri_cache', JSON.stringify(cacheObj));
      } catch(_) {}
    })();

    // ── Search filter logic ──────────────────────────────────────────────────
    const _applyFilter = (q) => {
      const term = q.trim().toLowerCase();
      searchClear.style.display = term ? 'block' : 'none';
      // Walk every category section and mood button
      scrollDiv.querySelectorAll('.ai-mood-btn').forEach(btn => {
        const idx = parseInt(btn.dataset.idx);
        const m = moods[idx];
        const match = !term ||
          m.label.toLowerCase().includes(term) ||
          m.query.toLowerCase().includes(term);
        btn.style.display = match ? '' : 'none';
      });
      // Hide category headers when all their buttons are hidden
      scrollDiv.querySelectorAll('[data-cat-label]').forEach(label => {
        const section = label.parentElement;
        const anyVisible = [...section.querySelectorAll('.ai-mood-btn')]
          .some(b => b.style.display !== 'none');
        section.style.display = anyVisible ? '' : 'none';
      });
      // Show a "no results" message if nothing matches
      let noRes = scrollDiv.querySelector('.mood-no-results');
      const hasAny = [...scrollDiv.querySelectorAll('.ai-mood-btn')]
        .some(b => b.style.display !== 'none');
      if (!hasAny) {
        if (!noRes) {
          noRes = document.createElement('div');
          noRes.className = 'mood-no-results';
          noRes.style.cssText = `text-align:center;color:${this._pt("dim")};font-size:13px;padding:32px 0;`;
          noRes.textContent = 'No vibes match';
          scrollDiv.appendChild(noRes);
        }
      } else {
        noRes?.remove();
      }
    };
    searchInput.addEventListener('input', () => _applyFilter(searchInput.value));
    searchClear.addEventListener('click', () => { searchInput.value = ''; _applyFilter(''); searchInput.focus(); });
    // ─────────────────────────────────────────────────────────────────────────
  },

  /**
   * Feature 6 — AI Smart Search (natural language → MA search)
   * Intercepts the MA library search field when AI is enabled.
   */

  // ── AI Search Panel ─────────────────────────────────────────────────────────
  // Dedicated panel: natural language query → AI picks tracks → show results list
  // ── Artist Radio — direct play, no panel ───────────────────────────────────
  async _playArtistRadio(artistName) {
    if (!artistName) return;
    return this._busyJob(() => this.__playArtistRadio(artistName));
  },

  async __playArtistRadio(artistName) {
    // AI-driven feature — reached from several long-press entry points
    // (artist name, library rows, info panel) beyond its hidden quick-menu
    // item, so guard here at the function itself with a clear message.
    if (!this._aiFeatureOn('discover')) { this._showToast('AI features are turned off in the card editor'); return; }
    const target = this._resolveMATargetEntity() || this._getValidMASpeakers(true)[0] || this._entity;

    // Suppress artwork tap for 3s to prevent library opening during MA's idle transition
    this._suppressArtTap = true;
    clearTimeout(this._suppressArtTapTimer);
    this._suppressArtTapTimer = setTimeout(() => { this._suppressArtTap = false; }, 3000);

    this._maBatchLoading = true;
    clearTimeout(this._maBatchLoadingTimer);
    this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 60000);

    // Use AI to build a queue of tracks exclusively by this artist.
    // MA radio_mode intentionally mixes in similar artists — we don't want that here.
    const hasAI = await this._aiCheckAvailable();
    if (hasAI) {
      try {
        const _seed = Math.random().toString(36).slice(2, 7);
        const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
        const prompt = `List 10 well-known tracks by "${artistName}". Only songs by ${artistName} — no other artists. Mix popular hits with deeper cuts. ref:${_seed}. Respond ONLY with a JSON array: [{"title":"Track Title","artist":"${artistName}"}]`;
        const resp = await this._aiProcess({ _crowFeature: 'discover',
          type: 'conversation/process', _crowSilent: true, text: prompt,
          agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        const tracks = this._aiCleanSongs(this._aiExtractList(raw), artistName).map(t => ({ ...t, artist: artistName }));
        if (!tracks.length) throw new Error('Empty');
        // Find them in parallel; the first few start playing straight away.
        const { added } = await this._enqueueTracksFast(tracks, target, { firstEnqueue: 'replace' });
        if (!added) throw new Error('none found');
        this._maBatchLoading = false;
        clearTimeout(this._maBatchLoadingTimer);
        this._pillPulse(0);
        this._pillPulse(500);
        this._showToast(`✓ ${artistName} — ${added} tracks queued`);
        // Exit back to the main artwork screen — playback has started.
        this._closeInfoPopup();
        this._closeMABrowser(true);
        return;
      } catch(_) { /* fall through to MA artist queue */ }
    }

    // Fallback: search MA for the artist and play their tracks directly (no radio_mode)
    try {
      const configEntryId = await this._getMAConfigEntryId();
      if (!configEntryId) throw new Error('no config entry');
      const res = await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'music_assistant', service: 'search',
        service_data: { config_entry_id: configEntryId, name: artistName, media_type: 'artist', limit: 1 },
        return_response: true
      });
      const artists = res?.response?.artists || (Array.isArray(res?.response) ? res.response : []);
      const artist  = Array.isArray(artists) ? artists[0] : null;
      if (!artist?.uri) throw new Error('artist not found');
      await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'music_assistant', service: 'play_media',
        service_data: { entity_id: target, media_id: artist.uri, media_type: 'artist', enqueue: 'replace' }
      });
      this._maBatchLoading = false;
      clearTimeout(this._maBatchLoadingTimer);
      this._pillPulse(500);
      // Exit back to the main artwork screen — playback has started.
      this._closeInfoPopup();
      this._closeMABrowser(true);
    } catch(e2) {
      this._maBatchLoading = false;
      clearTimeout(this._maBatchLoadingTimer);
      this._pillPulse(0);
      this._suppressArtTap = false;
      this._showToast(`\u26a0\ufe0f Couldn\u2019t find music by ${artistName} in Music Assistant.`, 5000);
    }
  },

  // ── AI Similar Artist Radio ─────────────────────────────────────────────────
  // Long-pressing an artist name anywhere in the card opens this panel.
  // The AI picks similar artists, the user chooses one, and MA starts a radio queue.
  async _showArtistRadioPanel(artistName) {
    if (!artistName) return;
    const r = this.shadowRoot;
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    const titleEl = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;

    const isMa = this._maEntityIds?.has(this._entity);
    if (!isMa) { this._showToast('Music Assistant required'); return; }

    // Force solid background
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.style.setProperty('isolation', 'isolate');
    popup.style.setProperty('transform', 'translateZ(0)');
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _haCard = r.querySelector('ha-card');
    if (_haCard) _haCard.style.setProperty('--crow-card-blur', 'none');

    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    const _rbo = r.getElementById('queueMenuBtn');
    if (_rbo) _rbo.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'Similar Artists';

    if (!this._aiPanelGeneration) this._aiPanelGeneration = 0;
    this._aiPanelGeneration++;
    const _myGen = this._aiPanelGeneration;
    const _stale = () => this._aiPanelGeneration !== _myGen;

    // Check cache before showing loading state
    if (!this._aiSimilarArtistsCache) this._aiSimilarArtistsCache = new Map();
    const _simArtKey = ('simartists|' + artistName).toLowerCase();
    if (!this._aiSimilarArtistsCache.has(_simArtKey)) {
      const _lsSim = this._aiLocalGet('similarArtists', _simArtKey);
      if (_lsSim) this._aiSimilarArtistsCache.set(_simArtKey, _lsSim);
    }
    if (!this._aiSimilarArtistsCache.has(_simArtKey)) {
      const _persisted = this._aiSessionGet('similarArtists', _simArtKey);
      if (_persisted) this._aiSimilarArtistsCache.set(_simArtKey, _persisted);
    }

    // Loading state (only shown when not cached)
    if (!this._aiSimilarArtistsCache.has(_simArtKey)) {
      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:24px;">
          <div style="width:26px;height:26px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
          <div style="font-size:12px;color:${this._pt("dim")};">Finding artists similar to ${artistName}…</div>
        </div>`;
    }

    const hasAI = await this._aiCheckAvailable();
    if (_stale()) return;
    if (!hasAI) { this._aiShowNoAgentBanner(popup); return; }

    let artists = [];
    if (this._aiSimilarArtistsCache.has(_simArtKey)) {
      artists = this._aiSimilarArtistsCache.get(_simArtKey);
    } else {
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
    const prompt = `List 8 artists that are musically similar to "${artistName}". `
      + `Be varied — mix well-known and lesser-known acts, different eras if appropriate. `
      + `Respond ONLY with a JSON array: [{"name":"Artist Name","reason":"5 word max reason"}]`;

    try {
      const resp = await this._aiProcess({ _crowFeature: 'discover',
        type: 'conversation/process', text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      if (_stale()) return;
      const raw = resp?.response?.speech?.plain?.speech || '';
      const s = raw.indexOf('['), e2 = raw.lastIndexOf(']');
      if (s === -1 || e2 <= s) throw new Error('No JSON');
      artists = JSON.parse(raw.slice(s, e2 + 1));
      if (!Array.isArray(artists) || !artists.length) throw new Error('Empty');
      this._aiSimilarArtistsCache.set(_simArtKey, artists);
      this._aiSessionSet('similarArtists', _simArtKey, artists);
      this._aiLocalSet('similarArtists', _simArtKey, artists);
    } catch(e) {
      if (_stale()) return;
      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:32px;text-align:center;">
          <div style="font-size:13px;color:rgba(255,100,100,0.8);">Couldn't find similar artists — try again in a moment.</div>
        </div>`;
      return;
    }
    } // end else (not cached)

    if (_stale()) return;

    const glassOn = this._config?.card_liquid_glass !== false;
    const state   = this._hass?.states[this._entity];
    const attrs   = state?.attributes || {};
    const artUrl  = (attrs.entity_picture_local || attrs.entity_picture || '').replace(/^http:\/\//i, 'https://');

    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.5);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px;">
        <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:#63b3ed;vertical-align:middle;margin-right:3px"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        Similar to ${artistName}
      </div>
      <div id="artist-radio-list">
        ${artists.map((a, i) => `
          <div class="ai-rec-wrap" style="position:relative;overflow:hidden;border-radius:12px;margin-bottom:6px;">
            <div class="artist-radio-row" data-idx="${i}" data-artist="${(a.name||'').replace(/"/g,'&quot;')}"
              style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${this._pt("bg")};cursor:pointer;will-change:transform;">
              <div class="artist-radio-art" data-art-idx="${i}"
                style="width:40px;height:40px;border-radius:50%;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#63b3ed;opacity:0.7"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name||''}</div>
                ${a.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.reason}</div>` : ''}
              </div>
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("dim")};flex-shrink:0"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>`).join('')}
      </div>
      <div style="margin-top:10px;font-size:10px;color:${this._pt("dim")};text-align:center;">Tap to start a radio queue · Long-press for Info</div>
    <div style="margin-top:6px;font-size:10px;color:${this._pt("dim")};text-align:center;opacity:0.7;">🎧 Binaural beats require headphones</div>`;

    // Glass glow
    if (glassOn && artUrl) {
      content.querySelectorAll('.ai-rec-wrap').forEach(wrap => {
        if (this._applyRowGlow && this._config?.row_glow) this._applyRowGlow(artUrl, wrap, null);
      });
    }

    // Fetch Wikipedia photos for each artist (circular, like cast photos)
    artists.forEach((a, i) => {
      setTimeout(() => {
        this._fetchWikipediaThumb(a.name).then(blobUrl => {
          if (!blobUrl || _stale()) return;
          const artEl = content.querySelector(`.artist-radio-art[data-art-idx="${i}"]`);
          if (artEl && !artEl.querySelector('img')) {
            const _aImg = document.createElement('img');
            _aImg.src = blobUrl;
            _aImg.alt = a.name;
            _aImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;';
            _aImg.onerror = () => {
              // Evict dead blob from cache so next render re-fetches
              if (this._wikiBlobCache?.has(a.name)) this._wikiBlobCache.delete(a.name);
              if (this._castPhotoCache?.has(a.name)) this._castPhotoCache.delete(a.name);
              artEl.innerHTML = '<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:rgba(255,255,255,0.3)"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>';
            };
            artEl.innerHTML = '';
            artEl.appendChild(_aImg);
          }
        });
      }, i * 400);
    });

    // Wire rows — tap = start radio, long-press = AI track info for artist
    const self = this;
    const allMA = self._getValidMASpeakers(true);
    const targetEntity = allMA[0] || self._entity;

    content.querySelectorAll('.artist-radio-row').forEach(row => {
      self._rowSwipe(row, { extra: [
        { id: 'arRadio', label: 'Radio', color: '#AF52DE', icon: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', run: () => { self._closeInfoPopup(); self._playArtistRadio(row.dataset.artist); } },
        { id: 'arInfo', label: 'Info', color: '#32ADE6', icon: '<svg viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg>', run: () => self._showAITrackInfo('', row.dataset.artist) },
      ], right: ['arRadio'], left: ['arInfo'] }, row.closest('.ai-rec-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };

      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          // Long-press → AI info for this artist's top track
          self._showAITrackInfo('', row.dataset.artist);
        }, 480);
      }, { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });

      row.addEventListener('click', async () => {
        if (lpFired) { lpFired = false; return; }
        const artist = row.dataset.artist;
        self._closeInfoPopup();
        // Delegate to _playArtistRadio which builds an AI-exclusive artist queue
        self._playArtistRadio(artist);
      });
    });
  },

  async _showAISearchPanel(initialQuery = '') {
    const r = this.shadowRoot;
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    const titleEl = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;

    const isMa    = this._maEntityIds?.has(this._entity);
    const glassOn = this._config?.card_liquid_glass !== false;

    // Force solid background
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.style.setProperty('isolation', 'isolate');
    popup.style.setProperty('transform', 'translateZ(0)');
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _haCard = r.querySelector('ha-card');
    if (_haCard) _haCard.style.setProperty('--crow-card-blur', 'none');

    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    const _rbo = r.getElementById('queueMenuBtn');
    if (_rbo) _rbo.classList.add('hidden');
    const _qsrSearch = r.getElementById('queueSearchRow');
    if (_qsrSearch) _qsrSearch.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'AI Search';
    this._setResultsExport(null);

    if (!this._aiPanelGeneration) this._aiPanelGeneration = 0;
    this._aiPanelGeneration++;
    const _myGen = this._aiPanelGeneration;
    const _stale = () => this._aiPanelGeneration !== _myGen;

    const hasAI = await this._aiCheckAvailable();
    if (_stale()) return;
    if (!hasAI) { this._aiShowNoAgentBanner(popup); return; }
    let _doSearchFn = null; // hoisted reference updated each time _renderSearch wires up
    let _wireInputOnlyFn = null; // same, for the clear button's re-wire
    let _doLibrarySearchFn = null; // same, for the plain-MA-search button
    const _renderSearch = (query = '', results = null, loading = false, error = '') => {
      const _inputVal = query.replace(/"/g, '&quot;');
      if (!_stale()) this._setResultsExport(results?.length ? () => this._exportResultsPDF('AI Search', query, results) : null);
      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0;height:100%;">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">
            <div style="flex:1;position:relative;">
              <input id="ai-search-input" type="text" value="${_inputVal}"
                placeholder="Describe what you want to hear…"
                style="width:100%;box-sizing:border-box;background:${this._pt("btnBg")};border:1px solid ${this._pt("border")};border-radius:12px;color:${this._pt("text")};font-size:14px;font-family:inherit;padding:11px 40px 11px 14px;outline:none;-webkit-appearance:none;"
                autocomplete="off" autocorrect="off" spellcheck="false">
              <button id="ai-search-clear" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;display:${query ? 'flex' : 'none'};align-items:center;justify-content:center;">
                <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._pt("dim")}"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
            <button id="ai-search-btn" style="flex-shrink:0;background:rgba(0,122,255,0.9);border:none;border-radius:12px;color:${this._pt("text")};font-size:13px;font-weight:600;padding:11px 16px;cursor:pointer;white-space:nowrap;font-family:inherit;-webkit-tap-highlight-color:transparent;">Search</button>
          </div>
          ${loading ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:10px;">
              <div style="width:26px;height:26px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
              <div style="font-size:12px;color:${this._pt("dim")};">Searching with AI…</div>
            </div>` : ''}
          ${error ? `<div style="font-size:12px;color:rgba(255,100,100,0.8);padding:8px 2px;">${error}</div>` : ''}
          ${results !== null && !loading ? (results.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:10px;opacity:0.5;">
              <svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:${this._pt("dim")}"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <div style="font-size:13px;color:${this._pt("dim")};">No results found</div>
            </div>` : `
            <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.5);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;text-align:center;">
              <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:#63b3ed;vertical-align:middle;margin-right:3px"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              ${results.length} result${results.length === 1 ? '' : 's'} for "${query}"
            </div>
            <div id="ai-search-action-bar" class="ma-drill-actions" style="margin-bottom:10px;">
              <button class="ma-drill-action-btn ai-search-action-btn" data-action="replace">
                <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
                <span class="ma-drill-btn-label">Play All</span>
              </button>
              ${this._shuffleBtnHtml('data-action="shuffle"', 'ai-search-action-btn')}
              <button class="ma-drill-action-btn ai-search-action-btn" data-action="add">
                <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div>
                <span class="ma-drill-btn-label">Add All</span>
              </button>
              <button class="ma-drill-action-btn ai-search-action-btn" data-action="next">
                <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div>
                <span class="ma-drill-btn-label">Play Next</span>
              </button>
            </div>
            <div id="ai-search-results">
              ${results.map((rec, i) => `
                <div class="ai-rec-wrap" style="position:relative;overflow:hidden;border-radius:12px;margin-bottom:6px;">
                  <div class="ai-search-row" data-idx="${i}"
                    data-title="${(rec.title||'').replace(/"/g,'&quot;')}"
                    data-artist="${(rec.artist||'').replace(/"/g,'&quot;')}"
                    style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${this._pt("bg")};cursor:pointer;will-change:transform;">
                    <div class="ai-search-art" data-search-idx="${i}"
                      style="width:40px;height:40px;border-radius:8px;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                      <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#63b3ed;opacity:0.7"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>
                    </div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.title||''}</div>
                      <div style="font-size:11px;color:${this._pt("dim")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.artist||''}</div>
                      ${rec.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.reason}</div>` : ''}
                    </div>
                  </div>
                </div>`).join('')}
            </div>`) : ''}
          ${!results && !loading && !error ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:12px;opacity:0.45;padding:24px;text-align:center;">
              <svg viewBox="0 0 24 24" style="width:36px;height:36px;fill:${this._pt("dim")}"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <div style="font-size:13px;color:${this._pt("dim")};line-height:1.5;">Describe what you want to hear<br><span style="font-size:11px;color:${this._pt("dim")};">"upbeat 80s pop", "songs like Bohemian Rhapsody",<br>"something to study to"</span></div>
            </div>` : ''}
        </div>`;

      // Wire input
      const inp = content.querySelector('#ai-search-input');
      const btn = content.querySelector('#ai-search-btn');
      const clr = content.querySelector('#ai-search-clear');

      const _doSearch = async () => {
        const _activeInp = content.querySelector('#ai-search-input');
        const q = (_activeInp?.value || inp?.value || '').trim();
        if (!q) return;
        if (_stale()) return;
        this._maRecordRecentSearch('ai_search', q);
        // Check cache first — same search query returns same results
        if (!this._aiSearchResultCache) this._aiSearchResultCache = new Map();
        const _sqKey = ('search|' + q).toLowerCase();
        if (!this._aiSearchResultCache.has(_sqKey)) {
          const _lsSR = this._aiLocalGet('searchResults', _sqKey);
          if (_lsSR) this._aiSearchResultCache.set(_sqKey, _lsSR);
        }
        if (!this._aiSearchResultCache.has(_sqKey)) {
          const _sp = this._aiSessionGet('searchResults', _sqKey);
          if (_sp) this._aiSearchResultCache.set(_sqKey, _sp);
        }
        if (this._aiSearchResultCache.has(_sqKey)) {
          const _cached = this._aiSearchResultCache.get(_sqKey);
          _renderSearch(q, _cached);
          _wireResults(q, _cached);
          return;
        }
        _renderSearch(q, null, true);
        const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
        const prompt = `You are a music search assistant. The user wants: "${q}". Suggest 18 specific tracks that match this description. Be varied across artists and eras. Respond ONLY with a JSON array:
[{"title":"Track Title","artist":"Artist Name","reason":"5 word max reason"}]`;
        try {
          const resp = await this._aiProcess({ _crowFeature: 'discover',
            type: 'conversation/process', text: prompt,
            agent_id: agentId, language: navigator.language || 'en'
          });
          if (_stale()) return;
          const raw = resp?.response?.speech?.plain?.speech || '';
          const s = raw.indexOf('['), e2 = raw.lastIndexOf(']');
          if (s === -1 || e2 <= s) throw new Error('No JSON');
          const tracks = JSON.parse(raw.slice(s, e2 + 1));
          this._aiSearchResultCache.set(_sqKey, tracks);
          this._aiSessionSet('searchResults', _sqKey, tracks);
          this._aiLocalSet('searchResults', _sqKey, tracks);
          _renderSearch(q, tracks);
          // Fetch art and wire interactions after render
          _wireResults(q, tracks);
        } catch(err) {
          if (_stale()) return;
          _renderSearch(q, null, false, 'Search failed — try rephrasing your query.');
          // Re-wire input after error render
          _wireInputOnly();
        }
      };
      _doSearchFn = _doSearch; // update hoisted ref so initialQuery block can call it

      // Enter in the input runs the AI-powered round-trip (_doSearch) —
      // matches the placeholder's "Describe what you want to hear…" framing.
      // The blue "Search" button instead runs a plain Music Assistant
      // library search (_doLibrarySearch) — same cross-category search used
      // by the Library root screen's own search box — so there's a quick
      // literal-match option alongside the AI-curated one.
      const _doLibrarySearch = () => {
        const _activeInp = content.querySelector('#ai-search-input');
        const q = (_activeInp?.value || inp?.value || '').trim();
        if (!q) { _activeInp?.focus(); return; }
        if (_stale()) return;
        this._closeInfoPopup();
        this._maNavigateToLibrarySearch(q);
      };
      _doLibrarySearchFn = _doLibrarySearch; // update hoisted ref so initialQuery block can call it

      const _wireInputOnly = () => {
        const inp2 = content.querySelector('#ai-search-input');
        const btn2 = content.querySelector('#ai-search-btn');
        const clr2 = content.querySelector('#ai-search-clear');
        if (inp2) inp2.addEventListener('keydown', e => { if (e.key === 'Enter') _doSearch(); });
        if (btn2) btn2.addEventListener('click', _doLibrarySearch);
        if (clr2) clr2.addEventListener('click', () => { _renderSearch(); _wireInputOnly(); });
        if (inp2) setTimeout(() => inp2.focus(), 50);
      };
      _wireInputOnlyFn = _wireInputOnly;

      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') _doSearch(); });
      if (btn) btn.addEventListener('click', _doLibrarySearch);
      if (clr) clr.addEventListener('click', () => { _renderSearch(); _wireInputOnly(); });
      if (inp) inp.addEventListener('input', () => {
        const c2 = content.querySelector('#ai-search-clear');
        if (c2) c2.style.display = inp.value ? 'flex' : 'none';
      });
      if (inp && !loading) setTimeout(() => inp.focus(), 50);
    };

    const _wireResults = (query, results) => {
      // Fetch iTunes art staggered, with retry + Wikipedia artist-photo fallback
      // on confirmed misses (same pipeline as Similar Tracks / Album Tracks).
      const _applySearchArt = (i, img) => {
        const artEl = content.querySelector(`.ai-search-art[data-search-idx="${i}"]`);
        if (!artEl || artEl.querySelector('img') || _stale()) return;
        const _im = document.createElement('img');
        _im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        _im.addEventListener('error', () => { this._evictStaleWikiBlobBySrc(_im.src); _im.style.display = 'none'; });
        _im.src = img;
        artEl.innerHTML = '';
        artEl.appendChild(_im);
        artEl.style.border = 'none';
      };
      const _fetchSearchArtWithRetry = (rec, i, retriesLeft, delayMs) => {
        const _srchCacheKey = [rec.artist || '', rec.title || ''].filter(Boolean).join('|').toLowerCase();
        if (this._itunesArtCache?.[_srchCacheKey]) { _applySearchArt(i, this._itunesArtCache[_srchCacheKey]); return; }
        setTimeout(() => {
          if (_stale()) return;
          this._fetchItunesArtForTrack(rec.artist || '', rec.title || '').then(img => {
            if (_stale()) return;
            if (img) {
              _applySearchArt(i, img);
            } else if (retriesLeft > 0) {
              _fetchSearchArtWithRetry(rec, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
            } else if (rec.artist) {
              this._fetchMusicPersonThumb(rec.artist, 2, 1500).then(blobUrl => {
                if (blobUrl) _applySearchArt(i, blobUrl);
              });
            }
          });
        }, delayMs);
      };
      results.forEach((rec, i) => _fetchSearchArtWithRetry(rec, i, 5, i * 700));

      // Background poller — keep retrying rows still showing a placeholder
      let _srchPollCount = 0;
      const _srchPollInterval = setInterval(() => {
        _srchPollCount++;
        if (_srchPollCount > 20 || _stale()) { clearInterval(_srchPollInterval); return; }
        let allDone = true;
        results.forEach((rec, i) => {
          const artEl = content.querySelector(`.ai-search-art[data-search-idx="${i}"]`);
          if (!artEl) { clearInterval(_srchPollInterval); return; }
          if (!artEl.querySelector('img')) {
            allDone = false;
            this._fetchItunesArtForTrack(rec.artist || '', rec.title || '').then(img => {
              if (img && !_stale()) {
                _applySearchArt(i, img);
              } else if (rec.artist && _srchPollCount >= 3 && !_stale()) {
                const _srchKey = [rec.artist || '', rec.title || ''].filter(Boolean).join('|').toLowerCase();
                if (this._itunesArtCache?.[_srchKey] === '') {
                  this._fetchMusicPersonThumb(rec.artist, 2, 1500).then(blobUrl => {
                    if (blobUrl) _applySearchArt(i, blobUrl);
                  });
                }
              }
            });
          }
        });
        if (allDone) clearInterval(_srchPollInterval);
      }, 3000);

      // Apply glass glow
      if (glassOn) {
        const state = this._hass?.states[this._entity];
        const attrs = state?.attributes || {};
        const artUrl = (attrs.entity_picture_local || attrs.entity_picture || '').replace(/^http:\/\//i, 'https://');
        if (artUrl) {
          content.querySelectorAll('.ai-rec-wrap').forEach(wrap => {
            if (this._applyRowGlow && this._config?.row_glow) this._applyRowGlow(artUrl, wrap, null);
          });
        }
      }

      // Wire action bar — batch play/add all search results
      const self = this;
      // Resolve MA target using the same pattern as _playTrackViaMAToast:
      // prefer the configured ma_entities from the visual editor over dynamic resolution
      const _srchBarTarget = (() => {
        const _allMA = self._getValidMASpeakers ? self._getValidMASpeakers(true) : [];
        if (self._lastMAPlayTarget && _allMA.includes(self._lastMAPlayTarget)) return self._lastMAPlayTarget;
        if (_allMA.length) return _allMA[0];
        return self._entity;
      })();

      content.querySelectorAll('.ai-search-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (!results.length) return;
          if (action === 'shuffle') { self._crowShufflePlay(results, { target: _srchBarTarget }); return; }
          self._maBatchLoading = true;
          clearTimeout(self._maBatchLoadingTimer);
          self._maBatchLoadingTimer = setTimeout(() => { self._maBatchLoading = false; }, 20000);
          self._pillPulse(20000);
          let successCount = 0;
          if (action === 'replace') {
            (typeof self?._showLoadingToast === 'function' ? self : this)._showLoadingToast('Starting playback\u2026');
            const [first, ...rest] = results;
            try {
              await self._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _srchBarTarget, media_id: `${first.title} ${first.artist}`, media_type: 'track', enqueue: 'replace' }
              });
              successCount++;
            } catch(_) {}
            for (const rec of rest) {
              try {
                await self._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: _srchBarTarget, media_id: `${rec.title} ${rec.artist}`, media_type: 'track', enqueue: 'add' }
                });
                successCount++;
              } catch(_) {}
            }
            self._closeInfoPopup();
            self._closeMABrowser(true);
          } else {
            const enqueueMode = action === 'next' ? 'next' : 'add';
            for (const rec of results) {
              try {
                await self._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: _srchBarTarget, media_id: `${rec.title} ${rec.artist}`, media_type: 'track', enqueue: enqueueMode }
                });
                successCount++;
              } catch(_) {}
            }
          }
          self._maBatchLoading = false;
          clearTimeout(self._maBatchLoadingTimer);
          self._pillPulse(0);
          const _spkName = self._entityDisplayName(_srchBarTarget);
          if (successCount === 0 && action !== 'replace') {

            self._showToast('\u26a0\ufe0f Couldn\u2019t add to queue \u2014 check Music Assistant.', 4000);

          } else if (action !== 'replace') {
            const label = action === 'next' ? 'Playing next' : 'Added to queue';
            self._showToast(`${label} — ${successCount} track${successCount !== 1 ? 's' : ''} on ${_spkName}`, 3000);
          }
        });
      });

      // Wire tap → AI track info, long-press → enqueue menu
      content.querySelectorAll('.ai-search-row').forEach(row => {
        self._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ai-rec-wrap'));
        let lpTimer = null, lpFired = false;
        const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        row.addEventListener('pointerdown', () => {
          lpFired = false;
          lpTimer = setTimeout(() => {
            cancelLP(); lpFired = true;
            self._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
          }, 480);
        }, { passive: true });
        row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
        row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
        row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
        row.addEventListener('click', () => {
          if (lpFired) { lpFired = false; return; }
          self._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true });
        });
      });
    };

    if (initialQuery) {
      _renderSearch(initialQuery, null, true);
      // Re-wire inputs after render
      const _inp0 = content.querySelector('#ai-search-input');
      const _btn0 = content.querySelector('#ai-search-btn');
      const _clr0 = content.querySelector('#ai-search-clear');
      if (_inp0) _inp0.addEventListener('keydown', e => { if (e.key === 'Enter') _doSearchFn?.(); });
      if (_btn0) _btn0.addEventListener('click', () => _doLibrarySearchFn?.());
      if (_clr0) _clr0.addEventListener('click', () => { _renderSearch(); _wireInputOnlyFn?.(); });
      if (_inp0) _inp0.value = initialQuery;
      // _doSearchFn is assigned since _aiCheckAvailable has already resolved above
      _doSearchFn?.();
    } else {
      _renderSearch();
    }
  },

  async _aiSmartSearch(query, originalSearchFn) {
    if (!query) { originalSearchFn(query); return; }
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { originalSearchFn(query); return; }

    // If it looks like a normal exact search (short, no descriptive words), skip AI
    const descriptive = /\b(song|track|music|sounds like|reminds me|vibe|feel|mood|that|which|what|from the|by the|kind of|type of)\b/i.test(query) || query.split(' ').length > 4;
    if (!descriptive) { originalSearchFn(query); return; }

    const prompt = `Convert this natural language music search to a concise search query for a music library (max 5 words, artist or title style): "${query}". Respond with ONLY the search query, nothing else.`;
    try {
      const refined = await this._aiConverseF('discover', prompt);
      const finalQuery = refined?.trim() || query;
      this._showToast(`🔍 Searching for: ${finalQuery}`);
      originalSearchFn(finalQuery);
    } catch(_) {
      originalSearchFn(query);
    }
  },

  // Renders the vibe queue into the already-open infoPopup so we don't need to close it first

  // ── Music Action Row (Ask / Meaning / Trivia) ───────────────────────────────
  // Handles mutual exclusivity: opening one panel closes the others.
  _wireMusicActionRow(content, trackTitle, artistName, data) {
    const PANELS = [
      { btnId: '#music-ask-btn',     panelId: '#music-ask-panel' },
      { btnId: '#music-meaning-btn', panelId: '#music-meaning-panel' },
      { btnId: '#music-story-btn',   panelId: '#music-story-panel' },
      { btnId: '#music-trivia-btn',  panelId: '#music-trivia-panel' },
    ];
    const _dim    = this._pt('dim');
    const _text   = this._pt('text');
    const _bg     = this._pt('btnBg');
    const _border = this._pt('border');

    const _closeAll = (exceptBtnId) => {
      PANELS.forEach(p => {
        if (p.btnId === exceptBtnId) return;
        const btn   = content.querySelector(p.btnId);
        const panel = content.querySelector(p.panelId);
        if (btn)   { btn.style.color = this._pt('text'); }
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      });
    };

    // ── Ask ──
    const askBtn   = content.querySelector('#music-ask-btn');
    const askPanel = content.querySelector('#music-ask-panel');
    if (askBtn && askPanel) {
      let askOpen = false;
      askBtn.addEventListener('click', () => {
        askOpen = !askOpen;
        if (askOpen) _closeAll('#music-ask-btn');
        askBtn.style.color = askOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!askOpen) { askPanel.style.display = 'none'; askPanel.innerHTML = ''; return; }
        askPanel.style.display = 'block';
        askPanel.innerHTML = `
          ${this._aiAskHtml('music-ask-input', 'music-ask-send', 'music-ask-answer', 'Who wrote this? Is there a live version?…')}`;
        const input    = askPanel.querySelector('#music-ask-input');
        const sendBtn  = askPanel.querySelector('#music-ask-send');
        const answerEl = askPanel.querySelector('#music-ask-answer');
        const _doAsk = async () => {
          const q = input?.value?.trim();
          if (!q) return;
          answerEl.innerHTML = this._aiLoading('Thinking\u2026');
          const hasAI = await this._aiCheckAvailable();
          if (!hasAI) { this._aiShowFail(answerEl, null, 'agent'); return; }
          const prompt = `About the song "${trackTitle}" by "${artistName}"${data.year ? ' (' + data.year + ')' : ''}: ${q}\n\nAnswer in 2-4 plain sentences.`;
          const result = await this._aiConverseF('ask', prompt, { noCache: true });
          if (answerEl && askPanel.isConnected) { if (result) answerEl.innerHTML = this._aiRich(result); else this._aiShowFail(answerEl, _doAsk); }
        };
        sendBtn?.addEventListener('click', _doAsk);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doAsk(); });
        setTimeout(() => input?.focus(), 50);
      });
    }

    // ── Meaning ──
    const meaningBtn   = content.querySelector('#music-meaning-btn');
    const meaningPanel = content.querySelector('#music-meaning-panel');
    if (meaningBtn && meaningPanel) {
      let meaningOpen = false;
      meaningBtn.addEventListener('click', async () => {
        meaningOpen = !meaningOpen;
        if (meaningOpen) _closeAll('#music-meaning-btn');
        meaningBtn.style.color = meaningOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!meaningOpen) { meaningPanel.style.display = 'none'; meaningPanel.innerHTML = ''; return; }
        meaningPanel.style.display = 'block';
        const cacheKey = ('meaning|' + artistName + '|' + trackTitle).toLowerCase();
        if (!this._aiMeaningCache) this._aiMeaningCache = new Map();
        let text = this._aiMeaningCache.get(cacheKey)
          || this._aiLocalGet('meaning', cacheKey)
          || this._aiSessionGet('meaning', cacheKey);
        if (text) {
          meaningPanel.innerHTML = this._aiTextHtml('Meaning', text);
          return;
        }
        meaningPanel.innerHTML = this._aiLoading('Interpreting…');
        const hasAI = await this._aiCheckAvailable();
        if (!meaningPanel.isConnected) return;
        if (!hasAI) { this._aiShowFail(meaningPanel, () => { meaningOpen = false; meaningBtn.click(); }, 'agent'); return; }
        const raw = await this._aiConverseF('ask', `What is the song "${trackTitle}" by "${artistName}" about? In 2-3 sentences, explain the themes and emotional meaning without quoting any lyrics. No preamble.`);
        if (!meaningPanel.isConnected) return;
        if (!raw) { this._aiShowFail(meaningPanel, () => { meaningOpen = false; meaningBtn.click(); }); return; }
        const cleaned = raw.replace(/^["']|["']$/g, '').trim();
        this._aiMeaningCache.set(cacheKey, cleaned);
        this._aiSessionSet('meaning', cacheKey, cleaned);
        this._aiLocalSet('meaning', cacheKey, cleaned);
        meaningPanel.innerHTML = this._aiTextHtml('Meaning', cleaned);
      });
    }

    // ── Story: how the song came about (who wrote it, the recording, the producer, notable tales) ──
    const storyBtn   = content.querySelector('#music-story-btn');
    const storyPanel = content.querySelector('#music-story-panel');
    if (storyBtn && storyPanel) {
      let storyOpen = false;
      storyBtn.addEventListener('click', async () => {
        storyOpen = !storyOpen;
        if (storyOpen) _closeAll('#music-story-btn');
        storyBtn.style.color = storyOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!storyOpen) { storyPanel.style.display = 'none'; storyPanel.innerHTML = ''; return; }
        storyPanel.style.display = 'block';
        const cacheKey = ('story|' + artistName + '|' + trackTitle).toLowerCase();
        if (!this._aiStoryCache) this._aiStoryCache = new Map();
        const text = this._aiStoryCache.get(cacheKey) || this._aiLocalGet('story', cacheKey) || this._aiSessionGet('story', cacheKey);
        if (text) { storyPanel.innerHTML = this._aiTextHtml('Story', text); return; }
        storyPanel.innerHTML = this._aiLoading('Finding the story\u2026');
        const hasAI = await this._aiCheckAvailable();
        if (!storyPanel.isConnected || !storyOpen) return;
        if (!hasAI) { this._aiShowFail(storyPanel, () => { storyOpen = false; storyBtn.click(); }, 'agent'); return; }
        const raw = await this._aiConverseF('ask', `Tell the story behind the song "${trackTitle}" by "${artistName}"${data?.year ? ' (' + data.year + ')' : ''}: who wrote it and what inspired it, where and how it was recorded, the producer, and any notable stories from its making. 3-4 plain sentences. Don't quote any lyrics, and leave out anything you're not sure of. No preamble.`);
        if (!storyPanel.isConnected || !storyOpen) return;
        if (!raw) { this._aiShowFail(storyPanel, () => { storyOpen = false; storyBtn.click(); }); return; }
        const cleaned = raw.replace(/^["']|["']$/g, '').trim();
        this._aiStoryCache.set(cacheKey, cleaned);
        this._aiSessionSet('story', cacheKey, cleaned);
        this._aiLocalSet('story', cacheKey, cleaned);
        storyPanel.innerHTML = this._aiTextHtml('Story', cleaned);
      });
    }

    // ── Trivia ──
    const triviaBtn   = content.querySelector('#music-trivia-btn');
    const triviaPanel = content.querySelector('#music-trivia-panel');
    if (triviaBtn && triviaPanel) {
      let triviaOpen = false;
      triviaBtn.addEventListener('click', async () => {
        triviaOpen = !triviaOpen;
        if (triviaOpen) _closeAll('#music-trivia-btn');
        triviaBtn.style.color = triviaOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!triviaOpen) { triviaPanel.style.display = 'none'; triviaPanel.innerHTML = ''; return; }
        triviaPanel.style.display = 'block';
        const cacheKey = ('mtrivia|' + artistName + '|' + trackTitle).toLowerCase();
        if (!this._aiMusicTriviaCache) this._aiMusicTriviaCache = new Map();
        let questions = this._aiMusicTriviaCache.get(cacheKey) || this._aiSessionGet('mTrivia', cacheKey);
        if (!questions) {
          triviaPanel.innerHTML = this._aiLoading('Generating trivia…');
          const hasAI = await this._aiCheckAvailable();
          if (!triviaPanel.isConnected) return;
          if (!hasAI) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'agent'); return; }
          const raw = await this._aiConverseF('ask', `Generate 5 fun trivia questions about the song "${trackTitle}" by "${artistName}" — mix track facts, artist history, and chart performance. Respond ONLY with a JSON array:\n[{"q":"Question?","a":"Answer"}]`);
          if (!triviaPanel.isConnected) return;
          if (!raw) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }); return; }
          try {
            const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
            questions = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
            this._aiMusicTriviaCache.set(cacheKey, questions);
            this._aiSessionSet('mTrivia', cacheKey, questions);
          } catch(e) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'unreadable'); return; }
        }
        if (!triviaPanel.isConnected) return;
        this._aiTriviaList(triviaPanel, questions);
      });
    }
  },

  // ── Music: This Day in Music Context ─────────────────────────────────────────
  // Tapping the year shows what was happening in music that year (see below).
  async _loadDayInMusicContext(content, trackTitle, artistName, year) {
    if (!year) return;
    const cacheKey = ('daymusic|' + artistName + '|' + trackTitle + '|' + year).toLowerCase();
    if (!this._aiDayMusicCache) this._aiDayMusicCache = new Map();
    const ls = this._aiLocalGet('dayMusic', cacheKey);
    if (ls) this._aiDayMusicCache.set(cacheKey, ls);
    const ss = !this._aiDayMusicCache.has(cacheKey) ? this._aiSessionGet('dayMusic', cacheKey) : null;
    if (ss) this._aiDayMusicCache.set(cacheKey, ss);

    // Wire the Year box click to show a popup
    const yearBox = content.querySelector('#music-year-box');
    if (!yearBox || !this._aiFeatureOn('info')) return;

    // Tapping the year shows "<year> in music" inline, under the song's details (a small heading and plain
    // text, like Meaning) rather than in a pop-up; tapping it again hides it.
    yearBox.addEventListener('click', async (e) => {
      e.stopPropagation();
      const existing = content.querySelector('#music-year-ctx');
      if (existing) { existing.remove(); return; }
      const sec = document.createElement('div');
      sec.id = 'music-year-ctx';
      sec.style.cssText = 'margin:0 0 14px;';
      sec.innerHTML = `<div class="ip-sec">${year} in music</div>` + this._aiLoading('Loading\u2026');
      // straight after the song's details (the audio quality slot sits right there), else at the top
      const anchor = content.querySelector('#info-audio-quality');
      if (anchor) anchor.before(sec); else content.prepend(sec);
      const _show = (html) => { if (sec.isConnected) sec.innerHTML = `<div class="ip-sec">${year} in music</div>` + html; };

      let text = this._aiDayMusicCache.get(cacheKey);
      if (!text) {
        const hasAI = await this._aiCheckAvailable();
        if (!sec.isConnected) return;
        if (!hasAI) { _show(''); this._aiShowFail(sec.appendChild(document.createElement('div')), null, 'agent'); return; }
        const raw = await this._aiConverseQuietF('info', `"${trackTitle}" by "${artistName}" was released in ${year}. In 2-3 sentences, describe what was happening in music and pop culture in ${year} — notable albums, cultural moments, or musical movements. No preamble, no mention of this specific song.`);
        if (!sec.isConnected) return;
        if (!raw) { _show('<div class="ip-ai-text" style="opacity:0.6;">Nothing found for this year.</div>'); return; }
        text = raw.replace(/^["']|["']$/g, '').trim();
        this._aiDayMusicCache.set(cacheKey, text);
        this._aiSessionSet('dayMusic', cacheKey, text);
        this._aiLocalSet('dayMusic', cacheKey, text);
      }
      _show(`<div class="ip-ai-text">${this._aiRich(text)}</div>`);
    });
  },

  _showAIMoodQueueInPanel(content, popup) {
    // Re-use _showAIMoodQueue but intercept maPopup.appendChild to render into infoContent instead
    // Simplest approach: just call _showAIMoodQueue normally — it will find maPopup
    // But first we need the card expanded. Since infoPopup is already open (visible),
    // the card IS expanded. So we close infoPopup silently and open mood.
    const r = this.shadowRoot;
    const _popup = r.getElementById('infoPopup');
    if (_popup) {
      _popup.classList.remove('visible');
      _popup.style.removeProperty('background');
      _popup.style.removeProperty('backdrop-filter');
      _popup.style.removeProperty('-webkit-backdrop-filter');
      _popup.style.removeProperty('isolation');
      _popup.style.removeProperty('transform');
      const _ic = r.getElementById('infoContent');
      if (_ic) _ic.style.removeProperty('background');
      const _hc = r.querySelector('ha-card');
      if (_hc) _hc.style.removeProperty('--crow-card-blur');
      _popup.querySelectorAll('.info-popup-back').forEach(b => b.remove());
    }
    // Now show mood — card is still expanded, maPopup is ready
    this._showAIMoodQueue();
  },

  // Wikipedia fallback for movie/TV info when the AI lookup comes back
  // empty — same reliable lookup pattern already used for cast/artist bio
  // photos (direct title lookup, then a search-based fallback for titles
  // that don't match a Wikipedia article exactly), just pulling the
  // extract text too instead of only the thumbnail. Not a replacement for
  // the richer AI-sourced panel (no cast, rating, genres) — just something
  // rather than a dead end when the AI genuinely has nothing.
  async _fetchWikipediaVideoFallback(title, isTV) {
    if (!title) return null;
    const _cooling = () => this._wikiRateLimitUntil && Date.now() < this._wikiRateLimitUntil;
    if (_cooling()) return null;

    const _summary = async (t) => {
      const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
        + encodeURIComponent(t.replace(/ /g, '_'));
      const resp = await crowFetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 429) {
        this._wikiRateLimitUntil = Date.now() + 30000;
        return null;
      }
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data?.type === 'disambiguation') return null;
      if (!data?.extract) return null;
      return {
        title: data.title || t,
        extract: data.extract,
        thumbnail: data.thumbnail?.source || data.originalimage?.source || null,
        url: data.content_urls?.desktop?.page || null,
      };
    };

    // Try the disambiguated form first — Wikipedia's own convention for a
    // movie/show that shares its title with something else (a holiday, a
    // book, another film entirely) is "Title (film)" / "Title (TV series)".
    // A bare title match can land on a completely unrelated article; e.g.
    // "Independence Day" alone resolves to the holiday, not the 1996 film.
    let result = null;
    if (isTV !== undefined) {
      result = await _summary(title + (isTV ? ' (TV series)' : ' (film)'));
    }
    if (!result) result = await _summary(title);
    if (!result && !_cooling()) {
      try {
        const searchUrl = 'https://en.wikipedia.org/w/rest.php/v1/search/page?limit=1&q=' + encodeURIComponent(title);
        const searchResp = await crowFetch(searchUrl, { headers: { Accept: 'application/json' } });
        if (searchResp.status === 429) {
          this._wikiRateLimitUntil = Date.now() + 30000;
        } else if (searchResp.ok) {
          const searchData = await searchResp.json();
          const best = searchData?.pages?.[0];
          const bestKey = best?.key || best?.title;
          if (bestKey) result = await _summary(bestKey);
        }
      } catch (_) { /* fall through to null */ }
    }
    return result;
  },

  // Quick iTunes artwork lookup, used as a fallback in _fetchVideoInfo when
  // nothing else provided artwork (no caller override, nothing relevant
  // currently playing). Just the artwork — no need for the full dedup/
  // grouping logic _mtSearch does for a whole results list, since this only
  // needs the single best match for one already-known title.
  async _fetchItunesArtworkFallback(title, isTV) {
    if (!title) return null;
    try {
      const media = isTV ? 'tvShow' : 'movie';
      const entity = isTV ? 'tvSeason' : 'movie';
      // limit=1 trusted iTunes' top result blindly — fine when it has
      // artwork, but for a common/ambiguous title the single top match can
      // easily lack one while a nearby result has it. Search a few more
      // and take the first that actually has artwork.
      const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(title) + '&media=' + media + '&entity=' + entity + '&limit=5&country=gb';
      const res = await crowFetch(url);
      if (res.status === 429) { console.warn('[Crow Media Player] iTunes rate-limited (quick fallback)', title); return null; }
      if (!res.ok) { console.warn('[Crow Media Player] iTunes quick fallback HTTP error', res.status, title); return null; }
      const data = await res.json();
      const withArt = (data?.results || []).find(r => r.artworkUrl100);
      if (!withArt) console.warn('[Crow Media Player] iTunes quick fallback — no result with artwork', title);
      return withArt ? withArt.artworkUrl100.replace('100x100bb', '600x600bb') : null;
    } catch (e) {
      console.warn('[Crow Media Player] iTunes quick fallback network/parse error', title, e);
      return null;
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // EXACT MOVIE & TV MATCHING (editor → Discover & Charts → Movie & TV Matching)
  // Works out which film or show it is the way media servers do: the title, the year
  // and whether it's a film or a show, checked against TMDB and settled by TMDB's ID.
  // ══════════════════════════════════════════════════════════════════════
  _videoMatchMode() {
    const m = this._config?.video_match;
    return m === 'exact' || m === 'jellyfin' ? 'exact' : 'standard';   // (an older "Exact + Jellyfin" choice counts as Exact)
  },

  // TMDB's matches for a title: { candidates: [...] } (one = sure, several = let the person pick), or null
  async _lookupTMDBExact(title, { type = null, year = null, tmdbId = null } = {}) {
    if (!this._tmdbKey()) return null;
    if (tmdbId && (type === 'movie' || type === 'tv')) {
      return this._lookupTMDBVideoInfo(title || '', type === 'tv', { byId: { type, id: tmdbId } });
    }
    let q = String(title || '').trim();
    const ym = q.match(/\s*\((\d{4})\)\s*$/);
    if (ym) { q = q.replace(ym[0], '').trim(); if (!year) year = ym[1]; }
    // extras a speaker or app adds that aren't part of the name
    q = q.replace(/\s*[\[(](?:4k|uhd|hd|sd|hdr|dolby vision|extended|director'?s cut|remastered|imax)[\])]\s*/gi, ' ')
      .replace(/\s+[-–]\s+(?:season|series)\s*\d+.*$/i, '').replace(/\s*\bS\d{1,2}\s*E\d{1,3}\b.*$/i, '').trim();
    if (!q) return null;
    const y = parseInt(year, 10) || null;
    const memoKey = [q.toLowerCase(), type || '', y || ''].join('|');
    if (!this._tmdbExactMemo) this._tmdbExactMemo = new Map();
    if (this._tmdbExactMemo.has(memoKey)) return this._tmdbExactMemo.get(memoKey);

    const base = 'https://api.themoviedb.org/3';
    const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
    const nq = norm(q);
    const search = async (t, withYear) => {
      const url = base + '/search/' + t + '?query=' + encodeURIComponent(q) + '&include_adult=false'
        + (withYear && y ? (t === 'tv' ? '&first_air_date_year=' : '&year=') + y : '');
      try { const r = await this._tmdbFetch(url); return r.ok ? ((await r.json()).results || []).map(x => ({ ...x, _t: t })) : []; } catch (_) { return []; }
    };
    const types = type === 'movie' || type === 'tv' ? [type] : ['movie', 'tv'];
    let results = (await Promise.all(types.map(t => search(t, true)))).flat();
    if (y && !results.length) results = (await Promise.all(types.map(t => search(t, false)))).flat();
    const yearOf = r => parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10) || null;
    // a film must be within a year; a show must have started by then (the year given for a show is
    // often a later season's)
    const yearOk = r => {
      if (!y) return true;
      const ry = yearOf(r);
      if (!ry) return false;
      return r._t === 'tv' ? ry <= y + 1 : Math.abs(ry - y) <= 1;
    };
    const named = r => [r.title, r.name, r.original_title, r.original_name].some(n => n && norm(n) === nq);
    let hits = results.filter(r => named(r) && yearOk(r));
    if (!hits.length && y) {
      // a near name (e.g. a subtitle left off) is accepted only when the year matches too
      hits = results.filter(r => yearOk(r) && [r.title, r.name].some(n => { const a = norm(n); return a && (a.startsWith(nq) || nq.startsWith(a)); }));
    }
    hits.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    // the same title as both a film and a show, with no year to tell them apart: offer both
    const top = hits.slice(0, 4);
    let out = { candidates: [] };
    if (top.length) {
      const full = await Promise.all(top.map(r => this._lookupTMDBVideoInfo(r.title || r.name || q, r._t === 'tv', { byId: { type: r._t, id: r.id } }).then(x => x?.candidates?.[0] || null).catch(() => null)));
      out = { candidates: full.filter(Boolean) };
      // one clear winner by popularity is taken as the answer when the year settled it
      if (y && out.candidates.length > 1 && (top[0].popularity || 0) > (top[1].popularity || 0) * 4) out.candidates = out.candidates.slice(0, 1);
    }
    this._tmdbExactMemo.set(memoKey, out);
    return out;
  },

  // opts.byId { type: 'movie' | 'tv', id }: skip the search and build the full details for that exact title
  async _lookupTMDBVideoInfo(cleanTitle, isSeriesTitle, opts = {}) {
    const tmdbKey = this._tmdbKey();
    if (!tmdbKey || (!cleanTitle && !opts.byId)) return null;

    const base    = 'https://api.themoviedb.org/3';
    const imgBase = 'https://image.tmdb.org/t/p/w500';

    // Strip a trailing year e.g. "Interstellar (2014)" → "Interstellar"
    const yearMatch   = cleanTitle.match(/\s*\((\d{4})\)\s*$/);
    const searchTitle = yearMatch ? cleanTitle.replace(yearMatch[0], '').trim() : cleanTitle;
    const titleYear   = yearMatch ? yearMatch[1] : null;

    const norm  = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const qNorm = norm(searchTitle);
    const nameScore = (name) => {
      const n = norm(name);
      if (n === qNorm) return 4;
      if (n.startsWith(qNorm) || qNorm.startsWith(n)) return 3;
      if (n.includes(qNorm) || qNorm.includes(n)) return 2;
      return 0;
    };

    let tvResults = [], mvResults = [];
    if (!opts.byId) try {
      const [tvResp, mvResp] = await Promise.all([
        this._tmdbFetch(`${base}/search/tv?query=${encodeURIComponent(searchTitle)}&page=1`),
        this._tmdbFetch(`${base}/search/movie?query=${encodeURIComponent(searchTitle)}&page=1${titleYear ? '&year=' + titleYear : ''}`)
      ]);
      tvResults = tvResp.ok ? ((await tvResp.json()).results || []) : [];
      mvResults = mvResp.ok ? ((await mvResp.json()).results || []) : [];
    } catch (_) {
      return null;
    }

    const scored = (results, nameKey) => results
      .map(r => ({ r, s: nameScore(r[nameKey]), pop: r.popularity || 0 }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || b.pop - a.pop);

    const tvScored = scored(tvResults, 'name');
    const mvScored = scored(mvResults, 'title');
    if (!opts.byId && !tvScored.length && !mvScored.length) return { candidates: [] };

    const bestTV  = tvScored[0] || null;
    const bestMV  = mvScored[0] || null;
    const tvScore = bestTV ? bestTV.s : 0;
    const mvScore = bestMV ? bestMV.s : 0;
    // Both TV and movie have an equally strong match — genuine cross-type
    // ambiguity (e.g. "Passengers", "Legend") rather than a clear winner.
    const ambiguous = bestTV && bestMV && tvScore === mvScore;

    const _movieGenreMap = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Science Fiction',53:'Thriller',10752:'War',37:'Western'};
    const _tvGenreMap    = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',53:'Thriller',10752:'War',37:'Western',10759:'Action & Adventure',10762:'Kids',10763:'News',10764:'Reality',10765:'Sci-Fi & Fantasy',10766:'Soap',10767:'Talk',10768:'War & Politics'};

    const toFullMovie = async (r) => {
      let detail = r, credits = null, similar = [];
      try {
        const [dResp, cResp, sResp] = await Promise.all([
          this._tmdbFetch(`${base}/movie/${r.id}`),
          this._tmdbFetch(`${base}/movie/${r.id}/credits`),
          this._tmdbFetch(`${base}/movie/${r.id}/similar`)
        ]);
        if (dResp.ok) detail = await dResp.json();
        if (cResp.ok) credits = await cResp.json();
        if (sResp.ok) similar = ((await sResp.json()).results || []).slice(0, 10);
      } catch (_) {}
      const director = credits?.crew?.find(c => c.job === 'Director')?.name || null;
      const genres = (detail.genres || []).map(g => g.name);
      return {
        type: 'movie',
        title: detail.title || r.title,
        year: (detail.release_date || r.release_date || '').split('-')[0] || '',
        genres: genres.length ? genres : (r.genre_ids || []).map(id => _movieGenreMap[id]).filter(Boolean),
        rating: detail.vote_average ? detail.vote_average.toFixed(1) : '', votes: detail.vote_count || 0,
        overview: detail.overview || r.overview || '',
        cast: (credits?.cast || []).slice(0, 15).map(c => c.name),
        director,
        status: detail.status || '',
        similar: similar.map(s => ({ title: s.title, year: (s.release_date || '').split('-')[0] || '', type: 'movie' })),
        _fromTmdb: true,
        _tmdbPoster: detail.poster_path ? (imgBase + detail.poster_path) : (r.poster_path ? imgBase + r.poster_path : ''),
        _tmdbUrl: `https://www.themoviedb.org/movie/${r.id}`,
      };
    };

    const toFullTV = async (r) => {
      let detail = r, credits = null, similar = [];
      try {
        const [dResp, cResp, sResp] = await Promise.all([
          this._tmdbFetch(`${base}/tv/${r.id}`),
          this._tmdbFetch(`${base}/tv/${r.id}/aggregate_credits`),
          this._tmdbFetch(`${base}/tv/${r.id}/similar`)
        ]);
        if (dResp.ok) detail = await dResp.json();
        if (cResp.ok) credits = await cResp.json();
        if (sResp.ok) similar = ((await sResp.json()).results || []).slice(0, 10);
      } catch (_) {}
      const castSorted = (credits?.cast || []).slice().sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0));
      const genres = (detail.genres || []).map(g => g.name);
      return {
        type: 'tv',
        title: detail.name || r.name,
        year: (detail.first_air_date || r.first_air_date || '').split('-')[0] || '',
        genres: genres.length ? genres : (r.genre_ids || []).map(id => _tvGenreMap[id]).filter(Boolean),
        rating: detail.vote_average ? detail.vote_average.toFixed(1) : '', votes: detail.vote_count || 0,
        overview: detail.overview || r.overview || '',
        cast: castSorted.slice(0, 15).map(c => c.name),
        seasons: (detail.seasons || []).filter(s => s.season_number > 0).length || detail.number_of_seasons || 0,
        status: detail.status || '',
        similar: similar.map(s => ({ title: s.name, year: (s.first_air_date || '').split('-')[0] || '', type: 'tv' })),
        _fromTmdb: true,
        _tmdbPoster: detail.poster_path ? (imgBase + detail.poster_path) : (r.poster_path ? imgBase + r.poster_path : ''),
        _tmdbUrl: `https://www.themoviedb.org/tv/${r.id}`,
      };
    };

    if (opts.byId) {
      const r = { id: opts.byId.id };
      return { candidates: [opts.byId.type === 'tv' ? await toFullTV(r) : await toFullMovie(r)] };
    }
    if (ambiguous) {
      const mvTop = mvScored.slice(0, 3), tvTop = tvScored.slice(0, 3);
      const full = await Promise.all([
        ...mvTop.map(x => toFullMovie(x.r)),
        ...tvTop.map(x => toFullTV(x.r)),
      ]);
      return { candidates: full };
    }

    if (mvScore > tvScore && bestMV) {
      return { candidates: [await toFullMovie(bestMV.r)] };
    }
    if (bestTV) {
      const topShows = tvScored.filter(x => x.s === tvScore).slice(0, 4);
      if (topShows.length > 1) {
        const full = await Promise.all(topShows.map(x => toFullTV(x.r)));
        return { candidates: full };
      }
      return { candidates: [await toFullTV(bestTV.r)] };
    }
    if (bestMV) return { candidates: [await toFullMovie(bestMV.r)] };
    return { candidates: [] };
  },

  // TVmaze show lookup shaped like a TMDB candidate, so the normal picker /
  // detail views can render it. TV only (TVmaze has no movies) and only
  // accepted when the show's name genuinely matches the title, since
  // TVmaze's search always returns its closest show even for a film title.
  // The same request brings the episode list, which is saved for the
  // seasons screen so it doesn't need fetching again.
  async _lookupTVmazeShow(title) {
    const clean = String(title || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
    if (!clean) return null;
    if (!this._tvmazeShowCache) this._tvmazeShowCache = new Map();
    const key = clean.toLowerCase();
    if (this._tvmazeShowCache.has(key)) return this._tvmazeShowCache.get(key);
    const norm = v => String(v || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const plain = html => { const d = document.createElement('div'); d.innerHTML = String(html || ''); return (d.textContent || '').trim(); };
    let result = null;
    try {
      const resp = await crowFetch('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(clean) + '&embed[]=episodes&embed[]=cast');
      if (resp.ok) {
        const show = await resp.json();
        const a = norm(show?.name), b = norm(clean);
        if (a && b && (a === b || a.startsWith(b + ' ') || b.startsWith(a + ' '))) {
          const eps = (show._embedded?.episodes || []).filter(e => e && e.season > 0 && e.number != null);
          const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const list = eps.map(e => ({ season: e.season, ep: e.number, title: esc(e.name || ('Episode ' + e.number)), airdate: e.airdate || '', overview: esc(plain(e.summary)) }));
          const running = show.status === 'Running' || show.status === 'In Development';
          if (list.length) {
            if (!this._tvmazeCache) this._tvmazeCache = new Map();
            this._tvmazeCache.set(key, list);
            this._tvmazeSave(key, list, running);
            if (running) (this._tvmazeRunning || (this._tvmazeRunning = new Set())).add(key);
          }
          result = {
            type: 'tv',
            title: show.name || clean,
            year: (show.premiered || '').split('-')[0] || '',
            genres: Array.isArray(show.genres) ? show.genres : [],
            rating: show.rating?.average ? Number(show.rating.average).toFixed(1) : '',
            votes: 0,
            overview: plain(show.summary),
            cast: (show._embedded?.cast || []).slice(0, 15).map(c => c?.person?.name).filter(Boolean),
            seasons: list.reduce((m, e) => Math.max(m, e.season), 0),
            status: show.status || '',
            network: show.network?.name || show.webChannel?.name || '',
            similar: [],
            _fromTvmaze: true,
            _tmdbPoster: show.image?.original || show.image?.medium || '',
            _tvmazeUrl: show.url || '',
          };
        }
      }
    } catch (_) { result = null; }
    this._tvmazeShowCache.set(key, result);
    return result;
  },

  // Fills a TV show's missing details (overview, cast, genres, seasons…)
  // from TVmaze. Only empty fields are touched — the AI's or TMDB's own
  // values always win. Returns true if anything was added.
  async _fillVideoGapsFromTVmaze(data) {
    if (!data || data.type !== 'tv' || data._fromTvmaze || data._tvmazeFilled) return false;
    data._tvmazeFilled = true;
    const missing = !data.overview || !data.cast?.length || !data.genres?.length || !data.seasons || !data.year || !data.rating || !data.status;
    if (!missing) return false;
    const tm = await this._lookupTVmazeShow(data.title);
    if (!tm) return false;
    let changed = false;
    ['overview', 'year', 'rating', 'status'].forEach(k => { if (!data[k] && tm[k]) { data[k] = tm[k]; changed = true; } });
    ['cast', 'genres'].forEach(k => { if (!data[k]?.length && tm[k]?.length) { data[k] = tm[k]; changed = true; } });
    if (!data.seasons && tm.seasons) { data.seasons = tm.seasons; changed = true; }
    return changed;
  },

  // Simple Wikipedia summary page for a movie/TV title — the last-resort
  // fallback when nothing richer is available.
  _renderVideoWikiFallback(content, wikiFallback, note) {
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _wt = this.shadowRoot?.getElementById('infoPopupTitle'); if (_wt) _wt.textContent = 'Wikipedia Info';
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    const _escW = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content.innerHTML = `
      <div style="padding:24px;">
        ${wikiFallback.thumbnail ? `<img src="${wikiFallback.thumbnail}" alt="" style="width:100%;max-width:220px;display:block;margin:0 auto 16px;border-radius:10px;">` : ''}
        <div style="font-size:17px;font-weight:700;color:${this._pt("text")};text-align:center;margin-bottom:4px;">${_escW(wikiFallback.title)}</div>
        <div style="font-size:11px;color:${this._pt("dim")};text-align:center;margin-bottom:16px;">${_escW(note)}</div>
        <div style="font-size:14px;line-height:1.6;color:${this._pt("text")};">${_escW(wikiFallback.extract)}</div>
        ${wikiFallback.url ? `<div style="margin-top:16px;text-align:center;"><a href="${wikiFallback.url}" target="_blank" rel="noopener" style="font-size:12px;color:#63b3ed;">Read more on Wikipedia \u2192</a></div>` : ''}
      </div>`;
  },

  async _fetchVideoInfo(title, isKnownSeriesTitle, localFileMeta) {
    // Capture and clear the art override at the START so it's available throughout
    const overrideArt = this._videoInfoArtOverride || null;
    this._videoInfoArtOverride = null;
    this._videoInfoPickerState = null;
    // Same capture-and-clear pattern for the Watch History title key — set
    // only by _openWatchInfo, so every other way of opening this panel
    // leaves it null and can never touch the watch log.
    this._videoInfoWatchKey = this._pendingWatchInfoKey || null;
    this._pendingWatchInfoKey = null;
    // what the caller already knows about the title (film or show, year, TMDB ID), for exact matching
    const _hint = this._videoMatchHint || {};
    this._videoMatchHint = null;
    // set only by a row tapped in the "Not this one?" search (see _renderVideoInfoSearchInline)
    const _carry = this._videoChoiceCarry;
    this._videoChoiceCarry = null;
    const r       = this.shadowRoot;
    const content = r.getElementById('infoContent');
    if (!content || !title) return;

    // Force solid background and disable glass blur
    const popup = r.getElementById('infoPopup');
    if (popup) {
      popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
      popup.style.setProperty('backdrop-filter', 'none');
      popup.style.setProperty('-webkit-backdrop-filter', 'none');
      popup.style.setProperty('isolation', 'isolate');
      popup.style.setProperty('transform', 'translateZ(0)');
    }
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _haCard = r.querySelector('ha-card');
    if (_haCard) _haCard?.style.setProperty('--crow-card-blur', 'none');

    const attrs  = this._hass?.states[this._entity]?.attributes || {};
    // entityArt (whatever's currently playing on this entity) is only a
    // sensible fallback in the original "tapped artwork while it's playing"
    // context. When a caller explicitly states isKnownSeriesTitle (Watch
    // Recap rows, Movies & TV search) or provides localFileMeta (Local
    // Media), we're looking up a specific title that has nothing to do
    // with current playback — using entityArt there was showing whatever
    // happened to be playing (e.g. a radio station) instead of the actual
    // title being looked up.
    const entityArt = (isKnownSeriesTitle === undefined && !localFileMeta)
      ? (attrs.entity_picture_local || attrs.entity_picture || '').replace(/^http:\/\//i, 'https://')
      : '';
    let artUrl = overrideArt || entityArt;

    // Clean the title thoroughly:
    // 1. Use series title if available (Apple TV sends episode title in media_title)
    // 2. Strip trailing year in brackets e.g. "Heat (1995)" → "Heat"
    // 3. Strip episode subtitle after dash or colon e.g. "Doctor Who: Twice Upon a Time" → "Doctor Who"
    // isKnownSeriesTitle lets a caller that already knows the answer (search
    // results, Watch Recap rows) say so explicitly, rather than guessing
    // from whatever's currently playing on this entity — which is often
    // completely unrelated to the title being looked up, and was causing
    // shows with a colon in their own name (e.g. "Star Trek: The Next
    // Generation" vs "Star Trek: Voyager") to both get stripped down to
    // "Star Trek" and collide on the same cached result.
    // a full title that is a real show or film (e.g. "Star Trek: Strange New Worlds") is kept whole - see _videoLookupTitle
    const _lookup = await this._videoLookupTitle(title, isKnownSeriesTitle !== undefined
      ? isKnownSeriesTitle
      : !!(this._hass?.states[this._entity]?.attributes?.media_series_title));
    const _isSeriesTitle = _lookup.isSeries;
    let cleanTitle = _lookup.title;

    // No artwork came from the caller (override) or the currently-playing
    // entity — likely opened from a context that never had artwork to pass
    // through in the first place (e.g. a Watch Recap row, which only stores
    // title/count, not artwork). Fetch one directly rather than showing a
    // blank placeholder.
    if (!artUrl) {
      artUrl = await this._fetchItunesArtworkFallback(cleanTitle, _isSeriesTitle) || '';
    }

    // Pin button — constructed from whatever we've resolved so far (clean
    // title, kind, artwork), so it works the same way regardless of which
    // context opened this panel (artwork tap, Watch Recap row, Movies & TV
    // search result).
    const _mtPin    = r.getElementById('infoPinBtn');
    const _mtPinSvg = r.getElementById('infoPinSvg');
    const _mtPinItem = {
      id: (_isSeriesTitle ? 'tv_' : 'movie_') + cleanTitle.toLowerCase(),
      kind: _isSeriesTitle ? 'tv' : 'movie',
      title: cleanTitle,
      subtitle: '',
      artworkUrl100: artUrl || '',
    };
    const _updateMtPinBtn = () => {
      if (!_mtPin || !_mtPinSvg) return;
      const pinned = this._mtIsStarred(_mtPinItem);
      _mtPinSvg.style.fill = pinned ? '#FFD60A' : 'rgba(255,255,255,0.5)';
      _mtPin.title = pinned ? 'Unpin' : 'Pin';
    };
    if (_mtPin) {
      _mtPin.classList.remove('hidden'); this._heroPinWatch();
      _updateMtPinBtn();
      _mtPin.onclick = async () => {
          if (this._mtIsStarred(_mtPinItem) && !(await this._confirmUnpin(_mtPinItem.kind === 'tv' ? 'show' : 'movie', _mtPinItem.title))) return;
        const nowPinned = this._mtToggleStar(_mtPinItem);
        _updateMtPinBtn();
        this._showToast(nowPinned ? '\ud83d\udccd Pinned' : 'Unpinned');
        this._updatePinnedIndicator();
        // Refresh whichever list is underneath this panel — otherwise
        // navigating back shows a stale pinned section that doesn't
        // reflect what was just toggled here.
        if (this._maCurrentTab === 'movie_tv') this._loadMATab('movie_tv');
        if (this._pinnedDetailActive && this._pinnedDetailCategory === 'movies_tv') this._openPinnedCategoryDetail('movies_tv');
      };
    }

    // "Not this one?" choices. The title this panel was opened for is its root: a match picked for it
    // (here, or on a DVD / Blu-ray case) is remembered and shown straight away next time. A search
    // started from "Not this one?" comes back through here carrying the root it was started from.
    const _carried = !!(_carry && Date.now() < _carry.until);
    this._videoInfoRootTitles = _carried ? _carry.titles : [title, cleanTitle];
    this._videoChoiceSaveNext = _carried;
    if (!_carried) {
      const _chosen = this._videoChoiceGet(title, cleanTitle);
      if (_chosen && (isKnownSeriesTitle === undefined || (_chosen.type === 'tv') === !!isKnownSeriesTitle)) {
        r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        this._renderVideoInfoDetail(content, _chosen, _chosen._tmdbPoster || artUrl);
        return;
      }
    }

    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:24px 32px;text-align:center;">
        <div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
        <div style="font-size:12px;line-height:1.5;color:${this._pt("dim")};max-width:300px;">Looking up \u201C${cleanTitle}\u201D\u2026</div>
      </div>`;

    // ── Exact matching ── settle which film or show it is through TMDB first, by the
    // title, year and whether it's a film or a show, before the AI or a looser search can guess
    const _matchMode = this._videoMatchMode();
    if (_matchMode !== 'standard' && this._tmdbKey()) {
      const _ct = String(attrs.media_content_type || '').toLowerCase();
      const _type = _hint.type || (isKnownSeriesTitle === true ? 'tv' : isKnownSeriesTitle === false ? 'movie'
        : (_isSeriesTitle || attrs.media_series_title || /tvshow|episode|season/.test(_ct)) ? 'tv' : _ct === 'movie' ? 'movie' : null);
      const _year = _hint.year || null, _tmdbId = _hint.tmdbId || null;
      let _exact = null;
      try { _exact = await this._lookupTMDBExact(cleanTitle, { type: _type, year: _year, tmdbId: _tmdbId }); } catch (_) { _exact = null; }
      const _ec = _exact?.candidates || [];
      // with AI Info First, the exact match settles which title it is and the AI then describes that one
      // (see _videoExactAI); with TMDB First or AI off, TMDB's info is shown as it is
      const _mixVid = this._config?.video_info_priority === 'tmdb_ai' && this._aiFeatureOn('info');
      _ec.forEach(c => { c._exactAI = true; if (_mixVid) c._mixedAI = true; });
      if (_ec.length) {
        const _artUrls = _ec.map(c => c._tmdbPoster || '');
        if (_ec.length > 1) {
          this._videoInfoPickerState = { results: _ec, artUrls: _artUrls, artUrl, cacheKey: null };
          this._renderVideoInfoPicker(content, _ec, artUrl, null, _artUrls);
        } else {
          this._videoInfoPickerState = null;
          this._renderVideoInfoDetail(content, _ec[0], _ec[0]._tmdbPoster || artUrl);
        }
        return;
      }
      // nothing certain on TMDB: carry on with the usual lookup below
    }

    // ── TMDB priority / AI-off fallback ── when the user has flipped Movie/TV
    // Info Priority to "TMDB First", or AI Features is off entirely, try TMDB
    // before ever touching AI (no agent-availability probe, no AI network
    // call). A hit renders through the same picker/detail views the AI path
    // uses. A miss or missing key falls through to the normal AI-first flow
    // below when AI is on — or shows a clear message when AI is off, since
    // there's nowhere else left to fall back to.
    const _aiOffForVideo = !this._aiFeatureOn('info');
    const _tmdbKeyPresent = !!this._tmdbKey();
    // TMDB & AI: TMDB's panel first, with the AI's extras (Ask, Mood Match, Spot It, Trivia) added
    const _vidMix = this._config?.video_info_priority === 'tmdb_ai' && !_aiOffForVideo;
    const _tmdbFirst = _tmdbKeyPresent && (this._config?.video_info_priority === 'tmdb' || _vidMix || _aiOffForVideo);
    if (_tmdbFirst) {
      let _earlyTmdb = null;
      try { _earlyTmdb = await this._lookupTMDBVideoInfo(cleanTitle, _isSeriesTitle); } catch (_) { _earlyTmdb = null; }
      const _cands = _earlyTmdb?.candidates || [];
      if (_vidMix) _cands.forEach(c => { c._mixedAI = true; });
      if (_cands.length) {
        const _artUrls = _cands.map(c => c._tmdbPoster || '');
        if (_cands.length > 1) {
          this._videoInfoPickerState = { results: _cands, artUrls: _artUrls, artUrl, cacheKey: null };
          this._renderVideoInfoPicker(content, _cands, artUrl, null, _artUrls);
        } else {
          this._videoInfoPickerState = null;
          this._renderVideoInfoDetail(content, _cands[0], _cands[0]._tmdbPoster || artUrl);
        }
        return;
      }
      if (_aiOffForVideo) {
        // Not on TMDB — try TVmaze (TV shows), then Wikipedia, before giving up
        const _tmShow = await this._lookupTVmazeShow(cleanTitle);
        if (_tmShow) { this._videoInfoPickerState = null; this._renderVideoInfoDetail(content, _tmShow, _tmShow._tmdbPoster || artUrl); return; }
        const _wikiOff = await this._fetchWikipediaVideoFallback(cleanTitle, _isSeriesTitle);
        if (_wikiOff) { this._renderVideoWikiFallback(content, _wikiOff, 'From Wikipedia \u2014 not found on TMDB'); return; }
        content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
        content.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px;text-align:center;">
            <svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:${this._pt("icon")}"><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg>
            <div style="font-size:15px;font-weight:600;color:${this._pt("text")}">Not found on TMDB</div>
            <div style="font-size:13px;color:${this._pt("dim")};line-height:1.5">"${cleanTitle}" isn't in the TMDB database, or the AI Info tab could add more matches once AI Features is turned on.</div>
          </div>`;
        return;
      }
      // AI is on but was set to TMDB-first — fall through to the normal
      // AI-first flow below since TMDB had nothing.
    } else if (_aiOffForVideo) {
      // AI is off and no TMDB key — TVmaze for TV shows, then Wikipedia.
      const _tmShow = await this._lookupTVmazeShow(cleanTitle);
      if (_tmShow) { this._videoInfoPickerState = null; this._renderVideoInfoDetail(content, _tmShow, _tmShow._tmdbPoster || artUrl); return; }
      const _wikiOff = await this._fetchWikipediaVideoFallback(cleanTitle, _isSeriesTitle);
      if (_wikiOff) { this._renderVideoWikiFallback(content, _wikiOff, 'From Wikipedia \u2014 add a TMDB key for full movie and TV info'); return; }
      // Nothing left to show.
      content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px;text-align:center;">
          <svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:${this._pt("icon")}"><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg>
          <div style="font-size:15px;font-weight:600;color:${this._pt("text")}">Movie/TV Info Unavailable</div>
          <div style="font-size:13px;color:${this._pt("dim")};line-height:1.6">AI Features is off. Add a free TMDB API key in the card editor → Info Panels to show movie/TV info without AI.</div>
        </div>`;
      return;
    }

    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) { this._aiShowNoAgentBanner(popup); return; }

    const cacheKey = ('videoinfo5|' + cleanTitle).toLowerCase(); // v5: TV lookups can return multiple candidates again, invalidates old forced-single-entry cache
    if (!this._aiVideoInfoCache) this._aiVideoInfoCache = new Map();
    if (!this._aiVideoInfoCache.has(cacheKey)) {
      const _lsPersisted = this._aiLocalGet('videoInfo', cacheKey);
      if (_lsPersisted) this._aiVideoInfoCache.set(cacheKey, _lsPersisted);
    }
    if (!this._aiVideoInfoCache.has(cacheKey)) {
      const persisted = this._aiSessionGet('videoInfo', cacheKey);
      if (persisted) this._aiVideoInfoCache.set(cacheKey, persisted);
    }
    let results = this._aiVideoInfoCache.get(cacheKey);

    if (!results) {
      const agentId = this._config?.ai_conversation_agent || '';
      const usingDefault = !agentId || agentId === 'conversation.home_assistant';

      // If using the built-in HA agent, warn immediately — it can't answer movie/TV questions
      if (usingDefault) {
        content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px;text-align:center;">
            <svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:rgba(99,179,237,0.4)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <div style="font-size:15px;font-weight:600;color:${this._pt("text")}">AI Agent Required</div>
            <div style="font-size:13px;color:${this._pt("dim")};line-height:1.6">Media info needs an AI agent with general knowledge.<br><br>Go to the card editor → AI and set your <strong style="color:${this._pt("text")}">AI Agent</strong> to Claude, OpenAI, or another capable assistant.</div>
          </div>`;
        return;
      }

      // If we have a series title, add specificity to avoid returning sibling shows
      const _isTVContext = _isSeriesTitle;
      // Previously, when the caller already knew the format for certain
      // (Watch Recap rows, Movies & TV search — anywhere isKnownSeriesTitle
      // is passed explicitly), the prompt hard-excluded the other format
      // and results were then hard-filtered to match. That made the AI's
      // own candidate list collapse to a single (occasionally wrong) entry
      // far more often than the artwork-tap flow, where no such exclusion
      // is applied — meaning the exact same title could get a helpful
      // "Which one did you mean?" picker from one entry point and a silent,
      // uncorrectable wrong answer from another. The prompt is now
      // identical everywhere so every entry point gets the same candidate
      // set (and therefore the same picker experience) for the same title.
      const _exactInstruction = _isTVContext
        // Same-titled shows do get reused (an old series revived decades
        // later under an unrelated production, a title remade for a
        // different network/country, etc). If multiple distinct works
        // share this exact title — including a same-named movie — include
        // all of them rather than confidently guessing the most famous
        // one; that's what lets a mix-up get caught and corrected via the
        // picker instead of silently showing the wrong thing.
        ? 'IMPORTANT: Return the exact show "' + cleanTitle + '" — do NOT include other shows in the same franchise, spin-offs, or related series. If multiple distinct TV series share this exact title (different years, different networks, unrelated reboots or remakes), or a movie shares this exact title, include ALL of them, not just the most famous one. Return up to 5 entries.'
        // Titles get reused across decades and formats (e.g. an older,
        // famous TV series vs a newer movie with the identical title).
        // Guessing the more famous one is worse than asking — when there's
        // genuine ambiguity, return every distinct version you know of so
        // the actual one can be picked, rather than confidently returning
        // only the best-known one.
        : 'IMPORTANT: This was watched as a movie. If multiple distinct movies share this exact title (different years, different films entirely), or a TV series shares this exact title, include ALL of them, not just the most famous one — a newer or less well-known release can still be the right one. Return up to 5 entries.';
      const prompt = 'You are a movie and TV encyclopedia. Use the full breadth of your training knowledge, including recent releases — do not assume you only know about older titles. I need information about "' + cleanTitle + '". CRITICAL: You MUST use your training knowledge to answer this. Do NOT say you cannot access the internet. ' + _exactInstruction + ' Return as a raw JSON array. Start with [ end with ]. Include up to 15 cast members and a "similar" array of 10 similar titles. Movie: [{"type":"movie","title":"Heat","year":"1995","genres":["Crime"],"rating":"8.3","overview":"...","cast":["Al Pacino"],"director":"Michael Mann","status":"Released","vibe":"Intense","similar":[{"title":"Michael Mann\'s Collateral","year":"2004","type":"movie"},{"title":"Heat 2","year":"2022","type":"movie"}]}] TV: [{"type":"tv","title":"Doctor Who","year":"2005","genres":["Sci-Fi"],"rating":"8.6","overview":"...","cast":["David Tennant"],"seasons":14,"status":"Continuing","vibe":"Epic","similar":[{"title":"Torchwood","year":"2006","type":"tv"},{"title":"The Sarah Jane Adventures","year":"2007","type":"tv"}]}] If truly unknown return [].' ;

      try {
        // Quiet when TMDB can step in if the AI can't help.
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
          type: 'conversation/process', text: prompt, _crowSilent: _tmdbKeyPresent,
          agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        // Strip code fences then extract JSON array
        const stripped = raw.split(String.fromCharCode(96)+String.fromCharCode(96)+String.fromCharCode(96)).join('');
        const start = stripped.indexOf('[');
        const end   = stripped.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array in response');
        results = JSON.parse(stripped.slice(start, end + 1));
        if (!Array.isArray(results) || !results.length) throw new Error('Empty results');
        // No longer hard-filtered by expected type here — that filtering
        // used to silently collapse a genuinely mixed-format candidate
        // list (e.g. a TV entry and a same-titled movie) down to whichever
        // single entry matched the caller's known format, which is exactly
        // what was suppressing the picker for Watch History / Video Recap
        // taps. Leaving every candidate the AI returned intact means the
        // picker (or the sort below) can do the disambiguation instead.
        // Softly prefer the expected type's entries first when there's a
        // mix, purely as a display-order nicety — doesn't drop anything.
        const _expectedType = _isSeriesTitle ? 'tv' : 'movie';
        results = [...results].sort((a, b) => {
          const aMatch = (a?.type || 'movie') === _expectedType ? 0 : 1;
          const bMatch = (b?.type || 'movie') === _expectedType ? 0 : 1;
          return aMatch - bMatch;
        });
        this._aiVideoInfoCache.set(cacheKey, results);
        this._aiSessionSet('videoInfo', cacheKey, results);
        this._aiLocalSet('videoInfo', cacheKey, results);
      } catch(e) {
        // AI came back empty — try TMDB next if a key is configured and we
        // haven't already tried it above (priority was AI-first, or off).
        // Falls to Wikipedia, then local file info, then nothing, exactly
        // as before, if TMDB also comes up empty.
        if (_tmdbKeyPresent && !_tmdbFirst) {
          let _fallbackTmdb = null;
          try { _fallbackTmdb = await this._lookupTMDBVideoInfo(cleanTitle, _isSeriesTitle); } catch (_) { _fallbackTmdb = null; }
          const _fbCands = _fallbackTmdb?.candidates || [];
          if (_fbCands.length) {
            const _fbArtUrls = _fbCands.map(c => c._tmdbPoster || '');
            content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
            this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
            if (_fbCands.length > 1) {
              this._videoInfoPickerState = { results: _fbCands, artUrls: _fbArtUrls, artUrl, cacheKey: null };
              this._renderVideoInfoPicker(content, _fbCands, artUrl, null, _fbArtUrls);
            } else {
              this._videoInfoPickerState = null;
              this._renderVideoInfoDetail(content, _fbCands[0], _fbCands[0]._tmdbPoster || artUrl);
            }
            return;
          }
        }
        // AI (and TMDB, if tried) came back empty — try Wikipedia before
        // giving up entirely. Won't have cast/rating/genres, but a summary
        // is better than nothing, especially for titles the AI's training
        // data doesn't cover or a mangled title that didn't resolve to
        // anything.
        const _tmShowFb = await this._lookupTVmazeShow(cleanTitle);
        if (_tmShowFb) { this._videoInfoPickerState = null; this._renderVideoInfoDetail(content, _tmShowFb, _tmShowFb._tmdbPoster || artUrl); return; }
        const wikiFallback = await this._fetchWikipediaVideoFallback(cleanTitle, _isSeriesTitle);
        if (wikiFallback) {
          content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
          this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          const _escW = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          { const _wt = this.shadowRoot?.getElementById('infoPopupTitle'); if (_wt) _wt.textContent = 'Wikipedia Info'; }
          content.innerHTML = `
            <div style="padding:24px;">
              ${wikiFallback.thumbnail ? `<img src="${wikiFallback.thumbnail}" alt="" style="width:100%;max-width:220px;display:block;margin:0 auto 16px;border-radius:10px;">` : ''}
              <div style="font-size:17px;font-weight:700;color:${this._pt("text")};text-align:center;margin-bottom:4px;">${_escW(wikiFallback.title)}</div>
              <div style="font-size:11px;color:${this._pt("dim")};text-align:center;margin-bottom:16px;">From Wikipedia \u2014 no AI info available for this title</div>
              <div style="font-size:14px;line-height:1.6;color:${this._pt("text")};">${_escW(wikiFallback.extract)}</div>
              ${wikiFallback.url ? `<div style="margin-top:16px;text-align:center;"><a href="${wikiFallback.url}" target="_blank" rel="noopener" style="font-size:12px;color:#63b3ed;">Read more on Wikipedia \u2192</a></div>` : ''}
            </div>`;
          return;
        }
        // Both AI and Wikipedia came up empty. If this came from browsing a
        // local file, show what we actually know about it (raw filename,
        // format, thumbnail if any) rather than a dead end — there's no
        // online match, but the file itself still has real information.
        if (localFileMeta) {
          content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
          this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          const _escL = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const _fmt = localFileMeta.extension ? localFileMeta.extension.toUpperCase() : (localFileMeta.mediaContentType || 'Unknown format');
          { const _wt = this.shadowRoot?.getElementById('infoPopupTitle'); if (_wt) _wt.textContent = 'File Info'; }
          content.innerHTML = `
            <div style="padding:24px;">
              ${localFileMeta.thumbnail ? `<img src="${_escL(localFileMeta.thumbnail)}" alt="" style="width:100%;max-width:220px;display:block;margin:0 auto 16px;border-radius:10px;">` :
                `<div style="display:flex;justify-content:center;margin-bottom:16px;"><svg viewBox="0 0 24 24" style="width:56px;height:56px;fill:${this._pt('icon')}"><path d="M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z"/></svg></div>`}
              <div style="font-size:17px;font-weight:700;color:${this._pt("text")};text-align:center;margin-bottom:4px;word-break:break-word;">${_escL(cleanTitle)}</div>
              <div style="font-size:11px;color:${this._pt("dim")};text-align:center;margin-bottom:20px;">No online match found \u2014 showing what\u2019s known from the file itself</div>
              <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;">
                <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="font-size:12px;color:${this._pt('dim')};">Filename</span><span style="font-size:12px;color:${this._pt('text')};text-align:right;max-width:65%;word-break:break-word;">${_escL(localFileMeta.rawFilename)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="font-size:12px;color:${this._pt('dim')};">Format</span><span style="font-size:12px;color:${this._pt('text')};">${_escL(_fmt)}</span></div>
              </div>
            </div>`;
          return;
        }
        content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px;text-align:center;">
            <svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:${this._pt("icon")}"><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg>
            <div style="font-size:15px;font-weight:600;line-height:1.4;color:${this._pt("text")};max-width:300px;">Nothing found for<br>\u201C${cleanTitle}\u201D</div>
            <div style="font-size:13px;color:${this._pt("dim")};line-height:1.5">Try tapping the artwork again in a moment, or check your AI agent is set up in the card editor.</div>
          </div>`;
        return;
      }
    }

    if (results.length > 1) {
      // If user already chose one for this title, go straight to it
      if (!this._aiVideoInfoSelectedCache) this._aiVideoInfoSelectedCache = new Map();
      const savedIdx = this._aiVideoInfoSelectedCache.get(cacheKey);
      if (savedIdx !== undefined && results[savedIdx]) {
        this._videoInfoPickerState = { results, artUrls: null, artUrl, cacheKey };
        this._renderVideoInfoDetail(content, results[savedIdx], artUrl);
      } else {
        this._renderVideoInfoPicker(content, results, artUrl, cacheKey);
      }
    } else {
      this._videoInfoPickerState = null;
      this._renderVideoInfoDetail(content, results[0], artUrl);
    }
  },

  async _renderVideoInfoPicker(content, results, artUrl, cacheKey, preFetchedArtUrls) {
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // Show list immediately with placeholders while artwork fetches in parallel
    const fallbackSvg = (type) => `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:${this._pt("dim")}"><path d="${type === 'tv' ? 'M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z' : 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z'}"/></svg>`;

    const renderList = (artUrls) => {
      content.innerHTML = `
        <div style="margin-bottom:12px;">
          <div class="info-section-label">Which one did you mean?</div>
          <div id="video-picker-list" style="display:flex;flex-direction:column;gap:8px;">
            ${results.map((r, i) => `
              <div class="video-picker-item" data-idx="${i}" style="
                display:flex;align-items:center;gap:12px;padding:12px 14px;
                background:${this._pt("bg")};border:1px solid ${this._pt("border")};
                border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background 0.12s;">
                <div style="width:44px;height:60px;border-radius:6px;background:${this._pt("bg")};flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                  ${artUrls && artUrls[i]
                    ? `<img src="${artUrls[i]}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.innerHTML='${fallbackSvg(r.type).replace(/"/g, '&quot;')}'"/>`
                    : fallbackSvg(r.type)}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</div>
                  <div style="font-size:11px;color:${this._pt("dim")};margin-top:2px">${[r.year, r.type === 'tv' ? 'TV Series' : 'Movie', r.genres?.[0]].filter(Boolean).join(' · ')}</div>
                  ${r.overview ? `<div style="font-size:11px;color:${this._pt("dim")};margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${r.overview}</div>` : ''}
                </div>
                
              </div>`).join('')}
          </div>
        </div>`;

      const self = this;
      content.querySelectorAll('.video-picker-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.idx, 10);
          if (cacheKey) {
            if (!this._aiVideoInfoSelectedCache) this._aiVideoInfoSelectedCache = new Map();
            this._aiVideoInfoSelectedCache.set(cacheKey, idx);
          }
          const selectedArt = (artUrls && artUrls[idx]) || artUrl;
          // Stash everything needed to re-show this exact picker instantly
          // (already-fetched artwork included) — lets the detail view offer
          // a way back to reconsider, without re-running the AI artwork
          // query or re-fetching every option's poster again.
          this._videoInfoPickerState = { results, artUrls, artUrl, cacheKey };
          if (this._videoInfoRootTitles) this._videoChoiceSet(this._videoInfoRootTitles, results[idx]);
          self._renderVideoInfoDetail(content, results[idx], selectedArt);
        });
      });
    };

    // Render immediately with placeholders so list is responsive
    renderList(null);

    if (preFetchedArtUrls) {
      // Returning to a picker we've already resolved artwork for — reuse
      // it directly instead of re-querying the AI and re-fetching every
      // poster again.
      renderList(preFetchedArtUrls);
      return;
    }

    // Ask the AI for precise, unambiguous image search queries for each result
    // then use those to fetch artwork — avoids franchise/disambiguation collisions
    let artUrls = new Array(results.length).fill(null);
    try {
      const agentId = this._config?.ai_conversation_agent || '';
      const pickerPrompt = 'For each of these movies/TV shows, give me the most specific and unambiguous Wikipedia article title that would show its poster/thumbnail. Return ONLY a JSON array of strings, one per item, in the same order. Example: ["Star Trek (film)", "Star Trek: The Next Generation", "Doctor Who (2005 TV series)"]. Items: '
        + results.map((r, i) => `${i+1}. "${r.title}" (${r.year}, ${r.type === 'tv' ? 'TV series' : 'movie'})`).join(', ');
      const resp = await this._aiProcess({ _crowFeature: 'info',
        type: 'conversation/process', text: pickerPrompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const start = raw.indexOf('['), end = raw.lastIndexOf(']');
      if (start !== -1 && end > start) {
        const queries = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(queries)) {
          // Fetch artwork in parallel using AI-provided precise queries
          artUrls = await Promise.all(
            queries.map((q, i) => {
              const r = results[i];
              const searchTitle = (typeof q === 'string' && q) ? q : (r.title + (r.year ? ' (' + r.year + ')' : ''));
              return this._fetchVideoArtWithWiki(searchTitle, r.year, r.type || 'movie').catch(() => null);
            })
          );
        }
      }
    } catch(_) {
      // AI query failed — fall back to standard title-based fetch
      artUrls = await Promise.all(
        results.map(r => this._fetchVideoArtWithWiki(r.title, r.year, r.type || 'movie').catch(() => null))
      );
    }

    // Re-render with artwork
    if (artUrls.some(u => u)) renderList(artUrls);

    const self = this;
    content.querySelectorAll('.video-picker-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        if (cacheKey) {
          if (!this._aiVideoInfoSelectedCache) this._aiVideoInfoSelectedCache = new Map();
          this._aiVideoInfoSelectedCache.set(cacheKey, idx);
        }
        const selectedArt = artUrls[idx] || artUrl;
        if (this._videoInfoRootTitles) this._videoChoiceSet(this._videoInfoRootTitles, results[idx]);
        self._renderVideoInfoDetail(content, results[idx], selectedArt);
      });
    });
  },

  // Manual disambiguation fallback for when the AI only ever returned a
  // single candidate (so there's no multi-result picker to fall back to)
  // and that single candidate turned out to be wrong — e.g. a franchise
  // mix-up like "Star Trek: Deep Space Nine" resolving to a Star Trek
  // movie's synopsis while the artwork (fetched separately via iTunes)
  // correctly shows the DS9 poster. Reuses the same iTunes search and row
  // rendering as the Movies & TV tab, so picking a result here opens the
  // exact same info panel via the exact same path (_mtMakeRow's own click
  // handler calls _fetchVideoInfo with a confirmed title + kind).
  //
  // Renders inline inside the existing info panel `content` container —
  // same as the AI candidate picker — rather than as a separate overlay,
  // so it stays within the panel's own bounds and matches its look.
  // `restoreFn` re-renders whatever was on screen before this was opened,
  // wired to the back button.
  _renderVideoInfoSearchInline(content, initialTitle, restoreFn, rootTitles = null) {
    const _pt = (k) => this._pt(k);
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button id="video-search-inline-back" style="width:28px;height:28px;border-radius:50%;background:${_pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${_pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
        </button>
        <div style="font-size:15px;font-weight:700;color:${_pt("text")};">Search for the right match</div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <input id="videoSearchInlineInput" type="text" value="${(initialTitle || '').replace(/"/g, '&quot;')}" placeholder="Search movies & TV shows" style="flex:1;min-width:0;box-sizing:border-box;background:${_pt("bg")};border:1px solid ${_pt("border")};border-radius:10px;padding:10px 12px;font-size:14px;color:${_pt("text")};font-family:inherit;" autocomplete="off" autocorrect="off" spellcheck="false">
        <button id="videoSearchInlineBtn" style="padding:0 16px;background:#0A84FF;border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;flex-shrink:0;">Search</button>
      </div>
      <div id="videoSearchInlineResults" style="display:flex;flex-direction:column;"></div>`;

    content.querySelector('#video-search-inline-back')?.addEventListener('click', () => {
      if (typeof restoreFn === 'function') restoreFn();
    });

    const _input    = content.querySelector('#videoSearchInlineInput');
    const _resultsEl = content.querySelector('#videoSearchInlineResults');
    // Tapping a result opens it through _fetchVideoInfo; tell it which title this search is fixing,
    // so the pick is remembered for that title. Runs before the row's own click handler.
    if (rootTitles) _resultsEl?.addEventListener('click', () => { this._videoChoiceCarry = { titles: rootTitles, until: Date.now() + 2000 }; }, true);

    const _runSearch = async () => {
      const q = (_input?.value || '').trim();
      if (!q || !_resultsEl) return;
      _resultsEl.innerHTML = `<div style="padding:16px 0;text-align:center;font-size:12px;color:${_pt("dim")};">Searching…</div>`;
      let results;
      try {
        results = await this._mtSearch(q);
      } catch (e) {
        if (!_resultsEl.isConnected) return;
        _resultsEl.innerHTML = `<div style="padding:16px 0;text-align:center;font-size:12px;color:${_pt("dim")};">Search unavailable right now — try again shortly.</div>`;
        return;
      }
      if (!_resultsEl.isConnected) return; // panel navigated away while awaiting
      _resultsEl.innerHTML = '';
      if (!results.length) {
        _resultsEl.innerHTML = `<div style="padding:16px 0;text-align:center;font-size:12px;color:${_pt("dim")};">Nothing matched "${q.replace(/</g, '&lt;')}"</div>`;
        return;
      }
      // _mtMakeRow's own click handler already opens the info panel with
      // a confirmed title/kind/artwork, replacing this view naturally.
      results.forEach(item => _resultsEl.appendChild(this._mtMakeRow(item, false)));
    };

    _input?.focus();
    content.querySelector('#videoSearchInlineBtn')?.addEventListener('click', _runSearch);
    _input?.addEventListener('keydown', e => { if (e.key === 'Enter') _runSearch(); });

    // Auto-run once with whatever title we already have, so the view
    // isn't empty on open.
    if (initialTitle) _runSearch();
  },

  // The AI's info for exactly the film or show the exact match settled on (told its title, year, whether
  // it's a film or a show, director and cast, so it can't drift to another with the same name). TMDB's facts
  // (title, year, poster, rating, cast, seasons) are kept; the AI adds its overview, vibe and
  // similar titles, and the panel gets its AI extras (Ask, Mood Match, Trivia). Null if the AI can't help.
  async _videoExactAI(t) {
    const idm = String(t._tmdbUrl || '').match(/\/(movie|tv)\/(\d+)/);
    const key = ('videoexact1|' + (idm ? idm[1] + '|' + idm[2] : (t.type || '') + '|' + (t.title || '') + '|' + (t.year || ''))).toLowerCase();
    if (!this._aiVideoInfoCache) this._aiVideoInfoCache = new Map();
    let ai = this._aiCachedRead(this._aiVideoInfoCache, 'videoInfo', key);
    if (!ai) {
      const agentId = this._config?.ai_conversation_agent || '';
      if (!agentId || agentId === 'conversation.home_assistant') return null;
      if (!(await this._aiCheckAvailable())) return null;
      const isTv = t.type === 'tv';
      const who = [t.director ? 'directed by ' + t.director : '', (t.cast || []).length ? 'starring ' + t.cast.slice(0, 3).join(', ') : ''].filter(Boolean).join(', ');
      const prompt = 'You are a movie and TV encyclopedia. Use the full breadth of your training knowledge, including recent releases. I need information about the '
        + (isTv ? 'TV series' : 'movie') + ' "' + t.title + '"' + (t.year ? ' (' + t.year + ')' : '') + (who ? ', ' + who : '') + '. '
        + 'It is exactly this one: not any other film or show with the same or a similar name, and not a remake, reboot, spin-off or sequel. '
        + 'CRITICAL: You MUST use your training knowledge to answer this. Do NOT say you cannot access the internet. '
        + 'Return a single raw JSON object. Start with { end with }. Include an "overview", a one-word "vibe", "genres", and a "similar" array of 10 similar titles. Example: '
        + (isTv
          ? '{"type":"tv","title":"Doctor Who","year":"2005","genres":["Sci-Fi"],"overview":"...","vibe":"Epic","similar":[{"title":"Torchwood","year":"2006","type":"tv"}]}'
          : '{"type":"movie","title":"Heat","year":"1995","genres":["Crime"],"overview":"...","vibe":"Intense","similar":[{"title":"Collateral","year":"2004","type":"movie"}]}')
        + ' If truly unknown return {}.';
      try {
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true, _crowSilent: true,
          type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en' });
        const raw = String(resp?.response?.speech?.plain?.speech || '').split(String.fromCharCode(96).repeat(3)).join('');
        const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
        if (a === -1 || b <= a) return null;
        let obj = JSON.parse(raw.slice(a, b + 1));
        if (Array.isArray(obj)) obj = obj[0];
        if (!obj || typeof obj !== 'object' || !obj.overview) return null;
        ai = { overview: obj.overview || '', vibe: obj.vibe || '', genres: Array.isArray(obj.genres) ? obj.genres : [],
          similar: Array.isArray(obj.similar) ? obj.similar.filter(x => x && x.title).slice(0, 10) : [] };
        this._aiCachedWrite(this._aiVideoInfoCache, 'videoInfo', key, ai);
      } catch (_) { return null; }
    }
    return {
      ...t,
      overview: ai.overview || t.overview || '',
      vibe: ai.vibe || t.vibe || '',
      genres: (t.genres || []).length ? t.genres : ai.genres,
      similar: (ai.similar || []).length ? ai.similar : (t.similar || []),
      _fromTmdb: false, _exactDone: true,
    };
  },

  _renderVideoInfoDetail(content, data, artUrl) {
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    if (!data) return;
    // Exact Match with AI Info First: the AI describes the title the exact match settled on, then the
    // panel is shown (TMDB's own info if the AI can't help)
    if (data._exactAI && !data._exactDone && !data._mixedAI && this._aiFeatureOn('info') && !['tmdb', 'tmdb_ai'].includes(this._config?.video_info_priority)) {
      const tok = this._exactAITok = (this._exactAITok || 0) + 1;
      const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      content.innerHTML = `
        <div id="exactAiLoading" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:32px;text-align:center;">
          <div style="width:24px;height:24px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
          <div style="font-size:12px;line-height:1.5;color:${this._pt('dim')};max-width:300px;">Looking up \u201C${esc(data.title)}\u201D${data.year ? ' (' + esc(data.year) + ')' : ''}\u2026</div>
        </div>`;
      this._videoExactAI(data).catch(() => null).then(ai => {
        if (tok !== this._exactAITok || !content.isConnected || !content.querySelector('#exactAiLoading')) return;
        this._renderVideoInfoDetail(content, ai || { ...data, _exactDone: true }, artUrl);
      });
      return;
    }
    this._videoPdfData = data;   // used by Export Info to PDF
    // the first title shown after a "Not this one?" search is the choice for the root title
    if (this._videoChoiceSaveNext && this._videoInfoRootTitles) { this._videoChoiceSet(this._videoInfoRootTitles, data); this._videoChoiceSaveNext = false; }
    const _rootTitles = this._videoInfoRootTitles ? this._videoInfoRootTitles.slice() : null;
    // TV show with missing details (no cast, no overview…)? Top it up from
    // TVmaze in the background and redraw — but only if this same panel is
    // still showing and none of its Ask / Mood / Trivia panels are open.
    if (data.type === 'tv' && !data._fromTvmaze && !data._tvmazeFilled) {
      this._videoDetailShowing = data;
      this._fillVideoGapsFromTVmaze(data).then(changed => {
        if (!changed || this._videoDetailShowing !== data) return;
        if (!content.querySelector('#content-warning-section')) return; // navigated within the panel
        const _open = ['#ask-panel', '#mood-panel', '#trivia-panel'].some(sel => {
          const el = content.querySelector(sel); return el && el.style.display !== 'none';
        });
        if (_open) return;
        const _scroll = content.scrollTop;
        this._renderVideoInfoDetail(content, data, artUrl);
        content.scrollTop = _scroll;
      }).catch(() => {});
    }
    this._videoDetailShowing = data;
    // Opened from Watch History: keep the cover the history list showed for
    // this title, even if the lookup or picker supplied a different poster
    // (e.g. a spin-off or sequel poster for the same franchise).
    if (this._watchInfoArt?.url) {
      const _norm = t => String(t || '').toLowerCase().replace(/\s*\(\d{4}\)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
      if (_norm(data.title) === _norm(this._watchInfoArt.title)) artUrl = this._watchInfoArt.url;
    }
    // Normalize data.similar here — the single choke point every caller
    // (initial lookup, disambiguation picker, Similar-row taps) funnels
    // through. The AI is asked for {title,year,type} objects but sometimes
    // simplifies its own output to a plain array of title strings instead —
    // downstream code (row text, art fetch, click-through) all read s.title/
    // s.year/s.type, which are undefined on a bare string, silently
    // producing a blank title and no artwork (just the generic type label,
    // e.g. "TV Series", left over from the fallback join). Coerce any
    // string entries into the expected object shape so every reader sees
    // the same thing regardless of which form the AI actually returned.
    if (Array.isArray(data.similar)) {
      data.similar = data.similar.map(s => (typeof s === 'string' ? { title: s } : s)).filter(s => s && s.title);
    }
    // Store for rewiring after back navigation from bio/seasons
    content.dataset.videoDataJson = JSON.stringify(data);
    content.dataset.videoArtUrl   = artUrl || '';

    // Header pin button — wired here rather than only by the caller, since
    // this function is the actual final render step and gets called
    // directly from many places (Similar row clicks, disambiguation picker
    // selections, cast/season back-navigation, etc.) that bypass
    // _fetchVideoInfo's own early wiring entirely. Without this, the button
    // kept showing whichever title's pinned state was wired last — e.g. a
    // pinned movie's own detail page, then tapping into an unrelated
    // Similar title, still showing "pinned" for that unrelated title.
    // Always rebuilt from `data`/`artUrl` (this function's own params), so
    // it's correct for whatever is actually on screen regardless of caller.
    {
      const _vidR = this.shadowRoot;
      const _mtPin    = _vidR?.getElementById('infoPinBtn');
      const _mtPinSvg = _vidR?.getElementById('infoPinSvg');
      if (_mtPin && _mtPinSvg) {
        const _pinTitle = (data.title || '').trim();
        const _mtPinItem = {
          id: (data.type === 'tv' ? 'tv_' : 'movie_') + _pinTitle.toLowerCase(),
          kind: data.type === 'tv' ? 'tv' : 'movie',
          title: _pinTitle,
          subtitle: '',
          artworkUrl100: artUrl || '',
        };
        const _updateMtPinBtn = () => {
          const pinned = this._mtIsStarred(_mtPinItem);
          _mtPinSvg.style.fill = pinned ? '#FFD60A' : 'rgba(255,255,255,0.5)';
          _mtPin.title = pinned ? 'Unpin' : 'Pin';
        };
        _mtPin.classList.remove('hidden'); this._heroPinWatch();
        _updateMtPinBtn();
        _mtPin.onclick = async () => {
          if (this._mtIsStarred(_mtPinItem) && !(await this._confirmUnpin(_mtPinItem.kind === 'tv' ? 'show' : 'movie', _mtPinItem.title))) return;
          const nowPinned = this._mtToggleStar(_mtPinItem);
          _updateMtPinBtn();
          this._showToast(nowPinned ? '\ud83d\udccd Pinned' : 'Unpinned');
          this._updatePinnedIndicator();
          if (this._maCurrentTab === 'movie_tv') this._loadMATab('movie_tv');
          if (this._pinnedDetailActive && this._pinnedDetailCategory === 'movies_tv') this._openPinnedCategoryDetail('movies_tv');
        };
      }
    }

    // Header label — matches the pattern used for the music info panel
    // (✨ AI Info vs 💿 Discogs Info): shows which source this result came
    // from so it's never ambiguous when both are configured.
    const _videoTitleEl = this.shadowRoot?.getElementById('infoPopupTitle');
    // the header names where the info came from
    // TMDB & AI (Try First → TMDB with AI Extras): TMDB's facts, with the AI's Ask, Mood Match, Spot It and Trivia
    const _vMix = !!(data._fromTmdb && data._mixedAI && this._aiFeatureOn('info'));
    if (_videoTitleEl) _videoTitleEl.textContent = data._fromTmdb ? 'TMDB Info' : data._fromTvmaze ? 'TVmaze Info' : 'AI Info';

    // Opened from Watch History and the lookup says this is a TV show —
    // fix any entries for that title that were logged as a movie (some
    // players report a show with no series/episode metadata at all), so
    // the history groups, labels and artwork lookups treat it as TV from
    // now on. The list underneath is refreshed so the change shows as soon
    // as this panel is closed.
    if (this._videoInfoWatchKey && data.type === 'tv') {
      if (this._correctWatchKind(this._videoInfoWatchKey, 'tv')) this._refreshWatchHistoryView();
    }

    const genreTags = (data.genres || []).slice(0, 3).map(g => `<span class="info-tag bio-genre-tag" data-tag="${g.replace(/"/g,'&quot;')}">${g}</span>`).join('');
    const _seasonsCount = data.type === 'tv' && data.seasons ? data.seasons : 0;
    const metaItems = [data.year, data.status].filter(Boolean);
    // Seasons rendered as a separate tappable button if available — see #tv-seasons-btn below
    const ratingHtml = this._ratingRingHtml(data.rating, data.votes, {
      site: 'tmdb', name: data.title || '',
      url: data._tmdbUrl || (data.title ? 'https://www.themoviedb.org/search?query=' + encodeURIComponent(data.title) : ''),
    });
    const _directorKnownEmpty = (() => {
      if (!data.director) return false;
      const _bioCacheKey = ('bio|' + data.director).toLowerCase();
      const _cached = this._castBioCache?.get(_bioCacheKey) || this._aiLocalGet?.('castBio', _bioCacheKey) || this._aiSessionGet?.('castBio', _bioCacheKey);
      if (!_cached) return false;
      return !(_cached.bio || _cached.known_for?.length);
    })();
    const _showDirectorPill = !!data.director && !_directorKnownEmpty;
    const directorHtml = _showDirectorPill ? `<div style="margin-top:6px;width:fit-content;max-width:100%;"><div id="video-director-link" data-director="${(data.director||''). replace(/"/g,'&quot;')}" class="ip-link"><svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4h-2l2 4H7L5 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V4h-4z"/></svg><span>Dir. ${data.director}</span></div></div>` : '';

    // Hero art — always start with a spinner; iTunes fetch replaces it with the
    // correct poster. Never use the entity picture as a placeholder because HA's
    // media_player art is whatever the source app has (e.g. podcast/documentary
    // thumbnails) and is frequently wrong for movie disambiguation.
    const artFallbackSvg = `<svg viewBox="0 0 24 24" style="width:36px;height:36px;fill:${this._pt("icon")}"><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg>`;
    const heroArtHtml = `<div id="video-info-poster-spinner" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><div style="width:22px;height:22px;border:2.5px solid rgba(99,179,237,0.2);border-top-color:rgba(99,179,237,0.6);border-radius:50%;animation:ma-spin 0.9s linear infinite;"></div></div>`;

    // Cast with placeholder photos — up to 15 members
    const castHtml = (data.cast || []).length ? `
      <div class="info-section-label">Cast</div>
      <div class="info-cast">
        ${(data.cast || []).slice(0, 10).map((name, idx) => `
          <div class="info-cast-item" data-cast-name="${name.replace(/"/g,'&quot;')}" data-cast-idx="${idx}" style="cursor:pointer;">
            <div class="info-cast-photo" id="cast-photo-${idx}" style="background:${this._pt("bg")};">
              <svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:${this._pt("dim")}"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>
            </div>
            <div class="info-cast-name">${name}</div>
          </div>`).join('')}
      </div>` : '';

    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    const _pickerState = this._videoInfoPickerState;
    const _hasMultiCandidates = !!(_pickerState && Array.isArray(_pickerState.results) && _pickerState.results.length > 1);
    // This used to only appear when the AI happened to return multiple
    // candidates to disambiguate between. But when the AI is confident
    // (wrongly) and returns just one result — e.g. mixing up a franchise
    // entry like "Star Trek: Deep Space Nine" with an unrelated Star Trek
    // movie — there was no way at all to fix it. Now always shown; it
    // either reopens the AI's own candidate picker (if there was one) or
    // falls back to a manual iTunes search so the person can pick the
    // right title themselves.
    content.innerHTML = `
      <div id="video-other-matches-btn" class="ip-link" style="margin-bottom:10px"><svg viewBox="0 0 24 24"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg><span>${_hasMultiCandidates ? 'Other Matches' : 'Not this one?'}</span></div>
      <div class="info-hero">
        <div class="info-hero-art" style="background:${this._pt("bg")};">${heroArtHtml}</div>
        <div class="info-hero-meta">
          <div class="info-hero-title">${data.title || ''}</div>
          ${metaItems.length ? `<div class="info-hero-sub">${metaItems.join(' · ')}</div>` : ''}
          ${(_seasonsCount || ratingHtml) ? `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;margin-top:2px;">
          ${_seasonsCount ? `<button id="tv-seasons-btn" class="ip-link" style="margin-bottom:2px"><svg viewBox="0 0 24 24"><path d="M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z"/></svg><span>${_seasonsCount} season${_seasonsCount !== 1 ? 's' : ''}</span></button>` : ''}
          ${ratingHtml}
          </div>` : ''}
          ${directorHtml}
        </div>
      </div>
      ${data.overview ? `<div class="info-section-label">Overview</div><div class="info-overview">${this._aiEm(data.overview)}</div>` : ''}
      ${genreTags ? `<div class="info-hero-tags" style="margin-top:8px;">${genreTags}</div>` : ''}
      <div id="content-warning-section"></div>
      ${(this._aiFeatureOn('ask') && (!data._fromTmdb || _vMix)) ? `
      <div id="action-row" style="display:flex;flex-wrap:wrap;justify-content:flex-start;gap:6px 20px;margin:12px 0 8px;">
        <button id="ask-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6V9M14,14H6V12H14V14M18,8H6V6H18V8Z"/></svg>
          Ask
        </button>
        <button id="mood-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2M12 20A8 8 0 1 1 20 12 8 8 0 0 1 12 20M17 11.5A1.5 1.5 0 1 1 15.5 10 1.5 1.5 0 0 1 17 11.5M8.5 10A1.5 1.5 0 1 1 7 11.5 1.5 1.5 0 0 1 8.5 10M12 17.5C9.67 17.5 7.69 16.04 6.89 14H17.11C16.31 16.04 14.33 17.5 12 17.5Z"/></svg>
          Mood Match
        </button>
        <button id="spot-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>
          Spot It
        </button>
        <button id="trivia-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
          Trivia
        </button>
      </div>
      <div id="ask-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="mood-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="spot-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="trivia-panel" style="display:none;margin-bottom:12px;"></div>
      ` : ''}
      ${castHtml}
      <div id="wtw-section"></div>
      ${(data.similar && data.similar.length) ? `
      <div class="info-section-label" style="margin-top:12px;">Similar</div>
      <div id="video-similar-list">
        ${(data.similar || []).map((s, i) => `
          <div class="video-similar-row" data-idx="${i}"
            data-title="${(s.title||'').replace(/"/g,'&quot;')}"
            data-year="${(s.year||'').replace(/"/g,'&quot;')}"
            data-type="${s.type||data.type||'movie'}"
            style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${this._pt("div")};cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <div class="video-similar-art" data-sim-idx="${i}" style="width:36px;height:50px;border-radius:5px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("dim")}"><path d="${(s.type||data.type) === 'tv' ? 'M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z' : 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z'}"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.title||''}</div>
              <div style="font-size:11px;color:${this._pt("dim")};margin-top:1px">${[s.year, (s.type||data.type)==='tv'?'TV Series':'Movie'].filter(Boolean).join(' · ')}</div>
            </div>
            
          </div>`).join('')}
      </div>` : ''}
`;

    // Wire post-render async features
    this._loadContentWarning(content, data);
    this._loadWhereToWatch(content, data);
    this._wireVideoActionRow(content, data);

    // Wire genre tag clicks
    this._wireGenreTagClicks(content);

    // "Other Matches" — back to the disambiguation picker, if this detail
    // view came from one.
    content.querySelector('#video-other-matches-btn')?.addEventListener('click', () => {
      if (_hasMultiCandidates) {
        this._renderVideoInfoPicker(content, _pickerState.results, _pickerState.artUrl, _pickerState.cacheKey, _pickerState.artUrls || null);
      } else {
        // a title picked in this search becomes the choice for the root title (see _fetchVideoInfo)
        this._renderVideoInfoSearchInline(content, data.title || '', () => this._renderVideoInfoDetail(content, data, artUrl), _rootTitles);
      }
    });

    // Prefer already-provided artwork (from the disambiguation picker, a
    // similar-item click, etc.) over a fresh iTunes fetch — see below.
    const heroArt = content.querySelector('.info-hero-art');
    // Fetch correct poster by title/year from iTunes — always replaces the spinner.
    // Uses DOM API (not innerHTML) to avoid escaping issues with the fallback SVG.
    const _setHeroPoster = (src) => {
      const ha = content.querySelector('.info-hero-art');
      if (!ha) return;
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.addEventListener('error', () => {
        const fb = document.createElement('div');
        fb.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
        fb.innerHTML = artFallbackSvg;
        ha.innerHTML = '';
        ha.appendChild(fb);
      });
      ha.innerHTML = '';
      ha.appendChild(img);
      img.src = src; // set src after error listener is attached
      img.style.pointerEvents = 'auto';
      // Tap poster → lightbox
      ha.style.cursor = 'zoom-in';
      ha.style.pointerEvents = 'auto';
      ha.onclick = () => this._showBioPhotoLightbox(src, data.title || '', content, true);
    };
    // If we already have artwork (e.g. selected from the disambiguation
    // picker, which used a precise AI-generated query specific to that
    // exact title/year — more accurate than a fresh generic lookup could
    // be) use it directly rather than racing a new fetch that could
    // override a correct result with a worse one, or simply fail outright
    // if the API happens to be having a bad moment.
    if (artUrl && artUrl !== '_no_entity_art_') {
      _setHeroPoster(artUrl);
    } else {
      this._fetchVideoArtWithWiki(data.title, data.year, data.type || 'movie').then(imgUrl => {
        if (imgUrl) {
          _setHeroPoster(imgUrl);
        } else {
          const ha = content.querySelector('.info-hero-art');
          if (ha) {
            ha.innerHTML = '';
            const fb = document.createElement('div');
            fb.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
            fb.innerHTML = artFallbackSvg;
            ha.appendChild(fb);
          }
        }
      });
    }

    // Wire similar row clicks → load detail for that title
    if (data.similar && data.similar.length) {
      const _self = this;
      content.querySelectorAll('.video-similar-row').forEach(row => {
        // hold: the same menu as Movies & TV rows (Pin, case printables, soundtrack); swipe: Pin / More
        const _simItem = () => {
          const t = (row.dataset.title || '').trim(), tv = row.dataset.type === 'tv';
          return { id: (tv ? 'tv_' : 'movie_') + t.toLowerCase(), kind: tv ? 'tv' : 'movie', title: t,
            subtitle: [row.dataset.year, tv ? 'TV Series' : 'Movie'].filter(Boolean).join(' \u00b7 '),
            artworkUrl100: row.querySelector('.video-similar-art img')?.src || '' };
        };
        let _simLp = null, _simLpFired = false;
        const _simCancel = () => { if (_simLp) { clearTimeout(_simLp); _simLp = null; } };
        row.addEventListener('contextmenu', e => e.preventDefault());
        row.addEventListener('pointerdown', () => {
          _simLpFired = false;
          _simLp = setTimeout(() => { _simCancel(); _simLpFired = true; _self._showMtContextMenu(row, _simItem()); }, 480);
        }, { passive: true });
        ['pointerup', 'pointercancel', 'pointermove'].forEach(t => row.addEventListener(t, _simCancel, { passive: true }));
        // the release of a hold isn't a tap
        row.addEventListener('click', (e) => { if (_simLpFired) { _simLpFired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        _self._rowSwipe(row, { menu: (h) => _self._showMtContextMenu(row, _simItem(), {}, h), right: ['mtPin'], left: ['mtSoundtrack', 'more'] });
        row.addEventListener('click', async () => {
          const simTitle = row.dataset.title;
          const simYear  = row.dataset.year;
          const simType  = row.dataset.type;
          const simArtEl = row.querySelector('.video-similar-art img');
          const simArt   = simArtEl?.src || '';
          // Show loading
          content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div></div>`;
          _self._videoInfoPickerState = null;
          _self._videoInfoRootTitles = null;
          // Respect the same source preference as the main lookup: skip
          // the AI round-trip entirely when AI is off, or the user has
          // set TMDB First and a key is configured — go straight to TMDB
          // for this title instead.
          const _simTmdbFirst = !!(_self._config?.tmdb_api_key || '').trim()
            && (!_self._aiFeatureOn('info') || ['tmdb', 'tmdb_ai'].includes(_self._config?.video_info_priority));
          if (_simTmdbFirst) {
            try {
              const _simTmdb = await _self._lookupTMDBVideoInfo(simTitle, simType === 'tv');
              const _simCand = _simTmdb?.candidates?.[0];
              if (_simCand && _self._config?.video_info_priority === 'tmdb_ai' && _self._aiFeatureOn('info')) _simCand._mixedAI = true;
              if (_simCand) {
                _self._renderVideoInfoDetail(content, _simCand, _simCand._tmdbPoster || simArt);
                return;
              }
            } catch (_) {}
            if (!_self._aiFeatureOn('info')) {
              // No AI to fall back to and TMDB had nothing — show what we know.
              _self._renderVideoInfoDetail(content, { title: simTitle, year: simYear, type: simType }, simArt);
              return;
            }
          }
          // Fetch AI details for selected similar title
          try {
            const agentId3 = _self._config?.ai_conversation_agent || 'conversation.home_assistant';
            const typeLabel3 = simType === 'tv' ? 'TV show' : 'movie';
            const simPrompt = `You are a movie and TV encyclopedia. For the ${typeLabel3} "${simTitle}"${simYear ? ` (${simYear})` : ''}, return a single JSON object (no array, no markdown): {"type":"${simType}","title":"${simTitle}","year":"${simYear||''}","genres":["Genre"],"rating":"8.0","overview":"2 sentence overview","cast":["Name1","Name2","Name3","Name4","Name5","Name6"],"director":"Name or null","status":"Released or Continuing","vibe":"Short vibe","similar":[{"title":"Title","year":"YYYY","type":"${simType}"}]}`;
            const simResp = await _self._aiProcess({ _crowFeature: 'info',
              type: 'conversation/process', text: simPrompt,
              agent_id: agentId3, language: navigator.language || 'en'
            });
            const simRaw = simResp?.response?.speech?.plain?.speech || '';
            // Fresh single-title lookup (not a multi-candidate array) —
            // clear any leftover picker state from the previous panel so
            // "Not this one?" falls back to a manual search for THIS
            // title rather than reopening an unrelated candidate list.
            _self._videoInfoPickerState = null;
            if (simRaw) {
              const si1 = simRaw.indexOf('{'), si2 = simRaw.lastIndexOf('}');
              if (si1 !== -1 && si2 !== -1) {
                const simData = JSON.parse(simRaw.slice(si1, si2 + 1));
                _self._renderVideoInfoDetail(content, simData, simArt);
                return;
              }
            }
          } catch(_) {}
          // Fallback
          _self._renderVideoInfoDetail(content, { title: simTitle, year: simYear, type: simType }, simArt);
        });
      });

      // Fetch poster art for similar items — same retry/poller pattern as music similar tracks
      const _applySimVideoArt = (i, url) => {
        const artEl = content.querySelector(`.video-similar-art[data-sim-idx="${i}"]`);
        if (!artEl) return;
        artEl.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.innerHTML=''">`;
        artEl.style.border = 'none';
        artEl.style.background = 'transparent';
        artEl.dataset.loaded = '1';
      };

      const _fetchSimVideoArtWithRetry = (s, i, retriesLeft, delayMs) => {
        const _simType = s.type || data.type || 'movie';
        const _cacheKey = (s.title + '|' + (s.year || '') + '|' + _simType).toLowerCase();
        if (this._itunesMoviePosterCache?.has(_cacheKey)) {
          const cached = this._itunesMoviePosterCache.get(_cacheKey);
          if (cached) { _applySimVideoArt(i, cached); return; }
        }
        setTimeout(async () => {
          const _artElCheck = content.querySelector(`.video-similar-art[data-sim-idx="${i}"]`);
          if (_artElCheck?.dataset.loaded) return; // already loaded — don't overwrite
          const url = await this._fetchVideoArtWithWiki(s.title, s.year || '', _simType).catch(() => null);
          if (url) {
            _applySimVideoArt(i, url);
          } else if (retriesLeft > 0) {
            _fetchSimVideoArtWithRetry(s, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
          }
        }, delayMs);
      };

      requestAnimationFrame(() => {
        (data.similar || []).forEach((s, i) => _fetchSimVideoArtWithRetry(s, i, 5, 300 + i * 700));

        // Background poller — keep retrying placeholders after initial wave
        let _simVidPollCount = 0;
        const _simVidPollInterval = setInterval(() => {
          _simVidPollCount++;
          if (_simVidPollCount > 15) { clearInterval(_simVidPollInterval); return; }
          let allDone = true;
          (data.similar || []).forEach((s, i) => {
            const artEl = content.querySelector(`.video-similar-art[data-sim-idx="${i}"]`);
            if (!artEl) { clearInterval(_simVidPollInterval); return; }
            if (!artEl.dataset.loaded) {
              allDone = false;
              const _simType = s.type || data.type || 'movie';
              this._fetchVideoArtWithWiki(s.title, s.year || '', _simType).then(url => {
                if (url) _applySimVideoArt(i, url);
              }).catch(() => {});
            }
          });
          if (allDone) clearInterval(_simVidPollInterval);
        }, 3000);
      });
    }

    // Fetch cast photos from Wikipedia — with staleness guard and retry loop.
    // Show header share button for this movie/TV panel
    const _vs = this.shadowRoot?.getElementById('infoShareBtn');
    if (_vs) {
      _vs.classList.remove('hidden');
      const _vSelf = this;
      _vs.onclick = () => _vSelf._showInfoShareMenu(_vs, () => {
        const _yr = data.year ? ' (' + data.year + ')' : '';
        const _tp = data.type === 'tv' ? 'TV Series' : 'Movie';
        const _ov = data.overview ? data.overview.slice(0, 120) + (data.overview.length > 120 ? '...' : '') : '';
        const _vShareText = (data.title || '') + _yr + (data.director ? ' - Dir. ' + data.director : '') + (_ov ? '\n' + _ov : '');
        const _vShareUrl = 'https://www.themoviedb.org/search?query=' + encodeURIComponent(data.title || '');
        _vSelf._copyToClipboard(_vShareText + '\n' + _vShareUrl);
      }, {
        extraItems: [..._vSelf._atvTrailerItems(data), {
          label: 'DVD / Blu-ray Case Printables (PDF)', pdf: 'disc',
          icon: 'M12,2A10,10 0 1,1 12,22A10,10 0 1,1 12,2Z M12,7.5A4.5,4.5 0 1,0 12,16.5A4.5,4.5 0 1,0 12,7.5Z M12,10.8A1.2,1.2 0 1,1 12,13.2A1.2,1.2 0 1,1 12,10.8Z',
          onClick: () => _vSelf._exportDiscCase(data, artUrl, { origTitles: _rootTitles || [data.title] }),
        }],
      });
    }

    // Watch Trailer (an item in the panel's 3-dot menu) — wired here (not in _fetchVideoInfo's
    // early wiring) for the same reason the pin button had to move here:
    // this function is the actual final render step, called directly from
    // 13 different places (Similar row clicks, the disambiguation picker,
    // cast/season back-navigation, etc.) that bypass _fetchVideoInfo
    // entirely. Wiring only in the early path left it stale/wrong after
    // navigating any of those other 12 ways.
    const _ytHdr2 = this.shadowRoot?.getElementById('infoYoutubeBtn');
    if (_ytHdr2) {
      if (this._config?.show_youtube_button === false) {
        _ytHdr2.classList.add('hidden');
        _ytHdr2.onclick = null;
      } else {
        _ytHdr2.title = 'Watch Trailer';
        _ytHdr2.classList.remove('hidden');
        const _trailerTitle = (data.title || '').trim();
        const _trailerYear  = data.year ? ' (' + data.year + ')' : '';
        _ytHdr2.onclick = () => {
          window.open(this._buildYoutubeUrl(`${_trailerTitle}${_trailerYear} official trailer`), '_blank');
        };
      }
    }


    // Photos are fetched as blob URLs to bypass HA's CSP restriction on upload.wikimedia.org.
    // Each photo is retried up to 3 times (at 3s, 8s, 15s) so slow network calls that
    // didn't resolve before the panel painted still appear once they complete.
    const castFetchId = String(Date.now());
    content.dataset.castFetchId = castFetchId;
    const _castFallbackSvg = `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:${this._pt("dim")}"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>`;

    const _applyCastPhoto = (photoEl, blobUrl, name) => {
      const img = document.createElement('img');
      img.src = blobUrl;
      img.alt = name;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      img.onerror = () => {
        // The cached blob URL is dead — evict from all caches so next render re-fetches
        if (this._wikiBlobCache?.has(name)) this._wikiBlobCache.delete(name);
        if (this._castPhotoCache?.has(name)) this._castPhotoCache.delete(name);
        photoEl.innerHTML = _castFallbackSvg;
      };
      photoEl.innerHTML = '';
      photoEl.appendChild(img);
      // Note: no lightbox tap here — these are cast GRID thumbnails, tapping
      // the row should open that person's bio (handled by the row's own click
      // listener). The lightbox-on-tap behaviour only applies to the single
      // bio header photo once the user has drilled into a person's page —
      // see _wireBioPhotoTap / the bio render path.
    };

    // In-memory cast photo cache — instant repaint if the same actor appears
    // twice in one render. Only ever caches a successful blob URL, never a
    // miss: confirmed misses are already tracked at the shared level via
    // _wikiThumbUrlCache, and a transient local failure shouldn't permanently
    // block this actor's photo for the rest of the session.
    if (!this._castPhotoCache) this._castPhotoCache = new Map();

    const _fetchCastPhotoWithRetry = (name, idx) => {
      const _cached = this._castPhotoCache.get(name);
      if (_cached) {
        const photoEl = content.querySelector('#cast-photo-' + idx);
        if (photoEl && !photoEl.querySelector('img')) _applyCastPhoto(photoEl, _cached, name);
        return;
      }
      this._fetchWikipediaThumbWithRetry(name, 4, 1500).then(blobUrl => {
        // Bail if the content panel has been replaced since we started fetching
        if (content.dataset.castFetchId !== castFetchId) return;
        const photoEl = content.querySelector('#cast-photo-' + idx);
        if (!photoEl) return;
        // Already has a real image — nothing to do
        if (photoEl.querySelector('img')) return;
        if (blobUrl) {
          this._castPhotoCache.set(name, blobUrl);
          _applyCastPhoto(photoEl, blobUrl, name);
        }
      });
    };

    // Cached actors load immediately. Only names that still need a network
    // lookup are staggered — previously every actor waited idx × 700ms even
    // when fully cached, so the 10th photo couldn't appear before ~6.3s.
    let _uncachedN = 0;
    (data.cast || []).slice(0, 10).forEach((name, idx) => {
      const _known = this._castPhotoCache.has(name) || this._wikiThumbUrlCache?.has(name);
      const delay = _known ? 0 : (_uncachedN++) * 250;
      setTimeout(() => _fetchCastPhotoWithRetry(name, idx), delay);
    });

    // Wire cast item clicks → bio panel
    const self = this;
    content.querySelectorAll('.info-cast-item[data-cast-name]').forEach(item => {
      const photoEl = item.querySelector('.info-cast-photo');
      item.addEventListener('click', () => {
        self._showCastBio(content, item.dataset.castName, data.title || '', artUrl);
      });
    });

    // User score ring → "Visit TMDB?" alert
    this._wireExtLinks(content);

    // Wire director link → bio panel
    const directorLink = content.querySelector('#video-director-link');
    if (directorLink) {
      directorLink.addEventListener('click', () => {
        self._showCastBio(content, directorLink.dataset.director, data.title || '', artUrl);
      });
      // Prefetch the bio in background — remove the pill if it turns out empty
      const _directorForPrefetch = directorLink.dataset.director;
      setTimeout(() => {
        self._prefetchCastBio(_directorForPrefetch, data.title || '').then(async hasData => {
          if (hasData !== false) return;
          // The AI had nothing — but the bio panel falls back to Wikipedia,
          // so only hide the pill if Wikipedia has nothing either.
          if (await self._fetchWikipediaPersonSummary(_directorForPrefetch, false)) return;
          const _stillThere = content.querySelector('#video-director-link');
          if (_stillThere && _stillThere.dataset.director === _directorForPrefetch) _stillThere.remove();
        });
      }, 500);
    }

    // Wire seasons button → seasons list panel
    const _seasonsBtn = content.querySelector('#tv-seasons-btn');
    if (_seasonsBtn) {
      _seasonsBtn.addEventListener('click', () => {
        self._showTvSeasons(content, data, artUrl);
      });
    }

  },

  // Format a YYYY-MM-DD airdate string using the HA-configured locale
  _formatAirdate(dateStr) {
    if (!dateStr) return '';
    try {
      // Parse as UTC noon to avoid any timezone-shift flipping the day
      const d = new Date(dateStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) return dateStr;
      // Use HA's locale language if available, otherwise browser default
      const lang = this._hass?.locale?.language || navigator.language || 'en';
      return d.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    } catch (e) {
      return dateStr;
    }
  },

  // ── Where to Watch ───────────────────────────────────────────────────────────
  // Fires async after _renderVideoInfoDetail sets content.innerHTML.
  // Injects a styled streaming-services section into the #wtw-section placeholder.
  // Cached for 7 days in localStorage (streaming rights change — shorter than the
  // 30-day default used for static info like cast/plot).
  async _loadWhereToWatch(content, data) {
    const title = data.title || '';
    const year  = data.year  || '';
    const type  = data.type  || 'movie';
    if (!title) return;

    const cacheKey  = ('wtw|' + type + '|' + title + '|' + year).toLowerCase();
    const _section  = () => content.querySelector('#wtw-section');
    const _dim      = this._pt('dim');
    const _text     = this._pt('text');
    const _bg       = this._pt('bg');
    const _border   = this._pt('border');

    // Helper — render the services into the placeholder
    const _render = (services) => {
      data._pdfWtw = services;   // for Export Info to PDF
      const el = _section();
      if (!el) return;
      if (!services || !services.length) { el.innerHTML = ''; return; }

      // Build service pills — each is a real <a> anchor for iOS deep-link compatibility
      const SERVICE_URLS = {
        'netflix':        'https://www.netflix.com/search?q=',
        'amazon':         'https://www.amazon.co.uk/s?k=',
        'amazon prime':   'https://www.amazon.co.uk/s?k=',
        'prime video':    'https://www.amazon.co.uk/s?k=',
        'disney+':        'https://www.disneyplus.com/search/',
        'disney plus':    'https://www.disneyplus.com/search/',
        'apple tv+':      'https://tv.apple.com/search?term=',
        'apple tv plus':  'https://tv.apple.com/search?term=',
        'apple tv':       'https://tv.apple.com/search?term=',
        'bbc iplayer':    'https://www.bbc.co.uk/iplayer/search?q=',
        'itvx':           'https://www.itv.com/search?q=',
        'channel 4':      'https://www.channel4.com/search?q=',
        'channel4':       'https://www.channel4.com/search?q=',
        'all 4':          'https://www.channel4.com/search?q=',
        'my5':            'https://www.channel5.com/search?q=',
        'channel 5':      'https://www.channel5.com/search?q=',
        'now':            'https://www.nowtv.com/search?q=',
        'now tv':         'https://www.nowtv.com/search?q=',
        'paramount+':     'https://www.paramountplus.com/search/',
        'paramount plus': 'https://www.paramountplus.com/search/',
        'hbo max':        'https://play.max.com/search?q=',
        'max':            'https://play.max.com/search?q=',
        'hulu':           'https://www.hulu.com/search?q=',
        'peacock':        'https://www.peacocktv.com/search?q=',
        'sky go':         'https://www.sky.com/watch/search?q=',
        'britbox':        'https://www.britbox.com/search?q=',
        'mubi':           'https://mubi.com/en/gb/search?q=',
        'youtube':        'https://www.youtube.com/results?search_query=',
        'youtube premium':'https://www.youtube.com/results?search_query=',
        'crunchyroll':    'https://www.crunchyroll.com/search?q=',
        'curiosity stream':'https://curiositystream.com/search?q=',
      };

      const SERVICE_COLORS = {
        'netflix':        '#E50914',
        'amazon':         '#00A8E1',
        'amazon prime':   '#00A8E1',
        'prime video':    '#00A8E1',
        'disney+':        '#113CCF',
        'disney plus':    '#113CCF',
        'apple tv+':      '#555555',
        'apple tv plus':  '#555555',
        'apple tv':       '#555555',
        'bbc iplayer':    '#FF6B35',
        'itvx':           '#542082',
        'channel 4':      '#6700C8',
        'channel4':       '#6700C8',
        'all 4':          '#6700C8',
        'my5':            '#0033FF',
        'channel 5':      '#0033FF',
        'now':            '#00CA2C',
        'now tv':         '#00CA2C',
        'paramount+':     '#0064FF',
        'paramount plus': '#0064FF',
        'hbo max':        '#5822B4',
        'max':            '#5822B4',
        'hulu':           '#3DBB3D',
        'peacock':        '#E8C619',
        'sky go':         '#0057FF',
        'britbox':        '#C41A1A',
        'mubi':           '#1A1A1A',
        'youtube':        '#FF0000',
        'crunchyroll':    '#F47521',
      };

      const q = encodeURIComponent(title + (year ? ' ' + year : ''));
      const _hexToRgba = (hex, alpha) => {
        const h = hex.replace('#','');
        const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
        return `rgba(${r},${g},${b},${alpha})`;
      };
      const googlePill = `<a href="https://www.google.com/search?q=${encodeURIComponent('where can I watch ' + title + (year ? ' ' + year : ''))}" target="_blank" rel="noopener"
        class="ip-link" style="color:${_dim};font-weight:500;">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <span>Search</span>
      </a>`;
      const pillsHtml = services.map(svc => {
        const key   = String(svc?.service || svc?.name || svc?.title || svc || '').toLowerCase().trim();
        const label = String(svc?.service || svc?.name || svc?.title || svc || '');
        // Defensive cap — the prompt asks for max 3 words, but AI responses
        // aren't guaranteed to comply. A stray full sentence here would
        // overflow off the edge of the screen with no wrapping, since these
        // pills are white-space:nowrap by design. Truncating defensively
        // means a misbehaving response degrades gracefully instead.
        let note = (svc.note || '').trim();
        if (note.length > 24) note = note.slice(0, 21) + '…';
        const color = SERVICE_COLORS[key] || '#63b3ed';
        const isHex = color.startsWith('#');
        const bgColor     = isHex ? _hexToRgba(color, 0.13) : color.replace(/[\d.]+\)$/, '0.13)');
        const borderColor = isHex ? _hexToRgba(color, 0.35) : color.replace(/[\d.]+\)$/, '0.35)');
        const base  = Object.entries(SERVICE_URLS).find(([k]) => key.includes(k))?.[1] || null;
        const href  = base ? base + q : `https://www.google.com/search?q=${encodeURIComponent('watch ' + title + (year ? ' ' + year : '') + ' ' + label)}`;
        // no pill: the service's name as a link, with a small dot in its colour
        return `<a href="${href}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:5px;text-decoration:none;
                 font-size:12px;font-weight:600;color:${_text};white-space:nowrap;
                 -webkit-tap-highlight-color:transparent;flex-shrink:0;">
          <span style="width:7px;height:7px;border-radius:50%;background:${borderColor.replace(/[\d.]+\)$/, '1)')};flex-shrink:0;"></span>${label}${note ? `<span style="font-size:11px;font-weight:400;color:${_dim};margin-left:1px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${note}</span>` : ''}
        </a>`;
      }).join('');

      el.innerHTML = `
        <div style="margin-top:12px;">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px;">
            <svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:rgba(99,179,237,0.7);flex-shrink:0">
              <path d="M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z"/>
            </svg>
            <span style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.7);letter-spacing:0.5px;text-transform:uppercase;">Where to Watch</span>
            <span style="font-size:9px;color:${_dim};margin-left:2px;">• AI</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;">
            ${pillsHtml}
            ${googlePill}
          </div>
        </div>`;
    };

    // Check caches first — render immediately if we have a hit
    if (!this._aiWtwCache) this._aiWtwCache = new Map();
    const _lsHit = this._aiLocalGet('wtw', cacheKey);
    if (_lsHit) { this._aiWtwCache.set(cacheKey, _lsHit); }
    const _ssHit = !this._aiWtwCache.has(cacheKey) ? this._aiSessionGet('wtw', cacheKey) : null;
    if (_ssHit) { this._aiWtwCache.set(cacheKey, _ssHit); }

    if (this._aiWtwCache.has(cacheKey)) {
      _render(this._aiWtwCache.get(cacheKey));
      return;
    }

    // Where to Watch comes from the AI: with AI off or unavailable (or its info feature switched off)
    // the section is simply left empty, so there's no spinner to get stuck
    const _clear = () => { const el = _section(); if (el) el.innerHTML = ''; };
    if (typeof this._aiFeatureOn === 'function' && !this._aiFeatureOn('info')) { _clear(); return; }
    const hasAI = await this._aiCheckAvailable().catch(() => false);
    if (!_section()) return;
    if (!hasAI) { _clear(); return; }

    // Show a subtle loading state in the placeholder
    const _elNow = _section();
    if (_elNow) {
      _elNow.innerHTML = `<div style="display:flex;align-items:center;gap:7px;margin-top:12px;opacity:0.5;">
        <div style="width:12px;height:12px;border:1.5px solid rgba(99,179,237,0.3);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;flex-shrink:0;"></div>
        <span style="font-size:10px;color:${_dim};">Finding streaming services…</span>
      </div>`;
    }

    const typeLabel = type === 'tv' ? 'TV series' : 'movie';
    const prompt = `Where can I watch the ${typeLabel} "${title}"${year ? ` (${year})` : ''} ? Respond ONLY with a JSON array, no markdown, no preamble: [{"service":"Netflix","note":""},{"service":"Amazon Prime Video","note":""}]. The "note" field must be at most 3 words (e.g. "Subscription", "Rent/Buy", "Season 1-3") or an empty string — never a full sentence or disclaimer.`;

    try {
      // an answer that hasn't come in 30 seconds isn't waited for (the spinner goes)
      const raw = await Promise.race([this._aiConverseQuietF('info', prompt), new Promise(r => setTimeout(() => r(null), 30000))]);
      if (!_section()) return; // panel navigated away
      if (!raw) { _clear(); return; }
      const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
      if (i1 === -1 || i2 === -1) { const el = _section(); if (el) el.innerHTML = ''; return; }
      const services = JSON.parse(raw.slice(i1, i2 + 1));
      // Only cache non-empty results — empty means the AI wasn't confident,
      // so we want to retry on next open rather than permanently showing nothing
      if (services && services.length) {
        this._aiWtwCache.set(cacheKey, services);
        this._aiSessionSet('wtw', cacheKey, services);
        try {
          const store = JSON.parse(localStorage.getItem('crow_media_ai_local_wtw') || '{}');
          store[cacheKey] = { data: services, ts: Date.now(), ttl: 7 };
          localStorage.setItem('crow_media_ai_local_wtw', JSON.stringify(store));
        } catch(_) {}
      }
      _render(services);
    } catch(e) {
      const el = _section();
      if (el) el.innerHTML = '';
    }
  },

  // ── Content Warning ──────────────────────────────────────────────────────────
  // Renders clickable content warning pills into #content-warning-section.
  // Tapping any pill opens a bottom-sheet popup explaining that rating/theme.
  async _loadContentWarning(content, data) {
    const el = content.querySelector('#content-warning-section');
    if (!el || !data.title) return;
    const cacheKey = ('cw|' + (data.type||'') + '|' + data.title + '|' + (data.year||'')).toLowerCase();
    if (!this._aiCwCache) this._aiCwCache = new Map();
    const ls = this._aiLocalGet('cw', cacheKey);
    if (ls) this._aiCwCache.set(cacheKey, ls);
    const ss = !this._aiCwCache.has(cacheKey) ? this._aiSessionGet('cw', cacheKey) : null;
    if (ss) this._aiCwCache.set(cacheKey, ss);
    let result = this._aiCwCache.get(cacheKey);
    if (!result) {
      const hasAI = await this._aiCheckAvailable();
      if (!content.querySelector('#content-warning-section')) return;
      if (!hasAI) return;
      const typeLabel = data.type === 'tv' ? 'TV series' : 'movie';
      const raw = await this._aiConverseQuietF('info', `For the ${typeLabel} "${data.title}"${data.year ? ' (' + data.year + ')' : ''}, give a brief content advisory. Respond ONLY with a JSON object: {"rating":"e.g. 15","rating_desc":"One sentence explaining what this UK age rating means for this title","themes":[{"label":"Violence","desc":"One sentence describing the nature of violence in this title"},{"label":"Language","desc":"One sentence describing the language"}],"kid_friendly":false}. Use UK age ratings (U, PG, 12, 15, 18). Max 3 themes.`);
      if (!raw) return;
      try {
        const i1 = raw.indexOf('{'), i2 = raw.lastIndexOf('}');
        result = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
        // Normalise themes — support both old string[] and new {label,desc}[] format
        if (result.themes && typeof result.themes[0] === 'string') {
          result.themes = result.themes.map(t => ({ label: t, desc: '' }));
        }
        this._aiCwCache.set(cacheKey, result);
        this._aiSessionSet('cw', cacheKey, result);
        this._aiLocalSet('cw', cacheKey, result);
      } catch(e) { return; }
    }
    if (result) data._pdfCw = result;   // for Export Info to PDF
    const elNow = content.querySelector('#content-warning-section');
    if (!elNow || !result) return;
    const _dim = this._pt('dim');
    const _text = this._pt('text');
    const _bg = this._pt('btnBg');
    const _border = this._pt('border');
    const ratingColor = result.kid_friendly ? '#34c759' : result.rating === '18' ? '#ff3b30' : result.rating === '15' ? '#ff9500' : '#63b3ed';
    const themes = result.themes || [];

    const _showCwPopup = (title, titleColor, body) => {
      // Remove any existing popup
      this.shadowRoot?.querySelectorAll('.cw-popup').forEach(el => el.remove());
      const cardOuter = this.shadowRoot?.getElementById('cardOuter') || this.shadowRoot;
      const popup = document.createElement('div');
      popup.className = 'cw-popup';
      popup.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';
      popup.innerHTML = `
        <div style="width:100%;max-width:480px;background:var(--crow-panel-bg,#13131a);border-radius:20px 20px 0 0;padding:20px 20px 40px;box-shadow:0 -8px 40px rgba(0,0,0,0.6);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <span style="font-size:15px;font-weight:700;color:${titleColor};">${title}</span>
            <button class="cw-popup-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${_text}"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div style="font-size:13px;color:${_text};line-height:1.6;">${body}</div>
        </div>`;
      cardOuter.appendChild(popup);
      const _close = () => popup.remove();
      popup.addEventListener('click', e => { if (e.target === popup) _close(); });
      popup.querySelector('.cw-popup-close')?.addEventListener('click', _close);
    };

    const ratingPillHtml = `<span class="cw-pill" data-cw-type="rating" style="display:inline-flex;align-items:center;font-size:11px;font-weight:700;color:${ratingColor};background:${ratingColor}22;border:1px solid ${ratingColor}55;border-radius:5px;padding:2px 8px;flex-shrink:0;cursor:pointer;-webkit-tap-highlight-color:transparent;">${result.rating || '?'}</span>`;
    const themePillsHtml = themes.map(t =>
      `<span class="cw-pill" data-cw-type="theme" data-cw-label="${(t.label||'').replace(/"/g,'&quot;')}" data-cw-desc="${(t.desc||'').replace(/"/g,'&quot;')}" style="display:inline-flex;align-items:center;font-size:10px;color:${_dim};background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 7px;cursor:pointer;-webkit-tap-highlight-color:transparent;">${t.label||''}</span>`
    ).join('');

    elNow.innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 4px;">
      ${ratingPillHtml}${themePillsHtml}
    </div>`;

    // Wire pill taps
    elNow.querySelectorAll('.cw-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        if (pill.dataset.cwType === 'rating') {
          const rDesc = result.rating_desc || `Rated ${result.rating} by the BBFC.`;
          _showCwPopup(`${result.rating} Rating`, ratingColor, rDesc);
        } else {
          const label = pill.dataset.cwLabel || '';
          const desc  = pill.dataset.cwDesc  || `This title contains ${label.toLowerCase()}.`;
          _showCwPopup(label, _dim, desc);
        }
      });
    });
  },

  // ── Video Action Row (Ask / Mood Match / Trivia) ────────────────────────────
  // Handles mutual exclusivity: opening one panel closes the others.
  _wireVideoActionRow(content, data) {
    const PANELS = [
      { btnId: '#ask-btn',   panelId: '#ask-panel' },
      { btnId: '#mood-btn',  panelId: '#mood-panel' },
      { btnId: '#spot-btn',  panelId: '#spot-panel' },
      { btnId: '#trivia-btn',panelId: '#trivia-panel' },
    ];
    const _dim    = this._pt('dim');
    const _text   = this._pt('text');
    const _bg     = this._pt('btnBg');
    const _border = this._pt('border');

    const _closeAll = (exceptBtnId) => {
      PANELS.forEach(p => {
        if (p.btnId === exceptBtnId) return;
        const btn   = content.querySelector(p.btnId);
        const panel = content.querySelector(p.panelId);
        if (btn)   { btn.style.color = this._pt('text'); }
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      });
    };

    // ── Ask ──
    const askBtn   = content.querySelector('#ask-btn');
    const askPanel = content.querySelector('#ask-panel');
    if (askBtn && askPanel) {
      let askOpen = false;
      askBtn.addEventListener('click', () => {
        askOpen = !askOpen;
        if (askOpen) _closeAll('#ask-btn');
        askBtn.style.color = askOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!askOpen) { askPanel.style.display = 'none'; askPanel.innerHTML = ''; return; }
        askPanel.style.display = 'block';
        askPanel.innerHTML = `
          ${this._aiAskHtml('ask-input', 'ask-send', 'ask-answer', 'Is this suitable for kids? Best watch order?…')}`;
        const input    = askPanel.querySelector('#ask-input');
        const sendBtn  = askPanel.querySelector('#ask-send');
        const answerEl = askPanel.querySelector('#ask-answer');
        const _doAsk = async () => {
          const q = input?.value?.trim();
          if (!q) return;
          answerEl.innerHTML = this._aiLoading('Thinking\u2026');
          const hasAI = await this._aiCheckAvailable();
          if (!hasAI) { this._aiShowFail(answerEl, null, 'agent'); return; }
          const typeLabel = data.type === 'tv' ? 'TV series' : 'movie';
          const result = await this._aiConverseF('ask', `About the ${typeLabel} "${data.title}"${data.year ? ' (' + data.year + ')' : ''}: ${q}\n\nAnswer in 2-4 plain sentences.`, { noCache: true });
          if (answerEl && askPanel.isConnected) { if (result) answerEl.innerHTML = this._aiRich(result); else this._aiShowFail(answerEl, _doAsk); }
        };
        sendBtn?.addEventListener('click', _doAsk);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doAsk(); });
        setTimeout(() => input?.focus(), 50);
      });
    }

    // ── Mood Match ──
    const moodBtn   = content.querySelector('#mood-btn');
    const moodPanel = content.querySelector('#mood-panel');
    if (moodBtn && moodPanel) {
      const MOODS = ['Dark & Gritty','Light & Fun','Mind-Bending','Action-Packed','Emotional','Slow Burn','Scary','Feel-Good'];
      let moodOpen = false;
      moodBtn.addEventListener('click', () => {
        moodOpen = !moodOpen;
        if (moodOpen) _closeAll('#mood-btn');
        moodBtn.style.color = moodOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!moodOpen) { moodPanel.style.display = 'none'; moodPanel.innerHTML = ''; return; }
        moodPanel.style.display = 'block';
        // no box or pills: a small heading, the moods as plain words with dots between them, the picks as a list
        moodPanel.innerHTML = `
          <div class="ip-sec">Mood Match \u00b7 pick a vibe</div>
          <div class="ip-tags" id="mood-chips" style="font-size:13px;line-height:1.9;">
            ${MOODS.map(m => `<button type="button" class="ip-tag" data-mood="${m}" style="color:${_text};">${m}</button>`).join('')}
          </div>
          <div id="mood-results" style="margin-top:8px;"></div>`;
        const resultsEl = moodPanel.querySelector('#mood-results');
        moodPanel.querySelectorAll('[data-mood]').forEach(chip => {
          chip.addEventListener('click', async () => {
            const mood = chip.dataset.mood;
            moodPanel.querySelectorAll('[data-mood]').forEach(c => {
              c.style.color      = c === chip ? 'var(--crow-info-link,#63b3ed)' : _text;
              c.style.fontWeight = c === chip ? '600' : '';
            });
            const cacheKey = ('mood|' + data.title + '|' + mood).toLowerCase();
            if (!this._aiMoodCache) this._aiMoodCache = new Map();
            let recs = this._aiMoodCache.get(cacheKey) || this._aiSessionGet('mood', cacheKey);
            if (!recs) {
              resultsEl.innerHTML = this._aiLoading('Finding ' + mood.toLowerCase() + ' picks\u2026');
              const hasAI = await this._aiCheckAvailable();
              if (!moodPanel.isConnected) return;
              if (!hasAI) { this._aiShowFail(resultsEl, null, 'agent'); return; }
              const typeLabel = data.type === 'tv' ? 'TV series' : 'movie';
              const raw = await this._aiConverseF('ask', `I just watched the ${typeLabel} "${data.title}"${data.year ? ' (' + data.year + ')' : ''}. I\'m in a "${mood}" mood. Suggest 4 ${data.type === 'tv' ? 'TV shows or movies' : 'movies or TV shows'} that match this vibe. Respond ONLY with a JSON array:\n[{"title":"Title","year":"YYYY","type":"tv or movie","reason":"10 word max reason"}]`);
              if (!raw) { this._aiShowFail(resultsEl, () => chip.click()); return; }
              try {
                const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
                recs = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
                this._aiMoodCache.set(cacheKey, recs);
                this._aiSessionSet('mood', cacheKey, recs);
              } catch(e) { this._aiShowFail(resultsEl, () => chip.click(), 'unreadable'); return; }
            }
            if (!moodPanel.isConnected) return;
            resultsEl.innerHTML = (recs||[]).map(r => `
              <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--crow-panel-divider,rgba(255,255,255,0.07));">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:${_text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.title||''}</div>
                  <div style="font-size:11px;color:${_dim};margin-top:1px;">${[r.year, r.type==='tv'?'TV Series':'Movie'].filter(Boolean).join(' · ')}</div>
                  ${r.reason ? `<div style="font-size:11px;color:var(--crow-info-link,#63b3ed);margin-top:2px;">${this._aiRich(r.reason)}</div>` : ''}
                </div>
              </div>`).join('');
          });
        });
      });
    }

    // ── Spot It: things to look out for while watching ──
    const spotBtn   = content.querySelector('#spot-btn');
    const spotPanel = content.querySelector('#spot-panel');
    if (spotBtn && spotPanel) {
      let spotOpen = false;
      spotBtn.addEventListener('click', () => {
        spotOpen = !spotOpen;
        if (spotOpen) _closeAll('#spot-btn');
        spotBtn.style.color = spotOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!spotOpen) { spotPanel.style.display = 'none'; spotPanel.innerHTML = ''; return; }
        spotPanel.style.display = 'block';
        const typeLabel = data.type === 'tv' ? 'TV series' : 'movie';
        this._aiSpotItFill(spotPanel, {
          cacheKey: ('spot|' + data.title + '|' + (data.year || '')).toLowerCase(),
          subject: `the ${typeLabel} "${data.title}"${data.year ? ' (' + data.year + ')' : ''}`,
          isOpen: () => spotOpen,
          retry: () => { spotOpen = false; spotBtn.click(); },
        });
      });
    }

    // ── Trivia ──
    const triviaBtn   = content.querySelector('#trivia-btn');
    const triviaPanel = content.querySelector('#trivia-panel');
    if (triviaBtn && triviaPanel) {
      let triviaOpen = false;
      triviaBtn.addEventListener('click', async () => {
        triviaOpen = !triviaOpen;
        if (triviaOpen) _closeAll('#trivia-btn');
        triviaBtn.style.color = triviaOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!triviaOpen) { triviaPanel.style.display = 'none'; triviaPanel.innerHTML = ''; return; }
        triviaPanel.style.display = 'block';
        const cacheKey = ('trivia|' + data.title + '|' + (data.year||'')).toLowerCase();
        if (!this._aiTriviaCache) this._aiTriviaCache = new Map();
        let questions = this._aiTriviaCache.get(cacheKey) || this._aiSessionGet('trivia', cacheKey);
        if (!questions) {
          triviaPanel.innerHTML = this._aiLoading('Generating trivia…');
          const hasAI = await this._aiCheckAvailable();
          if (!triviaPanel.isConnected) return;
          if (!hasAI) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'agent'); return; }
          const typeLabel = data.type === 'tv' ? 'TV series' : 'movie';
          const raw = await this._aiConverseF('ask', `Generate 5 fun trivia questions about the ${typeLabel} "${data.title}"${data.year ? ' (' + data.year + ')' : ''}. Respond ONLY with a JSON array:\n[{"q":"Question?","a":"Answer"}]`);
          if (!triviaPanel.isConnected) return;
          if (!raw) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }); return; }
          try {
            const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
            questions = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
            this._aiTriviaCache.set(cacheKey, questions);
            this._aiSessionSet('trivia', cacheKey, questions);
          } catch(e) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'unreadable'); return; }
        }
        if (!triviaPanel.isConnected) return;
        this._aiTriviaList(triviaPanel, questions);
      });
    }
  },

  // TVmaze (free, no key) — fallback source for season/episode lists when
  // the AI is off or doesn't know the show. One request returns the show
  // plus every episode; cached in memory for the session. Text fields come
  // back plain and HTML-escaped so they can drop straight into the views.
  // Best guess at whether a show is still airing, from what's already cached:
  // TVmaze's own "Running" status, or any episode (TVmaze or the AI's list for
  // the latest season) that aired in the last 60 days or hasn't aired yet.
  // Used to give airing shows short cache lifetimes.
  _tvShowIsAiring(showTitle, latestSeason) {
    const key = String(showTitle || '').toLowerCase().trim();
    if (!key) return false;
    if (this._tvmazeRunning?.has(key)) return true;
    const recent = d => { const t = Date.parse(d || ''); return !isNaN(t) && t > Date.now() - 60 * 864e5; };
    const tm = this._tvmazeCachedSync(showTitle);
    if (tm && tm.some(e => recent(e.airdate))) return true;
    if (latestSeason) {
      const ai = this._aiCachedRead(this._tvEpisodesCache || (this._tvEpisodesCache = new Map()), 'tvEpisodes', `${key}|s${latestSeason}|v2`);
      if (Array.isArray(ai) && ai.some(e => recent(e?.airdate))) return true;
    }
    return false;
  },

  // Synchronous cache check (memory, then localStorage) — lets views render
  // straight away without flashing a spinner when the data's already here.
  // Saved for 2 days while a show is still running (so new episodes and
  // seasons turn up quickly) and 7 days once it's ended; capped at 25 shows
  // and cleared from the editor's TV Episode Cache row.
  _tvmazeCachedSync(showTitle) {
    if (!showTitle) return undefined;
    if (!this._tvmazeCache) this._tvmazeCache = new Map();
    const key = showTitle.toLowerCase().trim();
    if (this._tvmazeCache.has(key)) return this._tvmazeCache.get(key);
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_tvmaze_cache') || '{}');
      const hit = store[key];
      const ttlDays = hit?.running ? 2 : 7;
      if (hit && Date.now() - (hit.ts || 0) < ttlDays * 864e5 && Array.isArray(hit.list)) {
        this._tvmazeCache.set(key, hit.list);
        if (hit.running) (this._tvmazeRunning || (this._tvmazeRunning = new Set())).add(key);
        return hit.list;
      }
    } catch (_) {}
    return undefined;
  },

  _tvmazeSave(key, list, running = false) {
    try {
      const store = JSON.parse(localStorage.getItem('crow_media_tvmaze_cache') || '{}');
      store[key] = { ts: Date.now(), list, running: !!running };
      const keys = Object.keys(store).sort((a, b) => (store[b].ts || 0) - (store[a].ts || 0));
      keys.slice(25).forEach(k => delete store[k]);
      localStorage.setItem('crow_media_tvmaze_cache', JSON.stringify(store));
    } catch (_) { /* storage full — memory copy still works for this session */ }
  },

  async _tvmazeEpisodes(showTitle) {
    if (!showTitle) return null;
    if (!this._tvmazeCache) this._tvmazeCache = new Map();
    const key = showTitle.toLowerCase().trim();
    const _cached = this._tvmazeCachedSync(showTitle);
    if (_cached !== undefined) return _cached;
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const plain = html => {
      const d = document.createElement('div');
      d.innerHTML = String(html || '');
      return (d.textContent || '').trim();
    };
    let list = null, running = false;
    try {
      const resp = await crowFetch('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(showTitle) + '&embed=episodes');
      if (resp.ok) {
        const show = await resp.json();
        running = show?.status === 'Running' || show?.status === 'In Development';
        const eps = show?._embedded?.episodes || [];
        list = eps
          .filter(e => e && e.season > 0 && e.number != null)
          .map(e => ({
            season:   e.season,
            ep:       e.number,
            title:    esc(e.name || ('Episode ' + e.number)),
            airdate:  e.airdate || '',
            overview: esc(plain(e.summary)),
          }));
        if (!list.length) list = null;
      }
    } catch (_) { list = null; }
    this._tvmazeCache.set(key, list);
    if (list) {
      this._tvmazeSave(key, list, running);
      if (running) (this._tvmazeRunning || (this._tvmazeRunning = new Set())).add(key);
    }
    return list;
  },

  // ── TV Seasons list ──────────────────────────────────────────────────────────
  async _showTvSeasons(content, data, artUrl) {
    const savedHtml = content.innerHTML;
    const savedScroll = content.scrollTop;
    const showTitle = data.title || '';
    // The show's info (cached up to 30 days) can be behind when a new season
    // starts — so if TVmaze already knows about more seasons, list those too.
    const _tmSeasons = (this._tvmazeCachedSync(showTitle) || []).reduce((m, e) => Math.max(m, e.season || 0), 0);
    const totalSeasons = Math.max(data.seasons || 0, _tmSeasons);
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // Build season rows immediately — episode counts fetched async below
    const seasonRows = Array.from({ length: totalSeasons }, (_, i) => i + 1).map(n => `
      <div class="tv-season-row" data-season="${n}" style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:${this._pt("bg")};border:1px solid ${this._pt("div")};border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div style="width:36px;height:36px;border-radius:8px;background:rgba(99,179,237,0.12);border:1px solid rgba(99,179,237,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-size:13px;font-weight:700;color:#63b3ed;">${n}</span>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:${this._pt("text")};">Season ${n}</div>
          <div id="tv-ep-count-${n}" style="font-size:11px;color:${this._pt("dim")};margin-top:1px;">Loading…</div>
        </div>
        
      </div>`).join('');

    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <button id="tv-seasons-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
        </button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${showTitle}</div>
          <div style="font-size:11px;color:${this._pt("dim")};">${totalSeasons} Season${totalSeasons !== 1 ? 's' : ''}</div>
        </div>
        ${totalSeasons ? `<button id="tv-seasons-pdf" data-pdf="info" aria-label="Export episode guide to PDF" title="Export episode guide to PDF" style="height:28px;padding:0 11px;border-radius:14px;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;gap:5px;flex-shrink:0;color:${this._pt("text")};font-size:11px;font-weight:600;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z"/></svg>Export
        </button>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${seasonRows}</div>`;

    content.querySelector('#tv-seasons-back').addEventListener('click', () => {
      this._renderVideoInfoDetail(content, data, artUrl);
    });
    content.querySelector('#tv-seasons-pdf')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._exportEpisodeGuidePDF(data, artUrl);
    });

    const self = this;
    content.querySelectorAll('.tv-season-row').forEach(row => {
      row.addEventListener('click', () => {
        // Park the seasons list so Back from the episodes restores it
        // instantly at the same scroll position.
        const _parked = document.createDocumentFragment();
        const _scroll = content.scrollTop;
        while (content.firstChild) _parked.appendChild(content.firstChild);
        self._showTvEpisodes(content, data, parseInt(row.dataset.season, 10), artUrl, () => {
          content.innerHTML = '';
          content.appendChild(_parked);
          content.scrollTop = _scroll;
        });
      });
    });
    // Hold the count labels directly — they stay valid while the list is
    // parked, so a count that arrives then is still filled in.
    const _countEls = {};
    for (let n = 1; n <= totalSeasons; n++) _countEls[n] = content.querySelector(`#tv-ep-count-${n}`);

    // Ask AI for episode counts per season in one call
    if (!this._tvEpCountCache) this._tvEpCountCache = new Map();
    const cacheKey = showTitle.toLowerCase();
    let counts = this._tvEpCountCache.get(cacheKey);
    if (!counts) {
      const _lsCounts = this._aiLocalGet('tvEpCount', cacheKey);
      if (_lsCounts) { this._tvEpCountCache.set(cacheKey, _lsCounts); counts = _lsCounts; }
    }
    // Saved TVmaze list for this show? Count from that rather than asking
    // the AI again.
    if (!counts) {
      const _tmc = this._tvmazeCachedSync(showTitle);
      if (_tmc) {
        counts = {};
        _tmc.forEach(e => { counts[String(e.season)] = (counts[String(e.season)] || 0) + 1; });
        this._tvEpCountCache.set(cacheKey, counts);
      }
    }
    if (!counts) {
      try {
        const prompt = `For the TV series "${showTitle}" (${totalSeasons} seasons), list the episode count for each season. Reply ONLY with a JSON object like {"1":13,"2":13,"3":16} — season number as string key, episode count as integer value. No markdown.`;
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
          type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) counts = JSON.parse(raw.slice(start, end + 1));
        if (counts) {
          this._tvEpCountCache.set(cacheKey, counts);
          this._aiSessionSet('tvEpCount', cacheKey, counts);
          // Still airing → recount after 2 days; finished → keep for 30
          this._aiLocalSet('tvEpCount', cacheKey, counts, { ttlDays: this._tvShowIsAiring(showTitle, totalSeasons) ? 2 : 30 });
        }
      } catch(e) {}
      // AI off or empty — count them from TVmaze instead
      if (!counts) {
        const _tm = await this._tvmazeEpisodes(showTitle);
        if (_tm) {
          counts = {};
          _tm.forEach(e => { counts[String(e.season)] = (counts[String(e.season)] || 0) + 1; });
          this._tvEpCountCache.set(cacheKey, counts);
        }
      }
    }
    // Any season the counts don't cover (typically a new one) — use TVmaze's
    // count if we have it.
    const _tmNow = this._tvmazeCachedSync(showTitle);
    if (_tmNow) {
      const _tmCounts = {};
      _tmNow.forEach(e => { _tmCounts[String(e.season)] = (_tmCounts[String(e.season)] || 0) + 1; });
      counts = counts ? { ...counts } : {};
      for (let n = 1; n <= totalSeasons; n++) {
        if (!counts[String(n)] && _tmCounts[String(n)]) counts[String(n)] = _tmCounts[String(n)];
      }
    }
    // Populate episode counts into the rows (if still on this panel)
    if (counts) {
      for (let n = 1; n <= totalSeasons; n++) {
        const el = _countEls[n];
        if (!el) break; // panel was navigated away
        const c = counts[String(n)];
        el.textContent = c ? `${c} episode${c !== 1 ? 's' : ''}` : 'Episodes';
      }
    } else {
      for (let n = 1; n <= totalSeasons; n++) {
        const el = _countEls[n];
        if (!el) break;
        el.textContent = 'Episodes';
      }
    }

    // Not checked TVmaze for this show yet? Do it quietly in the background —
    // if it turns up a season this list doesn't have, rebuild the list (only
    // while it's still on screen). The rebuild reads the now-cached TVmaze
    // data, so this runs at most once per show.
    if (this._tvmazeCachedSync(showTitle) === undefined) {
      const _firstRow = content.querySelector('.tv-season-row');
      this._tvmazeEpisodes(showTitle).then(tm => {
        const most = (tm || []).reduce((m, e) => Math.max(m, e.season || 0), 0);
        if (most > totalSeasons && _firstRow?.isConnected && content.contains(_firstRow)) {
          const _scroll = content.scrollTop;
          this._showTvSeasons(content, data, artUrl).then(() => { content.scrollTop = _scroll; });
        }
      }).catch(() => {});
    }
  },

  // ── TV Episodes list ─────────────────────────────────────────────────────────
  async _showTvEpisodes(content, data, seasonNum, artUrl, onBack = null) {
    const savedHtml = content.innerHTML;
    const savedScroll = content.scrollTop;
    const showTitle = data.title || '';
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    const self = this;
    // Back to the seasons list — restores the parked view if we came from
    // it, otherwise rebuilds it.
    const _goBack = () => {
      if (typeof onBack === 'function') onBack();
      else self._showTvSeasons(content, data, artUrl);
    };

    // Fetch episodes from AI
    if (!this._tvEpisodesCache) this._tvEpisodesCache = new Map();
    const cacheKey = `${showTitle.toLowerCase()}|s${seasonNum}|v2`; // v2 = includes tease field
    // A season newer than the show's info knows about — TVmaze is the
    // reliable source for that, so try it before the AI.
    let episodes;
    if (seasonNum > (data.seasons || 0)) {
      const _tmNew = (await this._tvmazeEpisodes(showTitle)) || [];
      const _season = _tmNew.filter(e => e.season === Number(seasonNum));
      if (_season.length) episodes = _season.map(({ ep, title, airdate, overview }) => ({ ep, title, airdate, overview }));
    }
    if (!episodes?.length) episodes = this._aiCachedRead(this._tvEpisodesCache, 'tvEpisodes', cacheKey);
    // Already have TVmaze's list for this show? Use it rather than asking the
    // AI again (which is what made the list reload every time).
    if (!episodes?.length) {
      const _tmc = this._tvmazeCachedSync(showTitle);
      const _season = (_tmc || []).filter(e => e.season === Number(seasonNum));
      if (_season.length) episodes = _season.map(({ ep, title, airdate, overview }) => ({ ep, title, airdate, overview }));
    }
    if (!episodes?.length) {
      // Only show the loading state when there's genuinely something to fetch
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <button id="tv-eps-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
          </button>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:700;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${showTitle}</div>
            <div style="font-size:11px;color:${this._pt("dim")};">Season ${seasonNum}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;min-height:calc(100% - 60px);box-sizing:border-box;">
          <div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
          <div style="font-size:12px;color:${this._pt("dim")};">Loading episodes…</div>
        </div>`;
  
      content.querySelector('#tv-eps-back')?.addEventListener('click', _goBack);

      try {
        const prompt = `List all episodes of Season ${seasonNum} of "${showTitle}". Reply ONLY with a JSON array — no markdown:\n[{"ep":1,"title":"Episode Title","airdate":"YYYY-MM-DD","tease":"Under 10 words, spoiler-free teaser"}]\nKeep teases intriguing but spoiler-free — no plot reveals.`;
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
          type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        const start = raw.indexOf('['), end = raw.lastIndexOf(']');
        if (start !== -1 && end > start) episodes = JSON.parse(raw.slice(start, end + 1));
        if (episodes?.length) {
          // A season that's still airing (an episode in the last 60 days or yet to
          // air) is refreshed after 2 days; a finished season keeps for 30.
          const _now = Date.now();
          const _airing = episodes.some(e => {
            const t = Date.parse(e?.airdate || '');
            return !isNaN(t) && t > _now - 60 * 864e5;
          });
          this._aiCachedWrite(this._tvEpisodesCache, 'tvEpisodes', cacheKey, episodes, { ttlDays: _airing ? 2 : 30, max: 150 });
        }
      } catch(e) {}
      // AI off or empty — use TVmaze's episode list for this season. These
      // carry the real episode summary, which the episode view shows.
      if (!episodes?.length) {
        const _tm = await this._tvmazeEpisodes(showTitle);
        const _season = (_tm || []).filter(e => e.season === Number(seasonNum));
        if (_season.length) episodes = _season.map(({ ep, title, airdate, overview }) => ({ ep, title, airdate, overview }));
      }
    }

    if (!episodes?.length) {
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <button id="tv-eps-back2" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
          </button>
          <div style="font-size:15px;font-weight:700;color:${this._pt("text")};">${showTitle} — Season ${seasonNum}</div>
        </div>
        <div style="padding:24px;text-align:center;font-size:13px;color:${this._pt("dim")};">Couldn't load episodes — try again.</div>`;
      content.querySelector('#tv-eps-back2').addEventListener('click', _goBack);
      return;
    }


    const epRows = episodes.map(ep => `
      <div class="tv-ep-row" data-ep="${ep.ep}" style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;background:${this._pt("bg")};border:1px solid ${this._pt("div")};border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div style="width:28px;text-align:center;flex-shrink:0;padding-top:1px;">
          <span style="font-size:12px;font-weight:700;color:rgba(99,179,237,0.7);">${ep.ep}</span>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ep.title || 'Episode ' + ep.ep}</div>
          ${ep.tease ? '<div style="font-size:11px;color:' + this._pt('dim') + ';margin-top:2px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + ep.tease + '</div>' : ep.airdate ? '<div style="font-size:11px;color:' + this._pt('dim') + ';margin-top:1px;">' + self._formatAirdate(ep.airdate) + '</div>' : ''}
        </div>
        
      </div>`).join('');

    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <button id="tv-eps-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
        </button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:${this._pt("text")};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${showTitle}</div>
          <div style="font-size:11px;color:${this._pt("dim")};">Season ${seasonNum} · ${episodes.length} episode${episodes.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${epRows}</div>`;

    content.querySelector('#tv-eps-back').addEventListener('click', _goBack);

    content.querySelectorAll('.tv-ep-row').forEach(row => {
      row.addEventListener('click', () => {
        const epIdx = parseInt(row.dataset.ep, 10) - 1;
        const ep = episodes[epIdx] || episodes.find(e => e.ep === parseInt(row.dataset.ep, 10));
        if (!ep) return;
        // Park this list (the real nodes, handlers and all) so Back from the
        // episode puts it straight back at the same scroll position — no
        // rebuild, no spinner.
        const _parked = document.createDocumentFragment();
        const _scroll = content.scrollTop;
        while (content.firstChild) _parked.appendChild(content.firstChild);
        self._showTvEpisodeDetail(content, ep, data, seasonNum, artUrl, () => {
          content.innerHTML = '';
          content.appendChild(_parked);
          content.scrollTop = _scroll;
        });
      });
    });
  },

  // ── TV Episode detail ────────────────────────────────────────────────────────
  async _showTvEpisodeDetail(content, ep, showData, seasonNum, artUrl, onBack = null) {
    const showTitle = showData.title || '';
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
    const aiOn   = this._aiFeatureOn('info');      // AI episode details
    const askOn  = this._aiFeatureOn('ask');       // Ask / Trivia
    const discOn = this._aiFeatureOn('discover');  // Soundtrack
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const _render = (detail) => {
      const overview = detail?.overview || ep.overview || '';
      const overviewHtml = overview
        ? `<div style="font-size:13px;color:${this._pt("text")};line-height:1.6;margin-top:12px;">${overview}</div>`
        : '';
      // Writer / director as tappable pills (same style as the artist and
      // album pills in the music info panel). Several names split into
      // separate pills; someone who both wrote and directed gets one pill.
      const _names = v => String(v || '').split(/\s*(?:,|&|\band\b)\s*/i).map(x => x.trim()).filter(Boolean).slice(0, 3);
      const _writers = _names(detail?.writer), _directors = _names(detail?.director);
      const _penIcon  = 'M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z';
      const _clapIcon = 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z';
      const _pill = (cls, name, icon, tip, prefix = '') =>
        `<div class="${cls} ip-link" data-name="${esc(name)}" title="${esc(tip)}" role="button"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg><span>${prefix}${esc(name)}</span></div>`;
      const _creditPills = [
        ..._writers.map(n => _directors.some(x => x.toLowerCase() === n.toLowerCase())
          ? _pill('ep-writer-link', n, _clapIcon, 'Written and directed by ' + n)
          : _pill('ep-writer-link', n, _penIcon, 'Written by ' + n)),
        ..._directors.filter(n => !_writers.some(x => x.toLowerCase() === n.toLowerCase()))
          .map(n => _pill('ep-director-link', n, _clapIcon, 'Directed by ' + n, 'Dir. ')),
      ];
      const creditsHtml = _creditPills.length
        ? `<div class="ip-links" style="margin-top:7px;">${_creditPills.join('')}</div>`
        : '';

      // Hero — same layout as Watch History's title drill-in: artwork box,
      // a small coloured label, the title, then a dim stats line.
      const stats = [
        showTitle,
        ep.airdate ? this._formatAirdate(ep.airdate) : '',
        detail?.rating ? '\u2605 ' + detail.rating + '/10' : '',
      ].filter(Boolean);
      const fallbackIcon = `<svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:${this._pt('iconDim')}"><path d="M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z"/></svg>`;
      const heroHtml = `
        <div style="display:flex;gap:14px;align-items:center;padding:2px 0 12px;">
          <div style="width:84px;height:84px;border-radius:12px;overflow:hidden;flex-shrink:0;background:${this._pt('btnBg')};display:flex;align-items:center;justify-content:center;">
            ${artUrl ? `<img src="${esc(artUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.remove()">` : fallbackIcon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#A78BFA;margin-bottom:4px;">Season ${seasonNum} \u00b7 Episode ${ep.ep}</div>
            <div style="font-size:16px;font-weight:700;color:${this._pt('text')};line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(ep.title || 'Episode ' + ep.ep)}</div>
            <div style="font-size:12px;color:${this._pt('dim')};margin-top:4px;line-height:1.45;">${stats.map(esc).join(' \u00b7 ')}</div>
            ${creditsHtml}
          </div>
        </div>`;

      // Action bar — Ask / Trivia / Soundtrack are all AI, so the whole bar
      // is left out when AI features are off.
      const _btn = (id, label, path) =>
        `<button class="ma-drill-action-btn" id="${id}"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="${path}"/></svg></div><span class="ma-drill-btn-label">${label}</span></button>`;
      const actionsHtml = (askOn || discOn) ? `
        <div class="ma-drill-actions" style="margin:0 -4px 4px;">
          ${askOn ? _btn('ep-ask-btn', 'Ask', 'M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6V9M14,14H6V12H14V14M18,8H6V6H18V8Z') : ''}
          ${askOn ? _btn('ep-trivia-btn', 'Trivia', 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z') : ''}
          ${askOn ? _btn('ep-spot-btn', 'Spot It', 'M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z') : ''}
          ${discOn ? _btn('ep-soundtrack-btn', 'Soundtrack', 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z') : ''}
        </div>
        <div id="ep-ask-panel" style="display:none;margin:10px 0 4px;"></div>
        <div id="ep-trivia-panel" style="display:none;margin:10px 0 4px;"></div>
        <div id="ep-spot-panel" style="display:none;margin:10px 0 4px;"></div>` : '';

      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <button id="tv-ep-detail-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
          </button>
          <div style="font-size:12px;font-weight:600;color:${this._pt("dim")};">Season ${seasonNum}</div>
        </div>
        ${heroHtml}
        ${actionsHtml}
        ${overviewHtml}
        <div style="height:8px;"></div>`;

      const self = this;
      content.querySelector('#tv-ep-detail-back').addEventListener('click', () => {
        if (typeof onBack === 'function') onBack();
        else self._showTvEpisodes(content, showData, seasonNum, artUrl);
      });
      content.querySelectorAll('.ep-director-link, .ep-writer-link').forEach(el => {
        el.addEventListener('click', () => { self._showCastBio(content, el.dataset.name, showTitle, artUrl); });
      });
      if (askOn) self._wireEpisodeActionRow(content, ep, showTitle, seasonNum);
      if (discOn) {
        content.querySelector('#ep-soundtrack-btn')?.addEventListener('click', () => {
          self._showAISearchPanel(`Music from ${showTitle}`);
        });
      }
    };

    // Richer detail comes from the AI (cached ones render straight away).
    // With AI off there's nothing to fetch — render what the episode list gave us.
    if (!this._tvEpDetailCache) this._tvEpDetailCache = new Map();
    const cacheKey = `${showTitle.toLowerCase()}|s${seasonNum}e${ep.ep}`;
    let detail = aiOn ? this._aiCachedRead(this._tvEpDetailCache, 'tvEpDetail', cacheKey) : null;
    // Token so a slow lookup can't paint over a view the user has already
    // navigated to (back to the episode list, another episode, etc.).
    const _token = this._epDetailToken = {};
    if (aiOn && !detail) {
      // Centred spinner, same as every other info view while it loads
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div></div>`;
      try {
        const prompt = `Give details for S${seasonNum}E${ep.ep} "${ep.title || ''}" of the TV series "${showTitle}". Reply ONLY with JSON — no markdown: {"overview":"2-3 sentence synopsis","director":"Name","writer":"Name","rating":"8.1"}`;
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
          type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) detail = JSON.parse(raw.slice(start, end + 1));
        if (detail) this._aiCachedWrite(this._tvEpDetailCache, 'tvEpDetail', cacheKey, detail, { ttlDays: 30, max: 400 });
      } catch(e) {}
      if (this._epDetailToken !== _token || !content.isConnected) return;
    }
    _render(detail);
  },

  // ── Episode Detail Action Row (Ask / Trivia) ─────────────────────────────────
  _wireEpisodeActionRow(content, ep, showTitle, seasonNum) {
    const PANELS = [
      { btnId: '#ep-ask-btn',    panelId: '#ep-ask-panel' },
      { btnId: '#ep-trivia-btn', panelId: '#ep-trivia-panel' },
      { btnId: '#ep-spot-btn',   panelId: '#ep-spot-panel' },
    ];
    const _dim    = this._pt('dim');
    const _text   = this._pt('text');
    const _bg     = this._pt('btnBg');
    const _border = this._pt('border');
    const epLabel = `S${seasonNum}E${ep.ep} "${ep.title || 'Episode ' + ep.ep}"`;

    // Highlights the action-bar circle (and its label) while its panel is open
    const _setActive = (btn, on) => {
      const circle = btn.querySelector('.ma-drill-btn-circle') || btn;
      const label  = btn.querySelector('.ma-drill-btn-label');
      circle.style.background  = on ? 'rgba(99,179,237,0.15)' : '';
      circle.style.borderColor = on ? 'rgba(99,179,237,0.4)'  : '';
      const svg = circle.querySelector('svg');
      if (svg) svg.style.fill = on ? '#63b3ed' : '';
      if (label) label.style.color = on ? '#63b3ed' : '';
    };
    const _closeAll = (exceptBtnId) => {
      PANELS.forEach(p => {
        if (p.btnId === exceptBtnId) return;
        const btn   = content.querySelector(p.btnId);
        const panel = content.querySelector(p.panelId);
        if (btn)   _setActive(btn, false);
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      });
    };

    // ── Ask ──
    const askBtn   = content.querySelector('#ep-ask-btn');
    const askPanel = content.querySelector('#ep-ask-panel');
    if (askBtn && askPanel) {
      let askOpen = false;
      askBtn.addEventListener('click', () => {
        askOpen = !askOpen;
        if (askOpen) _closeAll('#ep-ask-btn');
        _setActive(askBtn, askOpen);
        if (!askOpen) { askPanel.style.display = 'none'; askPanel.innerHTML = ''; return; }
        askPanel.style.display = 'block';
        askPanel.innerHTML = `
          ${this._aiAskHtml('ep-ask-input', 'ep-ask-send', 'ep-ask-answer', 'Who plays the villain? Is this a filler episode?…')}`;
        const input    = askPanel.querySelector('#ep-ask-input');
        const sendBtn  = askPanel.querySelector('#ep-ask-send');
        const answerEl = askPanel.querySelector('#ep-ask-answer');
        const _doAsk = async () => {
          const q = input?.value?.trim();
          if (!q) return;
          answerEl.innerHTML = this._aiLoading('Thinking\u2026');
          const hasAI = await this._aiCheckAvailable();
          if (!hasAI) { this._aiShowFail(answerEl, null, 'agent'); return; }
          const result = await this._aiConverseF('ask', `About ${epLabel} of "${showTitle}": ${q}\n\nAnswer in 2-4 plain sentences.`, { noCache: true });
          if (answerEl && askPanel.isConnected) { if (result) answerEl.innerHTML = this._aiRich(result); else this._aiShowFail(answerEl, _doAsk); }
        };
        sendBtn?.addEventListener('click', _doAsk);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doAsk(); });
        setTimeout(() => input?.focus(), 50);
      });
    }

    // ── Spot It: things to look out for in this episode ──
    const spotBtn   = content.querySelector('#ep-spot-btn');
    const spotPanel = content.querySelector('#ep-spot-panel');
    if (spotBtn && spotPanel) {
      let spotOpen = false;
      spotBtn.addEventListener('click', () => {
        spotOpen = !spotOpen;
        if (spotOpen) _closeAll('#ep-spot-btn');
        _setActive(spotBtn, spotOpen);
        if (!spotOpen) { spotPanel.style.display = 'none'; spotPanel.innerHTML = ''; return; }
        spotPanel.style.display = 'block';
        this._aiSpotItFill(spotPanel, {
          cacheKey: ('epspot|' + showTitle + '|s' + seasonNum + 'e' + ep.ep).toLowerCase(),
          subject: `${epLabel} of the TV series "${showTitle}"`,
          isOpen: () => spotOpen,
          retry: () => { spotOpen = false; spotBtn.click(); },
        });
      });
    }

    // ── Trivia ──
    const triviaBtn   = content.querySelector('#ep-trivia-btn');
    const triviaPanel = content.querySelector('#ep-trivia-panel');
    if (triviaBtn && triviaPanel) {
      let triviaOpen = false;
      triviaBtn.addEventListener('click', async () => {
        triviaOpen = !triviaOpen;
        if (triviaOpen) _closeAll('#ep-trivia-btn');
        _setActive(triviaBtn, triviaOpen);
        if (!triviaOpen) { triviaPanel.style.display = 'none'; triviaPanel.innerHTML = ''; return; }
        triviaPanel.style.display = 'block';
        const cacheKey = ('eptrivia|' + showTitle + '|s' + seasonNum + 'e' + ep.ep).toLowerCase();
        if (!this._aiEpTriviaCache) this._aiEpTriviaCache = new Map();
        let questions = this._aiCachedRead(this._aiEpTriviaCache, 'epTrivia', cacheKey);
        if (!questions) {
          triviaPanel.innerHTML = this._aiLoading('Generating trivia…');
          const hasAI = await this._aiCheckAvailable();
          if (!triviaPanel.isConnected) return;
          if (!hasAI) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'agent'); return; }
          const raw = await this._aiConverseF('ask', `Generate 5 fun trivia questions about ${epLabel} of "${showTitle}" — mix plot details, behind-the-scenes facts, and cast/crew. Respond ONLY with a JSON array:\n[{"q":"Question?","a":"Answer"}]`);
          if (!triviaPanel.isConnected) return;
          if (!raw) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }); return; }
          try {
            const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
            questions = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
            this._aiCachedWrite(this._aiEpTriviaCache, 'epTrivia', cacheKey, questions, { ttlDays: 30, max: 200 });
          } catch(e) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'unreadable'); return; }
        }
        if (!triviaPanel.isConnected) return;
        this._aiTriviaList(triviaPanel, questions);
      });
    }
  },

  // Wire genre tag pills (.bio-genre-tag[data-tag]) to show an AI description sheet
  // Wikipedia fallback for a genre pill's description. Tries "<tag> music"
  // style titles first so "Pop" doesn't land on the soft-drink article, and
  // only accepts a summary that actually talks about music.
  async _fetchWikipediaGenreSummary(tag) {
    if (!tag) return null;
    if (this._wikiRateLimitUntil && Date.now() < this._wikiRateLimitUntil) return null;
    const t = String(tag).trim();
    const cap = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    const titles = [...new Set([cap + ' music', t + ' (music)', t + ' (genre)', cap])];
    const musicy = /\b(music|genre|style|rock|pop|jazz|song|sound|band|musician|instrument|beat|rhythm|melod|vocal|dance|hip hop|rap)\b/i;
    for (const title of titles) {
      try {
        const resp = await crowFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')),
          { headers: { Accept: 'application/json' } });
        if (resp.status === 429) { this._wikiRateLimitUntil = Date.now() + 30000; return null; }
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data?.type === 'disambiguation' || !data?.extract) continue;
        if (!musicy.test((data.description || '') + ' ' + data.extract.slice(0, 300))) continue;
        const sentences = data.extract.match(/[^.!?]+[.!?]+/g) || [data.extract];
        const text = sentences.slice(0, 2).join('').trim();
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      } catch (_) { /* try the next form */ }
    }
    return null;
  },

  _wireGenreTagClicks(content) {
    if (!this._rbTagCache) this._rbTagCache = new Map();
    content.querySelectorAll('.bio-genre-tag').forEach(pill => {
      pill.style.cursor = 'pointer';
      pill.style.webkitTapHighlightColor = 'transparent';
      pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tag = pill.dataset.tag;
        if (!tag) return;
        const _pt2 = (k) => this._pt(k);
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
        let desc = this._rbTagCache.get(tag);
        if (!desc) {
          const hasAI = this._aiFeatureOn('info') && await this._aiCheckAvailable();
          if (sheet.isConnected && hasAI) {
            const raw = await this._aiConverseF('info', 'In 1-2 sentences, describe the "' + tag + '" music genre or category. Be concise and factual.');
            if (raw) { desc = raw; this._rbTagCache.set(tag, desc); }
          }
          // AI off or empty — first two sentences of the genre's Wikipedia
          // summary instead.
          if (!desc && sheet.isConnected) {
            const wiki = await this._fetchWikipediaGenreSummary(tag);
            if (wiki) { desc = wiki; this._rbTagCache.set(tag, desc); }
          }
          if (!desc) desc = 'No description available.';
        }
        const bodyEl = sheet.querySelector('.crow-media-rb-tag-sheet-body');
        if (bodyEl && sheet.isConnected) bodyEl.innerHTML = desc;
      });
    });
  },

  // Show a bio panel for a cast member, with back button to return to the detail view
  // Lightweight bio prefetch — shares the exact cache key/storage with _showCastBio
  // so a pill can be hidden once we know a name has no substantive bio content.
  // Returns true (has content), false (confirmed empty), or null (couldn't check).
  async _prefetchCastBio(name, showTitle) {
    if (!name) return null;
    if (!this._castBioCache) this._castBioCache = new Map();
    const _bioCacheKey = ('bio|' + name).toLowerCase();
    const _cached = this._castBioCache.get(_bioCacheKey)
      || this._aiLocalGet('castBio', _bioCacheKey)
      || this._aiSessionGet('castBio', _bioCacheKey);
    if (_cached) {
      this._castBioCache.set(_bioCacheKey, _cached);
      return !!(_cached.bio || _cached.known_for?.length);
    }
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return null;
    try {
      const isMusicContext = this._detectMediaType(this._hass?.states[this._entity]) === 'music';
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const prompt = isMusicContext
        ? 'Give me a short biography of the musician "' + name + '" known for their work with "' + (showTitle || '') + '". Reply ONLY with JSON: {"known_for":[{"title":"Song or Album 1","year":"YYYY","type":"song"},{"title":"Song or Album 2","year":"YYYY","type":"album"},{"title":"Song or Album 3","year":"YYYY","type":"song"}],"born":"1970","nationality":"American","bio":"2 sentence overview"}'
        : 'Give me a short biography of the actor/actress "' + name + '" known for appearing in "' + (showTitle || '') + '". Reply ONLY with JSON: {"known_for":[{"title":"Work 1","year":"YYYY","type":"tv"},{"title":"Work 2","year":"YYYY","type":"movie"},{"title":"Work 3","year":"YYYY","type":"tv"}],"born":"1970","nationality":"American","bio":"2 sentence overview"}';
      const resp = await this._aiProcess({ _crowFeature: 'prefetch', _crowFallback: true,
        type: 'conversation/process', _crowSilent: true, text: prompt, agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
      if (start === -1 || end <= start) return false;
      const result = JSON.parse(raw.slice(start, end + 1));
      this._castBioCache.set(_bioCacheKey, result);
      this._aiSessionSet('castBio', _bioCacheKey, result);
      this._aiLocalSet('castBio', _bioCacheKey, result);
      return !!(result.bio || result.known_for?.length);
    } catch (e) { return null; }
  },

  // Short Wikipedia biography for a person/band — used by the bio panel when
  // the AI is off or doesn't know them. Tries the bare name, then the usual
  // Wikipedia disambiguations, and only accepts an article whose short
  // description reads like a person or act (so "Queen" doesn't land on the
  // monarch). In-memory cache only, so turning AI back on still gets the
  // richer AI bio next time.
  async _fetchWikipediaPersonSummary(name, isMusic) {
    if (!name) return null;
    if (!this._wikiPersonCache) this._wikiPersonCache = new Map();
    const _key = (isMusic ? 'm|' : 'v|') + name.toLowerCase();
    if (this._wikiPersonCache.has(_key)) return this._wikiPersonCache.get(_key);
    if (this._wikiRateLimitUntil && Date.now() < this._wikiRateLimitUntil) return null;
    const _personish = /\b(singer|songwriter|musician|band|group|duo|trio|rapper|composer|conductor|pianist|guitarist|drummer|bassist|vocalist|producer|dj|orchestra|ensemble|artist|actor|actress|comedian|director|filmmaker|screenwriter|writer|presenter|personality|performer|entertainer|model)\b/i;
    const titles = isMusic
      ? [name, name + ' (musician)', name + ' (band)', name + ' (singer)', name + ' (composer)']
      : [name, name + ' (actor)', name + ' (actress)'];
    for (const t of titles) {
      try {
        const resp = await crowFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')),
          { headers: { Accept: 'application/json' } });
        if (resp.status === 429) { this._wikiRateLimitUntil = Date.now() + 30000; return null; }
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data?.type === 'disambiguation' || !data?.extract) continue;
        if (!_personish.test(data.description || '') && !_personish.test(data.extract.slice(0, 200))) continue;
        const result = { bio: data.extract, _source: 'wikipedia', _url: data.content_urls?.desktop?.page || null };
        this._wikiPersonCache.set(_key, result);
        return result;
      } catch (_) { /* network hiccup — try the next form */ }
    }
    this._wikiPersonCache.set(_key, null);
    return null;
  },

  async _showCastBio(content, name, showTitle, artUrl, onBack) {
    const savedHtml = content.innerHTML;
    const savedScroll = content.scrollTop;
    const _escB = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Header: the panel we came from may say "Discogs Info", "TMDB Info"
    // etc. — that's about the track or title, not this person, so show a
    // plain label while the bio is open and put the original back on Back.
    const _bioTitleEl = this.shadowRoot?.getElementById('infoPopupTitle');
    const _savedHeader = _bioTitleEl?.textContent || '';
    // The header itself becomes the back button + the person's name; the
    // in-panel back row is hidden. The header button just presses that
    // hidden button, so every existing Back path (onBack callbacks, photo
    // clean-up) runs exactly as before.
    const _savedHeaderStyle = _bioTitleEl?.getAttribute('style') || '';
    if (_bioTitleEl) {
      _bioTitleEl.setAttribute('style', 'display:flex;align-items:center;gap:10px;min-width:0;flex:1;');
      _bioTitleEl.innerHTML =
        `<button id="infoHeaderBioBack" aria-label="Back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;-webkit-tap-highlight-color:transparent;">`
        + `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg></button>`
        + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${_escB(name)}</span>`;
      _bioTitleEl.querySelector('#infoHeaderBioBack')?.addEventListener('click', (e) => {
        e.stopPropagation();
        content.querySelector('#cast-bio-back')?.click();
      });
    }
    const _resetHeaderStyle = () => {
      if (!_bioTitleEl) return;
      if (_savedHeaderStyle) _bioTitleEl.setAttribute('style', _savedHeaderStyle); else _bioTitleEl.removeAttribute('style');
    };
    const _restoreHeader = () => {
      _resetHeaderStyle();
      if (_bioTitleEl && _savedHeader) _bioTitleEl.textContent = _savedHeader;
    };
    // Left the bio some other way (a Known For item, closing the panel…)?
    // Drop the header back button as soon as the bio is gone.
    const _bioObserver = new MutationObserver(() => {
      if (content.querySelector('#cast-bio-back')) return;
      _bioObserver.disconnect();
      const btn = _bioTitleEl?.querySelector('#infoHeaderBioBack');
      if (btn) { btn.remove(); _resetHeaderStyle(); }
    });
    _bioObserver.observe(content, { childList: true });
    const _hideBioBackRow = () => {
      const row = content.querySelector('#cast-bio-back')?.parentElement;
      if (row) row.style.display = 'none';
    };
    // Ask / Trivia are AI features — left out entirely when AI is off
    const aiOn  = this._aiFeatureOn('info');   // AI biography
    const askOn = this._aiFeatureOn('ask');    // Ask / Trivia buttons
    this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // Show bio immediately with placeholder photo, then load async
    const renderBio = (imgUrl, isLoading) => {
      const photoHtml = imgUrl
        ? `<img id="cast-bio-photo-img" src="${imgUrl}" alt="${name}" style="width:80px;height:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,0.1);" onerror="this.style.display='none';this.parentNode.innerHTML='<div style=\\'width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;\\'><svg viewBox=\\'0 0 24 24\\' style=\\'width:36px;height:36px;fill:rgba(255,255,255,0.2)\\'><path d=\\'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z\\'/></svg></div>'">`
        : `<div style="width:80px;height:80px;border-radius:50%;background:${this._pt("bg")};border:2px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:36px;height:36px;fill:${this._pt("dim")}"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg></div>`;

      const metaLine = [bio?.born ? 'b. ' + bio.born : null, bio?.nationality].filter(Boolean).join(' · ');

      if (isLoading) {
        // Loading: keep the back row so the user can leave, and fill the rest
        // with the same centred ring + caption used by every other info view.
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <button id="cast-bio-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
            </button>
            <div style="font-size:15px;font-weight:700;color:${this._pt("text")}">${name}</div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;">
            <div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
            <div style="font-size:12px;color:${this._pt("dim")};">Looking up ${_escB(name)}…</div>
          </div>
        </div>`;
        _hideBioBackRow();
        content.querySelector('#cast-bio-back')?.addEventListener('click', () => {
          this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          _restoreHeader();
          if (typeof onBack === 'function') { onBack(); return; }
          content.innerHTML = savedHtml;
          content.scrollTop = savedScroll;
          this._rewireCastClicks(content, showTitle, artUrl);
        });
        return;
      }

      const bioBodyHtml = bio?.bio
        ? `<div style="font-size:13px;color:${this._pt("text")};line-height:1.5;">${bio._source === 'wikipedia' ? _escB(bio.bio) : this._aiEm(bio.bio)}</div>`
          + (bio._source === 'wikipedia' ? `<div style="font-size:10px;color:${this._pt("dim")};margin-top:6px;letter-spacing:0.3px;">From Wikipedia</div>` : '')
        : `<div style="font-size:12px;color:${this._pt("dim")};line-height:1.5;padding-top:8px;">No biography found for ${_escB(name)}.</div>`;

      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <button id="cast-bio-back" style="width:28px;height:28px;border-radius:50%;background:${this._pt("btnBg")};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("text")}"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
          </button>
          <div style="font-size:15px;font-weight:700;color:${this._pt("text")}">${name}</div>
        </div>
        <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">
          <div id="cast-bio-photo">${photoHtml}</div>
          <div style="flex:1;min-width:0;">
            ${metaLine ? `<div style="font-size:11px;color:${this._pt("dim")};margin-bottom:6px;">${metaLine}</div>` : ''}
            ${bioBodyHtml}
          </div>
        </div>

        ${askOn ? `<div id="bio-action-row" style="display:flex;flex-wrap:wrap;justify-content:flex-start;gap:6px 24px;margin:14px 0 8px;">
          <button id="bio-ask-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6V9M14,14H6V12H14V14M18,8H6V6H18V8Z"/></svg>
            Ask
          </button>
          <button id="bio-trivia-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
            Trivia
          </button>
        </div>
        <div id="bio-ask-panel" style="display:none;margin-bottom:12px;"></div>
        <div id="bio-trivia-panel" style="display:none;margin-bottom:12px;"></div>` : ''}
        ${bio?.known_for?.length ? `
          <div class="info-section-label">Known For</div>
          <div id="cast-known-for-list">
            ${bio.known_for.map((w, i) => {
              const kTitle = typeof w === 'object' ? (w.title || '') : w;
              const kYear  = typeof w === 'object' ? (w.year  || '') : '';
              const kType  = typeof w === 'object' ? (w.type  || 'song') : 'song';
              const isMusicItem = kType === 'song' || kType === 'album' || kType === 'single';
              if (isMusicItem) {
                // Music: tappable row — tap opens AI track info, long-press opens enqueue menu
                return `<div class="cast-kf-music-row" data-title="${kTitle.replace(/"/g,'&quot;')}" data-artist="${name.replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${this._pt("div")};cursor:pointer;-webkit-tap-highlight-color:transparent;">
                  <div class="cast-kf-art" data-kf-idx="${i}" style="width:36px;height:36px;border-radius:6px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._pt("dim")}"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${kTitle}</div>
                    <div style="font-size:11px;color:${this._pt("dim")};margin-top:1px">${[kYear, kType.charAt(0).toUpperCase()+kType.slice(1)].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>`;
              } else {
                // Video: poster art row with tap-to-detail
                return `<div class="cast-known-for-row" data-idx="${i}"
                  data-title="${kTitle.replace(/"/g,'&quot;')}" data-year="${kYear}" data-type="${kType}"
                  style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${this._pt("div")};cursor:pointer;-webkit-tap-highlight-color:transparent;">
                  <div class="cast-kf-art" data-kf-idx="${i}" style="width:36px;height:50px;border-radius:5px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                    <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:${this._pt("dim")}"><path d="${kType === 'tv' ? 'M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z' : 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z'}"/></svg>
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${kTitle}</div>
                    <div style="font-size:11px;color:${this._pt("dim")};margin-top:1px">${[kYear, kType === 'tv' ? 'TV Series' : 'Movie'].filter(Boolean).join(' · ')}</div>
                  </div>
                  
                </div>`;
              }
            }).join('')}
          </div>` : ''}`;

      _hideBioBackRow();
      content.querySelector('#cast-bio-back').addEventListener('click', () => {
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        _restoreHeader();
          if (typeof onBack === 'function') { onBack(); return; }
        content.innerHTML = savedHtml;
        content.scrollTop = savedScroll;
        this._rewireCastClicks(content, showTitle, artUrl);
      });
      if (askOn) this._wireBioActionRow(content, name, showTitle);
    };

    // Render immediately with placeholder while fetching photo + bio in parallel
    let bio = null;
    renderBio(null, true);

    const _fallbackPhotoHtml = `<div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:36px;height:36px;fill:rgba(255,255,255,0.2)"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg></div>`;
    const _wireBioPhotoTap = (imgSrc) => {
      const photoContainer = content.querySelector('#cast-bio-photo');
      if (!photoContainer) return;
      // Wire error handler via JS — more reliable than inline onerror in HA's CSP
      const imgEl = photoContainer.querySelector('#cast-bio-photo-img');
      if (imgEl) {
        imgEl.addEventListener('error', () => {
          // Evict dead blob from all caches
          if (imgSrc) {
            if (this._wikiBlobCache) {
              for (const [k, v] of this._wikiBlobCache) {
                if (v === imgSrc) { this._wikiBlobCache.delete(k); break; }
              }
            }
            try { URL.revokeObjectURL(imgSrc); } catch(_) {}
          }
          photoContainer.innerHTML = _fallbackPhotoHtml;
        }, { once: true });
      }
      if (!imgSrc) return;
      photoContainer.style.cursor = 'zoom-in';
      photoContainer.onclick = () => this._showBioPhotoLightbox(imgSrc, name, content);
    };

    // Fetch photo and bio in parallel
    // For music context, append disambiguation hints so Wikipedia finds the right article
    // e.g. "Queen" → tries "Queen" first, then "Queen band", then "Queen musician"
    const isMusicCtx = this._detectMediaType(this._hass?.states[this._entity]) === 'music';
    const _photoName = name;
    const photoPromise = isMusicCtx
      ? this._fetchMusicPersonThumb(_photoName, 2, 1500)
      : this._fetchWikipediaThumbWithRetry(_photoName, 2, 1500);

    // Bio cache — keyed by name, persisted in localStorage (30-day TTL)
    if (!this._castBioCache) this._castBioCache = new Map();
    const _bioCacheKey = ('bio|' + name).toLowerCase();
    const _cachedBio = this._castBioCache.get(_bioCacheKey)
      || this._aiLocalGet('castBio', _bioCacheKey)
      || this._aiSessionGet('castBio', _bioCacheKey);
    if (_cachedBio) this._castBioCache.set(_bioCacheKey, _cachedBio);

    // Fetch bio from AI
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
    // An AI answer (fresh or cached) with no bio or Known For in it
    // counts as nothing — fall back to Wikipedia for those too.
    const _hasBioContent = b => !!(b && (b.bio || b.known_for?.length));
    const bioPromise = (_cachedBio ? Promise.resolve(_cachedBio) : (async () => {
      if (aiOn) try {
        const isMusicContext = this._detectMediaType(this._hass?.states[this._entity]) === 'music';
        const prompt = isMusicContext
          ? 'Give me a short biography of the musician "' + name + '" known for their work with "' + showTitle + '". Reply ONLY with JSON: {"known_for":[{"title":"Song or Album 1","year":"YYYY","type":"song"},{"title":"Song or Album 2","year":"YYYY","type":"album"},{"title":"Song or Album 3","year":"YYYY","type":"song"}],"born":"1970","nationality":"American","bio":"2 sentence overview"}'
          : 'Give me a short biography of the actor/actress "' + name + '" known for appearing in "' + showTitle + '". Reply ONLY with JSON: {"known_for":[{"title":"Work 1","year":"YYYY","type":"tv"},{"title":"Work 2","year":"YYYY","type":"movie"},{"title":"Work 3","year":"YYYY","type":"tv"}],"born":"1970","nationality":"American","bio":"2 sentence overview"}';
        const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true,
          type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en'
        });
        const raw = resp?.response?.speech?.plain?.speech || '';
        const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
          const result = JSON.parse(raw.slice(start, end + 1));
          this._castBioCache.set(_bioCacheKey, result);
          this._aiSessionSet('castBio', _bioCacheKey, result);
          this._aiLocalSet('castBio', _bioCacheKey, result);
          return result;
        }
      } catch(e) {}
      // AI off, or it didn't know this person (common for artists that only
      // Discogs could identify) — fall back to the Wikipedia summary so the
      // panel isn't left empty.
      return this._fetchWikipediaPersonSummary(name, isMusicCtx);
    })()).then(b => _hasBioContent(b) ? b : this._fetchWikipediaPersonSummary(name, isMusicCtx));

    // Re-render when both arrive
    Promise.all([photoPromise, bioPromise]).then(([blobUrl, bioData]) => {
      bio = bioData;
      renderBio(blobUrl, false);
      // Wire tap on bio header photo → lightbox
      if (blobUrl) _wireBioPhotoTap(blobUrl);
      // Revoke blob URL when the back button is pressed (it's recreated inside renderBio's innerHTML)
      // We observe the back button that renderBio creates
      const backBtn = content.querySelector('#cast-bio-back');
      if (backBtn && blobUrl && blobUrl.startsWith('blob:')) {
        backBtn.addEventListener('click', () => {
          URL.revokeObjectURL(blobUrl);
          // Evict blob from cache regardless of which name key it was stored under
          // (may be "Queen band" not "Queen" if disambiguation was used)
          if (this._wikiBlobCache) {
            for (const [k, v] of this._wikiBlobCache) {
              if (v === blobUrl) { this._wikiBlobCache.delete(k); break; }
            }
          }
          // Also clear any __none__ entries for this name and its variants so
          // the next bio open re-tries Wikipedia rather than returning null instantly
          if (this._wikiThumbUrlCache) {
            [name, name + ' band', name + ' musician'].forEach(n => {
              if (this._wikiThumbUrlCache.get(n) === '__none__') this._wikiThumbUrlCache.delete(n);
            });
          }
        }, { once: true });
      }

      // Wire Known For rows → detail panel (video only) + fetch poster art
      if (bio?.known_for?.length) {
        const _self = this;

        // Wire music Known For rows — tap: AI track info, long-press: enqueue menu
        content.querySelectorAll('.cast-kf-music-row').forEach(row => {
          _self._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri]);
          let lpTimer = null, lpFired = false;
          const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
          row.addEventListener('pointerdown', () => {
            lpFired = false;
            lpTimer = setTimeout(() => {
              cancelLP(); lpFired = true;
              _self._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
            }, 480);
          }, { passive: true });
          row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
          row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
          row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
          row.addEventListener('click', () => {
            if (lpFired) { lpFired = false; return; }
            _self._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true });
          });
        });

        const _videoItems = bio.known_for.filter(w => {
          const t = typeof w === 'object' ? w.type : 'song';
          return t !== 'song' && t !== 'album' && t !== 'single';
        });

        // Tap handlers for video items only
        content.querySelectorAll('.cast-known-for-row').forEach(row => {
          _self._wireMtRow(row, null, () => _self._mtItemFromRow(row, '.cast-kf-art'));
          row.addEventListener('click', async () => {
            const kTitle = row.dataset.title;
            const kYear  = row.dataset.year;
            const kType  = row.dataset.type;
            const kArtEl = row.querySelector('.cast-kf-art img');
            const kArt   = kArtEl?.src || '';
            content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div></div>`;
            try {
              const _agentId = _self._config?.ai_conversation_agent || 'conversation.home_assistant';
              const _typeLabel = kType === 'tv' ? 'TV show' : 'movie';
              const _kPrompt = `You are a movie and TV encyclopedia. For the ${_typeLabel} "${kTitle}"${kYear ? ` (${kYear})` : ''}, return a single JSON object (no array, no markdown): {"type":"${kType}","title":"${kTitle}","year":"${kYear||''}","genres":["Genre"],"rating":"8.0","overview":"2 sentence overview","cast":["Name1","Name2","Name3","Name4","Name5","Name6"],"director":"Name or null","status":"Released or Continuing","vibe":"Short vibe","similar":[{"title":"Title","year":"YYYY","type":"${kType}"}]}`;
              const _kResp = await _self._aiProcess({ _crowFeature: 'info', _crowFallback: true,
                type: 'conversation/process', text: _kPrompt,
                agent_id: _agentId, language: navigator.language || 'en'
              });
              const _kRaw = _kResp?.response?.speech?.plain?.speech || '';
              // Fresh single-title lookup — clear any leftover picker
              // state so "Not this one?" refers to this title.
              _self._videoInfoPickerState = null;
              _self._videoInfoRootTitles = null;
              if (_kRaw) {
                const _ki1 = _kRaw.indexOf('{'), _ki2 = _kRaw.lastIndexOf('}');
                if (_ki1 !== -1 && _ki2 !== -1) {
                  _self._renderVideoInfoDetail(content, JSON.parse(_kRaw.slice(_ki1, _ki2 + 1)), kArt);
                  return;
                }
              }
            } catch(_) {}
            _self._renderVideoInfoDetail(content, { title: kTitle, year: kYear, type: kType }, kArt);
          });
        });

        // Fetch art for known_for items — music uses iTunes (with retry + Wikipedia
        // artist-photo fallback + background poller, same as AI Info's Similar
        // Tracks), video uses poster art via its own existing retry helper.
        const _applyKfArt = (i, img) => {
          const artEl = content.querySelector(`.cast-kf-art[data-kf-idx="${i}"]`);
          if (!artEl || artEl.dataset.loaded) return;
          const _im = document.createElement('img');
          _im.alt = '';
          _im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          _im.addEventListener('error', () => { this._evictStaleWikiBlobBySrc(_im.src); if (artEl.parentNode) artEl.innerHTML = ''; });
          _im.src = img;
          artEl.innerHTML = '';
          artEl.appendChild(_im);
          artEl.style.border = 'none';
          artEl.style.background = 'transparent';
          artEl.dataset.loaded = '1';
        };
        const _fetchKfArtWithRetry = (kTitle, i, retriesLeft, delayMs) => {
          // If already cached, apply immediately without the stagger delay
          const _kfCacheKey = [name || '', kTitle || ''].filter(Boolean).join('|').toLowerCase();
          if (this._itunesArtCache?.[_kfCacheKey]) { _applyKfArt(i, this._itunesArtCache[_kfCacheKey]); return; }
          setTimeout(() => {
            this._fetchItunesArtForTrack(name, kTitle).then(img => {
              if (img) {
                _applyKfArt(i, img);
              } else if (retriesLeft > 0) {
                _fetchKfArtWithRetry(kTitle, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
              } else if (name) {
                // iTunes confirmed a miss — fall back to a Wikipedia artist photo
                this._fetchMusicPersonThumb(name, 2, 1500).then(blobUrl => {
                  if (blobUrl) _applyKfArt(i, blobUrl);
                });
              }
            });
          }, delayMs);
        };

        requestAnimationFrame(() => {
          bio.known_for.forEach((w, i) => {
            const kType  = typeof w === 'object' ? (w.type || 'song') : 'song';
            const kTitle = typeof w === 'object' ? w.title : w;
            const kYear  = typeof w === 'object' ? w.year  : '';
            const isMusicItem = kType === 'song' || kType === 'album' || kType === 'single';

            if (isMusicItem) {
              // Stagger initial requests by 700ms each to avoid iTunes burst rate-limiting
              _fetchKfArtWithRetry(kTitle, i, 5, i * 700);
            } else {
              // Video: fetch poster art via Wikipedia → iTunes
              _self._fetchVideoArtWithRetry(content, kTitle, kYear, kType, `.cast-kf-art[data-kf-idx="${i}"]`, 5, 300 + i * 500);
            }
          });

          // Background poller — keep retrying music rows that still show a
          // placeholder after the initial fetch wave, in case of rate limiting
          // or slow responses (mirrors the Similar Tracks poller in AI Info).
          const _musicKf = bio.known_for
            .map((w, i) => ({ w, i }))
            .filter(({ w }) => {
              const t = typeof w === 'object' ? (w.type || 'song') : 'song';
              return t === 'song' || t === 'album' || t === 'single';
            });
          if (_musicKf.length) {
            let _kfPollCount = 0;
            const _kfPollInterval = setInterval(() => {
              _kfPollCount++;
              if (_kfPollCount > 20) { clearInterval(_kfPollInterval); return; } // max ~60s
              let allDone = true;
              _musicKf.forEach(({ w, i }) => {
                const kTitle = typeof w === 'object' ? w.title : w;
                const artEl = content.querySelector(`.cast-kf-art[data-kf-idx="${i}"]`);
                if (!artEl) return;
                if (!artEl.dataset.loaded) {
                  allDone = false;
                  this._fetchItunesArtForTrack(name, kTitle).then(img => {
                    if (img) {
                      _applyKfArt(i, img);
                    } else if (name && _kfPollCount >= 3) {
                      const _kfKey = [name, kTitle || ''].filter(Boolean).join('|').toLowerCase();
                      if (this._itunesArtCache?.[_kfKey] === '') {
                        this._fetchMusicPersonThumb(name, 2, 1500).then(blobUrl => {
                          if (blobUrl) _applyKfArt(i, blobUrl);
                        });
                      }
                    }
                  });
                }
              });
              if (allDone) clearInterval(_kfPollInterval);
            }, 3000);
          }
        });
      }
    });
  },

  // ── Bio Action Row (Ask / Trivia) ───────────────────────────────────────────
  _wireBioActionRow(content, name, showTitle) {
    const PANELS = [
      { btnId: '#bio-ask-btn',    panelId: '#bio-ask-panel' },
      { btnId: '#bio-trivia-btn', panelId: '#bio-trivia-panel' },
    ];
    const _dim    = this._pt('dim');
    const _text   = this._pt('text');
    const _bg     = this._pt('btnBg');
    const _border = this._pt('border');

    const _closeAll = (exceptBtnId) => {
      PANELS.forEach(p => {
        if (p.btnId === exceptBtnId) return;
        const btn   = content.querySelector(p.btnId);
        const panel = content.querySelector(p.panelId);
        if (btn)   { btn.style.color = this._pt('text'); }
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      });
    };

    // ── Ask ──
    const askBtn   = content.querySelector('#bio-ask-btn');
    const askPanel = content.querySelector('#bio-ask-panel');
    if (askBtn && askPanel) {
      let askOpen = false;
      askBtn.addEventListener('click', () => {
        askOpen = !askOpen;
        if (askOpen) _closeAll('#bio-ask-btn');
        askBtn.style.color = askOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!askOpen) { askPanel.style.display = 'none'; askPanel.innerHTML = ''; return; }
        askPanel.style.display = 'block';
        askPanel.innerHTML = `
          ${this._aiAskHtml('bio-ask-input', 'bio-ask-send', 'bio-ask-answer', 'What was their breakthrough role? Awards won?…')}`;
        const input    = askPanel.querySelector('#bio-ask-input');
        const sendBtn  = askPanel.querySelector('#bio-ask-send');
        const answerEl = askPanel.querySelector('#bio-ask-answer');
        const _doAsk = async () => {
          const q = input?.value?.trim();
          if (!q) return;
          answerEl.innerHTML = this._aiLoading('Thinking\u2026');
          const hasAI = await this._aiCheckAvailable();
          if (!hasAI) { this._aiShowFail(answerEl, null, 'agent'); return; }
          const context = showTitle ? ` known for "${showTitle}"` : '';
          const prompt = `About ${name}${context}: ${q}\n\nAnswer in 2-4 plain sentences.`;
          const result = await this._aiConverseF('ask', prompt, { noCache: true });
          if (answerEl && askPanel.isConnected) { if (result) answerEl.innerHTML = this._aiRich(result); else this._aiShowFail(answerEl, _doAsk); }
        };
        sendBtn?.addEventListener('click', _doAsk);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doAsk(); });
        setTimeout(() => input?.focus(), 50);
      });
    }

    // ── Trivia ──
    const triviaBtn   = content.querySelector('#bio-trivia-btn');
    const triviaPanel = content.querySelector('#bio-trivia-panel');
    if (triviaBtn && triviaPanel) {
      let triviaOpen = false;
      triviaBtn.addEventListener('click', async () => {
        triviaOpen = !triviaOpen;
        if (triviaOpen) _closeAll('#bio-trivia-btn');
        triviaBtn.style.color = triviaOpen ? 'var(--crow-info-link,#63b3ed)' : this._pt('text');
        if (!triviaOpen) { triviaPanel.style.display = 'none'; triviaPanel.innerHTML = ''; return; }
        triviaPanel.style.display = 'block';
        const cacheKey = ('biotrivia|' + name).toLowerCase();
        if (!this._aiBioTriviaCache) this._aiBioTriviaCache = new Map();
        let questions = this._aiBioTriviaCache.get(cacheKey) || this._aiSessionGet('bioTrivia', cacheKey);
        if (!questions) {
          triviaPanel.innerHTML = this._aiLoading('Generating trivia…');
          const hasAI = await this._aiCheckAvailable();
          if (!triviaPanel.isConnected) return;
          if (!hasAI) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'agent'); return; }
          const context = showTitle ? ` known for "${showTitle}"` : '';
          const raw = await this._aiConverseF('ask', `Generate 5 fun trivia questions about ${name}${context} — mix career highlights, personal facts, and lesser-known details. Respond ONLY with a JSON array:\n[{"q":"Question?","a":"Answer"}]`);
          if (!triviaPanel.isConnected) return;
          if (!raw) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }); return; }
          try {
            const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
            questions = JSON.parse(i1 !== -1 ? raw.slice(i1, i2+1) : raw);
            this._aiBioTriviaCache.set(cacheKey, questions);
            this._aiSessionSet('bioTrivia', cacheKey, questions);
          } catch(e) { this._aiShowFail(triviaPanel, () => { triviaOpen = false; triviaBtn.click(); }, 'unreadable'); return; }
        }
        if (!triviaPanel.isConnected) return;
        this._aiTriviaList(triviaPanel, questions);
      });
    }
  },

  // Re-wire cast clicks after restoring saved HTML
  _rewireCastClicks(content, showTitle, artUrl) {
    const self = this;
    content.querySelectorAll('.info-cast-item[data-cast-name]').forEach(item => {
      item.addEventListener('click', () => {
        self._showCastBio(content, item.dataset.castName, showTitle, artUrl);
      });
    });

    // Re-wire director link (video info panel)
    const directorLink = content.querySelector('#video-director-link');
    if (directorLink) {
      directorLink.addEventListener('click', () => {
        self._showCastBio(content, directorLink.dataset.director, showTitle, artUrl);
      });
    }

    // Re-wire artist name pill (music AI panel)
    const artistNameEl = content.querySelector('#ai-track-artist-name');
    if (artistNameEl) {
      let _artLpTimer = null, _artLpFired = false;
      artistNameEl.style.color = '#63b3ed';
      artistNameEl.addEventListener('pointerdown', () => {
        _artLpFired = false;
        _artLpTimer = setTimeout(() => { _artLpFired = true; self._playArtistRadio(artistNameEl.dataset.artist); }, 500);
      }, { passive: true });
      artistNameEl.addEventListener('pointerup',     () => { clearTimeout(_artLpTimer); }, { passive: true });
      artistNameEl.addEventListener('pointercancel', () => { clearTimeout(_artLpTimer); _artLpFired = false; }, { passive: true });
      artistNameEl.addEventListener('pointermove',   () => { clearTimeout(_artLpTimer); }, { passive: true });
      artistNameEl.addEventListener('click', () => {
        if (_artLpFired) { _artLpFired = false; return; }
        self._showCastBio(content, artistNameEl.dataset.artist, showTitle, artUrl);
      });
    }

    // Re-wire album pill (music AI panel)
    const albumPillEl = content.querySelector('#ai-track-album-btn');
    if (albumPillEl) {
      const r2 = self.shadowRoot;
      const titleEl2 = r2?.getElementById('infoPopupTitle') || r2?.getElementById('infoTitle') || r2?.querySelector('.info-popup-title');
      albumPillEl.addEventListener('click', () => {
        const albumName   = albumPillEl.dataset.album;
        const albumArtist = albumPillEl.dataset.artist;
        if (!self._albumPillTapped) self._albumPillTapped = new Set();
        self._albumPillTapped.add((albumName + '|' + albumArtist).toLowerCase());
        const _savedContent2 = content.innerHTML;
        const _savedTitle2   = titleEl2?.textContent || 'Info';
        if (titleEl2) titleEl2.textContent = 'Album';
        self._showAIAlbumTracks(content, albumName, albumArtist, artUrl, () => {
          r2?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          content.innerHTML = _savedContent2;
          if (titleEl2) titleEl2.textContent = _savedTitle2;
          self._rewireCastClicks(content, showTitle, artUrl);
        });
      });
    }

    // Re-wire Ask / Meaning / Trivia action row + Year box (music AI panel)
    const _storedTrack  = content.dataset.musicTrackTitle;
    const _storedArtist = content.dataset.musicArtistName;
    const _storedYear   = content.dataset.musicTrackYear || '';
    if (_storedTrack && content.querySelector('#music-ask-btn')) {
      const _storedData = { year: _storedYear };
      self._wireMusicActionRow(content, _storedTrack, _storedArtist, _storedData);
    }
    if (_storedYear && content.querySelector('#music-year-box')) {
      self._loadDayInMusicContext(content, _storedTrack, _storedArtist, _storedYear);
    }

    // Re-wire similar track rows — long-press (enqueue menu) and tap (drill in)
    content.querySelectorAll('.ai-sim-row').forEach(row => {
      self._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ai-sim-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          self._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
        }, 480);
      }, { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
      row.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        self._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true, overrideArt: row.dataset.art || '' });
      });
    });

    // Re-wire video info panel (director, seasons, cast, ratings, content warnings)
    if (content.dataset.videoDataJson && !_storedTrack) {
      try {
        const _vData  = JSON.parse(content.dataset.videoDataJson);
        const _vArt   = content.dataset.videoArtUrl || artUrl || '';
        // Re-render fully — this rewires all interactive elements
        self._renderVideoInfoDetail(content, _vData, _vArt);
      } catch(_) {}
    }

    // Re-wire art thumbnail tap → lightbox (lost when content.innerHTML is restored)
    const _artImg2OpenedAt = Date.now();
    const _artImg2 = content.querySelector('.info-hero-art-img');
    if (_artImg2) {
      _artImg2.style.pointerEvents = 'auto';
      _artImg2.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((Date.now() - _artImg2OpenedAt) < 500) return;
        const _tTitle  = content.dataset.musicTrackTitle  || '';
        const _tArtist = content.dataset.musicArtistName || '';
        self._showBioPhotoLightbox(_artImg2.src || artUrl, `${_tTitle}${_tArtist ? ' · ' + _tArtist : ''}`, content, 'square');
      });
    }

    // Re-wire genre tag pills in any bio screen
    self._wireGenreTagClicks(content);
  },

  // Fetch movie/TV poster from iTunes Search API
  // ── Video poster art helper — same retry/stagger pattern as music recs ──────
  _applyVideoArt(container, selectorOrEl, url) {
    const el = typeof selectorOrEl === 'string'
      ? (container?.querySelector(selectorOrEl) || this.shadowRoot?.querySelector(selectorOrEl))
      : selectorOrEl;
    if (!el) return;
    if (el.dataset.loaded) return; // already loaded — don't overwrite
    el.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.innerHTML=''">`;
    el.style.border = 'none';
    el.style.background = 'transparent';
    el.dataset.loaded = '1';
  },

  _fetchVideoArtWithRetry(content, title, year, type, artSelector, retriesLeft = 3, delayMs = 300) {
    setTimeout(async () => {
      // Check if already loaded before fetching
      const _checkEl = typeof artSelector === 'string'
        ? (content?.querySelector(artSelector) || this.shadowRoot?.querySelector(artSelector))
        : artSelector;
      if (_checkEl?.dataset.loaded) return;
      const url = await this._fetchVideoArtWithWiki(title, year || '', type || 'movie').catch(() => null);
      if (url) {
        this._applyVideoArt(content, artSelector, url);
      } else if (retriesLeft > 0) {
        this._fetchVideoArtWithRetry(content, title, year, type, artSelector, retriesLeft - 1, Math.min(delayMs * 2, 4000));
      }
    }, delayMs);
  },

  // ── Movie/TV poster via Wikipedia first, iTunes fallback ─────────────────
  // Wikipedia has better coverage for older films and returns official posters.
  // iTunes is used as fallback for newer/obscure titles not on Wikipedia.
  async _fetchVideoArtWithWiki(title, year, type) {
    if (!title) return null;
    const _cacheKey = (title + '|' + (year || '') + '|' + (type || 'movie')).toLowerCase();
    if (!this._itunesMoviePosterCache) this._itunesMoviePosterCache = new Map();
    // blob: URLs only live for the current document session — a page reload
    // (WKWebView backgrounding, dashboard refresh, etc.) invalidates them
    // silently. Trusting a cached blob: URL without checking it's still
    // alive is exactly what was showing the placeholder icon for titles
    // that resolved via Wikipedia in a previous session. Verify liveness
    // the same way _wikiBlobCache already does, and fall through to a
    // real re-fetch rather than returning a dead URL.
    const _isDeadBlob = async (u) => {
      if (!u || !u.startsWith('blob:')) return false;
      try { const t = await crowFetch(u); return !t.ok; } catch (_) { return true; }
    };
    if (this._itunesMoviePosterCache.has(_cacheKey)) {
      const cached = this._itunesMoviePosterCache.get(_cacheKey);
      if (!(await _isDeadBlob(cached))) return cached;
      this._itunesMoviePosterCache.delete(_cacheKey);
    }
    const _lsCached = this._aiLocalGet('moviePoster', _cacheKey);
    if (_lsCached) {
      if (!(await _isDeadBlob(_lsCached))) {
        this._itunesMoviePosterCache.set(_cacheKey, _lsCached);
        return _lsCached;
      }
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_ai_local_moviePoster') || '{}');
        delete store[_cacheKey];
        localStorage.setItem('crow_media_ai_local_moviePoster', JSON.stringify(store));
      } catch (_) {}
    }

    // ── Step 1: Try Wikipedia with multiple title variants ───────────────────
    const isTv = type === 'tv';
    // The picker's disambiguation flow already asks the AI for "the most
    // specific and unambiguous Wikipedia article title" (e.g. "Doctor Who
    // (2005 TV series)") and passes that straight in as `title` — it's
    // already qualified. Appending more suffixes onto that would produce
    // malformed doubled variants like "Doctor Who (2005 TV series) (2005
    // TV series)", which is what was happening here. Detect that case and
    // use the title as given, falling back to its bare form only.
    const _bareTitle = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const _alreadyQualified = _bareTitle && _bareTitle !== title;

    // Catalog/article titles often use "&" (e.g. "Fast & Furious") while
    // AI-generated titles tend to spell out "and" — try the opposite form too.
    const _andSource = _alreadyQualified ? _bareTitle : title;
    let altTitle = null;
    if (/\s+&\s+/.test(_andSource)) altTitle = _andSource.replace(/\s+&\s+/, ' and ');
    else if (/\s+and\s+/i.test(_andSource)) altTitle = _andSource.replace(/\s+and\s+/i, ' & ');

    // Most-specific first. The bare title is the riskiest variant — common
    // words/phrases (e.g. "Independence Day") often resolve to a real,
    // unrelated Wikipedia article (a holiday, a place, etc.) rather than a
    // disambiguation page, so it passes the disambiguation check and hands
    // back a wrong-but-valid thumbnail. Qualified forms like "(1996 film)"
    // essentially can't collide with anything else, so try those first and
    // only fall back to the bare title as a last resort.
    const variants = _alreadyQualified
      ? [title, _bareTitle, altTitle].filter(Boolean)
      : [
          year ? title + ' (' + year + (isTv ? ' TV series)' : ' film)') : null,
          year ? title + ' (' + year + ')' : null,
          title + (isTv ? ' (TV series)' : ' (film)'),
          altTitle ? altTitle + (isTv ? ' (TV series)' : ' (film)') : null,
          title,
          altTitle,
        ].filter(Boolean);

    let url = null;
    for (const variant of variants) {
      url = await this._fetchWikipediaThumb(variant, true).catch(() => null);
      if (url) break;
    }

    // ── Step 2: Fall back to iTunes if Wikipedia returned nothing ────────────
    if (!url) {
      url = await this._fetchItunesMoviePoster(title, year || '', type || 'movie').catch(() => null);
    }

    // Cache result (positive or null). blob: URLs (from the Wikipedia path)
    // are only kept in the in-memory cache for this session — persisting
    // them to localStorage would just hand a future session a dead URL.
    // The Wikipedia layer already persists the underlying remote https
    // URL separately (_wikiThumbUrlCache) and re-derives a fresh blob from
    // it next time, so nothing is lost by not persisting the blob here.
    if (url) {
      this._itunesMoviePosterCache.set(_cacheKey, url);
      if (!url.startsWith('blob:')) this._aiLocalSet('moviePoster', _cacheKey, url);
    } else {
      console.warn('[Crow Media Player] Artwork fallback exhausted (Wikipedia + iTunes both failed)', title, year || '(no year)', 'variants tried:', variants);
    }
    return url || null;
  },

  async _fetchItunesMoviePoster(title, year, type = 'movie') {
    if (!title) return null;
    if (!this._itunesMoviePosterCache) this._itunesMoviePosterCache = new Map();
    const _cacheKey = (title + '|' + (year || '') + '|' + type).toLowerCase();
    if (this._itunesMoviePosterCache.has(_cacheKey)) return this._itunesMoviePosterCache.get(_cacheKey);
    // Check localStorage before network fetch
    const _lsPoster = this._aiLocalGet('moviePoster', _cacheKey);
    if (_lsPoster) { this._itunesMoviePosterCache.set(_cacheKey, _lsPoster); return _lsPoster; }
    try {
      // Treat "&" and "and" as equivalent — catalog titles often use "&"
      // (e.g. "Fast & Furious") while AI-generated titles tend to spell out
      // "and", which otherwise causes an exact match to score zero and get
      // skipped even though the right result is sitting right there.
      const _normTitle = s => s.toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim();
      const titleLower = _normTitle(title);
      const yearStr = year ? String(year) : '';

      const _scoreResults = (results) => {
        let best = null, bestScore = -1;
        const titleWords = titleLower.split(' ').filter(Boolean);
        for (const r of results) {
          // For movies: trackName is primary. For TV seasons: collectionName is primary.
          const rTitle = _normTitle((r.trackName || r.collectionName || r.artistName || '')
            .replace(/,?\s+season\s+\d+/i, '')); // strip "Season N" suffix for TV
          const rWords = rTitle.split(' ').filter(Boolean);
          let score = 0;
          if (rTitle === titleLower) {
            score += 10; // exact match
          } else if (rTitle.startsWith(titleLower + ':')) {
            score += 5; // subtitle e.g. "Stargate: The Movie"
            score -= (rWords.length - titleWords.length); // penalise extra words
          } else if (
            rWords.length >= titleWords.length &&
            titleWords.every((w, i) => rWords[i] === w)
          ) {
            // Title words match as a prefix of result words (e.g. "Stargate SG-1" for query "Stargate SG-1")
            score += 4;
            score -= (rWords.length - titleWords.length) * 1.5; // penalise extra words
          } else if (rTitle.includes(titleLower)) {
            score += 1;
            score -= (rWords.length - titleWords.length) * 2;
          } else {
            continue;
          }
          if (yearStr) {
            if ((r.releaseDate || '').startsWith(yearStr)) score += 6;
            else score -= 2;
          }
          if (score < 1) continue;
          if (score > bestScore) { bestScore = score; best = r; }
        }
        return best;
      };

      const _itunesFetch = async (term, mediaType, entity) => {
        const resp = await crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term)
          + '&media=' + mediaType + '&entity=' + entity + '&limit=25&country=us');
        const data = await resp.json();
        return data?.results || [];
      };

      let best = null;
      const isTv = type === 'tv';
      const termWithYear = yearStr ? title + ' ' + yearStr : title;

      if (isTv) {
        // Try tvSeason (gets season artwork) and tvEpisode in parallel for better hit rate
        const [seasonResults, episodeResults] = await Promise.all([
          _itunesFetch(title, 'tvShow', 'tvSeason').catch(() => []),
          _itunesFetch(title, 'tvShow', 'tvEpisode').catch(() => []),
        ]);
        best = _scoreResults(seasonResults) || _scoreResults(episodeResults);
        if (!best) {
          // Try with year appended
          const [s2, e2] = await Promise.all([
            _itunesFetch(termWithYear, 'tvShow', 'tvSeason').catch(() => []),
            _itunesFetch(termWithYear, 'tvShow', 'tvEpisode').catch(() => []),
          ]);
          best = _scoreResults(s2) || _scoreResults(e2);
        }
      } else {
        // Movie — search by title alone first (year in search term often breaks iTunes)
        const [r1, r2] = await Promise.all([
          _itunesFetch(title, 'movie', 'movie').catch(() => []),
          _itunesFetch(title, 'tvShow', 'tvSeason').catch(() => []),
        ]);
        best = _scoreResults(r1) || _scoreResults(r2);
        // If no hit with year constraint, try relaxing the year penalty by searching without year
        if (!best && yearStr) {
          const _noYearResults = await _itunesFetch(title, 'movie', 'movie').catch(() => []);
          // Temporarily score without year
          const _bestNoYear = (() => {
            let b = null, bs = -1;
            const tl = titleLower, tw = tl.split(' ').filter(Boolean);
            for (const r of _noYearResults) {
              const rt = _normTitle((r.trackName || r.collectionName || '').replace(/,?\s+season\s+\d+/i,''));
              const rw = rt.split(' ').filter(Boolean);
              let s = 0;
              if (rt === tl) s = 10;
              else if (rt.startsWith(tl + ':')) s = 5;
              else if (rw.length >= tw.length && tw.every((w,i) => rw[i] === w)) { s = 4; s -= (rw.length-tw.length)*1.5; }
              else if (rt.includes(tl)) { s = 1; s -= (rw.length-tw.length)*2; }
              else continue;
              if (s < 1) continue;
              if (s > bs) { bs = s; b = r; }
            }
            return b;
          })();
          best = _bestNoYear;
        }
        if (!best && termWithYear !== title) {
          best = _scoreResults(await _itunesFetch(termWithYear, 'movie', 'movie').catch(() => []));
        }
      }

      const art = best?.artworkUrl100 || best?.artworkUrl60;
      const result = art ? art.replace(/\d+x\d+bb/, '600x600bb') : null;
      if (result) {
        this._itunesMoviePosterCache.set(_cacheKey, result);
        this._aiLocalSet('moviePoster', _cacheKey, result);
      }
      return result;
    } catch(e) {
      return null;
    }
  },

  _saveWikiUrlCache() {
    try {
      if (!this._wikiThumbUrlCache) return;
      const MAX_ENTRIES = 300;
      const out = {};
      const now = Date.now();
      // Load existing to merge
      try {
        const existing = JSON.parse(localStorage.getItem('crow_media_wiki_urls') || '{}');
        for (const [k, v] of Object.entries(existing)) out[k] = v;
      } catch(_) {}
      for (const [name, url] of this._wikiThumbUrlCache.entries()) {
        // Confirmed misses ARE persisted now (with a shorter 7-day TTL on
        // load) — previously every miss re-ran summary → search → summary
        // each session. Keep an existing entry's timestamp so the TTL isn't
        // refreshed just because the cache was re-saved.
        const prev = out[name];
        out[name] = { url, ts: (prev && prev.url === url && prev.ts) ? prev.ts : now };
      }
      // Evict oldest if over cap
      const entries = Object.entries(out);
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        const keep = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES));
        localStorage.setItem('crow_media_wiki_urls', JSON.stringify(keep));
        this._haStorageSaveWiki();
      } else {
        localStorage.setItem('crow_media_wiki_urls', JSON.stringify(out));
        this._haStorageSaveWiki();
      }
    } catch(e) {}
  },

  // Persistent store for Wikipedia photo bytes. Cache API needs a secure
  // context (https) — on plain-http local access it's simply
  // unavailable and we fall back to the network every session as before.
  async _wikiImageCache() {
    if (this._wikiImgCachePromise === undefined) {
      this._wikiImgCachePromise = (async () => {
        try {
          if (!window.caches || !window.isSecureContext) return null;
          return await window.caches.open('crow-media-wiki-img-v1');
        } catch (_) { return null; }
      })();
    }
    return this._wikiImgCachePromise;
  },

  async _fetchWikipediaThumb(name, validateIsMedia) {
    if (!name) return null;
    // Bounded concurrency (3 at a time) rather than a strict one-at-a-time
    // queue. The old serial queue meant a single slow miss (summary 404 →
    // search → second summary → image) held up every other photo behind it,
    // including ones that were already cached and needed no network at all.
    const MAX = 3;
    if (this._wikiActive == null) { this._wikiActive = 0; this._wikiWaiters = []; }
    if (this._wikiActive >= MAX) await new Promise(res => this._wikiWaiters.push(res));
    this._wikiActive++;
    try {
      return await this._fetchWikipediaThumbDirect(name, validateIsMedia);
    } finally {
      this._wikiActive--;
      const next = this._wikiWaiters.shift();
      if (next) next();
    }
  },

  async _fetchWikipediaThumbDirect(name, validateIsMedia) {
    if (!name) return null;
    try {
      // Cache the final blob URL itself — once we've downloaded and converted
      // a photo for this name, every subsequent call (retries, the background
      // poller, reopening the panel) reuses it with zero network calls, instead
      // of re-downloading the same image bytes from Wikimedia's CDN each time.
      if (!this._wikiBlobCache) this._wikiBlobCache = new Map();
      if (this._wikiBlobCache.has(name)) {
        const _cachedBlob = this._wikiBlobCache.get(name);
        if (_cachedBlob) {
          // Verify the cached blob is actually still alive. blob: URLs can go stale
          // in WKWebView (app backgrounding, memory pressure) without ever triggering
          // a JS-visible revocation — so a cached entry can look valid forever while
          // silently being dead. crowFetch() on a dead blob: URL rejects or returns !ok.
          try {
            const _testResp = await crowFetch(_cachedBlob);
            if (_testResp.ok) return _cachedBlob;
          } catch (_) { /* stale — fall through and re-download below */ }
        }
        this._wikiBlobCache.delete(name);
      }

      // Cache the Wikipedia remote URL (step 1) separately so retries only
      // need to re-run the blob download (step 2) rather than both fetches.
      if (!this._wikiThumbUrlCache) this._wikiThumbUrlCache = new Map();
      let remoteUrl = this._wikiThumbUrlCache.get(name) || null;
      if (remoteUrl === '__none__') return null; // confirmed no Wikipedia result

      if (!remoteUrl) {
        // Shared cooldown across every actor/artist lookup — if a recent request
        // got rate-limited, skip the network call entirely until it clears rather
        // than hammering an endpoint that's already throttling us. Returning null
        // here does NOT cache '__none__', so this name gets a fair retry later.
        const _cooling = () => this._wikiRateLimitUntil && Date.now() < this._wikiRateLimitUntil;
        if (_cooling()) return null;

        // Looks up a single title via the Wikimedia REST API (not the legacy
        // action=query API). This endpoint is backed by Wikimedia's CDN, follows
        // redirects automatically (covers stage names, nicknames, names missing a
        // middle name/suffix — all common even for very famous people), and is
        // far less prone to throttling a browser-based client than the action API.
        const _summary = async (title) => {
          const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
            + encodeURIComponent(title.replace(/ /g, '_'));
          const resp = await crowFetch(url, { headers: { Accept: 'application/json' } });
          if (resp.status === 429) {
            this._wikiRateLimitUntil = Date.now() + 30000;
            console.warn('[Crow Media Player] Wikipedia rate-limited — pausing Wikipedia lookups for 30s');
            return null;
          }
          if (!resp.ok) { console.warn('[Crow Media Player] Wikipedia summary miss', resp.status, title); return null; } // 404 = no article, or another non-fatal error
          const data = await resp.json();
          if (data?.type === 'disambiguation') { console.warn('[Crow Media Player] Wikipedia disambiguation page, skipping', title); return null; } // no single usable photo
          // Bare/common titles (e.g. "Independence Day") can resolve to a
          // real, unrelated article instead of a disambiguation page —
          // passes every check above while being completely the wrong
          // subject ("Independence Day" resolves to the US federal holiday,
          // not the film). A positive allowlist of expected phrasing (only
          // accept if description contains "film"/"series"/etc.) turned out
          // too fragile — Wikipedia's actual short descriptions vary a lot
          // ("television programme" instead of "series", etc.) and got
          // legitimate matches wrongly rejected. A negative check is safer:
          // only reject when the description clearly names a non-media
          // topic; anything else is given the benefit of the doubt.
          if (validateIsMedia) {
            const _desc = (data?.description || '').toLowerCase();
            const _nonMediaHit = _desc && /\bholiday\b|\bobservance\b|\bnational day\b|\bcommemorat|\bday of the year\b|\bannual (event|celebration)\b|\bvideo game\b|\balbum by\b|\bsong by\b|\bnovel by\b|\bbook by\b|\bpolitical party\b|\bnewspaper\b|\bmagazine\b|\bvillage in\b|\bmunicipality\b|\bcounty in\b|\bcity in\b|\bdistrict in\b|\bspecies of\b|\bgenus of\b|\bmountain in\b|\briver in\b/.test(_desc);
            if (_nonMediaHit) {
              console.warn('[Crow Media Player] Wikipedia article looks like a non-media topic, skipping', title, 'got:', _desc);
              return null;
            }
          }
          return data?.thumbnail?.source || data?.originalimage?.source || null;
        };

        remoteUrl = await _summary(name);

        // Fallback: if the exact name didn't resolve to a usable photo, use
        // Wikipedia's search to find the best-matching article and try that
        // instead. Covers AI-returned names that don't exactly match the
        // article title (missing middle name/suffix, alternate spelling, etc).
        if (!remoteUrl && !_cooling()) {
          try {
            const searchUrl = 'https://en.wikipedia.org/w/rest.php/v1/search/page?limit=1&q='
              + encodeURIComponent(name);
            const searchResp = await crowFetch(searchUrl, { headers: { Accept: 'application/json' } });
            if (searchResp.status === 429) {
              this._wikiRateLimitUntil = Date.now() + 30000;
              console.warn('[Crow Media Player] Wikipedia rate-limited — pausing Wikipedia lookups for 30s');
            } else if (searchResp.ok) {
              const searchData = await searchResp.json();
              const best = searchData?.pages?.[0];
              const bestKey = best?.key || best?.title;
              if (bestKey && bestKey.toLowerCase().replace(/_/g, ' ') !== name.toLowerCase()) {
                remoteUrl = await _summary(bestKey);
              }
            }
          } catch(_) { /* fall through to no-result handling below */ }
        }

        if (!remoteUrl) {
          // Only blacklist this name if the failure was a genuine miss — not if
          // we're mid-cooldown, since in that case we never really got an answer.
          if (!_cooling()) {
            this._wikiThumbUrlCache.set(name, '__none__');
            this._saveWikiUrlCache();
          }
          return null;
        }
        // Cache the URL in memory and persist to localStorage
        this._wikiThumbUrlCache.set(name, remoteUrl);
        this._saveWikiUrlCache();
      }

      // Step 2: fetch the image bytes via JS (not subject to img-src CSP) and
      // convert to a blob URL so <img src="blob:..."> works inside HA's webview
      // The blob cache above is memory-only, so it's empty every time the HA
      // frontend reloads — and previously that meant re-downloading every
      // photo each session even though its URL was cached. Keep the bytes in
      // the Cache API (persistent, survives reloads) and only hit Wikimedia's
      // CDN on a genuine first sighting.
      let imgResp = null;
      const _imgCache = await this._wikiImageCache();
      if (_imgCache) {
        try { imgResp = await _imgCache.match(remoteUrl); } catch (_) { imgResp = null; }
      }
      if (!imgResp) {
        imgResp = await crowFetch(remoteUrl);
        if (imgResp.ok && _imgCache) {
          try { await _imgCache.put(remoteUrl, imgResp.clone()); } catch (_) { /* quota etc — non-fatal */ }
        }
      }
      if (!imgResp.ok) { console.warn('[Crow Media Player] Wikipedia image fetch failed', imgResp.status, name); return null; }
      const blob = await imgResp.blob();
      const blobUrl = URL.createObjectURL(blob);
      this._wikiBlobCache.set(name, blobUrl);
      return blobUrl;
    } catch(e) {
      console.warn('[Crow Media Player] Wikipedia photo lookup error', name, e);
      return null;
    }
  },

  // Wraps _fetchWikipediaThumb with real retries (not just relying on the caller).
  // If we're mid rate-limit cooldown, waits past it before retrying rather than
  // firing into the same dead window. Safe to call from anywhere a photo is needed.
  async _fetchWikipediaThumbWithRetry(name, retriesLeft = 2, delayMs = 1500) {
    const blobUrl = await this._fetchWikipediaThumb(name);
    if (blobUrl || retriesLeft <= 0) return blobUrl;
    const cooldownRemaining = this._wikiRateLimitUntil ? Math.max(0, this._wikiRateLimitUntil - Date.now()) : 0;
    await new Promise(res => setTimeout(res, Math.max(delayMs, cooldownRemaining + 500)));
    return this._fetchWikipediaThumbWithRetry(name, retriesLeft - 1, delayMs * 2);
  },

  // An artist's or band member's photo: the name alone first, then "<name> band" and "<name> musician", so a
  // short or common name (Queen, Genesis, Prince…) still finds the musician's page rather than nothing. The
  // round photos in the music info panel and the artist's bio use this same lookup, so they always agree.
  async _fetchMusicPersonThumb(name, retriesLeft = 2, delayMs = 1500) {
    const first = await this._fetchWikipediaThumbWithRetry(name, retriesLeft, delayMs);
    if (first) return first;
    return (await this._fetchWikipediaThumb(name + ' band')) || this._fetchWikipediaThumb(name + ' musician');
  },

  async _loadMATab(tab) {
    this._maCurrentTab = tab;
    this._saveLibraryOpenState(tab);
    const content = this.shadowRoot.getElementById('maContent');

    // ── In-memory item cache — instant tab switching ────────────────────
    // If this tab's items are cached in memory (last 30s), render immediately
    // from memory — no network, no localStorage parse, no loading flash.
    if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
    const _now = Date.now();
    const _memEntry = this._maTabRenderCache.get(tab);
    if (_memEntry && (_now - _memEntry.ts) < 30000 && _memEntry.items?.length) {
      this._renderMAGrid(_memEntry.items, tab, content);
      this._buildTabActionBar(content, tab);
      if (tab === 'radio') this._rbInjectStarredSection(content);
      if (tab === 'podcast') this._pcInjectSections(content);
      this._maLibInjectStarred(tab, content);
      return;
    }

    // Pinned tab: consolidated view across every pin category — doesn't
    // touch MA library loading or the in-memory render cache at all, since
    // it's just reading straight from localStorage each time (instant).
    if (tab === 'pinned') {
      content.innerHTML = '';
      this._renderPinnedOverview(content);
      return;
    }

    // Charts: Apple Music / Deezer charts, nothing from the Music Assistant library
    if (tab === 'charts') {
      content.innerHTML = '';
      this._renderChartsList(content);
      return;
    }

    // Recent Searches: same shape as Pinned — a client-side, localStorage-only
    // list with no MA/network involvement.
    if (tab === 'recent_searches') {
      content.innerHTML = '';
      this._renderRecentSearchesTab(content);
      return;
    }

    // Recently Played: same shape again — reads straight from the existing
    // listening-history log that already powers Music Recap,
    // just presented as a chronological list instead of weekly stats.
    if (tab === 'recent_plays') {
      content.innerHTML = '';
      this._renderRecentPlaysTab(content);
      return;
    }

    // Watch History: the movie/TV counterpart — same relationship to the
    // Recap panel that Music History has to Music Recap.
    if (tab === 'recently_watched') {
      this._renderRecentlyWatchedTab(content);
      return;
    }

    // Podcast tab: skip MA library entirely — show pinned + top charts only
    if (tab === 'podcast') {
      content.innerHTML = '';
      this._pcInjectSections(content);
      return;
    }
    // Movie/TV tab: skip MA library entirely — show pinned + search prompt only
    if (tab === 'movie_tv') {
      content.innerHTML = '';
      this._mtInjectSections(content);
      return;
    }
    // Audiobook tab: skip MA library entirely — show pinned + search prompt only
    if (tab === 'audiobook') {
      content.innerHTML = '';
      this._abInjectSections(content);
      return;
    }

    // Serve from cache immediately before any async work — avoids loading flash
    const _earlyCached = this._maLibCacheGet(tab);
    if (_earlyCached && _earlyCached.length) {
      this._renderMAGrid(_earlyCached, tab, content);
      // For slow-fetching tabs, return early — no background refresh needed
      if (tab === 'recommended' || tab === 'recently_played' || tab === 'recently_added') {
        if (tab === 'recommended') this._buildTabActionBar(content, tab);
        return;
      }
      this._buildTabActionBar(content, tab);
      if (tab === 'radio') this._rbInjectStarredSection(content);
      if (tab === 'podcast') this._pcInjectSections(content);
      this._maLibInjectStarred(tab, content);
      if (tab === 'favourites') return;
      // For standard library tabs, fall through to refresh in background silently
    } else {
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = '<div class="ma-loading">Loading</div>';
    }

    const configEntryId = await this._getMAConfigEntryId();
    if (!configEntryId) {
      this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      content.innerHTML = this._psEmpty('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17L7,12L8.41,10.58L12,14.17L15.59,10.58L17,12L12,17M12,10L7,5L8.41,3.58L12,7.17L15.59,3.58L17,5L12,10Z', 'Music Assistant not found', 'Make sure the MA integration is installed and running in HA.');
      this._maLastSearch = null; this._maInSearchResults = false; this._maErrorShowing = true;
      this._psAutoCloseStart(this.shadowRoot, null, () => { this._maErrorShowing = false; }, 10000, 'maNotFoundErrBtn', 'maNotFoundErrRing');
      return;
    }

    // ── Recently Played ──────────────────────────────────────────────────
    if (tab === 'recently_played') {
      try {
        // Fetch the last-played items across all key media types in parallel,
        // capping each at 10 to keep the list varied and manageable.
        const TYPES = ['track', 'album', 'artist', 'playlist', 'radio'];
        const CAP   = this._maCmdOn?.() ? 50 : 10;   // with Music Assistant's history, enough to fill in its details
        const fetches = TYPES.map(mt =>
          this._hass.connection.sendMessagePromise({
            type: 'call_service',
            domain: 'music_assistant',
            service: 'get_library',
            service_data: { config_entry_id: configEntryId, media_type: mt, order_by: 'last_played_desc', limit: CAP },
            return_response: true
          }).then(res => (res?.response?.items || []).map(item => ({ ...item, _tab: mt })))
            .catch(() => [])
        );
        // Music Assistant's own history of what was played, in the order it was played (through Queue
        // Actions), asked for alongside the library lists above, which fill in each item's details
        const historyP = this._maCmdOn?.()
          ? this._maCmd('music/recently_played_items', { limit: 50, media_types: TYPES, fully_played_only: false }).catch(() => null)
          : Promise.resolve(null);
        const [chunks, history] = await Promise.all([Promise.all(fetches), historyP]);
        let allItems = [];
        if (Array.isArray(history) && history.length) allItems = await this._maRecentFromHistory(history, chunks);
        if (!allItems.length) {
          // Interleave results: pick one from each type in round-robin so the list
          // feels chronologically mixed rather than type-grouped.
          const maxLen = Math.max(...chunks.map(c => c.length));
          for (let i = 0; i < maxLen; i++) {
            for (const chunk of chunks) {
              if (chunk[i]) allItems.push(chunk[i]);
            }
          }
        }
        if (!allItems.length) {
          this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          content.innerHTML = '<div class="ma-empty">Nothing played yet — start listening and check back here.</div>';
          return;
        }
        this._maLibCacheSet('recently_played', allItems);
        this._renderMAGrid(allItems, 'recently_played', content);
        if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
        this._maTabRenderCache.set('recently_played', { items: allItems, ts: Date.now() });
      } catch (e) {
        console.error('[MA] recently_played error:', e);
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = this._psEmpty('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17L7,12L8.41,10.58L12,14.17L15.59,10.58L17,12L12,17M12,10L7,5L8.41,3.58L12,7.17L15.59,3.58L17,5L12,10Z', 'Could not load recently played', 'Check your Music Assistant connection and try again.');
          this._maLastSearch = null; this._maInSearchResults = false; this._maErrorShowing = true;
          this._psAutoCloseStart(this.shadowRoot, null, () => { this._maErrorShowing = false; }, 10000, 'maRecentErrBtn', 'maRecentErrRing');
      }
      return;
    }

    // ── Recently Added ────────────────────────────────────────────────
    if (tab === 'recently_added') {
      try {
        // Primary: ask MA's library directly for tracks sorted by true add
        // date (order_by: timestamp_added_desc). Note: MA's Apple Music
        // provider only seems to carry genuine, distinct per-track add dates
        // for a small recent window — beyond that, tracks appear to share
        // one fallback timestamp and the "sort" silently reverts to
        // whatever their default library order already was. There's no way
        // to detect that boundary from the data get_library returns (no
        // date field is exposed, only the ability to sort by it), so
        // further down a long list, entries may not actually be true
        // recent-adds — just whatever MA's default order happens to be.
        let items = [];
        try {
          const res = await this._hass.connection.sendMessagePromise({
            type: 'call_service',
            domain: 'music_assistant',
            service: 'get_library',
            service_data: { config_entry_id: configEntryId, media_type: 'track', order_by: 'timestamp_added_desc' },
            return_response: true
          });
          items = (res?.response?.items || []).map(item => ({ ...item, _tab: 'track' }));
        } catch (_) {
          // order_by not supported on this Music Assistant version —
          // fall through to the playlist heuristic below.
        }

        if (items.length) {
          this._maLibCacheSet('recently_added', items);
          this._renderMAGrid(items, 'track', content);
          if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
          this._maTabRenderCache.set('recently_added', { items, ts: Date.now() });
          return;
        }

        // Fallback: look for a playlist literally named "Recently Added
        // Tracks" (or similar) — only reached when the direct query above
        // isn't supported or came back empty, e.g. an older Music Assistant
        // version. Its contents are only as accurate as whatever maintains
        // that playlist, so it's a last resort rather than the default.
        const playlistRes = await this._hass.connection.sendMessagePromise({
          type: 'call_service',
          domain: 'music_assistant',
          service: 'get_library',
          service_data: { config_entry_id: configEntryId, media_type: 'playlist', limit: 100 },
          return_response: true
        });
        const playlists = playlistRes?.response?.items || [];
        const _normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const _targets = ['recentlyaddedtracks', 'recentlyadded', 'newlyadded', 'newadditions'];
        const recentPlaylist = playlists.find(p =>
          _targets.some(t => _normName(p.name || p.title || '') === t)
        );

        if (recentPlaylist) {
          // Found it — open it as a collection drill-in so we reuse all the
          // existing track-loading, rendering, and action bar infrastructure.
          // Set _maCurrentTab to '__ios_root__' before calling so the nav stack
          // entry pushed inside _maOpenCollectionTracks is the root sentinel —
          // meaning the back button returns to the Music Library category list,
          // not back to recently_added (which would just re-trigger the lookup).
          this._maCurrentTab = '__ios_root__';
          const _fakeItem = {
            ...recentPlaylist,
            media_type: 'playlist',
            _tab: 'playlist',
          };
          this._maOpenCollectionTracks(_fakeItem, 'playlist');
          return;
        }

        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = '<div class="ma-empty">No recently added tracks found. Try adding a playlist named "Recently Added Tracks" in Music Assistant.</div>';
      } catch (e) {
        console.error('[MA] recently_added error:', e);
        this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
        content.innerHTML = this._psEmpty('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17L7,12L8.41,10.58L12,14.17L15.59,10.58L17,12L12,17M12,10L7,5L8.41,3.58L12,7.17L15.59,3.58L17,5L12,10Z', 'Could not load recently added', 'Check your Music Assistant connection and try again.');
      }
      return;
    }

    // ── Recommended ──────────────────────────────────────────────────
    if (tab === 'recommended') {
      // (cache already served by _earlyCached check at top of _loadMATab if available)

      const _loadRecommendedFallback = async () => {
        try {
          const TYPES = ['track', 'album'];
          const fetches = TYPES.map(mt =>
            this._hass.connection.sendMessagePromise({
              type: 'call_service',
              domain: 'music_assistant',
              service: 'get_library',
              service_data: { config_entry_id: configEntryId, media_type: mt, order_by: 'random', limit: 25 },
              return_response: true
            }).then(res => (res?.response?.items || []).map(item => ({ ...item, _tab: mt })))
              .catch(() => [])
          );
          const chunks = await Promise.all(fetches);
          const allItems = [];
          const maxLen = Math.max(...chunks.map(c => c.length));
          for (let i = 0; i < maxLen; i++) {
            for (const chunk of chunks) { if (chunk[i]) allItems.push(chunk[i]); }
          }
          if (!allItems.length) {
            this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
            content.innerHTML = '<div class="ma-empty">No recommendations available — add some music to your library first.</div>';
            return;
          }
          this._maLibCacheSet('recommended', allItems);
          this._renderMAGrid(allItems, 'recommended', content);
          this._buildTabActionBar(content, 'recommended');
          if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
          this._maTabRenderCache.set('recommended', { items: allItems, ts: Date.now() });
        } catch (e) {
          console.error('[MA] recommended (fallback) error:', e);
          this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          content.innerHTML = this._psEmpty('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17L7,12L8.41,10.58L12,14.17L15.59,10.58L17,12L12,17M12,10L7,5L8.41,3.58L12,7.17L15.59,3.58L17,5L12,10Z', 'Could not load recommendations', 'Check your Music Assistant connection and try again.');
        }
      };

      // Check whether the optional mass_queue integration is available.
      // If it is, use its get_recommendations service which returns curated groups.
      // Otherwise fall back to MA own random/suggested tracks via get_library
      // with order_by: 'random' across a few types.
      const hasMassQueue = !!(this._hass?.services?.mass_queue?.get_recommendations);
      if (hasMassQueue) {
        try {
          const currentIsMA = this._maEntityIds?.has(this._entity)
            || (Array.isArray(this._config.ma_entities) && this._config.ma_entities.includes(this._entity));
          const maEntityForRec = currentIsMA
            ? this._entity
            : (this._config.ma_entities?.[0] || (this._maEntityIds && [...this._maEntityIds][0]) || this._entity);
          const res = await this._hass.connection.sendMessagePromise({
            type: 'call_service',
            domain: 'mass_queue',
            service: 'get_recommendations',
            service_data: { entity: maEntityForRec },
            return_response: true
          });
          const payload = res?.response;
          let groups = [];
          if (Array.isArray(payload)) {
            groups = payload;
          } else if (payload && typeof payload === 'object') {
            if (Array.isArray(payload[this._entity])) groups = payload[this._entity];
            else Object.values(payload).forEach(v => { if (Array.isArray(v)) groups.push(...v); else if (v && typeof v === 'object') groups.push(v); });
            if (!groups.length && Array.isArray(payload.items)) groups = payload.items;
          }
          const allItems = [];
          for (const group of groups) {
            const groupItems = Array.isArray(group?.items) && group.items.length ? group.items : [group];
            for (const item of groupItems) {
              const uri = item?.uri || item?.item_id;
              if (!uri) continue;
              // Detect type from URI prefix (e.g. "spotify://artist/...", "library://album/...")
              const uriType = uri.match(/\/(track|album|artist|playlist|podcast)\//i)?.[1]?.toLowerCase() || null;
              allItems.push({
                ...item,
                uri,
                name:         item?.name || group?.name || 'Recommendation',
                media_artist: group?.name || item?.provider || '',
                image:        item?.image || group?.image || null,
                media_type:   item?.media_type || item?.item_type || uriType || null,
                _tab:         item?.media_type || item?.item_type || uriType || 'recommended',
              });
            }
          }
          if (!allItems.length) {
            this.shadowRoot?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
            content.innerHTML = '<div class="ma-empty">No recommendations available right now.</div>';
            return;
          }
          this._maLibCacheSet('recommended', allItems);
          this._renderMAGrid(allItems, 'recommended', content);
          this._buildTabActionBar(content, 'recommended');
          if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
          this._maTabRenderCache.set('recommended', { items: allItems, ts: Date.now() });
        } catch (e) {
          console.error('[MA] recommended (mass_queue) error:', e);
          // Fall through to random library fallback instead of showing error
          await _loadRecommendedFallback();
        }
      } else {
        await _loadRecommendedFallback();
      }
      return;
    }

    // ── Standard library tabs ────────────────────────────────────────────
    const tabTypeMap = { playlist:'playlist', artist:'artist', album:'album', track:'track', radio:'radio', podcast:'podcast', audiobook:'audiobook', favourites:'track' };
    const mediaType = tabTypeMap[tab] || 'track';
    const isFav = tab === 'favourites';
    const PAGE = 200;

    const _cached = _earlyCached; // already served above if present

    const _fetchPage = (offset) => this._hass.connection.sendMessagePromise({
      type: 'call_service',
      domain: 'music_assistant',
      service: 'get_library',
      service_data: { config_entry_id: configEntryId, media_type: mediaType, limit: PAGE, offset, ...(isFav ? { favorite: true } : {}) },
      return_response: true
    }).then(res => res?.response?.items || []);

    try {
      // Fetch first page — renders immediately and reveals total count
      const firstPage = await _fetchPage(0);
      const allItems = [...firstPage];

      if (firstPage.length) {
        this._renderMAGrid(allItems, tab, content);
        this._buildTabActionBar(content, tab);
        // For radio tab, prepend starred section above the MA library grid
        if (tab === 'radio') this._rbInjectStarredSection(content);
        if (tab === 'podcast') this._pcInjectSections(content);
        this._maLibInjectStarred(tab, content);
      } else if (tab === 'radio') {
        // No MA library stations yet — still show starred if any
        this._rbInjectStarredSection(content);
      } else if (tab === 'podcast') {
        // No MA library podcasts yet — still show pinned + top charts
        this._pcInjectSections(content);
      }

      // If first page was full, fan out remaining pages in parallel
      if (firstPage.length === PAGE) {
        // Fetch next 2 pages in parallel to probe depth, then continue if needed
        let offset = PAGE;
        while (true) {
          const batchOffsets = [offset, offset + PAGE];
          const batch = await Promise.all(batchOffsets.map(o => _fetchPage(o)));
          const batchItems = batch.flat();
          allItems.push(...batchItems);

          // Re-render with full batch
          if (batchItems.length) {
            this._renderMAGrid(allItems, tab, content);
            this._buildTabActionBar(content, tab);
            if (tab === 'radio') this._rbInjectStarredSection(content);
            if (tab === 'podcast') this._pcInjectSections(content);
            this._maLibInjectStarred(tab, content);
          }

          // Stop if last batch returned less than a full page
          const lastPage = batch[batch.length - 1];
          if (lastPage.length < PAGE) break;
          offset += PAGE * 2;
        }
      }

      if (!allItems.length) {
        if (tab !== 'podcast' && (!_cached || !_cached.length)) content.innerHTML = '<div class="ma-empty">No ' + tab + 's found in your library.</div>';
        return;
      }
      // De-duplicate by URI — MA can return the same item from multiple providers
      const _seenItemUris = new Set();
      const _seenNameKeys = new Set();
      const _dedupedItems = allItems.filter(item => {
        const _u = item.uri || item.item_id || '';
        const _nameKey = ((item.name || '') + '|' + (item.artist || item.artists?.[0]?.name || '')).toLowerCase().trim();
        // Reject if we've seen this exact URI, OR this exact name+artist combo
        // (catches the same playlist/album synced from two providers with different URIs)
        if (_u && _seenItemUris.has(_u)) return false;
        if (_nameKey && _seenNameKeys.has(_nameKey)) return false;
        if (_u) _seenItemUris.add(_u);
        if (_nameKey) _seenNameKeys.add(_nameKey);
        return true;
      });
      this._maLibCacheSet(tab, _dedupedItems);
      if (!this._maTabRenderCache) this._maTabRenderCache = new Map();
      this._maTabRenderCache.set(tab, { items: _dedupedItems, ts: Date.now() });
      if (_dedupedItems.length !== allItems.length) {
        this._renderMAGrid(_dedupedItems, tab, content);
        this._buildTabActionBar(content, tab);
        if (tab === 'radio') this._rbInjectStarredSection(content);
        if (tab === 'podcast') this._pcInjectSections(content);
        this._maLibInjectStarred(tab, content);
      }
    } catch (e) {
      console.error('[MA] get_library error:', e);
      if (!_cached || !_cached.length) content.innerHTML = this._psEmpty('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17L7,12L8.41,10.58L12,14.17L15.59,10.58L17,12L12,17M12,10L7,5L8.41,3.58L12,7.17L15.59,3.58L17,5L12,10Z', 'Could not load library', 'Check your Music Assistant connection and try again.');
          this._maLastSearch = null; this._maInSearchResults = false; this._maErrorShowing = true;
          this._psAutoCloseStart(this.shadowRoot, null, () => { this._maErrorShowing = false; }, 10000, 'maLibErrBtn', 'maLibErrRing');
    }
  },

  // Resolves the keyboard-focused binary_sensor and config_entry_id that
  // belong to the same Apple TV device as the given media_player entity.
  // Deliberately doesn't guess at entity_id naming patterns (e.g. stripping
  // "_remote" or appending "_keyboard_focused") — HA doesn't guarantee any
  // particular naming convention, especially once a person has renamed
  // entities themselves. Instead this fetches the entity registry once and
  // finds the sibling entity that shares the same device_id, which is
  // reliable regardless of what anything's actually named. Cached per
  // entity for the session, same pattern _getMAConfigEntryId already uses.
  async _getAppleTVKeyboardInfo(entityId) {
    if (!this._atvKeyboardInfoCache) this._atvKeyboardInfoCache = {};
    if (this._atvKeyboardInfoCache[entityId] !== undefined) return this._atvKeyboardInfoCache[entityId];
    try {
      const entities = await this._hass.connection.sendMessagePromise({ type: 'config/entity_registry/list' });
      const mediaEntry = entities.find(e => e.entity_id === entityId);
      if (!mediaEntry?.device_id) { this._atvKeyboardInfoCache[entityId] = null; return null; }
      const binarySensorEntry = entities.find(e =>
        e.device_id === mediaEntry.device_id &&
        e.entity_id.startsWith('binary_sensor.') &&
        e.entity_id.includes('keyboard')
      );
      if (!binarySensorEntry) { this._atvKeyboardInfoCache[entityId] = null; return null; }
      const result = {
        binarySensorId: binarySensorEntry.entity_id,
        configEntryId: mediaEntry.config_entry_id || binarySensorEntry.config_entry_id || null,
      };
      this._atvKeyboardInfoCache[entityId] = result;
      return result;
    } catch (_) {
      this._atvKeyboardInfoCache[entityId] = null;
      return null;
    }
  },

  // Build the iTunes cache key for a MA library item (same formula as _fetchItunesArt)


  _buildTabActionBar(content, tab) {
    if (tab === 'recommended') this._cmpMixShelf(content);
    if (tab === 'radio') return; // No action bar for radio — stations play individually
    if (tab === 'podcast') return; // No action bar for podcasts — episodes play individually
    if (tab === 'movie_tv') return; // No action bar — results tap straight into AI Info
    if (tab === 'audiobook') return; // No action bar for audiobooks — chapters play individually
    // No action bar on top-level browse tabs — Play All on thousands of tracks/artists/albums
    // is almost never intentional and can overwhelm MA. The action bar belongs only on
    // drill-in collection views (album, playlist, artist) where the set is finite and curated.
    // _maOpenCollectionTracks injects its own dedicated bar after calling _renderMAGrid, so
    // suppressing here doesn't affect those views at all.
    const _topLevelTabs = new Set(['track','artist','album','playlist','recently_added','favourites','recommended','recently_played']);
    if (_topLevelTabs.has(tab)) return;
    const bar = document.createElement('div');
    bar.className = 'ma-drill-actions';
    const showMood = this._maEntityIds?.size > 0 && ['favourites','recommended','album','track'].includes(tab);
    bar.innerHTML =
      '<button class="ma-drill-action-btn" data-action="play_all"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span class="ma-drill-btn-label">Play All</span></button><button class="ma-drill-action-btn" data-action="add"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div><span class="ma-drill-btn-label">Add</span></button><button class="ma-drill-action-btn" data-action="next"><div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div><span class="ma-drill-btn-label">Play Next</span></button>' +
      (showMood
        ? ''
        : '');
    content.insertBefore(bar, content.firstChild);

    // Shuffle, after Play All, when this tab's items are songs
    {
      const cached = this._maLibCacheGet(tab) || [];
      const songs = cached.length && cached.every(it => (it.media_type || '') === 'track' || /:\/\/track\//i.test(it.uri || ''));
      const pa = bar.querySelector('[data-action="play_all"]');
      if (songs && pa) pa.insertAdjacentHTML('afterend', this._shuffleBtnHtml());
    }
    bar.querySelectorAll('.ma-drill-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const items = this._maLibCacheGet(tab) || [];
        if (!items.length) { this._showToast('Nothing to play yet', 2000); return; }
        if (action === 'shuffle') { this._crowShufflePlay(items); return; }

        const validMA = this._getValidMASpeakers(true);
        const target  = validMA.includes(this._entity)
          ? this._entity
          : (this._resolveMATargetEntity() || validMA[0] || this._entity);

        // ── AI Mood — open mood picker

        const enqueueMode = action === 'add' ? 'add' : action === 'next' ? 'next' : null;

        // Suppress error toasts for unplayable items in this batch
        this._maRecentPlaySuccess = true;
        clearTimeout(this._maRecentPlaySuccessTimer);
        this._maRecentPlaySuccessTimer = setTimeout(() => { this._maRecentPlaySuccess = false; }, 15000);
        // Suppress queue panel refresh while populating (prevents flashing)
        this._maBatchLoading = true;
        clearTimeout(this._maBatchLoadingTimer);
        this._maBatchLoadingTimer = setTimeout(() => { this._maBatchLoading = false; }, 15000);

        // Pulsate the active speaker pill to signal background queue activity
        this._pillPulse(15000);

        // Show the overlay — sits above infoContent, nothing can overwrite it
        const _overlay = this.shadowRoot?.getElementById('queueBuildingOverlay');
        // Only show overlay if the queue panel is open — never bleed onto other panels
        const _infoPopup = this.shadowRoot?.getElementById('infoPopup');
        const _isQueueOpen = _infoPopup?.classList.contains('visible') && this._queuePanelDirection != null;
        if (_overlay && _isQueueOpen) _overlay.style.display = 'flex';

        // Track successes/failures across the batch
        let successCount = 0, doneCount = 0;
        const totalCount = items.length;
        const _onDone = (ok) => {
          if (ok) successCount++;
          doneCount++;
          if (doneCount === totalCount) {
            // All done — stop spin, clear batch flag, show summary toast

            this._maBatchLoading = false;
            clearTimeout(this._maBatchLoadingTimer);
            this._pillPulse(0);
            if (action !== 'play_all') {
              const label = action === 'next' ? 'Play Next' : 'Added to queue';
              this._showToast(`${label} — ${successCount} track${successCount !== 1 ? 's' : ''}`, 3000);
            }
          }
        };

        // Patch: temporarily suppress per-item toast for batch by passing a sentinel
        const _batchEnqueue = (item, itemTab, mode) => {
          const uri = item.uri || item.media_content_id;
          const mediaType = item.media_type || itemTab;
          if (!uri) { _onDone(false); return; }
          const _isTrk = (mediaType === 'track' || itemTab === 'track' || itemTab === 'recently_added');
          const _bName  = (item.name || item.title || '').trim();
          const _bArt   = (item.artists && item.artists[0]?.name) || '';
          const _bId    = (_isTrk && _bName) ? (_bName + (_bArt ? ' ' + _bArt : '')) : uri;
          this._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'play_media',
            service_data: { entity_id: target, media_id: _bId, media_type: mediaType, enqueue: mode,
              ...(mode === 'replace' && this._radioModeLegacy?.() ? { radio_mode: true } : {}) }
          }).then(() => _onDone(true)).catch(() => _onDone(false));
        };

        if (action === 'play_all') {
          const [first, ...rest] = items;
          _batchEnqueue(first, first._tab || tab, 'replace');
          rest.forEach(it => _batchEnqueue(it, it._tab || tab, 'add'));
          this._closeMABrowser(true);
        } else {
          items.forEach(it => _batchEnqueue(it, it._tab || tab, enqueueMode));
        }

        // Refresh queue panel after MA finishes — 15ms/item, 4s min, 12s max
        const delay = Math.min(12000, Math.max(4000, items.length * 15));
        setTimeout(() => {
          const _ov = this.shadowRoot?.getElementById('queueBuildingOverlay');
          if (_ov) _ov.style.display = 'none';
          if (this._queuePanelDirection != null) {
            const popup = this.shadowRoot?.getElementById('infoPopup');
            // Bust the cache — with a 4s minimum delay this refresh can land
            // inside the 8s cache TTL and be skipped, hiding the added tracks.
            this._queueDataCache = null;
            if (popup?.classList.contains('visible')) this._showQueuePanel(this._queuePanelDirection);
          }
        }, delay);
      });
    });
  }
});

K.ready.video = true;
})();
