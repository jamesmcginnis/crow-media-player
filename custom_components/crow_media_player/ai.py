"""AI for Crow Media Player, run by Home Assistant.

The card's AI requests (track info, recommendations, Ask, Trivia and the rest) go through here to the
conversation agent chosen in the card. Answers that can be reused are kept for a week and shared by
everyone, so the same question about the same song is only ever asked once. Play a Mood (an action for
automations) asks the AI for songs and plays them through Music Assistant.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from typing import TYPE_CHECKING

from homeassistant.core import Context, HomeAssistant

if TYPE_CHECKING:
    from .manager import CrowMedia

_LOGGER = logging.getLogger(__name__)

KEEP_SECONDS = 7 * 86400
MAX_ITEMS = 1500
TIMEOUT = 90


async def async_process(hass: HomeAssistant, m: "CrowMedia", context: Context, text: str, agent_id: str | None,
                        language: str | None, cache: bool) -> dict:
    """The same answer as Home Assistant's own conversation/process, kept for a week when it can be reused."""
    from homeassistant.components.conversation import async_converse
    key = hashlib.sha256(f"{agent_id or ''}\n{language or ''}\n{text}".encode()).hexdigest()[:40]
    store = m.cache["ai"]
    if cache:
        hit = store.get(key)
        if hit and time.time() - hit.get("ts", 0) < KEEP_SECONDS:
            return hit["r"]
    async with asyncio.timeout(TIMEOUT):
        result = await async_converse(hass, text, None, context, language, agent_id)
    out = result.as_dict()
    resp = out.get("response") or {}
    if cache and resp.get("response_type") != "error" and ((resp.get("speech") or {}).get("plain") or {}).get("speech"):
        store[key] = {"ts": time.time(), "r": out}
        if len(store) > MAX_ITEMS:
            for k in sorted(store, key=lambda k: store[k].get("ts", 0))[: len(store) - MAX_ITEMS + 100]:
                del store[k]
        m.save_cache()
    return out


def forget(m: "CrowMedia") -> int:
    n = len(m.cache["ai"])
    m.cache["ai"] = {}
    m.save_cache()
    return n


def _task_entity(hass: HomeAssistant) -> str | None:
    try:
        from homeassistant.components.ai_task.const import DATA_PREFERENCES
        return getattr(hass.data.get(DATA_PREFERENCES), "gen_data_entity_id", None)
    except Exception:  # noqa: BLE001
        return None


async def _ask(hass: HomeAssistant, instructions: str, agent_id: str | None) -> str:
    """An AI Task when Home Assistant has one, otherwise the conversation agent."""
    entity = _task_entity(hass)
    if entity and not agent_id:
        from homeassistant.components.ai_task import async_generate_data
        async with asyncio.timeout(TIMEOUT):
            res = await async_generate_data(hass, task_name="Crow Media Player", entity_id=entity, instructions=instructions)
        return res.data if isinstance(res.data, str) else json.dumps(res.data)
    from homeassistant.components.conversation import async_converse
    async with asyncio.timeout(TIMEOUT):
        result = await async_converse(hass, instructions, None, Context(), None, agent_id)
    return ((result.as_dict().get("response") or {}).get("speech") or {}).get("plain", {}).get("speech", "")


def _songs(text: str) -> list[dict]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip(), flags=re.S)
    try:
        data = json.loads(text)
    except ValueError:
        a, b = text.find("["), text.rfind("]")
        data = json.loads(text[a:b + 1]) if a != -1 and b > a else []
    out = []
    for x in data if isinstance(data, list) else []:
        if isinstance(x, dict) and x.get("title") and x.get("artist"):
            out.append({"artist": str(x["artist"])[:120], "title": str(x["title"])[:160]})
    return out


async def async_play_mood(hass: HomeAssistant, m: "CrowMedia", entity_id: str, mood: str, count: int = 15,
                          agent_id: str | None = None) -> list[dict]:
    """Ask the AI for songs that fit a mood, and play them through Music Assistant."""
    if not m._is_ma(entity_id):  # noqa: SLF001
        raise ValueError("Play a Mood needs a Music Assistant speaker")
    liked = ", ".join(m.top_artists(90, 10))
    answer = await _ask(hass, (
        f"Suggest {count} songs for this mood: \"{mood[:200]}\". Mix well-known and lesser-known songs, no repeats of "
        "the same artist more than twice." + (f" The household often listens to {liked}; lean towards things they'd like." if liked else "")
        + " Reply ONLY with a JSON array like [{\"artist\": \"…\", \"title\": \"…\"}]."), agent_id)
    songs = _songs(answer)[:count]
    if not songs:
        raise ValueError("The AI didn't suggest any songs")
    for i, s in enumerate(songs):
        try:
            await hass.services.async_call("music_assistant", "play_media", {
                "entity_id": entity_id, "media_id": s["title"], "artist": s["artist"], "media_type": "track",
                "enqueue": "replace" if i == 0 else "add"}, blocking=True)
        except Exception as err:  # noqa: BLE001 - a song Music Assistant can't find is skipped
            _LOGGER.debug("Play a Mood: skipped %s - %s: %s", s["artist"], s["title"], err)
    return songs
