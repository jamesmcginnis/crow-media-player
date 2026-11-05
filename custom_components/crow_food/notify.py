"""Phone notifications (Home Assistant Companion app): a daily note about food that's expiring,
expired or running low, sent to the people chosen in the card editor.

Each Companion app install is a mobile_app config entry that records the user who signed in on it,
which is how a note for a person reaches only their phones.

Notes carry their own buttons (shown when you press and hold on an iPhone, or under the note on Android):
* Add to Shopping… - type something into the note and it goes on the Shopping list (every note)
* Freeze them - moves what should be frozen today into the freezer (the daily note, when there's something)
* Meal ideas - opens Use It Up on the card (the daily note, when Use It Up is on and things need using)
"""
from __future__ import annotations

import logging
import re
from typing import Any

from homeassistant.core import Event, HomeAssistant
from homeassistant.util import slugify

from .const import DOMAIN, NAME
from .store import CrowFood

_LOGGER = logging.getLogger(__name__)

ACTION_ADD = "CROW_FOOD_ADD"
ACTION_FREEZE = "CROW_FOOD_FREEZE"


def mobile_devices(hass: HomeAssistant) -> list[dict[str, Any]]:
    out = []
    for entry in hass.config_entries.async_entries("mobile_app"):
        data = entry.data
        name = data.get("device_name") or entry.title or ""
        service = f"mobile_app_{slugify(name)}"
        os_name = str(data.get("os_name") or "").lower()
        platform = "ios" if os_name in ("ios", "ipados", "macos", "watchos", "visionos") else "android"
        out.append({"service": service, "name": name, "user_id": data.get("user_id"), "platform": platform,
                    "available": hass.services.has_service("notify", service)})
    return out


def dashboard_path(food: CrowFood, uid: str) -> str:
    """The dashboard chosen in the editor, or - when it's left on Automatic - wherever this person last
    opened the card."""
    chosen = str(food.settings.get("notify", {}).get("path") or "").split("?")[0].strip().strip("/")
    if chosen:
        return f"/{chosen}"
    return food.data.get("auto_paths", {}).get(uid) or "/lovelace/0"


def _shopping(food: CrowFood) -> dict | None:
    return next((s for s in food.data["storages"].values() if s.get("builtin") == "shopping"), None)


def add_action(food: CrowFood) -> dict | None:
    """Add to Shopping…: type into the note, and it goes on the Shopping list."""
    shop = _shopping(food)
    if not shop:
        return None
    return {"action": ACTION_ADD, "title": f"Add to {shop.get('name') or 'Shopping'}…", "behavior": "textInput",
            "textInputButtonTitle": "Add", "textInputPlaceholder": "Milk, bread"}


async def async_send(hass: HomeAssistant, uids: list[str], title: str, message: str, tag: str,
                     food: CrowFood | None = None, open_view: str | None = None, actions: list[dict] | None = None) -> int:
    sent = 0
    for d in mobile_devices(hass):
        if d["user_id"] not in uids or not d["available"]:
            continue
        data: dict[str, Any] = {"tag": f"{DOMAIN}_{tag}", "group": DOMAIN}
        if food and open_view:
            # tapping the note opens the card on that page
            link = f"{dashboard_path(food, d['user_id'])}?crow_food={open_view}"
            data["url"] = link
            data["clickAction"] = link
        if actions:
            # buttons; one that opens a page of the card ("open") gets this person's dashboard
            out = []
            for a in actions[:3]:
                a = dict(a)
                if food and a.get("open"):
                    a = {"action": "URI", "title": a["title"], "uri": f"{dashboard_path(food, d['user_id'])}?crow_food={a.pop('open')}"}
                out.append(a)
            data["actions"] = out
        if d["platform"] == "ios":
            data["push"] = {"interruption-level": "active", "thread-id": DOMAIN}
        else:
            data["channel"] = NAME
        try:
            await hass.services.async_call("notify", d["service"], {"title": title, "message": message, "data": data},
                                           blocking=False)
            sent += 1
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Crow Food couldn't notify %s: %s", d["service"], err)
    return sent


def _names(food: CrowFood, items: list[dict], limit: int = 4) -> str:
    names = []
    for it in items:
        n = food.name_of(it)
        if n not in names:
            names.append(n)
    shown = ", ".join(names[:limit])
    return shown + (f" and {len(names) - limit} more" if len(names) > limit else "")


def daily_message(food: CrowFood) -> tuple[str, str] | None:
    """The day's note, or None when there's nothing to say."""
    opts = food.settings.get("notify", {})
    smart = food.smart(None)
    lines = []
    if opts.get("expired", True) and smart["expired"]:
        n = len(smart["expired"])
        lines.append(f"{n} {'thing has' if n == 1 else 'things have'} expired: {_names(food, smart['expired'])}.")
    if opts.get("expiring", True) and smart["soon"]:
        n = len(smart["soon"])
        lines.append(f"{n} {'thing expires' if n == 1 else 'things expire'} soon: {_names(food, smart['soon'])}.")
    if opts.get("freeze", True):
        fz = food.freeze_today()
        if fz:
            lines.append(f"Freeze today? {_names(food, fz)} {'goes' if len(fz) == 1 else 'go'} off soon and freeze{'s' if len(fz) == 1 else ''} well.")
    if opts.get("low_stock") and smart["low"]:
        names = [x["name"] for x in smart["low"]]
        more = f" and {len(names) - 4} more" if len(names) > 4 else ""
        lines.append(f"Running low: {', '.join(names[:4])}{more}.")
    if not lines:
        return None
    title = "Use these soon" if (smart["soon"] or smart["expired"]) and (opts.get("expiring", True) or opts.get("expired", True)) else NAME
    return title, " ".join(lines)


async def async_daily(hass: HomeAssistant, food: CrowFood) -> int:
    uids = food.settings.get("notify", {}).get("users") or []
    if not uids:
        return 0
    msg = daily_message(food)
    if not msg:
        return 0
    return await async_send(hass, uids, msg[0], msg[1], "daily", food, None, daily_actions(food))


def daily_actions(food: CrowFood) -> list[dict]:
    """The daily note's buttons: Freeze them (when something should be frozen today), Meal ideas (when Use It Up
    is on and things need using) and Add to Shopping…"""
    from .ai import feature_on
    opts = food.settings.get("notify", {})
    out: list[dict] = []
    if opts.get("freeze", True) and food.freeze_today():
        # it changes what's at home, so an iPhone asks to be unlocked first
        out.append({"action": ACTION_FREEZE, "title": "Freeze them", "authenticationRequired": True})
    smart = food.smart(None)
    if feature_on(food, "use_up") and (smart["soon"] or smart["expired"]):
        out.append({"open": "useup", "title": "Meal ideas"})
    add = add_action(food)
    if add:
        out.append(add)
    return out


def _split_names(text: str) -> list[str]:
    """ "milk, bread and 2 onions" -> the three things (a number at the front is left on the name) """
    parts = re.split(r"\s*(?:,|;|\n|\band\b|&|\+)\s*", str(text or ""), flags=re.I)
    return [p.strip(" .") for p in parts if p.strip(" .")][:10]


def _list_words(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


async def async_action(hass: HomeAssistant, food: CrowFood, event: Event) -> None:
    """A button pressed on one of Crow Food's notes (the Companion app sends it as an event)."""
    action = event.data.get("action")
    if action not in (ACTION_ADD, ACTION_FREEZE):
        return
    users = food.settings.get("notify", {}).get("users") or []
    # the phone's own person (the Companion app sends its button presses as them); otherwise whoever gets the notes
    uid = event.context.user_id if event.context and event.context.user_id else (users[0] if users else None)
    if not uid:
        return
    if action == ACTION_ADD:
        names = _split_names(event.data.get("reply_text") or event.data.get("textInput") or "")
        if not names:
            return
        from .assist import add_to_list
        shop = _shopping(food)
        added, list_name = [], (shop or {}).get("name")
        for n in names:
            r = await add_to_list(food, uid, n, list_name, 1)
            if r.get("added"):
                added.append(r["added"])
                list_name = r.get("list") or list_name
        if added:
            await async_send(hass, [uid], f"Added to {list_name}", f"{_list_words(added)} {'is' if len(added) == 1 else 'are'} on the {list_name} list.",
                             "added", food, f"storage:{shop['id']}" if shop else None, [a for a in [add_action(food)] if a])
        return
    # Freeze them: what should be frozen today, into the first freezer
    items = food.freeze_today(uid)
    vis = food.visible_storages(uid)
    freezers = sorted((s for s in vis.values() if s.get("kind") == "storage" and food._is_freezer(s["id"])), key=lambda s: s.get("sort", 0))
    if not items or not freezers:
        await async_send(hass, [uid], NAME, "Nothing needs freezing now.", "frozen", food)
        return
    target, moved = freezers[0], []
    for it in items:
        try:
            await food.async_move(uid, it["id"], target["id"])
            moved.append(food.name_of(it))
        except Exception as err:  # noqa: BLE001 - changed or used since the note
            _LOGGER.debug("Crow Food couldn't freeze %s: %s", it.get("id"), err)
    if moved:
        names = list(dict.fromkeys(moved))
        await async_send(hass, [uid], "Frozen", f"{_list_words(names)} {'is' if len(names) == 1 else 'are'} in the {target['name']} now.",
                         "frozen", food, f"storage:{target['id']}")


def _months(n: int) -> str:
    return {12: "a year", 24: "two years"}.get(n, f"{n} months" if n != 1 else "a month")


async def async_stale(hass: HomeAssistant, food: CrowFood) -> int:
    """A note when more products reach Not Bought Lately (not every day: only when there are new ones)."""
    opts = food.settings.get("notify", {})
    stale = food.stale()
    ids = [p["id"] for p in stale]
    told = set(food.data.get("stale_notified") or [])
    new = [i for i in ids if i not in told]
    # products that left the list (bought again, kept or deleted) can be told about again later
    food.data["stale_notified"] = [i for i in ids if i in told or i in new]
    food._save()
    uids = opts.get("users") or []
    if not new or not uids or opts.get("stale", True) is False:
        return 0
    n = len(ids)
    months = int(food.settings.get("stale_months", 6) or 6)
    names = ", ".join(p["name"] for p in stale[:3]) + (f" and {n - 3} more" if n > 3 else "")
    msg = (f"{n} {'product hasn’t' if n == 1 else 'products haven’t'} been bought for {_months(months)}: {names}. "
           "Tap to review them.")
    return await async_send(hass, uids, "Not bought lately", msg, "stale", food, "review", [a for a in [add_action(food)] if a])


async def async_year(hass: HomeAssistant, food: CrowFood) -> int:
    """On 1 January: last year's Year in Food is ready (tapping it opens the report)."""
    opts = food.settings.get("notify", {})
    uids = opts.get("users") or []
    if not uids or opts.get("year", True) is False:
        return 0
    from homeassistant.util import dt as dt_util
    from .reports import _Ctx, r_year
    year = dt_util.now().year - 1
    sent = 0
    for uid in uids:
        y = r_year(_Ctx(food, uid, None), year)
        if not (y["used"] or y["thrown"] or y["bought"]):
            continue
        bits = [f"{y['used']} things used", f"{y['waste_share']:g}% thrown away"]
        if y.get("top_used"):
            bits.append(f"top of the list: {y['top_used'][0]['name']}")
        sent += await async_send(hass, [uid], f"Your {year} in Food", "; ".join(bits).capitalize() + ". Tap to see your year.",
                                 "year", food, "year", [a for a in [add_action(food)] if a])
    return sent
