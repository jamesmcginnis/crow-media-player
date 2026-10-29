/*
 * Crow Media Player — full screen
 * Part of the Crow Media Player card, in a file of its own so it's only downloaded when it's first used.
 * Loaded by the card (crow-media-player-card.js); not a dashboard resource.
 */
(() => {
'use strict';
const K = window.CrowMediaKit;
if (!K || !K.Card || K.ready.fullscreen) return;
const { CROW_MEDIA_FS_ICONS, crowFetch } = K.kit;
// the remote button's icon until the one chosen in the editor is known (see _fsUpdate)
const FS_REMOTE = 'M17 5H7a5 5 0 0 0-5 5v4a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5v-4a5 5 0 0 0-5-5zm-8 9H7v-2h2v2zm0-4H7V8h2v2zm4 6h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V6h2v2zm4 8h-2v-6h2v6z';
// ── Full screen: its styles ──
const CROW_MEDIA_FS_CSS = `
#cardOuter[data-crow-fs] { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important;
  max-width: none !important; max-height: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  border-radius: 0 !important; box-shadow: none !important; overflow: hidden !important; transform: none !important; z-index: 2147483000 !important;
  background: #000 !important; color: #fff !important;
  /* no glass edge anywhere around the screen: the card's frosted blur (which iPhones and iPads draw as a faint light line
     along the edges of something that fills the screen), and Home Assistant's own card outline and rounding */
  backdrop-filter: none !important; -webkit-backdrop-filter: none !important; outline: 0 !important;
  --ha-card-border-width: 0px; --ha-card-border-color: transparent; --ha-card-border-radius: 0px; --ha-card-box-shadow: none; }
#cardOuter[data-crow-fs] > #skTb, #cardOuter[data-crow-fs] > #modeBtnAbs, #cardOuter[data-crow-fs] > #artClick,
#cardOuter[data-crow-fs] > .content, #cardOuter[data-crow-fs] > #cmpFsBtn { visibility: hidden !important; pointer-events: none !important; }
/* panels opened from full screen (the info screen, the library) fill the whole screen, clear of the notch and home bar */
#cardOuter[data-crow-fs] > #maPopup, #cardOuter[data-crow-fs] > #infoPopup { inset: 0 !important; width: auto !important; height: auto !important; max-width: none !important; max-height: none !important;
  border-radius: 0 !important; box-sizing: border-box !important; z-index: 60 !important; box-shadow: none !important;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) !important;
  /* square edges: the rounded-corner mask the panels use on the card leaves a faint seam on iPhones and iPads */
  -webkit-mask-image: none !important; mask-image: none !important; border: 0 !important; outline: 0 !important; }
#cardOuter[data-crow-fs] > #crowToast { z-index: 90 !important; }
/* Glass toasts in full screen: the same glass capsule, without a live blur. On iPhones and iPads the blur behind a toast
   here could only see full screen's black base, not the scene, which turned the capsule nearly black; full screen's
   background is already a soft blur, so a see-through tint looks the same as everywhere else. */
:host(.crow-glass) #cardOuter[data-crow-fs] > #crowToast {
  backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  background: linear-gradient(160deg, rgba(255,255,255,0.24), rgba(255,255,255,0.1)), rgba(24,24,28,0.42) !important;
  border: 1px solid rgba(255,255,255,0.28) !important; }
/* a long press on the artwork opens the main player's own lyrics screen, filling the screen (a tap closes it) */
#cardOuter[data-crow-fs][data-crow-fs-lyr] > #artClick { visibility: visible !important; pointer-events: auto !important; position: absolute !important; inset: 0 !important;
  width: auto !important; height: auto !important; max-width: none !important; aspect-ratio: auto !important; margin: 0 !important; border-radius: 0 !important;
  transform: none !important; z-index: 55 !important; background: transparent !important; }
#cardOuter[data-crow-fs][data-crow-fs-lyr] > #artClick::after { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-lyr] > #artClick > :not(#lyricsOverlay) { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-lyr] #lyricsOverlay { border-radius: 0 !important;
  padding: max(12px, env(safe-area-inset-top)) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); box-sizing: border-box; }
/* the Apple TV remote, when it's open (the main player's own remote; a hold on the artwork again, a hold on an empty
   part of the remote, the Remote button again or Escape closes it). Where it goes depends on the screen (data-crow-fs-rem):
   - "col3": a tablet on its side: a third panel, beside the player and the info
   - "art": a phone held upright (or a tablet held upright): in the artwork's place, as on the main player, with the
     title and controls under it; the info is hidden while it's open
   - "side": a phone on its side: in the info's place (there's no room for a third panel)
   It's placed over that spot from the spot's own position (--cfs-r*). */
#cardOuter[data-crow-fs][data-crow-fs-rem] > #artClick { visibility: visible !important; pointer-events: auto !important; position: absolute !important;
  left: var(--cfs-rx, 0px) !important; top: var(--cfs-ry, 0px) !important; width: var(--cfs-rw, 100%) !important; height: var(--cfs-rh, 100%) !important;
  right: auto !important; bottom: auto !important; max-width: none !important; max-height: none !important; aspect-ratio: auto !important; margin: 0 !important;
  border-radius: 20px !important; overflow: hidden !important; transform: none !important; z-index: 45 !important;
  background: transparent !important; box-shadow: none !important; }
/* it sits straight on full screen's own background: no blurred artwork behind it, no ✕ (a hold closes it), and the
   touchpad and buttons in full screen's own frosted white, like the corner buttons and the Up Next bar */
#cardOuter[data-crow-fs][data-crow-fs-rem] #remoteBlurBg, #cardOuter[data-crow-fs][data-crow-fs-rem] #clickpadBlurBg,
#cardOuter[data-crow-fs][data-crow-fs-rem] #remoteCloseBtn { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] #remoteOverlay { background: transparent !important; }
/* Apps: straight on full screen's own background too (no dark box), with the remote hidden underneath while it's open */
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-apps-dropdown.r-apps-grid { background: transparent !important; box-shadow: none !important;
  backdrop-filter: none !important; -webkit-backdrop-filter: none !important; border: 0 !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] #remoteOverlay:has(> .r-apps-grid:not(.hidden)) > :not(.r-apps-grid) { visibility: hidden !important; }
/* no "Apps" heading over the grid in full screen: just the ✕, on the right */
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-ag-title { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-ag-close { background: rgba(255,255,255,0.1) !important; border-color: rgba(255,255,255,0.14) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-ag-search-input { background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.12) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .clickpad { background: rgba(255,255,255,0.08) !important; border: 1px solid rgba(255,255,255,0.12) !important;
  box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .clickpad.pressed { background: rgba(255,255,255,0.14) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .clickpad .cp-select { background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.14) !important; box-shadow: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-btn-circle { background: rgba(255,255,255,0.1) !important; border: 1px solid rgba(255,255,255,0.14) !important;
  box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-btn-circle svg { fill: rgba(255,255,255,0.88) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-pill-btn:active .r-btn-circle,
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-pill-btn.pressed .r-btn-circle,
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-apps-btn.r-apps-open .r-btn-circle { background: rgba(255,255,255,0.2) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-power-btn .r-btn-circle svg { fill: #FF453A !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-btn-label { color: rgba(255,255,255,0.6) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] .r-hint { color: rgba(255,255,255,0.55) !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] > #artClick::after { display: none !important; }
/* a skin's touches on the main player's artwork (Zune's coloured bar along the bottom, the borders of Winamp, iTunes,
   Windows and the rest) aren't carried into full screen's remote or lyrics screen */
#cardOuter[data-crow-fs][data-crow-fs-rem] > #artClick::before, #cardOuter[data-crow-fs][data-crow-fs-lyr] > #artClick::before { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] > #artClick, #cardOuter[data-crow-fs][data-crow-fs-lyr] > #artClick { border: 0 !important; outline: 0 !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] > #artClick > :not(#remoteOverlay) { display: none !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem] #remoteOverlay { border-radius: 0 !important; }
/* beside the player (a tablet or a phone on its side): the remote runs from the top of the artwork to the bottom of
   the player (see _fsRemPlace), and the touchpad grows to fill it, so its top lines up with the artwork's. The room
   kept above the touchpad for the remote's ✕ isn't needed here (full screen hides the ✕), so it goes too (the
   card sets that room on the panel itself, hence !important) */
#cardOuter[data-crow-fs][data-crow-fs-rem="col3"] #remoteOverlay .remote-panel,
#cardOuter[data-crow-fs][data-crow-fs-rem="side"] #remoteOverlay .remote-panel { width: 100%; height: 100%; margin: 0 auto; padding: 0 !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem="col3"] #remoteOverlay .remote-panel { width: min(100%, 460px); }
/* the third panel: the space the remote sits in, after the info; the artwork gives up a little room for it */
.cfs-rpanel { display: none; flex: 0 0 auto; align-self: stretch; width: clamp(300px, 30vw, 440px); }
#cardOuter[data-crow-fs-rem="col3"] .cfs-rpanel { display: block; }
#cardOuter[data-crow-fs-rem="col3"] #crowFs { --cfs-art: max(160px, min(calc(100vh - 430px), 27vw, 520px)); }
@supports (height: 100dvh) { #cardOuter[data-crow-fs-rem="col3"] #crowFs { --cfs-art: max(160px, min(calc(100dvh - 430px), 27vw, 520px)); } }
/* in the artwork's place: the artwork grows to the size it is on the main player, and the info steps aside */
#cardOuter[data-crow-fs][data-crow-fs-rem="art"] > #artClick { border-radius: 18px !important; }
#cardOuter[data-crow-fs][data-crow-fs-rem="art"] #remoteOverlay .remote-panel { padding: 0; }
#cardOuter[data-crow-fs-rem="art"] #crowFs { --cfs-art: max(220px, min(88vw, calc(100vh - 400px), 600px)); }
@supports (height: 100dvh) { #cardOuter[data-crow-fs-rem="art"] #crowFs { --cfs-art: max(220px, min(88vw, calc(100dvh - 400px), 600px)); } }
#cardOuter[data-crow-fs-rem="art"] .cfs-side { display: none; }
#cardOuter[data-crow-fs-rem="art"] .cfs-art { visibility: hidden; }
/* the remote's spot takes all the height the title, progress and controls don't need (no empty space above it),
   so the touchpad is as big as the screen allows; it never gets shorter than the square it started as */
#cardOuter[data-crow-fs-rem="art"] .cfs-main { justify-content: flex-start; }
#cardOuter[data-crow-fs-rem="art"] .cfs-player { flex: 1 1 auto; min-height: 0; width: min(600px, 88vw); }
#cardOuter[data-crow-fs-rem="art"] .cfs-art { width: 100%; height: auto; flex: 1 1 auto; min-height: min(var(--cfs-art), 100%); max-height: 820px; }
/* in the info's place: the info underneath isn't shown */
#cardOuter[data-crow-fs][data-crow-fs-rem="side"] .cfs-side { visibility: hidden; }
/* the Remote button lights up while the remote is open */
.cfs-circ.on { color: var(--btn-active-color, var(--accent, #007AFF)); background: rgba(255,255,255,0.14); }
#crowFs { position: absolute; inset: 0; z-index: 40; overflow: hidden; color: #fff; -webkit-user-select: none; user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, system-ui, sans-serif;
  background: radial-gradient(900px 700px at 20% 30%, rgba(88,86,214,0.45), transparent 70%), radial-gradient(900px 700px at 85% 15%, rgba(255,45,85,0.28), transparent 70%), #0b0a10;
  --cfs-art: max(160px, min(calc(100vh - 430px), 40vw, 620px)); }
@supports (height: 100dvh) { #crowFs { --cfs-art: max(160px, min(calc(100dvh - 430px), 40vw, 620px)); } }
#crowFs [hidden] { display: none !important; }
/* no iPhone image menu (Share, Save to Photos…) on a long press, the same as the main player's artwork */
#crowFs, #crowFs * { -webkit-touch-callout: none; }
#crowFs img { -webkit-user-drag: none; user-drag: none; pointer-events: none; }
#crowFs button { font-family: inherit; -webkit-tap-highlight-color: transparent; }
.cfs-bg { position: absolute; inset: 0; overflow: hidden; }
.cfs-bgimg { position: absolute; left: -12%; top: -12%; width: 124%; height: 124%; object-fit: cover; filter: blur(70px) saturate(1.5) brightness(0.72); animation: cfs-drift 40s ease-in-out infinite alternate; }
@keyframes cfs-drift { from { transform: scale(1.1) translate(-2%, -1%); } to { transform: scale(1.2) translate(2%, 1.5%); } }
@media (prefers-reduced-motion: reduce) { .cfs-bgimg { animation: none; } }
/* Animated Background (editor → Appearance, off by default): while something plays, several big, blurred copies of
   the artwork turn and drift slowly on their own paths, so its colours swirl behind everything, like the Apple TV's
   music background. It fades in over the plain background and back out when playing stops (it keeps moving while it
   fades, data-flow-run). Composited transforms only, so it's light on tablets and kiosks. Never for an app's icon. */
.cfs-flow { position: absolute; inset: 0; opacity: 0; transition: opacity 1.6s ease; pointer-events: none; }
#crowFs[data-flow] .cfs-flow { opacity: 1; }
#crowFs[data-flow].cfs-flow-swap .cfs-flow { opacity: 0; transition: opacity 0.7s ease; }
.cfs-fl { position: absolute; width: 95vmax; height: 95vmax; object-fit: cover; border-radius: 50%; will-change: transform;
  filter: blur(64px) saturate(1.7) brightness(0.78); }
.cfs-fl[hidden] { display: none; }
.cfs-fl1 { left: -30vmax; top: -38vmax; animation: cfs-fl-a 42s linear infinite; }
.cfs-fl2 { right: -38vmax; top: -22vmax; animation: cfs-fl-b 51s linear infinite; }
.cfs-fl3 { left: -20vmax; bottom: -42vmax; animation: cfs-fl-c 58s linear infinite; }
.cfs-fl4 { right: -28vmax; bottom: -36vmax; animation: cfs-fl-d 67s linear infinite; opacity: 0.85; }
/* at rest unless it's showing (the layers' own animation shorthand would otherwise set them running) */
#crowFs .cfs-fl { animation-play-state: paused; }
#crowFs[data-flow-run] .cfs-fl { animation-play-state: running; }
/* behind full screen's lyrics screen nobody sees it, so it rests */
#cardOuter[data-crow-fs-lyr] #crowFs .cfs-fl { animation-play-state: paused; }
@keyframes cfs-fl-a { 0% { transform: rotate(0deg) translate(0, 0) scale(1); } 50% { transform: rotate(180deg) translate(9vmax, 6vmax) scale(1.18); } 100% { transform: rotate(360deg) translate(0, 0) scale(1); } }
@keyframes cfs-fl-b { 0% { transform: rotate(0deg) translate(0, 0) scale(1.1); } 50% { transform: rotate(-180deg) translate(-10vmax, 8vmax) scale(0.95); } 100% { transform: rotate(-360deg) translate(0, 0) scale(1.1); } }
@keyframes cfs-fl-c { 0% { transform: rotate(0deg) translate(0, 0) scale(0.95); } 50% { transform: rotate(180deg) translate(8vmax, -9vmax) scale(1.15); } 100% { transform: rotate(360deg) translate(0, 0) scale(0.95); } }
@keyframes cfs-fl-d { 0% { transform: rotate(0deg) translate(0, 0) scale(1.05); } 50% { transform: rotate(-180deg) translate(-8vmax, -7vmax) scale(1.2); } 100% { transform: rotate(-360deg) translate(0, 0) scale(1.05); } }
@media (prefers-reduced-motion: reduce) { .cfs-flow { display: none; } }
.cfs-bgshade { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 30%, rgba(0,0,0,0.05), rgba(0,0,0,0.45)), rgba(10,8,18,0.25); }
/* just the quick menu and exit buttons, top right */
.cfs-top { position: absolute; top: 0; right: 0; z-index: 5; display: flex; align-items: center; gap: 0;
  padding: max(15px, env(safe-area-inset-top)) max(28px, env(safe-area-inset-right)) 0 0; }
/* the quick menu and exit buttons: one capsule with a thin line between them, the same as the
   player's Full Screen and resize buttons (38px tall, 34px buttons; each still a 44px tap area) */
.cfs-cap { display: flex; align-items: center; height: 38px; padding: 0 3px; border-radius: 19px; box-sizing: border-box;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.14); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.cfs-cap-sep { width: 1px; height: 19px; background: rgba(255,255,255,0.22); flex-shrink: 0; }
.cfs-circ { position: relative; width: 34px; height: 34px; border: none; background: none; padding: 0; border-radius: 50%; color: rgba(255,255,255,0.88);
  display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 0.2s ease; }
.cfs-circ::after { content: ''; position: absolute; inset: -5px 0; }
.cfs-circ:hover { background: rgba(255,255,255,0.08); }
.cfs-circ:active svg { opacity: 0.6; }
.cfs-circ svg { position: relative; width: 15px; height: 15px; fill: currentColor; }
.cfs-main { position: absolute; inset: 0; box-sizing: border-box; display: flex; align-items: center; gap: clamp(28px, 4.5vw, 72px);
  padding: calc(max(18px, env(safe-area-inset-top)) + 60px) max(40px, 4vw) max(30px, env(safe-area-inset-bottom)) max(40px, 4vw); }
.cfs-player { flex: 0 0 auto; width: max(var(--cfs-art), 300px); display: flex; flex-direction: column; gap: 16px; }
.cfs-art { width: var(--cfs-art); height: var(--cfs-art); border-radius: 18px; overflow: hidden; position: relative; flex-shrink: 0; cursor: pointer;
  background: rgba(255,255,255,0.08); box-shadow: 0 30px 80px rgba(0,0,0,0.55); transition: opacity 0.4s ease, transform 0.15s ease; -webkit-tap-highlight-color: transparent; }
.cfs-art:active { transform: scale(0.98); }
.cfs-artimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cfs-artph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.cfs-artph svg { width: 30%; height: 30%; fill: rgba(255,255,255,0.3); }
/* an app on an Apple TV (Netflix…) with no picture of its own: its icon, centred, as in the main player */
.cfs-art.cfs-appicon .cfs-artimg { inset: 0; margin: auto; width: 46%; height: 46%; border-radius: 22%; box-shadow: 0 14px 44px rgba(0,0,0,0.5); }
.cfs-art.cfs-appicon .cfs-artph svg { visibility: hidden; }
/* an app with no running time: no progress bar or times (they'd only say "Live" and repeat the app's name) */
.cfs-noprog .cfs-prog { visibility: hidden; }
/* the app's icon at the top of what's shown beside the player */
.cfs-iicon { width: 64px; height: 64px; border-radius: 22%; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.4); margin-bottom: 6px; }
.cfs-title { font-size: clamp(20px, 2.4vw, 30px); font-weight: 800; letter-spacing: -0.5px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfs-subt { font-size: clamp(15px, 1.6vw, 19px); color: rgba(255,255,255,0.72); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfs-bar { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.2); cursor: pointer; }
.cfs-bar::before { content: ''; position: absolute; left: 0; right: 0; top: -14px; bottom: -14px; }
.cfs-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: #fff; transition: width 0.5s linear; }
.cfs-live .cfs-fill { width: 100% !important; opacity: 0.35; }
.cfs-times { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.62); margin-top: 8px; font-variant-numeric: tabular-nums; }
.cfs-app { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfs-ctrls { display: flex; align-items: center; justify-content: space-between; padding: 0 2px; }
.cfs-b { width: 64px; height: 64px; border: none; background: none; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.cfs-b svg { width: 40px; height: 40px; fill: currentColor; }
.cfs-b:active { transform: scale(0.92); }
.cfs-small { width: 48px; height: 48px; color: rgba(255,255,255,0.7); }
.cfs-small svg { width: 24px; height: 24px; }
.cfs-small.on { color: var(--btn-active-color, var(--accent, #007AFF)); opacity: var(--btn-active-opacity, 1); background: rgba(255,255,255,0.14); }
/* films and shows: back and forward 15 seconds where shuffle and repeat would be */
.cfs-skip text { font: 700 6.6px -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif; fill: currentColor; }
.cfs-play { width: 84px; height: 84px; background: #fff; color: #14101f; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
.cfs-vol { display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.6); }
.cfs-vol svg { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; }
.cfs-volr { flex: 1; min-width: 0; height: 28px; accent-color: #fff; cursor: pointer; }
/* the lyrics take all the room beside (or under) the player, with the next song at the bottom */
.cfs-side { flex: 1 1 auto; min-width: 0; align-self: stretch; display: flex; flex-direction: column; gap: 14px; }
.cfs-panel { position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain;
  -webkit-mask-image: linear-gradient(transparent, #000 16%, #000 84%, transparent); mask-image: linear-gradient(transparent, #000 16%, #000 84%, transparent); }
.cfs-panel::-webkit-scrollbar { display: none; }
.cfs-lpad { height: 50%; }
/* lines are never re-sized while they play: the current line is scaled up (set per frame), so nothing re-flows */
.cfs-line { font-size: clamp(24px, 3vw, 40px); font-weight: 800; letter-spacing: -0.6px; line-height: 1.2; color: rgba(255,255,255,0.3); padding: 10px 6%;
  text-align: center; transform-origin: 50% 50%; transition: color 0.45s ease; }
.cfs-line.past { color: rgba(255,255,255,0.38); }
.cfs-line.on { color: #fff; text-shadow: 0 0 24px rgba(255,255,255,0.25); }
.cfs-plain { white-space: pre-line; text-align: center; font-size: clamp(18px, 2vw, 24px); font-weight: 600; line-height: 1.5; color: rgba(255,255,255,0.85); padding: 24px 0; }
/* messages (nothing playing, finding the lyrics, none found) sit in the middle of the lyrics area */
.cfs-lmsg { min-height: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center;
  font-size: clamp(15px, 1.6vw, 19px); color: rgba(255,255,255,0.6); padding: 0 8%; }   /* the same size as the artist line under the title */
.cfs-next { flex-shrink: 0; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; padding: 10px 8px; border-radius: 14px;
  background: transparent; border: 0; color: #fff; text-align: left; font-size: inherit; cursor: pointer; transition: background 0.2s ease, transform 0.15s ease; }
/* no box: the next song sits straight on the background, like the rest of full screen; a faint tint only while it's touched */
.cfs-next:hover { background: rgba(255,255,255,0.06); }
.cfs-next:active { background: rgba(255,255,255,0.08); }
.cfs-next:active { transform: scale(0.98); }
.cfs-nextart { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.1); flex-shrink: 0; }
.cfs-nextart img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cfs-nexttx { min-width: 0; flex: 1 1 auto; }
.cfs-nextl { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: rgba(255,255,255,0.6); }
.cfs-nextt { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfs-nextchev { width: 20px; height: 20px; fill: rgba(255,255,255,0.45); flex-shrink: 0; }
.cfs-stopped .cfs-art { opacity: 0.6; }
/* sleep timer: a small pill beside the corner buttons with the time left; tap to change or turn it off */
.cfs-sleep { height: 38px; margin: 0 8px 0 0; padding: 0 13px 0 10px; border-radius: 19px; border: 1px solid rgba(255,255,255,0.14); box-sizing: border-box; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9);
  display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; white-space: nowrap;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.cfs-sleep svg { width: 15px; height: 15px; fill: #FFD60A; flex-shrink: 0; }
.cfs-sleep:active { transform: scale(0.94); }
/* the artwork: swipe to skip, double-tap to pin; the pinned badge sits in its corner */
.cfs-art { touch-action: pan-y; }
.cfs-pinb { position: absolute; left: 10px; bottom: 10px; z-index: 2; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.18); padding: 0;
  background: rgba(0,0,0,0.58); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.cfs-pinb svg { width: 14px; height: 14px; fill: #FFD60A; }
.cfs-heart { position: absolute; z-index: 3; pointer-events: none; line-height: 0; }
.cfs-heart svg { width: 100%; height: 100%; }
/* volume: tap the speaker to mute; the level beside the slider */
.cfs-mute { width: 36px; height: 36px; margin: -4px -6px -4px -8px; padding: 0; border: none; background: none; border-radius: 50%; color: rgba(255,255,255,0.6);
  display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.cfs-mute svg { width: 20px; height: 20px; fill: currentColor; }
.cfs-mute.on { color: #fff; }
.cfs-mute:active { transform: scale(0.9); }
.cfs-volp { min-width: 40px; text-align: right; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.62); font-variant-numeric: tabular-nums; }
.cfs-vol.muted .cfs-volr { opacity: 0.4; }
/* what's playing, when there are no lyrics: a heading, the title, a short description and a few facts */
.cfs-info { min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  padding: 18px 4% 22px; gap: 6px; cursor: pointer; -webkit-tap-highlight-color: transparent; outline: none; }
.cfs-info.has-ch { justify-content: flex-start; }
.cfs-ih { font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: rgba(255,255,255,0.55); }
.cfs-it { font-size: clamp(18px, 2.2vw, 26px); font-weight: 800; letter-spacing: -0.3px; line-height: 1.2; color: #fff; max-width: 100%; }
.cfs-is { font-size: clamp(14px, 1.5vw, 17px); color: rgba(255,255,255,0.65); max-width: 100%; }
.cfs-id { margin-top: 6px; font-size: clamp(14px, 1.5vw, 17px); line-height: 1.5; color: rgba(255,255,255,0.8); max-width: 640px;
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.cfs-if { margin-top: 4px; font-size: clamp(15px, 1.6vw, 19px); line-height: 1.45; color: rgba(255,255,255,0.72); max-width: 640px; }
.cfs-if span { display: inline-block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.cfs-info { max-width: 100%; }
.cfs-info > * { max-width: min(640px, 100%); box-sizing: border-box; }
.cfs-it, .cfs-is { overflow-wrap: anywhere; }
.cfs-if2 { margin-top: 2px; font-size: clamp(13px, 1.3vw, 16px); color: rgba(255,255,255,0.5); }
/* a film or show: who's in it, under the overview */
.cfs-icast { margin-top: 8px; font-size: clamp(13px, 1.3vw, 16px); line-height: 1.45; color: rgba(255,255,255,0.55); }
/* the facts come before the overview, so they get a little room under the title */
.cfs-is + .cfs-if { margin-top: 8px; }
/* the info only fades at the very edges of its area, so a title at the top is never faded out */
.cfs-panel:has(> .cfs-info) { -webkit-mask-image: linear-gradient(transparent, #000 4%, #000 96%, transparent); mask-image: linear-gradient(transparent, #000 4%, #000 96%, transparent); }
/* the line under the player's title keeps its height while it's empty, so nothing jumps when it fills in */
.cfs-subt { min-height: 1.25em; }
.cfs-chl { margin-top: 12px; width: 100%; max-width: 640px; display: flex; flex-direction: column; }
.cfs-chmsg { padding: 14px 0; font-size: 14px; color: rgba(255,255,255,0.55); }
.cfs-ch { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 6px; border: none; border-bottom: 1px solid rgba(255,255,255,0.08); background: none; color: #fff; text-align: left; cursor: pointer; font-size: 15px; }
.cfs-ch .n { width: 24px; flex-shrink: 0; text-align: center; font-weight: 700; color: rgba(255,255,255,0.35); }
.cfs-ch .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.cfs-ch .d { flex-shrink: 0; font-size: 13px; color: rgba(255,255,255,0.5); font-variant-numeric: tabular-nums; }
.cfs-ch.on { background: rgba(255,255,255,0.1); border-radius: 10px; border-bottom-color: transparent; }
.cfs-ch.on .n, .cfs-ch.on .d { color: var(--btn-active-color, var(--accent, #007AFF)); }
/* translations sit under their line, smaller */
.cfs-tr { display: block; margin-top: 4px; font-size: 0.5em; font-weight: 600; letter-spacing: 0; color: rgba(255,255,255,0.55); }
.cfs-pr { display: block; margin-top: 4px; font-size: 0.42em; font-weight: 500; font-style: italic; letter-spacing: 0; color: rgba(255,255,255,0.45); }
.cfs-line.on .cfs-tr { color: rgba(255,255,255,0.75); }
/* the editor's lyrics scroll setting: Scroll and None show every line at full brightness */
.cfs-lyrics[data-mode="scroll"] .cfs-line, .cfs-lyrics[data-mode="none"] .cfs-line { color: #fff; }
/* portrait: artwork and controls on top, the panel underneath */
@media (max-aspect-ratio: 4/5) {
  #crowFs { --cfs-art: max(160px, min(64vw, calc(100vh - 700px))); }
  .cfs-main { flex-direction: column; align-items: center; gap: 22px; padding-top: calc(max(18px, env(safe-area-inset-top)) + 62px); }
  .cfs-player { width: min(600px, 86vw); align-items: center; }
  .cfs-meta { text-align: center; max-width: 100%; }
  .cfs-prog, .cfs-ctrls, .cfs-vol { align-self: stretch; }
  .cfs-side { width: 100%; max-width: 760px; align-self: center; flex: 1 1 0; min-height: 160px; }
  .cfs-line { font-size: clamp(22px, 4.2vw, 34px); }
  .cfs-id { -webkit-line-clamp: 4; }
}
@supports (height: 100dvh) { @media (max-aspect-ratio: 4/5) { #crowFs { --cfs-art: max(160px, min(64vw, calc(100dvh - 700px))); } } }
/* short landscape screens (a phone on its side) */
@media (max-height: 560px) and (min-aspect-ratio: 4/5) {
  #crowFs { --cfs-art: max(120px, min(calc(100vh - 300px), 34vw)); }
  .cfs-main { padding-top: 60px; gap: 28px; }
  .cfs-player { gap: 10px; width: max(var(--cfs-art), 270px); }
  /* the artwork is narrower than the controls here: it (and the title under it) sit in the middle of them */
  .cfs-art { align-self: center; }
  .cfs-meta { text-align: center; }
  .cfs-vol { display: none; }
  .cfs-meta .cfs-title { font-size: 18px; } .cfs-subt, .cfs-lmsg { font-size: 14px; }
  .cfs-b { width: 50px; height: 50px; } .cfs-b svg { width: 30px; height: 30px; }
  .cfs-play { width: 60px; height: 60px; } .cfs-small { width: 40px; height: 40px; }
  .cfs-line { font-size: clamp(18px, 2.6vw, 28px); }
}
`;

Object.assign(K.Card.prototype, {
  _fsEnter() {
    if (this._fs || !this._fsOn() || !this.isConnected) return;
    const r = this.shadowRoot, card = r?.getElementById('cardOuter');
    if (!card) return;
    try {
      this._fsWasCompact = card.classList.contains('mode-compact');
      // the card keeps its place on the dashboard while it's away
      this._fsOldMin = this.style.minHeight;
      this.style.minHeight = Math.round(this.getBoundingClientRect().height) + 'px';
      if (this._fsWasCompact) card.classList.remove('mode-compact');   // menus and panels need the full-size card
      if (!r.getElementById('crowFsCss')) {
        const st = document.createElement('style');
        st.id = 'crowFsCss';
        st.textContent = CROW_MEDIA_FS_CSS;
        r.appendChild(st);
      }
      this._fs = true;
      card.setAttribute('data-crow-fs', '');
      this._fsBuild(card);
      let top = false;
      if (typeof card.showPopover === 'function') {
        try { card.setAttribute('popover', 'manual'); card.showPopover(); top = true; }
        catch (_) { card.removeAttribute('popover'); }
      }
      this._fsTop = top;
      this._fsListen(true);
      // the remote: whether it was open on the card (it goes back that way afterwards), and full screen follows it
      this._fsRemWas = !!this._remoteMode;
      this._fsRemWatch(true);
      this._fsUpdate(true);
      // an Apple TV that's on with nothing playing (sitting on its home screen): straight to the remote
      {
        const st = this._hass?.states?.[this._entity];
        const a = st?.attributes || {};
        if (this._isAppleTV && (st?.state === 'on' || st?.state === 'idle') && !a.media_title && !a.media_series_title) this._fsRemote(true);
      }
      this._fsTimer = setInterval(() => {
        try {
          if (!this._fs) return;
          if (!this.isConnected || !this._fsOn()) { this._fsExit(); return; }
          this._fsUpdate();
        } catch (err) { console.warn('[Crow Media Player] full screen', err); this._fsExit(); }
      }, 500);
      // an older browser without a top layer: if anything on the page covers the exit button, don't stay
      if (!top) setTimeout(() => this._fsCheck(), 400);
    } catch (err) {
      console.warn('[Crow Media Player] couldn’t go full screen', err);
      this._fsExit();
    }
  },
  _fsCheck() {
    if (!this._fs) return;
    const b = this.shadowRoot?.querySelector('#crowFs .cfs-exit');
    const rc = b?.getBoundingClientRect();
    if (!rc || !rc.width) { this._fsExit(); return; }
    const at = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
    if (at !== this && !this.contains(at)) {
      this._fsExit();
      this._showToast('Full screen isn’t available on this dashboard');
    }
  },
  _fsListen(on) {
    if (on) {
      this._fsOnKey = (e) => {
        if (e.key !== 'Escape' || !this._fs) return;
        // Escape closes an open menu first; with no menu open, it leaves full screen
        const menus = [...document.querySelectorAll('#crowMediaQuickMenuPopup, #crowMediaEntityMenuPopup, #crowMediaMaQuickPickerPopup')];
        e.preventDefault();
        if (menus.length) { menus.forEach(m => m.remove()); return; }
        if (this.shadowRoot?.getElementById('cardOuter')?.hasAttribute('data-crow-fs-lyr')) { this._fsLyricsScreen(false); return; }
        if (this.shadowRoot?.getElementById('cardOuter')?.hasAttribute('data-crow-fs-rem')) { this._fsRemote(false); return; }
        this._fsExit();
      };
      this._fsOnLeave = () => { if (this._fs) this._fsExit(); };
      this._fsOnToggle = (e) => { if (e.newState === 'closed' && this._fs && !this._fsLeaving) this._fsExit(); };
      document.addEventListener('keydown', this._fsOnKey, true);
      window.addEventListener('location-changed', this._fsOnLeave);
      window.addEventListener('popstate', this._fsOnLeave);
      window.addEventListener('pagehide', this._fsOnLeave);
      this.shadowRoot?.getElementById('cardOuter')?.addEventListener('toggle', this._fsOnToggle);
    } else {
      if (this._fsOnKey) document.removeEventListener('keydown', this._fsOnKey, true);
      if (this._fsOnLeave) {
        window.removeEventListener('location-changed', this._fsOnLeave);
        window.removeEventListener('popstate', this._fsOnLeave);
        window.removeEventListener('pagehide', this._fsOnLeave);
      }
      if (this._fsOnToggle) this.shadowRoot?.getElementById('cardOuter')?.removeEventListener('toggle', this._fsOnToggle);
    }
  },
  _fsExit() {
    if (!this._fs) return;
    this._fs = false;
    this._fsLeaving = true;
    try { clearInterval(this._fsTimer); if (this._fsLyRaf) cancelAnimationFrame(this._fsLyRaf); } catch (_) {}
    this._fsLyRaf = null;
    this._fsLy = null;
    this._fsTimer = null;
    try { this._fsListen(false); } catch (_) {}
    const card = this.shadowRoot?.getElementById('cardOuter');
    if (card) {
      try { if (card.matches(':popover-open')) card.hidePopover(); } catch (_) {}
      card.removeAttribute('popover');
      if (card.hasAttribute('data-crow-fs-lyr')) { card.removeAttribute('data-crow-fs-lyr'); try { if (this._lyricsOpen) this._closeLyrics(); } catch (_) {} }
      // the remote goes back to how it was on the card before full screen
      try { this._fsRemWatch(false); } catch (_) {}
      card.removeAttribute('data-crow-fs-rem');
      try { if (!!this._remoteMode !== !!this._fsRemWas) this._toggleRemote(); } catch (_) {}
      card.removeAttribute('data-crow-fs');
    }
    this.shadowRoot?.getElementById('crowFs')?.remove();
    // menus that were lifted above it go back to normal
    document.querySelectorAll('[data-crow-fs-pop]').forEach(el => {
      try { if (el.matches(':popover-open')) el.hidePopover(); } catch (_) {}
      el.removeAttribute('popover'); el.removeAttribute('data-crow-fs-pop');
    });
    this.style.minHeight = this._fsOldMin || '';
    if (this._fsWasCompact && card) {
      const r = this.shadowRoot;
      try { if (r.getElementById('maPopup')?.classList.contains('visible')) this._closeMABrowser?.(true); } catch (_) {}
      try { if (r.getElementById('infoPopup')?.classList.contains('visible')) this._closeInfoPopup?.(); } catch (_) {}
      card.classList.add('mode-compact');
    }
    this._fsLeaving = false;
    this._fsBtnSync();
  },
  // ── the layout ──
  _fsBuild(card) {
    card.querySelector('#crowFs')?.remove();
    const v = document.createElement('div');
    v.id = 'crowFs';
    v.className = 'cfs';
    const I = CROW_MEDIA_FS_ICONS;
    const svg = (p, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}"><path d="${p}"/></svg>`;
    // a round arrow with "15" in it (turned the other way for forward)
    const skip15 = fwd => `<svg viewBox="0 0 24 24" aria-hidden="true"><path${fwd ? ' transform="matrix(-1 0 0 1 24 0)"' : ''} d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.4" text-anchor="middle">15</text></svg>`;
    v.innerHTML = `
      <div class="cfs-bg" aria-hidden="true"><img class="cfs-bgimg" alt=""><div class="cfs-flow">${[1, 2, 3, 4].map(n => '<img class="cfs-fl cfs-fl' + n + '" alt="" hidden>').join('')}</div><div class="cfs-bgshade"></div></div>
      <div class="cfs-top">
        <button type="button" class="cfs-sleep" data-a="sleep" aria-label="Sleep timer" hidden>${svg(I.moon)}<span></span></button>
        <div class="cfs-cap">
          <button type="button" class="cfs-circ cfs-lib" data-a="library" aria-label="Library" title="Library">${svg(I.menu)}</button>
          <button type="button" class="cfs-circ" data-a="queue" aria-label="Queue" title="Queue">${svg(I.queue)}</button>
          <button type="button" class="cfs-circ cfs-remote" data-a="remote" aria-label="Remote" title="Remote" hidden>${svg(FS_REMOTE)}</button>
          <button type="button" class="cfs-circ cfs-exit" data-a="exit" aria-label="Exit full screen" title="Exit Full Screen">${svg(I.exit)}</button>
          <span class="cfs-cap-sep" aria-hidden="true"></span>
          <button type="button" class="cfs-circ cfs-menu" data-a="menu" data-crow-qm-toggle aria-label="Quick menu" title="Menu">${svg(I.dots)}</button>
        </div>
      </div>
      <div class="cfs-main">
        <div class="cfs-player">
          <div class="cfs-art" role="button" tabindex="0" aria-label="Info. Double-tap to pin, swipe to skip"><div class="cfs-artph">${svg(I.note)}</div><img class="cfs-artimg" alt=""><button type="button" class="cfs-pinb" data-a="unpin" aria-label="Pinned. Tap to unpin" title="Tap to unpin" hidden>${svg(I.pin)}</button></div>
          <div class="cfs-meta"><div class="cfs-title"></div><div class="cfs-subt"></div></div>
          <div class="cfs-prog">
            <div class="cfs-bar" role="slider" aria-label="Position" tabindex="0"><div class="cfs-fill"></div></div>
            <div class="cfs-times"><span class="cfs-el">0:00</span><span class="cfs-app"></span><span class="cfs-rem"></span></div>
          </div>
          <div class="cfs-ctrls">
            <button type="button" class="cfs-b cfs-small" data-a="shuffle" aria-label="Shuffle">${svg(I.shuffle)}</button>
            <button type="button" class="cfs-b cfs-small cfs-skip" data-a="back15" aria-label="Back 15 seconds" title="Back 15 seconds" hidden>${skip15(false)}</button>
            <button type="button" class="cfs-b" data-nav="btnPrev" aria-label="Previous (double-tap to go back 15 seconds, hold for the queue)">${svg(I.prev)}</button>
            <button type="button" class="cfs-b cfs-play" data-a="play" aria-label="Play or pause">${svg(I.play, 'cfs-pi')}</button>
            <button type="button" class="cfs-b" data-nav="btnNext" aria-label="Next (double-tap to go forward 15 seconds, hold for the queue)">${svg(I.next)}</button>
            <button type="button" class="cfs-b cfs-small" data-a="repeat" aria-label="Repeat">${svg(I.repeat, 'cfs-ri')}</button>
            <button type="button" class="cfs-b cfs-small cfs-skip" data-a="fwd15" aria-label="Forward 15 seconds" title="Forward 15 seconds" hidden>${skip15(true)}</button>
          </div>
          <div class="cfs-vol"><button type="button" class="cfs-mute" data-a="mute" aria-label="Mute">${svg(I.volLo)}</button><input type="range" class="cfs-volr" min="0" max="100" step="1" aria-label="Volume"><span class="cfs-volp"></span></div>
        </div>
        <div class="cfs-side">
          <div class="cfs-panel cfs-lyrics"></div>
          <button type="button" class="cfs-next" data-a="upnext" aria-label="Open the queue" hidden><div class="cfs-nextart"></div><div class="cfs-nexttx"><div class="cfs-nextl">Up Next</div><div class="cfs-nextt"></div></div>${svg(I.chevR, 'cfs-nextchev')}</button>
        </div>
        <div class="cfs-rpanel" aria-hidden="true"></div>
      </div>`;
    card.insertBefore(v, card.firstChild);
    // a picture that won't load: hidden, remembered, and something else (or the placeholder) shown instead
    {
      const ai = v.querySelector('.cfs-artimg'), bi = v.querySelector('.cfs-bgimg');
      ai.addEventListener('error', () => {
        if (v._art) (this._fsArtBad || (this._fsArtBad = new Set())).add(v._art);
        ai.hidden = true; bi.hidden = true; v._art = null;
        try { this._fsUpdate(); } catch (_) {}
      });
      bi.addEventListener('error', () => { bi.hidden = true; });
    }
    this._fsLyrKey = null;
    this._fsQKey = null;
    this._fsNext = null;
    v.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      e.stopPropagation();
      this._fsAct(b.dataset.a, e, b);
    });
    v.addEventListener('contextmenu', e => { if (e.target.closest('.cfs-art, .cfs-next, .cfs-bg')) e.preventDefault(); });
    v.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('cfs-art')) { e.preventDefault(); this._fsAct('info', e, e.target); }
    });
    // the artwork, as in the main player: tap for the info screen, double-tap to pin, swipe left for the
    // next song and right for the previous one
    const art = v.querySelector('.cfs-art');
    let sx = 0, sy = 0, st = 0, down = false, lastTap = 0, tapT = null;
    let lpT = null, lpDone = false;
    art.addEventListener('pointerdown', e => {
      if (e.target.closest('.cfs-pinb')) return;
      down = true; sx = e.clientX; sy = e.clientY; st = Date.now(); lpDone = false;
      clearTimeout(lpT);
      lpT = setTimeout(() => { lpT = null; if (!down) return; lpDone = true; clearTimeout(tapT); tapT = null; lastTap = 0;
        try { navigator.vibrate?.(10); } catch (_) {}
        this._fsHold(); }, 500);
    });
    art.addEventListener('pointermove', e => { if (lpT && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(lpT); lpT = null; } });
    art.addEventListener('pointercancel', () => { down = false; clearTimeout(lpT); lpT = null; });
    art.addEventListener('contextmenu', e => e.preventDefault());
    art.addEventListener('pointerup', e => {
      if (!down) return;
      down = false;
      clearTimeout(lpT); lpT = null;
      // a long press has opened the lyrics screen or the remote: letting go isn't a tap
      if (lpDone || (Date.now() - st > 500 && Math.abs(e.clientX - sx) < 10 && Math.abs(e.clientY - sy) < 10)) { lpDone = false; lastTap = 0; return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) {
        clearTimeout(tapT); tapT = null; lastTap = 0;
        art.animate([{ transform: 'translateX(' + (dx < 0 ? -24 : 24) + 'px)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
        this._fsAct(dx < 0 ? 'next' : 'prev', e, art);
        return;
      }
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapT); tapT = null; lastTap = 0;
        const rc = art.getBoundingClientRect();
        this._fsPin(e.clientX - rc.left, e.clientY - rc.top);
        return;
      }
      lastTap = now;
      clearTimeout(tapT);
      tapT = setTimeout(() => { tapT = null; this._fsAct('info', e, art); }, 300);
    });
    // Previous / Next work exactly as the main player's: tap to skip, double-tap for 15 seconds back or on,
    // hold for the queue. The presses are handed to the main player's own (hidden) buttons.
    v.querySelectorAll('[data-nav]').forEach(fb => {
      const main = () => this.shadowRoot?.getElementById(fb.dataset.nav);
      const pass = (type) => { const m = main(); if (m) m.dispatchEvent(new PointerEvent(type, { bubbles: true })); };
      let px = 0, py = 0, moved = false;
      fb.addEventListener('pointerdown', e => { px = e.clientX; py = e.clientY; moved = false; pass('pointerdown'); });
      fb.addEventListener('pointermove', e => { if (!moved && (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10)) { moved = true; pass('pointercancel'); } });
      fb.addEventListener('pointerup', () => pass('pointerup'));
      fb.addEventListener('pointercancel', () => pass('pointercancel'));
      fb.addEventListener('click', e => { e.stopPropagation(); if (!moved) main()?.click(); });
    });
    // the progress bar: tap or drag to a new spot, the same as the main player
    const bar = v.querySelector('.cfs-bar');
    const pct = e => { const rc = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)); };
    const canSeek = () => { const at = this._hass?.states?.[this._entity]?.attributes || {}; return !!(+at.media_duration) && ((at.supported_features || 0) & 2) !== 0; };
    bar.style.touchAction = 'none';
    bar.addEventListener('pointerdown', e => {
      if (!canSeek()) return;
      e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      this._fsSeekPct = pct(e);
      this._fsUpdate();
    });
    bar.addEventListener('pointermove', e => { if (this._fsSeekPct == null) return; this._fsSeekPct = pct(e); this._fsUpdate(); });
    const endSeek = (e, cancel) => {
      if (this._fsSeekPct == null) return;
      const f = cancel ? this._fsSeekPct : pct(e);
      this._fsSeekPct = null;
      const dur = +(this._hass?.states?.[this._entity]?.attributes?.media_duration) || 0;
      if (!dur) return;
      const to = Math.round(f * dur);
      this._optimisticSeekPos = to;
      this._optimisticSeekTime = Date.now();
      this._lyLiveAt = null;        // the lyrics follow the new spot straight away
      this._fsLy = null;
      this._call('media_player', 'media_seek', { entity_id: this._entity, seek_position: to }).catch(err => this._showToast(err?.message || 'That didn’t work'));
      this._fsUpdate();
    };
    bar.addEventListener('pointerup', e => endSeek(e));
    bar.addEventListener('pointercancel', e => endSeek(e, true));
    bar.addEventListener('click', e => e.stopPropagation());
    const vol = v.querySelector('.cfs-volr');
    vol.addEventListener('input', () => { this._fsVolAt = Date.now(); const pc = v.querySelector('.cfs-volp'); if (pc) pc.textContent = Math.round(+vol.value) + '%'; });
    vol.addEventListener('change', () => {
      this._fsVolAt = Date.now();
      this._call('media_player', 'volume_set', { entity_id: this._volEntity || this._entity, volume_level: Math.round(+vol.value) / 100 }).catch(() => {});
    });
  },
  // Pin or unpin what's playing, the same as double-tapping the main player's artwork (unpinning asks first);
  // the hearts burst from the full screen artwork
  async _fsPin(x, y, fromBadge) {
    const badge = () => this.shadowRoot?.getElementById('pinnedIndicatorBadge')?.style.display === 'flex';
    try { this._updatePinnedIndicator?.(); } catch (_) {}
    const was = badge();
    try {
      if (was) await this._confirmUnpinFromBadge(x ?? undefined, y ?? undefined);
      else await this._handleArtworkDoubleTapPin(x ?? undefined, y ?? undefined);
    } catch (_) {}
    try { this._updatePinnedIndicator?.(); } catch (_) {}
    const now = badge();
    if (now !== was) this._fsHearts(x, y, now ? '#DC241F' : '#8E8E93');
    this._fsUpdate();
  },
  _fsHearts(x, y, color) {
    if (this._config?.pin_hearts === false) return;
    const art = this.shadowRoot?.querySelector('#crowFs .cfs-art');
    if (!art) return;
    const rc = art.getBoundingClientRect();
    const ox = x != null ? x : rc.width / 2, oy = y != null ? y : rc.height / 2;
    for (let i = 0; i < 10; i++) {
      const size = 18 + Math.random() * 14, dx = (Math.random() - 0.5) * 120, rise = 90 + Math.random() * rc.height * 0.45, rot = (Math.random() - 0.5) * 50;
      const h = document.createElement('div');
      h.className = 'cfs-heart';
      h.style.cssText = 'left:' + (ox - size / 2) + 'px;top:' + (oy - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;';
      h.innerHTML = '<svg viewBox="0 0 24 24"><path fill="' + color + '" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/></svg>';
      art.appendChild(h);
      const an = h.animate([{ transform: 'translate(0,0) scale(0.4)', opacity: 0 }, { transform: 'translate(' + dx * 0.3 + 'px,-' + rise * 0.3 + 'px) scale(1.1)', opacity: 1, offset: 0.25 },
        { transform: 'translate(' + dx + 'px,-' + rise + 'px) rotate(' + rot + 'deg) scale(0.9)', opacity: 0 }], { duration: 900 + Math.random() * 500, delay: Math.random() * 200, easing: 'ease-out', fill: 'both' });
      an.onfinish = () => h.remove();
    }
  },
  // the main player's lyrics screen over full screen (long press on the artwork); a tap on it closes it, as usual
  _fsLyricsScreen(open) {
    const card = this.shadowRoot?.getElementById('cardOuter');
    if (!card || !this._fs) return;
    if (open) {
      card.setAttribute('data-crow-fs-lyr', '');
      if (!this._lyricsOpen) this._openLyrics();
    } else {
      card.removeAttribute('data-crow-fs-lyr');
      if (this._lyricsOpen) this._closeLyrics();
    }
  },
  // ── Full screen: a hold on the artwork, the remote and the 15-second skips ──
  // a film or TV show (the same test as the main player's)
  _fsIsVideo() {
    const st = this._hass?.states?.[this._entity];
    if (!st) return false;
    try { const t = this._detectMediaType?.(st); return t === 'tv' || t === 'movie'; } catch (_) { return false; }
  },
  // a hold on the artwork, the same as on the main player: a film or show on an Apple TV (or an Apple TV with nothing
  // showing) opens the remote (where the info panel is); a song, a station, a podcast or a book opens the lyrics screen; a film or show on
  // anything else has no remote, so nothing happens
  _fsHold() {
    const v = this.shadowRoot?.getElementById('crowFs');
    // the remote's open: a hold on the artwork closes it again
    if (this.shadowRoot?.getElementById('cardOuter')?.hasAttribute('data-crow-fs-rem')) { this._fsRemote(false); return; }
    const video = this._fsIsVideo();
    if (this._isAppleTV && (video || !v?._art || v?._appIcon)) { this._fsRemote(true); return; }
    if (video) return;
    this._fsLyricsScreen(true);
  },
  // open or close the remote. It's the main player's own remote (touchpad, holds, Apps, Power, keyboard): a third panel
  // on a tablet on its side, in the artwork's place on a phone held upright (see _fsRemPlace). However it's opened or
  // closed (here, the quick menu, its ✕, a hold on it), full screen keeps in step.
  _fsRemote(open) {
    const card = this.shadowRoot?.getElementById('cardOuter');
    if (!card || !this._fs) return;
    if (open) {
      if (!this._isAppleTV) return;
      if (card.hasAttribute('data-crow-fs-lyr')) this._fsLyricsScreen(false);
      document.getElementById('crowMediaQuickMenuPopup')?.remove();
      if (!this._remoteMode) this._toggleRemote();
      if (!card.hasAttribute('data-crow-fs-rem')) card.setAttribute('data-crow-fs-rem', '');
      this._fsRemPlace();
    } else {
      if (this._remoteMode) this._toggleRemote();
      card.removeAttribute('data-crow-fs-rem');
    }
  },
  // which layout the remote uses on this screen: a third panel on a tablet on its side, the artwork's place on an
  // upright screen, the info's place on a phone on its side (too short for a third panel)
  _fsRemMode() {
    const w = window.innerWidth || 0, h = window.innerHeight || 0;
    if (!w || !h || w / h <= 0.8) return 'art';
    if (h > 560 && w >= 900) return 'col3';
    return 'side';
  },
  // where the remote goes: the layout is set first (it changes the sizes), then the remote is laid over its spot
  _fsRemPlace() {
    const card = this.shadowRoot?.getElementById('cardOuter');
    if (!card || !card.hasAttribute('data-crow-fs-rem')) return;
    const mode = this._fsRemMode();
    if (card.getAttribute('data-crow-fs-rem') !== mode) card.setAttribute('data-crow-fs-rem', mode);
    const spot = this.shadowRoot?.querySelector('#crowFs ' + (mode === 'col3' ? '.cfs-rpanel' : mode === 'art' ? '.cfs-art' : '.cfs-side'));
    if (!spot) return;
    const c = card.getBoundingClientRect(), s = spot.getBoundingClientRect();
    if (!s.width || !s.height) return;
    const px = n => Math.round(n) + 'px';
    let top = s.top, height = s.height;
    // beside the player (the third panel, or the info's place on a phone on its side): from the top of the artwork
    // to the bottom of the player, so the touchpad starts level with the artwork and the buttons end level with the
    // player's last row
    if (mode === 'col3' || mode === 'side') {
      const art = this.shadowRoot?.querySelector('#crowFs .cfs-art')?.getBoundingClientRect();
      const player = this.shadowRoot?.querySelector('#crowFs .cfs-player')?.getBoundingClientRect();
      if (art?.height && player?.height && player.bottom - art.top > 240) { top = art.top; height = player.bottom - art.top; }
    }
    const want = [px(s.left - c.left), px(top - c.top), px(s.width), px(height)];
    ['--cfs-rx', '--cfs-ry', '--cfs-rw', '--cfs-rh'].forEach((k, i) => { if (card.style.getPropertyValue(k) !== want[i]) card.style.setProperty(k, want[i]); });
  },
  // watches the remote: shown → it takes its place; hidden → full screen goes back to how it was. It also follows
  // its spot when the screen turns or changes size.
  _fsRemWatch(on) {
    try { this._fsRemObs?.disconnect(); } catch (_) {}
    try { this._fsRemSize?.disconnect(); } catch (_) {}
    this._fsRemObs = null;
    this._fsRemSize = null;
    if (!on) {
      const card = this.shadowRoot?.getElementById('cardOuter');
      ['--cfs-rx', '--cfs-ry', '--cfs-rw', '--cfs-rh'].forEach(k => card?.style.removeProperty(k));
      return;
    }
    if (typeof ResizeObserver === 'function') {
      this._fsRemSize = new ResizeObserver(() => { if (this._fs) this._fsRemPlace(); });
      this.shadowRoot?.querySelectorAll('#crowFs .cfs-main, #crowFs .cfs-player, #crowFs .cfs-art, #crowFs .cfs-side, #crowFs .cfs-rpanel').forEach(el => this._fsRemSize.observe(el));
    }
    const ov = this.shadowRoot?.getElementById('remoteOverlay');
    const card = this.shadowRoot?.getElementById('cardOuter');
    if (!ov || !card || typeof MutationObserver !== 'function') return;
    this._fsRemObs = new MutationObserver(() => {
      if (!this._fs) return;
      const shown = !ov.classList.contains('hidden');
      if (shown && !card.hasAttribute('data-crow-fs-rem')) {
        if (card.hasAttribute('data-crow-fs-lyr')) this._fsLyricsScreen(false);
        card.setAttribute('data-crow-fs-rem', '');
        this._fsRemPlace();
      } else if (!shown && card.hasAttribute('data-crow-fs-rem')) card.removeAttribute('data-crow-fs-rem');
    });
    this._fsRemObs.observe(ov, { attributes: true, attributeFilter: ['class'] });
  },
  // back or forward 15 seconds (films and shows), the same checks as a double-tap on Previous or Next
  _fsSkip(secs) {
    const st = this._hass?.states?.[this._entity];
    const a = st?.attributes || {};
    try { if (this._isLiveStream?.(st)) { this._showToast('Seek not available for live streams', 2000); return; } } catch (_) {}
    const dur = +a.media_duration || 0;
    if (!((a.supported_features || 0) & 2) || !dur) { this._showToast(this._entityDisplayName(this._entity) + ' doesn’t support seeking', 2000); return; }
    if (a.media_position === undefined || a.media_position === null) return;
    const to = Math.floor(Math.max(0, Math.min(dur - 1, this._fsPosNow() + secs)));
    this._optimisticSeekPos = to;
    this._optimisticSeekTime = Date.now();
    this._call('media_player', 'media_seek', { entity_id: this._entity, seek_position: to }).catch(err => this._showToast(err?.message || 'That didn’t work'));
    this._showToast((secs < 0 ? '−' : '+') + Math.abs(secs) + 's', 1200);
    this._fsUpdate();
  },
  // ── Full screen lyrics translation (quick menu → Translate Lyrics; shares the translations the card has made) ──
  async _fsToggleTrans() {
    const a = this._hass?.states?.[this._entity]?.attributes || {};
    const L = this._fsLyr;
    if (!L || !L.length || !a.media_title) return;
    const key = ((a.media_artist || '') + '|' + (a.media_title || '')).toLowerCase();
    if (!this._lyricsTransPinned) this._lyricsTransPinned = new Set();
    if (this._fsTransOn) { this._lyricsTransPinned.delete(key); this._fsTransOn = false; this._fsApplyTrans(); return; }
    let tr = this._lyricsTransGet(key);
    if (!tr) {
      if (this._lyricsTranslating) return;
      this._lyricsTranslating = true;
      this._showToast('Translating the lyrics…', 6000);
      try { tr = await this._fetchLyricsTranslation({ key, artist: a.media_artist || '', title: a.media_title || '', album: a.media_album_name || '', texts: L.map(l => l.text || '') }); }
      catch (_) { tr = null; }
      finally { this._lyricsTranslating = false; }
      if (!this._fs || this._fsLyr !== L) return;   // moved on to another song
      if (!tr) { this._showToast('Couldn’t translate the lyrics right now'); return; }
      this._lyricsTransCache.set(key, tr);
      this._aiLocalSet('lyricsTrans', key, tr, { max: 60 });
    }
    if (tr.same) { this._showToast('These lyrics are already in ' + this._lyricsTargetLanguage()); return; }
    this._lyricsTransPinned.add(key);
    this._fsTransOn = true;
    this._fsApplyTrans(tr);
    this._showToast(tr.language ? 'Translated from ' + tr.language : 'Translated', 2000);
  },
  // put the translation (and pronunciation) under each line, or take it away
  _fsApplyTrans(tr) {
    const box = this.shadowRoot?.querySelector('#crowFs .cfs-lyrics');
    const L = this._fsLyr;
    if (!box || !L) return;
    box.querySelectorAll('.cfs-tr, .cfs-pr').forEach(x => x.remove());
    if (!this._fsTransOn || !tr?.map) return;
    const esc = t => this._cmpEsc(t);
    box.querySelectorAll('.cfs-line').forEach((el, i) => {
      const src = String(L[i]?.text || '').trim();
      const m = src && tr.map[src];
      if (!m) return;
      if (m.p) el.insertAdjacentHTML('beforeend', '<span class="cfs-pr">' + esc(m.p) + '</span>');
      if (m.t && m.t.toLowerCase() !== src.toLowerCase()) el.insertAdjacentHTML('beforeend', '<span class="cfs-tr">' + esc(m.t) + '</span>');
    });
  },
  async _fsAct(a, e, el) {
    const eid = this._entity;
    const st = this._hass?.states?.[eid];
    const at = st?.attributes || {};
    const call = (svc, data = {}) => this._call('media_player', svc, { entity_id: eid, ...data }).catch(err => this._showToast(err?.message || 'That didn’t work'));
    if (a === 'exit') { this._fsExit(); return; }
    const mainBtn = (id) => { const m = this.shadowRoot?.getElementById(id); if (m) { m.click(); return true; } return false; };
    if (a === 'play') { if (!mainBtn('btnPlay')) call('media_play_pause'); return; }
    // a swipe on the artwork
    if (a === 'next') return this.call('media_next_track');
    if (a === 'prev') return this.call('media_previous_track');
    if (a === 'shuffle' || a === 'repeat') {
      if (!mainBtn(a === 'shuffle' ? 'btnShuffle' : 'btnRepeat')) {
        if (a === 'shuffle') call('shuffle_set', { shuffle: !at.shuffle });
        else call('repeat_set', { repeat: at.repeat === 'all' ? 'one' : at.repeat === 'one' ? 'off' : 'all' });
      }
      // show the new setting straight away; the next update from the speaker confirms it
      const now = Date.now();
      if (a === 'shuffle') this._fsOpt = { ...(this._fsOpt || {}), shuffle: !at.shuffle, shuffleAt: now };
      else this._fsOpt = { ...(this._fsOpt || {}), repeat: at.repeat === 'all' ? 'one' : at.repeat === 'one' ? 'off' : 'all', repeatAt: now };
      this._fsUpdate();
      return;
    }
    // the Remote button opens the remote, and closes it again
    if (a === 'remote') { this._fsRemote(!this.shadowRoot?.getElementById('cardOuter')?.hasAttribute('data-crow-fs-rem')); return; }
    if (a === 'back15' || a === 'fwd15') { this._fsSkip(a === 'back15' ? -15 : 15); return; }
    if (a === 'resume') return this._cmpResume();
    if (a === 'info') {
      const k = this._fsKind();
      this._expandFromCompact().then(() => {
        if (k === 'audiobook' && this._abNowPlaying) return this._resolveAndShowAudiobook?.();
        if (k === 'podcast' && this._pcNowPlaying) return this._resolveAndShowPodcast?.();
        if (k === 'radio') return this._resolveAndShowLiveStation?.();
        return this._openInfoPopup?.();
      });
      return;
    }
    // the library and the queue, as from the main player's control row and quick menu (they fill the screen)
    if (a === 'library') { const m = this.shadowRoot?.getElementById('btnMABrowseControls'); if (m) m.click(); else this._expandFromCompact().then(() => this._openMABrowser?.()); return; }
    if (a === 'queue') { this._expandFromCompact().then(() => this._showQueuePanel?.('next', true)); return; }
    if (a === 'mute') { this._toggleMute(); setTimeout(() => this._fsUpdate(), 150); return; }
    if (a === 'sleep') { this._chooseSleepTimer(); return; }
    if (a === 'unpin') { this._fsPin(null, null, true); return; }
    // the Up Next bar opens the queue (the same as Queue in the quick menu)
    if (a === 'upnext') { this._expandFromCompact().then(() => this._showQueuePanel?.('next', true)); return; }
    if (a === 'menu') {
      // a second tap on the button closes the menu
      const open = document.getElementById('crowMediaQuickMenuPopup');
      if (open) { open.remove(); return; }
      const btn = this.shadowRoot?.getElementById('btnQueueOpen');
      if (!btn) return;
      btn.click();
      const pop = document.getElementById('crowMediaQuickMenuPopup');
      if (pop) {
        const rc = el.getBoundingClientRect();
        pop.style.bottom = '';
        pop.style.top = Math.round(rc.bottom + 10) + 'px';
        pop.style.left = Math.max(8, Math.round(rc.right - pop.offsetWidth)) + 'px';
        pop.style.maxHeight = Math.round(window.innerHeight - rc.bottom - 24) + 'px';
        pop.style.overflowY = 'auto';
      }
    }
  },
  // Animated Background: moves while something it's on for is playing (Animate For: everything, music only, or
  // films and TV only), with real artwork. An app's icon (Netflix…) keeps the plain background. A new picture fades
  // in once the old one has faded out.
  _fsFlow(v, playing, art) {
    const cfg = this._config || {};
    const want = (() => {
      if (cfg.fullscreen_animated_bg !== true || !playing || !art || v._appIcon) return false;
      const forWhat = ['music', 'video'].includes(cfg.fullscreen_animated_bg_for) ? cfg.fullscreen_animated_bg_for : 'all';
      if (forWhat === 'all') return true;
      let video = false;
      try { video = this._fsIsVideo(); } catch (_) { video = false; }
      return forWhat === 'video' ? video : !video;
    })();
    const layers = [...v.querySelectorAll('.cfs-fl')];
    const setArt = (u) => layers.forEach(l => { if (u) { if (l.getAttribute('src') !== u) l.src = u; l.hidden = false; } else { l.removeAttribute('src'); l.hidden = true; } });
    if (want) {
      clearTimeout(this._fsFlowStop);
      if (v._flowArt !== art) {
        const first = !v._flowArt || !v.hasAttribute('data-flow');
        v._flowArt = art;
        clearTimeout(this._fsFlowSwap);
        if (first) setArt(art);
        else {
          v.classList.add('cfs-flow-swap');
          this._fsFlowSwap = setTimeout(() => { if (v._flowArt === art) setArt(art); v.classList.remove('cfs-flow-swap'); }, 700);
        }
      }
      v.setAttribute('data-flow-run', '');
      v.setAttribute('data-flow', '');
    } else if (v.hasAttribute('data-flow')) {
      // fades back to the plain background, still moving while it fades, then rests
      v.removeAttribute('data-flow');
      v.classList.remove('cfs-flow-swap');
      this._fsFlowStop = setTimeout(() => {
        if (v.hasAttribute('data-flow')) return;
        v.removeAttribute('data-flow-run');
        // nothing to show any more: the layers let go of the picture once they've faded
        if (!v._art) { v._flowArt = null; setArt(''); }
      }, 1800);
    }
  },
  _fsUpdate(force = false) {
    const v = this.shadowRoot?.getElementById('crowFs');
    if (!v || !this._fs) return;
    const eid = this._entity;
    const st = this._hass?.states?.[eid];
    const a = st?.attributes || {};
    const playing = st?.state === 'playing' || st?.state === 'buffering';
    const active = playing || st?.state === 'paused';
    const key = active ? [a.media_artist || '', a.media_title || '', a.media_series_title || '', a.media_content_id || ''].join('|') : '';
    // the artwork: what the card shows, else the speaker's picture. One that won't load (a broken link from the
    // speaker) isn't shown, so there's no "?" over the placeholder; the podcast's or book's own picture is used
    // instead when the info beside the player has found one.
    const img = this.shadowRoot.getElementById('albumImg');
    let art = img && img.src && img.naturalWidth > 0 && getComputedStyle(img).display !== 'none' ? img.src : (a.entity_picture || '');
    if (!active) art = '';
    const bad = this._fsArtBad || (this._fsArtBad = new Set());
    if (art && bad.has(art)) art = '';
    if (!art && active && this._fsArtFb?.key === key && this._fsArtFb.url && !bad.has(this._fsArtFb.url)) art = this._fsArtFb.url;
    // nothing to show, and an app is open on an Apple TV (Netflix…): the app's icon, as the main player shows it
    const appName = active ? String(a.app_name || '').trim() : '';
    let appIcon = '';
    if (!art && appName && !/^com\.apple\.headboard/i.test(String(a.app_id || ''))) {
      try { this._appIconCacheReady?.(); } catch (_) {}
      appIcon = this._appIconCache?.[appName] || '';
      if (appIcon && bad.has(appIcon)) appIcon = '';
      const asked = this._fsIconAsked || (this._fsIconAsked = new Set());
      if (!appIcon && !asked.has(appName) && this._atvAppIcon) {
        asked.add(appName);
        this._atvAppIcon(appName).then(u => { if (u && this._fs) { this._fsLyrKey = null; this._fsUpdate(); } }).catch(() => {});
      }
    }
    v._appIcon = !art && !!appIcon;
    v.querySelector('.cfs-art')?.classList.toggle('cfs-appicon', v._appIcon);
    if (!art && appIcon) art = appIcon;
    if (v._art !== art) {
      v._art = art;
      const ai = v.querySelector('.cfs-artimg'), bi = v.querySelector('.cfs-bgimg');
      if (art) { ai.src = art; bi.src = art; ai.hidden = false; bi.hidden = false; }
      else { ai.removeAttribute('src'); bi.removeAttribute('src'); ai.hidden = true; bi.hidden = true; }
    }
    this._fsFlow(v, playing, art);
    const room = this._entityDisplayName(eid);
    const set = (sel, t) => { const el = v.querySelector(sel); if (el && el.textContent !== t) el.textContent = t; };
    // an app with nothing of its own to say (Netflix…): the app's name, with the Apple TV under it, as the main player shows it
    const appOnly = active && !a.media_title && !a.media_series_title && !!appName;
    const title = active ? (appOnly ? appName : (a.media_title || a.media_series_title || room)) : 'Nothing playing';
    const artistR = this._fsReal(a.media_artist);
    let sub = active ? (appOnly ? room : [artistR || a.media_series_title || a.app_name, a.media_album_name].filter((x, i, arr) => x && arr.indexOf(x) === i).join(' — ')) : room;
    // a film, show, podcast or book: the app's name is already beside the times, so under the title goes the network
    // (a show), "Film · year", the podcast's name or the author, once the info beside the player has found it
    if (active && !artistR && !a.media_series_title) {
      let vk = '';
      try { vk = this._fsKind(); } catch (_) { vk = ''; }
      if (['tv', 'movie', 'podcast', 'audiobook'].includes(vk)) {
        const said = this._fsVidSub?.key === key ? this._fsVidSub.text : '';
        sub = [said, vk === 'podcast' || vk === 'audiobook' ? '' : this._fsReal(a.media_album_name)].filter(Boolean).join(' — ');
      }
    }
    set('.cfs-title', title);
    set('.cfs-subt', sub);
    set('.cfs-app', active && !appOnly ? (a.app_name || a.source || '') : '');
    // progress
    const dur = +a.media_duration || 0;
    let pos = this._fsPosNow();
    if (this._fsSeekPct != null && dur) pos = this._fsSeekPct * dur;   // while dragging, the bar follows the finger
    const fill = v.querySelector('.cfs-fill');
    fill.style.transition = this._fsSeekPct != null ? 'none' : '';
    fill.style.width = dur && active ? (pos / dur * 100).toFixed(2) + '%' : '0%';
    v.querySelector('.cfs-prog').classList.toggle('cfs-live', !dur && active);
    // an app with no running time (and not a radio station): no bar or times at all
    { let k = 'x'; if (active && !dur) { try { k = this._fsIsRadio() ? 'radio' : this._fsKind(); } catch (_) { k = 'x'; } }
      v.classList.toggle('cfs-noprog', active && !dur && k === '' && !!appName); }
    set('.cfs-el', active && dur ? this._cmpFmt(pos) : (active ? 'Live' : ''));
    set('.cfs-rem', active && dur ? '−' + this._cmpFmt(dur - pos) : '');
    // controls
    const pi = v.querySelector('.cfs-pi path');
    const want = playing ? CROW_MEDIA_FS_ICONS.pause : CROW_MEDIA_FS_ICONS.play;
    if (pi && pi.getAttribute('d') !== want) pi.setAttribute('d', want);
    const o = this._fsOpt || {}, fresh = (t) => t && Date.now() - t < 4000;
    if (fresh(o.shuffleAt) && !!a.shuffle === o.shuffle) o.shuffleAt = 0;   // the speaker has caught up
    if (fresh(o.repeatAt) && (a.repeat || 'off') === o.repeat) o.repeatAt = 0;
    const shuf = fresh(o.shuffleAt) ? o.shuffle : a.shuffle === true;
    const repm = fresh(o.repeatAt) ? o.repeat : (a.repeat || 'off');
    const lit = st?.state === 'playing' || st?.state === 'buffering';
    v.querySelector('[data-a="shuffle"]').classList.toggle('on', lit && shuf);
    v.querySelector('[data-a="repeat"]').classList.toggle('on', lit && repm !== 'off');
    v.querySelector('[data-a="shuffle"]').setAttribute('aria-pressed', String(!!shuf));
    v.querySelector('[data-a="repeat"]').setAttribute('aria-label', repm === 'one' ? 'Repeat: this song' : repm === 'all' ? 'Repeat: on' : 'Repeat: off');
    // a film, show, podcast or audiobook: back and forward 15 seconds instead of shuffle and repeat (which don't apply)
    const video = active && this._fsIsVideo();
    let spoken = false;
    if (active && !video) { try { spoken = ['podcast', 'audiobook'].includes(this._fsKind()); } catch (_) { spoken = false; } }
    const skips = video || spoken;
    v.querySelector('[data-a="shuffle"]').hidden = skips;
    v.querySelector('[data-a="repeat"]').hidden = skips;
    v.querySelector('[data-a="back15"]').hidden = !skips;
    v.querySelector('[data-a="fwd15"]').hidden = !skips;
    // the Remote button, for an Apple TV
    const remBtn = v.querySelector('.cfs-remote');
    remBtn.hidden = !this._isAppleTV;
    // the same icon as the main player's Remote button (chosen in the editor: Colours & Themes → Button Icons),
    // at the size of the other icons in the corner
    {
      let d = '';
      try { d = this._btnIconPath?.('remote') || ''; } catch (_) { d = ''; }
      const p = remBtn.querySelector('path');
      if (d && p && p.getAttribute('d') !== d) p.setAttribute('d', d);
    }
    {
      const remOn = !!this.shadowRoot.getElementById('cardOuter')?.hasAttribute('data-crow-fs-rem');
      remBtn.classList.toggle('on', remOn);
      remBtn.setAttribute('aria-pressed', String(remOn));
      if (remOn) this._fsRemPlace();
    }
    // what a hold on the artwork does, for screen readers
    {
      const remOpen = !!this.shadowRoot.getElementById('cardOuter')?.hasAttribute('data-crow-fs-rem');
      const hold = remOpen ? 'hold to close the remote, ' : this._isAppleTV && (video || !v._art || v._appIcon) ? 'hold for the remote, ' : video ? '' : 'hold for the lyrics, ';
      const lab = 'Info. Tap for more, ' + hold + 'double-tap to pin, swipe to skip';
      const artEl = v.querySelector('.cfs-art');
      if (artEl.getAttribute('aria-label') !== lab) artEl.setAttribute('aria-label', lab);
    }
    const ri = v.querySelector('.cfs-ri path');
    const rw = repm === 'one' ? CROW_MEDIA_FS_ICONS.repeatOne : CROW_MEDIA_FS_ICONS.repeat;
    if (ri && ri.getAttribute('d') !== rw) ri.setAttribute('d', rw);
    const vs = this._hass?.states?.[this._volEntity || eid];
    const volEl = v.querySelector('.cfs-vol');
    const hasVol = typeof vs?.attributes?.volume_level === 'number';
    volEl.hidden = !hasVol;
    const volR = v.querySelector('.cfs-volr');
    if (hasVol && Date.now() - (this._fsVolAt || 0) > 2500) volR.value = Math.round(vs.attributes.volume_level * 100);
    // muted: the speaker's own mute where it has one, otherwise the card's soft mute (as in the main player)
    const volEnt = this._volEntity || eid;
    const nativeMute = 'is_volume_muted' in (vs?.attributes ?? {}) && !this._isAppleTVEntity?.(eid);
    const muted = nativeMute ? !!vs?.attributes?.is_volume_muted : !!this._softMuteMap?.[volEnt];
    volEl.classList.toggle('muted', muted);
    const mb = v.querySelector('.cfs-mute');
    mb.classList.toggle('on', muted);
    mb.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    const mp = mb.querySelector('path'), mw = muted ? CROW_MEDIA_FS_ICONS.volOff : CROW_MEDIA_FS_ICONS.volLo;
    if (mp.getAttribute('d') !== mw) mp.setAttribute('d', mw);
    set('.cfs-volp', hasVol ? (muted ? 'Muted' : Math.round(+volR.value) + '%') : '');
    // the sleep timer, when one is running for this speaker
    const sl = v.querySelector('.cfs-sleep');
    const slOn = !!this._sleep && this._sleep.entity === eid;
    sl.hidden = !slOn;
    if (slOn) {
      const left = this._sleepLeft?.();
      const t = this._sleep.mode === 'track' && left > 3600 ? 'End of song' : (this._sleepLeftLabel?.() || '');
      set('.cfs-sleep span', t);
      sl.title = 'Sleep timer: pausing in ' + t;
    }
    // Library and Menu wear the same icons as the main player's buttons (the library icon chosen in the editor,
    // the menu icon from the icon theme); Library shows only when the main player has its library button
    {
      const icon = (fb, mainId) => {
        const d = this.shadowRoot.getElementById(mainId)?.querySelector('svg path')?.getAttribute('d');
        const p = fb?.querySelector('path');
        if (d && p && p.getAttribute('d') !== d) p.setAttribute('d', d);
      };
      const lib = v.querySelector('.cfs-lib'), mainLib = this.shadowRoot.getElementById('btnMABrowseControls');
      icon(lib, 'btnMABrowseControls');
      // Menu: the three dots the card's other menus use (from the icon theme), not the music note of the
      // control row's Media button
      {
        const d = this._themeIconPaths?.menu || CROW_MEDIA_FS_ICONS.dots;
        const p = v.querySelector('.cfs-menu path');
        if (p && p.getAttribute('d') !== d) p.setAttribute('d', d);
      }
      lib.hidden = !mainLib || mainLib.style.display === 'none' || getComputedStyle(mainLib).display === 'none';
    }
    // pinned: the same check as the badge on the main player's artwork
    try { this._updatePinnedIndicator?.(); } catch (_) {}
    const pinned = this.shadowRoot.getElementById('pinnedIndicatorBadge')?.style.display === 'flex';
    v.querySelector('.cfs-pinb').hidden = !(pinned && active);
    v.classList.toggle('cfs-stopped', !active);
    // lyrics and what's up next
    this._fsLyrics(v, key, a, pos, force, dur);
    { const s2 = v.querySelector('.cfs-appstat'); if (s2) { const t = this._fsAppStat(st); if (s2.textContent !== t) s2.textContent = t; } }
    this._fsQueue(v, key, force);
  },
  // Full screen lyrics: always the timed (synced) version when there is one, so they scroll with the song.
  // Uses the same lookup as the lyrics in the card (with the song's length, which is what finds the timed
  // version), and if only plain lyrics have been found so far it looks again for a timed version.
  async _fsLyricsFetch(artist, title, album, duration) {
    const key = (artist + '|' + title).toLowerCase();
    if (!this._lyricsCache) this._lyricsCache = new Map();
    const cached = this._lyricsCachedEntry(artist, title);
    if (cached?.type === 'synced' && cached.lines?.length) return cached;
    const hdr = { headers: { 'Lrclib-Client': 'crow-media-player/1.0 (home-assistant)' } };
    const cleanTitle = title.replace(/\s+by\s+.+$/i, '').trim() || title;
    const synced = d => {
      if (!d || d.instrumental || !d.syncedLyrics) return null;
      const lines = this._parseLrc(d.syncedLyrics);
      return lines.length ? { type: 'synced', lines } : null;
    };
    // Music Assistant's own copy first, then the lyrics site
    let data = await this._maLyricsData(artist, title);
    if (!data) try {
      const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
      if (album) params.set('album_name', album);
      if (duration) params.set('duration', duration);
      const res = await crowFetch('https://lrclib.net/api/get?' + params.toString(), hdr);
      if (res.ok) data = await res.json();
    } catch (_) { data = null; }
    let entry = synced(data);
    // no timed lyrics from the exact match: the search often has a timed version of the same song
    if (!entry) {
      const found = await this._searchLyricsFallback(cleanTitle, artist).catch(() => null);
      entry = synced(found);
      if (!entry && !data) data = found;
    }
    if (!entry && data && !data.instrumental && data.plainLyrics && data.plainLyrics.trim()) entry = { type: 'plain', text: data.plainLyrics };
    if (!entry && data?.instrumental) return { type: 'instrumental' };
    if (!entry) return cached || { type: 'none' };
    if (entry.type === 'synced' || !cached || cached.type === 'none') {
      this._lyricsCache.set(key, entry);
      if (this._lyricsLocalSet) { try { this._lyricsLocalSet(key, entry); } catch (_) {} }
    }
    return entry;
  },
  _fsLyrics(v, key, a, pos, force, dur) {
    const box = v.querySelector('.cfs-lyrics');
    if (!box) return;
    // plain lyrics showing, but the card has since found the timed version: switch to it
    if (key && key === this._fsLyrKey && !this._fsLyr && this._fsLyrPlain) {
      const c = this._lyricsCachedEntry(a.media_artist, a.media_title);
      if (c?.type === 'synced' && c.lines?.length) { this._fsShowSynced(box, c.lines); force = true; }
    }
    if (key !== this._fsLyrKey) {
      this._fsLyrKey = key;
      this._fsLyr = null;
      this._fsLyrPlain = false;
      this._fsLyrIdx = -2;
      const msg = t => { box.innerHTML = '<div class="cfs-lmsg"></div>'; box.firstChild.textContent = t; box.scrollTop = 0; };
      // nothing playing: the space beside the player is simply left empty
      if (!key) { box.innerHTML = ''; box.scrollTop = 0; return; }
      // a radio station, podcast, audiobook, film or TV show: what's known about it instead of lyrics
      const kind = this._fsKind();
      if (kind !== 'music') {
        if (kind) this._fsInfo(box, kind, key);
        else this._fsAppInfo(box, a);
        return;
      }
      msg('Finding the lyrics…');
      const want = key;
      this._fsLyricsFetch(a.media_artist, a.media_title, a.media_album_name || '', Math.round(dur || 0)).then(entry => {
        if (this._fsLyrKey !== want || !this._fs) return;
        if (entry?.type === 'synced' && entry.lines?.length) {
          this._fsShowSynced(box, entry.lines);
          this._fsUpdate(true);
        } else if (entry?.type === 'plain' && entry.text) {
          this._fsLyrPlain = true;
          box.innerHTML = '<div class="cfs-plain"></div>';
          box.firstChild.textContent = entry.text;
          box.scrollTop = 0;
        } else this._fsInfo(box, 'music', want, { instrumental: entry?.type === 'instrumental' });   // no lyrics: about the song instead
      }).catch(() => { if (this._fsLyrKey === want) this._fsInfo(box, 'music', want); });
      return;
    }
    // timed lyrics: the scroll runs every frame (started here, so it picks up again after a pause)
    if (this._fsLyr && this._fsLyr.length) this._fsLyrStart(force);
  },
  // ── Full screen: what's playing, when there are no lyrics ──
  // Only what the card already looks up without the AI: Discogs and Music Assistant for songs, the station
  // directory for radio, the podcast's own feed, LibriVox / Archive.org chapters, and TMDB, TVmaze or the
  // iTunes Store for films and shows. What Home Assistant already knows shows straight away; the rest
  // fills in as it arrives. A tap opens the info screen (a chapter tap plays that chapter).
  _fsKind() {
    const st = this._hass?.states?.[this._entity];
    const a = st?.attributes || {};
    if (!st) return '';
    const cid = a.media_content_id || '';
    const mt = String(a.mass_media_type || '').toLowerCase(), ct = String(a.media_content_type || '').toLowerCase();
    // Music Assistant's own audiobooks and podcasts say so in their address (library://audiobook/12,
    // spotify://podcast_episode/…) even when they aren't tagged
    if (mt === 'audiobook' || ct === 'audiobook' || /:\/\/audiobook\//i.test(cid) || (this._abNowPlaying && (!cid || this._abNowPlaying.url === cid))) return 'audiobook';
    // a book the card has played on this device, a LibriVox recording, or a title that reads like a book's chapter
    // ("The War of the Worlds - Book 1 - Chapter 01") that runs like one (five minutes or more)
    { let cached = null; try { cached = this._abCachedBook?.(cid) || null; } catch (_) { cached = null; }
      if (cached || /librivox/i.test(cid + ' ' + (a.media_album_name || ''))) return 'audiobook'; }
    if (this._fsChapter(a) && (!(+a.media_duration) || +a.media_duration >= 300)) return 'audiobook';
    if (/^podcast/.test(mt) || ct === 'podcast' || /:\/\/podcast(_episode)?\//i.test(cid) || (this._pcNowPlaying && (!cid || this._pcNowPlaying.url === cid))) return 'podcast';
    // radio: the same test as the main player's LIVE pill (a stream with no length), so a station started in another
    // app (AirMusic, a speaker's own app…) counts too, not just one the card has played or looked up
    let radio = false;
    try { radio = a.mass_media_type === 'radio' || !!this._isActuallyRadioStream?.(st) || !!this._isLiveStream?.(st); } catch (_) { radio = false; }
    // a station that says which song it's playing is treated as that song (lyrics first)
    if (radio) return a.media_artist && a.media_title ? 'music' : 'radio';
    const app = (() => { try { return this._appInfoKind?.(a) || null; } catch (_) { return null; } })();
    if (app && app !== 'music') return '';   // YouTube, sport, news, apps…: nothing of this kind to show
    const t = this._detectMediaType?.(st);
    if (t === 'tv' || t === 'movie') return t;
    // Music Assistant playing something long with no artist ("[unknown]"): a podcast episode, not a song
    const ma = !!this._maEntityIds?.has?.(this._entity) || 'mass_player_id' in a || /music assistant/i.test(String(a.app_name || ''));
    if (ma && a.media_title && !this._fsReal(a.media_artist) && +a.media_duration >= 15 * 60) return 'podcast';
    if (this._fsReal(a.media_artist) && a.media_title) return 'music';
    return '';
  },
  // ── Full screen: an app on the Apple TV (Netflix, YouTube…) with no lyrics or film details to show ──
  // Its icon, the app (or what's on, when the app says), the Apple TV it's on, and whether it's playing and for how long
  _fsAppInfo(box, a) {
    const app = String(a.app_name || '').trim();
    const title = String(a.media_title || '').trim();
    const st = this._hass?.states?.[this._entity];
    const who = this._fsReal(a.media_artist) || String(a.media_series_title || '').trim();
    this._fsInfoRender(box, {
      icon: app ? (this._appIconCache?.[app] || '') : '',
      heading: this._entityDisplayName(this._entity),
      title: title || app || 'Now playing',
      sub: title ? [who, app].filter((x, i, arr) => x && arr.indexOf(x) === i).join(' · ') : '',
      chips: [],
      stat: this._fsAppStat(st),
    });
  },
  // "Playing for 42 min", "Playing for 1 hr 5 min", "Paused"
  _fsAppStat(st) {
    if (!st) return '';
    if (st.state === 'paused') return 'Paused';
    if (st.state !== 'playing' && st.state !== 'buffering') return '';
    const since = Date.parse(st.last_changed || '');
    const m = isNaN(since) ? 0 : Math.floor((Date.now() - since) / 60000);
    if (m < 1) return 'Playing';
    const h = Math.floor(m / 60), r = m % 60;
    return 'Playing for ' + (h ? h + ' hr' + (r ? ' ' + r + ' min' : '') : m + ' min');
  },
  // a chapter of a book, from its title: "The War of the Worlds - Book 1 - Chapter 01" → the book and the chapter
  // (with the album as the book when the title is just "Chapter 3"); null when the title isn't one
  _fsChapter(a) {
    const t = String(a?.media_title || '').trim(), alb = this._fsReal(a?.media_album_name);
    const m = t.match(/(?:\b(?:book|part|volume|vol\.)\s*[\divxlc]+\s*[-–—:,.]?\s*)?\b(?:chapter|chap\.)\s*[\divxlc]+\b/i);
    if (!m) return null;
    const book = t.slice(0, m.index).replace(/[\s\-–—:|,.]+$/, '').trim() || alb;
    return book ? { book, chapter: t.slice(m.index).trim() } : null;
  },
  // a name that's really there: Music Assistant sends "[unknown]" when it has no artist
  _fsReal(s) {
    const t = String(s ?? '').trim();
    return /^\[?\s*(unknown( artist)?)?\s*\]?$/i.test(t) ? '' : t;
  },
  // a country's everyday name ("United Kingdom", not "The United Kingdom Of Great Britain And Northern Ireland")
  _fsCountry(st) {
    const cc = String(st?.countrycode || '').toUpperCase();
    if (cc.length === 2) { try { const n = new Intl.DisplayNames([navigator.language || 'en-GB', 'en'], { type: 'region' }).of(cc); if (n && n !== cc) return n; } catch (_) {} }
    return String(st?.country || '').replace(/^the\s+/i, '').replace(/\s+of\s+great\s+britain.*$/i, '').trim();
  },
  _fsIsRadio() {
    const st = this._hass?.states?.[this._entity];
    const a = st?.attributes || {};
    try { return a.mass_media_type === 'radio' || !!this._isActuallyRadioStream?.(st) || !!this._isLiveStream?.(st); } catch (_) { return a.mass_media_type === 'radio'; }
  },
  // the station playing: its name, and a line about it ("SomaFM · Ambient, Space · Live")
  // (given: the station already worked out, or null for none, so a looked-up station that doesn't match isn't used)
  _fsStation(a, given) {
    let station = null;
    if (given !== undefined) station = given;
    else try { station = this._rbGetLastPlayed?.(this._entity, this._rbStreamKey?.(a)) || null; } catch (_) { station = null; }
    if (!station && given === undefined) { try { const u = String(a.media_content_id || '').replace(/^builtin:\/\/radio\//i, ''); station = u ? this._rbCachedStation?.(u) : null; } catch (_) { station = null; } }
    // without the station directory: the "album" a station sends, e.g. "Drone Zone [SomaFM]" (name and network)
    const alb = String(a.media_album_name || '');
    const net = (alb.match(/[\[(]([^\])]+)[\])]\s*$/) || [])[1] || '';
    const name = station?.name || a.media_station || alb.replace(/\s*[\[(][^\])]*[\])]\s*$/, '').trim() || a.media_artist || a.media_title || 'the radio';
    const tags = String(station?.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 2).map(t => t.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
    const stream = station?.codec ? station.codec + (station.bitrate ? ' ' + station.bitrate + ' kbps' : '') : '';
    return { name, station, line: [net, tags, 'Live'].filter(Boolean).join(' · '), stream };
  },
  async _fsInfo(box, kind, want, opt = {}) {
    const a = { ...(this._hass?.states?.[this._entity]?.attributes || {}) };
    const live = () => this._fs && this._fsLyrKey === want && box.isConnected;
    const draw = m => { if (live()) this._fsInfoRender(box, m); };
    const dec = s => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value; };
    const plain = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const mins = sec => { sec = Math.round(+sec || 0); if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? h + 'h ' + m + 'm' : m + ' min'; };
    const day = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
    const chips = list => list.filter(c => c && c[1] !== undefined && c[1] !== null && String(c[1]).trim() !== '');
    try {
      if (kind === 'music') {
        const radio = this._fsIsRadio();
        const st = radio ? this._fsStation(a) : null;
        // a station sends its own name as the "album" (e.g. "Drone Zone [SomaFM]"), so it's never looked up as one
        const album = radio ? '' : (a.media_album_name || '');
        const m = radio
          ? { heading: 'Now playing on ' + st.name, title: a.media_title || '', sub: a.media_artist || '', chips: [], chips2: st.line }
          : album
            ? { heading: opt.instrumental ? 'Instrumental · From the album' : 'From the album', title: album, sub: '', chips: [] }
            : { heading: opt.instrumental ? 'Instrumental' : 'About this song', title: a.media_title || '', sub: this._fsReal(a.media_artist), chips: [] };
        draw(m);
        // Discogs is only asked when there's a real artist (an "[unknown]" one finds some other record)
        const artist = this._fsReal(a.media_artist);
        const [dg, aq] = await Promise.all([
          artist ? Promise.resolve(this._lookupDiscogsForAIData?.(artist, album, a.media_title || '')).catch(() => null) : null,
          radio ? null : Promise.resolve(this._audioQualityNow?.()).catch(() => null),
        ]);
        let r = dg && typeof dg === 'object' ? dg : null;
        // on the radio there's no album to go by, so a release only counts when this song is on it
        // (otherwise Discogs' artist-only search could offer another of the artist's albums)
        if (radio && r) {
          const n = x => String(x || '').toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/[^a-z0-9]+/g, '');
          const want = n(a.media_title);
          if (!want || !(r.tracklist || []).some(t => { const h = n(t?.title); return h && (h === want || h.includes(want) || want.includes(h)); })) r = null;
        }
        const arr = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => typeof x === 'string' ? x : x?.name || '').filter(Boolean);
        const genre = [...new Set([...arr(r?.genre), ...arr(r?.style)])].slice(0, 2).join(', ');
        const fmt = [...new Set(arr(r?.format))].filter(f => !/^(album|lp|stereo|reissue|remastered|file)$/i.test(f)).slice(0, 2).join(', ');
        // the album the song really comes from (Discogs gives "Artist - Album")
        const relAlbum = r ? String(r.title || '').split(' - ').slice(1).join(' - ').trim() : '';
        m.chips = chips([
          ['Album', radio && relAlbum ? relAlbum : ''],
          ['Year', r?.year && r.year !== '0' ? String(r.year) : ''],
          ['Label', arr(r?.label)[0] || ''],
          ['Genre', genre],
          ['Format', radio ? '' : fmt],
        ]);
        if (aq) m.chips2 = [aq.head, aq.detail, aq.source].filter(Boolean).join(' · ');
        if (!m.chips.length && !radio && !opt.instrumental) m.desc = 'No lyrics found for this song.';
        draw(m);
        return;
      }
      if (kind === 'radio') {
        let station = null;
        try { station = this._rbGetLastPlayed?.(this._entity, this._rbStreamKey?.(a)) || null; } catch (_) { station = null; }
        if (!station) { try { const u = String(a.media_content_id || '').replace(/^builtin:\/\/radio\//i, ''); station = u ? this._rbCachedStation?.(u) : null; } catch (_) { station = null; } }
        // a station started outside the card: look it up in the station directory (the same lookup the main player
        // uses for its artwork), and only use what comes back when its name matches what's playing
        if (!station) {
          const n = x => String(x || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
          const nm = n(a.media_station || a.media_album_name || a.media_title);
          if (nm) {
            draw({ heading: 'Live radio', title: this._fsStation(a).name, sub: '', chips: [], chips2: 'Live' });
            try { await this._rbAutoResolveStationArt?.(this._entity); } catch (_) {}
            let found = null;
            try { found = this._rbGetLastPlayed?.(this._entity, this._rbStreamKey?.(a)) || null; } catch (_) { found = null; }
            const fn = n(found?.name);
            if (found && fn && (fn === nm || fn.includes(nm) || nm.includes(fn))) station = found;
          }
        }
        const flag = cc => cc && cc.length === 2 ? cc.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397)) + ' ' : '';
        const tags = String(station?.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 3).map(t => t.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
        const sl = this._fsStation(a, station);
        draw({
          chips2: [sl.stream, 'Live'].filter(Boolean).join(' · '),
          heading: 'Live radio',
          title: station?.name || sl.name || a.media_title || 'Radio',
          sub: a.media_title && (station?.name || sl.name) && a.media_title.trim().toLowerCase() !== String(station?.name || sl.name).trim().toLowerCase() ? a.media_title : '',
          chips: chips([
            ['Tags', tags],
            ['Country', station?.country || station?.countrycode ? flag(station.countrycode) + this._fsCountry(station) : ''],
            ['Language', station?.language ? station.language.charAt(0).toUpperCase() + station.language.slice(1) : ''],
          ]),
        });
        return;
      }
      if (kind === 'podcast') {
        const real = x => this._fsReal(x);
        const n = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const title = a.media_title || 'Podcast';
        const show0 = real(a.media_album_name) || real(a.media_artist);
        const m = { heading: 'Podcast episode', title, sub: show0, chips: chips([['Length', mins(a.media_duration)]]) };
        this._fsVidSub = { key: want, text: show0 };
        draw(m);
        // the podcast the card played it from (its feed has the episode's description)
        let pod = null;
        try { pod = this._pcCachedPod?.(this._pcNowPlaying?.url || a.media_content_id) || this._pcNowPlaying?.pod || null; } catch (_) { pod = null; }
        let ep = null;
        if (pod) {
          try {
            const feed = await this._pcResolveFeedUrl?.(pod);
            const eps = feed ? await this._pcFetchEpisodes(feed, 50) : [];
            ep = (eps || []).find(e => e.url && e.url === a.media_content_id) || (eps || []).find(e => n(e.title) === n(title)) || null;
          } catch (_) { ep = null; }
        }
        // played from somewhere else (Music Assistant's own podcasts): the episode from the iTunes Store's podcast
        // directory, by its title (and the show's name when there is one); only an exact title match is used
        let it = null;
        if (!ep && title) {
          try {
            const r = await crowFetch('https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=15&term=' + encodeURIComponent((show0 ? show0 + ' ' : '') + title));
            const list = r.ok ? ((await r.json()).results || []) : [];
            it = list.find(x => n(x.trackName) === n(title) && (!show0 || n(x.collectionName) === n(show0))) || list.find(x => n(x.trackName) === n(title)) || null;
          } catch (_) { it = null; }
        }
        const showName = pod?.collectionName || it?.collectionName || show0;
        m.sub = showName;
        this._fsVidSub = { key: want, text: showName };
        m.desc = plain(ep?.description || it?.description || it?.shortDescription || '');
        const itLen = it?.trackTimeMillis ? mins(it.trackTimeMillis / 1000) : '';
        m.chips = chips([
          ['Host', pod?.artistName && pod.artistName !== showName ? pod.artistName : ''],
          ['Released', ep?.date || (it?.releaseDate ? day(it.releaseDate) : '')],
          ['Length', ep?.duration || mins(a.media_duration) || itLen],
          ['Genre', pod?.primaryGenreName || (Array.isArray(it?.genres) ? (typeof it.genres[0] === 'string' ? it.genres[0] : it.genres[0]?.name || '') : '')],
        ]);
        // the episode's own picture, for when the speaker's doesn't load
        const pic = it?.artworkUrl600 || pod?.artworkUrl600 || '';
        if (pic) this._fsArtFb = { key: want, url: pic };
        draw(m);
        return;
      }
      if (kind === 'audiobook') {
        // the book, its author and the chapter playing, then (from the card's own LibriVox list, a LibriVox search by
        // its title, or the iTunes Store) a description and the chapters, with the one playing highlighted
        const real = x => this._fsReal(x);
        const n = x => String(x || '').toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
        const ch = this._fsChapter(a);
        const album = real(a.media_album_name);
        let book = null;
        try { book = this._abCachedBook?.(this._abNowPlaying?.url || a.media_content_id) || null; } catch (_) { book = null; }
        const bookTitle = book?.title || ch?.book || album || a.media_title || 'Audiobook';
        const chapter = ch?.chapter || (album && a.media_title && n(a.media_title) !== n(album) ? a.media_title : '');
        let author = book?.author || real(a.media_artist);
        const chLen = mins(a.media_duration);
        // how the chapter reads: "Book 1 - Chapter 01" → "Book 1, Chapter 1"
        const chapterShown = String(chapter || '').replace(/\s*[-–—:|]\s*/g, ', ').replace(/\b0+(\d)/g, '$1');
        const m = { heading: 'Audiobook', title: bookTitle, sub: author ? 'by ' + author : '', factsFirst: true,
          chips: chips([['Now playing', chapterShown], ['Length', chLen]]) };
        const say = () => { this._fsVidSub = { key: want, text: m.sub }; };
        say();
        draw(m);
        // not played from the card's own list: find it on LibriVox by its title (and author, when there is one)
        if (!book && bookTitle) {
          let list = [];
          try { list = (await this._abFetchBooks?.('title', bookTitle)) || []; } catch (_) { list = []; }
          const last = n(String(author || '').split(/\s+/).pop());
          book = list.find(b => n(b.title) === n(bookTitle) && (!last || n(b.author).includes(last)))
            || list.find(b => { const h = n(b.title); return h && (h.startsWith(n(bookTitle)) || n(bookTitle).startsWith(h)) && (!last || n(b.author).includes(last)); })
            || null;
        }
        if (book) {
          if (!author && book.author) { author = book.author; m.sub = 'by ' + author; say(); }
          m.desc = plain(dec(book.description || ''));
          const genre = Array.isArray(book.genres) ? (typeof book.genres[0] === 'string' ? book.genres[0] : book.genres[0]?.name || '') : '';
          m.chips = chips([['Now playing', chapterShown], ['Length', chLen], ['Genre', genre]]);
          if (book.artUrl) this._fsArtFb = { key: want, url: book.artUrl };
          m.chapters = 'loading';
          draw(m);
          let list = [];
          try { list = (await this._abFetchChapters(book.id, 50)) || []; } catch (_) { list = []; }
          // the chapter playing: its own link, else its numbers ("Book 1 - Chapter 01" is 1, 1) in the chapter's name
          // (LibriVox names them from their files, e.g. "warofworlds 1 01 wells")
          const nums = x => (String(x || '').match(/\d+/g) || []).map(Number);
          const want2 = nums(chapter);
          const hasRun = g => want2.length && g.some((_, i) => want2.every((w, j) => g[i + j] === w));
          const byUrl = list.some(c => c.url && c.url === a.media_content_id);
          // a chapter named after its file ("warofworlds 1 02 wells") reads as "Book 1, Chapter 2" (or "Chapter 2"),
          // following how the chapter playing is named; real chapter names are kept
          const part = (String(chapter || '').match(/^(book|part|volume|vol\.)/i) || [])[1];
          // (a chapter with no title of its own is named after its file here)
          const fileName = c => String(c.file || '').replace(/\.mp3$/i, '').replace(/^[\d_\-]+/, '').replace(/_/g, ' ').trim();
          const nice = (t, i, c) => {
            if (/^Chapter \d+$/.test(t) && c?.file) t = fileName(c) || t;
            if (!/^[a-z0-9]+( [a-z0-9]+)*$/.test(t) || !/\d/.test(t)) return t;
            const g = nums(t);
            if (part && g.length >= 2) return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() + ' ' + g[g.length - 2] + ', Chapter ' + g[g.length - 1];
            return 'Chapter ' + (g.length ? g[g.length - 1] : i + 1);
          };
          m.chapters = list.map((c, i) => {
            const t = dec(c.title);
            const on = byUrl ? c.url === a.media_content_id : (hasRun(nums(c.file ? fileName(c) : t)) || hasRun(nums(t)));
            return { num: c.num, title: nice(t, i, c), duration: c.duration || '', url: c.url, on };
          });
          // only one highlighted (the first match)
          let seen = false;
          m.chapters.forEach(c => { if (c.on) { if (seen) c.on = false; seen = true; } });
          m.book = book;
          draw(m);
          return;
        }
        // not on LibriVox: the iTunes Store's audiobooks (description, genre, year), only when the title matches
        let it = null;
        try {
          const r = await crowFetch('https://itunes.apple.com/search?media=audiobook&entity=audiobook&limit=15&term=' + encodeURIComponent(bookTitle + (author ? ' ' + author : '')));
          const res = r.ok ? ((await r.json()).results || []) : [];
          const w = n(bookTitle);
          it = res.find(x => { const h = n(x.collectionName); return h && (h === w || h.startsWith(w) || w.startsWith(h)); }) || null;
        } catch (_) { it = null; }
        if (it) {
          if (!author && it.artistName) { m.sub = 'by ' + it.artistName; say(); }
          m.desc = plain(dec(it.description || ''));
          m.chips = chips([['Now playing', chapterShown], ['Length', chLen], ['Genre', it.primaryGenreName || ''], ['Released', it.releaseDate ? String(it.releaseDate).slice(0, 4) : '']]);
          const pic = String(it.artworkUrl100 || it.artworkUrl60 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
          if (pic) this._fsArtFb = { key: want, url: pic };
          draw(m);
        }
        return;
      }
      if (kind === 'movie' || kind === 'tv') {
        await this._fsVideoInfo(a, kind, draw, want);
        return;
      }
    } catch (err) {
      console.warn('[Crow Media Player] full screen info', err);
    }
  },
  // ── Full screen: a film or a TV show ──
  // Only from TVmaze (no key needed), the iTunes Store (no key needed) and TMDB (with the editor's key):
  // never the AI. Apps such as Apple TV often send nothing but the title, so whether it's a film or a show
  // is worked out here: what Home Assistant says first, then a match picked in the info screen ("Not this
  // one?"), then TVmaze, with the length as the tie-break (a film runs an hour and a quarter or more).
  // If nothing knows it as a film but TVmaze knows it as a show, it's a show.
  async _fsVideoInfo(a, guess, draw, want) {
    const dec = s => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value; };
    const plain = s => dec(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const day = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
    const n = x => String(x || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    const facts = list => list.filter(c => c && c[1] !== undefined && c[1] !== null && String(c[1]).trim() !== '');
    const genre = g => (Array.isArray(g) ? g : []).map(x => typeof x === 'string' ? x : x?.name || '').filter(Boolean).slice(0, 2).join(', ');
    const starring = c => { const l = (Array.isArray(c) ? c : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 4); return l.length ? 'Starring ' + l.join(', ') : ''; };
    // the line under the player's title (the app's name is already beside the times)
    const under = t => { this._fsVidSub = { key: want, text: t || '' }; };
    const ct = String(a.media_content_type || '').toLowerCase();
    const sure = (a.media_series_title || a.media_season != null || a.media_episode != null || /tvshow|episode|season/.test(ct)) ? 'tv' : ct === 'movie' ? 'movie' : '';
    const raw = String((guess === 'tv' ? a.media_series_title || a.media_title : a.media_title) || '').trim();
    // the title straight away, without calling it a film or a show until that's known
    const m = { heading: '', title: raw, sub: '', chips: [], factsFirst: true };
    under('');
    draw(m);
    // the lookups are in the video file, which may not have loaded yet (a wall tablet that opens in full screen)
    try { await K.kit.crowMediaLoad?.('video'); } catch (_) {}
    let look = null;
    try { look = await this._videoLookupTitle?.(raw, guess === 'tv'); } catch (_) { look = null; }
    const clean = look?.title || raw;
    if (clean !== m.title) { m.title = clean; draw(m); }
    // a match picked in the info screen settles which title it is; its facts are only used when they came
    // from TMDB or TVmaze, so a match the AI described never shows its words here
    let picked = null;
    try { picked = this._videoChoiceGet?.(raw, clean) || null; } catch (_) { picked = null; }
    const pickType = picked?.type === 'tv' || picked?.type === 'movie' ? picked.type : '';
    const trusted = picked && (picked._fromTmdb || picked._fromTvmaze) ? picked : null;
    const name = String(picked?.title || clean);
    const year = String(picked?.year || '');
    let tvm;   // TVmaze's show for this title (undefined until it's been asked)
    const tvmaze = async () => {
      if (tvm === undefined) { try { tvm = (await this._lookupTVmazeShow?.(name)) || null; } catch (_) { tvm = null; } }
      return tvm;
    };
    let type = sure || pickType;
    if (!type) type = (await tvmaze()) && !(+a.media_duration >= 75 * 60) ? 'tv' : 'movie';

    if (type === 'movie') {
      let data = trusted?.type === 'movie' ? trusted : null;
      if (!data && this._tmdbKey?.()) { try { data = (await this._lookupTMDBExact?.(name, { type: 'movie', year: year || null }))?.candidates?.[0] || null; } catch (_) { data = null; } }
      const [tx, itm] = await Promise.all([
        data?._fromTmdb ? Promise.resolve(this._mvTmdbExtras?.(data)).catch(() => null) : null,
        Promise.resolve(this._mvItunesMovie?.(data?.title || name, data?.year || year)).catch(() => null),
      ]);
      if (data || itm || sure === 'movie' || pickType === 'movie' || !(await tvmaze())) {
        const run = (tx && !tx.error && tx.runtime) || itm?.runtime || 0;
        const y = String(data?.year || year || '');
        m.title = data?.title || name;
        m.sub = ['Film', y, data?.director ? 'Directed by ' + data.director : ''].filter(Boolean).join(' · ');
        m.desc = plain(data?.overview || itm?.blurb || '');
        m.chips = facts([
          ['Certificate', (tx && !tx.error && tx.certificate) || itm?.certificate || ''],
          ['Runtime', run ? (run >= 60 ? Math.floor(run / 60) + 'h ' + (run % 60) + 'm' : run + ' min') : ''],
          ['Genre', genre(data?.genres)],
          ['Rating', data?.rating ? '★ ' + data.rating : ''],
        ]);
        m.cast = starring(data?.cast);
        under(['Film', y].filter(Boolean).join(' · '));
        draw(m);
        return;
      }
      // nothing knows it as a film, but TVmaze knows it as a show: carry on as a show
    }

    // a show: TVmaze first (it has the network, the cast and the episode guide), then TMDB
    const tv = await tvmaze();
    let show = trusted?.type === 'tv' ? { ...trusted } : null;
    const same = !!(tv && show && n(tv.title) === n(show.title) && (!show.year || !tv.year || String(show.year) === String(tv.year)));
    if (show && same) {
      // the match picked came from TMDB: TVmaze fills in what it doesn't have
      for (const k of ['network', 'overview', 'status', 'rating', 'seasons', 'year']) if (!show[k] && tv[k]) show[k] = tv[k];
      for (const k of ['cast', 'genres']) if (!(show[k] || []).length && (tv[k] || []).length) show[k] = tv[k];
    }
    if (!show) show = tv;
    if (!show && this._tmdbKey?.()) { try { show = (await this._lookupTMDBExact?.(name, { type: 'tv', year: year || null }))?.candidates?.[0] || null; } catch (_) { show = null; } }
    const title = String(show?.title || name);
    const useTvm = !!tv && (show === tv || same);
    const [eps, cert] = await Promise.all([
      useTvm ? Promise.resolve(this._tvmazeEpisodes?.(title)).catch(() => null) : null,
      Promise.resolve(this._mvItunesTvCert?.(title)).catch(() => null),
    ]);
    const list = Array.isArray(eps) ? eps : [];
    const se = +a.media_season, en = +a.media_episode;
    const epTitle = a.media_series_title ? String(a.media_title || '') : '';
    const ep = list.find(e => se && en && e.season === se && e.ep === en) || (epTitle ? list.find(e => n(dec(e.title)) === n(epTitle)) : null) || null;
    // the years it ran, from the episode guide ("2008–2013", "2019–present")
    const dates = list.map(e => e.airdate).filter(Boolean).sort();
    const y0 = String(dates[0] || '').slice(0, 4) || String(show?.year || ''), y1 = String(dates[dates.length - 1] || '').slice(0, 4);
    const st = String(show?.status || '');
    const running = /running|returning|in production|development/i.test(st);
    const ended = /ended|cancel/i.test(st);
    const years = y0 ? (running ? y0 + '–present' : ended && y1 && y1 !== y0 ? y0 + '–' + y1 : y0) : '';
    const status = running ? 'Still running' : /cancel/i.test(st) ? 'Cancelled' : ended ? 'Ended' : '';
    const net = String(show?.network || '');
    const seasons = +show?.seasons || 0;
    const certTxt = cert?.certificate || '';
    if (ep) {
      m.title = dec(ep.title);
      m.sub = title + ' · Season ' + ep.season + ', Episode ' + ep.ep;
      m.desc = plain(ep.overview) || plain(show?.overview);
      m.chips = facts([['Aired', day(ep.airdate)], ['Network', net], ['Certificate', certTxt], ['Genre', genre(show?.genres)]]);
    } else {
      m.title = title;
      m.sub = ['TV series', net, years].filter(Boolean).join(' · ');
      m.desc = plain(show?.overview);
      m.chips = facts([
        ['Episode', epTitle || (se && en ? 'Season ' + se + ', Episode ' + en : '')],
        ['Status', status],
        ['Seasons', seasons ? String(seasons) : ''],
        ['Certificate', certTxt],
        ['Genre', genre(show?.genres)],
        ['Rating', show?.rating ? '★ ' + show.rating : ''],
      ]);
    }
    m.cast = starring(show?.cast);
    under(net || 'TV series');
    draw(m);
  },
  _fsInfoRender(box, m) {
    const esc = t => this._cmpEsc(t);
    // each fact as it reads in a sentence; the ones that need a word to make sense get one
    const say = { Host: v => 'Hosted by ' + v, Aired: v => 'Aired ' + v, Released: v => 'Released ' + v, Seasons: v => v + (v === '1' ? ' season' : ' seasons'),
      Certificate: v => 'Cert ' + v, Network: v => v, Chapter: v => v };
    // each fact kept whole: a line only breaks between facts, never inside one
    const facts = list => list.filter(Boolean).map(t => `<span>${esc(t)}</span>`).join(' · ');
    const line = facts((m.chips || []).map(([l, v]) => (say[l] ? say[l](v) : v)));
    const chips = (line ? `<div class="cfs-if">${line}</div>` : '') + (m.chips2 ? `<div class="cfs-if cfs-if2">${facts(String(m.chips2).split(' · '))}</div>` : '');
    let chap = '';
    if (m.chapters === 'loading') chap = '<div class="cfs-chl"><div class="cfs-chmsg">Loading the chapters…</div></div>';
    else if (Array.isArray(m.chapters)) chap = m.chapters.length
      ? '<div class="cfs-chl">' + m.chapters.map((c, i) => `<button type="button" class="cfs-ch${c.on ? ' on' : ''}" data-ch="${i}"><span class="n">${esc(c.num)}</span><span class="t">${esc(c.title)}</span><span class="d">${c.on ? 'Playing' : esc(c.duration)}</span></button>`).join('') + '</div>'
      : '<div class="cfs-chl"><div class="cfs-chmsg">No chapters found.</div></div>';
    // films and shows: no heading, the facts straight under the title, then the overview and who's in it
    const desc = m.desc ? `<div class="cfs-id">${esc(m.desc)}</div>` : '';
    const cast = m.cast ? `<div class="cfs-icast">${esc(m.cast)}</div>` : '';
    const html = `<div class="cfs-info${m.chapters ? ' has-ch' : ''}" data-a="info" role="button" tabindex="0" aria-label="${esc(m.heading || m.title || 'Info')}. Tap for more">
      ${m.icon ? `<img class="cfs-iicon" alt="" src="${esc(m.icon)}" onerror="this.remove()">` : ''}
      ${m.heading ? `<div class="cfs-ih">${esc(m.heading)}</div>` : ''}
      ${m.title ? `<div class="cfs-it">${esc(m.title)}</div>` : ''}${m.sub ? `<div class="cfs-is">${esc(m.sub)}</div>` : ''}
      ${m.factsFirst ? chips + desc : desc + chips}${m.stat !== undefined ? `<div class="cfs-if cfs-if2 cfs-appstat">${esc(m.stat)}</div>` : ''}${cast}${chap}</div>`;
    if (box._infoHtml === html && box.querySelector(':scope > .cfs-info')) return;
    box._infoHtml = html;
    box.innerHTML = html;
    box.scrollTop = 0;
    // a chapter: tap to play it; the one playing is kept in view
    if (Array.isArray(m.chapters)) {
      box.querySelectorAll('.cfs-ch').forEach(row => row.addEventListener('click', e => {
        e.stopPropagation();
        const c = m.chapters[+row.dataset.ch];
        if (c?.url) this._abPlayChapter(c.url, c.title, this._resolveMATargetEntity?.() || this._entity, m.book);
      }));
      const on = box.querySelector('.cfs-ch.on');
      // only scrolled when the playing chapter would be out of sight, so the book's title stays in view for early chapters
      if (on) requestAnimationFrame(() => { if (on.offsetTop + on.offsetHeight > box.clientHeight * 0.85) box.scrollTop = Math.max(0, on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2); });
    }
  },
  _fsShowSynced(box, lines) {
    this._fsLyr = lines.filter(l => !l.isInstrumental && typeof l.time === 'number');
    this._fsLyrPlain = false;
    box.innerHTML = '<div class="cfs-lpad"></div>' + this._fsLyr.map((l, i) => `<div class="cfs-line" data-i="${i}"></div>`).join('') + '<div class="cfs-lpad"></div>';
    box.querySelectorAll('.cfs-line').forEach((el, i) => { el.textContent = this._fsLyr[i].text || '♪'; });
    box.scrollTop = 0;
    box.dataset.mode = this._config?.lyrics_scroll_mode || 'highlight';
    this._fsLyrIdx = -2;
    this._fsLy = null;
    this._fsTransOn = false;
    {
      const a = this._hass?.states?.[this._entity]?.attributes || {};
      const key = ((a.media_artist || '') + '|' + (a.media_title || '')).toLowerCase();
      const tr = this._lyricsTransPinned?.has(key) ? this._lyricsTransGet(key) : null;
      if (tr && !tr.same && tr.map) { this._fsTransOn = true; this._fsApplyTrans(tr); }
    }
    // a swipe through the lyrics is left alone; a moment after you let go the scroll glides back
    if (!box._crowSwipe) {
      box._crowSwipe = true;
      let sy = 0;
      box.addEventListener('touchstart', e => { sy = e.touches[0]?.clientY ?? 0; }, { passive: true });
      box.addEventListener('touchmove', e => { if (Math.abs((e.touches[0]?.clientY ?? 0) - sy) > 6) this._fsLyUser = Date.now() + 3000; }, { passive: true });
      box.addEventListener('touchend', () => { if (this._fsLyUser > Date.now()) this._fsLyUser = Date.now() + 3000; }, { passive: true });
      box.addEventListener('wheel', () => { this._fsLyUser = Date.now() + 3000; }, { passive: true });
    }
    this._fsLyUser = 0;
    this._fsLyrStart(true);
  },
  // ── Full screen lyrics scroll ──
  // The same scroll as the lyrics opened from the artwork: it never stops, drifting gently through each
  // line and gliding into the next on a soft spring so it arrives just as that line starts. Here the
  // current line sits in the middle of the lyrics area and grows as it reaches its place.
  _fsLyrStart(snap) {
    if (snap) this._fsLy = null;
    if (this._fsLyRaf) return;
    this._fsLyLast = performance.now();
    const step = (now) => {
      let more = false;
      try { more = this._fsLyrTick(now); } catch (_) { more = false; }
      this._fsLyRaf = more ? requestAnimationFrame(step) : null;
    };
    this._fsLyRaf = requestAnimationFrame(step);
  },
  _fsLyrPos(now) {
    const s = this._hass?.states?.[this._entity];
    const moving = s?.state === 'playing' || s?.state === 'buffering';
    // the progress bar's own position when the card has one, carried forward smoothly between updates
    if (this._lyLiveAt != null && now - this._lyLiveAt < 3000) return this._lyLivePos + (moving ? (now - this._lyLiveAt) / 1000 : 0);
    return this._fsPosNow();
  },
  // where the song is, worked out the same way as the main player's progress bar: carried forward from
  // Home Assistant's last report (even when that report was 0:00), and straight to a new spot after a seek
  _fsPosNow() {
    const s = this._hass?.states?.[this._entity];
    const a = s?.attributes || {};
    const dur = +a.media_duration || 0;
    if (a.media_position === undefined || a.media_position === null) return 0;
    let p = +a.media_position || 0;
    const moving = s?.state === 'playing' || s?.state === 'buffering';
    if (a.media_position_updated_at && moving) p += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
    if (this._optimisticSeekPos !== undefined && this._optimisticSeekTime !== undefined) {
      const at = a.media_position_updated_at ? new Date(a.media_position_updated_at).getTime() : 0;
      if (at < this._optimisticSeekTime) p = this._optimisticSeekPos + (moving ? (Date.now() - this._optimisticSeekTime) / 1000 : 0);
    }
    return Math.max(0, dur ? Math.min(p, dur) : p);
  },
  _fsLyrTick(now) {
    const v = this.shadowRoot?.getElementById('crowFs');
    const box = v?.querySelector('.cfs-lyrics');
    const L = this._fsLyr;
    if (!this._fs || !this.isConnected || !box || !L || !L.length) { this._fsLy = null; return false; }
    const els = box.querySelectorAll('.cfs-line'), n = Math.min(els.length, L.length);
    if (!n) return false;
    // the editor's lyrics scroll setting: Highlight (the default), Scroll (no highlight), None (no scrolling)
    const mode = this._config?.lyrics_scroll_mode || 'highlight';
    if (box.dataset.mode !== mode) box.dataset.mode = mode;
    if (mode === 'none') { this._fsLy = null; return false; }
    const dt = Math.min(0.05, Math.max(0.001, (now - (this._fsLyLast || now)) / 1000));
    this._fsLyLast = now;
    const st = this._hass?.states?.[this._entity]?.state;
    const moving = st === 'playing' || st === 'buffering';
    const pos = this._fsLyrPos(now);

    // the highlighted line
    let idx = -1;
    for (let k = 0; k < n; k++) { if (L[k].time <= pos) idx = k; else break; }
    if (idx !== this._fsLyrIdx) {
      this._fsLyrIdx = idx;
      els.forEach((el, i) => { el.classList.toggle('on', i === idx); el.classList.toggle('past', i < idx); });
    }

    // where the scroll should be, as a fractional line number (the same timing as the lyrics in the card)
    // the current line holds the middle; the scroll glides to the next line only in the last
    // half-second before it starts, so the line being sung is always the one in the middle
    const p = pos + 0.15;
    let ci = -1;
    for (let k = 0; k < n; k++) { if (L[k].time <= p) ci = k; else break; }
    let target = Math.max(0, ci);
    if (ci >= 0 && ci < n - 1) {
      const s0 = L[ci].time, s1 = L[ci + 1].time, span = Math.max(0.3, s1 - s0);
      const glide = Math.min(0.5, span * 0.5);
      const g = Math.max(0, Math.min(1, (p - (s1 - glide)) / glide)), ge = g * g * (3 - 2 * g);
      target = ci + ge;
    }

    // follow it on a soft spring (it jumps straight there when the song is skipped or seeks a long way)
    let S = this._fsLy, snapped = false;
    if (!S || Math.abs(target - S.pos) > 4 || S.for !== L) { S = this._fsLy = { pos: target, vel: 0, for: L, off: 0, offVel: 0, driving: false, scaled: new Set() }; snapped = true; }
    const K = 90, D = 2 * Math.sqrt(K) * 1.05;
    for (let i = 0, steps = Math.ceil(dt / 0.008); i < steps; i++) {
      const h = dt / steps;
      S.vel += ((target - S.pos) * K - S.vel * D) * h;
      S.pos += S.vel * h;
    }

    // a fractional line number → scrollTop, measured from the live layout every frame, with the
    // middle of the current line in the middle of the lyrics area
    const anchor = box.clientHeight * 0.5;
    const lineY = (k) => { const el = els[Math.max(0, Math.min(n - 1, k))]; return el.offsetTop + el.offsetHeight / 2 - anchor; };
    const toPx = (x) => { const k = Math.floor(x), f = x - k; const a = lineY(k); return a + (lineY(k + 1) - a) * f; };
    const want = toPx(S.pos);
    const driving = !(this._fsLyUser > Date.now());
    if (driving) {
      // coming back from a swipe: glide home from wherever the lyrics were left
      if (!S.driving && !snapped) { S.off = box.scrollTop - want; S.offVel = 0; }
      if (S.off) {
        const K2 = 28, D2 = 2 * Math.sqrt(K2);
        S.offVel += (-S.off * K2 - S.offVel * D2) * dt;
        S.off += S.offVel * dt;
        if (Math.abs(S.off) < 0.3 && Math.abs(S.offVel) < 0.3) { S.off = 0; S.offVel = 0; }
      }
      const top = Math.max(0, want + S.off);
      if (Math.abs(box.scrollTop - top) > 0.25) box.scrollTop = top;
    }
    S.driving = driving;

    // the current line grows as it reaches the middle and shrinks as it leaves (scaled, so nothing re-flows)
    const keep = new Set();
    const c = Math.round(S.pos);
    for (let k = Math.max(0, c - 2); mode === 'highlight' && k <= Math.min(n - 1, c + 2); k++) {
      const d = Math.min(1, Math.abs(k - S.pos)), e = d * d * (3 - 2 * d);
      const sc = 1 + 0.08 * (1 - e);
      if (sc > 1.0005) { els[k].style.transform = 'scale(' + sc.toFixed(4) + ')'; keep.add(k); }
    }
    S.scaled.forEach(k => { if (!keep.has(k) && els[k]) els[k].style.transform = ''; });
    S.scaled = keep;

    // nothing left to move while the music is stopped: rest until it plays again (the 500ms update restarts it)
    const settled = Math.abs(target - S.pos) < 0.0005 && Math.abs(S.vel) < 0.001 && !S.off;
    if (!moving && settled && driving) { S.driving = false; return false; }
    return true;
  },
  // the next song, shown under the lyrics; tapping it opens its info screen
  async _fsQueue(v, key, force) {
    if (key === this._fsQKey && !force) return;
    if (key === this._fsQKey && force && this._fsQBusy) return;
    this._fsQKey = key;
    const strip = v.querySelector('.cfs-next');
    if (!strip) return;
    if (!key) { strip.hidden = true; this._fsNext = null; return; }
    this._fsQBusy = true;
    let items = [];
    try {
      const eid = this._cmpIsMa(this._entity) ? this._entity : (this._resolveMATargetEntity?.() || this._entity);
      const cur = this._hass?.states?.[this._entity]?.attributes || {};
      // Music Assistant's own idea of what's next, straight from its queue (through Queue Actions)
      const _mq = this._maQueueId(eid) || this._maQueueId(this._entity);
      if (_mq && this._maCmdOn()) {
        try {
          const q = await this._maQueueGet(_mq, { fresh: !!force });
          if (q?.next_item) { const m = this._maItem(q.next_item, 1, 0); items = [{ title: m.title, artist: m.artist, image: m.thumbnail || '' }]; }
          else if (q && typeof q.current_index === 'number') items = [];   // nothing after this song
        } catch (_) { items = []; }
      }
      // otherwise the queue list, read the same way as the Queue panel, so the two always agree: find the song
      // playing now (its flag, then its id, then its title) and take the one after it
      if (!items.some(x => x.title) && this._hass?.services?.mass_queue?.get_queue_items) {
        try {
          const res = await this._hass.connection.sendMessagePromise({ type: 'call_service', domain: 'mass_queue', service: 'get_queue_items',
            service_data: { entity: eid, limit_before: 5, limit_after: 3 }, return_response: true });
          const raw = res?.response?.[eid] || res?.response || [];
          if (Array.isArray(raw) && raw.length) {
            let at = raw.findIndex(x => x.active === true || x.state === 'playing');
            if (at === -1 && cur.media_content_id) at = raw.findIndex(x => (x.media_content_id || x.uri) === cur.media_content_id);
            const t = (cur.media_title || '').trim().toLowerCase();
            if (at === -1 && t) at = raw.findIndex(x => (x.media_title || x.name || '').trim().toLowerCase() === t);
            const x = at >= 0 ? raw[at + 1] : null;
            if (x) items = [{ title: x.media_title || x.name || '', artist: x.media_artist || x.artist || '', image: x.media_image || x.local_image_encoded || x.thumbnail || '' }];
          }
        } catch (_) { items = []; }
      }
      // otherwise Music Assistant's own idea of the next song
      if (!items.some(x => x.title) && this._hass?.services?.music_assistant?.get_queue) {
        const res = await this._hass.connection.sendMessagePromise({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
          service_data: { entity_id: eid }, return_response: true });
        const q = res?.response?.[eid] || {};
        const n = q.next_item;
        if (n) {
          const img = n.media_item?.image?.path || n.media_item?.image || n.image?.path || n.image || '';
          items = [{ title: n.media_item?.name || n.name || '', artist: (n.media_item?.artists || []).map(x => x.name).join(', '), image: typeof img === 'string' ? img : '' }];
        }
      }
    } catch (_) { items = []; }
    this._fsQBusy = false;
    if (this._fsQKey !== key || !this._fs) return;
    const n = items.find(x => x.title) || null;
    this._fsNext = n;
    strip.hidden = !n;
    if (n) {
      const esc = t => this._cmpEsc(t);
      strip.querySelector('.cfs-nextt').textContent = n.title + (n.artist ? ' — ' + n.artist : '');
      strip.querySelector('.cfs-nextart').innerHTML = n.image ? `<img src="${esc(n.image)}" alt="" onerror="this.remove()">` : '';
      strip.setAttribute('aria-label', 'Up next: ' + n.title + (n.artist ? ' by ' + n.artist : '') + '. Open the queue');
    }
  }
});

K.ready.fullscreen = true;
})();
