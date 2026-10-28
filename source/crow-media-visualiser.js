/*
 * Crow Media Player — Visualiser
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.viz) return;
const {  } = K.kit;


Object.assign(K.Card.prototype, {
  _vizLoop(now) {
    this._vizRaf = requestAnimationFrame(t => this._vizLoop(t));
    const viz = this._viz, el = this.shadowRoot?.getElementById('crowViz');
    if (!viz || !el || document.hidden || this._vizOffscreen) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // lyrics glide at the screen's full rate; the rest at a steady 30 frames a second (every other frame,
    // rather than an uneven mix of gaps, which looks juddery)
    if (now - (this._vizLast || 0) < (still ? 500 : viz.style === 'lyrics' ? 0 : 29)) return;
    this._vizLast = now;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    viz.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
    const st = this._hass?.states[this._entity];
    const at = st?.attributes || {};
    const playing = !!st && (st.state === 'playing' || st.state === 'buffering');
    let pos = Number(at.media_position) || 0;
    if (playing && at.media_position_updated_at) pos += (Date.now() - new Date(at.media_position_updated_at).getTime()) / 1000;
    if (this._optimisticSeekPos !== undefined && this._optimisticSeekTime !== undefined) pos = this._optimisticSeekPos + (playing ? (Date.now() - this._optimisticSeekTime) / 1000 : 0);
    const dur = Number(at.media_duration) || 0;
    if (dur) pos = Math.min(pos, dur);
    else {
      // a live stream has no song position: keep time from when the visuals started instead
      if (!this._vizClock) this._vizClock = { t: now, pos: 0 };
      if (playing) this._vizClock.pos += (now - this._vizClock.t) / 1000;
      this._vizClock.t = now;
      pos = this._vizClock.pos;
    }
    viz.step(now, { playing, pos, dur, bpm: this._vizBpm || 0, energy: this._vizEnergy || 0 });
    viz.draw();
  },

  // The song's tempo (and how loud it's mastered) from Deezer, kept on this device
  async _vizTempo(artist, title) {
    const key = (artist + '|' + title).toLowerCase();
    let store = {};
    try { store = JSON.parse(localStorage.getItem('crow_media_viz_bpm') || '{}'); } catch (_) {}
    if (store[key]) return store[key].bpm ? store[key] : null;
    const clean = s => String(s || '').replace(/\s*[\(\[][^\)\]]*(remaster|live|edit|version|mix|mono|stereo|feat)[^\)\]]*[\)\]]/gi, '').replace(/"/g, '').trim();
    const q = 'artist:"' + clean(artist).split(/\s*(?:,|&| feat\.? | ft\.? )\s*/i)[0] + '" track:"' + clean(title) + '"';
    const r = await this._vizDeezer('/search/track?q=' + encodeURIComponent(q) + '&limit=1');
    const id = r?.data?.[0]?.id;
    let out = { bpm: 0, energy: 0, ts: Date.now() };
    if (id) {
      const tr = await this._vizDeezer('/track/' + id);
      const bpm = Number(tr?.bpm) || 0, gain = Number(tr?.gain);
      if (bpm >= 50 && bpm <= 220) out.bpm = Math.round(bpm * 10) / 10;
      // louder masters feel more energetic: gain is about -15 (quiet) to -4 (loud)
      if (Number.isFinite(gain)) out.energy = Math.max(0.6, Math.min(1, 0.6 + (gain + 15) / 11 * 0.4));
    } else if (!r) return null;   // couldn't reach Deezer: try again next time
    store[key] = out;
    const ks = Object.keys(store);
    if (ks.length > 600) ks.sort((x, y) => (store[x].ts || 0) - (store[y].ts || 0)).slice(0, ks.length - 500).forEach(k => delete store[k]);
    try { localStorage.setItem('crow_media_viz_bpm', JSON.stringify(store)); } catch (_) {}
    return out.bpm ? out : null;
  },

  _vizDeezer(path) {
    return new Promise(resolve => {
      const cb = '__crowMediaVz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const s = document.createElement('script');
      let done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(t); try { delete window[cb]; } catch (_) { window[cb] = undefined; } s.remove(); resolve(v); };
      const t = setTimeout(() => finish(null), 8000);
      window[cb] = d => finish(d && !d.error ? d : null);
      s.onerror = () => finish(null);
      s.src = 'https://api.deezer.com' + path + (path.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
      (document.head || document.documentElement).appendChild(s);
    });
  }
});

K.ready.viz = true;
})();
