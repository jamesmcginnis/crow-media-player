"""Health & Support: checks that what Crow Food relies on is there and still answers the way it expects.

Run by Home Assistant itself, because it's Home Assistant that looks things up for the card (Open Food Facts,
Wikipedia and the photo searches), keeps the files and sends the reminders. The card's editor adds the checks
that happen on the phone (the PDF tools, the camera, the microphone) and puts them together with these.

Each check gives a status: ok, slow, warn, changed (it answered, but not the way Crow Food expects, so Crow Food
may need an update), fail, or off (switched off or not used).
"""
from __future__ import annotations

import asyncio
import shutil
import time
from typing import Any, Awaitable, Callable

from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import ai
from .info import ServiceError, get_json, resting
from .store import CrowFood, FoodError

GROUP_HA = "Home Assistant"
GROUP_LOOKUPS = "Products & Photos (looked up by Home Assistant)"


def _get(o: Any, path: str) -> Any:
    for k in path.split("."):
        if o is None:
            return None
        o = o[int(k)] if isinstance(o, list) and k.isdigit() and int(k) < len(o) else (o.get(k) if isinstance(o, dict) else None)
    return o


async def _json(food: CrowFood, url: str, params: dict | None = None, service: str = "") -> Any:
    """Asked the same way Find Photos asks (tried twice), so a good answer here brings a resting service back."""
    return await get_json(async_get_clientsession(food.hass), service or url, url, params)


def _lookup(name: str, url: str, params: dict, need: list[str], on: Callable[[CrowFood], bool | str], service: str = "") -> dict:
    async def run(food: CrowFood) -> dict:
        j = await _json(food, url, params, service)
        return {"j": j, "need": need}
    return {"group": GROUP_LOOKUPS, "name": name, "on": on, "run": run}


def checks() -> list[dict]:
    async def ha(food: CrowFood) -> dict:
        from homeassistant.const import __version__ as v
        d = food.data
        return {"status": "ok", "note": f"Connected ({v}) · {len(d['products'])} products, {len(d['items'])} items, "
                                        f"{len(d['storages'])} storages and lists"}

    async def files(food: CrowFood) -> dict:
        def look() -> tuple[bool, int]:
            import os
            food.photos.mkdir(parents=True, exist_ok=True)
            return os.access(food.photos, os.W_OK), shutil.disk_usage(food.photos).free
        writable, free = await food.hass.async_add_executor_job(look)
        if not writable:
            return {"status": "fail", "note": "Crow Food can’t save photos: its folder is read-only"}
        gb = free / 1024 ** 3
        if gb < 0.5:
            return {"status": "warn", "note": f"Only {gb:.1f} GB free on Home Assistant’s disk"}
        return {"status": "ok", "note": f"Saving fine · {gb:.0f} GB free"}

    async def backups(food: CrowFood) -> dict:
        rows = await food.async_list_backups()
        if not rows:
            return {"status": "warn", "note": "No backups yet (the first is made overnight, or use Back Up Now)"}
        age = (time.time() * 1000 - max(int(r.get("ts") or 0) for r in rows)) / 3600000
        if age > 50:
            return {"status": "warn", "note": f"The newest backup is {age / 24:.0f} days old"}
        return {"status": "ok", "note": f"{len(rows)} kept · newest {age:.0f} hours ago"}

    async def reminders(food: CrowFood) -> dict:
        from .notify import mobile_devices
        users = (food.settings.get("notify") or {}).get("users") or []
        devices = {d["user_id"] for d in mobile_devices(food.hass)}
        without = [u for u in users if u not in devices]
        if without:
            return {"status": "warn", "note": f"{len(without)} of {len(users)} chosen people have no phone with the Home Assistant app"}
        return {"status": "ok", "note": f"{len(users)} {'person' if len(users) == 1 else 'people'}, each with a phone"}

    async def todo(food: CrowFood) -> dict:
        from homeassistant.helpers import entity_registry as er
        from .const import DOMAIN
        n = len([e for e in er.async_get(food.hass).entities.values() if e.platform == DOMAIN and e.domain == "todo"])
        return {"status": "ok" if n else "warn", "note": f"{n} shopping list{'' if n == 1 else 's'} in Home Assistant" if n else "None found yet"}

    async def ai_task(food: CrowFood) -> dict:
        ent = ai.task_entity(food.hass, food)
        if not ent:
            chosen = (food.settings.get("ai") or {}).get("task_entity")
            return {"status": "fail", "note": "The chosen AI Task no longer exists" if chosen else
                    "No AI Task: choose one on the AI page, or set Home Assistant’s own in Settings"}
        name = (food.hass.states.get(ent).attributes.get("friendly_name") if food.hass.states.get(ent) else None) or ent
        if not ai.supports_photos(food.hass, ent):
            return {"status": "warn", "note": f"{name} found, but it can’t look at photos (Photo to Product and receipt photos won’t work). Use Test AI to check it answers"}
        return {"status": "ok", "note": f"{name} found, and it can look at photos (use Test AI to check it answers)"}

    async def assist_check(food: CrowFood) -> dict:
        from homeassistant.helpers import llm
        from .const import DOMAIN
        hass = food.hass
        offered = any(a.id == DOMAIN for a in llm.async_get_apis(hass))
        # which Assist agents have Crow Food ticked (Control Home Assistant), in their settings or their parts
        agents = []
        for entry in hass.config_entries.async_entries():
            places = [(entry.title, entry.options)] + [(sub.title, sub.data) for sub in (getattr(entry, "subentries", None) or {}).values()]
            for title, data in places:
                apis = data.get("llm_hass_api") if isinstance(data, dict) or hasattr(data, "get") else None
                if apis and DOMAIN in (apis if isinstance(apis, list) else [apis]):
                    agents.append(title)
        tools = ai.tools_supported()
        if not offered:
            return {"status": "warn", "note": "Crow Food’s AI tools aren’t offered to Assist (restart Home Assistant)"}
        bits = [f"Ticked in {', '.join(agents[:3])}" if agents else
                "Not ticked in any Assist agent yet (Settings → Voice assistants → your agent → Control Home Assistant)",
                "Ask AI on the card uses the tools too" if tools else "Ask AI uses a smaller list instead (Home Assistant too old for tools in AI Tasks)",
                "Quick phrases like “Do we have tuna?” work in Assist without AI"]
        return {"status": "ok" if agents else "warn", "note": " · ".join(bits)}

    async def off_search(food: CrowFood) -> dict:
        """The newer search (Search-a-licious), or the older one when that's busy: packet photos work if either does."""
        try:
            j = await _json(food, "https://search.openfoodfacts.org/search", {"q": "Nutella", "langs": "en", "page_size": "1",
                                                                              "fields": "code,product_name"}, "off_search")
            return {"j": j, "need": ["hits.0.code"]}
        except ServiceError as new_err:
            try:
                j = await _json(food, "https://world.openfoodfacts.org/cgi/search.pl",
                                {"search_terms": "Nutella", "search_simple": "1", "action": "process", "json": "1", "page_size": "1",
                                 "fields": "product_name,image_front_url"}, "off_old")
            except ServiceError:
                raise new_err from None
            if not _get(j, "products.0.image_front_url"):
                raise new_err from None
            return {"status": "ok", "note": f"Working, using the older search (the newer one answered {new_err})"}

    def off_on(food: CrowFood) -> bool | str:
        return food.settings.get("openfoodfacts", True) is not False or "Open Food Facts is off"

    def photos_on(food: CrowFood) -> bool | str:
        return food.settings.get("photo_finder", True) is not False or "Find Photos is off"

    return [
        {"id": "ha", "group": GROUP_HA, "name": "Crow Food", "run": ha},
        {"id": "files", "group": GROUP_HA, "name": "Files and photos", "run": files},
        {"id": "backups", "group": GROUP_HA, "name": "Backups",
         "on": lambda f: (f.settings.get("backups") or {}).get("enabled", True) is not False or "Backups are off", "run": backups},
        {"id": "reminders", "group": GROUP_HA, "name": "Reminders",
         "on": lambda f: bool((f.settings.get("notify") or {}).get("users")) or "Nobody chosen", "run": reminders},
        {"id": "todo", "group": GROUP_HA, "name": "Shopping lists as to-do lists",
         "on": lambda f: bool(f.settings.get("todo_lists")) or "Off", "run": todo},
        {"id": "ai", "group": GROUP_HA, "name": "AI Task",
         "on": lambda f: bool((f.settings.get("ai") or {}).get("enabled")) or "AI Features are off", "run": ai_task},
        {"id": "assist", "group": GROUP_HA, "name": "Crow Food for Assist", "run": assist_check},
        {"id": "off_barcode", **_lookup("Open Food Facts (barcodes)", "https://world.openfoodfacts.org/api/v2/product/3017620422003.json",
                                        {"fields": "product_name,image_front_url,quantity"}, ["product.product_name", "product.image_front_url"], off_on, "off_barcode")},
        {"id": "off_search", "group": GROUP_LOOKUPS, "name": "Open Food Facts (packet photos)", "run": off_search,
         "on": lambda f: (f.settings.get("openfoodfacts", True) is not False and f.settings.get("photo_finder", True) is not False)
         or "Open Food Facts or Find Photos is off"},
        {"id": "wiki", **_lookup("Wikipedia (pictures of food)", "https://en.wikipedia.org/w/api.php",
                                 {"action": "query", "generator": "search", "gsrsearch": "Cheddar cheese", "gsrlimit": "1", "prop": "pageimages",
                                  "piprop": "thumbnail", "pithumbsize": "200", "format": "json"}, ["query.pages"], photos_on, "wiki")},
        {"id": "commons", **_lookup("Wikimedia Commons (photos)", "https://commons.wikimedia.org/w/api.php",
                                    {"action": "query", "generator": "search", "gsrsearch": "filetype:bitmap cheddar", "gsrnamespace": "6", "gsrlimit": "1",
                                     "prop": "imageinfo", "iiprop": "url", "iiurlwidth": "200", "format": "json"}, ["query.pages"], photos_on, "commons")},
        {"id": "openverse", **_lookup("Openverse (photos)", "https://api.openverse.org/v1/images/", {"q": "cheddar", "page_size": "1"},
                                      ["results.0.url"], photos_on, "openverse")},
    ]


def _clock(ts: float) -> str:
    from datetime import datetime
    from homeassistant.util import dt as dt_util
    return dt_util.as_local(datetime.fromtimestamp(ts, dt_util.UTC)).strftime("%H:%M")


async def async_run(food: CrowFood) -> dict:
    """Every check at once; the answers in the order they're listed."""
    async def one(c: dict) -> dict:
        row = {"id": c["id"], "group": c["group"], "name": c["name"]}
        on = c["on"](food) if c.get("on") else True
        if on is not True:
            return {**row, "status": "off", "note": on or "Off"}
        t0 = time.monotonic()
        try:
            async with asyncio.timeout(40):
                v = await c["run"](food)
        except TimeoutError:
            return {**row, "status": "fail", "note": "No answer within 40 seconds"}
        except ServiceError as err:
            st = err.status
            if st and (st >= 500 or st == 429):
                # their side, not something to fix here: Crow Food tries again, and uses the other sources meanwhile
                back = resting(c.get("service") or c["id"])
                when = f": Find Photos leaves it out until {_clock(back)}" if back else ""
                return {**row, "status": "warn", "note": f"Busy on their side right now (HTTP {st}), try again later{when}"}
            if st:
                return {**row, "status": "fail", "note": f"Answered with an error (HTTP {st})"}
            return {**row, "status": "fail", "note": f"Not reachable from Home Assistant ({err})"}
        except FoodError as err:
            st = getattr(err, "status", None)
            return {**row, "status": "fail", "note": "Busy (too many requests): try again in a minute" if st == 429
                    else f"Answered with an error (HTTP {st})" if st else str(err)}
        except Exception as err:  # noqa: BLE001 - offline, DNS, anything
            return {**row, "status": "fail", "note": f"Not reachable from Home Assistant ({type(err).__name__})"}
        ms = (time.monotonic() - t0) * 1000
        status, note = v.get("status"), v.get("note")
        if not status:
            miss = [p for p in v.get("need") or [] if _get(v.get("j"), p) in (None, "", [], {})]
            if miss:
                status, note = "changed", f"Its answer has changed (missing {', '.join(miss)}): Crow Food may need an update"
            else:
                status, note = ("slow" if ms > 5000 else "ok"), "Working"
        if status in ("ok", "slow") and ms >= 50:
            note = f"{note} ({ms / 1000:.1f}s)"
        return {**row, "status": status, "note": note, "ms": round(ms)}

    rows = await asyncio.gather(*(one(c) for c in checks()))
    return {"at": int(time.time() * 1000), "rows": list(rows)}


async def async_test_ai(food: CrowFood) -> dict:
    """Asks the AI a tiny question (it uses a little of its allowance) and says how it went."""
    if not (food.settings.get("ai") or {}).get("enabled"):
        return {"status": "off", "note": "AI Features are off"}
    t0 = time.monotonic()
    try:
        text = await ai._task(food.hass, food, "Crow Food: test", "Reply with the single word OK and nothing else.", timeout=30)
    except FoodError as err:
        return {"status": "fail", "note": str(err)}
    secs = time.monotonic() - t0
    odd = "" if "ok" in str(text).lower() else f" (with an unexpected reply: “{str(text)[:60]}”)"
    return {"status": "slow" if secs > 8 else "ok", "note": f"Answered in {secs:.1f}s{odd}"}
