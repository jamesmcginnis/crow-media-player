"""Made for You mixes: playlists made by Home Assistant from what the house listens to.

On Repeat, Your Month in Music and Forgotten Favourites come straight from the listening history. Discover
Weekly and the mood mixes are chosen by the AI from the house's taste. Every song is checked against Music
Assistant, so only songs it can play are kept, and the mixes are kept here (Music Assistant can't be given
new playlists from Home Assistant). They're made again each week on the chosen day, and the month mix on the
1st of each month.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.util import dt as dt_util

from . import ai

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MIN_TRACKS = 8
MAX_TRACKS = 40
MISS_SECONDS = 14 * 86400

# kind -> title, what it is, colours for its cover, how it's made
KINDS: dict[str, dict[str, Any]] = {
    "repeat": {"title": "On Repeat", "about": "The songs the house has played most in the last 30 days.",
               "colors": ["#FF2D55", "#FF9500"], "source": "history"},
    "month": {"title": "Your Month in Music", "about": "Last month's most played songs.",
              "colors": ["#5856D6", "#AF52DE"], "source": "history"},
    "forgotten": {"title": "Forgotten Favourites", "about": "Songs the house loved a while ago, but hasn't played lately.",
                  "colors": ["#FF9F0A", "#FFD60A"], "source": "history"},
    "discover": {"title": "Discover Weekly", "about": "New-to-you music, chosen by AI from the house's taste.",
                 "colors": ["#0A84FF", "#64D2FF"], "source": "ai"},
    "sunday": {"title": "Sunday Morning", "about": "Easy, warm songs for a slow start.", "mood": "a slow, sunny Sunday morning",
               "colors": ["#FFB340", "#FF6482"], "source": "ai"},
    "focus": {"title": "Focus", "about": "Steady music that stays out of the way.", "mood": "focusing on work, mostly instrumental or calm",
              "colors": ["#30B0C7", "#34C759"], "source": "ai"},
    "dinner": {"title": "Dinner Party", "about": "Good company music for the table.", "mood": "a relaxed dinner party with friends",
               "colors": ["#BF5AF2", "#FF375F"], "source": "ai"},
    "workout": {"title": "Workout", "about": "Upbeat songs to keep moving.", "mood": "an energetic workout",
                "colors": ["#FF453A", "#FF9F0A"], "source": "ai"},
    "evening": {"title": "Chill Evening", "about": "Unwinding at the end of the day.", "mood": "a chilled, cosy evening in",
                "colors": ["#5E5CE6", "#0A84FF"], "source": "ai"},
    "drive": {"title": "Road Trip", "about": "Windows-down singalongs.", "mood": "a long road trip with singalongs",
              "colors": ["#32D74B", "#FFD60A"], "source": "ai"},
}
DEFAULT_KINDS = ["repeat", "month", "forgotten", "discover", "sunday", "dinner"]


def _norm(s: Any) -> str:
    s = re.sub(r"\s*[\(\[].*?[\)\]]", "", str(s or "").lower())
    s = re.sub(r"\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


class Mixes:
    def __init__(self, hass: HomeAssistant, media: "CrowMedia") -> None:
        self.hass = hass
        self.m = media
        self._unsubs: list = []
        self.busy = False
        self.m.house.setdefault("mixes", {})
        self.m.cache.setdefault("uri", {})

    # ── settings (Configure) ────────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        return self.m.options.get("mixes", True) is not False

    def kinds(self) -> list[str]:
        k = self.m.options.get("mix_kinds")
        return [x for x in (k if isinstance(k, list) else DEFAULT_KINDS) if x in KINDS]

    def refresh_day(self) -> int:
        d = str(self.m.options.get("mix_day") or "mon")[:3].lower()
        return DAYS.index(d) if d in DAYS else 0

    # ── when ────────────────────────────────────────────────────────────────
    def start(self) -> None:
        self._unsubs.append(async_track_time_change(self.hass, self._daily, hour=5, minute=40, second=0))
        # after a restart: make any that are missing or out of date
        self._unsubs.append(async_call_later(self.hass, 240, self._catch_up))

    def stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs.clear()

    @callback
    def _daily(self, now: datetime) -> None:
        if not self.enabled:
            return
        local = dt_util.as_local(now)
        due = []
        if local.weekday() == self.refresh_day():
            due += [k for k in self.kinds() if k != "month"]
        if local.day == 1 and "month" in self.kinds():
            due.append("month")
        if due:
            self.hass.async_create_task(self.async_make(due, notify=True))

    @callback
    def _catch_up(self, _now=None) -> None:
        if not self.enabled:
            return
        have = self.m.house["mixes"]
        now = dt_util.now()
        due = []
        for k in self.kinds():
            mix = have.get(k)
            if not mix:
                due.append(k)
            elif k == "month":
                if mix.get("period") != self._last_month(now)[2]:
                    due.append(k)
            elif time.time() * 1000 - (mix.get("made") or 0) > 8 * 86_400_000:
                due.append(k)
        # mixes no longer chosen in Configure go
        gone = [k for k in have if k not in self.kinds()]
        for k in gone:
            del have[k]
        if gone:
            self.m.save_house()
            self.m.push({"type": "mixes"})
        if due:
            self.hass.async_create_task(self.async_make(due))

    # ── what can play them ──────────────────────────────────────────────────
    def ma_entry_id(self) -> str | None:
        for e in self.hass.config_entries.async_entries("music_assistant"):
            if e.state is ConfigEntryState.LOADED:
                return e.entry_id
        return None

    # ── making them ─────────────────────────────────────────────────────────
    async def async_make(self, kinds: list[str] | None = None, notify: bool = False) -> list[str]:
        """Make (or make again) these mixes. Returns the titles made."""
        if self.busy:
            return []
        entry_id = self.ma_entry_id()
        if not entry_id:
            _LOGGER.debug("Made for You mixes need Music Assistant")
            return []
        self.busy = True
        self.m.push({"type": "mixes"})
        made: list[str] = []
        try:
            for kind in kinds or self.kinds():
                if kind not in KINDS:
                    continue
                try:
                    mix = await self._make_one(kind, entry_id)
                except Exception as err:  # noqa: BLE001 - one mix failing doesn't stop the rest
                    _LOGGER.warning("Crow Media Player couldn't make %s: %s", KINDS[kind]["title"], err)
                    continue
                if mix:
                    self.m.house["mixes"][kind] = mix
                    made.append(mix["title"])
                    self.m.save_house()
                    self.m.push({"type": "mixes"})
        finally:
            self.busy = False
            self.m.push({"type": "mixes"})
        if made and notify and self.m.options.get("notify_mixes"):
            await self.m.discover.notify("New mixes for you", "Ready in Made for You: " + ", ".join(made) + ".")
        return made

    def _entries(self) -> list[dict]:
        muted = self.m._muted()  # noqa: SLF001
        return [e for e in self.m.house["log"].values()
                if (e.get("data") or {}).get("artist") and (e["data"].get("artist") or "").lower() not in muted]

    @staticmethod
    def _last_month(now: datetime) -> tuple[int, int, str]:
        first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev = (first - timedelta(days=1)).replace(day=1)
        return int(prev.timestamp() * 1000), int(first.timestamp() * 1000), prev.strftime("%Y-%m")

    @staticmethod
    def _rank(entries: list[dict]) -> list[dict]:
        counts: dict[str, dict] = {}
        for e in entries:
            d = e["data"]
            k = f"{_norm(d.get('artist'))}|{_norm(d.get('title'))}"
            c = counts.setdefault(k, {"artist": d.get("artist"), "title": d.get("title"), "album": d.get("album") or "", "n": 0, "last": 0})
            c["n"] += 1
            c["last"] = max(c["last"], e.get("ts") or 0)
        return sorted(counts.values(), key=lambda c: (-c["n"], -c["last"]))

    async def _make_one(self, kind: str, entry_id: str) -> dict | None:
        spec = KINDS[kind]
        now = dt_util.now()
        now_ms = int(time.time() * 1000)
        entries = self._entries()
        extra: dict[str, Any] = {}
        title = spec["title"]
        if kind == "repeat":
            cands = [c for c in self._rank([e for e in entries if e["ts"] >= now_ms - 30 * 86_400_000]) if c["n"] >= 2]
        elif kind == "month":
            a, b, period = self._last_month(now)
            cands = self._rank([e for e in entries if a <= e["ts"] < b])
            name = dt_util.as_local(dt_util.utc_from_timestamp(a / 1000)).strftime("%B")
            title = f"{name} in Music"
            extra = {"period": period}
        elif kind == "forgotten":
            recent = {f"{_norm(e['data'].get('artist'))}|{_norm(e['data'].get('title'))}" for e in entries
                      if e["ts"] >= now_ms - 21 * 86_400_000}
            older = [e for e in entries if e["ts"] < now_ms - 30 * 86_400_000]
            cands = [c for c in self._rank(older) if c["n"] >= 2 and f"{_norm(c['artist'])}|{_norm(c['title'])}" not in recent]
            random.shuffle(cands)
        else:
            cands = await self._ai_songs(kind)
        if len(cands) < MIN_TRACKS:
            _LOGGER.debug("%s: only %s songs so far", title, len(cands))
            return None
        tracks = await self._resolve(cands[: MAX_TRACKS + 20], entry_id)
        tracks = tracks[:MAX_TRACKS]
        if len(tracks) < MIN_TRACKS:
            return None
        if kind not in ("repeat", "month"):
            random.shuffle(tracks)
        return {"id": kind, "kind": kind, "title": title, "about": spec["about"], "colors": spec["colors"],
                "made": now_ms, "tracks": tracks, **extra}

    async def _ai_songs(self, kind: str) -> list[dict]:
        spec = KINDS[kind]
        entries = self._entries()
        liked = self.m.top_artists(90, 25)
        top = [f"{c['artist']} - {c['title']}" for c in self._rank(entries)[:20]]
        if kind == "discover":
            if len(liked) < 3:
                return []
            prompt = (
                "A household's favourite artists: " + ", ".join(liked) + ". Their most played songs: " + "; ".join(top) + ". "
                f"Suggest {MAX_TRACKS} songs they'd probably love but haven't heard: only by artists NOT in that list, "
                "a mix of well-known and lesser-known, no more than two songs per artist.")
        else:
            prompt = (f"Suggest {MAX_TRACKS} songs for {spec['mood']}. Mix well-known and lesser-known songs, no more than two "
                      "songs per artist." + (" The household often listens to " + ", ".join(liked[:15]) +
                                              "; include some of their songs and lean towards things they'd like." if liked else ""))
        prompt += ' Reply ONLY with a JSON array like [{"artist": "…", "title": "…"}].'
        agent = self.m.options.get("mix_agent") or None
        answer = await ai._ask(self.hass, prompt, agent)  # noqa: SLF001
        songs = ai._songs(answer)  # noqa: SLF001
        if kind == "discover":
            known = {_norm(a) for a in liked}
            songs = [s for s in songs if _norm(s["artist"]) not in known]
        return songs

    async def _resolve(self, cands: list[dict], entry_id: str) -> list[dict]:
        """Find each song in Music Assistant (kept, so each song is only looked up once)."""
        store = self.m.cache["uri"]
        sem = asyncio.Semaphore(4)
        now = time.time()

        async def one(c: dict) -> dict | None:
            key = f"{_norm(c['artist'])}|{_norm(c['title'])}"
            hit = store.get(key)
            if hit and (hit.get("uri") or now - hit.get("miss", 0) < MISS_SECONDS):
                return {**hit, "title": hit.get("title") or c["title"], "artist": hit.get("artist") or c["artist"]} if hit.get("uri") else None
            async with sem:
                try:
                    resp = await self.hass.services.async_call("music_assistant", "search", {
                        "config_entry_id": entry_id, "name": c["title"], "artist": c["artist"], "media_type": ["track"], "limit": 5},
                        blocking=True, return_response=True)
                except Exception as err:  # noqa: BLE001
                    _LOGGER.debug("Music Assistant search failed for %s - %s: %s", c["artist"], c["title"], err)
                    return None
            found = None
            for t in (resp or {}).get("tracks") or []:
                names = [_norm(a.get("name")) for a in t.get("artists") or []]
                if _norm(t.get("name")).startswith(_norm(c["title"])[:12]) and any(
                        n and (n in _norm(c["artist"]) or _norm(c["artist"]) in n) for n in names):
                    found = t
                    break
            if not found:
                store[key] = {"miss": now}
                return None
            hit = {"uri": found.get("uri"), "title": found.get("name") or c["title"],
                   "artist": ", ".join(a.get("name") for a in found.get("artists") or [] if a.get("name")) or c["artist"],
                   "album": ((found.get("album") or {}).get("name") or c.get("album") or ""), "image": found.get("image") or ""}
            store[key] = hit
            return hit

        results = await asyncio.gather(*(one(c) for c in cands))
        if len(store) > 6000:
            for k in list(store)[: len(store) - 5000]:
                del store[k]
        self.m.save_cache()
        seen, out = set(), []
        for r in results:
            if r and r["uri"] not in seen:
                seen.add(r["uri"])
                out.append({k: r.get(k, "") for k in ("uri", "title", "artist", "album", "image")})
        return out

    # ── for the cards and automations ───────────────────────────────────────
    def view(self) -> dict:
        order = {k: i for i, k in enumerate(KINDS)}
        mixes = sorted(self.m.house["mixes"].values(), key=lambda x: order.get(x.get("kind"), 99))
        return {"mixes": [m for m in mixes if m.get("kind") in self.kinds()], "making": self.busy, "enabled": self.enabled,
                "ma": bool(self.ma_entry_id())}

    def find(self, name: str) -> dict | None:
        n = _norm(name)
        for mix in self.m.house["mixes"].values():
            if n in (_norm(mix.get("id")), _norm(mix.get("title")), _norm(KINDS.get(mix.get("kind"), {}).get("title"))):
                return mix
        for mix in self.m.house["mixes"].values():
            if n and n in _norm(mix.get("title")):
                return mix
        return None

    async def async_play(self, entity_id: str, mix: dict, *, mode: str = "replace", shuffle: bool = False, start: int = 0) -> int:
        if not self.m._is_ma(entity_id):  # noqa: SLF001
            raise ValueError("Mixes play on Music Assistant speakers")
        uris = [t["uri"] for t in mix.get("tracks") or [] if t.get("uri")]
        if not uris:
            raise ValueError("This mix is empty")
        if shuffle:
            random.shuffle(uris)
        elif start:
            uris = uris[start:] + uris[:start]
        enqueue = {"replace": "replace", "next": "next", "add": "add"}.get(mode, "replace")
        await self.hass.services.async_call("music_assistant", "play_media", {
            "entity_id": entity_id, "media_id": uris, "media_type": "track", "enqueue": enqueue,
            **({"radio_mode": False} if enqueue == "replace" else {})}, blocking=True)
        return len(uris)
