"""Sensors: the household's listening, and what each speaker is doing.

Nothing anyone says in a message, and nothing private: songs, artists and stations played on the house's
speakers, as Home Assistant's own media players already show them.
"""
from __future__ import annotations

import math
from datetime import timedelta

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity import HouseEntity, SpeakerEntity, setup_speakers
from .manager import SIGNAL_POSITION, CrowMedia

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    m: CrowMedia = hass.data[DOMAIN]
    add([ListeningSensor(m, "listening_today"), ListeningSensor(m, "listening_week"), TracksTodaySensor(m),
         TopArtistSensor(m), TopTrackSensor(m), LastPlayedSensor(m), StreakSensor(m), EpisodesSensor(m), ReleasesSensor(m),
         RoomsPlayingSensor(m), LastMusicSensor(m), ListeningByRoomSensor(m)])
    setup_speakers(hass, entry, add, lambda m, eid: [
        SleepSensor(m, eid), NextAlarmSensor(m, eid), RadioSensor(m, eid), QueueSensor(m, eid), WatchingSensor(m, eid),
        AudiobookSensor(m, eid), UpNextSensor(m, eid), SongEndsSensor(m, eid), AudioQualitySensor(m, eid)])


def room_of(hass: HomeAssistant, eid: str) -> str:
    """The speaker's area in Home Assistant, or its own name."""
    try:
        ent = er.async_get(hass).async_get(eid)
        area_id = ent.area_id if ent else None
        if not area_id and ent and ent.device_id:
            dev = dr.async_get(hass).async_get(ent.device_id)
            area_id = dev.area_id if dev else None
        area = ar.async_get(hass).async_get_area(area_id) if area_id else None
        if area:
            return area.name
    except Exception:  # noqa: BLE001 - no registries (yet)
        pass
    st = hass.states.get(eid)
    return (st.attributes.get("friendly_name") if st else None) or eid


# ── The household ───────────────────────────────────────────────────────────
class ListeningSensor(HouseEntity, SensorEntity):
    """Minutes of music played in the house today (or this week, from Monday)."""
    _attr_icon = "mdi:headphones"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, m: CrowMedia, key: str) -> None:
        super().__init__(m, key)
        self._field = "today_minutes" if key == "listening_today" else "week_minutes"

    @property
    def native_value(self):
        return self.m.stats()[self._field]


class TracksTodaySensor(HouseEntity, SensorEntity):
    _attr_icon = "mdi:music-note-plus"
    _attr_native_unit_of_measurement = "tracks"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "tracks_today")

    @property
    def native_value(self):
        return self.m.stats()["tracks_today"]

    @property
    def extra_state_attributes(self):
        return {"this_week": self.m.stats()["tracks_week"]}


class TopArtistSensor(HouseEntity, SensorEntity):
    _attr_icon = "mdi:account-music"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "top_artist_week")

    @property
    def native_value(self):
        t = self.m.stats()["top_artists"]
        return t[0][0][:250] if t else None

    @property
    def extra_state_attributes(self):
        t = self.m.stats()["top_artists"]
        return {"plays": t[0][1] if t else 0, "top_five": [{"artist": a, "plays": n} for a, n in t]}


class TopTrackSensor(HouseEntity, SensorEntity):
    _attr_icon = "mdi:music-circle"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "top_track_week")

    @property
    def native_value(self):
        t = self.m.stats()["top_tracks"]
        return t[0][0][:250] if t else None

    @property
    def extra_state_attributes(self):
        t = self.m.stats()["top_tracks"]
        return {"plays": t[0][1] if t else 0, "top_five": [{"track": a, "plays": n} for a, n in t]}


class LastPlayedSensor(HouseEntity, SensorEntity):
    _attr_icon = "mdi:history"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "last_played")

    @property
    def native_value(self):
        last = self.m.stats()["last"]
        return f"{last['data']['artist']} – {last['data']['title']}"[:250] if last else None

    @property
    def extra_state_attributes(self):
        last = self.m.stats()["last"]
        if not last:
            return {"artist": None, "title": None, "album": None, "speaker": None, "played_at": None}
        d = last["data"]
        return {"artist": d.get("artist"), "title": d.get("title"), "album": d.get("album") or None,
                "speaker": d.get("entity") or None, "played_at": dt_util.utc_from_timestamp(last["ts"] / 1000).isoformat()}


class StreakSensor(HouseEntity, SensorEntity):
    _attr_icon = "mdi:fire"
    _attr_native_unit_of_measurement = UnitOfTime.DAYS

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "listening_streak")

    @property
    def native_value(self):
        return self.m.stats()["streak"]


class EpisodesSensor(HouseEntity, SensorEntity):
    """Episodes from the last week of podcasts anyone has pinned."""
    _attr_icon = "mdi:podcast"
    _attr_native_unit_of_measurement = "episodes"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "new_podcast_episodes")

    @property
    def native_value(self):
        return len(self.m.house["podcasts"].get("episodes") or [])

    @property
    def extra_state_attributes(self):
        eps = self.m.house["podcasts"].get("episodes") or []
        return {"episodes": [{k: e.get(k) for k in ("podcast", "title", "released")} for e in eps[:15]],
                "checked": self.m.house["podcasts"].get("checked")}


class ReleasesSensor(HouseEntity, SensorEntity):
    """Albums and singles from the last two weeks by the artists played most in the house."""
    _attr_icon = "mdi:album"
    _attr_native_unit_of_measurement = "releases"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "new_releases")

    @property
    def native_value(self):
        return len(self.m.house["releases"].get("albums") or [])

    @property
    def extra_state_attributes(self):
        al = self.m.house["releases"].get("albums") or []
        return {"releases": [{k: a.get(k) for k in ("artist", "title", "type", "released")} for a in al[:15]],
                "checked": self.m.house["releases"].get("checked")}


class RoomsPlayingSensor(HouseEntity, SensorEntity):
    """How many rooms are playing something right now, and which."""
    _attr_icon = "mdi:home-sound-out"
    _attr_native_unit_of_measurement = "rooms"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "rooms_playing")

    def _room(self, eid: str) -> str:
        return room_of(self.hass, eid)

    @property
    def native_value(self):
        return len(self.m.stats()["playing"])

    @property
    def extra_state_attributes(self):
        rooms, out = [], []
        for eid in self.m.stats()["playing"]:
            n = self.m.now.get(eid) or {}
            room = self._room(eid)
            if room not in rooms:
                rooms.append(room)
            out.append({"room": room, "speaker": eid, "kind": n.get("kind"), "title": n.get("title") or None, "artist": n.get("artist") or None})
        return {"rooms": rooms, "speakers": out}


class LastMusicSensor(HouseEntity, SensorEntity):
    """When a song last played anywhere in the house."""
    _attr_icon = "mdi:music-clef-treble"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "last_music")

    @property
    def native_value(self):
        ts = self.m.stats().get("last_ts")
        return dt_util.utc_from_timestamp(ts / 1000) if ts else None

    @property
    def extra_state_attributes(self):
        st = self.m.stats()
        last = st["last"]
        playing = any((self.m.now.get(e) or {}).get("kind") == "music" for e in st["playing"])
        ts = st.get("last_ts")
        return {"playing_now": playing, "song": f"{last['data']['artist']} – {last['data']['title']}"[:250] if last else None,
                "speaker": (last["data"].get("entity") or None) if last else None,
                "days_ago": (dt_util.now().date() - dt_util.as_local(dt_util.utc_from_timestamp(ts / 1000)).date()).days if ts else None}


# ── Each speaker ────────────────────────────────────────────────────────────
class SleepSensor(SpeakerEntity, SensorEntity):
    """Minutes left on the sleep timer (unknown when there isn't one)."""
    _attr_icon = "mdi:power-sleep"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_suggested_display_precision = 0

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "sleep_timer")

    @property
    def native_value(self):
        left = self.m.sleep_left(self.eid)
        return None if left is None else math.ceil(left / 60)

    @property
    def extra_state_attributes(self):
        s = self.m.house["sleep"].get(self.eid)
        if not s:
            return {"mode": None, "ends_at": None}
        return {"mode": "end_of_track" if s["mode"] == "track" else "minutes",
                "ends_at": dt_util.utc_from_timestamp(s["end"] / 1000).isoformat() if s.get("end") else None}


class NextAlarmSensor(SpeakerEntity, SensorEntity):
    _attr_icon = "mdi:alarm"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "next_alarm")

    @property
    def native_value(self):
        a = self.m.next_alarm(self.eid)
        return dt_util.parse_datetime(a["next"]) if a else None

    @property
    def extra_state_attributes(self):
        a = self.m.next_alarm(self.eid)
        return {"title": a.get("title") if a else None, "alarm_id": a["id"] if a else None,
                "alarms": len([x for x in self.m.house["alarms"] if x["entity_id"] == self.eid and x.get("enabled", True)])}


class RadioSensor(SpeakerEntity, SensorEntity):
    _attr_icon = "mdi:radio"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "radio_station")

    @property
    def native_value(self):
        n = self.now
        if n.get("kind") != "radio" or n.get("state") not in ("playing", "buffering"):
            return None
        return (n.get("channel") or n.get("album") or n.get("artist") or n.get("title") or "Radio")[:250]

    @property
    def extra_state_attributes(self):
        n = self.now
        on = n.get("kind") == "radio"
        return {"now_playing": (f"{n.get('artist')} – {n.get('title')}" if n.get("artist") else n.get("title")) if on else None,
                "picture": n.get("picture") if on else None}


class QueueSensor(SpeakerEntity, SensorEntity):
    """Roughly how long until Music Assistant's queue on this speaker runs out."""
    _attr_icon = "mdi:playlist-play"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_device_class = SensorDeviceClass.DURATION

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "queue_time_left")

    @property
    def native_value(self):
        q = self.now.get("queue")
        return round(q["seconds"] / 60) if q and self.now.get("state") == "playing" else None

    @property
    def extra_state_attributes(self):
        q = self.now.get("queue") or {}
        return {"tracks_left": q.get("tracks_left"), "shuffle": q.get("shuffle"), "repeat": q.get("repeat")}


class WatchingSensor(SpeakerEntity, SensorEntity):
    """The film or TV episode playing, for movie-night scenes."""
    _attr_icon = "mdi:movie-open-outline"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "now_watching")

    @property
    def native_value(self):
        n = self.now
        if n.get("kind") != "video" or n.get("state") not in ("playing", "paused"):
            return None
        if n.get("series"):
            ep = ""
            if n.get("season") is not None and n.get("episode") is not None:
                ep = f" S{n['season']}E{n['episode']}"
            return f"{n['series']}{ep}"[:250]
        return (n.get("title") or None) and n["title"][:250]

    @property
    def extra_state_attributes(self):
        n = self.now
        on = n.get("kind") == "video"
        return {"title": n.get("title") if on else None, "series": n.get("series") or None if on else None,
                "season": n.get("season") if on else None, "episode": n.get("episode") if on else None,
                "app": n.get("app") or None if on else None, "picture": n.get("picture") or None if on else None,
                "paused": n.get("state") == "paused" if on else None}


class AudiobookSensor(SpeakerEntity, SensorEntity):
    """How far through the audiobook (or the chapter, when that's all the speaker knows) it is."""
    _attr_icon = "mdi:book-music-outline"
    _attr_native_unit_of_measurement = "%"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "audiobook")

    @property
    def native_value(self):
        n = self.now
        if n.get("kind") != "audiobook" or not n.get("duration"):
            return None
        return max(0, min(100, round(float(n.get("position") or 0) / float(n["duration"]) * 100)))

    @property
    def extra_state_attributes(self):
        n = self.now
        on = n.get("kind") == "audiobook"
        return {"book": (n.get("album") or n.get("title")) if on else None, "chapter": n.get("title") if on else None,
                "author": n.get("artist") if on else None}


class UpNextSensor(SpeakerEntity, SensorEntity):
    """The next song in Music Assistant's queue on this speaker."""
    _attr_icon = "mdi:skip-next-circle-outline"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "up_next")

    @property
    def _next(self) -> dict | None:
        n = self.now
        if n.get("state") not in ("playing", "paused", "buffering"):
            return None
        return (n.get("queue") or {}).get("next")

    @property
    def native_value(self):
        up = self._next
        if not up:
            return None
        return (f"{up['artist']} – {up['title']}" if up.get("artist") else up.get("title") or "")[:250] or None

    @property
    def extra_state_attributes(self):
        up = self._next or {}
        return {"title": up.get("title"), "artist": up.get("artist"), "album": up.get("album"), "picture": up.get("image"),
                "duration": up.get("duration"), "uri": up.get("uri"),
                "tracks_left": ((self.now.get("queue") or {}).get("tracks_left")) if up else None}


class ListeningByRoomSensor(HouseEntity, SensorEntity):
    """The room with the most music today, with the minutes and songs for every room."""
    _attr_icon = "mdi:floor-plan"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "listening_by_room")

    def _rooms(self) -> list[dict]:
        rooms: dict[str, dict] = {}
        for eid, v in (self.m.stats().get("today_by_speaker") or {}).items():
            r = rooms.setdefault(room_of(self.hass, eid), {"ms": 0, "tracks": 0})
            r["ms"] += v["ms"]
            r["tracks"] += v["tracks"]
        out = [{"room": k, "minutes": round(v["ms"] / 60000), "tracks": v["tracks"]} for k, v in rooms.items()]
        return sorted(out, key=lambda r: (-r["minutes"], -r["tracks"], r["room"]))

    @property
    def native_value(self):
        rooms = self._rooms()
        return rooms[0]["room"][:250] if rooms else None

    @property
    def extra_state_attributes(self):
        rooms = self._rooms()
        return {"minutes": rooms[0]["minutes"] if rooms else 0, "rooms": rooms}


class SongEndsSensor(SpeakerEntity, SensorEntity):
    """When the song (or episode, chapter or film) playing will finish, for "when this song ends" automations."""
    _attr_icon = "mdi:timer-music-outline"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "song_ends_at")
        self._shown = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_POSITION + self.eid, self.async_write_ha_state))

    @property
    def native_value(self):
        n = self.now
        if n.get("state") != "playing" or n.get("kind") not in ("music", "podcast", "audiobook", "video"):
            self._shown = None
            return None
        try:
            dur = float(n.get("duration") or 0)
            pos = float(n.get("position") or 0)
            at = dt_util.parse_datetime(n.get("position_at") or "") if n.get("position_at") else None
        except (TypeError, ValueError):
            return None
        if not dur or not at:
            self._shown = None
            return None
        ends = at + timedelta(seconds=max(0.0, dur - pos))
        # the speaker reporting its place again moves this by a moment: keep the time already shown
        if self._shown and abs((ends - self._shown).total_seconds()) < 3:
            return self._shown
        self._shown = ends.replace(microsecond=0)
        return self._shown

    @property
    def extra_state_attributes(self):
        n = self.now
        on = n.get("state") == "playing"
        return {"title": n.get("title") or None if on else None, "duration": n.get("duration") or None if on else None}


class AudioQualitySensor(SpeakerEntity, SensorEntity):
    """The format of the song streaming on a Music Assistant speaker, e.g. "FLAC 24-bit 96 kHz" (with Queue Actions)."""
    _attr_icon = "mdi:high-definition"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "audio_quality")

    @property
    def _q(self) -> dict:
        n = self.now
        return (n.get("quality") or {}) if n.get("kind") in ("music", "podcast", "audiobook") and n.get("state") in ("playing", "paused", "buffering") else {}

    @property
    def native_value(self):
        return (self._q.get("text") or None) and self._q["text"][:250]

    @property
    def extra_state_attributes(self):
        q = self._q
        return {k: q.get(k) for k in ("codec", "sample_rate", "bit_depth", "bit_rate", "lossless", "hi_res", "source")}
