"""Crow Media Player's brain: each person's data, the household's listening history, sleep timers, alarms,
and what's playing on each speaker (for the sensors).

Each person's pins, settings and the rest are kept here, so they're the same on every device and isn't lost when a phone clears its storage. Home Assistant records plays on
the speakers itself, so Listening Recap counts everything played in the house, not only while a card is
open. The sleep timer and alarms run here too, so they keep working with every screen off.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import secrets
import time
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_CALL_SERVICE, EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_change, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    ALARM_RAMP_SECONDS, DEFAULT_TRACK_MS, DOMAIN, LOG_AFTER_SECONDS, LOG_DAYS, LOG_DEDUP_MS, LOG_MAX,
    MAX_USER_VALUE_BYTES, SLEEP_FADE_SECONDS, SLEEP_FADE_TRACK_SECONDS, STORAGE_VERSION, STORE_CACHE,
    STORE_HOUSE, STORE_USERS,
)

_LOGGER = logging.getLogger(__name__)

SIGNAL_UPDATE = f"{DOMAIN}_update"            # the household's numbers changed
SIGNAL_SPEAKERS = f"{DOMAIN}_speakers"        # a speaker to make sensors for
SIGNAL_SPEAKER = f"{DOMAIN}_speaker_"         # + entity id: that speaker's numbers changed
SIGNAL_POSITION = f"{DOMAIN}_position_"       # + entity id: only where that speaker is in the song changed (a seek)

VIDEO_TYPES = {"video", "movie", "tvshow", "episode", "season", "channel", "game", "app", "url", "image"}
VIDEO_APPS = ("youtube", "netflix", "prime video", "disney", "apple tv", "tv+", "iplayer", "itvx", "channel 4", "my5",
              "now tv", "nowtv", "paramount", "hulu", "max", "plex", "jellyfin", "infuse", "swiftfin", "kodi", "twitch",
              "sky go", "britbox", "peacock")
RESUME_DAYS = 7
LOSSLESS = {"flac", "alac", "wav", "wave", "aif", "aiff", "pcm", "wavpack", "wv", "ape", "dsf", "dff",
            "s16le", "s24le", "s32le", "f32le", "f64le"}
CODEC_NAMES = {"alac": "ALAC", "flac": "FLAC", "wav": "WAV", "wave": "WAV", "aif": "AIFF", "aiff": "AIFF", "wavpack": "WavPack",
               "wv": "WavPack", "ape": "APE", "dsf": "DSD", "dff": "DSD", "aac": "AAC", "mp4": "AAC", "m4a": "AAC", "mp3": "MP3",
               "ogg": "Ogg Vorbis", "vorbis": "Ogg Vorbis", "opus": "Opus"}
ANNOUNCE_RE = re.compile(r"\b(announcement|alert|doorbell|tts|text to speech)\b", re.I)


def now_ms() -> int:
    return int(time.time() * 1000)


def _norm(s: Any) -> str:
    return str(s or "").strip()


class CrowMedia:
    """Everything the integration keeps and does."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._users_store = Store(hass, STORAGE_VERSION, STORE_USERS)
        self._house_store = Store(hass, STORAGE_VERSION, STORE_HOUSE)
        self._cache_store = Store(hass, STORAGE_VERSION, STORE_CACHE)
        self.users: dict[str, dict[str, Any]] = {}
        self.house: dict[str, Any] = {}
        self.cache: dict[str, Any] = {}
        self._subs: dict[int, Callable[[dict], None]] = {}
        self._sub_id = 0
        self._unsubs: list[Callable[[], None]] = []
        self._pending: dict[str, dict] = {}          # entity -> a song waiting to count as played
        self.now: dict[str, dict] = {}               # entity -> what it's doing now (for the sensors)
        self._sleep_tick: Callable[[], None] | None = None
        self._ramps: dict[str, Callable[[], None]] = {}
        self._queue_at: dict[str, float] = {}
        self._stats: dict[str, Any] | None = None

    # ── loading and saving ──────────────────────────────────────────────────
    async def async_load(self) -> None:
        self.users = await self._users_store.async_load() or {}
        self.house = await self._house_store.async_load() or {}
        self.cache = await self._cache_store.async_load() or {}
        for k, v in (("log", {}), ("sleep", {}), ("alarms", []), ("speakers", []), ("podcasts", {}), ("releases", {}),
                     ("muted", {}), ("resume", {})):
            self.house.setdefault(k, v)
        self.cache.setdefault("ai", {})
        # song details once looked up from Deezer (for sensors that are gone): not kept any more
        self.cache.pop("tempo", None)

    def save_users(self) -> None:
        self._users_store.async_delay_save(lambda: self.users, 5)

    def save_house(self) -> None:
        self._house_store.async_delay_save(lambda: self.house, 3)

    def save_cache(self) -> None:
        self._cache_store.async_delay_save(lambda: self.cache, 30)

    @property
    def options(self) -> dict:
        return dict(self.entry.options)

    # ── starting and stopping ───────────────────────────────────────────────
    async def async_start(self) -> None:
        self._unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._on_state))
        # Radio Mode switched on or off (by a card, or anything else using Queue Actions): read it again
        self._unsubs.append(self.hass.bus.async_listen(EVENT_CALL_SERVICE, self._on_service))
        self._unsubs.append(async_track_time_change(self.hass, self._alarm_minute, second=0))
        self._unsubs.append(async_track_time_interval(self.hass, self._every_minute, timedelta(minutes=1)))
        if self.house["sleep"]:
            self._sleep_start()
        # what's playing right now, without waiting for it to change
        for st in self.hass.states.async_all("media_player"):
            if self._watched(st.entity_id):
                self._track(st.entity_id, st.state, dict(st.attributes))
        # Music Assistant speakers: their Radio Mode (and what's playing), once Home Assistant has started
        async_call_later(self.hass, 20, callback(lambda _n: [self.hass.async_create_task(self.async_queue(e))
                                                               for e in list(self.now) if self._is_ma(e)]))

    async def async_stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs.clear()
        if self._sleep_tick:
            self._sleep_tick()
            self._sleep_tick = None
        for p in self._pending.values():
            if p.get("cancel"):
                p["cancel"]()
        for c in self._ramps.values():
            c()
        await self._users_store.async_save(self.users)
        await self._house_store.async_save(self.house)
        await self._cache_store.async_save(self.cache)

    # ── live updates for the cards ──────────────────────────────────────────
    def subscribe(self, cb: Callable[[dict], None]) -> Callable[[], None]:
        self._sub_id += 1
        sid = self._sub_id
        self._subs[sid] = cb
        return lambda: self._subs.pop(sid, None)

    def push(self, event: dict) -> None:
        for cb in list(self._subs.values()):
            try:
                cb(event)
            except Exception:  # noqa: BLE001 - one closed connection mustn't stop the rest
                _LOGGER.debug("Crow Media Player: couldn't send an update", exc_info=True)

    def changed(self, entity_id: str | None = None) -> None:
        self._stats = None
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        if entity_id:
            async_dispatcher_send(self.hass, SIGNAL_SPEAKER + entity_id)

    def state_view(self) -> dict:
        o = self.options
        return {"sleep": self.sleep_view(), "alarms": self.alarms_view(), "resume": self.resume_view(),
                "keys": {"tmdb": bool(o.get("tmdb_key")), "discogs": bool(o.get("discogs_token"))}}

    def push_state(self) -> None:
        self.push({"type": "state", **self.state_view()})

    # ── each person's data ──────────────────────────────────────────────────
    async def async_data_get(self, uid: str, key: str) -> Any:
        mine = self.users.setdefault(uid, {})
        if key in mine:
            return mine[key]
        return None

    def data_set(self, uid: str, key: str, value: Any) -> None:
        import json
        if len(json.dumps(value, default=str)) > MAX_USER_VALUE_BYTES:
            raise ValueError("That's too much to keep")
        mine = self.users.setdefault(uid, {})
        if value is None:
            mine.pop(key, None)
        else:
            mine[key] = value
        self.save_users()
        if key == "crow_media_ai_local" and isinstance(value, dict) and isinstance(value.get("mutedArtists"), dict):
            # artists someone never wants logged: not recorded by Home Assistant either
            self.house["muted"][uid] = sorted(k for k in value["mutedArtists"])
            self.save_house()

    # ── which speakers ──────────────────────────────────────────────────────
    def speakers(self) -> list[str]:
        """Speakers with their own sensors: the ones chosen in Configure, and the ones the cards use."""
        chosen = list(self.options.get("speakers") or [])
        return list(dict.fromkeys(chosen + list(self.house.get("speakers") or [])))

    def _watched(self, entity_id: str) -> bool:
        chosen = self.options.get("speakers") or []
        return entity_id in chosen or entity_id in (self.house.get("speakers") or []) or not chosen

    def register_speakers(self, entities: list[str]) -> None:
        new = [e for e in entities if isinstance(e, str) and e.startswith("media_player.") and e not in self.house["speakers"]]
        if not new:
            return
        self.house["speakers"] = (self.house["speakers"] + new)[-40:]
        self.save_house()
        async_dispatcher_send(self.hass, SIGNAL_SPEAKERS)

    # ── what's playing ──────────────────────────────────────────────────────
    @callback
    def _on_state(self, event: Event) -> None:
        eid = event.data.get("entity_id") or ""
        if not eid.startswith("media_player."):
            return
        new = event.data.get("new_state")
        if not new or not self._watched(eid):
            return
        self._track(eid, new.state, dict(new.attributes))

    def _kind(self, attrs: dict) -> str:
        """music, video, radio, audiobook, podcast or ''."""
        ctype = str(attrs.get("media_content_type") or "").lower()
        cid = str(attrs.get("media_content_id") or "").lower()
        app = str(attrs.get("app_name") or attrs.get("app_id") or "").lower()
        if ctype == "audiobook" or "audiobook" in cid:
            return "audiobook"
        if ctype in ("podcast", "episode") and ("podcast" in cid or ctype == "podcast"):
            return "podcast"
        if ctype == "radio" or "://radio/" in cid or cid.startswith("library://radio") or "radio" in ctype:
            return "radio"
        if ctype in VIDEO_TYPES or (app and any(a in app for a in VIDEO_APPS) and "music" not in app):
            return "video"
        if attrs.get("media_series_title") or attrs.get("media_season") is not None:
            return "video"
        if attrs.get("media_title"):
            if not attrs.get("media_duration") and (cid.startswith("http") or attrs.get("media_channel")):
                return "radio"
            return "music"
        return ""

    def _track(self, eid: str, state: str, attrs: dict) -> None:
        kind = self._kind(attrs) if state in ("playing", "paused", "buffering") else ""
        artist, title = _norm(attrs.get("media_artist") or attrs.get("media_album_artist")), _norm(attrs.get("media_title"))
        prev = self.now.get(eid) or {}
        cur = {"state": state, "kind": kind, "artist": artist, "title": title, "album": _norm(attrs.get("media_album_name")),
               "duration": attrs.get("media_duration") or 0, "position": attrs.get("media_position") or 0,
               "position_at": str(attrs.get("media_position_updated_at") or ""), "picture": attrs.get("entity_picture") or "",
               "channel": _norm(attrs.get("media_channel")), "series": _norm(attrs.get("media_series_title")),
               "season": attrs.get("media_season"), "episode": attrs.get("media_episode"),
               "app": _norm(attrs.get("app_name")), "content_id": _norm(attrs.get("media_content_id")),
               "content_type": _norm(attrs.get("media_content_type")),
               "volume": attrs.get("volume_level"),
               "playing_since": (prev.get("playing_since") if prev.get("state") == "playing" and (prev.get("artist"), prev.get("title")) == (artist, title)
                                 else time.monotonic()) if state == "playing" else None,
               "queue": prev.get("queue") if prev.get("title") == title else None,
               "quality": prev.get("quality") if prev.get("title") == title else None,
               "radio_mode": prev.get("radio_mode")}
        self.now[eid] = cur
        # it stopped (paused, idle, off, or gone in a power cut): remember where, for Resume
        if prev.get("state") in ("playing", "buffering") and state not in ("playing", "buffering") \
                and prev.get("kind") in ("music", "podcast", "audiobook", "radio") and prev.get("title"):
            self._resume_save(eid, prev)
        changed_track = (prev.get("artist"), prev.get("title"), prev.get("state")) != (artist, title, state)
        # a song counts as played once it's played for half a minute (or to its end, if shorter)
        if kind == "music" and state == "playing" and artist and title and not ANNOUNCE_RE.search(f"{artist} {title}"):
            key = f"{artist}|{title}".lower()
            p = self._pending.get(eid)
            if not p or p["key"] != key:
                if p and p.get("cancel"):
                    p["cancel"]()
                wait = LOG_AFTER_SECONDS
                if cur["duration"]:
                    wait = min(wait, max(5, float(cur["duration"]) - 1))
                meta = {"artist": artist, "title": title, "album": cur["album"], "entity": eid, "app": cur["app"],
                        "durationMs": int(float(cur["duration"] or 0) * 1000)}
                self._pending[eid] = {"key": key, "meta": meta, "started": now_ms(),
                                      "cancel": async_call_later(self.hass, wait, callback(lambda _n, e=eid, k=key: self._count(e, k)))}
        # a new song: read the queue again shortly (for what's up next)
        if changed_track and state == "playing" and kind in ("music", "audiobook", "podcast"):
            self._queue_at[eid] = time.monotonic()
            async_call_later(self.hass, 3, callback(lambda _n, e=eid: self.hass.async_create_task(self.async_queue(e))))
        else:
            p = self._pending.pop(eid, None)
            if p and p.get("cancel"):
                p["cancel"]()
        if changed_track or prev.get("kind") != kind:
            self.changed(eid)
        elif (prev.get("position_at"), prev.get("duration")) != (cur["position_at"], cur["duration"]):
            async_dispatcher_send(self.hass, SIGNAL_POSITION + eid)   # a seek: when the song ends moved

    @callback
    def _count(self, eid: str, key: str) -> None:
        p = self._pending.get(eid)
        cur = self.now.get(eid) or {}
        if not p or p["key"] != key:
            return
        p["cancel"] = None
        if cur.get("state") != "playing" or f"{cur.get('artist')}|{cur.get('title')}".lower() != key:
            return
        self.log_play(p["meta"], p["started"])

    def log_play(self, meta: dict, ts: int) -> str | None:
        """Add a play to the household's listening history, unless it's already there."""
        log = self.house["log"]
        for e in log.values():
            d = e.get("data") or {}
            if d.get("artist") == meta["artist"] and d.get("title") == meta["title"] and (d.get("entity") or "") == meta.get("entity", "") \
                    and abs((e.get("ts") or 0) - ts) <= LOG_DEDUP_MS:
                return None
        key = f"h{ts}_{random.randrange(36 ** 4):04x}"
        data = {"artist": meta["artist"], "title": meta["title"], "album": meta.get("album") or "",
                "entity": meta.get("entity") or "", "mediaType": "music", "durationMs": int(meta.get("durationMs") or 0)}
        if meta.get("app"):
            data["app"] = meta["app"]
        log[key] = {"data": data, "ts": ts}
        cutoff = now_ms() - LOG_DAYS * 86_400_000
        for k in [k for k, e in log.items() if (e.get("ts") or 0) < cutoff]:
            del log[k]
        if len(log) > LOG_MAX:
            for k in sorted(log, key=lambda k: log[k].get("ts") or 0)[: len(log) - LOG_MAX]:
                del log[k]
        self.save_house()
        self.push({"type": "log", "entries": {key: log[key]}})
        self.hass.bus.async_fire(f"{DOMAIN}_track_played", {"entity_id": data["entity"], "artist": data["artist"],
                                                          "title": data["title"], "album": data["album"]})
        self.changed(data["entity"])
        return key

    def log_since(self, ts: int) -> dict:
        return {k: e for k, e in self.house["log"].items() if (e.get("ts") or 0) > ts}

    def forget_plays(self, keys: list[str] | None = None, *, everything: bool = False) -> None:
        if everything:
            self.house["log"] = {}
        else:
            for k in keys or []:
                self.house["log"].pop(k, None)
        self.save_house()
        self.push({"type": "log_removed", "keys": keys or [], "everything": everything})
        self.changed()

    # ── the household's numbers ─────────────────────────────────────────────
    def _muted(self) -> set[str]:
        out: set[str] = set()
        for names in (self.house.get("muted") or {}).values():
            out.update(n.lower() for n in names)
        return out

    def stats(self) -> dict:
        if self._stats is not None:
            return self._stats
        muted = self._muted()
        entries = [e for e in self.house["log"].values() if (e.get("data") or {}).get("artist", "").lower() not in muted]
        now = dt_util.now()
        day0 = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        week0 = day0 - now.weekday() * 86_400_000
        def ms(e):
            d = e["data"].get("durationMs") or DEFAULT_TRACK_MS
            return min(d, 30 * 60_000)
        today = [e for e in entries if e["ts"] >= day0]
        week = [e for e in entries if e["ts"] >= week0]
        def top(items, key):
            counts: dict[str, int] = {}
            for e in items:
                k = key(e)
                if k:
                    counts[k] = counts.get(k, 0) + 1
            return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        artists = top(week, lambda e: e["data"].get("artist"))
        tracks = top(week, lambda e: f"{e['data'].get('artist')} – {e['data'].get('title')}")
        last = max(entries, key=lambda e: e["ts"]) if entries else None
        # a streak: days in a row with music, up to today (or yesterday, if nothing yet today)
        days = {dt_util.as_local(dt_util.utc_from_timestamp(e["ts"] / 1000)).date() for e in entries}
        streak, d = 0, now.date()
        if d not in days:
            d -= timedelta(days=1)
        while d in days:
            streak += 1
            d -= timedelta(days=1)
        self._stats = {
            "today_minutes": round(sum(ms(e) for e in today) / 60000), "week_minutes": round(sum(ms(e) for e in week) / 60000),
            "tracks_today": len(today), "tracks_week": len(week),
            "top_artists": artists[:5], "top_tracks": tracks[:5], "last": last, "streak": streak,
            "playing": [e for e, n in self.now.items() if n.get("state") == "playing" and n.get("kind")],
            "last_ts": max((e["ts"] for e in entries), default=None),
            "today_by_speaker": self._by_speaker(today, ms),
        }
        return self._stats

    @staticmethod
    def _by_speaker(entries: list, ms: Callable) -> dict:
        """Milliseconds and songs for each speaker."""
        out: dict[str, dict] = {}
        for e in entries:
            eid = e["data"].get("entity") or ""
            if eid:
                o = out.setdefault(eid, {"ms": 0, "tracks": 0})
                o["ms"] += ms(e)
                o["tracks"] += 1
        return out

    def top_artists(self, days: int = 60, n: int = 12) -> list[str]:
        cutoff = now_ms() - days * 86_400_000
        counts: dict[str, int] = {}
        muted = self._muted()
        for e in self.house["log"].values():
            a = (e.get("data") or {}).get("artist") or ""
            if e.get("ts", 0) >= cutoff and a and a.lower() not in muted:
                for name in re.split(r"\s*(?:,|&| feat\.? | ft\.? | x )\s*", a, flags=re.I)[:1]:
                    counts[name] = counts.get(name, 0) + 1
        return [a for a, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:n]]

    # ── Music Assistant queue ───────────────────────────────────────────────
    def _is_ma(self, eid: str) -> bool:
        try:
            ent = er.async_get(self.hass).async_get(eid)
        except Exception:  # noqa: BLE001 - no entity registry yet
            return False
        return bool(ent and ent.platform == "music_assistant")

    async def async_queue(self, eid: str) -> None:
        if not self._is_ma(eid):
            return
        await self._async_ma_details(eid)
        if not self.hass.services.has_service("music_assistant", "get_queue"):
            return
        try:
            resp = await self.hass.services.async_call("music_assistant", "get_queue", {"entity_id": eid},
                                                      blocking=True, return_response=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Crow Media Player couldn't read the queue of %s: %s", eid, err)
            return
        q = (resp or {}).get(eid) or {}
        cur = self.now.get(eid)
        if not cur:
            return
        items, idx = int(q.get("items") or 0), q.get("current_index")
        current = q.get("current_item") or {}
        dur = float(current.get("duration") or cur.get("duration") or 0)
        elapsed = float(q.get("elapsed_time") or 0)
        left_tracks = max(0, items - (int(idx) + 1)) if idx is not None else 0
        avg = (dur or DEFAULT_TRACK_MS / 1000)
        nxt = q.get("next_item") or {}
        mi = nxt.get("media_item") or {}
        up = None
        if nxt.get("name") or mi.get("name"):
            up = {"title": mi.get("name") or nxt.get("name"), "duration": nxt.get("duration"),
                  "artist": ", ".join(a.get("name") for a in mi.get("artists") or [] if a.get("name")) or None,
                  "album": (mi.get("album") or {}).get("name") or None, "image": mi.get("image") or None, "uri": mi.get("uri") or None}
        cm = current.get("media_item") or {}
        cur["queue"] = {"tracks_left": left_tracks, "seconds": int(max(0, dur - elapsed) + left_tracks * avg),
                        "shuffle": q.get("shuffle_enabled"), "repeat": q.get("repeat_mode"), "next": up,
                        "explicit": cm.get("explicit"), "uri": cm.get("uri")}
        async_dispatcher_send(self.hass, SIGNAL_SPEAKER + eid)

    # ── Audio quality and Radio Mode, from Music Assistant's full queue (through Queue Actions) ──
    def _mass_queue_entry(self) -> str | None:
        for e in self.hass.config_entries.async_entries("mass_queue"):
            if not e.disabled_by:
                return e.entry_id
        return None

    async def _async_ma_details(self, eid: str, retry: bool = True) -> None:
        """What Music Assistant knows of this speaker's queue that Home Assistant doesn't pass on: the stream's
        format for the song playing, and whether Radio Mode ("Don't stop the music") is on."""
        if not self.hass.services.has_service("mass_queue", "send_command"):
            return
        st = self.hass.states.get(eid)
        qid = st and (st.attributes.get("active_queue") or st.attributes.get("mass_player_id"))
        entry_id = self._mass_queue_entry()
        if not qid or not entry_id:
            return
        try:
            resp = await self.hass.services.async_call(
                "mass_queue", "send_command", {"command": "player_queues/get", "data": {"queue_id": qid}, "config_entry_id": entry_id},
                blocking=True, return_response=True)
        except Exception as err:  # noqa: BLE001 - an older Queue Actions, or Music Assistant restarting
            _LOGGER.debug("Crow Media Player couldn't read Music Assistant's queue for %s: %s", eid, err)
            return
        q = resp.get("response") if isinstance(resp, dict) and isinstance(resp.get("response"), dict) else resp
        cur = self.now.get(eid)
        if not isinstance(q, dict) or not cur:
            return
        radio = q.get("autoplay_enabled", q.get("dont_stop_the_music_enabled"))
        if isinstance(radio, bool):
            cur["radio_mode"] = radio
        item = q.get("current_item") or {}
        name = (item.get("media_item") or {}).get("name") or item.get("name") or ""
        sd = item.get("streamdetails") or {}
        af = sd.get("audio_format") or {}
        if name and _norm(name).lower() == (cur.get("title") or "").lower():
            if af.get("content_type"):
                cur["quality"] = self._quality(af, sd)
            elif retry and cur.get("state") == "playing":
                # not streaming yet: once more shortly
                async_call_later(self.hass, 6, callback(lambda _n: self.hass.async_create_task(self._async_ma_details(eid, False))))
        async_dispatcher_send(self.hass, SIGNAL_SPEAKER + eid)

    @staticmethod
    def _quality(af: dict, sd: dict) -> dict:
        fmt = str(af.get("content_type") or "").lower()
        def num(v):
            try:
                return float(v or 0)
            except (TypeError, ValueError):
                return 0.0
        bits, rate, br = int(num(af.get("bit_depth"))), int(num(af.get("sample_rate"))), num(af.get("bit_rate"))
        kbps = round(br / 1000) if br > 5000 else round(br)
        lossless = fmt in LOSSLESS
        hi_res = lossless and (bits > 16 or rate > 48000)
        khz = (f"{rate / 1000:.1f}".rstrip("0").rstrip(".") + " kHz") if rate else ""
        codec = CODEC_NAMES.get(fmt) or fmt.upper()
        detail = " ".join(x for x in (codec, (f"{bits}-bit" if lossless and bits else (f"{kbps} kbps" if not lossless and kbps else "")), khz) if x)
        prov = re.sub(r"--.*$", "", str(sd.get("provider") or "")).replace("_", " ").strip()
        return {"text": detail, "codec": codec or None, "sample_rate": rate or None, "bit_depth": bits or None,
                "bit_rate": kbps or None, "lossless": lossless, "hi_res": hi_res, "source": prov or None}

    @callback
    def _on_service(self, event: Event) -> None:
        d = event.data or {}
        if d.get("domain") != "mass_queue" or d.get("service") != "send_command":
            return
        sd = d.get("service_data") or {}
        if "dont_stop_the_music" not in str(sd.get("command") or ""):
            return
        qid = (sd.get("data") or {}).get("queue_id")
        for eid in list(self.now):
            st = self.hass.states.get(eid)
            if st and qid and qid in (st.attributes.get("active_queue"), st.attributes.get("mass_player_id")):
                async_call_later(self.hass, 1, callback(lambda _n, e=eid: self.hass.async_create_task(self._async_ma_details(e, False))))

    @callback
    def _every_minute(self, _now=None) -> None:
        for eid, cur in list(self.now.items()):
            if cur.get("state") == "playing" and cur.get("kind") in ("music", "audiobook", "podcast") \
                    and time.monotonic() - self._queue_at.get(eid, 0) > 55:
                self._queue_at[eid] = time.monotonic()
                self.hass.async_create_task(self.async_queue(eid))
        # Resume: once something has played for half a minute, there's nothing to resume on that speaker
        gone = False
        for eid in list(self.house["resume"]):
            cur = self.now.get(eid) or {}
            r = self.house["resume"][eid]
            if (cur.get("state") == "playing" and cur.get("playing_since") and time.monotonic() - cur["playing_since"] >= 30
                    and not ANNOUNCE_RE.search(f"{cur.get('artist')} {cur.get('title')}")) or now_ms() - r.get("ts", 0) > RESUME_DAYS * 86_400_000:
                del self.house["resume"][eid]
                gone = True
                async_dispatcher_send(self.hass, SIGNAL_SPEAKER + eid)
        if gone:
            self.save_house()
            self.push_state()
        # the day changed, so did today's numbers
        self.changed()

    # ── Resume: carry on where a speaker stopped ────────────────────────────
    def _resume_save(self, eid: str, prev: dict) -> None:
        pos = float(prev.get("position") or 0)
        try:
            at = dt_util.parse_datetime(prev.get("position_at") or "")
            if at and prev.get("state") == "playing":
                pos += max(0.0, (dt_util.utcnow() - at).total_seconds())
        except (TypeError, ValueError):
            pass
        dur = float(prev.get("duration") or 0)
        if dur and pos >= dur - 5 and prev.get("kind") == "music":
            return   # the song finished: nothing was interrupted
        if dur:
            pos = min(pos, max(0.0, dur - 2))
        q = prev.get("queue") or {}
        self.house["resume"][eid] = {
            "kind": prev.get("kind"), "title": prev.get("title"), "artist": prev.get("artist") or "", "album": prev.get("album") or "",
            "picture": prev.get("picture") or "", "content_id": prev.get("content_id") or "", "content_type": prev.get("content_type") or "",
            "uri": q.get("uri") or "", "position": round(pos, 1), "duration": dur, "volume": prev.get("volume"), "ts": now_ms()}
        self.save_house()
        self.push_state()
        self.changed(eid)

    def resume_view(self) -> dict:
        return {eid: {k: r.get(k) for k in ("kind", "title", "artist", "album", "picture", "position", "duration", "ts")}
                for eid, r in (self.house.get("resume") or {}).items()}

    async def async_resume(self, eid: str) -> dict:
        """Carry on with what this speaker was playing when it stopped, from where it stopped."""
        r = (self.house.get("resume") or {}).get(eid)
        if not r:
            raise ValueError("There's nothing to resume on this speaker")
        st = self.hass.states.get(eid)
        if not st or st.state in ("unavailable", "unknown"):
            raise ValueError("The speaker isn't available")
        call = self.hass.services.async_call
        if r.get("volume") is not None and abs(float(st.attributes.get("volume_level") or 0) - float(r["volume"])) > 0.02:
            try:
                await call("media_player", "volume_set", {"entity_id": eid, "volume_level": float(r["volume"])}, blocking=True)
            except Exception:  # noqa: BLE001 - not every speaker has a volume
                pass
        if st.state == "paused" and _norm(st.attributes.get("media_title")) == r["title"]:
            await call("media_player", "media_play", {"entity_id": eid}, blocking=True)
            return {"title": r["title"], "how": "play"}
        if r.get("uri") and self._is_ma(eid) and self.hass.services.has_service("music_assistant", "play_media"):
            await call("music_assistant", "play_media", {"entity_id": eid, "media_id": [r["uri"]], "enqueue": "replace"}, blocking=True)
        elif r.get("content_id"):
            await call("media_player", "play_media", {"entity_id": eid, "media_content_id": r["content_id"],
                                                     "media_content_type": r.get("content_type") or "music"}, blocking=True)
        else:
            await call("media_player", "media_play", {"entity_id": eid}, blocking=True)
        # back to where it was (not for radio): once it's playing, if the speaker can seek
        pos = float(r.get("position") or 0)
        if r.get("kind") != "radio" and pos > 5:
            for _ in range(20):
                await asyncio.sleep(0.5)
                s2 = self.hass.states.get(eid)
                if s2 and s2.state == "playing":
                    break
            s2 = self.hass.states.get(eid)
            if s2 and (int(s2.attributes.get("supported_features") or 0) & 2):
                try:
                    await call("media_player", "media_seek", {"entity_id": eid, "seek_position": pos}, blocking=True)
                except Exception as err:  # noqa: BLE001
                    _LOGGER.debug("Crow Media Player couldn't seek %s: %s", eid, err)
        return {"title": r["title"], "how": "replay", "position": pos}

    # ── Sleep timer ─────────────────────────────────────────────────────────
    def sleep_view(self) -> dict:
        out = {}
        for eid, s in self.house["sleep"].items():
            out[eid] = {"mode": s["mode"], "end": s.get("end"), "title": s.get("title"), "started": s.get("started"),
                        "left": self.sleep_left(eid), "fading": s.get("vol0") is not None}
        return out

    def sleep_set(self, eid: str, *, minutes: float | None = None, end_of_track: bool = False,
                  volume_entity: str | None = None) -> dict:
        self.sleep_cancel(eid, restore=True, quiet=True)
        st = self.hass.states.get(eid)
        a = st.attributes if st else {}
        s: dict[str, Any] = {"entity": eid, "vol": volume_entity or eid, "started": now_ms()}
        if end_of_track:
            s.update(mode="track", title=a.get("media_title") or "", content_id=a.get("media_content_id") or "")
        else:
            s.update(mode="time", end=now_ms() + int(float(minutes or 30) * 60_000))
        self.house["sleep"][eid] = s
        self.save_house()
        self._sleep_start()
        self.push_state()
        self.changed(eid)
        return self.sleep_view()[eid]

    def sleep_cancel(self, eid: str, *, restore: bool = True, quiet: bool = False, delay: float = 0) -> None:
        s = self.house["sleep"].pop(eid, None)
        if not s:
            return
        self.save_house()
        if restore and s.get("vol0") is not None:
            vol = {"entity_id": s["vol"], "volume_level": s["vol0"]}
            if delay:
                async_call_later(self.hass, delay, callback(lambda _n: self.hass.async_create_task(
                    self.hass.services.async_call("media_player", "volume_set", vol))))
            else:
                self.hass.async_create_task(self.hass.services.async_call("media_player", "volume_set", vol))
        if not self.house["sleep"] and self._sleep_tick:
            self._sleep_tick()
            self._sleep_tick = None
        if not quiet:
            self.push_state()
        self.changed(eid)

    def sleep_left(self, eid: str) -> int | None:
        s = self.house["sleep"].get(eid)
        if not s:
            return None
        if s["mode"] == "time":
            return max(0, round((s["end"] - now_ms()) / 1000))
        st = self.hass.states.get(eid)
        a = st.attributes if st else {}
        pos = float(a.get("media_position") or 0)
        upd = a.get("media_position_updated_at")
        if pos and upd and st and st.state == "playing":
            try:
                pos += (dt_util.utcnow() - (upd if isinstance(upd, datetime) else dt_util.parse_datetime(str(upd)))).total_seconds()
            except Exception:  # noqa: BLE001
                pass
        return max(0, round(float(a.get("media_duration") or 0) - pos))

    def _sleep_start(self) -> None:
        if not self._sleep_tick:
            self._sleep_tick = async_track_time_interval(self.hass, self._sleep_step, timedelta(seconds=1))

    @callback
    def _sleep_step(self, _now=None) -> None:
        for eid, s in list(self.house["sleep"].items()):
            st = self.hass.states.get(eid)
            a = st.attributes if st else {}
            song_changed = s["mode"] == "track" and ((s.get("content_id") and a.get("media_content_id") and a.get("media_content_id") != s["content_id"])
                                                    or (s.get("title") and a.get("media_title") and a.get("media_title") != s["title"]))
            stopped = not st or st.state in ("idle", "off", "standby", "unavailable")
            left = self.sleep_left(eid) or 0
            if s["mode"] == "track" and now_ms() - s.get("started", 0) > 3 * 3600_000:
                stopped = True
            if song_changed or stopped or left <= 0:
                if not stopped and st and st.state == "playing":
                    self.hass.async_create_task(self.hass.services.async_call("media_player", "media_pause", {"entity_id": eid}))
                self.sleep_cancel(eid, restore=True, delay=2.5)
                self.hass.bus.async_fire(f"{DOMAIN}_sleep_timer_ended", {"entity_id": eid})
                continue
            # the last half a minute (12 seconds for "end of this song"): turn the volume down gently
            fade = SLEEP_FADE_TRACK_SECONDS if s["mode"] == "track" else SLEEP_FADE_SECONDS
            vs = self.hass.states.get(s["vol"])
            can_vol = vs is not None and isinstance(vs.attributes.get("volume_level"), (int, float)) \
                and (int(vs.attributes.get("supported_features") or 0) & 4)
            if left <= fade and can_vol and st and st.state == "playing":
                if s.get("vol0") is None:
                    s["vol0"] = vs.attributes["volume_level"]
                    self.push_state()
                target = max(0.0, s["vol0"] * (left / fade))
                if time.monotonic() - s.get("_last_vol", 0) > 1.4 and abs(float(vs.attributes.get("volume_level") or 0) - target) > 0.008:
                    s["_last_vol"] = time.monotonic()
                    self.hass.async_create_task(self.hass.services.async_call(
                        "media_player", "volume_set", {"entity_id": s["vol"], "volume_level": round(target, 2)}))
            async_dispatcher_send(self.hass, SIGNAL_SPEAKER + eid)

    # ── Alarms ──────────────────────────────────────────────────────────────
    def alarms_view(self) -> list[dict]:
        return [{**a, "next": self._next_fire(a)} for a in self.house["alarms"]]

    def _next_fire(self, a: dict) -> str | None:
        if not a.get("enabled", True):
            return None
        try:
            hh, mm = (int(x) for x in a["time"].split(":")[:2])
        except (ValueError, KeyError):
            return None
        now = dt_util.now()
        for add in range(0, 8):
            d = (now + timedelta(days=add)).replace(hour=hh, minute=mm, second=0, microsecond=0)
            if d <= now:
                continue
            if a.get("days") and d.weekday() not in a["days"]:
                continue
            return d.isoformat()
        return None

    def alarm_save(self, raw: dict) -> dict:
        aid = raw.get("id") or "a" + secrets.token_hex(6)
        tm = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?", str(raw.get("time") or "").strip())
        if not tm or int(tm[1]) > 23 or int(tm[2]) > 59:
            raise ValueError("Choose a time, like 07:00")
        raw = {**raw, "time": f"{int(tm[1]):02d}:{tm[2]}"}
        if not str(raw.get("entity_id") or "").startswith("media_player."):
            raise ValueError("Choose a speaker")
        a = {"id": aid, "entity_id": raw["entity_id"], "time": raw["time"],
             "days": sorted({int(d) for d in raw.get("days") or [] if 0 <= int(d) <= 6}),
             "volume": max(0.05, min(1.0, float(raw.get("volume") if raw.get("volume") is not None else 0.35))),
             "media_content_id": raw.get("media_content_id") or "", "media_content_type": raw.get("media_content_type") or "music",
             "title": str(raw.get("title") or "")[:120], "artwork": str(raw.get("artwork") or "")[:500],
             "enabled": raw.get("enabled", True) is not False}
        self.house["alarms"] = [x for x in self.house["alarms"] if x["id"] != aid] + [a]
        self.save_house()
        self.push_state()
        self.changed(a["entity_id"])
        return a

    def alarm_delete(self, aid: str) -> None:
        gone = [x for x in self.house["alarms"] if x["id"] == aid]
        self.house["alarms"] = [x for x in self.house["alarms"] if x["id"] != aid]
        self.save_house()
        self.push_state()
        for g in gone:
            self.changed(g["entity_id"])

    def next_alarm(self, eid: str | None = None) -> dict | None:
        best = None
        for a in self.alarms_view():
            if a["next"] and (eid is None or a["entity_id"] == eid) and (best is None or a["next"] < best["next"]):
                best = a
        return best

    @callback
    def _alarm_minute(self, now: datetime) -> None:
        local = dt_util.as_local(now)
        hm = local.strftime("%H:%M")
        for a in list(self.house["alarms"]):
            if not a.get("enabled", True):
                continue
            hh, mm = a["time"].split(":")
            if f"{int(hh):02d}:{mm}" != hm:
                continue
            if a.get("days") and local.weekday() not in a["days"]:
                continue
            self.hass.async_create_task(self.async_ring(a))
            if not a.get("days"):
                a["enabled"] = False   # a one-off alarm switches itself off
                self.save_house()
        self.push_state()

    async def async_ring(self, a: dict) -> None:
        """Wake up: start quietly, then bring the volume up to the alarm's level over a minute."""
        eid = a["entity_id"]
        self.hass.bus.async_fire(f"{DOMAIN}_alarm", {"entity_id": eid, "alarm_id": a["id"], "title": a.get("title", "")})
        try:
            await self.hass.services.async_call("media_player", "volume_set", {"entity_id": eid, "volume_level": 0.04}, blocking=True)
        except Exception:  # noqa: BLE001
            pass
        try:
            if a.get("media_content_id"):
                if self._is_ma(eid) and self.hass.services.has_service("music_assistant", "play_media"):
                    await self.hass.services.async_call("music_assistant", "play_media", {
                        "entity_id": eid, "media_id": a["media_content_id"], "enqueue": "replace",
                        **({"media_type": a["media_content_type"]} if a.get("media_content_type") in
                           ("artist", "album", "playlist", "track", "radio", "podcast", "audiobook") else {})}, blocking=True)
                else:
                    await self.hass.services.async_call("media_player", "play_media", {
                        "entity_id": eid, "media_content_id": a["media_content_id"],
                        "media_content_type": a.get("media_content_type") or "music"}, blocking=True)
            else:
                await self.hass.services.async_call("media_player", "media_play", {"entity_id": eid}, blocking=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Crow Media Player alarm couldn't play on %s: %s", eid, err)
            return
        target = float(a.get("volume") or 0.35)
        steps = 12
        if self._ramps.get(eid):
            self._ramps.pop(eid)()

        def step(i: int) -> None:
            if i > steps:
                self._ramps.pop(eid, None)
                return
            vol = round(0.04 + (target - 0.04) * i / steps, 2)
            self.hass.async_create_task(self.hass.services.async_call("media_player", "volume_set", {"entity_id": eid, "volume_level": vol}))
            self._ramps[eid] = async_call_later(self.hass, ALARM_RAMP_SECONDS / steps, callback(lambda _n: step(i + 1)))

        step(1)

    # ── Actions ─────────────────────────────────────────────────────────────
    def find_pin(self, name: str, kind: str | None = None, uid: str | None = None) -> tuple[str, dict] | None:
        """A pinned item by its name: (category, item)."""
        want = name.strip().lower()
        people = [uid] if uid else list(self.users)
        best = None
        for u in people:
            pins = (self.users.get(u) or {}).get("crow_media_pins") or {}
            for cat, items in pins.items():
                if kind and cat != kind:
                    continue
                for it in items or []:
                    if not isinstance(it, dict):
                        continue
                    nm = str(it.get("name") or it.get("title") or it.get("collectionName") or "").strip().lower()
                    if nm == want:
                        return cat, it
                    if want and want in nm and best is None:
                        best = (cat, it)
        return best

    async def async_play_item(self, eid: str, cat: str, item: dict) -> None:
        uri = item.get("_maUri") or item.get("uri") or item.get("media_content_id") or item.get("url_resolved") or item.get("url") \
            or item.get("feedUrl") or ""
        if not uri:
            raise ValueError("That pin can't be played")
        media_type = {"stations": "radio", "track": "track", "artist": "artist", "album": "album", "playlist": "playlist",
                      "podcasts": "podcast", "audiobooks": "audiobook"}.get(cat)
        if self._is_ma(eid) and self.hass.services.has_service("music_assistant", "play_media"):
            await self.hass.services.async_call("music_assistant", "play_media", {
                "entity_id": eid, "media_id": uri, "enqueue": "replace", **({"media_type": media_type} if media_type else {})}, blocking=True)
        else:
            await self.hass.services.async_call("media_player", "play_media", {
                "entity_id": eid, "media_content_id": uri, "media_content_type": item.get("media_content_type") or "music"}, blocking=True)

    async def async_play_station(self, eid: str, name: str) -> str:
        found = self.find_pin(name, "stations")
        if found:
            await self.async_play_item(eid, *found)
            return found[1].get("name") or name
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(15):
            async with session.get("https://de1.api.radio-browser.info/json/stations/search",
                                   params={"name": name, "limit": "8", "order": "votes", "reverse": "true", "hidebroken": "true"},
                                   headers={"User-Agent": "CrowMediaPlayer/0.1 (Home Assistant)"}) as r:
                stations = await r.json(content_type=None)
        if not stations:
            raise ValueError(f"No radio station called {name}")
        st = stations[0]
        await self.async_play_item(eid, "stations", st)
        return st.get("name") or name
