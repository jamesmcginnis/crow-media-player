"""Crow Media Player: an iPhone-style media player card for Home Assistant, and the integration behind it.

The integration serves the card (no dashboard resource to add), keeps each person's pins, history and
settings, records what's played on the speakers for Listening Recap, runs the sleep timer and wake-up
alarms, makes the Made for You mixes, fetches outside services (with the keys kept here), runs the AI, and has sensors and actions
for automations.
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.loader import async_get_integration

from . import ai, websocket
from .const import CARD_FILENAME, CARD_URL, DOMAIN, LAZY_FILES
from .discover import Discover
from .fetch import FetchView
from .manager import CrowMedia
from .mixes import Mixes

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

SLEEP_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id, vol.Optional("minutes"): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=1440)),
                           vol.Optional("end_of_track", default=False): cv.boolean, vol.Optional("volume_entity"): cv.entity_id})
ALARM_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id, vol.Required("time"): cv.string,
                           vol.Optional("days", default=[]): vol.All(cv.ensure_list, [vol.In(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])]),
                           vol.Optional("media_content_id"): cv.string, vol.Optional("media_content_type"): cv.string,
                           vol.Optional("volume"): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1)),
                           vol.Optional("title"): cv.string})
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


async def _async_register_card(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_card_registered"):
        return
    www = Path(__file__).parent / "www"
    card_path = www / CARD_FILENAME
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(card_path), True)]
        + [StaticPathConfig(f"/{DOMAIN}/{name}", str(www / name), True) for name in LAZY_FILES.values()])
    integration = await async_get_integration(hass, DOMAIN)

    def _digests() -> tuple[str, dict[str, str]]:
        card = hashlib.sha1(card_path.read_bytes()).hexdigest()[:10]
        mods = {mod: hashlib.sha1((www / name).read_bytes()).hexdigest()[:10] if (www / name).exists() else "0"
                for mod, name in LAZY_FILES.items()}
        return card, mods

    card, mods = await hass.async_add_executor_job(_digests)
    # the cache-buster is a fingerprint of the file, so any change reaches phones after a restart
    url = f"{CARD_URL}?v={integration.version}-{card}"
    add_extra_js_url(hass, url)
    add_extra_js_url(hass, url, es5=True)
    hass.data[f"{DOMAIN}_version"] = str(integration.version)
    hass.data[f"{DOMAIN}_modules"] = {mod: f"/{DOMAIN}/{name}?v={integration.version}-{mods[mod]}" for mod, name in LAZY_FILES.items()}
    hass.data[f"{DOMAIN}_card_registered"] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_register_card(hass)
    m = CrowMedia(hass, entry)
    await m.async_load()
    hass.data[DOMAIN] = m
    if not hass.data.get(f"{DOMAIN}_ws"):
        websocket.async_register(hass)
        hass.http.register_view(FetchView(hass))
        hass.data[f"{DOMAIN}_ws"] = True
    await m.async_start()
    m.discover = Discover(hass, m)
    m.discover.start()
    m.mixes = Mixes(hass, m)
    m.mixes.start()
    _register_services(hass)
    _remove_retired_entities(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_options_changed))
    return True


# Sensors that were taken out (Tempo, Mood, Genre, Release year, Explicit song playing, Sleep timer running):
# their old entities are removed for every speaker, rather than left behind as "unavailable"
RETIRED_KEYS = ("tempo", "mood", "genre", "release_year", "explicit", "sleep_timer_running")


def _remove_retired_entities(hass: HomeAssistant, entry: ConfigEntry) -> None:
    reg = er.async_get(hass)
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        if ent.platform == DOMAIN and any(ent.unique_id.endswith("_" + k) for k in RETIRED_KEYS):
            reg.async_remove(ent.entity_id)


async def _options_changed(hass: HomeAssistant, entry: ConfigEntry) -> None:
    m: CrowMedia = hass.data.get(DOMAIN)
    if m:
        m.push_state()
        from homeassistant.helpers.dispatcher import async_dispatcher_send
        from .manager import SIGNAL_SPEAKERS
        async_dispatcher_send(hass, SIGNAL_SPEAKERS)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    m: CrowMedia | None = hass.data.pop(DOMAIN, None)
    if m:
        m.discover.stop()
        m.mixes.stop()
        await m.async_stop()
    for svc in ("start_sleep_timer", "cancel_sleep_timer", "set_alarm", "delete_alarm", "play_station", "play_pinned",
                "play_mood", "forget_history", "check_new", "play_mix", "make_mixes", "pause_everywhere", "resume"):
        hass.services.async_remove(DOMAIN, svc)
    return ok


def _m(hass: HomeAssistant) -> CrowMedia:
    m = hass.data.get(DOMAIN)
    if not m:
        raise HomeAssistantError("Crow Media Player isn't set up")
    return m


def _register_services(hass: HomeAssistant) -> None:
    async def start_sleep(call: ServiceCall) -> None:
        d = call.data
        if not d.get("end_of_track") and not d.get("minutes"):
            raise HomeAssistantError("Give the minutes, or choose end of track")
        _m(hass).sleep_set(d["entity_id"], minutes=d.get("minutes"), end_of_track=d["end_of_track"], volume_entity=d.get("volume_entity"))

    async def cancel_sleep(call: ServiceCall) -> None:
        _m(hass).sleep_cancel(call.data["entity_id"], restore=True)

    async def set_alarm(call: ServiceCall) -> ServiceResponse:
        d = dict(call.data)
        d["days"] = [DAYS.index(x) for x in d.get("days") or []]
        try:
            a = _m(hass).alarm_save(d)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        return {"alarm_id": a["id"]}

    async def delete_alarm(call: ServiceCall) -> None:
        m = _m(hass)
        aid = call.data.get("alarm_id")
        if aid:
            m.alarm_delete(aid)
            return
        for a in list(m.house["alarms"]):
            if a["entity_id"] == call.data.get("entity_id") and (not call.data.get("time") or a["time"] == call.data["time"][:5].zfill(5)):
                m.alarm_delete(a["id"])

    async def play_station(call: ServiceCall) -> ServiceResponse:
        try:
            name = await _m(hass).async_play_station(call.data["entity_id"], call.data["name"])
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        return {"station": name}

    async def play_pinned(call: ServiceCall) -> ServiceResponse:
        m = _m(hass)
        found = m.find_pin(call.data["name"], call.data.get("kind"), call.context.user_id if call.data.get("mine") else None)
        if not found:
            raise HomeAssistantError(f"Nothing pinned called {call.data['name']}")
        try:
            await m.async_play_item(call.data["entity_id"], *found)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        return {"kind": found[0], "name": found[1].get("name") or found[1].get("title") or found[1].get("collectionName")}

    async def play_mood(call: ServiceCall) -> ServiceResponse:
        try:
            songs = await ai.async_play_mood(hass, _m(hass), call.data["entity_id"], call.data["mood"],
                                             call.data.get("count", 15), call.data.get("agent_id"))
        except (ValueError, TimeoutError) as err:
            raise HomeAssistantError(str(err) or "The AI took too long") from err
        return {"songs": songs}

    async def forget_history(call: ServiceCall) -> None:
        _m(hass).forget_plays(everything=True)

    async def check_new(call: ServiceCall) -> None:
        await _m(hass).discover.async_check()

    hass.services.async_register(DOMAIN, "start_sleep_timer", start_sleep, schema=SLEEP_SCHEMA)
    hass.services.async_register(DOMAIN, "cancel_sleep_timer", cancel_sleep, schema=vol.Schema({vol.Required("entity_id"): cv.entity_id}))
    hass.services.async_register(DOMAIN, "set_alarm", set_alarm, schema=ALARM_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete_alarm", delete_alarm, schema=vol.Schema({
        vol.Optional("alarm_id"): cv.string, vol.Optional("entity_id"): cv.entity_id, vol.Optional("time"): cv.string}))
    hass.services.async_register(DOMAIN, "play_station", play_station, schema=vol.Schema({
        vol.Required("entity_id"): cv.entity_id, vol.Required("name"): cv.string}), supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "play_pinned", play_pinned, schema=vol.Schema({
        vol.Required("entity_id"): cv.entity_id, vol.Required("name"): cv.string,
        vol.Optional("kind"): vol.In(["track", "artist", "album", "playlist", "stations", "podcasts", "audiobooks"]),
        vol.Optional("mine", default=False): cv.boolean}), supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "play_mood", play_mood, schema=vol.Schema({
        vol.Required("entity_id"): cv.entity_id, vol.Required("mood"): cv.string,
        vol.Optional("count", default=15): vol.All(vol.Coerce(int), vol.Range(min=3, max=40)),
        vol.Optional("agent_id"): cv.string}), supports_response=SupportsResponse.OPTIONAL)
    async def play_mix(call: ServiceCall) -> ServiceResponse:
        m = _m(hass)
        mix = m.mixes.find(call.data["name"])
        if not mix:
            raise HomeAssistantError(f"No mix called {call.data['name']}")
        try:
            n = await m.mixes.async_play(call.data["entity_id"], mix, mode=call.data["enqueue"], shuffle=call.data["shuffle"])
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        return {"mix": mix["title"], "songs": n}

    async def make_mixes(call: ServiceCall) -> ServiceResponse:
        m = _m(hass)
        if not m.mixes.ma_entry_id():
            raise HomeAssistantError("Made for You mixes need Music Assistant")
        return {"made": await m.mixes.async_make(call.data.get("mixes") or None)}

    async def pause_everywhere(call: ServiceCall) -> ServiceResponse:
        keep = set(call.data.get("except") or [])
        paused = [st.entity_id for st in hass.states.async_all("media_player")
                  if st.state == "playing" and st.entity_id not in keep]
        if paused:
            await hass.services.async_call("media_player", "media_pause", {"entity_id": paused}, blocking=True)
        return {"paused": paused}

    hass.services.async_register(DOMAIN, "forget_history", forget_history)
    hass.services.async_register(DOMAIN, "check_new", check_new)
    hass.services.async_register(DOMAIN, "play_mix", play_mix, schema=vol.Schema({
        vol.Required("entity_id"): cv.entity_id, vol.Required("name"): cv.string,
        vol.Optional("shuffle", default=False): cv.boolean,
        vol.Optional("enqueue", default="replace"): vol.In(["replace", "next", "add"])}), supports_response=SupportsResponse.OPTIONAL)
    from .mixes import KINDS
    hass.services.async_register(DOMAIN, "make_mixes", make_mixes, schema=vol.Schema({
        vol.Optional("mixes"): vol.All(cv.ensure_list, [vol.In(list(KINDS))])}), supports_response=SupportsResponse.OPTIONAL)
    async def resume(call: ServiceCall) -> ServiceResponse:
        try:
            return await _m(hass).async_resume(call.data["entity_id"])
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err

    hass.services.async_register(DOMAIN, "resume", resume, schema=vol.Schema({vol.Required("entity_id"): cv.entity_id}),
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "pause_everywhere", pause_everywhere, schema=vol.Schema({
        vol.Optional("except"): cv.entity_ids}), supports_response=SupportsResponse.OPTIONAL)
