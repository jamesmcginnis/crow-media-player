/*
 * Crow Media Player — AI panels
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.panels) return;
const {  } = K.kit;

Object.assign(K.Card.prototype, {
  // Silently pre-warm the AI track info cache so long-press on artwork is instant
  async _showVideoRecommendations(content, r, popup, state, attrs) {
    const mediaType   = this._detectMediaType(state);
    const isTv        = mediaType === 'tv';
    const showTitle   = attrs.media_series_title || attrs.media_title || '';
    const movieTitle  = attrs.media_title || '';
    const displayTitle = isTv ? showTitle : movieTitle;
    const year        = '';  // not always available from HA

    // Claim ownership of the panel generation counter — see _showAIRecommendations
    // for why this matters: without it, a delayed AI Info call (or any other AI
    // panel) that resolves after this one could silently overwrite these results.
    if (!this._aiPanelGeneration) this._aiPanelGeneration = 0;
    const _myGen = ++this._aiPanelGeneration;
    const _stale = () => this._aiPanelGeneration !== _myGen;

    this._setResultsExport(null);
    const cacheKey = ('videorecs|' + mediaType + '|' + displayTitle).toLowerCase();
    if (!this._aiRecsCache) this._aiRecsCache = new Map();

    // Always fetch fresh on open — see the music recommendations panel for
    // why: re-opening should surface something new, not the same cached list.
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:24px;">
        <div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
        <div style="font-size:12px;color:${this._pt("dim")};">Finding Similar…</div>
      </div>`;

    let recs;
    {
      const hasAI = await this._aiCheckAvailable();
      if (_stale()) return;
      if (!hasAI) { this._aiShowNoAgentBanner(popup); return; }
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const typeLabel = isTv ? 'TV show' : 'movie';
      const prompt = `I'm watching the ${typeLabel} "${displayTitle}". Suggest 18 similar ${typeLabel}s I might enjoy. Respond ONLY with JSON array (no markdown):\n[{"title":"Title","year":"YYYY","type":"tv or movie","genre":"Genre","reason":"10 word max reason"}]`;
      try {
        const resp = await this._aiProcess({ _crowFeature: 'discover',
          type: 'conversation/process', text: prompt,
          agent_id: agentId, language: navigator.language || 'en'
        });
        if (_stale()) return;
        const raw = resp?.response?.speech?.plain?.speech || '';
        if (!raw) throw new Error('no response');
        const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
        recs = JSON.parse(i1 !== -1 && i2 !== -1 ? raw.slice(i1, i2 + 1) : raw.replace(/```json?\s*/gi,'').replace(/```/g,'').trim());
        this._aiRecsCache.set(cacheKey, recs);
        this._aiSessionSet('recs', cacheKey, recs);
        this._aiLocalGet('recs', cacheKey) === null && this._aiLocalSet('recs', cacheKey, recs);
      } catch(e) {
        if (_stale()) return;
        { const _k = e?.kind || (e instanceof SyntaxError ? 'unreadable' : this._aiErrorKind(e?.message)); const [_t, _b] = this._aiFriendlyReason(_k === 'error' && /no response/i.test(e?.message || '') ? 'unreadable' : _k); content.innerHTML = this._psError('Suggestions: ' + _t.charAt(0).toLowerCase() + _t.slice(1), _b); }
        return;
      }
    }

    if (_stale()) return;

    // Filter out currently watching
    const _norm = s => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    recs = recs.filter(rec => _norm(rec.title) !== _norm(displayTitle));
    this._setResultsExport(() => this._exportResultsPDF('Recommendations', 'Similar to ' + displayTitle,
      recs.map(rec => ({ ...rec, type: rec.type || (isTv ? 'tv' : 'movie'), reason: [rec.genre, rec.reason].filter(Boolean).join(' · ') }))));

    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:rgba(99,179,237,0.8);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px;">
        <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:#63b3ed;vertical-align:middle;margin-right:3px"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        Similar to ${displayTitle}
      </div>
      <div id="ai-video-recs-list">
        ${recs.map((rec, i) => `
          <div class="ai-video-rec-row" data-idx="${i}"
            data-title="${(rec.title||'').replace(/"/g,'&quot;')}"
            data-year="${(rec.year||'').replace(/"/g,'&quot;')}"
            data-type="${isTv ? 'tv' : 'movie'}"
            style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${this._pt("bg")};border-radius:12px;margin-bottom:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <div class="ai-video-rec-art" data-rec-idx="${i}" style="width:40px;height:58px;border-radius:6px;background:${this._pt("bg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:${this._pt("dim")}"><path d="${isTv ? 'M21,3H3C1.89,3 1,3.89 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5C23,3.89 22.1,3 21,3M21,17H3V5H21V17Z' : 'M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z'}"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.title||''}</div>
              <div style="font-size:11px;color:${this._pt("dim")};margin-top:1px;">${[rec.year, (rec.type === 'tv' || (!rec.type && isTv)) ? 'TV Series' : 'Movie'].filter(Boolean).join(' · ')}</div>
              ${rec.reason ? `<div style="font-size:10px;color:rgba(99,179,237,0.5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rec.reason}</div>` : ''}
            </div>
            
          </div>`).join('')}
      </div>`;

    // Wire row clicks → video info detail panel
    const self = this;
    content.querySelectorAll('.ai-video-rec-row').forEach(row => {
      this._wireMtRow(row, null, () => this._mtItemFromRow(row, '.ai-video-rec-art'));
      row.addEventListener('click', async () => {
        const idx  = parseInt(row.dataset.idx, 10);
        const rec  = recs[idx];
        const type = row.dataset.type;
        // Get the pre-fetched poster art if available
        const artEl = content.querySelector(`.ai-video-rec-art[data-rec-idx="${idx}"] img`);
        const artUrl = artEl?.src || '';
        // Build a result object matching _renderVideoInfoDetail's expected format
        const result = {
          title:    rec.title || '',
          year:     rec.year  || '',
          type:     type,
          overview: '',
          genres:   rec.genre ? [rec.genre] : [],
        };
        // Show loading then fetch full details via AI + render detail panel
        content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div></div>`;
        // Fetch AI details for the selected title
        try {
          const agentId2 = self._config?.ai_conversation_agent || 'conversation.home_assistant';
          const typeLabel2 = type === 'tv' ? 'TV show' : 'movie';
          const detailPrompt = `Give me details about the ${typeLabel2} "${rec.title}"${rec.year ? ` (${rec.year})` : ''}. Respond ONLY with JSON (no markdown):\n{"title":"${rec.title}","year":"${rec.year||''}","type":"${type}","status":"e.g. Released/Ended","seasons":null,"rating":null,"overview":"2 sentence overview","genres":["Genre"],"director":"Name or null","cast":["Name1","Name2","Name3","Name4","Name5","Name6"],"vibe":"Short vibe","similar":[{"title":"Title","year":"YYYY","type":"${type}"}]}`;
          const detailResp = await self._aiProcess({ _crowFeature: 'discover',
            type: 'conversation/process', text: detailPrompt,
            agent_id: agentId2, language: navigator.language || 'en'
          });
          const detailRaw = detailResp?.response?.speech?.plain?.speech || '';
          // Fresh single-title lookup — clear any leftover picker state so
          // "Not this one?" refers to this title, not a stale candidate list.
          self._videoInfoPickerState = null;
          self._videoInfoRootTitles = null;
          if (detailRaw) {
            const di1 = detailRaw.indexOf('{'), di2 = detailRaw.lastIndexOf('}');
            const detailData = JSON.parse(di1 !== -1 && di2 !== -1 ? detailRaw.slice(di1, di2 + 1) : detailRaw);
            self._renderVideoInfoDetail(content, detailData, artUrl);
            return;
          }
        } catch(_) {}
        // Fallback: render with what we have
        self._renderVideoInfoDetail(content, result, artUrl);
      });
    });

    // Fetch poster art for each rec — wait for DOM paint then stagger with retry
    requestAnimationFrame(() => {
      recs.forEach((rec, i) => {
        const recType = rec.type || (isTv ? 'tv' : 'movie');
        this._fetchVideoArtWithRetry(content, rec.title, rec.year || '', recType, `.ai-video-rec-art[data-rec-idx="${i}"]`, 4, 300 + i * 400);
      });
    });
  },

  async _prefetchVideoRecs(title, mediaType) {
    if (!title || (mediaType !== 'tv' && mediaType !== 'movie')) return;
    const cacheKey = ('videorecs|' + mediaType + '|' + title).toLowerCase();
    if (!this._aiRecsCache) this._aiRecsCache = new Map();
    if (this._aiRecsCache.has(cacheKey)) return;
    const _ls = this._aiLocalGet('recs', cacheKey);
    if (_ls) { this._aiRecsCache.set(cacheKey, _ls); return; }
    const _ss = this._aiSessionGet('recs', cacheKey);
    if (_ss) { this._aiRecsCache.set(cacheKey, _ss); return; }
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return;
    try {
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const typeLabel = mediaType === 'tv' ? 'TV show' : 'movie';
      const prompt = `I'm watching the ${typeLabel} "${title}". Suggest 18 similar ${typeLabel}s I might enjoy. Respond ONLY with JSON array (no markdown):\n[{"title":"Title","year":"YYYY","genre":"Genre","reason":"10 word max reason"}]`;
      const resp = await this._aiProcess({ _crowFeature: 'prefetch',
        type: 'conversation/process', _crowSilent: true, text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      if (!raw) return;
      const i1 = raw.indexOf('['), i2 = raw.lastIndexOf(']');
      const recs = JSON.parse(i1 !== -1 && i2 !== -1 ? raw.slice(i1, i2 + 1) : raw.replace(/```json?\s*/gi,'').replace(/```/g,'').trim());
      if (!Array.isArray(recs) || !recs.length) return;
      this._aiRecsCache.set(cacheKey, recs);
      this._aiSessionSet('recs', cacheKey, recs);
      this._aiLocalSet('recs', cacheKey, recs);
    } catch(_) {}
  },

  async _prefetchAIRecs(trackTitle, artistName, albumName) {
    if (!trackTitle || !artistName) return;
    const cacheKey = ('recs|' + artistName + '|' + trackTitle).toLowerCase();
    if (!this._aiRecsCache) this._aiRecsCache = new Map();
    // Check all cache layers — if any hit, no need to fetch
    if (this._aiRecsCache.has(cacheKey)) return;
    const _ls = this._aiLocalGet('recs', cacheKey);
    if (_ls) { this._aiRecsCache.set(cacheKey, _ls); return; }
    const _ss = this._aiSessionGet('recs', cacheKey);
    if (_ss) { this._aiRecsCache.set(cacheKey, _ss); return; }
    // Not cached — fetch silently in background
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return;
    try {
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const parts = [trackTitle && `"${trackTitle}"`, artistName && `by ${artistName}`, albumName && `(album: ${albumName})`].filter(Boolean).join(' ');
      const prompt = `I'm listening to ${parts}. Suggest 18 similar tracks I might enjoy. Respond ONLY with JSON array (no markdown):\n[{"title":"Track Name","artist":"Artist Name","reason":"10 word max reason"}]`;
      const resp = await this._aiProcess({ _crowFeature: 'prefetch',
        type: 'conversation/process', _crowSilent: true, text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      if (!raw) return;
      const recs = JSON.parse(raw.replace(/```json?\s*/gi,'').replace(/```/g,'').trim());
      if (!Array.isArray(recs) || !recs.length) return;
      this._aiRecsCache.set(cacheKey, recs);
      this._aiSessionSet('recs', cacheKey, recs);
      this._aiLocalSet('recs', cacheKey, recs);
    } catch(_) { /* silent prefetch failure */ }
  },

  // ── AI track info lookup ────────────────────────────────────────────────
  // The one place that asks the AI about a track: used by the info panel,
  // by the prefetch, and by the quiet background retry after a miss, so all
  // three share the same prompt and cache. Returns the data (possibly
  // marked _notFound / _incomplete) or throws if the AI couldn't answer.
  async _fetchAITrackInfoData(trackTitle, artistName, { fallback = false, feature = 'info' } = {}) {
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
    const cacheKey = ('trackinfo3|' + artistName + '|' + trackTitle).toLowerCase();
    if (!this._aiTrackInfoCache) this._aiTrackInfoCache = new Map();
    // If artist contains multiple artists (e.g. "Aerosmith & YUNGBLUD"), try the
    // primary artist first — concatenated names often cause hallucinated results.
    const primaryArtist = artistName.split(/\s*[&,]\s*/)[0].trim() || artistName;
    const queryArtist = primaryArtist !== artistName ? primaryArtist : artistName;
    const prompt = `You are a music encyclopedia. For the track "${trackTitle}" by "${queryArtist}", provide a JSON object (no markdown, raw JSON only):\n{\n  \"year\": \"release year\",\n  \"chart\": \"highest chart position e.g. UK #1 or US #4 Billboard Hot 100, or null if truly unknown\",\n  \"reception\": \"one short phrase e.g. 4x Platinum or Critically acclaimed or GRAMMY winner, null only if no notable reception\",\n  \"album\": \"album name\",\n  \"label\": \"record label\",\n  \"genre\": [\"genre1\",\"genre2\"],\n  \"duration\": \"duration e.g. 3:42\",\n  \"vibe\": \"3-word vibe e.g. Euphoric indie anthem\",\n  \"members\": [\"Member Name 1\",\"Member Name 2\"],\n  \"similar\": [{\"title\":\"Track\",\"artist\":\"Artist\"},{\"title\":\"Track\",\"artist\":\"Artist\"}],\n  \"found\": true\n}\\nFor similar: list exactly 10 similar tracks in that array, varied across artists, not just 2-3. For members: list the band members (2-6 names). If the artist is a solo performer, set members to [\"${queryArtist}\"] (just their own name as a single-element array). IMPORTANT: If you cannot find reliable information about this specific track, set \"found\" to false and all other fields to null. Do NOT invent or hallucinate details. Respond with ONLY the JSON.`;
    const resp = await this._aiProcess({
      type: 'conversation/process', text: prompt, _crowSilent: true, _crowFallback: fallback, _crowFeature: feature,
      agent_id: agentId, language: navigator.language || 'en'
    });
    const raw = resp?.response?.speech?.plain?.speech || '';
    // Robust extraction — find first { to last }
    const s = raw.indexOf('{'), e2 = raw.lastIndexOf('}');
    if (s === -1 || e2 <= s) { const e = new Error('No JSON'); e.kind = 'unreadable'; throw e; }
    let data = JSON.parse(raw.slice(s, e2 + 1));
    // Detect hallucination signals — the AI saying it couldn't find the track
    // the AI says it doesn't know this track (it's asked to set "found" to false rather than invent details)
    const _hallucinated = data.found === false;
    if (_hallucinated) {
      data = { album: null, year: null, label: null, duration: null, vibe: null, similar: [], _notFound: true };
      // Short 7-day memory so genuinely unknown tracks don't use quota every session
      this._aiLocalSet('trackInfo', cacheKey, { ...data, _notFoundTTL: 7 });
    } else {
      // Thin answers are marked incomplete so a later open retries the AI
      const _thin = (!data.members || data.members.length === 0)
        && (!data.similar || data.similar.length === 0);
      if (_thin) data._incomplete = true;
      this._aiTrackInfoCache.set(cacheKey, data);
      if (!data._incomplete) this._aiLocalSet('trackInfo', cacheKey, data);
    }
    // A proper answer clears any "AI missed this track" note
    this._aiTrackMissDelete(cacheKey);
    return data;
  },

  // Tracks the AI failed on this session (sessionStorage, so a refresh keeps
  // it; a new session gives the AI a fresh chance).
  _aiTrackMissList() {
    try { return JSON.parse(sessionStorage.getItem('crow_media_ai_track_miss') || '[]'); } catch (_) { return []; }
  },

  _aiTrackMissHas(key) { return this._aiTrackMissList().includes(key); },

  _aiTrackMissAdd(key) {
    try {
      const l = this._aiTrackMissList().filter(k => k !== key);
      l.push(key);
      sessionStorage.setItem('crow_media_ai_track_miss', JSON.stringify(l.slice(-200)));
    } catch (_) {}
  },

  _aiTrackMissDelete(key) {
    try {
      const l = this._aiTrackMissList();
      if (l.includes(key)) sessionStorage.setItem('crow_media_ai_track_miss', JSON.stringify(l.filter(k => k !== key)));
    } catch (_) {}
  },

  // One quiet retry per track per session, while the Discogs panel is
  // showing. Never changes what's on screen — a good answer is simply cached
  // so the next tap opens the full AI panel.
  _aiTrackMissRetry(trackTitle, artistName) {
    const key = ('trackinfo3|' + artistName + '|' + trackTitle).toLowerCase();
    if (!this._aiTrackMissRetried) this._aiTrackMissRetried = new Set();
    // Not while the AI is paused — that would just use up the one retry
    if (this._aiTrackMissRetried.has(key) || !this._aiFeatureOn('info') || this._aiPauseGet()) return;
    this._aiTrackMissRetried.add(key);
    setTimeout(() => {
      this._fetchAITrackInfoData(trackTitle, artistName).catch(() => {});
    }, 4000);
  },

  async _prefetchAITrackInfo(trackTitle, artistName) {
    if (!trackTitle || !artistName) return;
    const cacheKey = ('trackinfo3|' + artistName + '|' + trackTitle).toLowerCase();
    if (!this._aiTrackInfoCache) this._aiTrackInfoCache = new Map();
    if (!this._aiTrackInfoCache.has(cacheKey)) {
      const _p = this._aiLocalGet('trackInfo', cacheKey) || this._aiSessionGet('trackInfo', cacheKey);
      if (_p && !_p._incomplete) this._aiTrackInfoCache.set(cacheKey, _p);
    }
    if (this._aiTrackInfoCache.has(cacheKey) || this._aiTrackMissHas(cacheKey)) return;
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return;
    try {
      const data = await this._fetchAITrackInfoData(trackTitle, artistName, { feature: 'prefetch' });
      // Only chain-prefetch album if the user has previously tapped the album pill
      if (data && !data._notFound && data.album && this._albumPillTapped?.has((data.album + '|' + artistName).toLowerCase())) {
        setTimeout(() => this._prefetchAIAlbumTracks(data.album, artistName), 1000);
      }
    } catch (_) { /* silent — prefetch failures are non-critical */ }
  },

  async _prefetchAIAlbumTracks(albumName, artistName) {
    if (!albumName || !artistName) return null;
    if (!this._aiAlbumTracksCache) this._aiAlbumTracksCache = new Map();
    const cacheKey = (albumName + '|' + artistName).toLowerCase();
    this._aiCachedRead(this._aiAlbumTracksCache, 'albumTracks', cacheKey);
    if (this._aiAlbumTracksCache.has(cacheKey)) {
      const existing = this._aiAlbumTracksCache.get(cacheKey);
      return existing?.empty ? false : true;
    }
    const hasAI = await this._aiCheckAvailable();
    if (!hasAI) return null;
    try {
      const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';
      const prompt = `You are a music encyclopedia. For the album "${albumName}" by "${artistName}", respond ONLY with a JSON object (no markdown):
{"year":"release year or null","label":"record label or null","genre":["genre1","genre2"],"tracks":[{"position":"1","title":"Track Name"},{"position":"2","title":"Track Name"}]}
Include ALL tracks. Use null for unknown fields.`;
      const resp = await this._aiProcess({ _crowFeature: 'prefetch',
        type: 'conversation/process', _crowSilent: true, text: prompt,
        agent_id: agentId, language: navigator.language || 'en'
      });
      const raw = resp?.response?.speech?.plain?.speech || '';
      const stripped = raw.replace(/```json?\s*/gi,'').replace(/```/g,'');
      const s = stripped.indexOf('{'), e2 = stripped.lastIndexOf('}');
      if (s === -1 || e2 <= s) { this._aiAlbumTracksCache.set(cacheKey, { tracks: [], meta: {}, empty: true }); return false; }
      const parsed = JSON.parse(stripped.slice(s, e2 + 1));
      const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : (Array.isArray(parsed) ? parsed : []);
      const meta = Array.isArray(parsed) ? {} : { year: parsed.year || null, label: parsed.label || null, genre: parsed.genre || [] };
      if (tracks.length) {
        this._aiCachedWrite(this._aiAlbumTracksCache, 'albumTracks', cacheKey, { tracks, meta }, { ttlDays: 30, max: 150 });
        return true;
      }
      this._aiAlbumTracksCache.set(cacheKey, { tracks: [], meta: {}, empty: true });
      return false;
    } catch(e) { /* silent — prefetch failures are non-critical */ return null; }
  },

  _showAppleTVKeyboardPanel(configEntryId) {
    const r = this.shadowRoot;
    if (r.getElementById('atvKeyboardPanel')) return; // already showing
    const cardOuter = r.getElementById('cardOuter');
    if (!cardOuter) return;

    const panel = document.createElement('div');
    panel.id = 'atvKeyboardPanel';
    // Reuse the exact same full-panel look as the Media Info popup (same
    // classes, same size/position within the card) rather than a small
    // centered floating card — this was getting lost in the middle of the
    // screen instead of anchoring at the top like every other panel.
    panel.className = 'info-popup visible';
    panel.style.zIndex = '70';
    panel.innerHTML =
      '<div class="info-popup-header">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
          '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:' + this._pt('dim') + ';flex-shrink:0;"><path d="M19,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.9 20.1,3 19,3M11,5H13V7H11V5M8,5H10V7H8V5M5,5H7V7H5V5M5,8H7V10H5V8M5,11H7V13H5V11M19,19H5V16H19V19M19,13H17V11H19V13M19,10H17V8H19V10M16,13H14V11H16V13M16,10H14V8H16V10M13,10H11V8H13V10M8,10V8H10V10H8M8,13V11H10V13H8Z"/></svg>' +
          '<span class="info-popup-title">Apple TV Keyboard</span>' +
        '</div>' +
        '<div class="info-popup-header-actions">' +
          '<button class="info-popup-close" id="atvKeyboardClose">' +
            '<svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="info-popup-content">' +
        '<div style="font-size:13px;color:' + this._pt('dim') + ';line-height:1.4;margin-bottom:14px;">The on-screen keyboard is active — type here and send it straight to the TV instead of using the remote\u2019s letter-by-letter entry.</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<div style="position:relative;flex:1;min-width:0;">' +
            '<input type="text" id="atvKeyboardInput" placeholder="Type here\u2026" enterkeyhint="send" autocomplete="off" autocorrect="off" spellcheck="false" ' +
              'style="width:100%;box-sizing:border-box;background:' + this._pt('bg') + ';border:1px solid ' + this._pt('border') + ';border-radius:10px;padding:10px 30px 10px 12px;font-size:14px;color:' + this._pt('text') + ';font-family:inherit;-webkit-appearance:none;">' +
            '<div id="atvKeyboardClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;padding:2px;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:' + this._pt('dim') + ';display:block;"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></div>' +
          '</div>' +
          '<button id="atvKeyboardSend" style="padding:0 16px;background:#0A84FF;border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;flex-shrink:0;">Send</button>' +
        '</div>' +
      '</div>';
    cardOuter.appendChild(panel);

    const input = panel.querySelector('#atvKeyboardInput');
    input?.focus();

    const sendText = () => {
      const text = input?.value ?? '';
      if (!configEntryId) { this._showToast('Could not find this Apple TV\u2019s config entry'); return; }
      this._call('apple_tv', 'set_keyboard_text', { config_entry_id: configEntryId, text }).catch(() => {
        this._showToast('Failed to send text to Apple TV');
      });
    };
    panel.querySelector('#atvKeyboardSend')?.addEventListener('click', sendText);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });

    // Inline "x" clear button — mirrors the search-clear pattern used in the
    // Announce/Send Message panels: hidden until there's text, clears the
    // local field, and (since this field mirrors the actual on-screen
    // keyboard on the Apple TV) also tells the TV to clear what's been
    // typed there so far, same as the old standalone "Clear" button did.
    const clearBtn = panel.querySelector('#atvKeyboardClear');
    input?.addEventListener('input', () => {
      if (clearBtn) clearBtn.style.display = input.value ? 'block' : 'none';
    });
    clearBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (input) input.value = '';
      clearBtn.style.display = 'none';
      input?.focus();
      if (configEntryId) this._call('apple_tv', 'clear_keyboard_text', { config_entry_id: configEntryId }).catch(() => {});
    });
    // Manual close only hides this card's panel — the keyboard may still be
    // focused on the Apple TV itself, so this doesn't try to un-focus it.
    // It'll reappear on the next update cycle if the sensor is still "on"
    // and this device is reselected; that's acceptable since the main
    // point of a manual close is "I'll finish typing on the actual remote
    // instead", not "make the TV stop asking for text".
    panel.querySelector('#atvKeyboardClose')?.addEventListener('click', () => {
      panel.remove();
      this._atvKeyboardManuallyDismissed = true;
    });
  },

  _handleArtworkDoubleTapPin(x, y) {
    const state = this._hass?.states[this._entity];
    if (!state) { this._showToast('Nothing to pin right now'); return; }

    if (this._isActuallyRadioStream(state)) {
      // Same station-resolution chain the LIVE pill already uses
      // successfully, so double-tap and the LIVE pill always agree on
      // identity — pinning/unpinning via either one is reflected in both.
      const attrs = state.attributes || {};
      const _lastPlayedSt = this._rbGetLastPlayed(this._entity, this._rbStreamKey(attrs));
      let station = _lastPlayedSt || null;
      if (!station) {
        const _rawId = attrs.media_content_id || '';
        const _streamUrl = _rawId.replace(/^builtin:\/\/radio\//i, '');
        station = _streamUrl ? this._rbCachedStation(_streamUrl) : null;
      }
      if (!station) {
        // Not resolved yet this session — kick off the same background
        // resolver the pinned indicator uses, so a retry shortly after
        // should work even if this particular attempt can't.
        if (state.state === 'playing') this._rbAutoResolveStationArt(this._entity);
        this._showToast('Nothing to pin right now');
        return;
      }
      const nowPinned = this._rbToggleStar(station);
      if (nowPinned) { this._spawnPinHearts(x, y); }
      else { this._spawnPinHearts(x, y, '#8E8E93'); }
      this._updatePinnedIndicator();
      return;
    }

    const mediaType = this._detectMediaType(state);
    const attrs = state.attributes || {};
    const art = attrs.entity_picture_local || attrs.entity_picture || '';

    // YouTube, Twitch, sport, news, an app that isn't saying what's on… aren't films or shows,
    // so they'd only pin as a film that doesn't exist
    const _appKind = this._appInfoKind(attrs);
    if (_appKind && _appKind !== 'music') {
      const _app = String(attrs.app_name || '').trim();
      this._showToast(_appKind === 'app' || !_app ? 'Nothing to pin right now' : 'Things playing in ' + _app + ' can\u2019t be pinned', 2200);
      return;
    }

    if (mediaType === 'tv' || mediaType === 'movie') {
      const title = (attrs.media_title || '').trim();
      if (!title) { this._showToast('Nothing to pin right now'); return; }
      const mtPinItem = {
        id: (mediaType === 'tv' ? 'tv_' : 'movie_') + title.toLowerCase(),
        kind: mediaType === 'tv' ? 'tv' : 'movie',
        title, subtitle: '', artworkUrl100: art,
      };
      const nowPinned = this._mtToggleStar(mtPinItem);
      if (nowPinned) { this._spawnPinHearts(x, y); }
      else { this._spawnPinHearts(x, y, '#8E8E93'); }
      this._updatePinnedIndicator();
      if (this._maCurrentTab === 'movie_tv') this._loadMATab('movie_tv');
      if (this._pinnedDetailActive && this._pinnedDetailCategory === 'movies_tv') this._openPinnedCategoryDetail('movies_tv');
      return;
    }

    const isMusic = state.state === 'playing' && mediaType === 'music'
      && !!(attrs.media_artist || attrs.media_title);
    if (!isMusic) { this._showToast('Nothing to pin right now'); return; }

    const trackTitle = attrs.media_title  || '';
    const artistName = attrs.media_artist || '';
    // Same fallback-URI approach the AI Info panel's pin button already
    // uses — a synthetic title-artist key when there's no real media
    // content_id, so pinning still works on speakers (often non-MA) that
    // don't populate one. Playback of a pinned track already goes through a
    // fuzzy title+artist search regardless of URI, so this loses nothing.
    const trackUri = attrs.media_content_id
      || ((trackTitle || artistName) ? ('title-artist://' + trackTitle.toLowerCase().trim() + '|' + artistName.toLowerCase().trim()) : '');
    if (!trackUri) { this._showToast('Nothing to pin right now'); return; }
    const pinItem = {
      uri: trackUri, name: trackTitle, artist: artistName,
      artists: artistName ? [{ name: artistName }] : [],
      image: art, media_type: 'track',
    };
    const nowPinned = this._maLibToggleStar(pinItem, 'track');
    if (nowPinned === null) { this._showToast('Nothing to pin right now'); return; }
    if (nowPinned) { this._spawnPinHearts(x, y); }
    else { this._spawnPinHearts(x, y, '#8E8E93'); }
    this._updatePinnedIndicator();
    this._maLibRefreshPinnedUI('track');
  },

  // Burst of hearts floating up from the tap point. The artwork wrapper
  // clips overflow, so hearts fade out while still within its own bounds
  // rather than actually escaping the card.
  _spawnPinHearts(x, y, color = '#DC241F') {
    // Optional via the Pin Hearts toggle in the editor's visual-effects
    // section — gated here at the single spawn point rather than at each
    // pin/unpin call site, so the pin itself (and the pinned-indicator
    // update) always still happens; only the animation is suppressed.
    if (this._config?.pin_hearts === false) return;
    const r = this.shadowRoot;
    const artEl = r.getElementById('artClick');
    if (!artEl) return;
    const rect = artEl.getBoundingClientRect();
    const originX = (x != null) ? x : rect.width / 2;
    const originY = (y != null) ? y : rect.height / 2;
    const HEART_COUNT = 10;
    for (let i = 0; i < HEART_COUNT; i++) {
      const driftX   = (Math.random() - 0.5) * 120;
      const riseDist = 90 + Math.random() * (rect.height * 0.45);
      const rotate   = (Math.random() - 0.5) * 50;
      const size     = 18 + Math.random() * 14;
      const delay    = Math.random() * 200;
      const duration = 900 + Math.random() * 500;
      const heart = document.createElement('div');
      heart.className = 'pin-heart';
      heart.style.cssText = `position:absolute;left:${originX}px;top:${originY}px;width:${size}px;height:${size}px;pointer-events:none;z-index:15;--heart-drift-x:${driftX}px;--heart-rise:${riseDist}px;--heart-rotate:${rotate}deg;animation:pin-heart-float ${duration}ms ease-out ${delay}ms forwards;`;
      heart.innerHTML = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;display:block;"><path fill="${color}" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.09C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.42 22,8.5C22,12.28 18.6,15.36 13.45,20.03L12,21.35Z"/></svg>`;
      artEl.appendChild(heart);
      setTimeout(() => heart.remove(), delay + duration + 50);
    }
  },

  // Discogs & AI: similar tracks for a song from the AI, kept per song. A full AI answer for the song
  // (from AI First or Look Up in Advance) is used if there is one.
  _songMixKey(artist, title) { return ('songmix2|' + artist + '|' + title).toLowerCase(); },

  _songMixCached(artist, title) {
    if (!this._aiTrackInfoCache) this._aiTrackInfoCache = new Map();
    const mine = this._aiCachedRead(this._aiTrackInfoCache, 'trackInfo', this._songMixKey(artist, title));
    if (mine) return mine;
    const full = this._aiCachedRead(this._aiTrackInfoCache, 'trackInfo', ('trackinfo3|' + artist + '|' + title).toLowerCase());
    if (full && !full._notFound && !full._incomplete && (full.similar || []).length) return { similar: full.similar };
    return null;
  },

  async _songMixExtras(artist, title) {
    const agentId = this._config?.ai_conversation_agent || '';
    if (!agentId || agentId === 'conversation.home_assistant') return null;
    if (!(await this._aiCheckAvailable())) return null;
    const prompt = 'You are a music encyclopedia. For the track "' + title + '" by "' + artist + '", give 10 similar songs by other artists. '
      + 'CRITICAL: Use your training knowledge. Return a single raw JSON object, start with { end with }: {"similar":[{"title":"...","artist":"..."}]}. If you don\'t know the song return {}.';
    try {
      const resp = await this._aiProcess({ _crowFeature: 'info', _crowFallback: true, _crowSilent: true,
        type: 'conversation/process', text: prompt, agent_id: agentId, language: navigator.language || 'en' });
      const raw = String(resp?.response?.speech?.plain?.speech || '');
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      let o = null;
      if (a !== -1 && b > a) { try { o = JSON.parse(raw.slice(a, b + 1)); } catch (_) { o = null; } }
      const out = { similar: Array.isArray(o?.similar) ? o.similar.filter(x => x && x.title && x.artist).slice(0, 10).map(x => ({ title: String(x.title), artist: String(x.artist) })) : [] };
      if (!out.similar.length) return null;
      this._aiCachedWrite(this._aiTrackInfoCache || (this._aiTrackInfoCache = new Map()), 'trackInfo', this._songMixKey(artist, title), out);
      return out;
    } catch (_) { return null; }
  },

  _wireInfoPinButton(pinItem, pinTab, labelNoun) {
    const r = this.shadowRoot;
    const _pinBtn = r.getElementById('infoPinBtn');
    const _pinSvg = r.getElementById('infoPinSvg');
    if (!_pinBtn || !_pinSvg || !pinItem?.uri) {
      if (_pinBtn) { _pinBtn.classList.add('hidden'); _pinBtn.onclick = null; }
      return;
    }
    const _update = () => {
      const _pinned = this._maLibIsStarred(pinItem, pinTab);
      _pinSvg.style.fill = _pinned ? '#FFD60A' : 'rgba(255,255,255,0.5)';
      _pinBtn.title = _pinned ? ('Unpin ' + labelNoun) : ('Pin ' + labelNoun);
    };
    _pinBtn.classList.remove('hidden'); this._heroPinWatch();
    _update();
    _pinBtn.onclick = async () => {
      if (this._maLibIsStarred(pinItem, pinTab) && !(await this._confirmUnpin(String(labelNoun || 'item').toLowerCase(), this._pinItemName(pinItem)))) return;
      const nowPinned = this._maLibToggleStar(pinItem, pinTab);
      if (nowPinned === null) return;
      _update();
      this._showToast(nowPinned ? ('\ud83d\udccd ' + labelNoun + ' pinned') : (labelNoun + ' unpinned'));
      this._maLibRefreshPinnedUI(pinTab);
      this._updatePinnedIndicator();
    };
  },

  // The info panels' Pin sits in the hero action bar (the row of round buttons under the
  // artwork). Each view still wires the header pin button for its own item; that button stays
  // out of sight, and a round Pin button in the bar runs it and shows whether it's pinned. A view
  // with no bar of its own gets one under its hero (marked .info-hero or data-hero-pin).
  _heroPinWatch() {
    const r = this.shadowRoot;
    const hdr = r?.getElementById('infoPinBtn');
    const content = r?.getElementById('infoContent');
    if (!hdr || !content) return;
    if (!this._heroPinObs || this._heroPinFor !== content || this._heroPinHdr !== hdr) {
      try { this._heroPinObs?.disconnect(); } catch (_) {}
      const obs = new MutationObserver(() => this._heroPinSync());
      obs.observe(content, { childList: true, subtree: true });
      obs.observe(hdr, { attributes: true, attributeFilter: ['class', 'title'] });
      const yt = r.getElementById('infoYoutubeBtn');
      if (yt) obs.observe(yt, { attributes: true, attributeFilter: ['class', 'title'] });
      this._heroPinObs = obs; this._heroPinFor = content; this._heroPinHdr = hdr;
    }
    this._heroPinSync();
  },

  _heroPinSync() {
    const r = this.shadowRoot;
    const hdr = r?.getElementById('infoPinBtn');
    const content = r?.getElementById('infoContent');
    if (!hdr || !content) return;
    let btn = content.querySelector('.crow-hero-pin');
    const active = !hdr.classList.contains('hidden') && typeof hdr.onclick === 'function';
    if (!active) {
      content.querySelector('.crow-hero-trailer')?.remove();
      if (btn) { const ownBar = btn.closest('.crow-hero-pin-bar'); btn.remove(); ownBar?.remove(); }
      return;
    }
    // a view that already has a Pin of its own in its bar keeps that one
    if (content.querySelector('[data-action="pin"]')) {
      if (btn) { const ownBar = btn.closest('.crow-hero-pin-bar'); btn.remove(); ownBar?.remove(); }
      return;
    }
    const realBar = content.querySelector('.ma-drill-actions:not(.crow-hero-pin-bar)');
    if (btn && realBar && !realBar.contains(btn)) {
      // the view's own bar arrived after the stand-in bar was added: move into it
      const ownBar = btn.closest('.crow-hero-pin-bar');
      realBar.appendChild(btn); ownBar?.remove();
    }
    if (!btn) {
      let bar = realBar || content.querySelector('.crow-hero-pin-bar');
      if (!bar) {
        const hero = content.querySelector('.info-hero, [data-hero-pin]');
        if (!hero) return;
        bar = document.createElement('div');
        bar.className = 'ma-drill-actions crow-hero-pin-bar';
        bar.style.marginBottom = '14px';
        hero.after(bar);
      }
      btn = document.createElement('button');
      btn.className = 'ma-drill-action-btn crow-hero-pin';
      btn.innerHTML = '<div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg></div><span class="ma-drill-btn-label">Pin</span>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const h = this.shadowRoot?.getElementById('infoPinBtn');
        if (h && typeof h.onclick === 'function') h.onclick(e);
      });
      bar.appendChild(btn);
    }
    this._heroTrailerSync(content, btn);
    const pinned = /^unpin/i.test(hdr.title || '');
    const svg = btn.querySelector('svg'), label = btn.querySelector('.ma-drill-btn-label');
    const fill = pinned ? '#FFD60A' : '';
    if (svg && svg.style.fill !== (pinned ? 'rgb(255, 214, 10)' : '')) svg.style.fill = fill;
    const text = pinned ? 'Unpin' : 'Pin';
    if (label && label.textContent !== text) label.textContent = text;
    btn.title = hdr.title || 'Pin';
  },

  // Movie and TV panels: a round Trailer button in the bar, before Pin, running the same
  // Watch Trailer as the 3-dot menu (it's in both places)
  _heroTrailerSync(content, pinBtn) {
    const yt = this.shadowRoot?.getElementById('infoYoutubeBtn');
    const on = !!yt && !yt.classList.contains('hidden') && typeof yt.onclick === 'function' && yt.title === 'Watch Trailer';
    let tb = content.querySelector('.crow-hero-trailer');
    if (!on) { tb?.remove(); return; }
    if (!tb) {
      tb = document.createElement('button');
      tb.className = 'ma-drill-action-btn crow-hero-trailer';
      tb.title = 'Watch Trailer';
      tb.innerHTML = '<div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg></div><span class="ma-drill-btn-label">Trailer</span>';
      tb.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = this.shadowRoot?.getElementById('infoYoutubeBtn');
        if (b && typeof b.onclick === 'function') b.onclick(e);
      });
    }
    if (tb.nextElementSibling !== pinBtn) pinBtn.before(tb);
  },

  async _showAITrackInfo(trackTitle, artistName, context = {}) {
    const r = this.shadowRoot;
    if (!trackTitle && !artistName) return;

    // Use the existing infoPopup — proven to have correct background and positioning
    const popup   = r.getElementById('infoPopup');
    const content = r.getElementById('infoContent');
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    const titleEl = r.getElementById('infoPopupTitle');
    if (!popup || !content) return;

    // Force solid backgrounds — disable ha-card's backdrop-filter while popup is open
    popup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    popup.style.setProperty('backdrop-filter', 'none');
    popup.style.setProperty('-webkit-backdrop-filter', 'none');
    popup.style.setProperty('isolation', 'isolate');
    popup.style.setProperty('transform', 'translateZ(0)');
    content.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    const _haCard1 = r.querySelector('ha-card');
    if (_haCard1) {
      _haCard1?.style.setProperty('--crow-card-blur', 'none');
    }

    // Open the info popup
    popup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    // Clear queue direction so state-change auto-refresh doesn't overwrite this panel
    this._queuePanelDirection = null;
    const _rbo = r.getElementById('queueMenuBtn');
    if (_rbo) _rbo.classList.add('hidden');
    // Hide queue search bar while AI Info is showing
    const _qsr = r.getElementById('queueSearchRow');
    if (_qsr) _qsr.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'Info';

    // Staleness guard — if another panel opens while we're awaiting async work,
    // our continuations must not overwrite content with stale track info.
    if (!this._aiPanelGeneration) this._aiPanelGeneration = 0;
    const _myGen = ++this._aiPanelGeneration;
    const _stale = () => this._aiPanelGeneration !== _myGen;

    // Show loading spinner
    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

    // Play/Add/Play Next and Pin never actually depend on the AI response —
    // only the fact/meta-grid/members/similar-tracks sections below do. The
    // old behavior blocked the ENTIRE panel (including those controls)
    // behind a full-screen spinner for the whole AI round-trip, which could
    // take several seconds. Render the hero + action bar + pin immediately
    // and interactive, and confine the "loading" state to just the details
    // section underneath, which gets filled in once the AI call resolves
    // (the full re-render further down naturally replaces this shell —
    // nothing here needs manual cleanup).
    // Only borrow the player's own artwork when it's actually playing this
    // track — otherwise (a song opened from the library, Music History,
    // etc. while something else plays) the hero showed whatever was on
    // screen, e.g. a TV show's thumbnail next to a Supertramp song.
    const _entityIsThisTrack = !context.fromSearch && this._entityPlayingTrack(trackTitle, artistName);
    const _quickArt = (context.overrideArt || (_entityIsThisTrack && (
        this._hass?.states[this._entity]?.attributes?.entity_picture_local
        || this._hass?.states[this._entity]?.attributes?.entity_picture
        || this._hass?.states[this._entity]?.attributes?.album_art
      )) || '').toString().replace(/^http:\/\//i, 'https://');
    const _quickArtHtml = _quickArt
      ? `<img src="${_quickArt}" class="info-hero-art-img" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;" onerror="this.style.display='none'">`
      : `<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:${this._pt('dim')}"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>`;

    content.innerHTML = `
      <div id="ai-info-action-bar" class="ma-drill-actions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="replace">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
          <span class="ma-drill-btn-label">Play Now</span>
        </button>
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="add">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div>
          <span class="ma-drill-btn-label">Add</span>
        </button>
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="next">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div>
          <span class="ma-drill-btn-label">Play Next</span>
        </button>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="width:64px;height:64px;border-radius:10px;overflow:hidden;flex-shrink:0;background:${this._pt("bg")};display:flex;align-items:center;justify-content:center;">${_quickArtHtml}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:${this._pt('text')};letter-spacing:-0.3px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${trackTitle||''}</div>
          <div class="ip-links" style="margin-top:5px;">
            <div class="ip-link" style="cursor:default;"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg><span>${artistName||''}</span></div>
          </div>
        </div>
      </div>
      <div id="ai-track-details-loading" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px 0;">
        <div style="width:22px;height:22px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
        <div style="font-size:12px;color:${this._pt("dim")};">Loading…</div>
      </div>`;

    // Always start a newly opened track at the top. infoContent is the scroll
    // container and is reused between panels, so without this, tapping a row
    // deep in a Discogs tracklist re-rendered the new panel (often the SAME
    // release/tracklist) at the old scroll offset — it looked like nothing
    // happened, and the row now under the finger was the panel's own track.
    content.scrollTop = 0;

    // Wire action bar immediately — identical target-resolution/play logic
    // to the one used once the full AI response is in (see below); duplicated
    // here rather than shared because this shell gets fully replaced once
    // that render happens, so there's no state to reconcile between them.
    {
      const _qBarAllMA = (() => {
        let ma = this._getValidMASpeakers(true);
        if (!ma.length) ma = [...(this._maEntityIds||[])].filter(e => this._hass?.states[e]);
        return ma;
      })();
      const _qBarTarget = (_qBarAllMA.includes(this._lastMAPlayTarget) ? this._lastMAPlayTarget : null)
        || this._resolveMATargetEntity()
        || _qBarAllMA[0]
        || this._entity;
      content.querySelectorAll('.ai-info-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (!_qBarAllMA.length) { this._showToast('Music Assistant required'); return; }
          if (action === 'replace') this._showLoadingToast('Starting playback\u2026');
          if (action === 'replace' && context.queueItemId) {
            const _target = context.queueEntity || this._entity;
            // Music Assistant can play it right where it is in the queue, without moving it
            if (await this._maPlayQueueItem?.(_target, context.queueItemId)) { this._queuePanelDirection = null; this._closeInfoPopup(); return; }
            const _hasMoveNext = !!(this._hass?.services?.mass_queue?.move_queue_item_next);
            try {
              if (_hasMoveNext && context.queueItemId) {
                await this._call('mass_queue', 'move_queue_item_next', {
                  entity: _target, queue_item_id: context.queueItemId
                });
              } else {
                await this._hass.connection.sendMessagePromise({
                  type: 'call_service', domain: 'music_assistant', service: 'play_media',
                  service_data: { entity_id: _target, media_id: trackTitle + ' ' + artistName, media_type: 'track', enqueue: 'next' }
                });
              }
            } catch(e) { this._showToast('Could not play track'); return; }
            await new Promise(res => setTimeout(res, 300));
            try { await this._call('media_player', 'media_next_track', { entity_id: _target }); } catch(_) {}
            this._queuePanelDirection = null;
            this._closeInfoPopup();
            return;
          }
          this._lastMAPlayTarget = _qBarTarget;
          const _played = await this._playTrackViaMAToast(trackTitle, artistName, _qBarTarget, action);
          if (action === 'replace' && _played) { this._closeInfoPopup(); this._closeMABrowser(true); }
        });
      });
    }

    // Wire pin button immediately too — same URI/item construction as the
    // full render uses later, so pinning during the loading window and
    // pinning after it both key to the same identity.
    {
      const _qTrackUri = context.queueUri
        || this._hass?.states[this._entity]?.attributes?.media_content_id
        || ((trackTitle || artistName) ? ('title-artist://' + (trackTitle || '').toLowerCase().trim() + '|' + (artistName || '').toLowerCase().trim()) : '');
      const _qPinItem = {
        uri: _qTrackUri, name: trackTitle, artist: artistName,
        artists: artistName ? [{ name: artistName }] : [],
        image: _quickArt || '', media_type: 'track',
      };
      this._wireInfoPinButton(_qTrackUri ? _qPinItem : null, 'track', 'Song');
    }

    const glassOn = this._config?.card_liquid_glass !== false;
    // Try to get iTunes art specifically for this track.
    // Only fall back to entity state art when NOT opened from a search/rec context
    // (context.fromSearch flag) — otherwise we'd show the currently-playing song's art.
    // Use override art (e.g. already-fetched thumbnail from a similar/rec row) to avoid
    // a redundant iTunes request and prevent entity art from bleeding into the panel.
    // The track's artwork is looked up alongside the info (not before it), and kept for the
    // session, so reopening a song (or a cached one) doesn't wait on the artwork searches again.
    const stationName = context.stationName || '';
    if (!this._infoArtMemo) this._infoArtMemo = new Map();
    const _artMemoKey = (artistName + '|' + trackTitle).toLowerCase();
    const _artP = (async () => {
      let specificArt = context.overrideArt || null;
      if (specificArt) return specificArt;
      if (this._infoArtMemo.has(_artMemoKey)) return this._infoArtMemo.get(_artMemoKey) || null;
      if (!specificArt) {
        specificArt = await this._fetchItunesArtForTrack(artistName, trackTitle);
      }

      // Fallback: if iTunes had nothing, try MA search for the track's artwork.
      // This covers local files, Tidal exclusives, and tracks iTunes doesn't index.
      if (!specificArt && trackTitle && this._hass?.services?.mass_queue) {
        try {
          const _maConfigId = await this._getMAConfigEntryId();
          if (_maConfigId) {
            const _maQuery = artistName ? trackTitle + ' ' + artistName : trackTitle;
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

            // Score by title+artist match — same logic as _playTrackViaMAToast
            const _norm = s => (s || '').toLowerCase().replace(/[''`]/g, "'").trim();
            const _nt = _norm(trackTitle), _na = _norm(artistName);
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
              ? (typeof _bestMA.image === 'string' ? _bestMA.image
                  : (_bestMA.image?.path || _bestMA.thumbnail || ''))
              : '';

            if (_maImgUrl) {
              const _encoded = await this._fetchMAImage(_maImgUrl);
              if (_encoded) specificArt = _encoded;
            }
          }
        } catch(_) {}
      }
      if (!_stale()) this._infoArtMemo.set(_artMemoKey, specificArt || '');
      return specificArt;
    })();


    const isMa = this._maEntityIds?.has(this._entity);
    const agentId = this._config?.ai_conversation_agent || 'conversation.home_assistant';

    // ── AI master switch ── with AI features disabled, don't probe for an
    // agent or show the "No AI Found" education screen — fall straight into
    // the same _notFound branch a failed AI lookup uses further down, which
    // is the existing Discogs → library-data fallback chain. That makes
    // Discogs the default info panel when AI is off. Cached AI results from
    // before the switch was turned off are deliberately ignored too, so the
    // panel behaves consistently rather than showing AI data for some
    // tracks and Discogs for others.
    let _aiOff = !this._aiFeatureOn('info');

    // ── Info panel priority ── when the user has flipped this to "Discogs
    // First" in the editor, try Discogs before AI is ever consulted: no
    // agent-availability probe, no AI network call. A hit here renders
    // through the exact same Discogs-sourced template used by the AI-first
    // fallback chain below (data._fromDiscogs). A miss or rate limit simply
    // falls through into the normal AI-first flow beneath it.
    let _earlyDiscogsData = null;
    // "Discogs & AI" (discogs_ai) takes Discogs's facts the same way, then adds the AI's extras
    if (!_aiOff && ['discogs', 'discogs_ai'].includes(this._config?.info_panel_priority)) {
      const _fromSearchEarly = !!(context.fromSearch || context.overrideArt);
      const _liveMediaTypeEarly = _fromSearchEarly ? null : this._detectMediaType(this._hass?.states[this._entity]);
      if (!_liveMediaTypeEarly || _liveMediaTypeEarly === 'music') {
        const _earlyAttrs = this._hass?.states[this._entity]?.attributes || {};
        const _earlyRawAlbum = _earlyAttrs.media_album_name || '';
        const _earlyAlbumLooksLikeTitle = !!(_earlyRawAlbum && trackTitle &&
          _earlyRawAlbum.toLowerCase().replace(/[^a-z0-9]/g,'') === trackTitle.toLowerCase().replace(/[^a-z0-9]/g,''));
        const _earlyAlbum = context.overrideAlbum || (_fromSearchEarly || _earlyAlbumLooksLikeTitle ? '' : _earlyRawAlbum) || '';
        const _earlyResult = await this._lookupDiscogsForAIData(artistName, _earlyAlbum, trackTitle);
        if (_stale()) return;
        if (_earlyResult && _earlyResult !== 'rate_limited') {
          const _earlyDurSecs = _fromSearchEarly ? null : _earlyAttrs.media_duration;
          const _earlyDur = (() => {
            if (!_earlyDurSecs) return null;
            const s = Math.round(parseFloat(_earlyDurSecs));
            const m = Math.floor(s / 60), h = Math.floor(m / 60);
            return h > 0 ? h + ':' + String(m % 60).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0')
                         : m + ':' + String(s % 60).padStart(2,'0');
          })();
          _earlyDiscogsData = this._discogsResultToAIData(_earlyResult, _earlyAlbum, _earlyDur, trackTitle, artistName);
          if (_earlyDiscogsData && this._config?.info_panel_priority === 'discogs_ai') {
            _earlyDiscogsData._mixedAI = true;
            // the AI's extras straight away when they're already known (from this mode, or a full AI answer)
            const _mx = this._songMixCached(artistName, trackTitle);
            if (_mx && (_mx.similar || []).length && !(_earlyDiscogsData.similar || []).length) _earlyDiscogsData.similar = _mx.similar;
          }
        }
      }
    }

    if (!_aiOff && !_earlyDiscogsData) {
      const hasAI = await this._aiCheckAvailable();
      if (_stale()) return;
      // No AI agent available: use the same Discogs → library details route
      // as when AI is switched off, rather than a "No AI Found" dead end.
      if (!hasAI) _aiOff = true;
    }

    const cacheKey = ('trackinfo3|' + artistName + '|' + trackTitle).toLowerCase();
    if (!this._aiTrackInfoCache) this._aiTrackInfoCache = new Map();

    // Check localStorage/sessionStorage before network
    if (!_aiOff && !this._aiTrackInfoCache.has(cacheKey)) {
      const persisted = this._aiLocalGet('trackInfo', cacheKey)
        || this._aiSessionGet('trackInfo', cacheKey);
      // Only warm the in-session cache for complete, confident results.
      // _incomplete: will retry AI now. _notFound within TTL: skip AI, show MA fallback.
      if (persisted && !persisted._incomplete) this._aiTrackInfoCache.set(cacheKey, persisted);
    }
    // Clear incomplete cached entry so we retry AI
    let data = _earlyDiscogsData || (_aiOff ? undefined : this._aiTrackInfoCache.get(cacheKey));
    if (data?._incomplete) { this._aiTrackInfoCache.delete(cacheKey); data = undefined; }
    if (_aiOff) {
      // Same shape a failed AI lookup produces — routes into the _notFound
      // handling below (MA queue metadata → Discogs → plain library data).
      data = { album: null, year: null, label: null, duration: null, vibe: null, similar: [], _notFound: true };
    } else if (!data && this._aiTrackMissHas(cacheKey)) {
      // The AI already failed for this track this session — don't make the
      // user wait for it again. Straight to Discogs; a quiet background
      // retry (below) can bring the AI panel back for next time.
      data = { album: null, year: null, label: null, duration: null, vibe: null, similar: [], _notFound: true, _aiFailed: true, _fromMiss: true };
    } else if (!data) {
      try {
        data = await this._fetchAITrackInfoData(trackTitle, artistName, { fallback: true });
        if (_stale()) return;
      } catch(e) {
        if (_stale()) return;
        // The AI couldn't help (limit reached, timed out, unreadable answer…):
        // remember that for this session so the next tap goes straight to
        // Discogs, and take the same route as "not found" (Discogs, then
        // the library details).
        this._aiTrackMissAdd(cacheKey);
        data = { album: null, year: null, label: null, duration: null, vibe: null, similar: [], _notFound: true, _aiFailed: true };
      }
    }

    if (_stale()) return;

    // the artwork gets a short while more once the info is in hand; a slow search doesn't hold the panel up
    const specificArt = await Promise.race([_artP, new Promise(res => setTimeout(() => res(null), 2500))]);
    if (_stale()) return;
    const artUrl = specificArt || (() => {
      if (context.fromSearch) return ''; // don't use entity art for search/rec results
      if (!_entityIsThisTrack) return ''; // player is showing something else
      const state = this._hass?.states[this._entity];
      const attrs = state?.attributes || {};
      const itunesKey = [(attrs.media_artist||''), (attrs.media_album_name||attrs.media_title||'')]
        .filter(Boolean).join('|').toLowerCase();
      const itunesArt = (itunesKey && this._itunesArtCache?.[itunesKey]) || '';
      return (attrs.entity_picture_local || attrs.entity_picture || attrs.album_art || itunesArt || '')
        .replace(/^http:\/\//i, 'https://');
    })();

    // Show a clear not-found state rather than a half-empty or hallucinated panel
    if (data._notFound) {
      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');

      // Fallback: show rich metadata from MA queue + HA state rather than blank "not found"
      const _fbState = this._hass?.states[this._entity];
      const _fbAttrs = _fbState?.attributes || {};
      const _isMaFb  = this._maEntityIds?.has(this._entity);

      // AI failed for this track — quietly give it one more go in the
      // background so the next tap can show the full AI panel.
      if (data._aiFailed) this._aiTrackMissRetry(trackTitle, artistName);

      // Reopening a track the AI already missed: reuse the queue details from
      // the first time and skip the spinner, so the (cached) Discogs panel
      // appears straight away.
      if (!this._fbQueueItemCache) this._fbQueueItemCache = new Map();
      const _cachedQ = data._fromMiss && this._fbQueueItemCache.has(cacheKey) ? this._fbQueueItemCache.get(cacheKey) : undefined;
      if (_cachedQ === undefined) content.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:24px;">
          <div style="width:24px;height:24px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>
          <div style="font-size:12px;color:${this._pt('dim')};">Loading track details…</div>
        </div>`;

      // Try MA queue for rich metadata — but ONLY when playing the currently-playing track.
      // If opened from search/recs (context.fromSearch), the queue reflects the currently
      // playing song, not the tapped one, so skip it and use params + HA attrs only.
      let _qItem = _cachedQ !== undefined ? _cachedQ : null;
      const _fromSearch = !!(context.fromSearch || context.overrideArt);
      if (_cachedQ === undefined && _isMaFb && !_fromSearch) {
        try {
          const _qRes = await this._hass.connection.sendMessagePromise({
            type: 'call_service', domain: 'music_assistant', service: 'get_queue',
            service_data: { entity_id: this._resolveMATargetEntity() || this._entity },
            return_response: true
          });
          const _qData = _qRes?.response?.[this._resolveMATargetEntity() || this._entity]
                      || _qRes?.response || null;
          _qItem = _qData?.current_item?.media_item || _qData?.current_item || null;
          // Double-check: discard if the queue item doesn't match the track we're showing
          const _qTitle  = (_qItem?.name || '').toLowerCase().trim();
          const _qArtist = (_qItem?.artists?.[0]?.name || '').toLowerCase().trim();
          const _pTitle  = (trackTitle || '').toLowerCase().trim();
          const _pArtist = (artistName || '').toLowerCase().trim();
          if (_qTitle && _pTitle && !_qTitle.includes(_pTitle) && !_pTitle.includes(_qTitle)) {
            _qItem = null; // queue is out of sync with the track we're showing
          }
        } catch(_) {}
      }
      if (_cachedQ === undefined && !_fromSearch) this._fbQueueItemCache.set(cacheKey, _qItem);
      if (_stale()) return;

      // Some non-MA players report media_album_name identical to the track
      // title itself — not a real album, just a placeholder. Trusting that
      // as an album name sends the Discogs search below looking for an
      // "album" that's really just the song title, which can confidently
      // match the wrong single/promo release instead of the actual album.
      const _rawAlbumAttr = _fbAttrs.media_album_name || '';
      const _albumLooksLikeTitle = !!(_rawAlbumAttr && trackTitle &&
        _rawAlbumAttr.toLowerCase().replace(/[^a-z0-9]/g,'') === trackTitle.toLowerCase().replace(/[^a-z0-9]/g,''));

      // Merge: MA queue (if matched) > function params > HA state attrs
      const _fb = {
        title:    trackTitle                                                           || _fbAttrs.media_title       || '',
        artist:   artistName                                                           || _fbAttrs.media_artist      || '',
        // Only use HA state album when showing the currently-playing track (not from search)
        album:    _qItem?.album?.name          || context.overrideAlbum || (_fromSearch || _albumLooksLikeTitle ? '' : _rawAlbumAttr) || '',
        year:     _qItem?.year                 || null,
        trackNo:  _qItem?.track_number         || null,
        discNo:   _qItem?.disc_number          || null,
        isrc:     _qItem?.isrc                 || _qItem?.external_ids?.isrc          || null,
        mbid:     _qItem?.mbid                 || _qItem?.external_ids?.musicbrainz   || null,
        duration: _qItem?.duration             || (_fromSearch ? null : _fbAttrs.media_duration) || null,
        providers:(_qItem?.provider_mappings   || []).map(p => p.provider_domain || p.provider || '').filter(Boolean),
        genres:   (_qItem?.metadata?.genres    || []).slice(0, 5),
        explicit: !!_qItem?.metadata?.explicit,
      };

      const _fmtDur = (secs) => {
        if (!secs) return null;
        const s = Math.round(parseFloat(secs));
        const m = Math.floor(s / 60), h = Math.floor(m / 60);
        return h > 0 ? h + ':' + String(m % 60).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0')
                     : m + ':' + String(s % 60).padStart(2,'0');
      };

      // Try Discogs before dropping to the plain library-data panel. A match
      // here gets rendered through the exact same template used below for a
      // genuine AI result (data.album/year/label/genre, same hero/meta-grid/
      // action bar), just with a Discogs-sourced tracklist + rating + link
      // appended — so the only time the bare library-data panel appears at
      // all is when Discogs also has nothing.
      let _discogsData = null;
      let _discogsRateLimited = false;
      // Only relevant when this call reflects what's actually playing right
      // now (not a tap into a different track from search/tracklist/similar
      // tracks, where the live entity's content has nothing to do with the
      // track being looked up). Guards against Discogs ever showing up for
      // video — if the entity is actually playing a movie/TV show, don't
      // treat it as a music lookup no matter how it got routed here.
      const _liveMediaType = _fromSearch ? null : this._detectMediaType(this._hass?.states[this._entity]);
      const _isActuallyMusic = !_liveMediaType || _liveMediaType === 'music';
      if (_isActuallyMusic) {
        const _discogsResult = await this._lookupDiscogsForAIData(artistName, _fb.album, trackTitle);
        if (_stale()) return;
        if (_discogsResult === 'rate_limited') {
          _discogsRateLimited = true;
          // The original card's full-panel warning: a friendly "slow down"
          // message with a Close button that counts down and closes the panel
          // after 10 seconds — the same 10 seconds the card waits before
          // asking Discogs again.
          content.innerHTML = this._psAutoClose(
            this._psWarning('Slow down a little!', 'You\u2019ve been looking up a lot of albums. Give it a moment and tap the artwork again.'),
            null, 10000, 'discogsRlBtn', 'discogsRlRing');
          // Only close if this warning is still what's showing (not if
          // something else was opened in the meantime).
          this._psAutoCloseStart(this.shadowRoot, null, () => {
            if (this.shadowRoot?.getElementById('discogsRlBtn')?.isConnected) this._closeInfoPopup();
          }, 10000, 'discogsRlBtn', 'discogsRlRing');
          return;
        } else if (_discogsResult) {
          _discogsData = this._discogsResultToAIData(_discogsResult, _fb.album, _fmtDur(_fb.duration), trackTitle, artistName);
        }
      }

      if (_discogsData) {
        data = _discogsData;
      } else {

      const _providerLabel = { spotify:'Spotify',tidal:'Tidal',youtube_music:'YT Music',
        apple_music:'Apple Music',deezer:'Deezer',qobuz:'Qobuz',amazon_music:'Amazon Music',
        soundcloud:'SoundCloud',jellyfin:'Jellyfin',subsonic:'Subsonic',plex:'Plex',
        tunein:'TuneIn',filesystem:'Local Files' };
      const _providerColor = { spotify:'#1DB954',tidal:'#00FFFF',youtube_music:'#FF0000',
        apple_music:'#FC3C44',deezer:'#A238FF',qobuz:'#2C6FD1',amazon_music:'#00A8E0',
        soundcloud:'#FF5500',jellyfin:'#00A4DC',subsonic:'#F6832E',plex:'#E5A00D',
        tunein:'#40BF95',filesystem:'#63b3ed' };

      const _providerPills = _fb.providers.length
        ? `<div class="ip-sec" style="margin-top:12px;">Available on</div><div class="ip-tags">` +
          _fb.providers.map(p => {
            const _lbl = _providerLabel[p] || p.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
            const _col = _providerColor[p] || '#63b3ed';
            return `<span style="color:${_col};font-weight:600;">${_lbl}</span>`;
          }).join('') + `</div>`
        : '';

      const _fbMeta = [
        _fb.album    && ['Album',  _fb.album],
        _fb.year     && ['Year',   String(_fb.year)],
        _fmtDur(_fb.duration) && ['Length', _fmtDur(_fb.duration)],
        _fb.trackNo  && ['Track',  _fb.discNo > 1 ? `${_fb.discNo}–${_fb.trackNo}` : String(_fb.trackNo)],
        _fb.isrc     && ['ISRC',   _fb.isrc],
        _fb.mbid     && ['MBID',   _fb.mbid.slice(0,13) + '…'],
      ].filter(Boolean);

      // the details as quiet lines under the title (no boxes): year, length and track, then the identifiers
      const _fbLine = _fbMeta.filter(([l]) => l === 'Year' || l === 'Length' || l === 'Track').map(([l, v]) => l === 'Track' ? 'Track ' + v : v).join(' · ');
      const _fbIds = _fbMeta.filter(([l]) => l === 'ISRC' || l === 'MBID').map(([l, v]) => l + ' ' + v).join(' · ');
      const _metaGridHtml = _fbIds ? `<div class="ip-meta" style="opacity:0.7;margin:-4px 0 12px;font-size:11px;">${_fbIds}</div>` : '';

      const _genreHtml = _fb.genres.length
        ? `<div class="ip-sec">Genre</div><div class="ip-tags" style="margin-bottom:12px;">
            ${_fb.genres.map(g => `<span>${g}</span>`).join('')}
           </div>`
        : '';

      const _artHtml2 = artUrl
        ? `<img src="${artUrl}" class="info-hero-art-img" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;" onerror="this.style.display='none'">`
        : `<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:${this._pt('dim')}"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>`;

      const _noAINote = `
        <div class="ip-note">
          <svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
          <span>AI info unavailable — showing library data</span>
        </div>`;

      // Shown instead of/alongside the note above specifically when Discogs
      // itself was rate-limited (as opposed to genuinely having no match) —
      // same "slow down" framing used elsewhere in the card for Discogs
      // rate limits, so this doesn't look like a different kind of error.
      const _discogsRateLimitNote = _discogsRateLimited ? `
        <div class="ip-note">
          <svg viewBox="0 0 24 24" style="fill:rgba(255,165,0,0.85)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
          <span>Slow down a little! Discogs lookups are rate-limited — try again shortly.</span>
        </div>` : '';

      const _fbActionBar = `
        <div id="ai-info-action-bar" class="ma-drill-actions" style="margin-bottom:14px;">
          <button class="ma-drill-action-btn ai-info-action-btn" data-action="replace">
            <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
            <span class="ma-drill-btn-label">Play Now</span>
          </button>
          <button class="ma-drill-action-btn ai-info-action-btn" data-action="add">
            <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div>
            <span class="ma-drill-btn-label">Add</span>
          </button>
          <button class="ma-drill-action-btn ai-info-action-btn" data-action="next">
            <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div>
            <span class="ma-drill-btn-label">Play Next</span>
          </button>
        </div>`;

      r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
      // the details come from the library (or the player), so the header says so
      { const _lt = r?.getElementById('infoPopupTitle'); if (_lt) _lt.textContent = 'Library Info'; }
      content.innerHTML = `
        ${_fbActionBar}
        <div style="display:flex;gap:12px;margin-bottom:14px;">
          <div style="width:64px;height:64px;border-radius:10px;overflow:hidden;flex-shrink:0;background:${this._pt('bg')};display:flex;align-items:center;justify-content:center;">${_artHtml2}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:700;color:${this._pt('text')};letter-spacing:-0.3px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_fb.title}</div>
            <div style="font-size:12px;color:${this._pt('dim')};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_fb.artist}</div>
            ${_fb.album ? `<div style="font-size:11px;color:${this._pt('dim')};opacity:0.7;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_fb.album}</div>` : ''}
            ${_fbLine ? `<div style="font-size:11px;color:${this._pt('dim')};opacity:0.7;margin-top:2px;">${_fbLine}</div>` : ''}
            ${_fb.explicit ? `<span style="display:inline-block;margin-top:4px;font-size:9px;font-weight:700;background:rgba(255,255,255,0.12);border-radius:3px;padding:1px 4px;color:rgba(255,255,255,0.5);letter-spacing:0.3px;">E</span>` : ''}
          </div>
        </div>
        ${_noAINote}
        ${_discogsRateLimitNote}
        ${_metaGridHtml}
        ${_genreHtml}
        ${_providerPills}
      `;

      // Wire action bar buttons
      const _fbAllMA = (() => {
        let ma = this._getValidMASpeakers(true);
        if (!ma.length) ma = [...(this._maEntityIds||[])].filter(e => this._hass?.states[e]);
        return ma;
      })();
      const _fbTarget = (_fbAllMA.includes(this._lastMAPlayTarget) ? this._lastMAPlayTarget : null)
        || this._resolveMATargetEntity() || _fbAllMA[0] || this._entity;
      content.querySelectorAll('.ai-info-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const _act = btn.dataset.action;
          const _enq = _act === 'replace' ? 'replace' : _act === 'next' ? 'next' : 'add';
          if (_enq === 'replace') this._showLoadingToast('Starting playback\u2026');
          try {
            await this._hass.connection.sendMessagePromise({
              type: 'call_service', domain: 'music_assistant', service: 'play_media',
              service_data: { entity_id: _fbTarget,
                media_id: _fb.title + (_fb.artist ? ' ' + _fb.artist : ''),
                media_type: 'track', enqueue: _enq }
            });
            if (_act === 'replace') { this._closeInfoPopup(); this._closeMABrowser(true); }
          } catch(_) {
            // Music Assistant couldn't take it: play directly instead - and still return to the main screen on Play Now
            this._playMediaDirect(_fbTarget, _fb.title, 'music', _fb.title);
            if (_act === 'replace') { this._closeInfoPopup(); this._closeMABrowser(true); }
          }
        });
      });

      // Wire art lightbox
      const _fbArtImg = content.querySelector('.info-hero-art-img');
      if (_fbArtImg) {
        _fbArtImg.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._infoPopupOpenedAt && (Date.now() - this._infoPopupOpenedAt) < 500) return;
          this._showBioPhotoLightbox(_fbArtImg.src || artUrl, `${trackTitle}${artistName ? ' · ' + artistName : ''}`, content, 'square');
        });
      }

      // Wire pin button in the fallback panel — same logic as the full AI panel below
      const _fbPinBtn = r.getElementById('infoPinBtn');
      const _fbPinSvg = r.getElementById('infoPinSvg');
      const _fbTrackUri = context.queueUri
        || _qItem?.uri
        || this._hass?.states[this._entity]?.attributes?.media_content_id
        || '';
      if (_fbPinBtn && _fbPinSvg && _fbTrackUri) {
        const _fbPinItem = { uri: _fbTrackUri, name: trackTitle, artist: artistName, image: artUrl || '', media_type: 'track' };
        const _fbUpdatePin = () => {
          const _fbPinned = this._maLibIsStarred(_fbPinItem, 'track');
          _fbPinSvg.style.fill = _fbPinned ? '#FFD60A' : 'rgba(255,255,255,0.5)';
          _fbPinBtn.title = _fbPinned ? 'Unpin Song' : 'Pin Song';
        };
        _fbPinBtn.classList.remove('hidden'); this._heroPinWatch();
        _fbUpdatePin();
        _fbPinBtn.onclick = async () => {
          if (this._maLibIsStarred(_fbPinItem, 'track') && !(await this._confirmUnpin('song', this._pinItemName(_fbPinItem)))) return;
          const nowPinned = this._maLibToggleStar(_fbPinItem, 'track');
          if (nowPinned === null) return;
          _fbUpdatePin();
          this._showToast(nowPinned ? '📍 Song pinned' : 'Song unpinned');
          this._maLibRefreshPinnedUI('track');
          this._updatePinnedIndicator();
        };
      } else if (_fbPinBtn) {
        _fbPinBtn.classList.add('hidden');
        _fbPinBtn.onclick = null;
      }
      return;
      }
    }

    // Reflect the actual data source in the header — "AI Info" for an AI
    // answer, "Discogs Info" when Discogs filled in (AI found nothing).
    // Discogs & AI (Try First → Discogs with AI Extras): Discogs's facts with the AI's Ask, Meaning, Story and
    // Trivia, and similar tracks looked up after the panel shows (kept per song)
    const _sMix = !!(data._fromDiscogs && data._mixedAI && !_aiOff);
    const _sMixTok = _sMix ? (this._songMixTok = (this._songMixTok || 0) + 1) : 0;
    const _needSim = _sMix && !(data.similar || []).length;
    if (_needSim) {
      const _okSlot = el => el && el.dataset.k === String(_sMixTok);
      this._songMixExtras(artistName, trackTitle).then(x => {
        if (!x) return;
        const ok = _okSlot;
        const ss = content.querySelector('#mixSimSlot');
        const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        if (ok(ss) && (x.similar || []).length) {
          ss.innerHTML = `<div style="margin-top:14px;"><div style="font-size:10px;font-weight:700;color:${this._pt("dim")};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Similar Tracks</div>`
            + x.similar.map(t => `<div class="ai-sim-wrap" style="position:relative;overflow:hidden;border-radius:10px;margin-bottom:4px;"><div class="ai-sim-row mix-sim-row" data-title="${esc(t.title)}" data-artist="${esc(t.artist)}" style="display:flex;align-items:center;gap:10px;padding:9px 10px;background:${this._pt("bg")};cursor:pointer;">`
              + `<div class="mix-sim-art" style="width:36px;height:36px;border-radius:6px;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#63b3ed;opacity:0.7"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg></div>`
              + `<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}</div><div style="font-size:11px;color:${this._pt("dim")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.artist)}</div></div></div></div>`).join('')
            + `</div>`;
          ss.querySelectorAll('.mix-sim-row').forEach(row => {
            // tap: the song's info; hold: the song menu; swipe: Add to Queue / Play Next, Play / Info / More
            let lpTimer = null, lpFired = false;
            const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
            row.addEventListener('contextmenu', e => e.preventDefault());
            row.addEventListener('pointerdown', () => {
              lpFired = false;
              lpTimer = setTimeout(() => { cancelLP(); lpFired = true; this._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || ''); }, 480);
            }, { passive: true });
            ['pointerup', 'pointercancel', 'pointermove'].forEach(t => row.addEventListener(t, cancelLP, { passive: true }));
            row.addEventListener('click', () => {
              if (lpFired) { lpFired = false; return; }
              this._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true });
            });
            this._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ai-sim-wrap'));
            this._fetchItunesArtForTrack(row.dataset.artist, row.dataset.title).then(u => {
              const box = row.querySelector('.mix-sim-art');
              if (u && box && box.isConnected) box.innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`;
            }).catch(() => {});
          });
        }
      }).catch(() => {});
    }
    if (titleEl) titleEl.textContent = data._fromDiscogs ? 'Discogs Info' : 'AI Info';

    const metaRows = [
      data.album    && ['Album',   data.album],
      data.year     && ['Year',    data.year],
      data.label    && ['Label',   data.label],
      data.duration && ['Length',  data.duration],
      (data.genre && data.genre.length) && ['Genre', data.genre.join(', ')],
    ].filter(Boolean);

    const genreTags = (data.genre || []).map(g =>
      `<span class="info-tag bio-genre-tag" data-tag="${g.replace(/"/g,'&quot;')}">${g}</span>`
    ).join('');

    const artHtml = artUrl
      ? `<img src="${artUrl}" class="info-hero-art-img" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;" onerror="this.style.display='none'">`
      : `<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:${this._pt("dim")}"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>`;

    const similarHtml = (data.similar || []).length ? `
      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:700;color:${this._pt("dim")};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Similar Tracks</div>
        <div id="ai-track-similar-list">
          ${(data.similar || []).map((s, i) => `
            <div class="ai-sim-wrap" style="position:relative;overflow:hidden;border-radius:10px;margin-bottom:4px;">
              <div class="ai-sim-row" data-title="${(s.title||'').replace(/"/g,'&quot;')}" data-artist="${(s.artist||'').replace(/"/g,'&quot;')}" data-idx="${i}"
                style="display:flex;align-items:center;gap:10px;padding:9px 10px;background:${this._pt("bg")};cursor:pointer;will-change:transform;">
                <div class="ai-sim-art-ph" style="width:36px;height:36px;border-radius:6px;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#63b3ed;opacity:0.7"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.title||''}</div>
                  <div style="font-size:11px;color:${this._pt("dim")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.artist||''}</div>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : '';

    // Only populated when `data` came from the Discogs fallback lookup above —
    // AI-sourced data never has these fields, so this renders nothing for a
    // genuine AI result. Rows use the exact same card layout as the AI panel's
    // own "Similar Tracks" list (.ai-sim-wrap/.ai-sim-row) — art thumbnail,
    // bold title, dim subtitle, row glow — just reusing the album's own
    // artwork for every row since every track here is from the same release.
    // Compare against the track this panel is actually showing info for
    // (the trackTitle parameter) rather than re-reading live entity state —
    // playback may have already moved on by the time this renders, or the
    // entity's media_title could be formatted slightly differently than
    // Discogs' own tracklist title, either of which would silently break
    // the "which row is currently playing" match below.
    const currentTrackTitle = trackTitle || this._hass?.states[this._entity]?.attributes?.media_title || '';
    // Resolve to at most ONE row. The old per-row test was a bidirectional
    // substring match, so short titles ("Love" vs "Love Song") or titles that
    // normalised to '' (non-Latin, punctuation-only — ''.includes() is always
    // true) flagged several or ALL rows as current. Exact match wins; the
    // fuzzy fallback only applies when it's unambiguous.
    const _discogsCurrentIdx = (() => {
      const list = data._discogsTracklist || [];
      const norm = (s) => (s || '').toLowerCase()
        .replace(/\s*[\(\[][^\)\]]*(remaster|version|edit|mix|live|mono|stereo|demo)[^\)\]]*[\)\]]/g, '')
        .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/g, '')
        .replace(/[^\p{L}\p{N}]/gu, '');
      const cur = norm(currentTrackTitle);
      if (!cur) return -1;
      const exact = list.findIndex(t => norm(t.title) === cur);
      if (exact !== -1) return exact;
      const fuzzy = list
        .map((t, i) => ({ i, n: norm(t.title) }))
        .filter(x => x.n.length >= 3 && (cur.includes(x.n) || x.n.includes(cur)));
      return fuzzy.length === 1 ? fuzzy[0].i : -1;
    })();
    const discogsTracklistHtml = (data._discogsTracklist || []).length ? `
      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:700;color:${this._pt("dim")};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Tracklist <span${data._discogsUrl ? ` class="crow-ext-link" role="button" data-site="discogs" data-url="${String(data._discogsUrl).replace(/"/g, '&quot;')}" data-name="${String(data.album || trackTitle || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''} style="font-size:9px;color:rgba(99,179,237,0.8);font-weight:400;letter-spacing:0.3px;${data._discogsUrl ? 'padding:6px 8px;margin:-6px -8px;border-radius:8px;' : ''}">• Discogs</span></div>
        ${data._discogsRating ? `<div${data._discogsUrl ? ` class="crow-ext-link" role="button" data-site="discogs" data-url="${String(data._discogsUrl).replace(/"/g, '&quot;')}" data-name="${String(data.album || data._discogsTitle || trackTitle || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''} style="display:flex;align-items:center;gap:4px;margin-bottom:8px;flex-wrap:wrap;width:fit-content;">
          ${Array.from({ length: 5 }, (_, i) => {
            const fill = Math.min(1, Math.max(0, data._discogsRating.average - i));
            const pct  = Math.round(fill * 100);
            const id   = `discogs-rt-${i}-${Math.random().toString(36).slice(2,6)}`;
            return `<svg viewBox="0 0 24 24" width="12" height="12" style="flex-shrink:0;">
              <defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">
                <stop offset="${pct}%" stop-color="#FFD60A"/>
                <stop offset="${pct}%" stop-color="rgba(255,255,255,0.18)"/>
              </linearGradient></defs>
              <path fill="url(#${id})" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/>
            </svg>`;
          }).join('')}
          <span style="font-size:11px;color:${this._pt('text')};font-weight:600;">${data._discogsRating.average.toFixed(2)}</span>
          ${data._discogsRating.count ? `<span style="font-size:10px;color:${this._pt('dim')};">(${data._discogsRating.count.toLocaleString()})</span>` : ''}
        </div>` : ''}
        <div id="discogs-track-list">
          ${data._discogsTracklist.map((t, i) => {
            const isPlaying = i === _discogsCurrentIdx;
            const artInner = artUrl
              ? `<img src="${artUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none'">`
              : `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#63b3ed;opacity:0.7"><path d="M12,3V13.55C11.41,13.21 10.73,13 10,13C7.79,13 6,14.79 6,17C6,19.21 7.79,21 10,21C12.21,21 14,19.21 14,17V7H18V3H12Z"/></svg>`;
            return `<div class="discogs-track-wrap" style="position:relative;overflow:hidden;border-radius:10px;margin-bottom:4px;">
              <div class="discogs-track-row" data-idx="${i}" data-track-title="${(t.title || '').replace(/"/g, '&quot;')}" data-track-artist="${(artistName || '').replace(/"/g, '&quot;')}" data-is-playing="${isPlaying ? '1' : ''}"
                style="display:flex;align-items:center;gap:10px;padding:9px 10px;background:${isPlaying ? 'rgba(99,179,237,0.12)' : this._pt("bg")};${isPlaying ? 'box-shadow:inset 3px 0 0 #63b3ed;' : ''}cursor:pointer;will-change:transform;">
                <div class="discogs-track-art" style="width:36px;height:36px;border-radius:6px;background:rgba(99,179,237,0.1);border:1px solid rgba(99,179,237,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">${artInner}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:${this._pt("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.title || ''}</div>
                  <div style="font-size:11px;color:${this._pt("dim")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${[t.position ? `Track ${t.position}` : '', t.duration].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // Make album name clickable to view tracks — but not if we already know
    // (from a previous prefetch) that this album has no tracklist data.
    // Discogs-sourced results are exempt: they already carry a confirmed
    // tracklist from Discogs itself, so a stale AI-side "empty" cache entry
    // (from some earlier, unrelated track by this artist) shouldn't hide it.
    const _albumKnownEmpty = !data._fromDiscogs && data.album && this._aiAlbumTracksCache?.get((data.album + '|' + artistName).toLowerCase())?.empty === true;
    const _showAlbumPill = !!data.album && !_albumKnownEmpty;
    const albumClickHtml = _showAlbumPill
      ? `<button id="ai-track-album-btn" data-album="${(data.album||'').replace(/"/g,'&quot;')}" data-artist="${(artistName||'').replace(/"/g,'&quot;')}" class="ip-link"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>${data.album}</span></button>`
      : '';

    const isMaForBar = this._maEntityIds?.has(this._entity) || (this._maEntityIds?.size > 0);
    const actionBarHtml = `
      <div id="ai-info-action-bar" class="ma-drill-actions" style="margin-bottom:14px;">
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="replace">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
          <span class="ma-drill-btn-label">Play Now</span>
        </button>
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="add">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg></div>
          <span class="ma-drill-btn-label">Add</span>
        </button>
        <button class="ma-drill-action-btn ai-info-action-btn" data-action="next">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg></div>
          <span class="ma-drill-btn-label">Play Next</span>
        </button>
        ${(isMaForBar && _showAlbumPill) ? `<button class="ma-drill-action-btn ai-info-action-btn" data-action="play_album" data-album="${(data.album||''). replace(/"/g,'&quot;')}" data-artist="${(artistName||''). replace(/"/g,'&quot;')}">
          <div class="ma-drill-btn-circle"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg></div>
          <span class="ma-drill-btn-label">Add Album</span>
        </button>` : ''}

      </div>`;

    r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
    content.innerHTML = `
      ${actionBarHtml}
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="width:64px;height:64px;border-radius:10px;overflow:hidden;flex-shrink:0;background:${this._pt("bg")};display:flex;align-items:center;justify-content:center;">${artHtml}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:${this._pt('text')};letter-spacing:-0.3px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${trackTitle}</div>
          <div class="ip-links" style="margin-top:5px;">
            <div id="ai-track-artist-name" class="ip-link" role="button" data-artist="${(artistName||''). replace(/"/g,'&quot;')}"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg><span>${artistName}</span></div>
            ${albumClickHtml}
          </div>
          ${metaRows.some(([l]) => l !== 'Album' && l !== 'Genre') ? `<div class="ip-tags" style="margin-top:5px;">${metaRows.filter(([l]) => l !== 'Album' && l !== 'Genre').map(([l,v]) => { const _yt = l === 'Year' && this._aiFeatureOn('info'); /* "This year in music" is AI-only — plain, non-tappable year when AI is off */ return _yt ? `<span id="music-year-box" class="ip-tag" role="button" data-year="${v}" style="color:var(--crow-info-link,#63b3ed);font-weight:600;">${v}</span>` : `<span>${v}</span>`; }).join('')}</div>` : ''}
          ${(data.genre && data.genre.length) ? `<div class="ip-tags" style="margin-top:2px;opacity:0.85;">${data.genre.map(g => `<span>${g}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div id="info-audio-quality"></div>
      ${(!_aiOff && (!data._fromDiscogs || _sMix) && this._aiFeatureOn('ask')) ? `
      <div id="music-action-row" style="display:flex;flex-wrap:wrap;justify-content:flex-start;gap:6px 20px;margin:0 0 12px;">
        <button id="music-ask-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M6,9H18V11H6V9M14,14H6V12H14V14M18,8H6V6H18V8Z"/></svg>
          Ask
        </button>
        <button id="music-meaning-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm1 14h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Meaning
        </button>
        <button id="music-story-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M21,5C19.89,4.65 18.67,4.5 17.5,4.5C15.55,4.5 13.45,4.9 12,6C10.55,4.9 8.45,4.5 6.5,4.5C4.55,4.5 2.45,4.9 1,6V20.65C1,20.9 1.25,21.15 1.5,21.15C1.6,21.15 1.65,21.1 1.75,21.1C3.1,20.45 5.05,20 6.5,20C8.45,20 10.55,20.4 12,21.5C13.35,20.65 15.8,20 17.5,20C19.15,20 20.85,20.3 22.25,21.05C22.35,21.1 22.4,21.1 22.5,21.1C22.75,21.1 23,20.85 23,20.6V6C22.4,5.55 21.75,5.25 21,5M21,18.5C19.9,18.15 18.7,18 17.5,18C15.8,18 13.35,18.65 12,19.5V8C13.35,7.15 15.8,6.5 17.5,6.5C18.7,6.5 19.9,6.65 21,7V18.5Z"/></svg>
          Story
        </button>
        <button id="music-trivia-btn" style="display:inline-flex;align-items:center;gap:6px;padding:4px 0;background:none;border:none;color:${this._pt("text")};font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:rgba(99,179,237,0.8);flex-shrink:0"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
          Trivia
        </button>
      </div>
      <div id="music-ask-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="music-meaning-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="music-story-panel" style="display:none;margin-bottom:12px;"></div>
      <div id="music-trivia-panel" style="display:none;margin-bottom:12px;"></div>
      ` : ''}
      ${(data.members && data.members.length >= 1) ? `
      <div style="margin-bottom:14px;">
        <div class="info-section-label">${data.members.length === 1 ? 'Artist' : 'Band Members'}</div>
        <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
          ${data.members.map(name => `
            <div class="info-cast-item" data-cast-name="${(name||'').replace(/"/g,'&quot;')}" style="display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;width:60px;-webkit-tap-highlight-color:transparent;">
              <div class="info-cast-photo" style="width:52px;height:52px;border-radius:50%;background:${this._pt("bg")};border:1px solid ${this._pt("border")};display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                <svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:${this._pt("dim")}"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>
              </div>
              <div style="font-size:10px;color:${this._pt("text")};text-align:center;line-height:1.2;word-break:break-word;width:100%;">${name}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
      ${similarHtml}${_needSim ? `<div id="mixSimSlot" data-k="${_sMixTok}"></div>` : ''}
      <div id="info-new-releases"></div>
      ${discogsTracklistHtml}
`;

    // Audio quality (song playing now) and the artist's new releases, filled in once they're known
    this._fillTrackInfoExtras(content, trackTitle, artistName, () => this._showAITrackInfo(trackTitle, artistName, context));

    // Wire genre tag clicks
    this._wireGenreTagClicks(content);

    // Discogs community rating → "Visit Discogs?" alert
    this._wireExtLinks(content);

    // Wire Discogs-sourced tracklist rows (only present when data._fromDiscogs) —
    // same card layout, row glow, and interactions as the AI panel's own
    // "Similar Tracks" list: tap opens AI Info for that specific track,
    // long-press opens the enqueue menu.
    if (this._config?.row_glow === true && artUrl) {
      content.querySelectorAll('.discogs-track-wrap').forEach(wrap => {
        this._applyRowGlow(artUrl, wrap, null);
      });
    }
    content.querySelectorAll('.discogs-track-row').forEach(row => {
      row.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });
      this._trackRowSwipe(row, () => [row.dataset.trackTitle, row.dataset.trackArtist || artistName, ''], row.closest('.discogs-track-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          const t = row.dataset.trackTitle, a = row.dataset.trackArtist;
          if (t) this._showTrackEnqueueMenu(row, t, a || artistName, '');
        }, 480);
      }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        if (row.dataset.isPlaying) {
          // This row IS the track this panel is about — its info is at the
          // top of the panel, so take the user there rather than toasting.
          try { content.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { content.scrollTop = 0; }
          return;
        }
        const t = row.dataset.trackTitle, a = row.dataset.trackArtist;
        if (t) this._showAITrackInfo(t, a || artistName, { fromSearch: true, overrideArt: artUrl || '', overrideAlbum: data.album || '' });
      });
    });

    // Wire art thumbnail tap → lightbox (square for music)
    const _artImg = content.querySelector('.info-hero-art-img');
    if (_artImg) {
      _artImg.style.pointerEvents = 'auto';
      _artImg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._infoPopupOpenedAt && (Date.now() - this._infoPopupOpenedAt) < 500) return;
        this._showBioPhotoLightbox(_artImg.src || artUrl, `${trackTitle}${artistName ? ' · ' + artistName : ''}`, content, 'square');
      });
    }

    // Wire action bar — identical path to long-press enqueue menu
    const _barAllMA = (() => {
      let ma = this._getValidMASpeakers(true);
      if (!ma.length) ma = [...(this._maEntityIds||[])].filter(e => this._hass?.states[e]);
      return ma;
    })();
    const _barTarget = (_barAllMA.includes(this._lastMAPlayTarget) ? this._lastMAPlayTarget : null)
      || this._resolveMATargetEntity()
      || _barAllMA[0]
      || this._entity;

    content.querySelectorAll('.ai-info-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'mood') {
          this._showAIMoodQueueInPanel(content, popup);
          return;
        }
        if (action === 'play_album') {
          const _alb = btn.dataset.album;
          const _art = btn.dataset.artist;
          if (_alb) {
            const _isStreamNow = this._isLiveStream(this._hass?.states[this._entity]);
            const _albumMode = _isStreamNow ? 'replace' : 'add';
            this._playAlbum(_alb, _art, _albumMode);
          }
          return;
        }
        if (!_barAllMA.length) { this._showToast('Music Assistant required'); return; }

        // Play Now from queue context — never use 'replace' (clears queue).
        // Strategy: if MA has move_queue_item_next and we have a queueItemId, use it
        // (moves item to next slot then skips). Otherwise enqueue as 'next' then skip.
        // Only applies when opened FROM the queue panel (has queueItemId) — NOT when
        // opened from the library (has queueUri but no queueItemId), where Play Now
        // should just play directly via search like the other buttons.
        if (action === 'replace' && context.queueItemId) {
          const _target = context.queueEntity || this._entity;
          // Music Assistant can play it right where it is in the queue, without moving it
          if (await this._maPlayQueueItem?.(_target, context.queueItemId)) { this._queuePanelDirection = null; this._closeInfoPopup(); return; }
          const _hasMoveNext = !!(this._hass?.services?.mass_queue?.move_queue_item_next);
          try {
            if (_hasMoveNext && context.queueItemId) {
              // Best path: move the existing queue item to play next, then skip to it
              await this._call('mass_queue', 'move_queue_item_next', {
                entity: _target, queue_item_id: context.queueItemId
              });
            } else {
              // No move service — search by title+artist and insert as next then skip
              await this._hass.connection.sendMessagePromise({
                type: 'call_service', domain: 'music_assistant', service: 'play_media',
                service_data: { entity_id: _target, media_id: trackTitle + ' ' + artistName, media_type: 'track', enqueue: 'next' }
              });
            }
          } catch(e) { this._showToast('Could not play track'); return; }
          // Small delay before skipping so MA has time to move the item
          await new Promise(r => setTimeout(r, 300));
          try {
            await this._call('media_player', 'media_next_track', { entity_id: _target });
          } catch(_) {}
          this._queuePanelDirection = null;
          this._closeInfoPopup();
          return;
        }

        this._lastMAPlayTarget = _barTarget;
        const _played = await this._playTrackViaMAToast(trackTitle, artistName, _barTarget, action);
        if (action === 'replace' && _played) { this._closeInfoPopup(); this._closeMABrowser(true); }
      });
    });

    // Wire share button
    // Show header share button — always show on iOS, uses native share sheet
    const _hs = r.getElementById('infoShareBtn');
    if (_hs) {
      _hs.classList.remove('hidden');
      const _self = this;
      _hs.onclick = () => _self._showInfoShareMenu(_hs, () => {
        const _alb = (data.album && data.album.toLowerCase() !== trackTitle.toLowerCase()) ? ' - ' + data.album : '';
        const _shareText = trackTitle + ' by ' + artistName + _alb;
        const _shareUrl = this._buildShareUrl(trackTitle, artistName);
        _self._copyToClipboard(_shareText + '\n' + _shareUrl, this._shareServiceLabel());
      }, {
        lyrics: { artist: artistName, title: trackTitle, album: data.album || '' },
        extraItems: [{
          label: 'CD Case Printables (PDF)', pdf: 'cd',
          icon: 'M12,2A10,10 0 1,1 12,22A10,10 0 1,1 12,2Z M12,7.5A4.5,4.5 0 1,0 12,16.5A4.5,4.5 0 1,0 12,7.5Z M12,10.8A1.2,1.2 0 1,1 12,13.2A1.2,1.2 0 1,1 12,10.8Z',
          onClick: () => {
            // The album for this panel (AI or Discogs), else the live one when
            // this is the track that's playing. Without one, the track itself
            // is looked up.
            let _cdAlbum = String(context.overrideAlbum || data.album || '').trim();
            if (!_cdAlbum && !(context.fromSearch || context.overrideArt)) {
              const _n = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
              const _at = _self._hass?.states[_self._entity]?.attributes || {};
              if (_n(_at.media_title) === _n(trackTitle) && _n(_at.media_album_name) !== _n(trackTitle)) _cdAlbum = String(_at.media_album_name || '').trim();
            }
            _self._exportCdPrintables({ artist: artistName, title: trackTitle, album: _cdAlbum });
          },
        }],
      });
    }

    // Watch on YouTube (an item in the panel's 3-dot menu)
    const _yt = r.getElementById('infoYoutubeBtn');
    if (_yt) {
      if (this._config?.show_youtube_button === false) {
        _yt.classList.add('hidden');
        _yt.onclick = null;
      } else {
        _yt.title = 'Watch on YouTube';
        _yt.classList.remove('hidden');
        _yt.onclick = () => {
          window.open(this._buildYoutubeUrl(`${trackTitle} ${artistName}`), '_blank');
        };
      }
    }

    // Wire pin button — builds a minimal track item from whatever URI we have:
    // context.queueUri (library row long-press) → entity's media_content_id
    // (artwork tap) → a synthetic title+artist key as a last resort, so pinning
    // still works on non-MA speakers, which often don't populate
    // media_content_id at all. Playing a pinned track back later already goes
    // through a fuzzy title+artist search regardless of URI (see
    // _playTrackViaMAToast), so this synthetic key doesn't lose anything —
    // it's only ever used as a stable identity key for the pin list itself.
    const _trackUri = context.queueUri
      || this._hass?.states[this._entity]?.attributes?.media_content_id
      || ((trackTitle || artistName) ? ('title-artist://' + (trackTitle || '').toLowerCase().trim() + '|' + (artistName || '').toLowerCase().trim()) : '');
    const _pinItem = {
      uri:          _trackUri,
      name:         trackTitle,
      artist:       artistName,
      // _maLibRenderStarredSection's subtitle reads item.artists (an array,
      // matching MA's own library item shape) — not the singular 'artist'
      // field above, so without this the artist silently never displayed.
      artists:      artistName ? [{ name: artistName }] : [],
      image:        specificArt || '',
      media_type:   'track',
    };
    this._wireInfoPinButton(_trackUri ? _pinItem : null, 'track', 'Song');

    // Hide AI Mood button if it causes overflow (not enough room)
    requestAnimationFrame(() => {
      const bar = content.querySelector('#ai-info-action-bar');
    });

    // Album name click → open the album view. For Discogs-sourced results
    // the AI wouldn't recognize the album any better than it recognized the
    // track, so the album view is filled from the Discogs release we already
    // have (tracklist, year, label, genres) instead of an AI lookup.
    const albumLink = content.querySelector('#ai-track-album-btn');
    if (albumLink) {
      albumLink.addEventListener('click', () => {
        const albumName   = albumLink.dataset.album;
        const albumArtist = albumLink.dataset.artist;
        const _albumPrefill = (data._fromDiscogs && Array.isArray(data._discogsTracklist) && data._discogsTracklist.length)
          ? {
              tracks: data._discogsTracklist.map((t, i) => ({ title: t.title, position: t.position || String(i + 1) })),
              meta: { year: data.year || null, label: data.label || null, genre: data.genre || [] },
            }
          : null;
        // Record that user explicitly tapped this album pill so future prefetches are allowed
        if (!this._albumPillTapped) this._albumPillTapped = new Set();
        this._albumPillTapped.add((albumName + '|' + albumArtist).toLowerCase());
        // Park the current panel's actual nodes (not a copy of its HTML) so
        // Back puts them back with every click handler still attached —
        // Discogs tracklist rows, the album pill, Ask/Trivia and so on.
        const _savedNodes  = document.createDocumentFragment();
        while (content.firstChild) _savedNodes.appendChild(content.firstChild);
        const _savedScroll = content.scrollTop;
        const _savedTitle  = titleEl?.textContent || 'Info';
        if (titleEl) titleEl.textContent = 'Album';
        this._showAIAlbumTracks(content, albumName, albumArtist, artUrl, () => {
          // Back callback — restore the track panel exactly as it was
          r?.getElementById('queueBuildingOverlay')?.style.setProperty('display', 'none');
          content.innerHTML = '';
          content.appendChild(_savedNodes);
          content.scrollTop = _savedScroll;
          if (titleEl) titleEl.textContent = _savedTitle;
          this._wireInfoPinButton(_trackUri ? _pinItem : null, 'track', 'Song');
        }, _albumPrefill);
      });
    }

    // Prefetch album tracks in background as soon as the panel renders — if it
    // comes back empty, remove the pill/button so a dead-end tap isn't left showing.
    // Skipped for Discogs-sourced data: we already have a confirmed tracklist
    // straight from Discogs, and re-verifying via AI would almost always
    // "fail" here — the whole reason Discogs was consulted is that AI didn't
    // recognize this artist/track in the first place, so it won't recognize
    // the album either, and would silently rip out a perfectly valid button.
    if (_showAlbumPill && artistName && !data._fromDiscogs) {
      const _albumForPrefetch = data.album;
      setTimeout(() => {
        this._prefetchAIAlbumTracks(_albumForPrefetch, artistName).then(hasData => {
          if (hasData !== false || _stale()) return;
          content.querySelector('#ai-track-album-btn')?.remove();
          content.querySelector('.ai-info-action-btn[data-action="play_album"]')?.remove();
        });
      }, 500);
    }

    // Tap artist name → bio, long-press → artist radio
    const _artistNameEl = content.querySelector('#ai-track-artist-name');
    if (_artistNameEl && artistName) {
      let _artLpTimer = null, _artLpFired = false;
      _artistNameEl.addEventListener('pointerdown', () => {
        _artLpFired = false;
        _artLpTimer = setTimeout(() => { _artLpFired = true; this._playArtistRadio(artistName); }, 500);
      }, { passive: true });
      _artistNameEl.addEventListener('pointerup',     () => { clearTimeout(_artLpTimer); }, { passive: true });
      _artistNameEl.addEventListener('pointercancel', () => { clearTimeout(_artLpTimer); _artLpFired = false; }, { passive: true });
      _artistNameEl.addEventListener('pointermove',   () => { clearTimeout(_artLpTimer); }, { passive: true });
      _artistNameEl.addEventListener('click', () => {
        if (_artLpFired) { _artLpFired = false; return; }
        this._showCastBio(content, artistName, trackTitle, artUrl);
      });
    }

    // Wire band member clicks → bio panel, and fetch Wikipedia photos
    if (data.members && data.members.length >= 1) {
      const _self = this;
      content.querySelectorAll('.info-cast-item[data-cast-name]').forEach(item => {
        item.addEventListener('click', () => {
          _self._showCastBio(content, item.dataset.castName, artistName, artUrl);
        });
      });
      // Fetch Wikipedia photos for each member, staggered
      data.members.forEach((memberName, i) => {
        setTimeout(() => {
          // the same lookup as the artist's bio page, so the circle shows the same photo
          this._fetchMusicPersonThumb(memberName, 3, 1500).then(blobUrl => {
            if (!blobUrl) return;
            // Find the member's photo div by matching cast-name attribute
            const memberEl = content.querySelector(`.info-cast-item[data-cast-name="${memberName.replace(/"/g, '\\"')}"] .info-cast-photo`);
            if (!memberEl) return;
            const img = document.createElement('img');
            img.alt = memberName;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
            img.addEventListener('error', () => {
              URL.revokeObjectURL(blobUrl);
              if (this._wikiBlobCache?.get(memberName) === blobUrl) this._wikiBlobCache.delete(memberName);
              memberEl.innerHTML = `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:${this._pt('dim')}"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>`;
            });
            memberEl.innerHTML = '';
            memberEl.appendChild(img);
            img.src = blobUrl;
          });
        }, i * 700);
      });
    }

    // Fetch iTunes art for similar tracks — staggered to avoid rate limiting,
    // with retry on failure so later tracks aren't dropped when the first few
    // exhaust iTunes' burst limit.
    if (data.similar?.length) {
      const _applySimArt = (i, img) => {
        const row = content.querySelector(`.ai-sim-row[data-idx="${i}"]`);
        if (!row) return;
        row.dataset.art = img; // store for click-through
        const artEl = row.querySelector('.ai-sim-art-ph');
        if (!artEl) return;
        artEl.innerHTML = '';
        const _im = document.createElement('img');
        _im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        _im.addEventListener('error', () => { this._evictStaleWikiBlobBySrc(_im.src); _im.style.display = 'none'; });
        _im.src = img;
        artEl.appendChild(_im);
        artEl.style.border = 'none';
      };
      // Pre-fill rows immediately with the main panel art as a fallback —
      // iTunes will replace with track-specific art asynchronously.
      // If iTunes exhausts all retries, fall back to a Wikipedia artist photo (blob URL).
      const _fetchSimArtWithRetry = (s, i, retriesLeft, delayMs) => {
        // If already cached, apply immediately without the stagger delay
        const _simCacheKey = [s.artist || '', s.title || ''].filter(Boolean).join('|').toLowerCase();
        if (this._itunesArtCache?.[_simCacheKey]) { _applySimArt(i, this._itunesArtCache[_simCacheKey], true); return; }
        setTimeout(() => {
          this._fetchItunesArtForTrack(s.artist || '', s.title || '').then(img => {
            if (img) {
              _applySimArt(i, img, true);
            } else if (retriesLeft > 0) {
              _fetchSimArtWithRetry(s, i, retriesLeft - 1, Math.max(2000, delayMs * 2));
            } else if (s.artist) {
              // Only try Wikipedia if iTunes confirmed a miss (not just timed out)
              const _wikiSimKey = [s.artist, s.title || ''].filter(Boolean).join('|').toLowerCase();
              const _itunesResult = this._itunesArtCache?.[_wikiSimKey];
              if (_itunesResult === '') {
                // Confirmed iTunes miss — try Wikipedia
                this._fetchMusicPersonThumb(s.artist, 2, 1500).then(blobUrl => {
                  if (blobUrl) _applySimArt(i, blobUrl, true);
                });
              } else if (_itunesResult) {
                // iTunes actually has it now — apply directly
                _applySimArt(i, _itunesResult, true);
              }
            }
          });
        }, delayMs);
      };
      // Stagger initial requests by 700ms each to avoid iTunes burst rate-limiting
      data.similar.forEach((s, i) => _fetchSimArtWithRetry(s, i, 5, i * 700));

      // Background poller — keep retrying rows that still show a placeholder
      // after the initial fetch wave, in case of rate limiting or slow responses
      let _simPollCount = 0;
      const _simPollInterval = setInterval(() => {
        _simPollCount++;
        if (_simPollCount > 20) { clearInterval(_simPollInterval); return; } // max ~60s
        let allDone = true;
        data.similar.forEach((s, i) => {
          const artEl = content.querySelector(`.ai-sim-row[data-idx="${i}"] .ai-sim-art-ph`);
          if (!artEl) return;
          if (!artEl.dataset.final) {
            allDone = false;
            this._fetchItunesArtForTrack(s.artist || '', s.title || '').then(img => {
              if (img) {
                _applySimArt(i, img, true);
              } else if (s.artist && _simPollCount >= 3) {
                // Only try Wikipedia if iTunes has confirmed a miss for this key
                const _wpKey = [s.artist, s.title || ''].filter(Boolean).join('|').toLowerCase();
                if (this._itunesArtCache?.[_wpKey] === '') {
                  this._fetchMusicPersonThumb(s.artist, 2, 1500).then(blobUrl => {
                    if (blobUrl) _applySimArt(i, blobUrl, true);
                  });
                }
              }
            });
          }
        });
        if (allDone) clearInterval(_simPollInterval);
      }, 3000);
    }

    // Glass blur behind each similar row if enabled
    if (glassOn && artUrl) {
      content.querySelectorAll('.ai-sim-wrap').forEach(wrap => {
        if (this._applyRowGlow && this._config?.row_glow) this._applyRowGlow(artUrl, wrap, null);
      });
    }

    // Wire long-press and tap on similar rows
    const _simSelf = this;
    content.querySelectorAll('.ai-sim-row').forEach(row => {
      _simSelf._trackRowSwipe(row, () => [row.dataset.title, row.dataset.artist, row.dataset.uri], row.closest('.ai-sim-wrap'));
      let lpTimer = null, lpFired = false;
      const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
      row.addEventListener('pointerdown', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          cancelLP(); lpFired = true;
          _simSelf._showTrackEnqueueMenu(row, row.dataset.title, row.dataset.artist, '', row.dataset.uri || '');
        }, 480);
      }, { passive: true });
      row.addEventListener('pointerup',     () => cancelLP(), { passive: true });
      row.addEventListener('pointercancel', () => { cancelLP(); lpFired = false; }, { passive: true });
      row.addEventListener('pointermove',   () => cancelLP(), { passive: true });
      row.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        _simSelf._showAITrackInfo(row.dataset.title, row.dataset.artist, { fromSearch: true, overrideArt: row.dataset.art || '' });
      });
    });

    // Store for rewiring after back navigation
    content.dataset.musicTrackTitle = trackTitle  || '';
    content.dataset.musicArtistName = artistName  || '';
    content.dataset.musicTrackYear  = data.year   || '';
    // Wire new music AI features
    this._wireMusicActionRow(content, trackTitle, artistName, data);
    this._loadDayInMusicContext(content, trackTitle, artistName, data.year || null);
  }
});

K.ready.panels = true;
})();
