"""Shopping lists as Home Assistant to-do lists (off unless switched on in the card editor).

With this on, Assist can "add milk to the shopping list", and the lists show in Home Assistant's
To-do panel and the Companion app. Ticking something off there marks it bought in Crow Food.
"""
from __future__ import annotations

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, KIND_LIST, SIGNAL_UPDATE
from .sensor import device_info
from .store import CrowFood


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    food: CrowFood = hass.data[DOMAIN]
    known: dict[str, ShoppingTodo] = {}

    @callback
    def sync(kind: str = "all") -> None:
        if kind not in ("storages", "settings", "all"):
            return
        on = bool(food.settings.get("todo_lists"))
        lists = {sid for sid, s in food.data["storages"].items() if s.get("kind") == KIND_LIST} if on else set()
        new = [ShoppingTodo(food, sid) for sid in lists if sid not in known]
        for e in new:
            known[e.sid] = e
        if new:
            add(new)
        reg = er.async_get(hass)
        for sid in [k for k in known if k not in lists]:
            ent = known.pop(sid)
            if ent.entity_id and reg.async_get(ent.entity_id):
                reg.async_remove(ent.entity_id)

    sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATE, sync))


class ShoppingTodo(TodoListEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_supported_features = (TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM
                                | TodoListEntityFeature.DELETE_TODO_ITEM)

    def __init__(self, food: CrowFood, sid: str) -> None:
        self.food = food
        self.sid = sid
        self._attr_unique_id = f"{DOMAIN}_list_{sid}"
        self._attr_device_info = device_info()

    @property
    def name(self) -> str:
        return (self.food.data["storages"].get(self.sid) or {}).get("name", "Shopping")

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self._changed))

    @callback
    def _changed(self, kind: str) -> None:
        if kind in ("items", "products", "storages", "all") and self.sid in self.food.data["storages"]:
            self.async_write_ha_state()

    @property
    def todo_items(self) -> list[TodoItem]:
        out = []
        for it in sorted((i for i in self.food.data["items"].values() if i.get("storage") == self.sid),
                         key=lambda i: (i.get("bought", False), self.food.name_of(i).lower())):
            qty = it.get("qty", 1)
            summary = self.food.name_of(it) + (f" ×{qty:g}" if qty and qty != 1 else "")
            out.append(TodoItem(uid=it["id"], summary=summary, description=it.get("note") or None,
                                status=TodoItemStatus.COMPLETED if it.get("bought") else TodoItemStatus.NEEDS_ACTION))
        return out

    def _product_for(self, summary: str) -> dict | None:
        name = (summary or "").strip()
        return next((p for p in self.food.data["products"].values() if p["name"].lower() == name.lower()), None)

    async def async_create_todo_item(self, item: TodoItem) -> None:
        name = (item.summary or "").strip()
        if not name:
            return
        p = self._product_for(name) or await self.food.async_save_product(None, {"name": name, "source": "todo"})
        await self.food.async_save_item(None, {"product": p["id"], "storage": self.sid, "qty": 1, "note": item.description or ""})

    async def async_update_todo_item(self, item: TodoItem) -> None:
        it = self.food.data["items"].get(item.uid or "")
        if not it:
            return
        await self.food.async_set_bought(None, it["id"], item.status == TodoItemStatus.COMPLETED)

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        await self.food.async_delete_items(None, uids)
