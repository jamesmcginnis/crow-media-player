"""Play Time: how long each Apple TV, HomePod and AirPlay speaker in the house plays, kept by Home Assistant.

Everything Home Assistant's Apple TV integration adds is counted (it doesn't reliably say which is a TV and which a
speaker), each listed by its own name.

Only time spent playing counts (an Apple TV sitting on its home screen or in a menu doesn't). Each day keeps its
total, the time in each category (TV & Films, YouTube, Music, Podcasts & Books, Other), in each app and on each
Apple TV, the same split for every hour of the day, the titles watched longest, when it was first and last used,
and how many times something was started. It runs with every dashboard closed, and on its first run it fills in
the days Home Assistant's own history still holds, so the report isn't empty to begin with.
"""
from __future__ import annotations

import functools
import logging
import time
from datetime import datetime, timedelta
from typing import Any

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, State, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STORE = f"{DOMAIN}.screen_time"
# 2: each device's apps and categories, and each title's devices, are kept too.
# 3: everything the Apple TV integration adds counts again (version 2 tried to leave speakers out by their model,
#    which Home Assistant doesn't reliably give). The days are worked out again from Home Assistant's history.
VERSION = 3
REBUILD_DAYS = 30
KEEP_DAYS = 400
TITLES_PER_DAY = 150
# a pause shorter than this and then playing again is the same use, not a new one
NEW_USE_GAP = 60
PLAYING = ("playing", "buffering")
MUSIC_APPS = ("music", "spotify", "tidal", "deezer", "amazon music", "youtube music", "soundcloud", "pandora", "qobuz")
AUDIO_APPS = ("podcasts", "pocket casts", "overcast", "audible", "books", "castro")


def category(attrs: dict) -> str:
    """tv (TV & Films), youtube, music, audio (Podcasts & Books) or other."""
    app = str(attrs.get("app_name") or attrs.get("app_id") or "").lower()
    ctype = str(attrs.get("media_content_type") or "").lower()
    if "youtube" in app and "music" not in app:
        return "youtube"
    if ctype in ("podcast", "audiobook") or any(a in app for a in AUDIO_APPS):
        return "audio"
    if ctype == "music" or any(app == a or app.startswith(a) for a in MUSIC_APPS):
        return "music"
    if ctype in ("video", "movie", "tvshow", "episode", "season", "channel") or attrs.get("media_series_title") \
            or attrs.get("media_season") is not None:
        return "tv"
    return "other"


def _day(ts: float) -> str:
    return dt_util.as_local(dt_util.utc_from_timestamp(ts)).strftime("%Y-%m-%d")


class ScreenTime:
    """Times each Apple TV while it's playing, and keeps the totals for each day."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, 1, STORE)
        self.data: dict[str, Any] = {}
        self.open: dict[str, dict] = {}      # entity -> what it's playing now, and since when (unix seconds)
        self.stopped: dict[str, float] = {}  # entity -> when it last stopped playing
        self._unsubs: list = []
        self._atv: set[str] = set()
        self._atv_at = 0.0

    # ── which players count: everything Home Assistant's Apple TV integration adds ──
    def apple_tvs(self) -> set[str]:
        if time.monotonic() - self._atv_at > 300 or not self._atv:
            reg = er.async_get(self.hass)
            self._atv = {e.entity_id for e in reg.entities.values()
                         if e.domain == "media_player" and e.platform == "apple_tv" and not e.disabled_by}
            self._atv_at = time.monotonic()
        return self._atv

    async def async_start(self) -> None:
        self.data = await self._store.async_load() or {}
        if self.data.get("v") != VERSION:
            # worked out again from Home Assistant's history, up to now; counted live from here on
            self.data = {"days": {}, "v": VERSION, "since": time.time(), "counted_from": time.time()}
            self._save()
        self.data.setdefault("days", {})
        self.data.setdefault("since", time.time())   # when counting began (earlier, once history is filled in)
        self._unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._on_state))
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, timedelta(minutes=1)))
        now = time.time()
        for eid in self.apple_tvs():
            st = self.hass.states.get(eid)
            if st and st.state in PLAYING:
                self._begin(eid, dict(st.attributes), now, new_use=False)
        if not self.data.get("backfilled"):
            # once Home Assistant's history is ready to read
            async_call_later(self.hass, 90, callback(lambda _n: self.hass.async_create_task(self._backfill())))

    async def async_stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs.clear()
        now = time.time()
        for eid in list(self.open):
            self._end(eid, now)
        await self._store.async_save(self.data)

    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 60)

    # ── following the Apple TVs ──
    @callback
    def _on_state(self, event: Event) -> None:
        eid = event.data.get("entity_id") or ""
        if not eid.startswith("media_player.") or eid not in self.apple_tvs():
            return
        new: State | None = event.data.get("new_state")
        self._apply(eid, new.state if new else "off", dict(new.attributes) if new else {}, time.time())

    def _apply(self, eid: str, state: str, attrs: dict, ts: float) -> None:
        cur = self.open.get(eid)
        if state not in PLAYING:
            if cur:
                self._end(eid, ts)
                self.stopped[eid] = ts
            return
        what = self._what(attrs)
        if cur and (cur["cat"], cur["app"], cur["title"]) == (what["cat"], what["app"], what["title"]):
            return
        if cur:
            self._end(eid, ts)
            self._begin(eid, attrs, ts, new_use=False)
        else:
            self._begin(eid, attrs, ts, new_use=ts - self.stopped.get(eid, 0) > NEW_USE_GAP)

    @staticmethod
    def _what(attrs: dict) -> dict:
        title = str(attrs.get("media_series_title") or attrs.get("media_title") or "").strip()
        return {"cat": category(attrs), "app": str(attrs.get("app_name") or "").strip(), "title": title[:120]}

    def _begin(self, eid: str, attrs: dict, ts: float, new_use: bool) -> None:
        self.open[eid] = {**self._what(attrs), "since": ts}
        if new_use:
            d = self._dayrec(_day(ts))
            d["n"] = d.get("n", 0) + 1
            self._save()

    def _end(self, eid: str, ts: float) -> None:
        cur = self.open.pop(eid, None)
        if cur:
            self._add(eid, cur, cur["since"], ts)

    @callback
    def _tick(self, _now=None) -> None:
        """Every minute: what's playing is counted up to now, so nothing is lost if Home Assistant stops."""
        now = time.time()
        for eid, cur in list(self.open.items()):
            self._add(eid, cur, cur["since"], now)
            cur["since"] = now
        cutoff = (dt_util.now() - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
        for k in [k for k in self.data["days"] if k < cutoff]:
            del self.data["days"][k]

    # ── adding up ──
    @staticmethod
    def _blank() -> dict:
        return {"t": 0, "c": {}, "a": {}, "r": {}, "h": {}, "ti": {}, "n": 0, "ra": {}, "rc": {}}

    def _dayrec(self, day: str) -> dict:
        return self.data["days"].setdefault(day, self._blank())

    def _add(self, eid: str, cur: dict, start: float, end: float, into: dict | None = None) -> None:
        """Adds the time from start to end, split at each hour (and so each day)."""
        if end - start < 1:
            return
        days = into if into is not None else self.data["days"]
        t = start
        while t < end:
            local = dt_util.as_local(dt_util.utc_from_timestamp(t))
            nxt = (local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).timestamp()
            seg_end = min(end, nxt)
            sec = seg_end - t
            day = local.strftime("%Y-%m-%d")
            d = days.setdefault(day, self._blank())
            cat, app = cur["cat"], cur["app"] or ""
            # each Apple TV's apps and categories
            ra = d.setdefault("ra", {}).setdefault(eid, {})
            if app:
                ra[app] = round(ra.get(app, 0) + sec, 1)
            rc = d.setdefault("rc", {}).setdefault(eid, {})
            rc[cat] = round(rc.get(cat, 0) + sec, 1)
            d["t"] = round(d["t"] + sec, 1)
            d["c"][cat] = round(d["c"].get(cat, 0) + sec, 1)
            if app:
                d["a"][app] = round(d["a"].get(app, 0) + sec, 1)
            d["r"][eid] = round(d["r"].get(eid, 0) + sec, 1)
            hr = d["h"].setdefault(str(local.hour), {})
            hr[cat] = round(hr.get(cat, 0) + sec, 1)
            if cur.get("title"):
                k = (app + "|" + cur["title"]).lower()
                ti = d["ti"].setdefault(k, {"n": cur["title"], "a": app, "c": cat, "t": 0})
                ti["t"] = round(ti["t"] + sec, 1)
                tr = ti.setdefault("r", {})
                tr[eid] = round(tr.get(eid, 0) + sec, 1)
                if len(d["ti"]) > TITLES_PER_DAY * 2:
                    for drop in sorted(d["ti"], key=lambda x: d["ti"][x]["t"])[: len(d["ti"]) - TITLES_PER_DAY]:
                        del d["ti"][drop]
            d["f"] = min(d.get("f") or t, t)
            d["l"] = max(d.get("l") or seg_end, seg_end)
            t = seg_end
        if into is None:
            self._save()

    # ── what the card asks for ──
    def view(self, days: int) -> dict:
        """The last `days` days (today included), with what's playing right now counted up to this moment."""
        days = max(1, min(int(days or 7), KEEP_DAYS))
        first = (dt_util.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        out = {k: _copy(v) for k, v in self.data["days"].items() if k >= first}
        now = time.time()
        for eid, cur in self.open.items():
            self._add(eid, cur, cur["since"], now, into=out)
        names = {}
        for eid in self.apple_tvs() | {e for v in out.values() for e in v.get("r", {})}:
            st = self.hass.states.get(eid)
            names[eid] = (st.attributes.get("friendly_name") if st else None) or eid.split(".", 1)[-1].replace("_", " ").title()
        return {"days": out, "rooms": names, "today": dt_util.now().strftime("%Y-%m-%d"),
                "playing": {eid: {k: cur[k] for k in ("cat", "app", "title")} for eid, cur in self.open.items()},
                "since": self.data.get("since")}

    # ── a head start from Home Assistant's own history ──
    async def _backfill(self) -> None:
        if self.data.get("backfilled"):
            return
        eids = sorted(self.apple_tvs())
        try:
            from homeassistant.components.recorder import get_instance, history
        except Exception:   # noqa: BLE001  no recorder: nothing to fill in from
            self.data["backfilled"] = True
            self._save()
            return
        end = dt_util.utcnow()
        start = end - timedelta(days=REBUILD_DAYS)
        merge = bool(self.data.get("counted_from"))
        counted = sorted(self.data["days"])
        if merge:
            # worked out again: from history up to when live counting began, added to what's been counted since
            end = min(end, dt_util.utc_from_timestamp(self.data["counted_from"]))
        elif counted:
            # only the days before this integration started counting (what it counted itself is kept as it is)
            try:
                end = min(end, dt_util.as_utc(dt_util.start_of_local_day(datetime.strptime(counted[0], "%Y-%m-%d").date())))
            except (TypeError, ValueError):
                pass
        if not eids or end <= start:
            self.data["backfilled"] = True
            self._save()
            return
        try:
            hist = await get_instance(self.hass).async_add_executor_job(functools.partial(
                history.get_significant_states, self.hass, start, end, eids,
                include_start_time_state=True, significant_changes_only=False, minimal_response=False, no_attributes=False))
        except Exception as err:   # noqa: BLE001
            _LOGGER.debug("Play Time couldn't read Home Assistant's history: %s", err)
            return   # tried again at the next start
        filled: dict = {}
        oldest = None
        for eid, states in (hist or {}).items():
            cur, last_stop = None, 0.0
            for st in states:
                if not isinstance(st, State):
                    continue
                ts = max(st.last_updated.timestamp(), start.timestamp())
                what = self._what(dict(st.attributes))
                if st.state in PLAYING:
                    if cur and (cur["cat"], cur["app"], cur["title"]) == (what["cat"], what["app"], what["title"]):
                        continue
                    if cur:
                        self._add(eid, cur, cur["since"], ts, into=filled)
                    elif ts - last_stop > NEW_USE_GAP:
                        d = filled.setdefault(_day(ts), self._blank())
                        d["n"] = d.get("n", 0) + 1
                    cur = {**what, "since": ts}
                    oldest = ts if oldest is None else min(oldest, ts)
                elif cur:
                    self._add(eid, cur, cur["since"], ts, into=filled)
                    cur, last_stop = None, ts
            if cur:
                self._add(eid, cur, cur["since"], end.timestamp(), into=filled)
        for day, rec in filled.items():
            if day not in self.data["days"]:
                self.data["days"][day] = rec
            elif merge:
                _merge(self.data["days"][day], rec)
        self.data["backfilled"] = True
        if oldest:
            self.data["since"] = min(self.data.get("since") or oldest, oldest)
        self._save()
        _LOGGER.debug("Play Time filled in %d days from Home Assistant's history", len(filled))


def _merge(into: dict, add: dict) -> None:
    """Adds one day's record to another (numbers added, dictionaries merged)."""
    for k, v in add.items():
        if k == "f":
            into["f"] = min(into.get("f") or v, v)
        elif k == "l":
            into["l"] = max(into.get("l") or v, v)
        elif isinstance(v, (int, float)):
            into[k] = round((into.get(k) or 0) + v, 1)
        elif isinstance(v, dict):
            if k == "ti":
                for tk, tv in v.items():
                    if tk in into.setdefault("ti", {}):
                        _merge(into["ti"][tk], {kk: vv for kk, vv in tv.items() if kk in ("t", "r")})
                    else:
                        into["ti"][tk] = tv
            else:
                _merge(into.setdefault(k, {}), v)


def _copy(d: Any) -> Any:
    return {k: _copy(v) for k, v in d.items()} if isinstance(d, dict) else d
