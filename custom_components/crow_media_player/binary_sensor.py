"""Binary sensors: music playing anywhere in the house, and each speaker's Radio Mode and whether it has
something to resume."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity import HouseEntity, SpeakerEntity, setup_speakers
from .manager import CrowMedia


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    m: CrowMedia = hass.data[DOMAIN]
    add([MusicPlayingSensor(m)])
    setup_speakers(hass, entry, add, lambda m, eid: [RadioModeSensor(m, eid), ResumeSensor(m, eid)])


class MusicPlayingSensor(HouseEntity, BinarySensorEntity):
    """On while any speaker is playing something, with which ones."""
    _attr_icon = "mdi:music"

    def __init__(self, m: CrowMedia) -> None:
        super().__init__(m, "music_playing")

    @property
    def is_on(self) -> bool:
        return bool(self.m.stats()["playing"])

    @property
    def extra_state_attributes(self):
        out = []
        for eid in self.m.stats()["playing"]:
            n = self.m.now.get(eid) or {}
            out.append({"speaker": eid, "kind": n.get("kind"), "title": n.get("title"), "artist": n.get("artist") or None})
        return {"speakers": out}


class RadioModeSensor(SpeakerEntity, BinarySensorEntity):
    """On while Music Assistant's Radio Mode ("Don't stop the music") is on for this speaker (with Queue Actions)."""
    _attr_icon = "mdi:radio-tower"
    # Radio Mode is shown and changed in the card itself, so this is off until it's wanted for an automation
    _attr_entity_registry_enabled_default = False

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "radio_mode")

    @property
    def is_on(self) -> bool | None:
        v = self.now.get("radio_mode")
        return v if isinstance(v, bool) else None


class ResumeSensor(SpeakerEntity, BinarySensorEntity):
    """On while this speaker has something it can carry on with (a song, audiobook, podcast or station stopped part way)."""
    _attr_icon = "mdi:play-pause"

    def __init__(self, m: CrowMedia, eid: str) -> None:
        super().__init__(m, eid, "resume_available")

    @property
    def _r(self) -> dict:
        return (self.m.house.get("resume") or {}).get(self.eid) or {}

    @property
    def is_on(self) -> bool:
        return bool(self._r)

    @property
    def extra_state_attributes(self):
        r = self._r
        if not r:
            return {"kind": None, "title": None, "artist": None, "album": None, "position": None, "duration": None,
                    "percent": None, "stopped_at": None}
        dur, pos = float(r.get("duration") or 0), float(r.get("position") or 0)
        return {"kind": r.get("kind"), "title": r.get("title"), "artist": r.get("artist") or None, "album": r.get("album") or None,
                "position": round(pos) if r.get("kind") != "radio" else None, "duration": round(dur) or None,
                "percent": round(pos / dur * 100) if dur and r.get("kind") != "radio" else None,
                "stopped_at": dt_util.utc_from_timestamp((r.get("ts") or 0) / 1000).isoformat() if r.get("ts") else None}
