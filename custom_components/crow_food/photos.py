"""Product photos made smaller overnight.

Every night from 01:30 to 03:30 (a quiet time, before Crow Food's 03:40 backup), one photo at a time and at low priority:

* photos that are the same picture are found (by fingerprint) and kept once, every product pointing at it
* older JPEG photos are converted to WebP — smaller at the same quality, the right way up, without
  location data — and kept as they are only when WebP wouldn't save at least 5%
* the small copies used in lists are made WebP too

Whatever isn't finished by 03:30 carries on the next night. On Sunday nights, photo files no product
uses any more (left from edits, deleted products or barcode photos) are removed once they're a day old.
An administrator can also start it straight away with Optimise Now in the card editor.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .store import THUMB_SIDE, WEBP_QUALITY, CrowFood, now_ms

_LOGGER = logging.getLogger(__name__)

START = (1, 30)        # a quiet time of night
STOP = (3, 30)         # Crow Food's own backup is at 03:40
SWEEP_WEEKDAY = 6      # Sunday night
STRAY_MIN_AGE = 24 * 3600
PAUSE = 0.5            # between photos, so a Raspberry Pi doesn't notice


def _hash_file(path: str) -> str | None:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            while chunk := fh.read(1 << 20):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def _to_webp(src: str, dst: str, side: int | None, quality: int) -> int | None:
    """A photo as WebP (the right way up, no location data). Its size, or None when it can't be."""
    try:
        from PIL import Image, ImageOps

        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if side and max(im.size) > side:
                im.thumbnail((side, side), Image.LANCZOS)
            im = im.convert("RGB")
            im.save(dst, "WEBP", quality=quality, method=4)
        return os.path.getsize(dst)
    except Exception as err:  # noqa: BLE001 - keep the original
        _LOGGER.debug("Crow Food couldn't make %s smaller: %s", src, err)
        try:
            os.remove(dst)
        except OSError:
            pass
        return None


def _disk(path) -> tuple[int, int]:
    total = files = 0
    try:
        for entry in os.scandir(path):
            if entry.is_file():
                total += entry.stat().st_size
                files += 1
    except OSError:
        pass
    return total, files


class PhotoKeeper:
    """Runs the overnight work and answers the editor's storage figures."""

    def __init__(self, hass: HomeAssistant, food: CrowFood) -> None:
        self.hass = hass
        self.food = food
        self.running = False
        self.progress: dict = {}
        self._task: asyncio.Task | None = None

    @callback
    def start(self) -> list:
        return [async_track_time_change(self.hass, self._nightly, hour=START[0], minute=START[1], second=0)]

    @callback
    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    @callback
    def _nightly(self, now: datetime) -> None:
        deadline = dt_util.as_local(now).replace(hour=STOP[0], minute=STOP[1], second=0, microsecond=0)
        if deadline <= dt_util.as_local(now):
            deadline += timedelta(days=1)
        self.run(deadline=deadline, sweep=dt_util.as_local(now).weekday() == SWEEP_WEEKDAY)

    @callback
    def run(self, deadline: datetime | None = None, sweep: bool = False) -> bool:
        """Starts the work in the background. False when it's already running."""
        if self.running:
            return False
        self._task = self.hass.async_create_background_task(self._run(deadline, sweep), "crow_food photos")
        return True

    def _meta(self) -> dict:
        return self.food.data.setdefault("photos", {})

    def _products_using(self, pid: str) -> list[dict]:
        return [p for p in self.food.data["products"].values() if p.get("photo") == pid]

    def _used(self) -> set[str]:
        return {p["photo"] for p in self.food.data["products"].values() if p.get("photo")}

    def _late(self, deadline: datetime | None) -> bool:
        return bool(deadline) and dt_util.now() >= deadline

    async def _run(self, deadline: datetime | None, sweep: bool) -> None:
        food, hass = self.food, self.hass
        self.running = True
        stats = food.data.setdefault("photo_stats", {})
        done = saved = merged = 0
        self.progress = {"state": "checking"}
        try:
            meta = self._meta()
            # photos saved before photos were tracked (Crow Food 0.0.1): note them
            names = await hass.async_add_executor_job(lambda: [f.name for f in food.photos.iterdir() if f.is_file()])
            for name in names:
                m = re.match(r"^([A-Za-z0-9-]+?)(_t)?\.(jpg|webp)$", name)
                if m and not m.group(2) and m.group(1) not in meta:
                    meta[m.group(1)] = {"ext": f".{m.group(3)}", "text": f".{m.group(3)}", "v": 0, "ts": now_ms()}

            # the same picture more than once: keep one, point every product at it
            seen: dict[str, str] = {}
            for pid in sorted(meta, key=lambda k: meta[k].get("ts", 0)):
                if self._late(deadline):
                    break
                m = meta.get(pid)
                if m is None:
                    continue
                if not m.get("hash"):
                    m["hash"] = await hass.async_add_executor_job(_hash_file, str(food.photo_path(pid)))
                if not m.get("hash"):
                    continue
                keep = seen.get(m["hash"])
                if not keep:
                    seen[m["hash"]] = pid
                    continue
                rows = self._products_using(pid)
                for p in rows:
                    p["photo"] = keep
                if rows:
                    food._changed("products", rows)
                await food.async_drop_photo(pid)
                merged += 1

            # older photos converted to WebP
            todo = [pid for pid, m in meta.items() if m.get("opt") not in ("webp", "kept") or m.get("text") != ".webp"]
            self.progress = {"state": "optimising", "done": 0, "total": len(todo)}
            for n, pid in enumerate(todo, 1):
                if self._late(deadline):
                    break
                m = meta.get(pid)
                if not m:
                    continue
                gain = await self._convert(pid, m)
                saved += max(0, gain)
                done += 1
                self.progress = {"state": "optimising", "done": n, "total": len(todo)}
                rows = self._products_using(pid)
                if rows and gain >= 0:
                    food._changed("products", rows)
                await asyncio.sleep(PAUSE)

            if sweep and not self._late(deadline):
                self.progress = {"state": "tidying"}
                await self.sweep()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Crow Food: the overnight photo work stopped")
        finally:
            stats["last_run"] = now_ms()
            stats["saved"] = int(stats.get("saved", 0)) + saved
            stats["last_saved"] = saved
            stats["last_done"] = done
            stats["merged"] = int(stats.get("merged", 0)) + merged
            food._save()
            self.running = False
            self.progress = {}

    async def _convert(self, pid: str, m: dict) -> int:
        """Makes one photo (and its small copy) WebP when that's smaller. Answers the bytes saved (-1: nothing changed)."""
        food, hass = self.food, self.hass
        main = food.photo_path(pid)
        thumb = food.photo_path(pid, True)
        gain = -1
        changed = False
        if m.get("opt") not in ("webp", "kept"):
            old = await hass.async_add_executor_job(lambda: main.stat().st_size if main.is_file() else 0)
            if not old:
                return -1
            if m.get("ext") == ".webp":
                m["opt"] = "webp"
            else:
                tmp = food.photos / f".tmp_{pid}.webp"
                new = await hass.async_add_executor_job(_to_webp, str(main), str(tmp), None, WEBP_QUALITY)
                if new and new < old * 0.95:
                    dst = main.with_suffix(".webp")
                    await hass.async_add_executor_job(os.replace, str(tmp), str(dst))
                    if dst != main:
                        await hass.async_add_executor_job(lambda: main.unlink(missing_ok=True))
                    m.update({"ext": ".webp", "opt": "webp"})
                    gain = old - new
                    changed = True
                else:
                    await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
                    m["opt"] = "kept"
        if m.get("text") != ".webp":
            told = await hass.async_add_executor_job(lambda: thumb.stat().st_size if thumb.is_file() else 0)
            src = thumb if told else food.photo_path(pid)
            tmp = food.photos / f".tmp_{pid}_t.webp"
            new = await hass.async_add_executor_job(_to_webp, str(src), str(tmp), THUMB_SIDE, 80)
            if new and (not told or new < told):
                dst = food.photos / f"{re.sub(r'[^A-Za-z0-9_-]', '', pid)}_t.webp"
                await hass.async_add_executor_job(os.replace, str(tmp), str(dst))
                if told and thumb != dst:
                    await hass.async_add_executor_job(lambda: thumb.unlink(missing_ok=True))
                m["text"] = ".webp"
                gain = max(gain, 0) + max(0, told - new)
                changed = True
            else:
                await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
                m["text"] = m.get("text") or ".jpg"
        if changed:
            m["v"] = int(m.get("v", 0)) + 1
            m["size"] = await hass.async_add_executor_job(
                lambda: sum(p.stat().st_size for p in (food.photo_path(pid), food.photo_path(pid, True)) if p.is_file()))
        return gain

    async def sweep(self) -> int:
        """Removes photo files no product uses (once they're a day old). Answers how many photos went."""
        food = self.food
        used = self._used()
        meta = self._meta()
        cutoff = time.time() - STRAY_MIN_AGE

        def _find() -> list[str]:
            out = set()
            for f in food.photos.iterdir():
                m = re.match(r"^\.?(?:tmp_)?([A-Za-z0-9-]+?)(_t)?\.(jpg|webp)$", f.name)
                if not m or m.group(1) in used:
                    continue
                try:
                    if f.stat().st_mtime < cutoff:
                        out.add(m.group(1))
                except OSError:
                    pass
            return sorted(out)

        gone = await self.hass.async_add_executor_job(_find)
        for pid in gone:
            await food.async_drop_photo(pid)
        # notes about photos whose files have gone
        for pid in [k for k in meta if k not in used]:
            if not await self.hass.async_add_executor_job(food.photo_path(pid).is_file):
                meta.pop(pid, None)
        food._save()
        return len(gone)

    async def async_stats(self) -> dict:
        food = self.food
        meta = self._meta()
        used = self._used()
        size, files = await self.hass.async_add_executor_job(_disk, food.photos)
        stats = food.data.get("photo_stats") or {}
        waiting = sum(1 for k, m in meta.items() if k in used and (m.get("opt") not in ("webp", "kept") or m.get("text") != ".webp"))
        return {
            "photos": len(used), "files": files, "size": size, "saved": int(stats.get("saved", 0)),
            "merged": int(stats.get("merged", 0)), "waiting": waiting, "last_run": stats.get("last_run"),
            "running": self.running, "progress": self.progress,
            "window": f"{START[0]:02d}:{START[1]:02d}–{STOP[0]:02d}:{STOP[1]:02d}",
        }
