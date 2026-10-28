/*
 * Crow Media Player — Card editor
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.editor) return;
const { CROW_BUTTON_ICONS, CROW_MEDIA_RELAYS, CROW_MEDIA_SKINS, CROW_MEDIA_VERSION, CROW_MEDIA_VIZ_STYLES, CrowMediaClockDrawer, CrowMediaPlayerCard, CrowMediaVisualiser, crowFetch, crowMediaAiKind, crowMediaAiReason, crowMediaAppIconDb, crowMediaAppleLegacyMap, crowMediaAppleLegacyUrl, crowMediaAutoStart, crowMediaBridge, crowMediaRelays, crowMediaUserData } = K.kit;
const CROW_MEDIA_ISSUES_URL = 'https://github.com/jamesmcginnis/crow-media-player/issues';

const crowMediaHealth = {
  // a value by path, e.g. 'results.0.artworkUrl100'
  get(o, path) { return String(path).split('.').reduce((v, k) => (v == null ? v : v[k]), o); },
  missing(o, paths) { return paths.filter(p => { const v = crowMediaHealth.get(o, p); return v == null || v === ''; }); },
  async timed(fn, ms = 10000) {
    const t0 = performance.now();
    let timer;
    try {
      const v = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); })]);
      return { v, ms: performance.now() - t0 };
    } catch (e) { return { err: e, ms: performance.now() - t0 }; } finally { clearTimeout(timer); }
  },
  async json(url, opts = {}) {
    const r = await crowFetch(url, opts);
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  },
  jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__crowMediaHealthCb' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const done = () => { try { delete window[cb]; } catch (_) { window[cb] = undefined; } s.remove(); };
      window[cb] = d => { done(); resolve(d); };
      s.onerror = () => { done(); reject(new Error('blocked')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
      document.head.appendChild(s);
    });
  },
  // direct first, then the relays the card falls back to
  async jsonRelayed(url, valid = null) {
    const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    const ok = j => { if (!j || typeof j !== 'object' || (valid && !valid(j))) throw new Error('bad'); return j; };
    try { return { j: ok(await withTimeout(crowMediaHealth.json(url), 6000)), relayed: false }; } catch (_) {}
    try {
      return await Promise.any(crowMediaRelays().map(r => withTimeout(crowMediaHealth.json(r.url(url)), 9000)
        .then(j => ({ j: ok(r.unwrap ? r.unwrap(j) : j), relayed: r.name }))));
    } catch (_) { throw new Error('unreachable'); }
  },
  secs(ms) { return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; },

  // The checks. Each: group, name, on(cfg, hass) (or 'off reason' string), run(ctx) → { j, relayed, need, note, status }
  list() {
    const H = crowMediaHealth;
    const tmdbFetch = (cfg, url) => {
      const key = String(cfg.tmdb_api_key || '').trim(), bearer = key.startsWith('ey');
      return H.json(bearer ? url : url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key), bearer ? { headers: { Authorization: 'Bearer ' + key } } : {});
    };
    return [
      // Home Assistant
      { id: 'ha', group: 'Home Assistant', name: 'Home Assistant', run: async ({ hass }) => {
        if (!hass?.connection) return { status: 'fail', note: 'Not connected' };
        const v = hass.config?.version || '';
        return { status: 'ok', note: 'Connected' + (v ? ' (' + v + ')' : '') };
      } },
      { id: 'players', group: 'Home Assistant', name: 'Media players', run: async ({ hass, cfg }) => {
        const ents = (cfg.entities || []).map(e => typeof e === 'string' ? e : e?.entity).filter(Boolean);
        const found = ents.filter(e => hass?.states?.[e]);
        const away = found.filter(e => hass.states[e].state === 'unavailable');
        if (!ents.length) return { status: 'warn', note: 'No media players chosen' };
        if (found.length < ents.length) return { status: 'warn', note: (ents.length - found.length) + ' of ' + ents.length + ' chosen players no longer exist in Home Assistant' };
        if (away.length) return { status: 'warn', note: away.length + ' of ' + ents.length + ' unavailable right now' };
        return { status: 'ok', note: ents.length + ' found' };
      } },
      { id: 'ma', group: 'Home Assistant', name: 'Music Assistant', on: (cfg, hass) => !!hass?.services?.music_assistant || (cfg.ma_entities || []).length > 0 || 'Not installed (optional)', run: async ({ hass }) => {
        const ma = hass?.services?.music_assistant || {};
        const need = ['search', 'get_queue', 'play_media'].filter(s => !ma[s]);
        if (need.length) return { status: 'changed', note: 'Missing services the card uses: ' + need.join(', ') };
        if (!hass?.services?.mass_queue) return { status: 'warn', note: 'Working; the Music Assistant Queue integration isn’t installed, so queue reordering and audio quality aren’t available' };
        return { status: 'ok', note: 'Working, with queue features' };
      } },
      { id: 'ai', group: 'Home Assistant', name: 'AI agent', on: cfg => cfg.ai_features_enabled === true || 'AI Features is off', run: async ({ hass, cfg }) => {
        const agent = cfg.ai_conversation_agent || '';
        if (!agent || agent === 'conversation.home_assistant') return { status: 'warn', note: 'No AI agent chosen (the built-in assistant can’t answer music or film questions)' };
        const r = await hass.connection.sendMessagePromise({ type: 'conversation/agent/list' });
        const ids = (r?.agents || []).map(a => a.id);
        if (!ids.includes(agent) && !hass.states?.[agent]) return { status: 'fail', note: 'The chosen agent no longer exists' };
        return { status: 'ok', note: 'Agent found (use Test AI to check it answers)' };
      } },
      { id: 'tts', group: 'Home Assistant', name: 'Announcements (TTS)', on: cfg => !!cfg.announce_tts_service || 'Not set', run: async ({ hass, cfg }) => {
        // saved as "domain|service" (e.g. tts|speak) by the editor; "domain.service" is read too
        const svc = String(cfg.announce_tts_service || '');
        const [d, s] = svc.includes('|') ? svc.split('|') : svc.includes('.') ? svc.split('.') : ['tts', svc];
        if (hass?.services?.[d]?.[s]) return { status: 'ok', note: 'Found (' + d + '.' + s + ')' };
        const auto = hass?.services?.tts?.speak ? 'tts.speak' : '';
        return { status: 'fail', note: d + '.' + s + ' isn\u2019t in Home Assistant any more' + (auto ? ' - announcements use ' + auto + ' instead until you choose another in Announcements' : ' - choose another in Announcements') };
      } },
      { id: 'sendspin', group: 'Home Assistant', name: 'Play on This Device server', on: cfg => (cfg.sendspin_enabled === true && !!cfg.sendspin_url) || 'Off', run: async ({ cfg }) => {
        await crowFetch(String(cfg.sendspin_url).replace(/\/+$/, '') + '/', { mode: 'no-cors' });
        return { status: 'ok', note: 'Reachable' };
      } },
      // Music
      { id: 'mb', group: 'Music', name: 'MusicBrainz', run: async (ctx) => {
        const u = 'https://musicbrainz.org/ws/2/release-group/?query=' + encodeURIComponent('releasegroup:"A Night at the Opera" AND artist:Queen') + '&fmt=json&limit=1';
        // MusicBrainz answers 503 when it's asked too often (it allows about one request a second): wait and ask once more
        let j;
        try { j = await H.json(u); }
        catch (e) {
          if (e.status !== 503) throw e;
          await new Promise(r => setTimeout(r, 2500));
          try { j = await H.json(u); }
          catch (e2) { if (e2.status === 503) return { status: 'warn', note: 'Busy - MusicBrainz limits how often it can be asked. The card waits and tries again when it needs it; run the check again in a minute' }; throw e2; }
        }
        ctx.mbid = j?.['release-groups']?.[0]?.id || '';
        return { j, need: ['release-groups.0.id', 'release-groups.0.title'] };
      } },
      { id: 'caa', group: 'Music', name: 'Cover Art Archive', run: async (ctx) => {
        if (!ctx.mbid) return { status: 'skip', note: 'Skipped (needs MusicBrainz)' };
        const j = await H.json('https://coverartarchive.org/release-group/' + ctx.mbid);
        return { j, need: ['images.0.image'] };
      } },
      { id: 'discogs', group: 'Music', name: 'Discogs', run: async () => {
        const j = await H.json('https://api.discogs.com/database/search?artist=Queen&release_title=' + encodeURIComponent('A Night at the Opera') + '&type=release&per_page=1', { headers: { 'User-Agent': 'CrowMediaPlayerCard/1.0' } });
        return { j, need: ['results.0.id', 'results.0.title'] };
      } },
      { id: 'itunes', group: 'Music', name: 'iTunes Store', run: async () => {
        const j = await H.json('https://itunes.apple.com/search?term=' + encodeURIComponent('Queen Bohemian Rhapsody') + '&entity=musicTrack&limit=1');
        return { j, need: ['results.0.artworkUrl100', 'results.0.trackName'] };
      } },
      { id: 'lrclib', group: 'Music', name: 'LRCLIB (lyrics)', run: async () => {
        const j = await H.json('https://lrclib.net/api/search?track_name=' + encodeURIComponent('Bohemian Rhapsody') + '&artist_name=Queen');
        return { j, need: ['0.trackName', '0.plainLyrics'] };
      } },
      { id: 'deezer', group: 'Music', name: 'Deezer (charts and tempos)', run: async () => {
        const j = await H.jsonp('https://api.deezer.com/chart/0/tracks?limit=1');
        if (j?.error) return { status: 'fail', note: 'Answered with an error: ' + (j.error.message || 'unknown') };
        return { j, need: ['data.0.id', 'data.0.title', 'data.0.artist.name'] };
      } },
      { id: 'applecharts', timeout: 26000, group: 'Music', name: 'Apple Music and Podcasts charts', on: cfg => (cfg.feat_charts === true && cfg.charts_apple !== false) || cfg.feat_podcast_charts !== false || 'Charts are off', run: async ({ hass }) => {
        const cc = String(hass?.config?.country || 'gb').toLowerCase();
        const path = cc + '/music/most-played/{n}/songs.json';
        const within = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        try { const j = await within(H.json('https://rss.marketingtools.apple.com/api/v2/' + path.replace('{n}', 10)), 5000); if (j?.feed?.results) return { j, need: ['feed.results.0.name', 'feed.results.0.artworkUrl100'] }; } catch (_) {}
        try {
          const mapped = crowMediaAppleLegacyMap(await within(H.json(crowMediaAppleLegacyUrl(path, 10)), 5000));
          if (mapped) return { j: mapped, need: ['feed.results.0.name', 'feed.results.0.artworkUrl100'], note: 'Working (using Apple\u2019s older iTunes feed)' };
        } catch (_) {}
        try {
          const { j, relayed } = await H.jsonRelayed('https://rss.marketingtools.apple.com/api/v2/' + path.replace('{n}', 10), j => Array.isArray(j?.feed?.results));
          return { j, relayed, need: ['feed.results.0.name', 'feed.results.0.artworkUrl100'] };
        } catch (_) {
          return { status: 'warn', note: 'Apple\u2019s charts can\u2019t be reached from this device, so Deezer\u2019s charts are used instead (Top Songs, Top Albums and Top Podcasts)' };
        }
      } },
      { id: 'wiki', group: 'Music', name: 'Wikipedia', run: async () => {
        const j = await H.json('https://en.wikipedia.org/api/rest_v1/page/summary/Queen_(band)');
        return { j, need: ['title', 'extract', 'thumbnail.source'] };
      } },
      { id: 'wikidata', group: 'Music', name: 'Wikidata', run: async () => {
        const j = await H.json('https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities&ids=Q15862&props=labels&languages=en');
        return { j, need: ['entities.Q15862.labels.en.value'] };
      } },
      { id: 'radio', group: 'Music', name: 'Radio Browser', run: async () => {
        const j = await H.json('https://de1.api.radio-browser.info/json/stations/search?name=bbc&limit=1&hidebroken=true&order=votes&reverse=true');
        return { j, need: ['0.name', '0.url_resolved', '0.stationuuid'] };
      } },
      { id: 'archive', group: 'Music', name: 'Internet Archive (audiobooks)', run: async () => {
        const j = await H.json('https://archive.org/advancedsearch.php?q=' + encodeURIComponent('collection:librivoxaudio') + '&fl%5B%5D=identifier&fl%5B%5D=title&rows=1&output=json');
        return { j, need: ['response.docs.0.identifier'] };
      } },
      // Movies & TV
      { id: 'tmdb', group: 'Movies & TV', name: 'TMDB', on: cfg => !!String(cfg.tmdb_api_key || '').trim() || 'No key added (optional)', run: async ({ cfg }) => {
        try {
          const j = await tmdbFetch(cfg, 'https://api.themoviedb.org/3/search/movie?query=Heat&year=1995');
          return { j, need: ['results.0.id', 'results.0.title', 'results.0.poster_path'], note: 'Working, key accepted' };
        } catch (e) {
          if (e.status === 401) return { status: 'fail', note: 'Key not accepted - check it in Info Panels' };
          throw e;
        }
      } },
      { id: 'tvmaze', group: 'Movies & TV', name: 'TVmaze', run: async () => {
        const j = await H.json('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent('Breaking Bad'));
        return { j, need: ['0.show.id', '0.show.name'] };
      } },
      { id: 'epg', group: 'Movies & TV', name: 'UK TV guide (Freeview)', on: cfg => (cfg.feat_video_charts !== false && cfg.feat_tv_guide !== false) || 'TV Guide is off', run: async () => {
        const ctrl = new AbortController();
        // straight from GitHub, as the guide itself is fetched (it's too big to come through Home Assistant)
        const r = await crowFetch('https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml', { signal: ctrl.signal, headers: { Range: 'bytes=0-4095' }, crowDirect: true });
        if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        // just the start of the file: enough to see it's still the guide
        const rd = r.body?.getReader?.();
        let head = '';
        if (rd) { const { value } = await rd.read(); head = new TextDecoder().decode(value || new Uint8Array()); ctrl.abort(); }
        else head = (await r.text()).slice(0, 4096);
        return /<tv[\s>]/.test(head) && /<channel\b|<programme\b/.test(head) ? { status: 'ok', note: 'Working' } : { status: 'changed', note: 'The guide file has changed' };
      } },
      { id: 'atvapps', group: 'Home Assistant', name: 'Apple TV apps', on: (cfg, hass) => {
          if (cfg.atv_apps_button === false) return 'Apps Button is off';
          const ents = (cfg.entities || []).map(e => typeof e === 'string' ? e : e?.entity).filter(Boolean);
          const atv = ents.filter(e => { const st = hass?.states?.[e]; const n = (st?.attributes?.friendly_name || e).toLowerCase(); return st && (st.attributes?.device_class === 'tv' || /apple.?tv/.test(e) || n.includes('apple tv')); });
          return atv.length ? true : 'No Apple TV chosen';
        }, run: async ({ hass, cfg }) => {
          const ents = (cfg.entities || []).map(e => typeof e === 'string' ? e : e?.entity).filter(Boolean);
          const atv = ents.filter(e => { const st = hass?.states?.[e]; const n = (st?.attributes?.friendly_name || e).toLowerCase(); return st && (st.attributes?.device_class === 'tv' || /apple.?tv/.test(e) || n.includes('apple tv')); });
          const withApps = atv.map(e => ({ e, n: (hass.states[e]?.attributes?.source_list || []).length, name: hass.states[e]?.attributes?.friendly_name || e }));
          const ok = withApps.filter(x => x.n > 0);
          if (ok.length) return { status: 'ok', note: ok.map(x => x.name + ': ' + x.n + ' apps').join(', ') };
          const v = String(hass?.config?.version || ''), [yy, mm] = v.split('.').map(Number);
          const old = yy && (yy < 2026 || (yy === 2026 && mm < 7));
          return { status: 'warn', note: 'The Apple TV isn\u2019t sharing its app list' + (old ? ' - update Home Assistant to 2026.7 or later' : ' - check the Apple TV is awake, then reload its integration') };
        } },
      // Behind the scenes
      { id: 'weserv', group: 'Behind the Scenes', name: 'Image proxy (artwork in PDFs)', on: cfg => cfg.pdf_enabled !== false || 'PDF exports are off', run: async () => {
        const r = await crowFetch('https://images.weserv.nl/?url=' + encodeURIComponent('upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/120px-PNG_transparency_demonstration_1.png') + '&w=40');
        if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return /^image\//.test(r.headers.get('content-type') || '') ? { status: 'ok', note: 'Working' } : { status: 'changed', note: 'Didn’t return an image' };
      } },
      { id: 'relay', group: 'Behind the Scenes', name: 'Relays (Apple TV app icons, and sites that block the card)',
        // with the integration connected, Home Assistant fetches for the card and the relays are never used
        on: () => !crowMediaBridge.on || 'Not needed - Home Assistant fetches for the card', run: async ({ hass }) => {
        const test = 'https://itunes.apple.com/search?term=queen&entity=musicTrack&limit=1';
        const cc = String(hass?.config?.country || 'gb').toLowerCase();
        // What would fall back to a relay if it couldn't be read directly (Apple Music charts aren't here: they fall back to Deezer)
        const direct = [
          { name: 'Apple TV charts', go: async () => { const j = await H.json('https://itunes.apple.com/' + cc + '/rss/topmovies/limit=1/json'); if (!j?.feed) throw new Error('bad'); } },
          { name: 'TVmaze listings', go: async () => { const j = await H.json('https://api.tvmaze.com/schedule?country=' + cc.toUpperCase()); if (!Array.isArray(j)) throw new Error('bad'); } },
        ];
        const [res, dres] = await Promise.all([
          Promise.all(CROW_MEDIA_RELAYS.map(r => crowMediaHealth.timed(async () => {
            const j0 = await H.json(r.url(test)); const j = r.unwrap ? r.unwrap(j0) : j0;
            if (!j?.results?.[0]?.trackName) throw new Error('bad');
            return true;
          }, 9000).then(t => !t.err))),
          Promise.all(direct.map(d => crowMediaHealth.timed(d.go, 6000).then(t => !t.err))),
        ]);
        const n = res.filter(Boolean).length, names = CROW_MEDIA_RELAYS.filter((r, i) => res[i]).map(r => r.name);
        // Always worth testing: Apple TV app icons fall back to the relays whenever Apple refuses
        // lookups for being too many, even on a device that reaches Apple fine.
        const blocked = direct.filter((d, i) => !dres[i]).map(d => d.name);
        if (n) return { status: n >= 2 ? 'ok' : 'warn', note: n + ' of ' + CROW_MEDIA_RELAYS.length + ' working (' + names.join(', ') + ')' + (blocked.length ? '. Used here for ' + blocked.join(' and ') + ', which this device can\u2019t read directly' : '') };
        return { status: 'warn', note: 'None of the ' + CROW_MEDIA_RELAYS.length + ' relays answered, so Apple TV app icons may stay as letters when Apple is busy' + (blocked.length ? ', and ' + blocked.join(' and ') + ' can\u2019t be read from this device' : '') };
      } },
      { id: 'jspdf', group: 'Behind the Scenes', name: 'PDF library', on: cfg => cfg.pdf_enabled !== false || 'PDF exports are off', run: async () => {
        const r = await crowFetch('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', { method: 'HEAD' });
        return r.ok ? { status: 'ok', note: 'Working' } : { status: 'fail', note: 'Not reachable (HTTP ' + r.status + ')' };
      } },
    ];
  },

  // Runs every check (in parallel), calling onRow as each finishes. Results are kept for 10 minutes.
  async run({ hass, cfg }, onRow, { force = false } = {}) {
    const memo = window.__crowMediaHealthMemo;
    if (!force && memo && Date.now() - memo.at < 600000) { memo.rows.forEach(r => onRow?.(r)); return memo; }
    const ctx = { hass, cfg: cfg || {} };
    const checks = crowMediaHealth.list();
    const rows = [];
    const runOne = async c => {
      const on = c.on ? c.on(ctx.cfg, hass) : true;
      let row;
      if (on !== true) row = { id: c.id, group: c.group, name: c.name, status: 'off', note: on || 'Off' };
      else {
        const t = await crowMediaHealth.timed(() => c.run(ctx), c.timeout || 12000);
        if (t.err) {
          const e = t.err, msg = String(e?.message || e);
          row = { id: c.id, group: c.group, name: c.name, status: 'fail', ms: t.ms,
            note: msg === 'timeout' ? 'No answer within ' + Math.round((c.timeout || 12000) / 1000) + ' seconds'
              : e?.status === 429 ? 'Busy (too many requests) - try again in a minute'
              : e?.status ? 'Answered with an error (HTTP ' + e.status + ')'
              : 'Not reachable from this device' };
        } else {
          const v = t.v || {};
          let status = v.status, note = v.note;
          if (!status) {
            const miss = v.need ? crowMediaHealth.missing(v.j, v.need) : [];
            if (miss.length) { status = 'changed'; note = 'Its answer has changed (missing ' + miss.join(', ') + ') - the card may need an update'; }
            else { status = t.ms > 5000 && !v.relayed ? 'slow' : 'ok'; note = (note || 'Working') + (v.relayed ? ' through a relay (' + v.relayed + ')' : ''); }
          }
          if (v.soft && status === 'fail') status = 'warn';
          row = { id: c.id, group: c.group, name: c.name, status, ms: t.ms, note: note + (t.ms >= 50 && ['ok', 'slow'].includes(status) ? ' (' + crowMediaHealth.secs(t.ms) + ')' : '') };
        }
      }
      rows.push(row); onRow?.(row);
      return row;
    };
    // MusicBrainz first (Cover Art Archive needs its answer); everything else at once
    const mbFirst = checks.filter(c => c.id === 'mb'), after = checks.filter(c => c.id === 'caa'), rest = checks.filter(c => c.id !== 'mb' && c.id !== 'caa');
    await Promise.all([...rest.map(runOne), (async () => { for (const c of [...mbFirst, ...after]) await runOne(c); })()]);
    const order = checks.map(c => c.id);
    rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const res = { at: Date.now(), rows };
    window.__crowMediaHealthMemo = res;
    return res;
  },

  summary(rows) {
    const active = rows.filter(r => r.status !== 'off' && r.status !== 'skip');
    const ok = active.filter(r => r.status === 'ok').length, slow = active.filter(r => r.status === 'slow').length;
    const bad = active.filter(r => ['fail', 'changed', 'warn'].includes(r.status)).length;
    return ok + slow + ' of ' + active.length + ' working' + (slow ? ', ' + slow + ' slow' : '') + (bad ? ', ' + bad + ' need' + (bad === 1 ? 's' : '') + ' attention' : '');
  },

  async testAI(hass, cfg) {
    if (cfg?.ai_features_enabled !== true) return { status: 'off', note: 'AI Features is off' };
    const agent = cfg.ai_conversation_agent || '';
    if (!agent || agent === 'conversation.home_assistant') return { status: 'warn', note: 'No AI agent chosen' };
    const say = (kind) => { const [title, text] = crowMediaAiReason(kind); return title + ' - ' + text; };
    const t = await crowMediaHealth.timed(() => hass.connection.sendMessagePromise({ type: 'conversation/process', text: 'Reply with the single word OK and nothing else.', agent_id: agent, language: navigator.language || 'en' }), 30000);
    if (t.err) {
      const msg = String(t.err?.message || t.err?.code || t.err);
      const kind = msg === 'timeout' ? 'timeout' : crowMediaAiKind(msg);
      console.warn('[Crow Media Player AI] Test AI:', msg);
      return { status: 'fail', note: say(kind === 'error' ? 'offline' : kind), kind };
    }
    const resp = t.v?.response || {}, speech = String(resp?.speech?.plain?.speech || '');
    if (resp.response_type === 'error' || /^(sorry, i had a problem|error talking to|unexpected error during intent)/i.test(speech.trim())) {
      const kind = crowMediaAiKind(speech + ' ' + (resp?.data?.code || ''));
      console.warn('[Crow Media Player AI] Test AI error answer:', speech);
      return { status: kind === 'busy' ? 'warn' : 'fail', note: say(kind), kind };
    }
    if (!speech.trim()) return { status: 'fail', note: say('unreadable'), kind: 'unreadable' };
    return { status: t.ms > 8000 ? 'slow' : 'ok', note: 'Answered in ' + crowMediaHealth.secs(t.ms) + (/\bok\b/i.test(speech) ? '' : ' (with an unexpected reply: "' + speech.slice(0, 60) + '")') };
  },

  device() {
    const ua = navigator.userAgent || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    const iosV = (ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1, 3).join('.');
    const app = /Home Assistant\//i.test(ua) ? 'Home Assistant app' : /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return os + (iosV && /iPhone|iPad/.test(os) ? ' (iOS ' + iosV + ')' : '') + ', ' + app;
  },

  // The report: versions, device and settings in general terms (never keys, entity names or addresses)
  report(hass, cfg, health, ai) {
    cfg = cfg || {};
    const yes = v => (v ? 'on' : 'off');
    const auto = (typeof crowMediaAutoStart === 'function') ? crowMediaAutoStart(cfg) : { mode: 'off' };
    const lines = [
      '**Card:** v' + CROW_MEDIA_VERSION,
      '**Home Assistant:** ' + (hass?.config?.version || 'unknown'),
      '**Device:** ' + crowMediaHealth.device(),
      '**Players:** ' + ((cfg.entities || []).length) + ' chosen, ' + ((cfg.ma_entities || []).length) + ' Music Assistant',
      '**Settings:** AI ' + yes(cfg.ai_features_enabled === true)
        + ', TMDB key ' + (String(cfg.tmdb_api_key || '').trim() ? 'added' : 'not added')
        + ', songs try first: ' + (cfg.info_panel_priority || 'ai')
        + ', movies & TV try first: ' + (cfg.video_info_priority || 'ai')
        + ', matching: ' + (cfg.video_match === 'exact' || cfg.video_match === 'jellyfin' ? 'exact' : 'best guess')
        + ', charts ' + yes(cfg.feat_charts === true)
        + ', start automatically: ' + auto.mode
        + ', PDF exports ' + yes(cfg.pdf_enabled !== false)
        + ', Play on This Device ' + yes(cfg.sendspin_enabled === true),
    ];
    const mark = s => ({ ok: 'OK', slow: 'SLOW', warn: 'CHECK', changed: 'CHANGED', fail: 'FAILED', off: 'off', skip: 'skipped' }[s] || s);
    if (ai) lines.push('**Test AI:** ' + mark(ai.status) + ' - ' + ai.note);
    if (health?.rows?.length) {
      lines.push('', '**Health check** (' + new Date(health.at).toLocaleString() + '): ' + crowMediaHealth.summary(health.rows));
      health.rows.forEach(r => lines.push('- ' + mark(r.status) + ' - ' + r.name + ': ' + r.note));
    }
    return lines.join('\n');
  },
  issueBody(details) {
    return '### What happened\n<!-- What were you doing, and what went wrong? -->\n\n\n### What I expected\n\n\n### Steps to make it happen\n1. \n\n### Screenshot\n<!-- Drag a screenshot in here if you can. -->\n\n---\n' + details + '\n';
  },
  issueUrl(details) {
    const make = d => CROW_MEDIA_ISSUES_URL + '/new?title=' + encodeURIComponent('Problem: ') + '&body=' + encodeURIComponent(crowMediaHealth.issueBody(d));
    let url = make(details);
    if (url.length <= 7500) return { url, cut: false };
    // too long for a link: keep the versions, settings and anything that isn't working
    const short = details.split('\n').filter(l => !/^- (OK|off|skipped|SLOW) - /.test(l)).join('\n') + '\n\n_(Full report copied to the clipboard - paste it here.)_';
    url = make(short);
    return { url: url.length <= 7500 ? url : make('_(Report copied to the clipboard - paste it here.)_'), cut: true };
  },
};

// Static mood defaults for the visual editor — mirrors the hardcoded moods array
// so the editor can show defaults and detect overrides without instantiating the card.
function _getCrowMoodDefaults() {
  const m = [
    { emoji:'⚡', label:'Energetic',        maSearch:['The Prodigy','Fatboy Slim','Chemical Brothers','Daft Punk'] },
    { emoji:'💪', label:'Workout',          maSearch:['AC/DC','Rage Against the Machine','Metallica','Eminem'] },
    { emoji:'🔥', label:'Hype',             maSearch:['Travis Scott','Drake','Kendrick Lamar','Future'] },
    { emoji:'🚀', label:'Epic',             maSearch:['Hans Zimmer','John Williams','Ennio Morricone','Two Steps from Hell'] },
    { emoji:'🌙', label:'Chill',            maSearch:['Norah Jones','Jack Johnson','Ben Harper','Bon Iver'] },
    { emoji:'🧘', label:'Meditate',         maSearch:['Brian Eno','Moby','Sigur Ros','Max Richter'] },
    { emoji:'😴', label:'Sleep',            maSearch:['Brian Eno','Max Richter','Moby','Erik Satie'] },
    { emoji:'🌊', label:'Calm',             maSearch:['Norah Jones','Jack Johnson','Nick Drake','Jose Gonzalez'] },
    { emoji:'🎯', label:'Focus',            maSearch:['Brian Eno','Bonobo','Tycho','Explosions in the Sky'] },
    { emoji:'📖', label:'Study',            maSearch:['Nujabes','J Dilla','Bonobo','Madlib'] },
    { emoji:'💡', label:'Creative',         maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'] },
    { emoji:'❤️', label:'Romantic',        maSearch:['Frank Sinatra','Norah Jones','Michael Buble','Adele'] },
    { emoji:'😢', label:'Melancholic',      maSearch:['Elliott Smith','Nick Drake','Sufjan Stevens','Bon Iver'] },
    { emoji:'😂', label:'Happy',            maSearch:['Pharrell Williams','Bruno Mars','Justin Timberlake','Katy Perry'] },
    { emoji:'😤', label:'Angry',            maSearch:['The Clash','Sex Pistols','Ramones','Green Day'] },
    { emoji:'🎉', label:'Party',            maSearch:'Dua Lipa', query:'Now That\'s What I Call Party|Party Anthems|Party Hits|Essential Party|Best Party Songs' },
    { emoji:'🕺', label:'Dance',            maSearch:'Daft Punk', query:'Now That\'s What I Call Dance|Dance Anthems|Dance Classics|Essential Dance|Dance Hits' },
    { emoji:'🍻', label:'Pub Night',        maSearch:'The Pogues', query:'Pub Classics|Pub Anthems|Sing-Along Classics|Pub Songs|Classic Sing-Along Hits' },
    { emoji:'🎸', label:'Rock',             maSearch:'The Rolling Stones', query:'Now That\'s What I Call Rock|Essential Rock|Rock Classics|Rock Anthems|Classic Rock Hits' },
    { emoji:'🤘', label:'Metal',            maSearch:'Metallica', query:'Now That\'s What I Call Metal|Essential Metal|Metal Classics|Heavy Metal Hits|Metal Anthems' },
    { emoji:'🎵', label:'Pop',              maSearch:'Taylor Swift', query:'Now That\'s What I Call Music|Pop Hits|Essential Pop|Pop Classics|Greatest Pop Hits' },
    { emoji:'🎷', label:'Jazz',             maSearch:'Miles Davis', query:'Essential Jazz|Jazz Classics|Jazz Standards|Best Of Jazz|Smooth Jazz Hits' },
    { emoji:'🎻', label:'Classical',        maSearch:'Ludwig van Beethoven', query:'Essential Classical|Classical Masterpieces|Best Of Classical|Classical Hits|BBC Classical' },
    { emoji:'🎤', label:'Hip Hop',          maSearch:'Kendrick Lamar', query:'Now That\'s What I Call Hip Hop|Essential Hip Hop|Hip Hop Classics|Best Of Hip Hop|Rap Hits' },
    { emoji:'🎹', label:'Electronic',       maSearch:'Daft Punk', query:'Now That\'s What I Call Dance|Essential Electronic|Dance Classics|Electronic Hits|Dance Anthems' },
    { emoji:'🪕', label:'Country',          maSearch:'Johnny Cash', query:'Essential Country|Country Classics|Country Hits|Now Country|Best Of Country' },
    { emoji:'🎺', label:'Blues',            maSearch:'B.B. King', query:'Essential Blues|Blues Classics|Best Of Blues|Blues Hits|Electric Blues' },
    { emoji:'🎙️',label:'Soul',             maSearch:'Aretha Franklin', query:'Essential Soul|Soul Classics|Soul Hits|Best Of Soul|Motown Classics' },
    { emoji:'🪗', label:'Folk',             maSearch:'Bob Dylan', query:'Essential Folk|Folk Classics|Folk Hits|Acoustic Folk|Best Of Folk' },
    { emoji:'🌍', label:'World',            maSearch:'Buena Vista Social Club', query:'Essential World Music|World Music Classics|Global Hits|World Beats' },
    { emoji:'🌅', label:'Morning',          maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'] },
    { emoji:'🌇', label:'Evening',          maSearch:['James Taylor','Paul Simon','Carole King','Cat Stevens'] },
    { emoji:'🌧️',label:'Rainy Day',        maSearch:['Bon Iver','Fleet Foxes','Iron and Wine','Sufjan Stevens'] },
    { emoji:'☀️', label:'Summer',           maSearch:['The Beach Boys','Jack Johnson','Vampire Weekend','Weezer'] },
    { emoji:'🍂', label:'Autumn',           maSearch:['Bon Iver','Fleet Foxes','Iron and Wine','Sufjan Stevens'] },
    { emoji:'❄️', label:'Winter',           maSearch:'James Taylor' },
    { emoji:'🌸', label:'Spring',           maSearch:['Coldplay','U2','Arcade Fire','Fleetwood Mac'] },
    { emoji:'🎙', label:'Acoustic',         maSearch:'James Taylor', query:'Acoustic Hits|Acoustic Classics|Unplugged|Acoustic Sessions|Acoustic Favourites' },
    { emoji:'🌿', label:'Indie',            maSearch:'Radiohead', query:'Now That\'s What I Call Indie|Essential Indie|Indie Classics|Indie Hits|Indie Anthems' },
    { emoji:'🎤', label:'R&B',              maSearch:'Marvin Gaye', query:'Essential R&B|R&B Classics|Best Of R&B|R&B Hits|Soul R&B' },
    { emoji:'🌴', label:'Reggae',           maSearch:'Bob Marley', query:'Essential Reggae|Reggae Classics|Reggae Hits|Best Of Reggae|Roots Reggae' },
    { emoji:'💃', label:'Latin',            maSearch:'Carlos Santana', query:'Essential Latin|Latin Hits|Latin Classics|Best Of Latin|Latin Pop Hits' },
    { emoji:'🎹', label:'Piano',            maSearch:'Bill Evans', query:'Piano Classics|Essential Piano|Piano Hits|Best Of Piano|Classical Piano' },
    { emoji:'🎮', label:'Gaming',           maSearch:['Nobuo Uematsu','Koji Kondo','Austin Wintory','Jesper Kyd'] },
    { emoji:'🍷', label:'Dinner',           maSearch:'Miles Davis' },
    { emoji:'🚗', label:'Road Trip',        maSearch:'The Rolling Stones' },
    { emoji:'📼', label:'Nostalgic',        maSearch:['The Beatles','The Rolling Stones','Fleetwood Mac','The Eagles'] },
    { emoji:'💔', label:'Heartbreak',       maSearch:['Elliott Smith','Nick Drake','Sufjan Stevens','Bon Iver'] },
    { emoji:'👑', label:'Confidence',       maSearch:['Queen','Bon Jovi','U2','Foo Fighters'] },
    { emoji:'🎙️',label:'50s',              maSearch:['Chuck Berry','Elvis Presley','Bill Haley','Little Richard','Buddy Holly','Jerry Lee Lewis','Bo Diddley','The Everly Brothers','Fats Domino','Eddie Cochran'], query:'UK Number 1s 1950s|Now That\'s What I Call The 50s|50s Greatest Hits|Rock And Roll Hits 1950s' },
    { emoji:'🕰️',label:'60s',              maSearch:['The Rolling Stones','The Beatles','The Kinks','The Who','The Beach Boys','The Supremes','Otis Redding','Small Faces','The Animals','Dusty Springfield'], query:'UK Number 1s 1960s|Now That\'s What I Call The 60s|60s Greatest Hits|Swinging Sixties Hits' },
    { emoji:'🪩', label:'70s',              maSearch:['Queen','ABBA','David Bowie','The Clash','Donna Summer','Elton John','Led Zeppelin','The Bee Gees','Blondie','Electric Light Orchestra'], query:'UK Number 1s 1970s|Now That\'s What I Call The 70s|70s Greatest Hits|Top Of The Pops 1970s' },
    { emoji:'📼', label:'80s',              maSearch:['Duran Duran','Wham!','Depeche Mode','A-ha','Bananarama','Culture Club','Cyndi Lauper','Madness','The Human League','New Order','Frankie Goes to Hollywood','Kim Wilde'], query:'UK Number 1s 1980s|Now That\'s What I Call The 80s|80s Greatest Hits|Top Of The Pops 1980s' },
    { emoji:'💽', label:'90s',              maSearch:['Oasis','Blur','Pulp','Elastica','Spice Girls','TLC','Ace of Base','No Doubt','Alanis Morissette','Backstreet Boys','Supergrass','Shed Seven'], query:'UK Number 1s 1990s|Now That\'s What I Call The 90s|90s Greatest Hits|Top Of The Pops 1990s' },
    { emoji:'📱', label:'2000s',            maSearch:['The Killers','Coldplay','Arctic Monkeys','Kaiser Chiefs','Franz Ferdinand','Razorlight','Amy Winehouse','Justin Timberlake','Nelly Furtado','Kelly Clarkson','Keane','Snow Patrol'], query:'UK Number 1s 2000s|Now That\'s What I Call The 2000s|00s Greatest Hits|Top Of The Pops 2000s' },
    { emoji:'🎧', label:'2010s',            maSearch:['Arctic Monkeys','Dua Lipa','Bruno Mars','Pharrell Williams','Lorde','Tame Impala','The 1975','Disclosure','Years and Years','Mark Ronson','Bastille','Clean Bandit'], query:'UK Number 1s 2010s|Now That\'s What I Call The 2010s|2010s Greatest Hits|Best Of The 2010s' },
    { emoji:'📲', label:'2020s',            maSearch:['Dua Lipa','Harry Styles','Glass Animals','Olivia Rodrigo','The Weeknd','Silk Sonic','Doja Cat','Billie Eilish','Lizzo','Arlo Parks','Little Simz','Joy Crookes'], query:'UK Number 1s 2020s|Now That\'s What I Call The 2020s|2020s Hits|Best Of 2020s' },
    { emoji:'🔊', label:'Power Up',         maSearch:['Queen','Bon Jovi','U2','Foo Fighters'] },
    { emoji:'🌃', label:'Late Night',       maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'🎭', label:'Dramatic',         maSearch:['Hans Zimmer','John Williams','Ludwig van Beethoven','Wolfgang Amadeus Mozart'] },
    { emoji:'🧊', label:'Ice Cold',         maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'🌸', label:'Gentle',           maSearch:'James Taylor' },
    { emoji:'🧠', label:'Deep Work',        maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'☕', label:'Morning Coffee',   maSearch:['Astrud Gilberto','Antonio Carlos Jobim','Stan Getz','João Gilberto'] },
    { emoji:'🌙', label:'Midnight',         maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'🏖️',label:'Holiday',          maSearch:['Harry Belafonte','Bob Marley','Buena Vista Social Club','Manu Chao'] },
    { emoji:'🍕', label:'Friday Night',     maSearch:'Taylor Swift' },
    { emoji:'😌', label:'Content',          maSearch:['Pharrell Williams','Bruno Mars','Justin Timberlake','Katy Perry'] },
    { emoji:'🤔', label:'Thoughtful',       maSearch:['Nick Drake','Elliott Smith','Joni Mitchell','James Taylor'] },
    { emoji:'🏃', label:'Running',          maSearch:'The Rolling Stones' },
    { emoji:'🔥', label:'Beast Mode',       maSearch:'Metallica' },
    { emoji:'⚡', label:'Adrenaline',       maSearch:'The Rolling Stones' },
    { emoji:'💪', label:'Pump Up',          maSearch:'The Rolling Stones' },
    { emoji:'🥊', label:'Fierce',           maSearch:'Metallica' },
    { emoji:'💻', label:'Coding',           maSearch:['Nujabes','J Dilla','Bonobo','Madlib'] },
    { emoji:'📖', label:'Reading',          maSearch:'James Taylor' },
    { emoji:'🌊', label:'Flow State',       maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'🎼', label:'Instrumental',     maSearch:['Brian Eno','Explosions in the Sky','Godspeed You Black Emperor','Mogwai'] },
    { emoji:'🧘', label:'Mindful',          maSearch:['Brian Eno','Moby','Sigur Ros','Max Richter'] },
    { emoji:'🎸', label:'Classic Rock',     maSearch:'AC/DC', query:'Classic Rock Anthems|Now That\'s What I Call Classic Rock|Essential Classic Rock|Rock Classics 70s 80s|Arena Rock Hits' },
    { emoji:'🪩', label:'Disco',            maSearch:'Donna Summer', query:'Disco Classics|Essential Disco|Best Of Disco|Disco Hits|Disco Fever' },
    { emoji:'🌍', label:'Afrobeats',        maSearch:'Burna Boy', query:'Essential Afrobeats|Afrobeats Hits|Best Of Afrobeats|Afrobeats Classics' },
    { emoji:'🎤', label:'K-Pop',            maSearch:'BTS', query:'Essential K-Pop|K-Pop Hits|Best Of K-Pop|K-Pop Classics' },
    { emoji:'🥁', label:'Drum & Bass',      maSearch:'Pendulum', query:'Essential Drum And Bass|Drum And Bass Hits|DNB Classics|Liquid Drum And Bass' },
    { emoji:'🇬🇧',label:'UK Garage',       maSearch:'Craig David', query:'Essential UK Garage|UK Garage Classics|UK Garage Hits|2 Step Classics' },
    { emoji:'🎙️',label:'Grime',            maSearch:'Stormzy', query:'Essential Grime|Grime Classics|Grime Hits|Best Of Grime|UK Grime' },
    { emoji:'🎹', label:'Synthpop',         maSearch:'Depeche Mode', query:'Essential Synthpop|Synthpop Classics|New Wave Hits|Synth Pop Classics|80s Electronic Hits' },
    { emoji:'😢', label:'Emo',              maSearch:'My Chemical Romance', query:'Essential Emo|Emo Classics|Best Of Emo|Emo Hits|Post-Hardcore Classics' },
    { emoji:'🍖', label:'BBQ',              maSearch:'The Beach Boys', query:'BBQ Classics|Garden Party|Summer Party Hits|Outdoor Anthems|Feel Good Summer' },
    { emoji:'☕', label:'Sunday Morning',   maSearch:'James Taylor', query:'Sunday Morning|Lazy Sunday|Easy Sunday|Sunday Vibes|Morning Coffee Playlist' },
    { emoji:'🥂', label:'Pre-Drinks',       maSearch:'Taylor Swift', query:'Pre-Drinks Anthems|Getting Ready Playlist|Pre-Party Hits|Pump Up Anthems|Getting Ready' },
    { emoji:'🛁', label:'Bath / Spa',       maSearch:['Brian Eno','Moby','Aphex Twin','Stars of the Lid'] },
    { emoji:'🍳', label:'Cooking',          maSearch:'Taylor Swift', query:'Cooking Classics|Kitchen Vibes|Cooking Music|Happy Background Music|Cooking Playlist' },
    { emoji:'🌟', label:'Euphoric',         maSearch:'Daft Punk' },
    { emoji:'🍂', label:'Bittersweet',      maSearch:'Radiohead' },
    { emoji:'💫', label:'Empowered',        maSearch:'Taylor Swift' },
    { emoji:'🌻', label:'Nostalgic (Warm)', maSearch:['The Beatles','The Rolling Stones','Fleetwood Mac','The Eagles'] },
    // Binaural & Noise
    { emoji:'🤍', label:'White Noise',  maSearch:['White Noise','White Noise Sleep','White Noise Focus'] },
    { emoji:'🌸', label:'Pink Noise',   maSearch:['Pink Noise','Pink Noise Sleep','Pink Noise Relaxation'] },
    { emoji:'🟤', label:'Brown Noise',  maSearch:['Brown Noise','Brown Noise Focus','Brown Noise ADHD'] },
    { emoji:'🌿', label:'Green Noise',  maSearch:['Green Noise','Nature Sounds','Green Noise Relaxation'] },
    { emoji:'🧠', label:'Delta Waves',  maSearch:['Delta Waves','Delta Binaural Beats','Deep Sleep Binaural'] },
    { emoji:'💭', label:'Theta Waves',  maSearch:['Theta Waves','Theta Binaural Beats','Meditation Binaural'] },
    { emoji:'🎯', label:'Alpha Waves',  maSearch:['Alpha Waves','Alpha Binaural Beats','Focus Binaural'] },
    { emoji:'⚡', label:'Beta Waves',   maSearch:['Beta Waves','Beta Binaural Beats','Concentration Binaural'] },
    { emoji:'🔮', label:'Gamma Waves',  maSearch:['Gamma Waves','Gamma Binaural Beats','Peak Focus Binaural'] },
  ];
  return m;
}

const _CROW_MOOD_CATEGORIES = [
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

class CrowMediaPlayerCardEditor extends HTMLElement {
  // keeping things in Home Assistant: with the integration, on unless switched off
  _persistOn(k) {
    const v = this._config?.[k + '_persistent_storage'];
    return crowMediaBridge.on ? v !== false : v === true;
  }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) this.render();
  }



  setConfig(config) {
    // Merge with defaults so toggles show correct state even when keys aren't in YAML
    this._config = {
      auto_switch: true, show_entity_selector: true, show_vol_pct: true,
      scroll_text: false, use_ha_theme: false, remember_view: false,
      remember_last_entity: false, lyrics_persist: false, lyrics_cache_enabled: true,
      lyrics_persistent_storage: true,
      pins_persistent_storage: true,
      show_pins_in_sections: true,
      ai_info_persistent_storage: true,
      itunes_persistent_storage: true,
      wiki_persistent_storage: true,
      ma_library_cache_enabled: true,
      ma_radio_mode: false, ambient_glow: false, row_glow: false, row_swipes: true, keyboard_shortcuts: true, screensaver: false, screensaver_style: 'wall', screensaver_after: 10, screensaver_clock: true, screensaver_dial: 'luxury', music_visual: 'artwork', music_visual_style: 'eq', qm_visualiser: true, qm_screensaver: true, video_match: 'standard', screensaver_weather: '',
      show_remote_button: true,
      artwork_crossfade: false, show_ma_library_button: true,
      resize_btn_spin: true, pin_hearts: true, remote_art_blur: true, volume_hud: true,
      itunes_art: true, controls_theme: 'classic', add_pill_color: '', card_liquid_glass: true, appearance: 'auto', volume_hud_glass: false,
      ai_features_enabled: false, skin: '', skin_menu: true,
      ...config
    };
    // Once the editor is rendered, never re-render from setConfig.
    // All DOM state (search filter, checkboxes, vol toggles) is managed directly.
    if (!this._initialized && this._hass) this.render();
  }

  updateUI() {
    const root = this.shadowRoot;
    if (!root) return;
    // Sync colour cards
    this.shadowRoot.querySelectorAll('.colour-card').forEach(card => {
      const key       = card.dataset.key;
      const savedVal  = this._config[key] || '';
      const swatchVal = savedVal || card.querySelector('.colour-hex').placeholder;
      card.querySelector('.colour-swatch-preview').style.background = swatchVal;
      card.querySelector('.colour-dot').style.background            = swatchVal;
      card.querySelector('input[type=color]').value = /^#[0-9a-fA-F]{6}$/.test(swatchVal) ? swatchVal : swatchVal.substring(0,7);
      card.querySelector('.colour-hex').value = savedVal;
    });
    const autoSwitchInput = root.getElementById('auto_switch');
    if (autoSwitchInput) autoSwitchInput.checked = this._config.auto_switch !== false;
    const rememberRow = root.getElementById('remember_last_entity_row');
    const rememberInput = root.getElementById('remember_last_entity');
    if (rememberInput) rememberInput.checked = this._config.remember_last_entity === true;
    if (rememberRow) rememberRow.style.display = this._config.auto_switch !== false ? 'none' : '';
    const showSelectorInput = root.getElementById('show_entity_selector');
    if (showSelectorInput) showSelectorInput.checked = this._config.show_entity_selector !== false;
    const volBtnInput = root.getElementById('volume_control_btn');
    if (volBtnInput) volBtnInput.checked = this._config.volume_control === 'buttons';
    const showVolPctInput = root.getElementById('show_vol_pct');
    if (showVolPctInput) showVolPctInput.checked = this._config.show_vol_pct !== false;
    const scrollTextInput = root.getElementById('scroll_text');
    if (scrollTextInput) scrollTextInput.checked = this._config.scroll_text === true;
    const useHaThemeInput = root.getElementById('use_ha_theme');
    if (useHaThemeInput) useHaThemeInput.checked = this._config.use_ha_theme === true;
    // Dim colour pickers when HA theme mode is active
    const colourGrid = root.getElementById('colour-grid');
    const haThemeWarn = root.getElementById('ha-theme-colour-warn');
    // Detect light vs dark HA theme — same robust (text-colour-based, bg-based fallback)
    // method used at runtime in _applyHaTheme(), so the editor and the live card always agree.
    const _editorDetectIsLight = () => {
      const docStyle = getComputedStyle(document.body);
      const get = (v, fallback) => { const val = docStyle.getPropertyValue(v).trim(); return val || fallback; };
      const bgTrim = get("--primary-background-color", get("--card-background-color", "#ffffff")).replace(/\s/g,'');
      let isLightFromBg = false;
      const rgbMatch = bgTrim.match(/rgb\((\d+),(\d+),(\d+)\)/);
      const hexMatch = bgTrim.match(/^#([0-9a-fA-F]{3,8})$/);
      if (rgbMatch) {
        isLightFromBg = (+rgbMatch[1] + +rgbMatch[2] + +rgbMatch[3]) / 3 >= 128;
      } else if (hexMatch) {
        const h = hexMatch[1].length === 3 ? hexMatch[1].split('').map(c => c+c).join('') : hexMatch[1].slice(0,6);
        isLightFromBg = (parseInt(h.slice(0,2),16) + parseInt(h.slice(2,4),16) + parseInt(h.slice(4,6),16)) / 3 >= 128;
      }
      const primaryText = get("--primary-text-color", isLightFromBg ? "#111111" : "#ffffff").replace(/\s/g,'');
      const ptHex = primaryText.match(/^#([0-9a-fA-F]{6})$/);
      const ptRgb = primaryText.match(/^rgba?\((\d+),(\d+),(\d+)/);
      if (ptHex) {
        const avg = (parseInt(ptHex[1].slice(0,2),16) + parseInt(ptHex[1].slice(2,4),16) + parseInt(ptHex[1].slice(4,6),16)) / 3;
        return avg < 128;
      }
      if (ptRgb) return ((+ptRgb[1] + +ptRgb[2] + +ptRgb[3]) / 3) < 128;
      return isLightFromBg;
    };
    const cardGlassNote  = root.getElementById('cardGlassDisabledNote');
    ['classic', 'glass'].forEach(v => {
      const el = root.getElementById('cs_' + v);
      if (el) el.checked = (this._config.card_liquid_glass !== false ? 'glass' : 'classic') === v;
    });
    ['auto', 'light', 'dark'].forEach(v => {
      const el = root.getElementById('ap_' + v);
      if (el) el.checked = (this._config.appearance || 'auto') === v;
    });
    const _applyCardGlassAvailability = (haOn) => {
      // Glass becomes a no-op whenever Follow HA Theme is on, the Theme override above is
      // still Auto, and the current HA theme is light — a solid theme-matched background is
      // used instead for readability (see _applyHaTheme()). Not disabled, just noted — Theme
      // is the way round it, so the control stays interactive.
      const overridden = this._config.appearance === 'light' || this._config.appearance === 'dark';
      const disable = haOn && !overridden && _editorDetectIsLight();
      if (cardGlassNote) cardGlassNote.style.display = disable ? 'block' : 'none';
    };
    const _applyHaThemeUi = (on) => {
      if (colourGrid) {
        // When HA theme is on, only lock non-accent colour pickers.
        // Accent and volume accent remain editable as personal touches.
        colourGrid.querySelectorAll('.colour-card').forEach(item => {
          const key = item.dataset.key;
          const isAccent = key === 'accent_color' || key === 'volume_accent';
          item.style.opacity = (on && !isAccent) ? '0.35' : '1';
          item.style.pointerEvents = (on && !isAccent) ? 'none' : '';
        });
      }
      if (haThemeWarn) haThemeWarn.style.display = on ? 'block' : 'none';
      _applyCardGlassAvailability(on);
    };
    _applyHaThemeUi(this._config.use_ha_theme === true);
    this._applyHaThemeUi = _applyHaThemeUi; // also needed by the toggle's change handler
    const lyricsScrollMode = this._config.lyrics_scroll_mode || 'highlight';
    ['highlight', 'scroll', 'none'].forEach(v => {
      const el = root.getElementById('lsm_' + v);
      if (el) el.checked = lyricsScrollMode === v;
    });
    const lyricsPersistInput = root.getElementById('lyrics_persist');
    if (lyricsPersistInput) lyricsPersistInput.checked = this._config.lyrics_persist === true;
    const lyricsCacheEnabledInput = root.getElementById('lyrics_cache_enabled');
    const lyricsCacheTtlSection   = root.getElementById('lyrics-cache-ttl-section');
    if (lyricsCacheEnabledInput) lyricsCacheEnabledInput.checked = this._config.lyrics_cache_enabled !== false;
    if (lyricsCacheTtlSection) {
      lyricsCacheTtlSection.style.opacity      = this._config.lyrics_cache_enabled !== false ? '1' : '0.35';
      lyricsCacheTtlSection.style.pointerEvents = this._config.lyrics_cache_enabled !== false ? '' : 'none';
    }
    const lyricsCacheTtl = this._config.lyrics_cache_ttl ?? 7;
    [1, 3, 7, 30].forEach(v => {
      const el = root.getElementById('lct_' + v);
      if (el) el.checked = lyricsCacheTtl === v;
    });
    const lyricsPersistentStorageInput = root.getElementById('lyrics_persistent_storage');
    if (lyricsPersistentStorageInput) lyricsPersistentStorageInput.checked = this._persistOn('lyrics');
    const pinsPersistentStorageInput = root.getElementById('pins_persistent_storage');
    if (pinsPersistentStorageInput) pinsPersistentStorageInput.checked = this._persistOn('pins');
    const showPinsInSectionsInput = root.getElementById('show_pins_in_sections');
    if (showPinsInSectionsInput) showPinsInSectionsInput.checked = this._config.show_pins_in_sections !== false;
    const aiInfoPersistentStorageInput = root.getElementById('ai_info_persistent_storage');
    if (aiInfoPersistentStorageInput) aiInfoPersistentStorageInput.checked = this._persistOn('ai_info');
    const itunesPersistentStorageInput = root.getElementById('itunes_persistent_storage');
    if (itunesPersistentStorageInput) itunesPersistentStorageInput.checked = this._persistOn('itunes');
    const wikiPersistentStorageInput = root.getElementById('wiki_persistent_storage');
    if (wikiPersistentStorageInput) wikiPersistentStorageInput.checked = this._persistOn('wiki');
    // MA library cache initial state
    const maLibCacheEnabledInit = root.getElementById('ma_library_cache_enabled');
    if (maLibCacheEnabledInit) maLibCacheEnabledInit.checked = this._config.ma_library_cache_enabled !== false;
    const maLibCacheTtlInit = this._config.ma_library_cache_ttl ?? 1;
    [1, 3, 7, 30].forEach(v => {
      const el = root.getElementById('mlct_' + v);
      if (el) el.checked = maLibCacheTtlInit === v;
    });
    const startupMode = this._config.startup_mode || 'compact';
    ['compact','maximised','remote'].forEach(v => {
      const el = root.getElementById('sm_' + v);
      if (el) el.checked = startupMode === v;
    });

    const rememberViewEl = root.getElementById('remember_view');
    if (rememberViewEl) rememberViewEl.checked = this._config.remember_view === true;
    const seg = root.getElementById('startup-mode-segmented');
    if (seg) seg.style.opacity = this._config.remember_view ? '0.4' : '1';
    const remoteButtonsPos = this._config.remote_buttons_position || 'bottom';
    ['top', 'bottom'].forEach(v => {
      const el = root.getElementById('rbp_' + v);
      if (el) el.checked = remoteButtonsPos === v;
    });
  }

  render() {
    if (!this._hass || !this._config) return;
    this._initialized = true;
    const selected = this._config.entities || [];
    const others = Object.keys(this._hass.states)
      .filter(e => e.startsWith('media_player.') && !selected.includes(e) && this._hass.states[e] != null)
      .sort();
    const sortedList = [...selected, ...others];

    this.shadowRoot.innerHTML = `
      <style>
        .container { display: flex; flex-direction: column; gap: 20px; padding: 12px; color: var(--primary-text-color); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; position: relative; }
        .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px; word-break: break-word; }
        .editor-tooltip { position:relative; display:inline-flex; align-items:center; }
        .editor-tooltip .tooltip-icon { width:14px;height:14px;border-radius:50%;background:rgba(99,179,237,0.15);border:1px solid rgba(99,179,237,0.3);color:rgba(99,179,237,0.7);font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;margin-left:5px;user-select:none; }
        .editor-tooltip .tooltip-text { display:none;position:absolute;left:0;top:20px;z-index:100;background:rgba(28,28,30,0.97);border:1px solid rgba(99,179,237,0.2);border-radius:8px;padding:7px 10px;font-size:11px;color:#ccc;line-height:1.5;width:220px;box-shadow:0 4px 16px rgba(0,0,0,0.4); }
        .editor-tooltip .tooltip-icon:focus + .tooltip-text, .editor-tooltip:hover .tooltip-text { display:block; }
        .colour-preview-strip { display:flex;gap:4px;margin:8px 0;height:6px;border-radius:4px;overflow:hidden; }
        .card-block { background: var(--card-background-color); border: 1px solid var(--divider-color, rgba(128,128,128,0.2)); border-radius: 12px; overflow: hidden; }

        /* ── Buttons: one plain style in the theme's own colours; the icon comes from the style, so it stays when a label changes ── */
        .crow-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1.2;
          cursor: pointer; color: var(--primary-text-color, #111); background: transparent; border: 1px solid var(--divider-color, rgba(128,128,128,0.3)); border-radius: 10px; padding: 9px 12px;
          -webkit-tap-highlight-color: transparent; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; text-align: center; }
        .crow-btn:hover { background: color-mix(in srgb, var(--primary-text-color, #111) 6%, transparent); }
        .crow-btn:active { background: color-mix(in srgb, var(--primary-text-color, #111) 12%, transparent); }
        .crow-btn:disabled { opacity: 0.5; cursor: default; }
        .crow-btn.sm { padding: 5px 10px; border-radius: 8px; font-weight: 500; white-space: nowrap; gap: 5px; }
        .crow-btn.wide { width: 100%; }
        .crow-btn.danger { color: var(--error-color, #db4437); border-color: color-mix(in srgb, var(--error-color, #db4437) 45%, transparent); }
        .crow-btn.danger:hover { background: color-mix(in srgb, var(--error-color, #db4437) 8%, transparent); }
        .crow-btn.danger:active { background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); }
        .crow-btn.armed, .crow-btn.armed:hover { background: var(--error-color, #db4437); border-color: var(--error-color, #db4437); color: #fff; }
        .crow-btn[data-ic]::before { content: ''; flex-shrink: 0; width: 15px; height: 15px; background: currentColor; -webkit-mask: var(--ic) center / contain no-repeat; mask: var(--ic) center / contain no-repeat; }
        .crow-btn.sm[data-ic]::before { width: 14px; height: 14px; }
        .crow-btn > ha-icon, .crow-btn > svg { display: none !important; }
        .crow-btn[data-ic="delete"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="copy"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="open"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="refresh"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="restore"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="bug"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14,12H10V10H14M14,16H10V14H14M20,8H17.19C16.74,7.22 16.12,6.55 15.37,6.04L17,4.41L15.59,3L13.42,5.17C12.96,5.06 12.5,5 12,5C11.5,5 11.04,5.06 10.59,5.17L8.41,3L7,4.41L8.62,6.04C7.88,6.55 7.26,7.22 6.81,8H4V10H6.09C6.04,10.33 6,10.66 6,11V12H4V14H6V15C6,15.34 6.04,15.67 6.09,16H4V18H6.81C7.85,19.79 9.78,21 12,21C14.22,21 16.15,19.79 17.19,18H20V16H17.91C17.96,15.67 18,15.34 18,15V14H20V12H18V11C18,10.66 17.96,10.33 17.91,10H20V8Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="stethoscope"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M19,8C19.56,8 20,8.43 20,9A1,1 0 0,1 19,10C18.43,10 18,9.55 18,9C18,8.43 18.43,8 19,8M2,2V11C2,13.96 4.19,16.5 7.14,16.91C7.76,19.92 10.42,22 13.5,22A6.5,6.5 0 0,0 20,15.5V11.81C21.16,11.39 22,10.29 22,9A3,3 0 0,0 19,6A3,3 0 0,0 16,9C16,10.29 16.84,11.4 18,11.81V15.41C18,17.91 16,19.91 13.5,19.91C11.5,19.91 9.82,18.7 9.22,16.9C12,16.3 14,13.8 14,11V2H10V5H12V11A4,4 0 0,1 8,15A4,4 0 0,1 4,11V5H6V2H2Z'/%3E%3C/svg%3E"); }
        .crow-btn[data-ic="ai"] { --ic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M19,1L17.74,3.75L15,5L17.74,6.26L19,9L20.25,6.26L23,5L20.25,3.75M9,4L6.5,9.5L1,12L6.5,14.5L9,20L11.5,14.5L17,12L11.5,9.5M19,15L17.74,17.75L15,19L17.74,20.25L19,23L20.25,20.25L23,19L20.25,17.75'/%3E%3C/svg%3E"); }

        /* ── Colour pickers — leopard style ── */
        .colour-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .colour-card {
          border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          transition: box-shadow 0.15s, border-color 0.15s;
          position: relative;
        }
        .colour-card:hover {
          box-shadow: 0 2px 10px rgba(0,0,0,0.12);
          border-color: var(--primary-color, #007AFF);
        }
        .colour-swatch {
          height: 44px; width: 100%;
          display: block; position: relative;
        }
        .colour-swatch input[type="color"] {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          opacity: 0; cursor: pointer; border: none; padding: 0;
        }
        .colour-swatch-preview { position: absolute; inset: 0; pointer-events: none; }
        .colour-swatch::before {
          content: ''; position: absolute; inset: 0;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%),
            linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%),
            linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
          opacity: 0.3; pointer-events: none;
        }
        .colour-info {
          padding: 6px 8px 7px;
          background: var(--card-background-color, #fff);
        }
        .colour-label {
          font-size: 11px; font-weight: 700;
          color: var(--primary-text-color); letter-spacing: 0.02em; margin-bottom: 1px;
        }
        .colour-desc {
          font-size: 10px; color: var(--secondary-text-color, #6b7280);
          margin-bottom: 4px; line-height: 1.3;
        }
        .colour-hex-row { display: flex; align-items: center; gap: 4px; }
        .colour-dot {
          width: 12px; height: 12px; border-radius: 50%;
          border: 1px solid rgba(0,0,0,0.15); flex-shrink: 0;
        }
        .colour-hex {
          flex: 1; font-size: 11px; font-family: monospace;
          border: none; background: none;
          color: var(--secondary-text-color, #6b7280);
          padding: 0; width: 0; min-width: 0;
        }
        .colour-hex:focus { outline: none; color: var(--primary-text-color); }
        .colour-edit-icon {
          opacity: 0; transition: opacity 0.15s;
          color: var(--secondary-text-color); font-size: 14px; line-height: 1;
        }
        .colour-card:hover .colour-edit-icon { opacity: 1; }

        /* Toggle rows */
        .toggle-list { display: flex; flex-direction: column; }
        .toggle-item { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid var(--divider-color,rgba(128,128,128,0.2)); min-height: 52px; }
        .toggle-item:last-child { border-bottom: none; }
        /* collapsible groups: small headings between their settings, and no line under the last one */
        @keyframes ed-spin { to { transform: rotate(360deg); } }
        .grp-sub { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 2px; }
        .grp-body > .grp-sub:first-child { margin-top: 2px; }
        .grp-body > :last-child { border-bottom: none !important; }
        .toggle-label { font-size: 14px; font-weight: 500; flex: 1; padding-right: 12px; }
        /* iOS toggle switch */
        .toggle-switch { position: relative; width: 51px; height: 31px; flex-shrink: 0; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .toggle-track {
          position: absolute; inset: 0; border-radius: 31px;
          background: rgba(120,120,128,0.32); cursor: pointer;
          transition: background 0.25s ease;
        }
        .toggle-track::after {
          content: ''; position: absolute;
          width: 27px; height: 27px; border-radius: 50%;
          background: #fff; top: 2px; left: 2px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.25s ease;
        }
        .toggle-switch input:checked + .toggle-track { background: #34C759; }
        .toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }

        /* Segmented control */
        .segmented { display: flex; background: rgba(118,118,128,0.2); border-radius: 9px; padding: 2px; gap: 2px; }
        .segmented input[type="radio"] { display: none; }
        .segmented label {
          flex: 1; text-align: center; padding: 8px 4px; font-size: 13px; font-weight: 500;
          border-radius: 7px; cursor: pointer; color: var(--primary-text-color);
          transition: all 0.2s ease; white-space: nowrap;
        }
        .segmented input[type="radio"]:checked + label {
          background: #007AFF; color:var(--primary-text-color, #111)fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        /* Select dropdowns */
        .select-row { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .select-row label { font-size: 14px; font-weight: 500; }
        .select-row .hint { font-size: 11px; color: #888; margin-top: -2px; }
        select {
          width: 100%; background: var(--card-background-color); color: var(--primary-text-color);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
          padding: 10px 12px; font-size: 14px; cursor: pointer; -webkit-appearance: none;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 12px center;
          padding-right: 32px;
        }

        /* Entity list */
        input[type="text"] { width: 100%; box-sizing: border-box; background: var(--card-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color, rgba(128,128,128,0.2)); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
        .checklist { max-height: 300px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        .check-item { display: flex; flex-wrap: wrap; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--divider-color, rgba(128,128,128,0.2)); background: var(--card-background-color); min-height: 48px; }
        .entity-ctrl-group { display: flex; align-items: center; gap: 6px; }
        .entity-ctrl-label { font-size: 11px; color: var(--primary-text-color,rgba(0,0,0,0.5)); white-space: nowrap; }
        .check-item:last-child { border-bottom: none; }
        .dragging { opacity: 0.5; background: #444 !important; }
        .drag-handle { cursor: grab; padding: 8px; color: #888; font-size: 20px; user-select: none; flex-shrink: 0; touch-action: none; }
        .check-item .toggle-switch { width: 44px; height: 26px; flex-shrink: 0; margin-left: auto; }
        .check-item .toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }
        .check-item .toggle-track::after { width: 22px; height: 22px; }
        .check-item .toggle-track { border-radius: 26px; }
        .check-item input[type="checkbox"] { display: none; }
        /* Settings page toggles (Startup Volume, Music Assistant Speaker) use a
           smaller 36x22 size that has no matching knob override, so the base
           51x31 rule's translateX(20px) was being used against a much
           narrower track — pushing the knob past the track's right edge when
           checked. Same left:2px/2px-margin pattern as the other two sizes,
           just scaled to this one: knob 18x18, translateX(14px). */
        #entitySettingsVolToggle + .toggle-track::after,
        #entitySettingsMaToggle + .toggle-track::after { width: 18px; height: 18px; }
        #entitySettingsVolToggle:checked + .toggle-track::after,
        #entitySettingsMaToggle:checked + .toggle-track::after { transform: translateX(14px); }
      </style>
      <div class="container">

        <!-- ── Search filter ────────────────────────────────── -->
        <div style="position:sticky;top:0;z-index:10;background:var(--ha-card-background,var(--card-background-color,#1c1c1e));padding:4px 0 10px;">
          <ha-icon icon="mdi:magnify" style="position:absolute;left:10px;top:12px;--mdc-icon-size:18px;width:18px;height:18px;display:inline-flex;color:var(--secondary-text-color,#888);pointer-events:none;z-index:1;"></ha-icon>
          <input type="text" id="editor-search" placeholder="Filter settings…" style="width:100%;box-sizing:border-box;padding:9px 12px 9px 36px;border-radius:10px;border:1px solid var(--divider-color,rgba(128,128,128,0.2));background:rgba(128,128,128,0.08);color:var(--primary-text-color,#111);font-size:13px;font-family:inherit;outline:none;">
        </div>

        <!-- ── Reset to Defaults ─────────────────────────────── -->
        <div style="margin-bottom:12px;">
          <button id="editor-reset-btn" type="button" class="crow-btn danger wide" data-ic="restore">
            <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:rgba(255,149,0,0.9);flex-shrink:0;"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
            Reset All Settings to Defaults
          </button>
          <div id="editor-reset-confirm" style="display:none;margin-top:8px;padding:10px 12px;background:rgba(255,69,58,0.1);border:1px solid rgba(255,69,58,0.3);border-radius:10px;">
            <div style="font-size:12px;color:#ff453a;margin-bottom:8px;font-weight:500;"><ha-icon icon="mdi:alert-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>This will clear all customisations. Are you sure?</div>
            <div style="display:flex;gap:8px;">
              <button id="editor-reset-confirm-btn" type="button" class="crow-btn danger sm" style="flex:1">Yes, Reset</button>
              <button id="editor-reset-cancel-btn" type="button" class="crow-btn sm" style="flex:1">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Entity List -->
        <div>
          <div class="section-title">Manage &amp; Reorder Media Players</div>
          <div class="card-block">
            <div style="padding:10px 12px 0;">
              <input type="text" id="search" placeholder="Filter entities...">
            </div>
            <div class="checklist" id="entityList">
              ${sortedList.map(ent => {
                const isSelected = selected.includes(ent);
                const hasVol  = (this._config.entity_startup_volumes || {})[ent] != null;
                const volVal  = hasVol ? (this._config.entity_startup_volumes || {})[ent] : '';
                const isMaEnt = Array.isArray(this._config.ma_entities) && this._config.ma_entities.includes(ent);
                const _alias  = ((this._config.entity_names || {})[ent] || '').trim();
                const name    = _alias || this._hass.states[ent]?.attributes?.friendly_name || ent;
                return `
                  <div class="check-item" data-id="${ent}" draggable="${isSelected}">
                    <div class="drag-handle"><svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#888;display:block;"><path d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V21V19Z"/></svg></div>
                    ${isSelected ? `
                    <div class="entity-settings-btn" data-ent="${ent}" style="display:flex;align-items:center;flex:1;min-width:0;margin-left:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:6px 0;">
                      <span class="entity-name" style="flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                      <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#888;flex-shrink:0;margin-left:6px;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
                    </div>` : `
                    <span class="entity-name" style="margin-left:10px;flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>`}
                    <label class="toggle-switch" style="flex-shrink:0;margin-left:10px;">
                      <input type="checkbox" ${isSelected ? 'checked' : ''}>
                      <span class="toggle-track"></span>
                    </label>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- Per-speaker settings page — pushed over the editor when "Settings" is
             tapped on a speaker row, with its own back button. A real page-push
             rather than an inline-expanding panel: with several speakers each
             potentially needing Startup Volume, Volume Entity and MA Speaker set,
             letting each one expand inline would make an already-long list
             increasingly unwieldy the more speakers are configured. -->
        <div id="entitySettingsPage" style="display:none;position:absolute;inset:0;background:var(--card-background-color,#1c1c1e);z-index:20;overflow-y:auto;padding:12px;box-sizing:border-box;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
            <button id="entitySettingsBack" style="background:none;border:none;padding:6px;margin:-6px;cursor:pointer;display:flex;align-items:center;-webkit-tap-highlight-color:transparent;">
              <svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:var(--primary-color,#007AFF);"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
            </button>
            <div id="entitySettingsTitle" style="font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
          </div>

          <div class="card-block" style="padding:14px;display:flex;flex-direction:column;gap:16px;">
            <div>
              <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Display Name</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">A friendly name shown for this speaker in the card's speaker menu, instead of its Home Assistant name. Leave blank to use the Home Assistant name.</div>
              <input type="text" id="entitySettingsDisplayName" placeholder="" autocomplete="off" autocorrect="off"
                style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color,rgba(128,128,128,0.2));background:var(--card-background-color);color:var(--primary-text-color,#111);font-size:13px;font-family:inherit;outline:none;">
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--divider-color,rgba(128,128,128,0.2));padding-top:16px;">
              <div>
                <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Startup Volume</div>
                <div style="font-size:11px;color:#888;">Set volume when this speaker is selected</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <label class="toggle-switch" style="width:36px;height:22px;flex-shrink:0;">
                  <input type="checkbox" id="entitySettingsVolToggle">
                  <span class="toggle-track" style="border-radius:22px;"></span>
                </label>
                <input type="number" id="entitySettingsVolInput"
                  min="0" max="100" step="1" placeholder="35"
                  style="width:56px;background:var(--card-background-color);border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:6px;padding:5px 6px;color:var(--primary-text-color,#111);font-size:13px;font-family:inherit;text-align:center;outline:none;">
                <span id="entitySettingsVolPct" style="font-size:12px;color:#888;">%</span>
              </div>
            </div>

            <div style="border-top:1px solid var(--divider-color,rgba(128,128,128,0.2));padding-top:16px;">
              <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Volume Entity</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Route this speaker's volume control to a different media player entity (e.g. an amp or receiver) instead of controlling it directly.</div>
              <select id="entitySettingsVolEntity" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color,rgba(128,128,128,0.2));background:var(--card-background-color);color:var(--primary-text-color,#111);font-size:13px;font-family:inherit;">
                <option value="">Default (control directly)</option>
              </select>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--divider-color,rgba(128,128,128,0.2));padding-top:16px;">
              <div>
                <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Music Assistant Speaker</div>
                <div style="font-size:11px;color:#888;">Enables MA features for this speaker</div>
              </div>
              <label class="toggle-switch" style="width:36px;height:22px;flex-shrink:0;">
                <input type="checkbox" id="entitySettingsMaToggle">
                <span class="toggle-track" style="border-radius:22px;"></span>
              </label>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="playerGrpHeader" data-grp="playerGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:play-circle-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Player &amp; Controls</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Startup · Buttons · Apple TV · Display · Volume</div>
                </div>
              </div>
              <svg id="playerGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="playerGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div class="grp-sub">Startup &amp; Navigation</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Auto Switch to Playing Device</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Automatically switches the card to whichever configured speaker starts playing, so you don't have to select it manually.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="auto_switch" checked><span class="toggle-track"></span></label>
                  </div>
<div class="toggle-item" id="remember_last_entity_row" style="align-items:flex-start;gap:12px;padding:10px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Remember Last Selected Speaker</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Reopens the card on the speaker you had selected last time, instead of the default.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="remember_last_entity"><span class="toggle-track"></span></label>
                  </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Show Media Player Selector</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Shows the speaker-switching row at the top of the card. Turn off if you only ever use one speaker.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_entity_selector" checked><span class="toggle-track"></span></label>
                  </div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
                  <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Startup View</div>
                  <div class="segmented" id="startup-mode-segmented">
                    <input type="radio" name="startup_mode" id="sm_compact"   value="compact"><label for="sm_compact">Compact</label>
                    <input type="radio" name="startup_mode" id="sm_maximised" value="maximised"><label for="sm_maximised">Maximised</label>
                    <input type="radio" name="startup_mode" id="sm_remote"    value="remote"><label for="sm_remote">Remote</label>
                  </div>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Retain Current View</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Reopen in whichever view (Compact/Maximised/Remote) was last used, instead of the Startup View above.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="remember_view"><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Buttons</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Always Show Discover Button</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show the Discover button on all speakers, not just Music Assistant ones.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_ma_library_button"><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Apple TV</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Apple TV Remote Button</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show a remote button in the controls bar for Apple TVs. Long-pressing the artwork opens the remote either way. When on, the library button moves to the quick menu for Apple TVs.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_remote_button" checked><span class="toggle-track"></span></label>
                </div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
                  <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Remote Button Row Position</div>
                  <div class="segmented" id="remote-position-segmented">
                    <input type="radio" name="remote_buttons_position" id="rbp_bottom" value="bottom"><label for="rbp_bottom">Bottom</label>
                    <input type="radio" name="remote_buttons_position" id="rbp_top"    value="top"><label for="rbp_top">Top</label>
                  </div>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Apple TV Keyboard Panel</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Automatically shows a text input when an Apple TV's on-screen keyboard becomes active, so you can type on your phone instead of using the remote's letter-by-letter entry.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="atv_keyboard_panel" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Apps Button</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Adds Apps to the Apple TV remote and Open App to the quick menu: a grid of the Apple TV's apps, most used first. Shows only when the Apple TV shares its app list (Home Assistant 2026.7 or later on tvOS 26).</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="atv_apps_button" checked><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Display</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Scroll Long Track / Artist Text</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Scrolls track and artist names that are too long to fit, instead of truncating them.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="scroll_text"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">iTunes Artwork Fallback</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Looks up album art on iTunes whenever a track has none.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="itunes_art" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Show Vibe</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Adds the Vibe option to the menus so you can start a mood or genre queue. Needs Music Assistant. Off by default.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_vibe"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Show Live/Podcast/Audiobook Pill</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Shows a small badge on the artwork screen identifying radio, podcast, or audiobook content.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_media_type_pill"><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Volume</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Show Volume HUD</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Shows a brief overlay with the current level whenever volume changes.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="volume_hud" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Use Volume Buttons</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Replaces the volume slider with tap-to-adjust buttons.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="volume_control_btn"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Show Volume Percentage</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Shows the exact volume percentage next to the volume control.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_vol_pct" checked><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Now Playing</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Sleep Timer</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Sleep Timer in the quick menu: pause after 15, 30, 45 or 60 minutes or at the end of the song, turning the volume down gently first. The time left shows at the top of the artwork.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_sleep_timer" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
              <div style="flex:1;">
                <div class="toggle-label">Ghost-Skip Healer</div>
                <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">When Music Assistant silently skips a track that failed to stream (e.g. a stale Apple Music playlist reference), automatically re-look it up and queue the fresh match to play next.</div>
              </div>
              <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ghost_skip_heal"><span class="toggle-track"></span></label>
            </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="maGrpHeader" data-grp="maGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:music-box-multiple-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Music Assistant</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Play on this device · Radio · Vibe artist seeds</div>
                </div>
              </div>
              <svg id="maGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="maGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div class="grp-sub">Play on This Device</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
              <div style="flex:1;">
                <div class="toggle-label">Show "Play on this device"</div>
                <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Adds "Play on this device" to the speaker menu. Tapping it turns the browser showing this card into a Music Assistant speaker (via Sendspin) that appears here like any other player. Each device opts in separately and appears with a name like "James's iPhone (Safari)", which you can change in Music Assistant. Works in a web browser such as Safari; it isn't offered in the Home Assistant Companion app. Needs Music Assistant 2.10 or newer.</div>
              </div>
              <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="sendspin_enabled"><span class="toggle-track"></span></label>
            </div>
<div id="sendspinOpts" style="margin-top:14px;">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Music Assistant server URL</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Leave blank to use this Home Assistant host on Music Assistant's Sendspin port (8927). Use the Sendspin port, not Music Assistant's web port 8095. If you open Home Assistant over https, this must be an https address too (for example a reverse proxy in front of Music Assistant), or the browser will block the connection.</div>
              <input type="text" id="sendspin_url" placeholder="http://homeassistant.local:8927" autocomplete="off" spellcheck="false"
                style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;box-sizing:border-box;">
            </div>
<div class="grp-sub">Radio</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Default Radio Mode on Startup</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Starts MA Radio Mode on automatically whenever the card loads.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ma_radio_mode"><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Vibe</div>
<div>
              <div id="moodPromptHeader" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <ha-icon icon="mdi:account-music-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                  <div>
                    <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Vibe Artist Seeds</div>
                    <div style="font-size:11px;color:#888;margin-top:1px;">Radio fallback seeds · Decade moods use UK chart playlists first</div>
                  </div>
                </div>
                <svg id="moodPromptChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
              </div>
              <div id="moodPromptBody" style="display:none;flex-direction:column;margin-top:10px;">
                <div style="font-size:11px;color:var(--secondary-text-color, rgba(0,0,0,0.5));margin-bottom:10px;line-height:1.5;">Enter artist names separated by commas. When a mood is triggered, these artists are searched in your local library first, then used as radio seeds.</div>
                <button id="moodResetAllBtn" type="button" class="crow-btn" data-ic="restore" style="align-self:flex-start;margin-bottom:12px"><ha-icon icon="mdi:restore" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:4px;"></ha-icon>Reset All to Defaults</button>
                <div id="moodPromptCategories"></div>
              </div>
            </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="discoverGrpHeader" data-grp="discoverGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:magnify" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Discover</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Search · Pins · Charts</div>
                </div>
              </div>
              <svg id="discoverGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="discoverGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div class="grp-sub">Search &amp; Pins</div>
<div class="ai-dep" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Library Search</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Whether pressing Enter/Search in Discover (Songs, Artists, Albums) runs a normal keyword search or interprets it as natural language with AI (e.g. "upbeat 90s rock"). The dedicated AI search button next to the search box always works either way.</div>
              <select id="library_search_mode" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="normal">Normal Search</option>
                <option value="ai">AI Enhanced Search</option>
              </select>
            </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Show Pins in Sections</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">On: pinned items also appear in their own tab (e.g. Pinned Songs in the Track tab). Off: pins only appear in the consolidated Pinned tab.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_pins_in_sections"><span class="toggle-track"></span></label>
                </div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Share Track Service</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Streaming service used when copying a Share Track link from context menus.</div>
              <select id="share_service" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="apple_music">Apple Music</option>
                <option value="amazon_music">Amazon Music</option>
                <option value="deezer">Deezer</option>
                <option value="spotify">Spotify</option>
                <option value="tidal">Tidal</option>
                <option value="youtube_music">YouTube Music</option>
              </select>
            </div>
<div class="grp-sub">Charts</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Charts</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A Charts section in Discover: Apple Music's Top Songs and Top Albums for your country, plus the charts on Deezer's front page (Official Charts, Charts, Trending, Popular Playlists, Most-streamed Artists and Albums). Top 10 to start, Top 50 or Top 100 from the &#8943; menu. Refreshed once a day. No account needed. Off by default.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_charts"><span class="toggle-track"></span></label>
                </div>
<div id="chartsSourcesWrap" style="display:none;padding:0 0 4px 14px;border-left:2px solid var(--divider-color,rgba(128,128,128,0.2));margin:0 0 6px 0;">
                  <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:6px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Apple Music</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Top Songs and Top Albums for your country.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="charts_apple" checked><span class="toggle-track"></span></label>
                  </div>
                  <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:6px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Deezer</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Official Charts, Charts, Trending, Popular Playlists and the most-streamed artists and albums. Switching both off turns Charts off.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="charts_deezer" checked><span class="toggle-track"></span></label>
                  </div>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Movie &amp; TV Charts</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A Charts row at the top of Discover's Movies &amp; TV section: Apple TV's Top Movies and Top TV Shows, TV Tonight (with the TV Guide below) and TVmaze's New on Streaming for your country, and, with a TMDB key added below, TMDB's Trending, Popular, Now in Cinemas, Coming Soon, Top Rated and TV charts. Refreshed once a day.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_video_charts" checked><span class="toggle-track"></span></label>
                </div>
<div id="mtChartsSubWrap" style="padding:0 0 4px 14px;border-left:2px solid var(--divider-color,rgba(128,128,128,0.2));margin:0 0 6px 0;">
                  <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:6px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">TV Guide</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">TV Tonight as a full TV guide (UK): the Freeview listings channel by channel with channel logos, and tapping a programme shows its details, Info and where to watch it live. Off, or outside the UK, TV Tonight shows TVmaze's listings instead.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_tv_guide" checked><span class="toggle-track"></span></label>
                  </div>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Podcast Charts</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Apple Podcasts' Top Podcasts at the top of Discover's Podcasts section, for your country. Refreshed once a day.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_podcast_charts" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Made for You Mixes</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Your Mixes at the top of Discover's Made for You: On Repeat, Discover Weekly and more, made each week from what the house listens to. Needs the Crow Media Player integration and Music Assistant; choose which mixes in the integration's Configure.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_mixes" checked><span class="toggle-track"></span></label>
                </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="infoGrpHeader" data-grp="infoGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:information-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Info Panels</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Sources · TMDB · Matching · Extras</div>
                </div>
              </div>
              <svg id="infoGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="infoGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div id="infoSummary" style="padding:10px 12px;margin:2px 0 6px;background:rgba(99,179,237,0.06);border:1px solid rgba(99,179,237,0.14);border-radius:10px;font-size:12px;line-height:1.5;color:var(--primary-text-color,#fff);"></div>
<div class="grp-sub">Songs</div>
<div class="ai-dep" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Try First</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Which source a song&#39;s info panel tries first. The other is still used if the first has nothing. Discogs with AI Extras shows Discogs&#39;s details plus the AI&#39;s similar tracks and Ask, Meaning, Story and Trivia.</div>
              <select id="info_panel_priority" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="ai">AI First</option>
                <option value="discogs">Discogs First</option>
                <option value="discogs_ai">Discogs with AI Extras</option>
              </select>
              <div class="ai-off-note" style="display:none;font-size:11px;color:rgba(255,159,10,0.9);margin-top:8px;line-height:1.4;">AI Features is off (in the AI section), so this uses the other source.</div>
            </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">New Releases</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A New Releases list in the music info panel: albums, EPs and singles the artist playing has put out in the last year, or that are due soon. Dated by when each record first came out, so reissues don't count. Uses MusicBrainz, no account needed.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_new_releases" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Audio Quality</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">An Audio Quality box in the music info panel for the song playing: Lossless or Hi-Res Lossless, the format, bit depth, sample rate and source. Needs Music Assistant Queue Actions.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_audio_quality" checked><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Movies &amp; TV</div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">TMDB API Key</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Optional. Adds TMDB (The Movie Database) as a source for movie/TV info panels — posters, ratings, cast and episode details. Works with AI on or off. Get a free key at <strong style="color:rgba(99,179,237,0.8)">themoviedb.org/settings/api</strong> (either a v3 API key or a v4 Bearer token both work).</div>
              <input type="text" id="tmdb_api_key" placeholder="TMDB API key…" autocomplete="off" spellcheck="false"
                style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;box-sizing:border-box;">
              <div id="tmdbKeyStatus" style="display:none;font-size:11px;color:#30d158;margin-top:8px;line-height:1.4;">Key added: TMDB is ready to use.</div>
              <div style="font-size:10px;color:#888;margin-top:6px;line-height:1.4;opacity:0.85;">This product uses the TMDB API but is not endorsed or certified by TMDB.</div>
            </div>
<div class="ai-dep" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Try First</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Which source a movie or TV info panel tries first. The other is still used if the first has nothing. TMDB with AI Extras shows TMDB&#39;s details plus the AI&#39;s Ask, Mood Match, Spot It and Trivia. With AI off, TMDB is used (with the key below).</div>
              <select id="video_info_priority" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="ai">AI First</option>
                <option value="tmdb">TMDB First</option>
                <option value="tmdb_ai">TMDB with AI Extras</option>
              </select>
              <div id="vprioKeyNote" style="display:none;font-size:11px;color:rgba(255,159,10,0.9);margin-top:8px;line-height:1.4;">Add a TMDB API key above for TMDB to be used. Until then the AI is used.</div>
              <div class="ai-off-note" style="display:none;font-size:11px;color:rgba(255,159,10,0.9);margin-top:8px;line-height:1.4;">AI Features is off (in the AI section), so this uses the other source.</div>
            </div>
            <div id="videoMatchRow" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Movie &amp; TV Matching</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">How the card works out which film or show you mean, everywhere it looks one up. Best Guess goes by the title, as before. Exact Match works it out the way media servers do: the title, the year and whether it&#39;s a film or a show, settled by TMDB&#39;s own ID, so remakes and shows with the same name don&#39;t get mixed up. With AI Info First, the AI then describes the title it found.</div>
              <select id="video_match" style="width:100%;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:9px 10px;">
                <option value="standard">Best Guess</option>
                <option value="exact">Exact Match (TMDB)</option>
              </select>
            </div>
<div class="grp-sub">Extras</div>
                <div class="toggle-item ai-dep" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">AI Details</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">AI details in the music, album, movie and TV, season, episode, person, podcast and station panels. Off: those panels use Discogs, TMDB, TVmaze and Wikipedia instead.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_feature_info" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Watch on YouTube</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Adds Watch on YouTube to the Info panel's 3-dot menu for a song, and Watch Trailer for a movie or TV show.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="show_youtube_button" checked><span class="toggle-track"></span></label>
                </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="lyricsGrpHeader" data-grp="lyricsGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:text-box-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Lyrics</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Line style · Translation · Lyrics cache</div>
                </div>
              </div>
              <svg id="lyricsGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="lyricsGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
                  <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Synced Lyric Line Style</div>
                  <div class="segmented" id="lyrics-scroll-mode-segmented">
                    <input type="radio" name="lyrics_scroll_mode" id="lsm_highlight" value="highlight"><label for="lsm_highlight">Highlight</label>
                    <input type="radio" name="lyrics_scroll_mode" id="lsm_scroll"    value="scroll"   ><label for="lsm_scroll">Scroll Only</label>
                    <input type="radio" name="lyrics_scroll_mode" id="lsm_none"      value="none"     ><label for="lsm_none">Off</label>
                  </div>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Keep Lyrics Open Between Tracks</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Keeps the lyrics panel open when the track changes, instead of closing it automatically.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="lyrics_persist"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Translate Lyrics</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A Translate option in the lyrics &#8943; menu shows a translation under each line, with pronunciation for non-Latin scripts. Needs AI Features on.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="feat_lyrics_translate" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Cache Lyrics</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Caches fetched lyrics so repeat lookups for the same song are instant instead of re-fetching every time.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="lyrics_cache_enabled" checked><span class="toggle-track"></span></label>
                </div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
                  <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Save Lyrics For</div>
                  <div class="segmented" id="lyrics-cache-ttl-segmented">
                    <input type="radio" name="lyrics_cache_ttl" id="lct_1"  value="1" ><label for="lct_1">1 Day</label>
                    <input type="radio" name="lyrics_cache_ttl" id="lct_3"  value="3" ><label for="lct_3">3 Days</label>
                    <input type="radio" name="lyrics_cache_ttl" id="lct_7"  value="7" ><label for="lct_7">1 Week</label>
                    <input type="radio" name="lyrics_cache_ttl" id="lct_30" value="30"><label for="lct_30">30 Days</label>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;">
                    <span style="font-size:12px;color:#888;" id="lyrics-cache-status">Calculating…</span>
                    <button id="lyrics-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                  </div>
                </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="aiGrpHeader" data-grp="aiGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:creation-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">AI</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">AI agent · Features · Announcements</div>
                </div>
              </div>
              <svg id="aiGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="aiGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
              <div style="flex:1;">
                <div class="toggle-label">Enable AI Features</div>
                <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Master switch for all AI features — AI Search, Recommendations, AI Artist Radio, Add Similar Songs, Add Songs from Same Year, Add Songs from Same Genre, Trivia, Story, Spot It, Mood Match, and AI-generated summaries. Off: the info panel uses Discogs data instead, and everything else in the card works as normal. Requires a conversation agent (e.g. Google Gemini) when on.</div>
              </div>
              <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_features_enabled"><span class="toggle-track"></span></label>
            </div>
<div class="ai-dep" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">AI Agent <span class="editor-tooltip"><span class="tooltip-icon" tabindex="0">i</span><span class="tooltip-text">The AI agent used for all AI features. Google Gemini with a current Flash model is recommended — add the Google Generative AI integration under Settings → Devices &amp; Services first.</span></span></div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Used for all AI features — Recommendations, Mood, Search, Info panels and Announce AI.</div>
              <div id="ai-pause-row" style="display:none;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:10px 12px;border-radius:10px;background:rgba(255,159,10,0.10);border:1px solid rgba(255,159,10,0.3);">
                <div id="ai-pause-status" style="font-size:12px;line-height:1.4;color:var(--primary-text-color,#fff);"></div>
                <button id="ai-pause-retry-btn" type="button" class="crow-btn" data-ic="refresh" style="flex-shrink:0">Try AI Again</button>
              </div>
              <select id="ai_conversation_agent" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="">Default (Home Assistant)</option>
              </select>
              <div id="ai-agent-warn" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,159,10,0.10);border:1px solid rgba(255,159,10,0.3);font-size:11px;line-height:1.45;color:var(--primary-text-color,#fff);"></div>
            </div>
<div class="ai-dep" style="padding:8px 10px;background:rgba(99,179,237,0.06);border:1px solid rgba(99,179,237,0.12);border-radius:8px;margin:6px 0 10px;">
              <div style="font-size:10px;color:var(--secondary-text-color, rgba(0,0,0,0.5));line-height:1.5;">Add agents via <strong style="color:rgba(99,179,237,0.6)">Settings → Devices &amp; Services</strong> (for example the Google Generative AI integration). Google Gemini with a current Flash model is recommended — other AI Agents may work.</div>
            </div>
<div class="ai-dep" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:2px;color:var(--primary-text-color, #111);">AI Features</div>
              <div style="font-size:11px;color:#888;margin-bottom:4px;line-height:1.4;">Turn individual AI features off to save quota. Anything switched off falls back to the card's normal behaviour.</div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Look Up in Advance</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Fetches AI info for the playing track, show or album in the background so panels open instantly. Turn off to save AI quota — panels then load when you tap.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_feature_prefetch"><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Search and Recommendations</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">AI Search, AI Recommendations, AI Artist Radio, Add Similar / Same Year / Same Genre songs and Find Soundtrack.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_feature_discover" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Ask, Meaning and Trivia</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">The Ask, Meaning, Trivia and Mood Match buttons in the info panels.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_feature_ask" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Recap Summaries</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">The short written summary at the top of Music Recap and Video Recap. The stats show either way.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_feature_recap" checked><span class="toggle-track"></span></label>
                </div>
            </div>
<div class="grp-sub">Announcements</div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:var(--primary-text-color, #111);">Announce TTS Service</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Choose the TTS service used when making announcements. Leave blank to auto-detect.</div>
              <select id="announce_tts_service" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;-webkit-appearance:none;cursor:pointer;">
                <option value="">Auto-detect</option>
              </select>
            </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="saverGrpHeader" data-grp="saverGrp" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:monitor" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Visualiser &amp; Screensaver</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Start automatically · Styles · Clock face · Weather</div>
                </div>
              </div>
              <svg id="saverGrpChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="saverGrpBody" class="grp-body" style="display:none;flex-direction:column;margin-top:10px;">
              <div style="padding:10px 0 12px;">
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Start Automatically</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A visualiser in place of the album artwork while music plays, or a screensaver whether or not anything is playing (full screen or just over the artwork — see Full Screen below), once it has been left alone for a while (one or the other). Visualiser and Screensaver in the quick menu work either way.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="auto_start_on"><span class="toggle-track"></span></label>
                </div>
                <div id="autoStartSub" style="display:none;margin-top:12px;padding:0 0 4px 14px;border-left:2px solid var(--divider-color,rgba(128,128,128,0.2));">
                  <div style="margin:0 0 12px;">
                    <div style="font-size:13px;font-weight:500;margin-bottom:4px;">Start</div>
                    <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">The visualiser (while music plays), or the screensaver (with or without music playing).</div>
                    <select id="auto_start" style="width:100%;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;padding:9px 12px;font-family:inherit;">
                    <option value="visualiser">Visualiser</option>
                    <option value="screensaver">Screensaver</option>
                  </select>
                  </div>
                  <div style="margin:0 0 12px;">
                    <div style="font-size:13px;font-weight:500;margin-bottom:4px;">After</div>
                    <div id="autoAfterHint" style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;"></div>
                    <select id="auto_start_after" style="width:100%;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;padding:9px 12px;font-family:inherit;">
                      <option value="0">Immediately</option>
                      <option value="0.5">After 30 seconds</option>
                      <option value="1">After 1 minute</option>
                      <option value="2">After 2 minutes</option>
                      <option value="5">After 5 minutes</option>
                      <option value="10">After 10 minutes</option>
                      <option value="15">After 15 minutes</option>
                      <option value="30">After 30 minutes</option>
                      <option value="60">After 1 hour</option>
                    </select>
                  </div>
                  <div id="autoVizWrap" style="display:none;">
                    <div style="font-size:13px;font-weight:500;margin-bottom:4px;">Visualiser Style</div>
                    <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">The visuals follow the song&#39;s tempo, where it&#39;s up to and its synced lyrics, in the album&#39;s own colours. With Play on This Device they follow the actual sound. Radio streams get it too; movies, TV, podcasts and audiobooks keep their artwork.</div>
                    <div id="auto_start_viz_style" role="radiogroup" aria-label="Visualiser Style" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                      <button type="button" class="viz-tile" data-viz="eq" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Spectrum Equaliser</button>
                      <button type="button" class="viz-tile" data-viz="radial" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Radial Equaliser</button>
                      <button type="button" class="viz-tile" data-viz="vu" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>VU Meters</button>
                      <button type="button" class="viz-tile" data-viz="wave" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Waveform</button>
                      <button type="button" class="viz-tile" data-viz="vinyl" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Vinyl Turntable</button>
                      <button type="button" class="viz-tile" data-viz="cassette" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Cassette Deck</button>
                      <button type="button" class="viz-tile" data-viz="particles" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Pulse Particles</button>
                      <button type="button" class="viz-tile" data-viz="synthwave" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Synthwave Grid</button>
                      <button type="button" class="viz-tile" data-viz="lyrics" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Synced Lyrics</button>
                      <button type="button" class="viz-tile" data-viz="liquid" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Liquid Colour</button>
                      <button type="button" class="viz-tile" data-viz="code" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Code Rain</button>
                      <button type="button" class="viz-tile" data-viz="shuffle" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11px;font-weight:600;line-height:1.2;text-align:center;"><canvas width="72" height="72" style="width:72px;height:72px;border-radius:8px;pointer-events:none;"></canvas>Shuffle Each Song</button>
                    </div>
                  </div>
                  <div id="autoSaverWrap" style="display:none;">
                    <div style="font-size:13px;font-weight:500;margin-bottom:4px;">Screensaver Style</div>
                    <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Album Wall is a grid of the album covers of songs you&#39;ve played recently; Shuffle changes style every five minutes.</div>
                    <select id="auto_start_saver_style" style="width:100%;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:9px 10px;">
                  <option value="wall">Album Wall</option>
                  <option value="rain">Rain on Glass</option>
                  <option value="aurora">Ambient Aurora</option>
                  <option value="lava">Lava Lamp</option>
                  <option value="night">Night Sky</option>
                  <option value="fire">Fireplace</option>
                  <option value="ocean">Ocean</option>
                  <option value="clock">Clock &amp; Weather</option>
                  <option value="flip">Flip Clock</option>
                  <option value="analog">Analogue Clock</option>
                  <option value="words">Word Clock</option>
                  <option value="shuffle">Shuffle</option>
                </select>
                  </div>
                </div>
              </div>
<div class="grp-sub">Quick Menu</div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Visualiser in Quick Menu</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show Visualiser in the quick menu, to switch style or back to the artwork on this device until the page is refreshed or closed.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="qm_visualiser" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Screensaver in Quick Menu</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show Screensaver in the quick menu, to start any style straight away.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="qm_screensaver" checked><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Screensaver</div>
              <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:0 0 10px;">
                <div style="flex:1;">
                  <div class="toggle-label">Full Screen</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">On: the screensaver covers the whole screen, Home Assistant's header and sidebar included, and a tap anywhere on the dashboard counts as using it. Off: it stays over this card's album artwork.</div>
                </div>
                <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="screensaver_full"><span class="toggle-track"></span></label>
              </div>
              <div style="margin:0 0 12px;">
                <div style="font-size:13px;font-weight:500;margin-bottom:4px;">Analogue Clock Face</div>
                <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">The dial used by the Analogue Clock style. Tap a face to choose it.</div>
                <div id="screensaver_dial" role="radiogroup" aria-label="Analogue Clock Face" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                  <button type="button" class="saver-face" data-face="classic" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Classic</button>
                  <button type="button" class="saver-face" data-face="minimal" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Minimal</button>
                  <button type="button" class="saver-face" data-face="roman" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Roman</button>
                  <button type="button" class="saver-face" data-face="modern" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Modern</button>
                  <button type="button" class="saver-face" data-face="luxury" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Luxury</button>
                  <button type="button" class="saver-face" data-face="skeleton" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Skeleton</button>
                  <button type="button" class="saver-face" data-face="neon" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Neon</button>
                  <button type="button" class="saver-face" data-face="retro" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Retro</button>
                  <button type="button" class="saver-face" data-face="sport" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Sport</button>
                  <button type="button" class="saver-face" data-face="art_deco" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Art Deco</button>
                  <button type="button" class="saver-face" data-face="celestial" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Celestial</button>
                  <button type="button" class="saver-face" data-face="stargate" aria-pressed="false" style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px 7px;border-radius:12px;cursor:pointer;background:rgba(128,128,128,0.06);color:var(--primary-text-color,#fff);border:2px solid transparent;font-family:inherit;font-size:11.5px;font-weight:600;"><canvas width="52" height="52" style="width:52px;height:52px;pointer-events:none;"></canvas>Stargate</button>
                </div>
              </div>
              <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:4px 0 10px;">
                <div style="flex:1;">
                  <div class="toggle-label">Show Clock</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A small clock and the date (and the weather, if chosen below) in the corner of the styles that don't already show the time.</div>
                </div>
                <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="screensaver_clock" checked><span class="toggle-track"></span></label>
              </div>
              <div style="margin:0 0 4px;">
                <div style="font-size:13px;font-weight:500;margin-bottom:4px;">Weather</div>
                <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">A weather entity for the conditions and temperature (shown by the clocks), and the animated sky behind Clock &amp; Weather.</div>
                <select id="screensaver_weather" style="width:100%;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.07));border:1px solid var(--divider-color,rgba(128,128,128,0.2));border-radius:10px;color:var(--primary-text-color,#fff);font-size:13px;font-family:inherit;padding:9px 10px;"><option value="">None</option></select>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="pdfHeader" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:file-pdf-box" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Export &amp; PDF</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">PDF exports · Reports · Case printables</div>
                </div>
              </div>
              <svg id="pdfChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="pdfBody" style="display:none;flex-direction:column;margin-top:10px;">
            <div class="toggle-item" style="align-items:flex-start;gap:12px;margin-bottom:14px;padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,0.07);">
              <div style="flex:1;">
                <div class="toggle-label">Enable PDF Exports</div>
                <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Master switch for every PDF the card can make. Off: no Export or PDF options appear anywhere in the card.</div>
              </div>
              <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_enabled" checked><span class="toggle-track"></span></label>
            </div>
            <div class="pdf-dep">
              <div style="font-size:13px;font-weight:500;margin-bottom:2px;color:var(--primary-text-color, #111);">PDF Types</div>
              <div style="font-size:11px;color:#888;margin-bottom:4px;line-height:1.4;">Turn off the PDFs you don't use. Anything switched off is removed from the three-dot menus, Export buttons and action bars.</div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Lyrics</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Song lyrics and album lyrics booklets.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_lyrics" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">CD Case Printables</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Front, back tray and disc label for a CD jewel case.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_cd" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">DVD / Blu-ray Case Printables</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Full case wrap and disc label for films and TV shows.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_disc" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Format Marks</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A small Compact Disc, DVD or Blu-ray mark at the foot of the spine, along the bottom of the back and on the disc label of CD and DVD / Blu-ray case printables (not on scanned artwork, which has its own).</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_marks" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Cover on the Back</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A faint copy of the front cover filling backs that have no artwork of their own: the CD tracklist card and the DVD / Blu-ray back. A real back cover scan is never changed.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_back_art" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Info Panel PDFs</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">The music, movie, TV and podcast info panels, and TV episode guides.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_info" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Listening &amp; Watch Reports</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Reports from Music History and Watch History, including a single title's watch history.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_history" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Your Month in Music</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">The monthly listening summary.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_month" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Recently Played</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Songs played on a speaker in the last 24 hours.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_recent" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Recaps</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Music Recap and Video Recap snapshots, including pinned recaps.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_recap" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Pinned Items</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Your pinned songs, albums, shows and more.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_pins" checked><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Lists &amp; Results</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">The queue, saved queues, album tracklists, playlists, artists, AI Search and Recommendations results, and podcast episodes.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pdf_lists" checked><span class="toggle-track"></span></label>
                </div>
            </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card-block" style="padding:12px;">

            <div style="margin-top:0;border-top:none;padding-top:0;">
              <div id="cachesDataHeader" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <ha-icon icon="mdi:database-cog-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                  <div>
                    <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Caches, Data &amp; Support</div>
                    <div style="font-size:11px;color:#888;margin-top:1px;">Health check · Report a problem · Keep in Home Assistant · Clear caches</div>
                  </div>
                </div>
                <svg id="cachesDataChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
              </div>
              <div id="cachesDataBody" style="display:none;flex-direction:column;margin-top:10px;">
                <!-- Health & Support -->
                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Health &amp; Support</div>
                <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.4;">Check that the services the card uses are working and still answer the way it expects, test your AI agent, or report a problem.</div>
                <div style="display:flex;gap:8px;">
                  <button id="healthRunBtn" type="button" class="crow-btn" data-ic="stethoscope" style="flex:1;min-width:0">Run Health Check</button>
                  <button id="healthAiBtn" type="button" class="crow-btn" data-ic="ai" style="flex:1;min-width:0">Test AI</button>
                  <button id="reportBtn" type="button" class="crow-btn" data-ic="bug" style="flex:1;min-width:0">Report a Problem</button>
                </div>
                <div id="reportPanel" style="display:none;margin-top:12px;padding:12px;border-radius:10px;background:transparent;border:1px solid var(--divider-color, rgba(128,128,128,0.3));">
                  <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Report a Problem</div>
                  <div style="font-size:12px;line-height:1.5;color:var(--secondary-text-color,#999);">
                    <div style="margin-bottom:6px;"><b style="color:var(--primary-text-color,#fff);">What helps most:</b> what you were doing, what you expected and what happened instead, and a screenshot if you can.</div>
                    <div style="margin-bottom:6px;"><b style="color:var(--primary-text-color,#fff);">Added for you:</b> the card and Home Assistant versions, your device, which features are on and the Health Check results. API keys, entity names, addresses and anything personal are never included.</div>
                    <div><b style="color:var(--primary-text-color,#fff);">Note:</b> GitHub needs a free account to open an issue.</div>
                  </div>
                  <div id="reportStatus" style="display:none;font-size:11px;margin-top:8px;color:var(--secondary-text-color,#999);"></div>
                  <div style="display:flex;gap:8px;margin-top:10px;">
                    <button id="reportOpenBtn" type="button" class="crow-btn" data-ic="open" style="flex:1;min-width:0">Open GitHub Issue</button>
                    <button id="reportCopyBtn" type="button" class="crow-btn" data-ic="copy" style="flex:1;min-width:0">Copy Report</button>
                  </div>
                </div>
                <div id="healthAiOut" style="display:none;margin-top:10px;font-size:12px;line-height:1.45;"></div>
                <div id="healthOut" style="display:none;margin-top:12px;"></div>
                <div style="height:16px;"></div>
                <!-- Keep in Home Assistant -->
                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Keep in Home Assistant</div>
                <div style="font-size:11px;color:#888;margin-bottom:4px;line-height:1.4;">Off: kept on this device only, where the phone can clear it. On: also saved in Home Assistant for your user, so it survives app restarts and is there on your other devices.</div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Pins</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Your pinned songs, albums, stations, shows and more.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pins_persistent_storage"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Lyrics</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Lyrics that have been looked up.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="lyrics_persistent_storage"><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">AI Info</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">AI lookups (track info, recommendations, bios and so on) and Music Recap history.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ai_info_persistent_storage"><span class="toggle-track"></span></label>
                </div>
                  <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">iTunes Artwork</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Artwork found on iTunes.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="itunes_persistent_storage"><span class="toggle-track"></span></label>
                  </div>
                  <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:8px 0;">
                    <div style="flex:1;">
                      <div class="toggle-label">Wikipedia Artwork</div>
                      <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Photos and links found on Wikipedia.</div>
                    </div>
                    <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="wiki_persistent_storage"><span class="toggle-track"></span></label>
                  </div>
                <div style="height:14px;"></div>


                <!-- AI Caches -->
                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">AI Caches</div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Actor &amp; Artist Bios</div>
                    <span style="font-size:12px;color:#888;" id="bio-cache-status">Calculating…</span>
                  </div>
                  <button id="bio-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Trivia &amp; Meanings</div>
                    <span style="font-size:12px;color:#888;" id="trivia-cache-status">Calculating…</span>
                  </div>
                  <button id="trivia-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Where to Watch</div>
                    <span style="font-size:12px;color:#888;" id="wtw-cache-status">Calculating…</span>
                  </div>
                  <button id="wtw-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Content Warnings</div>
                    <span style="font-size:12px;color:#888;" id="cw-cache-status">Calculating…</span>
                  </div>
                  <button id="cw-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Year in Music</div>
                    <span style="font-size:12px;color:#888;" id="daymusic-cache-status">Calculating…</span>
                  </div>
                  <button id="daymusic-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Vibe History</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Recently suggested artists per mood, kept for 30 days, and the daily pool of tracks Vibe picks from.</div>
                    <span style="font-size:12px;color:#888;" id="mood-history-status">Calculating…</span>
                  </div>
                  <button id="mood-history-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">AI Response Cache</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Track info, recommendations, search and panel results, cached for up to 30 days.</div>
                    <span style="font-size:12px;color:#888;" id="ai-session-cache-status">Calculating…</span>
                  </div>
                  <button id="ai-session-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Discogs Info</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Album and release details the info panels use when AI is off, or when AI has nothing.</div>
                    <span style="font-size:12px;color:#888;" id="discogs-cache-status">Calculating…</span>
                  </div>
                  <button id="discogs-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Already Added Songs</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Songs Add Similar, Same Year and Same Genre have added before, so they aren&#39;t added again.</div>
                    <span style="font-size:12px;color:#888;" id="added-cache-status">Calculating…</span>
                  </div>
                  <button id="added-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>

                <!-- Artwork Caches -->
                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 8px;">Artwork Caches</div>
                <div style="padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <div>
                      <div style="font-size:13px;font-weight:500;margin-bottom:2px;">iTunes Artwork</div>
                      <span style="font-size:12px;color:#888;" id="itunes-cache-status">Calculating…</span>
                    </div>
                    <button id="itunes-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete" style="flex-shrink:0">Clear</button>
                  </div>
                </div>
                <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <div>
                      <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Wikipedia Artwork</div>
                      <span style="font-size:12px;color:#888;" id="wiki-cache-status">Calculating…</span>
                    </div>
                    <button id="wiki-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete" style="flex-shrink:0">Clear</button>
                  </div>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Report &amp; PDF Covers</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Small copies of artwork kept so PDFs and reports always have covers.</div>
                    <span style="font-size:12px;color:#888;" id="covers-cache-status">Calculating…</span>
                  </div>
                  <button id="covers-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>

                <!-- Library & Radio -->

                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 8px;">Library &amp; Radio</div>
                <div style="padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Music Library Cache</div>
                      <div style="font-size:11px;color:#888;margin-bottom:6px;line-height:1.4;">Saves library tab contents for instant re-opens.</div>
                    </div>
                    <button id="ma-library-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete" style="flex-shrink:0">Clear</button>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <label class="toggle-switch" style="flex-shrink:0"><input type="checkbox" id="ma_library_cache_enabled" checked><span class="toggle-track"></span></label>
                    <span style="font-size:12px;color:#888;">Enable</span>
                  </div>
                  <div id="ma-library-cache-ttl-section">
                    <div class="segmented" id="ma-library-cache-ttl-segmented" style="margin-bottom:6px;">
                      <input type="radio" name="ma_library_cache_ttl" id="mlct_1"  value="1" ><label for="mlct_1">1 Day</label>
                      <input type="radio" name="ma_library_cache_ttl" id="mlct_3"  value="3" ><label for="mlct_3">3 Days</label>
                      <input type="radio" name="ma_library_cache_ttl" id="mlct_7"  value="7" ><label for="mlct_7">1 Week</label>
                      <input type="radio" name="ma_library_cache_ttl" id="mlct_30" value="30"><label for="mlct_30">30 Days</label>
                    </div>
                  </div>
                  <span style="font-size:12px;color:#888;" id="ma-library-cache-status">Calculating…</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Radio Station Cache</div>
                    <span style="font-size:12px;color:#888;" id="rb-station-cache-status">Calculating…</span>
                  </div>
                  <button id="rb-station-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Charts</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Today&#39;s Charts, Movie &amp; TV Charts and Podcast Charts, kept until midnight.</div>
                    <span style="font-size:12px;color:#888;" id="charts-cache-status">Calculating…</span>
                  </div>
                  <button id="charts-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Podcast Episodes &amp; Audiobook Chapters</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Episode and chapter lists, kept so podcasts and audiobooks open faster.</div>
                    <span style="font-size:12px;color:#888;" id="pcab-cache-status">Calculating…</span>
                  </div>
                  <button id="pcab-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Apple TV App Icons</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">The icons in the remote&#39;s Apps grid and the Info panel, kept on this device and in Home Assistant so they only load once.</div>
                    <span style="font-size:12px;color:#888;" id="appicon-cache-status">Calculating…</span>
                  </div>
                  <button id="appicon-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">TV Episode Cache</div>
                    <span style="font-size:12px;color:#888;" id="tv-episode-cache-status">Calculating…</span>
                  </div>
                  <button id="tv-episode-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">HA Registry</div>
                    <span style="font-size:12px;color:#888;" id="registry-cache-status">Calculating…</span>
                  </div>
                  <button id="registry-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>

                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 8px;">Other</div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Announcement History</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Your recent announcements. Favourites are kept.</div>
                    <span style="font-size:12px;color:#888;" id="announce-hist-status">Calculating…</span>
                  </div>
                  <button id="announce-hist-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Icon Lookups</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Home Assistant icons looked up for custom button icons.</div>
                    <span style="font-size:12px;color:#888;" id="mdi-cache-status">Calculating…</span>
                  </div>
                  <button id="mdi-cache-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Song Tempos</div>
                    <div style="font-size:11px;color:#888;margin-bottom:2px;line-height:1.4;">Each song&#39;s tempo, looked up for the visualiser.</div>
                    <span style="font-size:12px;color:#888;" id="viz-bpm-status">Calculating…</span>
                  </div>
                  <button id="viz-bpm-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>
                
                
                
                
                

                <!-- Pinned Items -->
                <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 8px;">Pinned Items</div>
                
                <div id="pins-rows"></div>
                <button id="clear-all-pins-btn" type="button" class="crow-btn danger wide" data-ic="delete" style="margin-top:10px"><ha-icon icon="mdi:pin-off-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Clear All Pins</button>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:13px;font-weight:500;margin-bottom:2px;">Pinned Radio Stations</div>
                    <span style="font-size:12px;color:#888;" id="starred-stations-status">Calculating…</span>
                  </div>
                  <button id="starred-stations-clear-btn" type="button" class="crow-btn sm" data-ic="delete">Clear</button>
                </div>


                <!-- Clear All -->
                <button id="clear-all-caches-btn" type="button" class="crow-btn danger wide" data-ic="delete" style="margin-top:16px"><ha-icon icon="mdi:delete-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Clear All Caches</button>

                <div style="margin-top:10px;padding:10px 0 2px;border-top:1px solid rgba(255,255,255,0.07);">
                  <div style="font-size:11px;color:#888;line-height:1.5;margin-bottom:8px;">Persistent storage is saved to Home Assistant's database and survives app restarts and cache clears. Pins, AI info cache and lyrics are only included here if their toggles above are turned on — this also always includes iTunes artwork, Wikipedia photos and vibe history.</div>
                  <button id="clear-ha-storage-btn" type="button" class="crow-btn danger wide" data-ic="delete"><ha-icon icon="mdi:delete-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Clear Persistent Storage</button>
                </div>

              </div>
            </div>

          </div>
        </div>

        

        <div>
          <div class="card-block" style="padding:12px;">
            <div id="coloursHeader" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;padding-bottom:2px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <ha-icon icon="mdi:palette-outline" style="--mdc-icon-size:22px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--secondary-text-color, #888);"></ha-icon>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--primary-text-color, #111);">Appearance</div>
                  <div style="font-size:11px;color:#888;margin-top:1px;">Style · Theme · Colours · Glass &amp; glow · Animations</div>
                </div>
              </div>
              <svg id="coloursChevron" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--secondary-text-color, rgba(0,0,0,0.5));transition:transform 0.25s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="coloursBody" style="display:none;flex-direction:column;margin-top:10px;">
<div class="grp-sub" style="margin-top:2px;">Theme &amp; Colours</div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Skin</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">A whole new look for every screen of the card, in light and dark — the Theme setting below chooses which, or Home Assistant’s own light or dark mode when Theme is Auto. Style and the colours below sit out while a skin is chosen.</div>
              <select id="skin_select" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.08));border:1px solid var(--divider-color,rgba(255,255,255,0.14));border-radius:10px;color:var(--primary-text-color, #111);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;cursor:pointer;">
                <option value="">Crow (Original)</option>
                ${['Retro Players', 'Retro Desktops', 'Modern'].map(g => '<optgroup label="' + g + '">' + CROW_MEDIA_SKINS.filter(k => k.group === g).map(k => '<option value="' + k.id + '">' + k.name + '</option>').join('') + '</optgroup>').join('')}
              </select>
              <div class="toggle-item" style="align-items:flex-start;gap:12px;padding:12px 0 0;">
                <div style="flex:1;">
                  <div class="toggle-label">Skin in Quick Menu</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show Skin in the quick menu, so each phone, tablet or computer can choose its own skin. The choice stays on that device. When this is off, every device uses the skin chosen above.</div>
                </div>
                <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="skin_menu"><span class="toggle-track"></span></label>
              </div>
            </div>
<div id="cardGlassRow" style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Style</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Classic uses a custom background colour (set below). Glass makes the card transparent with a frosted-glass blur, over the dashboard or the artwork.</div>
              <div class="segmented" id="card-style-segmented">
                <input type="radio" name="card_style" id="cs_classic" value="classic"><label for="cs_classic">Classic</label>
                <input type="radio" name="card_style" id="cs_glass" value="glass"><label for="cs_glass">Glass</label>
              </div>
              <div id="cardSkinGlassNote" style="display:none;font-size:11px;color:rgba(255,159,10,0.9);margin-top:8px;line-height:1.4;">A skin is chosen above, so the card uses the skin’s own look instead of Classic or Glass.</div>
              <div id="cardGlassDisabledNote" style="display:none;font-size:11px;color:rgba(255,159,10,0.9);margin-top:8px;line-height:1.4;">Glass needs a dark look to show through — set Theme to Dark below, or turn off Follow HA Theme, or switch Home Assistant itself to a dark theme.</div>
            </div>
<div style="padding:10px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2));">
              <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Theme</div>
              <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Chooses light or dark for a skin, and for the card when Follow Home Assistant Theme (below) is on. Auto follows Home Assistant’s own light/dark setting; Light or Dark forces it — the way to get Glass on a light Home Assistant theme.</div>
              <div class="segmented" id="appearance-segmented">
                <input type="radio" name="appearance" id="ap_auto"  value="auto"><label for="ap_auto">Auto</label>
                <input type="radio" name="appearance" id="ap_light" value="light"><label for="ap_light">Light</label>
                <input type="radio" name="appearance" id="ap_dark"  value="dark"><label for="ap_dark">Dark</label>
              </div>
            </div>

<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:4px 0 12px;margin-bottom:12px;">
                  <div style="flex:1;">
                    <div class="toggle-label">Follow Home Assistant Theme</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">When on, the card uses your HA theme colours. Custom colours below are ignored.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="use_ha_theme"><span class="toggle-track"></span></label>
                </div>
              <!-- Live colour preview strip -->
              <div id="colour-preview-strip" class="colour-preview-strip" title="Live accent colour preview">
                <div id="preview-accent" style="flex:3;background:#007AFF;border-radius:4px;"></div>
                <div id="preview-volume" style="flex:2;background:#007AFF;opacity:0.6;border-radius:4px;"></div>
                <div id="preview-text" style="flex:2;background:#fff;border-radius:4px;"></div>
                <div id="preview-artist" style="flex:2;background:#aaa;border-radius:4px;"></div>
              </div>
              <div id="ha-theme-colour-warn" style="display:none;margin-bottom:12px;padding:10px 14px;background:rgba(255,149,0,0.10);border:1px solid rgba(255,149,0,0.25);border-radius:10px;font-size:12px;color:rgba(255,180,50,0.95);line-height:1.5;">
                <ha-icon icon="mdi:alert-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon><strong>Follow HA Theme</strong> is enabled above — text, background and icon colours are driven by your HA theme. <strong>Accent</strong> and <strong>Volume Accent</strong> colours are still customisable.
              </div>
              <!-- Controls Theme Picker -->
              <div style="margin-bottom:16px;">
                <div style="font-size:13px;font-weight:600;color:var(--secondary-text-color, rgba(0,0,0,0.5));letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">Controls Theme</div>
                <select id="controls_theme_select" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.08));border:1px solid var(--divider-color,rgba(255,255,255,0.14));border-radius:10px;color:var(--primary-text-color, #111);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;">
                  <option value="classic">Classic — white icons (default)</option>
                  <option value="vivid">Vivid — accent colour throughout</option>
                  <option value="warm">Warm — amber &amp; sunset</option>
                  <option value="ocean">Ocean — cool blue &amp; cyan</option>
                  <option value="rose">Rose — pink &amp; blush</option>
                  <option value="forest">Forest — green &amp; emerald</option>
                  <option value="neon">Neon — electric high-contrast</option>
                  <option value="soft">Soft — pastel accent</option>
                  <option value="midnight">Midnight — deep space blue</option>
                  <option value="gold">Gold — classical &amp; burnished</option>
                  <option value="retro">Retro — teal &amp; magenta</option>
                  <option value="ember">Ember — autumn &amp; flame</option>
                </select>
              </div>
              <!-- Player Icon Theme Picker -->
              <div style="margin-bottom:16px;">
                <div style="font-size:13px;font-weight:600;color:var(--secondary-text-color, rgba(0,0,0,0.5));letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">Player Icon Theme</div>
                <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.4;">Changes the shape and style of the media control icons themselves (separate from Controls Theme colours above).</div>
                <select id="icon_theme" style="width:100%;background:var(--card-background-color,rgba(255,255,255,0.08));border:1px solid var(--divider-color,rgba(255,255,255,0.14));border-radius:10px;color:var(--primary-text-color, #111);font-size:13px;font-family:inherit;padding:10px 12px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;">
                  <option value="standard">Standard</option>
                  <option value="modern">Modern</option>
                  <option value="robot">Robot (default)</option>
                  <option value="vhs">Chunky</option>
                  <option value="retro_player">Retro Player</option>
                  <option value="sharp">Sharp</option>
                  <option value="pixel">Pixel</option>
                  <option value="lcd">LCD</option>
                </select>
              </div>
              <!-- Button Icons: the library and Apple TV remote buttons in the controls bar -->
              <div style="margin-bottom:16px;">
                <div style="font-size:13px;font-weight:600;color:var(--secondary-text-color, rgba(0,0,0,0.5));letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">Button Icons</div>
                <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.4;">The icons on the Discover and Apple TV remote buttons in the controls bar. Custom takes any Home Assistant icon.</div>
                <div style="font-size:12px;font-weight:600;color:var(--primary-text-color, #111);margin-bottom:6px;">Discover Button</div>
                <div id="library-icon-row" role="radiogroup" aria-label="Discover button icon" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
                <div id="library-icon-custom" style="display:none;margin-bottom:6px;"></div>
                <div style="font-size:12px;font-weight:600;color:var(--primary-text-color, #111);margin:10px 0 6px;">Apple TV Remote Button</div>
                <div id="remote-icon-row" role="radiogroup" aria-label="Apple TV remote button icon" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
                <div id="remote-icon-custom" style="display:none;"></div>
              </div>
              <div style="margin-bottom:14px;">
                <div style="font-size:13px;font-weight:600;color:var(--secondary-text-color, rgba(0,0,0,0.5));letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">Accent Preset</div>
                <div id="accent-preset-row" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
              </div>
              <div class="colour-grid" id="colour-grid"></div>
            <div class="grp-sub">Glass &amp; Glow</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Remote Liquid Glass</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Show a blurred version of the movie/show artwork behind the Apple TV remote control pad.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="remote_art_blur" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Volume HUD Liquid Glass</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Gives the volume overlay a frosted-glass look instead of a solid background.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="volume_hud_glass"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Ambient Glow</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Extracts the dominant colour from the artwork and applies a subtle glow behind it.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="ambient_glow"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Row Glow</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Adds a subtle accent-colour glow to rows throughout the app — library browser, queue panel, Music Recap, and pinned tracks/artists/albums/playlists.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="row_glow"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Row Swipes</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Swipe a row right or left for its most useful actions, like Add to Queue, Play Next, Pin and Remove. A long swipe does the first one straight away. Press and hold still opens the full menu. Rows are a little taller while this is on.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="row_swipes"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Keyboard Shortcuts</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">On a tablet or computer with a keyboard: Space plays or pauses, the arrows skip and change the volume, L, I, Q and B open Lyrics, Info, the Queue and the Library, / searches and Esc closes. Press ? in the card for the full list. The keys work in the player you last tapped.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="keyboard_shortcuts"><span class="toggle-track"></span></label>
                </div>
<div class="grp-sub">Animations</div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Artwork Crossfade</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A cinematic fade-to-black transition between track artwork changes.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="artwork_crossfade"><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Pin Hearts</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A burst of hearts when double-tapping the centre of the artwork to pin or unpin. The pin itself still works with this off.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="pin_hearts" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Resize Button Spin</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Spins the compact/maximise icon when toggling between views.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="resize_btn_spin" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" style="align-items:flex-start;gap:12px;padding:10px 0;">
                  <div style="flex:1;">
                    <div class="toggle-label">Full Screen Button</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">A button next to the resize button (and Full Screen in the quick menu) that fills the whole screen with a layout made for a tablet or wall screen. The exit button in its corner always works, and so do Escape and leaving the dashboard.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="fullscreen_button" checked><span class="toggle-track"></span></label>
                </div>
<div class="toggle-item" id="startFullRow" style="align-items:flex-start;gap:12px;padding:10px 0 10px 16px;">
                  <div style="flex:1;">
                    <div class="toggle-label">Open in Full Screen</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4;">Starts in full screen each time this dashboard opens, for a wall tablet. Never in the card editor or while editing the dashboard.</div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink:0;margin-top:2px;"><input type="checkbox" id="start_full"><span class="toggle-track"></span></label>
                </div>
            </div>
          </div>
        </div>
        <!-- Media Info API Keys -->

      </div>
    `;
    this._setupSearch();
    this._setupReordering();

    // Accent Preset — one tap sets Main Accent (and Volume Accent, if it still matches the
    // default, so the two usually-matching colours don't silently drift apart)
    const ACCENT_PRESETS = [
      { id: 'classic', name: 'Classic', accent: '#007AFF' },
      { id: 'ocean',   name: 'Ocean',   accent: '#30B0C7' },
      { id: 'berry',   name: 'Berry',   accent: '#BF5AF2' },
      { id: 'amber',   name: 'Amber',   accent: '#FF9F0A' },
    ];
    const presetRow = this.shadowRoot.getElementById('accent-preset-row');
    if (presetRow) {
      ACCENT_PRESETS.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'width:26px;height:26px;border-radius:50%;border:2px solid rgba(128,128,128,0.25);cursor:pointer;padding:0;background:' + p.accent + ';';
        b.title = p.name;
        b.addEventListener('click', () => {
          const prevAccent = this._config.accent_color || '#007AFF';
          const updates = { accent_color: p.accent };
          if (!this._config.volume_accent || this._config.volume_accent === prevAccent) updates.volume_accent = p.accent;
          this._updateConfigMulti(updates);
          this.updateUI();
        });
        presetRow.appendChild(b);
      });
    }

    // ── Button Icons: library and Apple TV remote ───────────────────
    {
      const sr = this.shadowRoot;
      const accent = () => this._config?.accent_color || '#007AFF';
      const ink = 'var(--primary-text-color, #111)';
      const buildIconPicker = (kind, cfgKey) => {
        const row = sr.getElementById(kind + '-icon-row'), custom = sr.getElementById(kind + '-icon-custom');
        if (!row || !custom) return;
        const list = CROW_BUTTON_ICONS[kind] || [];
        const cur = () => String(this._config?.[cfgKey] || list[0]?.key || '');
        const isCustom = v => /^mdi:/i.test(v);
        let customOpen = false;
        const svg = d => '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:' + ink + ';pointer-events:none;"><path d="' + d + '"/></svg>';
        const tile = (key, label, inner) => {
          const b = document.createElement('button');
          b.type = 'button'; b.title = label; b.dataset.key = key;
          b.setAttribute('role', 'radio'); b.setAttribute('aria-label', label);
          b.style.cssText = 'width:40px;height:40px;border-radius:10px;border:1.5px solid var(--divider-color, rgba(128,128,128,0.3));background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background 0.15s ease, border-color 0.15s ease;';
          b.innerHTML = inner;
          row.appendChild(b);
          return b;
        };
        const paint = () => {
          const v = cur();
          row.querySelectorAll('button').forEach(b => {
            const on = b.dataset.key === '__custom' ? (isCustom(v) || customOpen) : (b.dataset.key === v && !customOpen);
            b.style.borderColor = on ? accent() : 'var(--divider-color, rgba(128,128,128,0.3))';
            b.style.background = on ? accent() + '24' : 'transparent';
            b.setAttribute('aria-checked', on ? 'true' : 'false');
          });
          custom.style.display = (isCustom(v) || customOpen) ? 'block' : 'none';
        };
        list.forEach(o => tile(o.key, o.label, svg(o.path)).addEventListener('click', () => {
          customOpen = false;
          this._updateConfig(cfgKey, o.key);
          this._config = { ...this._config, [cfgKey]: o.key };   // show the choice straight away
          paint();
        }));
        // Custom: Home Assistant's own icon picker (searches every icon), or a plain "mdi:" box if it isn't available
        const customTile = tile('__custom', 'Custom', svg('M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z'));
        const showCustom = () => {
          custom.innerHTML = '';
          const v = isCustom(cur()) ? cur() : '';
          const save = val => {
            val = String(val || '').trim().toLowerCase();
            if (!val) return;
            if (!val.includes(':')) val = 'mdi:' + val;
            if (!/^mdi:[a-z0-9-]+$/.test(val)) return;
            this._updateConfig(cfgKey, val);
            this._config = { ...this._config, [cfgKey]: val };   // show the choice straight away
            paint();
          };
          if (customElements.get('ha-icon-picker')) {
            const pk = document.createElement('ha-icon-picker');
            pk.hass = this._hass;
            pk.value = v;
            pk.label = kind === 'remote' ? 'Remote button icon' : 'Discover button icon';
            pk.style.cssText = 'display:block;width:100%;';
            pk.addEventListener('value-changed', e => { e.stopPropagation(); save(e.detail?.value); });
            custom.appendChild(pk);
          } else {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:8px;align-items:center;';
            wrap.innerHTML = '<input type="text" placeholder="mdi:bookshelf" autocomplete="off" autocorrect="off" spellcheck="false" style="flex:1;min-width:0;box-sizing:border-box;background:var(--card-background-color,rgba(255,255,255,0.08));border:1px solid var(--divider-color,rgba(128,128,128,0.3));border-radius:10px;color:' + ink + ';font-size:13px;font-family:inherit;padding:9px 12px;outline:none;">';
            const inp = wrap.querySelector('input');
            inp.value = v;
            inp.addEventListener('change', () => save(inp.value));
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(inp.value); } });
            custom.appendChild(wrap);
          }
          const note = document.createElement('div');
          note.style.cssText = 'font-size:11px;color:#888;margin-top:4px;line-height:1.4;';
          note.textContent = 'Any Home Assistant icon, e.g. mdi:bookshelf. If it can\u2019t be found, the standard icon is used.';
          custom.appendChild(note);
        };
        customTile.addEventListener('click', () => { customOpen = true; showCustom(); paint(); });
        if (isCustom(cur())) showCustom();
        paint();
      };
      buildIconPicker('library', 'discover_icon');
      buildIconPicker('remote', 'remote_icon');
    }

    // ── Build colour cards (leopard style) ──────────────────────────
    const COLOUR_FIELDS = [
      { key: 'accent_color',      label: 'Main Accent',          desc: 'Progress bar, active icons, highlights',                                          default: '#007AFF', maxlen: 7 },
      { key: 'volume_accent',     label: 'Volume Accent',        desc: 'Volume slider track colour',                                                       default: '#007AFF', maxlen: 7 },
      { key: 'title_color',       label: 'Song Title',           desc: 'Track title text colour',                                                          default: '#ffffff', maxlen: 7 },
      { key: 'artist_color',      label: 'Song Artist',          desc: 'Artist name text colour',                                                          default: '#ffffff', maxlen: 7 },
      { key: 'button_color',      label: 'Button Colour',        desc: 'Media control icon colour (used by Classic theme as base)',                     default: '#ffffff', maxlen: 7 },
      { key: 'add_pill_color',   label: '+ Add Speaker',        desc: 'Colour of the + Add speaker button on the artwork panel',                          default: '#007AFF', maxlen: 7 },
      { key: 'vol_pct_color',     label: 'Volume % Colour',      desc: 'Volume percentage badge colour',                                                   default: '#ffffff', maxlen: 7 },
      { key: 'player_bg',         label: 'Custom Background',    desc: 'Used when Card Liquid Glass is off. 8-digit hex for partial opacity — e.g. #1c1c1e80. Set to #000000 for transparent.',          default: '#1c1c1e', maxlen: 9 },
      { key: 'lyrics_bg',         label: 'Lyrics Background',    desc: '#000000 = transparent. 8-digit hex for partial opacity — e.g. #0a0a0c80',          default: '#0a0a0c', maxlen: 9 },
      { key: 'lyrics_text_color', label: 'Lyrics Text',          desc: 'Active lyric line colour — past and upcoming lines are shown at reduced opacity',  default: '#ffffff', maxlen: 7 },
    ];
    const grid = this.shadowRoot.getElementById('colour-grid');
    for (const field of COLOUR_FIELDS) {
      const savedVal  = this._config[field.key] || '';
      const swatchVal = savedVal || field.default;
      const card = document.createElement('div');
      card.className   = 'colour-card';
      card.dataset.key = field.key;
      card.innerHTML = `
        <label class="colour-swatch">
          <div class="colour-swatch-preview" style="background:${swatchVal}"></div>
          <input type="color" value="${/^#[0-9a-fA-F]{6}$/.test(swatchVal) ? swatchVal : swatchVal.substring(0,7)}">
        </label>
        <div class="colour-info">
          <div class="colour-label">${field.label}</div>
          <div class="colour-desc">${field.desc}</div>
          <div class="colour-hex-row">
            <div class="colour-dot" style="background:${swatchVal}"></div>
            <input class="colour-hex" type="text" value="${savedVal}"
              maxlength="${field.maxlen}" placeholder="${field.default}" spellcheck="false">
            <span class="colour-edit-icon"><ha-icon icon="mdi:pencil" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;"></ha-icon></span>
          </div>
        </div>`;
      const nativePicker = card.querySelector('input[type=color]');
      const hexInput     = card.querySelector('.colour-hex');
      const preview      = card.querySelector('.colour-swatch-preview');
      const dot          = card.querySelector('.colour-dot');
      const apply = (val) => {
        preview.style.background = val;
        dot.style.background     = val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) nativePicker.value = val;
        hexInput.value = val;
        this._updateConfig(field.key, val);
      };
      nativePicker.addEventListener('input',  () => apply(nativePicker.value));
      nativePicker.addEventListener('change', () => apply(nativePicker.value));
      hexInput.addEventListener('input', () => {
        const v = hexInput.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{8}$/.test(v)) apply(v);
      });
      hexInput.addEventListener('blur', () => {
        const cur = this._config[field.key] || field.default;
        if (!/^#[0-9a-fA-F]{6,8}$/.test(hexInput.value.trim())) hexInput.value = cur;
      });
      hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexInput.blur(); });
      grid.appendChild(card);
    }

    this._setupListeners();
    this.updateUI();
  }

  _setupSearch() {
    const searchInput = this.shadowRoot.getElementById('search');
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      this.shadowRoot.querySelectorAll('.check-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(term) ? 'flex' : 'none';
      });
    });
  }

  _setupReordering() {
    const list = this.shadowRoot.getElementById('entityList');
    let dragging  = null;
    let dragClone = null;
    let offsetY   = 0;
    let lastTarget = null;
    let dragBelow  = false;

    const getDropTarget = (clientY) => {
      for (const el of list.querySelectorAll('.check-item:not(.dragging)')) {
        const box = el.getBoundingClientRect();
        if (clientY < box.top + box.height / 2) return el;
      }
      return null;
    };

    const onDown = (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const item = handle.closest('.check-item');
      if (!item) return;
      const cb = item.querySelector('label.toggle-switch input[type="checkbox"]:not(.entity-vol-toggle):not(.entity-ma-toggle)');
      if (!cb?.checked) return;

      e.preventDefault();
      e.stopPropagation();
      list.setPointerCapture(e.pointerId);

      dragging = item;
      const box = item.getBoundingClientRect();
      offsetY = e.clientY - box.top;
      item.classList.add('dragging');
      list.style.touchAction = 'none';

      // Ghost clone — minimal styling so it works outside shadow DOM
      dragClone = document.createElement('div');
      dragClone.textContent = item.querySelector('span[style*="flex:1"]')?.textContent || item.dataset.id || '';
      dragClone.style.cssText = [
        'position:fixed',
        'left:' + box.left + 'px',
        'top:' + box.top + 'px',
        'width:' + box.width + 'px',
        'height:' + box.height + 'px',
        'z-index:9999',
        'pointer-events:none',
        'opacity:0.92',
        'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
        'border-radius:8px',
        'background:#2c2c2e',
        'color:var(--primary-text-color, #111)',
        'font-size:14px',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
        'display:flex',
        'align-items:center',
        'padding:0 16px',
        'transition:none',
      ].join(';');
      document.body.appendChild(dragClone);
    };

    const onMove = (e) => {
      if (!dragging) return;
      if (dragClone) dragClone.style.top = (e.clientY - offsetY) + 'px';

      const target = getDropTarget(e.clientY);
      if (lastTarget) { lastTarget.style.borderTop = ''; }
      lastTarget = target;
      dragBelow  = !target;
      if (target) target.style.borderTop = '2px solid #007AFF';
    };

    const onEnd = () => {
      if (!dragging) return;
      if (dragClone) { dragClone.remove(); dragClone = null; }

      // Capture final drop position BEFORE clearing lastTarget
      const finalTarget = lastTarget;
      const finalBelow  = dragBelow;

      if (lastTarget) { lastTarget.style.borderTop = ''; lastTarget = null; }
      dragging.classList.remove('dragging');
      list.style.touchAction = '';

      // Use the captured values for insertion
      if (!finalBelow && finalTarget) list.insertBefore(dragging, finalTarget);
      else list.appendChild(dragging);

      dragging  = null;
      dragBelow = false;
      this._saveOrder();
    };

    const onCancel = () => {
      if (dragClone) { dragClone.remove(); dragClone = null; }
      if (dragging)  { dragging.classList.remove('dragging'); dragging = null; }
      if (lastTarget){ lastTarget.style.borderTop = ''; lastTarget = null; }
      list.style.touchAction = '';
      dragBelow = false;
    };

    list.addEventListener('pointerdown',   onDown,    { passive: false });
    list.addEventListener('pointermove',   onMove,    { passive: true  });
    list.addEventListener('pointerup',     onEnd);
    list.addEventListener('pointercancel', onCancel);
  }

  _getDragAfterElement(container, y) {
    const draggables = [...container.querySelectorAll('.check-item:not(.dragging)')];
    return draggables.reduce((closest, child) => {
      const box    = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  _saveOrder() {
    const newOrder = Array.from(this.shadowRoot.querySelectorAll('.check-item'))
      .filter(i => i.querySelector('label.toggle-switch input[type="checkbox"]:not(.entity-vol-toggle):not(.entity-ma-toggle)')?.checked)
      .map(i => i.getAttribute('data-id'));

    // Prune ma_entities — remove any entity no longer in the card's entity list
    // so stale YAML entries can't cause invisible speakers to appear in the picker.
    const maEntities = Array.isArray(this._config.ma_entities) ? this._config.ma_entities : [];
    const newOrderSet = new Set(newOrder);
    const prunedMA = maEntities.filter(eid => newOrderSet.has(eid));

    // Same idea for the per-entity volume_entity overrides — an entity removed
    // from the card shouldn't leave an orphaned routing entry behind.
    const veMap = (this._config.volume_entity && typeof this._config.volume_entity === 'object') ? this._config.volume_entity : {};
    const prunedVe = {};
    Object.keys(veMap).forEach(eid => { if (newOrderSet.has(eid)) prunedVe[eid] = veMap[eid]; });

    // Both updates must land in a single dispatch. Two separate sequential
    // _updateConfig calls each spread fresh from this._config — if the
    // parent dashboard hasn't fed the first update's result back into
    // this._config before the second call runs (a real race, made much more
    // likely by any connection hiccup/reconnect in between), the second
    // call's spread uses a stale `entities` value and silently reverts the
    // first change while the second one (ma_entities) sticks — exactly the
    // "toggled the speaker off, but it came back on and only the MA flag
    // changed" symptom. One combined dispatch has no such window.
    this._updateConfigMulti({ entities: newOrder, ma_entities: prunedMA, volume_entity: prunedVe });
  }

  // Opens the per-speaker settings page for a given entity, populating all
  // three fields fresh from current config, plus the Volume Entity dropdown's
  // option list (every other media_player entity in Home Assistant, same
  // source list the old global dropdown used).
  _openEntitySettingsPage(ent) {
    const root = this.shadowRoot;
    const page = root.getElementById('entitySettingsPage');
    if (!page) return;
    page.dataset.ent = ent;

    const name = this._hass.states[ent]?.attributes?.friendly_name || ent;
    const titleEl = root.getElementById('entitySettingsTitle');
    if (titleEl) titleEl.textContent = name;

    // Display Name override — the page title deliberately keeps showing the
    // real HA friendly name above, so while typing an alias the user can
    // always still see exactly which speaker they're renaming.
    const dnInput = root.getElementById('entitySettingsDisplayName');
    if (dnInput) {
      dnInput.value = ((this._config.entity_names || {})[ent] || '');
      dnInput.placeholder = name;
    }

    const hasVol = (this._config.entity_startup_volumes || {})[ent] != null;
    const volVal = hasVol ? (this._config.entity_startup_volumes || {})[ent] : 35;
    const volToggle = root.getElementById('entitySettingsVolToggle');
    const volInput  = root.getElementById('entitySettingsVolInput');
    if (volToggle) volToggle.checked = hasVol;
    if (volInput)  volInput.value = volVal;

    const isMaEnt = Array.isArray(this._config.ma_entities) && this._config.ma_entities.includes(ent);
    const maToggle = root.getElementById('entitySettingsMaToggle');
    if (maToggle) maToggle.checked = isMaEnt;

    const veMap = (this._config.volume_entity && typeof this._config.volume_entity === 'object') ? this._config.volume_entity : {};
    const currentVe = veMap[ent] || '';
    const veSelect = root.getElementById('entitySettingsVolEntity');
    if (veSelect) {
      const opts = ['<option value="">Default (control directly)</option>'];
      Object.keys(this._hass?.states || {})
        .filter(eid => eid.startsWith('media_player.') && eid !== ent)
        .sort()
        .forEach(eid => {
          const friendly = ((this._config.entity_names || {})[eid] || '').trim() || this._hass.states[eid]?.attributes?.friendly_name || eid;
          opts.push(`<option value="${eid}"${currentVe === eid ? ' selected' : ''}>${friendly}</option>`);
        });
      veSelect.innerHTML = opts.join('');
      veSelect.value = currentVe;
    }

    page.style.display = 'block';
    page.scrollTop = 0;
  }


  _setupListeners() {
    const root = this.shadowRoot;
    // The buttons that clear a lot at once ask first: the first tap turns the button red
    // ("Tap Again to Clear"), and only a second tap within 4 seconds clears.
    if (this._dangerRoot !== root) {
      this._dangerRoot = root;
      root.addEventListener('click', (e) => {
        const btn = e.target.closest?.('#clear-all-caches-btn, #clear-ha-storage-btn, #clear-all-pins-btn');
        if (!btn || btn.disabled) return;
        if (btn._armedAt && Date.now() - btn._armedAt < 4000) {
          btn._armedAt = 0; clearTimeout(btn._armT); btn.classList.remove('armed');
          if (btn._label != null) btn.innerHTML = btn._label;
          return;   // the button's own action runs now
        }
        e.stopImmediatePropagation(); e.preventDefault();
        btn._armedAt = Date.now(); btn._label = btn.innerHTML;
        btn.classList.add('armed'); btn.textContent = 'Tap Again to Clear';
        clearTimeout(btn._armT);
        btn._armT = setTimeout(() => { btn._armedAt = 0; btn.classList.remove('armed'); if (btn._label != null) btn.innerHTML = btn._label; }, 4000);
      }, true);
    }
    const list = root.getElementById('entityList');
    // ── Open per-speaker settings page ────────────────────────────────────────
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.entity-settings-btn');
      if (!btn) return;
      this._openEntitySettingsPage(btn.dataset.ent);
    });

    // ── Entity enable toggle ──────────────────────────────────────────────────
    root.querySelectorAll('.check-item label.toggle-switch input[type="checkbox"]:not(.entity-vol-toggle):not(.entity-ma-toggle)').forEach(cb => {
      cb.onchange = () => {
        const item = cb.closest('.check-item');
        if (!item) return;
        item.draggable = cb.checked;

        // Move newly-checked item to just after the last currently-checked item,
        // keeping selected entities at the top without triggering a re-render.
        if (cb.checked) {
          const allItems = Array.from(list.querySelectorAll('.check-item'));
          const lastChecked = allItems.filter(i => {
            const c = i.querySelector('label.toggle-switch input[type="checkbox"]:not(.entity-vol-toggle):not(.entity-ma-toggle)');
            return c && c.checked && i !== item;
          }).pop();
          if (lastChecked) lastChecked.after(item);
          else list.prepend(item);

          // Wrap the name in the clickable settings trigger if not already present
          if (!item.querySelector('.entity-settings-btn')) {
            const ent = item.dataset.id;
            const nameEl = item.querySelector('.entity-name');
            if (nameEl) {
              const wrap = document.createElement('div');
              wrap.className = 'entity-settings-btn';
              wrap.dataset.ent = ent;
              wrap.style.cssText = 'display:flex;align-items:center;flex:1;min-width:0;margin-left:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:6px 0;';
              nameEl.style.marginLeft = '0';
              nameEl.parentNode.insertBefore(wrap, nameEl);
              wrap.appendChild(nameEl);
              const chevron = document.createElement('span');
              chevron.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#888;flex-shrink:0;margin-left:6px;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>';
              wrap.appendChild(chevron.firstElementChild);
            }
          }
        }

        this._saveOrder();
      };
    });
    // ── Per-speaker settings page ─────────────────────────────────────────────
    root.getElementById('entitySettingsBack')?.addEventListener('click', () => {
      const page = root.getElementById('entitySettingsPage');
      if (page) page.style.display = 'none';
    });
    // Display Name — same add/delete map pattern as entity_startup_volumes:
    // an empty (or whitespace-only) value removes the key entirely so YAML
    // stays clean and the HA friendly name takes over again. Saved on
    // change (blur/Enter) rather than per-keystroke, so the config isn't
    // dispatched mid-typing. Also live-updates the entity list row behind
    // the settings page, so the new name is already visible on Back.
    root.getElementById('entitySettingsDisplayName')?.addEventListener('change', (e) => {
      const page = root.getElementById('entitySettingsPage');
      const ent = page?.dataset.ent;
      if (!ent) return;
      const val = e.target.value.trim();
      const names = { ...(this._config.entity_names || {}) };
      if (val) names[ent] = val;
      else delete names[ent];
      this._updateConfig('entity_names', names);
      const row = root.querySelector(`.check-item[data-id="${ent}"] .entity-name`);
      if (row) row.textContent = val || this._hass.states[ent]?.attributes?.friendly_name || ent;
    });
    root.getElementById('entitySettingsVolToggle')?.addEventListener('change', (e) => {
      const page = root.getElementById('entitySettingsPage');
      const ent = page?.dataset.ent;
      if (!ent) return;
      const numInput = root.getElementById('entitySettingsVolInput');
      const overrides = { ...(this._config.entity_startup_volumes || {}) };
      if (e.target.checked) {
        const n = Math.min(100, Math.max(0, parseInt(numInput?.value) || 35));
        if (numInput) numInput.value = n;
        overrides[ent] = n;
      } else {
        delete overrides[ent];
      }
      this._updateConfig('entity_startup_volumes', overrides);
    });
    root.getElementById('entitySettingsVolInput')?.addEventListener('change', (e) => {
      const page = root.getElementById('entitySettingsPage');
      const ent = page?.dataset.ent;
      if (!ent) return;
      const val = e.target.value.trim();
      const overrides = { ...(this._config.entity_startup_volumes || {}) };
      if (val === '') {
        delete overrides[ent];
        const toggle = root.getElementById('entitySettingsVolToggle');
        if (toggle) toggle.checked = false;
      } else {
        const n = Math.min(100, Math.max(0, parseInt(val) || 0));
        overrides[ent] = n;
        e.target.value = n;
      }
      this._updateConfig('entity_startup_volumes', overrides);
    });
    root.getElementById('entitySettingsVolEntity')?.addEventListener('change', (e) => {
      const page = root.getElementById('entitySettingsPage');
      const ent = page?.dataset.ent;
      if (!ent) return;
      const veMap = (this._config.volume_entity && typeof this._config.volume_entity === 'object') ? { ...this._config.volume_entity } : {};
      if (e.target.value) veMap[ent] = e.target.value;
      else delete veMap[ent];
      this._updateConfig('volume_entity', veMap);
    });
    root.getElementById('entitySettingsMaToggle')?.addEventListener('change', (e) => {
      const page = root.getElementById('entitySettingsPage');
      const ent = page?.dataset.ent;
      if (!ent) return;
      const current = Array.isArray(this._config.ma_entities) ? [...this._config.ma_entities] : [];
      if (e.target.checked) {
        if (!current.includes(ent)) current.push(ent);
      } else {
        const idx = current.indexOf(ent);
        if (idx !== -1) current.splice(idx, 1);
      }
      this._updateConfig('ma_entities', current);
    });

    root.getElementById('auto_switch').onchange = (e) => {
      this._updateConfig('auto_switch', e.target.checked);
      const row = root.getElementById('remember_last_entity_row');
      if (row) row.style.display = e.target.checked ? 'none' : '';
    };
    const rememberEl = root.getElementById('remember_last_entity');
    if (rememberEl) rememberEl.onchange = (e) => this._updateConfig('remember_last_entity', e.target.checked);
    root.getElementById('show_entity_selector').onchange = (e) => this._updateConfig('show_entity_selector', e.target.checked);
    root.getElementById('volume_control_btn').onchange   = (e) => this._updateConfig('volume_control', e.target.checked ? 'buttons' : 'slider');
    root.getElementById('show_vol_pct').onchange         = (e) => this._updateConfig('show_vol_pct', e.target.checked);
    root.getElementById('scroll_text').onchange          = (e) => this._updateConfig('scroll_text',   e.target.checked);
    root.getElementById('use_ha_theme').onchange         = (e) => { this._updateConfig('use_ha_theme', e.target.checked); this._applyHaThemeUi?.(e.target.checked); };
    ['highlight', 'scroll', 'none'].forEach(v => {
      const el = root.getElementById('lsm_' + v);
      if (el) el.onchange = () => this._updateConfig('lyrics_scroll_mode', v);
    });
    root.getElementById('lyrics_persist').onchange = (e) => this._updateConfig('lyrics_persist', e.target.checked);
    const lyricsCacheEnabledEl  = root.getElementById('lyrics_cache_enabled');
    const lyricsCacheTtlSection = root.getElementById('lyrics-cache-ttl-section');
    if (lyricsCacheEnabledEl) lyricsCacheEnabledEl.onchange = (e) => {
      this._updateConfig('lyrics_cache_enabled', e.target.checked);
      if (lyricsCacheTtlSection) {
        lyricsCacheTtlSection.style.opacity      = e.target.checked ? '1' : '0.35';
        lyricsCacheTtlSection.style.pointerEvents = e.target.checked ? '' : 'none';
      }
      // If the user has just disabled caching, clear what's stored
      if (!e.target.checked) {
        try { localStorage.removeItem('crow_media_lyrics_store'); } catch (_) {}
        if (this._lyricsCache) this._lyricsCache.clear();
        crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_lyrics', value: null }).catch(() => {});
        updateCacheStatus();
      }
    };
    [1, 3, 7, 30].forEach(v => {
      const el = root.getElementById('lct_' + v);
      if (el) el.onchange = () => this._updateConfig('lyrics_cache_ttl', v);
    });
    const lyricsPersistentStorageEl = root.getElementById('lyrics_persistent_storage');
    if (lyricsPersistentStorageEl) lyricsPersistentStorageEl.onchange = async (e) => {
      this._updateConfig('lyrics_persistent_storage', e.target.checked);
      if (e.target.checked) {
        // Just turned on — pull down anything already saved from another device
        // (HA wins on conflict, same as _haStorageLoad), then push the merged result up
        try {
          const res = await crowMediaUserData(this._hass?.connection, { type: 'frontend/get_user_data', key: 'crow_media_lyrics' });
          const haLyrics = res?.value;
          if (haLyrics && typeof haLyrics === 'object') {
            const local = JSON.parse(localStorage.getItem('crow_media_lyrics_store') || '{}');
            const ttlDays = this._config?.lyrics_cache_ttl ?? 7;
            const ttlMs   = ttlDays * 24 * 60 * 60 * 1000;
            const freshHaLyrics = {};
            Object.entries(haLyrics).forEach(([key, entry]) => {
              if (entry && (Date.now() - (entry.ts || 0)) <= ttlMs) freshHaLyrics[key] = entry;
            });
            const merged = { ...local, ...freshHaLyrics };
            localStorage.setItem('crow_media_lyrics_store', JSON.stringify(merged));
            updateCacheStatus();
          }
        } catch (_) {}
        this._haStorageSaveLyrics();
      } else {
        // Just turned off — remove the HA copy but keep the local cache as-is
        crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_lyrics', value: null }).catch(() => {});
      }
    };
    const pinsPersistentStorageEl = root.getElementById('pins_persistent_storage');
    if (pinsPersistentStorageEl) pinsPersistentStorageEl.onchange = async (e) => {
      this._updateConfig('pins_persistent_storage', e.target.checked);
      if (e.target.checked) {
        // Just turned on — pull down anything already saved, merge (HA wins), push back up
        try {
          const res = await crowMediaUserData(this._hass?.connection, { type: 'frontend/get_user_data', key: 'crow_media_pins' });
          const haPins = res?.value;
          if (haPins && typeof haPins === 'object') {
            Object.entries(haPins).forEach(([cat, items]) => {
              if (!Array.isArray(items)) return;
              const lsKey = 'crow_media_pin_' + cat;
              try { localStorage.setItem(lsKey, JSON.stringify(items)); } catch (_) {}
              if (!this._starredMemCache) this._starredMemCache = {};
              this._starredMemCache[lsKey] = items;
            });
          }
        } catch (_) {}
        this._haStorageSavePins();
      } else {
        // Just turned off — remove the HA copy but keep the local pins as-is
        crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_pins', value: null }).catch(() => {});
      }
    };
    const showPinsInSectionsEl = root.getElementById('show_pins_in_sections');
    if (showPinsInSectionsEl) showPinsInSectionsEl.onchange = (e) => {
      this._updateConfig('show_pins_in_sections', e.target.checked);
    };
    const aiInfoPersistentStorageEl = root.getElementById('ai_info_persistent_storage');
    if (aiInfoPersistentStorageEl) aiInfoPersistentStorageEl.onchange = async (e) => {
      this._updateConfig('ai_info_persistent_storage', e.target.checked);
      if (e.target.checked) {
        // Just turned on — pull down anything already saved, merge (HA wins) into
        // each local subcache, then push the full merged set back up in one write
        try {
          const haAi = await crowMediaAiGetAll(this._hass?.connection);
          if (haAi && typeof haAi === 'object') {
            Object.entries(haAi).forEach(([cacheName, haStore]) => {
              if (!haStore || typeof haStore !== 'object') return;
              const lsKey = 'crow_media_ai_local_' + cacheName;
              try {
                const local = JSON.parse(localStorage.getItem(lsKey) || '{}');
                const merged = { ...local, ...haStore };
                localStorage.setItem(lsKey, JSON.stringify(merged));
              } catch (_) {}
            });
          }
          // Push the merged result for every local subcache back up, one saved entry each
          Object.keys(localStorage).filter(k => k.startsWith('crow_media_ai_local_')).forEach(k => {
            const cacheName = k.slice('crow_media_ai_local_'.length);
            try { crowMediaAiPut(this._hass?.connection, cacheName, JSON.parse(localStorage.getItem(k) || '{}')); } catch (_) {}
          });
        } catch (_) {}
      } else {
        // Just turned off — remove the HA copy but keep the local cache as-is
        crowMediaAiClear(this._hass?.connection).catch(() => {});
      }
    };
    const itunesPersistentStorageEl = root.getElementById('itunes_persistent_storage');
    if (itunesPersistentStorageEl) itunesPersistentStorageEl.onchange = async (e) => {
      this._updateConfig('itunes_persistent_storage', e.target.checked);
      if (e.target.checked) {
        // Just turned on — pull down anything already saved, merge (HA wins), push back up
        try {
          const res = await crowMediaUserData(this._hass?.connection, { type: 'frontend/get_user_data', key: 'crow_media_itunes_preferred' });
          const haItunes = res?.value;
          let merged = null;
          if (haItunes && typeof haItunes === 'object') {
            const local = JSON.parse(localStorage.getItem('crow_media_itunes_preferred') || '{}');
            merged = { ...local, ...haItunes };
            localStorage.setItem('crow_media_itunes_preferred', JSON.stringify(merged));
            if (this._itunesPreferred) Object.assign(this._itunesPreferred, haItunes);
          }
        } catch (_) {}
        this._haStorageSaveItunes();
      } else {
        // Just turned off — remove the HA copy but keep the local cache as-is
        crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_itunes_preferred', value: null }).catch(() => {});
      }
    };
    const wikiPersistentStorageEl = root.getElementById('wiki_persistent_storage');
    if (wikiPersistentStorageEl) wikiPersistentStorageEl.onchange = async (e) => {
      this._updateConfig('wiki_persistent_storage', e.target.checked);
      if (e.target.checked) {
        // Just turned on — pull down anything already saved, merge (HA wins), push back up
        try {
          const res = await crowMediaUserData(this._hass?.connection, { type: 'frontend/get_user_data', key: 'crow_media_wiki_urls' });
          const haWiki = res?.value;
          if (haWiki && typeof haWiki === 'object') {
            const local = JSON.parse(localStorage.getItem('crow_media_wiki_urls') || '{}');
            const merged = { ...local, ...haWiki };
            localStorage.setItem('crow_media_wiki_urls', JSON.stringify(merged));
            if (this._wikiThumbUrlCache) {
              Object.entries(haWiki).forEach(([name, entry]) => {
                if (entry?.url && entry.url !== '__none__') this._wikiThumbUrlCache.set(name, entry.url);
              });
            }
          }
        } catch (_) {}
        this._haStorageSaveWiki();
      } else {
        // Just turned off — remove the HA copy but keep the local cache as-is
        crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_wiki_urls', value: null }).catch(() => {});
      }
    };
    const clearBtn    = root.getElementById('lyrics-cache-clear-btn');
    const cacheStatus = root.getElementById('lyrics-cache-status');
    const updateCacheStatus = () => {
      try {
        const raw   = localStorage.getItem('crow_media_lyrics_store');
        const count = raw ? Object.keys(JSON.parse(raw)).length : 0;
        if (cacheStatus) cacheStatus.textContent = count === 0 ? 'No lyrics cached' : `${count} song${count === 1 ? '' : 's'} cached`;
      } catch (_) {
        if (cacheStatus) cacheStatus.textContent = 'No lyrics cached';
      }
    };
    updateCacheStatus();
    if (clearBtn) clearBtn.onclick = () => {
      try { localStorage.removeItem('crow_media_lyrics_store'); } catch (_) {}
      if (this._lyricsCache) this._lyricsCache.clear();
      crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key: 'crow_media_lyrics', value: null }).catch(() => {});
      updateCacheStatus();
    };

    // ── MA Library Cache controls ─────────────────────────────────────────
    const maLibCacheEnabledEl  = root.getElementById('ma_library_cache_enabled');
    const maLibCacheTtlSection = root.getElementById('ma-library-cache-ttl-section');
    const maLibCacheStatus     = root.getElementById('ma-library-cache-status');
    const updateMALibCacheStatus = () => {
      try {
        // Read from in-memory cache (source of truth) not just localStorage
        const memCache = this._maLibMemCache || {};
        const memTabs = Object.keys(memCache).filter(k => memCache[k]?.items?.length);
        // Also check localStorage for tabs not yet in memory
        let lsTabs = [];
        try {
          const raw = localStorage.getItem('crow_media_ma_lib_store');
          lsTabs = raw ? Object.keys(JSON.parse(raw)) : [];
        } catch (_) {}
        const allTabs = [...new Set([...memTabs, ...lsTabs])];
        if (maLibCacheStatus) maLibCacheStatus.textContent = allTabs.length === 0 ? 'No tabs cached' : allTabs.length + ' tab' + (allTabs.length === 1 ? '' : 's') + ' cached (' + allTabs.join(', ') + ')';
      } catch (_) {
        if (maLibCacheStatus) maLibCacheStatus.textContent = 'No tabs cached';
      }
    };
    updateMALibCacheStatus();
    if (maLibCacheEnabledEl) {
      maLibCacheEnabledEl.checked = this._config?.ma_library_cache_enabled !== false;
      maLibCacheEnabledEl.onchange = (e) => {
        this._updateConfig('ma_library_cache_enabled', e.target.checked);
        if (maLibCacheTtlSection) {
          maLibCacheTtlSection.style.opacity       = e.target.checked ? '1' : '0.35';
          maLibCacheTtlSection.style.pointerEvents = e.target.checked ? '' : 'none';
        }
        if (!e.target.checked) { this._maLibCacheClear(); updateMALibCacheStatus(); }
      };
      if (maLibCacheTtlSection) {
        const enabled = this._config?.ma_library_cache_enabled !== false;
        maLibCacheTtlSection.style.opacity       = enabled ? '1' : '0.35';
        maLibCacheTtlSection.style.pointerEvents = enabled ? '' : 'none';
      }
    }
    [1, 3, 7, 30].forEach(v => {
      const el = root.getElementById('mlct_' + v);
      if (el) { el.checked = (this._config?.ma_library_cache_ttl ?? 1) === v; el.onchange = () => this._updateConfig('ma_library_cache_ttl', v); }
    });
    const maLibClearBtn = root.getElementById('ma-library-cache-clear-btn');
    if (maLibClearBtn) maLibClearBtn.onclick = () => {
      // Clear localStorage directly (always accessible from editor)
      try { localStorage.removeItem('crow_media_ma_lib_store'); } catch (_) {}
      // Also clear in-memory cache on the card element if we can find it
      const cardEl = document.querySelector('crow-media-player-card') ||
        document.querySelector('hui-card')?.querySelector('crow-media-player-card') ||
        [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (cardEl?._maLibMemCache) cardEl._maLibMemCache = {};
      if (cardEl?._drillInCache)  cardEl._drillInCache  = new Map();
      updateMALibCacheStatus();
    };

    // ── Starred Radio Stations ───────────────────────────────────────────────
    const starredStatus   = root.getElementById('starred-stations-status');
    const starredClearBtn = root.getElementById('starred-stations-clear-btn');
    const updateStarredStatus = () => {
      try {
        const list = JSON.parse(localStorage.getItem('crow_media_pin_stations') || '[]');
        if (starredStatus) starredStatus.textContent = list.length === 0 ? 'No pinned stations' : list.length + ' station' + (list.length === 1 ? '' : 's') + ' pinned';
      } catch (_) {
        if (starredStatus) starredStatus.textContent = 'No pinned stations';
      }
    };
    updateStarredStatus();
    if (starredClearBtn) starredClearBtn.onclick = () => {
      try { localStorage.removeItem('crow_media_pin_stations'); } catch (_) {}
      updateStarredStatus();
      this._showToast?.('Saved stations cleared');
    };

    // ── Radio station cache ──────────────────────────────────────────────────
    const rbCacheStatus   = root.getElementById('rb-station-cache-status');
    const rbCacheClearBtn = root.getElementById('rb-station-cache-clear-btn');
    const updateRbCacheStatus = () => {
      try {
        const store = JSON.parse(localStorage.getItem('crow_media_rb_station_cache') || '{}');
        const count = Object.keys(store).length;
        if (rbCacheStatus) rbCacheStatus.textContent = count === 0 ? 'No stations cached' : count + ' station URL' + (count === 1 ? '' : 's') + ' cached';
      } catch (_) {
        if (rbCacheStatus) rbCacheStatus.textContent = 'No stations cached';
      }
    };
    updateRbCacheStatus();
    if (rbCacheClearBtn) rbCacheClearBtn.onclick = () => {
      try { localStorage.removeItem('crow_media_rb_station_cache'); } catch (_) {}
      // Also clear in-memory cache on the card element
      const cardEl = document.querySelector('crow-media-player-card') ||
        document.querySelector('hui-card')?.querySelector('crow-media-player-card') ||
        [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (cardEl) cardEl._rbStationCache = new Map();
      updateRbCacheStatus();
    };

    // ── Vibe History cache ────────────────────────────────────────────
    // ── AI Session Cache controls ─────────────────────────────────────────
    const aiSessionCacheStatus   = root.getElementById('ai-session-cache-status');
    const aiSessionCacheClearBtn = root.getElementById('ai-session-cache-clear-btn');
    const updateAISessionCacheStatus = () => {
      try {
        let count = Object.keys(sessionStorage).filter(k => k.startsWith('crow_media_ai_')).length;
        ['albumTracks','epTrivia','libSearch','pcBio','pcEpisodes','rbBio','trackInfo','tvEpisodes','tvEpDetail','videoInfo','recs','moodUriCache','similarArtists','searchResults','tvEpCount','castBio','moviePoster','wtw','cw','meaning','trivia','mTrivia','bioTrivia','dayMusic','mood','story','spotIt'].forEach(name => {
          try {
            const store = JSON.parse(localStorage.getItem('crow_media_ai_local_' + name) || '{}');
            count += Object.keys(store).length;
          } catch(_) {}
        });
        if (aiSessionCacheStatus) aiSessionCacheStatus.textContent = count === 0 ? 'No AI responses cached' : `${count} cached response${count === 1 ? '' : 's'}`;
      } catch(_) { if (aiSessionCacheStatus) aiSessionCacheStatus.textContent = 'No AI responses cached'; }
    };
    updateAISessionCacheStatus();
    if (aiSessionCacheClearBtn) aiSessionCacheClearBtn.onclick = () => {
      try {
        Object.keys(sessionStorage).filter(k => k.startsWith('crow_media_ai_')).forEach(k => sessionStorage.removeItem(k));
        sessionStorage.removeItem('crow_media_ai_available');
        sessionStorage.removeItem('crow_media_ma_config_entry_id');
        sessionStorage.removeItem('crow_media_entity_registry');
        sessionStorage.removeItem('crow_media_device_registry');
        sessionStorage.removeItem('crow_media_area_registry');
        // Also clear the longer-lived localStorage layer (_aiLocalGet/_aiLocalSet,
        // 30-day expiry) — without this, pressing "Clear Cache" looked complete
        // but stale results would just get re-hydrated from here on next lookup.
        ['albumTracks','epTrivia','libSearch','pcBio','pcEpisodes','rbBio','trackInfo','tvEpisodes','tvEpDetail','videoInfo','recs','moodUriCache','similarArtists','searchResults','tvEpCount','castBio','moviePoster','wtw','cw','meaning','trivia','mTrivia','bioTrivia','dayMusic','mood','story','spotIt']
          .forEach(name => localStorage.removeItem('crow_media_ai_local_' + name));
      } catch(_) {}
      // Also clear in-memory AI caches on the card
      const _ce = document.querySelector('crow-media-player-card') || [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (_ce) {
        ['_aiTrackInfoCache','_aiInfoCache','_aiRecsCache','_aiAddSimilarCache','_aiSimilarAdded','_aiAlbumTracksCache','_aiVideoInfoCache','_aiSimilarArtistsCache','_aiSearchResultCache','_tvEpCountCache','_tvEpisodesCache','_tvEpDetailCache','_tvActorCache','_aiPromptCache','_entityRegistryCache','_deviceRegistryCache','_areaRegistryCache','_aiWtwCache','_aiCwCache','_aiMoodCache','_aiTriviaCache','_aiMusicTriviaCache','_aiMeaningCache','_aiDayMusicCache','_aiBioTriviaCache','_castBioCache'].forEach(k => { if (_ce[k]) _ce[k] = _ce[k] instanceof Map ? new Map() : {}; });
        _ce._aiAvailable = undefined;
        _ce._maConfigEntryId = null;
      }
      updateAISessionCacheStatus();
    };

    // ── Export & PDF: master switch + one switch per PDF type (all on unless switched off) ──
    const _applyPdfDepState = (on) => {
      root.querySelectorAll('.pdf-dep').forEach(el => { el.style.opacity = on ? '' : '0.35'; el.style.pointerEvents = on ? '' : 'none'; });
    };
    const pdfEnabledEl = root.getElementById('pdf_enabled');
    if (pdfEnabledEl) {
      pdfEnabledEl.checked = this._config?.pdf_enabled !== false;
      _applyPdfDepState(pdfEnabledEl.checked);
      pdfEnabledEl.onchange = (e) => { this._updateConfig('pdf_enabled', e.target.checked); _applyPdfDepState(e.target.checked); };
    }
    ['lyrics', 'cd', 'disc', 'marks', 'back_art', 'info', 'history', 'month', 'recent', 'recap', 'pins', 'lists'].forEach(k => {
      const el = root.getElementById('pdf_' + k);
      if (!el) return;
      el.checked = this._config?.['pdf_' + k] !== false;
      el.onchange = (e) => this._updateConfig('pdf_' + k, e.target.checked);
    });
    // ── Lyrics & Discovery: feature switches (on unless switched off) ──────────
    ['lyrics_translate', 'new_releases', 'sleep_timer', 'audio_quality', 'podcast_charts', 'video_charts', 'tv_guide', 'mixes'].forEach(k => {
      const el = root.getElementById('feat_' + k);
      if (!el) return;
      el.checked = this._config?.['feat_' + k] !== false;
      el.onchange = (e) => this._updateConfig('feat_' + k, e.target.checked);
    });
    // Full Screen switches
    {
      const fb = root.getElementById('fullscreen_button');
      [['fullscreen_button', true], ['start_full', false]].forEach(([k, def]) => {
        const el = root.getElementById(k);
        if (!el) return;
        el.checked = def ? this._config?.[k] !== false : this._config?.[k] === true;
        el.onchange = (e) => { this._updateConfig(k, e.target.checked); dim(); };
      });
      const dim = () => ['startFullRow'].forEach(id => { const row = root.getElementById(id); if (row) { row.style.opacity = fb?.checked ? '' : '0.4'; row.style.pointerEvents = fb?.checked ? '' : 'none'; } });
      dim();
    }
    // the TV Guide switch shows under Movie & TV Charts, only while that's on
    {
      const vc = root.getElementById('feat_video_charts'), sub = root.getElementById('mtChartsSubWrap');
      const show = () => { if (sub) sub.style.display = vc?.checked ? 'block' : 'none'; };
      show();
      vc?.addEventListener('change', show);
    }
    // Charts: off unless switched on, with its country picker shown underneath when on
    {
      const sw = root.getElementById('feat_charts');
      const srcWrap = root.getElementById('chartsSourcesWrap'), swA = root.getElementById('charts_apple'), swD = root.getElementById('charts_deezer');
      const aOn = this._config?.charts_apple !== false, dOn = this._config?.charts_deezer !== false;
      // Charts only counts as on while at least one source is
      const on = this._config?.feat_charts === true && (aOn || dOn);
      // the source switches show with Charts
      const show = v => { if (srcWrap) srcWrap.style.display = v ? 'block' : 'none'; };
      show(on);
      if (swA) swA.checked = aOn;
      if (swD) swD.checked = dOn;
      if (sw) {
        sw.checked = on;
        sw.onchange = (e) => {
          show(e.target.checked);
          // switching Charts back on with every source off turns them all back on
          if (e.target.checked && swA && swD && !swA.checked && !swD.checked) {
            swA.checked = swD.checked = true;
            this._updateConfigMulti({ feat_charts: true, charts_apple: true, charts_deezer: true });
          } else this._updateConfig('feat_charts', e.target.checked);
        };
      }
      const srcChange = () => {
        if (!swA.checked && !swD.checked) {
          // every source off: Charts goes off too
          if (sw) sw.checked = false;
          show(false);
          this._updateConfigMulti({ feat_charts: false, charts_apple: false, charts_deezer: false });
        } else this._updateConfigMulti({ charts_apple: swA.checked, charts_deezer: swD.checked });
      };
      if (swA) swA.onchange = srcChange;
      if (swD) swD.onchange = srcChange;
    }
    // ── Export & PDF collapsible ─────────────────────────────────────────────
    const _pdfHeader = root.getElementById('pdfHeader');
    const _pdfBody = root.getElementById('pdfBody');
    const _pdfChevron = root.getElementById('pdfChevron');
    if (_pdfHeader && _pdfBody) {
      _pdfHeader.addEventListener('click', () => {
        const open = _pdfBody.style.display !== 'none';
        _pdfBody.style.display = open ? 'none' : 'flex';
        _pdfBody.style.flexDirection = 'column';
        if (_pdfChevron) _pdfChevron.style.transform = open ? '' : 'rotate(90deg)';
      });
    }

    // ── Per-feature AI switches (all on unless switched off) ─────────────────
    ['info', 'prefetch', 'discover', 'ask', 'recap'].forEach(k => {
      const el = root.getElementById('ai_feature_' + k);
      if (!el) return;
      el.checked = k === 'prefetch' ? this._config.ai_feature_prefetch === true : this._config['ai_feature_' + k] !== false;
      el.onchange = (e) => this._updateConfig('ai_feature_' + k, e.target.checked);
    });
    // ── Agent warning: AI on but no usable agent chosen ──────────────────────
    const aiAgentWarn = root.getElementById('ai-agent-warn');
    const updateAgentWarn = () => {
      if (!aiAgentWarn) return;
      const on = this._config.ai_features_enabled === true;
      const agent = this._config.ai_conversation_agent || '';
      let msg = '';
      if (on && !agent) msg = 'No AI agent chosen. The default is Home Assistant\u2019s built-in assistant, which can\u2019t answer AI questions \u2014 choose your AI agent (Google Generative AI recommended) above. Add one in Settings \u2192 Voice Assistants if it isn\u2019t listed.';
      else if (on && agent && this._hass && !this._hass.states?.[agent]) msg = 'The chosen AI agent (' + agent + ') isn\u2019t available in Home Assistant any more. Choose another one above.';
      aiAgentWarn.textContent = msg;
      aiAgentWarn.style.display = msg ? 'block' : 'none';
    };
    updateAgentWarn();
    this._updateAgentWarn = updateAgentWarn;

    // ── AI pause status ─────────────────────────────────────────────────────
    // Shows when the card has paused the AI after a failure (usage limit,
    // timeouts, sign-in…), and lets you clear it straight away.
    const aiPauseRow    = root.getElementById('ai-pause-row');
    const aiPauseStatus = root.getElementById('ai-pause-status');
    const aiPauseRetry  = root.getElementById('ai-pause-retry-btn');
    const updateAiPause = () => {
      let p = null;
      try { p = JSON.parse(sessionStorage.getItem('crow_media_ai_pause') || 'null'); } catch (_) {}
      if (p && !p.perm && Date.now() >= (p.until || 0)) p = null;
      if (!aiPauseRow) return;
      if (!p) { aiPauseRow.style.display = 'none'; return; }
      const why = { quota: 'usage limit reached', timeout: 'not answering', auth: 'couldn\u2019t sign in', model: 'model not available', agent: 'no AI agent found' }[p.kind] || p.kind;
      const until = p.perm ? 'until the AI settings change' : 'until ' + new Date(p.until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      aiPauseStatus.textContent = 'AI paused (' + why + ') ' + until + '. Discogs, TVmaze and Wikipedia are used meanwhile.';
      aiPauseRow.style.display = 'flex';
    };
    updateAiPause();
    if (aiPauseRetry) aiPauseRetry.onclick = () => {
      try { sessionStorage.removeItem('crow_media_ai_pause'); sessionStorage.removeItem('crow_media_ai_available'); sessionStorage.removeItem('crow_media_ai_track_miss'); } catch (_) {}
      updateAiPause();
    };

    // ── TV Episode cache ──────────────────────────────────────────────────────
    // Season episode counts, episode lists and episode details — from the AI
    // and from TVmaze — so going back and forth between seasons and episodes
    // doesn't reload. Clearing it makes the next visit fetch fresh lists.
    const tvEpCacheStatus   = root.getElementById('tv-episode-cache-status');
    const tvEpCacheClearBtn = root.getElementById('tv-episode-cache-clear-btn');
    const TV_AI_CACHES = ['tvEpCount', 'tvEpisodes', 'tvEpDetail'];
    const updateTvEpCacheStatus = () => {
      const shows = new Set();
      try { Object.keys(JSON.parse(localStorage.getItem('crow_media_tvmaze_cache') || '{}')).forEach(k => shows.add(k)); } catch (_) {}
      TV_AI_CACHES.forEach(name => {
        try { Object.keys(JSON.parse(localStorage.getItem('crow_media_ai_local_' + name) || '{}')).forEach(k => shows.add(k.split('|')[0])); } catch (_) {}
      });
      if (tvEpCacheStatus) tvEpCacheStatus.textContent = shows.size === 0 ? 'No shows cached' : shows.size + ' show' + (shows.size === 1 ? '' : 's') + ' cached';
    };
    updateTvEpCacheStatus();
    if (tvEpCacheClearBtn) tvEpCacheClearBtn.onclick = () => {
      try {
        localStorage.removeItem('crow_media_tvmaze_cache');
        TV_AI_CACHES.forEach(name => localStorage.removeItem('crow_media_ai_local_' + name));
        Object.keys(sessionStorage)
          .filter(k => TV_AI_CACHES.some(name => k.startsWith('crow_media_ai_' + name + '|')))
          .forEach(k => sessionStorage.removeItem(k));
      } catch (_) {}
      document.querySelectorAll('crow-media-player-card').forEach(el => {
        el._tvmazeCache = new Map();
        el._tvEpCountCache = new Map();
        el._tvEpisodesCache = new Map();
        el._tvEpDetailCache = new Map();
      });
      updateTvEpCacheStatus();
      updateAISessionCacheStatus();
    };

    // ── iTunes cache controls ────────────────────────────────────────────
    const itunesCacheStatus   = root.getElementById('itunes-cache-status');
    const itunesCacheClearBtn = root.getElementById('itunes-cache-clear-btn');
    const updateItunesCacheStatus = () => {
      try {
        const raw = localStorage.getItem('crow_media_itunes_preferred');
        const data = raw ? JSON.parse(raw) : {};
        const hits   = Object.values(data).filter(v => v?.url).length;
        const misses = Object.values(data).filter(v => v?.url === '').length;
        if (itunesCacheStatus) itunesCacheStatus.textContent = hits + misses === 0 ? 'No artwork cached' : `${hits} artwork${hits === 1 ? '' : 's'}, ${misses} known miss${misses === 1 ? '' : 'es'} cached`;
      } catch(_) { if (itunesCacheStatus) itunesCacheStatus.textContent = 'No artwork cached'; }
    };
    updateItunesCacheStatus();
    if (itunesCacheClearBtn) itunesCacheClearBtn.onclick = () => {
      try { localStorage.removeItem('crow_media_itunes_preferred'); } catch(_) {}
      const _ce = document.querySelector('crow-media-player-card') || [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (_ce) { _ce._itunesArtCache = {}; _ce._itunesPreferredKeys = new Set(); }
      updateItunesCacheStatus();
    };

    // ── Wikipedia cache controls ─────────────────────────────────────────
    const wikiCacheStatus   = root.getElementById('wiki-cache-status');
    const wikiCacheClearBtn = root.getElementById('wiki-cache-clear-btn');
    const updateWikiCacheStatus = () => {
      try {
        const raw = localStorage.getItem('crow_media_wiki_urls');
        const data = raw ? JSON.parse(raw) : {};
        const hits   = Object.values(data).filter(v => v?.url && v.url !== '__none__').length;
        const nones  = Object.values(data).filter(v => v?.url === '__none__').length;
        if (wikiCacheStatus) wikiCacheStatus.textContent = hits + nones === 0 ? 'No Wikipedia URLs cached' : `${hits} URL${hits === 1 ? '' : 's'}, ${nones} known miss${nones === 1 ? '' : 'es'} cached`;
      } catch(_) { if (wikiCacheStatus) wikiCacheStatus.textContent = 'No Wikipedia URLs cached'; }
    };
    updateWikiCacheStatus();
    if (wikiCacheClearBtn) wikiCacheClearBtn.onclick = () => {
      try { localStorage.removeItem('crow_media_wiki_urls'); } catch(_) {}
      const _ce = document.querySelector('crow-media-player-card') || [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (_ce) {
        _ce._wikiThumbUrlCache = new Map();
        if (_ce._wikiBlobCache) { for (const url of _ce._wikiBlobCache.values()) { try { URL.revokeObjectURL(url); } catch(_) {} } }
        _ce._wikiBlobCache = new Map();
        _ce._wikiImgCachePromise = undefined;
      }
      // the downloaded photos too, not just their links
      try { if (window.caches) window.caches.delete('crow-media-wiki-img-v1').catch(() => {}); } catch (_) {}
      updateWikiCacheStatus();
    };

    // ── Registry cache controls ───────────────────────────────────────────
    const registryCacheStatus   = root.getElementById('registry-cache-status');
    const registryCacheClearBtn = root.getElementById('registry-cache-clear-btn');
    const updateRegistryCacheStatus = () => {
      try {
        const entCount = (() => { try { const r = sessionStorage.getItem('crow_media_entity_registry'); return r ? JSON.parse(r).length : 0; } catch(_){return 0;} })();
        const devCount = (() => { try { const r = sessionStorage.getItem('crow_media_device_registry'); return r ? JSON.parse(r).length : 0; } catch(_){return 0;} })();
        const hasMA    = !!sessionStorage.getItem('crow_media_ma_config_entry_id');
        if (registryCacheStatus) registryCacheStatus.textContent = entCount === 0 ? 'Not yet cached' : `${entCount} entities, ${devCount} devices${hasMA ? ', MA config ID' : ''} cached`;
      } catch(_) { if (registryCacheStatus) registryCacheStatus.textContent = 'Not yet cached'; }
    };
    updateRegistryCacheStatus();
    if (registryCacheClearBtn) registryCacheClearBtn.onclick = () => {
      ['crow_media_entity_registry','crow_media_device_registry','crow_media_area_registry','crow_media_ma_config_entry_id'].forEach(k => { try { sessionStorage.removeItem(k); } catch(_) {} });
      const _ce = document.querySelector('crow-media-player-card') || [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
      if (_ce) { _ce._entityRegistryCache = null; _ce._deviceRegistryCache = null; _ce._areaRegistryCache = null; _ce._maConfigEntryId = null; }
      updateRegistryCacheStatus();
    };

    // ── Pinned Items controls ────────────────────────────────────────────
    const PIN_KEYS = [
      { key: 'crow_media_pin_stations',   label: 'Radio Stations' },
      { key: 'crow_media_pin_podcasts',   label: 'Podcasts' },
      { key: 'crow_media_pin_audiobooks', label: 'Audiobooks' },
      { key: 'crow_media_pin_track',      label: 'Songs' },
      { key: 'crow_media_pin_artist',     label: 'Artists' },
      { key: 'crow_media_pin_album',      label: 'Albums' },
      { key: 'crow_media_pin_playlist',   label: 'Playlists' },
      { key: 'crow_media_pin_saved_queues', label: 'Pinned Queues' },
    ];

    const pinsRowsEl = root.getElementById('pins-rows');

    const renderPinsRows = () => {
      if (!pinsRowsEl) return;
      pinsRowsEl.innerHTML = '';
      PIN_KEYS.forEach(({ key, label }, i) => {
        let count = 0;
        try { count = JSON.parse(localStorage.getItem(key) || '[]').length; } catch(_) {}
        const isLast = i === PIN_KEYS.length - 1;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:' + (i === 0 ? '0 0 10px' : '10px 0') + ';' + (isLast ? '' : 'border-bottom:1px solid rgba(255,255,255,0.07);');
        row.innerHTML =
          '<div>' +
            '<div style="font-size:13px;font-weight:500;margin-bottom:2px;">' + label + '</div>' +
            '<span style="font-size:12px;color:#888;">' + (count === 0 ? 'Nothing pinned' : count + ' pinned') + '</span>' +
          '</div>' +
          (count > 0
            ? '<button type="button" data-pin-key="' + key + '" class="pin-clear-btn crow-btn sm" data-ic="delete">Clear</button>'
            : '<span style="font-size:12px;color:rgba(255,255,255,0.2);">—</span>'
          );
        pinsRowsEl.appendChild(row);
      });

      // Wire individual clear buttons
      pinsRowsEl.querySelectorAll('.pin-clear-btn').forEach(btn => {
        btn.onclick = () => {
          const k = btn.dataset.pinKey;
          try { localStorage.removeItem(k); } catch(_) {}
          // Also clear from in-memory cache on live card
          document.querySelectorAll('crow-media-player-card').forEach(el => {
            if (el._starredMemCache) delete el._starredMemCache[k];
          });
          renderPinsRows();
        };
      });
    };

    renderPinsRows();

    const clearAllPinsBtn = root.getElementById('clear-all-pins-btn');
    if (clearAllPinsBtn) {
      clearAllPinsBtn.onclick = () => {
        PIN_KEYS.forEach(({ key }) => {
          try { localStorage.removeItem(key); } catch(_) {}
        });
        document.querySelectorAll('crow-media-player-card').forEach(el => {
          if (el._starredMemCache) el._starredMemCache = {};
        });
        renderPinsRows();
      };
    }

    const moodHistoryStatus   = root.getElementById('mood-history-status');
    const moodHistoryClearBtn = root.getElementById('mood-history-clear-btn');
    const _getMoodHistoryKeys = () => {
      try {
        return Object.keys(localStorage).filter(k => k.startsWith('crow_media_mood_artists_'));
      } catch(_) { return []; }
    };
    const updateMoodHistoryStatus = () => {
      const keys = _getMoodHistoryKeys();
      if (!moodHistoryStatus) return;
      if (!keys.length) { moodHistoryStatus.textContent = 'No history stored'; return; }
      let totalArtists = 0;
      keys.forEach(k => {
        try { const a = JSON.parse(localStorage.getItem(k)); if (Array.isArray(a)) totalArtists += a.length; } catch(_) {}
      });
      const moodCount = keys.length;
      moodHistoryStatus.textContent = `${moodCount} mood${moodCount === 1 ? '' : 's'}, ${totalArtists} artist${totalArtists === 1 ? '' : 's'} tracked`;
    };
    updateMoodHistoryStatus();
    if (moodHistoryClearBtn) moodHistoryClearBtn.onclick = () => {
      _getMoodHistoryKeys().forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
      // and the daily pool of tracks Vibe picks from
      try { localStorage.removeItem('crow_media_vibe_pool_v1'); } catch(_) {}
      try { sessionStorage.removeItem('crow_media_mood_lib_cache'); } catch(_) {}
      updateMoodHistoryStatus();
    };

    // ── Radio Mode ───────────────────────────────────────────────────────
    const radioModeEl = root.getElementById('ma_radio_mode');
    if (radioModeEl) {
      radioModeEl.checked = this._config?.ma_radio_mode === true;
      radioModeEl.onchange = (e) => this._updateConfig('ma_radio_mode', e.target.checked);
    }

    // ── Always Show Library Button ───────────────────────────────────────
    // ── Visualiser and Screensaver in the quick menu ──────────────────────
    ['qm_visualiser', 'qm_screensaver'].forEach(id => {
      const el = root.getElementById(id);
      if (el) { el.checked = this._config?.[id] !== false; el.onchange = (e) => this._updateConfig(id, e.target.checked); }
    });
    // ── Start Automatically: a visualiser or a screensaver (one or the other) ─────────
    {
      const auto = crowMediaAutoStart(this._config);
      const sel = root.getElementById('auto_start'), onEl = root.getElementById('auto_start_on'), sub = root.getElementById('autoStartSub'), grid = root.getElementById('auto_start_viz_style');
      const afterEl = root.getElementById('auto_start_after'), hint = root.getElementById('autoAfterHint');
      const vizWrap = root.getElementById('autoVizWrap'), saverWrap = root.getElementById('autoSaverWrap');
      const saverSel = root.getElementById('auto_start_saver_style');
      // choosing here replaces a choice made from the quick menu on this device
      const clearDev = () => { window.__crowMediaVizPick = null; window.__crowMediaSaverPick = null; };
      const show = (mode) => {
        if (sub) sub.style.display = mode === 'off' ? 'none' : 'block';
        if (vizWrap) vizWrap.style.display = mode === 'visualiser' ? 'block' : 'none';
        if (saverWrap) saverWrap.style.display = mode === 'screensaver' ? 'block' : 'none';
        const imm = afterEl?.querySelector('option[value="0"]');
        if (imm) { imm.hidden = mode !== 'visualiser'; imm.disabled = mode !== 'visualiser'; }
        if (hint) hint.textContent = mode === 'visualiser'
          ? 'How long music plays with the card left alone before the visualiser takes over from the artwork. Pausing goes back to the artwork, and the time starts again when the music resumes. Tap the visualiser to close it.'
          : 'How long the card is left alone, while the full-size player is on screen, with or without music playing. It stays until you tap it.';
      };
      // settings saved before Start Automatically existed are replaced by the new ones the first time anything here changes
      const curMode = () => (onEl && !onEl.checked) ? 'off' : (sel?.value || 'screensaver');
      const save = (updates) => this._updateConfigMulti({ auto_start: curMode(), auto_start_after: Number(afterEl?.value ?? auto.after),
        auto_start_viz_style: auto.vizStyle, auto_start_saver_style: auto.saverStyle, music_visual: undefined, music_visual_style: undefined,
        screensaver: undefined, screensaver_after: undefined, screensaver_style: undefined, ...updates });
      if (afterEl) {
        afterEl.value = String(auto.after);
        if (afterEl.value === '' ) afterEl.value = '10';
        afterEl.onchange = (e) => save({ auto_start_after: Number(e.target.value) });
      }
      // the switch turns it on or off; under it, Start chooses the visualiser or the screensaver
      const apply = () => {
        const mode = curMode();
        show(mode);
        clearDev();
        // a screensaver can't start straight away: Immediately becomes 30 seconds
        if (mode === 'screensaver' && afterEl && Number(afterEl.value) < 0.5) afterEl.value = '0.5';
        save({ auto_start: mode, auto_start_after: Number(afterEl?.value ?? 10) });
      };
      if (sel) { sel.value = auto.mode === 'visualiser' ? 'visualiser' : 'screensaver'; sel.onchange = apply; }
      if (onEl) { onEl.checked = auto.mode !== 'off'; onEl.onchange = apply; }
      show(curMode());
      if (saverSel) { saverSel.value = auto.saverStyle; saverSel.onchange = (e) => { auto.saverStyle = e.target.value; clearDev(); save({ auto_start_saver_style: e.target.value }); }; }
      if (grid) {
        const tiles = [...grid.querySelectorAll('.viz-tile')];
        const mark = (pick) => {
          const want = pick || auto.vizStyle;
          const cur = tiles.some(t => t.dataset.viz === want) ? want : 'eq';
          tiles.forEach(t => {
            const on = t.dataset.viz === cur;
            t.setAttribute('aria-pressed', on ? 'true' : 'false');
            t.style.borderColor = on ? 'var(--primary-color,#03a9f4)' : 'transparent';
            t.style.background = on ? 'rgba(3,169,244,0.10)' : 'rgba(128,128,128,0.06)';
          });
        };
        // a still from each style to choose from
        const sample = (k, cv) => {
          if (typeof CrowMediaVisualiser !== 'function' || !cv) return;
          try {
            const pv = new CrowMediaVisualiser(cv);
            pv.setPalette(['#ff375f', '#bf5af2', '#0a84ff']);
            pv.title = 'Song Title'; pv.artist = 'Artist';
            pv.lyrics = [{ time: 0, text: 'Lyrics light up' }, { time: 90, text: 'in time with the song' }, { time: 100, text: 'line by line' }];
            pv.resize(72, 72, Math.min(2, window.devicePixelRatio || 1));
            const styles = CROW_MEDIA_VIZ_STYLES.map(x => x[0]);
            pv.setStyle(k === 'shuffle' ? 'eq' : k);
            for (let f = 0; f < 40; f++) { pv.step(1000 + f * 33, { playing: true, pos: 92.2 + f * 0.033, dur: 210, bpm: 120, energy: 0.9 }); if (k === 'particles' || k === 'code') pv.draw(); }
            pv.lyricSince = -10;
            if (k === 'shuffle') {
              // four of the styles in quarters
              const c2 = document.createElement('canvas'), q = new CrowMediaVisualiser(c2);
              q.setPalette(pv.pal); q.resize(36, 36, Math.min(2, window.devicePixelRatio || 1));
              const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
              ['eq', 'vinyl', 'synthwave', 'radial'].forEach((st, i) => {
                q.setStyle(st);
                for (let f = 0; f < 40; f++) q.step(1000 + f * 33, { playing: true, pos: 92.2 + f * 0.033, dur: 210, bpm: 120, energy: 0.9 });
                q.draw();
                ctx.drawImage(c2, (i % 2) * cv.width / 2, Math.floor(i / 2) * cv.height / 2, cv.width / 2, cv.height / 2);
              });
            } else pv.draw();
          } catch (_) {}
        };
        tiles.forEach(t => {
          sample(t.dataset.viz, t.querySelector('canvas'));
          t.onclick = () => { mark(t.dataset.viz); auto.vizStyle = t.dataset.viz; clearDev(); save({ auto_start_viz_style: t.dataset.viz }); };
        });
        mark();
      }
    }

    // ── Screensaver ──────────────────────────────────────────────────────────
    {
      const clockEl = root.getElementById('screensaver_clock'), wxEl = root.getElementById('screensaver_weather');
      if (clockEl) { clockEl.checked = this._config?.screensaver_clock !== false; clockEl.onchange = (e) => this._updateConfig('screensaver_clock', e.target.checked); }
      const fullEl = root.getElementById('screensaver_full');
      if (fullEl) { fullEl.checked = this._config?.screensaver_area === 'screen'; fullEl.onchange = (e) => this._updateConfig('screensaver_area', e.target.checked ? 'screen' : 'artwork'); }
      // Analogue clock faces: a small drawing of each dial to pick from
      const faceEl = root.getElementById('screensaver_dial');
      if (faceEl) {
        const btns = [...faceEl.querySelectorAll('.saver-face')];
        const mark = (pick) => {
          const want = pick || this._config?.screensaver_dial;
          const cur = btns.some(b => b.dataset.face === want) ? want : 'luxury';
          btns.forEach(b => {
            const on = b.dataset.face === cur;
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.style.borderColor = on ? 'var(--primary-color,#03a9f4)' : 'transparent';
            b.style.background = on ? 'rgba(3,169,244,0.10)' : 'rgba(128,128,128,0.06)';
          });
        };
        btns.forEach(b => {
          const cv = b.querySelector('canvas');
          if (cv && typeof CrowMediaClockDrawer === 'function') {
            try {
              const d = new CrowMediaClockDrawer(cv);
              d.setConfig({ face: b.dataset.face, dial_color: '#101015', dial_text_color: '#FFFFFF', accent_color: this._config?.accent_color || '#007AFF',
                hour_hand_color: '#FFFFFF', minute_hand_color: '#FFFFFF', second_hand_color: '#FF3B30', show_seconds: true });
              d.resize(52);
              d.draw(10, 9, 36, (36 / 60) * 2 * Math.PI);
            } catch (_) {}
          }
          b.onclick = () => { mark(b.dataset.face); this._updateConfig('screensaver_dial', b.dataset.face); };
        });
        mark();
      }
      if (wxEl) {
        const cur = this._config?.screensaver_weather || '';
        const ents = Object.keys(this._hass?.states || {}).filter(id => id.startsWith('weather.')).sort();
        if (cur && !ents.includes(cur)) ents.unshift(cur);
        const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        wxEl.innerHTML = '<option value="">None</option>' + ents.map(id => '<option value="' + esc(id) + '">' + esc(this._hass?.states[id]?.attributes?.friendly_name || id) + '</option>').join('');
        wxEl.value = cur;
        wxEl.onchange = (e) => this._updateConfig('screensaver_weather', e.target.value);
      }
    }
    const ambientGlowEl = root.getElementById('ambient_glow');
    if (ambientGlowEl) {
      ambientGlowEl.checked = this._config?.ambient_glow === true;
      ambientGlowEl.onchange = (e) => {
        this._updateConfig('ambient_glow', e.target.checked);
        if (!e.target.checked) this._clearAmbientGlow();
      };
    }
    const rowGlowEl = root.getElementById('row_glow');
    if (rowGlowEl) {
      rowGlowEl.checked = this._config?.row_glow === true;
      rowGlowEl.onchange = (e) => this._updateConfig('row_glow', e.target.checked);
    }
    const rowSwipesEl = root.getElementById('row_swipes');
    if (rowSwipesEl) {
      rowSwipesEl.checked = this._config?.row_swipes !== false;
      rowSwipesEl.onchange = (e) => this._updateConfig('row_swipes', e.target.checked);
    }
    const kbEl = root.getElementById('keyboard_shortcuts');
    if (kbEl) {
      kbEl.checked = this._config?.keyboard_shortcuts !== false;
      kbEl.onchange = (e) => this._updateConfig('keyboard_shortcuts', e.target.checked);
    }
    const iconThemeEl = root.getElementById('icon_theme');
    if (iconThemeEl) {
      iconThemeEl.value = this._config?.icon_theme || 'robot';
      iconThemeEl.onchange = (e) => { this._updateConfig('icon_theme', e.target.value); };
    }
    const artCrossfadeEl = root.getElementById('artwork_crossfade');
    if (artCrossfadeEl) {
      artCrossfadeEl.checked = this._config?.artwork_crossfade === true;
      artCrossfadeEl.onchange = (e) => this._updateConfig('artwork_crossfade', e.target.checked);
    }

    const pinHeartsEl = root.getElementById('pin_hearts');
    if (pinHeartsEl) {
      pinHeartsEl.checked = this._config?.pin_hearts !== false;
      pinHeartsEl.onchange = (e) => this._updateConfig('pin_hearts', e.target.checked);
    }

    const showRemoteBtnEl = root.getElementById('show_remote_button');
    if (showRemoteBtnEl) {
      showRemoteBtnEl.checked = this._config?.show_remote_button !== false;
      showRemoteBtnEl.onchange = (e) => this._updateConfig('show_remote_button', e.target.checked);
    }

    const atvKeyboardPanelEl = root.getElementById('atv_keyboard_panel');
    if (atvKeyboardPanelEl) {
      atvKeyboardPanelEl.checked = this._config?.atv_keyboard_panel !== false;
      atvKeyboardPanelEl.onchange = (e) => this._updateConfig('atv_keyboard_panel', e.target.checked);
    }
    const atvAppsBtnEl = root.getElementById('atv_apps_button');
    if (atvAppsBtnEl) {
      atvAppsBtnEl.checked = this._config?.atv_apps_button !== false;
      atvAppsBtnEl.onchange = (e) => this._updateConfig('atv_apps_button', e.target.checked);
    }

    const showMALibBtnEl = root.getElementById('show_ma_library_button');
    if (showMALibBtnEl) {
      showMALibBtnEl.checked = this._config?.show_ma_library_button !== false;
      showMALibBtnEl.onchange = (e) => this._updateConfig('show_ma_library_button', e.target.checked);
    }

    const showMediaTypePillEl = root.getElementById('show_media_type_pill');
    if (showMediaTypePillEl) {
      showMediaTypePillEl.checked = this._config?.show_media_type_pill === true;
      showMediaTypePillEl.onchange = (e) => this._updateConfig('show_media_type_pill', e.target.checked);
    }
    const showYoutubeBtnEl = root.getElementById('show_youtube_button');
    if (showYoutubeBtnEl) {
      showYoutubeBtnEl.checked = this._config?.show_youtube_button !== false;
      showYoutubeBtnEl.onchange = (e) => this._updateConfig('show_youtube_button', e.target.checked);
    }
    const showVibeEl = root.getElementById('show_vibe');
    if (showVibeEl) {
      showVibeEl.checked = this._config?.show_vibe === true;
      showVibeEl.onchange = (e) => this._updateConfig('show_vibe', e.target.checked);
    }
    // Master AI Features switch — also dims every AI-dependent control in
    // the editor (.ai-dep: agent picker, agent note) while off, so it's immediately clear those settings
    // have no effect until AI is enabled. Dimmed rather than hidden so
    // users can still see what enabling AI would unlock.
    const _applyAiDepState = (on) => {
      root.querySelectorAll('.ai-dep').forEach(el => {
        el.style.opacity = on ? '' : '0.35';
        el.style.pointerEvents = on ? '' : 'none';
      });
    };
    const aiFeaturesEl = root.getElementById('ai_features_enabled');
    if (aiFeaturesEl) {
      aiFeaturesEl.checked = this._config?.ai_features_enabled === true;
      _applyAiDepState(aiFeaturesEl.checked);
      aiFeaturesEl.onchange = (e) => {
        this._updateConfig('ai_features_enabled', e.target.checked);
        _applyAiDepState(e.target.checked);
        this._updateAgentWarn?.();
      };
    }
    const sendspinEnabledEl = root.getElementById('sendspin_enabled');
    const sendspinOptsEl = root.getElementById('sendspinOpts');
    if (sendspinEnabledEl) {
      sendspinEnabledEl.checked = this._config?.sendspin_enabled === true;
      if (sendspinOptsEl) sendspinOptsEl.style.display = sendspinEnabledEl.checked ? '' : 'none';
      sendspinEnabledEl.onchange = (e) => {
        if (sendspinOptsEl) sendspinOptsEl.style.display = e.target.checked ? '' : 'none';
        this._updateConfig('sendspin_enabled', e.target.checked);
      };
    }
    const sendspinUrlEl = root.getElementById('sendspin_url');
    if (sendspinUrlEl) {
      sendspinUrlEl.value = this._config?.sendspin_url || '';
      sendspinUrlEl.onchange = (e) => this._updateConfig('sendspin_url', e.target.value.trim());
    }
    const ghostSkipHealEl = root.getElementById('ghost_skip_heal');
    if (ghostSkipHealEl) {
      ghostSkipHealEl.checked = this._config?.ghost_skip_heal !== false; // default on
      ghostSkipHealEl.onchange = (e) => this._updateConfig('ghost_skip_heal', e.target.checked);
    }

    const resizeBtnSpinEl = root.getElementById('resize_btn_spin');
    if (resizeBtnSpinEl) {
      resizeBtnSpinEl.checked = this._config?.resize_btn_spin !== false;
      resizeBtnSpinEl.onchange = (e) => this._updateConfig('resize_btn_spin', e.target.checked);
    }

    const controlsThemeEl = root.getElementById('controls_theme_select');
    if (controlsThemeEl) {
      controlsThemeEl.value = this._config?.controls_theme || 'classic';
      controlsThemeEl.onchange = (e) => { this._updateConfig('controls_theme', e.target.value); };
    }

    const itunesArtEl = root.getElementById('itunes_art');
    if (itunesArtEl) {
      itunesArtEl.checked = this._config?.itunes_art !== false;
      itunesArtEl.onchange = (e) => this._updateConfig('itunes_art', e.target.checked);
    }

    const volumeHudGlassEl = root.getElementById('volume_hud_glass');
    if (volumeHudGlassEl) {
      volumeHudGlassEl.checked = this._config?.volume_hud_glass === true;
      volumeHudGlassEl.onchange = (e) => this._updateConfig('volume_hud_glass', e.target.checked);
    }

    const volumeHudEl = root.getElementById('volume_hud');
    if (volumeHudEl) {
      volumeHudEl.checked = this._config?.volume_hud !== false;
      volumeHudEl.onchange = (e) => this._updateConfig('volume_hud', e.target.checked);
    }

    ['classic', 'glass'].forEach(v => {
      const el = root.getElementById('cs_' + v);
      if (el) el.onchange = () => this._updateConfig('card_liquid_glass', v === 'glass');
    });
    // Skin: choosing one here also clears this device's own choice from the ••• menu, so the change shows
    const _skinUi = () => {
      const on = !!this._config?.skin;
      const seg = root.getElementById('card-style-segmented');
      if (seg) { seg.style.opacity = on ? '0.4' : ''; seg.style.pointerEvents = on ? 'none' : ''; }
      const note = root.getElementById('cardSkinGlassNote');
      if (note) note.style.display = on ? 'block' : 'none';
    };
    const skinSel = root.getElementById('skin_select');
    if (skinSel) {
      skinSel.value = this._config?.skin || '';
      skinSel.onchange = (e) => {
        try { localStorage.removeItem('crow_media_skin_' + (this._config?.entities?.[0] || '')); } catch (_) {}
        this._updateConfig('skin', e.target.value);
        _skinUi();
      };
    }
    const skinMenuEl = root.getElementById('skin_menu');
    if (skinMenuEl) {
      skinMenuEl.checked = this._config?.skin_menu !== false;
      skinMenuEl.onchange = (e) => this._updateConfig('skin_menu', e.target.checked);
    }
    _skinUi();
    ['auto', 'light', 'dark'].forEach(v => {
      const el = root.getElementById('ap_' + v);
      if (el) el.onchange = () => this._updateConfig('appearance', v);
    });

    const remoteArtBlurEl = root.getElementById('remote_art_blur');
    if (remoteArtBlurEl) {
      remoteArtBlurEl.checked = this._config?.remote_art_blur !== false;
      remoteArtBlurEl.onchange = (e) => this._updateConfig('remote_art_blur', e.target.checked);
    }

    // ── Vibe Artist Seeds ───────────────────────────────────────────────
    // ── Collapsible groups (Player & Controls, Music Assistant, Discover & Charts, Lyrics, AI,
    //    Screensaver, Visual Effects): tap the header to open or close
    root.querySelectorAll('[data-grp]').forEach(h => {
      const k = h.dataset.grp, b = root.getElementById(k + 'Body'), c = root.getElementById(k + 'Chevron');
      if (!b) return;
      h.addEventListener('click', () => {
        const open = b.style.display !== 'none';
        b.style.display = open ? 'none' : 'flex';
        b.style.flexDirection = 'column';
        if (c) c.style.transform = open ? '' : 'rotate(90deg)';
      });
    });

    // ── Colours & Themes collapsible ─────────────────────────────────────────
    const _coloursHeader  = root.getElementById('coloursHeader');
    const _coloursBody    = root.getElementById('coloursBody');
    const _coloursChevron = root.getElementById('coloursChevron');
    if (_coloursHeader && _coloursBody) {
      _coloursHeader.addEventListener('click', () => {
        const open = _coloursBody.style.display !== 'none';
        _coloursBody.style.display = open ? 'none' : 'flex';
        _coloursBody.style.flexDirection = 'column';
        if (_coloursChevron) _coloursChevron.style.transform = open ? '' : 'rotate(90deg)';
      });
    }

    // ── Caches & Data collapsible ────────────────────────────────────────────
    const _cachesHeader  = root.getElementById('cachesDataHeader');
    const _cachesBody    = root.getElementById('cachesDataBody');
    const _cachesChevron = root.getElementById('cachesDataChevron');
    if (_cachesHeader && _cachesBody) {
      _cachesHeader.addEventListener('click', () => {
        const open = _cachesBody.style.display !== 'none';
        _cachesBody.style.display = open ? 'none' : 'flex';
        _cachesBody.style.flexDirection = 'column';
        if (_cachesChevron) _cachesChevron.style.transform = open ? '' : 'rotate(90deg)';
      });
    }

    const moodPromptHeader  = root.getElementById('moodPromptHeader');
    const moodPromptBody    = root.getElementById('moodPromptBody');
    const moodPromptChevron = root.getElementById('moodPromptChevron');
    const moodCatContainer  = root.getElementById('moodPromptCategories');
    const moodResetAllBtn   = root.getElementById('moodResetAllBtn');

    if (moodPromptHeader && moodPromptBody) {
      moodPromptHeader.addEventListener('click', () => {
        const open = moodPromptBody.style.display !== 'none';
        moodPromptBody.style.display = open ? 'none' : 'flex';
        moodPromptBody.style.flexDirection = 'column';
        if (moodPromptChevron) moodPromptChevron.style.transform = open ? '' : 'rotate(90deg)';
        // Build mood rows on first open
        if (!open && moodCatContainer && !moodCatContainer._built) {
          this._buildMoodEditorRows(moodCatContainer);
          moodCatContainer._built = true;
        }
      });
    }

    if (moodResetAllBtn) {
      moodResetAllBtn.addEventListener('click', () => {
        this._updateConfig('mood_overrides', {});
        this._updateConfig('mood_query_overrides', {});
        // Rebuild rows to show defaults
        if (moodCatContainer) {
          moodCatContainer._built = false;
          moodCatContainer.innerHTML = '';
          this._buildMoodEditorRows(moodCatContainer);
          moodCatContainer._built = true;
        }
      });
    }

    // ── Colour preview strip — init with current config values ────────────────
    const _initPreview = () => {
      const r2 = root;
      const _a = this._config?.accent_color  || '#007AFF';
      const _v = this._config?.volume_accent || _a;
      const _t = this._config?.title_color   || '#ffffff';
      const _ar = this._config?.artist_color || '#aaaaaa';
      r2.getElementById('preview-accent')?.style.setProperty('background', _a);
      r2.getElementById('preview-volume')?.style.setProperty('background', _v);
      r2.getElementById('preview-text')?.style.setProperty('background', _t);
      r2.getElementById('preview-artist')?.style.setProperty('background', _ar);
    };
    _initPreview();

    // ── Search / filter ───────────────────────────────────────────────────────
    const editorSearch = root.getElementById('editor-search');
    // ── Filter settings: searches the editor's own text, setting by setting ──
    // Every word typed must appear (any order) in a setting's name, description or choices. Collapsed
    // groups holding a match are opened, settings that don't match are hidden, and a match on a section's
    // or group's own name shows all of it. Clearing the box puts everything back exactly as it was.
    if (editorSearch) {
      const container = root.querySelector('.container');
      const ROW = '.toggle-item, .check-item, .card-block > div, [id$="Body"] > div, .toggle-list > div, .checklist > *';
      const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
      let empty = root.getElementById('editor-search-empty');
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'editor-search-empty';
        empty.style.cssText = 'display:none;font-size:12px;color:var(--secondary-text-color,#888);padding:8px 2px 0;';
        editorSearch.parentElement.appendChild(empty);
      }
      const restore = () => {
        container.querySelectorAll('[data-es-hidden]').forEach(el => { el.style.display = el.dataset.esPrev || ''; delete el.dataset.esHidden; delete el.dataset.esPrev; });
        container.querySelectorAll('[data-es-open]').forEach(b => {
          b.style.display = 'none';
          const c = root.getElementById(b.id.replace(/Body$/, 'Chevron'));
          if (c) c.style.transform = b.dataset.esChev || '';
          delete b.dataset.esOpen; delete b.dataset.esChev;
        });
      };
      const apply = () => {
        if (!container) return;
        restore();
        const words = norm(editorSearch.value).trim().split(' ').filter(Boolean);
        empty.style.display = 'none';
        if (!words.length) return;
        const hit = t => { const n = norm(t); return words.every(w => n.includes(w)); };
        const hide = el => { if (el.dataset.esHidden) return; el.dataset.esHidden = '1'; el.dataset.esPrev = el.style.display; el.style.display = 'none'; };
        const unhide = el => { el.style.display = el.dataset.esPrev || ''; delete el.dataset.esHidden; delete el.dataset.esPrev; };
        // the rows directly inside el (not inside another row)
        const childRows = el => [...el.querySelectorAll(ROW)].filter(r => { const a = r.parentElement?.closest(ROW); return !a || a === el || !el.contains(a); });
        // collapsible groups: their one-line summaries ("Display · Volume · Lyrics…") only repeat what's
        // inside, so they don't count as matches; the groups are opened so their settings can show
        const pairs = [...container.querySelectorAll('[id$="Header"]')].map(h => ({ h, b: root.getElementById(h.id.replace(/Header$/, 'Body')) })).filter(p => p.b);
        const skip = new Set();
        pairs.forEach(p => {
          const leaves = [...p.h.querySelectorAll('div')].filter(d => !d.children.length && d.textContent.trim());
          leaves.slice(1).forEach(d => skip.add(d));
          if (p.b.style.display !== 'none') return;
          const c = root.getElementById(p.b.id.replace(/Body$/, 'Chevron'));
          p.b.dataset.esOpen = '1'; p.b.dataset.esChev = c?.style.transform || '';
          p.b.style.display = 'flex'; p.b.style.flexDirection = 'column';
          if (c) c.style.transform = 'rotate(90deg)';
        });
        // an element's searchable words (optionally without the rows nested inside it: its own label and description)
        const txt = (el, ownOnly) => {
          let out = '';
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            let p = n.parentElement, skipIt = false;
            while (p && p !== el) { if (skip.has(p) || (ownOnly && p.matches(ROW)) || p.tagName === 'STYLE') { skipIt = true; break; } p = p.parentElement; }
            if (!skipIt) out += ' ' + n.nodeValue;
          }
          return out;
        };
        // the most specific match wins: settings that match show on their own; a whole group or row shows
        // only when its own name matches and nothing inside it does
        const visit = el => childRows(el).forEach(r => {
          if (!hit(txt(r))) { hide(r); return; }
          const kids = childRows(r);
          if (!kids.length) return;
          if (kids.some(x => hit(txt(x)))) { visit(r); return; }
          if (!hit(txt(r, true))) hide(r);   // the words are spread across different settings
        });
        let any = false;
        [...container.children].forEach(sec => {
          if (sec.contains(editorSearch) || sec.querySelector('#editor-reset-btn')) return;   // search + reset stay
          const title = sec.querySelector(':scope > .section-title');
          const kidsHit = childRows(sec).some(r => hit(txt(r)));
          if (kidsHit) visit(sec);
          else if (!(title && hit(title.textContent))) { hide(sec); return; }
          any = true;
        });
        pairs.forEach(p => {
          // a group whose own name matched with nothing inside matching shows whole
          if (p.b.dataset.esHidden && !p.b.parentElement.closest('[data-es-hidden]') && hit(txt(p.h))) {
            unhide(p.b); p.b.querySelectorAll('[data-es-hidden]').forEach(unhide);
            if (p.h.dataset.esHidden) unhide(p.h);
          }
          // and a group's header stays with any of its settings that are showing
          if (!p.b.closest('[data-es-hidden]') && p.h.dataset.esHidden) unhide(p.h);
        });
        // a section left with nothing showing is hidden too
        [...container.children].forEach(sec => {
          if (sec.dataset.esHidden || sec.contains(editorSearch) || sec.querySelector('#editor-reset-btn')) return;
          const title = sec.querySelector(':scope > .section-title');
          if (title && hit(title.textContent)) return;
          const rows = childRows(sec);
          if (rows.length && rows.every(r => r.dataset.esHidden)) hide(sec);
        });
        any = [...container.children].some(sec => !sec.dataset.esHidden && !sec.contains(editorSearch) && !sec.querySelector('#editor-reset-btn'));
        if (!any) { empty.textContent = 'No settings match “' + editorSearch.value.trim() + '”.'; empty.style.display = 'block'; }
      };
      editorSearch.addEventListener('input', apply);
      editorSearch.addEventListener('keydown', e => { if (e.key === 'Escape') { editorSearch.value = ''; apply(); } });
    }

    // ── Reset to Defaults ─────────────────────────────────────────────────────
    const resetBtn = root.getElementById('editor-reset-btn');
    const resetConfirm = root.getElementById('editor-reset-confirm');
    if (resetBtn && resetConfirm) {
      resetBtn.addEventListener('click', () => {
        resetConfirm.style.display = resetConfirm.style.display === 'none' ? 'block' : 'none';
      });
      root.getElementById('editor-reset-cancel-btn')?.addEventListener('click', () => {
        resetConfirm.style.display = 'none';
      });
      root.getElementById('editor-reset-confirm-btn')?.addEventListener('click', () => {
        const _entity = this._config?.entity || '';
        this._config = { entity: _entity };
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
        resetConfirm.style.display = 'none';
        this._render();
      });
    }

    // ── Bio Cache (actor/artist bios) ─────────────────────────────────────────
    const bioCacheStatus   = root.getElementById('bio-cache-status');
    const bioCacheClearBtn = root.getElementById('bio-cache-clear-btn');
    if (bioCacheStatus) {
      try {
        const _bioKeys = Object.keys(localStorage).filter(k => k.includes('castBio') || k.includes('crow_media_ai_local_bio'));
        bioCacheStatus.textContent = _bioKeys.length ? `${_bioKeys.length} bio${_bioKeys.length !== 1 ? 's' : ''} cached` : 'No bios cached';
      } catch(_) { bioCacheStatus.textContent = 'Unavailable'; }
    }
    if (bioCacheClearBtn) {
      bioCacheClearBtn.addEventListener('click', () => {
        try {
          const _keys = Object.keys(localStorage).filter(k => k.includes('castBio') || k.includes('crow_media_ai_local_bio'));
          _keys.forEach(k => localStorage.removeItem(k));
          // Clear in-memory cache on the card instance
          const cardEl = document.querySelector('crow-media-player-card');
          if (cardEl?._castBioCache) cardEl._castBioCache.clear();
          if (bioCacheStatus) bioCacheStatus.textContent = 'No bios cached';
          bioCacheClearBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:4px;"></ha-icon>Cleared';
          setTimeout(() => { bioCacheClearBtn.textContent = 'Clear'; }, 2000);
        } catch(_) {}
      });
    }

    // ── Where to Watch cache ────────────────────────────────────────────────────
    const wtwCacheStatus   = root.getElementById('wtw-cache-status');
    const wtwCacheClearBtn = root.getElementById('wtw-cache-clear-btn');
    const _getCardEl = () => document.querySelector('crow-media-player-card') || [...document.querySelectorAll('*')].find(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
    const _countLocalCache = (name) => { try { return Object.keys(JSON.parse(localStorage.getItem('crow_media_ai_local_' + name) || '{}')).length; } catch(_) { return 0; } };
    const _clearLocalCache = (name, cardProp) => {
      try { localStorage.removeItem('crow_media_ai_local_' + name); } catch(_) {}
      const ce = _getCardEl(); if (ce && cardProp && ce[cardProp]) ce[cardProp] = new Map();
    };
    if (wtwCacheStatus) {
      const n = _countLocalCache('wtw'); wtwCacheStatus.textContent = n ? `${n} title${n !== 1 ? 's' : ''} cached` : 'No entries cached';
    }
    if (wtwCacheClearBtn) wtwCacheClearBtn.addEventListener('click', () => {
      _clearLocalCache('wtw', '_aiWtwCache');
      if (wtwCacheStatus) wtwCacheStatus.textContent = 'No entries cached';
      wtwCacheClearBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:0px;"></ha-icon>'; setTimeout(() => { wtwCacheClearBtn.textContent = 'Clear'; }, 2000);
    });

    // ── Trivia & Meanings cache ──────────────────────────────────────────────────
    const triviaCacheStatus   = root.getElementById('trivia-cache-status');
    const triviaCacheClearBtn = root.getElementById('trivia-cache-clear-btn');
    if (triviaCacheStatus) {
      const n = _countLocalCache('trivia') + _countLocalCache('mTrivia') + _countLocalCache('bioTrivia') + _countLocalCache('meaning') + _countLocalCache('story') + _countLocalCache('spotIt');
      triviaCacheStatus.textContent = n ? `${n} entr${n !== 1 ? 'ies' : 'y'} cached` : 'No entries cached';
    }
    if (triviaCacheClearBtn) triviaCacheClearBtn.addEventListener('click', () => {
      ['trivia','mTrivia','bioTrivia','meaning','story','spotIt'].forEach(name => _clearLocalCache(name, null));
      const ce = _getCardEl();
      if (ce) { ['_aiTriviaCache','_aiMusicTriviaCache','_aiBioTriviaCache','_aiMeaningCache','_aiStoryCache','_aiSpotCache'].forEach(k => { if (ce[k]) ce[k] = new Map(); }); }
      if (triviaCacheStatus) triviaCacheStatus.textContent = 'No entries cached';
      triviaCacheClearBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:0px;"></ha-icon>'; setTimeout(() => { triviaCacheClearBtn.textContent = 'Clear'; }, 2000);
    });

    // ── Content Warnings cache ───────────────────────────────────────────────────
    const cwCacheStatus   = root.getElementById('cw-cache-status');
    const cwCacheClearBtn = root.getElementById('cw-cache-clear-btn');
    if (cwCacheStatus) {
      const n = _countLocalCache('cw'); cwCacheStatus.textContent = n ? `${n} title${n !== 1 ? 's' : ''} cached` : 'No entries cached';
    }
    if (cwCacheClearBtn) cwCacheClearBtn.addEventListener('click', () => {
      _clearLocalCache('cw', '_aiCwCache');
      if (cwCacheStatus) cwCacheStatus.textContent = 'No entries cached';
      cwCacheClearBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:0px;"></ha-icon>'; setTimeout(() => { cwCacheClearBtn.textContent = 'Clear'; }, 2000);
    });

    // ── Year in Music cache ──────────────────────────────────────────────────────
    const dayMusicCacheStatus   = root.getElementById('daymusic-cache-status');
    const dayMusicCacheClearBtn = root.getElementById('daymusic-cache-clear-btn');
    if (dayMusicCacheStatus) {
      const n = _countLocalCache('dayMusic'); dayMusicCacheStatus.textContent = n ? `${n} year${n !== 1 ? 's' : ''} cached` : 'No entries cached';
    }
    if (dayMusicCacheClearBtn) dayMusicCacheClearBtn.addEventListener('click', () => {
      _clearLocalCache('dayMusic', '_aiDayMusicCache');
      if (dayMusicCacheStatus) dayMusicCacheStatus.textContent = 'No entries cached';
      dayMusicCacheClearBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:0px;"></ha-icon>'; setTimeout(() => { dayMusicCacheClearBtn.textContent = 'Clear'; }, 2000);
    });

    // ── Clear Caches ──────────────────────────────────────────────────────────
    // ── Further caches: Discogs, already-added songs, covers, charts, podcast/audiobook lists,
    //    announcement history and icon lookups ────────────────────────────────────────────────
    const _cards = () => [...document.querySelectorAll('*')].filter(el => el.tagName?.toLowerCase() === 'crow-media-player-card');
    const _lsJson = (k, dflt) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? dflt : v; } catch (_) { return dflt; } };
    const _n = (count, one, many) => count + ' ' + (count === 1 ? one : (many || one + 's'));
    const _wire = (key, status, clear) => {
      const st = root.getElementById(key + '-status'), btn = root.getElementById(key + '-clear-btn');
      const upd = async () => { if (!st) return; try { st.textContent = await status(); } catch (_) { st.textContent = 'Nothing cached'; } };
      upd();
      if (btn) btn.onclick = async () => { try { await clear(); } catch (_) {} upd(); };
      return upd;
    };
    // a store in one of the card's browser databases: counted and emptied through the card's own
    // connection when a card is on the page (so nothing is left blocked), otherwise opened directly
    const _idbStore = async (dbName, store, getter) => {
      const ce = _cards()[0];
      if (ce && typeof ce[getter] === 'function') { try { const db = await ce[getter](); if (db) return db; } catch (_) {} }
      return new Promise(res => {
        try {
          const rq = indexedDB.open(dbName);
          rq.onsuccess = () => res(rq.result.objectStoreNames.contains(store) ? rq.result : null);
          rq.onerror = rq.onblocked = () => res(null);
          rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (_) {} res(null); };
        } catch (_) { res(null); }
      });
    };
    const _idbCount = async (dbName, store, getter) => {
      const db = await _idbStore(dbName, store, getter);
      if (!db) return 0;
      return new Promise(res => { try { const r = db.transaction(store, 'readonly').objectStore(store).count(); r.onsuccess = () => res(r.result || 0); r.onerror = () => res(0); } catch (_) { res(0); } });
    };
    const _idbClear = async (dbName, store, getter) => {
      const db = await _idbStore(dbName, store, getter);
      if (!db) return;
      await new Promise(res => { try { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = tx.onerror = tx.onabort = () => res(); } catch (_) { res(); } });
    };
    const DISCOGS_KEYS = ['crow_media_discogs_fb_store_v3', 'crow_media_discogs_fb_release_store_v3'];
    const ADDED_KEYS = ['crow_media_ai_similar_added', 'crow_media_ai_same_year_added', 'crow_media_ai_same_genre_added', 'crow_media_ai_same_genre_year_added'];
    const clearDiscogs = () => {
      DISCOGS_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      _cards().forEach(el => { Object.keys(el).filter(k => /^_discogs/i.test(k) && (el[k] instanceof Map || (el[k] && typeof el[k] === 'object' && !Array.isArray(el[k]) && !(el[k] instanceof Promise)))).forEach(k => { el[k] = el[k] instanceof Map ? new Map() : {}; }); });
    };
    const clearAdded = () => {
      ADDED_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      _cards().forEach(el => { ['_aiSimilarAdded', '_aiAddSimilarCache'].forEach(k => { if (el[k]) el[k] = el[k] instanceof Map ? new Map() : {}; }); });
    };
    const clearCovers = async () => {
      await _idbClear('crow-media-covers', 'covers', '_coverDb');
      _cards().forEach(el => { el._coverMem = new Map(); });
    };
    const clearCharts = async () => {
      try { localStorage.removeItem('crow_media_chart_day'); } catch (_) {}
      await _idbClear('crow_media_charts', 'kv', '_chartIdb');
      _cards().forEach(el => { el._chartStoreMem = null; el._chartStoreLoading = null; });
    };
    const clearPcAb = () => {
      ['crow_media_pc_episode_cache', 'crow_media_ab_chapter_cache'].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      _cards().forEach(el => { el._pcEpisodeCache = new Map(); el._abChapterCache = new Map(); });
    };
    const clearAnnounce = () => {
      // favourites are the user's own, so they stay
      const fav = _lsJson('crow_media_announce_history', []).filter(h => h && h.favourite);
      try { fav.length ? localStorage.setItem('crow_media_announce_history', JSON.stringify(fav)) : localStorage.removeItem('crow_media_announce_history'); } catch (_) {}
    };
    const clearMdi = () => {
      try { localStorage.removeItem('crow_media_mdi_paths'); } catch (_) {}
      try { if (CrowMediaPlayerCard._mdiPathCache) CrowMediaPlayerCard._mdiPathCache.clear(); } catch (_) {}
    };
    const clearWikiImages = async () => {
      try { if (window.caches) await window.caches.delete('crow-media-wiki-img-v1'); } catch (_) {}
      _cards().forEach(el => { el._wikiImgCachePromise = undefined; });
    };
    // Apple TV app icons: this device's copy, the copy in Home Assistant, and every card's memory
    const clearAppIcons = () => {
      ['crow_media_atv_app_icons', 'crow_media_atv_app_icon_miss', 'crow_media_atv_app_icon_miss2', 'crow_media_atv_app_icon_site', 'crow_media_atv_app_sites'].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      try { crowMediaAppIconDb.clear(); } catch (_) {}
      try { crowMediaUserData((this._hass || _cards()[0]?._hass)?.connection, { type: 'frontend/set_user_data', key: 'crow_media_atv_app_icons', value: {} }).catch(() => {}); } catch (_) {}
      _cards().forEach(el => { el._appIconCache = {}; el._appIconMiss = {}; el._appIconReadyP = Promise.resolve(); el._appIconUrls = {}; el._appIconPrefetchAt = 0; el._appIconAskedAt = {}; });
    };
    const clearVibePool = () => {
      try { localStorage.removeItem('crow_media_vibe_pool_v1'); } catch (_) {}
      try { sessionStorage.removeItem('crow_media_mood_lib_cache'); } catch (_) {}
    };
    const _furtherUpd = [
      _wire('discogs-cache', () => { const n = DISCOGS_KEYS.reduce((a, k) => a + Object.keys(_lsJson(k, {})).length, 0); return n ? _n(n, 'entry', 'entries') + ' cached' : 'Nothing cached'; }, clearDiscogs),
      _wire('added-cache', () => { const n = ADDED_KEYS.reduce((a, k) => { const v = _lsJson(k, {}); return a + Object.values(v).reduce((b, x) => b + (Array.isArray(x) ? x.length : 1), 0); }, 0); return n ? _n(n, 'song') + ' remembered' : 'Nothing remembered'; }, clearAdded),
      _wire('covers-cache', async () => { const n = await _idbCount('crow-media-covers', 'covers', '_coverDb'); return n ? _n(n, 'cover') + ' kept' : 'No covers kept'; }, clearCovers),
      _wire('charts-cache', async () => {
        const day = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
        const ls = _lsJson('crow_media_chart_day', null);
        const n = ls && ls.day === day && ls.items ? Object.keys(ls.items).length : 0;
        return n ? _n(n, 'chart') + ' kept for today' : 'No charts kept';
      }, clearCharts),
      _wire('pcab-cache', () => { const p = Object.keys(_lsJson('crow_media_pc_episode_cache', {})).length, a = Object.keys(_lsJson('crow_media_ab_chapter_cache', {})).length; return p + a ? _n(p, 'podcast') + ', ' + _n(a, 'audiobook') + ' cached' : 'Nothing cached'; }, clearPcAb),
      _wire('appicon-cache', () => { const n = Object.keys(_lsJson('crow_media_atv_app_icons', {})).length; return n ? _n(n, 'icon') + ' kept' : 'No icons kept'; }, clearAppIcons),
      _wire('announce-hist', () => { const h = _lsJson('crow_media_announce_history', []); const fav = h.filter(x => x && x.favourite).length; return h.length ? _n(h.length, 'announcement') + (fav ? ' (' + fav + ' favourite' + (fav === 1 ? '' : 's') + ')' : '') : 'No history'; }, clearAnnounce),
      _wire('viz-bpm', () => { const n = Object.keys(_lsJson('crow_media_viz_bpm', {})).length; return n ? _n(n, 'song') + ' looked up' : 'Nothing looked up'; }, () => { try { localStorage.removeItem('crow_media_viz_bpm'); } catch (_) {} }),
      _wire('mdi-cache', () => { const n = Object.keys(_lsJson('crow_media_mdi_paths', {})).length; return n ? _n(n, 'icon') + ' cached' : 'No icons cached'; }, clearMdi),
    ];

    const clearAllBtn = root.getElementById('clear-all-caches-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        try {
          // Clear All Caches clears caches, not things that are yours: pins, saved stations and queues,
          // Music and Watch History, muted artists, favourite announcements and the card's remembered
          // choices (last speaker and view, Radio Mode, a running sleep timer) all stay
          const KEEP = ['crow_media_pin_', 'crow_media_starred_', 'crow_media_saved_queues', 'crow_media_ai_local_listenLog', 'crow_media_ai_local_watchLog',
            'crow_media_ai_local_listenDaily', 'crow_media_ai_local_historyCheckpoint', 'crow_media_ai_local_mutedArtists', 'crow_media_ai_local_recapClearedAt',
            'crow_media_ai_local_maRecapState', 'crow_media_announce_history', 'crow_media_last_entity_', 'crow_media_view_', 'crow_media_library_open_',
            'crow_media_radio_mode', 'crow_media_sleep_timer', 'crow_media_chart_limit'];
          clearAnnounce();
          clearMdi();
          clearAppIcons();
          Promise.all([clearCovers(), clearCharts(), clearWikiImages()]).catch(() => {}).then(() => _furtherUpd.forEach(f => f()));
          const _rm = (storage) => {
            const keys = [];
            for (let i = 0; i < storage.length; i++) {
              const k = storage.key(i);
              // crow_media_pin_* keys are user pins — intentional data, not cache.
              // They survive Clear All Caches and are only managed via the
              // Pinned Items section in the editor.
              if (!k) continue;
              const isCache = k.startsWith('crow_media_') || k.startsWith('crow-media-') || DISCOGS_KEYS.includes(k);
              if (isCache && !KEEP.some(x => x.endsWith('_') ? k.startsWith(x) : k === x)) keys.push(k);
            }
            keys.forEach(k => storage.removeItem(k));
            return keys.length;
          };
          const n = _rm(localStorage) + _rm(sessionStorage);

          // Also reset every in-memory cache on every live card instance on the page.
          // Without this, a card that's been running since before this button was
          // pressed keeps serving stale results (e.g. a Wikipedia photo lookup that
          // failed earlier in the session stays cached as "no photo" in memory even
          // though the persisted copy was just deleted) until the dashboard is fully
          // reloaded — which makes it look like clearing the cache did nothing.
          const _cacheKeys = [
            '_wikiThumbUrlCache', '_wikiBlobCache', '_castPhotoCache', '_castBioCache',
            '_itunesArtCache', '_itunesMiniCache', '_itunesMoviePosterCache', '_discogsArtCache',
            '_aiTrackInfoCache', '_aiInfoCache', '_aiRecsCache', '_aiAddSimilarCache', '_aiSimilarAdded',
            '_aiAlbumTracksCache', '_aiVideoInfoCache', '_aiVideoInfoSelectedCache',
            '_aiSimilarArtistsCache', '_aiSearchResultCache', '_aiPromptCache',
            '_tvEpCountCache', '_tvEpisodesCache', '_tvEpDetailCache', '_tvActorCache', '_tvmazeCache',
            // '_entityRegistryCache', '_deviceRegistryCache', '_areaRegistryCache', // handled explicitly below as null
            '_maLibMemCache', '_drillInCache', '_maImageCache', '_maRootCache', '_maTabRenderCache',
            '_lyricsCache', '_moodArtistUriCache', '_moodLibraryCache', '_queueDataCache', '_appIconCache',
            '_aiWtwCache', '_aiCwCache', '_aiMoodCache', '_aiTriviaCache', '_aiMusicTriviaCache',
            '_aiMeaningCache', '_aiDayMusicCache', '_aiBioTriviaCache', '_castBioCache',
          ];
          document.querySelectorAll('*').forEach(el => {
            if (el.tagName?.toLowerCase() !== 'crow-media-player-card') return;
            if (el._wikiBlobCache) { for (const url of el._wikiBlobCache.values()) { try { URL.revokeObjectURL(url); } catch(_) {} } }
            _cacheKeys.forEach(k => { if (el[k]) el[k] = el[k] instanceof Map ? new Map() : {}; });
            el._aiAvailable = undefined;
            el._maConfigEntryId = null;
            // Registry caches must be null (not empty Map) so the getter re-fetches
            el._entityRegistryCache = null;
            el._deviceRegistryCache = null;
            el._areaRegistryCache   = null;
            el._maConfigEntryId     = null;
          });

          // Explicitly clear registry sessionStorage keys (belt-and-braces)
          ['crow_media_entity_registry','crow_media_device_registry','crow_media_area_registry','crow_media_ma_config_entry_id'].forEach(k => {
            try { sessionStorage.removeItem(k); } catch(_) {}
          });
          // Refresh the registry status display
          const _regStatus = root.getElementById('registry-cache-status');
          if (_regStatus) _regStatus.textContent = 'Not yet cached';
          _cards().forEach(el => { el._coverMem = new Map(); el._chartStoreMem = null; el._pcEpisodeCache = new Map(); el._abChapterCache = new Map(); });
          _furtherUpd.forEach(f => f());

          clearAllBtn.innerHTML = `<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:4px;"></ha-icon>Cleared ${n} cache entries`;
          clearAllBtn.style.cssText += ';color:#30d158;border-color:rgba(48,209,88,0.3);background:rgba(48,209,88,0.1);';
          setTimeout(() => {
            clearAllBtn.innerHTML = '<ha-icon icon="mdi:delete-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Clear All Caches';
            clearAllBtn.style.color = '';
            clearAllBtn.style.borderColor = '';
            clearAllBtn.style.background = '';
          }, 2500);
        } catch(_) {}
      });
    }

    // ── Clear Persistent Storage ──────────────────────────────────────────────
    const clearHaStorageBtn = root.getElementById('clear-ha-storage-btn');
    if (clearHaStorageBtn) {
      clearHaStorageBtn.addEventListener('click', async () => {
        const conn = this._hass?.connection;
        if (!conn) { this._showToast('Not connected to Home Assistant'); return; }
        try {
          clearHaStorageBtn.textContent = 'Clearing…';
          clearHaStorageBtn.disabled = true;
          const keys = ['crow_media_pins', 'crow_media_ai_local', 'crow_media_itunes_preferred', 'crow_media_wiki_urls', 'crow_media_lyrics'];
          await Promise.all(keys.map(k =>
            crowMediaUserData(conn, { type: 'frontend/set_user_data', key: k, value: null }).catch(() => {})
          ).concat(crowMediaAiClear(conn).catch(() => {})));
          // Reset in-memory caches so cleared data isn't served from memory
          this._starredMemCache   = {};
          this._wikiThumbUrlCache = new Map();
          this._lyricsCache       = new Map();
          this._haStorageLoaded   = false; // allow reload on next hass set
          clearHaStorageBtn.innerHTML = '<ha-icon icon="mdi:check" style="--mdc-icon-size:14px;width:14px;height:14px;display:inline-flex;vertical-align:-2px;margin-right:4px;"></ha-icon>Cleared';
          clearHaStorageBtn.style.cssText += ';color:#30d158;border-color:rgba(48,209,88,0.3);background:rgba(48,209,88,0.1);';
          setTimeout(() => {
            clearHaStorageBtn.innerHTML = '<ha-icon icon="mdi:delete-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Clear Persistent Storage';
            clearHaStorageBtn.disabled = false;
            clearHaStorageBtn.style.color = '';
            clearHaStorageBtn.style.borderColor = '';
            clearHaStorageBtn.style.background = '';
          }, 2500);
        } catch(_) {
          clearHaStorageBtn.innerHTML = '<ha-icon icon="mdi:alert-outline" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;vertical-align:-3px;margin-right:4px;"></ha-icon>Failed — try again';
          clearHaStorageBtn.disabled = false;
        }
      });
    }

    const ttsSvcEl = root.getElementById('announce_tts_service');
    if (ttsSvcEl && this._hass?.services?.tts) {
      const ttsDomain = this._hass.services.tts;
      const opts = ['<option value="">Auto-detect</option>'];
      if (ttsDomain.speak) opts.push('<option value="tts|speak">tts.speak (recommended)</option>');
      Object.keys(ttsDomain).filter(s => s !== 'speak' && s !== 'clear_cache' && s !== 'reload')
        .forEach(svc => opts.push('<option value="tts|' + svc + '">tts.' + svc + '</option>'));
      ttsSvcEl.innerHTML = opts.join('');
      ttsSvcEl.value = this._config?.announce_tts_service || '';
      ttsSvcEl.onchange = (e) => this._updateConfig('announce_tts_service', e.target.value);
    }
    ['compact','maximised','remote'].forEach(v => {
      const el = root.getElementById('sm_' + v);
      if (el) el.onchange = () => this._updateConfig('startup_mode', v);
    });

    ['top', 'bottom'].forEach(v => {
      const el = root.getElementById('rbp_' + v);
      if (el) el.onchange = () => this._updateConfig('remote_buttons_position', v);
    });
    const rememberViewEl = root.getElementById('remember_view');
    if (rememberViewEl) rememberViewEl.onchange = (e) => {
      this._updateConfig('remember_view', e.target.checked);
      const seg = root.getElementById('startup-mode-segmented');
      if (seg) seg.style.opacity = e.target.checked ? '0.4' : '1';
    };
    const startupVolInput = root.getElementById('startup_volume');
    if (startupVolInput) {
      startupVolInput.oninput = (e) => {
        const val = e.target.value.trim();
        if (val === '') {
          this._updateConfig('startup_volume', null);
        } else {
          const n = Math.min(100, Math.max(0, parseInt(val) || 0));
          e.target.value = n;
          this._updateConfig('startup_volume', n);
        }
      };
    }

    // ── AI Agent Selects ──────────────────────────────────────────────────────
    const _populateAgentSelect = (selectEl, currentVal, noneLabel) => {
      if (!selectEl) return;
      this._hass?.connection.sendMessagePromise({ type: 'conversation/agent/list' }).then(resp => {
        const agents = resp?.agents || [];
        const opts = [`<option value="">${noneLabel}</option>`];
        agents.forEach(a => {
          // Exclude the built-in HA agent (shown as the default option) and
          // non-AI agents like Google Assistant SDK that can't answer AI queries
          const _idLower   = (a.id   || '').toLowerCase();
          const _nameLower = (a.name || '').toLowerCase();
          const _isDefault = a.id === 'conversation.home_assistant';
          const _isSdk     = _idLower.includes('assistant_sdk') || _idLower.includes('google_assistant')
                          || _nameLower.includes('sdk') || _nameLower.includes('assistant sdk');
          if (!_isDefault && !_isSdk) {
            opts.push(`<option value="${a.id}"${currentVal === a.id ? ' selected' : ''}>${a.name || a.id}</option>`);
          }
        });
        selectEl.innerHTML = opts.join('');
        // If no agent is configured, auto-select the first Google AI Conversation agent
        if (!currentVal) {
          const googleAgent = agents.find(a =>
            !a.id.includes('home_assistant') && !a.id.includes('assistant_sdk') &&
            ((a.name || '').toLowerCase().includes('google') || (a.id || '').toLowerCase().includes('google'))
          );
          if (googleAgent) {
            selectEl.value = googleAgent.id;
            this._updateConfig('ai_conversation_agent', googleAgent.id);
            this._updateAgentWarn?.();
          } else {
            selectEl.value = currentVal || '';
          }
        } else {
          selectEl.value = currentVal;
        }
      }).catch(() => {});
      selectEl.value = currentVal || '';
      selectEl.onchange = (e) => {
        this._updateConfig(selectEl.id, e.target.value);
        if (selectEl.id === 'ai_conversation_agent') this._updateAgentWarn?.();
      };
    };
    _populateAgentSelect(root.getElementById('ai_conversation_agent'), this._config?.ai_conversation_agent || '', 'Default (Home Assistant)');
    const infoPanelPriorityEl = root.getElementById('info_panel_priority');
    if (infoPanelPriorityEl) {
      infoPanelPriorityEl.value = this._config?.info_panel_priority || 'ai';
      infoPanelPriorityEl.onchange = (e) => this._updateConfig('info_panel_priority', e.target.value);
    }
    const librarySearchModeEl = root.getElementById('library_search_mode');
    if (librarySearchModeEl) {
      librarySearchModeEl.value = this._config?.library_search_mode || 'normal';
      librarySearchModeEl.onchange = (e) => this._updateConfig('library_search_mode', e.target.value);
    }
    const tmdbApiKeyEl = root.getElementById('tmdb_api_key');
    if (tmdbApiKeyEl) {
      tmdbApiKeyEl.value = this._config?.tmdb_api_key || '';
      tmdbApiKeyEl.onchange = (e) => this._updateConfig('tmdb_api_key', e.target.value.trim());
    }
    // Movie & TV Matching
    {
      const vm = root.getElementById('video_match');
      if (vm) {
        vm.value = ['exact', 'jellyfin'].includes(this._config?.video_match) ? 'exact' : 'standard';
        vm.onchange = (e) => { this._updateConfig('video_match', e.target.value); this._infoPanelsRefresh?.(); };
      }
    }
    const videoInfoPriorityEl = root.getElementById('video_info_priority');
    if (videoInfoPriorityEl) {
      videoInfoPriorityEl.value = this._config?.video_info_priority || 'ai';
      videoInfoPriorityEl.onchange = (e) => this._updateConfig('video_info_priority', e.target.value);
    }
    // ── Info Panels: a plain summary of where each panel's info comes from, the TMDB key's status, and
    // only the settings that apply (Movie & TV Matching needs the key; AI choices note when AI is off)
    this._infoPanelsRefresh = () => {
      const g = id => root.getElementById(id);
      const aiOn = !!g('ai_features_enabled')?.checked && g('ai_feature_info')?.checked !== false;
      const key = !!String(g('tmdb_api_key')?.value || '').trim();
      const sp = g('info_panel_priority')?.value || 'ai', vp = g('video_info_priority')?.value || 'ai';
      const songAi = sp === 'ai';
      const vidAi = vp === 'ai' || (vp === 'tmdb_ai' && !key);
      const kn = g('vprioKeyNote'); if (kn) kn.style.display = !key && (vp === 'tmdb' || vp === 'tmdb_ai') ? 'block' : 'none';
      const exact = key && g('video_match')?.value === 'exact';
      const st = g('tmdbKeyStatus'); if (st) st.style.display = key ? 'block' : 'none';
      const mr = g('videoMatchRow'); if (mr) mr.style.display = key ? '' : 'none';
      root.querySelectorAll('.ai-off-note').forEach(n => { n.style.display = aiOn ? 'none' : 'block'; });
      const songs = aiOn ? (songAi ? 'AI, then Discogs' : sp === 'discogs_ai' ? 'Discogs, with AI extras (then AI if Discogs has nothing)' : 'Discogs, then AI') : 'Discogs, then your library';
      let vid;
      if (aiOn && vidAi) vid = (exact ? 'AI, for the exact title found on TMDB' : 'AI') + (key ? ', then TMDB, TVmaze and Wikipedia' : ', then TVmaze and Wikipedia');
      else if (key && aiOn && vp === 'tmdb_ai') vid = (exact ? 'TMDB, exact title' : 'TMDB') + ', with AI extras (then AI if TMDB has nothing)';
      else if (key) vid = (exact ? 'TMDB, exact title' : 'TMDB') + (aiOn ? ', then AI' : '') + ', TVmaze and Wikipedia';
      else vid = aiOn ? 'AI, then TVmaze and Wikipedia' : 'TVmaze and Wikipedia (add a TMDB key for full details)';
      const sum = g('infoSummary');
      if (sum) sum.innerHTML = '<b>Songs:</b> ' + songs + '.<br><b>Movies &amp; TV:</b> ' + vid + '.';
    };
    ['ai_features_enabled', 'ai_feature_info', 'info_panel_priority', 'video_info_priority', 'tmdb_api_key'].forEach(id => {
      const el = root.getElementById(id);
      if (el) { el.addEventListener('change', () => setTimeout(() => this._infoPanelsRefresh(), 0)); if (id === 'tmdb_api_key') el.addEventListener('input', () => this._infoPanelsRefresh()); }
    });
    this._infoPanelsRefresh();
    // ── Health & Support: Run Health Check, Test AI, Report a Problem ─────────────
    {
      const g = id => root.getElementById(id);
      const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const COL = { ok: '#30d158', slow: '#ff9f0a', warn: '#ff9f0a', changed: '#ff453a', fail: '#ff453a', off: '#8e8e93', skip: '#8e8e93' };
      const cfgNow = () => this._config || {};
      const aiState = () => {
        const b = g('healthAiBtn'), on = !!g('ai_features_enabled')?.checked;
        if (b) { b.disabled = !on; b.style.opacity = on ? '' : '0.4'; b.title = on ? 'Ask your AI agent a tiny question (uses a little quota)' : 'Turn on AI Features in the AI section first'; }
      };
      aiState();
      g('ai_features_enabled')?.addEventListener('change', () => setTimeout(aiState, 0));
      const renderRows = (rows, running) => {
        const out = g('healthOut'); if (!out) return;
        out.style.display = 'block';
        const order = crowMediaHealth.list().map(c => c.id);
        rows = rows.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        const groups = [...new Set(crowMediaHealth.list().map(c => c.group))];
        const sum = rows.length ? crowMediaHealth.summary(rows) : '';
        out.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px;">${running ? '<span style="width:12px;height:12px;border:2px solid rgba(10,132,255,0.3);border-top-color:#0a84ff;border-radius:50%;display:inline-block;animation:ed-spin 0.8s linear infinite;"></span>' : ''}<span>${running ? 'Checking\u2026 ' : ''}${esc(sum)}</span></div>`
          + groups.map(gr => {
            const rs = rows.filter(r => r.group === gr);
            if (!rs.length) return '';
            return `<div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin:10px 0 2px;">${esc(gr)}</div>`
              + rs.map(r => `<div style="display:flex;gap:9px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.15));"><span style="width:8px;height:8px;border-radius:50%;background:${COL[r.status] || '#8e8e93'};flex-shrink:0;margin-top:5px;"></span><div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:500;">${esc(r.name)}</div><div style="font-size:11px;color:${['fail', 'changed'].includes(r.status) ? '#ff6961' : '#888'};line-height:1.35;">${esc(r.note)}</div></div></div>`).join('');
          }).join('');
      };
      const runHealth = async (force = true) => {
        const btn = g('healthRunBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }
        const rows = [];
        renderRows(rows, true);
        const res = await crowMediaHealth.run({ hass: this._hass, cfg: cfgNow() }, r => { rows.push(r); renderRows(rows, true); }, { force });
        renderRows(res.rows, false);
        if (btn) { btn.disabled = false; btn.textContent = 'Run Health Check'; }
        return res;
      };
      g('healthRunBtn')?.addEventListener('click', () => runHealth(true));
      g('healthAiBtn')?.addEventListener('click', async () => {
        const out = g('healthAiOut'), btn = g('healthAiBtn');
        if (!out || btn?.disabled) return;
        out.style.display = 'block';
        out.innerHTML = '<span style="color:#888;">Asking your AI agent\u2026</span>';
        btn.disabled = true;
        const r = await crowMediaHealth.testAI(this._hass, cfgNow());
        this._lastAiTest = r;
        out.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COL[r.status] || '#8e8e93'};margin-right:7px;"></span><b>Test AI:</b> ${esc(r.note)}`;
        btn.disabled = false;
      });
      // Report a Problem
      const reportText = () => crowMediaHealth.report(this._hass, cfgNow(), window.__crowMediaHealthMemo || null, this._lastAiTest || null);
      const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
        try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
      };
      const status = (t) => { const el = g('reportStatus'); if (el) { el.style.display = t ? 'block' : 'none'; el.textContent = t || ''; } };
      g('reportBtn')?.addEventListener('click', () => {
        const p = g('reportPanel'); if (!p) return;
        const show = p.style.display === 'none';
        p.style.display = show ? 'block' : 'none';
        if (show) setTimeout(() => { try { p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) { p.scrollIntoView(); } }, 0);
        // the Health Check runs in the background while the guidance is read, so its results go with the report
        if (show && (!window.__crowMediaHealthMemo || Date.now() - window.__crowMediaHealthMemo.at > 600000) && !this._healthRunning) {
          this._healthRunning = true;
          status('Running the Health Check so its results go with your report\u2026');
          runHealth(false).finally(() => { this._healthRunning = false; status('Health Check done - its results will be included.'); });
        }
      });
      g('reportOpenBtn')?.addEventListener('click', () => {
        // opened straight from the tap (so it isn't blocked as a pop-up), with whatever results there are so far
        const details = reportText();
        const { url, cut } = crowMediaHealth.issueUrl(details);
        window.open(url, '_blank', 'noopener');
        if (cut) copy(crowMediaHealth.issueBody(details));
        status(cut ? 'The full report was too long for the link, so it\u2019s been copied - paste it into the issue.' : 'Opened GitHub. Fill in the top part and press Submit.');
      });
      g('reportCopyBtn')?.addEventListener('click', async () => {
        const ok = await copy(crowMediaHealth.issueBody(reportText()));
        status(ok ? 'Report copied. Paste it into a new issue at ' + CROW_MEDIA_ISSUES_URL.replace('https://', '') : 'Couldn\u2019t copy on this device.');
      });
    }
    const _shareServiceEl = root.getElementById('share_service');
    if (_shareServiceEl) {
      _shareServiceEl.value = this._config?.share_service || 'youtube_music';
      _shareServiceEl.onchange = (e) => this._updateConfig('share_service', e.target.value);
    }
  }

  _buildMoodEditorRows(container) {
    const defaults  = _getCrowMoodDefaults();
    const overrides = this._config?.mood_overrides || {};

    _CROW_MOOD_CATEGORIES.forEach((cat, catIdx) => {
      // Category header
      const catWrap = document.createElement('div');
      catWrap.style.cssText = 'margin-bottom:4px;border:1px solid rgba(128,128,128,0.15);border-radius:10px;overflow:hidden;';

      const catHeader = document.createElement('div');
      catHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;background:rgba(128,128,128,0.06);-webkit-tap-highlight-color:transparent;';
      catHeader.innerHTML = `<span style="font-size:13px;font-weight:600;color:var(--primary-text-color,#111);">${cat.label}</span><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:var(--secondary-text-color,rgba(0,0,0,0.4));transition:transform 0.2s;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>`;

      const catBody = document.createElement('div');
      catBody.style.cssText = 'display:none;flex-direction:column;padding:4px 0;';

      catHeader.addEventListener('click', () => {
        const open = catBody.style.display !== 'none';
        catBody.style.display = open ? 'none' : 'flex';
        catHeader.querySelector('svg').style.transform = open ? '' : 'rotate(90deg)';
      });

      cat.indices.forEach((idx, rowIdx) => {
        const m = defaults[idx];
        if (!m) return;
        const isDecade = !!m.query; // decade moods have a query field
        const defVal = Array.isArray(m.maSearch) ? m.maSearch.join(', ') : (m.maSearch || '');
        const overVal = overrides[m.label] !== undefined ? overrides[m.label] : defVal;
        const isOverridden = overrides[m.label] !== undefined;

        // Decade query overrides
        const queryOverrides = this._config?.mood_query_overrides || {};
        const defQuery = m.query || '';
        const overQuery = queryOverrides[m.label] !== undefined ? queryOverrides[m.label] : defQuery;
        const isQueryOverridden = queryOverrides[m.label] !== undefined;

        const row = document.createElement('div');
        row.style.cssText = `padding:8px 12px;${rowIdx < cat.indices.length - 1 ? 'border-bottom:1px solid rgba(128,128,128,0.1);' : ''}`;

        if (isDecade) {
          // ── Decade row: playlist query (primary) + radio fallback (secondary) ──
          const header = document.createElement('div');
          header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

          const emoji = document.createElement('span');
          emoji.style.cssText = 'font-size:16px;flex-shrink:0;width:22px;text-align:center;';
          emoji.textContent = m.emoji;

          const labelEl = document.createElement('span');
          labelEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--primary-text-color,#111);flex-shrink:0;min-width:40px;';
          labelEl.textContent = m.label;

          header.appendChild(emoji);
          header.appendChild(labelEl);
          row.appendChild(header);

          // Playlist search terms (primary)
          const queryLabel = document.createElement('div');
          queryLabel.style.cssText = 'font-size:10px;color:#888;margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:0.4px;';
          queryLabel.textContent = 'Playlist search terms (pipe-separated)';
          row.appendChild(queryLabel);

          const queryRow = document.createElement('div');
          queryRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

          const queryInp = document.createElement('input');
          queryInp.type = 'text';
          queryInp.value = overQuery;
          queryInp.placeholder = defQuery;
          queryInp.style.cssText = `flex:1;font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid rgba(128,128,128,0.25);background:var(--card-background-color,#fff);color:var(--primary-text-color,#111);font-family:inherit;min-width:0;${isQueryOverridden ? 'border-color:rgba(99,179,237,0.5);' : ''}`;

          queryInp.addEventListener('change', () => {
            const cur = { ...(this._config?.mood_query_overrides || {}) };
            const trimmed = queryInp.value.trim();
            if (trimmed === defQuery || trimmed === '') {
              delete cur[m.label];
              queryInp.style.borderColor = '';
            } else {
              cur[m.label] = trimmed;
              queryInp.style.borderColor = 'rgba(99,179,237,0.5)';
            }
            this._updateConfig('mood_query_overrides', cur);
          });

          const queryResetBtn = document.createElement('button');
          queryResetBtn.title = 'Reset playlist search to default';
          queryResetBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0.5;padding:0;font-size:13px;color:var(--primary-text-color,#111);-webkit-tap-highlight-color:transparent;';
          queryResetBtn.innerHTML = '<ha-icon icon="mdi:restore" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;"></ha-icon>';
          queryResetBtn.addEventListener('click', () => {
            queryInp.value = defQuery;
            queryInp.style.borderColor = '';
            const cur = { ...(this._config?.mood_query_overrides || {}) };
            delete cur[m.label];
            this._updateConfig('mood_query_overrides', cur);
          });

          queryRow.appendChild(queryInp);
          queryRow.appendChild(queryResetBtn);
          row.appendChild(queryRow);

          // Radio fallback (secondary, smaller)
          const fallbackLabel = document.createElement('div');
          fallbackLabel.style.cssText = 'font-size:10px;color:#888;margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:0.4px;';
          fallbackLabel.textContent = 'Radio fallback artist (if no playlist found)';
          row.appendChild(fallbackLabel);

          const fallbackRow = document.createElement('div');
          fallbackRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

          const inp = document.createElement('input');
          inp.type = 'text';
          inp.dataset.moodLabel = m.label;
          inp.value = overVal;
          inp.placeholder = defVal;
          inp.style.cssText = `flex:1;font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid rgba(128,128,128,0.2);background:var(--card-background-color,#fff);color:var(--secondary-text-color,#888);font-family:inherit;min-width:0;${isOverridden ? 'border-color:rgba(99,179,237,0.4);' : ''}`;

          inp.addEventListener('change', () => {
            const cur = { ...(this._config?.mood_overrides || {}) };
            const trimmed = inp.value.trim();
            if (trimmed === defVal || trimmed === '') {
              delete cur[m.label];
              inp.style.borderColor = '';
            } else {
              cur[m.label] = trimmed;
              inp.style.borderColor = 'rgba(99,179,237,0.4)';
            }
            this._updateConfig('mood_overrides', cur);
          });

          const resetBtn = document.createElement('button');
          resetBtn.title = 'Reset fallback to default';
          resetBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0.4;padding:0;font-size:13px;color:var(--primary-text-color,#111);-webkit-tap-highlight-color:transparent;';
          resetBtn.innerHTML = '<ha-icon icon="mdi:restore" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;"></ha-icon>';
          resetBtn.addEventListener('click', () => {
            inp.value = defVal;
            inp.style.borderColor = '';
            const cur = { ...(this._config?.mood_overrides || {}) };
            delete cur[m.label];
            this._updateConfig('mood_overrides', cur);
          });

          fallbackRow.appendChild(inp);
          fallbackRow.appendChild(resetBtn);
          row.appendChild(fallbackRow);

        } else {
          // ── Standard row: emoji + label + artist seeds ────────────────────
          row.style.cssText += 'display:flex;align-items:center;gap:8px;';

          const emoji = document.createElement('span');
          emoji.style.cssText = 'font-size:16px;flex-shrink:0;width:22px;text-align:center;';
          emoji.textContent = m.emoji;

          const labelEl = document.createElement('span');
          labelEl.style.cssText = 'font-size:12px;font-weight:500;color:var(--primary-text-color,#111);flex-shrink:0;min-width:90px;';
          labelEl.textContent = m.label;

          const inp = document.createElement('input');
          inp.type = 'text';
          inp.dataset.moodLabel = m.label;
          inp.value = overVal;
          inp.style.cssText = `flex:1;font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(128,128,128,0.25);background:var(--card-background-color,#fff);color:var(--primary-text-color,#111);font-family:inherit;min-width:0;${isOverridden ? 'border-color:rgba(99,179,237,0.5);' : ''}`;
          inp.placeholder = defVal;

          inp.addEventListener('change', () => {
            const cur = { ...(this._config?.mood_overrides || {}) };
            const trimmed = inp.value.trim();
            if (trimmed === defVal || trimmed === '') {
              delete cur[m.label];
              inp.style.borderColor = '';
            } else {
              cur[m.label] = trimmed;
              inp.style.borderColor = 'rgba(99,179,237,0.5)';
            }
            this._updateConfig('mood_overrides', cur);
          });

          const resetBtn = document.createElement('button');
          resetBtn.title = 'Reset to default';
          resetBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0.5;padding:0;font-size:13px;color:var(--primary-text-color,#111);-webkit-tap-highlight-color:transparent;';
          resetBtn.innerHTML = '<ha-icon icon="mdi:restore" style="--mdc-icon-size:15px;width:15px;height:15px;display:inline-flex;"></ha-icon>';
          resetBtn.addEventListener('click', () => {
            inp.value = defVal;
            inp.style.borderColor = '';
            const cur = { ...(this._config?.mood_overrides || {}) };
            delete cur[m.label];
            this._updateConfig('mood_overrides', cur);
          });

          row.appendChild(emoji);
          row.appendChild(labelEl);
          row.appendChild(inp);
          row.appendChild(resetBtn);
        }

        catBody.appendChild(row);
      });

      catWrap.appendChild(catHeader);
      catWrap.appendChild(catBody);
      container.appendChild(catWrap);
    });
  }

  // Turning on a Keep in Home Assistant switch saves what's on this device to Home Assistant straight away
  // (the card's own copies of these run only once the new setting reaches the card)
  _haUserDataPut(key, value) {
    try { crowMediaUserData(this._hass?.connection, { type: 'frontend/set_user_data', key, value }).catch(() => {}); } catch (_) {}
  }
  _haStorageSaveLyrics() { try { this._haUserDataPut('crow_media_lyrics', JSON.parse(localStorage.getItem('crow_media_lyrics_store') || '{}')); } catch (_) {} }
  _haStorageSaveItunes() { try { this._haUserDataPut('crow_media_itunes_preferred', JSON.parse(localStorage.getItem('crow_media_itunes_preferred') || '{}')); } catch (_) {} }
  _haStorageSaveWiki() { try { this._haUserDataPut('crow_media_wiki_urls', JSON.parse(localStorage.getItem('crow_media_wiki_urls') || '{}')); } catch (_) {} }
  _haStorageSavePins() {
    const value = {};
    ['stations','podcasts','audiobooks','track','artist','album','playlist','saved_queues','recaps','movies_tv','charts'].forEach(cat => {
      try { value[cat] = JSON.parse(localStorage.getItem('crow_media_pin_' + cat) || '[]'); } catch (_) { value[cat] = []; }
    });
    this._haUserDataPut('crow_media_pins', value);
  }

  _updateConfig(key, value) {
    // Update live colour preview strip when colour values change
    if (key === 'accent_color' || key === 'volume_accent' || key === 'title_color' || key === 'artist_color') {
      const r = this.shadowRoot;
      if (key === 'accent_color')  { r?.getElementById('preview-accent')?.style.setProperty('background', value || '#007AFF'); }
      if (key === 'volume_accent') { r?.getElementById('preview-volume')?.style.setProperty('background', value || '#007AFF'); }
      if (key === 'title_color')   { r?.getElementById('preview-text')?.style.setProperty('background', value || '#ffffff'); }
      if (key === 'artist_color')  { r?.getElementById('preview-artist')?.style.setProperty('background', value || '#aaaaaa'); }
    }
    // If disabling remote art blur, clear the backgrounds immediately
    if (key === 'remote_art_blur' && !value) {
      const r = this.shadowRoot;
      const b1 = r?.getElementById('remoteBlurBg');
      const b2 = r?.getElementById('clickpadBlurBg');
      if (b1) b1.style.backgroundImage = 'none';
      if (b2) b2.style.backgroundImage = 'none';
    }
    if (!this._config) return;
    // Only spread the original config (without injected defaults) plus the new key.
    // This prevents default values from being permanently written into the user's YAML.
    const DEFAULTS = {
      pdf_enabled: true, pdf_lyrics: true, pdf_cd: true, pdf_disc: true, pdf_marks: true, pdf_info: true, pdf_history: true,
      pdf_month: true, pdf_recent: true, pdf_recap: true, pdf_pins: true, pdf_lists: true,
      discover_icon: 'grid', remote_icon: 'remote_classic',
      feat_lyrics_translate: true, feat_new_releases: true, feat_sleep_timer: true, feat_audio_quality: true, feat_charts: false, feat_podcast_charts: true, charts_apple: true, charts_deezer: true, feat_video_charts: true, feat_tv_guide: true,
      auto_switch: true, show_entity_selector: true, show_vol_pct: true,
      scroll_text: false, use_ha_theme: false, remember_view: false,
      remember_last_entity: false, lyrics_persist: false, lyrics_cache_enabled: true,
      lyrics_persistent_storage: true,
      pins_persistent_storage: true,
      show_pins_in_sections: true,
      ai_info_persistent_storage: true,
      itunes_persistent_storage: true,
      wiki_persistent_storage: true,
      ma_library_cache_enabled: true,
      ma_radio_mode: false, ambient_glow: false, row_glow: false, row_swipes: true, keyboard_shortcuts: true, screensaver: false, screensaver_style: 'wall', screensaver_after: 10, screensaver_clock: true, screensaver_dial: 'luxury', music_visual: 'artwork', music_visual_style: 'eq', qm_visualiser: true, qm_screensaver: true, video_match: 'standard', screensaver_weather: '',
      show_remote_button: true,
      artwork_crossfade: false, show_ma_library_button: true,
      resize_btn_spin: true, pin_hearts: true, remote_art_blur: true, volume_hud: true,
      itunes_art: true, controls_theme: 'classic', add_pill_color: '', appearance: 'auto',
      ai_features_enabled: false, ai_conversation_agent: '',
      info_panel_priority: 'ai',
      library_search_mode: 'normal',
      tmdb_api_key: '',
      video_info_priority: 'ai',
      share_service: 'youtube_music',
      show_media_type_pill: false,
      show_youtube_button: true,
      atv_keyboard_panel: true,
      atv_apps_button: true,
      sendspin_enabled: false, sendspin_url: '',
    };
    // Strip keys that match their default value to keep YAML clean
    const cleanConfig = { ...this._config, [key]: value };
    // settings for features that no longer exist
    delete cleanConfig.song_intro_enabled;
    Object.keys(DEFAULTS).forEach(k => {
      if (k !== key && cleanConfig[k] === DEFAULTS[k]) delete cleanConfig[k];
    });
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cleanConfig }, bubbles: true, composed: true }));
  }

  // Same idea as _updateConfig, but merges several keys into a single
  // dispatch. Needed anywhere two related keys must change together
  // (e.g. _saveOrder's entities + ma_entities prune) — calling _updateConfig
  // twice in a row means the second call spreads from this._config again,
  // which may not yet reflect the first call's result if the parent
  // dashboard hasn't fed it back before the second call runs, silently
  // reverting the first change. One combined dispatch has no such window.
  _updateConfigMulti(updates) {
    if (!this._config || !updates) return;
    const DEFAULTS = {
      pdf_enabled: true, pdf_lyrics: true, pdf_cd: true, pdf_disc: true, pdf_marks: true, pdf_info: true, pdf_history: true,
      pdf_month: true, pdf_recent: true, pdf_recap: true, pdf_pins: true, pdf_lists: true,
      discover_icon: 'grid', remote_icon: 'remote_classic',
      feat_lyrics_translate: true, feat_new_releases: true, feat_sleep_timer: true, feat_audio_quality: true, feat_charts: false, feat_podcast_charts: true, charts_apple: true, charts_deezer: true, feat_video_charts: true, feat_tv_guide: true,
      auto_switch: true, show_entity_selector: true, show_vol_pct: true,
      scroll_text: false, use_ha_theme: false, remember_view: false,
      remember_last_entity: false, lyrics_persist: false, lyrics_cache_enabled: true,
      lyrics_persistent_storage: true,
      pins_persistent_storage: true,
      show_pins_in_sections: true,
      ai_info_persistent_storage: true,
      itunes_persistent_storage: true,
      wiki_persistent_storage: true,
      ma_library_cache_enabled: true,
      ma_radio_mode: false, ambient_glow: false, row_glow: false, row_swipes: true, keyboard_shortcuts: true, screensaver: false, screensaver_style: 'wall', screensaver_after: 10, screensaver_clock: true, screensaver_dial: 'luxury', music_visual: 'artwork', music_visual_style: 'eq', qm_visualiser: true, qm_screensaver: true, video_match: 'standard', screensaver_weather: '',
      show_remote_button: true,
      artwork_crossfade: false, show_ma_library_button: true,
      resize_btn_spin: true, pin_hearts: true, remote_art_blur: true, volume_hud: true,
      itunes_art: true, controls_theme: 'classic', add_pill_color: '', appearance: 'auto',
      ai_features_enabled: false, ai_conversation_agent: '',
      info_panel_priority: 'ai',
      library_search_mode: 'normal',
      tmdb_api_key: '',
      video_info_priority: 'ai',
      share_service: 'youtube_music',
      show_media_type_pill: false,
      show_youtube_button: true,
      atv_keyboard_panel: true,
      atv_apps_button: true,
      sendspin_enabled: false, sendspin_url: '',
    };
    const updatedKeys = Object.keys(updates);
    const cleanConfig = { ...this._config, ...updates };
    Object.keys(DEFAULTS).forEach(k => {
      if (!updatedKeys.includes(k) && cleanConfig[k] === DEFAULTS[k]) delete cleanConfig[k];
    });
    // a key given as undefined is removed (e.g. a setting replaced by a newer one)
    Object.keys(cleanConfig).forEach(k => { if (cleanConfig[k] === undefined) delete cleanConfig[k]; });
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cleanConfig }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('crow-media-player-card-editor')) customElements.define('crow-media-player-card-editor', CrowMediaPlayerCardEditor);

K.ready.editor = true;
})();
