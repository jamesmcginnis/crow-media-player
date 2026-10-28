"""Outside services, fetched by Home Assistant for the card.

The card used to ask iTunes, TheMovieDB, Discogs, LRCLIB, Radio Browser, MusicBrainz and the rest straight from
the phone, and for sites that block browsers it went through public relay sites. Now Home Assistant asks: the
keys for TheMovieDB and Discogs stay on the server (Configure), nothing goes through a stranger's relay, and
answers are kept for a while and shared by everyone in the house.

Only GET, only the sites the card uses, and only for people signed in to Home Assistant.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections import OrderedDict
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, FETCH_HOSTS, FETCH_MAX_BYTES, FETCH_TIMEOUT, TMDB_PLACEHOLDER

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)

CACHE_ITEMS = 500
CACHE_ITEM_MAX = 1_500_000
# how long an answer is kept (seconds): charts and lookups change slowly, lyrics never do
KEEP = {"lrclib.net": 7 * 86400, "itunes.apple.com": 6 * 3600, "api.tvmaze.com": 12 * 3600, "api.themoviedb.org": 12 * 3600,
        "api.discogs.com": 7 * 86400, "musicbrainz.org": 7 * 86400, "en.wikipedia.org": 86400, "www.wikidata.org": 86400}
KEEP_DEFAULT = 3 * 3600
# .archive.org: Cover Art Archive and archive.org answer from their storage servers (ia800309.us.archive.org…)
SUFFIXES = (".mzstatic.com", ".dzcdn.net", ".wikimedia.org", ".radio-browser.info", ".archive.org")


def allowed(host: str) -> bool:
    host = (host or "").lower()
    return host in FETCH_HOSTS or any(host.endswith(s) for s in SUFFIXES)


class FetchView(HomeAssistantView):
    url = f"/api/{DOMAIN}/fetch"
    name = f"api:{DOMAIN}:fetch"
    requires_auth = True

    def __init__(self, hass) -> None:
        self.hass = hass
        self._cache: OrderedDict[str, tuple[float, int, str, bytes]] = OrderedDict()
        self._inflight: dict[str, asyncio.Future] = {}

    @property
    def m(self) -> "CrowMedia":
        return self.hass.data[DOMAIN]

    async def get(self, request: web.Request) -> web.Response:
        if DOMAIN not in self.hass.data:
            return web.Response(status=503, text="Crow Media Player isn't set up")
        url = request.query.get("url", "")
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not allowed(p.hostname or ""):
            return web.Response(status=403, text="Not a site Crow Media Player uses")
        headers = {"User-Agent": "CrowMediaPlayer/0.1 (Home Assistant; https://github.com/jamesmcginnis/crow-media-player)",
                   "Accept": request.headers.get("Accept", "*/*")}
        url, headers = self._keys(url, headers)
        key = hashlib.sha1(url.encode()).hexdigest()
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < KEEP.get(p.hostname or "", KEEP_DEFAULT):
            self._cache.move_to_end(key)
            return web.Response(status=hit[1], content_type=hit[2].split(";")[0] or None, body=hit[3],
                                headers={"X-Crow-Cache": "hit", "Cache-Control": "no-store"})
        fut = self._inflight.get(key)
        if fut is None:
            fut = self._inflight[key] = asyncio.get_running_loop().create_task(self._fetch(url, headers))
        try:
            status, ctype, body = await fut
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Crow Media Player couldn't fetch %s: %s", p.hostname, err)
            return web.Response(status=502, text="Couldn't reach that site")
        finally:
            self._inflight.pop(key, None)
        if status == 200 and len(body) <= CACHE_ITEM_MAX:
            self._cache[key] = (time.time(), status, ctype, body)
            while len(self._cache) > CACHE_ITEMS:
                self._cache.popitem(last=False)
        return web.Response(status=status, content_type=(ctype or "application/octet-stream").split(";")[0], body=body,
                            headers={"Cache-Control": "no-store"})

    def _keys(self, url: str, headers: dict) -> tuple[str, dict]:
        """TheMovieDB's and Discogs' keys come from Configure, so the card never has them."""
        p = urlparse(url)
        host = (p.hostname or "").lower()
        o = self.m.options
        if host == "api.themoviedb.org":
            q = parse_qsl(p.query, keep_blank_values=True)
            key = str(o.get("tmdb_key") or "").strip()
            has = [v for k, v in q if k == "api_key"]
            if (not has or has[0] == TMDB_PLACEHOLDER) and key and "authorization" not in {h.lower() for h in headers}:
                q = [(k, v) for k, v in q if k != "api_key"]
                if key.startswith("ey"):
                    headers["Authorization"] = f"Bearer {key}"
                else:
                    q.append(("api_key", key))
                url = urlunparse(p._replace(query=urlencode(q)))
        elif host == "api.discogs.com" and o.get("discogs_token"):
            headers["Authorization"] = f"Discogs token={o['discogs_token']}"
        return url, headers

    async def _fetch(self, url: str, headers: dict) -> tuple[int, str, bytes]:
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(FETCH_TIMEOUT):
            async with session.get(url, headers=headers, allow_redirects=True) as r:
                if not allowed(r.url.host or ""):
                    return 403, "text/plain", b"Redirected somewhere Crow Media Player doesn't use"
                body = b""
                async for chunk in r.content.iter_chunked(65536):
                    body += chunk
                    if len(body) > FETCH_MAX_BYTES:
                        return 413, "text/plain", b"Too big"
                return r.status, r.headers.get("Content-Type", ""), body
