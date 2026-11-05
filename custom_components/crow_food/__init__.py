"""The Crow Food integration.

The household's food in Home Assistant: storages (Pantry, Fridge, Freezer...), shopping lists,
products with photos and barcodes, what's open, what's expiring and what's running low - with
phone notifications, sensors, optional to-do lists for Assist, and AI help.

The card ships inside the integration and is added to every dashboard automatically, so one
download installs both.
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_change
from homeassistant.loader import async_get_integration

from . import assist, notify, websocket
from .photos import PhotoKeeper
from .const import CARD_FILENAME, DOMAIN, KIND_LIST, KIND_STORAGE, LAZY_FILES, STATUS_CONSUMED, STATUS_THROWN
from .http import PhotoUploadView, PhotoView
from .store import CrowFood, FoodError

_LOGGER = logging.getLogger(__name__)

CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"
PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR, Platform.TODO]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

ADD_SCHEMA = vol.Schema({
    vol.Optional("name"): cv.string,
    vol.Optional("barcode"): cv.string,
    vol.Optional("storage"): cv.string,
    vol.Optional("quantity", default=1): vol.Coerce(float),
    vol.Optional("expires"): cv.string,
})
USE_SCHEMA = vol.Schema({
    vol.Required("name"): cv.string,
    vol.Optional("storage"): cv.string,
    vol.Optional("quantity"): vol.Coerce(float),
    vol.Optional("thrown_away", default=False): cv.boolean,
})
LIST_SCHEMA = vol.Schema({
    vol.Required("name"): cv.string,
    vol.Optional("list"): cv.string,
    vol.Optional("quantity", default=1): vol.Coerce(float),
})


async def _async_register_card(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_card_registered"):
        return
    www = Path(__file__).parent / "www"
    card_path = www / CARD_FILENAME
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(card_path), True)]
        + [StaticPathConfig(f"/{DOMAIN}/{name}", str(www / name), True) for name in LAZY_FILES.values()])
    integration = await async_get_integration(hass, DOMAIN)

    def _digests() -> tuple[str, dict[str, str]]:
        card = hashlib.sha1(card_path.read_bytes()).hexdigest()[:10]
        parts = {mod: hashlib.sha1((www / name).read_bytes()).hexdigest()[:10] if (www / name).exists() else "0"
                 for mod, name in LAZY_FILES.items()}
        return card, parts

    card_digest, digests = await hass.async_add_executor_job(_digests)
    # the cache-buster includes a fingerprint of the card itself, so any change reaches phones after a restart
    url = f"{CARD_URL}?v={integration.version}-{card_digest}"
    add_extra_js_url(hass, url)
    add_extra_js_url(hass, url, es5=True)
    hass.data[f"{DOMAIN}_modules"] = {mod: f"/{DOMAIN}/{name}?v={integration.version}-{digests[mod]}"
                                     for mod, name in LAZY_FILES.items()}
    hass.data[f"{DOMAIN}_card_registered"] = True


def _find_storage(food: CrowFood, name: str | None, kind: str) -> dict | None:
    rows = sorted((s for s in food.data["storages"].values() if s.get("kind") == kind), key=lambda s: s.get("sort", 0))
    if not name:
        return rows[0] if rows else None
    key = name.strip().lower()
    return next((s for s in rows if s["id"] == name or s["name"].lower() == key), None)


def _find_product(food: CrowFood, name: str | None, barcode: str | None) -> dict | None:
    if barcode:
        p = food.find_barcode(barcode)
        if p:
            return p
    key = (name or "").strip().lower()
    if not key:
        return None
    exact = next((p for p in food.data["products"].values() if p["name"].lower() == key), None)
    return exact or next((p for p in food.data["products"].values() if key in p["name"].lower()), None)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_register_card(hass)
    food = CrowFood(hass)
    await food.async_load()
    hass.data[DOMAIN] = food
    food.prime_watch()   # Ran Out and the running-low events start from what's there now

    if not hass.data.get(f"{DOMAIN}_views"):
        hass.http.register_view(PhotoView(hass))
        hass.http.register_view(PhotoUploadView(hass))
        websocket.async_register(hass)
        hass.data[f"{DOMAIN}_views"] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # photos made smaller overnight (01:30 to 03:30)
    keeper = PhotoKeeper(hass, food)
    hass.data[f"{DOMAIN}_photos"] = keeper
    for unsub in keeper.start():
        entry.async_on_unload(unsub)
    entry.async_on_unload(keeper.stop)
    # Crow Food for Assist: tools an AI agent can use (ticked in its settings), and quick phrases with no AI
    for undo in (assist.register_api(hass), assist.register_sentences(hass)):
        if undo:
            entry.async_on_unload(undo)

    # once: photos the old search found automatically (sometimes a brand's logo or a factory) are looked for again
    if not food.data.get("auto_photos_v2") and food.settings.get("photo_finder", True):
        from .info import async_recheck_auto_photos

        async def _recheck(_now=None) -> None:
            await async_recheck_auto_photos(food)

        from homeassistant.helpers.event import async_call_later

        entry.async_on_unload(async_call_later(hass, 90, lambda _n: hass.async_create_background_task(_recheck(), "crow_food photo recheck")))

    # the day's note to the people chosen in the editor, at the time chosen there
    @callback
    def _tick(now) -> None:
        if now.strftime("%H:%M") == food.settings.get("notify", {}).get("time", "09:00"):
            hass.async_create_task(notify.async_daily(hass, food))
            hass.async_create_task(notify.async_stale(hass, food))
            if now.month == 1 and now.day == 1:
                hass.async_create_task(notify.async_year(hass, food))

    entry.async_on_unload(async_track_time_change(hass, _tick, second=0))

    # buttons on Crow Food's notes (Add to Shopping…, Freeze them), sent back by the Companion app
    async def _note_action(event) -> None:
        await notify.async_action(hass, food, event)

    entry.async_on_unload(hass.bus.async_listen("mobile_app_notification_action", _note_action))

    # a copy of everything every night
    @callback
    def _backup(now) -> None:
        if food.settings.get("backups", {}).get("enabled", True):
            hass.async_create_task(food.async_backup())

    entry.async_on_unload(async_track_time_change(hass, _backup, hour=3, minute=40, second=0))

    # services, for automations and scripts
    async def svc_add(call: ServiceCall) -> dict:
        d = call.data
        st = _find_storage(food, d.get("storage"), KIND_STORAGE)
        if not st:
            raise HomeAssistantError(f"There's no storage called {d.get('storage')}.")
        p = _find_product(food, d.get("name"), d.get("barcode"))
        if not p:
            if not d.get("name"):
                raise HomeAssistantError("Give a name for a product Crow Food doesn't know yet.")
            p = await food.async_save_product(None, {"name": d["name"], "barcode": d.get("barcode", ""), "source": "service"})
        try:
            it = await food.async_save_item(None, {"product": p["id"], "storage": st["id"], "qty": d.get("quantity", 1),
                                                   "expires": d.get("expires")})
        except FoodError as err:
            raise HomeAssistantError(str(err)) from err
        return {"item": it["id"], "product": p["name"], "storage": st["name"]}

    async def svc_use(call: ServiceCall, thrown: bool | None = None) -> dict:
        d = call.data
        p = _find_product(food, d["name"], None)
        if not p:
            raise HomeAssistantError(f"Crow Food doesn't know {d['name']}.")
        st = _find_storage(food, d.get("storage"), KIND_STORAGE) if d.get("storage") else None
        items = sorted((i for i in food.data["items"].values() if i["product"] == p["id"]
                        and (food.data["storages"].get(i["storage"]) or {}).get("kind") == KIND_STORAGE
                        and (not st or i["storage"] == st["id"])),
                       key=lambda i: (not i.get("opened"), i.get("expires") or "9999"))
        if not items:
            raise HomeAssistantError(f"There's no {p['name']} left.")
        want = d.get("quantity")
        status = STATUS_THROWN if (thrown if thrown is not None else d.get("thrown_away")) else STATUS_CONSUMED
        used = 0.0
        for it in items:
            take = it["qty"] if want is None else min(it["qty"], want - used)
            if take <= 0:
                break
            await food.async_consume(None, it["id"], take, status)
            used += take
            if want is None or used >= want:
                break
        return {"product": p["name"], "used": used, "left": food.stock(p["id"])}

    async def svc_list(call: ServiceCall) -> dict:
        d = call.data
        lst = _find_storage(food, d.get("list"), KIND_LIST)
        if not lst:
            raise HomeAssistantError("There's no shopping list with that name.")
        p = _find_product(food, d["name"], None) or await food.async_save_product(None, {"name": d["name"], "source": "service"})
        it = await food.async_add_to_list(None, p["id"], lst["id"], d.get("quantity", 1))
        return {"item": it["id"], "product": p["name"], "list": lst["name"]}

    async def svc_notify(call: ServiceCall) -> None:
        await notify.async_daily(hass, food)
        await notify.async_stale(hass, food)

    async def svc_backup(call: ServiceCall) -> dict:
        return {"backup": await food.async_backup()}

    hass.services.async_register(DOMAIN, "add", svc_add, ADD_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "consume", svc_use, USE_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "add_to_shopping_list", svc_list, LIST_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "send_reminder", svc_notify)
    hass.services.async_register(DOMAIN, "backup", svc_backup, supports_response=SupportsResponse.OPTIONAL)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    food: CrowFood | None = hass.data.get(DOMAIN)
    if food:
        await food.async_flush()
    for svc in ("add", "consume", "add_to_shopping_list", "send_reminder", "backup"):
        hass.services.async_remove(DOMAIN, svc)
    if ok:
        hass.data.pop(DOMAIN, None)
    return ok
