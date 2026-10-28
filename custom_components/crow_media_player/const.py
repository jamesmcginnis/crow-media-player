"""Constants for Crow Media Player."""
from __future__ import annotations

DOMAIN = "crow_media_player"
NAME = "Crow Media Player"

CARD_FILENAME = "crow-media-player-card.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"
# the files the card loads when a feature is first used (module name -> file)
LAZY_FILES = {
    "editor": "crow-media-editor.js",
    "fullscreen": "crow-media-fullscreen.js",
    "pdf": "crow-media-pdf.js",
    "saver": "crow-media-screensaver.js",
    "viz": "crow-media-visualiser.js",
    "video": "crow-media-video.js",
    "panels": "crow-media-panels.js",
    "library": "crow-media-library.js",
    "sendspin": "crow-media-sendspin.js",
}

STORAGE_VERSION = 1
# each person's data (pins, starred stations, saved queues, lyrics, AI answers, their own listening log…)
STORE_USERS = f"{DOMAIN}.users"
# the household: plays recorded by Home Assistant, sleep timers, alarms, what's been seen of podcasts and releases
STORE_HOUSE = f"{DOMAIN}.household"
# answers from outside services and the AI, shared by everyone
STORE_CACHE = f"{DOMAIN}.cache"

MAX_USER_VALUE_BYTES = 6_000_000

# Listening history
LOG_DAYS = 90
LOG_MAX = 4000
LOG_AFTER_SECONDS = 30        # a song counts once it's played this long (or to the end, if shorter)
LOG_DEDUP_MS = 10 * 60 * 1000
DEFAULT_TRACK_MS = 210_000

# Sleep timer
SLEEP_FADE_SECONDS = 30
SLEEP_FADE_TRACK_SECONDS = 12

# Alarms
ALARM_RAMP_SECONDS = 60

# Outside services the card may fetch through Home Assistant
FETCH_HOSTS = (
    "itunes.apple.com", "rss.marketingtools.apple.com", "rss.applemarketingtools.com", "api.tvmaze.com",
    "musicbrainz.org", "coverartarchive.org", "en.wikipedia.org", "www.wikidata.org", "api.themoviedb.org",
    "image.tmdb.org", "api.discogs.com", "lrclib.net", "api.deezer.com", "archive.org", "librivox.org",
    "raw.githubusercontent.com", "de1.api.radio-browser.info", "de2.api.radio-browser.info",
    "nl1.api.radio-browser.info", "at1.api.radio-browser.info", "all.api.radio-browser.info",
    "upload.wikimedia.org", "commons.wikimedia.org", "is1-ssl.mzstatic.com", "is2-ssl.mzstatic.com",
    "is3-ssl.mzstatic.com", "is4-ssl.mzstatic.com", "is5-ssl.mzstatic.com", "e-cdns-images.dzcdn.net",
    "cdn-images.dzcdn.net", "api.radio-browser.info",
)
FETCH_MAX_BYTES = 8_000_000
FETCH_TIMEOUT = 20
TMDB_PLACEHOLDER = "__crow_media_player__"
