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
    el.addEventListener('click', (e) => { if (el._lpFired) { e.preventDefault(); e.stopPropagation(); return; } close(e); });
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

  _saverStop(now = false) {
    clearInterval(this._saverShuffleT); clearInterval(this._saverClockT); this._saverShuffleT = this._saverClockT = null;
    this._saverClearStyle();
    const el = this._saverEl;
    this._saverEl = null;
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
    else this._saverWall(stage);
    // styles that already show the time don't get the small clock
    if (!['clock', 'flip', 'analog', 'words'].includes(style) && this._config?.screensaver_clock !== false) {
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
  }
});

K.ready.saver = true;
})();
