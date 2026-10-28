"""What the card asks the integration for, over Home Assistant's websocket."""
from __future__ import annotations

import functools
import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import ai
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def _m(hass: HomeAssistant):
    m = hass.data.get(DOMAIN)
    if not m:
        raise websocket_api.HomeAssistantError("Crow Media Player isn't set up")
    return m


def _errors(fn):
    @functools.wraps(fn)
    async def wrapper(hass, connection, msg):
        try:
            await fn(hass, connection, msg)
        except (ValueError, TimeoutError) as err:
            connection.send_error(msg["id"], "invalid_format" if isinstance(err, ValueError) else "timeout",
                                  str(err) or "That took too long")
    return wrapper


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_info, ws_subscribe, ws_data_get, ws_data_set, ws_log, ws_log_forget, ws_register, ws_sleep_set,
                ws_sleep_cancel, ws_alarm_save, ws_alarm_delete, ws_alarm_test, ws_ai, ws_ai_forget, ws_discover,
                ws_mixes, ws_mixes_make, ws_mixes_play, ws_resume):
        websocket_api.async_register_command(hass, cmd)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/info"})
@websocket_api.async_response
async def ws_info(hass, connection, msg) -> None:
    m = _m(hass)
    connection.send_result(msg["id"], {"version": hass.data.get(f"{DOMAIN}_version"), "modules": hass.data.get(f"{DOMAIN}_modules", {}),
                                       "is_admin": connection.user.is_admin, **m.state_view()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(hass, connection, msg) -> None:
    m = _m(hass)

    @callback
    def send(event: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], event))

    connection.subscriptions[msg["id"]] = m.subscribe(send)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/data/get", vol.Required("key"): vol.All(str, vol.Length(max=80))})
@websocket_api.async_response
async def ws_data_get(hass, connection, msg) -> None:
    value = await _m(hass).async_data_get(connection.user.id, msg["key"])
    connection.send_result(msg["id"], {"value": value})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/data/set", vol.Required("key"): vol.All(str, vol.Length(max=80)),
                                  vol.Required("value"): object})
@websocket_api.async_response
@_errors
async def ws_data_set(hass, connection, msg) -> None:
    _m(hass).data_set(connection.user.id, msg["key"], msg["value"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/log", vol.Optional("since", default=0): vol.Coerce(int)})
@websocket_api.async_response
async def ws_log(hass, connection, msg) -> None:
    connection.send_result(msg["id"], {"entries": _m(hass).log_since(msg["since"])})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/log/forget", vol.Optional("keys"): [str],
                                  vol.Optional("everything", default=False): bool})
@websocket_api.async_response
async def ws_log_forget(hass, connection, msg) -> None:
    if msg["everything"] and not connection.user.is_admin:
        raise websocket_api.Unauthorized()
    _m(hass).forget_plays(msg.get("keys"), everything=msg["everything"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/register", vol.Required("entities"): [str]})
@websocket_api.async_response
async def ws_register(hass, connection, msg) -> None:
    _m(hass).register_speakers(msg["entities"][:20])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/sleep/set", vol.Required("entity_id"): str,
                                  vol.Optional("minutes"): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=24 * 60)),
                                  vol.Optional("end_of_track", default=False): bool, vol.Optional("volume_entity"): str})
@websocket_api.async_response
@_errors
async def ws_sleep_set(hass, connection, msg) -> None:
    if not msg["entity_id"].startswith("media_player."):
        raise ValueError("Choose a speaker")
    view = _m(hass).sleep_set(msg["entity_id"], minutes=msg.get("minutes"), end_of_track=msg["end_of_track"],
                              volume_entity=msg.get("volume_entity"))
    connection.send_result(msg["id"], {"timer": view})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/sleep/cancel", vol.Required("entity_id"): str})
@websocket_api.async_response
async def ws_sleep_cancel(hass, connection, msg) -> None:
    _m(hass).sleep_cancel(msg["entity_id"], restore=True)
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarm/save", vol.Required("alarm"): dict})
@websocket_api.async_response
@_errors
async def ws_alarm_save(hass, connection, msg) -> None:
    connection.send_result(msg["id"], {"alarm": _m(hass).alarm_save(msg["alarm"]), "alarms": _m(hass).alarms_view()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarm/delete", vol.Required("id"): str})
@websocket_api.async_response
async def ws_alarm_delete(hass, connection, msg) -> None:
    _m(hass).alarm_delete(msg["id"])
    connection.send_result(msg["id"], {"alarms": _m(hass).alarms_view()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarm/test", vol.Required("id"): str})
@websocket_api.async_response
@_errors
async def ws_alarm_test(hass, connection, msg) -> None:
    m = _m(hass)
    a = next((x for x in m.house["alarms"] if x["id"] == msg["id"]), None)
    if not a:
        raise ValueError("That alarm has gone")
    hass.async_create_task(m.async_ring(a))
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/ai", vol.Required("text"): vol.All(str, vol.Length(max=60000)),
                                  vol.Optional("agent_id"): vol.Any(str, None), vol.Optional("language"): vol.Any(str, None),
                                  vol.Optional("cache", default=False): bool})
@websocket_api.async_response
async def ws_ai(hass, connection, msg) -> None:
    m = _m(hass)
    try:
        out = await ai.async_process(hass, m, connection.context(msg), msg["text"], msg.get("agent_id"), msg.get("language"), msg["cache"])
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", "The AI took too long to answer")
        return
    except Exception as err:  # noqa: BLE001 - the card shows its own friendly message
        connection.send_error(msg["id"], "ai_failed", str(err) or "The AI couldn't answer")
        return
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/ai/forget"})
@websocket_api.async_response
async def ws_ai_forget(hass, connection, msg) -> None:
    connection.send_result(msg["id"], {"forgotten": ai.forget(_m(hass))})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/discover"})
@websocket_api.async_response
async def ws_discover(hass, connection, msg) -> None:
    m = _m(hass)
    connection.send_result(msg["id"], {"episodes": m.house["podcasts"].get("episodes", []),
                                       "releases": m.house["releases"].get("albums", [])})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/mixes"})
@websocket_api.async_response
async def ws_mixes(hass, connection, msg) -> None:
    connection.send_result(msg["id"], _m(hass).mixes.view())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/mixes/make", vol.Optional("kinds"): [str]})
@websocket_api.async_response
async def ws_mixes_make(hass, connection, msg) -> None:
    m = _m(hass)
    if not connection.user.is_admin:
        raise websocket_api.Unauthorized()
    if not m.mixes.ma_entry_id():
        connection.send_error(msg["id"], "no_music_assistant", "Made for You mixes need Music Assistant")
        return
    hass.async_create_task(m.mixes.async_make(msg.get("kinds") or None))
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/mixes/play", vol.Required("id"): str, vol.Required("entity_id"): str,
                                  vol.Optional("mode", default="replace"): vol.In(["replace", "next", "add"]),
                                  vol.Optional("shuffle", default=False): bool, vol.Optional("start", default=0): vol.Coerce(int)})
@websocket_api.async_response
async def ws_mixes_play(hass, connection, msg) -> None:
    m = _m(hass)
    mix = m.house["mixes"].get(msg["id"])
    if not mix:
        connection.send_error(msg["id"], "not_found", "That mix has gone")
        return
    try:
        n = await m.mixes.async_play(msg["entity_id"], mix, mode=msg["mode"], shuffle=msg["shuffle"], start=msg["start"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    except Exception as err:  # noqa: BLE001 - Music Assistant's own message
        connection.send_error(msg["id"], "play_failed", str(err) or "Music Assistant couldn't play it")
        return
    connection.send_result(msg["id"], {"songs": n})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/resume", vol.Required("entity_id"): str})
@websocket_api.async_response
async def ws_resume(hass, connection, msg) -> None:
    try:
        out = await _m(hass).async_resume(msg["entity_id"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    except Exception as err:  # noqa: BLE001 - the speaker's own message
        connection.send_error(msg["id"], "resume_failed", str(err) or "The speaker couldn't carry on")
        return
    connection.send_result(msg["id"], out)
