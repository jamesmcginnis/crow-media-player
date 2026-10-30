/*
 * Crow Media Player — PDF exports
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.pdf) return;
const { crowFetch } = K.kit;


Object.assign(K.Card.prototype, {
  // ── Lyrics for the Export menu ───────────────────────────────────────────
  // Uses the lyrics already cached for the track (the playing track's are
  // usually prefetched); otherwise looks them up quietly on LRCLIB without
  // disturbing the lyrics panel's own prefetch. Resolves to the cache entry
  // ({ type: 'synced' | 'plain' | 'none' }) or null if it couldn't check.
  // A song's lyrics over the Info panel (from Look Up Lyrics in its share menu), for any song,
  // playing or not. The ✕ closes it and returns to the Info panel.
  async _showLyricsSheet(song) {
    const host = this.shadowRoot?.getElementById('infoPopup');
    if (!host || !song?.artist || !song?.title) return;
    host.querySelector('#lyrSheet')?.remove();
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const sheet = document.createElement('div');
    sheet.id = 'lyrSheet';
    sheet.style.cssText = 'position:absolute;inset:0;z-index:60;background:var(--crow-panel-bg,#13131a);display:flex;flex-direction:column;opacity:0;transition:opacity 0.16s ease;';
    sheet.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:14px 14px 8px;flex-shrink:0;">
        <div style="flex:1;min-width:0;text-align:center;font-size:16px;font-weight:700;color:${this._pt('text')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:44px;">Lyrics</div>
        <button id="lyrSheetClose" aria-label="Close" style="width:34px;height:34px;border-radius:50%;border:none;background:${this._pt('btnBg')};display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;"><svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:${this._pt('text')};"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></button>
      </div>
      <div id="lyrSheetBody" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 20px 28px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:${this._pt('text')};line-height:1.3;">${esc(song.title)}</div>
        <div style="font-size:14px;color:${this._pt('dim')};margin-top:3px;">${esc(song.artist)}</div>
        <div id="lyrSheetText" style="margin-top:28px;display:flex;flex-direction:column;align-items:center;gap:10px;font-size:12px;color:${this._pt('dim')};"><div style="width:28px;height:28px;border:2.5px solid rgba(99,179,237,0.25);border-top-color:#63b3ed;border-radius:50%;animation:ma-spin 0.8s linear infinite;"></div>Finding lyrics…</div>
      </div>`;
    host.appendChild(sheet);
    requestAnimationFrame(() => { sheet.style.opacity = '1'; });
    const close = () => { sheet.style.opacity = '0'; setTimeout(() => sheet.remove(), 170); };
    sheet.querySelector('#lyrSheetClose').addEventListener('click', close);
    let entry = null;
    try { entry = await this._lyricsLookupForExport(song.artist, song.title, song.album || ''); } catch (_) { entry = null; }
    const box = sheet.querySelector('#lyrSheetText');
    if (!box || !sheet.isConnected) return;
    let lines = [];
    if (entry?.type === 'synced') lines = entry.lines.map(l => l.text);
    else if (entry?.type === 'plain') lines = String(entry.text).split(/\r?\n/);
    if (!lines.length) { box.textContent = entry ? 'No lyrics found for this song.' : 'Lyrics couldn’t be reached just now.'; return; }
    // a blank line between verses, as in the lyrics themselves
    box.style.cssText = 'margin-top:18px;font-size:16px;line-height:1.55;color:' + this._pt('text') + ';white-space:normal;';
    box.innerHTML = lines.map(l => l.trim() ? '<div>' + esc(l.trim()) + '</div>' : '<div style="height:14px;"></div>').join('');
  },

  async _lyricsLookupForExport(artist, title, album) {
    const cached = this._lyricsCachedEntry(artist, title);
    if (cached) return cached;
    const key = (artist + '|' + title).toLowerCase();
    try {
      const cleanTitle = title.replace(/\s+by\s+.+$/i, '').trim() || title;
      const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
      if (album) params.set('album_name', album);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      let data = await this._maLyricsData?.(artist, title) || null;   // Music Assistant's own copy first
      if (!data) try {
        const res = await crowFetch('https://lrclib.net/api/get?' + params.toString(),
          { signal: ctrl.signal, headers: { 'Lrclib-Client': 'crow-media-player/1.0 (home-assistant)' } });
        if (res.ok) data = await res.json();
        else if (res.status === 404) data = await this._searchLyricsFallback(cleanTitle, artist, ctrl.signal).catch(() => null);
      } finally { clearTimeout(t); }
      let entry = { type: 'none' };
      if (data && !data.instrumental) {
        const lines = data.syncedLyrics ? this._parseLrc(data.syncedLyrics) : [];
        if (lines.length) entry = { type: 'synced', lines };
        else if (data.plainLyrics && data.plainLyrics.trim()) entry = { type: 'plain', text: data.plainLyrics };
      }
      this._lyricsCache.set(key, entry);
      if (entry.type !== 'none' && this._lyricsLocalSet) this._lyricsLocalSet(key, entry);
      return entry;
    } catch (_) { return null; }
  },

  // Export Lyrics to PDF: the artwork with the title and artist beside it,
  // then the lyrics in a single column, running onto further pages as needed.
  async _exportLyricsPDF(args) {
    if (!this._pdfOn('lyrics')) return;   // switched off in the card editor
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    try { if (this._pdfFromSession('lyrics|' + JSON.stringify(args || {}), preview)) return; await this._buildLyricsPDF(args, preview); }
    catch (e) { console.warn('[Crow Media Player] lyrics PDF failed', e); preview.fail('Couldn\u2019t create the PDF. Please try again.'); }
    finally { this._pdfBusy = false; }
  },

  async _buildLyricsPDF({ artist, title, album }, preview) {
    const entry = this._lyricsCachedEntry(artist, title) || await this._lyricsLookupForExport(artist, title, album);
    if (!entry || entry.type === 'none') { preview.fail({ title: 'No Lyrics Found', message: 'There aren\u2019t any lyrics for this song yet, so there\u2019s nothing to put in the PDF.' }); return; }
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }

    // Lyric lines — synced lyrics repeat a line at each timestamp it's sung,
    // in time order, which is exactly the order to print them.
    let lines = entry.type === 'synced'
      ? entry.lines.map(l => String(l.text || '').trim())
      : String(entry.text || '').split('\n').map(l => l.trim());
    // Collapse runs of blank lines into a single stanza break
    lines = lines.reduce((out, l) => { if (l || (out.length && out[out.length - 1])) out.push(l); return out; }, []);
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (!lines.some(Boolean)) { preview.fail({ title: 'No Lyrics Found', message: 'There aren\u2019t any lyrics for this song yet, so there\u2019s nothing to put in the PDF.' }); return; }

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2;
    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    const clean = s => String(s || '')
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
      .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/[ \t]+/g, ' ').trim();

    // Masthead: the song title, then the band in the accent colour, in the
    // place the info PDF has "Crow Media Player  AI Info". Long names wrap.
    let y = 44;
    {
      const songT = clean(title), bandT = clean(artist);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      const oneLine = doc.getTextWidth(songT + '  ' + bandT) <= contentW;
      if (oneLine) {
        doc.setTextColor(...inkRgb); doc.text(songT, marginX, y);
        doc.setTextColor(...accentRgb); doc.text('  ' + bandT, marginX + doc.getTextWidth(songT), y);
      } else {
        doc.setTextColor(...inkRgb);
        doc.splitTextToSize(songT, contentW).forEach((l, k, arr) => { doc.text(l, marginX, y); if (k < arr.length - 1) y += 22; });
        y += 22;
        doc.setTextColor(...accentRgb);
        doc.splitTextToSize(bandT, contentW).forEach((l, k, arr) => { doc.text(l, marginX, y); if (k < arr.length - 1) y += 22; });
      }
    }
    y += 7;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;   // artwork and grey rows start just below the accent line

    // Header — the same layout as Export Info to PDF: the artwork, with the
    // title, artist and the grey Year / Label / Length / Genre rows beside
    // it, all taken from the info panel that's open for this track.
    const infoBlocks = this._collectInfoPanelBlocks(this.shadowRoot?.getElementById('infoContent') || document.createElement('div'));
    const heroSrc = infoBlocks.find(b => b.type === 'img' && b.w >= 60)?.src;
    const infoTexts = infoBlocks.filter(b => b.type === 'text');
    const isLbl = b => b.upper && b.size <= 12;
    const kv = [];
    let artistLine = '';
    {
      const tIdx = infoTexts.findIndex(b => b.size >= 15 && b.bold);
      for (let k = tIdx + 1; tIdx !== -1 && k < infoTexts.length; k++) {
        const b = infoTexts[k], nx = infoTexts[k + 1];
        if (isLbl(b)) {
          const v = nx ? clean(nx.text) : '';
          const same = nx && !isLbl(nx) && b.el.parentElement && b.el.parentElement.contains(nx.el);
          if (!same || !v || v.length > 60 || nx.url) break;   // first section heading ends the header
          kv.push([clean(b.text).toUpperCase(), v]);
          k++;
          continue;
        }
        if (b.size >= 15 && b.bold) break;
        if (!artistLine && !kv.length && clean(b.text).length <= 80) artistLine = clean(b.text);
      }
    }
    // The artwork is sized to the height of the grey rows beside it, so the
    // top of the first row and the bottom of the last line up with it.
    const rows = kv.length ? kv : (album ? [['ALBUM', clean(album)]] : []);
    const zebraRgb = [244, 244, 247];
    const rowGap = 3;
    if (heroSrc) preview?.status?.('Fetching artwork\u2026');
    const img = heroSrc ? await this._pdfImageData(heroSrc) : null;
    preview?.status?.('Building pages\u2026');
    const artGap = 16;
    const measure = (cw, lw) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      return rows.map(([lab, val]) => {
        const valLines = doc.splitTextToSize(val, cw - lw - 8);
        return { lab, valLines, boxH: Math.max(20, valLines.length * 13 + 7) };
      });
    };
    let colX = marginX, colW = contentW, artBottom = y, labelW = 112;
    let laid = measure(colW, labelW);
    if (img) {
      // First guess at the column width, then size the artwork to the rows
      const guess = 92;
      labelW = 64;
      laid = measure(contentW - guess - artGap, labelW);
      const rowsH = laid.reduce((h, r) => h + r.boxH, 0) + rowGap * Math.max(0, laid.length - 1);
      const side = Math.max(64, Math.min(110, rowsH || 80));
      const h = Math.min(side, side * (img.h / img.w)), w = h * (img.w / img.h);
      try {
        doc.addImage(img.data, 'JPEG', marginX, y, w, h);
        colX = marginX + w + artGap; colW = contentW - w - artGap; artBottom = y + h;
        laid = measure(colW, labelW);
      } catch (_) { colX = marginX; colW = contentW; labelW = 112; laid = measure(colW, labelW); }
    }
    let ty = y + 13;   // first row's baseline, its box level with the artwork's top
    const centred = !img || colX === marginX;   // no artwork beside the rows: centre them, like the lyrics below
    laid.forEach(({ lab, valLines, boxH }) => {
      doc.setFillColor(...zebraRgb);
      const boxTop = ty - 13;
      doc.roundedRect(colX, boxTop, colW, boxH, 3, 3, 'F');
      // text sits in the vertical middle of its box (10.5 pt caps are about 7.5 pt tall)
      const base = boxTop + (boxH - (valLines.length - 1) * 13) / 2 + 3.7;
      if (centred) {
        // label and value as one group, centred across the box
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        const lw = doc.getTextWidth(lab), gap = 12;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
        const vw = Math.max(...valLines.map(l => doc.getTextWidth(l)));
        const x0 = colX + (colW - (lw + gap + vw)) / 2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
        doc.text(lab, x0, base - 0.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
        valLines.forEach((ln, k) => doc.text(ln, x0 + lw + gap, base + k * 13));
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
        doc.text(lab, colX + 8, base - 0.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
        valLines.forEach((ln, k) => doc.text(ln, colX + labelW, base + k * 13));
      }
      ty += boxH + rowGap;
    });
    ty -= 13 + rowGap;   // bottom edge of the last row
    y = Math.max(ty, artBottom) + 26;   // first lyric baseline

    // Lyrics — centred, in a single column that runs onto further pages.
    const size = 10.5, lineH = 13.5, blankH = 7;
    const bottom = pageH - 40;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...inkRgb);
    lines.map(clean).forEach(l => {
      if (!l) { y += blankH; return; }
      doc.splitTextToSize(l, contentW).forEach(w => {
        if (y + lineH > bottom) {
          doc.addPage(); y = 40;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...inkRgb);
        }
        doc.text(w, pageW / 2, y, { align: 'center' }); y += lineH;
      });
    });

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    const slug = clean(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'lyrics';
    if (preview.closed) return;
    this._showPDFPreview(doc, 'crow-media-lyrics-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // ══ CD Case Printables ═══════════════════════════════════════════════════
  // Finds the front and back covers, booklet pages and disc artwork for the
  // album that's playing — matched through MusicBrainz, with the images taken
  // from the Cover Art Archive — and lays them out at real jewel-case sizes in
  // a PDF, ready to print at 100% and cut out. Anything that can't be found is
  // handled: a stand-in (title / tracklist) is printed in its place, and a last
  // "What was found" page says exactly what came from where.
  //
  //   Front cover / booklet pages   120 x 120 mm
  //   Back tray card                150 x 118 mm (fold lines 6 mm from each edge)
  //   Disc label                    118 mm with a 36 mm centre hole
  async _exportCdPrintables(args) {
    if (!this._pdfOn('cd')) return;   // switched off in the card editor
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    const orig = { artist: args?.artist || '', title: args?.title || '', album: args?.album || '' };
    // an album chosen with "Not this one?" for this song / album is used from then on
    let cur = Object.assign({}, orig, this._cdChoiceGet(orig) || {});
    let built = null;   // { rgId, album, artist } of the case on screen
    let running = null, rerun = false;
    const make = a => (running = (async () => {
      built = a.rgId ? { rgId: a.rgId, album: a.rgTitle || '', artist: a.rgArtist || '' } : null;
      if (this._pdfFromSession('cd|' + JSON.stringify(a), preview)) return;
      const b = await this._buildCdPrintables(a, preview);
      if (b) built = b;
    })());
    let picking = false;
    preview.offerMatch(async () => {
      // busy with this preview's own case is fine (it may be waiting on the No Cover Art alert); another export isn't
      if (preview.closed || picking || (this._pdfBusy && !running)) return;
      picking = true;
      const curRg = built?.rgId || cur.rgId || '';
      const m = await preview.pickMatch({
        title: 'Not This One?',
        message: 'Choose the right album.',
        query: String(built?.album || cur.rgTitle || orig.album || orig.title || '').replace(/\s+-\s+(Single|EP)\s*$/i, ''),
        placeholder: 'Search albums (or Artist - Album)',
        thumb: 'square',
        search: async q => {
          const res = await this._cdMatchSearch(q, orig.artist);
          return res && res.map(x => ({ value: x, label: x.title, sub: [x.artist, x.year, x.kind].filter(Boolean).join(' \u00B7 '), img: x.art, current: !!curRg && x.id === curRg }));
        },
      }).finally(() => { picking = false; });
      if (!m || preview.closed) return;
      rerun = true;
      preview.abandon();                                   // let a case still waiting on its alert finish
      try { await running; } catch (_) {}
      if (preview.closed) return;
      this._pdfBusy = true;
      preview.reset();
      try {
        const pick = { rgId: m.id, rgTitle: m.title, rgArtist: m.artist };
        this._cdChoiceSet(orig, pick);
        cur = Object.assign({}, orig, pick);
        await make(cur);
      }
      catch (e) { console.warn('[Crow Media Player] CD printables failed', e); preview.fail('Couldn\u2019t create the CD printables. Please try again.'); }
      finally { this._pdfBusy = false; }
    }, 'Choose a Different Album');
    try { await make(cur); }
    catch (e) { console.warn('[Crow Media Player] CD printables failed', e); preview.fail('Couldn\u2019t create the CD printables. Please try again.'); }
    finally { if (!rerun) this._pdfBusy = false; }
  },

  // Albums chosen with "Not this one?", remembered on this device by artist + album (or song)
  _cdChoiceKey(a) {
    const nf = v => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
    const artist = String(a?.artist || '').split(/\s*(?:[,;\/]|\s&\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\b)\s*/i)[0];
    const rest = nf(String(a?.album || '').replace(/\s+-\s+(Single|EP)\s*$/i, '')) || ('t:' + nf(a?.title));
    return rest === 't:' ? '' : nf(artist) + '|' + rest;
  },

  _cdChoiceStore() {
    if (!this._cdChoices) {
      let o = {};
      try { o = JSON.parse(localStorage.getItem('crow_media_cd_choice_v1') || '{}') || {}; } catch (_) { o = {}; }
      this._cdChoices = o;
    }
    return this._cdChoices;
  },

  _cdChoiceGet(a) {
    const k = this._cdChoiceKey(a);
    const v = k ? this._cdChoiceStore()[k] : null;
    return v?.rgId ? { rgId: v.rgId, rgTitle: v.rgTitle || '', rgArtist: v.rgArtist || '' } : null;
  },

  _cdChoiceSet(a, pick) {
    const k = this._cdChoiceKey(a);
    if (!k || !pick?.rgId) return;
    const s = this._cdChoiceStore();
    s[k] = { rgId: pick.rgId, rgTitle: pick.rgTitle || '', rgArtist: pick.rgArtist || '', t: Date.now() };
    Object.keys(s).sort((x, y) => (s[y].t || 0) - (s[x].t || 0)).slice(80).forEach(x => delete s[x]);
    try { localStorage.setItem('crow_media_cd_choice_v1', JSON.stringify(s)); } catch (_) {}
  },

  // Albums on MusicBrainz for the chooser (release groups, so each album is listed once), the playing
  // artist's first. "Artist - Album" searches for that artist. null if MusicBrainz couldn't be reached.
  async _cdMatchSearch(q, artistHint = '') {
    q = String(q || '').trim();
    if (!q) return [];
    let album = q;
    let artist = String(artistHint || '').split(/\s*(?:[,;\/]|\s&\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\b)\s*/i)[0].trim();
    const dash = q.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/);
    if (dash) { artist = dash[1].trim(); album = dash[2].trim(); }
    const esc = s => String(s).replace(/([+\-&|!(){}\[\]^"~*?:\\\/])/g, '\\$1');
    const queries = [];
    if (artist) queries.push('releasegroup:(' + esc(album) + ') AND artist:(' + esc(artist) + ')');
    queries.push('releasegroup:(' + esc(album) + ')');
    const seen = new Set(), out = [];
    let reached = false;
    for (const query of queries) {
      const res = await this._cdJson('https://musicbrainz.org/ws/2/release-group/?query=' + encodeURIComponent(query) + '&limit=15&fmt=json', { gap: 1100 });
      if (!res || res.notFound) continue;
      reached = true;
      (res['release-groups'] || []).forEach(g => {
        if (!g?.id || seen.has(g.id)) return;
        seen.add(g.id);
        const sec = g['secondary-types'] || [];
        out.push({
          id: g.id,
          title: g.title || '',
          artist: this._cdCreditName(g['artist-credit']),
          year: String(g['first-release-date'] || '').slice(0, 4),
          kind: sec.includes('Compilation') ? 'Compilation' : sec.includes('Soundtrack') ? 'Soundtrack' : sec.includes('Live') ? 'Live' : (g['primary-type'] || ''),
          art: 'https://coverartarchive.org/release-group/' + g.id + '/front-250',
        });
      });
    }
    return reached ? out.slice(0, 20) : null;
  },

  // JSON from MusicBrainz / the Cover Art Archive. Returns the parsed data,
  // { notFound: true } for a 404, or null if it couldn't be reached.
  // `gap` spaces MusicBrainz calls out (it asks for one request a second).
  // Album artwork from the iTunes Store (no key needed), 1200 px. Kept for the session.
  _cdItunesAlbumArt(artist, album) {
    return this._sessionMemo('italb', String(artist || '') + '|' + String(album || ''), async () => {
      const bare = s => String(s || '').replace(/\s+-\s+(Single|EP)\s*$/i, '').trim();
      const n = s => bare(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
      try {
        const r = await crowFetch('https://itunes.apple.com/search?term=' + encodeURIComponent((artist ? artist + ' ' : '') + bare(album)) + '&entity=album&limit=15');
        if (!r.ok) return null;
        const list = (await r.json()).results || [];
        const a = n(artist);
        const hit = list.find(x => n(x.collectionName) === n(album) && (!a || n(x.artistName).includes(a) || a.includes(n(x.artistName))))
          || list.find(x => n(x.collectionName) === n(album));
        return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\d+x\d+bb/, '1200x1200bb') : null;
      } catch (_) { return null; }
    });
  },

  async _cdJson(url, opts = {}) {
    return this._sessionMemo('mb', url, () => this._cdJsonFresh(url, opts));
  },

  async _cdJsonFresh(url, { timeout = 10000, retry = true, gap = 0 } = {}) {
    if (gap) {
      const wait = (this._cdMbAt || 0) + gap - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this._cdMbAt = Date.now();
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const resp = await crowFetch(url, { signal: ctrl.signal });
      if (resp.status === 404) return { notFound: true };
      if ((resp.status === 503 || resp.status === 429) && retry) {
        clearTimeout(t);
        await new Promise(r => setTimeout(r, 1800));
        return this._cdJsonFresh(url, { timeout, retry: false, gap });   // straight to the network, not via the cache (it is this call's own entry)
      }
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) { return null; } finally { clearTimeout(t); }
  },

  // Matches the album to a MusicBrainz release and finds which of its images
  // the Cover Art Archive has. Tries the album name, then the name without
  // "(Deluxe Edition)"-style tags, then the track itself. CDs and official
  // releases are preferred; up to six candidates are checked and the one with
  // the most artwork wins.
  async _cdFindRelease({ artist, title, album, rgId }, preview) {
    const nf = v => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
    const nc = v => nf(String(v || '').replace(/[(\[][^)\]]*[)\]]/g, ' '));
    const matchT = (a, b) => {
      const f1 = nf(a), f2 = nf(b);
      if (f1 && f1 === f2) return 3;
      const c1 = nc(a), c2 = nc(b);
      if (c1 && c1 === c2) return 2;
      if (c1 && c2 && Math.min(c1.length, c2.length) >= 4 && (c1.includes(c2) || c2.includes(c1))) return 1;
      return 0;
    };
    const primary = String(artist || '').split(/\s*(?:[,;\/]|\s&\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\b)\s*/i)[0].trim();
    const aN = nf(primary);
    const artistOk = r => !aN || nf((r['artist-credit'] || []).map(x => (x.name || '') + (x.artist?.name || '')).join('')).includes(aN);
    const key = rgId ? 'rg:' + rgId : aN + '|' + (nf(album) || 't:' + nf(title));
    if (!this._cdCache) this._cdCache = new Map();
    if (this._cdCache.has(key)) return this._cdCache.get(key);

    const lq = s => String(s).replace(/[\\"]/g, '\\$&');
    const mb = path => this._cdJson('https://musicbrainz.org/ws/2/' + path + (path.includes('?') ? '&' : '?') + 'fmt=json', { gap: 1100 });
    let cands = [], netFail = false;

    if (rgId) {
      // chosen with "Not this one?": every edition of that album
      if (preview.closed) return null;
      preview.status('Opening the album on MusicBrainz\u2026');
      const res = await mb('release?release-group=' + encodeURIComponent(rgId) + '&inc=artist-credits+media&limit=50');
      if (!res) netFail = true;
      else cands = (res.releases || []).map(r => ({ r: Object.assign({ 'release-group': { id: rgId } }, r), m: 3 }));
    }
    const albumQueries = [];
    if (album && !rgId) {
      albumQueries.push(album);
      const stripped = String(album).replace(/\s*[(\[][^)\]]*[)\]]\s*/g, ' ').trim();
      if (stripped && stripped !== album) albumQueries.push(stripped);
    }
    for (const aq of albumQueries) {
      if (preview.closed) return null;
      preview.status('Searching MusicBrainz\u2026');
      const q = 'release:"' + lq(aq) + '"' + (primary ? ' AND artist:"' + lq(primary) + '"' : '');
      const res = await mb('release/?query=' + encodeURIComponent(q) + '&limit=25');
      if (!res) { netFail = true; break; }
      cands = (res.releases || [])
        .map(r => ({ r, m: Math.max(matchT(r.title, album), matchT(r.title, aq)) }))
        .filter(x => x.m > 0 && artistOk(x.r));
      if (cands.length) break;
    }
    if (!cands.length && !netFail && title && !rgId) {
      if (preview.closed) return null;
      preview.status('Looking the track up on MusicBrainz\u2026');
      const q = 'recording:"' + lq(title) + '"' + (primary ? ' AND artist:"' + lq(primary) + '"' : '');
      const res = await mb('recording/?query=' + encodeURIComponent(q) + '&limit=10');
      if (!res) netFail = true;
      else {
        const seen = new Set();
        (res.recordings || []).filter(rc => matchT(rc.title, title) > 0).forEach(rc => (rc.releases || []).forEach(r => {
          if (seen.has(r.id)) return;
          seen.add(r.id);
          const rg = r['release-group'] || {};
          const plainAlbum = rg['primary-type'] === 'Album' && !(rg['secondary-types'] || []).length;
          cands.push({ r, m: plainAlbum ? 2 : 0.5 });
        }));
      }
    }
    const rank = ({ r, m }) => {
      const cd = (r.media || []).some(x => /\bcd\b|hdcd|cd-r/i.test(x.format || ''));
      return m * 100 + (r.status === 'Official' ? 20 : 0) + (cd ? 15 : 0) + Math.min(10, Math.round((r.score || 0) / 10));
    };
    cands.sort((a, b) => rank(b) - rank(a) || String(a.r.date || '9999').localeCompare(String(b.r.date || '9999')));
    cands = cands.slice(0, 6);

    let best = null;
    for (let i = 0; i < cands.length; i++) {
      if (preview.closed) return null;
      preview.progress('Checking the Cover Art Archive\u2026', i + 1, cands.length);
      const j = await this._cdJson('https://coverartarchive.org/release/' + cands[i].r.id);
      const imgs = (j && !j.notFound && Array.isArray(j.images)) ? j.images.filter(x => x.approved !== false) : [];
      if (!imgs.length) continue;
      const has = t => x => (x.types || []).includes(t);
      const front = imgs.find(x => x.front || has('Front')(x));
      const back = imgs.find(x => x.back || has('Back')(x)) || imgs.find(has('Tray'));
      const medium = imgs.find(has('Medium'));
      const booklets = imgs.filter(has('Booklet'));
      const score = (front ? 4 : 0) + (back ? 4 : 0) + (booklets.length ? 2 : 0) + (medium ? 1 : 0);
      if (score > 0 && (!best || score > best.score)) best = { score, release: cands[i].r, front, back, medium, booklets };
      if (front && back && booklets.length && medium) break;
    }
    // Nothing on any edition: the album's "release group" can still hold a front cover
    if (!best && cands.length) {
      const rgId = cands[0].r['release-group']?.id;
      const j = rgId ? await this._cdJson('https://coverartarchive.org/release-group/' + rgId) : null;
      const f = j && !j.notFound && Array.isArray(j.images) ? j.images.find(x => x.front) : null;
      if (f) best = { score: 1, release: cands[0].r, front: f, back: null, medium: null, booklets: [] };
    }
    const out = { best, found: cands.length, netFail };
    if (best || (!netFail && cands.length === 0)) this._cdCache.set(key, out);
    return out;
  },

  // Track titles for the stand-in back cover: [{ d, n, title }]
  async _cdTracklist(releaseId) {
    const j = releaseId ? await this._cdJson('https://musicbrainz.org/ws/2/release/' + releaseId + '?inc=recordings+artist-credits&fmt=json', { gap: 1100 }) : null;
    const media = j && !j.notFound ? (j.media || []) : [];
    const out = [];
    media.forEach((m, mi) => (m.tracks || []).forEach(t => out.push({ d: mi + 1, n: t.number || t.position, title: t.title || '', len: +t.length || +t.recording?.length || 0 })));
    return { tracks: out, discs: media.length, artist: this._cdCreditName(j?.['artist-credit']) };
  },

  // "Artist A & Artist B" from a MusicBrainz artist-credit list ('' when there isn't one)
  _cdCreditName(credit) {
    return (Array.isArray(credit) ? credit : []).map(x => (x?.name || x?.artist?.name || '') + (x?.joinphrase || '')).join('').trim();
  },

  // An image from the Cover Art Archive (or the artwork on screen). Direct
  // first; if the browser won't let the page read it, the public image proxy
  // the other PDF exports use.
  async _cdLoadBlob(url, max = 1600) {
    // artwork: kept for the session (images are big, so only the 60 most recent)
    return this._sessionMemo('img', url + '|' + max, () => this._cdLoadBlobFresh(url, max), { max: 60 });
  },

  async _cdLoadBlobFresh(url, max = 1600) {
    const get = async u => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await crowFetch(u, { signal: ctrl.signal });
        if (!r.ok) return null;
        const b = await r.blob();
        return b && b.size > 500 && (!b.type || /^image\//.test(b.type)) ? b : null;
      } catch (_) { return null; } finally { clearTimeout(t); }
    };
    let b = await get(url);
    const isLocal = /^(https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/]*\.local\b|[^/]*:8123)|data:|blob:)/i.test(url);
    if (!b && /^https?:\/\//i.test(url) && !isLocal) b = await get('https://images.weserv.nl/?url=' + encodeURIComponent(url) + '&w=' + max + '&output=jpg');
    return b;
  },

  // Draws an image into an exact print size (300 dpi) and returns it as a JPEG.
  // fit 'auto' fills the space when the shape is close to the target and
  // otherwise shrinks it to fit with white around it, so nothing important
  // gets cropped off. shape 'disc' cuts a circle with a centre hole;
  // part 'left' / 'right' takes one half of a two-page booklet spread.
  async _cdRender(src, wMm, hMm, { fit = 'auto', shape = 'rect', hole = 0, part = '', dpi = 300, bg = '#fff', focusY = 0.5, fade = false, banner = null } = {}) {
    const own = !(typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap);
    const bmp = own ? await createImageBitmap(src) : src;
    try {
      const pxW = Math.min(2400, Math.round(wMm / 25.4 * dpi)), pxH = Math.round(pxW * hMm / wMm);
      const c = document.createElement('canvas');
      c.width = pxW; c.height = pxH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, pxW, pxH);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const sx = part === 'right' ? bmp.width / 2 : 0;
      const sw = part ? bmp.width / 2 : bmp.width, sh = bmp.height;
      const mode = fit === 'auto' ? (Math.abs(Math.log((sw / sh) / (wMm / hMm))) < 0.2 ? 'cover' : 'contain') : fit;
      const s = mode === 'cover' ? Math.max(pxW / sw, pxH / sh) : Math.min(pxW / sw, pxH / sh);
      const dw = sw * s, dh = sh * s;
      const dx = (pxW - dw) / 2, dy = (pxH - dh) * (mode === 'cover' ? focusY : 0.5);
      ctx.save();
      if (shape === 'disc') {
        const R = pxW / 2, rh = hole / wMm * pxW / 2;
        ctx.beginPath();
        ctx.arc(R, R, R, 0, Math.PI * 2);
        if (rh) { ctx.moveTo(R + rh, R); ctx.arc(R, R, rh, 0, Math.PI * 2); }
        ctx.clip('evenodd');
      }
      ctx.drawImage(bmp, sx, 0, sw, sh, dx, dy, dw, dh);
      // A poster that doesn't fill the space melts into the background colour
      if (fade && mode === 'contain' && /^rgb\(/.test(bg)) {
        const clear = bg.replace('rgb(', 'rgba(').replace(')', ',0)');
        const edge = (x0, y0, x1, y1) => {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, bg); g.addColorStop(1, clear);
          ctx.fillStyle = g;
          ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || pxW, Math.abs(y1 - y0) || pxH);
        };
        if (dw < pxW - 2) { const f = Math.min(dw * 0.14, pxW * 0.1); edge(dx, 0, dx + f, 0); edge(dx + dw, 0, dx + dw - f, 0); }
        if (dh < pxH - 2) { const f = Math.min(dh * 0.14, pxH * 0.1); edge(0, dy, 0, dy + f); edge(0, dy + dh, 0, dy + dh - f); }
      }
      // Title across the lower half (below the centre hole on a disc)
      if (banner?.title) {
        const g = ctx.createLinearGradient(0, pxH * 0.5, 0, pxH);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = g; ctx.fillRect(0, pxH * 0.5, pxW, pxH * 0.5);
        const fs = pxW * 0.06, maxW = pxW * 0.58;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 ' + fs + 'px sans-serif';
        const lines = []; let cur = '';
        String(banner.title).split(/\s+/).forEach(w => {
          const t = cur ? cur + ' ' + w : w;
          if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
        });
        if (cur) lines.push(cur);
        const shown = lines.slice(0, 2);
        if (lines.length > 2) shown[1] = shown[1].replace(/\s*\S*$/, '') + '...';
        shown.forEach((l, i) => ctx.fillText(l, pxW / 2, pxH * 0.735 + i * fs * 1.15, maxW));
        if (banner.sub) {
          ctx.font = '500 ' + fs * 0.7 + 'px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.82)';
          ctx.fillText(String(banner.sub), pxW / 2, pxH * 0.735 + shown.length * fs * 1.15 + fs * 0.1, maxW);
        }
      }
      ctx.restore();
      const dpiEff = Math.round(sw / (dw / pxW * wMm) * 25.4);
      return { data: c.toDataURL('image/jpeg', 0.9), mode, aspect: bmp.width / bmp.height, srcW: bmp.width, srcH: bmp.height, dpi: dpiEff };
    } finally { if (own) { try { bmp.close(); } catch (_) {} } }
  },

  // a mark on a disc label: centred, near the bottom edge, on a soft dark pill so it shows on any artwork
  _pdfDiscMark(doc, cx, cy, radius, label, { onArt = true, rgb = [255, 255, 255], inset = 8.5 } = {}) {
    const r = 2.1, fs = 6.4;
    const w = this._pdfSpineMarkWidth(doc, label, r, fs);
    const y = cy + radius - inset, x = cx - w / 2;
    if (onArt) {
      try { doc.setGState(new doc.GState({ opacity: 0.42 })); } catch (_) {}
      doc.setFillColor(0, 0, 0); doc.roundedRect(x - 2.2, y - r - 1.4, w + 4.4, r * 2 + 2.8, r + 1.4, r + 1.4, 'F');
      try { doc.setGState(new doc.GState({ opacity: 1 })); } catch (_) {}
    }
    this._pdfFormatMark(doc, x, y, { r, lines: [label], rgb, fs });
  },

  _pdfSpineMarkWidth(doc, label, r, fs) { return this._pdfFormatMark(doc, 0, 0, { r, lines: [label], fs, measure: true }); },

  async _buildCdPrintables({ artist, title, album, rgId = '', rgTitle = '', rgArtist = '' }, preview) {
    artist = String(artist || '').trim(); title = String(title || '').trim(); album = String(album || '').trim();
    // a different album chosen with "Not this one?": its own name and artist from here on
    if (rgId) { album = rgTitle || album; if (rgArtist && !/^various(\s+artists?)?$/i.test(rgArtist)) artist = rgArtist; }
    if (!artist && !title) { preview.fail('There\u2019s no track to look up.'); return; }
    const pool = async (arr, n, fn) => {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => { while (i < arr.length) { const k = i++; await fn(arr[k], k); } }));
    };

    // 1 — find the album and its artwork list
    const found = await this._cdFindRelease({ artist, title, album, rgId }, preview);
    if (!found || preview.closed) return;
    if (found.netFail && !found.best) { preview.fail({ icon: 'offline', title: 'Can\u2019t Reach MusicBrainz', message: 'Check your internet connection, then try again.' }); return; }
    const best = found.best;
    const release = best?.release || null;
    const albumName = release?.title || album || title;
    // The album's own artist, not the playing song's: a compilation is credited to "Various Artists",
    // and then no single artist is printed on the cover (the song's artist is just one of many on it).
    let albumArtist = this._cdCreditName(release?.['artist-credit']);
    if (!albumArtist && release?.id) albumArtist = (await this._cdTracklist(release.id).catch(() => null))?.artist || '';
    const various = /^various(\s+artists?)?$/i.test(albumArtist) || albumArtist === '[unknown]';
    const coverArtist = various ? '' : (albumArtist || artist);

    // 2 — download the images
    const urlOf = im => String(im?.thumbnails?.['1200'] || im?.thumbnails?.large || im?.image || '').replace(/^http:\/\//i, 'https://');
    const MAXB = 24;
    const jobs = [];
    if (best?.front) jobs.push({ k: 'front', url: urlOf(best.front) });
    if (best?.back) jobs.push({ k: 'back', url: urlOf(best.back) });
    if (best?.medium) jobs.push({ k: 'medium', url: urlOf(best.medium) });
    (best?.booklets || []).slice(0, MAXB).forEach((im, i) => jobs.push({ k: 'bk' + i, url: urlOf(im) }));
    const blobs = {};
    let done = 0;
    if (jobs.length) preview.progress('Downloading artwork\u2026', 0, jobs.length);
    await pool(jobs, 3, async job => {
      blobs[job.k] = job.url ? await this._cdLoadBlob(job.url, 1600) : null;
      preview.progress('Downloading artwork\u2026', ++done, jobs.length);
    });
    if (preview.closed) return;
    let frontSrc = blobs.front ? 'Cover Art Archive' : '';
    if (!blobs.front && !rgId) {
      // No front cover from the archive: use the artwork already on screen (not for a chosen album - it shows the old one)
      const blocks = this._collectInfoPanelBlocks(this.shadowRoot?.getElementById('infoContent') || document.createElement('div'));
      const src = blocks.find(b => b.type === 'img' && b.w >= 60)?.src;
      if (src) { blobs.front = await this._cdLoadBlob(src, 1200); if (blobs.front) frontSrc = 'screen'; }
    }
    if (!blobs.front && albumName) {
      // Next: the album's artwork on the iTunes Store (no key needed, 1200 px)
      preview.status('Checking the iTunes Store for the cover\u2026');
      const it = await this._cdItunesAlbumArt(artist, albumName).catch(() => null);
      if (it) { blobs.front = await this._cdLoadBlob(it, 1200); if (blobs.front) frontSrc = 'itunes'; }
    }
    if (!blobs.front) {
      // Last: the artwork of what's playing, when it is this track
      const n = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const at = this._hass?.states[this._entity]?.attributes || {};
      const pic = (at.entity_picture_local || at.entity_picture || '').replace(/^http:\/\//i, 'https://');
      if (pic && !rgId && n(at.media_title) === n(title)) { blobs.front = await this._cdLoadBlob(pic, 1200); if (blobs.front) frontSrc = 'playing'; }
    }
    if (preview.closed) return;
    if (!Object.values(blobs).some(Boolean)) {
      // Nothing anywhere: say so kindly, and offer to carry on with plain title cards
      const niceAlbum = String(albumName || title).replace(/\s+-\s+(Single|EP)\s*$/i, '').trim();
      const mbUrl = release?.id ? 'https://musicbrainz.org/release/' + release.id + '/add-cover-art'
        : 'https://musicbrainz.org/search?type=release&query=' + encodeURIComponent(niceAlbum + ' ' + (artist || ''));
      const goOn = await new Promise(resolve => {
        preview.onClose(() => resolve(false));
        preview.onAbandon?.(() => resolve(false));   // a different album was chosen instead
        preview.fail({
          icon: 'art',
          title: 'No Cover Art Yet',
          message: 'We couldn\u2019t find the artwork for \u201C' + niceAlbum + '\u201D' + (artist ? ' by ' + artist : '') + '. '
            + 'You can still print the case with simple title cards, or add the cover to MusicBrainz so it\u2019s here next time.',
          actions: [
            { label: 'Make with Title Cards', primary: true, onClick: () => resolve(true) },
            { label: release?.id ? 'Add Cover on MusicBrainz' : 'Find It on MusicBrainz', href: mbUrl },
            { label: 'Not Now', onClick: () => { resolve(false); preview.close(); } },
          ],
        });
      });
      if (!goOn || preview.closed) return;
      preview.reset();
      preview.status('Making title cards\u2026');
    }

    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }

    // 3 — size everything for print
    preview.status('Sizing the artwork for print\u2026');
    const FW = 120, TW = 150, TH = 118, DD = 118, HOLE = 36;
    const safe = async fn => { try { return await fn(); } catch (e) { console.warn('[Crow Media Player] CD artwork skipped', e); return null; } };
    const rows = [];          // [label, status] for the last page
    const items = [];
    const fitNote = r => (r && r.mode === 'contain' ? ' (shrunk to fit - the scan isn\u2019t the usual shape)' : '');

    const frontImg = blobs.front ? await safe(() => this._cdRender(blobs.front, FW, FW)) : null;
    if (frontImg) {
      items.push({ kind: 'img', w: FW, h: FW, img: frontImg, cap: 'Front cover - 120 x 120 mm' });
      rows.push(['Front cover', frontSrc === 'screen'
        ? 'Not on the Cover Art Archive - used the artwork from the info panel (may be lower quality)' + fitNote(frontImg)
        : frontSrc === 'itunes' ? 'Not on the Cover Art Archive - used the album artwork from the iTunes Store' + fitNote(frontImg)
        : frontSrc === 'playing' ? 'Not on the Cover Art Archive - used the artwork of what\'s playing (may be lower quality)' + fitNote(frontImg)
        : 'Found' + fitNote(frontImg)]);
    } else {
      items.push({ kind: 'genFront', w: FW, h: FW, cap: 'Front cover - 120 x 120 mm (title card - no cover found)' });
      rows.push(['Front cover', 'Not found - printed a plain title card instead']);
    }

    let discImg = null, discHow = '';
    if (blobs.medium) { discImg = await safe(() => this._cdRender(blobs.medium, DD, DD, { shape: 'disc', hole: HOLE })); if (discImg) discHow = 'Found'; }
    if (!discImg && blobs.front) { discImg = await safe(() => this._cdRender(blobs.front, DD, DD, { shape: 'disc', hole: HOLE, fit: 'cover' })); if (discImg) discHow = 'No disc scan on the archive - made from the front cover'; }
    if (discImg) {
      items.push({ kind: 'img', disc: true, markOk: discHow !== 'Found', w: DD, h: DD, img: discImg, cap: 'Disc label - 118 mm, centre hole 36 mm' + (discHow === 'Found' ? '' : ' (made from the front cover)') });
      rows.push(['Disc', discHow]);
    } else {
      items.push({ kind: 'genDisc', disc: true, markOk: true, w: DD, h: DD, cap: 'Disc label - 118 mm, centre hole 36 mm (title only - no artwork found)' });
      rows.push(['Disc', 'Not found - printed a plain title label']);
    }

    const backImg = blobs.back ? await safe(() => this._cdRender(blobs.back, TW, TH)) : null;
    if (backImg) {
      items.push({ kind: 'img', tray: true, w: TW, h: TH, img: backImg, cap: 'Back tray card - 150 x 118 mm (fold at the two small ticks)' });
      rows.push(['Back cover', 'Found' + fitNote(backImg)]);
    } else {
      preview.status('Getting the tracklist\u2026');
      const tl = await safe(() => this._cdTracklist(release?.id)) || { tracks: [], discs: 0 };
      // a faint copy of the front cover, between the two spine folds (editor -> Export & PDF -> Cover on the Back)
      let wm = null;
      if (blobs.front && this._pdfOn('back_art')) wm = await safe(async () => {
        const bmp = await createImageBitmap(blobs.front);
        try {
          const dpi = 200, W = Math.round((TW - 12) / 25.4 * dpi), H = Math.round(TH / 25.4 * dpi);
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const ctx = c.getContext('2d');
          ctx.fillStyle = 'rgb(246,246,248)'; ctx.fillRect(0, 0, W, H);   // the stand-in's paper colour
          ctx.drawImage(this._cdFadedArt(bmp, W, H, { opacity: 0.08, mono: true }), 0, 0);
          return c.toDataURL('image/jpeg', 0.88);
        } finally { try { bmp.close(); } catch (_) {} }
      });
      items.push({ kind: 'genBack', tray: true, w: TW, h: TH, tl, wm, cap: 'Back tray card - 150 x 118 mm (fold at the two small ticks)' + (tl.tracks.length ? ' - tracklist from MusicBrainz' : ' - title only') });
      rows.push(['Back cover', 'Not found - printed a ' + (tl.tracks.length ? 'tracklist card from MusicBrainz' : 'title card') + ' instead' + (wm ? ' (with a faint copy of the front cover)' : '')]);
    }

    let pages = 0, bkSkipped = 0, bkSplit = 0;
    const bkTotal = Math.min(MAXB, best?.booklets?.length || 0);
    for (let i = 0; i < bkTotal; i++) {
      const b = blobs['bk' + i];
      const bmp = b ? await safe(() => createImageBitmap(b)) : null;
      if (!bmp) { bkSkipped++; continue; }
      const asp = bmp.width / bmp.height;
      const parts = asp >= 1.6 && asp <= 2.4 ? ['left', 'right'] : [''];   // a two-page spread becomes two pages
      if (parts.length === 2) bkSplit++;
      for (const part of parts) {
        const img = await safe(() => this._cdRender(bmp, FW, FW, { part }));
        if (img) { pages++; items.push({ kind: 'img', w: FW, h: FW, img, cap: 'Booklet page ' + pages + ' - 120 x 120 mm' }); }
        else bkSkipped++;
      }
      try { bmp.close(); } catch (_) {}
    }
    if (best?.booklets?.length) {
      rows.push(['Booklet', pages + ' page' + (pages === 1 ? '' : 's') + ' found' + (bkSplit ? ' (' + bkSplit + ' two-page spread' + (bkSplit === 1 ? '' : 's') + ' split into single pages)' : '')
        + (bkSkipped ? ', ' + bkSkipped + ' couldn\u2019t be downloaded' : '') + (best.booklets.length > MAXB ? ', first ' + MAXB + ' used' : '')]);
    } else rows.push(['Booklet', 'None on the Cover Art Archive for this album']);
    if (preview.closed) return;

    // 4 — lay it out
    preview.status('Building the PDF\u2026');
    const lang = String(navigator.languages?.[0] || navigator.language || '');
    const pref = String(this._config?.cd_paper_size || '').toLowerCase();
    const letter = pref ? pref === 'letter' : /-(US|CA|MX|PH)\b/i.test(lang);
    const doc = new JsPDFCtor({ unit: 'mm', format: letter ? 'letter' : 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], lineRgb = [150, 150, 150], paperRgb = [246, 246, 248];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    const clean = s => String(s || '')
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
      .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/[ \t]+/g, ' ').trim();
    const fit1 = (txt, maxW) => {   // one line that fits, with ... if cut
      let t = clean(txt);
      if (doc.getTextWidth(t) <= maxW) return t;
      while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
      return t.trimEnd() + '...';
    };
    const marks = (x, y, w, h) => {   // corner cut marks, just outside the artwork
      doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
      const g = 1.5, L = 4;
      [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]].forEach(([cx, cy, sx, sy]) => {
        doc.line(cx + sx * g, cy, cx + sx * (g + L), cy);
        doc.line(cx, cy + sy * g, cx, cy + sy * (g + L));
      });
    };
    const discGuides = (cx, cy) => {
      doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
      doc.circle(cx, cy, DD / 2 + 0.4, 'S');
      doc.circle(cx, cy, HOLE / 2 - 0.3, 'S');
    };
    const foldTicks = (x, y, h) => {
      doc.setDrawColor(...lineRgb); doc.setLineWidth(0.15);
      [x + 6, x + TW - 6].forEach(fx => { doc.line(fx, y - 1.5, fx, y - 5.5); doc.line(fx, y + h + 1.5, fx, y + h + 5.5); });
    };

    const draw = (it, x, y) => {
      if (it.kind === 'img') {
        doc.addImage(it.img.data, 'JPEG', x, y, it.w, it.h, undefined, 'FAST');
      } else if (it.kind === 'genFront') {
        doc.setFillColor(...paperRgb); doc.setDrawColor(200, 200, 205); doc.setLineWidth(0.2);
        doc.rect(x, y, it.w, it.h, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...inkRgb);
        const t = doc.splitTextToSize(clean(albumName), it.w - 20).slice(0, 5);
        const lh = 9, ty = y + it.h / 2 - (t.length * lh) / 2 + 4;
        t.forEach((l, i) => doc.text(l, x + it.w / 2, ty + i * lh, { align: 'center' }));
        doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...accentRgb);
        if (coverArtist) doc.splitTextToSize(clean(coverArtist), it.w - 20).slice(0, 2).forEach((l, i) => doc.text(l, x + it.w / 2, ty + t.length * lh + 3 + i * 5.5, { align: 'center' }));
      } else if (it.kind === 'genDisc') {
        const cx = x + it.w / 2, cy = y + it.h / 2;
        doc.setFillColor(...paperRgb); doc.setDrawColor(200, 200, 205); doc.setLineWidth(0.2);
        doc.circle(cx, cy, DD / 2, 'FD');
        doc.setFillColor(255, 255, 255); doc.circle(cx, cy, HOLE / 2, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
        const t = doc.splitTextToSize(clean(albumName), 56).slice(0, 3);
        t.forEach((l, i) => doc.text(l, cx, cy + HOLE / 2 + 8 + i * 5, { align: 'center' }));
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...accentRgb);
        if (coverArtist) doc.text(fit1(coverArtist, 56), cx, cy + HOLE / 2 + 9 + t.length * 5, { align: 'center' });
      } else if (it.kind === 'genBack') {
        doc.setFillColor(...paperRgb); doc.setDrawColor(200, 200, 205); doc.setLineWidth(0.2);
        doc.rect(x, y, it.w, it.h, 'FD');
        if (it.wm) {
          doc.addImage(it.wm, 'JPEG', x + 6, y, it.w - 12, it.h, undefined, 'FAST');
          doc.rect(x, y, it.w, it.h, 'S');   // the border back over it
        }
        doc.setLineDashPattern([1.2, 1.2], 0);
        doc.line(x + 6, y, x + 6, y + it.h); doc.line(x + it.w - 6, y, x + it.w - 6, y + it.h);
        doc.setLineDashPattern([], 0);
        const spine = clean(coverArtist ? coverArtist + ' - ' + albumName : albumName);
        // format marks: a small CD mark at the foot of each spine, and a strip along the bottom of the back
        const mk = this._caseMarksOn();
        const mLen = mk ? this._pdfSpineMark(doc, 0, 0, { label: 'CD', measure: true, r: 1.7, fs: 5.4 }) + 3 : 0;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...inkRgb);
        const sp = fit1(spine, it.h - 14 - mLen), sw = doc.getTextWidth(sp);
        const smid = y + (it.h - mLen) / 2;
        doc.text(sp, x + 3.9, smid + sw / 2, { angle: 90 });
        doc.text(sp, x + it.w - 6 + 3.9, smid + sw / 2, { angle: 90 });
        if (mk) [x + 3, x + it.w - 3].forEach(scx => this._pdfSpineMark(doc, scx, y + it.h - 2.5, { label: 'CD', rgb: mutedRgb, r: 1.7, fs: 5.4, dir: 'up' }));
        if (mk) {
          const sy = y + it.h - 6.5;
          doc.setDrawColor(205, 205, 210); doc.setLineWidth(0.2); doc.line(x + 12, sy - 5.2, x + it.w - 12, sy - 5.2);
          const mw = this._pdfFormatMark(doc, x + 12, sy, { r: 2.6, lines: ['COMPACT', 'DISC'], rgb: inkRgb, fs: 5.6 });
          const yr = (String(release?.date || '').match(/^\d{4}/) || [])[0] || '';
          const lab = release?.['label-info']?.find(li => li?.label?.name)?.label?.name || '';
          const ms = (it.tl?.tracks || []).reduce((t, tr) => t + (tr.len || 0), 0);
          const info = [lab, yr, ms > 60000 ? Math.round(ms / 60000) + ' min' : ''].filter(Boolean).join('  -  ');
          if (info) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...mutedRgb);
            doc.text(fit1(info, it.w - 24 - mw - 6), x + it.w - 12, sy + 0.8, { align: 'right' });
          }
        }
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...inkRgb); doc.setDrawColor(200, 200, 205);   // back to the card's own text style
        const bx = x + 12, bw = it.w - 24;
        doc.setFontSize(15);
        const t = doc.splitTextToSize(clean(albumName), bw).slice(0, 2);
        t.forEach((l, i) => doc.text(l, bx, y + 14 + i * 6.5));
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...accentRgb);
        if (coverArtist) doc.text(fit1(coverArtist, bw), bx, y + 14 + t.length * 6.5);
        const tracks = it.tl?.tracks || [];
        if (tracks.length) {
          const cols = tracks.length > 40 ? 3 : tracks.length > 18 ? 2 : 1;
          const fs = tracks.length > 40 ? 6 : 7, lhT = tracks.length > 40 ? 3 : 3.4;
          const top = y + (coverArtist ? 20 : 14) + t.length * 6.5, perCol = Math.floor((y + it.h - (this._caseMarksOn() ? 15 : 8) - top) / lhT), colW = bw / cols;
          doc.setFontSize(fs); doc.setTextColor(...inkRgb);
          tracks.slice(0, perCol * cols).forEach((tr, i) => {
            const c = Math.floor(i / perCol), r = i % perCol;
            const label = (it.tl.discs > 1 ? 'D' + tr.d + '-' : '') + tr.n + '. ' + tr.title;
            doc.text(fit1(label, colW - 3), bx + c * colW, top + r * lhT);
          });
        }
      }
      if (it.disc && it.markOk && this._caseMarksOn()) this._pdfDiscMark(doc, x + it.w / 2, y + it.h / 2, it.w / 2, 'CD', { onArt: it.kind === 'img', rgb: it.kind === 'img' ? [255, 255, 255] : mutedRgb });
      // Cut guides and caption — outside the artwork so nothing prints over it
      if (it.disc) discGuides(x + it.w / 2, y + it.h / 2); else marks(x, y, it.w, it.h);
      if (it.tray) foldTicks(x, y, it.h);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...mutedRgb);
      doc.text(clean(it.cap), pageW / 2, y + it.h + 5, { align: 'center' });
    };

    const MARGIN = 12;
    let y = MARGIN;
    items.forEach(it => {
      if (y + it.h + 5 > pageH - 12 && y > MARGIN + 0.1) { doc.addPage(); y = MARGIN; }
      draw(it, (pageW - it.w) / 2, y);
      y += it.h + 9;
    });

    // Last page: what was found, where from, and how to print it
    doc.addPage();
    const mx = 18, cw = pageW - mx * 2;
    let ny = 24;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...inkRgb);
    doc.splitTextToSize(clean(albumName), cw).slice(0, 2).forEach(l => { doc.text(l, mx, ny); ny += 8; });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...accentRgb);
    doc.text(fit1(coverArtist || 'Various Artists', cw), mx, ny); ny += 5;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(0.6); doc.line(mx, ny, pageW - mx, ny); ny += 10;
    const para = (head, body) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
      doc.text(clean(head), mx, ny); ny += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 67);
      doc.splitTextToSize(clean(body), cw).forEach(l => { doc.text(l, mx, ny); ny += 4.6; });
      ny += 4;
    };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
    doc.text('What was found', mx, ny); ny += 7;
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...inkRgb);
      doc.text(k, mx, ny);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 67);
      const lines = doc.splitTextToSize(clean(v), cw - 32);
      lines.forEach((l, i) => doc.text(l, mx + 32, ny + i * 4.6));
      ny += Math.max(1, lines.length) * 4.6 + 2;
    });
    ny += 4;
    if (release) {
      const fmts = [...new Set((release.media || []).map(m => m.format).filter(Boolean))].join('/');
      const detail = [release.country, release.date, fmts].filter(Boolean).join(', ');
      para('Source release', release.title + (detail ? ' (' + detail + ')' : '') + '\nmusicbrainz.org/release/' + release.id);
    } else para('Source release', 'No matching release was found on MusicBrainz.');
    para('Printing', 'Print at 100% / "Actual size" - not "Fit to page" - so everything comes out at the real size. Paper: ' + (letter ? 'US Letter' : 'A4') + '. Cut along the corner marks (the disc has a circle and a hole to cut out). On the back tray card, fold along the two small ticks.');
    para('Sizes', 'Front cover and booklet pages 120 x 120 mm, back tray card 150 x 118 mm, disc 118 mm with a 36 mm centre hole - standard jewel case. Slim cases and digipaks are different sizes.');

    // Footer on every page
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...mutedRgb);
      doc.text(p < pageCount ? 'Print at 100% (Actual size)' : 'Crow Media Player', MARGIN, pageH - 6);
      doc.text('Page ' + p + ' of ' + pageCount, pageW - MARGIN, pageH - 6, { align: 'right' });
    }
    if (preview.closed) return;
    const slug = clean((coverArtist ? coverArtist + ' ' : '') + albumName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'album';
    this._showPDFPreview(doc, 'crow-media-cd-printables-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
    return { rgId: release?.['release-group']?.id || rgId || '', album: albumName, artist: albumArtist || artist };
  },

  // ══ DVD / Blu-ray Case Printables ════════════════════════════════════════
  // For the movie / TV info panel. Prints a full case wrap (back | spine |
  // front) at real size, plus a disc label. The poster comes from TMDB when a
  // TMDB key is set in the card editor; with no key TMDB is skipped and only
  // key-free sources are used (TVmaze for TV, iTunes for films, then the
  // artwork already on screen). The spine and back take their colour from
  // the poster, and the back is laid out from the title's own details.
  //
  //   DVD (Amaray)   wrap 273 x 183 mm, spine 14 mm
  //   Blu-ray        wrap 272 x 149 mm, spine 14 mm
  //   Disc label     118 mm, 36 mm centre hole
  // From places that only know a title (Watch History, Video Recap, Movies & TV search, pinned items):
  // the title's details are looked up once the case size is chosen.
  // isTv is a hint unless sure is set (the player said it's an episode): history and some players
  // report shows as films, so an exact title match on TVmaze / the iTunes Store can overrule it.
  _exportDiscCaseFor(title, isTv, artUrl = '', { sure = false } = {}) {
    if (!this._pdfOn('disc')) return;   // switched off in the card editor
    if (!title) return;
    return this._exportDiscCase(preview => this._discCaseDataFor(title, isTv, preview, sure), artUrl, { origTitles: [title] });
  },

  // A title's details for the case back, without opening the info panel. Uses what the info panel already
  // found when it can; otherwise TMDB (with a key), TVmaze (TV) or Wikipedia. Kept for the session.
  _discCaseDataFor(title, isTv, preview = null, sure = false) {
    // a match chosen with "Not this one?" (here or in the info panel) wins
    const chosen = this._videoChoiceGet(title);
    if (chosen) return Promise.resolve(chosen);
    return this._sessionMemo('discdata', (isTv ? 'tv' : 'movie') + (sure ? '!' : '|') + String(title).toLowerCase(), async () => {
      preview?.status?.('Looking up \u201C' + title + '\u201D\u2026');
      const { title: clean } = await this._videoLookupTitle(title, isTv);
      const chosenClean = this._videoChoiceGet(clean);
      if (chosenClean) return chosenClean;
      // Is it really a show or a film? Unless the player said so, an exact title match decides:
      // "Breaking Bad" is a show on TVmaze and no film on the iTunes Store, so it's TV even if it was logged as a film.
      let want = isTv ? 'tv' : 'movie', guessed = null;
      if (!sure) {
        guessed = await this._videoKindGuess(clean).catch(() => null);
        if (guessed?.tv && !guessed.film) want = 'tv';
        else if (guessed?.film && !guessed.tv) want = 'movie';
      }
      const tvWanted = want === 'tv';
      const unsure = !sure && !(guessed?.tv || guessed?.film);
      const pick = arr => (Array.isArray(arr) ? arr : []).find(d => d && (d.type || 'movie') === want) || null;
      const ck = ('videoinfo5|' + clean).toLowerCase();
      let d = null;
      try { d = pick(this._aiVideoInfoCache?.get(ck)) || pick(this._aiLocalGet('videoInfo', ck)) || pick(this._aiSessionGet('videoInfo', ck)); } catch (_) {}
      if (!d && this._tmdbKey()) {
        const r = await this._lookupTMDBVideoInfo(clean, tvWanted).catch(() => null);
        // TMDB ranks shows and films together: when nothing else could tell, its best match is the answer
        d = pick(r?.candidates) || (unsure ? (r?.candidates || [])[0] || null : null);
      }
      if (!d && tvWanted) d = await this._lookupTVmazeShow(clean).catch(() => null);
      if (!d) {
        const w = await this._fetchWikipediaVideoFallback(clean, tvWanted).catch(() => null);
        if (w) d = Object.assign({}, w, { type: want, title: w.title || clean, overview: w.overview || w.extract || '' });
      }
      return d || { type: want, title: clean };
    }, { keep: v => v && (v.overview || v.cast?.length || v.year) });
  },

  // Exact title matches on TVmaze (shows) and the iTunes Store (films): { tv, film }. Kept for the session.
  _videoKindGuess(title) {
    const clean = String(title || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
    return this._sessionMemo('vkind', clean.toLowerCase(), async () => {
      const norm = v => String(v || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
      const want = norm(clean);
      const region = ((String(navigator.languages?.[0] || navigator.language || '').match(/-([A-Za-z]{2})\b/) || [])[1] || 'gb').toLowerCase();
      const get = async url => {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 6000);
        try { const r = await crowFetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : (r.status === 404 ? {} : null); }
        catch (_) { return null; } finally { clearTimeout(tm); }
      };
      const [show, films] = await Promise.all([
        get('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(clean)),
        get('https://itunes.apple.com/search?term=' + encodeURIComponent(clean) + '&media=movie&entity=movie&limit=10&country=' + region),
      ]);
      if (show == null && films == null) return null;   // offline: try again next time
      return { tv: !!want && norm(show?.name) === want, film: !!want && (films?.results || []).some(x => norm(x.trackName) === want) };
    });
  },

  // ── Movie / TV info PDF ─────────────────────────────────────────────────
  // Built from the panel's own data rather than by reading the screen, so
  // the layout is tidy: title and year as the masthead; the poster beside
  // the user-score ring and grey detail rows; then Overview,
  // Cast, Where to Watch and Similar. Anything opened with Ask, Mood Match
  // or Trivia is included too.
  async _buildVideoInfoPDF(preview, data, content, JsPDFCtor) {
    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2;
    const bottom = pageH - 40;
    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    const clean = s => String(s || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
      .replace(/[•●]/g, '·')
      .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();
    let y = 44;
    const newPageIfNeeded = need => { if (y + need > bottom) { doc.addPage(); y = 44; } };
    const para = (text, size = 10.5, rgb = inkRgb) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...rgb);
      doc.splitTextToSize(text, contentW).forEach(l => { newPageIfNeeded(size * 1.35); doc.text(l, marginX, y); y += size * 1.35; });
    };
    const section = title => {
      newPageIfNeeded(40);
      y += 8;
      doc.setFillColor(...accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
      doc.text(title, marginX + 9, y);
      y += 16;
    };
    // Lists (Cast, Where to Watch, Similar) go in a grid whose columns are
    // only as wide as the longest entry plus a small gap — as many as fit
    // across the page (up to 4) — so entries line up neatly without big
    // empty gaps between columns. Items: [{ title, sub }].
    const grid = (items, { bold = true } = {}) => {
      if (!items.length) return;
      const paired = items.some(it => it.sub);
      const tSize = 10, sSize = 8.5, gap = 18;
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(tSize);
      let widest = Math.max(...items.map(it => doc.getTextWidth(it.title)));
      if (paired) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(sSize);
        widest = Math.max(widest, ...items.map(it => doc.getTextWidth(it.sub || '')));
      }
      // At least three across; an unusually long title is shortened with "..."
      const maxColW = (contentW - gap * 2) / 3;
      const colW = Math.min(Math.max(widest + 2, 70), maxColW);
      const cols = Math.max(1, Math.min(4, items.length, Math.floor((contentW + gap) / (colW + gap))));
      const rowH = paired ? 26 : 15;
      const fit = (str, size, style) => {
        doc.setFont('helvetica', style); doc.setFontSize(size);
        if (doc.getTextWidth(str) <= colW) return str;
        let out = str;
        while (out.length > 1 && doc.getTextWidth(out + '...') > colW) out = out.slice(0, -1);
        return out.trimEnd() + '...';
      };
      // Fill down each column, then across (reads top-to-bottom like a list)
      const rows = Math.ceil(items.length / cols);
      for (let rI = 0; rI < rows; rI++) {
        newPageIfNeeded(rowH);
        for (let c = 0; c < cols; c++) {
          const it = items[c * rows + rI];
          if (!it) continue;
          const x = marginX + c * (colW + gap);
          doc.setTextColor(...inkRgb); doc.text(fit(it.title, tSize, bold ? 'bold' : 'normal'), x, y);
          if (it.sub) { doc.setTextColor(...mutedRgb); doc.text(fit(it.sub, sSize, 'normal'), x, y + 11); }
        }
        y += rowH;
      }
      y += 2;
    };

    // ── Masthead: title, then the year in the accent colour ──
    const isTv = data.type === 'tv';
    const title = clean(data.title) || 'Untitled';
    // Just the year beside the title — no status like "Ended" or "Released"
    const sub = clean(data.year);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    if (!sub || doc.getTextWidth(title + '  ' + sub) <= contentW) {
      doc.setTextColor(...inkRgb); doc.text(title, marginX, y);
      doc.setTextColor(...accentRgb); doc.text('  ' + sub, marginX + doc.getTextWidth(title), y);
    } else {
      doc.setTextColor(...inkRgb);
      doc.splitTextToSize(title, contentW).forEach((l, k, a) => { doc.text(l, marginX, y); if (k < a.length - 1) y += 22; });
      y += 22; doc.setTextColor(...accentRgb); doc.text(sub, marginX, y);
    }
    y += 7;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;

    // ── Detail rows beside the poster ──
    const cw = data._pdfCw || null;
    const rows = [];
    rows.push(['TYPE', isTv ? 'TV Series' : 'Movie']);
    if (isTv && data.seasons) rows.push(['SEASONS', String(data.seasons)]);
    if (data.director) rows.push([isTv ? 'CREATOR' : 'DIRECTOR', clean(data.director)]);
    if ((data.genres || []).length) rows.push(['GENRE', data.genres.slice(0, 4).map(clean).join(', ')]);
    if (cw && (cw.rating || (cw.themes || []).length)) {
      const themes = (cw.themes || []).map(t => clean(typeof t === 'string' ? t : t?.label)).filter(Boolean);
      rows.push(['RATED', [cw.rating ? clean(cw.rating) : '', themes.join(', ')].filter(Boolean).join('  ·  ')]);
    }

    // Score ring, as on screen: score out of 100 inside a coloured ring
    const ratingRaw = String(data.rating ?? '');
    const rn = parseFloat(ratingRaw.replace(',', '.'));
    const pct = isFinite(rn) && rn > 0 ? Math.max(0, Math.min(100, Math.round(/%/.test(ratingRaw) || rn > 10 ? rn : rn * 10))) : null;
    const ringH = pct != null ? 40 : 0;

    const posterSrc = content.querySelector('.info-hero-art img')?.currentSrc || content.querySelector('.info-hero-art img')?.src
      || this._collectInfoPanelBlocks(content).find(b => b.type === 'img' && b.w >= 60)?.src;
    if (posterSrc) preview?.status?.('Fetching artwork\u2026');
    const img = posterSrc ? await this._pdfImageData(posterSrc) : null;
    preview?.status?.('Building pages\u2026');
    const artGap = 16, rowGap = 3, labelW = 64;
    let colX = marginX, colW = contentW;
    const measure = w => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      return rows.map(([lab, val]) => { const vl = doc.splitTextToSize(val, w - labelW - 8); return { lab, vl, h: Math.max(20, vl.length * 13 + 7) }; });
    };
    let laid = measure(contentW);
    let artBottom = y;
    if (img) {
      laid = measure(contentW - 90 - artGap);
      const colH = ringH + laid.reduce((h, r) => h + r.h, 0) + rowGap * Math.max(0, laid.length - 1);
      // Posters are portrait — keep them a sensible size whatever the column height
      const h = Math.max(110, Math.min(170, colH));
      const w = Math.min(h * (img.w / img.h), contentW * 0.4);
      const hh = w * (img.h / img.w);
      try {
        doc.addImage(img.data, 'JPEG', marginX, y, w, hh);
        colX = marginX + w + artGap; colW = contentW - w - artGap; artBottom = y + hh;
        laid = measure(colW);
      } catch (_) {}
    }
    let ty = y;
    if (pct != null) {
      const r = 15, cx = colX + r + 2, cy = ty + r + 2;
      const colour = hexToRgb(pct >= 70 ? '#A8D64B' : pct >= 50 ? '#C8B420' : '#C0504A');
      doc.setLineWidth(3); doc.setDrawColor(228, 228, 232);
      doc.circle(cx, cy, r, 'S');
      doc.setDrawColor(...colour);
      if (doc.setLineCap) doc.setLineCap('round');
      const steps = Math.max(2, Math.round(pct * 0.9));
      let px = cx, py = cy - r;
      for (let k = 1; k <= steps; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * (pct / 100)) * (k / steps);
        const nx = cx + r * Math.cos(a), ny = cy + r * Math.sin(a);
        doc.line(px, py, nx, ny); px = nx; py = ny;
      }
      if (doc.setLineCap) doc.setLineCap('butt');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      doc.text(String(pct), cx, cy + 3.7, { align: 'center' });
      const v = parseInt(String(data.votes || '').replace(/[^0-9]/g, ''), 10) || 0;
      const votes = v ? (v >= 1000 ? Math.round(v / 1000) + 'k votes' : v + ' vote' + (v === 1 ? '' : 's')) : '';
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      doc.text('User Score', cx + r + 10, cy - 2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
      doc.text(pct + ' out of 100' + (votes ? '  ·  ' + votes : ''), cx + r + 10, cy + 10);
      ty += ringH;
    }
    ty += 13;
    laid.forEach(({ lab, vl, h }) => {
      doc.setFillColor(...zebraRgb);
      doc.roundedRect(colX, ty - 13, colW, h, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text(lab, colX + 8, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      vl.forEach((ln, k) => doc.text(ln, colX + labelW, ty + k * 13));
      ty += h + rowGap;
    });
    const colBottom = laid.length ? ty - 13 - rowGap : ty - 13;
    y = Math.max(colBottom, artBottom) + 14;

    // ── Sections ──
    if (data.overview) { section('Overview'); para(clean(data.overview)); }
    // Anything opened with Ask / Mood Match / Trivia
    [['#ask-panel', 'Ask'], ['#mood-panel', 'Mood Match'], ['#trivia-panel', 'Trivia']].forEach(([sel, label]) => {
      const el = content.querySelector(sel);
      if (!el || el.style.display === 'none') return;
      const t = clean(String(el.innerText || '').replace(/\n{2,}/g, '\n'));
      if (!t) return;
      section(label);
      t.split('\n').map(s => s.trim()).filter(Boolean).forEach(l => para(l));
    });
    const cast = (data.cast || []).slice(0, 15).map(clean).filter(Boolean);
    if (cast.length) { section('Cast'); grid(cast.map(c => ({ title: c, sub: '' })), { bold: false }); }
    const wtw = (data._pdfWtw || []).filter(s => s && (s.service || s.name));
    if (wtw.length) {
      section('Where to watch');
      grid(wtw.map(s => ({ title: clean(s.service || s.name), sub: clean(s.note || '') })));
    }
    const similar = (data.similar || []).filter(s => s && s.title);
    if (similar.length) {
      section('Similar');
      // One column, full titles: the title, then its year and type in grey
      // on the same line, so ten titles still only take ten short lines.
      similar.forEach(s => {
        const t = clean(s.title);
        const sub = [s.year, (s.type || data.type) === 'tv' ? 'TV Series' : 'Movie'].map(clean).filter(Boolean).join('  \u00B7  ');
        newPageIfNeeded(15);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
        const lines = doc.splitTextToSize(t, contentW - 110);
        lines.forEach((ln, k) => { if (k) { y += 13; newPageIfNeeded(13); } doc.text(ln, marginX, y); });
        const tw = doc.getTextWidth(lines[lines.length - 1]);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...mutedRgb);
        doc.text(sub, marginX + tw + 10, y);
        y += 15;
      });
      y += 2;
    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'info';
    if (preview.closed) return;
    this._showPDFPreview(doc, 'crow-media-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  async _buildInfoPanelPDF(preview) {
    const r = this.shadowRoot;
    const content = r?.getElementById('infoContent');
    if (!content) return;
    const headerText = (r.getElementById('infoPopupTitle')?.textContent || 'Info').trim();
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }

    // A movie / TV info panel has its own tidy layout built from its data
    if (content.querySelector('#content-warning-section') && this._videoPdfData) {
      return this._buildVideoInfoPDF(preview, this._videoPdfData, content, JsPDFCtor);
    }

    const blocks = this._collectInfoPanelBlocks(content);
    if (!blocks.some(b => b.type === 'text')) { preview.fail('Nothing to export yet.'); return; }

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 44;
    const contentW = pageW - marginX * 2;
    let y = 56;

    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    // jsPDF's built-in fonts only cover Western characters — map the common
    // typographic ones and drop anything else (e.g. emoji, stars).
    const clean = s => String(s || '')
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2212]/g, '-').replace(/\u2014/g, '-').replace(/\u2026/g, '...')
      .replace(/[\u2022\u25CF\u00B7]/g, '\u00B7').replace(/\u2192/g, '->').replace(/\u00A0/g, ' ')
      .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF]/g, '')
      .replace(/[ \t]+/g, ' ').trim();
    const newPageIfNeeded = need => { if (y + need > pageH - 50) { doc.addPage(); y = 56; } };
    // Text normally runs the full width. While the artwork is on the page,
    // the title, artist and the Year / Label / Length / Genre rows sit in a
    // column to its right (colX / colW); exitSide() drops back below it.
    let colX = marginX, colW = contentW, inSide = false, sideBottom = 0;
    const exitSide = () => {
      if (!inSide) return;
      y = Math.max(y, sideBottom + 22);
      colX = marginX; colW = contentW; inSide = false;
    };
    const writeWrapped = (text, size, style, rgb, indent = 0, lineGap = 1.35) => {
      doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...rgb);
      const lines = doc.splitTextToSize(text, colW - indent);
      lines.forEach(line => { newPageIfNeeded(size * lineGap); doc.text(line, colX + indent, y); y += size * lineGap; });
    };
    const sectionHeader = title => {
      exitSide();
      newPageIfNeeded(34);
      y += 8;
      doc.setFillColor(...accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
      doc.text(title, marginX + 9, y);
      y += 16;
    };

    // ── Header ── the same layout as the lyrics PDF: the title and artist
    // (or the panel's own subtitle) as the masthead, then the artwork sized
    // to the grey Year / Label / Length / Genre rows beside it. Blocks used
    // here are skipped in the main pass below.
    const texts = blocks.filter(b => b.type === 'text' || b.type === 'row');
    const isLbl = b => b.upper && b.size <= 12;
    // A label and its value form a "box" only when that box holds just the
    // two of them — otherwise the label is a section heading (Chapters,
    // Cast…) and the first item under it mustn't be pulled into a grey row.
    const boxOfTwo = (lab, val) => {
      const box = lab.el.parentElement;
      if (!box || box === r.getElementById('infoContent') || !box.contains(val.el)) return false;
      return texts.filter(t => box.contains(t.el)).length === 2;
    };
    const used = new Set();
    const tIdx = texts.findIndex(b => b.size >= 15 && b.bold);
    let subTxt = '';
    const kvRows = [];
    if (tIdx !== -1) {
      used.add(tIdx);
      for (let k = tIdx + 1; k < texts.length; k++) {
        const b = texts[k], nx = texts[k + 1];
        if (isLbl(b)) {
          const v = nx ? clean(nx.text) : '';
          const same = nx && !isLbl(nx) && nx.type !== 'row' && boxOfTwo(b, nx);
          if (!same || !v || v.length > 60 || nx.url) break;   // a section heading or long value ends the header
          kvRows.push([clean(b.text).toUpperCase(), v]);
          used.add(k); used.add(k + 1);
          k++;
          continue;
        }
        if (b.size >= 15 && b.bold) break;
        if (kvRows.length) break;
        const t = clean(b.text);
        if (!subTxt && t && t.length <= 120) { subTxt = t; used.add(k); }
      }
    }
    const mastTitle = tIdx !== -1 ? clean(texts[tIdx].text) : 'Crow Media Player';
    const mastSub = tIdx !== -1 ? subTxt : clean(headerText);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    if (!mastSub || doc.getTextWidth(mastTitle + '  ' + mastSub) <= contentW) {
      doc.setTextColor(...inkRgb); doc.text(mastTitle, marginX, y);
      if (mastSub) { doc.setTextColor(...accentRgb); doc.text('  ' + mastSub, marginX + doc.getTextWidth(mastTitle), y); }
    } else {
      doc.setTextColor(...inkRgb);
      doc.splitTextToSize(mastTitle, contentW).forEach((l, k, arr) => { doc.text(l, marginX, y); if (k < arr.length - 1) y += 22; });
      y += 22;
      doc.setTextColor(...accentRgb);
      doc.splitTextToSize(mastSub, contentW).forEach((l, k, arr) => { doc.text(l, marginX, y); if (k < arr.length - 1) y += 22; });
    }
    y += 7;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;

    // Artwork sized to the grey rows, rows starting level with its top
    const heroIdx = blocks.findIndex(b => b.type === 'img' && b.w >= 60);
    if (heroIdx !== -1) preview?.status?.('Fetching artwork\u2026');
    const heroImg = heroIdx !== -1 ? await this._pdfImageData(blocks[heroIdx].src) : null;
    preview?.status?.('Building pages\u2026');
    const artGap = 16, rowGap = 3;
    const measureRows = (cw, lw) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      return kvRows.map(([lab, val]) => {
        const valLines = doc.splitTextToSize(val, cw - lw - 8);
        return { lab, valLines, boxH: Math.max(20, valLines.length * 13 + 7) };
      });
    };
    let hdrX = marginX, hdrW = contentW, hdrLabelW = 112, artBottom = y;
    let laidRows = measureRows(hdrW, hdrLabelW);
    if (heroImg) {
      hdrLabelW = 64;
      laidRows = measureRows(contentW - 92 - artGap, hdrLabelW);
      const rowsH = laidRows.reduce((h, rw) => h + rw.boxH, 0) + rowGap * Math.max(0, laidRows.length - 1);
      const side = kvRows.length ? Math.max(64, Math.min(110, rowsH)) : 110;
      const h = Math.min(side, side * (heroImg.h / heroImg.w)), w = h * (heroImg.w / heroImg.h);
      try {
        doc.addImage(heroImg.data, 'JPEG', marginX, y, w, h);
        hdrX = marginX + w + artGap; hdrW = contentW - w - artGap; artBottom = y + h;
        laidRows = measureRows(hdrW, hdrLabelW);
      } catch (_) { hdrX = marginX; hdrW = contentW; hdrLabelW = 112; laidRows = measureRows(hdrW, hdrLabelW); }
    }
    let ry = y + 13;
    laidRows.forEach(({ lab, valLines, boxH }) => {
      doc.setFillColor(...zebraRgb);
      doc.roundedRect(hdrX, ry - 13, hdrW, boxH, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text(lab, hdrX + 8, ry);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      valLines.forEach((ln, k) => doc.text(ln, hdrX + hdrLabelW, ry + k * 13));
      ry += boxH + rowGap;
    });
    const rowsBottom = laidRows.length ? ry - 13 - rowGap : y;
    if (heroImg || laidRows.length) y = Math.max(rowsBottom, artBottom) + 22;

    // ── Everything else, in on-screen order ──
    let firstTitleDone = tIdx !== -1;
    for (let i = 0; i < texts.length; i++) {
      if (used.has(i)) continue;
      const b = texts[i];
      // List rows (audiobook chapters…): one line each — number, title,
      // and the length on the right
      if (b.type === 'row') {
        exitSide();
        const t = clean(b.text);
        const num = clean(b.num);
        const sub = /^0\s*min/i.test(String(b.sub || '').trim()) ? '' : clean(b.sub);
        newPageIfNeeded(16);
        const titleX = marginX + (num ? 24 : 0);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
        if (num) doc.text(num, marginX, y);
        if (sub) doc.text(sub, marginX + contentW, y, { align: 'right' });
        const subW = sub ? doc.getTextWidth(sub) + 12 : 0;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
        let show = t;
        const maxW = contentW - (titleX - marginX) - subW;
        if (doc.getTextWidth(show) > maxW) {
          while (show.length > 1 && doc.getTextWidth(show + '...') > maxW) show = show.slice(0, -1);
          show = show.trimEnd() + '...';
        }
        doc.text(show, titleX, y);
        y += 15;
        continue;
      }
      const text = clean(b.text);
      if (!text) continue;
      const isLabel = b.upper && b.size <= 12;
      if (isLabel) {
        // A small label with a short value right after it in the same box
        // (Year, Label, Length…) becomes a "Label  value" row; otherwise
        // it's a section heading (Band Members, Tracklist…).
        const next = texts[i + 1];
        const nextText = next ? clean(next.text) : '';
        const sameBox = next && !(next.upper && next.size <= 12) && next.type !== 'row'
          && (next.url ? (b.el.parentElement && b.el.parentElement.contains(next.el)) : boxOfTwo(b, next));
        // Already in the page title (e.g. an "Artist" box holding just the
        // artist's name) — leave it out rather than repeat it
        const _inTitle = v => !!v && [mastTitle, mastSub].some(m => m && m.toLowerCase() === v.toLowerCase());
        if (nextText && _inTitle(nextText)) {
          const after = texts[i + 2];
          if (sameBox || !after || isLbl(after) || (after.size >= 15 && after.bold)) { i++; continue; }
        }
        if (sameBox && nextText && (nextText.length <= 90 || next.url)) {
          // Long values (a stream URL…) don't fit beside the artwork
          if (inSide && nextText.length > 60) exitSide();
          newPageIfNeeded(30);
          doc.setFillColor(...zebraRgb);
          const labelW = inSide ? 64 : 112;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
          const valLines = doc.splitTextToSize(nextText, colW - labelW - 8);
          const boxH = Math.max(20, valLines.length * 13 + 7);
          doc.roundedRect(colX, y - 13, colW, boxH, 3, 3, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
          doc.text(text.toUpperCase(), colX + 8, y);
          const _isUrl = /^(https?:\/\/|www\.)\S+$/i.test(nextText);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...(_isUrl ? accentRgb : inkRgb));
          valLines.forEach((ln, k) => {
            if (_isUrl) doc.textWithLink(ln, colX + labelW, y + k * 13, { url: /^www\./i.test(nextText) ? 'https://' + nextText : nextText });
            else doc.text(ln, colX + labelW, y + k * 13);
          });
          y += boxH + 3;
          i++;
          continue;
        }
        sectionHeader(text.charAt(0) + text.slice(1).toLowerCase());
        if (texts[i + 1]?.type === 'row') continue;   // rows draw themselves below
        // List sections (Band Members, Similar Tracks, Tracklist, Known
        // For…) are laid out in columns so they don't run down the page:
        // a bold line with a smaller line under it (title + artist, track +
        // length) is one entry. Sections with long text stay as paragraphs.
        let j = i + 1;
        const sec = [];
        while (j < texts.length) {
          const nb = texts[j];
          if ((nb.upper && nb.size <= 12) || (nb.size >= 15 && nb.bold)) break;
          sec.push(nb); j++;
        }
        const secTexts = sec.map(x => clean(x.text)).filter(Boolean);
        if (secTexts.length >= 4 && sec.every(x => clean(x.text).length <= 70) && !sec.some(x => x.url)) {
          const items = [];
          for (let q = 0; q < sec.length; q++) {
            const t1 = clean(sec[q].text); if (!t1) continue;
            const n1 = sec[q + 1];
            if (sec[q].bold && n1 && !n1.bold && n1.size <= 12.5 && clean(n1.text)) { items.push({ title: t1, sub: clean(n1.text) }); q++; }
            else items.push({ title: t1, sub: '', plain: !sec[q].bold });
          }
          const paired = items.some(it => it.sub);
          // Single names (band members, cast, genres…) read best as one
          // flowing line separated by dots, wrapping only between names —
          // columns spread a short list awkwardly across the page.
          if (!paired) {
            const sep = '   \u00B7   ';
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
            const lines = [];
            let line = '';
            items.forEach(it => {
              const next = line ? line + sep + it.title : it.title;
              if (line && doc.getTextWidth(next) > contentW) { lines.push(line); line = it.title; }
              else line = next;
            });
            if (line) lines.push(line);
            lines.forEach(ln => { newPageIfNeeded(15); doc.text(ln, marginX, y); y += 15; });
            y += 4;
            i = j - 1;
            continue;
          }
          const cols = 2, gap = 12;
          const colW = (contentW - gap) / 2;
          const fit = (str, size, style) => {
            doc.setFont('helvetica', style); doc.setFontSize(size);
            if (doc.getTextWidth(str) <= colW - 4) return str;
            let out = str;
            while (out.length > 1 && doc.getTextWidth(out + '...') > colW - 4) out = out.slice(0, -1);
            return out.trimEnd() + '...';
          };
          const rowH = paired ? 28 : 16;
          for (let q = 0; q < items.length; q += cols) {
            newPageIfNeeded(rowH);
            for (let c = 0; c < cols && q + c < items.length; c++) {
              const it = items[q + c];
              const x = marginX + c * (colW + gap);
              if (paired) {
                doc.setTextColor(...inkRgb);
                doc.text(fit(it.title, 10, 'bold'), x, y);
                if (it.sub) { doc.setTextColor(...mutedRgb); doc.text(fit(it.sub, 8.5, 'normal'), x, y + 11); }
              } else {
                doc.setTextColor(...inkRgb);
                doc.text(fit(it.title, 10, 'normal'), x, y);
              }
            }
            y += rowH;
          }
          y += 2;
          i = j - 1;
        }
        continue;
      }
      if (b.size >= 15 && b.bold) {
        if (firstTitleDone) exitSide();
        newPageIfNeeded(28);
        writeWrapped(text, firstTitleDone ? 13 : 17, 'bold', inkRgb);
        firstTitleDone = true;
        y += 2;
        continue;
      }
      const small = b.size <= 11.5;
      // A paragraph (description, answer…) gets the full width
      if (inSide && text.length > 80) exitSide();
      writeWrapped(text, small ? 9.5 : 10.5, b.bold ? 'bold' : (b.italic ? 'italic' : 'normal'), small && !b.bold ? mutedRgb : inkRgb);
      y += small ? 2 : 4;
    }

    exitSide();

    // ── Footer on every page ──
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 26);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 26, { align: 'right' });
    }

    const firstTitle = texts.find(b => b.size >= 15 && b.bold);
    const slug = clean(firstTitle?.text || headerText).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'info';
    if (preview.closed) return;
    this._showPDFPreview(doc, 'crow-media-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // kind: 'music' | 'watch'. defaultRange: preselected period.
  async _exportHistoryReport(kind, defaultRange = 30) {
    if (!this._pdfOn('history')) return;   // switched off in the card editor
    const options = [
      { label: 'Today', value: 'today' },
      { label: 'Last 7 days', value: 7 },
      { label: 'Last 30 days', value: 30 },
      { label: 'Last 90 days', value: 90 },
      { label: 'All time', value: 'all' },
    ];
    const range = await this._iosChoose({
      title: kind === 'music' ? 'Music Report' : 'Watch Report',
      message: 'Choose the period to include in the PDF.',
      options, selected: defaultRange,
    });
    if (range === undefined) return;
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    try {
      // rebuilt when the history has changed (or on another day, since ranges count back from today)
      const log = (kind === 'music' ? this._getListenLogEntries() : this._getWatchLogEntries({ all: true })) || [];
      const fp = log.length + ':' + log.reduce((m, e) => Math.max(m, e?.ts || 0), 0);
      if (this._pdfFromSession('hist|' + kind + '|' + range + '|' + new Date().toDateString() + '|' + fp, preview)) return;
      await this._buildHistoryReportPDF(kind, range, preview);
    }
    catch (e) { console.warn('[Crow Media Player] history report failed', e); preview.fail('Couldn’t create the report. Please try again.'); }
    finally { this._pdfBusy = false; }
  },

  async _buildHistoryReportPDF(kind, range, preview) {
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }
    const isMusic = kind === 'music';
    const now = Date.now();
    const DAY = 864e5;
    const midnight = d => { const t = new Date(d); t.setHours(0, 0, 0, 0); return t.getTime(); };
    const all = (isMusic ? this._getListenLogEntries() : this._getWatchLogEntries())
      .filter(e => e && e.ts).sort((a, b) => a.ts - b.ts);
    const cutoff = range === 'today' ? midnight(now) : range === 'all' ? 0 : now - range * DAY;
    const entries = all.filter(e => e.ts >= cutoff);
    // YouTube videos: their own section in the Watch Report, kept apart from the films and shows so
    // a pile of short videos doesn't swamp the Movies vs TV bar or the top titles
    const ytAll = isMusic ? [] : this._getYouTubeLogEntries().filter(e => e && e.ts).sort((a, b) => a.ts - b.ts);
    const yt = ytAll.filter(e => e.ts >= cutoff);
    const rangeLabel = range === 'today' ? 'Today' : range === 'all' ? 'All time' : 'Last ' + range + ' days';

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2;
    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247];
    const accentHex = this._config?.accent_color || '#007AFF';
    const accentRgb = hexToRgb(accentHex);
    const theme = {
      hexToRgb, inkRgb, mutedRgb, zebraRgb, accentRgb,
      setInk: () => doc.setTextColor(...inkRgb), setMuted: () => doc.setTextColor(...mutedRgb), setAccent: () => doc.setTextColor(...accentRgb),
    };
    const clean = s => String(s || '')
      .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
      .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();
    const fmtDur = ms => {
      const m = Math.round((ms || 0) / 60000);
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60), r = m % 60;
      return h + 'h' + (r ? ' ' + r + 'm' : '');
    };
    const PALETTE = [accentHex, '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA', '#8E8E93'];
    let y = 44;
    const bottom = pageH - 40;
    const newPageIfNeeded = need => { if (y + need > bottom) { doc.addPage(); y = 44; return true; } return false; };
    const sectionHeader = title => {
      newPageIfNeeded(40);
      y += 6;
      doc.setFillColor(...accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
      doc.text(title, marginX + 9, y);
      y += 16;
    };
    // Ranked horizontal bars — a name on the left, a bar, the value on the right
    // With covers (items carrying .art), each row gets a small thumbnail.
    const rankedBars = async (items, { valueLabel = v => String(v), covers = false } = {}) => {
      if (!items.length) return;
      let thumbs = [];
      if (covers) {
        preview?.status?.('Fetching artwork\u2026');
        const budget = { itunes: 10 };
        thumbs = await Promise.all(items.map(it => it.art ? this._pdfThumbFor({ art: it.art }, budget).catch(() => null) : null));
        preview?.status?.('Building pages\u2026');
      }
      const useThumbs = thumbs.some(Boolean);
      const rowH = useThumbs ? 24 : 16, off = useThumbs ? 6 : 0;
      const max = Math.max(...items.map(i => i.value), 1);
      const thumbW = useThumbs ? 26 : 0;
      const labelW = 170 - thumbW, valW = 54, barX = marginX + thumbW + labelW + 8, barW = contentW - thumbW - labelW - 8 - valW;
      items.forEach((it, k) => {
        newPageIfNeeded(rowH);
        if (useThumbs) {
          const td = thumbs[k];
          if (td) { try { doc.addImage(td.data, 'JPEG', marginX, y - 1, 20, 20); } catch (_) {} }
          else { doc.setFillColor(...zebraRgb); doc.roundedRect(marginX, y - 1, 20, 20, 2, 2, 'F'); }
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...inkRgb);
        let label = (k + 1) + '. ' + clean(it.label);
        while (doc.getTextWidth(label) > labelW && label.length > 4) label = label.slice(0, -2);
        if (label !== (k + 1) + '. ' + clean(it.label)) label = label.trimEnd() + '...';
        doc.text(label, marginX + thumbW, y + 8 + off);
        doc.setFillColor(...zebraRgb);
        doc.roundedRect(barX, y + off, barW, 10, 2, 2, 'F');
        doc.setFillColor(...hexToRgb(it.color || accentHex));
        doc.roundedRect(barX, y + off, Math.max(3, barW * (it.value / max)), 10, 2, 2, 'F');
        doc.setTextColor(...mutedRgb); doc.setFontSize(8.5);
        doc.text(valueLabel(it.value), marginX + contentW, y + 8 + off, { align: 'right' });
        y += rowH;
      });
      y += 4;
    };
    const statCards = stats => {
      newPageIfNeeded(56);
      const gap = 8, cardW = (contentW - gap * (stats.length - 1)) / stats.length;
      stats.forEach((st, i) => {
        const x = marginX + i * (cardW + gap);
        doc.setFillColor(...zebraRgb);
        doc.roundedRect(x, y, cardW, 44, 4, 4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...(st.accent ? accentRgb : inkRgb));
        let v = clean(st.value);
        while (doc.getTextWidth(v) > cardW - 16 && v.length > 3) v = v.slice(0, -2);
        doc.text(v, x + 10, y + 20);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
        doc.text(st.label, x + 10, y + 34);
      });
      y += 44 + 18;
    };
    const countBy = (list, keyFn, valFn = () => 1) => {
      const m = new Map();
      list.forEach(e => { const k = keyFn(e); if (!k) return; m.set(k, (m.get(k) || 0) + valFn(e)); });
      return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    };
    const topWithOther = (items, n) => {
      if (items.length <= n) return items;
      const top = items.slice(0, n - 1);
      top.push({ label: 'Other', value: items.slice(n - 1).reduce((s, i) => s + i.value, 0) });
      return top;
    };
    // A title counts as TV if any of its watches (in the whole history) was
    // identified as an episode — same rule as the Watch History list — so a
    // show whose episodes didn't all report season/episode isn't counted
    // as a pile of movies.
    const titleKey = e => String(e.seriesTitle || e.title || '').toLowerCase().trim();
    const tvTitles = new Set(isMusic ? [] : all.filter(e => e.mediaType === 'tv' || Number.isFinite(e.season) || (e.seriesTitle && e.seriesTitle !== e.title)).map(titleKey));
    const isTv = e => tvTitles.has(titleKey(e));
    const watchedMs = e => (e.watchedMs > 0 ? e.watchedMs : (e.durationMs || 0));
    const valueOf = isMusic ? (() => 1) : (e => watchedMs(e) / 60000);   // plays, or minutes watched

    // ── Masthead ──
    const heading = isMusic ? 'Music History' : 'Watch History';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.setTextColor(...inkRgb); doc.text(heading, marginX, y);
    doc.setTextColor(...accentRgb); doc.text('  ' + rangeLabel, marginX + doc.getTextWidth(heading), y);
    y += 7;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;
    const firstTs = Math.min(entries.length ? entries[0].ts : now, yt.length ? yt[0].ts : now, entries.length || yt.length ? now : (cutoff || now));
    // The history only keeps so many entries, so it may not reach back to
    // the start of the chosen range — then the report starts where the
    // history does, rather than showing weeks of empty days.
    const historyStart = Math.min(all.length ? all[0].ts : now, ytAll.length ? ytAll[0].ts : now);
    const reportStart = range === 'all' ? firstTs : Math.max(cutoff, historyStart);
    const span = new Date(reportStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      + ' - ' + new Date(now).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
    doc.text(range === 'today' ? new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : span, marginX, y);
    y += 22;

    if (!entries.length && !yt.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
      doc.text(isMusic ? 'Nothing was played in this period.' : 'Nothing was watched in this period.', marginX, y);
    } else {
      // ── Summary ──
      if (isMusic) {
        const byDay = countBy(entries, e => midnight(e.ts));
        const busiest = byDay[0];
        statCards([
          { label: 'Listening time', value: fmtDur(entries.reduce((s, e) => s + (e.durationMs || 0), 0)), accent: true },
          { label: 'Artists', value: String(new Set(entries.map(e => (e.artist || '').toLowerCase()).filter(Boolean)).size) },
          { label: 'Busiest day', value: busiest ? new Date(busiest.label).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' (' + busiest.value + ')' : '-' },
        ]);
      } else {
        if (entries.length) statCards([
          { label: 'Watches', value: String(entries.length), accent: true },
          { label: 'Time watched', value: fmtDur(entries.reduce((s, e) => s + watchedMs(e), 0)) },
          { label: 'Movies / episodes', value: entries.filter(e => !isTv(e)).length + ' / ' + entries.filter(isTv).length },
          ...(yt.length ? [{ label: 'YouTube videos', value: String(yt.length) }] : []),
        ]);
      }

      // ── Optional AI summary ──
      if (this._aiFeatureOn('recap')) {
        preview?.status?.('Writing the summary\u2026');
        try {
          const topNames = countBy(entries, e => isMusic ? e.artist : (e.seriesTitle || e.title), valueOf).slice(0, 5).map(i => i.label).join(', ');
          const prompt = isMusic
            ? `Someone's music listening for "${rangeLabel}": top artists ${topNames}. Write a warm 2-sentence summary of their listening. Do not mention how many plays or tracks. Plain text, no emojis.`
            : `Someone's TV and movie watching for "${rangeLabel}": ${entries.length} watches${topNames ? ', mostly ' + topNames : ''}`
              + (yt.length ? `, plus ${yt.length} YouTube videos, mostly from ${countBy(yt, e => e.channel || '').slice(0, 3).map(i => i.label).join(', ') || 'various channels'}` : '')
              + `. Write a warm 2-sentence summary of their watching. Plain text, no emojis.`;
          const raw = await this._aiConverseF('recap', prompt);
          const text = clean(raw);
          if (text) {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
            doc.splitTextToSize(text, contentW).forEach(l => { newPageIfNeeded(14); doc.text(l, marginX, y); y += 14; });
            y += 8;
          }
        } catch (_) { /* the summary is optional */ }
        preview?.status?.('Building pages\u2026');
      }

      // ── When ── time of day and day of week, side by side
      const drawWhen = () => {
      const halfW = (contentW - 16) / 2;
      const tod = [['Morning', 5, 12], ['Afternoon', 12, 17], ['Evening', 17, 22], ['Night', 22, 29]]
        .map(([label]) => ({ label, value: 0 }));
      const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => ({ label, value: 0 }));
      entries.forEach(e => {
        const d = new Date(e.ts), h = d.getHours();
        const b = h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3;
        tod[b].value += valueOf(e);
        dow[(d.getDay() + 6) % 7].value += valueOf(e);
      });
      tod.forEach(t => { t.value = Math.round(t.value); });
      dow.forEach(t => { t.value = Math.round(t.value); });
      newPageIfNeeded(170);
      const yStart = y + 4;
      const y1 = this._pdfDrawCategoryBarChart(doc, theme, tod, marginX, yStart, marginX * 2 + halfW, { title: 'Time of day' });
      const x2 = marginX + halfW + 16;
      const y2 = this._pdfDrawCategoryBarChart(doc, theme, dow, x2, yStart, x2 * 2 + halfW, { title: 'Day of the week' });
      y = Math.max(y1, y2);
      };

      // ── Where and when ── at the top: the speaker share, then time of day
      // and day of week side by side (a per-day bar chart was dropped — it
      // was dominated by a few heavy days and hard to read)
      const drawWhere = () => {
        // ── Where ──
        const speakers = topWithOther(countBy(entries, e => e.entity ? (this._entityDisplayName(e.entity) || e.entity) : 'Unknown', valueOf), 6)
          .map((it, i) => {
            // Full speaker names — only a very long one is shortened
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
            let lab = clean(it.label);
            if (doc.getTextWidth(lab) > 200) { while (lab.length > 2 && doc.getTextWidth(lab + '...') > 200) lab = lab.slice(0, -1); lab = lab.trimEnd() + '...'; }
            return { ...it, label: lab, value: Math.round(it.value * 10) / 10, color: PALETTE[i % PALETTE.length] };
          });
        if (speakers.length > 1) {   // one speaker → nothing to compare
          newPageIfNeeded(110);
          y = this._pdfDrawDonutWithBars(doc, theme, speakers, marginX, y + 4, pageW, { title: isMusic ? 'Where you listen' : 'Where you watch', newPageIfNeeded });
        }
      };
      if (entries.length) { drawWhere(); drawWhen(); }

      // ── Top lists ──
      if (isMusic) {
        sectionHeader('Top artists');
        await rankedBars(countBy(entries, e => e.artist).slice(0, 10), { valueLabel: v => v + (v === 1 ? ' play' : ' plays') });
        sectionHeader('Top tracks');
        // The album each track was last played from — for its cover
        const albumOf = new Map();
        entries.forEach(e => { if (e.title) albumOf.set(e.title + '\u0000' + (e.artist || ''), e.album || ''); });
        const tracks = countBy(entries, e => e.title ? e.title + '\u0000' + (e.artist || '') : '').slice(0, 10)
          .map(t => { const [ti, ar] = t.label.split('\u0000'); return { label: ti + (ar ? ' - ' + ar : ''), value: t.value, art: { artist: ar, album: albumOf.get(t.label), title: ti } }; });
        await rankedBars(tracks, { valueLabel: v => v + (v === 1 ? ' play' : ' plays'), covers: true });
        const albums = countBy(entries.filter(e => e.album && e.album.toLowerCase() !== (e.title || '').toLowerCase()),
          e => e.album + '\u0000' + (e.artist || '')).slice(0, 5)
          .map(t => { const [al, ar] = t.label.split('\u0000'); return { label: al + (ar ? ' - ' + ar : ''), value: t.value, art: { artist: ar, album: al } }; });
        if (albums.length) { sectionHeader('Top albums'); await rankedBars(albums, { valueLabel: v => v + (v === 1 ? ' play' : ' plays'), covers: true }); }
      } else if (entries.length) {
        const movies = entries.filter(e => !isTv(e)), eps = entries.filter(isTv);
        newPageIfNeeded(60);
        y = this._pdfDrawSegmentedBar(doc, theme, [
          { label: 'Movies', value: movies.reduce((s, e) => s + watchedMs(e), 0) || movies.length, color: PALETTE[0] },
          { label: 'TV episodes', value: eps.reduce((s, e) => s + watchedMs(e), 0) || eps.length, color: PALETTE[1] },
        ], marginX, y + 4, pageW, { title: 'Movies vs TV (time watched)', newPageIfNeeded });
        sectionHeader('Top titles by time watched');
        await rankedBars(countBy(entries, e => isTv(e) ? (e.seriesTitle || e.title) : e.title, e => watchedMs(e)).slice(0, 10)
          .map(t => ({ ...t, art: { video: t.label } })),
          { valueLabel: v => fmtDur(v), covers: true });
      }

      // ── YouTube ── its own section: how much, which channels, when, and the videos
      if (!isMusic && yt.length) {
        if (!entries.length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...mutedRgb);
          doc.text('No films or TV in this period.', marginX, y); y += 18;
        }
        newPageIfNeeded(140);
        y += entries.length ? 22 : 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...inkRgb);
        doc.text('YouTube', marginX, y);
        y += 6;
        doc.setDrawColor(255, 0, 51); doc.setLineWidth(1);
        doc.line(marginX, y, pageW - marginX, y);
        y += 16;
        const ytMs = e => (e.watchedMs > 0 ? e.watchedMs : 0);
        const channels = new Set(yt.map(e => (e.channel || '').toLowerCase()).filter(Boolean));
        statCards([
          { label: 'Videos', value: String(yt.length), accent: true },
          { label: 'Time watched', value: fmtDur(yt.reduce((s, e) => s + ytMs(e), 0)) || '-' },
          { label: 'Channels', value: String(channels.size || '-') },
        ]);
        const chans = countBy(yt, e => e.channel || '', e => ytMs(e) / 60000).filter(c => c.value > 0).slice(0, 8);
        if (chans.length > 1) {
          sectionHeader('Top channels by time watched');
          await rankedBars(chans.map(c => ({ ...c, color: '#FF0033' })), { valueLabel: v => fmtDur(v * 60000) });
        }
        // when, by time of day (only worth a chart with a few videos)
        if (yt.length >= 3) {
          const tod = ['Morning', 'Afternoon', 'Evening', 'Night'].map(label => ({ label, value: 0 }));
          yt.forEach(e => { const h = new Date(e.ts).getHours(); tod[h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3].value += Math.max(1, Math.round(ytMs(e) / 60000)); });
          newPageIfNeeded(170);
          const halfW = (contentW - 16) / 2;
          y = this._pdfDrawCategoryBarChart(doc, theme, tod, marginX, y + 4, marginX * 2 + halfW, { title: 'When you watch YouTube' });
        }
        // the videos themselves, most recent first (the heading never sits alone at the foot of a page)
        newPageIfNeeded(90);
        sectionHeader(yt.length > 15 ? 'Latest videos' : 'Videos');
        const list = yt.slice().reverse().slice(0, 15);
        list.forEach((e, k) => {
          newPageIfNeeded(26);
          if (k % 2 === 0) { doc.setFillColor(...zebraRgb); doc.rect(marginX, y - 9, contentW, 24, 'F'); }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...inkRgb);
          const timeLbl = fmtDur(ytMs(e));
          const right = new Date(e.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + (ytMs(e) >= 60000 ? ' - ' + timeLbl : '');
          const maxW = contentW - 16 - doc.getTextWidth(right) - 12;
          let t = clean(e.title);
          while (doc.getTextWidth(t) > maxW && t.length > 4) t = t.slice(0, -2);
          if (t !== clean(e.title)) t = t.trimEnd() + '...';
          doc.text(t, marginX + 8, y + 1);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
          if (e.channel) doc.text(clean(e.channel), marginX + 8, y + 11);
          doc.text(right, marginX + contentW - 8, y + 1, { align: 'right' });
          y += 26;
        });
        if (yt.length > list.length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...mutedRgb);
          newPageIfNeeded(14); doc.text('...and ' + (yt.length - list.length) + ' more', marginX + 8, y + 2); y += 14;
        }
      }


    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    if (preview.closed) return;
    const slug = (isMusic ? 'music' : 'watch') + '-report-' + (range === 'today' ? 'today' : range === 'all' ? 'all-time' : range + '-days');
    this._showPDFPreview(doc, 'crow-media-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // ── PDF chart helpers ───────────────────────────────────────────────────
  _pdfFillPolygon(doc, points) {
    if (!points || points.length < 3) return;
    const start = points[0];
    const segs = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    doc.lines(segs, start[0], start[1], [1, 1], 'F', true);
  },

  _pdfDrawRing(doc, theme, items, cx, cy, outerR, innerR) {
    const usable = (items || []).filter(i => i.value > 0);
    if (!usable.length) return;
    const total = usable.reduce((s, i) => s + i.value, 0);
    const stepDeg = 4;
    let startDeg = -90;
    usable.forEach(item => {
      const endDeg = startDeg + (item.value / total) * 360;
      const pts = [];
      for (let a = startDeg; a < endDeg; a += stepDeg) {
        const r = a * Math.PI / 180;
        pts.push([cx + outerR * Math.cos(r), cy + outerR * Math.sin(r)]);
      }
      const rEnd = endDeg * Math.PI / 180;
      pts.push([cx + outerR * Math.cos(rEnd), cy + outerR * Math.sin(rEnd)]);
      pts.push([cx + innerR * Math.cos(rEnd), cy + innerR * Math.sin(rEnd)]);
      for (let a = endDeg; a > startDeg; a -= stepDeg) {
        const r = a * Math.PI / 180;
        pts.push([cx + innerR * Math.cos(r), cy + innerR * Math.sin(r)]);
      }
      const rStart = startDeg * Math.PI / 180;
      pts.push([cx + innerR * Math.cos(rStart), cy + innerR * Math.sin(rStart)]);
      doc.setFillColor(...theme.hexToRgb(item.color || this._config.accent_color || '#007AFF'));
      this._pdfFillPolygon(doc, pts);
      startDeg = endDeg;
    });
  },

  _pdfDrawDonutWithBars(doc, theme, items, marginX, y, pageW, { title = null, newPageIfNeeded = null } = {}) {
    const usable = (items || []).filter(i => i.value > 0);
    if (!usable.length) return y;
    if (newPageIfNeeded) newPageIfNeeded(100);
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    const outerR = 34, innerR = 17;
    const cx = marginX + outerR, cy = y + outerR;
    this._pdfDrawRing(doc, theme, usable, cx, cy, outerR, innerR);

    // Names get as much room as the longest one needs (up to about half the
    // space); the bars fill the rest, with the percentage inside the margin.
    const labelX = marginX + outerR * 2 + 20;
    const rightEdge = pageW - marginX;
    const pctW = 28;
    doc.setFontSize(8.5);
    const longest = usable.reduce((m, i) => { doc.setFont(undefined, i.bold ? 'bold' : 'normal'); return Math.max(m, doc.getTextWidth(String(i.label))); }, 0);
    const labelW = Math.min(longest, (rightEdge - labelX - pctW) * 0.5);
    const barX = labelX + labelW + 12;
    const barMaxW = rightEdge - pctW - barX;
    const total = usable.reduce((s, i) => s + i.value, 0);
    let by = y + 4;
    usable.forEach(item => {
      const pct = item.value / total;
      doc.setFontSize(8.5); doc.setFont(undefined, item.bold ? 'bold' : 'normal'); theme.setInk();
      let lab = String(item.label);
      if (doc.getTextWidth(lab) > labelW) { while (lab.length > 2 && doc.getTextWidth(lab + '...') > labelW) lab = lab.slice(0, -1); lab = lab.trimEnd() + '...'; }
      doc.text(lab, labelX, by + 8);
      doc.setFillColor(...theme.zebraRgb);
      doc.roundedRect(barX, by, barMaxW, 10, 2, 2, 'F');
      doc.setFillColor(...theme.hexToRgb(item.color || this._config.accent_color || '#007AFF'));
      doc.roundedRect(barX, by, Math.max(barMaxW * pct, 3), 10, 2, 2, 'F');
      theme.setMuted();
      doc.text(`${Math.round(pct * 100)}%`, rightEdge, by + 8, { align: 'right' });
      by += 17;
    });
    const ringBottom = y + outerR * 2 + 6;
    return Math.max(ringBottom, by) + 10;
  },

  _pdfDrawSegmentedBar(doc, theme, items, marginX, y, pageW, { title = null, newPageIfNeeded = null } = {}) {
    const usable = (items || []).filter(i => i.value > 0);
    if (!usable.length) return y;
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    const total = usable.reduce((s, i) => s + i.value, 0);
    const barMaxW = pageW - marginX * 2 - 130;
    usable.forEach(item => {
      if (newPageIfNeeded) newPageIfNeeded(18);
      const pct = item.value / total;
      const rgb = item.color ? theme.hexToRgb(item.color) : theme.accentRgb;
      doc.setFontSize(8.5); doc.setFont(undefined, item.bold ? 'bold' : 'normal'); theme.setInk();
      doc.text(String(item.label), marginX, y + 8);
      doc.setFillColor(...theme.zebraRgb);
      doc.roundedRect(marginX + 110, y, barMaxW, 10, 2, 2, 'F');
      doc.setFillColor(...rgb);
      doc.roundedRect(marginX + 110, y, Math.max(barMaxW * pct, 3), 10, 2, 2, 'F');
      theme.setMuted();
      doc.text(`${Math.round(pct * 100)}%`, marginX + 114 + barMaxW, y + 8);
      y += 17;
    });
    return y + 4;
  },

  _pdfDrawBarChart(doc, theme, dailyTotals, marginX, y, pageW, { color = null, unitSuffix = '', title = null } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!dailyTotals || !dailyTotals.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data in this range.', marginX, y);
      return y + 16;
    }
    const chartH = 110;
    const chartW = pageW - marginX * 2;
    const padTop = 8, padBottom = 18, padLeftAxis = 26, padRight = 6;
    const plotX = marginX + padLeftAxis;
    const plotW = chartW - padLeftAxis - padRight;
    const plotTop = y + padTop;
    const plotH = chartH - padTop - padBottom;
    const baseY = plotTop + plotH;

    doc.setFillColor(...theme.zebraRgb);
    doc.roundedRect(marginX, y, chartW, chartH, 6, 6, 'F');

    const maxVal = Math.max(...dailyTotals.map(d => d.value), 1);
    const n = dailyTotals.length;
    const slot = plotW / n;
    const barW = Math.max(1, slot - (n > 40 ? 0.5 : 2));
    doc.setFillColor(...(color ? theme.hexToRgb(color) : theme.accentRgb));
    dailyTotals.forEach((d, i) => {
      const h = (d.value / maxVal) * plotH;
      if (h > 0.3) doc.rect(plotX + i * slot, baseY - h, barW, h, 'F');
    });

    doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setMuted();
    doc.text(`${Math.round(maxVal)}${unitSuffix}`, marginX + 2, plotTop + 6);

    const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
    doc.setFontSize(7.5);
    doc.text(fmtDate(dailyTotals[0].date), plotX, y + chartH - 5);
    const lastLabel = fmtDate(dailyTotals[n - 1].date);
    doc.text(lastLabel, plotX + plotW - doc.getTextWidth(lastLabel), y + chartH - 5);

    return y + chartH + 20;
  },

  _pdfDrawCategoryBarChart(doc, theme, items, marginX, y, pageW, { color = null, title = null, showValues = true } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    const usable = items || [];
    if (!usable.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data in this range.', marginX, y);
      return y + 16;
    }
    const chartH = 120;
    const chartW = pageW - marginX * 2;
    const padTop = 16, padBottom = 22, padSide = 6;
    const plotW = chartW - padSide * 2;
    const plotTop = y + padTop;
    const plotH = chartH - padTop - padBottom;
    const baseY = plotTop + plotH;

    doc.setFillColor(...theme.zebraRgb);
    doc.roundedRect(marginX, y, chartW, chartH, 6, 6, 'F');

    const maxVal = Math.max(...usable.map(i => i.value), 1);
    const n = usable.length;
    const slot = plotW / n;
    const barW = Math.max(2, Math.min(22, slot - 8));
    usable.forEach((item, i) => {
      const x = marginX + padSide + i * slot + (slot - barW) / 2;
      const h = maxVal > 0 ? (item.value / maxVal) * plotH : 0;
      doc.setFillColor(...(item.color ? theme.hexToRgb(item.color) : (color ? theme.hexToRgb(color) : theme.accentRgb)));
      if (h > 0.3) doc.rect(x, baseY - h, barW, h, 'F');
      if (showValues && item.value > 0) {
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setInk();
        const valText = String(item.value);
        doc.text(valText, x + barW / 2 - doc.getTextWidth(valText) / 2, baseY - h - 4);
      }
      // Long labels (a date, a multi-word category) get shrunk to fit the
      // slot rather than overlapping the next bar's label.
      doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setMuted();
      let label = String(item.label);
      while (doc.getTextWidth(label) > slot && label.length > 3) label = label.slice(0, -2) + '…';
      doc.text(label, x + barW / 2 - doc.getTextWidth(label) / 2, y + chartH - 6);
    });

    return y + chartH + 20;
  },

  // ── List PDFs (queue, albums, playlists, episode guides, pins, results) ──
  // One shared layout: a masthead (title + accent subtitle), optionally the
  // artwork beside grey detail rows, an optional paragraph, then sections of
  // one-line entries — number, title, a grey detail after it, a value on the
  // right, an optional small thumbnail and an optional "watched" tick.
  //
  // spec = { title, subtitle, heroSrc, rows: [[LABEL, value]], intro,
  //          sections: [{ heading, thumbs, items: [{ num, title, sub, right, thumb, tick }] }],
  //          filename }
  async _exportListPDF(makeSpec) {
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    try {
      preview.status('Gathering the details\u2026');
      const spec = await makeSpec(preview);
      if (!spec) { preview.fail('Nothing to export.'); return; }
      let key = null;
      try { key = 'list|' + this._pdfHash(JSON.stringify(spec)); } catch (_) {}
      if (this._pdfFromSession(key, preview)) return;
      await this._buildListPDF(spec, preview);
    } catch (e) {
      console.warn('[Crow Media Player] list PDF failed', e);
      preview.fail('Couldn’t create the PDF. Please try again.');
    } finally { this._pdfBusy = false; }
  },

  async _buildListPDF(spec, preview) {
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }
    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2;
    const bottom = pageH - 40;
    const hexToRgb = hex => {
      const h = String(hex || '#007AFF').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
      const n = parseInt(full, 16);
      return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247], tickRgb = [52, 199, 89];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    const clean = s => String(s ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
      .replace(/[•●]/g, '·')
      .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();
    const fit = (str, maxW) => {
      if (doc.getTextWidth(str) <= maxW) return str;
      let out = str;
      while (out.length > 1 && doc.getTextWidth(out + '...') > maxW) out = out.slice(0, -1);
      return out.trimEnd() + '...';
    };
    let y = 44;
    const newPage = () => { doc.addPage(); y = 44; };
    const newPageIfNeeded = need => { if (y + need > bottom) { newPage(); return true; } return false; };

    // ── Masthead ──
    const title = clean(spec.title) || 'Crow Media Player';
    const sub = clean(spec.subtitle);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    if (!sub || doc.getTextWidth(title + '  ' + sub) <= contentW) {
      doc.setTextColor(...inkRgb); doc.text(fit(title, contentW), marginX, y);
      if (sub) { doc.setTextColor(...accentRgb); doc.text('  ' + sub, marginX + doc.getTextWidth(title), y); }
    } else {
      doc.setTextColor(...inkRgb);
      doc.splitTextToSize(title, contentW).forEach((l, k, a) => { doc.text(l, marginX, y); if (k < a.length - 1) y += 22; });
      y += 22; doc.setTextColor(...accentRgb); doc.text(fit(sub, contentW), marginX, y);
    }
    y += 7;
    doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 16;

    // ── Artwork beside the grey rows ──
    const rows = (spec.rows || []).filter(r => r && r[1] !== '' && r[1] != null).map(([l, v]) => [clean(l).toUpperCase(), clean(v)]);
    if (spec.heroSrc) preview?.status?.('Fetching artwork\u2026');
    const img = spec.heroSrc ? await this._pdfImageData(spec.heroSrc) : null;
    preview?.status?.('Building pages\u2026');
    const artGap = 16, rowGap = 3;
    // Label column sized from the widest label (8pt bold) + 8pt left padding + 10pt gap,
    // so long labels like "TIME WATCHED" never run into their values
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const fitLabelW = Math.ceil(rows.reduce((m, [lab]) => Math.max(m, doc.getTextWidth(lab)), 0)) + 18;
    let labelW = Math.max(112, fitLabelW), colX = marginX, colW = contentW, artBottom = y;
    const measure = w => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      return rows.map(([lab, val]) => { const vl = doc.splitTextToSize(val, w - labelW - 8); return { lab, vl, h: Math.max(20, vl.length * 13 + 7) }; });
    };
    let laid = measure(colW);
    if (img) {
      labelW = Math.max(64, fitLabelW);
      laid = measure(contentW - 92 - artGap);
      const rowsH = laid.reduce((h, r) => h + r.h, 0) + rowGap * Math.max(0, laid.length - 1);
      const side = rows.length ? Math.max(64, Math.min(110, rowsH)) : 90;
      const h = Math.min(side, side * (img.h / img.w)), w = h * (img.w / img.h);
      try {
        doc.addImage(img.data, 'JPEG', marginX, y, w, h);
        colX = marginX + w + artGap; colW = contentW - w - artGap; artBottom = y + h;
        laid = measure(colW);
      } catch (_) { labelW = Math.max(112, fitLabelW); colX = marginX; colW = contentW; laid = measure(colW); }
    }
    let ty = y + 13;
    laid.forEach(({ lab, vl, h }) => {
      doc.setFillColor(...zebraRgb);
      doc.roundedRect(colX, ty - 13, colW, h, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text(lab, colX + 8, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      vl.forEach((ln, k) => doc.text(ln, colX + labelW, ty + k * 13));
      ty += h + rowGap;
    });
    if (img || laid.length) y = Math.max(laid.length ? ty - 13 - rowGap : y, artBottom) + 20;

    // ── Intro paragraph ──
    const intro = clean(spec.intro);
    if (intro) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      doc.splitTextToSize(intro, contentW).forEach(l => { newPageIfNeeded(14); doc.text(l, marginX, y); y += 14; });
      y += 8;
    }

    // ── Charts ──
    // spec.charts: { type: 'days' (dated bars) | 'category' | 'donut' |
    // 'segmented' | 'ranked' | 'pair' (two category charts side by side),
    // title, items, ... }
    if (spec.charts?.length) {
      const theme = {
        hexToRgb, inkRgb, mutedRgb, zebraRgb, accentRgb,
        setInk: () => doc.setTextColor(...inkRgb), setMuted: () => doc.setTextColor(...mutedRgb), setAccent: () => doc.setTextColor(...accentRgb),
      };
      const accentHex = this._config?.accent_color || '#007AFF';
      const PALETTE = [accentHex, '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA', '#8E8E93'];
      const colour = list => list.map((it, i) => ({ ...it, label: clean(it.label), color: it.color || PALETTE[i % PALETTE.length] }));
      for (const ch of spec.charts) {
        if (!ch) continue;
        const items = (ch.items || []).filter(Boolean);
        const total = items.reduce((t, it) => t + (Number(it.value) || 0), 0);
        if (ch.type !== 'pair' && (!items.length || !total)) continue;
        if (ch.type === 'days') {
          newPageIfNeeded(150);
          y = this._pdfDrawBarChart(doc, theme, items, marginX, y + 10, pageW, { title: ch.title, unitSuffix: ch.unitSuffix || '' });
        } else if (ch.type === 'category') {
          newPageIfNeeded(160);
          y = this._pdfDrawCategoryBarChart(doc, theme, items, marginX, y + 10, pageW, { title: ch.title, showValues: ch.showValues !== false });
        } else if (ch.type === 'donut') {
          if (items.filter(it => it.value > 0).length < 2) continue;   // one slice says nothing
          newPageIfNeeded(110);
          y = this._pdfDrawDonutWithBars(doc, theme, colour(items), marginX, y + 10, pageW, { title: ch.title, newPageIfNeeded });
        } else if (ch.type === 'segmented') {
          newPageIfNeeded(60);
          y = this._pdfDrawSegmentedBar(doc, theme, colour(items), marginX, y + 10, pageW, { title: ch.title, newPageIfNeeded });
        } else if (ch.type === 'pair') {
          const [a, b] = ch.charts || [];
          const ok = c => c && (c.items || []).some(it => it.value > 0);
          if (!ok(a) && !ok(b)) continue;
          newPageIfNeeded(170);
          const halfW = (contentW - 16) / 2, yStart = y + 10;
          const y1 = ok(a) ? this._pdfDrawCategoryBarChart(doc, theme, a.items, marginX, yStart, marginX * 2 + halfW, { title: a.title, showValues: a.showValues !== false }) : yStart;
          const x2 = marginX + halfW + 16;
          const y2 = ok(b) ? this._pdfDrawCategoryBarChart(doc, theme, b.items, x2, yStart, x2 * 2 + halfW, { title: b.title, showValues: b.showValues !== false }) : yStart;
          y = Math.max(y1, y2);
        } else if (ch.type === 'ranked') {
          // Ranked bars — name, bar, value — optionally with covers
          newPageIfNeeded(40);
          y += 10;
          doc.setFillColor(...accentRgb); doc.rect(marginX, y - 10, 3, 13, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...inkRgb); doc.text(clean(ch.title), marginX + 9, y);
          y += 18;
          let thumbs = [];
          if (ch.covers) {
            preview?.status?.('Fetching artwork\u2026');
            const budget = { itunes: 10 };
            thumbs = await Promise.all(items.map(it => (it.art || it.thumb) ? this._pdfThumbFor({ art: it.art, thumb: it.thumb }, budget).catch(() => null) : null));
            preview?.status?.('Building pages\u2026');
          }
          const useThumbs = thumbs.some(Boolean);
          const rowH = useThumbs ? 24 : 16, off = useThumbs ? 6 : 0, thumbW = useThumbs ? 26 : 0;
          const max = Math.max(...items.map(it => it.value), 1);
          const labelW = 180 - thumbW, valW = 58, barX = marginX + thumbW + labelW + 8, barW = contentW - thumbW - labelW - 8 - valW;
          items.forEach((it, k) => {
            newPageIfNeeded(rowH);
            if (useThumbs) {
              const td = thumbs[k];
              if (td) { try { doc.addImage(td.data, 'JPEG', marginX, y - 1, 20, 20); } catch (_) {} }
              else { doc.setFillColor(...zebraRgb); doc.roundedRect(marginX, y - 1, 20, 20, 2, 2, 'F'); }
            }
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...inkRgb);
            doc.text(fit((k + 1) + '. ' + clean(it.label), labelW), marginX + thumbW, y + 8 + off);
            doc.setFillColor(...zebraRgb); doc.roundedRect(barX, y + off, barW, 10, 2, 2, 'F');
            doc.setFillColor(...accentRgb); doc.roundedRect(barX, y + off, Math.max(3, barW * (it.value / max)), 10, 2, 2, 'F');
            doc.setTextColor(...mutedRgb); doc.setFontSize(8.5);
            doc.text(ch.valueLabel ? ch.valueLabel(it.value) : String(it.value), marginX + contentW, y + 8 + off, { align: 'right' });
            y += rowH;
          });
          y += 6;
        }
      }
      y += 4;
    }

    // ── Sections ──
    const drawTick = (x, yy) => {
      doc.setDrawColor(...tickRgb); doc.setLineWidth(1.6);
      if (doc.setLineCap) doc.setLineCap('round');
      doc.line(x, yy - 3.5, x + 3, yy - 0.5);
      doc.line(x + 3, yy - 0.5, x + 8.5, yy - 7.5);
      if (doc.setLineCap) doc.setLineCap('butt');
    };
    for (const sec of spec.sections || []) {
      const items = (sec.items || []).filter(it => it && clean(it.title));
      if (!items.length) continue;
      // Section heading (kept with at least two entries)
      newPageIfNeeded(56);
      if (sec.heading) {
        y += 6;
        doc.setFillColor(...accentRgb);
        doc.rect(marginX, y - 10, 3, 13, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb);
        doc.text(clean(sec.heading), marginX + 9, y);
        if (sec.note) {
          const hw = doc.getTextWidth(clean(sec.heading));
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...mutedRgb);
          doc.text(clean(sec.note), marginX + 9 + hw + 8, y);
        }
        y += 16;
      }
      // Thumbnails (fetched a few at a time; anything slow or blocked is skipped)
      // Same sources the on-screen lists use: the image itself, Music
      // Assistant's image proxy, then iTunes. Capped so a huge playlist
      // doesn't take minutes to build.
      const THUMB_CAP = 500;
      const thumbItems = sec.thumbs ? items.slice(0, THUMB_CAP) : [];
      const thumbData = [];
      if (thumbItems.some(it => it.thumb || it.art)) {
        const budget = { itunes: 80 };
        let next = 0, done = 0, skipped = false;
        const total = thumbItems.length;
        preview?.progress?.('Fetching artwork\u2026', 0, total);
        if (total > 20) preview?.offerSkip?.(() => { skipped = true; });
        const worker = async () => {
          while (next < total && !skipped && !preview?.closed) {
            const i = next++;
            thumbData[i] = await this._pdfThumbFor(thumbItems[i], budget).catch(() => null);
            done++;
            if (!skipped) preview?.progress?.('Fetching artwork\u2026', done, total);
          }
        };
        // Skipping stops waiting at once — fetches already under way are left to finish on their own
        let release;
        const skipWait = new Promise(res => { release = res; });
        const poll = setInterval(() => { if (skipped || preview?.closed) release(); }, 200);
        await Promise.race([Promise.all(Array.from({ length: 6 }, worker)), skipWait]);
        clearInterval(poll);
        preview?.clearSkip?.();
      }
      preview?.status?.('Building pages\u2026');
      const useThumbs = thumbData.some(Boolean);
      const rowH = useThumbs ? 26 : 16;
      const hasNums = items.some(it => it.num != null && it.num !== '');
      const hasTicks = items.some(it => it.tick != null);
      items.forEach((it, idx) => {
        newPageIfNeeded(rowH);
        let x = marginX;
        const base = useThumbs ? y + 4 : y;   // text baseline
        if (hasTicks) { if (it.tick) drawTick(x, base); x += 14; }
        if (hasNums) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
          doc.text(clean(it.num), x + 18, base, { align: 'right' });
          x += 26;
        }
        if (useThumbs) {
          const td = thumbData[idx];
          if (td) { try { doc.addImage(td.data, 'JPEG', x, y - 9, 20, 20); } catch (_) {} }
          else { doc.setFillColor(...zebraRgb); doc.roundedRect(x, y - 9, 20, 20, 2, 2, 'F'); }
          x += 28;
        }
        const right = clean(it.right);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); 
        const rightW = right ? doc.getTextWidth(right) + 12 : 0;
        if (right) { doc.setTextColor(...mutedRgb); doc.text(right, marginX + contentW, base, { align: 'right' }); }
        const avail = marginX + contentW - rightW - x;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
        const t = fit(clean(it.title), avail * (it.sub ? 0.62 : 1));
        doc.text(t, x, base);
        const subT = clean(it.sub);
        if (subT) {
          const tw = doc.getTextWidth(t);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...mutedRgb);
          doc.text(fit(subT, avail - tw - 10), x + tw + 10, base);
        }
        y += rowH;
      });
      y += 6;
    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    if (preview.closed) return;
    const slug = (spec.filename || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'list';
    this._showPDFPreview(doc, 'crow-media-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // Small formatting helpers for the list exports
  _pdfFmtDuration(sec) {
    const s = Math.round(Number(sec) || 0);
    if (!s) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0') : m + ':' + String(r).padStart(2, '0');
  },

  _pdfFmtTotal(sec) {
    const m = Math.round((Number(sec) || 0) / 60);
    if (!m) return '';
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' hr ' + (m % 60) + ' min';
  },

  // ── Export: the current queue ──
  _exportQueuePDF() {
    if (!this._pdfOn('lists')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      const content = this.shadowRoot?.getElementById('infoContent');
      const q = content?._queueItemsFull;
      if (!q || (!q.current && !(q.after || []).length)) return null;
      const all = [q.current, ...(q.after || [])].filter(Boolean);
      const total = all.reduce((s, t) => s + (Number(t.duration) || 0), 0);
      const item = (t, n) => ({ num: n, title: t.title, sub: [t.artist, t.album].filter(Boolean).join(' · '), right: this._pdfFmtDuration(t.duration), thumb: t.thumbnail || null, art: { artist: t.artist, album: t.album, title: t.title } });
      return {
        title: 'Queue', subtitle: this._entityDisplayName(this._entity) || '',
        heroSrc: q.current?.thumbnail || null,
        rows: [['Tracks', String(all.length)], ['Length', this._pdfFmtTotal(total)], ['Now playing', q.current ? [q.current.title, q.current.artist].filter(Boolean).join(' - ') : '']],
        sections: [
          { heading: 'Now playing', thumbs: true, items: q.current ? [item(q.current, 1)] : [] },
          { heading: 'Coming up', thumbs: true, items: (q.after || []).map((t, i) => item(t, i + 2)) },
        ],
        filename: 'queue',
      };
    });
  },

  // ── Export: a pinned queue ──
  _exportSavedQueuePDF(sq) {
    if (!this._pdfOn('lists')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      const tracks = sq?.tracks || [];
      if (!tracks.length) return null;
      const total = tracks.reduce((s, t) => s + (Number(t.duration) || 0), 0);
      return {
        title: sq.name || 'Pinned Queue', subtitle: 'Pinned queue',
        heroSrc: tracks.find(t => t.thumbnail || t.image)?.thumbnail || tracks.find(t => t.image)?.image || null,
        rows: [['Tracks', String(tracks.length)], ['Length', this._pdfFmtTotal(total)],
          ['Pinned', sq.createdAt ? new Date(sq.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '']],
        sections: [{ heading: 'Tracks', thumbs: true, items: tracks.map((t, i) => ({
          num: i + 1, title: t.title || t.name, sub: [t.artist, t.album].filter(Boolean).join(' · '),
          right: this._pdfFmtDuration(t.duration), thumb: t.thumbnail || t.image || null, art: { artist: t.artist, album: t.album, title: t.title || t.name } })) }],
        filename: 'queue-' + (sq.name || ''),
      };
    });
  },

  // ── Export: an album or playlist from the library ──
  _exportCollectionPDF(item, tab, tracks) {
    if (!this._pdfOn('lists')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      if (!tracks?.length) return null;
      const artistsOf = t => (t.artists || []).map(a => a?.name || a).filter(Boolean).join(', ');
      const total = tracks.reduce((s, t) => s + (Number(t.duration) || 0), 0);
      const isAlbum = tab === 'album';
      const owner = isAlbum ? artistsOf(item) : (item.owner || '');
      const year = item.year || item.metadata?.year || (item.metadata?.release_date || '').slice(0, 4) || '';
      const genre = (item.metadata?.genres || []).slice(0, 3).join(', ');
      return {
        title: item.name || item.title || (isAlbum ? 'Album' : 'Playlist'),
        subtitle: owner || (isAlbum ? 'Album' : 'Playlist'),
        heroSrc: item.image || item.metadata?.images?.[0]?.path || tracks.find(t => t.image)?.image || null,
        rows: [['Type', isAlbum ? 'Album' : 'Playlist'], ['Year', year], ['Tracks', String(tracks.length)], ['Length', this._pdfFmtTotal(total)], ['Genre', genre]],
        sections: [{ heading: 'Tracklist', thumbs: !isAlbum, items: tracks.map((t, i) => ({
          num: t.track_number || i + 1, title: t.name || t.title,
          sub: isAlbum ? (artistsOf(t) !== owner ? artistsOf(t) : '') : [artistsOf(t), t.album?.name].filter(Boolean).join(' · '),
          right: this._pdfFmtDuration(t.duration), thumb: t.image || null, art: { artist: artistsOf(t), album: t.album?.name || '', title: t.name || t.title } })) }],
        filename: (isAlbum ? 'album-' : 'playlist-') + (item.name || ''),
      };
    });
  },

  // ── Export: a TV show's episode guide ──
  // Episodes from TVmaze (free, cached), or the AI's cached lists for any
  // season TVmaze doesn't have; episodes in Watch History are ticked.
  // onlySeason: just that season (a season row's Export Season).
  _exportEpisodeGuidePDF(data, artUrl, onlySeason = null) {
    if (!this._pdfOn('info')) return;   // switched off in the card editor
    this._exportListPDF(async (preview) => {
      const showTitle = data?.title || '';
      if (!showTitle) return null;
      preview?.status?.('Looking up episodes\u2026');
      const tm = (await this._tvmazeEpisodes(showTitle).catch(() => null)) || [];
      const seasons = Math.max(data.seasons || 0, tm.reduce((m, e) => Math.max(m, e.season || 0), 0));
      const key = showTitle.toLowerCase().trim();
      if (!this._tvEpisodesCache) this._tvEpisodesCache = new Map();
      const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const watched = new Set(this._getWatchLogEntries()
        .filter(e => norm(e.seriesTitle || e.title) === norm(showTitle) && Number.isFinite(e.season) && Number.isFinite(e.episode))
        .map(e => e.season + 'x' + e.episode));
      const fmtDate = d => { const t = Date.parse(d || ''); return isNaN(t) ? '' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
      const sections = [];
      let total = 0;
      const one = Number.isFinite(+onlySeason) && +onlySeason > 0 ? +onlySeason : null;
      for (let n = one || 1; n <= (one || seasons); n++) {
        // Episode titles are stored HTML-escaped for the panel; the PDF wants plain text.
        const unesc = v => String(v || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        let eps = tm.filter(e => e.season === n).map(e => ({ ep: e.ep, title: unesc(e.title), airdate: e.airdate }));
        if (!eps.length) {
          const ai = this._aiCachedRead(this._tvEpisodesCache, 'tvEpisodes', `${key}|s${n}|v2`);
          if (Array.isArray(ai)) eps = ai.map(e => ({ ep: e.ep, title: unesc(e.title), airdate: e.airdate }));
        }
        if (!eps.length) continue;
        total += eps.length;
        const seen = eps.filter(e => watched.has(n + 'x' + e.ep)).length;
        sections.push({ heading: 'Season ' + n, note: eps.length + ' episodes' + (seen ? '  ·  ' + seen + ' watched' : ''),
          items: eps.map(e => ({ num: e.ep, title: e.title || ('Episode ' + e.ep), right: fmtDate(e.airdate), tick: watched.has(n + 'x' + e.ep) })) });
      }
      if (!sections.length) return null;
      return {
        title: showTitle, subtitle: one ? 'Season ' + one : (data.year || ''),
        heroSrc: artUrl || null,
        rows: one
          ? [['Season', String(one)], ['Episodes', String(total)], ['Watched', (() => { const w = sections[0]?.items.filter(i => i.tick).length || 0; return w ? w + ' of ' + total : 'None yet'; })()],
            ['Genre', (data.genres || []).slice(0, 3).join(', ')]]
          : [['Seasons', String(seasons)], ['Episodes', String(total)], ['Watched', watched.size ? watched.size + ' of ' + total : 'None yet'],
            ['Genre', (data.genres || []).slice(0, 3).join(', ')]],
        sections,
        filename: 'episode-guide-' + showTitle + (one ? '-season-' + one : ''),
      };
    });
  },

  // ── Export: everything pinned ──
  _exportPinsPDF() {
    if (!this._pdfOn('pins')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      const first = v => Array.isArray(v) ? (v[0]?.name || v[0] || '') : (v?.name || v || '');
      const subFor = (it, key) => {
        switch (key) {
          case 'track':      return [first(it.artists) || it.artist, it.album?.name || it.album].filter(Boolean).join(' · ');
          case 'album':      return first(it.artists) || it.artist || '';
          case 'playlist':   return it.owner || '';
          case 'queues':     return (it.tracks || []).length + ' tracks';
          case 'stations':   return [it.country, (it.tags || '').split(',')[0]].filter(Boolean).join(' · ');
          case 'podcasts':   return it.artistName || '';
          case 'audiobooks': return it.author || '';
          case 'recaps':     return it.dateRangeLabel || '';
          case 'movies_tv':  return [it.year, it.kind === 'tv' ? 'TV Series' : 'Movie'].filter(Boolean).join(' · ');
          case 'charts':     return /^mt/.test(it.kind || '') ? 'Movies & TV' : it.country ? 'Apple Music' : 'Deezer';
          default: return '';
        }
      };
      const sections = this._pinnedCategoryDefs().map(cat => {
        const list = this._getPinnedCategoryItems(cat.key) || [];
        return { heading: cat.label, note: list.length + ' pinned', items: list.map(it => ({ title: this._pinnedItemDisplayName(it, cat.key), sub: subFor(it, cat.key) })) };
      }).filter(s => s.items.length);
      if (!sections.length) return null;
      const total = sections.reduce((n, s) => n + s.items.length, 0);
      return {
        title: 'Pins', subtitle: total + ' pinned items',
        sections, filename: 'pins',
      };
    });
  },

  // Share by speaker (top five plus Other)
  _pdfSpeakerShare(entries, valueFn = () => 1) {
    const m = {};
    (entries || []).forEach(e => { if (e?.entity) m[e.entity] = (m[e.entity] || 0) + valueFn(e); });
    const list = Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: this._entityDisplayName(k) || k, value: Math.round(v * 10) / 10 }));
    if (list.length > 6) list.splice(5, list.length, { label: 'Other', value: list.slice(5).reduce((t, x) => t + x.value, 0) });
    return list;
  },

  // ── Export: one title's Watch History (a show or movie) ──
  _exportWatchTitlePDF(g, artUrl) {
    if (!this._pdfOn('history')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      if (!g?.viewings?.length) return null;
      const isTv = g.kind === 'tv';
      const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const count = g.viewings.length;
      return {
        title: g.title, subtitle: isTv ? 'TV Show' : 'Movie',
        heroSrc: artUrl || null,
        rows: [['Watches', String(count)],
          ['Time watched', g.watchedMs >= 60000 ? this._watchDuration(g.watchedMs) : ''],
          ['First watched', fmtDay(g.firstTs)], ['Last watched', fmtDay(g.lastTs)]],
        sections: [{ heading: 'Watch history', items: g.viewings.map(v => ({
          title: isTv ? (this._watchEpisodeLabel(v.entry, g.title, false) || 'Episode') : fmtDay(v.lastTs),
          sub: [isTv ? fmtDay(v.lastTs) : '', fmtTime(v.lastTs), v.entry?.entity ? (this._entityDisplayName(v.entry.entity) || '') : ''].filter(Boolean).join(' · '),
          right: v.watchedMs >= 60000 ? this._watchDuration(v.watchedMs) : '',
        })) }],
        charts: (() => {
          const ents = g.entries || [];
          const mins = e => (e.watchedMs || 0) / 60000;
          const tb = this._pdfTimeBuckets(ents, mins);
          return [
            { type: 'donut', title: 'Where you watch', items: this._pdfSpeakerShare(ents, mins) },
            count >= 3 ? { type: 'pair', charts: [{ title: 'Time of day', items: tb.tod }, { title: 'Day of the week', items: tb.dow }] } : null,
          ];
        })(),
        filename: 'watch-history-' + g.title,
      };
    });
  },

  // ── Export: Pinned Songs ──
  _exportPinnedSongsPDF(items) {
    if (!this._pdfOn('pins')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      if (!items?.length) return null;
      const artistsOf = t => (t.artists || []).map(a => a?.name || a).filter(Boolean).join(', ') || t.artist || '';
      const total = items.reduce((s, t) => s + (Number(t.duration) || 0), 0);
      return {
        title: 'Pinned Songs', subtitle: items.length + (items.length === 1 ? ' song' : ' songs'),
        rows: total ? [['Songs', String(items.length)], ['Length', this._pdfFmtTotal(total)]] : [],
        sections: [{ heading: 'Songs', thumbs: true, items: items.map((t, i) => ({
          num: i + 1, title: t.name || t.title || '', sub: [artistsOf(t), t.album?.name || (typeof t.album === 'string' ? t.album : '')].filter(Boolean).join(' · '),
          right: this._pdfFmtDuration(t.duration), thumb: t.image || t.thumbnail || null, art: { artist: artistsOf(t), album: t.album?.name || (typeof t.album === 'string' ? t.album : ''), title: t.name || t.title } })) }],
        filename: 'pinned-songs',
      };
    });
  },

  // ── Daily listening summaries ──
  // One small record per day (plays, time, top artists/tracks/albums,
  // speakers, time of day, stations), rebuilt from Music History. The
  // history itself only holds the most recent 2,000 plays, but these
  // summaries are kept for about six months, which is what "Your month in
  // music" reads. A day is only summarised once the history covers all of
  // it, and rebuilding gives the same result on every device, so copies
  // synced through Home Assistant never double-count.
  _listenDailyRollup() {
    try {
      const entries = this._getListenLogEntries().filter(e => e && e.ts);
      if (!entries.length) return;
      const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const oldest = entries.reduce((m, e) => Math.min(m, e.ts), Infinity);
      const partialDay = dayKey(oldest);
      const byDay = {};
      entries.forEach(e => { const k = dayKey(e.ts); if (k === partialDay) return; (byDay[k] = byDay[k] || []).push(e); });
      const lsKey = 'crow_media_ai_local_listenDaily';
      const store = JSON.parse(localStorage.getItem(lsKey) || '{}');
      const topN = (m, n) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));
      const inc = (m, k) => { if (k) m[k] = (m[k] || 0) + 1; };
      let changed = false;
      Object.entries(byDay).forEach(([k, list]) => {
        const a = {}, t = {}, al = {}, en = {}, stn = {}, h = [0, 0, 0, 0];
        let sec = 0;
        list.forEach(e => {
          sec += (e.durationMs || 0) / 1000;
          inc(a, e.artist);
          if (e.title) inc(t, e.title + '\u0001' + (e.artist || '') + '\u0001' + (e.album || ''));
          if (e.album && e.album.toLowerCase() !== (e.title || '').toLowerCase()) inc(al, e.album + '\u0001' + (e.artist || ''));
          inc(en, e.entity);
          inc(stn, e.station);
          const hr = new Date(e.ts).getHours();
          h[hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 22 ? 2 : 3]++;
        });
        const rec = { p: list.length, s: Math.round(sec), a: topN(a, 40), t: topN(t, 25), al: topN(al, 15), e: en, h, st: topN(stn, 10) };
        if (JSON.stringify(store[k]) !== JSON.stringify(rec)) { store[k] = rec; changed = true; }
      });
      const keep = dayKey(Date.now() - 190 * 864e5);
      Object.keys(store).forEach(k => { if (k < keep) { delete store[k]; changed = true; } });
      if (changed) {
        localStorage.setItem(lsKey, JSON.stringify(store));
        this._haStorageSaveAI('listenDaily');
      }
    } catch (_) { /* best effort */ }
  },

  // ── Export: an artist from the library ──
  _exportArtistPDF(item, tracks) {
    if (!this._pdfOn('lists')) return;   // switched off in the card editor
    this._exportListPDF(async (preview) => {
      const name = item?.name || '';
      if (!name) return null;
      const norm = v => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
      const nName = norm(name);
      // Bio: the one already looked up for this artist, else Wikipedia
      const bioKey = ('bio|' + name).toLowerCase();
      const bio = this._castBioCache?.get(bioKey) || this._aiLocalGet?.('castBio', bioKey) || null;
      let bioText = bio?.bio || '';
      if (!bioText) {
        preview?.status?.('Looking up the biography…');
        bioText = (await this._fetchWikipediaPersonSummary(name, true).catch(() => null))?.bio || '';
      }
      if (bioText.length > 900) bioText = bioText.slice(0, 900).replace(/\s+\S*$/, '') + '...';
      // Your listening, from Music History
      const log = this._getListenLogEntries().filter(e => (this._splitArtists(e.artist) || [e.artist]).some(a => norm(a) === nName));
      const songs = {};
      log.forEach(e => { const k = e.title; if (!k) return; if (!songs[k]) songs[k] = { title: k, album: e.album || '', n: 0 }; songs[k].n++; });
      const topSongs = Object.values(songs).sort((a, b) => b.n - a.n).slice(0, 10);
      const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const firstTs = log.reduce((m, e) => Math.min(m, e.ts), Infinity), lastTs = log.reduce((m, e) => Math.max(m, e.ts), 0);
      // Albums, from the artist's tracks in the library
      const albums = new Map();
      (tracks || []).forEach(t => {
        const an = t.album?.name || (typeof t.album === 'string' ? t.album : '');
        if (!an) return;
        if (!albums.has(an)) albums.set(an, { name: an, n: 0, year: t.album?.year || '', image: (t.album && typeof t.album === 'object' ? this._maImgUrl(t.album) : null) || t.image || null });
        albums.get(an).n++;
      });
      const albumList = [...albums.values()].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.name.localeCompare(b.name));
      let hero = this._maImgUrl(item);
      if (!hero) hero = await this._fetchWikipediaThumb(name).catch(() => null);
      return {
        title: name, subtitle: 'Artist', heroSrc: hero || null,
        rows: [['Plays', log.length ? String(log.length) : ''], ['First played', log.length ? fmtDay(firstTs) : ''],
          ['Last played', log.length ? fmtDay(lastTs) : ''], ['In your library', (tracks || []).length + ' tracks'],
          ['Born', bio?.born || ''], ['From', bio?.nationality || '']],
        intro: bioText,
        sections: [
          { heading: 'Your most played', note: 'from Music History', thumbs: true, items: topSongs.map((s, i) => ({
            num: i + 1, title: s.title, sub: s.album, right: s.n + (s.n === 1 ? ' play' : ' plays'), art: { artist: name, album: s.album, title: s.title } })) },
          { heading: 'Albums', thumbs: true, items: albumList.map(a => ({
            title: a.name, sub: [a.year, a.n + (a.n === 1 ? ' track' : ' tracks') + ' in your library'].filter(Boolean).join(' · '), thumb: a.image, art: { artist: name, album: a.name } })) },
        ],
        charts: log.length ? (() => {
          const tb = this._pdfTimeBuckets(log);
          return [
            { type: 'donut', title: 'Where you listen', items: this._pdfSpeakerShare(log) },
            log.length >= 5 ? { type: 'pair', charts: [{ title: 'Time of day', items: tb.tod }, { title: 'Day of the week', items: tb.dow }] } : null,
          ];
        })() : [],
        filename: 'artist-' + name,
      };
    });
  },

  // ── Export: recently played on one speaker (the last 24 hours) ──
  async _exportRecentlyPlayedPDF() {
    if (!this._pdfOn('recent')) return;   // switched off in the card editor
    const since = Date.now() - 24 * 3600 * 1000;
    const recent = this._getListenLogEntries().filter(e => e.ts >= since && e.entity);
    if (!recent.length) { this._showToast('Nothing played in the last 24 hours'); return; }
    const counts = {};
    recent.forEach(e => { counts[e.entity] = (counts[e.entity] || 0) + 1; });
    const options = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([ent, n]) => ({ label: (this._entityDisplayName(ent) || ent) + ' (' + n + ')', value: ent }));
    if (options.length > 1) options.push({ label: 'All speakers', value: '*' });
    const ent = options.length === 1 ? options[0].value
      : await this._iosChoose({ title: 'Recently Played', message: 'Songs played in the last 24 hours on:', options, selected: options[0].value });
    if (ent === undefined) return;
    this._exportListPDF(async () => {
      const list = recent.filter(e => ent === '*' || e.entity === ent).sort((a, b) => a.ts - b.ts);
      if (!list.length) return null;
      const fmtT = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const fmtD = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      const sections = [];
      let n = 0;
      list.forEach(e => {
        const d = fmtD(e.ts);
        if (!sections.length || sections[sections.length - 1].heading !== d) sections.push({ heading: d, thumbs: true, items: [] });
        sections[sections.length - 1].items.push({
          num: ++n, title: e.title,
          sub: [e.artist, e.album, ent === '*' ? (this._entityDisplayName(e.entity) || '') : ''].filter(Boolean).join(' · '),
          right: fmtT(e.ts), art: { artist: e.artist, album: e.album, title: e.title } });
      });
      const ms = list.reduce((s, e) => s + (e.durationMs || 0), 0);
      return {
        title: 'Recently Played', subtitle: ent === '*' ? 'All speakers' : (this._entityDisplayName(ent) || ent),
        rows: [['Songs', String(list.length)], ['Started', fmtT(list[0].ts)], ['Last song', fmtT(list[list.length - 1].ts)],
          ['Listening time', ms >= 60000 ? this._pdfFmtTotal(ms / 1000) : '']],
        sections,
        charts: (() => {
          // Songs per hour
          const h0 = new Date(list[0].ts); h0.setMinutes(0, 0, 0);
          const hours = [];
          for (let t = h0.getTime(); t <= list[list.length - 1].ts && hours.length < 25; t += 3600 * 1000) {
            hours.push({ label: String(new Date(t).getHours()).padStart(2, '0'), value: 0, t });
          }
          list.forEach(e => { const i = Math.floor((e.ts - h0.getTime()) / 3600000); if (hours[i]) hours[i].value++; });
          if (hours.length > 12) hours.forEach((h, i) => { if (i % 2) h.label = ''; });
          const am = {};
          list.forEach(e => { if (e.artist) am[e.artist] = (am[e.artist] || 0) + 1; });
          const arts = Object.entries(am).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
          if (arts.length > 6) arts.splice(5, arts.length, { label: 'Other', value: arts.slice(5).reduce((t, x) => t + x.value, 0) });
          return [
            hours.length > 1 ? { type: 'category', title: 'Songs per hour', items: hours, showValues: hours.length <= 12 } : null,
            { type: 'donut', title: 'Artists played', items: arts },
            ent === '*' ? { type: 'donut', title: 'Speakers', items: this._pdfSpeakerShare(list) } : null,
          ];
        })(),
        filename: 'recently-played-' + (ent === '*' ? 'all' : (this._entityDisplayName(ent) || ent)),
      };
    });
  },

  // ── Export: the Watch Recap ──
  _exportWatchRecapPDF() {
    if (!this._pdfOn('recap')) return;   // switched off in the card editor
    const d = this._lastWatchRecapData;
    if (!d || (!d.topShows?.length && !d.topMovies?.length)) { this._showToast('Nothing to export yet'); return; }
    this._exportListPDF(async () => {
      const fmtD = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const dur = ms => (ms >= 60000 ? this._watchDuration(ms) : '');
      const totalMs = Object.values(d.ms || {}).reduce((s, v) => s + v, 0);
      return {
        title: 'Watch Recap', subtitle: fmtD(d.since || Date.now() - 7 * 864e5) + ' - ' + fmtD(Date.now()),
        rows: [['Watches', String(d.total || 0)], ['Time watched', dur(totalMs)],
          ['Shows', String(d.topShows.length)], ['Movies', String(d.topMovies.length)]],
        intro: d.narrative || '',
        sections: [
          { heading: 'Top shows', thumbs: true, items: d.topShows.map((s, i) => ({ num: i + 1, title: s.title,
            sub: s.count + (s.count === 1 ? ' episode' : ' episodes'), right: dur(d.ms?.[s.title]), art: { video: s.title } })) },
          { heading: 'Top movies', thumbs: true, items: d.topMovies.map((m, i) => ({ num: i + 1, title: m.title,
            sub: m.count > 1 ? m.count + ' plays' : '', right: dur(d.ms?.[m.title]), art: { video: m.title } })) },
        ],
        charts: (() => {
          const ents = d.entries || [];
          const mins = e => (e.watchedMs > 0 ? e.watchedMs : (e.durationMs || 0)) / 60000;
          const isTv = e => e.mediaType === 'tv';
          const tb = this._pdfTimeBuckets(ents, mins);
          return [
            { type: 'donut', title: 'TV and movies (time watched)', items: [
              { label: 'TV', value: Math.round(ents.filter(isTv).reduce((t, e) => t + mins(e), 0)) },
              { label: 'Movies', value: Math.round(ents.filter(e => !isTv(e)).reduce((t, e) => t + mins(e), 0)) }] },
            { type: 'pair', charts: [{ title: 'Time of day', items: tb.tod }, { title: 'Day of the week', items: tb.dow }] },
          ];
        })(),
        filename: 'watch-recap',
      };
    });
  },

  // ── Export: an album's lyrics as one booklet ──
  async _exportAlbumLyricsPDF(args) {
    if (!this._pdfOn('lyrics')) return;   // switched off in the card editor
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    try {
      let key = null;
      try { key = 'alyrics|' + this._pdfHash(JSON.stringify(args || {})); } catch (_) {}
      if (this._pdfFromSession(key, preview)) return;
      await this._buildAlbumLyricsPDF(args, preview);
    }
    catch (e) { console.warn('[Crow Media Player] album lyrics PDF failed', e); preview.fail('Couldn’t create the PDF. Please try again.'); }
    finally { this._pdfBusy = false; }
  },

  async _buildAlbumLyricsPDF({ album, artist, tracks = [], heroSrc = null }, preview) {
    if (!tracks.length) { preview.fail('This album has no tracks.'); return; }
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }
    // Look up each song's lyrics (two at a time), with progress
    const toLines = entry => {
      if (!entry || entry.type === 'none') return null;
      let lines = entry.type === 'synced'
        ? (entry.lines || []).map(l => String(l.text || '').trim())
        : String(entry.text || '').split('\n').map(l => l.trim());
      lines = lines.reduce((out, l) => { if (l || (out.length && out[out.length - 1])) out.push(l); return out; }, []);
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      return lines.some(Boolean) ? lines : null;
    };
    const songs = tracks.map((t, i) => ({ num: t.num || i + 1, title: t.title || '', artist: t.artist || artist, lines: null }));
    let next = 0, done = 0, skipped = false;
    preview.progress?.('Finding lyrics…', 0, songs.length);
    if (songs.length > 4) preview.offerSkip?.(() => { skipped = true; }, 12000, 'Skip the rest');
    const worker = async () => {
      while (next < songs.length && !skipped && !preview.closed) {
        const s = songs[next++];
        const entry = this._lyricsCachedEntry(s.artist, s.title) || await this._lyricsLookupForExport(s.artist, s.title, album).catch(() => null);
        s.lines = toLines(entry);
        done++;
        if (!skipped) preview.progress?.('Finding lyrics…', done, songs.length);
      }
    };
    let release;
    const skipWait = new Promise(res => { release = res; });
    const poll = setInterval(() => { if (skipped || preview.closed) release(); }, 200);
    await Promise.race([Promise.all([worker(), worker()]), skipWait]);
    clearInterval(poll);
    preview.clearSkip?.();
    if (preview.closed) return;
    const withLyrics = songs.filter(s => s.lines);
    if (!withLyrics.length) { preview.fail({ title: 'No Lyrics Found', message: 'None of the songs on this album have lyrics available yet, so there\u2019s nothing to put in the booklet.' }); return; }
    preview.status?.('Building pages…');

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2, bottom = pageH - 40;
    const hexToRgb = hex => { const h = String(hex || '#007AFF').replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16); return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247];
    const accentRgb = hexToRgb(this._config?.accent_color || '#007AFF');
    const clean = s => String(s || '')
      .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
      .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();
    let y = 44;
    // Masthead: album, then the artist in the accent colour
    {
      const a = clean(album), b = clean(artist);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      if (doc.getTextWidth(a + '  ' + b) <= contentW) {
        doc.setTextColor(...inkRgb); doc.text(a, marginX, y);
        doc.setTextColor(...accentRgb); doc.text('  ' + b, marginX + doc.getTextWidth(a), y);
      } else {
        doc.setTextColor(...inkRgb); doc.splitTextToSize(a, contentW).forEach((l, k, arr) => { doc.text(l, marginX, y); if (k < arr.length - 1) y += 22; });
        y += 22; doc.setTextColor(...accentRgb); doc.text(doc.splitTextToSize(b, contentW)[0], marginX, y);
      }
    }
    y += 7; doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5); doc.line(marginX, y, pageW - marginX, y); y += 16;
    // Cover beside the grey rows
    const rows = [['TYPE', 'Lyrics booklet'], ['TRACKS', String(songs.length)], ['WITH LYRICS', withLyrics.length + ' of ' + songs.length]];
    const img = heroSrc ? await this._pdfImageData(heroSrc).catch(() => null) : null;
    const rowH = 20, rowGap = 3, rowsH = rows.length * rowH + (rows.length - 1) * rowGap;
    let colX = marginX, colW = contentW, artBottom = y;
    if (img) {
      const side = Math.max(64, rowsH);
      try { doc.addImage(img.data, 'JPEG', marginX, y, side, side); colX = marginX + side + 16; colW = contentW - side - 16; artBottom = y + side; } catch (_) {}
    }
    let ty = y + 13;
    rows.forEach(([l, v]) => {
      doc.setFillColor(...zebraRgb); doc.roundedRect(colX, ty - 13, colW, rowH, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mutedRgb); doc.text(l, colX + 8, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb); doc.text(clean(v), colX + 90, ty);
      ty += rowH + rowGap;
    });
    y = Math.max(ty - 13 - rowGap + 4, artBottom) + 22;
    const heading = (t) => {
      if (y + 40 > bottom) { doc.addPage(); y = 44; }
      doc.setFillColor(...accentRgb); doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...inkRgb);
      doc.text(doc.splitTextToSize(clean(t), contentW - 12)[0], marginX + 9, y);
      y += 18;
    };
    // Contents
    heading('Contents');
    songs.forEach(s => {
      if (y + 14 > bottom) { doc.addPage(); y = 44; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
      doc.text(String(s.num), marginX + 18, y, { align: 'right' });
      doc.setFont('helvetica', s.lines ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(...(s.lines ? inkRgb : mutedRgb));
      doc.text(doc.splitTextToSize(clean(s.title), contentW - 120)[0], marginX + 26, y);
      if (!s.lines) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text('no lyrics found', marginX + contentW, y, { align: 'right' }); }
      y += 14;
    });
    y += 14;
    // The songs, one after another, lyrics centred
    const lineH = 13.5, blankH = 7;
    withLyrics.forEach(s => {
      if (y + 70 > bottom) { doc.addPage(); y = 44; }
      heading(s.num + '. ' + s.title);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb);
      s.lines.map(clean).forEach(l => {
        if (!l) { y += blankH; return; }
        doc.splitTextToSize(l, contentW).forEach(w => {
          if (y + lineH > bottom) { doc.addPage(); y = 44; doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...inkRgb); }
          doc.text(w, pageW / 2, y, { align: 'center' }); y += lineH;
        });
      });
      y += 22;
    });
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    if (preview.closed) return;
    const slug = clean(album).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'album';
    this._showPDFPreview(doc, 'crow-media-lyrics-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.pdf', preview);
  },

  // ── Export: Your month in music ──
  async _exportMonthReport() {
    if (!this._pdfOn('month')) return;   // switched off in the card editor
    this._listenDailyRollup();
    let store = {};
    try { store = JSON.parse(localStorage.getItem('crow_media_ai_local_listenDaily') || '{}'); } catch (_) {}
    const months = [...new Set(Object.keys(store).map(k => k.slice(0, 7)))].sort().reverse();
    if (!months.length) { this._showToast('Not enough listening history yet — try again tomorrow'); return; }
    const label = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const nowKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    const month = months.length === 1 ? months[0] : await this._iosChoose({
      title: 'Your Month in Music', message: 'Choose a month.',
      options: months.slice(0, 6).map(m => ({ label: label(m) + (m === nowKey ? ' (so far)' : ''), value: m })), selected: months[0],
    });
    if (month === undefined) return;
    if (this._pdfBusy) return;
    this._pdfBusy = true;
    const preview = this._openPDFPreview();
    try {
      let key = null;
      try { key = 'month|' + month + '|' + new Date().toDateString() + '|' + this._pdfHash(JSON.stringify(store)); } catch (_) {}
      if (this._pdfFromSession(key, preview)) return;
      await this._buildMonthReportPDF(month, store, label, preview);
    }
    catch (e) { console.warn('[Crow Media Player] month report failed', e); preview.fail('Couldn’t create the report. Please try again.'); }
    finally { this._pdfBusy = false; }
  },

  async _buildMonthReportPDF(month, store, label, preview) {
    let JsPDFCtor;
    try { JsPDFCtor = await this._ensureJsPDF(preview); }
    catch (e) { preview.fail(e?.message || 'Could not load the PDF library'); return; }
    preview.status?.('Building pages…');
    const merge = (days) => {
      const out = { p: 0, s: 0, a: {}, t: {}, al: {}, e: {}, st: {}, h: [0, 0, 0, 0], days: days.length };
      const add = (dst, src) => Object.entries(src || {}).forEach(([k, v]) => { dst[k] = (dst[k] || 0) + v; });
      days.forEach(([, d]) => { out.p += d.p || 0; out.s += d.s || 0; add(out.a, d.a); add(out.t, d.t); add(out.al, d.al); add(out.e, d.e); add(out.st, d.st); (d.h || []).forEach((v, i) => { out.h[i] += v; }); });
      return out;
    };
    const daysOf = m => Object.entries(store).filter(([k]) => k.startsWith(m)).sort((a, b) => a[0].localeCompare(b[0]));
    const days = daysOf(month);
    const cur = merge(days);
    const y0 = +month.slice(0, 4), m0 = +month.slice(5, 7);
    const prevKey = (m0 === 1 ? (y0 - 1) + '-12' : y0 + '-' + String(m0 - 1).padStart(2, '0'));
    const prevDays = daysOf(prevKey);
    const prev = prevDays.length >= 7 ? merge(prevDays) : null;   // only compare with a month that has enough days
    const earlierArtists = new Set(Object.entries(store).filter(([k]) => k < month).flatMap(([, d]) => Object.keys(d.a || {}).map(a => a.toLowerCase())));
    const daysInMonth = new Date(y0, m0, 0).getDate();
    const isCurrent = month === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const marginX = 44, contentW = pageW - marginX * 2, bottom = pageH - 40;
    const hexToRgb = hex => { const h = String(hex || '#007AFF').replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16); return isNaN(n) ? [0, 122, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const inkRgb = [28, 28, 30], mutedRgb = [120, 120, 128], zebraRgb = [244, 244, 247];
    const accentHex = this._config?.accent_color || '#007AFF';
    const accentRgb = hexToRgb(accentHex);
    const theme = { hexToRgb, inkRgb, mutedRgb, zebraRgb, accentRgb,
      setInk: () => doc.setTextColor(...inkRgb), setMuted: () => doc.setTextColor(...mutedRgb), setAccent: () => doc.setTextColor(...accentRgb) };
    const PALETTE = [accentHex, '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA', '#8E8E93'];
    const clean = s => String(s || '')
      .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
      .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();
    const fmtDur = sec => { const m = Math.round((sec || 0) / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return h + 'h' + (r ? ' ' + r + 'm' : ''); };
    let y = 44;
    const newPageIfNeeded = need => { if (y + need > bottom) { doc.addPage(); y = 44; return true; } return false; };
    const sectionHeader = t => {
      newPageIfNeeded(40); y += 10;
      doc.setFillColor(...accentRgb); doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...inkRgb); doc.text(t, marginX + 9, y);
      y += 16;
    };
    const ranked = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
    const prevRank = (obj, key) => { if (!obj) return null; const i = ranked(obj, 1000).findIndex(([k]) => k === key); return i === -1 ? null : i + 1; };
    // Ranked bars with an optional cover and a change note (e.g. "up 3", "new")
    const rankedBars = async (items, { valueLabel = v => String(v), covers = false } = {}) => {
      if (!items.length) return;
      let thumbs = [];
      if (covers) {
        preview.status?.('Fetching artwork…');
        const budget = { itunes: 10 };
        thumbs = await Promise.all(items.map(it => it.art ? this._pdfThumbFor({ art: it.art }, budget).catch(() => null) : null));
        preview.status?.('Building pages…');
      }
      const useThumbs = thumbs.some(Boolean);
      const rowH = useThumbs ? 24 : 16, off = useThumbs ? 6 : 0, thumbW = useThumbs ? 26 : 0;
      const max = Math.max(...items.map(i => i.value), 1);
      const labelW = 190 - thumbW, valW = 54, barX = marginX + thumbW + labelW + 8, barW = contentW - thumbW - labelW - 8 - valW;
      items.forEach((it, k) => {
        newPageIfNeeded(rowH);
        if (useThumbs) {
          const td = thumbs[k];
          if (td) { try { doc.addImage(td.data, 'JPEG', marginX, y - 1, 20, 20); } catch (_) {} }
          else { doc.setFillColor(...zebraRgb); doc.roundedRect(marginX, y - 1, 20, 20, 2, 2, 'F'); }
        }
        doc.setFontSize(9);
        const note = it.note ? '  ' + it.note : '';
        doc.setFont('helvetica', 'normal');
        const noteW = note ? doc.getTextWidth(note) : 0;
        let lab = (k + 1) + '. ' + clean(it.label);
        const full = lab;
        while (doc.getTextWidth(lab) > labelW - noteW && lab.length > 4) lab = lab.slice(0, -2);
        if (lab !== full) lab = lab.trimEnd() + '...';
        doc.setTextColor(...inkRgb); doc.text(lab, marginX + thumbW, y + 8 + off);
        const labW = doc.getTextWidth(lab);
        if (note) { doc.setTextColor(...(it.noteNew ? accentRgb : mutedRgb)); doc.setFontSize(8); doc.text(note, marginX + thumbW + labW, y + 8 + off); }
        doc.setFillColor(...zebraRgb); doc.roundedRect(barX, y + off, barW, 10, 2, 2, 'F');
        doc.setFillColor(...accentRgb); doc.roundedRect(barX, y + off, Math.max(3, barW * (it.value / max)), 10, 2, 2, 'F');
        doc.setTextColor(...mutedRgb); doc.setFontSize(8.5);
        doc.text(valueLabel(it.value), marginX + contentW, y + 8 + off, { align: 'right' });
        y += rowH;
      });
      y += 4;
    };
    const statCards = stats => {
      newPageIfNeeded(56);
      const gap = 8, cardW = (contentW - gap * (stats.length - 1)) / stats.length;
      stats.forEach((st, i) => {
        const x = marginX + i * (cardW + gap);
        doc.setFillColor(...zebraRgb); doc.roundedRect(x, y, cardW, 44, 4, 4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...(st.accent ? accentRgb : inkRgb));
        let v = clean(st.value);
        while (doc.getTextWidth(v) > cardW - 16 && v.length > 3) v = v.slice(0, -2);
        doc.text(v, x + 10, y + 20);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb); doc.text(st.label, x + 10, y + 34);
      });
      y += 56;
    };

    // Masthead
    const heading = 'Your Month in Music';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.setTextColor(...inkRgb); doc.text(heading, marginX, y);
    doc.setTextColor(...accentRgb); doc.text('  ' + label(month), marginX + doc.getTextWidth(heading), y);
    y += 7; doc.setDrawColor(...accentRgb); doc.setLineWidth(1.5); doc.line(marginX, y, pageW - marginX, y); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...mutedRgb);
    const covered = days.length + ' of ' + (isCurrent ? new Date().getDate() : daysInMonth) + ' days';
    doc.text((isCurrent ? 'Month so far' : 'Whole month') + '  ·  history covers ' + covered, marginX, y);
    y += 22;

    // Summary
    const busiest = days.slice().sort((a, b) => (b[1].p || 0) - (a[1].p || 0))[0];
    const fmtDay = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    statCards([
      { label: 'Listening time', value: fmtDur(cur.s), accent: true },
      { label: 'Days listened', value: String(days.filter(([, d]) => d.p > 0).length) },
      { label: 'Busiest day', value: busiest ? fmtDay(busiest[0]) + ' (' + busiest[1].p + ')' : '-' },
    ]);
    // Compared with last month (per day, so a part month compares fairly)
    if (prev && cur.days) {
      const perDay = v => v / Math.max(1, cur.days), perDayPrev = v => v / Math.max(1, prev.days);
      const pct = Math.round((perDay(cur.s) / Math.max(1, perDayPrev(prev.s)) - 1) * 100);
      const txt = 'Daily listening time ' + (pct === 0 ? 'the same as' : (pct > 0 ? 'up ' : 'down ') + Math.abs(pct) + '% on') + ' ' + label(prevKey).split(' ')[0] + '.';
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
      doc.text(txt, marginX, y); y += 18;
    } else {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...mutedRgb);
      doc.text('Comparisons with the month before appear once there is enough history to compare.', marginX, y); y += 18;
    }

    // Where and when — the speaker share, then time of day and day of week
    const speakers = ranked(cur.e, 6).map(([k, v], i) => ({ label: clean(this._entityDisplayName(k) || k), value: v, color: PALETTE[i % PALETTE.length] }));
    if (speakers.length > 1) {
      newPageIfNeeded(110);
      y = this._pdfDrawDonutWithBars(doc, theme, speakers, marginX, y + 14, pageW, { title: 'Where you listen', newPageIfNeeded });
    }
    {
      // Day of week from the daily totals
      const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => ({ label, value: 0 }));
      days.forEach(([k, d]) => { const dt = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)); dow[(dt.getDay() + 6) % 7].value += d.p || 0; });
      newPageIfNeeded(170);
      const halfW = (contentW - 16) / 2, yStart = y + 14;
      const y1 = this._pdfDrawCategoryBarChart(doc, theme, ['Morning', 'Afternoon', 'Evening', 'Night'].map((l, i) => ({ label: l, value: cur.h[i] })),
        marginX, yStart, marginX * 2 + halfW, { title: 'Time of day' });
      const x2 = marginX + halfW + 16;
      const y2 = this._pdfDrawCategoryBarChart(doc, theme, dow, x2, yStart, x2 * 2 + halfW, { title: 'Day of the week' });
      y = Math.max(y1, y2);
    }

    // Top lists, with movement against last month
    const move = (key, rank, prevObj) => {
      if (!prev) return {};
      const pr = prevRank(prevObj, key);
      if (pr == null) return { note: 'new', noteNew: true };
      if (pr === rank) return {};
      return { note: pr > rank ? 'up ' + (pr - rank) : 'down ' + (rank - pr) };
    };
    sectionHeader('Top artists');
    await rankedBars(ranked(cur.a, 10).map(([k, v], i) => ({ label: k, value: v, ...move(k, i + 1, prev?.a) })),
      { valueLabel: v => v + (v === 1 ? ' play' : ' plays') });
    sectionHeader('Top tracks');
    await rankedBars(ranked(cur.t, 10).map(([k, v], i) => { const [ti, ar, al] = k.split('\u0001'); return { label: ti + (ar ? ' - ' + ar : ''), value: v, art: { artist: ar, album: al, title: ti }, ...move(k, i + 1, prev?.t) }; }),
      { valueLabel: v => v + (v === 1 ? ' play' : ' plays'), covers: true });
    const albums = ranked(cur.al, 5);
    if (albums.length) {
      sectionHeader('Top albums');
      await rankedBars(albums.map(([k, v], i) => { const [al, ar] = k.split('\u0001'); return { label: al + (ar ? ' - ' + ar : ''), value: v, art: { artist: ar, album: al }, ...move(k, i + 1, prev?.al) }; }),
        { valueLabel: v => v + (v === 1 ? ' play' : ' plays'), covers: true });
    }
    // New this month: artists not in any earlier summary
    if (earlierArtists.size) {
      const fresh = ranked(cur.a, 1000).filter(([k]) => !earlierArtists.has(k.toLowerCase())).slice(0, 10);
      if (fresh.length) {
        sectionHeader('New this month');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...inkRgb);
        doc.splitTextToSize(fresh.map(([k]) => clean(k)).join(',  '), contentW).forEach(l => { newPageIfNeeded(14); doc.text(l, marginX, y + 4); y += 14; });
        y += 6;
      }
    }
    const stations = ranked(cur.st, 5);
    if (stations.length) {
      sectionHeader('Radio stations');
      await rankedBars(stations.map(([k, v]) => ({ label: k, value: v })), { valueLabel: v => v + (v === 1 ? ' song' : ' songs') });
    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mutedRgb);
      doc.text('Crow Media Player', marginX, pageH - 22);
      doc.text('Page ' + p + ' of ' + pages, pageW - marginX, pageH - 22, { align: 'right' });
    }
    if (preview.closed) return;
    this._showPDFPreview(doc, 'crow-media-month-in-music-' + month + '.pdf', preview);
  },

  // ── Export: a pinned Music Recap snapshot ──
  _exportRecapSnapshotPDF(recap) {
    if (!this._pdfOn('recap')) return;   // switched off in the card editor
    this._exportListPDF(async () => {
      if (!recap) return null;
      const artists = recap.topArtists || [], tracks = recap.topTracks || [];
      return {
        title: recap.name || 'Music Recap', subtitle: recap.dateRangeLabel || '',
        rows: [['Artists', String(artists.length)], ['Tracks', String(tracks.length)],
          ['Pinned', recap.pinnedAt ? new Date(recap.pinnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '']],
        intro: recap.narrative || '',
        charts: [
          artists.some(a => a.count) ? { type: 'ranked', title: 'Top artists', items: artists.slice(0, 10).map(a => ({ label: a.name, value: a.count || 0 })),
            valueLabel: v => v + (v === 1 ? ' play' : ' plays') } : null,
          tracks.some(t => t.count) ? { type: 'ranked', title: 'Top tracks', covers: true, items: tracks.slice(0, 10).map(t => ({ label: t.title + (t.artist ? ' - ' + t.artist : ''), value: t.count || 0, art: { artist: t.artist, album: t.album, title: t.title } })),
            valueLabel: v => v + (v === 1 ? ' play' : ' plays') } : null,
          recap.tod ? { type: 'pair', charts: [{ title: 'Time of day', items: recap.tod }, { title: 'Day of the week', items: recap.dow || [] }] } : null,
        ],
        sections: [
          artists.some(a => a.count) ? null : { heading: 'Top artists', items: artists.map((a, i) => ({ num: i + 1, title: a.name })) },
          // With play counts the top 10 are in the chart above; any beyond that are listed here
          (() => {
            const ranked = tracks.some(t => t.count), from = ranked ? 10 : 0;
            return { heading: ranked ? 'More top tracks' : 'Top tracks', thumbs: true, items: tracks.slice(from).map((t, i) => ({ num: from + i + 1, title: t.title, sub: [t.artist, t.album].filter(Boolean).join(' · '),
              right: t.count ? t.count + (t.count === 1 ? ' play' : ' plays') : '', art: { artist: t.artist, album: t.album, title: t.title } })) };
          })(),
        ].filter(Boolean),
        filename: 'recap-' + (recap.name || ''),
      };
    });
  },

  // PDF.js (Mozilla's PDF viewer), loaded the first time a preview opens.
  _ensurePdfJs() {
    if (window.pdfjsLib?.getDocument) return Promise.resolve(window.pdfjsLib);
    if (this._pdfJsLoadPromise) return this._pdfJsLoadPromise;
    const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    this._pdfJsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = BASE + 'pdf.min.js';
      const fail = (msg) => { this._pdfJsLoadPromise = null; reject(new Error(msg)); };
      const t = setTimeout(() => fail('PDF viewer took too long to load'), 15000);
      script.onload = () => {
        clearTimeout(t);
        const lib = window.pdfjsLib;
        if (!lib?.getDocument) { fail('PDF viewer failed to initialise'); return; }
        lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
        resolve(lib);
      };
      script.onerror = () => { clearTimeout(t); fail('Could not load the PDF viewer'); };
      document.head.appendChild(script);
    });
    return this._pdfJsLoadPromise;
  },

  // Draws every page of the PDF into the preview as a scrolling stack, with
  // a "Page 2 of 5" counter. Pages are only drawn as they scroll near, and
  // each one is kept as an image (not a live canvas) so long PDFs don't run
  // the phone out of memory. Pinch to zoom (up to 4x) or double-tap to zoom
  // in and back out; pages are redrawn sharper once a zoom settles.
  async _renderPDFPages(frameWrap, buf, { isClosed = () => false, onCleanup = () => {} } = {}) {
    const lib = await this._ensurePdfJs();
    if (isClosed()) return;
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    onCleanup(() => pdf.destroy());
    if (isClosed()) return;
    const total = pdf.numPages;
    const first = await pdf.getPage(1);
    const vp1 = first.getViewport({ scale: 1 });
    if (isClosed()) return;

    frameWrap.innerHTML = '';
    frameWrap.style.display = 'block';
    frameWrap.style.position = 'relative';
    frameWrap.style.background = '#d1d1d6';
    const scroller = document.createElement('div');
    scroller.style.cssText = 'position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px;box-sizing:border-box;touch-action:pan-x pan-y;';
    frameWrap.appendChild(scroller);
    // The zoomable sheet holding the pages — zoom is its width
    const sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;transform-origin:0 0;';
    scroller.appendChild(sheet);
    const counter = document.createElement('div');
    counter.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.62);color:#fff;font-size:11px;font-weight:600;padding:4px 11px;border-radius:11px;pointer-events:none;white-space:nowrap;' + (total > 1 ? '' : 'display:none;');
    frameWrap.appendChild(counter);
    const GAP = 10;

    const holders = [];
    for (let i = 1; i <= total; i++) {
      const h = document.createElement('div');
      h.dataset.page = String(i);
      h.style.cssText = 'position:relative;width:100%;aspect-ratio:' + vp1.width + ' / ' + vp1.height + ';background:#fff;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,0.18);overflow:hidden;' + (i < total ? 'margin-bottom:' + GAP + 'px;' : '');
      sheet.appendChild(h);
      holders.push(h);
    }

    const urls = new Set();
    onCleanup(() => urls.forEach(u => URL.revokeObjectURL(u)));
    const MAX_PX = 2600;            // widest a page is ever drawn (memory)
    const drawnW = new Map();       // page -> pixel width it was drawn at
    const busy = new Set();
    let chain = Promise.resolve();
    const wantPx = (holder) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      return Math.min(MAX_PX, Math.round((holder.clientWidth || scroller.clientWidth - 20 || 320) * dpr));
    };
    const renderPage = (n) => {
      const holder = holders[n - 1];
      if (!holder || busy.has(n)) return;
      const target = wantPx(holder);
      if ((drawnW.get(n) || 0) >= target * 0.9) return;   // already sharp enough
      busy.add(n);
      chain = chain.then(async () => {
        if (isClosed()) return;
        const page = n === 1 ? first : await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const px = wantPx(holder);
        const viewport = page.getViewport({ scale: px / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (n !== 1) page.cleanup();
        if (isClosed()) return;
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        canvas.width = 0; canvas.height = 0;   // free the canvas memory
        if (!blob || isClosed()) return;
        const url = URL.createObjectURL(blob);
        urls.add(url);
        const old = holder.querySelector('img');
        const img = document.createElement('img');
        img.alt = 'Page ' + n;
        img.draggable = false;
        img.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0;';
        img.onload = () => {
          if (old) { const ou = old.src; old.remove(); if (urls.has(ou)) { URL.revokeObjectURL(ou); urls.delete(ou); } }
        };
        img.src = url;
        holder.appendChild(img);
        drawnW.set(n, canvas.width || px);
      }).catch(() => {}).finally(() => { busy.delete(n); });
    };
    const visiblePages = (margin = 0) => {
      const top = scroller.scrollTop - margin, bottom = scroller.scrollTop + scroller.clientHeight + margin;
      return holders.filter(h => h.offsetTop + h.offsetHeight >= top && h.offsetTop <= bottom).map(h => Number(h.dataset.page));
    };

    // Draw pages as they come near the visible area
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) renderPage(Number(en.target.dataset.page)); });
      }, { root: scroller, rootMargin: '900px 300px' });
      holders.forEach(h => io.observe(h));
      onCleanup(() => io.disconnect());
    } else {
      for (let i = 1; i <= total; i++) renderPage(i);
    }
    renderPage(1);

    const updateCounter = () => {
      const mid = scroller.scrollTop + scroller.clientHeight / 2;
      let cur = 1;
      for (const h of holders) { if (h.offsetTop <= mid) cur = Number(h.dataset.page); else break; }
      counter.textContent = 'Page ' + cur + ' of ' + total;
    };
    scroller.addEventListener('scroll', updateCounter, { passive: true });
    updateCounter();

    // ── Zoom ──
    const MIN_Z = 1, MAX_Z = 4;
    let zoom = 1;
    let sharpenTimer = null;
    const sharpen = () => {
      clearTimeout(sharpenTimer);
      sharpenTimer = setTimeout(() => { if (!isClosed()) visiblePages(200).forEach(renderPage); }, 250);
    };
    // Set the zoom, keeping the content point under (cx, cy) — coordinates
    // relative to the scroller's visible box — where it is.
    const setZoom = (z, cx, cy) => {
      z = Math.max(MIN_Z, Math.min(MAX_Z, z));
      const pad = 10;
      const ratio = z / zoom;
      const contentX = scroller.scrollLeft + cx - pad;
      const contentY = scroller.scrollTop + cy - pad;
      // Page gaps don't scale, so vertical position is mapped page by page
      const pageIdx = Math.max(0, Math.min(total - 1, Math.floor(contentY / (holders[0].offsetHeight + GAP))));
      const gapsAbove = pageIdx * GAP;
      zoom = z;
      sheet.style.width = (z * 100) + '%';
      scroller.scrollLeft = contentX * ratio - cx + pad;
      scroller.scrollTop = (contentY - gapsAbove) * ratio + gapsAbove - cy + pad;
      updateCounter();
      sharpen();
    };

    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const rel = (x, y) => { const r = scroller.getBoundingClientRect(); return [x - r.left, y - r.top]; };
    let pinch = null;          // { d0, z0, cx, cy, scale }
    let lastTap = 0;
    const onStart = (e) => {
      if (e.touches.length === 2) {
        const [cx, cy] = rel((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
        // Live preview with a transform (smooth), committed on release
        const ox = scroller.scrollLeft + cx - 10, oy = scroller.scrollTop + cy - 10;
        sheet.style.transformOrigin = ox + 'px ' + oy + 'px';
        pinch = { d0: dist(e.touches), z0: zoom, cx, cy, scale: 1 };
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) {
          const [cx, cy] = rel(e.touches[0].clientX, e.touches[0].clientY);
          setZoom(zoom > 1.05 ? 1 : 2.5, cx, cy);
          lastTap = 0;
          e.preventDefault();
        } else lastTap = now;
      }
    };
    const onMove = (e) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const z = Math.max(MIN_Z, Math.min(MAX_Z, pinch.z0 * dist(e.touches) / pinch.d0));
      pinch.scale = z / pinch.z0;
      sheet.style.transform = 'scale(' + pinch.scale + ')';
    };
    const onEnd = (e) => {
      if (!pinch || e.touches.length >= 2) return;
      const { z0, scale, cx, cy } = pinch;
      pinch = null;
      sheet.style.transform = '';
      sheet.style.transformOrigin = '0 0';
      if (Math.abs(scale - 1) > 0.01) setZoom(z0 * scale, cx, cy);
    };
    scroller.addEventListener('touchstart', onStart, { passive: false });
    scroller.addEventListener('touchmove', e => { onMove(e); e.stopPropagation(); }, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    // Safari's own page-zoom gesture would zoom the whole dashboard instead
    ['gesturestart', 'gesturechange'].forEach(ev => scroller.addEventListener(ev, e => e.preventDefault(), { passive: false }));
    // Ctrl/trackpad pinch on a computer
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const [cx, cy] = rel(e.clientX, e.clientY);
      setZoom(zoom * Math.exp(-e.deltaY / 200), cx, cy);
    }, { passive: false });
    scroller.addEventListener('dblclick', (e) => {
      const [cx, cy] = rel(e.clientX, e.clientY);
      setZoom(zoom > 1.05 ? 1 : 2.5, cx, cy);
    });
  },

  _showPDFPreview(doc, filename, preview = null) {
    (preview || this._openPDFPreview()).show(doc, filename);
  },

  // Dedicated top-level "Watch History" tab — same relationship to the
  // Video Recap panel that Music History has to Music Recap: reads the
  // same underlying watch log, just as a plain chronological list instead
  // of weekly aggregated stats. Reuses _mtMakeRow entirely for each row, so
  // artwork fallback, tap-to-info, and long-press (Pin/Find Soundtrack) all
  // come for free. No inline heading — the shared library header already
  // shows "Watch History" as the title, same as Music History.
  _renderRecentlyWatchedTab(content) {
    if (!content) return;
    if (this._historyBackfillDone && !this._watchCatchUpDrawing) {
      const before = this._getWatchLogEntries({ all: true }).length;
      this._catchUpHistory(() => {
        if (this._getWatchLogEntries({ all: true }).length === before) return;
        this._watchCatchUpDrawing = true;
        try { this._refreshWatchHistoryView(); } finally { this._watchCatchUpDrawing = false; }
      });
    }
    // Leaving (or never having entered) a title's drill-in — restore the
    // list-level header title and ⋮ menu.
    this._watchDetailActive = false;
    this._watchDetailKey = null;
    const _titleEl = this.shadowRoot?.getElementById('maTitle');
    if (_titleEl) _titleEl.textContent = 'Watch History';
    const _menuBtn = this.shadowRoot?.getElementById('recentPlaysMenuBtn');
    if (_menuBtn) {
      _menuBtn.classList.remove('hidden');
      _menuBtn.onclick = () => this._showMtWatchOptionsMenu(_menuBtn);
    }

    // Grouped by title — one row per show/movie, most recently watched
    // first. The 10–500 limit applies to titles, not individual plays.
    const limit = this._mtWatchLimit();
    const groups = this._groupWatchLog(this._getWatchLogEntries()).slice(0, limit);
    const ytGroups = this._groupYouTubeLog().slice(0, limit);

    content.innerHTML = '';

    // Stays visible with an empty state rather than disappearing — same
    // reasoning as Recent Searches / Recent Played, which never vanish
    // either, so "nothing watched yet" reads differently from "this
    // feature doesn't exist here".
    if (!groups.length && !ytGroups.length) {
      const empty = document.createElement('div');
      empty.innerHTML = this._psEmpty(
        'M21,3H3C1.89,3 1,3.89 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3M21,19H3V5H21V19M18,13.5L15.5,15.15L15.5,11.85L18,13.5M13,15.5L10.5,17.15L10.5,13.85L13,15.5M8,13.5L5.5,15.15L5.5,11.85L8,13.5Z',
        'Nothing watched yet',
        'Movies, TV shows and YouTube videos you watch will show up here.'
      );
      content.appendChild(empty);
      return;
    }

    // With YouTube videos in the history, the list is split into two
    // sections: Movies & TV first, then YouTube.
    const _section = (label) => {
      const h = document.createElement('div');
      h.className = 'watch-day-heading watch-section-heading';
      h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:' + this._pt('dim') + ';padding:10px 4px 6px;';
      h.textContent = label;
      content.appendChild(h);
      return h;
    };
    if (ytGroups.length && groups.length) _section('Movies & TV');

    const _pendingArt = [];
    groups.forEach(g => {
      const kind = g.kind;
      const count = g.viewings.length;
      const artKey = kind + '|' + g.title.toLowerCase();
      // A single watch of an episode shows which one in the subtitle —
      // there's no drill-in for single-watch titles, so this is the only
      // place it would appear.
      let subtitle = this._watchRelTime(g.lastTs);
      if (count > 1) subtitle += ' \u00b7 ' + count + ' watches';
      else if (kind === 'tv') {
        const epLabel = this._watchEpisodeLabel(g.viewings[0].entry, g.title, true);
        if (epLabel) subtitle += ' \u00b7 ' + epLabel;
      }
      const item = {
        id: kind + '_' + g.title.toLowerCase(),
        kind,
        title: g.title,
        subtitle: this._watchEsc(subtitle),
        // Watch log entries never store artwork — checks a cache first,
        // and for a miss the row renders with _mtMakeRow's own fallback
        // icon, then gets patched in place once the queued fetch resolves.
        artworkUrl100: this._mtArtCache?.[artKey] || '',
      };
      const infoItem = { ...item, subtitle: '' };
      const opts = count > 1
        ? {
            onTap: () => this._openWatchGroupDetail(g.key),
            trailingHtml: this._watchCountPillHtml(count),
          }
        : { onTap: () => this._openWatchInfo(infoItem, g.key) };
      opts.onRemove = () => this._confirmRemoveWatchGroup(g, { fromList: true });
      const row = this._mtMakeRow(item, false, opts);
      content.appendChild(row);
      if (!item.artworkUrl100) _pendingArt.push({ title: g.title, kind, row });
    });
    // Fetched one at a time rather than all firing in parallel — up to 10
    // (or 50) rows each needing 2 iTunes requests would otherwise burst 20+
    // near-simultaneous requests, a much bigger spike than any other iTunes
    // usage in this card and a likely trigger for their IP-based
    // rate-limiting (documented elsewhere in this file as an ongoing,
    // known issue on Apple's end) — which would silently blank out
    // artwork for the whole list at once, not just mismatch a few titles.
    if (_pendingArt.length) this._fetchMtArtQueue(_pendingArt);

    if (ytGroups.length) {
      _section('YouTube');
      ytGroups.forEach(g => content.appendChild(this._buildYouTubeHistoryRow(g)));
      if (!this._appIconCache?.['YouTube']) {
        this._atvAppIcon('YouTube').then(url => {
          if (!url) return;
          content.querySelectorAll('.yt-hist-art').forEach(el => { el.style.background = 'transparent'; el.innerHTML = '<img src="' + this._watchEsc(url) + '" alt="" style="width:40px;height:40px;object-fit:cover;display:block;">'; });
        }).catch(() => {});
      }
    }
  },

  _groupYouTubeLog() {
    const groups = new Map();
    this._getYouTubeLogEntries().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(e => {
      const key = this._watchTitleKey(e.title) + '|' + this._watchTitleKey(e.channel || '');
      if (!e.title) return;
      let g = groups.get(key);
      if (!g) { g = { key, title: e.title, channel: e.channel || '', entries: [], watches: 0, lastTs: e.ts || 0, _prevTs: null }; groups.set(key, g); }
      if (!g.channel && e.channel) g.channel = e.channel;
      if (g._prevTs === null || g._prevTs - (e.ts || 0) > 6 * 3600 * 1000) g.watches++;
      g._prevTs = e.ts || 0;
      g.entries.push(e);
    });
    return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs);
  },

  _buildYouTubeHistoryRow(g) {
    const wrap = document.createElement('div');
    wrap.className = 'ma-item-wrap';
    const row = document.createElement('div');
    row.className = 'ma-item';
    row.style.cssText = 'cursor:pointer;-webkit-tap-highlight-color:transparent;position:relative;';
    let sub = (g.channel ? g.channel + ' \u00b7 ' : '') + this._watchRelTime(g.lastTs);
    if (g.watches > 1) sub += ' \u00b7 ' + g.watches + ' watches';
    // the YouTube app's own icon (the same one the Info panel shows), or a red play mark until it loads
    const _ytIcon = this._appIconCache?.['YouTube'];
    row.innerHTML =
      '<div class="ma-item-art yt-hist-art" style="width:40px;height:40px;border-radius:8px;background:' + (_ytIcon ? 'transparent' : 'rgba(255,0,51,0.12)') + ';flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;">'
        + (_ytIcon ? '<img src="' + this._watchEsc(_ytIcon) + '" alt="" style="width:40px;height:40px;object-fit:cover;display:block;">' : '<svg viewBox="0 0 24 24" style="width:22px;height:22px;"><path style="fill:#FF0033" d="M21.58,7.19C21.35,6.33 20.67,5.65 19.81,5.42C18.25,5 12,5 12,5C12,5 5.75,5 4.19,5.42C3.33,5.65 2.65,6.33 2.42,7.19C2,8.75 2,12 2,12C2,12 2,15.25 2.42,16.81C2.65,17.67 3.33,18.35 4.19,18.58C5.75,19 12,19 12,19C12,19 18.25,19 19.81,18.58C20.67,18.35 21.35,17.67 21.58,16.81C22,15.25 22,12 22,12C22,12 22,8.75 21.58,7.19Z"/><path style="fill:#fff" d="M10,15L15.2,12L10,9V15Z"/></svg>')
      + '</div>'
      + '<div style="flex:1;min-width:0;">'
        + '<div class="ma-item-title" style="font-size:13px;font-weight:600;color:var(--crow-panel-text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._watchEsc(g.title) + '</div>'
        + '<div class="ma-item-sub" style="font-size:11px;color:var(--crow-panel-text-dim,rgba(255,255,255,0.45));margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._watchEsc(sub) + '</div>'
      + '</div>';
    wrap.appendChild(row);

    // tap: AI Info for the video (or a YouTube search when AI Info is off); hold: remove it
    let lpT = null, lpFired = false;
    row.addEventListener('contextmenu', e => e.preventDefault());
    row.addEventListener('pointerdown', () => { lpFired = false; lpT = setTimeout(() => { lpFired = true; this._confirmRemoveYouTubeGroup(g); }, 480); }, { passive: true });
    ['pointerup', 'pointercancel', 'pointermove'].forEach(t => row.addEventListener(t, () => clearTimeout(lpT), { passive: true }));
    row.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }
      this._openYouTubeHistoryInfo(g);
    });
    this._rowSwipe(row, { extra: [{ id: 'yt_remove', label: 'Remove', danger: true, icon: this._swIcon('remove'), run: () => this._confirmRemoveYouTubeGroup(g) }], left: ['yt_remove'] }, wrap);
    return wrap;
  },

  _openYouTubeHistoryInfo(g) {
    const q = (g.title + ' ' + (g.channel || '')).trim();
    if (!this._aiFeatureOn('info')) { window.open(this._buildYoutubeUrl(q), '_blank'); return; }
    const r = this.shadowRoot, infoPopup = r?.getElementById('infoPopup'), infoContent = r?.getElementById('infoContent');
    if (!infoPopup || !infoContent) return;
    infoPopup.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    infoPopup.style.setProperty('backdrop-filter', 'none');
    infoPopup.style.setProperty('-webkit-backdrop-filter', 'none');
    infoContent.style.setProperty('background', 'var(--crow-panel-bg, #13131a)');
    infoPopup.classList.add('visible');
    this._infoPopupOpenedAt = Date.now();
    this._activeInfoPanelKind = null;
    r.getElementById('queueMenuBtn')?.classList.add('hidden');
    this._showAppAIInfo({ media_title: g.title, media_artist: g.channel || '', app_name: 'YouTube', app_id: 'com.google.ios.youtube' }, 'creator');
  },

  async _confirmRemoveYouTubeGroup(g) {
    const ok = await this._iosConfirm({
      title: 'Remove from History?',
      message: 'This removes \u201c' + g.title + '\u201d from Watch History. This can\u2019t be undone.',
      confirmLabel: 'Remove', destructive: true,
    });
    if (!ok) return;
    this._removeWatchEntries(g.entries.map(e => e._key).filter(Boolean));
    this._refreshWatchHistoryView();
    this._showToast('Removed from History');
  }
});

K.ready.pdf = true;
})();
