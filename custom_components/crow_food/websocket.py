"""The websocket commands the card uses (crow_food/...)."""
from __future__ import annotations

import logging
from typing import Any, Callable

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import ai, info, off, reports
from .const import DOMAIN, STATUS_CONSUMED, STATUS_THROWN
from .store import CrowFood, FoodError

_LOGGER = logging.getLogger(__name__)


def _f(hass: HomeAssistant) -> CrowFood:
    food = hass.data.get(DOMAIN)
    if not food:
        raise FoodError("not_ready", "Crow Food is still starting. Try again in a moment.")
    return food


def _simple(name: str, schema: dict, handler: Callable, admin: bool = False) -> Callable:
    """A command that runs handler(food, user, msg) and sends back what it returns."""

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/{name}", **schema})
    @websocket_api.async_response
    async def command(hass, connection, msg) -> None:
        user = connection.user
        if admin and not user.is_admin:
            connection.send_error(msg["id"], "unauthorized", "Only an administrator can change that.")
            return
        try:
            food = _f(hass)
            result = await handler(food, user, msg)
        except FoodError as err:
            connection.send_error(msg["id"], err.code, str(err))
            return
        except vol.Invalid as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        connection.send_result(msg["id"], result if result is not None else {})

    command.__name__ = f"ws_{name.replace('/', '_')}"
    return command


# ── Loading and listening ─────────────────────────────────────────────────────
async def _snapshot(food: CrowFood, user, msg):
    snap = food.snapshot(user.id)
    snap["me"] = user.id
    snap["is_admin"] = user.is_admin
    snap["users"] = await food.async_users()
    snap["ai"] = ai.capabilities(food.hass, food)
    snap["modules"] = food.hass.data.get(f"{DOMAIN}_modules", {})
    snap["profile"] = (food.data.get("profiles") or {}).get(user.id, {})
    return snap


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    food: CrowFood | None = hass.data.get(DOMAIN)
    if not food:
        connection.send_error(msg["id"], "not_ready", "Crow Food is still starting.")
        return

    @callback
    def forward(payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = food.subscribe(connection.user.id, forward)
    connection.send_result(msg["id"])


# ── Storages, lists, shops, categories ───────────────────────────────────────
async def _storage_save(food, user, msg):
    return await food.async_save_storage(user.id, msg["storage"])


async def _storage_delete(food, user, msg):
    await food.async_delete_storage(user.id, msg["storage_id"], msg.get("move_to"))


async def _storage_reorder(food, user, msg):
    await food.async_reorder_storages(user.id, msg["ids"])


async def _simple_save(food, user, msg):
    return await food.async_save_simple(msg["kind"], msg["row"])


async def _simple_delete(food, user, msg):
    await food.async_delete_simple(msg["kind"], msg["row_id"])


async def _simple_reorder(food, user, msg):
    kind = msg["kind"]
    rows = []
    for i, rid in enumerate(msg["ids"]):
        row = food.data[kind].get(rid)
        if row:
            row["sort"] = i
            rows.append(row)
    food._changed(kind, rows)


# ── Products and items ───────────────────────────────────────────────────────
async def _product_save(food, user, msg):
    return food.row_out("products", await food.async_save_product(user.id, msg["product"]))


async def _product_delete(food, user, msg):
    await food.async_delete_product(user.id, msg["product_id"])


async def _lookup(food, user, msg):
    """A barcode: the product Crow Food already knows, or what Open Food Facts knows about it."""
    code = msg["barcode"].strip()
    known = food.find_barcode(code)
    if known:
        return {"known": True, "product": food.row_out("products", known)}
    if not food.settings.get("openfoodfacts", True):
        return {"known": False, "product": None}
    found = await off.async_lookup(food, code)
    return {"known": False, "product": found}


async def _item_save(food, user, msg):
    return await food.async_save_item(user.id, msg["item"])


async def _item_delete(food, user, msg):
    await food.async_delete_items(user.id, msg["ids"])


async def _consume(food, user, msg):
    status = STATUS_THROWN if msg.get("status") == "thrown" else STATUS_CONSUMED
    item = await food.async_consume(user.id, msg["item_id"], msg.get("qty"), status)
    return {"item": item, "log_id": food.last_log_id}


async def _move(food, user, msg):
    return await food.async_move(user.id, msg["item_id"], msg["storage_id"], msg.get("qty"))


async def _open(food, user, msg):
    return await food.async_open(user.id, msg["item_id"], msg.get("opened", True))


async def _buy(food, user, msg):
    return await food.async_add_to_list(user.id, msg["product_id"], msg.get("list_id"), msg.get("qty", 1), msg.get("shop"))


async def _bought(food, user, msg):
    return await food.async_set_bought(user.id, msg["item_id"], msg.get("bought", True))


async def _pick(food, user, msg):
    await food.async_pick(user.id, msg["item_id"], msg.get("used", False))
    return {}


async def _add_names(food, user, msg):
    """Things to buy by name (Use It Up's missing ingredients): known products, or new ones, onto a list."""
    from . import assist
    added, list_name = [], None
    for n in msg["names"][:20]:
        r = await assist.add_to_list(food, user.id, str(n), msg.get("list"), 1)
        if r.get("error"):
            raise FoodError("bad", r["error"])
        added.append(r["added"])
        list_name = r.get("list")
    return {"added": added, "list": list_name}


async def _clear_min(food, user, msg):
    return {"cleared": await food.async_clear_min(msg.get("ids"))}


async def _put_away(food, user, msg):
    return {"count": await food.async_put_away(user.id, msg["list_id"], msg.get("ids"), msg.get("storage_id"))}


async def _keep(food, user, msg):
    return {"count": await food.async_keep(msg["ids"])}


async def _delete_many(food, user, msg):
    removed = await food.async_delete_products(msg["ids"])
    return {"products": removed}


async def _restore_products(food, user, msg):
    return {"count": await food.async_restore_products(msg["products"])}


async def _here(food, user, msg):
    food.set_auto_path(user.id, msg["path"])


async def _history(food, user, msg):
    return food.history(user.id, msg.get("product_id"), msg.get("limit", 200), msg.get("statuses"),
                        msg.get("before"), msg.get("query") or "")


async def _history_restore(food, user, msg):
    return await food.async_restore_log(user.id, msg["log_id"], msg.get("storage_id"))


async def _history_undo(food, user, msg):
    await food.async_undo_restore(user.id, msg["log_id"])


async def _history_delete(food, user, msg):
    await food.async_delete_log(user.id, msg["log_id"])


async def _min_qty(food, user, msg):
    p = food.product(msg["product_id"])
    return food.row_out("products", await food.async_save_product(user.id, {**p, "min_qty": msg["min_qty"]}))


async def _csv_import(food, user, msg):
    return {"count": await food.async_import_csv(user.id, msg["csv"], msg.get("storage_id"))}


async def _csv_export(food, user, msg):
    return {"csv": food.export_csv(user.id, msg.get("storage_id"))}


# ── AI ────────────────────────────────────────────────────────────────────────
async def _ai(food, user, msg):
    return await ai.async_run(food.hass, food, user, msg["feature"], msg.get("data") or {})


# ── Household settings (administrators) ──────────────────────────────────────
async def _settings_get(food, user, msg):
    from .notify import mobile_devices

    out: dict[str, Any] = {"is_admin": user.is_admin, "settings": food.settings if user.is_admin else food.public_settings(),
                           "users": await food.async_users(), "counts": {
                               "products": len(food.data["products"]), "items": len(food.data["items"]),
                               "storages": len(food.data["storages"]), "history": len(food.data["logs"])}}
    if user.is_admin:
        out["devices"] = [{"user_id": d["user_id"], "name": d["name"], "platform": d["platform"]} for d in mobile_devices(food.hass)]
        out["backups"] = await food.async_list_backups()
        out["ai_entities"] = ai.task_entities(food.hass)
        out["ai"] = ai.capabilities(food.hass, food)
        out["ai_memory"] = len(food.ai_cache)
    return out


async def _settings_set(food, user, msg):
    return await food.async_set_settings(msg["settings"])


async def _backup_now(food, user, msg):
    return {"name": await food.async_backup(), "backups": await food.async_list_backups()}


async def _restore(food, user, msg):
    await food.async_restore(msg["name"])


async def _report(food, user, msg):
    return await reports.async_report(food, user, msg["name"], msg.get("days"), msg.get("month"), msg.get("product_id"),
                                      msg.get("filter"), msg.get("since"), msg.get("until"), msg.get("year"))


async def _ai_clear(food, user, msg):
    await food.async_ai_cache_clear()
    return {"count": 0}


async def _info(food, user, msg):
    return {"info": await info.async_info(food.hass, food, msg["product_id"], bool(msg.get("refresh")))}


async def _ideas(food, user, msg):
    return {"ideas": await info.async_ideas(food.hass, food, msg["product_id"], msg["kind"])}


async def _photo_find(food, user, msg):
    return await info.async_find_photo(food, msg.get("name") or "", msg.get("product_id"))


async def _reset(food, user, msg):
    return {"backup": await food.async_reset(bool(msg.get("settings")))}


async def _photo_discard(food, user, msg):
    """A photo taken only to read a barcode: removed again unless a product uses it."""
    pid = msg["photo"]
    if not food._photo_in_use(pid):
        await food.async_drop_photo(pid)


def _keeper(food):
    keeper = food.hass.data.get(f"{DOMAIN}_photos")
    if not keeper:
        raise FoodError("not_ready", "Crow Food is still starting.")
    return keeper


async def _photos_stats(food, user, msg):
    return await _keeper(food).async_stats()


async def _photos_optimise(food, user, msg):
    keeper = _keeper(food)
    keeper.run(deadline=None, sweep=True)
    return await keeper.async_stats()


# ── Skins, adding a receipt's items, cheapest shops ─────────────────────────
async def _profile_set(food, user, msg):
    prof = food.data.setdefault("profiles", {}).setdefault(user.id, {})
    if "skin" in msg:
        prof["skin"] = str(msg["skin"] or "")[:30]
    food._save()
    return {"profile": prof}


async def _add_many(food, user, msg):
    return await food.async_add_many(user.id, msg["items"], msg.get("shop"), msg.get("shop_name") or "")


async def _receipt_prepare(food, user, msg):
    from . import receipts

    out = receipts.prepare(food, user.id, text=msg.get("text"), lines=msg.get("lines"),
                           shop_name=msg.get("shop_name") or "", receipt_total=float(msg.get("receipt_total") or 0))
    if not out["lines"] and msg.get("text"):
        out["chunks"] = receipts.chunks(msg["text"])   # a receipt the card couldn't follow: the AI lists it in pieces
    return out


async def _photo_choices(food, user, msg):
    from . import info as info_mod

    return await info_mod.async_photo_choices(food, msg.get("name") or "", msg.get("product_id"), msg.get("query"))


async def _photo_pick(food, user, msg):
    from . import info as info_mod

    return await info_mod.async_pick_photo(food, msg["choice"])


async def _health(food, user, msg):
    from . import health

    return await health.async_run(food)


async def _health_ai(food, user, msg):
    from . import health

    return await health.async_test_ai(food)


async def _cheapest(food, user, msg):
    return {"cheapest": food.cheapest()}


COMMANDS = [
    ws_subscribe,
    _simple("snapshot", {}, _snapshot),
    _simple("storage/save", {vol.Required("storage"): dict}, _storage_save),
    _simple("storage/delete", {vol.Required("storage_id"): str, vol.Optional("move_to"): vol.Any(None, str)}, _storage_delete),
    _simple("storage/reorder", {vol.Required("ids"): [str]}, _storage_reorder),
    _simple("simple/save", {vol.Required("kind"): vol.In(("shops", "categories")), vol.Required("row"): dict}, _simple_save),
    _simple("simple/delete", {vol.Required("kind"): vol.In(("shops", "categories")), vol.Required("row_id"): str}, _simple_delete),
    _simple("simple/reorder", {vol.Required("kind"): vol.In(("shops", "categories")), vol.Required("ids"): [str]}, _simple_reorder),
    _simple("product/save", {vol.Required("product"): dict}, _product_save),
    _simple("product/delete", {vol.Required("product_id"): str}, _product_delete),
    _simple("product/min_qty", {vol.Required("product_id"): str, vol.Required("min_qty"): vol.Coerce(float)}, _min_qty),
    _simple("lookup", {vol.Required("barcode"): str}, _lookup),
    _simple("item/save", {vol.Required("item"): dict}, _item_save),
    _simple("item/delete", {vol.Required("ids"): [str]}, _item_delete),
    _simple("item/consume", {vol.Required("item_id"): str, vol.Optional("qty"): vol.Any(None, vol.Coerce(float)),
                             vol.Optional("status"): vol.In(("consumed", "thrown"))}, _consume),
    _simple("item/move", {vol.Required("item_id"): str, vol.Required("storage_id"): str,
                          vol.Optional("qty"): vol.Any(None, vol.Coerce(float))}, _move),
    _simple("item/open", {vol.Required("item_id"): str, vol.Optional("opened"): bool}, _open),
    _simple("item/buy", {vol.Required("product_id"): str, vol.Optional("list_id"): vol.Any(None, str),
                         vol.Optional("qty"): vol.Coerce(float), vol.Optional("shop"): vol.Any(None, str)}, _buy),
    _simple("item/bought", {vol.Required("item_id"): str, vol.Optional("bought"): bool}, _bought),
    _simple("list/add_names", {vol.Required("names"): [str], vol.Optional("list"): vol.Any(None, str)}, _add_names),
    _simple("product/clear_min", {vol.Optional("ids"): vol.Any(None, [str])}, _clear_min),
    _simple("list/pick", {vol.Required("item_id"): str, vol.Optional("used"): bool}, _pick),
    _simple("list/put_away", {vol.Required("list_id"): str, vol.Optional("ids"): vol.Any(None, [str]),
                              vol.Optional("storage_id"): vol.Any(None, str)}, _put_away),
    _simple("product/keep", {vol.Required("ids"): [str]}, _keep),
    _simple("product/delete_many", {vol.Required("ids"): [str]}, _delete_many),
    _simple("product/restore", {vol.Required("products"): [dict]}, _restore_products),
    _simple("here", {vol.Required("path"): str}, _here),
    _simple("history", {vol.Optional("product_id"): vol.Any(None, str), vol.Optional("limit"): int,
                        vol.Optional("statuses"): vol.Any(None, [vol.In(("consumed", "thrown", "bought", "added", "moved", "picked"))]),
                        vol.Optional("before"): vol.Any(None, int), vol.Optional("query"): vol.Any(None, str)}, _history),
    _simple("history/restore", {vol.Required("log_id"): str, vol.Optional("storage_id"): vol.Any(None, str)}, _history_restore),
    _simple("history/undo_restore", {vol.Required("log_id"): str}, _history_undo),
    _simple("history/delete", {vol.Required("log_id"): str}, _history_delete),
    _simple("csv/import", {vol.Required("csv"): str, vol.Optional("storage_id"): vol.Any(None, str)}, _csv_import),
    _simple("csv/export", {vol.Optional("storage_id"): vol.Any(None, str)}, _csv_export),
    _simple("ai", {vol.Required("feature"): str, vol.Optional("data"): dict}, _ai),
    _simple("settings/get", {}, _settings_get),
    _simple("settings/set", {vol.Required("settings"): dict}, _settings_set, admin=True),
    _simple("backup/now", {}, _backup_now, admin=True),
    _simple("backup/restore", {vol.Required("name"): str}, _restore, admin=True),
    _simple("reset", {vol.Optional("settings"): bool}, _reset, admin=True),
    _simple("ai/clear", {}, _ai_clear, admin=True),
    _simple("report", {vol.Required("name"): vol.In(reports.NAMES), vol.Optional("days"): vol.Any(None, vol.All(int, vol.Range(min=1, max=800))),
                       vol.Optional("month"): vol.Any(None, str), vol.Optional("product_id"): vol.Any(None, str),
                       vol.Optional("filter"): vol.Any(None, dict), vol.Optional("since"): vol.Any(None, str),
                       vol.Optional("until"): vol.Any(None, str), vol.Optional("year"): vol.Any(None, vol.All(vol.Coerce(int), vol.Range(min=2000, max=2100)))}, _report),
    _simple("info/get", {vol.Required("product_id"): str, vol.Optional("refresh"): bool}, _info),
    _simple("info/ideas", {vol.Required("product_id"): str, vol.Required("kind"): vol.In(("serving", "cooking"))}, _ideas),
    _simple("photo/find", {vol.Optional("name"): vol.Any(None, str), vol.Optional("product_id"): vol.Any(None, str)}, _photo_find),
    _simple("photo/discard", {vol.Required("photo"): str}, _photo_discard),
    _simple("photos/stats", {}, _photos_stats, admin=True),
    _simple("photos/optimise", {}, _photos_optimise, admin=True),
    _simple("profile/set", {vol.Optional("skin"): vol.Any(None, str)}, _profile_set),
    _simple("items/add_many", {vol.Required("items"): [dict], vol.Optional("shop"): vol.Any(None, str),
                               vol.Optional("shop_name"): vol.Any(None, str)}, _add_many),
    _simple("shops/cheapest", {}, _cheapest),
    _simple("health", {}, _health),
    _simple("health/ai", {}, _health_ai),
    _simple("photo/choices", {vol.Optional("name"): vol.Any(None, str), vol.Optional("product_id"): vol.Any(None, str),
                              vol.Optional("query"): vol.Any(None, str)}, _photo_choices),
    _simple("photo/pick", {vol.Required("choice"): str}, _photo_pick),
    _simple("receipt/prepare", {vol.Optional("text"): vol.Any(None, str), vol.Optional("lines"): vol.Any(None, [dict]),
                                vol.Optional("shop_name"): vol.Any(None, str), vol.Optional("receipt_total"): vol.Any(None, vol.Coerce(float))},
            _receipt_prepare),
]


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in COMMANDS:
        websocket_api.async_register_command(hass, cmd)
