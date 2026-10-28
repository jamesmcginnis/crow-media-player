# Crow Media Player

Crow Media Player is a Home Assistant integration and Lovelace card for your speakers and TVs. The card is an iPhone-style media player with deep Music Assistant support, synced lyrics, AI track and film information, a library with podcasts, radio and audiobooks, Listening Recaps, PDF exports, a screensaver, a visualiser and an Apple TV remote. The integration runs alongside it on your Home Assistant server: it keeps everyone's pins, history and settings in Home Assistant, records what the house listens to even when no dashboard is open, runs the sleep timer and wake-up alarms, fetches outside services for the card and adds sensors and actions for your automations.

> **One download installs both.** The card is bundled inside the integration and is loaded into your dashboards automatically, so there's no separate resource to add.

[![HACS](https://img.shields.io/badge/HACS-Custom-orange)](https://hacs.xyz/)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.8+-blue)](https://www.home-assistant.io/)

**Step 1 — Add the repository to HACS:**

[![Open your Home Assistant instance and add this repository to HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jamesmcginnis&repository=crow-media-player&category=integration)

**Step 2 — After downloading and restarting, add the integration:**

[![Open your Home Assistant instance and start setting up Crow Media Player.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=crow_media_player)

**Step 3 — Add the card to a dashboard:**

[![Open your Home Assistant instance and show your dashboards.](https://my.home-assistant.io/badges/lovelace_dashboards.svg)](https://my.home-assistant.io/redirect/lovelace_dashboards/)

Open a dashboard, click **Edit** → **+ Add Card** and search for **Crow Media Player**.

---

## Installation

### Via HACS (Recommended)

1. Click the **Add to HACS** button above, or in Home Assistant open **HACS** → **⋮ menu** (top right) → **Custom repositories**
2. Add `https://github.com/jamesmcginnis/crow-media-player` as an **Integration** repository, then close
3. Search for **Crow Media Player** and click **Download**
4. **Restart Home Assistant**
5. Click the **Add Integration** button above, or go to **Settings → Devices & Services → + Add Integration** and search for **Crow Media Player**
6. Click **Submit**. Choose **Configure** on the integration afterwards for speakers, keys and notifications (all optional)
7. Hard-refresh your browser (Cmd+Shift+R on Mac) or close and reopen the Home Assistant app on your iPhone
8. Edit a dashboard, click **+ Add Card** and search for **Crow Media Player**

### Manual

1. Download the latest version from [Releases](https://github.com/jamesmcginnis/crow-media-player/releases/latest) (or **Code → Download ZIP** on this page)
2. Copy the `custom_components/crow_media_player` folder into `/config/custom_components/` on your Home Assistant instance
3. Restart Home Assistant and add the integration as above

---

## What the integration adds

**Everyone's data in Home Assistant.** Pins, starred stations, saved queues, pinned recaps, lyrics, AI answers and the rest are kept for each person by the integration, so they follow you from your phone to your tablet to your computer. The card editor's **Keep in Home Assistant** switches are on by default with the integration; switch one off to keep that kind of thing on the device only.

**Listening Recap that never misses a song.** Home Assistant records what plays on your speakers itself, so music played from the Music Assistant app, a voice assistant, an automation or a phone with every screen off still counts in Music History and Listening Recaps. A play counts after 30 seconds, and the same song seen by the card isn't counted twice. Choose which speakers count in **Configure** (all of them by default, plus every speaker on a Crow Media Player card).

**A sleep timer that keeps going.** With the integration, the sleep timer runs in Home Assistant, so it still turns the volume down gently and pauses with the dashboard closed and the phone locked. The card shows it counting down on every screen.

**Wake-up alarms.** Quick menu → **Alarm** sets an alarm on a speaker: at the time, it starts quietly with what's playing now (or whatever played last) and gets louder over a minute. Alarms repeat on the days you choose, can be switched off, tried out and deleted, and run with every screen off.

**Outside services fetched by Home Assistant.** Lookups for artwork, charts, podcasts, lyrics, films and TV go through your Home Assistant server instead of public relay websites, and answers are cached so the same lookup isn't made twice. Add your TheMovieDB key and Discogs token in **Configure** and they're used for every card in the house, without ever being sent to a phone.

**AI through Home Assistant.** The card's AI requests go through the integration to the conversation agent you choose in the card. Answers that can be reused (information about a song, an album or a film) are kept for a week and shared, so the same question is only asked once for the whole house.

**Made for You mixes.** Playlists made by Home Assistant from what the house listens to, at the top of Discover → Made for You: On Repeat (the most played songs of the last 30 days), Your Month in Music (made on the 1st), Forgotten Favourites (songs the house loved a while ago but hasn't played lately), Discover Weekly (new-to-you music chosen by AI from the house's taste) and mood mixes such as Sunday Morning, Focus, Dinner Party, Workout, Chill Evening and Road Trip. Every song is checked against Music Assistant, so only songs it can play are kept. They're made again each week on the day you choose in **Configure**, where you also pick which mixes to make, the AI that chooses them and whether to get a notification. Open a mix to play it, shuffle it, play it next or add it to the queue, or tap a song to play the mix from there. Mixes need Music Assistant; Home Assistant can't add playlists to Music Assistant, so they're kept by the integration.

**Resume.** When a speaker stops part-way through something (paused, turned off, or lost in a power cut), the integration remembers what it was, where it got to and how loud it was. Once the speaker has stopped, **Resume** shows in the quick menu, and the `resume` action does the same for automations: it plays it again from where it stopped, at the same volume. On a Music Assistant speaker whose queue is still on that item, Resume uses Music Assistant's own resume (the same queue and place, fading back in). Once something else has played for half a minute, there's nothing left to resume. A song that simply finished isn't kept.

**New episodes and new releases.** Twice a day, the integration checks every podcast someone has pinned for new episodes, and the artists the house plays most for new albums and singles, and can send a notification to the phones you choose.

---

## Music Assistant's queue

With Queue Actions installed (the mass_queue integration from HACS), the card uses Music Assistant's own queue features. Without it, everything works as before.

**The queue.** The Queue panel and Up Next read Music Assistant's queue directly, a page at a time as you scroll, with Music Assistant's own record of which song is playing, so there's no limit on how much of a long queue you can see and the panel always matches Music Assistant. **Play Now** on a song in the queue plays it from where it is, without moving it or adding a second copy.

**Radio Mode.** Radio Mode is Music Assistant's own "Don't stop the music" setting for each speaker: when the queue runs out, Music Assistant carries on with similar songs, and nothing restarts. It's the same setting the Music Assistant app shows. If Radio Mode was already on in the card, it's switched on for each Music Assistant speaker the first time the card sees it.

**Reordering.** When you drag songs into a new order, each song that moved goes straight to its new place with Music Assistant's own move. A song that's already loading to play next can't be moved, and the card says so.

**Announcements.** On a Music Assistant speaker, the Announce panel lets Music Assistant play the announcement itself: it pauses the music and restores it the moment the announcement ends. This needs a Home Assistant whose Music Assistant announcement action can speak a message, and a text-to-speech entity (tts.speak); other speakers, and older Home Assistant versions, are announced as before.

**Artwork.** Music Assistant's own covers come first. While a song plays with Music Assistant's cover, and for every song in the queue and the library that has one, the card uses it as it is and doesn't search anywhere else. A cover is only looked up when Music Assistant has none or its picture fails to load, and Music Assistant's search is asked before iTunes. Speakers Music Assistant doesn't run, films and TV, artist photos and radio station logos still use their own sources.

**Lyrics.** For the song playing on a Music Assistant speaker, the card uses the lyrics Music Assistant already has for it, when it has them, before asking the LRCLIB lyrics site. Timed lyrics from Music Assistant are used as they are; its untimed lyrics are used only when LRCLIB has no timed version.

**Recently Played.** The Recently Played tab lists what Music Assistant played, in the order it was played, instead of a few items of each kind taken in turn.

**Colours.** When the browser isn't allowed to read a cover's colours (some image servers don't allow it), the lyrics glow, the visualiser and the Lava Lamp screensaver use Music Assistant's colours for that cover instead of plain defaults. This needs a recent Music Assistant; otherwise they work as before.

**Pinned queues as playlists.** **Pin Queue** also saves the queue as a playlist in Music Assistant, so it's in the Music Assistant app and plays exactly the same songs. A queue pinned before can be saved to Music Assistant from its menu (**Save to Music Assistant**); each song is found in Music Assistant by its title and artist.

## Full screen

The Full Screen button sits beside the resize button in one small capsule in the card's corner (in the compact player too, and in a skin's title bar where it has one), and Full Screen is also in the quick menu. It fills the whole screen with a layout made for a tablet, a phone or a wall screen: big artwork on a background made from its colours, the title and controls, and beside it the synced lyrics scrolling along with the song, with the line being sung in the middle, and the next song underneath. On a portrait screen the lyrics sit underneath the controls. The capsule in the corner has Library, Queue, Remote (for an Apple TV), Exit and the quick menu. Tap the artwork to open the info screen, double-tap it to pin the song, swipe it to skip, or hold it for the lyrics screen; for a film or TV show on an Apple TV (or an Apple TV with nothing playing), holding it opens the remote instead. The remote is the card's own remote (touchpad, holds, Apps, Power and the keyboard) and only shows while it's open: on a tablet on its side it's a third panel beside the player and the info; on a phone (or tablet) held upright it takes the artwork's place, the same size as on the card, with the title and controls under it; on a phone on its side it takes the info's place. It sits straight on full screen's background, in the same frosted style as the rest of full screen. Hold the artwork again (or an empty part of the remote), tap the Remote button again or press Escape to close it, and full screen goes back to how it was. Remote in the quick menu opens it there too, and an Apple TV that's on with nothing playing opens full screen straight on the remote. For a film, TV show, podcast or audiobook, shuffle and repeat are replaced by back and forward 15 seconds. Tap the next song to open the queue. Previous and Next work as on the card: double-tap to go back or forward 15 seconds, hold for the queue. Tap the speaker beside the volume slider to mute. A running sleep timer shows beside the buttons in the corner, and Translate Lyrics in the quick menu puts a translation under each line. Panels such as the library and the info screen fill the whole screen, and the controls always stay on screen.

When there are no lyrics, the space shows what's known about what's playing instead, without the AI: for a song, the album it's from with its year, label, genre and format (from Discogs) and the audio quality; for a song on a radio station, the song with the album it really comes from, and the station; for a station on its own, its tags, country, language and stream; for a podcast, the episode with its description from the podcast's feed (or, for one played from Music Assistant, from the iTunes Store's podcast directory); for an audiobook, its chapters, with the one playing highlighted (tap a chapter to play it), or for an audiobook played from elsewhere (Music Assistant, another device), the book found on LibriVox by its title, with its description and chapters (named "Book 1, Chapter 2" rather than by their files), or failing that its description, genre and year from the iTunes Store; a title that reads like a book's chapter ("The War of the Worlds - Book 1 - Chapter 01") counts as an audiobook; Music Assistant's podcasts and audiobooks are recognised even when they aren't tagged as such, an "[unknown]" artist is never shown or looked up, and artwork that won't load is replaced by the podcast's or book's own picture (or the placeholder); and for a film or TV show, its overview, details and main cast from TVmaze, the iTunes Store or TMDB: for a show, the network, the years it ran, whether it's still running, the seasons, certificate, genre and rating, or the episode itself with its synopsis when the player says which one it is; for a film, the year, director, certificate, running time, genre and rating. Apps such as Apple TV often send only the title, so whether it's a film or a show is worked out from what the player sends, then a match picked in the info screen ("Not this one?"), then TVmaze, with the length as the tie-break. Under the title goes the show's network (or "Film" and the year) rather than the app's name, which is already beside the times.

When an app such as Netflix is open on an Apple TV and isn't sharing what's on, the artwork shows the app's icon (as on the card), the title is the app with the Apple TV underneath, the progress bar is hidden, and the space beside the player shows the app's icon, the Apple TV and how long it's been playing (for example "Playing for 42 min"). Apps that do share what's on (the Apple TV app, Disney+ and others) get the film or show's details instead. With nothing playing, the space beside the player is left empty. The remote's Apps panel sits straight on full screen's background, with ✕ at the top right and the search box at the bottom.

You can always get out: the exit button in the top corner always works, Escape leaves (after closing any open menu), and leaving the view or the dashboard, the browser closing the layer, editing the dashboard or switching the button off all put the card back. Full screen is never remembered, so a reload always shows the normal card. **Open in Full Screen** in the editor starts it each time the dashboard opens, for a wall tablet, but never in the card editor or while editing. The visualiser, screensaver styles inside the artwork, skins and the remote aren't offered in full screen, since they draw on the card's own artwork.

---

## Sensors

Household (on the **Crow Media Player (Household)** device):

| Entity | What it shows |
|---|---|
| Music playing | On while music is playing on any speaker |
| Listening time today | Minutes listened today |
| Listening time this week | Minutes listened since Monday |
| Tracks played today | Songs played today |
| Top artist this week | The most played artist since Monday, with the top five as attributes |
| Top track this week | The most played song since Monday |
| Last played | The last song played, with its speaker and time |
| Listening streak | Days in a row with music |
| New podcast episodes | New episodes of pinned podcasts in the last week, listed in attributes |
| New releases | New albums and singles by the house's favourite artists, listed in attributes |
| Rooms playing | How many rooms are playing right now, with the rooms (named from your areas) in attributes |
| Last music | When a song last played anywhere in the house, with the song, speaker and days since |
| Listening by room | The room with the most music today, with the minutes and songs for every room (named from your areas) in attributes |

Per speaker (one device for each speaker):

| Entity | What it shows |
|---|---|
| Sleep timer | Minutes until it pauses (unknown when no timer is set) |
| Next alarm | When the next alarm rings, with its details |
| Radio station | The station playing |
| Queue time left | Minutes left in the Music Assistant queue |
| Now watching | The film or show playing, with season and episode |
| Audiobook progress | How far through the audiobook playing |
| Up next | The next song in the Music Assistant queue, with its artist, album and artwork |
| Song ends at | When the song, episode, chapter or film playing will finish, for automations such as "when this song ends" |
| Audio quality | The format of the song streaming on a Music Assistant speaker, for example FLAC 24-bit 96 kHz, with the codec, sample rate, bit depth, whether it's lossless or hi-res, and the service in attributes (needs Queue Actions) |
| Radio Mode | On while Music Assistant's Radio Mode ("Don't stop the music") is on for the speaker (needs Queue Actions). Disabled by default: turn it on in the entity's settings if an automation needs it |
| Something to resume | On while the speaker has something stopped part way that it can carry on with, with what it is and how far through in attributes |

---

## Actions

| Action | What it does |
|---|---|
| `crow_media_player.start_sleep_timer` | Pause a speaker after some minutes, or at the end of the song, turning the volume down first |
| `crow_media_player.cancel_sleep_timer` | Turn a sleep timer off and put the volume back |
| `crow_media_player.set_alarm` | Set a wake-up alarm (returns its `alarm_id`) |
| `crow_media_player.delete_alarm` | Remove an alarm |
| `crow_media_player.play_station` | Play a radio station by name, starred in the card or from Radio Browser |
| `crow_media_player.play_pinned` | Play something pinned in the card by its name |
| `crow_media_player.play_mood` | The AI chooses songs for a mood and Music Assistant plays them |
| `crow_media_player.play_mix` | Play a Made for You mix by its name, shuffled or in order, now, next or at the end of the queue |
| `crow_media_player.make_mixes` | Make the mixes again now |
| `crow_media_player.resume` | Carry on with what a speaker was playing when it stopped, from where it stopped |
| `crow_media_player.pause_everywhere` | Pause every speaker and TV that's playing, with an optional list to leave playing |
| `crow_media_player.forget_history` | Delete every play recorded by Home Assistant |
| `crow_media_player.check_new` | Check for new episodes and releases now |

Events for automations: `crow_media_player_track_played` (every play recorded), `crow_media_player_sleep_timer_ended` and `crow_media_player_alarm`.

Example: "Bedtime" turns the bedroom lights down and starts a 30 minute sleep timer.

```yaml
actions:
  - action: light.turn_on
    target: { entity_id: light.bedroom }
    data: { brightness_pct: 20 }
  - action: crow_media_player.start_sleep_timer
    data:
      entity_id: media_player.bedroom
      minutes: 30
```

---

## The card

The card also works without the integration, keeping everything on each device. Highlights:

- An iPhone-style player in compact and full size, with skins, liquid glass, a volume HUD and artwork crossfade
- Deep Music Assistant support: the library, queue, radio mode, saved queues, Artist Radio and fast enqueue
- Synced lyrics, with translation and a lyrics booklet export
- AI Info for songs, albums, artists, films and TV, AI Recommendations, AI Search, Trivia and Ask, plus Meaning and Story for songs (how a song came about) and Spot It for films, shows and episodes (spoiler-free things to look out for while watching)
- Shuffle beside Play All on every list of songs (albums, playlists, artists, charts, Recently Played, pinned songs and recaps, saved queues, AI Recap, recommendations and search results): it plays the list once in a random order without turning on the speaker's own shuffle, so the next album still plays in order
- Podcasts, radio stations and LibriVox audiobooks, with pins and charts. A podcast's panel has Play Latest, Add All (the latest five, oldest first), Sleep, Website and Pin, and shows the podcast's own description from its feed; an audiobook's panel has Play (or Continue, from the chapter you last played), Add All (every chapter, in order), Sleep, LibriVox and Pin, with the book's cover, its real chapter titles and its genre. The sleep timer's "end of" option follows what's playing (song, episode or chapter)
- Info panels laid out like the rest of the card, with no boxes: Ask, Meaning, Story and Trivia (answers hidden until tapped), and lists that match the library's
- iOS-style confirmations, with Cancel and the action side by side
- Music History, Watch History and Listening Recaps
- PDF exports: history reports, month in music, CD and DVD case printables, episode guides and more
- A screensaver, a visualiser, an Apple TV remote and keyboard, and Sendspin playback in the browser

The card is split into a main file and parts that load when they're first used (the card editor, PDF exports, the screensaver and so on), so dashboards open faster.

### AI Features Setup (optional)

AI features are off by default. Turn on **AI Features** in the card editor and choose a conversation agent (for example OpenAI, Google Gemini, Anthropic or Ollama) that you've already set up in Home Assistant. Play a Mood uses Home Assistant's AI Task when one is set up.

---

## Requirements

- Home Assistant 2025.8 or newer
- Music Assistant is optional, but needed for the library, queue, Made for You mixes and Play a Mood
- Queue Actions (mass_queue, from HACS) is optional; with it the card uses Music Assistant's own queue, Radio Mode, playlists and resume
- The Home Assistant Companion app for notifications (optional)

## Source

The files Home Assistant serves (in custom_components/crow_media_player/www) are built for speed: minified, with compressed copies that Home Assistant sends to browsers that accept them. The readable files are in the source folder. To change the card, edit them there and run `npm install` once, then `npm run build`, in that folder.

## Support

Report problems or ask for features at [GitHub Issues](https://github.com/jamesmcginnis/crow-media-player/issues). New versions are listed under [Releases](https://github.com/jamesmcginnis/crow-media-player/releases), and HACS offers them as updates.

## Licence

MIT. See [LICENSE.md](LICENSE.md).
