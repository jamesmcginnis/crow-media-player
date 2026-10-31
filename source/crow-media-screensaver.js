/*
 * Crow Media Player — Screensaver
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.saver) return;
const { CROW_MEDIA_SAVER_CSS, CROW_MEDIA_SAVER_STYLES, crowMediaAutoStart } = K.kit;
/* ══════════════════════════════════════════════════════════════════
 * SCREENSAVER: the animated weather sky behind the Clock & Weather
 * screensaver. Prefixed names (CrowMedia…) so they can't clash with
 * anything else on the same dashboard.
 * ══════════════════════════════════════════════════════════════════ */
const CROW_MEDIA_WX_NAMES = {
  'clear-night': 'Clear', cloudy: 'Cloudy', exceptional: 'Unusual weather', fog: 'Fog', hail: 'Hail', lightning: 'Thunderstorms',
  'lightning-rainy': 'Thunderstorms', partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow',
  'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy',
};

// Sky colours for the animated sky: [r, g, b] at the top of the gradient
const CROW_MEDIA_W_SKY = {   // night / dark theme
  'clear-night':[5,8,25],'cloudy':[38,50,80],'exceptional':[28,95,215],
  'fog':[58,68,88],'hail':[18,26,48],'lightning':[13,18,38],
  'lightning-rainy':[13,18,38],'partlycloudy':[28,82,175],
  'pouring':[14,32,72],'rainy':[18,52,108],'snowy':[48,62,98],
  'snowy-rainy':[33,48,82],'sunny':[28,95,215],'windy':[33,68,138],
  'windy-variant':[33,68,138],'default':[28,58,118],
};

const CROW_MEDIA_W_SKY_L = { // day / light theme
  'sunny':[74,149,214],'partlycloudy':[102,165,217],'exceptional':[56,132,210],
  'cloudy':[128,166,198],'fog':[190,202,216],'hail':[100,125,148],
  'lightning':[98,115,132],'lightning-rainy':[98,115,132],
  'pouring':[105,130,150],'rainy':[110,140,162],'snowy':[168,194,218],
  'snowy-rainy':[148,175,200],'windy':[88,155,202],'windy-variant':[88,155,202],
  'default':[88,145,200],
};

/* ══════════════════════════════════════════════════════════════════
 * ANIMATED SKY — behind the top of the Weather view
 * Clouds · Stars · Sun · Moon · Rain · Snow · Lightning · Fog
 * ══════════════════════════════════════════════════════════════════ */
class CrowMediaAtmCanvas {
  constructor(canvas) {
    this._cv = canvas; this._ctx = null;
    this._animId = null; this._lastFrame = 0;
    // Particle systems
    this._stars        = []; this._clouds     = []; this._rain = [];
    this._snow         = []; this._bolts      = []; this._fog  = [];
    this._birds        = []; this._windVapor  = [];
    this._shootStars   = []; this._comets     = [];
    this._planes       = []; this._dustMotes  = [];
    this._aurora       = null;
    // State
    this._cond = 'sunny'; this._isNight = false; this._isDark = true;
    this._w = 0; this._h = 0;
    // Phase counters
    this._frame = 0; this._gustPh = 0; this._sunPh = 0; this._moonPh = 0;
    this._flashOp = 0; this._flashHold = 0;
    this._shimmerPh = 0;
    // cloud drift speed: 1 = a near-still sky; the screensaver sets it higher so clouds cross the panel
    this.cloudDrift = 1;
  }

  /* ── Public API ──────────────────────────────────────────────── */
  init(cond, isNight, isDark, w, h) {
    this._cond = cond || 'cloudy';
    this._isNight = !!isNight; this._isDark = !!isDark;
    this._w = w; this._h = h;
    this._fitCanvas();
    this._build();
  }

  update(cond, isNight, isDark) {
    const ch = this._cond !== cond || this._isNight !== !!isNight || this._isDark !== !!isDark;
    this._cond = cond; this._isNight = !!isNight; this._isDark = !!isDark;
    if (ch) this._build();
  }

  resize(w, h) {
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this._fitCanvas();
    this._build();
  }

  // Sharp on high-density screens: the canvas has more pixels, drawing stays in CSS pixels
  _fitCanvas() {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this._cv.width = Math.round(this._w * dpr); this._cv.height = Math.round(this._h * dpr);
    this._ctx = this._cv.getContext('2d');
    if (this._ctx) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // One still frame (Reduce Motion, or while paused)
  drawOnce() { this._draw(); }

  start() {
    if (this._animId) return;
    const TARGET = 1000 / 30;
    const loop = (ts) => {
      if (ts - this._lastFrame >= TARGET) {
        this._lastFrame = ts - ((ts - this._lastFrame) % TARGET);
        this._draw();
      }
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  }

  stop() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
  }

  /* ── Seeded random ───────────────────────────────────────────── */
  _sRand(seed) {
    let s = seed;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  /* ── Build all particle systems ──────────────────────────────── */
  _build() {
    const c = this._cond, w = this._w, h = this._h;
    this._stars=[]; this._clouds=[]; this._rain=[];
    this._snow=[]; this._bolts=[]; this._fog=[];
    this._birds=[]; this._windVapor=[];
    this._shootStars=[]; this._comets=[]; this._planes=[];
    this._dustMotes=[]; this._aurora=null;
    this._flashOp=0;

    this._buildStars(c, w, h);
    this._buildClouds(c, w, h);
    this._buildPrecip(c, w, h);
    if (c==='fog') this._buildFog(w, h);
    this._buildWindVapor(w, h);

    // Dust motes: daytime sunny/fair conditions only
    if (!this._isNight && (c==='sunny'||c==='exceptional'||c==='partlycloudy')) {
      this._buildDustMotes(w, h);
    }
  }

  /* ── Stars ───────────────────────────────────────────────────── */
  _buildStars(c, w, h) {
    if (!this._isNight) return;
    const counts = { 'clear-night':240,'exceptional':200,'partlycloudy':85,
      'windy':70,'windy-variant':65,'cloudy':35,'fog':18,'rainy':18,
      'snowy':28,'snowy-rainy':18,'lightning':8,'lightning-rainy':8,'pouring':6,'hail':10 };
    const n = counts[c] ?? 55;
    const PI2 = Math.PI*2;
    for (let i = 0; i < n; i++) {
      const isBg = i<n*.68, isHero = i>=n*.90;
      const tier = isHero?'hero':isBg?'bg':'mid';
      const [sz,br,rate] = isHero ? [1.4+Math.random(),.78+Math.random()*.18,.003+Math.random()*.006]
                         : isBg   ? [0.4+Math.random()*.7,.28+Math.random()*.22,.012+Math.random()*.015]
                         :          [.85+Math.random()*.85,.52+Math.random()*.24,.008+Math.random()*.01];
      const rv = Math.random();
      this._stars.push({ x:Math.random()*w, y:Math.random()*h*.88,
        r:sz, brightness:br, rate, phase:Math.random()*PI2, tier,
        hue:rv<.15?35:rv<.55?215:200, sat:rv<.15?60:rv<.55?25:8 });
    }
  }

  /* ── Clouds ──────────────────────────────────────────────────── */
  _buildClouds(c, w, h) {
    const nc = ({'clear-night':0,'sunny':0,'exceptional':0,'partlycloudy':4,'cloudy':9,
      'fog':7,'hail':8,'lightning':10,'lightning-rainy':9,'pouring':10,'rainy':8,
      'snowy':8,'snowy-rainy':7,'windy':6,'windy-variant':6})[c] ?? 5;
    const storm = c==='lightning'||c==='lightning-rainy'||c==='pouring'||c==='hail';
    const rainy  = c==='rainy'||c==='snowy'||c==='snowy-rainy';

    for (let i=0; i<nc; i++) {
      const rand = this._sRand(Math.random()*9999 + i*1337);
      // Depth layers: foreground clouds are bigger and lower
      const layer = 1 + (i % 3);             // 1=bg, 2=mid, 3=fg
      const depthScale = 0.55 + layer * 0.22; // bg smaller, fg larger
      const x = Math.random()*(w*1.6) - w*.3;
      const yRange = storm ? 0.42 : rainy ? 0.48 : 0.54;
      const y = h*(0.02 + rand()*(storm?0.38:yRange));
      const baseR = h*(0.10 + rand()*0.22) * depthScale;
      const vSq  = storm ? 0.38 : 0.42;    // vertical squash

      // Build organic cloud from many overlapping puffs
      // More puffs = rounder, more detailed shape
      const pc = 10 + Math.floor(rand()*7);  // 10-16 puffs per cloud
      const puffs = [];

      // Main body ring of puffs
      for (let p=0; p<pc; p++) {
        const ang = (p/pc)*Math.PI*2 + rand()*.6;
        const dist = rand()*.55 + .22;
        const dx = Math.cos(ang)*baseR*.58*dist;
        const dy = Math.sin(ang)*baseR*.58*dist*vSq;
        const r  = baseR*(.18 + rand()*.26);
        const normY = (dy + baseR*vSq) / (baseR*vSq*2);
        puffs.push({dx, dy, r, shade: Math.min(1, 0.38+(1-normY)*0.50), isRim:false});
      }
      // Crown puffs — extra large, bright top
      puffs.push({dx:0,         dy:-baseR*vSq*.25, r:baseR*.42, shade:.96, isRim:false});
      puffs.push({dx:-baseR*.18,dy:-baseR*vSq*.18, r:baseR*.30, shade:.90, isRim:false});
      puffs.push({dx: baseR*.18,dy:-baseR*vSq*.18, r:baseR*.30, shade:.90, isRim:false});
      // Side puffs for width
      puffs.push({dx:-baseR*.52,dy: baseR*vSq*.08, r:baseR*.28, shade:.72, isRim:false});
      puffs.push({dx: baseR*.52,dy: baseR*vSq*.08, r:baseR*.28, shade:.72, isRim:false});
      // Rim highlight — very subtle bright edge on top
      puffs.push({dx:0,         dy:-baseR*vSq*.35, r:baseR*.18, shade:1.0, isRim:true});

      puffs.sort((a,b)=>a.shade-b.shade);  // draw dark first, bright on top

      // Wind speed: fg clouds move faster than bg
      const spd = (0.04 + rand()*0.10) * depthScale;

      this._clouds.push({x, y, puffs, speed:spd, op:0.72+rand()*0.24,
        breathPh:rand()*Math.PI*2, breathSpd:0.002+rand()*0.003,
        layer, flashInt:0, depthScale});
    }
  }

  /* ── Precipitation ───────────────────────────────────────────── */
  _buildPrecip(c, w, h) {
    const pm = {'hail':{rain:80},'lightning':{rain:160},'lightning-rainy':{rain:130},
      'pouring':{rain:200},'rainy':{rain:120},'snowy':{snow:60},'snowy-rainy':{rain:55,snow:35}};
    const p = pm[c]||{};
    for (let i=0;i<(p.rain||0);i++) {
      const z=.42+Math.random()*.58;
      this._rain.push({x:Math.random()*w,y:Math.random()*h,vy:(5.5+Math.random()*5.5)*z,
        vx:(-.55-Math.random()*.75)*z,len:(9+Math.random()*14)*z,op:.22+Math.random()*.38,z});
    }
    for (let i=0;i<(p.snow||0);i++) {
      const z=.42+Math.random()*.58, sr=Math.random();
      const sz=sr<.28?(.38+Math.random()*.55)*z:sr<.68?(1.1+Math.random()*1.1)*z:(2.0+Math.random()*1.8)*z;
      this._snow.push({x:Math.random()*w,y:Math.random()*h,vy:(.28+Math.random()*.65)*z*(sz/2.2),
        vx:(Math.random()-.5)*.38,size:sz,op:.5+Math.random()*.42,z,
        wobPh:Math.random()*Math.PI*2,wobSpd:.016+Math.random()*.016});
    }
  }

  /* ── Fog ─────────────────────────────────────────────────────── */
  _buildFog(w, h) {
    for (let i=0;i<8;i++) {
      this._fog.push({x:Math.random()*w,y:h*(.28+Math.random()*.58),
        bw:w*(.9+Math.random()*.85),bh:30+Math.random()*42,
        spd:(.06+Math.random()*.10)*(Math.random()>.5?1:-1),
        op:.22+Math.random()*.14,ph:Math.random()*Math.PI*2,layer:i/8});
    }
  }

  /* ── Wind vapor ──────────────────────────────────────────────── */
  _buildWindVapor(w, h) {
    for (let i=0;i<18;i++) {
      const tier=i<6?0:i<12?1:2, depth=0.5+tier*0.25;
      this._windVapor.push({x:Math.random()*w*2-w*.5,y:h*.05+Math.random()*h*.85,
        w:w*(.7+Math.random()*.9)*depth,speed:(0.8+Math.random()*1.4)*depth,
        tier,ph:Math.random()*Math.PI*2,phSpd:.004+Math.random()*.004,
        drift:1.5+Math.random()*3,squash:.06+tier*.03+Math.random()*.02});
    }
  }

  /* ── Dust motes ──────────────────────────────────────────────── */
  _buildDustMotes(w, h) {
    const cx=w*.74, cy=h*.25;
    for (let i=0;i<28;i++) {
      this._dustMotes.push({
        x:cx+(Math.random()-.5)*280, y:cy+(Math.random()-.5)*140,
        size:.4+Math.random()*1.4,
        vx:(Math.random()-.5)*.28, vy:(Math.random()-.5)*.18,
        ph:Math.random()*Math.PI*2, op:.12+Math.random()*.22,
      });
    }
  }

  /* ── Cloud colour palette ────────────────────────────────────── */
  _pal() {
    const c=this._cond,n=this._isNight,d=this._isDark;
    const storm=c==='lightning'||c==='lightning-rainy'||c==='pouring';
    if (n&&d)     return {lit:[215,225,240],shd:[10,16,30], amb:.72};
    if (n)        return {lit:[200,215,240],shd:[40,52,78], amb:.85};
    if (d&&storm) return {lit:[110,118,135],shd:[12,15,22], amb:.85};
    if (d)        return {lit:[228,238,255],shd:[24,29,48], amb:.80};
    if (storm)    return {lit:[255,255,255],shd:[120,132,158],amb:.92};
    if (c==='rainy'||c==='snowy'||c==='snowy-rainy') return {lit:[255,255,255],shd:[155,166,190],amb:1.0};
    if (c==='cloudy'||c==='fog') return {lit:[255,255,255],shd:[120,134,162],amb:1.0};
    return {lit:[255,255,255],shd:[176,187,207],amb:1.0};
  }

  /* ── Master draw ─────────────────────────────────────────────── */
  _draw() {
    const ctx=this._ctx; if(!ctx) return;
    const w=this._w, h=this._h, c=this._cond;
    this._frame++; this._gustPh+=.008; this._sunPh+=.006; this._moonPh+=.003; this._shimmerPh+=.018;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    this._dSky(ctx,w,h);
    // Background layers
    if (this._isNight&&this._stars.length) this._dStars(ctx,w,h);
    if (this._isNight) this._dMoon(ctx,w,h); else this._dSun(ctx,w,h);
    // Mid layers
    this._dWindVapor(ctx,w,h);
    // Background + mid clouds (layers 1-2) first, foreground clouds (layer 3) later
    if (this._clouds.length)  this._dClouds(ctx,w,h, 1, 2);
    if (this._fog.length)     this._dFog(ctx,w,h);
    if (this._clouds.length)  this._dClouds(ctx,w,h, 3, 3);
    if (this._dustMotes.length&&!this._isNight) this._dDustMotes(ctx,w,h);
    if (!this._isNight&&(c==='sunny'||c==='exceptional')) this._dHeatShimmer(ctx,w,h);
    // Foreground precipitation
    if (this._rain.length)   this._dRain(ctx,w,h);
    if (this._snow.length)   this._dSnow(ctx,w,h);
    if (c==='lightning'||c==='lightning-rainy') this._dLightning(ctx,w,h);
    ctx.restore();
  }

  /* ── Sky ─────────────────────────────────────────────────────── */
  _dSky(ctx, w, h) {
    const c=this._cond, n=this._isNight, d=this._isDark;
    const useLight=!n&&!d;
    const skyMap=useLight?CROW_MEDIA_W_SKY_L:CROW_MEDIA_W_SKY;
    const [sr,sg,sb]=skyMap[c]||skyMap.default||[28,58,118];
    const g=ctx.createLinearGradient(0,0,0,h);
    if (useLight) {
      // Extra stops for smoother light-sky transition
      g.addColorStop(0,   `rgb(${Math.max(0,sr-22)},${Math.max(0,sg-22)},${Math.max(0,sb-16)})`);
      g.addColorStop(.18, `rgb(${Math.max(0,sr-12)},${Math.max(0,sg-12)},${Math.max(0,sb-8)})`);
      g.addColorStop(.40, `rgb(${sr},${sg},${sb})`);
      g.addColorStop(.62, `rgb(${Math.min(255,sr+20)},${Math.min(255,sg+22)},${Math.min(255,sb+12)})`);
      g.addColorStop(.82, `rgb(${Math.min(255,sr+42)},${Math.min(255,sg+44)},${Math.min(255,sb+26)})`);
      g.addColorStop(1,   `rgb(${Math.min(255,sr+72)},${Math.min(255,sg+70)},${Math.min(255,sb+38)})`);
    } else if (n) {
      g.addColorStop(0,   `rgb(${Math.max(0,sr-4)},${Math.max(0,sg-4)},${Math.max(0,sb-4)})`);
      g.addColorStop(.30, `rgb(${Math.max(0,sr-2)},${Math.max(0,sg-2)},${Math.max(0,sb-2)})`);
      g.addColorStop(.65, `rgb(${sr},${sg},${sb})`);
      g.addColorStop(.85, `rgb(${Math.min(255,sr+3)},${Math.min(255,sg+3)},${Math.min(255,sb+3)})`);
      g.addColorStop(1,   `rgb(${Math.min(255,sr+6)},${Math.min(255,sg+6)},${Math.min(255,sb+6)})`);
    } else {
      g.addColorStop(0,   `rgb(${Math.max(0,sr-22)},${Math.max(0,sg-22)},${Math.max(0,sb-20)})`);
      g.addColorStop(.25, `rgb(${Math.max(0,sr-12)},${Math.max(0,sg-12)},${Math.max(0,sb-11)})`);
      g.addColorStop(.55, `rgb(${sr},${sg},${sb})`);
      g.addColorStop(.78, `rgb(${Math.min(255,sr+5)},${Math.min(255,sg+6)},${Math.min(255,sb+8)})`);
      g.addColorStop(1,   `rgb(${Math.min(255,sr+10)},${Math.min(255,sg+12)},${Math.min(255,sb+16)})`);
    }
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);

    // Warm horizon haze on light clear/fair days
    if (useLight&&(c==='sunny'||c==='partlycloudy'||c==='exceptional'||c==='windy'||c==='windy-variant')) {
      const hz=ctx.createLinearGradient(0,h*.60,0,h);
      hz.addColorStop(0,'rgba(255,230,180,0)'); hz.addColorStop(1,'rgba(255,215,148,0.13)');
      ctx.fillStyle=hz; ctx.fillRect(0,0,w,h);
    }

    // Film-grain noise overlay — breaks up gradient banding
    // Uses a seeded pattern that changes slowly so it's not distracting
    const grainOp = useLight ? 0.028 : (n ? 0.018 : 0.022);
    this._dGrain(ctx, w, h, grainOp);
  }

  /* ── Film grain — eliminates canvas gradient banding ────────── */
  _dGrain(ctx, w, h, opacity) {
    // Draw a sparse scatter of tiny semi-transparent pixels
    // Using a fast pseudo-random walk rather than ImageData for performance
    const count = Math.floor(w * h * 0.08); // ~8% pixel coverage
    const seed  = (this._frame * 1.618 + 137) | 0; // slowly drifting seed
    ctx.save();
    ctx.globalAlpha = opacity;
    // Alternate between light and dark grain for true dithering
    for (let i = 0; i < count; i++) {
      // LCG fast random inline
      const r = (seed * 1664525 + (i * 22695477 + 1013904223)) >>> 0;
      const x = (r >>> 17) % w;
      const y = (r >>> 5)  % h;
      const bright = (r & 1) ? 255 : 0;
      ctx.fillStyle = `rgba(${bright},${bright},${bright},1)`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  /* ── Stars ───────────────────────────────────────────────────── */
  _dStars(ctx, w, h) {
    const dark=this._isDark, PI2=Math.PI*2;
    for (const s of this._stars) {
      s.phase+=s.rate;
      const tw=Math.sin(s.phase)+Math.sin(s.phase*2.85)*.38;
      const op=Math.max(0,Math.min(1,s.brightness*(1+tw*.18)));
      if (op<.04) continue;
      const r=s.r*(1+tw*.22);
      const fill=dark?`hsla(${s.hue},${s.sat}%,93%,${op})`:`hsla(${s.hue<100?36:42},72%,${s.hue<100?42:38}%,${op*.82})`;
      if (s.tier==='hero') {
        if (dark) {
          ctx.globalCompositeOperation='lighter';
          const gr=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,r*3);
          gr.addColorStop(0,`hsla(${s.hue},${s.sat}%,95%,${op*.88})`);
          gr.addColorStop(.45,`hsla(${s.hue},${s.sat}%,90%,${op*.14})`);
          gr.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(s.x,s.y,r*3,0,PI2); ctx.fill();
          ctx.globalCompositeOperation='source-over';
        }
        ctx.globalAlpha=op; ctx.fillStyle=fill;
        ctx.beginPath(); ctx.arc(s.x,s.y,r*.58,0,PI2); ctx.fill();
        ctx.globalAlpha=op*.28; ctx.strokeStyle=fill; ctx.lineWidth=.5;
        ctx.beginPath();
        ctx.moveTo(s.x-r*1.9,s.y); ctx.lineTo(s.x+r*1.9,s.y);
        ctx.moveTo(s.x,s.y-r*1.9); ctx.lineTo(s.x,s.y+r*1.9);
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation=dark?'lighter':'source-over';
        ctx.globalAlpha=op*(dark?1:.78); ctx.fillStyle=fill;
        ctx.beginPath(); ctx.arc(s.x,s.y,r*.50,0,PI2); ctx.fill();
      }
    }
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  }

  /* ── Moon ────────────────────────────────────────────────────── */
  _dMoon(ctx, w, h) {
    const mx=w*.73, my=h*.26, dark=this._isDark, PI2=Math.PI*2;
    const moonR=Math.min(h*.115,22), pulse=1+Math.sin(this._moonPh*.8)*.016;
    ctx.globalCompositeOperation=dark?'screen':'source-over';
    const glowR=moonR*(dark?3.5:2.8);
    const glow=ctx.createRadialGradient(mx,my,0,mx,my,glowR);
    dark?(glow.addColorStop(0,'rgba(185,208,255,.62)'),glow.addColorStop(.38,'rgba(165,192,248,.20)'),glow.addColorStop(1,'rgba(148,175,220,0)'))
        :(glow.addColorStop(0,'rgba(140,178,255,.72)'),glow.addColorStop(.32,'rgba(158,192,255,.30)'),glow.addColorStop(1,'rgba(175,208,255,0)'));
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(mx,my,glowR,0,PI2); ctx.fill();
    ctx.globalCompositeOperation='source-over';
    if (dark){ctx.save();ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,1)';ctx.beginPath();ctx.arc(mx,my,moonR*pulse-.5,0,PI2);ctx.fill();ctx.restore();}
    const disc=ctx.createRadialGradient(mx-moonR*.3,my-moonR*.3,0,mx,my,moonR*pulse);
    dark?(disc.addColorStop(0,'rgba(255,255,252,.97)'),disc.addColorStop(.62,'rgba(232,240,255,.93)'),disc.addColorStop(1,'rgba(210,225,248,.86)'))
        :(disc.addColorStop(0,'rgba(255,255,255,.90)'),disc.addColorStop(.62,'rgba(242,248,255,.80)'),disc.addColorStop(1,'rgba(218,232,252,.65)'));
    ctx.fillStyle=disc; ctx.beginPath(); ctx.arc(mx,my,moonR*pulse,0,PI2); ctx.fill();
    if (moonR>8){
      ctx.save(); ctx.beginPath(); ctx.arc(mx,my,moonR,0,PI2); ctx.clip();
      ctx.globalAlpha=dark?.14:.11; ctx.fillStyle=dark?'rgba(28,33,52,1)':'rgba(175,188,210,1)';
      ctx.beginPath(); ctx.ellipse(mx-moonR*.40,my+moonR*.10,moonR*.30,moonR*.40,.22,0,PI2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(mx+moonR*.33,my-moonR*.24,moonR*.20,moonR*.14,-.3,0,PI2); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha=1;
  }
  _dSun(ctx, w, h) {
    const c=this._cond;
    if (c==='fog'||c==='lightning'||c==='lightning-rainy'||c==='pouring') return;
    const sx=w*.74, sy=h*.25, dark=this._isDark, PI2=Math.PI*2;
    const pulse=1+Math.sin(this._sunPh*.55)*.032, sunR=Math.min(h*.13,24);
    const cR=sunR*(dark?3.5:5.5)*pulse;
    const cor=ctx.createRadialGradient(sx,sy,0,sx,sy,cR);
    dark?(cor.addColorStop(0,'rgba(255,225,85,.32)'),cor.addColorStop(.20,'rgba(255,195,45,.16)'),cor.addColorStop(.52,'rgba(255,165,22,.06)'),cor.addColorStop(1,'rgba(255,138,0,0)'))
        :(cor.addColorStop(0,'rgba(255,245,170,.80)'),cor.addColorStop(.15,'rgba(255,220,88,.52)'),cor.addColorStop(.32,'rgba(255,195,50,.26)'),cor.addColorStop(.55,'rgba(255,170,25,.10)'),cor.addColorStop(1,'rgba(255,140,0,0)'));
    ctx.fillStyle=cor; ctx.beginPath(); ctx.arc(sx,sy,cR,0,PI2); ctx.fill();
    const dR=(dark?sunR:sunR*2.5)*pulse;
    const disc=ctx.createRadialGradient(sx-sunR*.22,sy-sunR*.24,0,sx,sy,dR);
    dark?(disc.addColorStop(0,'rgba(255,255,218,1)'),disc.addColorStop(.38,'rgba(255,218,65,1)'),disc.addColorStop(1,'rgba(255,132,0,1)'))
        :(disc.addColorStop(0,'rgba(255,255,255,1)'),disc.addColorStop(.25,'rgba(255,255,228,.98)'),disc.addColorStop(.52,'rgba(255,235,150,.88)'),disc.addColorStop(.78,'rgba(255,195,58,.48)'),disc.addColorStop(1,'rgba(255,160,28,0)'));
    ctx.fillStyle=disc; ctx.beginPath(); ctx.arc(sx,sy,dR,0,PI2); ctx.fill();
  }

  /* ── Wind vapor ──────────────────────────────────────────────── */
  _dWindVapor(ctx, w, h) {
    const c=this._cond, PI2=Math.PI*2;
    const isWindy=c==='windy'||c==='windy-variant'||c==='cloudy'||c==='partlycloudy'||c==='rainy'||c==='snowy';
    const spdScale=isWindy?1.8:.6, d=this._isDark;
    const wind=.06+Math.sin(this._gustPh)*.04;
    for (const v of this._windVapor) {
      v.ph+=v.phSpd*spdScale; v.x+=(v.speed*spdScale+wind*40)*.5;
      if (v.x>w+v.w) v.x=-v.w;
      const uy=Math.sin(v.ph)*v.drift;
      const baseOp=d?(.04+v.tier*.02):(.08+v.tier*.04);
      const op=Math.min(.28,baseOp*(isWindy?1.6:1.0));
      if (op<.01) continue;
      const col=d?'210,225,245':'255,255,255';
      const gr=ctx.createRadialGradient(v.x,v.y+uy,0,v.x,v.y+uy,v.w/2);
      gr.addColorStop(0,`rgba(${col},${op})`); gr.addColorStop(.45,`rgba(${col},${op*.35})`); gr.addColorStop(1,`rgba(${col},0)`);
      ctx.save(); ctx.scale(1,v.squash*2.5);
      ctx.fillStyle=gr; ctx.beginPath();
      ctx.ellipse(v.x,(v.y+uy)/(v.squash*2.5),v.w/2,v.w*.3,0,0,PI2); ctx.fill();
      ctx.restore();
    }
  }

  /* ── Clouds ──────────────────────────────────────────────────── */
  _dClouds(ctx, w, h, minLayer = 1, maxLayer = 3) {
    const pal  = this._pal();
    const wind = .06 + Math.sin(this._gustPh)*.06;
    const PI2  = Math.PI*2;

    const sorted = [...this._clouds].sort((a,b) => a.layer - b.layer);

    for (const cl of sorted) {
      if (cl.layer < minLayer || cl.layer > maxLayer) continue;
      // Parallax: bg clouds drift slower
      if (this.cloudDrift > 1) {
        // steady drift with a gentle gusting rhythm (never stopping); wraps once fully off the edge
        if (cl.span == null) cl.span = cl.puffs.reduce((m, p) => Math.max(m, Math.abs(p.dx) + p.r), 0) * 1.3 + 8;
        cl.x += cl.speed * 0.06 * this.cloudDrift * (0.8 + Math.sin(this._gustPh + cl.layer) * 0.2) * (1 + cl.layer * .20);
        if (cl.x - cl.span > w) cl.x = -cl.span;
      } else {
        cl.x += cl.speed * wind * (1 + cl.layer * .20);
        if (cl.x > w + 200) cl.x = -200;
      }
      cl.breathPh += cl.breathSpd;
      const bS = 1 + Math.sin(cl.breathPh) * .018;
      const fl = cl.flashInt || 0; if (fl > 0) cl.flashInt *= .70;

      ctx.save(); ctx.translate(cl.x, cl.y);

      for (const pf of cl.puffs) {
        const dx = pf.dx * bS, dy = pf.dy, r = pf.r * bS;
        const sh = pf.shade, is = 1 - sh;

        // Base colour from palette interpolation
        let tR = (pal.lit[0]*sh + pal.shd[0]*is) | 0;
        let tG = (pal.lit[1]*sh + pal.shd[1]*is) | 0;
        let tB = (pal.lit[2]*sh + pal.shd[2]*is) | 0;
        const mR = ((pal.lit[0]+pal.shd[0])/2)|0;
        const mG = ((pal.lit[1]+pal.shd[1])/2)|0;
        const mB = ((pal.lit[2]+pal.shd[2])/2)|0;

        // Lightning flash tint
        if (fl > .01) {
          tR = (tR + (255-tR)*fl*.65) | 0;
          tG = (tG + (255-tG)*fl*.65) | 0;
          tB = (tB + (255-tB)*fl*.85) | 0;
        }

        // Layer opacity: bg clouds slightly more transparent
        const layerAlpha = 0.82 + cl.layer * 0.06;
        const op = Math.min(1, cl.op * pal.amb * sh * layerAlpha);
        if (op < .03) continue;

        if (pf.isRim) {
          // Rim highlight: thin bright crescent on top using screen blend
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = op * .55;
          const rg = ctx.createRadialGradient(dx-r*.12, dy-r*.42, 0, dx, dy, r);
          rg.addColorStop(0, `rgba(255,255,255,.85)`);
          rg.addColorStop(.45, `rgba(255,255,255,.20)`);
          rg.addColorStop(1,  `rgba(255,255,255,0)`);
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.ellipse(dx, dy, r, r*.55, 0, 0, PI2); ctx.fill();
          ctx.restore();
        } else {
          // Main puff — 4-stop radial gradient for volume
          const g = ctx.createRadialGradient(dx-r*.16, dy-r*.42, 0, dx, dy, r*1.05);
          g.addColorStop(0,   `rgba(${tR},${tG},${tB},${Math.min(1,op*1.1)})`);
          g.addColorStop(.28, `rgba(${tR},${tG},${tB},${op})`);
          g.addColorStop(.58, `rgba(${mR},${mG},${mB},${op*.55})`);
          g.addColorStop(.82, `rgba(${pal.shd[0]},${pal.shd[1]},${pal.shd[2]},${op*.10})`);
          g.addColorStop(1,   `rgba(${pal.shd[0]},${pal.shd[1]},${pal.shd[2]},0)`);
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(dx, dy, r, r * .72, 0, 0, PI2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ── Fog ─────────────────────────────────────────────────────── */
  _dFog(ctx, w, h) {
    const col=this._isDark?'82,88,105':'188,198,215', PI2=Math.PI*2;
    for (const f of this._fog) {
      f.x+=f.spd; f.ph+=.006;
      if(f.x>w+f.bw/2)f.x=-f.bw/2; if(f.x<-f.bw/2)f.x=w+f.bw/2;
      const ys=.14+f.layer*.19, uy=Math.sin(f.ph)*3.5;
      ctx.save(); ctx.scale(1,ys);
      const g=ctx.createRadialGradient(f.x,(f.y+uy)/ys,0,f.x,(f.y+uy)/ys,f.bw/2);
      g.addColorStop(0,`rgba(${col},${f.op})`); g.addColorStop(.52,`rgba(${col},${f.op*.52})`); g.addColorStop(1,`rgba(${col},0)`);
      ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(f.x,(f.y+uy)/ys,f.bw/2,f.bh,0,0,PI2); ctx.fill(); ctx.restore();
    }
  }

  /* ── Dust motes (sunlit specks near the sun) ───────────────── */
  _dDustMotes(ctx, w, h) {
    ctx.save(); ctx.globalCompositeOperation=this._isDark?'lighter':'source-over';
    const light=!this._isDark, m=light?2.2:2.8;
    for (const d of this._dustMotes) {
      d.ph+=.014; d.x+=d.vx+Math.sin(d.ph)*.14; d.y+=d.vy+Math.cos(d.ph*.7)*.09;
      if(d.x>w+5)d.x=-5; if(d.x<-5)d.x=w+5;
      if(d.y>h+5)d.y=-5; if(d.y<-5)d.y=h+5;
      const tw=.7+Math.sin(d.ph*2)*.3;
      ctx.globalAlpha=d.op*tw*m;
      ctx.fillStyle=light?'rgba(255,245,210,1)':'rgba(255,250,220,1)';
      ctx.beginPath(); ctx.arc(d.x,d.y,d.size*tw,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  /* ── Heat shimmer ────────────────────────────────────────────── */
  _dHeatShimmer(ctx, w, h) {
    ctx.save(); ctx.globalAlpha=.028;
    ctx.strokeStyle=this._isDark?'rgba(255,200,100,.15)':'rgba(255,180,80,.10)';
    ctx.lineWidth=2;
    for (let i=0;i<3;i++) {
      ctx.beginPath();
      const by=h-28+i*9;
      for (let x=0;x<=w;x+=4) {
        const y=by+Math.sin(x*.03+this._shimmerPh+i*.5)*3;
        x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Rain ────────────────────────────────────────────────────── */
  _dRain(ctx, w, h) {
    ctx.lineCap = 'round';
    // Light theme: make rain noticeably darker so it reads against blue sky
    const col = this._isDark ? 'rgba(178,208,245,1)' : 'rgba(55,88,140,1)';
    const opBoost = this._isDark ? 1.0 : 1.6; // brighter on light bg
    for (const p of this._rain) {
      p.y += p.vy; p.x += p.vx;
      if (p.y > h+14) { p.y = -14; p.x = Math.random()*w; }
      if (p.x < -8) p.x = w+8;
      ctx.globalAlpha = Math.min(1, p.op * opBoost);
      ctx.strokeStyle = col;
      ctx.lineWidth = p.z * .85;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx*1.8, p.y - p.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ── Snow ────────────────────────────────────────────────────── */
  _dSnow(ctx, w, h) {
    const PI2=Math.PI*2;
    for (const p of this._snow) {
      p.wobPh+=p.wobSpd; p.y+=p.vy; p.x+=p.vx+Math.sin(p.wobPh)*.40;
      if(p.y>h+6){p.y=-6;p.x=Math.random()*w;}
      if(p.x<-6)p.x=w+6; if(p.x>w+6)p.x=-6;
      const sh=.88+Math.sin(p.wobPh*2.5)*.12;
      ctx.globalAlpha=p.op*sh;
      if (p.size>1.6) {
        const gr=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size*sh);
        gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.48,'rgba(255,255,255,.52)'); gr.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle=gr;
      } else ctx.fillStyle='rgba(255,255,255,1)';
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*sh,0,PI2); ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  /* ── Lightning ───────────────────────────────────────────────── */
  _dLightning(ctx, w, h) {
    if (Math.random()<.007&&this._bolts.length<3) {
      this._flashOp=.72; this._flashHold=5;
      this._bolts.push(this._makeBolt(w,h));
      for (const cl of this._clouds) cl.flashInt=.68;
    }
    if (this._flashOp>0) {
      if(this._flashHold>0)this._flashHold--;else this._flashOp*=.65;
      ctx.globalAlpha=this._flashOp*.38; ctx.fillStyle='rgba(170,198,255,1)';
      ctx.fillRect(0,0,w,h); ctx.globalAlpha=1;
      if(this._flashOp<.004)this._flashOp=0;
    }
    for (let i=this._bolts.length-1;i>=0;i--) {
      const b=this._bolts[i];
      ctx.save(); ctx.lineCap='round';
      ctx.globalAlpha=b.alpha*.18; ctx.strokeStyle='rgba(158,188,255,1)'; ctx.lineWidth=11;
      for(const s of b.segs){if(!s.br){ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.nx,s.ny);ctx.stroke();}}
      ctx.globalAlpha=b.alpha; ctx.strokeStyle='rgba(255,255,255,1)'; ctx.lineWidth=1.8;
      for(const s of b.segs){if(!s.br){ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.nx,s.ny);ctx.stroke();}}
      ctx.restore();
      b.alpha-=.058; if(b.alpha<=0)this._bolts.splice(i,1);
    }
  }
  _makeBolt(w,h) {
    const x=w*.18+Math.random()*w*.64, segs=[];
    let cx=x, cy=0, bias=(Math.random()-.5)*12;
    while(cy<h*.88){const ny=cy+9+Math.random()*17,nx=cx+bias+(Math.random()*20-10);segs.push({x:cx,y:cy,nx,ny,br:false});if(Math.random()<.18){const d=Math.random()>.5?1:-1;segs.push({x:cx,y:cy,nx:cx+d*(10+Math.random()*20),ny:cy+10+Math.random()*16,br:true});}cx=nx;cy=ny;}
    return {segs,alpha:.95};
  }
}

class CrowMediaClockDrawer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this._config = {};
    this._px     = 220;
  }

  setConfig(config) { this._config = config; }

  resize(px) {
    this._px = px;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = px * dpr;
    this.canvas.height = px * dpr;
    this.canvas.style.width  = px + 'px';
    this.canvas.style.height = px + 'px';
  }

  draw(h, m, s, secondAngle) {
    const dpr = window.devicePixelRatio || 1;
    const px  = this._px;
    const r   = px / 2;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, px * dpr, px * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(r, r);

    this._drawFace(r, h, m, s, secondAngle);
    this._drawHands(r, h, m, s, secondAngle);

    ctx.restore();
  }

  _drawFace(r, h, m, s, secondAngle) {
    const ctx   = this.ctx;
    const cfg   = this._config;
    const face  = cfg.face || 'classic';
    const dial  = cfg.dial_color && cfg.dial_color !== 'transparent' ? cfg.dial_color : null;
    const accent = cfg.accent_color    || '#007AFF';
    const text   = cfg.dial_text_color || '#FFFFFF';

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.5, 0, 2 * Math.PI);
    ctx.clip();
    if (dial) {
      ctx.fillStyle = dial;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    const vig = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vig;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    switch (face) {
      case 'minimal':   this._faceMinimal(r, accent, text);   break;
      case 'roman':     this._faceRoman(r, accent, text);     break;
      case 'modern':    this._faceModern(r, accent, text);    break;
      case 'luxury':    this._faceLuxury(r, accent, text);    break;
      case 'skeleton':  this._faceSkeleton(r, accent, text);  break;
      case 'neon':      this._faceNeon(r, accent, text);      break;
      case 'retro':     this._faceRetro(r, accent, text);     break;
      case 'sport':     this._faceSport(r, accent, text);     break;
      case 'art_deco':  this._faceArtDeco(r, accent, text);   break;
      case 'celestial': this._faceCelestial(r, accent, text); break;
      case 'stargate':  this._faceStargate(r, accent, text, h, m, s, secondAngle); break;
      default:          this._faceClassic(r, accent, text);   break;
    }
  }

  _faceClassic(r, accent, text) {
    const ctx = this.ctx;
    for (let i = 0; i < 60; i++) {
      const a        = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isHour   = i % 5 === 0;
      const isQuarter = i % 15 === 0;
      const inner    = isHour ? (isQuarter ? r * 0.76 : r * 0.80) : r * 0.89;
      const outer    = r * 0.92;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.strokeStyle = isHour ? text : 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = isQuarter ? 3.2 : isHour ? 2 : 0.8;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    for (let i = 1; i <= 12; i++) {
      const a  = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.font = `600 ${r * 0.148}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
      ctx.fillText(String(i), Math.cos(a) * r * 0.665, Math.sin(a) * r * 0.665);
    }
  }

  _faceMinimal(r, accent, text) {
    const ctx = this.ctx;
    for (let i = 0; i < 60; i++) {
      const a         = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isHour    = i % 5 === 0;
      const isQuarter = i % 15 === 0;
      if (!isHour) {
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.91, Math.sin(a) * r * 0.91, r * 0.012, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fill();
      } else {
        const dotR = isQuarter ? r * 0.052 : r * 0.030;
        const dist = r * 0.83;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * dist, Math.sin(a) * dist, dotR, 0, 2 * Math.PI);
        ctx.fillStyle = isQuarter ? text : 'rgba(255,255,255,0.55)';
        ctx.fill();
      }
    }
  }

  _faceRoman(r, accent, text) {
    const ctx      = this.ctx;
    const numerals = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
    const fSizes   = { XII: 0.100, VIII: 0.083, VII: 0.092, XI: 0.090, IV: 0.100 };
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
      ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 0.7; ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.83, Math.sin(a) * r * 0.83);
      ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    for (let i = 0; i < 12; i++) {
      const a   = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const num = numerals[i];
      ctx.font  = `500 ${r * (fSizes[num] || 0.104)}px 'Times New Roman', Georgia, serif`;
      ctx.fillText(num, Math.cos(a) * r * 0.685, Math.sin(a) * r * 0.685);
    }
  }

  _faceModern(r, accent, text) {
    const ctx = this.ctx;
    for (let i = 0; i < 60; i++) {
      const a        = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isHour   = i % 5 === 0;
      const isQuarter = i % 15 === 0;
      const inner    = r * (isQuarter ? 0.74 : isHour ? 0.80 : 0.87);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.strokeStyle = isHour ? accent : 'rgba(255,255,255,0.13)';
      ctx.lineWidth   = isQuarter ? 3 : isHour ? 2 : 0.7;
      ctx.lineCap     = 'round'; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    [[12, 0], [3, 3], [6, 6], [9, 9]].forEach(([n, i]) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.font = `800 ${r * 0.185}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
      ctx.fillText(String(n), Math.cos(a) * r * 0.615, Math.sin(a) * r * 0.615);
    });
  }

  _faceLuxury(r, accent, text) {
    const ctx  = this.ctx;
    const gold = '#C9A84C';
    ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, 2 * Math.PI);
    ctx.strokeStyle = gold; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.905, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(201,168,76,0.22)'; ctx.lineWidth = 0.8; ctx.stroke();
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.865, Math.sin(a) * r * 0.865);
      ctx.lineTo(Math.cos(a) * r * 0.895, Math.sin(a) * r * 0.895);
      ctx.strokeStyle = 'rgba(201,168,76,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a      = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isMaj  = i % 3 === 0;
      const inner  = r * (isMaj ? 0.725 : 0.795);
      const outer  = r * 0.87;
      const hw     = r * (isMaj ? 0.032 : 0.018);
      ctx.save();
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = gold;
      ctx.roundRect(-hw / 2, -outer, hw, outer - inner, hw / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.roundRect(-hw * 0.2, -outer + hw, hw * 0.4, (outer - inner) * 0.55, hw * 0.2);
      ctx.fill();
      ctx.restore();
    }
  }

  _faceSkeleton(r, accent, text) {
    const ctx = this.ctx;
    [0.64, 0.50].forEach(rf => {
      ctx.beginPath(); ctx.arc(0, 0, r * rf, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.8; ctx.stroke();
    });
    for (let i = 0; i < 12; i++) {
      const a      = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isMaj  = i % 3 === 0;
      const sz     = r * (isMaj ? 0.052 : 0.030);
      const dist   = r * 0.875;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -dist - sz * 1.8);
      ctx.lineTo(sz, -dist);
      ctx.lineTo(0, -dist + sz * 1.8);
      ctx.lineTo(-sz, -dist);
      ctx.closePath();
      ctx.fillStyle = isMaj ? accent : 'rgba(255,255,255,0.5)';
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.91, Math.sin(a) * r * 0.91, r * 0.010, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = `600 ${r * 0.115}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
    [[12, 0], [3, 3], [6, 6], [9, 9]].forEach(([n, i]) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.fillText(String(n), Math.cos(a) * r * 0.645, Math.sin(a) * r * 0.645);
    });
  }

  _faceNeon(r, accent, text) {
    const ctx  = this.ctx;
    const neon = accent || '#00D4FF';
    ctx.save();
    ctx.shadowColor = neon; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.895, 0, 2 * Math.PI);
    ctx.strokeStyle = neon; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 12; i++) {
      const a      = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isMaj  = i % 3 === 0;
      ctx.save();
      ctx.shadowColor = neon; ctx.shadowBlur = isMaj ? 14 : 7;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * (isMaj ? 0.76 : 0.84), Math.sin(a) * r * (isMaj ? 0.76 : 0.84));
      ctx.lineTo(Math.cos(a) * r * 0.87, Math.sin(a) * r * 0.87);
      ctx.strokeStyle = neon;
      ctx.lineWidth   = isMaj ? 3 : 1.2;
      ctx.lineCap     = 'round'; ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.91, Math.sin(a) * r * 0.91, r * 0.010, 0, 2 * Math.PI);
      ctx.fillStyle = neon + '60'; ctx.fill();
    }
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = neon; ctx.shadowColor = neon; ctx.shadowBlur = 12;
    ctx.font = `700 ${r * 0.145}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', monospace`;
    [[12, 0], [3, 3], [6, 6], [9, 9]].forEach(([n, i]) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.fillText(String(n), Math.cos(a) * r * 0.63, Math.sin(a) * r * 0.63);
    });
    ctx.restore();
  }

  _faceRetro(r, accent, text) {
    const ctx  = this.ctx;
    const warm = '#D4A853';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(212,168,83,0.40)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(212,168,83,0.16)'; ctx.lineWidth = 0.5; ctx.stroke();
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.855, Math.sin(a) * r * 0.855);
      ctx.lineTo(Math.cos(a) * r * 0.875, Math.sin(a) * r * 0.875);
      ctx.strokeStyle = 'rgba(212,168,83,0.35)'; ctx.lineWidth = 0.7; ctx.lineCap = 'butt'; ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a     = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isQ   = i % 3 === 0;
      const inner = r * (isQ ? 0.760 : 0.820);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * r * 0.875, Math.sin(a) * r * 0.875);
      ctx.strokeStyle = warm; ctx.lineWidth = isQ ? 3.0 : 1.4; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.font = `500 ${r * 0.128}px 'Times New Roman', Georgia, serif`;
      ctx.fillText(String(i), Math.cos(a) * r * 0.665, Math.sin(a) * r * 0.665);
    }
  }

  _faceSport(r, accent, text) {
    const ctx = this.ctx;
    for (let i = 0; i < 60; i++) {
      const a      = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isHour = i % 5 === 0;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.915, Math.sin(a) * r * 0.915,
        isHour ? r * 0.020 : r * 0.009, 0, 2 * Math.PI);
      ctx.fillStyle = isHour ? accent : 'rgba(255,255,255,0.22)';
      ctx.fill();
    }
    for (let i = 0; i < 12; i++) {
      const a    = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isQ  = i % 3 === 0;
      const barH = r * (isQ ? 0.135 : 0.085);
      const barW = r * (isQ ? 0.038 : 0.022);
      const dist = r * 0.795;
      ctx.save();
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = isQ ? accent : text;
      ctx.beginPath();
      ctx.rect(-barW / 2, -dist - barH, barW, barH);
      ctx.fill();
      if (isQ) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.rect(-barW * 0.22, -dist - barH + barW, barW * 0.44, barH * 0.45);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    [[12, 0], [3, 3], [6, 6], [9, 9]].forEach(([n, i]) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.font = `900 ${r * 0.158}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
      ctx.fillText(String(n), Math.cos(a) * r * 0.615, Math.sin(a) * r * 0.615);
    });
  }

  _faceArtDeco(r, accent, text) {
    const ctx  = this.ctx;
    const gold = '#B8963E';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.905, 0, 2 * Math.PI);
    ctx.strokeStyle = gold; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.860, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(184,150,62,0.28)'; ctx.lineWidth = 0.6; ctx.stroke();
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.870, Math.sin(a) * r * 0.870);
      ctx.lineTo(Math.cos(a) * r * 0.900, Math.sin(a) * r * 0.900);
      ctx.strokeStyle = 'rgba(184,150,62,0.32)'; ctx.lineWidth = 0.6; ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a    = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isMaj = i % 3 === 0;
      ctx.save();
      ctx.rotate(a + Math.PI / 2);
      const dist = r * 0.830;
      const h    = r * (isMaj ? 0.115 : 0.068);
      const w    = r * (isMaj ? 0.038 : 0.022);
      ctx.beginPath();
      ctx.moveTo(0,       -dist);
      ctx.lineTo( w,      -dist + h);
      ctx.lineTo( w * 0.4,-dist + h * 0.68);
      ctx.lineTo(0,       -dist + h * 0.85);
      ctx.lineTo(-w * 0.4,-dist + h * 0.68);
      ctx.lineTo(-w,      -dist + h);
      ctx.closePath();
      ctx.fillStyle = isMaj ? gold : 'rgba(184,150,62,0.55)';
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(184,150,62,0.18)'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [[12, 0], [3, 3], [6, 6], [9, 9]].forEach(([n, i]) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.font      = `600 ${r * 0.132}px 'Times New Roman', Georgia, serif`;
      ctx.fillStyle = text;
      ctx.fillText(String(n), Math.cos(a) * r * 0.640, Math.sin(a) * r * 0.640);
    });
    ctx.fillStyle = 'rgba(184,150,62,0.40)';
    ctx.font      = `400 ${r * 0.075}px 'Times New Roman', Georgia, serif`;
    [1, 2, 4, 5, 7, 8, 10, 11].forEach(i => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      ctx.fillText('·', Math.cos(a) * r * 0.640, Math.sin(a) * r * 0.640);
    });
  }

  _faceCelestial(r, accent, text) {
    const ctx  = this.ctx;
    const star = accent || '#FFD700';
    [0.885, 0.650, 0.480].forEach((rf, i) => {
      ctx.beginPath(); ctx.arc(0, 0, r * rf, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(255,255,255,${0.04 + i * 0.02})`; ctx.lineWidth = 0.6; ctx.stroke();
    });
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a  = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const cx = Math.cos(a) * r * 0.885;
      const cy = Math.sin(a) * r * 0.885;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.011, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    }
    for (let i = 0; i < 12; i++) {
      const a    = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isMaj = i % 3 === 0;
      const dist = r * 0.820;
      const px   = Math.cos(a) * dist;
      const py   = Math.sin(a) * dist;
      ctx.save();
      ctx.translate(px, py);
      ctx.shadowColor = star; ctx.shadowBlur = isMaj ? 7 : 3;
      this._drawStar(ctx, 0, 0,
        r * (isMaj ? 0.050 : 0.028),
        r * (isMaj ? 0.022 : 0.012),
        isMaj ? 5 : 4);
      ctx.fillStyle = isMaj ? star : 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = star; ctx.shadowColor = star; ctx.shadowBlur = 14;
    ctx.font = `700 ${r * 0.142}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', monospace`;
    ctx.fillText('12', 0, -r * 0.632);
    ctx.restore();
  }

  _drawStar(ctx, cx, cy, outerR, innerR, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 === 0 ? outerR : innerR;
      const a  = (i / (points * 2)) * 2 * Math.PI - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else         ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  // ── Stargate ──────────────────────────────────────────────────────
  // 12 chevrons (one per clock-hour position), perspective-foreshortened
  // water-ripple puddle with no synthetic highlight blobs.
  _faceStargate(r, accent, text, h, m, s, secondAngle) {
    const ctx = this.ctx;
    const now = Date.now();
    const T   = now / 1000;
    const PI2 = Math.PI * 2;
    const isOnTheHour = (m === 0 && s < 6);

    if (!this._sg) {
      this._sg = {

        ripples: [], rippleTimer: 0,
        kawoosh: null, ringRotation: 0, lastFrame: now,
        prevMinute: -1, hourFlash: -99999,
        chevGlow: [],
        prevHourChev: -1, prevMinChev: -1, prevSecChev: -1,
        lastFiveSec: -1, allFlash: -99999, prevSecond: -1,
        // Dialling-sequence state
        dialPhase: 'idle',
        dialStart: -99999,
        dialLitCount: 0,
        dialLastLit: -99999,
        lockedChevrons: new Set(),
        dialResetPending: false,
        dialResetAt: -99999,
      };
    }
    const sg = this._sg;

    const dt = Math.min((now - sg.lastFrame) / 1000, 0.05);
    sg.ringRotation += dt * 0.018;
    sg.lastFrame = now;

    const rOuter  = r * 0.99;
    const rPortal = r * 0.745;
    const PERSP   = 0.50;


    // ── 12-chevron hand collision ──────────────────────────────────
    // angleToChev: maps a 0-based CW hand angle (0 = 12 o'clock) to chevron 0-11
    const angleToChev = a => {
      const frac = (((a % PI2) + PI2) % PI2) / PI2;
      return Math.floor(frac * 12) % 12;
    };

    const hourAngle = ((h % 12 + m / 60 + s / 3600) / 12) * PI2;
    const minAngle  = ((m + s / 60) / 60) * PI2;

    const hChev = angleToChev(hourAngle);
    const mChev = angleToChev(minAngle);
    const sChev = (secondAngle !== undefined) ? angleToChev(secondAngle) : -1;

    const triggerChev = idx => {
      if (!sg.chevGlow.find(g => g.idx === idx && now - g.born < 900))
        sg.chevGlow.push({ idx, born: now });
    };

    if (hChev !== sg.prevHourChev) { triggerChev(hChev); sg.prevHourChev = hChev; }
    if (mChev !== sg.prevMinChev)  { triggerChev(mChev); sg.prevMinChev  = mChev; }
    // (second hand chevron collision removed — 5-second bucket handles this below)

    // Every-5-seconds: light the chevron the second hand is now pointing at.
    // fiveBucket changes at s=0,5,10,…; the hand has just crossed into chevron
    // (fiveBucket % 12), but because bucket 0 covers s=0-4 (12→1 o'clock gap)
    // and the chevrons sit *at* the hour markers, we use the bucket directly —
    // chevron 0 = 12 o'clock = s=0, chevron 1 = 1 o'clock = s=5, etc.
    const fiveBucket = Math.floor(s / 5);
    if (fiveBucket !== sg.lastFiveSec) {
      sg.lastFiveSec = fiveBucket;
      // s=0 → chev 0 (12), s=5 → chev 1 (1), … s=55 → chev 11 (11)
      const fiveChev = fiveBucket % 12;
      triggerChev(fiveChev);
    }

    // Full-minute (second hand hits 12): flash ALL chevrons simultaneously
    if (s === 0 && sg.prevSecond !== 0) {
      sg.allFlash = now;
      for (let ci = 0; ci < 12; ci++) triggerChev(ci);
    }
    sg.prevSecond = s;

    sg.chevGlow = sg.chevGlow.filter(g => now - g.born < 1100);

    // ── Dialling-sequence: start at 5 s, light chevrons 1-by-1, stay lit ──
    if (s >= 5 && sg.dialPhase === 'idle') {
      sg.dialPhase    = 'dialling';
      sg.dialStart    = now;
      sg.dialLitCount = 0;
      sg.dialLastLit  = now - 999;
      sg.lockedChevrons.clear();
    }
    if (sg.dialPhase === 'dialling') {
      const CHEV_INTERVAL = 850;
      if (sg.dialLitCount < 12 && (now - sg.dialLastLit) >= CHEV_INTERVAL) {
        const nextIdx = sg.dialLitCount;
        sg.lockedChevrons.add(nextIdx);
        sg.dialLitCount++;
        sg.dialLastLit = now;
        sg.chevGlow.push({ idx: nextIdx, born: now });
      }
      if (sg.dialLitCount >= 12) sg.dialPhase = 'locked';
    }
    if (s === 0 && !sg.dialResetPending && sg.dialPhase !== 'idle') {
      sg.dialResetPending = true;
      sg.dialResetAt = now + 1400;
    }
    if (sg.dialResetPending && now >= sg.dialResetAt) {
      sg.dialResetPending = false;
      sg.dialPhase = 'idle';
      sg.dialLitCount = 0;
      sg.lockedChevrons.clear();
    }

    if (m !== sg.prevMinute) {
      sg.prevMinute = m;
      sg.kawoosh = { p: 0, maxR: rPortal * 2.8 };
      for (let i = 0; i < 6; i++) sg.ripples.push({
        r: 1, op: 0.85 - i * 0.08, born: now + i * 100,
        ox: 0, oy: 0, spd: rPortal * (0.014 - i * 0.0008),
        tilt: (Math.random() - 0.5) * 0.06,
      });
    }
    if (isOnTheHour && now - sg.hourFlash > 14000) {
      sg.hourFlash = now;
      for (let j = 0; j < 3; j++) sg.ripples.push({
        r: rPortal * (0.06 + j * 0.05), op: 0.82 - j * 0.14, born: now + j * 160,
        ox: 0, oy: 0, spd: rPortal * 0.010, tilt: 0,
      });
    }
    for (let i = sg.ripples.length - 1; i >= 0; i--) {
      const rp = sg.ripples[i];
      if (now < rp.born) continue;
      rp.r  += rp.spd;
      rp.op *= 0.971;
      if (rp.op < 0.020 || rp.r > rPortal * 1.06) sg.ripples.splice(i, 1);
    }
    if (sg.kawoosh) {
      sg.kawoosh.p += 0.024;
      if (sg.kawoosh.p >= 1) sg.kawoosh = null;
    }

    // ── DRAW 1: Stone ring ─────────────────────────────────────────
    const stoneGrad = ctx.createRadialGradient(0, 0, rPortal, 0, 0, rOuter);
    stoneGrad.addColorStop(0, '#2a2d30'); stoneGrad.addColorStop(0.18, '#1e2124');
    stoneGrad.addColorStop(0.55, '#2c3035'); stoneGrad.addColorStop(0.82, '#1a1d20');
    stoneGrad.addColorStop(1, '#131517');
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0,rOuter,0,PI2); ctx.arc(0,0,rPortal,0,PI2,true);
    ctx.fillStyle = stoneGrad; ctx.fill('evenodd');
    [0.78,0.82,0.86,0.90,0.935,0.965].forEach(rf => {
      ctx.beginPath(); ctx.arc(0,0,r*rf,0,PI2);
      ctx.strokeStyle = (Math.round(rf*100))%8===0 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.22)';
      ctx.lineWidth=0.6; ctx.stroke();
    });
    ctx.restore();

    // ── DRAW 2: Portal puddle — still dark water ──────────────────
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0,rPortal,0,PI2); ctx.clip();

    // Very dark water base
    ctx.fillStyle = '#000';
    ctx.fillRect(-rPortal,-rPortal,rPortal*2,rPortal*2);

    // Dark deep-water surface — subtle teal-black, slightly lighter centre
    const surfG = ctx.createRadialGradient(0, rPortal * 0.05, 0, 0, 0, rPortal * 0.98);
    surfG.addColorStop(0,    'rgba(10,28,68,1.00)');
    surfG.addColorStop(0.35, 'rgba(5,14,40,1.00)');
    surfG.addColorStop(0.70, 'rgba(2,6,22,1.00)');
    surfG.addColorStop(1,    'rgba(0,1,8,1.00)');
    ctx.fillStyle = surfG;
    ctx.beginPath(); ctx.arc(0,0,rPortal,0,PI2); ctx.fill();

    // Edge darkening vignette
    const edgeG = ctx.createRadialGradient(0,0,rPortal*0.58,0,0,rPortal);
    edgeG.addColorStop(0,'rgba(0,0,0,0)');
    edgeG.addColorStop(0.68,'rgba(0,0,0,0)');
    edgeG.addColorStop(1,'rgba(0,0,0,0.60)');
    ctx.fillStyle=edgeG;
    ctx.beginPath(); ctx.arc(0,0,rPortal,0,PI2); ctx.fill();



    // Ripple ellipses — minute-change and on-the-hour only
    for (const rp of sg.ripples) {
      if (now < rp.born || rp.r <= 0 || rp.r > rPortal * 1.05) continue;
      const rx = rp.r, ry = rx * PERSP;
      ctx.save();
      ctx.translate(rp.ox, rp.oy);
      if (rp.tilt) ctx.rotate(rp.tilt);
      ctx.globalAlpha = rp.op;

      // Dark trough
      ctx.beginPath(); ctx.ellipse(0,0,rx*1.022,ry*1.022,0,0,PI2);
      ctx.strokeStyle = 'rgba(0,4,18,0.72)';
      ctx.lineWidth = rPortal * 0.020 * Math.max(0.14, rp.op); ctx.stroke();

      // Bright silver-white crest
      ctx.beginPath(); ctx.ellipse(0,0,rx,ry,0,0,PI2);
      ctx.strokeStyle = `rgba(205,228,255,${rp.op * 0.90})`;
      ctx.lineWidth = rPortal * 0.012 * Math.max(0.20, rp.op * 0.85); ctx.stroke();

      ctx.globalAlpha = 1; ctx.restore();
    }

    // Kawoosh minute-change burst
    if (sg.kawoosh) {
      const kp = sg.kawoosh.p, kr = Math.min(sg.kawoosh.maxR * kp, rPortal * 1.01);
      const kop = Math.max(0, 1 - kp * 1.30);
      if (kr > 0.5 && kop > 0.01) {
        ctx.save();
        ctx.globalAlpha = kop * 0.38;
        const kg = ctx.createRadialGradient(0,0,0,0,0,kr);
        kg.addColorStop(0,   'rgba(20,110,230,0)');
        kg.addColorStop(0.55,`rgba(55,175,255,1)`);
        kg.addColorStop(0.85,`rgba(130,220,255,1)`);
        kg.addColorStop(1,   'rgba(200,240,255,0)');
        ctx.fillStyle = kg;
        ctx.beginPath(); ctx.arc(0,0,kr,0,PI2); ctx.fill();
        ctx.globalAlpha = 1; ctx.restore();
      }
    }

    ctx.restore(); // end portal clip

    // ── DRAW 3: Event horizon rim ──────────────────────────────────
    ctx.save();
    const rimP = 0.45 + Math.sin(T * 1.25) * 0.08;
    ctx.beginPath(); ctx.arc(0,0,rPortal+r*0.009,0,PI2);
    ctx.strokeStyle=`rgba(48,158,255,${rimP})`; ctx.lineWidth=r*0.019;
    ctx.shadowColor='rgba(0,130,255,0.88)'; ctx.shadowBlur=8; ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,rPortal-r*0.004,0,PI2);
    ctx.strokeStyle=`rgba(172,232,255,${0.28+Math.sin(T*0.80)*0.07})`;
    ctx.lineWidth=r*0.005; ctx.shadowBlur=4; ctx.stroke();
    ctx.restore();

    // ── DRAW 4: 39 rotating glyph slots ───────────────────────────
    ctx.save(); ctx.rotate(sg.ringRotation);
    for (let i=0;i<39;i++) {
      const a=(i/39)*PI2, gx=Math.cos(a)*r*0.862, gy=Math.sin(a)*r*0.862;
      ctx.save(); ctx.translate(gx,gy); ctx.rotate(a+Math.PI/2);
      const sw=r*0.026,sh=r*0.040;
      ctx.beginPath(); ctx.roundRect(-sw/2,-sh/2,sw,sh,sw*0.3);
      ctx.fillStyle='rgba(0,0,0,0.52)'; ctx.fill();
      ctx.strokeStyle='rgba(172,198,215,0.30)'; ctx.lineWidth=0.55;
      const seed=(i*137)%7; ctx.beginPath();
      if      (seed<2){ctx.moveTo(-sw*.30,-sh*.25);ctx.lineTo(sw*.30,-sh*.25);ctx.moveTo(0,-sh*.25);ctx.lineTo(0,sh*.25);}
      else if (seed<4){ctx.moveTo(-sw*.35,0);ctx.lineTo(sw*.35,0);ctx.arc(0,0,sw*.28,0,PI2);}
      else if (seed<6){ctx.moveTo(-sw*.30,-sh*.30);ctx.lineTo(sw*.30,sh*.30);ctx.moveTo(sw*.30,-sh*.30);ctx.lineTo(-sw*.30,sh*.30);}
      else            {ctx.moveTo(0,-sh*.35);ctx.lineTo(sw*.30,sh*.10);ctx.lineTo(-sw*.30,sh*.10);ctx.closePath();}
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();

    // ── DRAW 5: Twelve chevrons ────────────────────────────────────
    const hourAge = now - sg.hourFlash;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI2 - Math.PI / 2;
      const cx2 = Math.cos(a) * r * 0.955, cy2 = Math.sin(a) * r * 0.955;
      const lockDelay  = i * 680;
      const isLocked   = isOnTheHour && hourAge > lockDelay && hourAge < lockDelay + 8200;
      const lockFlash  = isOnTheHour && hourAge > lockDelay && hourAge < lockDelay + 360;
      const ge    = sg.chevGlow.find(g => g.idx === i);
      const gAge  = ge ? (now - ge.born) / 1000 : 1;
      const handLit  = !!ge && gAge < 1.0;
      const handFade = handLit ? Math.pow(1 - gAge, 1.5) : 0;
      const dialLocked = sg.lockedChevrons.has(i);
      const dialFlash  = dialLocked && handLit && gAge < 0.38;
      const isRed    = isLocked || lockFlash || handLit || dialLocked;

      ctx.save(); ctx.translate(cx2, cy2); ctx.rotate(a + Math.PI / 2);
      // Slightly smaller chevrons to fit 12 around the ring
      const cW=r*0.072, cH=r*0.108, cW2=cW*0.5;
      ctx.beginPath();
      ctx.moveTo(-cW2,cH*.28); ctx.lineTo(-cW2*.72,-cH*.22);
      ctx.lineTo(-cW2*.38,-cH*.52); ctx.lineTo(cW2*.38,-cH*.52);
      ctx.lineTo(cW2*.72,-cH*.22); ctx.lineTo(cW2,cH*.28); ctx.closePath();
      const bg=ctx.createLinearGradient(-cW2,-cH*.52,cW2,cH*.28);
      bg.addColorStop(0,'#3d4248'); bg.addColorStop(.5,'#2a2f34'); bg.addColorStop(1,'#1e2226');
      ctx.fillStyle=bg; ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.11)'; ctx.lineWidth=0.7; ctx.stroke();

      const vW=cW*.70, vH=cH*.72, vW2=vW*.5;
      ctx.beginPath();
      ctx.moveTo(0,-vH*.52); ctx.lineTo(vW2,vH*.28); ctx.lineTo(vW2*.4,vH*.28);
      ctx.lineTo(0,-vH*.10); ctx.lineTo(-vW2*.4,vH*.28); ctx.lineTo(-vW2,vH*.28);
      ctx.closePath();

      if (isRed) {
        const rg=ctx.createLinearGradient(0,-vH*.52,0,vH*.28);
        const anyFlash = lockFlash || dialFlash;
        if (anyFlash) {
          rg.addColorStop(0,'#FFFFFF'); rg.addColorStop(.28,'#FFBBAA'); rg.addColorStop(1,'#FF2200');
        } else {
          const b = (isLocked || dialLocked) ? 1.0 : handFade;
          rg.addColorStop(0,`rgb(255,${Math.round(58+b*30)},${Math.round(b*16)})`);
          rg.addColorStop(.5,'#EE1800'); rg.addColorStop(1,'#BB0D00');
        }
        ctx.fillStyle=rg;
        ctx.shadowColor=(lockFlash||dialFlash)?'rgba(255,225,200,1)':'rgba(255,18,0,0.96)';
        ctx.shadowBlur=(lockFlash||dialFlash)?20:((isLocked||dialLocked)?14:handFade*16);
      } else {
        const ug=ctx.createLinearGradient(0,-vH*.52,0,vH*.28);
        ug.addColorStop(0,'#4a4032'); ug.addColorStop(.5,'#302818'); ug.addColorStop(1,'#1c1508');
        ctx.fillStyle=ug; ctx.shadowBlur=0;
      }
      ctx.fill();
      // Highlight chip
      ctx.beginPath();
      ctx.moveTo(-vW2*.25,-vH*.44); ctx.lineTo(vW2*.14,-vH*.10);
      ctx.lineTo(vW2*.05,-vH*.10); ctx.lineTo(-vW2*.30,-vH*.44); ctx.closePath();
      const chipAlpha = (lockFlash||dialFlash) ? 0.55 : (dialLocked||isLocked) ? 0.40 : handFade*0.48;
      ctx.fillStyle=isRed?`rgba(255,210,190,${chipAlpha})`:'rgba(255,255,210,0.11)';
      ctx.shadowBlur=0; ctx.fill();
      ctx.restore();
    }

    // ── DRAW 6: Outer bezel ────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0,rOuter-1,0,PI2);
    const bz=ctx.createLinearGradient(-rOuter,-rOuter,rOuter,rOuter);
    bz.addColorStop(0,'rgba(210,220,230,0.20)'); bz.addColorStop(.5,'rgba(200,212,224,0.14)');
    bz.addColorStop(1,'rgba(185,195,208,0.18)');
    ctx.strokeStyle=bz; ctx.lineWidth=1.5; ctx.shadowBlur=0; ctx.stroke();
    ctx.restore();
  }

  // ── Hands ─────────────────────────────────────────────────────────
  _drawHands(r, h, m, s, secondAngle) {
    const ctx   = this.ctx;
    const cfg   = this._config;
    const face  = cfg.face || 'classic';
    const hCol  = cfg.hour_hand_color   || '#FFFFFF';
    const mCol  = cfg.minute_hand_color || '#FFFFFF';
    const sCol  = cfg.second_hand_color || '#FF3B30';

    const hourAngle = ((h % 12 + m / 60 + s / 3600) / 12) * 2 * Math.PI;
    const minAngle  = ((m + s / 60) / 60) * 2 * Math.PI;

    const isLuxury  = face === 'luxury'   || face === 'art_deco';
    const isNeon    = face === 'neon'     || face === 'celestial' || face === 'stargate';
    const isMinimal = face === 'minimal';

    if (isNeon) {
      this._handNeon(r, hourAngle, r * 0.50, r * 0.036, hCol);
      this._handNeon(r, minAngle,  r * 0.70, r * 0.024, mCol);
    } else if (isLuxury) {
      this._handBaton(r, hourAngle, r * 0.48, r * 0.038, hCol);
      this._handBaton(r, minAngle,  r * 0.67, r * 0.026, mCol);
    } else if (isMinimal) {
      this._handStick(r, hourAngle, r * 0.49, r * 0.024, r * 0.10, hCol);
      this._handStick(r, minAngle,  r * 0.69, r * 0.016, r * 0.08, mCol);
    } else {
      this._handTapered(r, hourAngle, r * 0.50, r * 0.038, r * 0.080, hCol);
      this._handTapered(r, minAngle,  r * 0.70, r * 0.026, r * 0.065, mCol);
    }

    if (cfg.show_seconds && secondAngle !== undefined) {
      this._handSecond(r, secondAngle, sCol, isNeon);
    }

    ctx.beginPath(); ctx.arc(0, 0, r * 0.040, 0, 2 * Math.PI);
    ctx.fillStyle = (cfg.show_seconds && secondAngle !== undefined) ? sCol : hCol;
    ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.018, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill();
  }

  _handTapered(r, angle, length, width, tailLen, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.rotate(angle);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(-width * 0.55, tailLen);
    ctx.quadraticCurveTo(-width, 0, -width * 0.12, -length * 0.62);
    ctx.lineTo(0, -length);
    ctx.lineTo(width * 0.12, -length * 0.62);
    ctx.quadraticCurveTo(width, 0, width * 0.55, tailLen);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  _handStick(r, angle, length, width, tailLen, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.rotate(angle);
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -length, width, length + tailLen, width / 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  _handBaton(r, angle, length, width, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.rotate(angle);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    const tailLen = r * 0.115;
    ctx.fillStyle = color;
    ctx.roundRect(-width / 2, -length, width, length + tailLen, width / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.roundRect(-width * 0.18, -length + width * 0.8, width * 0.36, (length - width) * 0.48, width * 0.18);
    ctx.fill();
    ctx.restore();
  }

  _handNeon(r, angle, length, width, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.rotate(angle);
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, r * 0.115); ctx.lineTo(0, -length); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = width * 0.38;
    ctx.beginPath(); ctx.moveTo(0, r * 0.10); ctx.lineTo(0, -length); ctx.stroke();
    ctx.restore();
  }

  _handSecond(r, angle, color, glowMode) {
    const ctx = this.ctx;
    ctx.save(); ctx.rotate(angle);
    if (glowMode) {
      ctx.shadowColor = color; ctx.shadowBlur = 10;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    }
    ctx.strokeStyle = color; ctx.lineWidth = r * 0.009; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, r * 0.23); ctx.lineTo(0, -r * 0.79); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(0, r * 0.135, r * 0.026, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
}

// Full-screen screensaver: the layer fills the window, and each style is
// sized from the screen (container units: cqw / cqh / cqmin / cqmax) instead
// of the fixed sizes that suit the artwork. Notches and home bars are kept
// clear with the safe-area insets.
const CROW_MEDIA_SAVER_FULL_CSS = `
  :host { all: initial; }
  .crow-saver.cs-full { position: absolute; inset: 0; z-index: auto; container-type: size; font-family: var(--cs-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); }
  /* Clock & Weather */
  .cs-full .cs-big .t { font-size: min(18cqw, 30cqh); letter-spacing: -0.02em; white-space: nowrap; }
  .cs-full .cs-big .d { font-size: clamp(15px, 3.4cqmin, 40px); margin-top: 1.4cqmin; }
  .cs-full .cs-big .w { font-size: clamp(14px, 3cqmin, 34px); margin-top: 0.8cqmin; }
  /* the small clock over the other styles */
  .cs-full .cs-mini { left: calc(max(20px, 3.2cqmin) + env(safe-area-inset-left, 0px)); top: calc(max(18px, 3.2cqmin) + env(safe-area-inset-top, 0px)); }
  .cs-full .cs-mini .t { font-size: clamp(34px, 7.5cqmin, 96px); letter-spacing: -0.02em; }
  .cs-full .cs-mini .d { font-size: clamp(12px, 2.3cqmin, 28px); margin-top: 0.6cqmin; }
  .cs-full .cs-msg { font-size: clamp(13px, 2.6cqmin, 28px); }
  /* Aurora: round glows (not stretched ovals) and a full sky of stars */
  .cs-full .cs-glow { width: 85cqmax; height: 85cqmax; }
  .cs-full .cs-stars { background-size: 46cqmin 46cqmin; }
  .cs-full .cs-stars::after { content: ''; position: absolute; inset: 0; background-image: inherit; background-size: 31cqmin 31cqmin; background-position: 17% 41%; opacity: 0.7; }
  /* Flip Clock: digits sized from the screen (--cs-fdw, set by the code), everything else in step */
  .cs-full .cs-flip { gap: calc(var(--cs-fdw, 19cqw) * 0.1); left: 50%; right: auto; transform: translate(-50%, -58%); }
  .cs-full .cs-fd { width: var(--cs-fdw, 19cqw); }
  .cs-full .cs-fd .h.t, .cs-full .cs-fd .flap.t { border-radius: calc(var(--cs-fdw, 80px) * 0.08) calc(var(--cs-fdw, 80px) * 0.08) 0 0; }
  .cs-full .cs-fd .h.b, .cs-full .cs-fd .flap.b { border-radius: 0 0 calc(var(--cs-fdw, 80px) * 0.08) calc(var(--cs-fdw, 80px) * 0.08); }
  .cs-full .cs-fd::after { height: max(2px, calc(var(--cs-fdw, 80px) * 0.02)); }
  .cs-full .cs-colon { gap: calc(var(--cs-fdw, 80px) * 0.2); }
  .cs-full .cs-colon i { width: calc(var(--cs-fdw, 80px) * 0.08); height: calc(var(--cs-fdw, 80px) * 0.08); }
  .cs-full .cs-flip .cs-ampm { position: absolute; left: auto; top: auto; right: 0; bottom: 100%; margin-bottom: calc(var(--cs-fdw, 80px) * 0.1); font-size: max(12px, calc(var(--cs-fdw, 80px) * 0.14)); }
  .cs-full .cs-under { bottom: calc(12% + env(safe-area-inset-bottom, 0px)); font-size: clamp(14px, 2.8cqmin, 32px); }
  @media (prefers-reduced-motion: reduce) { .cs-full .cs-stars::after { display: none; } }
`;

/* ══════════════════════════════════════════════════════════════════
 * INFO SCREENS: full-colour screens, one at a time (see _saverScreens)
 * ══════════════════════════════════════════════════════════════════ */
// in related runs: the music, the day, the warmth of the house, its lights and rooms, its security, then its machines
const CROW_MEDIA_SCR_KEYS = ['time', 'today', 'upnext', 'lyrics', 'calendar', 'timers', 'shopping', 'todo', 'rooms', 'heating', 'fans', 'lights', 'covers', 'occupancy', 'open', 'security', 'doorbell', 'cameras', 'appliances', 'vacuum', 'printers', 'plants'];
// screens left out unless they're ticked in the editor (none: every screen is on unless unticked)
const CROW_MEDIA_SCR_OFF = [];
// Doors, windows and garage doors: simple line drawings, in the same style as the full-screen player's icons
const CROW_MEDIA_SCR_ICON = {
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M12 5V3.5"/></svg>',
  door: '<svg viewBox="0 0 24 24"><path d="M4 21h16"/><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M6 3.4l6.5 2.1v16.1L6 21"/><path d="M10.5 12.6v1.2"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M12 3.5v17"/><path d="M12 3.5l6.2 2.4v12.2L12 20.5"/><path d="M3.5 12H12"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  therm: '<svg viewBox="0 0 24 24"><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/></svg>',
  battery: '<svg viewBox="0 0 24 24"><rect x="3" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3"/><path d="M5.8 10.3v3.4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/></svg>',
  sunrise: '<svg viewBox="0 0 24 24"><path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 4v5M9.5 6.5L12 4l2.5 2.5"/><path d="M4.2 12.8l1.4.8M19.8 12.8l-1.4.8"/></svg>',
  sunset: '<svg viewBox="0 0 24 24"><path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 9V4M9.5 6.5L12 9l2.5-2.5"/><path d="M4.2 12.8l1.4.8M19.8 12.8l-1.4.8"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8"/></svg>',
  washer: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7 6.5h2"/></svg>',
  dryer: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M10.5 11.5c.8.8.8 2.2 0 3M13.5 11.5c.8.8.8 2.2 0 3"/><path d="M7 6.5h2"/></svg>',
  dishwasher: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16"/><path d="M8 5.5h3"/><path d="M8 13h8M8 16.5h8"/></svg>',
  airfryer: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="4"/><path d="M5 13h14"/><path d="M10 16.5h4"/><circle cx="12" cy="7.5" r="1.6"/></svg>',
  kettle: '<svg viewBox="0 0 24 24"><path d="M7 20h10l-1.2-9.5H8.2z"/><path d="M9.5 10.5V8h5v2.5"/><path d="M8 13L4.8 10.6"/><path d="M15.8 11.5c2.4 0 3.2 1.4 3.2 3.4s-1 3.1-2.4 3.1"/><path d="M5.5 20h13"/></svg>',
  coffee: '<svg viewBox="0 0 24 24"><path d="M5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.2 2.2 0 0 1 0 4.4H16"/><path d="M9 3.5c-.8 1 .8 1.8 0 3M12.5 3.5c-.8 1 .8 1.8 0 3"/><path d="M4 21h14"/></svg>',
  microwave: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="5.5" y="8" width="9" height="8" rx="1"/><path d="M17.5 9h1M17.5 12h1M17.5 15h1"/></svg>',
  oven: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16"/><rect x="7" y="11" width="10" height="6.5" rx="1"/><path d="M8 5.5h.01M12 5.5h.01M16 5.5h.01"/></svg>',
  slowcooker: '<svg viewBox="0 0 24 24"><path d="M4.5 11h15v5a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4z"/><path d="M5.5 11a6.5 3 0 0 1 13 0"/><path d="M12 8V6.5"/><path d="M4.5 13H3M19.5 13H21"/></svg>',
  bread: '<svg viewBox="0 0 24 24"><path d="M6 20v-9a3.5 3.5 0 0 1 0-7h12a3.5 3.5 0 0 1 0 7v9z"/><path d="M10 9.5l1.5-2M13 11l1.5-2"/></svg>',
  ev: '<svg viewBox="0 0 24 24"><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3.5 21h13"/><path d="M10.5 7l-2 4h3l-2 4"/><path d="M15 9h1.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-2-2"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 3v4M15 3v4"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v5"/></svg>',
  fan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c0-3.5.7-6.4 3-6.4 2.4 0 2.6 3.6-3 6.4zM13.6 12c3.5 0 6.4.7 6.4 3 0 2.4-3.6 2.6-6.4-3zM12 13.6c0 3.5-.7 6.4-3 6.4-2.4 0-2.6-3.6 3-6.4zM10.4 12C6.9 12 4 11.3 4 9c0-2.4 3.6-2.6 6.4 3z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l7-7"/></svg>',
  blind: '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="3" rx="1"/><path d="M5 9.5h14M5 12.5h14M5 15.5h14"/><path d="M12 6.5v12"/></svg>',
  printer: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/></svg>',
  garage: '<svg viewBox="0 0 24 24"><path d="M3 20.5V9.2L12 4l9 5.2v11.3"/><path d="M6.5 20.5v-8h11v8"/><path d="M6.5 15h11"/><path d="M6.5 17.6h11"/></svg>',
};
// Sized from the screensaver itself (container units), so the same screens fit over the artwork, a phone
// held either way, a tablet and a wall screen
const CROW_MEDIA_SCR_CSS = `
.cs-scr { position: absolute; inset: 0; overflow: hidden; container-type: size; color: #fff;
  font-family: var(--cs-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); -webkit-font-smoothing: antialiased; }
.cs-sp { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cs-sp.cs-move { transition: transform 0.7s cubic-bezier(.22,.8,.24,1); }
.cs-slab { font-size: max(9px, 2.1cqmin); font-weight: 600; letter-spacing: 0.32em; text-transform: uppercase; opacity: 0.75; }
.cs-st1 { font-size: max(14px, 6cqmin); font-weight: 700; line-height: 1.08; letter-spacing: -0.015em; }
.cs-st2 { font-size: max(11px, 3cqmin); font-weight: 500; letter-spacing: 0.12em; opacity: 0.85; margin-top: 1cqmin; }
.cs-scorner { position: absolute; top: calc(max(12px, 4.5cqmin) + env(safe-area-inset-top, 0px)); left: max(14px, 5cqmin); right: max(14px, 5cqmin);
  display: flex; justify-content: space-between; gap: 4cqmin; font-size: max(9px, 2cqmin); font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.8; z-index: 3; pointer-events: none; }
.cs-scorner span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-scorner span:first-child { flex-shrink: 0; max-width: 60%; }
.cs-scorner span:last-child { text-align: right; }
.cs-sdots { position: absolute; left: 0; right: 0; bottom: calc(max(12px, 4cqmin) + env(safe-area-inset-bottom, 0px)); display: flex; justify-content: center; gap: max(5px, 1.2cqmin); z-index: 5; pointer-events: none; }
.cs-sdots i { width: max(5px, 1.1cqmin); height: max(5px, 1.1cqmin); border-radius: 99px; background: rgba(255,255,255,0.4); transition: width 0.4s ease, background 0.4s ease; }
.cs-sdots i.on { width: max(16px, 3.6cqmin); background: #fff; }
.cs-sp-week ~ .cs-sdots i, .cs-sp-open ~ .cs-sdots i { background: rgba(255,255,255,0.45); }

/* the time */
.cs-stime { text-align: center; }
.cs-stime .t { font-size: min(21cqw, 40cqh); font-weight: 200; line-height: 1; letter-spacing: -0.04em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cs-scolon { animation: cs-sblink 2s steps(1) infinite; }
@keyframes cs-sblink { 50% { opacity: 0.25; } }
.cs-sampm { font-size: 0.36em; font-weight: 400; letter-spacing: 0.04em; margin-left: 0.12em; }
.cs-stime .d { font-size: max(12px, 3.6cqmin); letter-spacing: 0.35em; text-transform: uppercase; margin-top: 2.4cqmin; opacity: 0.9; }

/* today */
.cs-sdials { display: flex; gap: 5cqw; align-items: center; justify-content: center; }
.cs-sdial { position: relative; width: min(28cqw, 40cqh); aspect-ratio: 1; }
.cs-sdial svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.cs-sdial .trk { fill: none; stroke: rgba(255,255,255,0.2); stroke-width: 6; }
.cs-sdial .val { fill: none; stroke: #fff; stroke-width: 6; stroke-linecap: round; stroke-dasharray: 0 999; transition: stroke-dasharray 1.6s cubic-bezier(.2,.8,.2,1); }
.cs-sdial .in { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.cs-sdial .n { font-size: max(16px, 8cqmin); font-weight: 300; font-variant-numeric: tabular-nums; }
.cs-sdial .cs-slab { font-size: max(8px, 1.6cqmin); margin-top: 0.8cqmin; letter-spacing: 0.22em; max-width: 80%; }
.cs-spills { position: absolute; left: 0; right: 0; bottom: calc(14cqmin + env(safe-area-inset-bottom, 0px)); display: flex; flex-wrap: wrap; justify-content: center; gap: 1.4cqmin 4.4cqmin; padding: 0 5cqmin; }
.cs-spills > div { display: flex; align-items: center; gap: 1.2cqmin; font-size: max(9px, 1.8cqmin); font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.55; transition: opacity 0.4s ease; }
.cs-spills > div::before { content: ''; width: max(6px, 1.2cqmin); height: max(6px, 1.2cqmin); border-radius: 50%; box-shadow: inset 0 0 0 max(1.5px, 0.3cqmin) #fff; transition: background 0.4s ease; }
.cs-spills > div.on { opacity: 1; }
.cs-spills > div.on::before { background: #fff; }

/* up next */
.cs-stiles { display: flex; gap: 4cqw; align-items: flex-end; justify-content: center; padding: 0 5cqw; }
.cs-stile { width: min(24cqw, 40cqh); min-width: 0; opacity: 0; transform: translateX(30cqw); }
.cs-stile:first-child { width: min(32cqw, 52cqh); }
.cs-in .cs-stile { animation: cs-sin 1.1s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes cs-sin { to { opacity: 1; transform: none; } }
.cs-stile .cs-slab { margin-bottom: 1.6cqmin; }
.cs-stile .sq { width: 100%; aspect-ratio: 1; border-radius: 3cqmin; overflow: hidden; background: rgba(0,0,0,0.14); box-shadow: 0 2cqmin 6cqmin rgba(90,60,0,0.25); }
.cs-stile .sq img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cs-stile .cs-st1 { font-size: max(12px, 3.6cqmin); margin-top: 2cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-stile .cs-st2 { font-size: max(10px, 2.1cqmin); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* the lyrics */
.cs-slyr { position: absolute; inset: 0; overflow: hidden; text-align: center;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, transparent 12%, #000 30%, #000 68%, transparent 86%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, transparent 12%, #000 30%, #000 68%, transparent 86%, transparent 100%); }
.cs-slyrw { padding: 0 8cqw; transition: transform 0.9s cubic-bezier(.22,.8,.24,1); }
.cs-slyrw .ln { font-size: max(18px, 7cqmin); font-weight: 800; line-height: 1.15; letter-spacing: -0.015em; padding: 1.8cqmin 0; opacity: 0.32;
  transform: scale(0.9); transform-origin: center; transition: opacity 0.6s ease, transform 0.6s ease; }
.cs-slyrw .ln.on { opacity: 1; transform: none; }
.cs-slyrw .ln.past { opacity: 0.18; }
.cs-slyrw .ln.gap { font-size: max(14px, 4cqmin); letter-spacing: 0.2em; }


/* doors and windows */
.cs-sopen { display: flex; flex-direction: column; align-items: center; gap: 5cqh; width: 100%; padding: 0 5cqw; box-sizing: border-box; }
.cs-scount { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1.4cqmin; }
.cs-scount b { font-size: min(18cqw, 19cqh); font-weight: 200; line-height: 1; }
.cs-scount span { font-size: max(12px, 4cqmin); font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; }
.cs-sotiles { display: flex; flex-direction: column; width: min(84cqw, 1000px); }
.cs-sot { display: flex; align-items: center; gap: 3.4cqmin; padding: 2.4cqmin 0.4cqmin; min-width: 0; opacity: 0; transform: translateY(3cqmin); }
.cs-sot + .cs-sot { box-shadow: 0 -1px 0 rgba(255,255,255,0.35); }
.cs-in .cs-sot { animation: cs-sin 0.9s cubic-bezier(.2,.8,.2,1) forwards; }
.cs-sot:nth-child(2) { animation-delay: 0.12s; } .cs-sot:nth-child(3) { animation-delay: 0.24s; } .cs-sot:nth-child(4) { animation-delay: 0.36s; } .cs-sot:nth-child(5) { animation-delay: 0.48s; } .cs-sot:nth-child(6) { animation-delay: 0.6s; }
.cs-sot .tx { min-width: 0; flex: 1; }
.cs-sot .dur { flex-shrink: 0; text-align: right; font-size: max(11px, 2.8cqmin); font-weight: 500; letter-spacing: 0.06em; opacity: 0.9; font-variant-numeric: tabular-nums; }
.cs-sot .cs-st1 { font-size: max(14px, 4.4cqmin); margin-top: 0.6cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-sot .cs-slab { font-size: max(8px, 1.7cqmin); }
/* the icons: line drawings in white */
.cs-sic { width: max(26px, 6.4cqmin); height: max(26px, 6.4cqmin); flex-shrink: 0; }
.cs-sic svg { width: 100%; height: 100%; display: block; fill: none; stroke: #fff; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* occupancy: each room in a list, its dot lit while someone's in it */
.cs-smap { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(36cqw, 520px), 1fr)); column-gap: 7cqw; width: 80cqw; max-height: 74cqh; }
.cs-smap > div { display: flex; align-items: center; gap: 2.4cqmin; padding: 2.8cqmin 0.2cqmin; min-width: 0; box-shadow: 0 1px 0 rgba(255,255,255,0.28); opacity: 0; transform: translateY(2cqmin); }
.cs-smap > div::before { content: ''; flex-shrink: 0; width: max(9px, 1.8cqmin); height: max(9px, 1.8cqmin); border-radius: 50%; box-shadow: inset 0 0 0 max(1.5px, 0.3cqmin) rgba(255,255,255,0.6); }
.cs-smap > div .tx { min-width: 0; flex: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 2cqmin; }
.cs-in .cs-smap > div { animation: cs-sin 0.8s cubic-bezier(.2,.8,.2,1) forwards; }
.cs-smap .cs-st1 { font-size: max(13px, 4.4cqmin); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.65; }
.cs-smap small { flex-shrink: 0; font-size: max(8px, 1.9cqmin); font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.6; white-space: nowrap; }
.cs-smap > div.on .cs-st1, .cs-smap > div.on small { opacity: 1; }
.cs-smap > div.on::before { background: #ffc35a; box-shadow: 0 0 0 0 rgba(255,195,90,0.6); animation: cs-sglow 2.4s ease-in-out 3; }
@keyframes cs-sglow { 50% { box-shadow: 0 0 0 1cqmin rgba(255,195,90,0.22); } }

/* lists (lights, rooms, today's calendar): thin lines between rows, like the full-screen panels */
.cs-scol { display: flex; flex-direction: column; align-items: center; gap: 4.5cqh; width: 100%; padding: 0 5cqw; box-sizing: border-box; }
.cs-slist { display: flex; flex-direction: column; width: min(84cqw, 1000px); }
.cs-srow { display: flex; align-items: center; gap: 3.2cqmin; padding: 2.2cqmin 0.4cqmin; min-width: 0; opacity: 0; transform: translateY(3cqmin); }
.cs-in .cs-srow { animation: cs-sin 0.9s cubic-bezier(.2,.8,.2,1) forwards; }
.cs-srow:nth-child(2) { animation-delay: 0.1s; } .cs-srow:nth-child(3) { animation-delay: 0.2s; } .cs-srow:nth-child(4) { animation-delay: 0.3s; } .cs-srow:nth-child(5) { animation-delay: 0.4s; } .cs-srow:nth-child(6) { animation-delay: 0.5s; } .cs-srow:nth-child(7) { animation-delay: 0.6s; }
.cs-srow + .cs-srow { box-shadow: 0 -1px 0 rgba(255,255,255,0.32); }
.cs-srow .tx { flex: 1; min-width: 0; }
.cs-srow .cs-st1 { font-size: max(14px, 4.2cqmin); margin-top: 0.5cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-srow .cs-slab { font-size: max(8px, 1.7cqmin); min-height: 1em; }
.cs-srow .rt { flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; }
.cs-srow .rt b { display: block; font-size: max(16px, 5cqmin); font-weight: 300; }
.cs-srow .rt small { display: block; font-size: max(9px, 1.8cqmin); font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.75; margin-top: 0.4cqmin; }
.cs-srow .cs-sic { width: max(22px, 5.4cqmin); height: max(22px, 5.4cqmin); }
.cs-sbar { width: max(60px, 14cqw); height: max(3px, 0.6cqmin); border-radius: 99px; background: rgba(255,255,255,0.25); margin: 1cqmin 0 0 auto; overflow: hidden; }
.cs-sbar i { display: block; height: 100%; background: #ffd36b; border-radius: 99px; transition: width 0.8s ease; }
/* any list that can grow: kept within the screen. Two columns on a wide screen when it's long (read down
   each column), closer rows when it's very long, and a slow scroll up and back when it still doesn't fit */
.cs-sclip { position: relative; display: flex; flex-direction: column; align-items: center; max-height: 70cqh; overflow-x: hidden; overflow-y: auto; width: 100%;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: none; }
.cs-sclip::-webkit-scrollbar { display: none; }
.cs-sp-lights .cs-sclip, .cs-sp-open .cs-sclip, .cs-sp-shopping .cs-sclip, .cs-sp-todo .cs-sclip { max-height: 46cqh; }
.cs-scol { max-height: calc(100cqh - max(64px, 22cqmin)); }
.cs-sp-calendar .cs-sclip { max-height: 62cqh; }
.cs-sclip.cs-sft { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 7%); mask-image: linear-gradient(to bottom, transparent 0, #000 7%); }
.cs-sclip.cs-sfb { -webkit-mask-image: linear-gradient(to bottom, #000 93%, transparent 100%); mask-image: linear-gradient(to bottom, #000 93%, transparent 100%); }
.cs-sclip.cs-sft.cs-sfb { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 7%, #000 93%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 7%, #000 93%, transparent 100%); }
.cs-sclip > [data-fit] { flex-shrink: 0; }
.cs-sclip.cs-sover > [data-fit] { will-change: transform; }
.cs-slist[data-size="many"], .cs-slist[data-size="lots"], .cs-sotiles[data-size="many"], .cs-sotiles[data-size="lots"] {
  display: grid; grid-template-rows: repeat(var(--rows, 4), auto); grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); column-gap: 6cqw; width: 90cqw; }
.cs-slist[data-size] > .cs-srow, .cs-sotiles[data-size] > .cs-sot { box-shadow: none; }
.cs-slist[data-size="many"] > *, .cs-slist[data-size="lots"] > *, .cs-sotiles[data-size="many"] > *, .cs-sotiles[data-size="lots"] > * { box-shadow: 0 1px 0 rgba(255,255,255,0.3) !important; }
[data-size="lots"] > .cs-srow, [data-size="lots"] > .cs-sot { padding-top: 1.3cqmin; padding-bottom: 1.3cqmin; }
[data-size="lots"] .cs-st1 { font-size: max(12px, 3.2cqmin) !important; }
[data-size="lots"] .rt b, [data-size="lots"] .dur { font-size: max(12px, 3.4cqmin) !important; }
.cs-smap[data-size="lots"] > div { padding-top: 1.6cqmin; padding-bottom: 1.6cqmin; }
/* timers: the ring empties as the time runs down */
.cs-stimers .cs-sdial .n { font-variant-numeric: tabular-nums; }
/* security: the alarm large, then every lock; unlocked ones lit */
.cs-salarm { display: flex; align-items: center; gap: 3cqmin; }
.cs-salarm[hidden] { display: none; }
.cs-salarm .cs-sic { width: max(36px, 10cqmin); height: max(36px, 10cqmin); }
.cs-sshield.on svg { fill: rgba(255,255,255,0.22); }
.cs-sshield.alert svg { stroke: #ffc35a; fill: rgba(255,195,90,0.25); }
.cs-sbig { font-size: max(22px, 8cqmin); font-weight: 200; line-height: 1.05; margin-top: 0.6cqmin; }
.cs-srow.cs-shot .rt b { color: #ffd36b; font-weight: 500; }
.cs-srow.cs-sdone { opacity: 0.62; }
.cs-srow.cs-shot .cs-sic svg { stroke: #ffd36b; }
.cs-srow .rt small:only-child { margin-top: 0; }
.cs-shead { font-size: max(9px, 1.9cqmin); font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.7; padding: 3cqmin 0.4cqmin 1cqmin; }
.cs-slist > .cs-shead:first-child, .cs-sth > .cs-shead:first-child { padding-top: 0; }
.cs-slist[data-grouped] { display: flex !important; flex-direction: column; }
.cs-slist[data-grouped] > .cs-shead + .cs-srow { box-shadow: none !important; }
.cs-sth[data-grouped] { display: grid; grid-template-columns: repeat(var(--hc, 3), minmax(0, 1fr)); gap: 2.4cqh 4cqw; width: 86cqw; }
.cs-sth[data-grouped] > .cs-shead { grid-column: 1 / -1; text-align: left; padding: 1.4cqh 0 0; }
.cs-sth[data-grouped][data-n="many"] { --hc: 4; }
.cs-sth[data-grouped] .cs-sthd .cs-sdial { width: min(17cqw, 21cqh); }
.cs-sth[data-grouped][data-n="many"] .cs-sthd .cs-sdial { width: min(13cqw, 17cqh); }
.cs-stemp svg { stroke: var(--tc, #fff) !important; }
.cs-sthd.off .cs-sdial .n { opacity: 0.6; }
/* cameras and doorbells: three to a row (one or two, larger, when there are only that many) */
.cs-scams { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2cqmin; width: min(90cqw, 128cqh); }
/* fewer cameras, larger pictures: each as large as fits the screen */
.cs-scams[data-n="3"] { width: min(94cqw, 360cqh); }
.cs-scams[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(90cqw, 124cqh); }
.cs-scams[data-n="6"] { width: min(94cqw, 186cqh); }
.cs-sp-cameras .cs-sclip, .cs-sp-doorbell .cs-sclip { max-height: 76cqh; }
.cs-scams[data-n="1"] { grid-template-columns: 1fr; width: min(86cqw, 126cqh); }
.cs-scams[data-n="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(94cqw, 250cqh); }
.cs-scam { position: relative; aspect-ratio: 16 / 9; border-radius: 1.6cqmin; overflow: hidden; background: rgba(0,0,0,0.25); }
.cs-scam img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cs-scam.cs-snopic { display: flex; align-items: center; justify-content: center; }
.cs-scam.cs-snopic .cs-sic { width: 22%; height: auto; aspect-ratio: 1; }
.cs-scl { position: absolute; left: 1.6cqmin; right: 1.6cqmin; bottom: 1.2cqmin; display: flex; justify-content: space-between; align-items: flex-end; gap: 1.6cqmin; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
.cs-scl b { font-size: max(11px, 2.4cqmin); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-scl span { font-size: max(8px, 1.5cqmin); letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.9; flex-shrink: 0; }
.cs-scams[data-n="1"] .cs-scl b, .cs-scams[data-n="2"] .cs-scl b { font-size: max(13px, 3.4cqmin); }
.cs-scams[data-n="1"] .cs-scl span, .cs-scams[data-n="2"] .cs-scl span { font-size: max(9px, 2cqmin); }
.cs-scams[data-n="1"] .cs-scl, .cs-scams[data-n="2"] .cs-scl { left: 2.4cqmin; right: 2.4cqmin; bottom: 2cqmin; }
/* heating: a dial for each thermostat */
.cs-sth { display: flex; gap: 6cqw; justify-content: center; }
.cs-sth[data-n="some"] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4cqh 4cqw; width: 84cqw; }
.cs-sth[data-n="many"] { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3cqh 3cqw; width: 88cqw; }
.cs-sth[data-n="some"] .cs-sthd .cs-sdial { width: min(17cqw, 21cqh); }
.cs-sth[data-n="many"] .cs-sthd .cs-sdial { width: min(13cqw, 17cqh); }
.cs-sth[data-n="some"] .cs-sdial .n, .cs-sth[data-n="many"] .cs-sdial .n { font-size: max(15px, 5.4cqmin); }
.cs-sth[data-n="many"] .cs-sthd .nm { font-size: max(11px, 2.6cqmin); }
.cs-sthd { display: flex; flex-direction: column; align-items: center; gap: 2.4cqmin; text-align: center; }
.cs-sthd .cs-sdial { width: min(26cqw, 44cqh); }
.cs-sthd.heat .cs-sdial .val { stroke: #ffb36b; }
.cs-sthd.cool .cs-sdial .val { stroke: #8fd3ff; }
.cs-sthd.idle .cs-sdial .val { stroke: rgba(255,255,255,0.55); }
.cs-sthd .cs-sdial .n { font-size: max(18px, 8.4cqmin); font-weight: 200; }
.cs-sthd .nm { font-size: max(13px, 3.6cqmin); font-weight: 700; }
.cs-sthd .st { font-size: max(9px, 1.9cqmin); font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.85; margin-top: 0.6cqmin; }
  font-size: min(7cqw, 10cqh); font-weight: 300; box-shadow: inset 0 0 0 max(2px, 0.5cqmin) #fff; }
/* today's calendar */
.cs-ssoon { font-size: max(9px, 1.9cqmin); font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; min-height: 1em; }
.cs-scal .tm { width: max(72px, 17cqmin); flex-shrink: 0; white-space: nowrap; font-size: max(13px, 3.4cqmin); font-weight: 300; font-variant-numeric: tabular-nums; }
.cs-scal .tm small { display: block; font-size: max(8px, 1.6cqmin); font-weight: 600; letter-spacing: 0.12em; opacity: 0.7; margin-top: 0.4cqmin; }
.cs-scal .cd { width: max(3px, 0.6cqmin); align-self: stretch; border-radius: 99px; background: #fff; opacity: 0.7; flex-shrink: 0; }
.cs-scal .now .cs-st1 { font-size: max(16px, 5.4cqmin); }
.cs-scal .now .cd { opacity: 1; }

/* the numbers inside every ring are sized from the ring itself, so they fit however small the rings get
   (a phone on its side, many thermostats, over the artwork) */
.cs-sdial { container-type: inline-size; }
.cs-sdial .in .n { font-size: 19cqi !important; letter-spacing: -0.02em; white-space: nowrap; }
.cs-sdial .in .cs-slab { font-size: max(6px, 6cqi) !important; letter-spacing: 0.18em; margin-top: 1.5cqi; }
/* every dial's number and label are sized from the dial itself, so they never crowd the ring however small
   it gets (a phone on its side), and a dial never gets too small to read */
.cs-scr .cs-sdial { container-type: inline-size; min-width: 92px; }
.cs-scr .cs-sdial .n { font-size: 21cqw !important; letter-spacing: -0.02em; line-height: 1; }
.cs-scr .cs-stimers .cs-sdial .n { font-size: 17cqw !important; }
.cs-scr .cs-sdial .cs-slab { font-size: max(7px, 6.5cqw) !important; letter-spacing: 0.16em; margin-top: 3cqw; }
/* settled: a row that's redrawn because a value changed appears at once, without its entrance */
.cs-settled .cs-srow, .cs-settled .cs-sot, .cs-settled .cs-smap > div, .cs-settled .cs-stile { animation: none !important; opacity: 1 !important; transform: none !important; }
.cs-settled .cs-sdial .val { transition: none; }
/* taller than wide (a phone held upright, or over a square of artwork): the screens stack */
@container (max-aspect-ratio: 5/6) {
  .cs-scams, .cs-scams[data-n] { grid-template-columns: repeat(2, minmax(0, 1fr)); width: 90cqw; }
  .cs-scams[data-n="1"], .cs-scams[data-n="2"] { grid-template-columns: 1fr; width: 90cqw; }
  .cs-slist[data-size="many"], .cs-slist[data-size="lots"], .cs-sotiles[data-size="many"], .cs-sotiles[data-size="lots"] { display: flex; flex-direction: column; width: 88cqw; }
  .cs-slist[data-size] > * + *, .cs-sotiles[data-size] > * + * { box-shadow: 0 -1px 0 rgba(255,255,255,0.3) !important; }
  .cs-slist[data-size] > *, .cs-sotiles[data-size] > * { box-shadow: none !important; }
  .cs-slist[data-size] > * + *, .cs-sotiles[data-size] > * + * { box-shadow: 0 -1px 0 rgba(255,255,255,0.3) !important; }
  .cs-sclip { max-height: 74cqh; }
  .cs-sp-lights .cs-sclip, .cs-sp-open .cs-sclip, .cs-sp-shopping .cs-sclip, .cs-sp-todo .cs-sclip { max-height: 52cqh; }
  .cs-sth { flex-direction: column; gap: 3.4cqh; align-items: flex-start; max-width: 90cqw; }
  .cs-sthd .tx { min-width: 0; }
  .cs-sthd .nm { white-space: normal; }
  .cs-sthd { flex-direction: row; gap: 5cqw; text-align: left; }
  .cs-sthd .cs-sdial { width: 34cqw; }
  .cs-sth[data-grouped] { --hc: 2 !important; width: 88cqw; }
  .cs-sth[data-grouped] .cs-sthd { flex-direction: column; text-align: center; gap: 1.6cqmin; }
  .cs-sth[data-grouped] .cs-sthd .cs-sdial { width: 32cqw !important; }
  .cs-sth[data-n="some"], .cs-sth[data-n="many"] { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4cqh 6cqw; width: 88cqw; max-width: none; }
  .cs-sth[data-n="some"] .cs-sthd, .cs-sth[data-n="many"] .cs-sthd { flex-direction: column; text-align: center; gap: 1.6cqmin; }
  .cs-sth[data-n="some"] .cs-sthd .cs-sdial { width: 32cqw; }
  .cs-sth[data-n="many"] .cs-sthd .cs-sdial { width: 24cqw; }
  .cs-slist { width: 88cqw; }
  .cs-stime .t { font-size: 24cqw; }
  .cs-sdials { flex-direction: column; gap: 3cqh; }
  .cs-sdial { width: min(46cqw, 24cqh); }
  .cs-sdial .n { font-size: max(16px, 7cqmin); }
  .cs-stiles { flex-direction: column; align-items: stretch; gap: 2.6cqh; width: 88cqw; }
  .cs-stile, .cs-stile:first-child { width: auto; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto auto; column-gap: 4cqw; align-items: center; transform: translateX(40cqw); }
  .cs-stile .sq { grid-row: 1 / 4; width: 22cqh; max-width: 34cqw; }
  .cs-stile:first-child .sq { width: 26cqh; max-width: 40cqw; }
  .cs-stile .cs-slab { margin: 0; align-self: end; }
  .cs-stile .cs-st1 { margin-top: 0.6cqmin; font-size: max(13px, 5cqmin); }
  .cs-sotiles { width: 86cqw; }
  .cs-smap { grid-template-columns: 1fr; }
}
/* a small box (the screensaver over the artwork): fewer things, larger */
@container (max-height: 520px) {
  .cs-scol { gap: 3cqh; }
  .cs-sotiles { width: 84cqw; }
  .cs-sopen { gap: 3cqh; }
  .cs-stile:nth-child(3) { display: none; }
}
.cs-still *, .cs-still *::before, .cs-still *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; transition-duration: 0.001s !important; }
/* Dark Screens (editor → Info Screens, off by default): each screen on black, with its own colour (made light
   enough to read on black, --sc) kept for the headings, rings, bars, icons and dots, instead of filling the
   screen. On an OLED screen a black pixel is switched off, so this uses far less power. */
.cs-sdark { color: rgba(255,255,255,0.9); }
.cs-sdark .cs-slab, .cs-sdark .cs-scorner, .cs-sdark .cs-shead { color: var(--sc); opacity: 1; }
.cs-sdark .cs-st2 { opacity: 0.7; }
.cs-sdark .cs-stime .d, .cs-sdark .cs-scount span { color: var(--sc); }
.cs-sdark .cs-sdial .trk { stroke: rgba(255,255,255,0.12); }
.cs-sdark .cs-sdial .val { stroke: var(--sc); }
.cs-sdark .cs-sbar { background: rgba(255,255,255,0.14); }
.cs-sdark .cs-sbar i { background: var(--sc) !important; }
.cs-sdark .cs-sic svg { stroke: var(--sc); }
.cs-sdark .cs-scal .cd { background: var(--sc); }
.cs-sdark .cs-spills > div::before { box-shadow: inset 0 0 0 max(1.5px, 0.3cqmin) var(--sc); }
.cs-sdark .cs-spills > div.on::before { background: var(--sc); }
.cs-sdark .cs-sot + .cs-sot, .cs-sdark .cs-srow + .cs-srow { box-shadow: 0 -1px 0 rgba(255,255,255,0.14); }
.cs-sdark .cs-smap > div { box-shadow: 0 1px 0 rgba(255,255,255,0.14); }
.cs-sdark .cs-stile .sq, .cs-sdark .cs-scam { background: rgba(255,255,255,0.06); box-shadow: none; }
.cs-sdark .cs-slyrw .ln { opacity: 0.25; }
.cs-sdark .cs-slyrw .ln.past { opacity: 0.14; }
.cs-sdark .cs-slyrw .ln.on { opacity: 1; }
.cs-sdark-root .cs-sdots i, .cs-sdark-root .cs-sp-week ~ .cs-sdots i, .cs-sdark-root .cs-sp-open ~ .cs-sdots i { background: rgba(255,255,255,0.22); }
.cs-sdark-root .cs-sdots i.on { background: var(--sc, #fff); }
`;

Object.assign(K.kit, { CrowMediaAtmCanvas, CrowMediaClockDrawer });

Object.assign(K.Card.prototype, {
  // the style picked from the quick menu (until the page is refreshed or closed), otherwise the editor's
  _saverPick() {
    let pick = null;
    pick = window.__crowMediaSaverPick || null;
    const ok = v => v === 'shuffle' || this._saverStyles().includes(v);
    return ok(pick) ? pick : crowMediaAutoStart(this._config).saverStyle;
  },

  _saverStyles() { return CROW_MEDIA_SAVER_STYLES; },

  async _saverStart(manual = false, chosen = null) {
    const r = this.shadowRoot;
    let card = r?.getElementById('cardOuter');
    if (!card) return;
    const full = this._saverFull();
    if (!full && card.classList.contains('mode-compact')) { try { await this._expandFromCompact(); } catch (_) {} }
    const art = r.getElementById('artClick');
    if ((!art && !full) || !this._saverCanShow(true)) return;
    this._saverStop(true);
    // the screensaver and a visualiser never show together
    this._vizStop(true);
    // only one full-screen screensaver on the page: another card's makes way
    const other = window.__crowMediaSaverOwner;
    if (other && other !== this) { try { other._saverStop(true); } catch (_) {} }
    const el = document.createElement('div');
    el.id = 'crowSaver';
    el.className = 'crow-saver';
    el._manual = manual;
    el._shownAt = Date.now();
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Screensaver: tap to close');
    el.innerHTML = '<div class="cs-stage"></div>';
    if (full) {
      // Full screen: a layer of its own on the page, above Home Assistant's header and sidebar, with its
      // own sealed-off copy of the screensaver styles (a card's glass blur would otherwise trap it inside
      // the card, and dashboard themes can't reach in)
      el.classList.add('cs-full');
      const host = document.createElement('div');
      host.className = 'crow-media-saver-host';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:block;margin:0;padding:0;border:0;background:transparent;';
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<style>' + CROW_MEDIA_SAVER_CSS + CROW_MEDIA_SAVER_FULL_CSS + '</style>';
      try { const font = getComputedStyle(card).fontFamily; if (font) el.style.setProperty('--cs-font', font); } catch (_) {}
      sr.appendChild(el);
      document.body.appendChild(host);
      this._fsPop(host);
      this._saverHost = host;
      window.__crowMediaSaverOwner = this;
      this._saverKey = (e) => { if (e.key === 'Escape' && this._saverEl === el) { e.stopPropagation(); this._saverActiveAt = Date.now(); this._saverStop(); } };
      document.addEventListener('keydown', this._saverKey, true);
    } else {
      card.insertBefore(el, art.nextSibling);
    }
    this._saverEl = el;
    this._saverPlace();
    if (!this._saverRO && typeof ResizeObserver === 'function') this._saverRO = new ResizeObserver(() => this._saverPlace());
    this._saverRO?.observe(full ? el : art);
    const close = (e) => {
      e.preventDefault(); e.stopPropagation();
      // iOS sends a late "click" after the tap that chose it from the quick menu, at the same spot, which
      // would land on the screensaver and close it straight away, so taps in its first moment are ignored
      if (Date.now() - el._shownAt < 900) return;
      this._saverActiveAt = Date.now();
      // the tap mustn't fall through to the artwork once the screensaver has gone
      this._suppressArtTap = true;
      clearTimeout(this._suppressArtTapTimer);
      this._suppressArtTapTimer = setTimeout(() => { this._suppressArtTap = false; }, 600);
      this._saverStop();
    };
    el.addEventListener('click', (e) => { if (el._lpFired || (el._swiped && Date.now() - el._swiped < 700)) { e.preventDefault(); e.stopPropagation(); return; } close(e); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Long press on an album cover (Album Wall) opens the Info panel for it
    let lpT = null, lpX = 0, lpY = 0;
    const lpCancel = () => { clearTimeout(lpT); lpT = null; };
    el.addEventListener('pointerdown', (e) => {
      lpCancel();
      if (e.button > 0) return;
      lpX = e.clientX; lpY = e.clientY;
      const tile = e.target.closest?.('.cs-tile');
      const item = el._style === 'wall' ? tile?._item : null;
      if (!item || (!item.song && !item.t && !item.s)) return;
      lpT = setTimeout(() => {
        lpT = null;
        el._lpFired = true;
        this._saverActiveAt = Date.now();
        this._suppressArtTap = true;
        clearTimeout(this._suppressArtTapTimer);
        this._suppressArtTapTimer = setTimeout(() => { this._suppressArtTap = false; }, 900);
        try { navigator.vibrate?.(10); } catch (_) {}
        this._saverStop();
        this._showAITrackInfo(item.song || item.t || '', item.s || '', { fromSearch: true, overrideArt: item.src || '', overrideAlbum: item.t && item.t !== item.song ? item.t : '' });
      }, 500);
    });
    el.addEventListener('pointermove', (e) => { if (lpT && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) lpCancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, lpCancel));
    if (chosen) window.__crowMediaSaverPick = chosen;   // until the page is refreshed or closed
    let style = chosen || this._saverPick();
    if (style !== 'shuffle' && !this._saverStyles().includes(style)) style = 'wall';
    const pick = (not) => { const l = this._saverStyles().filter(x => x !== not); return l[Math.floor(Math.random() * l.length)]; };
    this._saverShow(style === 'shuffle' ? pick() : style);
    if (style === 'shuffle') this._saverShuffleT = setInterval(() => { if (this._saverEl) this._saverShow(pick(this._saverEl._style)); }, 5 * 60000);
    this._saverClockT = setInterval(() => this._saverClock(), 5000);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  },


  // Sized and placed exactly over the artwork
  _saverPlace() {
    const el = this._saverEl;
    if (el?.classList.contains('cs-full')) {
      // fills the window by itself; just keep the drawings in step when it's resized or rotated
      if (this._saverSky && this._saverSkyCv?.isConnected) this._saverSky.resize(el.offsetWidth, el.offsetHeight);
      if (el._style === 'wall' && el._wallDims) {
        const d = this._saverWallDims(el._wallN);
        if (d.c !== el._wallDims.c || d.r !== el._wallDims.r) this._saverShow('wall');
      }
      if (el._style === 'flip') this._saverFlipUpdate(false);
      return;
    }
    const art = this.shadowRoot?.getElementById('artClick');
    if (!el || !art) return;
    // measured from the artwork's real on-screen box (inside the card's border), so no edge of it peeks out
    const host = el.offsetParent || el.parentElement;
    const ar = art.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const hcs = getComputedStyle(host);
    el.style.left = (ar.left - hr.left - (parseFloat(hcs.borderLeftWidth) || 0)) + 'px';
    el.style.top = (ar.top - hr.top - (parseFloat(hcs.borderTopWidth) || 0)) + 'px';
    el.style.width = ar.width + 'px';
    el.style.height = ar.height + 'px';
    if (this._saverSky && this._saverSkyCv?.isConnected) this._saverSky.resize(art.offsetWidth, art.offsetHeight);
  },

  // a screen's colour made light enough to read on black (Dark Screens): the same hue, brighter
  _scrTint(hex) {
    const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const l0 = (mx + mn) / 2, s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
    const s = Math.max(0.55, Math.min(0.9, s0)), l = 0.7;
    return 'hsl(' + Math.round(h) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)';
  },

  _saverStop(now = false) {
    clearInterval(this._saverShuffleT); clearInterval(this._saverClockT); this._saverShuffleT = this._saverClockT = null;
    this._saverClearStyle();
    const el = this._saverEl;
    this._saverEl = null;
    // what was resting underneath while it covered the screen picks up again straight away: full screen, or
    // the main player (which was only redrawn for real changes meanwhile)
    if (el?.classList.contains('cs-full')) {
      if (this._fs) { try { this._fsRest?.(false); } catch (_) {} }
      else { this._fsHassFp = null; try { const st = this._hass?.states?.[this._entity]; if (st) this.updateContent(st); } catch (_) {} }
    }
    if (this._saverRO) { try { this._saverRO.disconnect(); } catch (_) {} }
    if (this._saverKey) { document.removeEventListener('keydown', this._saverKey, true); this._saverKey = null; }
    const host = this._saverHost;
    this._saverHost = null;
    if (window.__crowMediaSaverOwner === this) window.__crowMediaSaverOwner = null;
    if (host) host.style.pointerEvents = 'none';   // the fading layer mustn't catch taps meant for the dashboard
    if (!el) { host?.remove(); return; }
    if (now) { el.remove(); host?.remove(); return; }
    el.style.pointerEvents = 'none';
    el.classList.remove('on');
    setTimeout(() => { el.remove(); host?.remove(); }, 650);
  },

  _saverClearStyle() {
    if (this._scrOff) { try { this._scrOff(); } catch (_) {} this._scrOff = null; }
    clearInterval(this._saverMoveT); this._saverMoveT = null;
    clearInterval(this._saverFxT); this._saverFxT = null;
    if (this._saverRaf) { cancelAnimationFrame(this._saverRaf); this._saverRaf = null; }
    if (this._saverSky) { try { this._saverSky.stop(); } catch (_) {} }
    this._saverSky = null; this._saverSkyCv = null;
    (this._saverBlobs || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    this._saverBlobs = [];
  },

  // Swap the screensaver to a style (the small clock sits over the styles that don't show the time themselves)
  _saverShow(style) {
    const el = this._saverEl;
    if (!el) return;
    this._saverClearStyle();
    el._style = style;
    el.innerHTML = '<div class="cs-stage"></div>';
    const stage = el.firstChild;
    if (style === 'aurora') this._saverAurora(stage);
    else if (style === 'clock') this._saverClockStyle(stage);
    else if (style === 'wall') this._saverWall(stage);
    else if (style === 'flip') this._saverFlip(stage);
    else if (style === 'analog') this._saverAnalog(stage);
    else if (style === 'lava') this._saverLava(stage);
    else if (style === 'rain') this._saverRain(stage);
    else if (style === 'night') this._saverNightSky(stage);
    else if (style === 'words') this._saverWordClock(stage);
    else if (style === 'fire') this._saverFireplace(stage);
    else if (style === 'ocean') this._saverOcean(stage);
    else if (style === 'screens') this._saverScreens(stage);
    else this._saverWall(stage);
    // styles that already show the time don't get the small clock
    if (!['clock', 'flip', 'analog', 'words', 'screens'].includes(style) && this._config?.screensaver_clock !== false) {
      const m = document.createElement('div');
      m.className = 'cs-mini';
      el.appendChild(m);
    }
    this._saverClock();
  },

  // Time, date and weather, in Home Assistant's own 12 / 24-hour setting
  _saverTimeParts() {
    const now = new Date();
    const loc = this._hass?.locale || {};
    const lang = loc.language || this._hass?.language || undefined;
    const h12 = loc.time_format === '12' ? true : loc.time_format === '24' ? false : undefined;
    let t;
    try { t = now.toLocaleTimeString(lang, { hour: h12 === false ? '2-digit' : 'numeric', minute: '2-digit', hour12: h12 }); } catch (_) { t = now.toLocaleTimeString(); }
    t = t.replace(/\s?[ap]\.?m\.?$/i, m => m.toUpperCase().replace(/\./g, ''));
    let d;
    try { d = now.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }); } catch (_) { d = now.toDateString(); }
    let w = '';
    const ent = (this._config?.screensaver_weather || '').trim();
    const ws = ent ? this._hass?.states[ent] : null;
    if (ws && ws.state !== 'unavailable' && ws.state !== 'unknown') {
      const temp = Number(ws.attributes?.temperature);
      const unit = ws.attributes?.temperature_unit || '°';
      const name = CROW_MEDIA_WX_NAMES[ws.state] || String(ws.state).replace(/-/g, ' ');
      w = name + (Number.isFinite(temp) ? ' · ' + Math.round(temp) + (unit.startsWith('°') ? unit : '°') : '');
    }
    return { t, d, w };
  },

  _saverClock() {
    const el = this._saverEl;
    if (!el) return;
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const { t, d, w } = this._saverTimeParts();
    const big = el.querySelector('.cs-big');
    if (big) {
      const html = '<div class="t">' + esc(t) + '</div><div class="d">' + esc(d) + '</div>' + (w ? '<div class="w">' + esc(w) + '</div>' : '');
      if (big._html !== html) { big._html = html; big.innerHTML = html; }
      this._saverSkySync();
    }
    const mini = el.querySelector('.cs-mini');
    if (mini) {
      const html = '<div class="t">' + esc(t) + '</div><div class="d">' + esc(w ? d + ' · ' + w : d) + '</div>';
      if (mini._html !== html) { mini._html = html; mini.innerHTML = html; }
    }
  },

  // The artwork of recently played albums (Album Wall, Rain on Glass, Lava Lamp's colours)
  _saverArtList() {
    const out = [], seen = new Set();
    // t: album (or song) for the caption, s: artist, song: a track to open the Info panel for
    const add = (src, t, s, song) => { if (!src || seen.has(src)) return; seen.add(src); out.push({ src, t: t || '', s: s || '', song: song || '' }); };
    const a = this._hass?.states[this._entity]?.attributes || {};
    const cur = this.shadowRoot?.getElementById('albumImg');
    if (cur?.src && cur.naturalWidth && !/^data:/.test(cur.src)) add(cur.src, a.media_album_name || a.media_title, a.media_artist, a.media_title);
    const big = u => String(u).replace(/\/\d+x\d+(bb|cc)?\./, '/600x600bb.');
    let asked = 0;
    const log = (this._getListenLogEntries?.() || []).filter(e => (e.mediaType || 'music') === 'music').sort((x, y) => (y.ts || 0) - (x.ts || 0));
    for (const e of log) {
      const key = [e.artist, e.album || e.title].filter(Boolean).join('|').toLowerCase();
      const art = this._itunesArtCache?.[key];
      if (art) add(big(art), e.album || e.title, e.artist, e.title);
      else if (!(key in (this._itunesArtCache || {})) && asked < 12) { asked++; try { this._fetchItunesArt(e.artist, e.album, e.title, { skipStaleGuard: true }); } catch (_) {} }
      if (out.length >= 40) break;
    }
    return out;
  },

  // Ambient aurora: colour glows drifting and fading in turn (so the colour keeps changing), with soft
  // aurora curtains swaying across a starry night sky. All CSS, so it runs smoothly and offline.
  _saverAurora(stage) {
    const box = document.createElement('div');
    box.className = 'cs-aurora';
    box.innerHTML = '<div class="cs-stars"></div>'
      + [0, 1, 2, 3, 4, 5, 6].map(i => '<div class="cs-glow g' + i + '"></div>').join('')
      + [0, 1, 2].map(i => '<div class="cs-curtain c' + i + '"></div>').join('');
    const v = document.createElement('div'); v.className = 'cs-vignette';
    stage.appendChild(box); stage.appendChild(v);
  },

  // Clock & Weather: a big clock over the animated weather sky (or a calm gradient without a weather entity)
  _saverClockStyle(stage) {
    const bg = document.createElement('div'); bg.className = 'cs-clockbg';
    stage.appendChild(bg);
    const ent = (this._config?.screensaver_weather || '').trim();
    if (ent && this._hass?.states[ent] && typeof CrowMediaAtmCanvas === 'function') {
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      stage.appendChild(cv);
      this._saverSkyCv = cv;
      this._saverSky = new CrowMediaAtmCanvas(cv);
      this._saverSky.cloudDrift = 34;   // clouds drift across the panel in a minute or two
      this._saverSkyReady = false;
    }
    const big = document.createElement('div'); big.className = 'cs-big';
    stage.appendChild(big);
    // a small shift every minute so nothing sits in exactly the same place for hours
    this._saverMoveT = setInterval(() => { big.style.transform = 'translate(' + (Math.random() * 10 - 5).toFixed(1) + '%, calc(-50% + ' + (Math.random() * 10 - 5).toFixed(1) + '%))'; }, 60000);
    requestAnimationFrame(() => this._saverSkySync());
  },

  _saverSkySync() {
    const sky = this._saverSky, cv = this._saverSkyCv, el = this._saverEl;
    if (!sky || !cv || !el) return;
    const ws = this._hass?.states[(this._config?.screensaver_weather || '').trim()];
    const cond = ws?.state || 'cloudy';
    const night = cond === 'clear-night' || this._hass?.states['sun.sun']?.state === 'below_horizon';
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    if (!this._saverSkyReady) { sky.init(cond, night, night, w, h); this._saverSkyReady = true; }
    else sky.update(cond, night, night);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { sky.stop(); sky.drawOnce(); } else sky.start();
  },

  // ── Album Wall: a grid of recent album covers, one tile at a time flipping to another ──
  _saverWall(stage) {
    let list = this._saverArtList();
    if (!list.length) { this._saverAurora(stage); return; }
    const alive = () => this._saverEl && stage.parentNode === this._saverEl;
    const n = list.length >= 6 ? 4 : list.length >= 2 ? 3 : 2;
    // over the artwork it's n by n; full screen keeps the covers square, so a tall phone gets more rows
    // and a wide screen more columns (worked out again if the screen is rotated)
    const dims = this._saverWallDims(n);
    if (this._saverEl) { this._saverEl._wallN = n; this._saverEl._wallDims = dims; }
    const wall = document.createElement('div');
    wall.className = 'cs-wall';
    wall.style.gridTemplateColumns = 'repeat(' + dims.c + ', 1fr)';
    wall.style.gridTemplateRows = 'repeat(' + dims.r + ', 1fr)';
    const tiles = [];
    for (let i = 0; i < dims.c * dims.r; i++) {
      const t = document.createElement('div');
      t.className = 'cs-tile';
      t.innerHTML = '<div class="in"><img class="a" alt=""><img class="b" alt=""></div>';
      const it = list[i % list.length], src = it.src;
      t.querySelector('img.a').src = src;
      t._src = src; t._item = it;
      tiles.push(t);
      wall.appendChild(t);
    }
    stage.appendChild(wall);
    const v = document.createElement('div'); v.className = 'cs-vignette';
    stage.appendChild(v);
    let flips = 0, last = -1;
    this._saverFxT = setInterval(() => {
      if (!alive()) return;
      if (++flips % 8 === 0) { const fresh = this._saverArtList(); if (fresh.length) list = fresh; }
      let i = Math.floor(Math.random() * tiles.length);
      if (i === last) i = (i + 1) % tiles.length;
      last = i;
      const t = tiles[i];
      const showing = new Set(tiles.map(x => x._src));
      const pool = list.filter(x => !showing.has(x.src));
      const pickFrom = pool.length ? pool : list.filter(x => x.src !== t._src);
      if (!pickFrom.length) return;
      const it = pickFrom[Math.floor(Math.random() * pickFrom.length)], src = it.src;
      const hidden = t.querySelector(t.classList.contains('flipped') ? 'img.a' : 'img.b');
      const img = new Image();
      img.onload = () => {
        if (!alive()) return;
        hidden.src = src;
        t._src = src; t._item = it;
        requestAnimationFrame(() => t.classList.toggle('flipped'));
      };
      img.src = src;
    }, 2600);
  },

  _saverWallDims(n) {
    const el = this._saverEl;
    if (!el?.classList.contains('cs-full')) return { c: n, r: n };
    const W = el.offsetWidth || 1, H = el.offsetHeight || 1, side = Math.min(W, H) / n;
    return { c: Math.max(1, Math.round(W / side)), r: Math.max(1, Math.round(H / side)) };
  },

  // ── Flip Clock: split-flap digits ──
  _saverFlip(stage) {
    const bg = document.createElement('div');
    bg.className = 'cs-flipbg';
    const unit = () => '<div class="cs-fd"><div class="h t"><span></span></div><div class="h b"><span></span></div></div>';
    bg.innerHTML = '<div class="cs-flip">' + unit() + unit() + '<div class="cs-colon"><i></i><i></i></div>' + unit() + unit()
      + '</div><div class="cs-ampm"></div><div class="cs-under"></div>';
    stage.appendChild(bg);
    if (this._saverEl?.classList.contains('cs-full')) bg.querySelector('.cs-flip').appendChild(bg.querySelector('.cs-ampm'));
    this._saverFlipUpdate(true);
    this._saverFxT = setInterval(() => this._saverFlipUpdate(false), 1000);
  },

  _saverFlipUpdate(first) {
    const el = this._saverEl;
    const bg = el?.querySelector('.cs-flipbg');
    if (!bg) return;
    const now = new Date();
    const h12 = this._hass?.locale?.time_format === '12'
      || (this._hass?.locale?.time_format !== '24' && /[ap]m/i.test(this._saverTimeParts().t));
    let h = now.getHours();
    const ampm = h < 12 ? 'AM' : 'PM';
    if (h12) h = h % 12 || 12;
    const hs = h12 ? String(h).padStart(2, ' ') : String(h).padStart(2, '0');
    const digits = (hs + String(now.getMinutes()).padStart(2, '0')).split('').map(c => c === ' ' ? '' : c);
    const flip = bg.querySelector('.cs-flip');
    const w = el.offsetWidth || 300;
    if (el.classList.contains('cs-full')) {
      // as wide as fits, and never taller than about 44% of the screen (wide screens, landscape tablets)
      const dw = Math.min(w * 0.19, (el.offsetHeight || 300) * 0.44 * 0.68);
      flip.style.setProperty('--cs-fdw', dw.toFixed(1) + 'px');
      flip.style.setProperty('--cs-fd', Math.round(dw / 0.68 * 0.74) + 'px');
    } else flip.style.setProperty('--cs-fd', Math.round(w * 0.19 / 0.68 * 0.74) + 'px');
    bg.querySelector('.cs-ampm').textContent = h12 ? ampm : '';
    const units = flip.querySelectorAll('.cs-fd');
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    units.forEach((u, i) => {
      const nv = digits[i];
      if (u._v === nv) return;
      const old = u._v;
      u._v = nv;
      const top = u.querySelector('.h.t span'), bot = u.querySelector('.h.b span');
      if (first || still || old === undefined) { top.textContent = nv; bot.textContent = nv; return; }
      u.querySelectorAll('.flap').forEach(f => f.remove());
      // the new digit waits behind the top flap; the old one stays on the bottom until the lower flap covers it
      top.textContent = nv;
      bot.textContent = old;
      const ft = document.createElement('div'); ft.className = 'flap t'; ft.innerHTML = '<span></span>'; ft.firstChild.textContent = old;
      const fb = document.createElement('div'); fb.className = 'flap b'; fb.innerHTML = '<span></span>'; fb.firstChild.textContent = nv;
      u.appendChild(ft); u.appendChild(fb);
      setTimeout(() => { bot.textContent = u._v; ft.remove(); fb.remove(); }, 680);
    });
    const { d, w: wx } = this._saverTimeParts();
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = esc(d) + (wx ? '<br>' + esc(wx) : '');
    const under = bg.querySelector('.cs-under');
    if (under._html !== html) { under._html = html; under.innerHTML = html; }
  },

  // ── Analogue Clock: a dial with a smoothly sweeping second hand, in the chosen face ──
  _saverAnalog(stage) {
    const bg = document.createElement('div');
    bg.className = 'cs-anbg';
    const cv = document.createElement('canvas');
    cv.className = 'cs-dial';
    cv.setAttribute('aria-hidden', 'true');
    const under = document.createElement('div');
    under.className = 'cs-under';
    bg.appendChild(cv); bg.appendChild(under);
    stage.appendChild(bg);
    if (typeof CrowMediaClockDrawer !== 'function') return;
    const drawer = new CrowMediaClockDrawer(cv);
    const faces = ['classic', 'minimal', 'roman', 'modern', 'luxury', 'skeleton', 'neon', 'retro', 'sport', 'art_deco', 'celestial', 'stargate'];
    const face = faces.includes(this._config?.screensaver_dial) ? this._config.screensaver_dial : 'luxury';
    const accent = this._config?.accent_color || '#007AFF';
    drawer.setConfig({
      face, dial_color: '#101015', dial_text_color: '#FFFFFF', accent_color: accent,
      hour_hand_color: '#FFFFFF', minute_hand_color: '#FFFFFF', second_hand_color: '#FF3B30', show_seconds: true,
    });
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let px = 0, lastSec = -1, lastText = '';
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const frame = () => {
      if (!this._saverEl || !cv.isConnected) return;
      const el = this._saverEl;
      const size = Math.round(el.classList.contains('cs-full')
        ? Math.min(el.offsetWidth * 0.8, el.offsetHeight * 0.6)
        : Math.min(el.offsetWidth, el.offsetHeight * 0.92) * 0.58);
      if (size > 0 && size !== px) { px = size; drawer.resize(px); lastSec = -1; }
      const now = new Date();
      const s = now.getSeconds(), ms = now.getMilliseconds();
      if (!still || s !== lastSec) {
        const sa = still ? (s / 60) * 2 * Math.PI : ((s + ms / 1000) / 60) * 2 * Math.PI;
        drawer.draw(now.getHours(), now.getMinutes(), s, sa);
      }
      if (s !== lastSec) {
        lastSec = s;
        const { d, w } = this._saverTimeParts();
        const html = esc(d) + (w ? '<br>' + esc(w) : '');
        if (html !== lastText) { lastText = html; under.innerHTML = html; }
      }
      this._saverRaf = still ? null : requestAnimationFrame(frame);
    };
    frame();
    if (still) this._saverFxT = setInterval(frame, 1000);
  },

  // ── Lava Lamp: glossy blobs rising, merging and sinking in a glowing lamp, their colours slowly shifting ──
  // The strongest colours in the last song's cover, as hues (most common first), or null when the cover
  // has no real colour (black and white, greys, browns) or can't be read
  _saverArtHues() {
    const im = this.shadowRoot?.getElementById('albumImg');
    if (!im || !im.complete || !im.naturalWidth || /^data:/.test(im.src || '')) return null;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0 }));
      let coloured = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dd = mx - mn;
        if (!dd) continue;
        const sat = dd / (1 - Math.abs(2 * l - 1));
        if (sat < 0.3 || l < 0.15 || l > 0.88) continue;
        let h = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
        h *= 60; if (h < 0) h += 360;
        const wt = sat * (1 - Math.abs(l - 0.5));
        const bk = buckets[Math.floor(h / 30) % 12];
        bk.w += wt; bk.h += h * wt;
        coloured++;
      }
      if (coloured < 24) return null;   // under about 4% of the cover has any colour
      const top = buckets.filter(bk => bk.w > 0.6).sort((a, b) => b.w - a.w).slice(0, 2).map(bk => bk.h / bk.w);
      return top.length ? top : null;
    } catch (_) {
      // an image from another site that the browser won't let us read: Music Assistant's colours for it
      const pal = this._maPaletteGet?.();
      const hue = c => {
        if (!Array.isArray(c) || c.length < 3) return null;
        const r = c[0] / 255, gg = c[1] / 255, b = c[2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
        const l = (mx + mn) / 2;
        if (!dd || dd / (1 - Math.abs(2 * l - 1)) < 0.3) return null;   // no real colour
        let h = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
        h *= 60; return h < 0 ? h + 360 : h;
      };
      const hs = pal ? [hue(pal.primary), hue(pal.accent)].filter(h => h != null) : [];
      if (!pal) this._maPaletteLoad?.();
      return hs.length ? hs : null;
    }
  },

  _saverLava(stage) {
    const box = document.createElement('div');
    box.className = 'cs-lava';
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    box.appendChild(cv);
    stage.appendChild(box);
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, img = null, px = null;
    // the album colours follow the cover: a skipped track's new cover is picked up and the wax
    // blends across to its colours over a couple of seconds
    let artHues = this._saverArtHues(), artSrc = this.shadowRoot?.getElementById('albumImg')?.src || '', artCheckAt = 0;
    let shown = artHues ? artHues.slice() : null;
    const towards = (from, to, k) => { const d = ((to - from + 540) % 360) - 180; return (from + d * k + 360) % 360; };
    // the blobs, in fractions of the panel: two big pools that sit at the bottom, and floating blobs
    const blobs = [
      { pool: true, x: 0.28, r: 0.17, ph: 0.4, wob: 0.05 },
      { pool: true, x: 0.72, r: 0.15, ph: 2.1, wob: 0.06 },
      ...Array.from({ length: 6 }, (_, i) => ({
        x: 0.18 + Math.random() * 0.64, r: 0.05 + Math.random() * 0.055,
        sp: 0.010 + Math.random() * 0.016, ph: Math.random() * Math.PI * 2, wob: 0.03 + Math.random() * 0.06, i,
      })),
    ];
    const hsl = (h, s, l) => {
      const a = s * Math.min(l, 1 - l);
      const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0) * 255, f(8) * 255, f(4) * 255];
    };
    // light from the upper left, for the glossy shading
    const Lx = -0.42, Ly = -0.52, Lz = 0.74;
    const size = () => {
      const el = this._saverEl;
      if (!el) return false;
      const cw = el.offsetWidth, ch = el.offsetHeight;
      if (!cw || !ch) return false;
      // drawn at a bit over half the panel's size and smoothed up: sharp enough, still light on the battery
      const w = Math.max(120, Math.min(el.classList.contains('cs-full') ? 360 : 280, Math.round(cw * 0.6)));
      const h = Math.max(120, Math.round(w * ch / cw));
      if (w === W && h === H) return true;
      W = w; H = h;
      cv.width = W; cv.height = H;
      img = ctx.createImageData(W, H); px = img.data;
      return true;
    };
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now() - Math.random() * 90000;
    let lastDraw = 0;
    const pos = new Float64Array(blobs.length * 4);
    // each blob adds a smooth bump to a field; the wax is wherever the field is over T. Its own reach (R) is
    // a little wider than the blob looks, so neighbours start to merge before they touch.
    const T = 0.18, REACH = 1 / Math.sqrt(1 - Math.cbrt(T));
    const frame = (now) => {
      if (!this._saverEl || !cv.isConnected) return;
      if (!still) this._saverRaf = requestAnimationFrame(frame);
      if (now - lastDraw < 33) return;   // about 30 frames a second is plenty
      lastDraw = now;
      if (!size()) return;
      const t = (now - t0) / 1000;
      // the last song's album colours, drifting gently around them (or every colour in turn, for a cover
      // with no real colour in it), always bright enough for the wax to glow
      if (now - artCheckAt > 1000) {
        artCheckAt = now;
        const im = this.shadowRoot?.getElementById('albumImg');
        if (im && im.src !== artSrc && im.complete && im.naturalWidth) {
          artSrc = im.src;
          artHues = this._saverArtHues();
          // from colour cycling to album colours (or back), start from the colour on screen now
          if (artHues && !shown) shown = [(t * 3) % 360, ((t * 3) + 28) % 360];
        }
      }
      let hue, hue2;
      if (artHues) {
        const k = 0.04;   // per frame (about 30 a second): most of the way there in two seconds
        shown[0] = towards(shown[0], artHues[0], k);
        shown[1] = towards(shown[1] ?? shown[0], artHues[1] ?? (artHues[0] + 28), k);
        const sway = Math.sin(t * 0.045);
        hue = (shown[0] + 16 * sway + 360) % 360;
        hue2 = (shown[1] + 12 * Math.sin(t * 0.037 + 1) + 360) % 360;
      } else { hue = (t * 3) % 360; hue2 = (hue + 28) % 360; shown = null; }
      // the wax is one colour family (lighter in the middle), on a plain dark background
      const rim = hsl(hue, 0.9, 0.26), mid = hsl((hue + 10) % 360, 0.9, 0.48), core = hsl((hue + 24) % 360, 0.95, 0.66);
      let rAvg = 0;
      blobs.forEach((b, k) => {
        let x, y, r;
        if (b.pool) {
          // the pools bulge and settle at the bottom, as if warmed by the bulb
          x = b.x + b.wob * Math.sin(t * 0.13 + b.ph);
          y = 1.04 - 0.05 * (0.5 + 0.5 * Math.sin(t * 0.21 + b.ph * 3));
          r = b.r * (1 + 0.08 * Math.sin(t * 0.17 + b.ph));
        } else {
          // each floating blob rises and sinks at its own slow pace, wobbling and swelling a little
          y = 0.52 - 0.5 * Math.sin(t * b.sp * 2 * Math.PI + b.ph);
          x = b.x + b.wob * Math.sin(t * 0.23 + b.ph * 2);
          r = b.r * (1 + 0.12 * Math.sin(t * 0.4 + b.i));
        }
        const M = Math.min(W, H);   // the same as W over the (square) artwork
        const R = r * M * REACH;
        pos[k * 4] = x * W; pos[k * 4 + 1] = y * H; pos[k * 4 + 2] = R * R; pos[k * 4 + 3] = 1 / (R * R);
        rAvg += r * M;
      });
      rAvg /= blobs.length;
      const dome = rAvg * 0.9;   // how tall the blobs look, for the shading
      const n = blobs.length;
      let p = 0;
      for (let y = 0; y < H; y++) {
        const fy = y / H;
        for (let x = 0; x < W; x++) {
          let f = 0, gx = 0, gy = 0;
          for (let k = 0; k < n; k++) {
            const o = k * 4;
            const dx = x - pos[o], dy = y - pos[o + 1];
            const d2 = dx * dx + dy * dy;
            if (d2 >= pos[o + 2]) continue;
            const w = 1 - d2 * pos[o + 3];
            f += w * w * w;
            const g = -6 * w * w * pos[o + 3];
            gx += g * dx; gy += g * dy;
          }
          if (f <= 0) { px[p++] = 0; px[p++] = 0; px[p++] = 0; px[p++] = 0; continue; }
          let al = 0;
          let r = mid[0], g = mid[1], b = mid[2];
          const gm = Math.sqrt(gx * gx + gy * gy);
          const e = Math.max(0.004, gm * 0.75);   // about a pixel of soft edge, so it stays clean when scaled up
          if (f > T - e) {
            const a = Math.min(1, (f - (T - e)) / (2 * e));
            const aa = a * a * (3 - 2 * a);
            // a rounded surface: flat on top, curving down to upright at the edge
            const sq = Math.sqrt(Math.max(f - T, 0.0004));
            let nx = -gx * dome / (2 * sq), ny = -gy * dome / (2 * sq);
            const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            nx *= il; ny *= il;
            const dif = Math.max(0, nx * Lx + ny * Ly + il * Lz);
            const lit = dif * dif;
            let wr = rim[0] + (mid[0] - rim[0]) * dif + (core[0] - mid[0]) * lit * 0.6;
            let wg = rim[1] + (mid[1] - rim[1]) * dif + (core[1] - mid[1]) * lit * 0.6;
            let wb = rim[2] + (mid[2] - rim[2]) * dif + (core[2] - mid[2]) * lit * 0.6;
            // glossy highlight, and warmth from the bulb below on the undersides
            const spec = Math.pow(dif, 36) * 0.75 * 255;
            const under = Math.max(0, ny) * fy * 0.45;
            wr += spec + core[0] * under; wg += spec + core[1] * under; wb += spec + core[2] * under;
            r += (wr - r) * aa; g += (wg - g) * aa; b += (wb - b) * aa;
            al += (1 - al) * aa;
          }
          px[p++] = r; px[p++] = g; px[p++] = b; px[p++] = al * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    this._saverRaf = requestAnimationFrame(frame);
  },

  // ── Rain on Glass: drops gathering, then running down a window over a blurred album cover ──
  _saverRain(stage) {
    const box = document.createElement('div');
    box.className = 'cs-rainbg';
    const cur = this.shadowRoot?.getElementById('albumImg');
    let src = cur?.src && cur.naturalWidth && !/^data:/.test(cur.src) ? cur.src : '';
    if (!src) src = this._saverArtList()[0]?.src || '';
    let art = null;
    if (src) {
      art = document.createElement('img');
      art.alt = '';
      art.src = src;
      box.appendChild(art);
    }
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    box.appendChild(cv);
    const v = document.createElement('div'); v.className = 'cs-vignette';
    stage.appendChild(box); stage.appendChild(v);
    const ctx = cv.getContext('2d');
    const mist = document.createElement('canvas');   // the small, still droplets
    const mctx = mist.getContext('2d');
    let W = 0, H = 0, S = 1, Rs = 1, maxDrops = Infinity;
    const drops = [];
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const size = () => {
      const el = this._saverEl;
      if (!el) return false;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return false;
      if (w === W && h === H) return true;
      W = w; H = h; S = Math.min(2, window.devicePixelRatio || 1);
      if (el.classList.contains('cs-full')) {
        S = Math.max(1, Math.min(S, Math.sqrt(2.4e6 / (W * H))));   // keep a big screen light on the processor
        Rs = Math.max(1, Math.min(1.8, Math.min(W, H) / 380));        // drops in proportion to the screen
        maxDrops = 150;
      }
      cv.width = mist.width = Math.round(W * S); cv.height = mist.height = Math.round(H * S);
      mctx.setTransform(S, 0, 0, S, 0, 0);
      for (let i = 0; i < Math.min(W * H / 260, 9000); i++) dot(Math.random() * W, Math.random() * H, (0.6 + Math.random() * 1.8) * Rs);
      return true;
    };
    const dot = (x, y, r) => {
      mctx.fillStyle = 'rgba(0,0,0,0.22)';
      mctx.beginPath(); mctx.arc(x, y + r * 0.35, r, 0, Math.PI * 2); mctx.fill();
      mctx.fillStyle = 'rgba(255,255,255,0.32)';
      mctx.beginPath(); mctx.arc(x, y, r * 0.8, 0, Math.PI * 2); mctx.fill();
    };
    const spawn = (y) => drops.push({
      x: Math.random() * W, y: y ?? Math.random() * H * 0.8, r: (3 + Math.random() * 6) * Rs,
      vy: 0, hold: 40 + Math.random() * 300, lastTrail: 0, drift: (Math.random() - 0.5) * 0.3,
    });
    const drawDrop = (d) => {
      const rx = d.r, ry = d.r * (d.vy > 0.5 ? 1.25 : 1.05);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(d.x, d.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      ctx.clip();
      if (art && art.complete && art.naturalWidth && (art._lens !== null)) {
        // a water drop works like a little lens, showing the colours behind it upside down. It uses a
        // tiny, soft copy of the cover, so lettering on the artwork never shows through the drops.
        if (!art._lens) {
          try { const lc = document.createElement('canvas'); lc.width = lc.height = 24; lc.getContext('2d').drawImage(art, 0, 0, 24, 24); art._lens = lc; } catch (_) { art._lens = null; }
        }
        const src = art._lens || art;
        const nw = src.width, nh = src.height;
        const k = Math.max(nw / (W * 1.16), nh / (H * 1.16));
        const sw = rx * 5 * k, sh = ry * 5 * k;
        const sx = Math.max(0, Math.min(nw - sw, (d.x + W * 0.08) * k + (nw - W * 1.16 * k) / 2 - sw / 2));
        const sy = Math.max(0, Math.min(nh - sh, (d.y + H * 0.08) * k + (nh - H * 1.16 * k) / 2 - sh / 2));
        ctx.translate(d.x, d.y); ctx.scale(1, -1);
        ctx.imageSmoothingEnabled = true; try { ctx.drawImage(src, sx, sy, sw, sh, -rx * 1.1, -ry * 1.1, rx * 2.2, ry * 2.2); } catch (_) {}
        ctx.setTransform(S, 0, 0, S, 0, 0);
      }
      const g = ctx.createRadialGradient(d.x, d.y, rx * 0.3, d.x, d.y, rx * 1.1);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g; ctx.fillRect(d.x - rx * 1.2, d.y - ry * 1.2, rx * 2.4, ry * 2.4);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(d.x - rx * 0.35, d.y - ry * 0.4, Math.max(0.8, rx * 0.2), 0, Math.PI * 2); ctx.fill();
    };
    let lastT = 0;
    const frame = (now) => {
      if (!this._saverEl || !cv.isConnected) return;
      if (!still) this._saverRaf = requestAnimationFrame(frame);
      if (!size()) return;
      const dt = lastT ? Math.min(3, (now - lastT) / 16.7) : 1;
      lastT = now;
      if (!still) {
        if (drops.length < Math.min(maxDrops, Math.max(10, W * H / 3500)) && Math.random() < 0.08 * dt) spawn();
        if (Math.random() < 0.5 * dt) dot(Math.random() * W, Math.random() * H, (0.5 + Math.random() * 1.6) * Rs);
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          if (d.hold > 0) { d.hold -= dt; if (d.hold <= 0) d.vy = 0.4; continue; }
          // running drops speed up, pause now and then, wander a little and wipe a path through the mist
          d.vy = Math.min(d.r * 0.9, d.vy + 0.03 * d.r * dt * (Math.random() < 0.97 ? 1 : -8));
          if (d.vy < 0.2) d.vy = 0.2;
          d.y += d.vy * dt;
          d.x += d.drift * dt + (Math.random() - 0.5) * 0.4;
          mctx.save(); mctx.globalCompositeOperation = 'destination-out';
          mctx.beginPath(); mctx.ellipse(d.x, d.y, d.r * 0.9, d.r * 1.2, 0, 0, Math.PI * 2); mctx.fill(); mctx.restore();
          if (d.y - d.lastTrail > d.r * 1.6) { d.lastTrail = d.y; dot(d.x + (Math.random() - 0.5) * 2, d.y - d.r * 1.8, d.r * (0.2 + Math.random() * 0.2)); d.r *= 0.985; }
          if (d.y - d.r > H || d.r < 1.5) drops.splice(i, 1);
        }
      } else if (!drops.length) { for (let i = 0; i < 14; i++) spawn(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(mist, 0, 0);
      ctx.setTransform(S, 0, 0, S, 0, 0);
      drops.forEach(drawDrop);
    };
    if (still) { const go = () => frame(performance.now()); if (art && !art.complete) art.onload = go; requestAnimationFrame(go); }
    else this._saverRaf = requestAnimationFrame(frame);
  },

  // A canvas filling the screensaver, kept at the panel's size (sharp, up to 2x on high-density screens).
  // frame(ctx, t, dt, W, H, resized, S) is called about 30 times a second; with reduced motion it's drawn once.
  // Anything drawn ahead of time should be made at W*S by H*S so it stays as sharp as the rest.
  _saverCanvasLoop(box, frame, { scale = 2, fps = 30 } = {}) {
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    box.appendChild(cv);
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, S = 1;
    const size = () => {
      const el = this._saverEl;
      if (!el) return false;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return false;
      if (w === W && h === H) return true;
      W = w; H = h; S = Math.min(scale, window.devicePixelRatio || 1);
      // full screen on a big, high-density display is a lot of pixels: stay within a budget (Raspberry Pi heat)
      if (el.classList.contains('cs-full')) S = Math.max(1, Math.min(S, Math.sqrt(2.4e6 / (W * H))));
      cv.width = Math.round(W * S); cv.height = Math.round(H * S);
      return 'resized';
    };
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let last = 0, prev = 0;
    const step = (now) => {
      if (!this._saverEl || !cv.isConnected) return;
      if (!still) this._saverRaf = requestAnimationFrame(step);
      if (now - last < 1000 / fps - 2) return;
      last = now;
      const sz = size();
      if (!sz) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / fps;
      prev = now;
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      frame(ctx, (now - t0) / 1000, dt, W, H, sz === 'resized', S);
    };
    this._saverRaf = requestAnimationFrame(step);
    return { cv, ctx };
  },

  // An offscreen canvas at the screen's pixel density; draw on it in CSS pixels
  _saverOff(W, H, S) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * S)); c.height = Math.max(1, Math.round(H * S));
    const g = c.getContext('2d'); g.setTransform(S, 0, 0, S, 0, 0);
    return [c, g];
  },

  // A fine, still film grain over the picture, which hides the banding smooth gradients get on screens
  _saverGrain(ctx, W, H, alpha = 0.035) {
    if (!this._saverGrainTile) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), im = g.createImageData(128, 128), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = (Math.random() * 255) | 0; }
      g.putImageData(im, 0, 0);
      this._saverGrainTile = c;
    }
    const p = ctx.createPattern(this._saverGrainTile, 'repeat');
    if (!p) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); ctx.restore();
  },

  // A soft round glow for stars, in white, warm or blue-white
  _saverStarSprites() {
    if (this._saverSprites) return this._saverSprites;
    const mk = (col) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(' + col + ',0.95)');
      gr.addColorStop(0.22, 'rgba(' + col + ',0.35)'); gr.addColorStop(0.5, 'rgba(' + col + ',0.08)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return c;
    };
    return (this._saverSprites = [mk('255,255,255'), mk('255,214,170'), mk('180,205,255')]);
  },

  // Tonight's moon, with its real phase (mirrored south of the equator), a soft edge to the shadow,
  // dark seas and craters, a glow, and the faint earthshine on its dark side. Drawn once a minute and reused.
  _saverMoon(ctx, cx, cy, r, S = 1, glow = 1) {
    const age = (((Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588853 + 29.530588853) % 29.530588853;
    const f = age / 29.530588853, k = Math.cos(f * Math.PI * 2);
    const south = (this._hass?.config?.latitude ?? 51) < 0;
    const side = (f < 0.5 ? 1 : -1) * (south ? -1 : 1);
    const lit = (1 - k) / 2;
    const key = [Math.round(r * 10), S, Math.round(f * 2000), side].join('|');
    if (this._saverMoonC?.key !== key) {
      const pad = Math.ceil(r * 0.15), D = (r + pad) * 2;
      const [c, g] = this._saverOff(D, D, S);
      const o = r + pad;
      // the surface: limb darkening, seas and a few craters
      const base = g.createRadialGradient(o - r * 0.25, o - r * 0.3, r * 0.1, o, o, r);
      base.addColorStop(0, '#fbf8ee'); base.addColorStop(0.7, '#e6e1d2'); base.addColorStop(1, '#bfb9a8');
      g.fillStyle = base; g.beginPath(); g.arc(o, o, r, 0, Math.PI * 2); g.fill();
      g.save(); g.beginPath(); g.arc(o, o, r, 0, Math.PI * 2); g.clip();
      const sea = (x, y, rx, ry, a) => { const gr = g.createRadialGradient(o + x * r, o + y * r, 0, o + x * r, o + y * r, Math.max(rx, ry) * r); gr.addColorStop(0, 'rgba(110,108,100,' + a + ')'); gr.addColorStop(0.7, 'rgba(110,108,100,' + a * 0.6 + ')'); gr.addColorStop(1, 'rgba(110,108,100,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(o + x * r, o + y * r, rx * r, ry * r, 0.3, 0, Math.PI * 2); g.fill(); };
      sea(-0.28, -0.28, 0.3, 0.24, 0.42); sea(-0.05, -0.05, 0.24, 0.2, 0.35); sea(0.22, -0.32, 0.18, 0.14, 0.32); sea(-0.42, 0.12, 0.2, 0.26, 0.3); sea(0.12, 0.25, 0.16, 0.12, 0.28); sea(0.36, 0.05, 0.12, 0.16, 0.25);
      let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.9, cr = r * (0.02 + rnd() * 0.06);
        const x = o + Math.cos(a) * d, y = o + Math.sin(a) * d;
        g.fillStyle = 'rgba(90,86,78,0.22)'; g.beginPath(); g.arc(x + cr * 0.15, y + cr * 0.15, cr, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,250,0.25)'; g.beginPath(); g.arc(x - cr * 0.2, y - cr * 0.2, cr * 0.7, 0, Math.PI * 2); g.fill();
      }
      // a bright rayed crater low on the face
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(o - r * 0.12, o + r * 0.6, r * 0.05, 0, Math.PI * 2); g.fill();
      g.restore();
      // the shadow: the unlit part taken away, in a few slightly different shapes for a soft terminator
      const N = 48;
      g.save(); g.globalCompositeOperation = 'destination-out';
      [[0, 1], [0.04, 0.35], [0.08, 0.25], [0.13, 0.15]].forEach(([dk, a]) => {
        const kk = Math.max(-1, Math.min(1, k + dk));
        g.globalAlpha = a; g.beginPath();
        for (let i = 0; i <= N; i++) { const t = -Math.PI / 2 + Math.PI * i / N; const x = o - side * (r + 1) * Math.cos(t), y = o + (r + 1) * Math.sin(t); i ? g.lineTo(x, y) : g.moveTo(x, y); }
        for (let i = N; i >= 0; i--) { const t = -Math.PI / 2 + Math.PI * i / N; g.lineTo(o + side * kk * r * Math.cos(t), o + r * Math.sin(t)); }
        g.closePath(); g.fill();
      });
      g.restore();
      // earthshine behind
      g.save(); g.globalCompositeOperation = 'destination-over';
      g.fillStyle = 'rgba(120,135,170,0.16)'; g.beginPath(); g.arc(o, o, r, 0, Math.PI * 2); g.fill();
      g.restore();
      this._saverMoonC = { key, c, D };
    }
    const m = this._saverMoonC;
    if (glow > 0) {
      const gr = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 6);
      gr.addColorStop(0, 'rgba(210,222,255,' + (0.22 * (0.25 + lit) * glow).toFixed(3) + ')');
      gr.addColorStop(0.3, 'rgba(200,214,255,' + (0.07 * (0.25 + lit) * glow).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(200,214,255,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r * 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.drawImage(m.c, cx - m.D / 2, cy - m.D / 2, m.D, m.D);
  },

  // ── Night Sky: thousands of twinkling stars, the Milky Way flowing slowly up from the bottom left to the
  //    top right (and endlessly replenishing), hills and trees, the odd shooting star and tonight's moon ──
  _saverNightSky(stage) {
    const box = document.createElement('div');
    box.className = 'cs-night';
    stage.appendChild(box);
    const SPR = this._saverStarSprites();
    let B = null, shoot = null, nextShoot = 5 + Math.random() * 8;
    const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
    const build = (W, H, S) => {
      // the stars across the sky
      const stars = [];
      const n = Math.min(Math.round(W * H / 300), 2600);
      for (let i = 0; i < n; i++) {
        const r = Math.random(), tier = r < 0.035 ? 2 : r < 0.3 ? 1 : 0;
        stars.push({ x: Math.random() * W, y: Math.random() * H * 0.95, tier, size: tier === 2 ? 7 + Math.random() * 9 : tier === 1 ? 0.7 + Math.random() * 0.6 : 0.35 + Math.random() * 0.4,
          al: tier === 2 ? 0.75 + Math.random() * 0.25 : tier === 1 ? 0.5 + Math.random() * 0.35 : 0.22 + Math.random() * 0.3,
          tw: 0.5 + Math.random() * 2.5, ph: Math.random() * 6.3, spr: Math.random() < 0.2 ? 1 : Math.random() < 0.35 ? 2 : 0 });
      }
      // the Milky Way, laid out along its own length (u) and across it (v). It repeats every L, so as it
      // flows toward the top right, what leaves at the top comes back in at the bottom left without a join.
      const ang = -0.62, cx = W * 0.5, cy = H * 0.44;
      const L = Math.ceil(Math.hypot(W, H) * 1.25), BH = Math.ceil(H * 0.6);
      const dust = [];
      for (let i = 0; i < Math.min(W * 4.5, 5200); i++) {
        const u = Math.random() * L;
        dust.push({ u, v: gauss() * H * 0.07 * (1 + 0.45 * Math.sin(u / L * Math.PI * 2 * 3)), s: 0.3 + Math.random() * 0.55, al: 0.18 + Math.random() * 0.45 });
      }
      // a few brighter knots of stars in it
      for (let k = 0; k < 7; k++) {
        const u0 = Math.random() * L, v0 = gauss() * H * 0.03;
        for (let i = 0; i < 70; i++) dust.push({ u: (u0 + gauss() * W * 0.05 + L) % L, v: v0 + gauss() * H * 0.025, s: 0.3 + Math.random() * 0.5, al: 0.25 + Math.random() * 0.5 });
      }
      // its glow and dark dust lanes, drawn once at half size (they're soft), on a strip that wraps round
      const GS = 0.5, glow = document.createElement('canvas');
      glow.width = Math.ceil(L * GS); glow.height = Math.ceil(BH * GS);
      const g = glow.getContext('2d');
      g.setTransform(GS, 0, 0, GS, 0, BH * GS / 2);   // CSS pixels; v = 0 along the middle of the strip
      const blob = (u, v, rr, col) => {
        [u - L, u, u + L].forEach(x => {
          if (x + rr < 0 || x - rr > L) return;
          const gr = g.createRadialGradient(x, v, 0, x, v, rr);
          gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x, v, rr, 0, Math.PI * 2); g.fill();
        });
      };
      for (let i = 0; i < 190; i++) blob(Math.random() * L, gauss() * H * 0.06, W * (0.05 + Math.random() * 0.12), Math.random() < 0.3 ? 'rgba(235,205,215,0.05)' : 'rgba(170,185,240,0.055)');
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 80; i++) blob(Math.random() * L, gauss() * H * 0.018 + H * 0.008, W * (0.015 + Math.random() * 0.04), 'rgba(0,0,0,0.35)');
      // the land: a glow along the horizon, distant hills in the haze, and a nearer ridge with trees
      const [land, l] = this._saverOff(W, H, S);
      const hg = l.createLinearGradient(0, H * 0.55, 0, H * 0.9);
      hg.addColorStop(0, 'rgba(70,90,150,0)'); hg.addColorStop(0.7, 'rgba(80,95,150,0.16)'); hg.addColorStop(0.9, 'rgba(255,170,110,0.07)'); hg.addColorStop(1, 'rgba(255,170,110,0)');
      l.fillStyle = hg; l.fillRect(0, H * 0.55, W, H * 0.35);
      const ridge = (base, amp, fr, top, bottom, trees) => {
        const p1 = Math.random() * 6, p2 = Math.random() * 6, p3 = Math.random() * 6;
        const yAt = x => H * (base - amp * (0.55 * Math.sin(x / W * Math.PI * fr + p1) + 0.3 * Math.sin(x / W * Math.PI * fr * 2.3 + p2) + 0.15 * Math.sin(x / W * Math.PI * fr * 6.1 + p3)));
        const gr = l.createLinearGradient(0, H * (base - amp), 0, H);
        gr.addColorStop(0, top); gr.addColorStop(1, bottom);
        l.fillStyle = gr; l.beginPath(); l.moveTo(0, H);
        for (let x = 0; x <= W; x += 2) l.lineTo(x, yAt(x));
        l.lineTo(W, H); l.closePath(); l.fill();
        if (!trees) return;
        l.fillStyle = bottom;
        let x = -10;
        while (x < W + 10) {
          if (Math.random() < 0.55) {
            const n = 2 + Math.floor(Math.random() * 7);
            for (let i = 0; i < n; i++) {
              const tx = x + Math.random() * 14, th = H * (0.03 + Math.random() * 0.05), tw = th * (0.28 + Math.random() * 0.12), ty = yAt(tx) + 2;
              l.beginPath(); l.moveTo(tx, ty - th);
              for (let j = 1; j <= 4; j++) { const yy = ty - th + th * j / 4; l.lineTo(tx + tw * j / 4 * 1.1, yy); l.lineTo(tx + tw * j / 4 * 0.55, yy); }
              l.lineTo(tx + tw * 0.08, ty); l.lineTo(tx - tw * 0.08, ty);
              for (let j = 4; j >= 1; j--) { const yy = ty - th + th * j / 4; l.lineTo(tx - tw * j / 4 * 0.55, yy); l.lineTo(tx - tw * j / 4 * 1.1, yy); }
              l.closePath(); l.fill();
              x += 4 + Math.random() * 7;
            }
          }
          x += 10 + Math.random() * 40;
        }
      };
      ridge(0.8, 0.05, 1.4, '#141c36', '#0b1124', false);
      ridge(0.87, 0.045, 2.2, '#080c19', '#05070f', false);
      ridge(0.93, 0.03, 3.1, '#030409', '#020306', true);
      B = { stars, dust, glow, GS, L, BH, ang, cx, cy, land };
    };
    this._saverCanvasLoop(box, (ctx, t, dt, W, H, resized, S) => {
      if (resized || !B) build(W, H, S);
      const { L, BH, ang, cx, cy } = B;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#010208'); sky.addColorStop(0.45, '#040719'); sky.addColorStop(0.75, '#0a1230'); sky.addColorStop(1, '#141d40');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      // the Milky Way flowing up toward the top right: across the panel in about four minutes
      const off = (t * W / 240) % L;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      for (const k of [-1, 0]) ctx.drawImage(B.glow, -L / 2 + off + k * L, -BH / 2, L, BH);
      ctx.fillStyle = '#dfe6ff';
      for (const s of B.dust) {
        const u = ((s.u + off) % L) - L / 2;
        ctx.globalAlpha = s.al; ctx.fillRect(u, s.v, s.s, s.s);
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#dfe6ff';
      for (const s of B.stars) {
        const tw = 0.7 + 0.3 * Math.sin(t * s.tw + s.ph) + 0.1 * Math.sin(t * s.tw * 2.7 + s.ph);
        if (s.tier === 2) {
          const z = s.size * (0.9 + 0.1 * tw);
          ctx.globalAlpha = s.al * tw; ctx.drawImage(SPR[s.spr], s.x - z / 2, s.y - z / 2, z, z);
          if (s.size > 12) { ctx.globalAlpha = s.al * tw * 0.25; ctx.fillStyle = '#fff'; ctx.fillRect(s.x - z * 0.55, s.y - 0.25, z * 1.1, 0.5); ctx.fillRect(s.x - 0.25, s.y - z * 0.55, 0.5, z * 1.1); ctx.fillStyle = '#dfe6ff'; }
        } else {
          ctx.globalAlpha = s.al * tw; ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
        }
      }
      ctx.globalAlpha = 1;
      // a shooting star now and then
      nextShoot -= dt;
      if (!shoot && nextShoot <= 0) {
        const a = 0.3 + Math.random() * 0.6;
        shoot = { x: W * (0.25 + Math.random() * 0.7), y: H * (0.04 + Math.random() * 0.3), vx: -Math.cos(a) * W * 0.8, vy: Math.sin(a) * W * 0.8, life: 0, dur: 0.6 + Math.random() * 0.6 };
        nextShoot = 15 + Math.random() * 40;
      }
      if (shoot) {
        shoot.life += dt;
        const k = shoot.life / shoot.dur;
        if (k >= 1) shoot = null;
        else {
          const hx = shoot.x + shoot.vx * shoot.life, hy = shoot.y + shoot.vy * shoot.life;
          const tl = 0.16, tx = hx - shoot.vx * tl, ty = hy - shoot.vy * tl;
          const al = Math.sin(k * Math.PI);
          const gr = ctx.createLinearGradient(hx, hy, tx, ty);
          gr.addColorStop(0, 'rgba(255,255,255,' + al.toFixed(2) + ')'); gr.addColorStop(0.3, 'rgba(200,220,255,' + (al * 0.4).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(200,220,255,0)');
          ctx.strokeStyle = gr; ctx.lineCap = 'round';
          ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.globalAlpha = al; ctx.drawImage(SPR[0], hx - 5, hy - 5, 10, 10); ctx.globalAlpha = 1;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      const mr = Math.max(11, Math.min(W, H) * 0.06);
      this._saverMoon(ctx, W - mr * 2.6, mr * 2.8, mr, S);
      ctx.drawImage(B.land, 0, 0, W, H);
      this._saverGrain(ctx, W, H, 0.03);
    });
  },

  // ── Word Clock: the time spelled out in a grid of letters, to the nearest five minutes, with a dot for each minute in between ──
  _saverWordClock(stage) {
    const ROWS = ['ITLISASTIME', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'];
    const W = { it: [0, 0, 2], is: [0, 3, 2], a: [1, 0, 1], quarter: [1, 2, 7], twenty: [2, 0, 6], fivem: [2, 6, 4], half: [3, 0, 4], tenm: [3, 5, 3], to: [3, 9, 2], past: [4, 0, 4],
      h9: [4, 7, 4], h1: [5, 0, 3], h6: [5, 3, 3], h3: [5, 6, 5], h4: [6, 0, 4], h5: [6, 4, 4], h2: [6, 8, 3], h8: [7, 0, 5], h11: [7, 5, 6], h7: [8, 0, 5], h12: [8, 5, 6], h10: [9, 0, 3], oclock: [9, 5, 6] };
    const box = document.createElement('div');
    box.className = 'cs-wordbg';
    const grid = document.createElement('div');
    grid.className = 'cs-word';
    grid.innerHTML = ROWS.map(r => '<div class="r">' + [...r].map(c => '<span>' + c + '</span>').join('') + '</div>').join('')
      ;
    const v = document.createElement('div'); v.className = 'cs-vignette';
    box.appendChild(grid);
    stage.appendChild(box); stage.appendChild(v);
    const cells = [...grid.querySelectorAll('.r')].map(r => [...r.children]);
    // the accent follows the album's colour when there is one, otherwise a warm white
    const tint = () => {
      const h = this._saverArtHues?.();
      grid.style.setProperty('--cs-wc', h ? 'hsl(' + Math.round(h[0]) + ', 70%, 82%)' : '#fff6e6');
    };
    let lastKey = '';
    const draw = () => {
      if (!grid.isConnected) { clearInterval(this._saverFxT); return; }
      const now = new Date(), m = now.getMinutes();
      let h = now.getHours();
      const m5 = Math.floor(m / 5) * 5;
      const words = ['it', 'is'];
      if (m5 > 30) h++;
      const hw = 'h' + (((h % 12) + 11) % 12 + 1);
      ({ 0: ['oclock'], 5: ['fivem', 'past'], 10: ['tenm', 'past'], 15: ['a', 'quarter', 'past'], 20: ['twenty', 'past'], 25: ['twenty', 'fivem', 'past'], 30: ['half', 'past'],
        35: ['twenty', 'fivem', 'to'], 40: ['twenty', 'to'], 45: ['a', 'quarter', 'to'], 50: ['tenm', 'to'], 55: ['fivem', 'to'] })[m5].forEach(w => words.push(w));
      words.push(hw);
      const key = words.join();
      if (key === lastKey) return;
      lastKey = key;
      tint();
      const on = new Set();
      words.forEach(w => { const [r, s, l] = W[w]; for (let i = 0; i < l; i++) on.add(r * 11 + s + i); });
      cells.forEach((row, r) => row.forEach((c, i) => c.classList.toggle('on', on.has(r * 11 + i))));
      // a small drift each minute, so nothing sits still on the screen for hours
      grid.style.transform = 'translate(calc(-50% + ' + (Math.random() * 6 - 3).toFixed(1) + '%), calc(-50% + ' + (Math.random() * 6 - 3).toFixed(1) + '%))';
    };
    const fit = () => {
      const el = this._saverEl;
      if (!el || !grid.isConnected) return;
      const s = Math.min(el.offsetWidth / 11, el.offsetHeight / 10.4) * 0.74;
      grid.style.setProperty('--cs-wf', Math.max(9, s).toFixed(1) + 'px');
    };
    fit(); draw();
    requestAnimationFrame(fit);
    this._saverFxT = setInterval(() => { fit(); draw(); }, 2000);
  },

  // ── Fireplace: flames licking up in the dark, with sparks rising ──
  _saverFireplace(stage) {
    const box = document.createElement('div');
    box.className = 'cs-firebg';
    stage.appendChild(box);
    // the flames are hundreds of soft glowing wisps, drawn on top of each other so the fire builds up
    // white-hot at the base and cools through yellow and orange to red at the tips
    const SPR = [[255, 252, 230], [255, 236, 160], [255, 208, 100], [255, 172, 60], [252, 132, 36], [238, 96, 24], [205, 62, 14], [150, 38, 8]].map(c => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(' + c + ',0.9)'); gr.addColorStop(0.3, 'rgba(' + c + ',0.5)'); gr.addColorStop(0.65, 'rgba(' + c + ',0.12)'); gr.addColorStop(1, 'rgba(' + c + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return cv;
    });
    let B = null, flames = [], sparks = [];
    // the fire's width (fw) and scale (M): over the square artwork these are 0.86 of the width and the height,
    // as before; full screen keeps them in proportion to each other
    const dimsOf = (W, H) => ({ fw: Math.min(W * 0.86, H * 1.3), M: Math.min(H, W * 1.15) });
    const build = (W, H, S) => {
      const { fw, M } = dimsOf(W, H);
      // where flames start: along the bottom, most in the middle
      const emit = [];
      for (let x = W / 2 - fw / 2; x <= W / 2 + fw / 2; x += 2) { const c = 1 - Math.abs(x - W / 2) / (fw / 2); if (c > 0) emit.push({ x, y: H - M * (0.015 + 0.09 * Math.pow(c, 1.4)), c: Math.min(1, c * 1.4), front: false }); }
      B = { emit, fw, M };
      flames = []; sparks = [];
    };
    const drawFlames = (ctx, front, mult = 1) => {
      for (const p of flames) {
        if (p.front !== front) continue;
        const k = p.life / p.max;
        const sz = p.s * (k < 0.15 ? 0.55 + k / 0.15 * 0.45 : 1 - (k - 0.15) * 0.85);
        const ci = Math.min(7, Math.floor(k * 7.5 + p.heat));
        const a = (k < 0.08 ? k / 0.08 : 1) * Math.pow(1 - k, 1.25) * p.a;
        if (a < 0.01 || sz < 1) continue;
        ctx.globalAlpha = a * mult;
        ctx.drawImage(SPR[ci], p.x - sz / 2, p.y - sz * 0.95, sz, sz * 1.7);
      }
      ctx.globalAlpha = 1;
    };
    this._saverCanvasLoop(box, (ctx, t, dt, W, H, resized, S) => {
      if (resized || !B) build(W, H, S);
      const flick = 0.82 + 0.1 * Math.sin(t * 7.1) * Math.sin(t * 2.9) + 0.08 * Math.sin(t * 13.7 + Math.sin(t * 3));
      // new flames: more where the fire is strongest, gathering into tongues that wander along the logs
      const want = 720 * dt;
      for (let i = 0; i < Math.floor(want) + (Math.random() < want % 1 ? 1 : 0); i++) {
        const e = B.emit[(Math.random() * B.emit.length) | 0];
        if (!e) break;
        const tongue = 0.45 + 0.55 * Math.max(0, Math.sin(e.x * 0.045 + t * 1.6) * 0.6 + Math.sin(e.x * 0.11 - t * 2.3) * 0.4 + 0.3);
        if (Math.random() > e.c * tongue) continue;
        flames.push({ x: e.x + (Math.random() - 0.5) * 6, y: e.y + 3 + Math.random() * 3, vx: (Math.random() - 0.5) * 12, vy: -B.M * (0.17 + Math.random() * 0.22) * (0.7 + e.c * 0.5),
          life: 0, max: (0.45 + Math.random() * 0.75) * (0.55 + e.c * 0.6) * (0.7 + tongue * 0.5), s: B.M * (0.06 + Math.random() * 0.06) * (0.7 + e.c * 0.5),
          a: 0.38 + Math.random() * 0.3, heat: Math.random() * 0.6, ph: Math.random() * 6.3, front: e.front });
      }
      flames = flames.filter(p => {
        p.life += dt;
        if (p.life >= p.max) return false;
        p.x += (p.vx + Math.sin(t * 4.2 + p.ph + p.y * 0.05) * B.M * 0.035) * dt;
        p.y += p.vy * dt; p.vy *= 1 + dt * 0.5;
        p.x += (W / 2 - p.x) * dt * 0.06;
        return true;
      });
      // darkness, warmed by the fire and breathing with it
      ctx.fillStyle = '#040201'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const warm = ctx.createRadialGradient(W / 2, H * 0.8, 0, W / 2, H * 0.8, Math.max(W, H) * (0.7 + 0.05 * flick));
      warm.addColorStop(0, 'rgba(150,50,10,' + (0.55 * flick).toFixed(3) + ')'); warm.addColorStop(0.45, 'rgba(70,20,5,' + (0.35 * flick).toFixed(3) + ')'); warm.addColorStop(1, 'rgba(20,5,0,0)');
      ctx.fillStyle = warm; ctx.fillRect(0, 0, W, H);
      // the flames
      drawFlames(ctx, false);
      // the bright glow at the base of the fire
      ctx.globalCompositeOperation = 'lighter';
      const cg = ctx.createRadialGradient(W / 2, H - B.M * 0.06, 0, W / 2, H - B.M * 0.06, B.fw * 0.44);
      cg.addColorStop(0, 'rgba(255,100,20,' + (0.28 * flick).toFixed(3) + ')'); cg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
      // sparks rising and fading
      const sk = this._saverEl?.classList.contains('cs-full') ? Math.max(1, B.M / 380) : 1;
      if (sparks.length < 30 && Math.random() < dt * 5) sparks.push({ x: W / 2 + B.fw * (Math.random() - 0.5) * 0.42, y: H - B.M * 0.28, vx: (Math.random() - 0.5) * 20 * sk, vy: -(40 + Math.random() * 70) * sk, life: 0, max: 1 + Math.random() * 2.2, r: (0.5 + Math.random() * 0.9) * sk, ph: Math.random() * 6 });
      sparks = sparks.filter(e => {
        e.life += dt;
        if (e.life > e.max) return false;
        e.x += (e.vx + Math.sin(t * 2.5 + e.ph) * 16) * dt; e.y += e.vy * dt; e.vy *= 0.993;
        const a = (1 - e.life / e.max) * (0.55 + 0.45 * Math.sin(t * 14 + e.ph));
        ctx.fillStyle = 'rgba(255,' + (160 + Math.round(70 * (1 - e.life / e.max))) + ',70,' + a.toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.globalCompositeOperation = 'source-over';
      this._saverGrain(ctx, W, H, 0.025);
    });
  },

  // ── Ocean: a rippling sea in perspective under a sky that follows Home Assistant's sun — dawn pink,
  //    midday blue, dusk orange, deep blue at night — with the sun or moon's path of light on the water,
  //    and clouds from the screensaver's weather entity ──
  _saverOcean(stage) {
    const box = document.createElement('div');
    box.className = 'cs-oceanbg';
    stage.appendChild(box);
    const SPR = this._saverStarSprites();
    // sky top, sky middle, horizon, far sea, near sea, sun, cloud lit, cloud shade
    const P = {
      night: ['#01030c', '#06102c', '#16264e', '#0c1a3a', '#01040b', '#eef2ff', '#3c4a74', '#0b1226'],
      dawn:  ['#1b2152', '#6d5c92', '#f8b8a2', '#7c6f98', '#121833', '#ffe6c8', '#ffcdb8', '#5c4c7c'],
      dusk:  ['#160f3a', '#73396c', '#ff9654', '#8b5262', '#140c1f', '#ffc06a', '#ffb877', '#5a2f52'],
      day:   ['#1b5fb8', '#5a9bdc', '#f0dcc0', '#3d86c1', '#08355f', '#ffd98e', '#fff3e2', '#b8b8c8'],
    };
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, k) => a.map((v, i) => hex(v).map((c, j) => Math.round(c + (hex(b[i])[j] - c) * k)));
    const rgb = (c, a = 1) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    const sun = () => {
      const s = this._hass?.states?.['sun.sun']?.attributes;
      if (s && typeof s.elevation === 'number') return { el: s.elevation, rising: !!s.rising };
      const now = new Date(), hr = now.getHours() + now.getMinutes() / 60;
      return { el: 50 * Math.sin((hr - 6) / 12 * Math.PI), rising: hr < 12 };
    };
    const palette = () => {
      const { el, rising } = sun();
      const tw = rising ? P.dawn : P.dusk;
      let c, dark = 0;
      if (el <= -10) { c = mix(P.night, P.night, 0); dark = 1; }
      else if (el < 0) { c = mix(P.night, tw, (el + 10) / 10); dark = -el / 10; }
      else if (el < 14) c = mix(tw, P.day, el / 14);
      else c = mix(P.day, P.day, 0);
      // how cloudy: from the weather entity chosen for the screensaver, a few wisps otherwise
      const w = this._hass?.states?.[(this._config?.screensaver_weather || '').trim()]?.state || '';
      const cloud = ({ sunny: 0.15, 'clear-night': 0.1, partlycloudy: 0.5, cloudy: 0.85, fog: 0.9, rainy: 0.9, pouring: 1, snowy: 0.9, 'snowy-rainy': 0.9, lightning: 1, 'lightning-rainy': 1, hail: 1, windy: 0.45, 'windy-variant': 0.6 })[w] ?? 0.35;
      return { c, el, rising, dark, cloud };
    };
    let pal = palette(), palAt = -99, B = null;
    // the water's ripples: one tile, worked out once, that repeats seamlessly; light on the crests, shade in the troughs
    const TW = 256, TH = 128;
    const tex = (() => {
      const comps = Array.from({ length: 16 }, (_, i) => ({ kx: Math.round((Math.random() - 0.5) * (i < 4 ? 4 : i < 10 ? 10 : 18)), ky: (i < 4 ? 3 : i < 10 ? 6 : 12) + Math.floor(Math.random() * (i < 4 ? 4 : i < 10 ? 10 : 16)), a: i < 4 ? 1 : i < 10 ? 0.5 : 0.25, p: Math.random() * 6.3 }));
      const hv = new Float32Array(TW * TH);
      let mx = 0;
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        let v = 0;
        for (const c of comps) v += c.a * Math.sin(Math.PI * 2 * (c.kx * x / TW + c.ky * y / TH) + c.p);
        hv[y * TW + x] = v; mx = Math.max(mx, Math.abs(v));
      }
      const mk = (fn) => {
        const c = document.createElement('canvas'); c.width = TW; c.height = TH;
        const g = c.getContext('2d'), im = g.createImageData(TW, TH), d = im.data;
        for (let i = 0; i < hv.length; i++) {
          // the slope toward the viewer catches the light, so take the change from the row behind
          const y = (i / TW) | 0, x = i % TW, up = hv[((y + TH - 1) % TH) * TW + x];
          const [r, gg, b, a] = fn(hv[i] / mx, (hv[i] - up) / mx * 6);
          d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
        }
        g.putImageData(im, 0, 0);
        return c;
      };
      const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      return {
        hi: mk((v, s) => [255, 255, 255, Math.round(255 * Math.min(1, ss(0.4, 1, v) * 0.55 + ss(0.3, 1, -s) * 0.8))]),
        lo: mk((v, s) => [0, 8, 24, Math.round(255 * Math.min(1, ss(0.1, 0.95, -v) * 0.7 + ss(0.2, 0.9, s) * 0.35))]),
      };
    })();
    const build = (W, H, S, hy) => {
      // rows of water from the horizon down: thin far away, thicker close up
      const rows = [];
      let y = hy;
      while (y < H) { const d = (y - hy) / (H - hy); const ny = Math.min(H, Math.round((y + 0.6 + d * 1.9) * S) / S); if (ny <= y) { y += 1 / S; continue; } rows.push([y, ny - y]); y = ny; }
      // clouds: soft banks low in the sky
      const clouds = Array.from({ length: 7 }, (_, i) => ({ x: Math.random() * W * 1.4 - W * 0.2, y: hy * (0.15 + Math.random() * 0.6), w: W * (0.45 + Math.random() * 0.5),
        puffs: Array.from({ length: 10 }, () => ({ dx: (Math.random() - 0.5) * 0.9, dy: (Math.random() - 0.5) * 0.25, r: 0.22 + Math.random() * 0.24 })), sp: 1.5 + Math.random() * 3, rank: i / 9 }));
      const stars = Array.from({ length: Math.round(W * hy / 450) }, () => ({ x: Math.random() * W, y: Math.random() * hy * 0.92, s: Math.random() < 0.06 ? 5 + Math.random() * 5 : 0.4 + Math.random() * 0.7, ph: Math.random() * 6, tw: 0.6 + Math.random() * 2 }));
      B = { rows, clouds, stars, hiP: null, loP: null };
    };
    // ── Life on the ocean: one thing at a time, now and then — dolphins leaping (alone or in a pod),
    //    seabirds gliding over, or a whale far out ──
    const life = { ev: null, bird: null, next: 2 + Math.random() * 3, nextBird: 3 + Math.random() * 3, splashes: [], caps: [], force: null };
    this._saverOceanLife = life;
    const rr = (a, b) => a + Math.random() * (b - a);
    const startEvent = (W, H, hy) => {
      const pick = [['dolphins', 0.7], ['whale', 0.3]];
      let r = Math.random() * pick.reduce((s, p) => s + p[1], 0), kind = 'dolphins';
      for (const [k, w] of pick) { if ((r -= w) <= 0) { kind = k; break; } }
      if (life.force) { kind = life.force; life.force = null; }
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (kind === 'dolphins') {
        const n = Math.random() < 0.4 ? 1 : 3 + Math.floor(Math.random() * 4);
        const d = rr(0.2, 0.4), len = W * 0.05 * (d / 0.35);
        const yW = hy + (H - hy) * d, speed = len * rr(1.6, 2.2) * dir;
        const x0 = dir > 0 ? rr(-0.05, 0.3) * W : rr(0.7, 1.05) * W;
        const pod = Array.from({ length: n }, (_, i) => {
          const leaps = [];
          let tt = i * rr(0.15, 0.6);
          const k = 2 + Math.floor(Math.random() * 3);
          for (let j = 0; j < k; j++) { const ld = rr(0.85, 1.15); leaps.push([tt, ld]); tt += ld + rr(1.1, 2.2); }
          return { dx: (i ? (Math.random() - 0.5) * len * 3 : 0) - i * len * 0.4 * dir, dy: (Math.random() - 0.5) * (H - hy) * 0.03, sc: rr(0.85, 1.1), leaps, end: tt };
        });
        return { kind, d, len, yW, speed, x0, pod, t: 0, dur: Math.max(...pod.map(p => p.end)) + 1.5, dir };
      }
      if (kind === 'birds') {
        const sc = W / 400 * 1.25;   // bird size, in step with the screen
        const x0 = dir > 0 ? -70 * sc : W + 70 * sc;
        if (Math.random() < 0.3) {
          // a distant flock: lots of tiny birds moving together, the group slowly changing shape
          const n = 15 + Math.floor(Math.random() * 16), R = W * rr(0.05, 0.08);
          return { kind, style: 'flock', dir, t: 0, x: x0, y: hy * rr(0.45, 0.8), vx: W * rr(0.035, 0.05) * dir, R,
            birds: Array.from({ length: n }, () => ({ a: Math.random() * 6.3, r: Math.sqrt(Math.random()), f1: rr(0.15, 0.35), f2: rr(0.1, 0.3), p1: Math.random() * 6.3, p2: Math.random() * 6.3, flapPh: Math.random() * 6, flapSpd: rr(0.13, 0.19), size: rr(1.2, 1.6) * sc })) };
        }
        const depth = 0.75 + Math.random() * 0.5, speed = (0.7 + Math.random() * 0.55) * dir * depth * 30 * sc;
        const startY = hy * (0.42 + Math.random() * 0.42);
        const count = 1 + Math.floor(Math.random() * 10), formation = Math.floor(Math.random() * 3);
        const birds = Array.from({ length: count }, (_, i) => {
          let offX = 0, offY = 0;
          if (count > 1) {
            if (formation === 0) { const row = Math.floor((i + 1) / 2), side = i % 2 === 0 ? 1 : -1; offX = -15 * row * dir; offY = 8 * row * side; }
            else if (formation === 1) { offX = -18 * i * dir; offY = 10 * i * (Math.random() > 0.5 ? 1 : -1); }
            else { offX = (Math.random() - 0.5) * 60 * dir; offY = (Math.random() - 0.5) * 45; }
          }
          return { x: x0 + offX * depth * sc, y: startY + offY * depth * sc, vx: speed, vy: (Math.random() - 0.5) * 0.06 * 30 * sc, flapPh: i + Math.random() * 2, flapSpd: 0.13 + Math.random() * 0.06, size: (2.0 + Math.random() * 0.7) * depth * sc };
        });
        return { kind, style: 'v', dir, t: 0, birds };
      }
      return { kind: 'whale', x: rr(0.2, 0.8) * W, d: rr(0.08, 0.15), t: 0, dur: 11, dir };
    };
    const seaY = (H, hy, d) => hy + (H - hy) * d;
    // a splash: droplets thrown up and a ring of ripples spreading
    const splash = (x, y, size) => {
      const drops = Array.from({ length: 10 }, () => ({ x, y, vx: (Math.random() - 0.5) * size * 3, vy: -rr(1.5, 3.5) * size, r: rr(0.35, 0.7) * Math.max(0.45, size * 0.05) }));
      life.splashes.push({ x, y, size, t: 0, drops });
    };
    const drawSplashes = (ctx, dt, lightC) => {
      life.splashes = life.splashes.filter(s => {
        s.t += dt;
        if (s.t > 2.2) return false;
        const k = s.t / 2.2;
        ctx.strokeStyle = rgb(lightC, (0.4 * (1 - k)).toFixed(3)); ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, s.size * (0.4 + k * 2.2), s.size * (0.08 + k * 0.35), 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = rgb(lightC, Math.max(0, 0.85 - k * 2).toFixed(3));
        for (const p of s.drops) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += s.size * 9 * dt; if (p.y < s.y) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); } }
        return true;
      });
    };
    // a dolphin, side on, facing +x, nose at +len/2
    const dolphin = (ctx, len, light) => {
      const L = len;
      const top = [Math.round(40 * light + 8), Math.round(52 * light + 10), Math.round(64 * light + 14)];
      const belly = [Math.round(150 * light + 20), Math.round(160 * light + 22), Math.round(168 * light + 26)];
      const g = ctx.createLinearGradient(0, -L * 0.12, 0, L * 0.09);
      g.addColorStop(0, rgb(top)); g.addColorStop(0.55, rgb(top.map((c, i) => Math.round(c * 0.6 + belly[i] * 0.4)))); g.addColorStop(1, rgb(belly));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0.5 * L, 0.012 * L);
      ctx.quadraticCurveTo(0.44 * L, -0.02 * L, 0.36 * L, -0.05 * L);
      ctx.quadraticCurveTo(0.31 * L, -0.1 * L, 0.2 * L, -0.11 * L);
      ctx.bezierCurveTo(0.02 * L, -0.13 * L, -0.22 * L, -0.09 * L, -0.38 * L, -0.03 * L);
      ctx.lineTo(-0.45 * L, -0.012 * L);
      ctx.quadraticCurveTo(-0.5 * L, -0.06 * L, -0.57 * L, -0.085 * L);
      ctx.quadraticCurveTo(-0.53 * L, -0.02 * L, -0.55 * L, 0.0);
      ctx.quadraticCurveTo(-0.53 * L, 0.02 * L, -0.57 * L, 0.085 * L);
      ctx.quadraticCurveTo(-0.5 * L, 0.06 * L, -0.45 * L, 0.012 * L);
      ctx.bezierCurveTo(-0.22 * L, 0.07 * L, 0.05 * L, 0.095 * L, 0.26 * L, 0.06 * L);
      ctx.quadraticCurveTo(0.4 * L, 0.04 * L, 0.5 * L, 0.012 * L);
      ctx.closePath(); ctx.fill();
      // dorsal fin and flipper
      ctx.fillStyle = rgb(top);
      ctx.beginPath(); ctx.moveTo(0.06 * L, -0.115 * L); ctx.quadraticCurveTo(-0.02 * L, -0.2 * L, -0.12 * L, -0.235 * L); ctx.quadraticCurveTo(-0.08 * L, -0.16 * L, -0.12 * L, -0.105 * L); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.22 * L, 0.05 * L); ctx.quadraticCurveTo(0.14 * L, 0.12 * L, 0.08 * L, 0.15 * L); ctx.quadraticCurveTo(0.12 * L, 0.08 * L, 0.12 * L, 0.06 * L); ctx.closePath(); ctx.fill();
      if (L < 18) return;
      // a wet highlight along the back
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * light).toFixed(2) + ')'; ctx.lineWidth = Math.max(0.5, L * 0.012);
      ctx.beginPath(); ctx.moveTo(0.32 * L, -0.075 * L); ctx.bezierCurveTo(0.15 * L, -0.11 * L, -0.1 * L, -0.1 * L, -0.3 * L, -0.05 * L); ctx.stroke();
      // eye
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(0.36 * L, -0.025 * L, Math.max(0.35, L * 0.008), 0, Math.PI * 2); ctx.fill();
    };
    const lifeDraw = (ctx, t, dt, W, H, S, hy, day, sunC, hor, bx) => {
      // the main visitors (dolphins or a whale) one at a time; seabirds come and go on their own
      life.next -= dt; life.nextBird -= dt;
      if (!life.ev && life.next <= 0) life.ev = startEvent(W, H, hy);
      if (!life.bird && life.nextBird <= 0 && pal.dark < 0.6) { life.force = 'birds'; life.bird = startEvent(W, H, hy); }
      const lightC = day ? [255, 255, 255] : [200, 210, 235];
      for (const e of [life.ev, life.bird]) {
        if (!e) continue;
        e.t += dt;
        if (e.kind === 'dolphins') {
          const light = day ? 1 : 0.4;
          for (const p of e.pod) {
            const wy = e.yW + p.dy;
            for (const [st, ld] of p.leaps) {
              const lt = e.t - st;
              const x = e.x0 + p.dx + e.speed * (e.t);
              if (lt >= 0 && lt <= ld) {
                const q = lt / ld, L = e.len * p.sc;
                if (!p['s' + st]) { p['s' + st] = 1; splash(x - L * 0.3 * e.dir, wy, L * 0.35); }
                if (q > 0.88 && !p['e' + st]) { p['e' + st] = 1; splash(x + L * 0.25 * e.dir, wy, L * 0.4); }
                const hgt = Math.sin(Math.PI * q) * L * 0.75, ang = -Math.cos(Math.PI * q) * 0.75;
                ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, wy + 0.5); ctx.clip();
                ctx.translate(x, wy - hgt + L * 0.12); ctx.scale(e.dir, 1); ctx.rotate(ang);
                dolphin(ctx, L, light);
                ctx.restore();
              }
            }
          }
          if (e.t >= e.dur) e.done = true;
        } else if (e.kind === 'birds') {
          // the birds: two strokes meeting at the body, wings beating in bursts
          ctx.strokeStyle = day ? 'rgba(40,45,52,0.80)' : 'rgba(200,210,220,0.65)'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          const step = dt * 30;   // the birds move a little each frame, paced for 30 frames a second
          const drawBird = (x, y, b, dir) => {
            b.flapPh += b.flapSpd * step;
            const env = Math.max(0, Math.sin(b.flapPh * 0.38)), wing = Math.sin(b.flapPh) * b.size * env;
            ctx.lineWidth = Math.max(0.8, b.size * 0.45);
            ctx.beginPath(); ctx.moveTo(x - b.size * dir, y + wing - b.size / 2.2); ctx.lineTo(x, y); ctx.lineTo(x - b.size * dir, y + wing + b.size / 2.2); ctx.stroke();
          };
          if (e.style === 'flock') {
            e.x += e.vx * dt;
            for (const b of e.birds) {
              // each bird wanders around its place in the flock, so the group keeps changing shape
              const a = b.a + Math.sin(t * b.f1 + b.p1) * 0.8, r = e.R * (0.35 + b.r * 0.65) * (0.8 + 0.3 * Math.sin(t * b.f2 + b.p2));
              drawBird(e.x + Math.cos(a) * r * 1.6, e.y + Math.sin(a) * r * 0.55, b, e.dir);
            }
            if ((e.dir > 0 && e.x - e.R * 2 > W) || (e.dir < 0 && e.x + e.R * 2 < 0)) e.done = true;
          } else {
            let gone = true;
            for (const b of e.birds) {
              b.x += b.vx * dt; b.y += b.vy * dt;
              drawBird(b.x, b.y, b, e.dir);
              if (!((e.dir > 0 && b.x > W + 80) || (e.dir < 0 && b.x < -80))) gone = false;
            }
            if (gone) e.done = true;
          }
          ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        } else if (e.kind === 'whale') {
          const y = seaY(H, hy, e.d), sz = W * 0.038 * (e.d / 0.12), light = day ? 1 : 0.45;
          // first a misty spout, then the back rolling over, then the tail lifting and slipping under
          if (e.t < 3.2) {
            const k = e.t / 3.2, h = sz * 1.1 * Math.min(1, k * 3);
            const g = ctx.createRadialGradient(e.x, y - h * 0.6, 0, e.x, y - h * 0.6, sz * 0.5 * (0.6 + k));
            g.addColorStop(0, rgb(lightC, (0.55 * (1 - k)).toFixed(3))); g.addColorStop(1, rgb(lightC, 0));
            ctx.fillStyle = g; ctx.save(); ctx.translate(e.x, y - h * 0.6); ctx.scale(0.7, 1.3); ctx.translate(-e.x, -(y - h * 0.6)); ctx.beginPath(); ctx.arc(e.x, y - h * 0.6, sz * 0.5 * (0.6 + k), 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
          const col = rgb([Math.round(30 * light + 6), Math.round(36 * light + 8), Math.round(44 * light + 10)]);
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, y + 0.3); ctx.clip(); ctx.fillStyle = col;
          if (e.t > 2 && e.t < 6) {
            const k = (e.t - 2) / 4, bxw = e.x + (k - 0.5) * sz * 1.2 * e.dir, hgt = Math.sin(Math.PI * k) * sz * 0.22;
            ctx.beginPath(); ctx.ellipse(bxw, y, sz * 0.8, hgt + 0.3, 0, Math.PI, 0); ctx.fill();
            if (k > 0.35 && k < 0.8) { ctx.beginPath(); ctx.moveTo(bxw - sz * 0.15 * e.dir, y - hgt); ctx.lineTo(bxw - sz * 0.25 * e.dir, y - hgt - sz * 0.1); ctx.lineTo(bxw - sz * 0.32 * e.dir, y - hgt + 1); ctx.closePath(); ctx.fill(); }
          }
          if (e.t > 6 && e.t < 10) {
            const k = (e.t - 6) / 4, lift = Math.sin(Math.PI * k) * sz * 0.75, fx = e.x + sz * 0.6 * e.dir;
            ctx.save(); ctx.translate(fx, y - lift); ctx.scale(e.dir, 1);
            ctx.beginPath(); ctx.moveTo(-sz * 0.05, sz * 0.4); ctx.lineTo(-sz * 0.04, 0); ctx.quadraticCurveTo(-sz * 0.25, -sz * 0.05, -sz * 0.45, -sz * 0.18); ctx.quadraticCurveTo(-sz * 0.2, sz * 0.02, 0, 0.02 * sz); ctx.quadraticCurveTo(sz * 0.2, sz * 0.02, sz * 0.45, -sz * 0.18); ctx.quadraticCurveTo(sz * 0.25, -sz * 0.05, sz * 0.04, 0); ctx.lineTo(sz * 0.05, sz * 0.4); ctx.closePath(); ctx.fill();
            // water streaming off it
            ctx.fillStyle = rgb(lightC, (0.5 * Math.sin(Math.PI * k)).toFixed(3));
            for (let i = 0; i < 6; i++) ctx.fillRect(-sz * 0.4 + i * sz * 0.16, -sz * 0.12 + ((t * 40 + i * 13) % (lift + 1)), 0.6, 1.2);
            ctx.restore();
            if (!e.sp1 && k > 0.85) { e.sp1 = 1; splash(fx, y, sz * 0.4); }
          }
          ctx.restore();
          if (e.t >= e.dur) e.done = true;
        }
        if (e.done) { if (e === life.bird) { life.bird = null; life.nextBird = rr(4, 12); } else { life.ev = null; life.next = rr(5, 12); } }
      }
      drawSplashes(ctx, dt, lightC);
    };
    // the state of the sea, from the weather entity's wind (and its storms)
    const seaState = () => {
      const st = this._hass?.states?.[(this._config?.screensaver_weather || '').trim()];
      const a = st?.attributes || {}, cond = st?.state || '';
      let ws = Number(a.wind_speed);
      const unit = String(a.wind_speed_unit || this._hass?.config?.unit_system?.wind_speed || 'km/h').toLowerCase();
      if (!isFinite(ws)) ws = cond === 'windy' || cond === 'windy-variant' ? 30 : 12;
      const kmh = unit.includes('mph') ? ws * 1.609 : unit.includes('m/s') ? ws * 3.6 : unit.includes('kn') ? ws * 1.852 : ws;
      let chop = Math.max(0, Math.min(1, (kmh - 5) / 45));
      if (/lightning|pouring|hail/.test(cond)) chop = Math.max(chop, 0.75);
      return { chop, rain: /rain|pouring|lightning-rainy|hail/.test(cond), storm: /lightning/.test(cond) };
    };
    let sea = seaState();
    // white caps when it's windy: small bright flecks breaking on the crests and fading
    const capsDraw = (ctx, dt, W, H, hy, lightC) => {
      const want = sea.chop > 0.4 ? (sea.chop - 0.4) * 90 : 0;
      if (life.caps.length < want && Math.random() < dt * want * 0.8) {
        const d = 0.05 + Math.pow(Math.random(), 0.7) * 0.95;
        life.caps.push({ x: Math.random() * W, d, t: 0, max: rr(1.2, 2.6), w: rr(4, 12) * (d + 0.05) * (W / 400) * (0.6 + sea.chop), sk: (Math.random() - 0.5) * 0.15 });
      }
      life.caps = life.caps.filter(c => {
        c.t += dt;
        if (c.t > c.max) return false;
        const k = c.t / c.max, y = seaY(H, hy, c.d), a = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k) * 0.55;
        ctx.fillStyle = rgb(lightC, a.toFixed(3));
        ctx.beginPath(); ctx.ellipse(c.x, y, c.w * (0.7 + k * 0.8), Math.max(0.3, c.w * 0.06), c.sk, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(lightC, (a * 0.35).toFixed(3)); ctx.beginPath(); ctx.ellipse(c.x - c.w * 0.3, y + c.w * 0.08, c.w * (0.5 + k), Math.max(0.3, c.w * 0.05), c.sk, 0, Math.PI * 2); ctx.fill();
        return true;
      });
    };
    // distant weather: a grey shower hanging under a cloud far out, and silent lightning in a storm
    const wx = { x: 0.15 + Math.random() * 0.7, flash: 0, nextFlash: 6 + Math.random() * 10 };
    const weatherDraw = (ctx, t, dt, W, H, hy, day) => {
      if (sea.rain) {
        const cx = W * wx.x, cw = W * 0.28, top = hy * 0.62;
        const cc = day ? [96, 102, 116] : [22, 26, 38];
        ctx.save();
        // the cloud
        for (let i = 0; i < 7; i++) {
          const px = cx + (i - 3) * cw * 0.16, py = top + Math.sin(i * 1.7) * hy * 0.025, r = cw * (0.2 + (i % 3) * 0.05);
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, rgb(cc, 0.6)); g.addColorStop(1, rgb(cc, 0));
          ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.45); ctx.translate(-px, -py); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        // the rain falling from it to the sea: a soft grey veil, densest where it meets the sea and fading at the sides
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
        const vr = cw * 0.4;
        ctx.translate(cx, hy); ctx.scale(1, (hy - top) / vr); 
        const veil = ctx.createRadialGradient(0, 0, 0, 0, 0, vr);
        veil.addColorStop(0, rgb(cc, 0.34)); veil.addColorStop(0.6, rgb(cc, 0.2)); veil.addColorStop(1, rgb(cc, 0));
        ctx.fillStyle = veil; ctx.beginPath(); ctx.arc(0, 0, vr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        for (let i = 0; i < 5; i++) {
          const sx = cx - cw * 0.25 + i * cw * 0.12 + Math.sin(t * 0.25 + i * 2.1) * cw * 0.03, sw = cw * (0.04 + (i % 2) * 0.03);
          const g = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0);
          g.addColorStop(0, rgb(cc, 0)); g.addColorStop(0.5, rgb(cc, 0.12)); g.addColorStop(1, rgb(cc, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - sw, top + hy * 0.03); ctx.lineTo(sx + sw, top + hy * 0.03); ctx.lineTo(sx + sw - cw * 0.06, hy); ctx.lineTo(sx - sw - cw * 0.06, hy); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      if (sea.storm) {
        wx.nextFlash -= dt;
        if (wx.nextFlash <= 0) { wx.flash = 1; wx.flash2 = Math.random() < 0.6 ? 0.25 : 0; wx.nextFlash = 8 + Math.random() * 22; wx.fx = sea.rain ? W * wx.x : W * (0.2 + Math.random() * 0.6); }
        if (wx.flash > 0 || wx.flash2 > 0) {
          if (wx.flash2 > 0 && wx.flash < 0.3) { wx.flash2 -= dt; if (wx.flash2 <= 0) wx.flash = 0.8; }
          const a = Math.max(0, wx.flash) * (day ? 0.35 : 0.7);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(wx.fx, hy * 0.6, 0, wx.fx, hy * 0.6, W * 0.6);
          g.addColorStop(0, 'rgba(200,210,255,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(200,210,255,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          ctx.restore();
          wx.flash -= dt * 6;
        }
      }
    };
    const water = (ctx, t, W, H, S, hy, pattern, alphaFn, speed, scale, drift) => {
      const K = (H - hy) / (0.55 * 1.6 * W / TW);
      for (const [y, st] of B.rows) {
        const d = (y + st / 2 - hy) / (H - hy);
        const a = alphaFn(d);
        if (a < 0.01) continue;
        const z = 1 / (d + 0.035);
        // ripples as deep as they are wide (a little flattened by the angle), so the water doesn't streak
        const v = (((z * K / scale + t * speed) % TH) + TH) % TH;
        const sx = (d + 0.035) * scale * W / TW * 1.6;
        const off = W / 2 - sx * (TW / 2 + t * drift);
        ctx.globalAlpha = a;
        ctx.setTransform(S * sx, 0, 0, S * st, S * off, S * (y - v * st));
        ctx.fillRect((-off) / sx - 1, v, W / sx + 2, 1);
      }
      ctx.setTransform(S, 0, 0, S, 0, 0); ctx.globalAlpha = 1;
    };
    this._saverCanvasLoop(box, (ctx, t, dt, W, H, resized, S) => {
      const hy = Math.round(H * 0.55);
      if (resized || !B) build(W, H, S, hy);
      if (t - palAt > 30) { pal = palette(); sea = seaState(); palAt = t; }
      if (!B.hiP) { B.hiP = ctx.createPattern(tex.hi, 'repeat'); B.loP = ctx.createPattern(tex.lo, 'repeat'); }
      const [top, mid, hor, seaFar, seaNear, sunC, cLit, cShd] = pal.c;
      // the sky
      const sky = ctx.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, rgb(top)); sky.addColorStop(0.55, rgb(mid)); sky.addColorStop(1, rgb(hor));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hy + 1);
      if (pal.dark > 0.15) {
        ctx.globalCompositeOperation = 'lighter';
        for (const s of B.stars) {
          const a = (pal.dark - 0.15) * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph)) * (1 - s.y / hy * 0.6);
          ctx.globalAlpha = a;
          if (s.s > 2) ctx.drawImage(SPR[0], s.x - s.s / 2, s.y - s.s / 2, s.s, s.s);
          else { ctx.fillStyle = '#e6ecff'; ctx.fillRect(s.x, s.y, s.s, s.s); }
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      // the sun low over the sea (rising on the left, setting on the right), or the moon at night
      const day = pal.el > -5;
      const bx = W * (pal.rising ? 0.3 : 0.7);
      const br = Math.min(W, H) * (day ? 0.045 : 0.05);
      const by = day ? hy - Math.max(-br * 1.2, Math.min(hy * 0.75, (pal.el / 35) * hy * 0.75)) : hy * 0.28;
      if (day) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const low = Math.max(0, 1 - Math.max(0, pal.el) / 20);
        const cor = ctx.createRadialGradient(bx, by, 0, bx, by, br * 9);
        const warmC = sunC.map((c, i) => Math.round(c * [1, 0.86, 0.62][i]));   // a deeper gold for the glow, so it warms the blue rather than paling it
        cor.addColorStop(0, rgb(warmC, 0.75)); cor.addColorStop(0.12, rgb(warmC, 0.4)); cor.addColorStop(0.35, rgb(warmC, 0.12 + low * 0.08)); cor.addColorStop(1, rgb(warmC, 0));
        ctx.fillStyle = cor; ctx.fillRect(0, 0, W, hy);
        // a wide warm glow along the horizon when the sun is low
        if (low > 0) {
          const hg = ctx.createRadialGradient(bx, hy, 0, bx, hy, W * 0.8);
          hg.addColorStop(0, rgb(sunC, 0.35 * low)); hg.addColorStop(1, rgb(sunC, 0));
          ctx.save(); ctx.translate(bx, hy); ctx.scale(1, 0.35); ctx.translate(-bx, -hy); ctx.fillStyle = hg; ctx.fillRect(0, hy - hy / 0.35 - 4, W, hy / 0.35 + 8); ctx.restore();
        }
        ctx.globalCompositeOperation = 'source-over';
        const disc = ctx.createRadialGradient(bx - br * 0.2, by - br * 0.2, 0, bx, by, br);
        disc.addColorStop(0, '#fffdf2'); disc.addColorStop(0.55, rgb(sunC.map(c => Math.round(c + (255 - c) * 0.6)))); disc.addColorStop(1, rgb(sunC));
        ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        this._saverMoon(ctx, bx, by, br, S, 1.3);
      }
      // clouds, lit from the sun's side
      const nC = Math.round(B.clouds.length * pal.cloud);
      for (let i = 0; i < nC; i++) {
        const c = B.clouds[i];
        c.x += c.sp * dt * (0.6 + c.rank);
        if (c.x - c.w > W) c.x = -c.w;
        const persp = 0.35 + 0.65 * (1 - c.y / hy);
        for (const p of c.puffs) {
          const x = c.x + p.dx * c.w, y = c.y + p.dy * c.w * 0.3 * persp, r = p.r * c.w * persp;
          const lx = (bx - x) / W * r * 0.5;
          const g = ctx.createRadialGradient(x + lx, y - r * 0.25, 0, x, y, r);
          g.addColorStop(0, rgb(cLit, 0.3 * (0.5 + pal.cloud * 0.5)));
          g.addColorStop(0.5, rgb(cShd, 0.2 * (0.5 + pal.cloud * 0.5))); g.addColorStop(1, rgb(cShd, 0));
          ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.38); ctx.translate(-x, -y);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      // the sun shining through: a bright glare over any cloud in front of it
      if (day) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const gc = sunC.map((c, i) => Math.round(c * [1, 0.8, 0.5][i]));
        const gl = ctx.createRadialGradient(bx, by, br * 0.6, bx, by, br * 2);
        gl.addColorStop(0, rgb(gc, 0.3)); gl.addColorStop(1, rgb(gc, 0));
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bx, by, br * 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      weatherDraw(ctx, t, dt, W, H, hy, day);
      // the sea: the sky's colour reflected near the horizon, deepening toward you
      const sg = ctx.createLinearGradient(0, hy, 0, H);
      sg.addColorStop(0, rgb(hor)); sg.addColorStop(0.06, rgb(seaFar)); sg.addColorStop(0.45, rgb(seaFar.map((c, i) => Math.round(c * 0.6 + seaNear[i] * 0.4)))); sg.addColorStop(1, rgb(seaNear));
      ctx.fillStyle = sg; ctx.fillRect(0, hy, W, H - hy);
      // the ripples: two layers of the same water, at different sizes and speeds, so it never looks repeated
      // calmer and glassier on a still day, choppier and quicker in the wind
      const chopA = 0.55 + 0.9 * sea.chop, spA = 9 * (0.6 + sea.chop * 1.2), spB = 13 * (0.6 + sea.chop * 1.2);
      const shadeA = d => Math.min(1, d * 6) * (0.35 + 0.35 * d) * chopA;
      const lightA = d => Math.min(1, d * 5) * (0.08 + 0.22 * d) * (day ? 1 : 0.55) * chopA;
      ctx.fillStyle = B.loP; water(ctx, t, W, H, S, hy, B.loP, shadeA, spA, 1, 2.2);
      ctx.fillStyle = B.hiP; water(ctx, t, W, H, S, hy, B.hiP, lightA, spA, 1, 2.2);
      ctx.fillStyle = B.loP; water(ctx, t * 0.7 + 40, W, H, S, hy, B.loP, d => shadeA(d) * 0.5, spB, 0.55, -1.4);
      ctx.fillStyle = B.hiP; water(ctx, t * 0.7 + 40, W, H, S, hy, B.hiP, d => lightA(d) * 0.6, spB, 0.55, -1.4);
      capsDraw(ctx, dt, W, H, hy, day ? [255, 255, 255] : [190, 200, 225]);
      // the path of light: crests sparkling under the sun or moon, strongest in the middle and fading out softly to the sides
      const strength = day ? Math.max(0.3, 1 - Math.max(0, pal.el) / 50) : 0.75;
      const spread = W * (day ? 0.3 : 0.18);
      const mkey = [Math.round(bx), Math.round(br), Math.round(spread), W, H].join('|');
      if (!B.glit || B.glit.key !== mkey) {
        const [gc, gg] = this._saverOff(W, H, S), [mc, mg] = this._saverOff(W, H, S);
        for (const [y, st] of B.rows) {
          const d = (y + st / 2 - hy) / (H - hy), half = br * 0.7 + spread * d;
          const lg = mg.createLinearGradient(bx - half, 0, bx + half, 0);
          lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.3, 'rgba(0,0,0,0.35)'); lg.addColorStop(0.5, 'rgba(0,0,0,1)'); lg.addColorStop(0.7, 'rgba(0,0,0,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
          mg.fillStyle = lg; mg.fillRect(bx - half, y, half * 2, st);
        }
        B.glit = { key: mkey, gc, gg, mc };
      }
      {
        const { gc, gg, mc } = B.glit;
        gg.setTransform(1, 0, 0, 1, 0, 0); gg.globalCompositeOperation = 'source-over'; gg.clearRect(0, 0, gc.width, gc.height);
        gg.setTransform(S, 0, 0, S, 0, 0);
        const pc = day ? sunC : [215, 225, 255];
        gg.fillStyle = rgb(pc, 0.22 * strength); gg.fillRect(0, hy, W, H - hy);
        gg.fillStyle = B.hiP; water(gg, t, W, H, S, hy, B.hiP, d => Math.min(1, d * 14) * strength, spA, 1, 2.2);
        gg.fillStyle = B.hiP; water(gg, t * 0.7 + 40, W, H, S, hy, B.hiP, d => Math.min(1, d * 14) * strength * 0.7, spB, 0.55, -1.4);
        gg.globalCompositeOperation = 'source-in';
        gg.fillStyle = rgb(day ? pc : pc.map(c => Math.min(255, c + 30))); gg.fillRect(0, hy, W, H - hy);
        gg.globalCompositeOperation = 'destination-in';
        gg.setTransform(1, 0, 0, 1, 0, 0); gg.drawImage(mc, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(gc, 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      // haze along the horizon, so the far water melts into the sky
      const hz = ctx.createLinearGradient(0, hy - H * 0.04, 0, hy + H * 0.07);
      hz.addColorStop(0, rgb(hor, 0)); hz.addColorStop(0.4, rgb(hor, 0.55)); hz.addColorStop(1, rgb(hor, 0));
      ctx.fillStyle = hz; ctx.fillRect(0, hy - H * 0.04, W, H * 0.11);
      // dolphins, seabirds or a whale, now and then
      lifeDraw(ctx, t, dt, W, H, S, hy, day, sunC, hor, bx);
      // a little darker at the bottom corners
      const vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.4, W / 2, H * 0.45, Math.max(W, H) * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      this._saverGrain(ctx, W, H, 0.03);
    });
  },

  // ── Info Screens: a set of full-colour screens, one at a time, that change by themselves and can be swiped
  // back and forth. Each has one plain colour and one large visual: the time, what's playing, a spectrum,
  // today's listening, up next, the lyrics, the weather (the same animated sky as Clock & Weather), the week,
  // and the doors and windows that are open (found by themselves: every door, window, garage door and opening
  // sensor in Home Assistant, by room). A screen with nothing to show is passed over. ──
  _saverScreens(stage) {
    const el = this._saverEl;
    if (!el) return;
    const esc = t => this._cmpEsc(t);
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const root = document.createElement('div');
    root.className = 'cs-scr' + (still ? ' cs-still' : '');
    root.innerHTML = '<style>' + CROW_MEDIA_SCR_CSS + '</style><div class="cs-sdots"></div>';
    stage.appendChild(root);
    const dotsEl = root.querySelector('.cs-sdots');
    const alive = () => this._saverEl === el && root.isConnected;
    const S = this._scrDefs();
    // the screens with something to show: worked out every ten seconds (or when asked to be fresh), rather than
    // every second, since that means looking through everything in Home Assistant
    const hasKey = k => { try { return !!S[k]?.has(); } catch (_) { return false; } };
    let pickedAt = 0, pickedList = null, pickedCfg = null;
    const picked = (fresh) => {
      const want = Array.isArray(this._config?.screensaver_screens) ? this._config.screensaver_screens : null;
      const now = Date.now();
      if (!fresh && pickedList && pickedCfg === want && now - pickedAt < 10000) return pickedList;
      const keys = CROW_MEDIA_SCR_KEYS.filter(k => (want && want.length) ? want.includes(k) : !CROW_MEDIA_SCR_OFF.includes(k));
      const ok = keys.filter(hasKey);
      pickedAt = now; pickedCfg = want; pickedList = ok.length ? ok : ['time'];
      return pickedList;
    };
    const hidden = () => document.hidden || document.visibilityState === 'hidden';
    let cur = null, pane = null, upd = null;
    // where a list is now: partway through a glide, at rest, or where it was left by hand
    const posNow = (a) => a.leg ? a.leg.from + (a.leg.to - a.leg.from) * Math.min(1, (Date.now() - a.leg.at) / a.leg.ms) : (a.tf || 0);
    // the fades at the top and bottom of a list only show where there's more to scroll to
    const edges = (clip) => {
      const a = clip._auto, max = a?.max ?? (clip.scrollHeight - clip.clientHeight), y = clip.scrollTop + (a ? posNow(a) : 0);
      clip.classList.toggle('cs-sft', max > 4 && y > 2);
      clip.classList.toggle('cs-sfb', max > 4 && y < max - 2);
    };
    const tr = y => 'translate3d(0,' + (-y).toFixed(1) + 'px,0)';
    // someone's touched it: it stops where it is and becomes an ordinary scrolling list
    const handBack = (clip) => {
      const a = clip._auto, list = clip.firstElementChild;
      if (!a || (!a.leg && !a.tf)) return;
      const y = posNow(a);
      clearTimeout(a.t); a.t = 0; a.leg = null; a.tf = 0;
      if (list) { list.style.transition = 'none'; list.style.transform = ''; }
      a.self = true;
      clip.scrollTop = Math.round(y);
    };
    // The slow scroll of a list nobody is touching: down, a pause, back up, a pause. Each glide is handed to the
    // browser as one transition, which it draws by itself on the graphics chip, so nothing runs frame by frame;
    // a timer wakes it only at each end.
    const glide = (clip, ms) => { clearTimeout(clip._auto.t); clip._auto.t = setTimeout(() => { clip._auto.t = 0; run(clip); }, Math.max(0, ms)); };
    const run = (clip) => {
      const a = clip._auto, list = clip.firstElementChild;
      if (!alive() || !clip.isConnected || !list || !a) return;
      if (hidden()) { glide(clip, 1500); return; }
      const now = Date.now();
      // got to the end it was heading for: turns round after a pause
      if (a.leg) {
        if (now < a.leg.at + a.leg.ms) { glide(clip, a.leg.at + a.leg.ms - now); return; }
        a.pos = a.tf = a.leg.to; a.leg = null;
        if (a.dir > 0) { a.dir = -1; a.endAt = a.endAt || now; } else a.dir = 1;
        a.wait = now + 3500;
        edges(clip);
      }
      const max = a.max ?? (clip.scrollHeight - clip.clientHeight);
      if (max <= 4) return;
      if (now < a.wait) { glide(clip, a.wait - now); return; }
      // carries on from wherever it was left by hand
      if (clip.scrollTop) { a.pos = clip.scrollTop; a.self = true; clip.scrollTop = 0; list.style.transition = 'none'; list.style.transform = tr(a.pos); a.tf = a.pos; list.getBoundingClientRect(); }
      const from = Math.min(max, a.tf || 0), to = a.dir > 0 ? max : 0, dist = Math.abs(to - from);
      const ms = Math.max(50, dist / (a.dir > 0 ? 24 : 42) * 1000);
      a.leg = { from, to, at: now, ms };
      a.tf = to;
      list.style.transition = 'transform ' + Math.round(ms) + 'ms linear';
      list.style.transform = tr(to);
      clip.classList.toggle('cs-sft', from > 2 || to > 2);
      clip.classList.toggle('cs-sfb', from < max - 2 || to < max - 2);
      glide(clip, ms + 30);
    };
    const fit = (pn) => {
      if (!pn) return;
      pn.querySelectorAll('[data-fit]').forEach(list => {
        const n = list.children.length;
        const size = n > 12 ? 'lots' : n > 6 ? 'many' : '';
        if ((list.dataset.size || '') !== size) list.dataset.size = size;
        const rows = String(Math.ceil(n / 2));
        if (list.style.getPropertyValue('--rows') !== rows) list.style.setProperty('--rows', rows);
        let clip = list.parentElement;
        if (!clip?.classList.contains('cs-sclip')) {
          clip = document.createElement('div');
          clip.className = 'cs-sclip';
          list.replaceWith(clip);
          clip.appendChild(list);
        }
        // more than fits: it can be scrolled, and scrolls slowly by itself when left alone
        if (!clip._auto) {
          clip._auto = { dir: 1, wait: Date.now() + 3000, pos: 0 };
          const held = () => { handBack(clip); clip._auto.wait = Date.now() + 8000; clip._auto.pos = clip.scrollTop; glide(clip, 8000); };
          clip.addEventListener('scroll', () => {
            edges(clip);
            if (clip.scrollTop + posNow(clip._auto) >= clip.scrollHeight - clip.clientHeight - 2) clip._auto.endAt = clip._auto.endAt || Date.now();
            if (!clip._auto.self) held();
            clip._auto.self = false;
          }, { passive: true });
          ['touchstart', 'wheel', 'pointerdown'].forEach(ev => clip.addEventListener(ev, held, { passive: true }));
        }
        // how far it can scroll, measured here once a second rather than on every frame of the drift
        const max = clip.scrollHeight - clip.clientHeight;
        clip._auto.max = max;
        clip.classList.toggle('cs-sover', max > 4);
        if (!clip._auto.leg) edges(clip);
        if (max > 4 && !clip._auto.t && !clip._auto.leg) glide(clip, clip._auto.wait - Date.now());
      });
    };
    const dots = (list) => {
      const html = list.map(k => '<i' + (k === cur ? ' class="on"' : '') + '></i>').join('');
      if (dotsEl._h !== html) { dotsEl._h = html; dotsEl.innerHTML = html; }
    };
    const show = (key, dir) => {
      if (!alive()) return;
      const def = S[key] || S.time;
      const next = document.createElement('div');
      next.className = 'cs-sp cs-sp-' + key;
      // Dark Screens: black, with the screen's colour (lightened to read on black) for its details
      const dark = this._config?.screensaver_screens_dark === true;
      root.classList.toggle('cs-sdark-root', dark);
      if (dark) {
        const tint = this._scrTint(def.bg);
        next.classList.add('cs-sdark');
        next.style.background = '#000';
        next.style.setProperty('--sc', tint);
        root.style.setProperty('--sc', tint);
      } else {
        next.style.background = def.bg;
        if (def.ink) next.style.color = def.ink;
      }
      root.insertBefore(next, dotsEl);
      try { this._scrSkyStop?.(); } catch (_) {}
      let u = null;
      try { u = def.build(next); } catch (e) { console.warn('[crow-media] screen', key, e); }
      const old = pane;
      cur = key; pane = next; upd = u;
      if (old) {
        if (still || !dir) { old.remove(); }
        else {
          next.style.transform = 'translateX(' + (dir > 0 ? 100 : -100) + '%)';
          next.getBoundingClientRect();
          next.classList.add('cs-move'); old.classList.add('cs-move');
          next.style.transform = 'translateX(0)';
          old.style.transform = 'translateX(' + (dir > 0 ? -100 : 100) + '%)';
          setTimeout(() => old.remove(), 750);
        }
      }
      // entrance animations start once the screen is in place
      requestAnimationFrame(() => next.classList.add('cs-in'));
      setTimeout(() => next.classList.add('cs-settled'), 1600);
      try { upd?.(); } catch (_) {}
      requestAnimationFrame(() => fit(next));
      dots(picked());
    };
    const step = (dir) => {
      const list = picked(true);
      let i = list.indexOf(cur);
      if (i === -1) i = dir > 0 ? -1 : 0;
      const key = list[(i + dir + list.length) % list.length];
      if (key === cur && list.length === 1) { dots(list); return; }
      show(key, dir);
      restart();
    };
    // changes by itself every so often (the editor's Change Every; Never leaves it to swiping)
    const canSwipe = el.classList.contains('cs-full');
    let autoT = null;
    const every = () => { const s = Number(this._config?.screensaver_screens_every); return Number.isFinite(s) && s >= 0 && (s > 0 || canSwipe) ? s : 15; };
    let shownAt = Date.now();
    const ready = () => {
      const now = Date.now();
      if (now - shownAt < every() * 1000) return false;
      let last = 0;
      for (const clip of pane?.querySelectorAll('.cs-sclip') || []) {
        if (clip.scrollHeight - clip.clientHeight <= 4) continue;
        const end = clip._auto?.endAt;
        if (!end) return false;
        last = Math.max(last, end);
      }
      return !last || now - last >= 1500;
    };
    const restart = () => {
      clearInterval(autoT); autoT = null;
      shownAt = Date.now();
      if (every() > 0) autoT = setInterval(() => { if (alive() && !hidden() && ready()) step(1); }, 500);
    };
    // full screen: swipe left or right (or the arrow keys) to change screen. A swipe isn't a tap, so it
    // doesn't wake the card. Over the artwork the screens just change by themselves.
    let sx = 0, sy = 0, sid = null;
    const down = (e) => { if (e.button > 0) return; sid = e.pointerId; sx = e.clientX; sy = e.clientY; };
    const up = (e) => {
      if (sid === null || e.pointerId !== sid) return;
      sid = null;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      el._swiped = Date.now();
      this._saverActiveAt = Date.now();
      step(dx < 0 ? 1 : -1);
    };
    const key = (e) => {
      if (!alive() || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault(); e.stopPropagation();
      el._swiped = Date.now();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    const cancel = () => { sid = null; };
    if (canSwipe) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', cancel);
      document.addEventListener('keydown', key, true);
    }
    // the live parts (time, progress, lyrics…) once a second, and a screen that's run out of things to
    // show (the song ended, the doors were shut) gives way to the next
    const tick = setInterval(() => {
      if (!alive() || hidden()) return;
      const list = picked();
      // the screen showing is checked every second; the rest every ten
      if (cur && list.length > 1 && !hasKey(cur)) { step(1); return; }
      if (cur && !list.includes(cur) && hasKey(cur)) pickedAt = 0;
      dots(list);
      try { upd?.(); } catch (_) {}
      fit(pane);
    }, 1000);
    const lyrTick = setInterval(() => { if (alive() && cur === 'lyrics' && !hidden()) { try { upd?.(); } catch (_) {} } }, 250);
    // hidden (another app, another tab, the screen locked): everything waits; back again, it carries on
    const vis = () => {
      if (hidden()) return;
      shownAt = Math.max(shownAt, Date.now() - 2000);
      try { upd?.(); } catch (_) {}
      fit(pane);
    };
    document.addEventListener('visibilitychange', vis);
    this._scrOff = () => {
      document.removeEventListener('visibilitychange', vis);
      clearInterval(autoT); clearInterval(tick); clearInterval(lyrTick); root.querySelectorAll('.cs-sclip').forEach(c => clearTimeout(c._auto?.t));
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, true);
      try { this._scrSkyStop?.(); } catch (_) {}
    };
    show(picked()[0], 0);
    restart();
  },

  // ── The screens ─────────────────────────────────────────────────────────────────────────────────────
  _scrDefs() {
    const esc = t => this._cmpEsc(t);
    const st = () => this._hass?.states?.[this._entity];
    const attrs = () => st()?.attributes || {};
    const playing = () => { const s = st()?.state; return (s === 'playing' || s === 'paused' || s === 'buffering') && !!attrs().media_title; };
    const isMusic = () => playing() && (this._fsKind ? (() => { try { const k = this._fsKind(); return !k || k === 'music'; } catch (_) { return true; } })() : true);
    const room = () => { try { return this._entityDisplayName?.(this._entity) || attrs().friendly_name || ''; } catch (_) { return attrs().friendly_name || ''; } };
    const pos = () => {
      const a = attrs();
      if (typeof a.media_position !== 'number') return null;
      let p = a.media_position;
      if (st()?.state === 'playing' && a.media_position_updated_at) p += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
      return Math.max(0, p);
    };
    const mmss = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
    const corner = (l, r) => '<div class="cs-scorner"><span>' + esc(l || '') + '</span><span>' + esc(r || '') + '</span></div>';
    const log = () => (this._getListenLogEntries?.() || []).filter(e => (e.mediaType || 'music') === 'music' && e.ts);
    const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const entryMs = e => e.durationMs > 0 ? Math.min(e.durationMs, 20 * 60000) : 210000;
    const dur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + 'm'; };
    const timeParts = () => this._saverTimeParts();
    const openings = () => this._scrOpenings();
    const clock = (ms) => {
      const h24 = this._hass?.locale?.time_format === '24';
      try { return new Date(ms).toLocaleTimeString(this._hass?.locale?.language || undefined, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: this._hass?.locale?.time_format === '12' ? true : h24 ? false : undefined }); } catch (_) { return ''; }
    };
    // a camera's picture at the size it's shown (Home Assistant's camera proxy scales it down before sending it),
    // so the iPad isn't fetching and decoding full-size pictures to show them small
    const sized = (url, tile) => {
      if (!/\/api\/camera_proxy\//.test(url)) return url;
      const w = Math.min(1920, Math.max(320, Math.ceil((tile.clientWidth || 640) * Math.min(2, window.devicePixelRatio || 1) / 160) * 160));
      return url + (url.includes('?') ? '&' : '?') + 'width=' + w;
    };
    // a grid of camera pictures: the tiles stay, and only their pictures are swapped, every ten seconds in full
    // screen (thirty over the artwork); a doorbell that's just rung says when
    const camGrid = (p, title, get) => {
      p.innerHTML = corner(title, '') + '<div class="cs-scams" data-fit></div>';
      const box = p.querySelector('.cs-scams'), c = p.querySelector('.cs-scorner span:last-child');
      let lastAt = 0;
      const every = () => (this._saverEl?.classList.contains('cs-full') ? 20000 : 60000);
      return () => {
        const K = get();
        const ids = K.map(k => k.id).join('|');
        if (box._ids !== ids) {
          box._ids = ids;
          box.dataset.n = K.length <= 4 ? String(K.length) : K.length <= 6 ? '6' : 'many';
          box.innerHTML = K.map(k => '<div class="cs-scam' + (k.pic ? '' : ' cs-snopic') + '" data-id="' + esc(k.id) + '">' + (k.pic ? '<img alt="">' : '<div class="cs-sic">' + CROW_MEDIA_SCR_ICON.bell + '</div>') + '<div class="cs-scl"><b>' + esc(k.name) + '</b><span></span></div></div>').join('');
          box.querySelectorAll('img').forEach(im => { im.onerror = () => { im.style.visibility = 'hidden'; }; im.onload = () => { im.style.visibility = ''; }; });
          lastAt = 0;
        }
        const now = Date.now();
        // when the doorbell rang, kept up to the minute
        K.forEach(k => {
          const tile = box.querySelector('[data-id="' + CSS.escape(k.id) + '"]');
          if (!tile) return;
          tile.classList.toggle('cs-srang', !!k.at);
          if (k.at) { const m = Math.floor((now - k.at) / 60000); tile.querySelector('span').textContent = m < 1 ? 'Rang just now' : 'Rang ' + m + ' min ago'; }
        });
        const rang = K.filter(k => k.at).sort((a, b) => b.at - a.at)[0];
        if (now - lastAt < every()) { if (rang) c.textContent = 'Rang ' + clock(rang.at); return; }
        lastAt = now;
        c.textContent = rang ? 'Rang ' + clock(rang.at) : '';
        K.forEach(k => {
          const tile = box.querySelector('[data-id="' + CSS.escape(k.id) + '"]');
          if (!tile) return;
          // a snapshot says when it was taken; a picture that's kept up to date, when it was last fetched
          // no times on the pictures: only a doorbell that's just rung says so
          if (!k.at) tile.querySelector('span').textContent = '';
          if (k.pic) { const u = sized(k.pic, tile); tile.querySelector('img').src = u + (u.includes('?') ? '&' : '?') + 't=' + lastAt; }
        });
      };
    };

    return {
      // the time and date, large
      time: { bg: '#3b3fb6', has: () => true, build: (p) => {
        p.innerHTML = corner(room(), '') + '<div class="cs-stime"><div class="t"></div><div class="d"></div></div>';
        const t = p.querySelector('.t'), d = p.querySelector('.d'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const tp = timeParts();
          const html = esc(tp.t).replace(':', '<span class="cs-scolon">:</span>').replace(/\s?(AM|PM)$/i, '<span class="cs-sampm">$1</span>');
          if (t._h !== html) { t._h = html; t.innerHTML = html; }
          if (d.textContent !== tp.d) d.textContent = tp.d;
        };
      } },

      // today: the volume, songs played and time spent listening, as dials, with what's switched on
      today: { bg: '#2e8b57', has: () => !!st(), build: (p) => {
        const dial = (k, lab) => `<div class="cs-sdial" data-k="${k}"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44"/></svg><div class="in"><div class="n"></div><div class="cs-slab">${lab}</div></div></div>`;
        p.innerHTML = corner('', 'Today') + '<div class="cs-sdials">' + dial('vol', 'Volume') + dial('songs', 'Songs today') + dial('time', 'Listening today') + '</div><div class="cs-spills"></div>';
        const C = 2 * Math.PI * 44;
        const set = (k, frac, txt) => {
          const d = p.querySelector('[data-k="' + k + '"]');
          d.querySelector('.n').textContent = txt;
          const f = Math.max(0, Math.min(1, frac)), v = d.querySelector('.val');
          v.style.strokeDasharray = (f * C).toFixed(1) + ' ' + C.toFixed(1);
          v.style.opacity = f > 0.005 ? '1' : '0';
        };
        const pills = p.querySelector('.cs-spills'), c = p.querySelector('.cs-scorner span:first-child');
        return () => {
          const a = attrs();
          const vol = typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null;
          const today = log().filter(e => e.ts >= dayStart());
          const ms = today.reduce((s, e) => s + entryMs(e), 0);
          set('vol', vol === null ? 0 : vol / 100, vol === null ? '–' : String(vol));
          set('songs', today.length / 40, String(today.length));
          set('time', ms / (3 * 3600000), dur(ms));
          const s = st()?.state;
          const P = [['Playing', s === 'playing'], ['Muted', a.is_volume_muted === true], ['Shuffle', a.shuffle === true], ['Repeat', a.repeat && a.repeat !== 'off'], ['Sleep timer', !!this._sleep]];
          const html = P.map(([l, on]) => '<div' + (on ? ' class="on"' : '') + '>' + l + '</div>').join('');
          if (pills._h !== html) { pills._h = html; pills.innerHTML = html; }
          c.textContent = room();
        };
      } },

      // up next: the next few songs in the queue, their artwork sliding in one after another
      upnext: { bg: '#d9a521', has: () => isMusic() && (this._scrNextFor(this._scrSongKey()) || []).length > 0, build: (p) => {
        p.innerHTML = corner('Up Next', room()) + '<div class="cs-stiles"></div>';
        const box = p.querySelector('.cs-stiles');
        return () => {
          const list = (this._scrNextFor(this._scrSongKey()) || []).slice(0, 3);
          const lbl = ['Next', 'Then', 'After'];
          const html = list.map((x, i) => { const img = this._scrArt(x); return '<div class="cs-stile" style="animation-delay:' + (i * 0.3) + 's"><div class="cs-slab">' + lbl[i] + '</div><div class="sq">' + (img ? '<img alt="" src="' + esc(img) + '" onerror="this.remove()">' : '') + '</div><div class="cs-st1">' + esc(x.title) + '</div><div class="cs-st2">' + esc(x.artist || '') + '</div></div>'; }).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // the lyrics: every line, gliding up as the song goes, the line being sung large and bright (like the
      // card's own synced lyrics)
      lyrics: { bg: '#6b3fa0', has: () => isMusic() && !!this._scrLyrics(), build: (p) => {
        p.innerHTML = corner('Lyrics', '') + '<div class="cs-slyr"><div class="cs-slyrw"></div></div>';
        const view = p.querySelector('.cs-slyr'), wrap = p.querySelector('.cs-slyrw'), c = p.querySelector('.cs-scorner span:last-child');
        let lines = null, at = -2;
        const place = (smooth) => {
          const el = wrap.children[Math.max(0, at)];
          if (!el) return;
          wrap.style.transition = smooth ? '' : 'none';
          const y = view.clientHeight * 0.47 - (el.offsetTop + el.offsetHeight / 2);
          wrap.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
        };
        return () => {
          const a = attrs();
          c.textContent = [a.media_title, a.media_artist].filter(Boolean).join(' \u00b7 ');
          const L = this._scrLyrics();
          if (!L) return;
          if (L !== lines) {
            lines = L; at = -2;
            wrap.innerHTML = L.map(l => { const t = (l.text || '').trim(); return '<div class="ln' + (t ? '' : ' gap') + '">' + (t ? esc(t) : '\u2022 \u2022 \u2022') + '</div>'; }).join('');
          }
          const ps = pos();
          if (ps === null) return;
          let i = -1;
          for (let k = 0; k < L.length; k++) { if (L[k].time <= ps + 0.15) i = k; else break; }
          if (i === at) return;
          const first = at === -2;
          at = i;
          [...wrap.children].forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
          place(!first);
        };
      } },

      // lights: how many are on, each with its room and brightness (only while any are on)
      lights: { bg: '#23345f', has: () => this._scrLights().on.length > 0, build: (p) => {
        p.innerHTML = corner('Lights', '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>On</span></div><div class="cs-slist" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const L = this._scrLights();
          cnt.textContent = String(L.on.length);
          c.textContent = L.off ? L.off + ' off' : '';
          const show = L.on;
          const html = show.map(x => '<div class="cs-srow"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON.bulb + '</div><div class="tx"><div class="cs-slab">' + esc(x.room || 'Other') + '</div><div class="cs-st1">' + esc(x.name) + '</div></div>'
            + '<div class="rt"><b>' + (x.pct === null ? 'On' : x.pct + '%') + '</b>' + (x.pct === null ? '' : '<div class="cs-sbar"><i style="width:' + x.pct + '%"></i></div>') + '</div></div>').join('')
          ;
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // rooms: the temperature (and humidity) in each room, warmest first
      rooms: { bg: '#4f5b70', has: () => this._scrRooms().length > 0, build: (p) => {
        p.innerHTML = corner('Rooms', '') + '<div class="cs-scol"><div class="cs-slist cs-srooms" data-fit></div></div>';
        const box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const R = this._scrRooms();
          const avg = R.reduce((s, r) => s + r.t, 0) / (R.length || 1);
          c.textContent = R.length > 1 ? 'Average ' + avg.toFixed(1) + '°' : '';
          const hot = R[0], cold = R[R.length - 1];
          // in Home Assistant's groups (or floors), each group warmest first
          const G = this._scrGrouped(this._scrStable(box, R, r => r.room), r => r.group);
          box.toggleAttribute('data-grouped', G.length > 1);
          const row = r => {
            const col = this._scrTempColour(r.t);
            const lab = R.length > 2 && r === hot ? 'Warmest' : R.length > 2 && r === cold ? 'Coldest' : '';
            return '<div class="cs-srow"><div class="cs-sic cs-stemp" style="--tc:' + col + '">' + CROW_MEDIA_SCR_ICON.therm + '</div><div class="tx"><div class="cs-slab">' + lab + '</div><div class="cs-st1">' + esc(r.room) + '</div></div>'
              + '<div class="rt"><b style="color:' + col + '">' + r.t.toFixed(1) + '°</b>' + (r.h !== null ? '<small>' + Math.round(r.h) + '% humidity</small>' : '') + '</div></div>';
          };
          const html = G.map(g => (G.length > 1 ? '<div class="cs-shead">' + esc(g.name || 'Other') + '</div>' : '') + g.items.map(row).join('')).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // heating: a dial for each thermostat, its ring coloured by the temperature (blue cold, through green, to red
      // hot) and pale while it's off; in Home Assistant's groups (or floors) when there are any
      heating: { bg: '#4b3f5c', has: () => this._scrClimate().length > 0, build: (p) => {
        p.innerHTML = corner('Heating', '') + '<div class="cs-sth" data-fit></div>';
        const box = p.querySelector('.cs-sth');
        const C = 2 * Math.PI * 44;
        return () => {
          const T = this._scrClimate();
          box.dataset.n = T.length > 6 ? 'many' : T.length > 3 ? 'some' : 'few';
          const G = this._scrGrouped(this._scrStable(box, T, x => x.id), x => x.group);
          box.toggleAttribute('data-grouped', G.length > 1);
          const dial = x => {
            const f = x.cur === null ? 0 : Math.max(0.04, Math.min(1, (this._scrToC(x.cur) - 10) / 20));
            const off = x.action === 'off';
            const col = off || x.cur === null ? 'rgba(255,255,255,0.5)' : this._scrTempColour(x.cur);
            return '<div class="cs-sthd' + (off ? ' off' : '') + '"><div class="cs-sdial"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" style="stroke:' + col + ';stroke-dasharray:' + (f * C).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>'
              + '<div class="in"><div class="n">' + (x.cur === null ? '–' : x.cur.toFixed(1) + '°') + '</div><div class="cs-slab">' + esc(x.action === 'heating' ? 'Heating' : x.action === 'cooling' ? 'Cooling' : 'Now') + '</div></div></div>'
              + '<div class="tx"><div class="nm">' + esc(x.name) + '</div><div class="st">' + esc(x.status) + '</div></div></div>';
          };
          const html = G.map(g => (G.length > 1 ? '<div class="cs-shead">' + esc(g.name || 'Other') + '</div>' : '') + g.items.map(dial).join('')).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // today: the rest of today from the calendars chosen in the editor (none chosen: this screen isn't shown)
      calendar: { bg: '#5a4fcf', has: () => (this._scrEvents() || []).length > 0, build: (p) => {
        p.innerHTML = corner('Today', '') + '<div class="cs-scol"><div class="cs-ssoon"></div><div class="cs-slist cs-scal" data-fit></div></div>';
        const box = p.querySelector('.cs-slist'), soon = p.querySelector('.cs-ssoon'), c = p.querySelector('.cs-scorner span:last-child');
        const lang = this._hass?.locale?.language || undefined;
        const hm = d => { try { const h24 = this._hass?.locale?.time_format === '24'; return d.toLocaleTimeString(lang, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: this._hass?.locale?.time_format === '12' ? true : this._hass?.locale?.time_format === '24' ? false : undefined }); } catch (_) { return d.toTimeString().slice(0, 5); } };
        const len = ms => { const m = Math.round(ms / 60000); return m >= 60 ? (m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.floor(m / 60) + ' h') : m + ' min'; };
        return () => {
          c.textContent = timeParts().d;
          const E = this._scrEvents() || [];
          const now = Date.now();
          const first = E.find(e => !e.allDay);
          let s = '';
          if (first) { const m = Math.max(1, Math.round((first.start - now) / 60000)); s = first.start <= now ? 'Now' : 'Next · in ' + (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'); }
          if (soon.textContent !== s) soon.textContent = s;
          const html = E.map(e => {
            const on = !e.allDay && e.start <= now;
            const tm = e.allDay ? 'All day' : hm(new Date(e.start));
            const d = e.allDay ? '' : len(e.end - e.start);
            return '<div class="cs-srow' + (e === first ? ' now' : '') + '"><div class="tm">' + esc(tm) + (d ? '<small>' + esc(on ? 'until ' + hm(new Date(e.end)) : d) + '</small>' : '') + '</div><div class="cd"></div>'
              + '<div class="tx"><div class="cs-slab">' + esc(e.cal) + '</div><div class="cs-st1">' + esc(e.title) + '</div></div></div>';
          }).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // timers: every Home Assistant timer that's running or paused, as a countdown in a ring that empties
      timers: { bg: '#c2185b', has: () => this._scrTimers().length > 0, build: (p) => {
        p.innerHTML = corner('Timers', '') + '<div class="cs-sth cs-stimers" data-fit></div>';
        const box = p.querySelector('.cs-sth');
        const C = 2 * Math.PI * 44;
        const fmt = s => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
        return () => {
          const T = this._scrTimers();
          box.dataset.n = T.length > 6 ? 'many' : T.length > 3 ? 'some' : 'few';
          const html = T.map(t => {
            const left = t.left(), f = t.total > 0 ? Math.max(0, Math.min(1, left / t.total)) : 0;
            const col = t.paused ? 'rgba(255,255,255,0.5)' : left <= 60 || f < 0.1 ? '#ff8a7a' : f < 0.25 ? '#ffd36b' : '#ffffff';
            return '<div class="cs-sthd"><div class="cs-sdial"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" style="stroke:' + col + ';stroke-dasharray:' + (f * C).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>'
              + '<div class="in"><div class="n">' + fmt(left) + '</div><div class="cs-slab">' + (t.paused ? 'Paused' : 'Left') + '</div></div></div>'
              + '<div class="tx"><div class="nm">' + esc(t.name) + '</div><div class="st">' + esc(t.paused ? 'Paused' : 'Ends ' + t.ends) + '</div></div></div>';
          }).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // shopping: what's still to buy, from the shopping lists in Home Assistant
      shopping: { bg: '#e8577a', has: () => this._scrTodo('shopping').items.length > 0, build: (p) => this._scrTodoScreen(p, 'shopping', 'Shopping', corner, esc) },

      // to-do: what's still to do, from the other to-do lists in Home Assistant
      todo: { bg: '#7e57c2', has: () => this._scrTodo('todo').items.length > 0, build: (p) => this._scrTodoScreen(p, 'todo', 'To-Do', corner, esc) },

      // appliances: what's running (smart appliances, and ones on smart plugs), with the time left or how long it's
      // been going, and what's finished in the last half hour, paler
      appliances: { bg: '#0277bd', has: () => this._scrAppliances().length > 0, build: (p) => {
        p.innerHTML = corner('Appliances', '') + '<div class="cs-scol"><div class="cs-slist" data-fit></div></div>';
        const box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const A = this._scrStable(box, this._scrAppliances(), a => a.key);
          const n = A.filter(a => a.running).length;
          c.textContent = n && n < A.length ? n + ' running' : '';
          const html = A.map(a => '<div class="cs-srow' + (a.running ? '' : ' cs-sdone') + '"><div class="cs-sic">' + (CROW_MEDIA_SCR_ICON[a.icon] || CROW_MEDIA_SCR_ICON.plug) + '</div><div class="tx"><div class="cs-slab">' + esc(a.room || '') + '</div><div class="cs-st1">' + esc(a.name) + '</div></div>'
            + '<div class="rt"><b>' + esc(a.big) + '</b>' + (a.small ? '<small>' + esc(a.small) + '</small>' : '') + '</div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // security: the alarm's state and every lock, the unlocked ones lit
      security: { bg: '#455a9e', has: () => { const x = this._scrSecurity(); return x.alarms.length > 0 || x.locks.length > 0; }, build: (p) => {
        p.innerHTML = corner('Security', '') + '<div class="cs-scol"><div class="cs-salarm"></div><div class="cs-slist cs-slocks" data-fit></div></div>';
        const al = p.querySelector('.cs-salarm'), box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const X0 = this._scrSecurity(), X = { alarms: X0.alarms, locks: this._scrStable(box, X0.locks, l => l.id) };
          const a = X.alarms[0];
          const ah = a ? '<div class="cs-sic cs-sshield' + (a.armed ? ' on' : '') + (a.alert ? ' alert' : '') + '">' + CROW_MEDIA_SCR_ICON.shield + '</div><div><div class="cs-slab">' + esc(a.name) + '</div><div class="cs-sbig">' + esc(a.label) + '</div></div>' : '';
          if (al._h !== ah) { al._h = ah; al.innerHTML = ah; al.hidden = !a; }
          const un = X.locks.filter(l => !l.locked).length;
          c.textContent = X.locks.length ? (un ? un + ' unlocked' : 'All locked') : '';
          const html = X.locks.map(l => '<div class="cs-srow' + (l.locked ? '' : ' cs-shot') + '"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON[l.locked ? 'lock' : 'unlock'] + '</div><div class="tx"><div class="cs-slab">' + esc(l.room || '') + '</div><div class="cs-st1">' + esc(l.name) + '</div></div><div class="rt"><b>' + esc(l.label) + '</b></div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // occupancy: every room with an occupancy, presence or motion sensor, the ones with someone in them lit
      occupancy: { bg: '#2f8473', has: () => this._scrOccupancy().some(r => r.on), build: (p) => {
        p.innerHTML = corner('Occupancy', '') + '<div class="cs-smap" data-fit></div>';
        const box = p.querySelector('.cs-smap'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const R = this._scrStable(box, this._scrOccupancy(), r => r.room);
          const on = R.filter(r => r.on).length;
          c.textContent = on + ' of ' + R.length + (R.length === 1 ? ' room' : ' rooms');
          const html = R.map(r => '<div' + (r.on ? ' class="on"' : '') + '><div class="tx"><div class="cs-st1">' + esc(r.room) + '</div>' + (r.on ? '<small>' + esc(r.since ? 'for ' + this._scrAgo(r.since) : 'now') + '</small>' : '') + '</div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // fans: every fan that's on (and smart plugs that run one), with its speed and whether it's oscillating
      fans: { bg: '#4f6dbf', has: () => this._scrFans().length > 0, build: (p) => {
        p.innerHTML = corner('Fans', '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>On</span></div><div class="cs-slist" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist');
        return () => {
          const F = this._scrStable(box, this._scrFans(), f => f.id);
          cnt.textContent = String(F.length);
          const html = F.map(f => '<div class="cs-srow"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON.fan + '</div><div class="tx"><div class="cs-slab">' + esc(f.room || '') + '</div><div class="cs-st1">' + esc(f.name) + '</div></div>'
            + '<div class="rt"><b>' + (f.pct === null ? 'On' : f.pct + '%') + '</b>' + (f.pct === null ? '' : '<div class="cs-sbar"><i style="width:' + Math.max(3, f.pct) + '%;background:#fff"></i></div>') + (f.osc ? '<small>Oscillating</small>' : '') + '</div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // plants: only the ones that need attention (the Plant integration's problems, or soil that's dry)
      plants: { bg: '#607d3b', has: () => this._scrPlants().length > 0, build: (p) => {
        p.innerHTML = corner('Plants', '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>Thirsty</span></div><div class="cs-slist" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const P = this._scrStable(box, this._scrPlants(), x => x.id);
          cnt.textContent = String(P.length);
          c.textContent = P.length === 1 ? '1 needs attention' : P.length + ' need attention';
          const html = P.map(x => '<div class="cs-srow"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON.leaf + '</div><div class="tx"><div class="cs-slab">' + esc(x.room || '') + '</div><div class="cs-st1">' + esc(x.name) + '</div></div>'
            + '<div class="rt"><b style="color:#ffd0c4">' + (x.pct === null ? esc(x.problem) : x.pct + '%') + '</b>' + (x.pct === null ? '' : '<div class="cs-sbar"><i style="width:' + Math.max(3, x.pct) + '%;background:#ffb4a2"></i></div><small>' + esc(x.problem) + '</small>') + '</div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // blinds and covers: what's open, and how far
      covers: { bg: '#8d6e63', has: () => this._scrCovers().open.length > 0, build: (p) => {
        p.innerHTML = corner('Blinds & Covers', '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>Open</span></div><div class="cs-slist" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const X = this._scrCovers(), O = this._scrStable(box, X.open, x => x.id);
          cnt.textContent = String(O.length);
          c.textContent = X.closed ? X.closed + ' closed' : '';
          const html = O.map(x => '<div class="cs-srow"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON.blind + '</div><div class="tx"><div class="cs-slab">' + esc(x.room || '') + '</div><div class="cs-st1">' + esc(x.name) + '</div></div>'
            + '<div class="rt"><b>' + (x.pct === null ? esc(x.label) : x.pct + '%') + '</b>' + (x.pct === null ? '' : '<div class="cs-sbar"><i style="width:' + Math.max(3, x.pct) + '%;background:#fff"></i></div>') + '</div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // robot vacuums: while one is out, its battery in a ring and what it's doing
      vacuum: { bg: '#00897b', has: () => this._scrVacuums().length > 0, build: (p) => {
        p.innerHTML = corner('Robot Vacuum', '') + '<div class="cs-sth cs-svac" data-fit></div>';
        const box = p.querySelector('.cs-sth');
        const C = 2 * Math.PI * 44;
        return () => {
          const V = this._scrStable(box, this._scrVacuums(), v => v.id);
          box.dataset.n = V.length > 6 ? 'many' : V.length > 3 ? 'some' : 'few';
          const html = V.map(v => {
            const f = v.bat === null ? 0 : Math.max(0.02, Math.min(1, v.bat / 100));
            const col = v.bat !== null && v.bat < 20 ? '#ff8a7a' : '#ffffff';
            return '<div class="cs-sthd"><div class="cs-sdial"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" style="stroke:' + col + ';stroke-dasharray:' + (f * C).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>'
              + '<div class="in"><div class="n">' + (v.bat === null ? '–' : v.bat + '%') + '</div><div class="cs-slab">Battery</div></div></div>'
              + '<div class="tx"><div class="nm">' + esc(v.name) + '</div><div class="st">' + esc(v.status) + '</div></div></div>';
          }).join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // printers: ink or toner under 20%, lowest first
      printers: { bg: '#5c6bc0', has: () => this._scrInk().length > 0, build: (p) => {
        p.innerHTML = corner('Printers', '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>Low</span></div><div class="cs-slist" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist');
        return () => {
          const I = this._scrStable(box, this._scrInk(), x => x.id);
          cnt.textContent = String(I.length);
          const html = I.map(x => '<div class="cs-srow"><div class="cs-sic">' + CROW_MEDIA_SCR_ICON.printer + '</div><div class="tx"><div class="cs-slab">' + esc(x.printer) + '</div><div class="cs-st1">' + esc(x.name) + '</div></div>'
            + '<div class="rt"><b style="color:' + (x.pct < 10 ? '#ffd0c4' : '#ffe08a') + '">' + x.pct + '%</b><div class="cs-sbar"><i style="width:' + Math.max(3, x.pct) + '%;background:' + (x.pct < 10 ? '#ff8a7a' : '#ffd36b') + '"></i></div></div></div>').join('');
          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },

      // doorbells: the picture from every doorbell camera, with when it last rang (for half an hour after); a
      // doorbell without a camera shows only while it's just rung
      doorbell: { bg: '#b85c38', has: () => this._scrDoorbells().length > 0, build: (p) => camGrid(p, 'Doorbell', () => this._scrDoorbells()) },

      // cameras: the latest picture from every camera, three to a row (doorbell
      // cameras are on the Doorbell screen instead while it's on)
      cameras: { bg: '#3e4a61', has: () => this._scrCameras().length > 0, build: (p) => camGrid(p, 'Cameras', () => this._scrCameras()) },

      // doors and windows: what's open now, each with how long it's been open (only while something is)
      open: { bg: '#e58a1f', has: () => openings().open.length > 0, build: (p) => {
        p.innerHTML = corner('Doors & Windows', '') + '<div class="cs-sopen"><div class="cs-scount"><b></b><span>Open</span></div><div class="cs-sotiles" data-fit></div></div>';
        const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-sotiles'), c = p.querySelector('.cs-scorner span:last-child');
        return () => {
          const o = openings();
          cnt.textContent = String(o.open.length);
          c.textContent = o.closed ? o.closed + ' closed' : '';
          const show = o.open;
          const html = show.map(x => '<div class="cs-sot"><div class="cs-sic cs-sic-' + x.kind + '">' + CROW_MEDIA_SCR_ICON[x.kind] + '</div><div class="tx"><div class="cs-slab">' + esc(x.room || 'Other') + '</div><div class="cs-st1">' + esc(x.name) + '</div></div><div class="dur">' + esc(this._scrAgo(x.since)) + '</div></div>').join('')

          if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
        };
      } },
    };
  },

  // The room an entity is in (its own area, or its device's), and whether it's one to leave out
  // (hidden, or a diagnostic or config entity)
  _scrArea(id) { const a = this._scrAreaId(id); return a ? (this._hass?.areas?.[a]?.name || '') : ''; },
  _scrAreaId(id) {
    const h = this._hass, reg = h?.entities?.[id];
    const areaId = reg?.area_id || (reg?.device_id ? h?.devices?.[reg.device_id]?.area_id : null);
    if (areaId && h?.areas?.[areaId]) return areaId;
    // no area set: the room its name or entity id starts with ("Living Room Temperature", sensor.living_room_…)
    const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const nm = norm(h?.states?.[id]?.attributes?.friendly_name), obj = norm(id.split('.')[1]);
    let best = '', bestId = '';
    for (const a of Object.values(h?.areas || {})) {
      const k = norm(a?.name);
      if (!k || k.length <= norm(best).length) continue;
      if (nm === k || nm.startsWith(k + '_') || obj === k || obj.startsWith(k + '_')) { best = a.name; bestId = a.area_id || Object.keys(h.areas).find(x => h.areas[x] === a) || ''; }
    }
    return bestId;
  },
  _scrSkip(id) { const reg = this._hass?.entities?.[id]; return !!(reg?.hidden || reg?.entity_category); },
  // A name without its room's at the front ("Kitchen Island Pendants" in the Kitchen: "Island Pendants")
  _scrName(id, room) {
    let n = String(this._hass?.states?.[id]?.attributes?.friendly_name || id.split('.')[1].replace(/_/g, ' '));
    if (room && n.toLowerCase().startsWith(room.toLowerCase() + ' ')) n = n.slice(room.length + 1);
    return n.charAt(0).toUpperCase() + n.slice(1);
  },
  // worked out at most every couple of seconds, and again whenever Home Assistant's states change
  _scrMemo(key, fn) {
    const h = this._hass, now = Date.now();
    if (!this._scrMemos) this._scrMemos = {};
    const m = this._scrMemos[key];
    // at most every two seconds, however often Home Assistant's states change
    if (m && now - m.at < 2000) return m.v;
    const v = fn();
    this._scrMemos[key] = { states: h?.states, at: now, v };
    return v;
  },

  // Every light (light groups are left out, so nothing is counted twice), the ones that are on brightest first
  _scrLights() {
    return this._scrMemo('lights', () => {
      const on = [];
      let off = 0;
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('light.') || this._scrSkip(id)) continue;
        if (Array.isArray(s.attributes?.entity_id) || s.attributes?.is_hue_group) continue;
        if (s.state === 'off') { off++; continue; }
        if (s.state !== 'on') continue;
        const room = this._scrArea(id);
        const b = Number(s.attributes?.brightness);
        on.push({ id, room, name: this._scrName(id, room), pct: Number.isFinite(b) ? Math.max(1, Math.round(b / 255 * 100)) : null });
      }
      on.sort((a, b) => (a.room || '￿').localeCompare(b.room || '￿') || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { on, off };
    });
  },

  // Each room with a temperature sensor (several in one room are averaged), with its humidity if it has one.
  // Sensors that aren't in a room (often outdoor ones) are left out.
  _scrRooms() {
    return this._scrMemo('rooms', () => {
      const rooms = new Map();
      const add = (room, k, v, id) => { if (!rooms.has(room)) rooms.set(room, { t: [], tIds: [], h: [], ids: [], area: this._scrAreaId(id) }); const r = rooms.get(room); r[k].push(v); r.ids.push(id); if (k === 't') r.tIds.push(id); };
      const unit = (this._hass?.config?.unit_system?.temperature || '°C');
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('sensor.') || this._scrSkip(id)) continue;
        let dc = s.attributes?.device_class;
        const u0 = String(s.attributes?.unit_of_measurement || '');
        if (!dc && (u0 === '\u00b0C' || u0 === '\u00b0F')) dc = 'temperature';
        else if (!dc && u0 === '%' && /humidity/i.test(id + ' ' + (s.attributes?.friendly_name || ''))) dc = 'humidity';
        if (dc !== 'temperature' && dc !== 'humidity') continue;
        const v = Number(s.state);
        if (!Number.isFinite(v)) continue;
        const room = this._scrArea(id);
        if (!room) continue;
        if (dc === 'temperature') {
          // in Home Assistant's own unit
          let t = v;
          const u = s.attributes?.unit_of_measurement;
          if (u === '°F' && unit === '°C') t = (v - 32) * 5 / 9;
          else if (u === '°C' && unit === '°F') t = v * 9 / 5 + 32;
          add(room, 't', t, id);
        } else add(room, 'h', v, id);
      }
      const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
      // the readings that aren't the room's air: thermostats' and radiator valves' own sensors (a device that also
      // has a thermostat), and anything named for a radiator, a valve, a chip, a battery, outdoors, water or a fridge
      const climateDevs = new Set(Object.keys(this._hass?.states || {}).filter(id => id.startsWith('climate.')).map(id => this._hass?.entities?.[id]?.device_id).filter(Boolean));
      const notAir = id => {
        const nm = id + ' ' + (this._hass?.states?.[id]?.attributes?.friendly_name || '');
        const dev = this._hass?.entities?.[id]?.device_id;
        return (dev && climateDevs.has(dev)) || /radiator|\btrv\b|valve|thermostat|heater|boiler|cpu|chip|processor|internal|device|battery|outdoor|outside|garden|soil|water|tank|fridge|freezer|oven|probe|pool|aquarium|dew|feels/i.test(nm);
      };
      for (const x of rooms.values()) {
        const air = x.tIds.map((id, i) => [id, x.t[i]]).filter(([id]) => !notAir(id));
        if (air.length) { x.t = air.map(a => a[1]); }
      }
      return [...rooms.entries()].filter(([, x]) => x.t.length).map(([room, x]) => ({ room, t: avg(x.t), h: x.h.length ? avg(x.h) : null, group: this._scrGroupName(x.ids, x.area) })).sort((a, b) => b.t - a.t);
    });
  },

  // Every thermostat: the temperature now, what it's set to, and whether it's heating, cooling or idle
  _scrClimate() {
    return this._scrMemo('climate', () => {
      const out = [];
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('climate.') || this._scrSkip(id) || s.state === 'unavailable' || s.state === 'unknown') continue;
        const a = s.attributes || {};
        const cur = Number(a.current_temperature);
        const set = Number(a.temperature), lo = Number(a.target_temp_low), hi = Number(a.target_temp_high);
        const deg = v => (Number.isInteger(v) ? v : v.toFixed(1)) + '°';
        const target = Number.isFinite(set) ? deg(set) : (Number.isFinite(lo) && Number.isFinite(hi) ? deg(lo) + '–' + deg(hi) : '');
        const action = String(a.hvac_action || '').toLowerCase();
        let status;
        if (s.state === 'off') status = 'Off';
        else if (action === 'heating' || action === 'preheating') status = target ? 'Heating to ' + target : 'Heating';
        else if (action === 'cooling') status = target ? 'Cooling to ' + target : 'Cooling';
        else if (action === 'drying') status = 'Drying';
        else if (action === 'fan') status = 'Fan';
        else status = target ? 'Idle · set to ' + target : 'Idle';
        const room = this._scrArea(id);
        out.push({ id, group: this._scrGroupName([id], this._scrAreaId(id)), name: this._scrName(id, ''), room, cur: Number.isFinite(cur) ? cur : null, action: s.state === 'off' ? 'off' : action === 'preheating' ? 'heating' : action, status });
      }
      // the ones heating or cooling first
      const rank = x => x.action === 'heating' || x.action === 'cooling' ? 0 : 1;
      return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    });
  },


  // The rest of today from the calendars chosen in the editor, asked for at most every five minutes.
  // With none chosen there's nothing to show, so the screen is passed over.
  _scrEvents() {
    const cals = (Array.isArray(this._config?.screensaver_calendars) ? this._config.screensaver_calendars : []).filter(id => this._hass?.states?.[id]);
    if (!cals.length) return null;
    const key = cals.join(',') + '|' + new Date().toDateString();
    const m = this._scrCalMemo;
    const now = Date.now();
    const keep = list => (list || []).filter(e => e.allDay || e.end > now);
    if (m && m.key === key && (now - m.at < 5 * 60000 || m.busy)) return keep(m.list);
    const list = m?.key === key ? m.list : null;
    this._scrCalMemo = { key, at: now, list, busy: true };
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const when = d => d.dateTime || d.date || d;
    Promise.all(cals.map(id => Promise.resolve(this._hass?.callApi?.('GET', 'calendars/' + id + '?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString())))
      .then(evs => (Array.isArray(evs) ? evs : []).map(e => {
        const s0 = when(e.start), e0 = when(e.end);
        const allDay = typeof s0 === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s0);
        const st = allDay ? start.getTime() : new Date(s0).getTime();
        const en = allDay ? end.getTime() : new Date(e0).getTime();
        return { title: e.summary || e.message || '', start: st, end: en, allDay, cal: this._hass?.states?.[id]?.attributes?.friendly_name || '' };
      })).catch(() => [])))
      .then(all => {
        const evs = all.flat().filter(e => e.title && e.end > start.getTime() && e.start < end.getTime())
          .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
        if (this._scrCalMemo?.key === key) this._scrCalMemo = { key, at: Date.now(), list: evs, busy: false };
      })
      .catch(() => { if (this._scrCalMemo?.key === key) this._scrCalMemo.busy = false; });
    return keep(list);
  },

  // Every timer that's running or paused: its name, how long is left (worked out to the second), and when it ends
  _scrTimers() {
    const lang = this._hass?.locale?.language || undefined;
    const h24 = this._hass?.locale?.time_format === '24';
    const secs = v => { const m = String(v || '').match(/^(?:(\d+)\s+days?,\s*)?(\d+):(\d+):(\d+)/); return m ? (Number(m[1] || 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])) : 0; };
    const out = [];
    for (const [id, s] of Object.entries(this._hass?.states || {})) {
      if (!id.startsWith('timer.') || this._scrSkip(id) || (s.state !== 'active' && s.state !== 'paused')) continue;
      const a = s.attributes || {};
      const total = secs(a.duration);
      const paused = s.state === 'paused';
      const end = a.finishes_at ? new Date(a.finishes_at).getTime() : NaN;
      const rem = secs(a.remaining);
      const left = () => paused || !Number.isFinite(end) ? rem : Math.max(0, (end - Date.now()) / 1000);
      let ends = '';
      if (Number.isFinite(end)) { try { ends = new Date(end).toLocaleTimeString(lang, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: this._hass?.locale?.time_format === '12' ? true : h24 ? false : undefined }); } catch (_) {} }
      out.push({ id, name: this._scrName(id, ''), total: total || rem, paused, left, ends });
    }
    return out.sort((a, b) => a.left() - b.left());
  },

  // The to-do lists in Home Assistant, split in two: shopping lists (by name: shopping, groceries) and the rest.
  // Their items are asked for when a list changes, and at most every couple of minutes otherwise.
  _scrTodo(kind) {
    const lists = Object.entries(this._hass?.states || {}).filter(([id, s]) => id.startsWith('todo.') && !this._scrSkip(id) && s.state !== 'unavailable')
      .filter(([id, s]) => (/shopping|grocer/i.test(id + ' ' + (s.attributes?.friendly_name || ''))) === (kind === 'shopping'));
    const items = [];
    if (!this._scrTodoMemo) this._scrTodoMemo = {};
    for (const [id, s] of lists) {
      const count = Number(s.state);
      if (!(count > 0)) continue;
      const m = this._scrTodoMemo[id];
      const stale = !m || m.count !== s.state || Date.now() - m.at > 120000;
      if (stale && !m?.busy && this._hass?.connection) {
        this._scrTodoMemo[id] = { ...(m || {}), busy: true, at: Date.now(), count: s.state };
        this._hass.connection.sendMessagePromise({ type: 'todo/item/list', entity_id: id })
          .then(r => { this._scrTodoMemo[id] = { items: (r?.items || []).filter(x => x.status !== 'completed'), at: Date.now(), count: s.state, busy: false }; })
          .catch(() => { this._scrTodoMemo[id] = { items: m?.items || [], at: Date.now(), count: s.state, busy: false }; });
      }
      const list = String(s.attributes?.friendly_name || id.slice(5));
      (this._scrTodoMemo[id]?.items || []).forEach(x => items.push({ list, title: x.summary || '', due: x.due || '' }));
    }
    return { items: items.filter(x => x.title), lists: lists.length };
  },
  _scrTodoScreen(p, kind, title, corner, esc) {
    p.innerHTML = corner(title, '') + '<div class="cs-scol"><div class="cs-scount"><b></b><span>' + (kind === 'shopping' ? 'To buy' : 'To do') + '</span></div><div class="cs-slist cs-stodo" data-fit></div></div>';
    const cnt = p.querySelector('.cs-scount b'), box = p.querySelector('.cs-slist');
    const lang = this._hass?.locale?.language || undefined;
    return () => {
      const T = this._scrTodo(kind);
      cnt.textContent = String(T.items.length);
      const many = new Set(T.items.map(x => x.list)).size > 1;
      const html = T.items.map(x => {
        let due = '';
        if (x.due) { try { const d = new Date(x.due); due = isNaN(d) ? '' : d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (_) {} }
        return '<div class="cs-srow"><div class="tx"><div class="cs-slab">' + (many ? esc(x.list) : '') + '</div><div class="cs-st1">' + esc(x.title) + '</div></div>' + (due ? '<div class="rt"><small>' + esc(due) + '</small></div>' : '') + '</div>';
      }).join('');
      if (box._h !== html) { box._h = html; this._scrPatch(box, html); }
    };
  },


  // Everything that says what something is: its entity ID, its name, its icon (set in Home Assistant, such as
  // mdi:tumble-dryer) and its device's name, model and maker. So an air fryer called "Leonard" is still found by
  // its entity ID (switch.airfryer_plug) or its icon.
  _scrText(id) {
    const h = this._hass, s = h?.states?.[id], e = h?.entities?.[id];
    const d = e?.device_id ? h?.devices?.[e.device_id] : null;
    return [id, s?.attributes?.friendly_name, e?.name, e?.icon, s?.attributes?.icon, d?.name, d?.name_by_user, d?.model, d?.manufacturer].filter(Boolean).join(' ');
  },

  // Appliances that are running, or finished in the last half hour: smart ones (a washing machine, dryer or
  // dishwasher with its own status and time left) and ones on a smart plug, which are running while the plug's
  // power (W) is over a few watts, or its energy (kWh) is going up quickly. Found by their icon, entity IDs, names
  // or device. One row per device.
  _scrAppliances() {
    return this._scrMemo('appliances', () => {
      const h = this._hass, states = h?.states || {}, now = Date.now();
      // [key, what it's called, its icon, name, watts it counts as running over]
      const kinds = [
        ['dishwasher', /dish[\s_-]*washer|geschirr/i, /dishwasher/, 'Dishwasher', 15],
        ['washer', /wash(ing)?[\s_-]*machine|washer(?![\s_-]*dryer)|lavatrice|waschmaschine/i, /washing-machine/, 'Washing Machine', 15],
        ['dryer', /tumble|(?<!hair[\s_-]*)dryer|(?<!hair[\s_-]*)drier|trockner/i, /tumble-dryer/, 'Tumble Dryer', 15],
        ['airfryer', /air[\s_-]*fryer|fryer|friteuse/i, /fryer/, 'Air Fryer', 30],
        ['kettle', /kettle|wasserkocher/i, /kettle/, 'Kettle', 100],
        ['coffee', /coffee(?![\s_-]*table)|espresso|nespresso|kaffee/i, /coffee/, 'Coffee Machine', 30],
        ['microwave', /microwave|mikrowelle/i, /microwave/, 'Microwave', 50],
        ['slowcooker', /slow[\s_-]*cooker|crock[\s_-]*pot|instant[\s_-]*pot|pressure[\s_-]*cooker/i, /pot-steam|pot-mix/, 'Slow Cooker', 20],
        ['oven', /\boven\b|_oven|oven_|\bstove\b|range[\s_-]*cooker/i, /stove|oven/, 'Oven', 50],
        ['bread', /bread[\s_-]*(maker|machine)|breadmaker/i, /bread/, 'Bread Maker', 20],
        ['ev', /ev[\s_-]*charg|wallbox|zappi|easee|ohme|car[\s_-]*charg/i, /ev-station|car-electric|ev-plug/, 'EV Charger', 500]];
      // not the appliance itself: what it costs, tariffs, solar and the like
      const not = /cost|tariff|price|rate\b|_rate|import|export|grid|solar|battery|forecast/i;
      const idle = /^(off|idle|standby|ready|stop|stopped|end|finished|complete|completed|done|power[\s_]?off|unavailable|unknown|none|inactive|0)$/i;
      const doneWord = /^(end|finished|complete|completed|done)$/i;
      const domains = /^(sensor|binary_sensor|select|switch|input_boolean)\./;
      const kindOf = (id) => {
        const e = h?.entities?.[id], icon = String(e?.icon || states[id]?.attributes?.icon || '');
        const byIcon = icon && kinds.find(k => k[2].test(icon));
        if (byIcon) return byIcon;
        const txt = this._scrText(id);
        if (not.test(id + ' ' + (states[id]?.attributes?.friendly_name || ''))) return null;
        return kinds.find(k => k[1].test(txt)) || null;
      };
      // every device (or entity without one) that's an appliance, with all of its entities
      const groups = new Map(), byDev = new Map();
      for (const id of Object.keys(states)) {
        if (!domains.test(id) || h?.entities?.[id]?.hidden) continue;
        const dev = h?.entities?.[id]?.device_id;
        if (dev) { if (!byDev.has(dev)) byDev.set(dev, []); byDev.get(dev).push(id); }
        const kind = kindOf(id);
        if (!kind) continue;
        const key = dev || ('x:' + kind[0]);
        if (!groups.has(key)) groups.set(key, { kind, ids: new Set(), dev: dev ? h?.devices?.[dev] : null, id });
        groups.get(key).ids.add(id);
      }
      for (const [key, g] of groups) if (!key.startsWith('x:')) (byDev.get(key) || []).forEach(id => g.ids.add(id));
      const out = [];
      const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
      this._scrApplSeen = this._scrApplSeen || new Map();
      for (const [key, g] of groups) {
        if (g.ids.size > 80) continue;
        let status = '', left = '', running = false, power = null, energy = null, sw = null, finishedAt = 0;
        for (const id of g.ids) {
          const s = states[id], st = String(s?.state || ''), a = s?.attributes || {};
          const dc = a.device_class, unit = a.unit_of_measurement || '', nm = id + ' ' + (a.friendly_name || '');
          if (not.test(nm)) continue;
          if (!status && (id.startsWith('sensor.') || id.startsWith('select.')) && !dc && !unit && st && !/^-?\d+(\.\d+)?$/.test(st) && /state|status|operation|cycle|phase|program|mode|job|run/i.test(nm)) {
            if (!idle.test(st)) { status = st.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()); running = true; }
            else if (doneWord.test(st)) finishedAt = Math.max(finishedAt, new Date(s.last_changed).getTime());
          }
          if (id.startsWith('binary_sensor.') && st === 'on' && /run|active|operat/i.test(id)) running = true;
          if (!left && dc === 'timestamp' && /finish|end|complet|done|remain/i.test(nm)) {
            const t = new Date(st).getTime() - now;
            if (t > 0 && t < 12 * 3600000) { left = mins(t); running = true; }
          }
          if (!left && (unit === 'min' || unit === 'h' || unit === 's' || dc === 'duration') && /remain|left|time[\s_]?to|finish/i.test(nm)) {
            const v = Number(st);
            if (Number.isFinite(v) && v > 0) { left = mins((unit === 'h' ? v * 3600 : unit === 's' ? v : v * 60) * 1000); running = true; }
          }
          if (id.startsWith('sensor.') && power === null && (dc === 'power' || /^k?W$/.test(unit))) power = id;
          if (id.startsWith('sensor.') && energy === null && (dc === 'energy' || /^k?Wh$/.test(unit))) energy = id;
          if ((id.startsWith('switch.') || id.startsWith('input_boolean.')) && sw === null) sw = id;
        }
        const thr = g.kind[4];
        let since = 0, sub = '';
        if (!running && power) {
          const r = this._scrApplMeter(power, 'power', thr);
          running = r.running; since = r.start || 0;
          if (!running && r.stop) finishedAt = Math.max(finishedAt, r.stop);
          const w = this._scrApplWatts(power);
          if (running && w > 0) sub = w >= 1000 ? (w / 1000).toFixed(2).replace(/0$/, '') + ' kW' : Math.round(w) + ' W';
        } else if (!running && energy) {
          const r = this._scrApplMeter(energy, 'energy', thr);
          running = r.running; since = r.start || 0;
          if (!running && r.stop) finishedAt = Math.max(finishedAt, r.stop);
          if (running && r.used > 0.005) sub = r.used.toFixed(2) + ' kWh used';
        } else if (!running && sw && !status) {
          // a plug that can't measure: running while it's switched on, unless it's always on
          const s = states[sw], on = s?.state === 'on', ch = new Date(s?.last_changed).getTime();
          if (on && now - ch < 6 * 3600000) { running = true; since = ch; }
        }
        // seen running in this session, and now stopped: finished
        const seen = this._scrApplSeen.get(key);
        if (running) this._scrApplSeen.set(key, { at: now });
        else if (seen && now - seen.at < 60000 && !finishedAt) finishedAt = now;
        if (!running && seen && finishedAt) this._scrApplSeen.delete(key);
        const fin = !running && finishedAt && now - finishedAt < 30 * 60000 && now - finishedAt > -60000;
        if (!running && !fin) continue;
        // its own name (Leonard), not the plug's (Smart Plug 3): else what it is (Tumble Dryer)
        const trim = n => String(n || '').replace(/\s*(smart\s*)?(plug|socket|outlet|switch|power|energy|status|state)(\s*\d+)?$/i, '').trim();
        const generic = n => !n || /\b(smart\s*)?(plug|socket|outlet|switch|power\s*strip)\b|^(tapo|kasa|shelly|sonoff|meross|tp-link|tuya)\b/i.test(n);
        const name = [g.dev?.name_by_user, g.dev?.name, /^(switch|input_boolean)\./.test(g.id) ? states[g.id]?.attributes?.friendly_name : ''].map(n => String(n || '').trim()).filter(n => n && !generic(n)).map(trim).find(Boolean)
          || [g.dev?.name_by_user, g.dev?.name, /^(switch|input_boolean)\./.test(g.id) ? states[g.id]?.attributes?.friendly_name : ''].map(trim).find(n => n && !generic(n)) || g.kind[3];
        const room = this._scrArea(g.id);
        if (running) out.push({ key, name, room, icon: g.kind[0], running: true, big: left || (since ? mins(now - since) : (status || 'On')), small: left ? (status || 'Left') : [status || 'Running', sub].filter(Boolean).join(' · '), at: since || now });
        else out.push({ key, name, room, icon: g.kind[0], running: false, big: g.kind[0] === 'kettle' ? 'Boiled' : 'Finished', small: (now - finishedAt < 60000 ? 'Just now' : mins(now - finishedAt) + ' ago'), at: finishedAt });
      }
      // running first, then the most recently finished
      return out.sort((a, b) => (b.running - a.running) || (a.running ? a.name.localeCompare(b.name) : b.at - a.at));
    });
  },
  // A meter's present reading in watts
  _scrApplWatts(id) {
    const s = this._hass?.states?.[id], v = Number(s?.state);
    return Number.isFinite(v) ? (/^kW$/.test(s?.attributes?.unit_of_measurement || '') ? v * 1000 : v) : 0;
  },
  // Whether a plug's meter says it's running: its readings over the last few hours (from Home Assistant's history
  // once, then as they change), with when this run started (or the last one stopped) and the energy it's used.
  // Power: over the threshold, with three minutes' grace for a pause (a dryer's cool-down). Energy: going up at
  // more than the threshold's rate, allowing for meters that only report every so often.
  _scrApplMeter(id, type, thr) {
    const now = Date.now();
    this._scrApplSer = this._scrApplSer || new Map();
    let ser = this._scrApplSer.get(id);
    if (!ser) { ser = { pts: [], hist: false }; this._scrApplSer.set(id, ser); this._scrApplHistory(id, type, ser); }
    const s = this._hass?.states?.[id];
    const unit = s?.attributes?.unit_of_measurement || '';
    const val = st => { const v = Number(st); return Number.isFinite(v) ? (type === 'power' ? (unit === 'kW' ? v * 1000 : v) : (unit === 'Wh' ? v / 1000 : v)) : null; };
    const t = new Date(s?.last_changed || s?.last_updated || now).getTime(), v = val(s?.state);
    const last = ser.pts[ser.pts.length - 1];
    if (v !== null && (!last || (t > last.t && v !== last.v))) ser.pts.push({ t, v });
    if (ser.pts.length > 600) ser.pts.splice(0, ser.pts.length - 600);
    ser.val = val;
    const P = ser.pts;
    if (!P.length) return { running: false };
    if (type === 'power') {
      // the stretches over the threshold, joined where they're less than three minutes apart
      let runs = [], cur = null;
      for (let i = 0; i < P.length; i++) {
        const end = i + 1 < P.length ? P[i + 1].t : now;
        if (P[i].v > thr) {
          if (cur && P[i].t - cur.end < 180000) cur.end = end;
          else { cur = { start: P[i].t, end }; runs.push(cur); }
        }
      }
      const r = runs[runs.length - 1];
      if (!r) return { running: false };
      const running = now - r.end < 180000 || (P[P.length - 1].v > thr);
      return { running, start: r.start, stop: running ? 0 : r.end };
    }
    // energy: each rise, at the rate it came in at
    const ch = [];
    for (let i = 1; i < P.length; i++) {
      const dv = P[i].v - P[i - 1].v, dt = P[i].t - P[i - 1].t;
      if (dv <= 0 || dt <= 0) { ch.push({ t: P[i].t, v: P[i].v, w: 0, dt, dv: 0 }); continue; }
      ch.push({ t: P[i].t, v: P[i].v, w: dv * 3.6e9 / dt, dt, dv });
    }
    if (!ch.length) return { running: false };
    // the last stretch of fast rises, each within a few minutes of the next
    let i = ch.length - 1;
    while (i >= 0 && ch[i].w < thr) i--;
    if (i < 0) return { running: false };
    const lastHot = ch[i];
    const gaps = [];
    let j = i;
    while (j > 0 && ch[j - 1].w >= thr && ch[j].dt < 20 * 60000) { gaps.push(ch[j].dt); j--; }
    const typical = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : lastHot.dt;
    const grace = Math.min(20 * 60000, Math.max(4 * 60000, typical * 1.6));
    // the rise that started it was measured from long before, so the start is when it would have begun at the
    // run's rate
    const first = ch[j], rate = lastHot.w;
    const start = first.t - Math.min(first.dt, (first.dv * 3.6e9) / Math.max(rate, thr));
    const before = P[P.indexOf(P.find(p => p.t === first.t)) - 1];
    const used = P[P.length - 1].v - (before ? before.v : first.v);
    // needs at least two quick rises in a row, or one rise at the threshold's rate over a short time
    if (i === j && lastHot.dt > grace) return { running: false };
    const running = now - lastHot.t < grace;
    return { running, start, stop: running ? 0 : lastHot.t, used: Math.max(0, used) };
  },
  // The last three hours of a meter's readings, from Home Assistant's history, so a dryer that was already
  // running when the screensaver came on shows how long it's been going
  _scrApplHistory(id, type, ser) {
    const h = this._hass;
    if (!h?.callApi) return;
    const start = new Date(Date.now() - 3 * 3600000).toISOString();
    h.callApi('GET', 'history/period/' + start + '?filter_entity_id=' + encodeURIComponent(id) + '&minimal_response&no_attributes').then(res => {
      const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : [];
      const val = ser.val || (st => { const v = Number(st); return Number.isFinite(v) ? v : null; });
      const pts = [];
      for (const r of rows) {
        const v = val(r.state), t = new Date(r.last_changed || r.last_updated).getTime();
        if (v === null || !Number.isFinite(t)) continue;
        if (pts.length && v === pts[pts.length - 1].v) continue;
        pts.push({ t, v });
      }
      // what's been seen since goes on the end
      const after = ser.pts.filter(p => !pts.length || p.t > pts[pts.length - 1].t);
      ser.pts = pts.concat(after);
      ser.hist = true;
      if (this._scrMemos) delete this._scrMemos.appliances;
    }).catch(() => {});
  },

  // The alarm panels and every lock: armed or not, and which locks are unlocked (or jammed)
  _scrSecurity() {
    return this._scrMemo('security', () => {
      const alarms = [], locks = [];
      const labels = { disarmed: 'Disarmed', armed_home: 'Armed home', armed_away: 'Armed away', armed_night: 'Armed night', armed_vacation: 'Armed vacation', armed_custom_bypass: 'Armed', arming: 'Arming', disarming: 'Disarming', pending: 'Pending', triggered: 'Triggered' };
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (this._scrSkip(id) || s.state === 'unavailable' || s.state === 'unknown') continue;
        if (id.startsWith('alarm_control_panel.')) alarms.push({ id, name: this._scrName(id, ''), label: labels[s.state] || s.state, armed: /^armed/.test(s.state), alert: s.state === 'triggered' || s.state === 'pending' });
        else if (id.startsWith('lock.')) {
          const room = this._scrArea(id);
          const label = { locked: 'Locked', unlocked: 'Unlocked', open: 'Open', jammed: 'Jammed', locking: 'Locking', unlocking: 'Unlocking', opening: 'Opening' }[s.state] || s.state;
          locks.push({ id, room, name: this._scrName(id, room), locked: s.state === 'locked' || s.state === 'locking', label });
        }
      }
      // the triggered alarm first; unlocked locks first
      alarms.sort((a, b) => b.alert - a.alert || b.armed - a.armed);
      locks.sort((a, b) => a.locked - b.locked || (a.room || '').localeCompare(b.room || '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { alarms, locks };
    });
  },

  // A temperature in °C (Home Assistant may be set to °F)
  _scrToC(t) { return /F/.test(this._hass?.config?.unit_system?.temperature || '') ? (t - 32) * 5 / 9 : t; },
  // The colour for a temperature: blue when cold, cyan, green when comfortable, yellow, orange, red when hot
  _scrTempColour(t) {
    const c = this._scrToC(Number(t));
    const stops = [[12, [110, 168, 255]], [16, [120, 214, 240]], [19, [140, 232, 170]], [21, [255, 224, 130]], [23, [255, 170, 100]], [26, [255, 110, 100]]];
    if (!Number.isFinite(c)) return '#ffffff';
    if (c <= stops[0][0]) return 'rgb(' + stops[0][1] + ')';
    for (let i = 1; i < stops.length; i++) {
      if (c <= stops[i][0]) {
        const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (c - t0) / (t1 - t0);
        return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',') + ')';
      }
    }
    return 'rgb(' + stops[stops.length - 1][1] + ')';
  },

  // The group something belongs to: the first Home Assistant group (group.…) that has one of its entities in it,
  // or else its room's floor. Empty when there's neither.
  _scrGroupName(ids, areaId) {
    const h = this._hass;
    if (!this._scrGroupIdx || this._scrGroupIdx.states !== h?.states) {
      const idx = new Map();
      for (const [gid, g] of Object.entries(h?.states || {})) {
        if (!gid.startsWith('group.') || this._scrSkip(gid)) continue;
        const members = g.attributes?.entity_id;
        if (!Array.isArray(members) || members.length > 60) continue;
        const name = String(g.attributes?.friendly_name || gid.slice(6).replace(/_/g, ' '));
        members.forEach(m => { if (!idx.has(m)) idx.set(m, name); });
      }
      this._scrGroupIdx = { states: h?.states, idx };
    }
    for (const id of ids) { const g = this._scrGroupIdx.idx.get(id); if (g) return g; }
    const fl = areaId ? h?.areas?.[areaId]?.floor_id : null;
    return fl ? (h?.floors?.[fl]?.name || '') : '';
  },
  // Puts new rows into a list, changing only the ones that are different, so the rest don't move or flicker
  _scrPatch(box, html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    const nw = [...t.content.children], old = [...box.children];
    if (old.length !== nw.length || old.some((o, i) => o.className !== nw[i].className || o.tagName !== nw[i].tagName)) { box.replaceChildren(...nw); return; }
    old.forEach((o, i) => { if (o.outerHTML !== nw[i].outerHTML) o.replaceWith(nw[i]); });
  },
  // Keeps a list in the order it was first shown in on this screen; anything new goes at the end
  _scrStable(memo, list, key) {
    if (!memo.order) memo.order = new Map();
    list.forEach(x => { const k = key(x); if (!memo.order.has(k)) memo.order.set(k, memo.order.size); });
    return list.slice().sort((a, b) => memo.order.get(key(a)) - memo.order.get(key(b)));
  },
  // Puts a list into its groups, in floor order (lowest first) or else by name, keeping each group's own order
  _scrGrouped(list, fn) {
    const groups = new Map();
    list.forEach(x => { const k = fn(x) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
    const level = name => { const f = Object.values(this._hass?.floors || {}).find(f => f.name === name); return f && Number.isFinite(Number(f.level)) ? Number(f.level) : null; };
    return [...groups.entries()].map(([name, items]) => ({ name, items }))
      .sort((a, b) => (!a.name) - (!b.name) || ((level(a.name) ?? 99) - (level(b.name) ?? 99)) || a.name.localeCompare(b.name));
  },


  // A picture from Home Assistant (an entity's entity_picture) as a full address
  _scrPic(pic) {
    if (!pic) return '';
    if (/^(https?:|data:)/.test(pic)) return pic;
    try { return this._hass?.hassUrl ? this._hass.hassUrl(pic) : pic; } catch (_) { return pic; }
  },

  // Each room with an occupancy or presence sensor (or a motion sensor: someone counts as there for five
  // minutes after the last movement), and whether someone's in it and since when
  _scrOccupancy() {
    return this._scrMemo('occupancy', () => {
      const rooms = new Map(), now = Date.now();
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('binary_sensor.') || this._scrSkip(id)) continue;
        const dc = s.attributes?.device_class;
        if (dc !== 'occupancy' && dc !== 'presence' && dc !== 'motion') continue;
        if (s.state === 'unavailable' || s.state === 'unknown') continue;
        const room = this._scrArea(id);
        if (!room) continue;
        const changed = new Date(s.last_changed || now).getTime();
        const on = s.state === 'on' || (dc === 'motion' && now - changed < 5 * 60000);
        if (!rooms.has(room)) rooms.set(room, { room, on: false, since: 0 });
        const r = rooms.get(room);
        if (on) { r.on = true; if (s.state === 'on' && (!r.since || changed < r.since)) r.since = changed; }
      }
      return [...rooms.values()].sort((a, b) => (b.on - a.on) || a.room.localeCompare(b.room));
    });
  },

  // Fans that are on: fan entities (with their speed and oscillation), and switches that run a fan (a smart
  // plug named for one, or given a fan icon). Switches shown as fans with Home Assistant's Switch as X are
  // already fans, and their switch is hidden, so nothing is counted twice.
  _scrFans() {
    return this._scrMemo('fans', () => {
      const out = [];
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (this._scrSkip(id) || s.state !== 'on') continue;
        const room = this._scrArea(id);
        if (id.startsWith('fan.')) {
          const p = Number(s.attributes?.percentage);
          out.push({ id, room, name: this._scrName(id, room), pct: Number.isFinite(p) && p > 0 ? Math.round(p) : null, osc: s.attributes?.oscillating === true });
        } else if (id.startsWith('switch.')) {
          const icon = this._hass?.entities?.[id]?.icon || s.attributes?.icon || '';
          if (!/\bfans?\b|_fan|fan_/i.test(this._scrText(id)) && !/mdi:fan/.test(icon)) continue;
          let name = this._scrName(id, room).replace(/\s*(smart\s*)?(plug|socket|switch|outlet)$/i, '').trim();
          out.push({ id, room, name: name || this._scrName(id, room), pct: null, osc: false });
        }
      }
      return out.sort((a, b) => (a.room || '￿').localeCompare(b.room || '￿') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    });
  },

  // Plants that need attention: the Plant integration's plants with a problem, and soil moisture sensors
  // reading under 20% (on a device that isn't already a plant)
  _scrPlants() {
    return this._scrMemo('plants', () => {
      const out = [], plantDevs = new Set();
      const states = this._hass?.states || {};
      for (const [id, s] of Object.entries(states)) {
        if (!id.startsWith('plant.') || this._scrSkip(id)) continue;
        const dev = this._hass?.entities?.[id]?.device_id;
        if (dev) plantDevs.add(dev);
        if (s.state !== 'problem') continue;
        const room = this._scrArea(id);
        const prob = String(s.attributes?.problem || 'Needs attention').split(',')[0].trim().replace(/_/g, ' ');
        const m = Number(s.attributes?.moisture);
        out.push({ id, room, name: this._scrName(id, room), pct: /moist/i.test(prob) && Number.isFinite(m) ? Math.round(m) : null, problem: prob.charAt(0).toUpperCase() + prob.slice(1) });
      }
      for (const [id, s] of Object.entries(states)) {
        if (!id.startsWith('sensor.') || this._scrSkip(id) || s.attributes?.device_class !== 'moisture' || s.attributes?.unit_of_measurement !== '%') continue;
        const dev = this._hass?.entities?.[id]?.device_id;
        if (dev && plantDevs.has(dev)) continue;
        const v = Number(s.state);
        if (!Number.isFinite(v) || v >= 20) continue;
        const room = this._scrArea(id);
        const d = dev ? this._hass?.devices?.[dev] : null;
        let name = String(d?.name_by_user || d?.name || s.attributes?.friendly_name || id.split('.')[1]).replace(/\s*(soil\s*)?moisture$/i, '').trim();
        if (room && name.toLowerCase().startsWith(room.toLowerCase() + ' ')) name = name.slice(room.length + 1);
        out.push({ id, room, name: name.charAt(0).toUpperCase() + name.slice(1), pct: Math.round(v), problem: 'Dry' });
      }
      return out.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));
    });
  },

  // Blinds, curtains, shades, shutters, awnings and windows that are open (garage doors and gates are on Doors
  // & Windows), with how far open
  _scrCovers() {
    return this._scrMemo('covers', () => {
      const open = [];
      let closed = 0;
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('cover.') || this._scrSkip(id)) continue;
        if (/^(garage|gate|door)$/.test(s.attributes?.device_class || '')) continue;
        if (s.state === 'closed' || s.state === 'closing') { closed++; continue; }
        if (s.state !== 'open' && s.state !== 'opening') continue;
        const room = this._scrArea(id);
        const pos = Number(s.attributes?.current_position);
        open.push({ id, room, name: this._scrName(id, room), pct: Number.isFinite(pos) ? Math.round(pos) : null, label: s.state === 'opening' ? 'Opening' : 'Open' });
      }
      open.sort((a, b) => (a.room || '￿').localeCompare(b.room || '￿') || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { open, closed };
    });
  },

  // Robot vacuums that are out (cleaning, returning, paused or stuck), with their battery
  _scrVacuums() {
    return this._scrMemo('vacuums', () => {
      const out = [];
      const words = { cleaning: 'Cleaning', returning: 'Returning to dock', paused: 'Paused', error: 'Needs help', idle: 'Idle' };
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('vacuum.') || this._scrSkip(id)) continue;
        if (!/^(cleaning|returning|paused|error)$/.test(s.state)) continue;
        let bat = Number(s.attributes?.battery_level);
        if (!Number.isFinite(bat)) {
          const dev = this._hass?.entities?.[id]?.device_id;
          const bs = dev ? Object.entries(this._hass?.entities || {}).find(([eid, e]) => e.device_id === dev && eid.startsWith('sensor.') && this._hass?.states?.[eid]?.attributes?.device_class === 'battery') : null;
          bat = bs ? Number(this._hass?.states?.[bs[0]]?.state) : NaN;
        }
        out.push({ id, name: this._scrName(id, ''), bat: Number.isFinite(bat) ? Math.round(bat) : null, status: words[s.state] || s.state });
      }
      return out;
    });
  },

  // Ink, toner and drums under 20%, lowest first, found by their names
  _scrInk() {
    return this._scrMemo('ink', () => {
      const out = [];
      for (const [id, s] of Object.entries(this._hass?.states || {})) {
        if (!id.startsWith('sensor.') || this._scrSkip(id) || s.attributes?.unit_of_measurement !== '%') continue;
        const nm = id + ' ' + (s.attributes?.friendly_name || '');
        if (!/\b(ink|toner|cartridge|drum)\b|_ink|_toner|_cartridge|_drum/i.test(nm)) continue;
        const v = Number(s.state);
        if (!Number.isFinite(v) || v >= 20) continue;
        const dev = this._hass?.entities?.[id]?.device_id ? this._hass?.devices?.[this._hass.entities[id].device_id] : null;
        const printer = String(dev?.name_by_user || dev?.name || 'Printer');
        let name = String(s.attributes?.friendly_name || id.split('.')[1].replace(/_/g, ' '));
        if (name.toLowerCase().startsWith(printer.toLowerCase() + ' ')) name = name.slice(printer.length + 1);
        out.push({ id, printer, name: name.charAt(0).toUpperCase() + name.slice(1), pct: Math.round(v) });
      }
      return out.sort((a, b) => a.pct - b.pct);
    });
  },

  // Whether a camera is a doorbell's: its name, entity ID or icon (set in Home Assistant, such as
  // mdi:doorbell-video), or its device's name or model, says doorbell; or its device has a doorbell event
  _scrIsBell(id) {
    const h = this._hass, s = h?.states?.[id], e = h?.entities?.[id];
    const d = e?.device_id ? h?.devices?.[e.device_id] : null;
    const txt = [id, s?.attributes?.friendly_name, s?.attributes?.icon, e?.icon, e?.name, d?.name, d?.name_by_user, d?.model].filter(Boolean).join(' ');
    if (/door[\s_-]?bell/i.test(txt)) return true;
    if (!e?.device_id) return false;
    return Object.entries(h?.entities || {}).some(([rid, re]) => re.device_id === e.device_id && rid.startsWith('event.') && h?.states?.[rid]?.attributes?.device_class === 'doorbell');
  },
  // One per camera: the same camera often turns up several times (its HomeKit, live view, snapshot and last
  // recording entities), so they're put together, by device or by name once words like those are taken off, and
  // the one with the newest picture is shown (HomeKit, before a snapshot or the last recording; live views are
  // never shown),
  // named for the camera ("Back Yard"). A doorbell when any of them is.
  _scrCamGroups() {
    return this._scrMemo('camgroups', () => {
      const h = this._hass, states = h?.states || {};
      const extra = /\b(cameras?|cam|homekit|home\s*kit|live(\s*view|\s*stream)?|stream|snapshots?|last\s*(recording|event|motion|ding|capture)|recording|still|image|picture|preview|hd|sd|high|low|main|sub|fluent|clear|rtsp)\b/gi;
      const stem = n => String(n || '').replace(/door[\s_-]*bell/gi, 'door').replace(/_/g, ' ').replace(extra, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
      const rank = n => /homekit|home\s*kit/i.test(n) ? 0 : /stream/i.test(n) ? 1 : /snapshot|last\s*(recording|event|motion|ding|capture)|recording|still/i.test(n) ? 3 : 2;
      const groups = new Map(), devKey = new Map();
      for (const [id, s] of Object.entries(states)) {
        if (!id.startsWith('camera.') || this._scrSkip(id) || s.state === 'unavailable' || !s.attributes?.entity_picture) continue;
        const full = String(s.attributes?.friendly_name || id.slice(7).replace(/_/g, ' '));
        // live views are left out
        if (/\blive\b|_live\b|live[\s_]*(view|stream)/i.test(full + ' ' + id)) continue;
        const dev = h?.entities?.[id]?.device_id;
        const st = stem(full) || stem(id.slice(7)) || id;
        // the same device, or the same name: one camera
        const key = (dev && devKey.get(dev)) || st;
        if (dev && !devKey.has(dev)) devKey.set(dev, key);
        if (!groups.has(key)) groups.set(key, { key, ids: [], bell: false });
        const g = groups.get(key);
        g.ids.push({ id, full, r: rank(full + ' ' + id) });
        if (this._scrIsBell(id)) g.bell = true;
      }
      return [...groups.values()].map(g => {
        const best = g.ids.sort((a, b) => a.r - b.r || a.full.length - b.full.length)[0];
        // the camera's own name, without the words for the kind of picture
        let name = best.full.replace(extra, ' ').replace(/\s{2,}/g, ' ').trim();
        const room = this._scrArea(best.id);
        if (room && name.toLowerCase().startsWith(room.toLowerCase() + ' ') && name.length > room.length + 1) name = name.slice(room.length + 1);
        name = name ? name.charAt(0).toUpperCase() + name.slice(1) : this._scrName(best.id, '');
        return { id: best.id, name, bell: g.bell, ids: g.ids.map(x => x.id), pic: this._scrPic(states[best.id].attributes.entity_picture) };
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    });
  },
  // Every doorbell: each doorbell camera, always, with when it rang if that was in the last half hour (from a
  // doorbell event entity, or a doorbell or ding sensor, on its device or in its room); and a doorbell with no
  // camera only for half an hour after it rings
  _scrDoorbells() {
    return this._scrMemo('doorbells', () => {
      const h = this._hass, states = h?.states || {}, now = Date.now();
      const areaOf = id => this._scrAreaId?.(id) || '';
      const devOf = id => h?.entities?.[id]?.device_id || '';
      const out = this._scrCamGroups().filter(g => g.bell)
        .map(g => ({ id: g.id, name: g.name, pic: g.pic, at: null, devs: g.ids.map(devOf).filter(Boolean), area: areaOf(g.id) }));
      for (const [id, s] of Object.entries(states)) {
        if (this._scrSkip(id)) continue;
        let at = NaN;
        if (id.startsWith('event.') && s.attributes?.device_class === 'doorbell') at = new Date(s.state).getTime();
        else if (id.startsWith('binary_sensor.') && /doorbell|\bding\b|_ding/i.test(id + ' ' + (s.attributes?.friendly_name || '')) && s.attributes?.device_class !== 'battery') at = s.state === 'on' ? now : new Date(s.last_changed).getTime() - 1;
        if (!Number.isFinite(at) || now - at > 30 * 60000 || now - at < -60000) continue;
        // its camera: on the same device, else in the same room, else the only doorbell camera there is
        const dev = devOf(id), area = areaOf(id);
        const cam = (dev && out.find(c => c.devs?.includes(dev))) || (area && out.find(c => c.area === area)) || (out.filter(c => c.pic).length === 1 ? out.find(c => c.pic) : null);
        if (cam) { if (!cam.at || at > cam.at) cam.at = at; continue; }
        const d = dev ? h?.devices?.[dev] : null;
        const name = String(d?.name_by_user || d?.name || s.attributes?.friendly_name || 'Doorbell').replace(/\s*(doorbell|ding|ring|button)$/i, '').trim() || 'Doorbell';
        out.push({ id, name, pic: '', at, devs: dev ? [dev] : [], area });
      }
      return out.sort((a, b) => (!!b.at - !!a.at) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    });
  },

  // Every camera that's working, by name (doorbell cameras are on the Doorbell screen while that's on)
  _scrCameras() {
    return this._scrMemo('cameras', () => {
      const want = Array.isArray(this._config?.screensaver_screens) && this._config.screensaver_screens.length ? this._config.screensaver_screens : null;
      const bells = !want || want.includes('doorbell');
      return this._scrCamGroups().filter(g => !(bells && g.bell)).map(g => ({ id: g.id, name: g.name, pic: g.pic, at: null }));
    });
  },


  // Every door, window, garage door and opening sensor in Home Assistant, with its room (from its own area or
  // its device's), its name without the room's, and whether it's open. Hidden and unavailable ones are left out.
  _scrOpenings() {
    const h = this._hass;
    const now = Date.now();
    if (this._scrOpenMemo && this._scrOpenMemo.states === h?.states && now - this._scrOpenMemo.at < 2000) return this._scrOpenMemo.v;
    const all = [];
    const kinds = { door: 'door', window: 'window', garage_door: 'garage', opening: 'door' };
    for (const [id, s] of Object.entries(h?.states || {})) {
      if (!id.startsWith('binary_sensor.')) continue;
      const kind = kinds[s.attributes?.device_class];
      if (!kind || s.state === 'unavailable' || s.state === 'unknown') continue;
      const reg = h.entities?.[id];
      if (reg?.hidden || reg?.entity_category) continue;
      const areaId = reg?.area_id || (reg?.device_id ? h.devices?.[reg.device_id]?.area_id : null);
      const room = areaId ? (h.areas?.[areaId]?.name || '') : '';
      let name = String(s.attributes?.friendly_name || id.split('.')[1].replace(/_/g, ' '));
      if (room && name.toLowerCase().startsWith(room.toLowerCase() + ' ')) name = name.slice(room.length + 1);
      name = name.replace(/\s+(contact|sensor|contact sensor|opening)$/i, '').trim() || name;
      name = name.charAt(0).toUpperCase() + name.slice(1);
      all.push({ id, room, name, kind, on: s.state === 'on', since: new Date(s.last_changed || now).getTime() });
    }
    const open = all.filter(x => x.on).sort((a, b) => a.since - b.since);
    const v = { all, open, closed: all.length - open.length };
    this._scrOpenMemo = { states: h?.states, at: now, v };
    return v;
  },

  _scrAgo(t) {
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min';
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    const d = Math.floor(hr / 24);
    return d + (d === 1 ? ' day' : ' days');
  },

  // A queued song's artwork: the queue's own picture, or else the album cover looked up the same way the
  // player does (Music Assistant, then Apple Music), kept for next time
  _scrArt(x) {
    let img = typeof x.image === 'string' ? x.image.trim() : '';
    if (img && !/^(https?:|data:|\/|blob:)/.test(img) && /^[A-Za-z0-9+/=\s]{100,}$/.test(img)) img = 'data:image/jpeg;base64,' + img.replace(/\s+/g, '');
    if (img && img.startsWith('/')) { try { img = this._hass?.hassUrl ? this._hass.hassUrl(img) : img; } catch (_) {} }
    if (img) return img;
    if (!x.artist && !x.title) return '';
    const key = [x.artist, x.album || x.title].filter(Boolean).join('|').toLowerCase();
    const got = this._itunesArtCache?.[key];
    if (got) return String(got);
    if (!this._itunesArtCache || !(key in this._itunesArtCache)) { try { this._fetchItunesArt?.(x.artist || '', x.album || '', x.title || '', { skipStaleGuard: true }); } catch (_) {} }
    return '';
  },

  _scrSongKey() {
    const a = this._hass?.states?.[this._entity]?.attributes || {};
    return [this._entity, a.media_title, a.media_artist, a.media_content_id].map(x => x || '').join('|');
  },

  // The next three songs in the queue (Music Assistant), looked up once for each song and kept a minute
  _scrNextFor(key) {
    const m = this._scrNextMemo;
    if (m && m.key === key && (Date.now() - m.at < 60000 || m.busy)) return m.items;
    const items = m?.key === key ? m.items : [];
    this._scrNextMemo = { key, at: Date.now(), items, busy: true };
    this._scrFetchNext().then(list => { if (this._scrNextMemo?.key === key) this._scrNextMemo = { key, at: Date.now(), items: list || [], busy: false }; })
      .catch(() => { if (this._scrNextMemo?.key === key) this._scrNextMemo.busy = false; });
    return items;
  },
  async _scrFetchNext() {
    const eid = this._entity;
    const cur = this._hass?.states?.[eid]?.attributes || {};
    const conn = this._hass?.connection;
    if (!conn || !eid) return [];
    if (this._hass?.services?.mass_queue?.get_queue_items) {
      try {
        const res = await conn.sendMessagePromise({ type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
          service_data: { entity: eid, limit_before: 1, limit_after: 3 }, return_response: true });
        const raw = res?.response?.[eid] || res?.response || [];
        if (Array.isArray(raw) && raw.length) {
          let at = raw.findIndex(x => x.active === true || x.state === 'playing');
          if (at === -1 && cur.media_content_id) at = raw.findIndex(x => (x.media_content_id || x.uri) === cur.media_content_id);
          const t = (cur.media_title || '').trim().toLowerCase();
          if (at === -1 && t) at = raw.findIndex(x => (x.media_title || x.name || '').trim().toLowerCase() === t);
          if (at >= 0) return raw.slice(at + 1, at + 4).map(x => ({ title: x.media_title || x.name || '', artist: x.media_artist || x.artist || '', album: x.media_album_name || x.album || '', image: x.media_image || x.local_image_encoded || x.thumbnail || x.image || '' })).filter(x => x.title);
        }
      } catch (_) {}
    }
    if (this._hass?.services?.music_assistant?.get_queue) {
      try {
        const res = await conn.sendMessagePromise({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: eid }, return_response: true });
        const n = (res?.response?.[eid] || {}).next_item;
        if (n) {
          const img = n.media_item?.image?.path || n.media_item?.image || n.image?.path || n.image || '';
          return [{ title: n.media_item?.name || n.name || '', artist: (n.media_item?.artists || []).map(x => x.name).join(', '), image: typeof img === 'string' ? img : '' }].filter(x => x.title);
        }
      } catch (_) {}
    }
    return [];
  },

  // The playing song's timed lyrics (the ones the card already uses), looked up once for each song
  _scrLyrics() {
    const a = this._hass?.states?.[this._entity]?.attributes || {};
    if (!a.media_artist || !a.media_title) return null;
    const e = this._lyricsCachedEntry?.(a.media_artist, a.media_title);
    if (e?.type === 'synced' && e.lines?.length) return e.lines;
    const key = (a.media_artist + '|' + a.media_title).toLowerCase();
    if (!this._scrLyrAsked) this._scrLyrAsked = new Set();
    if (!this._scrLyrAsked.has(key)) {
      this._scrLyrAsked.add(key);
      try { Promise.resolve(this._fsLyricsFetch?.(a.media_artist, a.media_title, a.media_album_name || '', Math.round(Number(a.media_duration) || 0))).catch(() => {}); } catch (_) {}
    }
    return null;
  },
});

K.ready.saver = true;
})();
