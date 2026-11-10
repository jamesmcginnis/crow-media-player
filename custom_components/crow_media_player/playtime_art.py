"""Play Time's artwork, kept by Home Assistant.

While an Apple TV or HomePod plays something, the picture it shows (a song's cover, a station's logo, a show's
poster) is only there for as long as it plays. A small copy of it is kept here, under the title it went with, so
Play Time can show it later, on any phone or tablet, even if no dashboard was open at the time.

Each copy is a 160 x 160 JPEG (a few kilobytes) in .storage/crow_media_player_art, and only the newest 600 are kept.
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import re
import time
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

_LOGGER = logging.getLogger(__name__)
FOLDER = "crow_media_player_art"
SIZE = 160
KEEP = 600
MAX_RAW = 250_000        # without Pillow, a picture is kept as it is only when it's this small
WAIT = 6                 # seconds after a change before the picture is taken (it often arrives after the title)
FRESH = 30 * 86400       # a title's picture is taken again after this long


def title_key(title: str) -> str:
    """The same key the card uses for a title (lower case, no bracketed parts, letters and numbers only)."""
    s = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", str(title or "").lower())
    return re.sub(r"[^a-z0-9]+", "", s)


def _file(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest()[:24] + ".jpg"


def _shrink(data: bytes) -> bytes | None:
    try:
        from PIL import Image  # noqa: PLC0415 - Home Assistant ships Pillow
    except ImportError:
        return data if len(data) <= MAX_RAW else None
    try:
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        w, h = im.size
        s = min(w, h)
        im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((SIZE, SIZE), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=80, optimize=True)
        return out.getvalue()
    except Exception as err:  # noqa: BLE001 - a picture Pillow can't read
        _LOGGER.debug("Couldn't shrink a Play Time picture: %s", err)
        return None


class PlayTimeArt:
    """Takes and keeps the pictures; hands them to the card."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.dir = hass.config.path(".storage", FOLDER)
        self._timers: dict[str, CALLBACK_TYPE] = {}
        self._last: dict[str, tuple[str, Any]] = {}    # entity -> (title key, picture) last taken
        self._taken: dict[str, float] = {}             # title key -> when (this run)
        self._from_ma: dict[str, float] = {}           # title key -> when Music Assistant's player gave its picture
        self._is_ma: set[str] = set()

    def stop(self) -> None:
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    @callback
    def seen(self, eid: str, state: str, attrs: dict, ma: bool = False) -> None:
        """A player changed: if it's playing something with a picture that's new, take it in a moment."""
        if ma:
            self._is_ma.add(eid)
        if state not in ("playing", "buffering"):
            return
        key = title_key(attrs.get("media_series_title") or attrs.get("media_title") or "")
        pic = attrs.get("entity_picture")
        if not key or not pic or self._last.get(eid) == (key, pic):
            return
        if eid in self._timers:
            self._timers.pop(eid)()
        self._timers[eid] = async_call_later(self.hass, WAIT, self._due(eid))

    def _due(self, eid: str):
        """The timer's callback, run in Home Assistant's event loop (a plain lambda would be run in a worker thread,
        where starting a task isn't allowed)."""
        @callback
        def _fire(_now: Any) -> None:
            self.hass.async_create_task(self._take(eid), f"crow_media_player play time art {eid}")
        return _fire

    async def _take(self, eid: str) -> None:
        self._timers.pop(eid, None)
        st = self.hass.states.get(eid)
        if not st or st.state not in ("playing", "buffering"):
            return
        key = title_key(st.attributes.get("media_series_title") or st.attributes.get("media_title") or "")
        pic = st.attributes.get("entity_picture")
        if not key or not pic:
            return
        prev = self._last.get(eid)
        self._last[eid] = (key, pic)
        # the same title again with the same picture, taken lately: nothing to do
        if prev and prev[0] == key and time.time() - self._taken.get(key, 0) < FRESH and prev[1] == pic:
            return
        # Music Assistant's picture for a title (a station's logo, say) isn't replaced by the Apple TV's or HomePod's
        # (often a plain AirPlay one) for the rest of the day
        ma = eid in self._is_ma
        if not ma and time.time() - self._from_ma.get(key, 0) < 86400:
            return
        comp = self.hass.data.get("media_player")
        ent = comp.get_entity(eid) if comp and hasattr(comp, "get_entity") else None
        if ent is None:
            return
        try:
            data, _ctype = await ent.async_get_media_image()
        except Exception as err:  # noqa: BLE001 - the player couldn't give its picture
            _LOGGER.debug("No picture from %s: %s", eid, err)
            return
        if not data:
            return
        small = await self.hass.async_add_executor_job(_shrink, data)
        if not small:
            return
        await self.hass.async_add_executor_job(self._write, key, small)
        self._taken[key] = time.time()
        if ma:
            self._from_ma[key] = time.time()

    def _write(self, key: str, data: bytes) -> None:
        os.makedirs(self.dir, exist_ok=True)
        path = os.path.join(self.dir, _file(key))
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        names = [n for n in os.listdir(self.dir) if n.endswith(".jpg")]
        if len(names) > KEEP:
            names.sort(key=lambda n: os.path.getmtime(os.path.join(self.dir, n)))
            for n in names[: len(names) - KEEP]:
                try:
                    os.remove(os.path.join(self.dir, n))
                except OSError:
                    pass

    def _read(self, keys: list[str]) -> dict[str, str]:
        out: dict[str, str] = {}
        for key in keys:
            path = os.path.join(self.dir, _file(key))
            try:
                with open(path, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            kind = "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "jpeg"
            out[key] = f"data:image/{kind};base64," + base64.b64encode(data).decode()
        return out

    async def async_get(self, keys: list[str]) -> dict[str, str]:
        """The pictures kept for these title keys (those there are)."""
        keys = [k for k in dict.fromkeys(keys) if k and re.fullmatch(r"[a-z0-9]{1,200}", k)][:80]
        return await self.hass.async_add_executor_job(self._read, keys)
