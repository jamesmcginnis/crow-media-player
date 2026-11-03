"""Music Assistant favourites: add a song (or an album, artist, playlist or station) to them, take it off, or ask.

Home Assistant's Music Assistant integration has no action for this (only a button that favourites the song
playing now), so it's asked through the Music Assistant connection that integration already has open. If that
isn't there (Music Assistant not loaded, or a later version keeps it elsewhere), the card uses Queue Actions or
Music Assistant's own button instead.
"""
from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)
TYPES = ("track", "album", "artist", "playlist", "radio", "podcast", "audiobook")


class NoMusicAssistant(Exception):
    """Music Assistant's connection can't be used from here."""


def _mass(hass: HomeAssistant) -> Any:
    for entry in hass.config_entries.async_entries("music_assistant"):
        if entry.state is not ConfigEntryState.LOADED:
            continue
        mass = getattr(getattr(entry, "runtime_data", None), "mass", None)
        if mass is not None and hasattr(mass, "send_command"):
            return mass
    raise NoMusicAssistant("Music Assistant isn't available")


def _get(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


async def _library(mass: Any, uri: str) -> tuple[Any, str | None, bool]:
    """The library copy of an item: (its id, media type, whether it's a favourite). (None, type, False) when it
    isn't in the library."""
    item = await mass.send_command("music/item_by_uri", uri=uri)
    mtype = str(_get(item, "media_type") or "track")
    mtype = getattr(mtype, "value", mtype)
    if _get(item, "provider") == "library":
        return _get(item, "item_id"), mtype, bool(_get(item, "favorite"))
    lib = await mass.send_command("music/get_library_item", media_type=mtype, item_id=_get(item, "item_id"),
                                  provider_instance_id_or_domain=_get(item, "provider"))
    if not lib:
        return None, mtype, False
    return _get(lib, "item_id"), mtype, bool(_get(lib, "favorite"))


def _norm(s: Any) -> str:
    s = re.sub(r"\s*[\(\[].*?[\)\]]", "", str(s or "").lower())
    s = re.sub(r"\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


async def _find_song(hass: HomeAssistant, entry_id: str, title: str, artist: str, album: str) -> str | None:
    """A song in Music Assistant when the artist given may not be its own (a soundtrack's tracklist lists the
    album's artist): searched by its name alone, the one on the same album first, then one whose artist is close,
    then the only one with that name."""
    try:
        resp = await hass.services.async_call("music_assistant", "search", {
            "config_entry_id": entry_id, "name": title, "media_type": ["track"], "limit": 25},
            blocking=True, return_response=True)
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Music Assistant search for %s failed: %s", title, err)
        return None
    want, art, alb = _norm(title), _norm(artist), _norm(album)
    same = [t for t in (resp or {}).get("tracks") or [] if t.get("uri") and _norm(t.get("name")) == want]
    if not same:
        return None
    if alb:
        for t in same:
            n = _norm((t.get("album") or {}).get("name"))
            if n and (n == alb or n.startswith(alb) or alb.startswith(n)):
                return t["uri"]
    if art:
        for t in same:
            if any(a and (a in art or art in a) for a in (_norm(x.get("name")) for x in t.get("artists") or [])):
                return t["uri"]
    return same[0]["uri"] if len(same) == 1 else None


async def _find_other(hass: HomeAssistant, entry_id: str, mtype: str, name: str, artist: str) -> str | None:
    """An album, artist, playlist or station in Music Assistant, by its name (and, for an album, its artist)."""
    data = {"config_entry_id": entry_id, "name": name, "media_type": [mtype], "limit": 15}
    if mtype == "album" and artist:
        data["artist"] = artist
    try:
        resp = await hass.services.async_call("music_assistant", "search", data, blocking=True, return_response=True)
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Music Assistant search for %s %s failed: %s", mtype, name, err)
        return None
    key = {"album": "albums", "artist": "artists", "playlist": "playlists", "radio": "radio"}.get(mtype, mtype + "s")
    want, art = _norm(name), _norm(artist)
    same = [x for x in (resp or {}).get(key) or [] if x.get("uri") and _norm(x.get("name")) == want]
    if not same:
        # a version of the name (a deluxe edition, say)
        same = [x for x in (resp or {}).get(key) or [] if x.get("uri") and _norm(x.get("name")).startswith(want)]
    if mtype == "album" and art:
        for x in same:
            if any(a and (a in art or art in a) for a in (_norm(y.get("name")) for y in x.get("artists") or [])):
                return x["uri"]
    return same[0]["uri"] if same else None


async def async_favourite(hass: HomeAssistant, m: "CrowMedia", *, uri: str | None, artist: str | None,
                          title: str | None, media_type: str = "track", favourite: bool | None = None,
                          album: str | None = None) -> dict:
    """Add (favourite=True), take off (False) or just ask (None). Returns {"favourite", "uri"}."""
    mass = _mass(hass)
    if not uri:
        # a song known only by its name (an Apple TV or HomePod playing it, say): found in Music Assistant first
        entry_id = m.mixes.ma_entry_id() if getattr(m, "mixes", None) else None
        if not (entry_id and title):
            raise ValueError("Couldn't find that song in Music Assistant")
        if media_type != "track":
            # an album, artist, playlist or station: looked for as one (never as a song with that name)
            uri = await _find_other(hass, entry_id, media_type, title, artist or "")
            what = {"album": "That album", "artist": "That artist", "playlist": "That playlist", "radio": "That station",
                    "podcast": "That podcast"}.get(media_type, "That")
            if not uri:
                raise ValueError(f"{what} (“{title}”) isn’t in Music Assistant or your streaming services, so it can’t be a favourite")
        else:
            found = await m.mixes._resolve([{"artist": artist, "title": title, "album": album or ""}], entry_id) if artist else []  # noqa: SLF001
            uri = found[0]["uri"] if found else await _find_song(hass, entry_id, title, artist or "", album or "")
            if not uri:
                raise ValueError(f"“{title}” isn’t in Music Assistant or your streaming services, so it can’t be a favourite")
    lib_id, mtype, now = await _library(mass, uri)
    if favourite is None or favourite == now:
        return {"favourite": now, "uri": uri}
    if favourite:
        await mass.send_command("music/favorites/add_item", item=uri)
        if lib_id is None:
            try:
                lib_id = (await _library(mass, uri))[0]
            except Exception:  # noqa: BLE001 - only used to find it again in the library
                lib_id = None
    elif lib_id is not None:
        await mass.send_command("music/favorites/remove_item", media_type=mtype or media_type, library_item_id=lib_id)
    kind = mtype or media_type
    _remember(m, kind, [uri, f"library://{kind}/{lib_id}" if lib_id is not None else None,
                        f"n:{kind}|{_norm(artist)}|{_norm(title)}" if title else None], favourite)
    _LOGGER.debug("%s %s Music Assistant favourites", uri, "added to" if favourite else "removed from")
    return {"favourite": favourite, "uri": uri, "at": int(time.time() * 1000) if favourite else None}


def _remember(m: "CrowMedia", kind: str, keys: list, on: bool) -> None:
    """When each favourite was added from the card (Music Assistant doesn't keep it), so lists can put the newest
    first. Kept by its address, its library address and its name; the newest 3000."""
    times = m.house.setdefault("fav_times", {})
    now = int(time.time() * 1000)
    for k in keys:
        if not k:
            continue
        if on:
            times[k] = now
        else:
            times.pop(k, None)
    if len(times) > 3000:
        for k in sorted(times, key=times.get)[: len(times) - 3000]:
            del times[k]
    m.save_house()


def favourite_times(m: "CrowMedia") -> dict:
    return dict(m.house.get("fav_times") or {})
