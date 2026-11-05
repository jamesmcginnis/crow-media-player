"""HTTP views: product photos and photo uploads.

Photos are kept in /config/crow_food/photos - deliberately not in /config/www, which is public at
/local/ to anyone. Each photo's address carries a signature made with the household's own secret,
so only the addresses Crow Food hands to signed-in cards work (and they can be cached, so lists
of products with photos load quickly).
"""
from __future__ import annotations

import logging
import os
import re
import tempfile

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .store import PHOTO_SIDE, CrowFood, FoodError

_LOGGER = logging.getLogger(__name__)
MAX_PHOTO = 25 * 1024 * 1024


def _food(hass: HomeAssistant) -> CrowFood | None:
    return hass.data.get(DOMAIN)


class PhotoView(HomeAssistantView):
    """GET /api/crow_food/photo/{photo}/{sig}.webp (or {sig}_t.webp for the small copy; .jpg for older photos)."""

    url = "/api/crow_food/photo/{photo}/{sig}"
    name = "api:crow_food:photo"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request, photo: str, sig: str) -> web.StreamResponse:
        food = _food(self.hass)
        if not food:
            return web.Response(status=503)
        sig = re.sub(r"\.(jpg|jpeg|webp)$", "", sig)
        thumb = sig.endswith("_t")
        sig = sig.removesuffix("_t")
        if not food.check_sig(photo, sig):
            return web.Response(status=404)
        path = food.photo_path(photo, thumb)
        if not await self.hass.async_add_executor_job(os.path.isfile, path):
            if not thumb:
                return web.Response(status=404)
            path = food.photo_path(photo)
            if not await self.hass.async_add_executor_job(os.path.isfile, path):
                return web.Response(status=404)
        return web.FileResponse(path, headers={
            "Content-Type": "image/webp" if path.suffix == ".webp" else "image/jpeg",
            # the address changes (?v=) when a photo is made smaller, so it can be kept a long time
            "Cache-Control": "private, max-age=2592000, immutable",
            "X-Content-Type-Options": "nosniff",
        })


async def _read_part(request: web.Request, field: str, limit: int, to_file: bool = False):
    """The named file from a multipart upload (into memory, or a temporary file for big ones)."""
    reader = await request.multipart()
    while True:
        part = await reader.next()
        if part is None:
            return None
        if part.name != field:
            continue
        size = 0
        if to_file:
            fd, path = tempfile.mkstemp(suffix=".upload")
            try:
                with os.fdopen(fd, "wb") as fh:
                    while chunk := await part.read_chunk(1024 * 1024):
                        size += len(chunk)
                        if size > limit:
                            raise FoodError("too_big", "That file is too big.")
                        fh.write(chunk)
            except Exception:
                os.unlink(path)
                raise
            return path
        buf = bytearray()
        while chunk := await part.read_chunk(256 * 1024):
            size += len(chunk)
            if size > limit:
                raise FoodError("too_big", "That photo is too big.")
            buf.extend(chunk)
        return bytes(buf)


DOC_SIDE = 2200


class PhotoUploadView(HomeAssistantView):
    """POST multipart with a 'photo' file. Answers {photo, photo_url, thumb_url}."""

    url = "/api/crow_food/upload"
    name = "api:crow_food:upload"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        food = _food(self.hass)
        if not food:
            return self.json_message("Crow Food is still starting.", 503)
        try:
            raw = await _read_part(request, "photo", MAX_PHOTO)
            if not raw:
                return self.json_message("No photo was sent.", 400)
            # a page of a receipt or an order (?doc=1) keeps more detail, so the writing can be read
            pid = await food.async_save_photo(raw, DOC_SIDE if request.query.get("doc") else PHOTO_SIDE)
        except FoodError as err:
            return self.json_message(str(err), 400)
        return self.json({"photo": pid, "photo_url": food.photo_url(pid), "thumb_url": food.photo_url(pid, True)})
