"""New podcast episodes and new releases, checked by Home Assistant twice a day.

Podcasts: the ones anyone has pinned in the card. New releases: from the artists played most in the house
over the last two months (from Deezer). Each can send a notification when something new appears (Configure).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.util import dt as dt_util

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)

EPISODE_DAYS = 7
RELEASE_DAYS = 14
UA = {"User-Agent": "CrowMediaPlayer/0.1 (Home Assistant)"}


class Discover:
    def __init__(self, hass: HomeAssistant, media: "CrowMedia") -> None:
        self.hass = hass
        self.m = media
        self._unsubs = []
        self._busy = False

    def start(self) -> None:
        self._unsubs.append(async_track_time_change(self.hass, self._tick, hour=[7, 17], minute=20, second=0))
        self._unsubs.append(async_call_later(self.hass, 120, self._tick))

    def stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs.clear()

    @callback
    def _tick(self, _now=None) -> None:
        self.hass.async_create_task(self.async_check())

    def followed_podcasts(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for data in self.m.users.values():
            for p in ((data.get("crow_media_pins") or {}).get("podcasts") or []):
                if isinstance(p, dict) and p.get("collectionId"):
                    out[str(p["collectionId"])] = p
        return out

    async def async_check(self) -> None:
        if self._busy:
            return
        self._busy = True
        try:
            await self._podcasts()
            await self._releases()
        finally:
            self._busy = False
            self.m.save_house()
            self.m.changed()

    async def _get(self, url: str, params: dict | None = None):
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(20):
            async with session.get(url, params=params, headers=UA) as r:
                if r.status != 200:
                    return None
                return await r.json(content_type=None)

    async def _podcasts(self) -> None:
        store = self.m.house["podcasts"]
        cutoff = dt_util.utcnow() - timedelta(days=EPISODE_DAYS)
        found: list[dict] = []
        for cid, pod in self.followed_podcasts().items():
            try:
                data = await self._get("https://itunes.apple.com/lookup", {"id": cid, "entity": "podcastEpisode", "limit": "6"})
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Crow Media Player couldn't check podcast %s: %s", cid, err)
                continue
            for ep in (data or {}).get("results") or []:
                if ep.get("wrapperType") != "podcastEpisode":
                    continue
                when = dt_util.parse_datetime(str(ep.get("releaseDate") or ""))
                if not when or when < cutoff:
                    continue
                found.append({"podcast": pod.get("collectionName") or ep.get("collectionName") or "", "collection_id": cid,
                              "title": ep.get("trackName") or "", "released": when.isoformat(), "id": str(ep.get("trackId") or ""),
                              "url": ep.get("episodeUrl") or "", "artwork": ep.get("artworkUrl600") or pod.get("artworkUrl600") or ""})
            await asyncio.sleep(0.3)
        found.sort(key=lambda e: e["released"], reverse=True)
        seen = set(store.get("notified") or [])
        new = [e for e in found if e["id"] and e["id"] not in seen]
        store["episodes"] = found[:40]
        store["checked"] = dt_util.utcnow().isoformat()
        if new and store.get("notified") is not None and self.m.options.get("notify_podcasts"):
            for e in new[:3]:
                await self.notify(f"New episode: {e['podcast']}", e["title"], e.get("artwork"))
        store["notified"] = list((seen | {e["id"] for e in found}))[-300:]

    async def _releases(self) -> None:
        store = self.m.house["releases"]
        artists = self.m.top_artists()
        if not artists:
            store["albums"] = []
            return
        cutoff = (dt_util.now() - timedelta(days=RELEASE_DAYS)).date().isoformat()
        ids = store.setdefault("artist_ids", {})
        found: list[dict] = []
        for name in artists:
            try:
                aid = ids.get(name.lower())
                if aid is None:
                    res = await self._get("https://api.deezer.com/search/artist", {"q": name, "limit": "1"})
                    hit = ((res or {}).get("data") or [{}])[0]
                    aid = hit.get("id") if hit and hit.get("name", "").lower() == name.lower() else 0
                    ids[name.lower()] = aid
                if not aid:
                    continue
                res = await self._get(f"https://api.deezer.com/artist/{aid}/albums", {"limit": "8"})
                for al in (res or {}).get("data") or []:
                    if str(al.get("release_date") or "") >= cutoff:
                        found.append({"artist": name, "title": al.get("title") or "", "type": al.get("record_type") or "album",
                                      "released": al.get("release_date"), "id": str(al.get("id") or ""),
                                      "artwork": al.get("cover_xl") or al.get("cover_big") or ""})
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Crow Media Player couldn't check new releases by %s: %s", name, err)
            await asyncio.sleep(0.3)
        found.sort(key=lambda a: a["released"] or "", reverse=True)
        seen = set(store.get("notified") or [])
        new = [a for a in found if a["id"] not in seen]
        store["albums"] = found[:30]
        store["checked"] = dt_util.utcnow().isoformat()
        if new and store.get("notified") is not None and self.m.options.get("notify_releases"):
            for a in new[:3]:
                await self.notify(f"New from {a['artist']}", f"{a['title']} ({a['type']}) is out", a.get("artwork"))
        store["notified"] = list(seen | {a["id"] for a in found})[-400:]

    async def notify(self, title: str, message: str, image: str | None = None) -> None:
        for target in self.m.options.get("notify") or []:
            service = str(target).removeprefix("notify.")
            data = {"title": title, "message": message}
            if image:
                data["data"] = {"image": image}
            try:
                await self.hass.services.async_call("notify", service, data)
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Crow Media Player couldn't notify %s: %s", target, err)
