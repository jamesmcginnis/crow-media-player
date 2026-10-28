"""Config flow for Crow Media Player: one step to add it, and Configure for the household's choices."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import DOMAIN, NAME
from .mixes import DAYS, DEFAULT_KINDS, KINDS

OPT_SPEAKERS = "speakers"
OPT_TMDB = "tmdb_key"
OPT_DISCOGS = "discogs_token"
OPT_NOTIFY = "notify"
OPT_NOTIFY_PODCASTS = "notify_podcasts"
OPT_NOTIFY_RELEASES = "notify_releases"
OPT_MIXES = "mixes"
OPT_MIX_KINDS = "mix_kinds"
OPT_MIX_DAY = "mix_day"
OPT_MIX_AGENT = "mix_agent"
OPT_NOTIFY_MIXES = "notify_mixes"


class CrowMediaPlayerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Adding it takes one step - the card's editor and Configure do the rest."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return CrowMediaPlayerOptionsFlow()


class CrowMediaPlayerOptionsFlow(config_entries.OptionsFlow):
    """The household's choices: which speakers are recorded, keys for outside services, notifications."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data={k: v for k, v in user_input.items() if v not in (None, "")})
        o = self.config_entry.options
        notify_services = sorted(f"notify.{s}" for s in self.hass.services.async_services().get("notify", {})
                                 if s not in ("send_message", "persistent_notification"))
        schema = vol.Schema({
            vol.Optional(OPT_SPEAKERS, description={"suggested_value": o.get(OPT_SPEAKERS, [])}):
                selector.EntitySelector(selector.EntitySelectorConfig(domain="media_player", multiple=True)),
            vol.Optional(OPT_TMDB, description={"suggested_value": o.get(OPT_TMDB, "")}):
                selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
            vol.Optional(OPT_DISCOGS, description={"suggested_value": o.get(OPT_DISCOGS, "")}):
                selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
            vol.Optional(OPT_NOTIFY, description={"suggested_value": o.get(OPT_NOTIFY, [])}):
                selector.SelectSelector(selector.SelectSelectorConfig(options=notify_services, multiple=True, custom_value=True)),
            vol.Optional(OPT_NOTIFY_PODCASTS, default=o.get(OPT_NOTIFY_PODCASTS, False)): selector.BooleanSelector(),
            vol.Optional(OPT_NOTIFY_RELEASES, default=o.get(OPT_NOTIFY_RELEASES, False)): selector.BooleanSelector(),
            vol.Optional(OPT_MIXES, default=o.get(OPT_MIXES, True)): selector.BooleanSelector(),
            vol.Optional(OPT_MIX_KINDS, default=o.get(OPT_MIX_KINDS, DEFAULT_KINDS)): selector.SelectSelector(selector.SelectSelectorConfig(
                options=list(KINDS), multiple=True, translation_key="mix_kinds")),
            vol.Optional(OPT_MIX_DAY, default=o.get(OPT_MIX_DAY, "mon")): selector.SelectSelector(selector.SelectSelectorConfig(
                options=DAYS, translation_key="mix_day", mode=selector.SelectSelectorMode.DROPDOWN)),
            vol.Optional(OPT_MIX_AGENT, description={"suggested_value": o.get(OPT_MIX_AGENT)}): selector.ConversationAgentSelector(),
            vol.Optional(OPT_NOTIFY_MIXES, default=o.get(OPT_NOTIFY_MIXES, False)): selector.BooleanSelector(),
        })
        return self.async_show_form(step_id="init", data_schema=schema)
