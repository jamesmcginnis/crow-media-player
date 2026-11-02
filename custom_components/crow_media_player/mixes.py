"""Made for You mixes: playlists made by Home Assistant from what the house listens to.

On Repeat, Your Month in Music, Forgotten Favourites, the Daily Mixes, the room mixes, Time of Day, the
Weekend Mix, Fresh Finds and Artist Spotlight come straight from the listening history (no AI). Discover Weekly
and the mood mixes are chosen by the AI from the house's taste. Every song is checked against Music
Assistant, so only songs it can play are kept, and the mixes are kept here (Music Assistant can't be given
new playlists from Home Assistant). They're made again each week on the chosen day, the month mix on the 1st
of each month, and the Daily Mixes and Time of Day mixes every morning.
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
    # one kind can make several mixes (Daily Mix 1-3, a mix for each room, morning / afternoon / evening)
    "daily": {"title": "Daily Mixes", "about": "Artists the house plays together.", "source": "history", "every_day": True,
              "colors": ["#FF375F", "#BF5AF2"]},
    "rooms": {"title": "Room Mixes", "about": "The songs played most in this room.", "source": "history",
              "colors": ["#30B0C7", "#5E5CE6"]},
    "timeofday": {"title": "Time of Day", "about": "What the house plays at this time of day.", "source": "history", "every_day": True,
                  "colors": ["#FFD60A", "#FF9F0A"]},
    "weekend": {"title": "Weekend Mix", "about": "What the house plays on Saturdays and Sundays.", "source": "history",
                "colors": ["#FF6482", "#FFB340"]},
    "fresh": {"title": "Fresh Finds", "about": "Songs the house started playing in the last 30 days.", "source": "history",
              "colors": ["#34C759", "#30B0C7"]},
    "spotlight": {"title": "Artist Spotlight", "about": "This month's most played artist: the songs you play, and some you haven't heard yet.",
                  "source": "history", "colors": ["#FF2D55", "#5E5CE6"]},
}
DEFAULT_KINDS = ["repeat", "month", "forgotten", "discover", "sunday", "dinner",
                 "daily", "rooms", "timeofday", "weekend", "fresh", "spotlight"]
# the kinds there were before the history mixes were added: someone who chose their mixes in Configure then gets
# the new ones too (until they next save Configure, which records every kind they've seen)
OLD_KINDS = ["repeat", "month", "forgotten", "discover", "sunday", "focus", "dinner", "workout", "evening", "drive"]
DAILY_COLORS = [["#FF375F", "#BF5AF2"], ["#30D158", "#64D2FF"], ["#FF9F0A", "#FF453A"]]
ROOM_COLORS = [["#30B0C7", "#5E5CE6"], ["#FF9F0A", "#FF2D55"], ["#32D74B", "#0A84FF"], ["#BF5AF2", "#FF6482"],
               ["#FFD60A", "#34C759"], ["#64D2FF", "#AF52DE"]]
PERIODS = {"morning": ("Morning Mix", "What the house plays in the morning.", ["#FFD60A", "#FF9F0A"]),
           "afternoon": ("Afternoon Mix", "What the house plays in the afternoon.", ["#64D2FF", "#0A84FF"]),
           "evening": ("Evening Mix", "What the house plays in the evening.", ["#5E5CE6", "#BF5AF2"])}
MAX_ROOMS = 6
SESSION_GAP_MS = 45 * 60_000


def _period(hour: int) -> str:
    return "morning" if 5 <= hour < 12 else "afternoon" if 12 <= hour < 17 else "evening"


def _main_artist(a: Any) -> str:
    return re.split(r"\s*(?:,|&| feat\.? | ft\.? | x | with )\s*", str(a or ""), flags=re.I)[0].strip()


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
        if not isinstance(k, list):
            return [x for x in DEFAULT_KINDS if x in KINDS]
        seen = self.m.options.get("mix_kinds_seen")
        seen = seen if isinstance(seen, list) else OLD_KINDS
        return [x for x in KINDS if x in k or (x in DEFAULT_KINDS and x not in seen)]

    def _of(self, kind: str) -> list[dict]:
        return [mx for mx in self.m.house["mixes"].values() if mx.get("kind") == kind]

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
        else:
            due += [k for k in self.kinds() if KINDS[k].get("every_day")]
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
        today = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        for k in self.kinds():
            mixes = self._of(k)
            made = max((mx.get("made") or 0 for mx in mixes), default=0)
            if not mixes:
                due.append(k)
            elif k == "month":
                if mixes[0].get("period") != self._last_month(now)[2]:
                    due.append(k)
            elif KINDS[k].get("every_day"):
                if made < today:
                    due.append(k)
            elif time.time() * 1000 - made > 8 * 86_400_000:
                due.append(k)
        # mixes no longer chosen in Configure go
        gone = [i for i, mx in have.items() if mx.get("kind", i) not in self.kinds()]
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
                    mixes = await self._make_kind(kind, entry_id)
                except Exception as err:  # noqa: BLE001 - one mix failing doesn't stop the rest
                    _LOGGER.warning("Crow Media Player couldn't make %s: %s", KINDS[kind]["title"], err)
                    continue
                if mixes:
                    # this kind's mixes from before go (a room that's no longer played in, say)
                    have = self.m.house["mixes"]
                    for i in [i for i, mx in have.items() if mx.get("kind", i) == kind]:
                        del have[i]
                    for mix in mixes:
                        have[mix["id"]] = mix
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

    async def _make_kind(self, kind: str, entry_id: str) -> list[dict]:
        if kind == "daily":
            return await self._make_daily(entry_id)
        if kind == "rooms":
            return await self._make_rooms(entry_id)
        if kind == "timeofday":
            return await self._make_timeofday(entry_id)
        if kind == "weekend":
            return [m for m in [await self._make_weekend(entry_id)] if m]
        if kind == "fresh":
            return [m for m in [await self._make_fresh(entry_id)] if m]
        if kind == "spotlight":
            return [m for m in [await self._make_spotlight(entry_id)] if m]
        return [m for m in [await self._make_one(kind, entry_id)] if m]

    async def _finish(self, mid: str, kind: str, title: str, about: str, colors: list[str], cands: list[dict],
                      entry_id: str, shuffle: bool = True, **extra: Any) -> dict | None:
        """Check the songs against Music Assistant and make the mix (None if too few can be played)."""
        if len(cands) < MIN_TRACKS:
            _LOGGER.debug("%s: only %s songs so far", title, len(cands))
            return None
        tracks = (await self._resolve(cands[: MAX_TRACKS + 20], entry_id))[:MAX_TRACKS]
        if len(tracks) < MIN_TRACKS:
            return None
        if shuffle:
            random.shuffle(tracks)
        return {"id": mid, "kind": kind, "title": title, "about": about, "colors": colors,
                "made": int(time.time() * 1000), "tracks": tracks, **extra}

    def _since(self, days: int) -> list[dict]:
        cutoff = int(time.time() * 1000) - days * 86_400_000
        return [e for e in self._entries() if (e.get("ts") or 0) >= cutoff]

    @staticmethod
    def _local(e: dict) -> datetime:
        return dt_util.as_local(dt_util.utc_from_timestamp((e.get("ts") or 0) / 1000))

    @staticmethod
    def _varied(ranked: list[dict]) -> list[dict]:
        """The most played first, but a different selection each time it's made: the top songs, then a random
        pick weighted towards the more played ones."""
        top, rest = ranked[:15], ranked[15:]
        rest = sorted(rest, key=lambda c: -random.random() * (c["n"] + 1))
        return top + rest

    # Daily Mixes: the artists the house plays in the same sittings are grouped together (three groups, such as a
    # rock mix, a hip-hop mix and an 80s mix), each named after its main artists
    async def _make_daily(self, entry_id: str) -> list[dict]:
        entries = sorted(self._since(90), key=lambda e: ((e["data"].get("entity") or ""), e["ts"]))
        sessions: list[set[str]] = []
        names: dict[str, str] = {}
        plays: dict[str, int] = {}
        last_who, last_ts, cur = None, 0, set()
        for e in entries:
            who = e["data"].get("entity") or ""
            a = _main_artist(e["data"].get("artist"))
            k = _norm(a)
            if not k:
                continue
            names.setdefault(k, a)
            plays[k] = plays.get(k, 0) + 1
            if who != last_who or e["ts"] - last_ts > SESSION_GAP_MS:
                if cur:
                    sessions.append(cur)
                cur = set()
            cur.add(k)
            last_who, last_ts = who, e["ts"]
        if cur:
            sessions.append(cur)
        top = [k for k, n in sorted(plays.items(), key=lambda kv: -kv[1]) if n >= 2][:40]
        if len(top) < 3:
            return []
        in_sess = {k: [i for i, ss in enumerate(sessions) if k in ss] for k in top}
        def sim(a: str, b: str) -> float:
            sa, sb = set(in_sess[a]), set(in_sess[b])
            return len(sa & sb) / ((len(sa) * len(sb)) ** 0.5) if sa and sb else 0.0
        S = {(a, b): sim(a, b) for a in top for b in top if a < b}
        def s(a: str, b: str) -> float:
            return S.get((a, b) if a < b else (b, a), 0.0)
        clusters = [[k] for k in top]
        while len(clusters) > 3:
            best, bi, bj = 0.0, -1, -1
            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    v = sum(s(a, b) for a in clusters[i] for b in clusters[j]) / (len(clusters[i]) * len(clusters[j]))
                    if v > best:
                        best, bi, bj = v, i, j
            if bi < 0:
                break
            clusters[bi] += clusters.pop(bj)
        weight = lambda c: sum(plays[k] for k in c)  # noqa: E731
        clusters.sort(key=lambda c: -weight(c))
        groups, spare = clusters[:3], [k for c in clusters[3:] for k in c]
        # artists left on their own join the group they were played with most
        for k in spare:
            scores = [sum(s(k, b) for b in g) / len(g) for g in groups]
            if scores and max(scores) > 0:
                groups[scores.index(max(scores))].append(k)
        ranked = self._rank(entries)
        out: list[dict] = []
        for g in groups:
            members = set(g)
            cands = self._varied([c for c in ranked if _norm(_main_artist(c["artist"])) in members])
            lead = sorted(g, key=lambda k: -plays[k])[:3]
            n = len(out) + 1
            mix = await self._finish(f"daily{n}", "daily", f"Daily Mix {n}",
                                     ", ".join(names[k] for k in lead) + (" and more." if len(g) > 3 else "."),
                                     DAILY_COLORS[(n - 1) % 3], cands, entry_id, order=n)
            if mix:
                out.append(mix)
        return out

    # Room Mixes: the songs played most on each speaker over the last two months (speakers in the same area are one
    # room), for the rooms played in most
    async def _make_rooms(self, entry_id: str) -> list[dict]:
        from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
        ents, devs, areas = er.async_get(self.hass), dr.async_get(self.hass), ar.async_get(self.hass)
        rooms: dict[str, dict] = {}
        for e in self._since(60):
            eid = e["data"].get("entity") or ""
            if not eid:
                continue
            ent = ents.async_get(eid)
            area_id = (ent.area_id if ent else None) or (devs.async_get(ent.device_id).area_id if ent and ent.device_id and devs.async_get(ent.device_id) else None)
            area = areas.async_get_area(area_id) if area_id else None
            if area:
                key, name = "area_" + area.id, area.name
            else:
                st = self.hass.states.get(eid)
                name = (st.attributes.get("friendly_name") if st else None) or eid.split(".", 1)[-1].replace("_", " ").title()
                name = re.sub(r"^(MA|Music Assistant)\s+", "", name).strip() or name
                key = eid
            r = rooms.setdefault(key, {"name": name, "entries": []})
            r["entries"].append(e)
        out: list[dict] = []
        for i, (key, r) in enumerate(sorted(rooms.items(), key=lambda kv: -len(kv[1]["entries"]))[:MAX_ROOMS]):
            cands = self._varied(self._rank(r["entries"]))
            mid = "room_" + re.sub(r"[^a-z0-9_]+", "_", key.lower())
            mix = await self._finish(mid, "rooms", f"{r['name']} Mix", f"The songs played most in the {r['name']} lately.",
                                     ROOM_COLORS[i % len(ROOM_COLORS)], cands, entry_id, order=i, room=r["name"])
            if mix:
                out.append(mix)
        return out

    # Time of Day: morning (5am to noon), afternoon (noon to 5pm) and evening (5pm on)
    async def _make_timeofday(self, entry_id: str) -> list[dict]:
        by: dict[str, list] = {p: [] for p in PERIODS}
        for e in self._since(60):
            by[_period(self._local(e).hour)].append(e)
        out: list[dict] = []
        for i, (p, (title, about, colors)) in enumerate(PERIODS.items()):
            mix = await self._finish("tod_" + p, "timeofday", title, about, colors, self._varied(self._rank(by[p])),
                                     entry_id, order=i, period=p)
            if mix:
                out.append(mix)
        return out

    # Weekend Mix: what's played on Saturdays and Sundays, the songs played mostly at weekends first
    async def _make_weekend(self, entry_id: str) -> dict | None:
        entries = self._since(60)
        wk = [e for e in entries if self._local(e).weekday() >= 5]
        total = {f"{_norm(c['artist'])}|{_norm(c['title'])}": c["n"] for c in self._rank(entries)}
        ranked = self._rank(wk)
        ranked.sort(key=lambda c: -(c["n"] * c["n"] / max(1, total.get(f"{_norm(c['artist'])}|{_norm(c['title'])}", 1))))
        spec = KINDS["weekend"]
        return await self._finish("weekend", "weekend", spec["title"], spec["about"], spec["colors"], self._varied(ranked), entry_id)

    # Fresh Finds: songs first played in the last 30 days (once there's enough history to tell what's new)
    async def _make_fresh(self, entry_id: str) -> dict | None:
        entries = self._entries()
        now = int(time.time() * 1000)
        if not entries or min(e["ts"] for e in entries) > now - 40 * 86_400_000:
            _LOGGER.debug("Fresh Finds: not enough history yet to tell what's new")
            return None
        first: dict[str, int] = {}
        for e in entries:
            k = f"{_norm(e['data'].get('artist'))}|{_norm(e['data'].get('title'))}"
            first[k] = min(first.get(k, e["ts"]), e["ts"])
        new = [e for e in entries if first[f"{_norm(e['data'].get('artist'))}|{_norm(e['data'].get('title'))}"] >= now - 30 * 86_400_000]
        spec = KINDS["fresh"]
        return await self._finish("fresh", "fresh", spec["title"], spec["about"], spec["colors"], self._rank(new), entry_id)

    # Artist Spotlight: the month's most played artist, the songs the house plays and some it hasn't heard yet
    async def _make_spotlight(self, entry_id: str) -> dict | None:
        recent = self._since(30)
        counts: dict[str, int] = {}
        names: dict[str, str] = {}
        for e in recent:
            a = _main_artist(e["data"].get("artist"))
            if _norm(a):
                counts[_norm(a)] = counts.get(_norm(a), 0) + 1
                names.setdefault(_norm(a), a)
        if not counts:
            return None
        key = max(counts, key=lambda k: counts[k])
        artist = names[key]
        played = [c for c in self._rank(self._since(90)) if _norm(_main_artist(c["artist"])) == key]
        known = (await self._resolve(played[:20], entry_id))[:20]
        have = {_norm(t["title"]) for t in known}
        more: list[dict] = []
        try:
            resp = await self.hass.services.async_call("music_assistant", "search", {
                "config_entry_id": entry_id, "name": artist, "media_type": ["track"], "limit": 50},
                blocking=True, return_response=True)
            for t in (resp or {}).get("tracks") or []:
                arts = [_norm(a.get("name")) for a in t.get("artists") or []]
                title = _norm(t.get("name"))
                if key in arts and title and title not in have and t.get("uri"):
                    have.add(title)
                    more.append({"uri": t["uri"], "title": t.get("name") or "", "album": (t.get("album") or {}).get("name") or "",
                                 "artist": ", ".join(a.get("name") for a in t.get("artists") or [] if a.get("name")) or artist,
                                 "image": t.get("image") or ""})
        except Exception as err:  # noqa: BLE001 - the songs already played still make the mix
            _LOGGER.debug("Artist Spotlight: Music Assistant search for %s failed: %s", artist, err)
        random.shuffle(more)
        tracks = known[:15] + more[: MAX_TRACKS - min(15, len(known))]
        tracks = tracks[:MAX_TRACKS]
        if len(tracks) < MIN_TRACKS:
            return None
        random.shuffle(tracks)
        spec = KINDS["spotlight"]
        return {"id": "spotlight", "kind": "spotlight", "title": f"{artist} Spotlight",
                "about": f"The house's most played artist this month: the {artist} songs you play, and some you haven't heard yet.",
                "colors": spec["colors"], "made": int(time.time() * 1000), "tracks": tracks, "artist": artist}

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
        order = {k: i for i, k in enumerate(DEFAULT_KINDS + [k for k in KINDS if k not in DEFAULT_KINDS])}
        # On Repeat first, then the Daily Mixes, then the mix for this time of day; the rest in their usual order
        order.update({"repeat": -3, "daily": -2, "timeofday": -1})
        now = _period(dt_util.now().hour)
        mixes = sorted(self.m.house["mixes"].values(), key=lambda x: (
            order.get(x.get("kind"), 99), 0 if x.get("period") == now else 1, x.get("order", 0)))
        # only one Daily Mix: just "Daily Mix" (the numbers are for telling several apart)
        daily = [x for x in mixes if x.get("kind") == "daily"]
        if len(daily) == 1:
            mixes = [{**x, "title": "Daily Mix"} if x.get("kind") == "daily" else x for x in mixes]
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
