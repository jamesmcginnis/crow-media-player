"""Crow Food's data: storages, shopping lists, products, the items in them, and their history.

Everything is kept in Home Assistant (/config/.storage/crow_food.data), with product photos in
/config/crow_food/photos. Every card on every dashboard and phone gets the same data over the
websocket and is told about each change as it happens, so they all stay in step.

* a **storage** is a place food is kept (Pantry, Fridge, Freezer, a box in the garage...); storages
  can sit inside other storages
* a **shopping list** is the same kind of thing, with kind "list"
* a **product** is something you buy (its name, barcode, photo, category, package size...)
* an **item** is some of a product in a storage or on a shopping list (how much, when it expires,
  when it was opened...)

Storages and lists are shared with the whole household unless someone limits one to certain people.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
import copy
import csv
import hashlib
import hmac
import io
import json
import logging
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    BACKUPS_DIR, DATA_DIR_NAME, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, DEFAULT_STORAGES, DOMAIN,
    EVENT_BACK_IN_STOCK, EVENT_CHANGED, EVENT_RUNNING_LOW, KIND_LIST, KIND_STORAGE, MAX_LOGS, MAX_NESTING, PHOTOS_DIR, RESTORE_DAYS, SIGNAL_UPDATE,
    STATUS_ADDED, STATUS_BOUGHT, STATUS_CONSUMED, STATUS_MOVED, STATUS_PICKED, STATUS_THROWN,
    PURPOSE_BUY, PURPOSES, STORAGE_KEY_DATA,
    STORAGE_KEY_AI_CACHE, STORAGE_KEY_HISTORY, STORAGE_KEY_SETTINGS, STORAGE_VERSION, AI_CACHE_MAX,
)

_LOGGER = logging.getLogger(__name__)

KINDS = ("storages", "shops", "categories", "products", "items")
# what a history entry keeps of an item, so Restore can put it back as it was
SNAP_FIELDS = ("expires", "stored", "opened", "note", "content", "content_unit", "shop", "created", "by")
EPS = 1e-6
# photos: WebP at quality 82; products don't need more than 1200px
PHOTO_SIDE = 1200
THUMB_SIDE = 240
WEBP_QUALITY = 82


class FoodError(Exception):
    """Something the card should show as a message (not a bug)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def now_ms() -> int:
    return int(time.time() * 1000)


def today() -> str:
    return dt_util.now().date().isoformat()


def _date(value: Any) -> str | None:
    """A date as YYYY-MM-DD, or None."""
    if value in (None, "", 0):
        return None
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()[:10]
    return text if re.match(r"^\d{4}-\d{2}-\d{2}$", text) else None


def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if out == out and abs(out) < 1e9 else default  # not NaN, not silly


def _str(value: Any, limit: int = 200) -> str:
    return str(value or "").strip()[:limit]


def _strip_tags(data: dict) -> bool:
    """Tags aren't used any more: takes any off the products (old data and backups). True if there were some."""
    found = False
    for prod in (data.get("products") or {}).values():
        if "tags" in prod:
            prod.pop("tags", None)
            found = True
    return found


def _merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in (patch or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def empty_data() -> dict:
    data: dict[str, Any] = {k: {} for k in KINDS}
    data["logs"] = []
    data["photos"] = {}
    data["photo_stats"] = {}
    data["secret"] = secrets.token_hex(16)
    for i, s in enumerate(DEFAULT_STORAGES):
        sid = new_id()
        data["storages"][sid] = {"id": sid, "parent": None, "users": [], "owner": None, "sort": i, "created": now_ms(),
                                 "modified": now_ms(), **s}
    for i, name in enumerate(DEFAULT_CATEGORIES):
        cid = new_id()
        data["categories"][cid] = {"id": cid, "name": name, "sort": i}
    return data


def _ensure_builtins(data: dict) -> bool:
    """Every household has a Shopping list and a Basket, which can't be changed or deleted. An existing list
    with the name becomes it; otherwise it's made."""
    storages = data["storages"]
    changed = False
    for spec in DEFAULT_STORAGES:
        key = spec.get("builtin")
        if not key or any(s.get("builtin") == key for s in storages.values()):
            continue
        lists = sorted((s for s in storages.values() if s.get("kind") == KIND_LIST and not s.get("builtin")),
                       key=lambda s: s.get("sort", 0))
        name = lambda s: (s.get("name") or "").strip().lower()
        if key == "shopping":
            found = next((s for s in lists if name(s) == "shopping"), None)
        else:
            found = next((s for s in lists if name(s) in ("basket", "shopping basket")), None) or \
                next((s for s in lists if "basket" in name(s)), None)
        if found:
            found.update({"builtin": key, "purpose": spec["purpose"], "parent": None, "modified": now_ms()})
        else:
            sid = new_id()
            storages[sid] = {"id": sid, "parent": None, "users": [], "owner": None, "sort": len(storages),
                             "created": now_ms(), "modified": now_ms(), **spec}
        changed = True
    return changed


class CrowFood:
    """The household's food: kept in Home Assistant and shared with every card."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY_DATA, private=True, atomic_writes=True)
        self._settings_store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY_SETTINGS, private=True, atomic_writes=True)
        self._history_store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY_HISTORY, private=True, atomic_writes=True)
        self._ai_store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY_AI_CACHE, private=True, atomic_writes=True)
        self.ai_cache: dict[str, dict] = {}
        # restored history entries, kept for a few minutes so Undo can put them back exactly as they were
        self._restored: dict[str, dict] = {}
        self.last_log_id: str | None = None
        self.data: dict[str, Any] = {}
        self.settings: dict[str, Any] = copy.deepcopy(DEFAULT_SETTINGS)
        self.base = Path(hass.config.path(DATA_DIR_NAME))
        self.photos = self.base / PHOTOS_DIR
        self.backups = self.base / BACKUPS_DIR
        # (user id, function) for every card that's listening
        self._subs: list[tuple[str, Callable[[dict], None]]] = []
        self._lock = asyncio.Lock()

    # ── Loading and saving ─────────────────────────────────────────────────────
    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if not stored:
            stored = empty_data()
            self._store.async_delay_save(lambda: self.data, 1)
        for k in KINDS:
            stored.setdefault(k, {})
        stored.setdefault("logs", [])
        stored.setdefault("photos", {})
        stored.setdefault("photo_stats", {})
        stored.setdefault("auto_paths", {})
        stored.setdefault("stale_notified", [])
        stored.setdefault("runouts", [])   # when each product ran out at home, and when it came back (Ran Out)
        stored.setdefault("runouts_since", today())
        stored.setdefault("secret", secrets.token_hex(16))
        untagged = _strip_tags(stored)
        builtins = _ensure_builtins(stored)
        self.ai_cache = (await self._ai_store.async_load() or {}).get("answers") or {}
        history = await self._history_store.async_load()
        moved = False
        if history is None:
            # first start with the history in its own file: move it out of the main file
            history = {"logs": stored.get("logs") or []}
            moved = True
        stored["logs"] = history.get("logs") or []
        self.data = stored
        self.index_bought()
        settings = await self._settings_store.async_load() or {}
        self.settings = _merge(DEFAULT_SETTINGS, settings)
        if not self.settings.get("history_v"):
            # history used to be kept forever by default; now two years
            if not settings.get("history_days"):
                self.settings["history_days"] = DEFAULT_SETTINGS["history_days"]
            self.settings["history_v"] = 1
            await self._settings_store.async_save(self.settings)
        if self._trim_logs() or moved or untagged or builtins:
            await self._history_store.async_save(self._history_out())
            await self._store.async_save(self._data_out())
        await self.hass.async_add_executor_job(self._make_dirs)

    def _make_dirs(self) -> None:
        self.photos.mkdir(parents=True, exist_ok=True)
        self.backups.mkdir(parents=True, exist_ok=True)

    def _data_out(self) -> dict:
        """Everything but the history, which has its own file."""
        return {k: v for k, v in self.data.items() if k != "logs"}

    def _history_out(self) -> dict:
        return {"logs": self.data.get("logs") or []}

    def _save(self) -> None:
        self._store.async_delay_save(self._data_out, 2)

    def _save_history(self) -> None:
        self._history_store.async_delay_save(self._history_out, 5)

    def _trim_logs(self) -> bool:
        """Drops history older than the chosen time (and keeps it under the size limit)."""
        logs = self.data.get("logs") or []
        before = len(logs)
        days = int(self.settings.get("history_days") or 0)
        if days:
            cut = now_ms() - days * 86400000
            if logs and logs[0].get("ts", 0) < cut:
                logs = [x for x in logs if x.get("ts", 0) >= cut]
        if len(logs) > MAX_LOGS:
            logs = logs[-MAX_LOGS:]
        self.data["logs"] = logs
        return len(logs) != before

    # ── AI memory ──────────────────────────────────────────────────────────────
    def ai_cache_get(self, key: str, max_age_ms: int | None, fp: str = "") -> dict | None:
        """A kept answer: still fresh, and asked about the same things (fp). None if there isn't one."""
        hit = self.ai_cache.get(key)
        if not hit or hit.get("fp", "") != fp:
            return None
        if max_age_ms is not None and now_ms() - int(hit.get("ts") or 0) > max_age_ms:
            return None
        return hit

    def ai_cache_put(self, key: str, value: Any, fp: str = "") -> int:
        ts = now_ms()
        self.ai_cache[key] = {"ts": ts, "fp": fp, "v": value}
        if len(self.ai_cache) > AI_CACHE_MAX:
            for old in sorted(self.ai_cache, key=lambda k: self.ai_cache[k].get("ts", 0))[: len(self.ai_cache) - AI_CACHE_MAX]:
                self.ai_cache.pop(old, None)
        self._ai_store.async_delay_save(lambda: {"answers": self.ai_cache}, 10)
        return ts

    async def async_ai_cache_clear(self) -> None:
        self.ai_cache = {}
        await self._ai_store.async_save({"answers": {}})

    async def async_flush(self) -> None:
        await self._ai_store.async_save({"answers": self.ai_cache})
        await self._store.async_save(self._data_out())
        await self._history_store.async_save(self._history_out())
        await self._settings_store.async_save(self.settings)

    # ── Settings ───────────────────────────────────────────────────────────────
    async def async_set_settings(self, patch: dict) -> dict:
        self.settings = _merge(self.settings, patch or {})
        s = self.settings
        s["soon_days"] = max(0, min(60, int(_num(s.get("soon_days"), 3))))
        s["stale_months"] = max(0, min(60, int(_num(s.get("stale_months"), 6))))
        s["history_days"] = max(0, int(_num(s.get("history_days"), 730)))
        s["backups"]["keep"] = max(1, min(60, int(_num(s["backups"].get("keep"), 7))))
        if not re.match(r"^\d{2}:\d{2}$", str(s["notify"].get("time") or "")):
            s["notify"]["time"] = "09:00"
        await self._settings_store.async_save(self.settings)
        if self._trim_logs():
            self._save_history()
            self.history_changed()
            self.stats_changed()
        self._broadcast_all({"type": "settings", "settings": self.public_settings()})
        async_dispatcher_send(self.hass, SIGNAL_UPDATE, "settings")
        return self.settings

    def public_settings(self) -> dict:
        """What every card needs to know (not who gets notifications or which AI is used)."""
        return {"soon_days": self.settings.get("soon_days", 3), "currency": self.settings.get("currency") or "",
                "stale_months": self.settings.get("stale_months", 6),
                "openfoodfacts": self.settings.get("openfoodfacts", True), "todo_lists": bool(self.settings.get("todo_lists")),
                "photo_finder": self.settings.get("photo_finder", True) is not False}

    # ── Listening cards ─────────────────────────────────────────────────────────
    @callback
    def subscribe(self, uid: str, send: Callable[[dict], None]) -> Callable[[], None]:
        entry = (uid, send)
        self._subs.append(entry)

        @callback
        def remove() -> None:
            if entry in self._subs:
                self._subs.remove(entry)

        return remove

    def _broadcast_all(self, payload: dict) -> None:
        for _uid, send in list(self._subs):
            try:
                send(payload)
            except Exception:  # noqa: BLE001 - a card that went away
                pass

    def _stock_all(self) -> dict[str, float]:
        out: dict[str, float] = defaultdict(float)
        for i in self.data["items"].values():
            if (self.data["storages"].get(i.get("storage")) or {}).get("kind") == KIND_STORAGE and i.get("product"):
                out[i["product"]] += float(i.get("qty") or 0)
        return out

    def prime_watch(self) -> None:
        """What's in stock and what's low at start-up, so the first change after a restart is noticed."""
        now = self._stock_all()
        self._stock_seen = dict(now)
        self._low_seen = None
        self._watch_low(now)

    def _watch_low(self, now: dict[str, float]) -> None:
        """Events for automations: crow_food_running_low when a product reaches its minimum, and
        crow_food_back_in_stock when it's above it again."""
        low = {pid for pid, p in self.data["products"].items()
               if float(p.get("min_qty") or 0) > 0 and now.get(pid, 0) <= float(p["min_qty"]) + 1e-9}
        was = getattr(self, "_low_seen", None)
        self._low_seen = low
        if was is None:
            return
        for pid in low - was:
            p = self.data["products"][pid]
            self.hass.bus.async_fire(EVENT_RUNNING_LOW, {"product_id": pid, "name": p.get("name", ""), "left": round(now.get(pid, 0), 3),
                                                         "minimum": float(p["min_qty"]), "unit": p.get("unit") or "package"})
        for pid in was - low:
            p = self.data["products"].get(pid)
            if p:
                self.hass.bus.async_fire(EVENT_BACK_IN_STOCK, {"product_id": pid, "name": p.get("name", ""), "left": round(now.get(pid, 0), 3),
                                                               "minimum": float(p.get("min_qty") or 0), "unit": p.get("unit") or "package"})

    def _watch_stock(self) -> None:
        """Ran Out: when a product's stock at home reaches nothing, and when it's back (bought, added or put away)."""
        now = self._stock_all()
        self._watch_low(now)
        seen = getattr(self, "_stock_seen", None)
        self._stock_seen = dict(now)
        if seen is None:
            return
        runs = self.data.setdefault("runouts", [])
        for pid in set(seen) | set(now):
            before, after = seen.get(pid, 0) > 1e-9, now.get(pid, 0) > 1e-9
            if before and not after and pid in self.data["products"]:
                runs.append({"product": pid, "ts": now_ms(), "back": None})
            elif after and not before:
                for r in reversed(runs):
                    if r["product"] == pid:
                        if r.get("back") is None:
                            r["back"] = now_ms()
                        break
        if len(runs) > 3000:
            del runs[:len(runs) - 3000]

    def _changed(self, kind: str, rows: list[dict] | None = None, removed: list[str] | None = None) -> None:
        """Save, and tell every card (each sees only the storages and items it may see)."""
        if kind == "items":
            self._watch_stock()
        elif kind == "products":
            self._watch_low(self._stock_all())
        self._save()
        for uid, send in list(self._subs):
            out_rows = [self.row_out(kind, r) for r in rows or [] if self._row_visible(uid, kind, r)]
            try:
                if out_rows:
                    send({"type": "upsert", "kind": kind, "rows": out_rows})
                if removed:
                    send({"type": "remove", "kind": kind, "ids": removed})
            except Exception:  # noqa: BLE001
                pass
        async_dispatcher_send(self.hass, SIGNAL_UPDATE, kind)
        self.hass.bus.async_fire(EVENT_CHANGED, {"kind": kind})

    def resync(self) -> None:
        """Every card loads everything again (after an import, a restore or a change of who can see what)."""
        self._stock_seen = self._stock_all()   # an import or restore isn't running out
        self._low_seen = None
        self._save()
        self._broadcast_all({"type": "resync"})
        async_dispatcher_send(self.hass, SIGNAL_UPDATE, "all")

    def stats_changed(self) -> None:
        self._broadcast_all({"type": "stats", "stats": self.stats()})

    def history_changed(self) -> None:
        """Open History pages load again."""
        self._broadcast_all({"type": "history"})

    # ── Who can see what ────────────────────────────────────────────────────────
    def can_see(self, uid: str | None, storage: dict | None) -> bool:
        if not storage:
            return False
        users = storage.get("users") or []
        if not users or uid is None:
            return True
        return uid in users or storage.get("owner") == uid

    def visible_storages(self, uid: str | None) -> dict[str, dict]:
        return {sid: s for sid, s in self.data["storages"].items() if self.can_see(uid, s)}

    def _row_visible(self, uid: str, kind: str, row: dict) -> bool:
        if kind == "storages":
            return self.can_see(uid, row)
        if kind == "items":
            return self.can_see(uid, self.data["storages"].get(row.get("storage")))
        return True

    def storage(self, sid: str, uid: str | None = None) -> dict:
        s = self.data["storages"].get(sid)
        if not s or not self.can_see(uid, s):
            raise FoodError("not_found", "That storage or list doesn’t exist any more.")
        return s

    def item(self, iid: str, uid: str | None = None) -> dict:
        it = self.data["items"].get(iid)
        if not it or not self.can_see(uid, self.data["storages"].get(it.get("storage"))):
            raise FoodError("not_found", "That item isn’t there any more. Someone may have used it up.")
        return it

    def product(self, pid: str) -> dict:
        p = self.data["products"].get(pid)
        if not p:
            raise FoodError("not_found", "That product doesn’t exist any more.")
        return p

    # ── Photos ──────────────────────────────────────────────────────────────────
    # Stored as WebP (smaller at the same quality), turned the right
    # way up, without location data, and only once however many products use the same picture. A photo is
    # only kept as it came when it's already smaller than WebP would make it. Photos saved before this are
    # converted overnight (see photos.py). data["photos"] keeps what's known about each one.
    def _sig(self, pid: str) -> str:
        return hmac.new(self.data["secret"].encode(), pid.encode(), hashlib.sha256).hexdigest()[:20]

    def check_sig(self, pid: str, sig: str) -> bool:
        return hmac.compare_digest(self._sig(pid), sig or "")

    def photo_meta(self, pid: str) -> dict:
        return self.data.setdefault("photos", {}).get(pid) or {}

    def photo_url(self, pid: str | None, thumb: bool = False) -> str | None:
        if not pid:
            return None
        meta = self.photo_meta(pid)
        ext = (meta.get("text") if thumb else meta.get("ext")) or ".jpg"
        # the version changes when the photo is made smaller, so cards don't keep a cached old copy
        return f"/api/{DOMAIN}/photo/{pid}/{self._sig(pid)}{'_t' if thumb else ''}{ext}?v={meta.get('v', 0)}"

    def photo_path(self, pid: str, thumb: bool = False) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_-]", "", pid)
        meta = self.photo_meta(pid)
        ext = (meta.get("text") if thumb else meta.get("ext")) or ".jpg"
        return self.photos / f"{safe}{'_t' if thumb else ''}{ext}"

    def photo_mime(self, pid: str) -> str:
        return "image/webp" if (self.photo_meta(pid).get("ext") or ".jpg") == ".webp" else "image/jpeg"

    def _write_photo(self, raw: bytes, pid: str, side: int = PHOTO_SIDE) -> dict:
        """Saves a photo and its small copy for lists (run in the executor). Answers what was saved."""
        from PIL import Image, ImageOps  # Home Assistant always has Pillow

        src = Image.open(io.BytesIO(raw))
        fmt = (src.format or "").upper()
        has_exif = bool(src.info.get("exif"))
        img = ImageOps.exif_transpose(src)
        if img.mode not in ("RGB", "L"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.convert("RGBA").split()[-1])
            img = bg
        img = img.convert("RGB")
        big = img.copy()
        if max(big.size) > side:
            big.thumbnail((side, side), Image.LANCZOS)
        buf = io.BytesIO()
        big.save(buf, "WEBP", quality=WEBP_QUALITY, method=4)
        webp = buf.getvalue()
        safe = re.sub(r"[^A-Za-z0-9_-]", "", pid)
        for old in self.photos.glob(f"{safe}.*"):
            old.unlink(missing_ok=True)
        for old in self.photos.glob(f"{safe}_t.*"):
            old.unlink(missing_ok=True)
        # kept as it came only when it's a plain JPEG, already small enough, with nothing hidden in it
        # (no location data) and WebP wouldn't save at least 5%
        keep = fmt == "JPEG" and not has_exif and max(src.size) <= side and len(webp) >= len(raw) * 0.95
        if keep:
            (self.photos / f"{safe}.jpg").write_bytes(raw)
            ext, size = ".jpg", len(raw)
        else:
            (self.photos / f"{safe}.webp").write_bytes(webp)
            ext, size = ".webp", len(webp)
        small = img.copy()
        small.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
        small.save(self.photos / f"{safe}_t.webp", "WEBP", quality=80, method=4)
        tsize = (self.photos / f"{safe}_t.webp").stat().st_size
        return {"ext": ext, "text": ".webp", "size": size + tsize, "orig": len(raw), "opt": "kept" if keep else "webp",
                "hash": hashlib.sha256(raw).hexdigest(), "v": 1, "ts": now_ms()}

    def photo_by_hash(self, digest: str) -> str | None:
        for pid, meta in self.data.setdefault("photos", {}).items():
            if meta.get("hash") == digest:
                return pid
        return None

    async def async_save_photo(self, raw: bytes, side: int = PHOTO_SIDE) -> str:
        if len(raw) > 25 * 1024 * 1024:
            raise FoodError("too_big", "That photo is too big.")
        # the same picture again (two products with the same Open Food Facts photo): stored once
        same = self.photo_by_hash(hashlib.sha256(raw).hexdigest())
        if same and await self.hass.async_add_executor_job(self.photo_path(same).is_file):
            return same
        pid = new_id()
        try:
            meta = await self.hass.async_add_executor_job(self._write_photo, raw, pid, side)
        except Exception as err:  # noqa: BLE001 - not a picture Pillow can read
            raise FoodError("bad_photo", "That doesn’t look like a photo Crow Food can read.") from err
        self.data.setdefault("photos", {})[pid] = meta
        self._save()
        return pid

    def _remove_photo_files(self, pid: str) -> None:
        safe = re.sub(r"[^A-Za-z0-9_-]", "", pid)
        if not safe:
            return
        for pattern in (f"{safe}.*", f"{safe}_t.*"):
            for f in self.photos.glob(pattern):
                f.unlink(missing_ok=True)

    async def async_drop_photo(self, pid: str) -> None:
        await self.hass.async_add_executor_job(self._remove_photo_files, pid)
        self.data.setdefault("photos", {}).pop(pid, None)
        self._save()

    def _photo_in_use(self, pid: str, skip_product: str | None = None) -> bool:
        return any(p.get("photo") == pid for k, p in self.data["products"].items() if k != skip_product)

    # ── What a card gets ────────────────────────────────────────────────────────
    def row_out(self, kind: str, row: dict) -> dict:
        if kind == "products":
            out = dict(row)
            out["photo_url"] = self.photo_url(row.get("photo"))
            out["thumb_url"] = self.photo_url(row.get("photo"), True)
            return out
        return row

    async def async_users(self) -> list[dict]:
        people = {}
        for st in self.hass.states.async_all("person"):
            uid = st.attributes.get("user_id")
            if uid:
                people[uid] = st.attributes.get("entity_picture")
        out = []
        for user in await self.hass.auth.async_get_users():
            if user.system_generated or not user.is_active:
                continue
            out.append({"id": user.id, "name": user.name or "Someone", "picture": people.get(user.id),
                        "is_admin": user.is_admin})
        out.sort(key=lambda u: u["name"].lower())
        return out

    def snapshot(self, uid: str) -> dict:
        storages = self.visible_storages(uid)
        return {
            "storages": list(storages.values()),
            "shops": list(self.data["shops"].values()),
            "categories": list(self.data["categories"].values()),
            "products": [self.row_out("products", p) for p in self.data["products"].values()],
            "items": [i for i in self.data["items"].values() if i.get("storage") in storages],
            "stats": self.stats(),
            "settings": self.public_settings(),
        }

    def stats(self, days: int = 0) -> dict:
        """How much was eaten and how much thrown away (the numbers at the top of the Overview)."""
        since = now_ms() - days * 86400000 if days else 0
        consumed = thrown = 0
        for log in self.data["logs"]:
            if log.get("ts", 0) < since:
                continue
            if log.get("status") == STATUS_CONSUMED:
                consumed += 1
            elif log.get("status") == STATUS_THROWN:
                thrown += 1
        total = consumed + thrown
        return {"consumed": consumed, "thrown": thrown,
                "consumed_pct": round(consumed * 100 / total, 1) if total else 0.0,
                "thrown_pct": round(thrown * 100 / total, 1) if total else 0.0}

    # ── History ─────────────────────────────────────────────────────────────────
    def _log(self, uid: str | None, status: str, item: dict, qty: float, storage: str | None = None, **extra) -> None:
        p = self.data["products"].get(item.get("product")) or {}
        entry = {"id": new_id(), "ts": now_ms(), "status": status, "user": uid,
                 "product": item.get("product"), "name": p.get("name", ""),
                 "storage": storage or item.get("storage"), "qty": round(qty, 6),
                 "unit": item.get("unit") or p.get("unit") or "package",
                 "price": item.get("price") or p.get("price") or 0, **extra}
        if status in (STATUS_CONSUMED, STATUS_THROWN):
            # enough of the item to put it back exactly as it was (Restore)
            entry["item"] = item.get("id")
            entry["snap"] = {k: item.get(k) for k in SNAP_FIELDS if item.get(k) not in (None, "")}
        elif status in (STATUS_ADDED, STATUS_BOUGHT):
            if item.get("id"):
                entry["item"] = item["id"]   # so a date corrected later corrects what's learnt from it
            if item.get("expires"):
                entry["expires"] = item["expires"]  # the batch, for Buying Habits
            if item.get("shop") and not entry.get("shop"):
                entry["shop"] = item["shop"]  # where it was bought, for Cheapest Shop
        self.data["logs"].append(entry)
        self.last_log_id = entry["id"]
        self._trim_logs()
        self._save_history()
        if status in (STATUS_CONSUMED, STATUS_THROWN):
            self.stats_changed()
            self.history_changed()
        if status in (STATUS_ADDED, STATUS_BOUGHT, STATUS_CONSUMED, STATUS_THROWN) and item.get("product") in self.data["products"]:
            # bought or added (last_bought), and anything that shows it's still in use (last_used)
            prod = self.data["products"][item["product"]]
            prod["last_used"] = now_ms()
            if status in (STATUS_ADDED, STATUS_BOUGHT):
                prod["last_bought"] = now_ms()
                prod.pop("keep_until", None)
            if status == STATUS_BOUGHT:
                prod["bought_n"] = int(prod.get("bought_n") or 0) + 1
            self._changed("products", [prod])

    def history(self, uid: str, product: str | None = None, limit: int = 200, statuses: list[str] | None = None,
                before: int | None = None, query: str = "") -> dict:
        """The newest history first, a page at a time. Searches product and storage names."""
        visible = self.visible_storages(uid)
        storages = self.data["storages"]
        q = (query or "").strip().lower()
        limit = max(1, min(int(limit or 200), 500))
        out = []
        more = False
        for log in reversed(self.data["logs"]):
            if before is not None and log.get("ts", 0) >= before:
                continue
            if product and log.get("product") != product:
                continue
            if statuses and log.get("status") not in statuses:
                continue
            sid = log.get("storage")
            if sid and sid not in visible and sid in storages:
                continue
            if q:
                st_name = (storages.get(sid) or {}).get("name", "")
                p_name = (self.data["products"].get(log.get("product")) or {}).get("name") or log.get("name", "")
                if q not in p_name.lower() and q not in st_name.lower() and q not in (log.get("name") or "").lower():
                    continue
            if len(out) >= limit:
                more = True
                break
            out.append(self.log_out(log))
        return {"logs": out, "more": more}

    def log_out(self, log: dict) -> dict:
        """A history entry as the card shows it."""
        p = self.data["products"].get(log.get("product"))
        st = self.data["storages"].get(log.get("storage"))
        row = {k: v for k, v in log.items() if k != "snap"}
        row["deleted"] = p is None
        if p:
            row["name"] = p.get("name") or log.get("name", "")
        row["storage_name"] = (st or {}).get("name", "")
        snap = log.get("snap") or {}
        row["content"] = snap.get("content") if snap.get("content") else (p or {}).get("content") or 0
        row["content_unit"] = snap.get("content_unit") if snap.get("content") else (p or {}).get("content_unit") or ""
        row["can_restore"] = bool(p and log.get("status") in (STATUS_CONSUMED, STATUS_THROWN)
                                  and log.get("ts", 0) >= now_ms() - RESTORE_DAYS * 86400000)
        return row

    def _find_log(self, uid: str, log_id: str) -> tuple[int, dict]:
        for i in range(len(self.data["logs"]) - 1, -1, -1):
            log = self.data["logs"][i]
            if log.get("id") == log_id:
                sid = log.get("storage")
                if sid in self.data["storages"] and not self.can_see(uid, self.data["storages"][sid]):
                    break
                return i, log
        raise FoodError("not_found", "That history entry doesn’t exist any more.")

    async def async_restore_log(self, uid: str, log_id: str, storage_id: str | None = None) -> dict:
        """Puts something eaten or thrown away back into stock, and takes it out of the history."""
        async with self._lock:
            idx, log = self._find_log(uid, log_id)
            if log.get("status") not in (STATUS_CONSUMED, STATUS_THROWN):
                raise FoodError("bad", "Only things eaten or thrown away can be restored.")
            if log.get("ts", 0) < now_ms() - RESTORE_DAYS * 86400000:
                raise FoodError("too_old", f"Only the last {RESTORE_DAYS} days can be restored.")
            product = self.data["products"].get(log.get("product"))
            if not product:
                raise FoodError("deleted", "That product has been deleted.")
            sid = storage_id or log.get("storage")
            st = self.data["storages"].get(sid)
            if not st or st.get("kind") != KIND_STORAGE:
                raise FoodError("no_storage", "Choose where to put it.")
            self.storage(sid, uid)
            qty = float(log.get("qty") or 0)
            snap = dict(log.get("snap") or {})
            if not snap.get("expires") or not snap.get("stored"):
                # an older entry without its dates: the same product's dates from what's still in stock
                like = sorted((i for i in self.data["items"].values() if i.get("product") == product["id"]
                               and (self.data["storages"].get(i.get("storage")) or {}).get("kind") == KIND_STORAGE),
                              key=lambda i: (i.get("storage") != sid, i.get("expires") or "9999"))
                if like:
                    for k in ("expires", "stored"):
                        if not snap.get(k) and like[0].get(k):
                            snap[k] = like[0][k]
            it = self.data["items"].get(log.get("item") or "")
            if it and it.get("storage") == sid and it.get("product") == product["id"]:
                it["qty"] = round(it["qty"] + qty, 4)
                it["modified"] = now_ms()
                added = False
            else:
                iid = log.get("item") if log.get("item") and log.get("item") not in self.data["items"] else new_id()
                it = {"product": product["id"], "storage": sid, "unit": log.get("unit") or product.get("unit") or "package",
                      "content": product.get("content") or 0, "content_unit": product.get("content_unit") or "",
                      "expires": None, "stored": None, "opened": None, "note": "", "price": log.get("price") or 0,
                      "shop": None, "bought": False, "by": uid, **{k: v for k, v in snap.items() if k in SNAP_FIELDS},
                      "id": iid, "qty": round(qty, 4), "modified": now_ms()}
                it.setdefault("created", now_ms())
                self.data["items"][iid] = it
                added = True
            del self.data["logs"][idx]
            self._restored[log_id] = {"log": log, "idx": idx, "item": it["id"], "qty": qty, "added": added, "at": now_ms()}
            for key in [k for k, v in self._restored.items() if v["at"] < now_ms() - 600000]:
                self._restored.pop(key, None)
            self._save_history()
            self._changed("items", [it])
            self.stats_changed()
            self.history_changed()
            return {"item": self.row_out("items", it), "storage": st["id"], "storage_name": st.get("name", "")}

    async def async_undo_restore(self, uid: str, log_id: str) -> None:
        """Undo for Restore: takes the amount back out and puts the history entry back where it was."""
        async with self._lock:
            info = self._restored.pop(log_id, None)
            if not info:
                raise FoodError("gone", "That can’t be undone any more.")
            it = self.data["items"].get(info["item"])
            if it and self.can_see(uid, self.data["storages"].get(it.get("storage"))):
                left = round(it["qty"] - info["qty"], 4)
                if left <= EPS or info["added"]:
                    del self.data["items"][it["id"]]
                    self._changed("items", removed=[it["id"]])
                else:
                    it["qty"] = left
                    it["modified"] = now_ms()
                    self._changed("items", [it])
            logs = self.data["logs"]
            ts = info["log"].get("ts", 0)
            pos = len(logs)
            while pos > 0 and logs[pos - 1].get("ts", 0) > ts:
                pos -= 1
            logs.insert(pos, info["log"])
            self._save_history()
            self.stats_changed()
            self.history_changed()

    async def async_delete_log(self, uid: str, log_id: str) -> None:
        """Removes an entry from the history (the stock isn't changed)."""
        async with self._lock:
            idx, log = self._find_log(uid, log_id)
            del self.data["logs"][idx]
            self._save_history()
            if log.get("status") in (STATUS_CONSUMED, STATUS_THROWN):
                self.stats_changed()
            self.history_changed()

    # ── Storages and shopping lists ─────────────────────────────────────────────
    def _depth(self, sid: str | None) -> int:
        depth, seen = 0, set()
        while sid and sid in self.data["storages"] and sid not in seen:
            seen.add(sid)
            depth += 1
            sid = self.data["storages"][sid].get("parent")
        return depth

    def _descendants(self, sid: str) -> set[str]:
        out, todo = set(), [sid]
        while todo:
            cur = todo.pop()
            for k, s in self.data["storages"].items():
                if s.get("parent") == cur and k not in out:
                    out.add(k)
                    todo.append(k)
        return out

    def _subtree_depth(self, sid: str) -> int:
        kids = [k for k, s in self.data["storages"].items() if s.get("parent") == sid]
        return 1 + max((self._subtree_depth(k) for k in kids), default=0)

    async def async_save_storage(self, uid: str, data: dict) -> dict:
        sid = data.get("id")
        old = self.data["storages"].get(sid) if sid else None
        if old and not self.can_see(uid, old):
            raise FoodError("not_found", "That storage or list doesn’t exist any more.")
        if old and old.get("builtin"):
            raise FoodError("built_in", f"The {old.get('name')} list can’t be changed. Only lists you make can be.")
        name = _str(data.get("name", old.get("name") if old else ""), 60)
        if not name:
            raise FoodError("no_name", "Give it a name first.")
        kind = data.get("kind") or (old or {}).get("kind") or KIND_STORAGE
        if kind not in (KIND_STORAGE, KIND_LIST):
            kind = KIND_STORAGE
        parent = data.get("parent", (old or {}).get("parent"))
        if parent:
            ps = self.data["storages"].get(parent)
            if not ps or ps.get("kind") != kind or kind == KIND_LIST:
                parent = None
            elif sid and (parent == sid or parent in self._descendants(sid)):
                raise FoodError("loop", "A storage can’t go inside itself.")
            elif self._depth(parent) + (self._subtree_depth(sid) if sid else 1) > MAX_NESTING:
                raise FoodError("too_deep", f"Storages can only be nested {MAX_NESTING} deep.")
        users = data.get("users", (old or {}).get("users") or [])
        users = [u for u in users if isinstance(u, str)][:50]
        if users and uid not in users:
            users.append(uid)  # whoever limits a storage keeps seeing it
        purpose = data.get("purpose", (old or {}).get("purpose") or PURPOSE_BUY)
        if purpose not in PURPOSES:
            purpose = PURPOSE_BUY
        row = {
            **(old or {}),
            "id": sid or new_id(), "name": name, "kind": kind, "parent": parent or None,
            "icon": _str(data.get("icon", (old or {}).get("icon") or "mdi:archive-outline"), 60),
            "color": _str(data.get("color", (old or {}).get("color") or "#8E8E93"), 20),
            "users": users, "owner": (old or {}).get("owner") or uid,
            "sort": int(_num(data.get("sort", (old or {}).get("sort", len(self.data["storages"]))))),
            "created": (old or {}).get("created") or now_ms(), "modified": now_ms(),
        }
        if kind == KIND_LIST:
            row["purpose"] = purpose
            row.pop("temp_entity", None)
            row.pop("door_entity", None)
        else:
            row.pop("purpose", None)
            # live readings shown on the storage: a temperature sensor and a door sensor from Home Assistant
            for key, domains in (("temp_entity", ("sensor.",)), ("door_entity", ("binary_sensor.",))):
                v = _str(data.get(key, (old or {}).get(key) or ""), 120)
                if v and v.startswith(domains) and " " not in v:
                    row[key] = v
                else:
                    row.pop(key, None)
        sharing_changed = old is not None and sorted(old.get("users") or []) != sorted(users)
        self.data["storages"][row["id"]] = row
        if sharing_changed:
            self.resync()
        else:
            self._changed("storages", [row])
        return row

    async def async_delete_storage(self, uid: str, sid: str, move_to: str | None = None) -> None:
        s = self.storage(sid, uid)
        if s.get("builtin"):
            raise FoodError("built_in", f"The {s.get('name')} list can’t be deleted. Only lists you make can be.")
        ids = {sid} | self._descendants(sid)
        target = self.data["storages"].get(move_to) if move_to else None
        if target and (move_to in ids or target.get("kind") != s.get("kind")):
            target = None
        moved, removed = [], []
        for iid, it in list(self.data["items"].items()):
            if it.get("storage") in ids:
                if target:
                    it["storage"] = target["id"]
                    it["modified"] = now_ms()
                    moved.append(it)
                else:
                    removed.append(iid)
                    del self.data["items"][iid]
        for k in ids:
            self.data["storages"].pop(k, None)
        if moved:
            self._changed("items", moved)
        if removed:
            self._changed("items", removed=removed)
        self._changed("storages", removed=list(ids))

    async def async_reorder_storages(self, uid: str, ids: list[str]) -> None:
        rows = []
        for i, sid in enumerate(ids):
            s = self.data["storages"].get(sid)
            if s and self.can_see(uid, s):
                s["sort"] = i
                rows.append(s)
        self._changed("storages", rows)

    # ── Shops and categories ────────────────────────────────────────────────────
    async def async_save_simple(self, kind: str, data: dict) -> dict:
        if kind not in ("shops", "categories"):
            raise FoodError("bad", "Unknown kind.")
        rid = data.get("id")
        old = self.data[kind].get(rid) if rid else None
        name = _str(data.get("name", (old or {}).get("name")), 60)
        if not name:
            raise FoodError("no_name", "Give it a name first.")
        for other in self.data[kind].values():
            if other["name"].lower() == name.lower() and other["id"] != rid:
                return other
        row = {**(old or {}), "id": rid or new_id(), "name": name,
               "sort": int(_num(data.get("sort", (old or {}).get("sort", len(self.data[kind])))))}
        self.data[kind][row["id"]] = row
        self._changed(kind, [row])
        return row

    async def async_delete_simple(self, kind: str, rid: str) -> None:
        if kind not in ("shops", "categories") or rid not in self.data[kind]:
            return
        del self.data[kind][rid]
        field = "shop" if kind == "shops" else "category"
        prods = [p for p in self.data["products"].values() if p.get(field) == rid]
        for p in prods:
            p[field] = None
        items = [i for i in self.data["items"].values() if i.get("shop") == rid] if kind == "shops" else []
        for i in items:
            i["shop"] = None
        if prods:
            self._changed("products", [self.data["products"][p["id"]] for p in prods])
        if items:
            self._changed("items", items)
        self._changed(kind, removed=[rid])

    def category_by_name(self, name: str) -> str | None:
        name = _str(name, 60)
        if not name:
            return None
        for c in self.data["categories"].values():
            if c["name"].lower() == name.lower():
                return c["id"]
        cid = new_id()
        self.data["categories"][cid] = {"id": cid, "name": name, "sort": len(self.data["categories"])}
        self._changed("categories", [self.data["categories"][cid]])
        return cid

    # ── Products ────────────────────────────────────────────────────────────────
    def find_barcode(self, code: str) -> dict | None:
        code = re.sub(r"\s", "", code or "")
        if not code:
            return None
        for p in self.data["products"].values():
            if code == p.get("barcode") or code in (p.get("barcodes") or []):
                return p
        return None

    def _product_fields(self, data: dict, old: dict | None) -> dict:
        o = old or {}
        g = lambda k, d=None: data.get(k, o.get(k, d))  # noqa: E731
        unit = _str(g("unit", "package"), 20).lower() or "package"
        content_unit = _str(g("content_unit", ""), 20).lower()
        sizes = []
        for s in g("sizes", []) or []:
            c = _num((s or {}).get("content"))
            if c > 0:
                sizes.append({"content": c, "content_unit": _str(s.get("content_unit"), 20).lower(), "label": _str(s.get("label"), 30)})
        return {
            "name": _str(g("name", ""), 160),
            "barcode": re.sub(r"\s", "", _str(g("barcode", ""), 40)),
            "category": g("category") or None,
            "photo": g("photo") or None,
            "unit": unit,
            "content": max(0.0, _num(g("content", 0))),
            "content_unit": content_unit,
            "sizes": sizes[:8],
            "min_qty": max(0.0, _num(g("min_qty", 0))),
            "price": max(0.0, _num(g("price", 0))),
            "url": _str(g("url", ""), 500),
            "note": _str(g("note", ""), 1000),
            "shop": g("shop") or None,
            "home": g("home") or None,
            "generic": bool(g("generic", False)),
            "nutrition": g("nutrition") if isinstance(g("nutrition"), dict) else None,
            "source": _str(g("source", "local"), 30),
            "no_expiry": bool(g("no_expiry", False)),
        }

    async def async_save_product(self, uid: str, data: dict, notify: bool = True) -> dict:
        pid = data.get("id")
        old = self.data["products"].get(pid) if pid else None
        fields = self._product_fields(data, old)
        if not fields["name"]:
            raise FoodError("no_name", "Give the product a name first.")
        if fields["category"] and fields["category"] not in self.data["categories"]:
            fields["category"] = self.category_by_name(str(fields["category"]))
        if fields["shop"] and fields["shop"] not in self.data["shops"]:
            fields["shop"] = None
        if old and old.get("photo") and old.get("photo") != fields["photo"] and not self._photo_in_use(old["photo"], pid):
            await self.async_drop_photo(old["photo"])
        row = {**(old or {}), **fields, "id": pid or new_id(), "created": (old or {}).get("created") or now_ms(),
               "modified": now_ms()}
        if old and old.get("name", "").strip().lower() != row["name"].strip().lower():
            row.pop("info", None)   # About This Food was for the old name
        if old and old.get("photo") != row.get("photo"):
            row.pop("photo_auto", None)
        self.data["products"][row["id"]] = row
        if notify:
            self._changed("products", [row])
        # a new product without a photo: a general picture of the food from Wikipedia, in the background
        if not old and not row.get("photo") and self.settings.get("photo_finder", True) \
                and data.get("source") not in ("csv", "import"):
            from .info import async_auto_photo

            self.hass.async_create_background_task(async_auto_photo(self, row["id"]), f"crow_food photo {row['id']}")
        return row

    async def async_delete_product(self, uid: str, pid: str) -> None:
        p = self.product(pid)
        removed = [k for k, i in self.data["items"].items() if i.get("product") == pid]
        for k in removed:
            del self.data["items"][k]
        del self.data["products"][pid]
        if p.get("photo") and not self._photo_in_use(p["photo"]):
            await self.async_drop_photo(p["photo"])
        if removed:
            self._changed("items", removed=removed)
        self._changed("products", removed=[pid])

    # ── Items ───────────────────────────────────────────────────────────────────
    def _item_fields(self, data: dict, old: dict | None, product: dict) -> dict:
        o = old or {}
        g = lambda k, d=None: data.get(k, o.get(k, d))  # noqa: E731
        qty = max(0.0, _num(g("qty", 1), 1))
        return {
            "product": product["id"],
            "storage": g("storage"),
            "qty": round(qty, 4),
            "unit": (_str(g("unit", product.get("unit") or "package"), 20).lower() or "package"),
            "content": max(0.0, _num(g("content", product.get("content", 0)))),
            "content_unit": _str(g("content_unit", product.get("content_unit", "")), 20).lower(),
            "expires": _date(g("expires")),
            "stored": _date(g("stored")) or (o.get("stored") if old else today()),
            "opened": _date(g("opened")),
            "price": max(0.0, _num(g("price", 0))),
            "note": _str(g("note", ""), 500),
            "shop": g("shop") or None,
            "bought": bool(g("bought", False)),
            "discount": g("discount") if isinstance(g("discount"), dict) else None,
            "dest": g("dest") or None,
        }

    async def async_save_item(self, uid: str, data: dict) -> dict:
        """Adds or changes an item. A new product can come with it (data["product"] as a dict)."""
        async with self._lock:
            iid = data.get("id")
            old = self.item(iid, uid) if iid else None
            prod_in = data.get("product")
            if isinstance(prod_in, dict):
                product = await self.async_save_product(uid, prod_in)
            else:
                product = self.product(prod_in or (old or {}).get("product"))
            data = {**data, "product": product["id"]}
            fields = self._item_fields(data, old, product)
            st = self.storage(fields["storage"], uid)
            if fields["qty"] <= EPS:
                fields["qty"] = 1
            if st.get("kind") == KIND_LIST:
                fields["expires"] = None
                fields["opened"] = None
            else:
                fields["bought"] = False
            # the same product, unopened, with the same date, in the same place: add to it
            if not old and not data.get("separate"):
                for other in self.data["items"].values():
                    if (other.get("product") == product["id"] and other.get("storage") == fields["storage"]
                            and other.get("expires") == fields["expires"] and not other.get("opened") and not fields["opened"]
                            and not other.get("bought") and other.get("unit") == fields["unit"]
                            and not other.get("note") and not fields["note"]):
                        other["qty"] = round(other["qty"] + fields["qty"], 4)
                        other["modified"] = now_ms()
                        # this purchase's own shop and price go in the history (Cheapest Shop, Spending)
                        extra = {k: fields[k] for k in ("shop", "price") if fields.get(k)}
                        self._log(uid, STATUS_ADDED, other, fields["qty"], **extra)
                        self._remember_home(product, st)
                        self._changed("items", [other])
                        return other
            row = {**(old or {}), **fields, "id": iid or new_id(), "created": (old or {}).get("created") or now_ms(),
                   "modified": now_ms(), "by": (old or {}).get("by") or uid}
            if old and fields.get("expires") != old.get("expires"):
                # a date corrected: what was learnt from this pack is corrected too
                for log in reversed(self.data.get("logs", [])):
                    if log.get("item") == old["id"] and log.get("status") in (STATUS_ADDED, STATUS_BOUGHT):
                        if fields.get("expires"):
                            log["expires"] = fields["expires"]
                        else:
                            log.pop("expires", None)
                        self._save_history()
                        break
            self.data["items"][row["id"]] = row
            if not old:
                self._log(uid, STATUS_ADDED, row, row["qty"])
            self._remember_home(product, st)
            self._changed("items", [row])
            return row

    def _remember_home(self, product: dict, st: dict) -> None:
        """Where a product usually lives, so bought items go back to the right place."""
        if st.get("kind") == KIND_STORAGE and product.get("home") != st["id"]:
            product["home"] = st["id"]
            self._changed("products", [product])

    async def async_consume(self, uid: str, iid: str, qty: float | None, status: str) -> dict | None:
        """Uses some or all of an item (consumed) or throws it away (thrown)."""
        async with self._lock:
            it = self.item(iid, uid)
            use = it["qty"] if qty is None else max(0.0, min(_num(qty, it["qty"]), it["qty"]))
            if use <= EPS:
                raise FoodError("nothing", "Choose how much first.")
            self._log(uid, STATUS_THROWN if status == STATUS_THROWN else STATUS_CONSUMED, it, use)
            left = round(it["qty"] - use, 6)
            # less than a hundredth of what's in a package left (a rounding crumb): it's all gone
            content = _num(it.get("content"))
            if left <= EPS or (content > 0 and left * content < 0.005):
                del self.data["items"][iid]
                self._changed("items", removed=[iid])
                self._check_low(uid, it["product"])
                return None
            it["qty"] = left
            it["modified"] = now_ms()
            self._changed("items", [it])
            self._check_low(uid, it["product"])
            return it

    async def async_clear_min(self, ids: list[str] | None) -> int:
        """Minimum quantities back to none: the ones given, or every product's."""
        async with self._lock:
            rows = []
            for pid, p in self.data["products"].items():
                if (ids is None or pid in ids) and float(p.get("min_qty") or 0) > 0:
                    p["min_qty"] = 0
                    p["modified"] = now_ms()
                    rows.append(p)
            if rows:
                self._changed("products", rows)
            return len(rows)

    # ── Freeze-by: things in the fridge or cupboard that go off in a day or two and freeze well ──
    FREEZES = re.compile(r"\b(mince|meat|beef|pork|lamb|chicken|turkey|duck|poultry|sausage|bacon|gammon|ham|steak|burger|meatball|fish|salmon|cod|haddock|"
                         r"tuna steak|prawn|bread|loaf|rolls?|bagel|wrap|pitta|naan|crumpet|muffin|croissant|baker|cake|soup|stew|curry|chilli|bolognese|lasagne)", re.I)

    def freezes_well(self, pid: str | None) -> bool:
        p = self.data["products"].get(pid or "") or {}
        info = p.get("info") or {}
        if info.get("frozen_days") or info.get("keeps_frozen"):
            return True
        cat = (self.data["categories"].get(p.get("category")) or {}).get("name", "")
        return bool(self.FREEZES.search(f"{p.get('name', '')} {cat}"))

    def freeze_today(self, uid: str | None = None, days: int = 2) -> list[dict]:
        """Unopened things outside a freezer, going off today to `days` from now, that freeze well (when there's a freezer)."""
        vis = self.visible_storages(uid)
        if not any(self._is_freezer(sid) for sid, st in vis.items() if st.get("kind") == KIND_STORAGE):
            return []
        t = date.fromisoformat(today())
        out = []
        for it in self.data["items"].values():
            st = vis.get(it.get("storage"))
            if not st or st.get("kind") != KIND_STORAGE or self._is_freezer(st["id"]) or it.get("opened") or not it.get("expires"):
                continue
            try:
                left = (date.fromisoformat(it["expires"]) - t).days
            except ValueError:
                continue
            if 0 <= left <= days and self.freezes_well(it.get("product")):
                out.append(it)
        return sorted(out, key=lambda i: i["expires"])

    def stock(self, pid: str) -> float:
        return sum(i["qty"] for i in self.data["items"].values() if i.get("product") == pid
                   and (self.data["storages"].get(i.get("storage")) or {}).get("kind") == KIND_STORAGE)

    # ── How long things keep in this house (for dates on things added from a receipt) ──
    def _is_freezer(self, sid: str | None) -> bool:
        st = self.data["storages"].get(sid or "") or {}
        return bool(re.search(r"freez|frozen", st.get("name", ""), re.I))

    def shelf_samples(self) -> dict[str, list[tuple[date, int, bool]]]:
        """product id -> (when it was put away, days it had until its best-before, kept in a freezer), one per pack.
        A pack's date as it is now (or was when it was used) wins over the date it was first given, so a date
        corrected later is what's learnt."""
        by_item: dict[str, tuple[str, date, int, bool]] = {}
        loose: list[tuple[str, date, int, bool]] = []

        def days_between(start: date | None, exp: Any) -> int | None:
            try:
                d = (date.fromisoformat(str(exp)[:10]) - start).days if start else None
            except (TypeError, ValueError):
                return None
            return d if d is not None and 0 < d <= 3650 else None

        def day_of(ms) -> date | None:
            try:
                return datetime.fromtimestamp(int(ms) / 1000).date()
            except (TypeError, ValueError, OSError):
                return None

        def iso(v) -> date | None:
            try:
                return date.fromisoformat(str(v)[:10]) if v else None
            except ValueError:
                return None

        def add(key: str | None, pid, start, exp, freezer: bool, rank: int) -> None:
            d = days_between(start, exp)
            if not pid or d is None:
                return
            if key:
                # the same pack seen more than once: its date as it is now beats the date it was first given
                if key not in by_item or rank >= by_item_rank[key]:
                    by_item[key] = (pid, start, d, freezer)
                    by_item_rank[key] = rank
            else:
                loose.append((pid, start, d, freezer))

        by_item_rank: dict[str, int] = {}
        for log in self.data.get("logs", []):
            st = log.get("status")
            if st in (STATUS_ADDED, STATUS_BOUGHT) and log.get("expires"):
                add(log.get("item"), log.get("product"), day_of(log.get("ts")), log["expires"], self._is_freezer(log.get("storage")), 1)
            elif st in (STATUS_CONSUMED, STATUS_THROWN):
                snap = log.get("snap") or {}
                if snap.get("expires") and snap.get("stored"):
                    add(log.get("item"), log.get("product"), iso(snap["stored"]), snap["expires"], self._is_freezer(log.get("storage")), 2)
        for it in self.data["items"].values():
            if it.get("expires") and (self.data["storages"].get(it.get("storage")) or {}).get("kind") == KIND_STORAGE:
                add(it.get("id"), it.get("product"), iso(it.get("stored")) or day_of(it.get("created")), it["expires"],
                    self._is_freezer(it.get("storage")), 3)
        out: dict[str, list[tuple[date, int, bool]]] = {}
        for pid, start, d, fz in list(by_item.values()) + loose:
            out.setdefault(pid, []).append((start, d, fz))
        return out

    @staticmethod
    def usual_days(samples: list[tuple[date, int, bool]] | None, freezer: bool) -> tuple[int | None, int]:
        """How many days to give a new pack, and from how many past packs: only packs kept the same way (freezer or
        not), the latest six, and the typical one of those (the middle; with one pack, that pack's)."""
        same = sorted((s for s in samples or [] if s[2] == freezer), key=lambda s: s[0])[-6:]
        if not same:
            return None, 0
        ds = sorted(s[1] for s in same)
        return ds[(len(ds) - 1) // 2], len(ds)

    def shelf_lives(self) -> dict[str, int]:
        """product id -> days for a new pack kept out of the freezer (the reports' simple view)."""
        out = {}
        for pid, samples in self.shelf_samples().items():
            d, _n = self.usual_days(samples, False)
            if d:
                out[pid] = d
        return out

    def usual_storage(self, pid: str, uid: str | None) -> str | None:
        """Where a product lives: its home, or where most of it is now."""
        storages = {k: v for k, v in self.visible_storages(uid).items() if v.get("kind") == KIND_STORAGE}
        p = self.data["products"].get(pid) or {}
        if p.get("home") in storages:
            return p["home"]
        counts: dict[str, int] = {}
        for it in self.data["items"].values():
            if it.get("product") == pid and it.get("storage") in storages:
                counts[it["storage"]] = counts.get(it["storage"], 0) + 1
        return max(counts, key=counts.get) if counts else None

    async def async_add_many(self, uid: str, rows: list[dict], shop: str | None = None, shop_name: str = "") -> dict:
        """Adds what was read from a receipt, an order email or said out loud, once it's been checked."""
        if not shop and shop_name.strip():
            low = shop_name.strip().lower()
            found = next((s["id"] for s in self.data["shops"].values() if s["name"].lower() == low), None)
            shop = found or (await self.async_save_simple("shops", {"name": shop_name.strip()[:60]}))["id"]
        if shop and shop not in self.data["shops"]:
            shop = None
        today = dt_util.now().date().isoformat()
        added = []
        for r in rows[:200]:
            name = str(r.get("name") or "").strip()[:160]
            pid = r.get("product") if r.get("product") in self.data["products"] else None
            if not pid and not name:
                continue
            product: Any = pid or {"name": name, "category": r.get("category") or None,
                                   "content": r.get("content") or 0, "content_unit": r.get("content_unit") or "",
                                   "price": r.get("price") or 0, "shop": shop}
            item = {"product": product, "storage": r.get("storage"), "qty": r.get("qty") or 1, "unit": "package",
                    "expires": r.get("expires") or None, "stored": today, "price": r.get("price") or 0, "shop": shop}
            if pid and r.get("content"):
                item["content"], item["content_unit"] = r["content"], r.get("content_unit") or ""
            row = await self.async_save_item(uid, item)
            added.append(row)
            # what the receipt called it, linked to the product it was added as: matched without asking next time
            if r.get("receipt_name"):
                from . import receipts

                receipts.remember(self, r["receipt_name"], row["product"])
        self._save()
        return {"count": len(added), "shop": shop}

    # ── Cheapest shop: what each product has cost at each shop ──────────────────────
    def shop_prices(self, pid: str) -> list[dict]:
        """Each shop a product was bought at with a price: lowest, last and how often (cheapest first)."""
        rows: dict[str, dict] = {}
        for log in self.data.get("logs", []):
            if log.get("product") != pid or log.get("status") not in (STATUS_ADDED, STATUS_BOUGHT):
                continue
            shop, price = log.get("shop"), float(log.get("price") or 0)
            if not shop or shop not in self.data["shops"] or price <= 0:
                continue
            r = rows.setdefault(shop, {"shop": shop, "name": self.data["shops"][shop]["name"], "lowest": price,
                                       "last": price, "last_ts": 0, "times": 0})
            r["lowest"] = min(r["lowest"], price)
            r["times"] += 1
            if int(log.get("ts") or 0) >= r["last_ts"]:
                r["last"], r["last_ts"] = price, int(log.get("ts") or 0)
        return sorted(rows.values(), key=lambda r: (r["last"], r["lowest"]))

    def cheapest(self) -> dict[str, dict]:
        """product id -> the shop where it last cost least, for products bought at two or more shops."""
        out = {}
        pids = {l.get("product") for l in self.data.get("logs", []) if l.get("shop") and float(l.get("price") or 0) > 0}
        for pid in pids:
            if pid not in self.data["products"]:
                continue
            rows = self.shop_prices(pid)
            if len(rows) >= 2:
                best = rows[0]
                out[pid] = {"shop": best["shop"], "name": best["name"], "price": best["last"],
                            "saving": round(rows[1]["last"] - best["last"], 2)}
        return out

    def _check_low(self, uid: str | None, pid: str) -> None:
        p = self.data["products"].get(pid)
        if p and p.get("min_qty", 0) > 0 and self.stock(pid) <= p["min_qty"] + EPS:
            self.hass.bus.async_fire(f"{DOMAIN}_low_stock", {"product": p["name"], "product_id": pid,
                                                             "stock": self.stock(pid), "min": p["min_qty"]})

    async def async_move(self, uid: str, iid: str, storage: str, qty: float | None = None) -> dict:
        async with self._lock:
            it = self.item(iid, uid)
            st = self.storage(storage, uid)
            src_kind = (self.data["storages"].get(it["storage"]) or {}).get("kind")
            src_sid, exp_before = it["storage"], it.get("expires")
            move = it["qty"] if qty is None else max(0.0, min(_num(qty, it["qty"]), it["qty"]))
            if move <= EPS:
                raise FoodError("nothing", "Choose how much first.")
            if move < it["qty"] - EPS:
                it["qty"] = round(it["qty"] - move, 4)
                it["modified"] = now_ms()
                row = {**it, "id": new_id(), "qty": round(move, 4), "storage": st["id"], "created": now_ms(), "modified": now_ms()}
                self.data["items"][row["id"]] = row
                changed = [it, row]
            else:
                it["storage"] = st["id"]
                it["modified"] = now_ms()
                row = it
                changed = [it]
            if st.get("kind") == KIND_LIST:
                row["expires"] = None
                row["opened"] = None
            else:
                row["bought"] = False
                if src_kind == KIND_LIST:
                    row["stored"] = today()
            # where it came from and its date then (Saved in Time: frozen before it went off)
            self._log(uid, STATUS_MOVED, row, move, storage=st["id"], **{"from": src_sid, "expires": exp_before})
            p = self.data["products"].get(row["product"])
            if p:
                self._remember_home(p, st)
            self._changed("items", changed)
            return row

    async def async_open(self, uid: str, iid: str, opened: bool) -> dict:
        """Marks one package as opened (the rest stay sealed), or closes it again."""
        async with self._lock:
            it = self.item(iid, uid)
            if not opened:
                it["opened"] = None
                it["modified"] = now_ms()
                self._changed("items", [it])
                return it
            if it["qty"] > 1 + EPS and not it.get("opened"):
                it["qty"] = round(it["qty"] - 1, 4)
                it["modified"] = now_ms()
                row = {**it, "id": new_id(), "qty": 1, "opened": today(), "created": now_ms(), "modified": now_ms()}
                self.data["items"][row["id"]] = row
                self._changed("items", [it, row])
                return row
            it["opened"] = today()
            it["modified"] = now_ms()
            self._changed("items", [it])
            return it

    async def async_add_to_list(self, uid: str, product_id: str, list_id: str | None, qty: float = 1,
                                shop: str | None = None) -> dict:
        p = self.product(product_id)
        if not list_id:
            lists = sorted((s for s in self.visible_storages(uid).values() if s.get("kind") == KIND_LIST),
                           key=lambda s: s.get("sort", 0))
            if not lists:
                raise FoodError("no_list", "Make a shopping list first.")
            list_id = lists[0]["id"]
        return await self.async_save_item(uid, {"product": p["id"], "storage": list_id, "qty": qty or 1,
                                                "shop": shop or p.get("shop"), "price": p.get("price", 0)})

    def purpose(self, sid: str | None) -> str | None:
        """What a list is for (buy, eat or ideas); None for a storage. Lists made before this are for buying."""
        st = self.data["storages"].get(sid or "")
        if not st or st.get("kind") != KIND_LIST:
            return None
        return st.get("purpose") if st.get("purpose") in PURPOSES else PURPOSE_BUY

    async def async_pick(self, uid: str, iid: str, used: bool) -> None:
        """Ticks something off an Eating list: kept in the history for Meal Picks, and taken off the list.
        What was eaten from storage (if anything) is counted separately, by the usual Consumed."""
        async with self._lock:
            it = self.item(iid, uid)
            if (self.data["storages"].get(it.get("storage")) or {}).get("kind") != KIND_LIST:
                raise FoodError("bad", "That isn’t on a list.")
            self._log(uid, STATUS_PICKED, it, it["qty"], used=bool(used))
            del self.data["items"][iid]
            self._changed("items", removed=[iid])

    async def async_set_bought(self, uid: str, iid: str, bought: bool) -> dict:
        it = self.item(iid, uid)
        it["bought"] = bool(bought)
        it["modified"] = now_ms()
        self._changed("items", [it])
        return it

    async def async_put_away(self, uid: str, list_id: str, ids: list[str] | None = None,
                             storage: str | None = None) -> int:
        """Moves bought things from a shopping list to where they live (or to the storage chosen)."""
        st_list = self.storage(list_id, uid)
        if st_list.get("kind") != KIND_LIST:
            raise FoodError("bad", "That isn’t a shopping list.")
        target = self.storage(storage, uid) if storage else None
        storages = self.visible_storages(uid)
        fallback = next((s for s in sorted(storages.values(), key=lambda s: s.get("sort", 0)) if s.get("kind") == KIND_STORAGE), None)
        n = 0
        async with self._lock:
            for it in list(self.data["items"].values()):
                if it.get("storage") != list_id or (ids is not None and it["id"] not in ids) or (ids is None and not it.get("bought")):
                    continue
                p = self.data["products"].get(it["product"]) or {}
                dest = target or storages.get(it.get("dest") or "") or storages.get(p.get("home") or "") or fallback
                if not dest or dest.get("kind") != KIND_STORAGE:
                    continue
                self._log(uid, STATUS_BOUGHT, it, it["qty"], shop=it.get("shop"))
                if it.get("price"):
                    p["price"] = it["price"]
                del self.data["items"][it["id"]]
                self._changed("items", removed=[it["id"]])
                new = {"product": it["product"], "storage": dest["id"], "qty": it["qty"], "unit": it.get("unit"),
                       "content": it.get("content"), "content_unit": it.get("content_unit"), "price": it.get("price", 0),
                       "stored": today()}
                p_obj = self.data["products"].get(it["product"])
                fields = self._item_fields(new, None, p_obj or {"id": it["product"]})
                row = {**fields, "id": new_id(), "created": now_ms(), "modified": now_ms(), "by": uid}
                self.data["items"][row["id"]] = row
                self._changed("items", [row])
                n += 1
        return n

    async def async_delete_items(self, uid: str, ids: list[str]) -> None:
        removed = []
        for iid in ids:
            it = self.data["items"].get(iid)
            if it and self.can_see(uid, self.data["storages"].get(it.get("storage"))):
                del self.data["items"][iid]
                removed.append(iid)
        if removed:
            self._changed("items", removed=removed)

    # ── Smart lists (also used by the sensors and notifications) ─────────────────
    def smart(self, uid: str | None = None) -> dict[str, list[dict]]:
        storages = self.visible_storages(uid)
        inv = [i for i in self.data["items"].values() if (storages.get(i.get("storage")) or {}).get("kind") == KIND_STORAGE]
        t = dt_util.now().date()
        soon = (t + timedelta(days=int(self.settings.get("soon_days", 3)))).isoformat()
        ts = t.isoformat()
        low = []
        for p in self.data["products"].values():
            if p.get("min_qty", 0) > 0:
                have = sum(i["qty"] for i in inv if i.get("product") == p["id"])
                if have <= p["min_qty"] + EPS:
                    low.append({"product": p["id"], "name": p["name"], "stock": have, "min": p["min_qty"]})
        return {
            "all": inv,
            "open": [i for i in inv if i.get("opened")],
            "soon": [i for i in inv if i.get("expires") and ts <= i["expires"] <= soon],
            "expired": [i for i in inv if i.get("expires") and i["expires"] < ts],
            "low": low,
            "stale": [{"product": p["id"], "name": p["name"], "last_bought": p.get("last_bought")} for p in self.stale()],
        }

    def name_of(self, item: dict) -> str:
        return (self.data["products"].get(item.get("product")) or {}).get("name", "Something")

    # ── Not Bought Lately ───────────────────────────────────────────────────────
    def index_bought(self) -> None:
        """Each product's last bought (or added) time and how often it's been bought, from the history."""
        last: dict[str, int] = {}
        used: dict[str, int] = {}
        count: dict[str, int] = {}
        for log in self.data.get("logs", []):
            pid = log.get("product")
            st = log.get("status")
            if not pid or st not in (STATUS_ADDED, STATUS_BOUGHT, STATUS_CONSUMED, STATUS_THROWN):
                continue
            ts = int(log.get("ts") or 0)
            used[pid] = max(used.get(pid, 0), ts)
            if st in (STATUS_ADDED, STATUS_BOUGHT):
                last[pid] = max(last.get(pid, 0), ts)
            if st == STATUS_BOUGHT:
                count[pid] = count.get(pid, 0) + 1
        for pid, p in self.data["products"].items():
            if pid in last and last[pid] > int(p.get("last_bought") or 0):
                p["last_bought"] = last[pid]
            if pid in used and used[pid] > int(p.get("last_used") or 0):
                p["last_used"] = used[pid]
            if count.get(pid, 0) > int(p.get("bought_n") or 0):
                p["bought_n"] = count[pid]

    def stale_period_ms(self) -> int:
        return int(int(self.settings.get("stale_months", 6) or 0) * 30.44 * 86400000)

    def stale(self) -> list[dict]:
        """Products that aren't at home or on a list and haven't been bought (or used) for the chosen months."""
        period = self.stale_period_ms()
        if not period:
            return []
        now = now_ms()
        present = {i.get("product") for i in self.data["items"].values()}
        out = []
        for p in self.data["products"].values():
            if p["id"] in present or int(p.get("keep_until") or 0) > now:
                continue
            seen = max(int(p.get("last_bought") or 0), int(p.get("last_used") or 0), int(p.get("created") or 0))
            if seen and seen < now - period:
                out.append(p)
        return sorted(out, key=lambda p: max(int(p.get("last_bought") or 0), int(p.get("last_used") or 0), int(p.get("created") or 0)))

    async def async_keep(self, ids: list[str]) -> int:
        """Keeps products out of Not Bought Lately for another full period."""
        until = now_ms() + (self.stale_period_ms() or 182 * 86400000)
        rows = []
        for pid in ids:
            p = self.data["products"].get(pid)
            if p:
                p["keep_until"] = until
                rows.append(p)
        if rows:
            self._changed("products", rows)
        return len(rows)

    async def async_delete_products(self, ids: list[str]) -> list[dict]:
        """Deletes products, answering them so they can be put back (Undo). Their photos stay until the
        weekly tidy-up, so Undo brings those back too; their history stays for the Consumed numbers."""
        removed, items = [], []
        for pid in ids:
            p = self.data["products"].pop(pid, None)
            if not p:
                continue
            removed.append(p)
            for iid in [k for k, i in self.data["items"].items() if i.get("product") == pid]:
                del self.data["items"][iid]
                items.append(iid)
        if items:
            self._changed("items", removed=items)
        if removed:
            self._changed("products", removed=[p["id"] for p in removed])
        return removed

    async def async_restore_products(self, rows: list[dict]) -> int:
        back = []
        for r in rows or []:
            if isinstance(r, dict) and r.get("id") and r["id"] not in self.data["products"] and r.get("name"):
                r = {k: v for k, v in r.items() if k not in ("photo_url", "thumb_url")}
                self.data["products"][r["id"]] = r
                back.append(r)
        if back:
            self._changed("products", back)
        return len(back)

    def set_auto_path(self, uid: str, path: str) -> None:
        path = "/" + str(path or "").split("?")[0].strip().strip("/")
        if len(path) > 1 and self.data.setdefault("auto_paths", {}).get(uid) != path:
            self.data["auto_paths"][uid] = path
            self._save()

    # ── Backups ─────────────────────────────────────────────────────────────────
    def _write_backup(self, payload: str, keep: int) -> str:
        self.backups.mkdir(parents=True, exist_ok=True)
        name = f"crow_food_{dt_util.now().strftime('%Y%m%d_%H%M%S')}.json"
        (self.backups / name).write_text(payload, encoding="utf-8")
        files = sorted(self.backups.glob("crow_food_*.json"))
        for old in files[:-keep]:
            try:
                old.unlink()
            except OSError:
                pass
        return name

    async def async_backup(self) -> str:
        keep = int(self.settings.get("backups", {}).get("keep", 7))
        payload = json.dumps({"crow_food": 1, "saved": now_ms(), "data": self.data}, ensure_ascii=False)
        return await self.hass.async_add_executor_job(self._write_backup, payload, keep)

    def _list_backups(self) -> list[dict]:
        out = []
        for f in sorted(self.backups.glob("crow_food_*.json"), reverse=True):
            st = f.stat()
            out.append({"name": f.name, "size": st.st_size, "ts": int(st.st_mtime * 1000)})
        return out

    async def async_list_backups(self) -> list[dict]:
        return await self.hass.async_add_executor_job(self._list_backups)

    async def async_restore(self, name: str) -> None:
        if not re.match(r"^crow_food_[\d_]+\.json$", name or ""):
            raise FoodError("bad", "That backup doesn’t exist.")
        path = self.backups / name

        def _read() -> dict:
            return json.loads(path.read_text(encoding="utf-8"))

        try:
            payload = await self.hass.async_add_executor_job(_read)
        except (OSError, ValueError) as err:
            raise FoodError("bad", "That backup couldn’t be read.") from err
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict) or "items" not in data:
            raise FoodError("bad", "That isn’t a Crow Food backup.")
        await self.async_backup()
        for k in KINDS:
            data.setdefault(k, {})
        data.setdefault("logs", [])
        data.setdefault("photos", {})
        data.setdefault("photo_stats", self.data.get("photo_stats") or {})
        data.setdefault("secret", self.data.get("secret") or secrets.token_hex(16))
        data.setdefault("auto_paths", self.data.get("auto_paths") or {})
        data.setdefault("stale_notified", [])
        _strip_tags(data)
        _ensure_builtins(data)
        self.data = data
        self._trim_logs()
        self._save_history()
        self.index_bought()
        self.resync()

    async def async_reset(self, settings_too: bool = False) -> str:
        """Deletes everything (a backup is made first) and starts again as when first installed."""
        async with self._lock:
            name = await self.async_backup()
            secret = self.data.get("secret") or secrets.token_hex(16)
            self.data = empty_data()
            self.data["secret"] = secret
            self._restored.clear()
            await self.async_ai_cache_clear()

            def _wipe_photos() -> int:
                n = 0
                if self.photos.exists():
                    for f in self.photos.iterdir():
                        if f.is_file():
                            try:
                                f.unlink()
                                n += 1
                            except OSError:
                                pass
                return n

            removed = await self.hass.async_add_executor_job(_wipe_photos)
            await self._store.async_save(self._data_out())
            await self._history_store.async_save(self._history_out())
            if settings_too:
                self.settings = copy.deepcopy(DEFAULT_SETTINGS)
                self.settings["history_v"] = 1
                await self._settings_store.async_save(self.settings)
                self._broadcast_all({"type": "settings", "settings": self.public_settings()})
            _LOGGER.warning("Crow Food was reset: everything deleted (%s photos); backup saved as %s", removed, name)
        self.resync()
        self.stats_changed()
        self.history_changed()
        return name

    # ── CSV ─────────────────────────────────────────────────────────────────────
    CSV_FIELDS = ("storage", "name", "quantity", "unit", "per_package", "package_unit", "expires", "stored", "opened",
                  "category", "barcode", "price", "shop", "min_quantity", "url", "note")

    def export_csv(self, uid: str, storage: str | None = None) -> str:
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(self.CSV_FIELDS)
        storages = self.visible_storages(uid)
        cats = self.data["categories"]
        shops = self.data["shops"]
        for it in sorted(self.data["items"].values(), key=lambda i: (storages.get(i.get("storage"), {}).get("name", ""), self.name_of(i).lower())):
            st = storages.get(it.get("storage"))
            if not st or (storage and it["storage"] != storage):
                continue
            p = self.data["products"].get(it["product"]) or {}
            w.writerow([st["name"], p.get("name", ""), f"{it['qty']:g}", it.get("unit", ""), f"{it.get('content') or 0:g}",
                        it.get("content_unit", ""), it.get("expires") or "", it.get("stored") or "", it.get("opened") or "",
                        (cats.get(p.get("category")) or {}).get("name", ""),
                        p.get("barcode", ""), f"{it.get('price') or p.get('price') or 0:g}",
                        (shops.get(it.get("shop") or p.get("shop")) or {}).get("name", ""), f"{p.get('min_qty') or 0:g}",
                        p.get("url", ""), it.get("note") or p.get("note", "")])
        return out.getvalue()

    async def async_import_csv(self, uid: str, text: str, storage: str | None = None) -> int:
        reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
        storages = self.visible_storages(uid)
        by_name = {s["name"].lower(): s for s in storages.values()}
        default = self.data["storages"].get(storage) if storage else None
        n = 0
        for row in reader:
            row = {str(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            name = row.get("name") or row.get("product")
            if not name:
                continue
            st = default or by_name.get((row.get("storage") or "").lower())
            if not st:
                if not row.get("storage"):
                    continue
                st = await self.async_save_storage(uid, {"name": row["storage"]})
                by_name[st["name"].lower()] = st
                storages[st["id"]] = st
            product = self.find_barcode(row.get("barcode", "")) or next(
                (p for p in self.data["products"].values() if p["name"].lower() == name.lower()), None)
            shop_id = None
            if row.get("shop"):
                shop_id = (await self.async_save_simple("shops", {"name": row["shop"]}))["id"]
            if not product:
                product = await self.async_save_product(uid, {
                    "name": name, "barcode": row.get("barcode", ""), "category": row.get("category") or None,
                    "unit": row.get("unit") or "package",
                    "content": _num(row.get("per_package")), "content_unit": row.get("package_unit", ""),
                    "price": _num(row.get("price")), "min_qty": _num(row.get("min_quantity")), "url": row.get("url", ""),
                    "shop": shop_id, "source": "csv"})
            await self.async_save_item(uid, {
                "product": product["id"], "storage": st["id"], "qty": _num(row.get("quantity"), 1) or 1,
                "unit": row.get("unit") or product.get("unit"), "expires": row.get("expires"), "stored": row.get("stored"),
                "opened": row.get("opened"), "price": _num(row.get("price")), "note": row.get("note", ""),
                "shop": shop_id, "separate": True})
            n += 1
        return n
