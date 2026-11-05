"""Sensors: how many things are in each smart list, storage and shopping list, and the waste score."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, KIND_LIST, NAME, SIGNAL_UPDATE
from .store import CrowFood

SMART = {
    "all": ("In storage", "mdi:archive-outline"),
    "open": ("Open", "mdi:package-variant"),
    "soon": ("Soon to be expired", "mdi:alert-outline"),
    "expired": ("Expired", "mdi:calendar-remove-outline"),
    "today": ("Expires today", "mdi:calendar-alert"),
    "low": ("Soon to run out", "mdi:arrow-collapse-down"),
    "stale": ("Not bought lately", "mdi:clock-alert-outline"),
}


def device_info() -> DeviceInfo:
    return DeviceInfo(identifiers={(DOMAIN, "household")}, name=NAME, manufacturer="Crow", model="Food inventory",
                      entry_type=DeviceEntryType.SERVICE)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    food: CrowFood = hass.data[DOMAIN]
    entities: list[SensorEntity] = [SmartSensor(food, k) for k in SMART] + [WasteSensor(food)]
    known: dict[str, StorageSensor] = {}
    for sid in food.data["storages"]:
        known[sid] = StorageSensor(food, sid)
    add(entities + list(known.values()))

    @callback
    def storages_changed(kind: str) -> None:
        if kind not in ("storages", "all"):
            return
        new = [StorageSensor(food, sid) for sid in food.data["storages"] if sid not in known]
        for s in new:
            known[s.sid] = s
        if new:
            add(new)
        reg = er.async_get(hass)
        for sid in [k for k in known if k not in food.data["storages"]]:
            ent = known.pop(sid)
            if ent.entity_id and reg.async_get(ent.entity_id):
                reg.async_remove(ent.entity_id)

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATE, storages_changed))


class _Base(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, food: CrowFood) -> None:
        self.food = food
        self._attr_device_info = device_info()

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self._update))

    @callback
    def _update(self, kind: str) -> None:
        if kind in ("items", "products", "storages", "settings", "all", "day"):
            self.async_write_ha_state()


class SmartSensor(_Base):
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, food: CrowFood, key: str) -> None:
        super().__init__(food)
        self.key = key
        self._attr_unique_id = f"{DOMAIN}_smart_{key}"
        self._attr_name = SMART[key][0]
        self._attr_icon = SMART[key][1]
        self._attr_native_unit_of_measurement = "products" if key in ("low", "stale") else "items"

    def _rows(self) -> list[dict]:
        if self.key == "today":
            t = dt_util.now().date().isoformat()
            return [i for i in self.food.smart(None)["all"] if i.get("expires") == t]
        return self.food.smart(None)[self.key]

    @property
    def native_value(self) -> int:
        return len(self._rows())

    @property
    def extra_state_attributes(self) -> dict:
        rows = self._rows()
        if self.key in ("low", "stale"):
            return {"products": [r["name"] for r in rows][:50]}
        return {"items": [{"name": self.food.name_of(i), "qty": i["qty"], "expires": i.get("expires"),
                           "storage": (self.food.data["storages"].get(i["storage"]) or {}).get("name")}
                          for i in sorted(rows, key=lambda r: r.get("expires") or "9999")][:50]}


class WasteSensor(_Base):
    _attr_native_unit_of_measurement = "%"
    _attr_icon = "mdi:leaf"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, food: CrowFood) -> None:
        super().__init__(food)
        self._attr_unique_id = f"{DOMAIN}_consumed_pct"
        self._attr_name = "Consumed"

    @callback
    def _update(self, kind: str) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> float:
        return self.food.stats()["consumed_pct"]

    @property
    def extra_state_attributes(self) -> dict:
        s = self.food.stats()
        last = self.food.stats(30)
        return {"consumed": s["consumed"], "thrown": s["thrown"], "thrown_pct": s["thrown_pct"],
                "consumed_pct_30_days": last["consumed_pct"], "thrown_pct_30_days": last["thrown_pct"]}


class StorageSensor(_Base):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"

    def __init__(self, food: CrowFood, sid: str) -> None:
        super().__init__(food)
        self.sid = sid
        self._attr_unique_id = f"{DOMAIN}_storage_{sid}"

    @property
    def _row(self) -> dict:
        return self.food.data["storages"].get(self.sid) or {}

    @property
    def name(self) -> str:
        return self._row.get("name", "Storage")

    @property
    def icon(self) -> str:
        return self._row.get("icon") or "mdi:archive-outline"

    @property
    def available(self) -> bool:
        return self.sid in self.food.data["storages"]

    @property
    def native_value(self) -> int:
        items = [i for i in self.food.data["items"].values() if i.get("storage") == self.sid]
        if self._row.get("kind") == KIND_LIST:
            items = [i for i in items if not i.get("bought")]
        return len(items)

    @property
    def extra_state_attributes(self) -> dict:
        r = self._row
        return {"kind": r.get("kind"), "shared_with": "everyone" if not r.get("users") else len(r["users"])}
