"""Save songs as a playlist in Music Assistant's own library.

Used for Save as Playlist (a speaker's queue, a Made for You mix, a chart, Music History, AI results). Home
Assistant's Music Assistant integration has no action for making playlists, so it's done through the Music
Assistant connection that integration already has open (as favourites are). Songs given only by name are found in
Music Assistant first; any that can't be found are left out and counted.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant

from .favourites import NoMusicAssistant, _get, _mass

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)
BATCH = 100
MAX_SONGS = 1000


def _ok(uri: Any) -> bool:
    """A Music Assistant address (not a web link)."""
    return bool(uri) and "://" in str(uri) and not str(uri).startswith(("http://", "https://"))


async def _queue_uris(mass: Any, queue_id: str) -> list[str]:
    """Every song in a Music Assistant queue, in order."""
    out: list[str] = []
    offset = 0
    while len(out) < MAX_SONGS:
        items = await mass.send_command("player_queues/items", queue_id=queue_id, limit=500, offset=offset) or []
        for it in items:
            mi = _get(it, "media_item") or {}
            uri = _get(mi, "uri") or _get(it, "uri")
            if uri and not str(uri).startswith(("http://", "https://")):
                out.append(str(uri))
        if len(items) < 500:
            break
        offset += 500
    return out


async def async_save_playlist(hass: HomeAssistant, m: "CrowMedia", *, name: str, uris: list[str] | None = None,
                              songs: list[dict] | None = None, queue_id: str | None = None) -> dict:
    """Make a new playlist called `name` with these songs. Returns {"uri", "name", "added", "missing"}."""
    mass = _mass(hass)
    found: list[str] = []
    missing = 0
    if queue_id:
        found = await _queue_uris(mass, queue_id)
    for u in uris or []:
        if u and not str(u).startswith(("http://", "https://")):
            found.append(str(u))
    # songs in the order given: each by its own address when it has one, otherwise found in Music Assistant by name
    given = [s for s in songs or [] if s.get("uri") or s.get("title")][:MAX_SONGS]
    if any(not _ok(s.get("uri")) for s in given):
        entry_id = m.mixes.ma_entry_id() if getattr(m, "mixes", None) else None
        if not entry_id:
            raise NoMusicAssistant("Music Assistant isn't available")
        sem = asyncio.Semaphore(4)

        async def one(s: dict) -> str | None:
            if _ok(s.get("uri")):
                return str(s["uri"])
            if not s.get("title"):
                return None
            async with sem:
                try:
                    r = await m.mixes._resolve([{"artist": s.get("artist") or "", "title": s["title"],  # noqa: SLF001
                                                 "album": s.get("album") or ""}], entry_id)
                except Exception as err:  # noqa: BLE001 - one song's search going wrong leaves just that one out
                    _LOGGER.debug("Couldn't look up %s: %s", s.get("title"), err)
                    return None
            return r[0]["uri"] if r else None

        got = await asyncio.gather(*(one(s) for s in given))
    else:
        got = [str(s["uri"]) for s in given]
    missing = sum(1 for u in got if not u)
    found += [u for u in got if u]
    # each song once, in the order given
    seen: set[str] = set()
    found = [u for u in found if not (u in seen or seen.add(u))][:MAX_SONGS]
    if not found:
        raise ValueError("None of these songs could be found in Music Assistant")
    pl = await mass.send_command("music/playlists/create_playlist", name=name)
    pid = _get(pl, "item_id")
    if pid in (None, ""):
        raise ValueError("Music Assistant didn't make the playlist")
    added = 0
    for i in range(0, len(found), BATCH):
        chunk = found[i:i + BATCH]
        try:
            await mass.send_command("music/playlists/add_playlist_tracks", db_playlist_id=pid, uris=chunk)
            added += len(chunk)
            continue
        except Exception as err:  # noqa: BLE001 - one song Music Assistant can't add stops the whole batch
            _LOGGER.debug("Adding songs to %s failed (%s); adding them one at a time", name, err)
        # one at a time, so a song Music Assistant can't add (gone from the streaming service, say) is left out
        # and the rest still go in
        for u in chunk:
            try:
                await mass.send_command("music/playlists/add_playlist_tracks", db_playlist_id=pid, uris=[u])
                added += 1
            except Exception as err:  # noqa: BLE001
                missing += 1
                _LOGGER.debug("Couldn't add %s to %s: %s", u, name, err)
    uri = _get(pl, "uri") or f"library://playlist/{pid}"
    _LOGGER.debug("Saved %d songs to the Music Assistant playlist %s (%d left out)", added, name, missing)
    return {"uri": uri, "name": name, "added": added, "missing": missing}
