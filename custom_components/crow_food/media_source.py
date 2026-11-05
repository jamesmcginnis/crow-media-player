"""Lets Home Assistant's AI Task look at a product photo (for Photo to Product and the expiry estimate).

Nothing is listed here (the folder in the Media panel is empty): a photo can only be reached by its
random id.
"""
from __future__ import annotations

from homeassistant.components.media_player import MediaClass, MediaType
from homeassistant.components.media_source import BrowseMediaSource, MediaSource, MediaSourceItem, PlayMedia, Unresolvable
from homeassistant.core import HomeAssistant

from .const import DOMAIN, NAME


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    return CrowFoodMediaSource(hass)


class CrowFoodMediaSource(MediaSource):
    name = NAME

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(DOMAIN)
        self.hass = hass

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        food = self.hass.data.get(DOMAIN)
        pid = item.identifier or ""
        if not food or not pid:
            raise Unresolvable("Not found")
        path = food.photo_path(pid)
        if not await self.hass.async_add_executor_job(path.is_file):
            raise Unresolvable("Not found")
        return PlayMedia(food.photo_url(pid), food.photo_mime(pid), path=path)

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        return BrowseMediaSource(domain=DOMAIN, identifier=None, media_class=MediaClass.DIRECTORY,
                                 media_content_type=MediaType.IMAGE, title=f"{NAME} (private)", can_play=False,
                                 can_expand=True, children=[])
