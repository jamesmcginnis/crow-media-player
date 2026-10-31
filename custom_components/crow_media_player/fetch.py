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
from homeassistant.helpers.storage import Store

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
# A site that's struggling (overloaded, a gateway error, too many requests) or doesn't answer in time is asked
# again a couple of times, with a short wait between, all within one overall time limit
RETRY_STATUS = (429, 500, 502, 503, 504)
RETRY_WAITS = (0.6, 1.8)
ATTEMPT_TIMEOUT = 10
TOTAL_TIMEOUT = 26
# Lyrics found are also kept on disk, so they survive a restart of Home Assistant, and while the lyrics site is
# down any song that's had lyrics before still gets them (from the copy kept, however old)
LYRICS_HOST = "lrclib.net"
LYRICS_STORE = f"{DOMAIN}.lyrics"
LYRICS_ITEMS = 2000
LYRICS_CHARS = 12_000_000
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
        self._lyr_store: Store = Store(hass, 1, LYRICS_STORE)
        self._lyr: dict[str, list] | None = None   # key -> [saved at, content type, body]
        self._lyr_loading: asyncio.Task | None = None

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
        keep = KEEP.get(p.hostname or "", KEEP_DEFAULT)
        lyrics = (p.hostname or "").lower() == LYRICS_HOST
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < keep:
            self._cache.move_to_end(key)
            return self._answer(hit[1], hit[2], hit[3], "hit")
        # lyrics kept on disk from before (a restart wipes the memory above)
        saved = (await self._lyr_get(key)) if lyrics else None
        if saved and time.time() - saved[0] < keep:
            self._remember(key, saved[0], 200, saved[1], saved[2])
            return self._answer(200, saved[1], saved[2], "hit")
        fut = self._inflight.get(key)
        if fut is None:
            fut = self._inflight[key] = asyncio.get_running_loop().create_task(self._fetch_retry(url, headers))
        try:
            status, ctype, body = await fut
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Crow Media Player couldn't fetch %s: %s", p.hostname, err)
            status, ctype, body = 502, "text/plain", b"Couldn't reach that site"
        finally:
            self._inflight.pop(key, None)
        if status == 200 and len(body) <= CACHE_ITEM_MAX:
            self._remember(key, time.time(), status, ctype, body)
            if lyrics:
                self._lyr_put(key, ctype, body)
        elif status in RETRY_STATUS:
            # the site is struggling: an older copy is better than nothing
            old = hit or ((saved[0], 200, saved[1], saved[2]) if saved else None)
            if old:
                return self._answer(old[1], old[2], old[3], "stale")
        return self._answer(status, ctype, body)

    def _answer(self, status: int, ctype: str, body: bytes, cache: str | None = None) -> web.Response:
        headers = {"Cache-Control": "no-store"}
        if cache:
            headers["X-Crow-Cache"] = cache
        return web.Response(status=status, content_type=(ctype or "application/octet-stream").split(";")[0], body=body,
                            headers=headers)

    def _remember(self, key: str, at: float, status: int, ctype: str, body: bytes) -> None:
        self._cache[key] = (at, status, ctype, body)
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_ITEMS:
            self._cache.popitem(last=False)

    async def _fetch_retry(self, url: str, headers: dict) -> tuple[int, str, bytes]:
        """Asks the site, and asks again (twice at most) when it's struggling or doesn't answer in time."""
        loop = asyncio.get_running_loop()
        end = loop.time() + TOTAL_TIMEOUT
        last: tuple[int, str, bytes] | None = None
        err: Exception | None = None
        for attempt in range(len(RETRY_WAITS) + 1):
            left = end - loop.time()
            if left < 2:
                break
            try:
                status, ctype, body, wait = await self._fetch(url, headers, min(ATTEMPT_TIMEOUT, left))
            except Exception as e:  # noqa: BLE001  (a timeout or a connection that failed)
                err, last, wait = e, None, None
            else:
                last = (status, ctype, body)
                if status not in RETRY_STATUS:
                    return last
            if attempt >= len(RETRY_WAITS):
                break
            pause = RETRY_WAITS[attempt] if wait is None else max(RETRY_WAITS[attempt], min(wait, 3.0))
            if end - loop.time() - pause < 2:
                break
            await asyncio.sleep(pause)
        if last:
            return last
        raise err or TimeoutError("no answer")

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

    async def _fetch(self, url: str, headers: dict, timeout: float = FETCH_TIMEOUT) -> tuple[int, str, bytes, float | None]:
        """One request. Also returns how long the site asked to wait before asking again (Retry-After), if it did."""
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(timeout):
            async with session.get(url, headers=headers, allow_redirects=True) as r:
                if not allowed(r.url.host or ""):
                    return 403, "text/plain", b"Redirected somewhere Crow Media Player doesn't use", None
                wait = None
                try:
                    ra = r.headers.get("Retry-After")
                    wait = float(ra) if ra and ra.strip().replace(".", "", 1).isdigit() else None
                except ValueError:
                    wait = None
                body = b""
                async for chunk in r.content.iter_chunked(65536):
                    body += chunk
                    if len(body) > FETCH_MAX_BYTES:
                        return 413, "text/plain", b"Too big", None
                return r.status, r.headers.get("Content-Type", ""), body, wait

    # ── lyrics kept on disk ──
    async def _lyr_ready(self) -> dict:
        if self._lyr is not None:
            return self._lyr
        if self._lyr_loading is None:
            async def load() -> None:
                try:
                    data = await self._lyr_store.async_load()
                except Exception as err:  # noqa: BLE001
                    _LOGGER.debug("Crow Media Player couldn't read the saved lyrics: %s", err)
                    data = None
                self._lyr = data.get("items", {}) if isinstance(data, dict) and isinstance(data.get("items"), dict) else {}
            self._lyr_loading = self.hass.async_create_task(load())
        await self._lyr_loading
        return self._lyr if self._lyr is not None else {}

    async def _lyr_get(self, key: str) -> tuple[float, str, bytes] | None:
        item = (await self._lyr_ready()).get(key)
        if not (isinstance(item, list) and len(item) == 3):
            return None
        try:
            return float(item[0]), str(item[1]), str(item[2]).encode("utf-8")
        except (TypeError, ValueError):
            return None

    def _lyr_put(self, key: str, ctype: str, body: bytes) -> None:
        if self._lyr is None:
            return
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return
        # an empty answer (no songs found) isn't worth keeping: the site may have the song later
        if text.strip() in ("", "[]", "{}", "null"):
            return
        self._lyr.pop(key, None)
        self._lyr[key] = [time.time(), ctype, text]
        # within its limits: the oldest go first
        size = sum(len(v[2]) for v in self._lyr.values())
        if len(self._lyr) > LYRICS_ITEMS or size > LYRICS_CHARS:
            for k in sorted(self._lyr, key=lambda k: self._lyr[k][0]):
                if len(self._lyr) <= LYRICS_ITEMS * 0.9 and size <= LYRICS_CHARS * 0.9:
                    break
                size -= len(self._lyr.pop(k)[2])
        self._lyr_store.async_delay_save(lambda: {"items": self._lyr or {}}, 30)
