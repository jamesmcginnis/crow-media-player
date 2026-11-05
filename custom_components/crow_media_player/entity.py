"""What Crow Media Player's entities share: the household's device, and one device for each speaker."""
from __future__ import annotations

from collections.abc import Callable

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, NAME
from .manager import SIGNAL_SPEAKER, SIGNAL_SPEAKERS, SIGNAL_UPDATE, CrowMedia


class HouseEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, m: CrowMedia, key: str) -> None:
        self.m = m
        self._attr_unique_id = f"household_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, "household")}, name=f"{NAME} (Household)",
                                            manufacturer=NAME, model="Household", entry_type=DeviceEntryType.SERVICE)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self.async_write_ha_state))


class SpeakerEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, m: CrowMedia, eid: str, key: str) -> None:
        self.m = m
        self.eid = eid
        self._attr_unique_id = f"{eid}_{key}"
        self._attr_translation_key = key
        st = m.hass.states.get(eid)
        name = (st.attributes.get("friendly_name") if st else None) or eid.split(".", 1)[1].replace("_", " ").title()
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, eid)}, name=f"{NAME} ({name})",
                                            manufacturer=NAME, model="Speaker", entry_type=DeviceEntryType.SERVICE)

    @property
    def now(self) -> dict:
        return self.m.now.get(self.eid) or {}

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_SPEAKER + self.eid, self.async_write_ha_state))


def setup_speakers(hass: HomeAssistant, entry: ConfigEntry, add: Callable, make: Callable[[CrowMedia, str], list]) -> None:
    """Entities for each speaker now, and for speakers added later (in Configure, or by a card)."""
    m: CrowMedia = hass.data[DOMAIN]
    known: set[str] = set()

    @callback
    def sync() -> None:
        new = []
        for eid in m.speakers():
            if eid not in known:
                known.add(eid)
                new += make(m, eid)
        if new:
            add(new)

    sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_SPEAKERS, sync))
