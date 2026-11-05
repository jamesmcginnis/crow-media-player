"""On/off sensors for automations and dashboard badges.

- Something expires today, Something has expired, Something's running low (the household's whole stock)

For one product (just the milk), automations use the crow_food_running_low and crow_food_back_in_stock
events, or the list on Something's running low. The one-sensor-per-product entities of earlier versions are
removed from Home Assistant at start-up.

They update whenever the food changes, and just after midnight, when "today" moves on.
"""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_UPDATE
from .sensor import device_info
from .store import CrowFood

HOUSE = {
    "expires_today": ("Something expires today", "mdi:calendar-alert", "mdi:calendar-check"),
    "expired": ("Something has expired", "mdi:calendar-remove", "mdi:calendar-check"),
    "low": ("Something's running low", "mdi:basket-unfill", "mdi:basket-check"),
}


def _today_items(food: CrowFood) -> list[dict]:
    t = dt_util.now().date().isoformat()
    return [i for i in food.smart(None)["all"] if i.get("expires") == t]


def _items_attr(food: CrowFood, items: list[dict]) -> dict:
    return {"count": len(items),
            "items": [{"name": food.name_of(i), "qty": i["qty"], "expires": i.get("expires"),
                       "storage": (food.data["storages"].get(i["storage"]) or {}).get("name")}
                      for i in sorted(items, key=lambda r: r.get("expires") or "9999")][:50]}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    food: CrowFood = hass.data[DOMAIN]
    add([HouseSensor(food, k) for k in HOUSE])
    # earlier versions made a "<product> running low" sensor for every product with a minimum: taken away
    reg = er.async_get(hass)
    for ent in list(er.async_entries_for_config_entry(reg, entry.entry_id)):
        if ent.domain == "binary_sensor" and (ent.unique_id or "").startswith(f"{DOMAIN}_low_"):
            reg.async_remove(ent.entity_id)

    @callback
    def midnight(_now) -> None:
        async_dispatcher_send(hass, SIGNAL_UPDATE, "day")

    entry.async_on_unload(async_track_time_change(hass, midnight, hour=0, minute=0, second=5))


class _Base(BinarySensorEntity):
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


class HouseSensor(_Base):
    def __init__(self, food: CrowFood, key: str) -> None:
        super().__init__(food)
        self.key = key
        self._attr_unique_id = f"{DOMAIN}_alert_{key}"
        self._attr_name = HOUSE[key][0]

    def _rows(self) -> list[dict]:
        if self.key == "expires_today":
            return _today_items(self.food)
        return self.food.smart(None)[self.key]

    @property
    def is_on(self) -> bool:
        return bool(self._rows())

    @property
    def icon(self) -> str:
        return HOUSE[self.key][1 if self.is_on else 2]

    @property
    def extra_state_attributes(self) -> dict:
        rows = self._rows()
        if self.key == "low":
            # what's low: name, how many left and the minimum (for automations and cards)
            return {"count": len(rows), "products": [r["name"] for r in rows][:100],
                    "items": [{"name": r["name"], "left": round(float(r.get("stock") or 0), 3), "minimum": r.get("min")} for r in rows][:100]}
        return _items_attr(self.food, rows)
