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

## Contents

- [Installation](#installation)
- [What the integration adds](#what-the-integration-adds)
- [Music Assistant's queue](#music-assistants-queue)
- [Full screen](#full-screen)
- [Sensors](#sensors) and [Actions](#actions)
- [The card](#the-card): [the player](#the-player), [keyboard shortcuts](#keyboard-shortcuts), [search](#search), [quick menu](#quick-menu-), [visualiser](#visualiser), [screensaver](#screensaver), [skins](#skins), [lyrics](#synced-lyrics), [info panels](#info-panels), [TMDB](#movies--tv-tmdb), [Discover](#discover-the-library), [pins](#pins), [Vibe](#vibe), [the queue](#the-queue), [several rooms](#several-rooms-at-once), [play on this device](#play-on-this-device), [recaps](#music-recap-and-video-recap), [sharing](#sharing), [PDFs](#export-to-pdf), [Announce](#announce-and-send-message), [Apple TV remote](#apple-tv-remote), [AI features](#ai-features), [Keep in Home Assistant](#keep-in-home-assistant), [visual editor](#visual-editor), [quick start](#quick-start)
- [Troubleshooting](#troubleshooting)
- [Requirements](#requirements)

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

The card also works without the integration, keeping everything on each device. Add it from **+ Add Card** → **Crow Media Player**, then choose your speakers and settings in its visual editor (or in YAML, see [Quick start](#quick-start)).

The card is about **discovery** as much as playback: info panels, recommendations, artist radio, similar songs, films and shows, AI search, Ask and Trivia, and your own Music Recap and Video Recap all help you find your next favourite song, album, TV show or film, not just control what's already playing. And when you want something to keep, almost anything can be saved as a PDF, from listening reports to printable CD and DVD / Blu-ray case covers.

> **AI features are optional and off by default.** Turn on **Enable AI Features** in the editor's **AI** section to unlock them (see [AI features](#ai-features)). With AI off, the music info panel shows **Discogs** details, films and TV use **TMDB** (with a free key), **TVmaze** and **Wikipedia**, and everything else in the card works as normal.

### The player

- **Built for iPhone**: touch targets, long-press handling and layout are all iPhone-first, and it works just as well on a tablet, a computer or a wall screen
- **Modern design**: choose a **Classic** solid card or a **Glass** frosted-glass card, with an Auto / Light / Dark theme setting, rounded corners and customisable accent colours. With Glass, the card's confirmations, choosers, messages and PDF preview use Liquid Glass too
- **Skins**: twelve whole-card looks, each with a light and a dark version (see [Skins](#skins))
- **Compact and full size**: toggle between full album art and a space-saving mini player
- **Full media controls**: play/pause, skip, shuffle, repeat, and seek with the progress bar
- **Double-tap to seek**: double-tap left or right of the artwork to go back or forward 15 seconds
- **Double-tap to pin**: double-tap the *centre* of the artwork to pin whatever's playing (a song, film, TV show or radio station), with a burst of red hearts floating up from the tap (grey for unpinning; the hearts can be turned off with **Pin Hearts** in Appearance, the pin itself always works)
- **Pinned badge**: a small pin appears in the bottom-left corner of the artwork whenever what's playing is pinned, and updates live whichever pin button was used. Tap it to unpin, with an iOS-style confirmation first
- **Artwork tap actions**: a single tap opens the info panel (music: AI Info or Discogs; TV and films: Media Info; live radio with song details: that song's info); double-tap the edges to seek and the centre to pin; long-press opens the lyrics for music, or the Apple TV remote while a show, film or video app is playing (or when nothing is showing on an Apple TV)
- **App-aware info**: with AI on, tapping the artwork while something that isn't a film or series is playing opens info made for the app: YouTube, Vimeo, TikTok and Dailymotion videos (the video, the channel, topics and a fun fact), Twitch streams (the streamer, the game, similar streamers), sport (the event and the teams, with no live scores), news channels, workouts in Apple Fitness+, Peloton and the like, podcasts, and apps and games open on the Apple TV, including Netflix and others when they aren't saying what's on. The app's icon sits where a poster would, and YouTube, Twitch, Vimeo and TikTok have a **Find on** button for the app's own search. Personal videos (Photos, or a file name like IMG_2041.mov) get a simple panel instead of a wrong film match, and music apps on the Apple TV open the song's own info
- **Artwork zoom**: tap the mini album art in an info panel or album view to see a larger version
- **Discover button**: on the left of the controls bar on every speaker; turn off **Always Show Discover Button** in Player & Controls to hide it. On an Apple TV the Remote button uses that spot instead (the library is always in the quick menu)
- **Apple TV Remote button**: on Apple TVs, a Remote button on the left of the controls bar opens the remote in one tap; toggle **Apple TV Remote Button** in Player & Controls
- **Button icons**: choose the icon for the Discover and Remote buttons from ready-made icons, or use any Home Assistant icon (for example `mdi:bookshelf`), in Appearance or with `discover_icon` / `remote_icon` in YAML
- **Volume control**: a slider or +/− buttons, with an optional separate volume entity for each speaker (an amplifier or receiver, for example), set on that speaker's own page in the editor
- **Volume HUD**: a sleek overlay showing the level, fading after 1.5 seconds
- **Mute**: tap the volume badge or speaker icon to mute and unmute
- **Display names and startup volume**: give any speaker a short name on its page in the editor, used everywhere the card shows a speaker (the speaker menu, the summary pill, group sheets, Announce, messages), and a volume to start at
- **Automatic artwork**: when a speaker sends none, the card finds the cover itself
- **Artwork crossfade**: an optional fade-to-black between songs
- **Player icon themes**: eight icon sets: Standard, Modern, Robot, Chunky, Retro, Sharp, Pixel and LCD
- **Controls theme**: 12 colour presets for the control icons: Classic, Vivid, Warm, Ocean, Rose, Forest, Neon, Soft, Midnight, Gold, Retro and Ember
- **Ambient glow**: takes the main colour from the artwork for a subtle glow, and optionally behind list rows (**Row Glow**)
- **Row swipes**: swipe a row right or left for its most useful actions, as in Apple's Mail app: right for "do it" actions such as Add to Queue, Play Next or Pin, left for "manage" ones such as Info, Remove or More. A short swipe shows the buttons, a long swipe does the one nearest the edge straight away, and press and hold still opens the full menu. Works on songs, library items, history, pins, films and shows throughout the card; turn it off with **Row Swipes** in Appearance
- **Keyboard shortcuts**: on a tablet or computer with a keyboard (see [Keyboard shortcuts](#keyboard-shortcuts))
- **Follows what's playing**: the card switches to whichever player starts playing, but holds on the player on screen while you're using it: while the remote, an info panel, the library, the lyrics or a menu is open, and after you pause or stop it
- **Radio Mode indicator**: tap the radio icon to turn Radio Mode off straight away
- **LIVE station identification**: a LIVE pill appears on the artwork while a radio stream plays, on any speaker. Tap it for the station's format, country, votes, website and description, and the artwork changes to the station's own logo when there is one. Stations played from the Music Assistant library are identified from Music Assistant itself. When a station sends real song details, tapping the *artwork* opens that song's info with the station shown as a badge
- **Live / Podcast / Audiobook pill**: an optional badge on the artwork saying what's playing (off by default)
- **Several kinds of player**: Apple TV, HomePod, Music Assistant speakers and other media players, all from one card
- **Audio quality**: while a song plays on a Music Assistant speaker, the info panel shows its quality, such as **Lossless**, **Hi-Res Lossless** or the lossy format (AAC 256 kbps), with the bit depth, sample rate and source (needs Queue Actions)
- **Sleep timer**: **Sleep Timer** in the quick menu pauses after 15, 30, 45 or 60 minutes, or at the end of the song, episode or chapter, turning the volume down gently over the last half a minute and putting it back afterwards. The time left shows in a pill at the top of the artwork (a small moon on the mini artwork in compact mode); tap it to change or turn off the timer. With the integration it runs in Home Assistant, so it keeps going with the dashboard closed and the phone locked
- **Friendly messages**: messages appear inside the card. Home Assistant's own "Failed to perform the action" bar never pops up over the dashboard: when something fails (an Apple TV button, a volume change, an announcement, grouping speakers), a short message in the card says so instead, and error messages stay up long enough to read
- **Tactile feedback**: glow and blur effects when buttons are pressed

### Keyboard shortcuts

On a tablet or computer with a keyboard, tap the player once and these keys control it. Press **?** in the card to see the list at any time.

| Key | Does |
|---|---|
| **Space** or **K** | Play or pause |
| **→** / **←** | Next / previous song |
| **Shift + →** / **Shift + ←** | Forward / back 10 seconds (when the player can seek) |
| **↑** / **↓**, or **+** / **−** | Volume up / down |
| **M** | Mute |
| **S** | Shuffle |
| **R** | Repeat |
| **L** | Lyrics |
| **I** | Info |
| **Q** | Queue |
| **B** | Library |
| **/** | Search the library |
| **Esc** | Close a menu or panel (in a search box, the first Esc leaves the box) |
| **?** | Show these shortcuts |

- **Only the player you last tapped responds**, so two players on one dashboard don't both react to a key
- **Typing is never caught**: keys typed into a search box (or anywhere else on the page) go to that box
- **While a panel is open**, ↑ and ↓ scroll it instead of changing the volume; use **+** and **−** for the volume
- **Home Assistant's own shortcuts** (such as **E** to search entities) still work; only the keys above go to the card, and only while you're using it
- Turn them off with **Keyboard Shortcuts** in the editor's Appearance section, or `keyboard_shortcuts: false` in YAML

### Search

- **Search in the quick menu** opens AI Search when AI features are on: describe what you want to hear ("upbeat 80s pop", "songs like Bohemian Rhapsody", "something to study to") and press Enter for up to 18 matching songs, each with a short reason. **Play All**, **Shuffle**, **Add All** and **Play Next** act on the whole list, and **Export Results to PDF** saves it. Tap a song for its info, long-press for the enqueue menu
- **The blue Search button** beside the box runs a normal Music Assistant search for the same words instead (artists, albums, songs and playlists together). Back from those results returns to AI Search with your words still in the box
- **With AI off**, Search opens the normal library search straight away. Back from its results returns to an empty search box, then to the player
- **In Discover**, the search box at the top does the same, and the Songs, Artists and Albums tabs each have an AI search button beside their own search bar, returning matching songs, artists or albums. Set **Library Search** in the editor's Discover section to **AI Enhanced Search** to have pressing Search in those tabs use AI too
- **Recent Searches**: a category at the top of Discover listing every search you've run (Music Assistant, the iTunes-backed Podcasts, Movies & TV and Radio searches, and AI searches alike), up to 50, most recent first; tap one to run it again, or **Clear** the list (with an iOS-style confirmation)

### Quick menu (⋮)

Related actions are grouped into sub-menus so the menu fits on a phone screen: tap a group (shown with › and how many items it holds) to slide its items in, and **‹** at the top to go back. A group with only one item available shows that item directly. The menu always fits between the status bar and the bottom of the screen, and scrolls if it needs to.

| Item | Notes |
|---|---|
| **Find & browse** | |
| Resume | Carry on with what a speaker was playing when it stopped (with the integration) |
| Queue | Music Assistant speakers |
| Search | AI Search, or the normal library search when AI is off (see [Search](#search)) |
| Discover | Opens Discover, the library |
| **Discover & build** | |
| Vibe | Opens the Vibe queue builder |
| AI Recommendations | Song, film or show suggestions, up to 18 results |
| AI Artist Radio | Builds an artist radio queue |
| Add to Queue › | Add Similar Songs, Add Songs from Same Genre, Same Year, or Same Genre & Year, and Add Album |
| Radio Mode | Music Assistant's Radio Mode ("Don't stop the music") |
| **What's playing** | |
| Lyrics | Opens or closes the lyrics |
| Visualiser › | Album Artwork, any visualiser style, or Shuffle Each Song, on this device until the page is refreshed or closed; the current choice is highlighted |
| Screensaver › | An **Auto Start** switch at the top (whether the screensaver starts by itself on this device; it flips in place without closing the menu), then any screensaver style to start now |
| Skin › | Crow (Original) or any of the twelve skins, on this device only; hidden when **Skin in Quick Menu** is off |
| Full Screen | Fills the whole screen (see [Full screen](#full-screen)) |
| Sleep Timer | Pause after a set time or at the end of the song; shows the time left while it runs |
| Alarm | Wake-up alarms (with the integration); shows the next alarm's time |
| Pin / Unpin | Pins whatever's playing (song, radio, podcast or audiobook) |
| AI Mood Match / AI Trivia | While a film or show is playing |
| Remote Control | Apple TV only: opens or closes the remote |
| Open App | Apple TV only: the remote's Apps grid |
| Find Soundtrack | While watching on an Apple TV |
| **Recaps, export & sharing** | |
| Recaps › | Music Recap, Video Recap |
| Export › | For what's playing: Lyrics (when the song has them), then CD Case Printables for a song or DVD / Blu-ray Case Printables for a show or film. Then Listening Report, Your Month in Music, Recently Played, Watch Report and Pinned Items (see [Export to PDF](#export-to-pdf)) |
| Share & Announce › | Share (see [Sharing](#sharing)), Announce, Send Message |
| More Info | At the bottom: opens the info panel for what's playing |

> The AI entries (Vibe's AI features, AI Recommendations, AI Artist Radio, the Add to Queue songs, AI Mood Match, AI Trivia, Find Soundtrack) only appear when **Enable AI Features** is on. The same goes for the AI entries in the queue's ⋮ menu and in every long-press menu.

### Visualiser

Start it from **Visualiser** in the quick menu, or have it start by itself with **Start Automatically** in the editor's Visualiser & Screensaver section. In place of the album artwork while music plays, visuals that move in time with the song, in the album's own colours. Eleven styles, or **Shuffle Each Song**:

- **Spectrum Equaliser**: LED bars with falling peaks
- **Radial Equaliser**: bars in a ring around the spinning cover
- **VU Meters**: a pair of backlit analogue meters
- **Waveform**: glowing oscilloscope lines
- **Vinyl Turntable**: the cover as the record label, with a tonearm that moves across the record through the song
- **Cassette Deck**: the tape winding from one reel to the other
- **Pulse Particles**: sparks bursting out on the beat
- **Synthwave Grid**: a neon horizon rolling in time with the tempo
- **Synced Lyrics**: the current lyric line, large, with the lines before and after faded
- **Liquid Colour**: slow blobs of the album's colours swelling with the music
- **Code Rain**: columns of glowing green characters, falling faster and brighter the busier the music

Speakers don't send their sound to the dashboard, so the visuals follow each song's tempo (looked up on Deezer), where the song is up to and its synced lyrics; with **Play on this device** they follow the actual sound. It shows while music is playing, and pausing or stopping goes back to the artwork. Radio streams get the visualiser too; films, TV, podcasts and audiobooks keep their artwork. Tap the visualiser to go back to the artwork. Both the Visualiser and Screensaver items can be hidden from the quick menu in the editor.

### Screensaver

Start it from **Screensaver** in the quick menu, or have it start by itself with **Start Automatically** in the editor's Visualiser & Screensaver section: over the full-size player's artwork, or over the whole screen with **Full Screen** switched on. Started by itself, it appears after a chosen time (30 seconds to 1 hour) with the card left alone, whether or not music is playing. Tap anywhere on it to close it. **Auto Start**, a switch at the top of the quick menu's **Screensaver ›**, turns starting by itself on or off for that device without opening the editor. Eleven styles, or **Shuffle** to change style every five minutes:

- **Album Wall**: a grid of recent album covers, flipping over one tile at a time
- **Rain on Glass**: raindrops gathering and running down a window over a blurred album cover, each drop showing the cover upside down like a little lens
- **Ambient Aurora**: an aurora slowly shifting through greens, teals, blues, violets, pinks and ambers, with curtains of light swaying across a starry sky
- **Lava Lamp**: glossy blobs rising, merging and sinking in a glowing lamp, in the colours of the last song's album cover
- **Night Sky**: thousands of twinkling stars and the Milky Way flowing slowly over hazy hills and pine trees, the odd shooting star, and tonight's moon in its real phase
- **Fireplace**: flames licking up in the dark, white-hot at the base and cooling to red at the tips, with sparks rising
- **Ocean**: a rippling sea under a sky that follows Home Assistant's sun (dawn pink, midday blue, dusk orange, and the moon and stars at night). Now and then dolphins leap, seabirds glide over or a whale spouts and lifts its tail. The weather entity sets the clouds and the sea: glassy when it's still, choppy with white caps in the wind, rain on the horizon, and silent lightning in a storm
- **Clock & Weather**: a big clock and the date over an animated sky with clouds, sun, moon, stars, rain, snow or lightning to match the weather
- **Flip Clock**: split-flap digits that flip over as the minutes change
- **Analogue Clock**: a dial with a smoothly sweeping second hand, in any of twelve faces chosen in the editor (Luxury by default)
- **Word Clock**: the time spelled out in a grid of letters, such as "IT IS TWENTY PAST TEN", lit in the album's colour

A small clock and the date (and the weather) can sit in the corner of the styles that don't show the time themselves. No account or key needed.

**Full-screen screensaver.** Turn on **Full Screen** under Screensaver in the editor to cover the whole screen, Home Assistant's header and sidebar included.

- **Every style is made for full screen**: the clocks and dials scale with the screen, the Album Wall keeps its covers square (more rows on an upright phone, more columns on a wide screen), and the others stay in proportion
- **Notches and home bars**: the clock and text stay clear of them on iPhones and iPads
- **Any tap on the dashboard counts as using it**, so it won't appear while someone is using a different card on the same screen
- **Works from a compact player too**, and only one card goes full screen at a time. It never starts by itself from the editor's preview, and closes when you switch to another view
- **Light on the processor**: on very large screens the animated styles cap how sharply they draw, so wall panels and Raspberry Pi kiosks stay cool
- **Keeping the screen on**: the card can't keep an iPhone or iPad awake inside the Home Assistant app. For a wall or bedside tablet, turn on **Keep screen on** in the app's **Kiosk mode**, or set Auto-Lock to Never

### Skins

Twelve whole-card looks, each with a light and a dark version, chosen under **Skin** in the editor's Appearance section:

- **Retro players**: Winamp Classic, Winamp Modern, iPod Classic, iTunes 2005, Windows Media Player and Walkman
- **Retro desktops**: Windows 98, Windows XP and Mac OS X Aqua
- **Modern**: Zune, Spotify Style and Terminal

A skin dresses every screen, panel, menu and pop-up of the card, with its own title bar, buttons, lists and fonts. Some add an LCD display with a seven-segment clock and a spectrum that moves while music plays; the iPod skin has a working click wheel (Menu, back, forward, play/pause, the centre button for More Info, and a finger round the wheel for the volume); and the Walkman skin turns the artwork into a cassette whose reels turn as the song plays. The Theme setting picks light or dark (or follows Home Assistant's own mode when Theme is Auto). **Crow (Original)** is the card's own look. With **Skin in Quick Menu** on (the default), each phone, tablet or computer can choose its own skin, remembered on that device. In YAML: `skin` (`winamp`, `winamp5`, `ipod`, `itunes`, `wmp`, `walkman`, `win98`, `xp`, `aqua`, `zune`, `spotify` or `terminal`) and `skin_menu`.

### Synced lyrics

Long-press the artwork while music plays to open the lyrics.

- **Smooth line-by-line scrolling**: the lyrics glide through each line like a teleprompter, arriving just as the next line starts, and the current line grows gently as it reaches its place. It follows the progress bar exactly, even straight after a seek
- Plain lyrics when timings aren't available
- Looked up in the background, so they open straight away. For a Music Assistant speaker, Music Assistant's own lyrics are used first, then the LRCLIB lyrics site
- Double-tap to pause or resume the scrolling
- Swipe to look through the lyrics yourself; a few seconds after you let go, they glide back to where the song is
- Closes by itself when the song ends or changes (or stays open between songs with **Keep Lyrics Open Between Tracks**)
- **Translate Lyrics**: tap **⋯** in the top-left corner of the lyrics, then **Translate Lyrics**, for a translation under each line, with pronunciation for scripts such as Japanese, Korean or Russian. Uses the AI; each translation is kept, so it's instant next time. **Hide Translation** turns it off
- **Lyrics for any song**: the **Lyrics & Export** folder in a song's info panel menu (for any song, playing or not) holds **Lyrics** and the lyrics as a PDF. It appears once lyrics are found, with a spinner while they're looked up

### Info panels

**Single-tap** the artwork to open the info panel for what's playing, or tap any song, album, artist, film or show anywhere in the card.

**Music:**
- Year, label, length, fun fact and genre tags (tap a genre for its description). With AI on, tap the year for "This year in music"
- **Album pill**: tap to open the album and browse its tracks, with its own action bar; tap the album art to zoom
- **Band Members / Artist**: tap any member to open their bio with photo (tap to zoom), Known For songs and a fun fact
- **Similar Tracks**: up to 10; tap to open, long-press for the enqueue menu
- **New Releases**: at the bottom, albums, EPs and singles the artist has put out in the last year or that are due soon, from MusicBrainz. Reissues and remasters don't count, and the section stays hidden when there's nothing new. Tap one for its songs, long-press to play or queue it
- **Audio Quality** on a Music Assistant speaker
- **Action bar**: Play Now, Add, Play Next, Add Album and Pin. **Play Now** closes the panel (and Discover) and takes you back to the player
- **Ask / Meaning / Story / Trivia** (AI): ask your own question about the song ("Who wrote this? Is there a live version?"), read what it means, how it came about, or try a quiz, with answers hidden until tapped. When one can't get an answer, the panel says why ("Limit reached", "Busy right now"…) with a **Try Again** button
- **Discogs panel**: the default when AI is off, and the fallback when the AI doesn't know a song: the same layout with the album's full tracklist and community rating. The header reads **Discogs Info** so it's clear where the details came from. Tap a track in the tracklist to open its own info; the track you're viewing is highlighted. Discogs rate limits are handled by backing off for 10 seconds when asked to slow down
- **Artist bios**: tapping an artist or band member always shows something: the AI bio when AI is on, otherwise the Wikipedia summary (marked "From Wikipedia")

**TV shows:**
- Poster (tap to zoom), genre tags, overview and cast
- **Similar Shows**: tap any to open that show's info
- **Seasons and episodes**: episode counts and air dates (from TVmaze when AI is off or doesn't know the show). New seasons appear as soon as TVmaze lists them
- **Episode pages**: the show's artwork, the season and episode, the title, air date and rating, tappable writer and director pills, the description and a fun fact. With AI on, **Ask**, **Trivia** and **Soundtrack** sit under the artwork
- Back from an episode returns to the show at the same scroll position
- **Ask / Mood Match / Trivia / Spot It** (AI), **Where to Watch** and content warnings

**Films:**
- Poster (tap to zoom), title, year, genre tags, synopsis and cast
- **Similar Movies**: tap any to open that film's info
- **Ask / Mood Match / Trivia / Spot It** (AI), **Where to Watch** and content warnings

**People:** tap any cast member for their bio with photo (tap to zoom), Known For credits and a fun fact. With AI off, or when the AI doesn't know the person, the bio comes from Wikipedia. With AI on, person pages have **Ask** and **Trivia**.

**Info panel menu (⋯ in the header):**
- **Watch on YouTube**: opens a YouTube search for the song. For a film or show, **Watch Trailer** opens its trailer (also a round **Trailer** button beside Pin under the poster). Always uses YouTube, whatever your Share service. Turn it off with **Watch on YouTube** in the editor's Info Panels section
- **Play Trailer on** your Apple TV: for films and shows, the official trailer (found on TMDB, so it needs a key) opens in the YouTube app on the Apple TV
- **Copy to Clipboard**: the same as Share
- **Export Info to PDF**
- **Lyrics & Export** (songs): Lyrics, and the lyrics as a PDF
- **CD Case Printables (PDF)** for music, **DVD / Blu-ray Case Printables (PDF)** for films and TV shows, and **Export Episodes to PDF** for podcasts

**Find Soundtrack** (AI): from the quick menu while watching on an Apple TV, the long-press menu on Movies & TV items, and the **Soundtrack** button on Watch History titles and episode pages. It opens an AI Search for "Music from" the title.

### Movies & TV (TMDB)

Add a free **TMDB** key in **Configure** on the integration (used for every card in the house), or in the editor's **Info Panels** section, for posters, ratings, cast and episode details. Get one at themoviedb.org/settings/api (a v3 API key or a v4 Bearer token both work).

- **AI off**: TMDB is used for film and TV info
- **AI on**: **Try First** (Movies & TV, in Info Panels) chooses whether AI or TMDB is tried first; the other is the fallback
- **TMDB with AI Extras**: a third **Try First** choice: TMDB's details (poster, rating, overview, cast, seasons and similar titles) with the AI's Ask, Mood Match and Trivia buttons, Where to Watch, content warnings and a fun fact. Songs have the same choice, **Discogs with AI Extras**: Discogs's details with the AI's fun fact, similar songs, and Ask, Meaning and Trivia
- **Movie & TV Matching**: **Best Guess** goes by the title. **Exact Match (TMDB)** works it out the way media servers do, from the title, the year and whether it's a film or a show, settled by TMDB's own ID, so remakes and same-name shows aren't mixed up
- **Not this one?**: if the panel picks the wrong title, tap it to choose another match

> **Recommended:** set **Try First** to **Discogs with AI Extras** for songs and **TMDB with AI Extras** for films and TV. You get the accuracy of Discogs's and TMDB's own records (the right year, label, cast, poster and rating) with the AI's extras on top. It usually uses less AI quota than AI First too.

### When AI is off or can't help

Every AI option (Search's AI results, Vibe, Recommendations, AI Artist Radio, the Add to Queue songs, Find Soundtrack, Ask, Trivia, Mood Match and the Announce / Send Message Improve buttons) is hidden throughout the card while **Enable AI Features** is off, including in the quick menu, the queue's ⋮ menu and every long-press menu, and the card never contacts the AI agent. Where a panel normally gets its details from the AI, it uses a free source instead, both when AI is off and when the AI doesn't recognise something:

| What | Fallback |
|---|---|
| Song info | Discogs |
| Album view (tracklist, year, label, genres) | Discogs |
| Film and TV info | TMDB (with a key), then TVmaze for TV shows, then Wikipedia |
| TV seasons and episodes (counts, titles, air dates, summaries) | TVmaze |
| TV Tonight (UK) | The Freeview programme guide, with channel logos |
| Artist, band member, cast and director bios | Wikipedia |
| Genre descriptions | Wikipedia |

None of these need an account or key apart from TMDB. TVmaze also fills in anything missing from an AI or TMDB TV panel, and a panel built entirely from TVmaze reads **TVmaze Info**.

**When the AI is struggling.** If the AI runs out of quota, keeps timing out, can't sign in or has no agent, the card pauses it and goes straight to the fallbacks above instead of waiting for each request to fail. You get a single message when a pause starts, and the editor's **AI** section shows the current state with a **Try AI Again** button. Panels with a fallback give the AI 25 seconds to answer before using it.

**Choosing which AI features run.** Under the master switch, **AI Features** lets you turn individual features off to save quota: **Look Up in Advance** (fetching AI info in the background before you tap; off by default), **Search and Recommendations**, **Ask, Meaning and Trivia**, and **Recap Summaries**. AI in the info panels is switched with **AI Details** in the Info Panels section. A "busy" answer from the AI service is retried once automatically, identical requests already on their way are shared rather than sent twice, and every prompt tells the AI to treat titles, descriptions and web text strictly as data.

### Discover (the library)

Categories: Recent Searches, Music History, Watch History, Recently Added, Pins, Favourites, Charts (when switched on), Made for You, Playlists, Artists, Albums, Songs, Radio, Podcasts, Audiobooks and Movies & TV. Discover opens from **Discover** in the quick menu on any speaker, Music Assistant or not: Movies & TV, Radio, Podcasts and Audiobooks don't need Music Assistant at all.

- Tap any item to play; open collections with a back button
- **Action bar**: Play All, Shuffle, Add, Play Next, Pin and Export. Shuffle plays the list once in a random order without turning on the speaker's own shuffle, so the next album still plays in order
- Long-press songs for the enqueue menu, or (with Row Swipes on) swipe right for Add to Queue and Play Next, left for Pin (or Remove) and More
- **Music History**: your last 10 songs; the ⋮ menu shows your last 50, 100, 250 or 500 instead, or clears history (with an iOS-style confirmation). A hero bar (Play All / Add All / Play Next / Export) acts on exactly what's showing. Tap a song for its info; long-press for Play Now/Next, Add to Queue, Pin, AI Artist Radio and Share, plus **Remove from History**, **Remove All Plays** (every play of that song) and **Never Log This Artist**, each confirmed first. Muted artists are listed under **Muted Artists** in the ⋮ menu, where you can unmute them. The ⋮ menu's **Export to PDF** offers a Listening report, Your month in music, or Recently played on a speaker
- **Watch History**: the films and TV equivalent, with **Show last** 50, 100, 250 and 500 in the ⋮ menu alongside Clear History. Long-press a title for Pin, Find Soundtrack, DVD / Blu-ray Case Printables and **Remove from History**, or open a title and long-press a viewing to remove just that one. A title's own page has an **Export** button for its watch history. Videos watched in the YouTube app get their own **YouTube** section, showing the channel and how many times you've watched each video, and never appear in Music History, Video Recap or the reports
- **Album, playlist and artist pages**: **Export** on an album page offers Tracklist, Lyrics booklet or CD case printables; playlists and artists export their tracklist
- **Charts** (off by default, switch it on in the editor's Discover section): under **Apple Music**, **Top Songs** and **Top Albums** for your country (the one set in Home Assistant). Below them, the charts on Deezer's front page: **Official Charts** (UK), **Charts** (Top Worldwide, your country, USA), **Trending**, **Popular Playlists**, **Most-streamed Artists** (their top songs) and **Most-streamed Albums**. Each chart opens on the Top 10, with Top 50 and Top 100 in the ⋯ menu, and the usual Play All, Add, Play Next, Pin and Export buttons. Songs are found through Music Assistant, and any it can't find are skipped and counted. Charts are fetched once a day and kept until midnight. A pinned chart sits in **Pins → Charts** and always opens the latest version. No account or key needed
- **Movie & TV charts**: a **Charts** row at the top of Movies & TV: **Apple TV** (Top Movies, Top TV Shows), **TVmaze** (TV Tonight, New on Streaming) and, with a TMDB key, **TMDB** (Trending This Week, Popular Movies, Now in Cinemas, Coming Soon, Top Rated Movies, Popular TV). Each chart has Pin and Export. In the UK, **TV Tonight** comes from the free Freeview guide, channel by channel with each channel's logo: what's on now with a progress bar, then the rest of the evening. Tap a programme for its picture, times, episode, synopsis, an **Info** button and a **Watch on** button for the broadcaster's live page or app. List your own channels (a regional BBC One or ITV1, say) under `tv_tonight_channels` in YAML
- **Podcasts**: search the Apple Podcasts directory, with **Podcast Charts** (Apple Podcasts' Top Podcasts for your country) at the top. A podcast's panel has **Play Latest**, **Add All** (the latest five, oldest first), **Sleep**, **Website** and **Pin**, with the podcast's own description from its feed, and **Export Episodes to PDF**
- **Audiobooks**: free, public-domain titles from LibriVox (via the Archive.org catalogue), with AI-assisted searching when AI is on. A book's panel has **Play** (or **Continue**, from the chapter you last played), **Add All** (every chapter, in order), **Sleep**, **LibriVox** and **Pin**, with the book's cover, its real chapter titles and its genre
- **Radio**: search radio-browser.info directly, or use **Browse Home Assistant Radio** to explore Home Assistant's own Radio Browser categories (Popular, By Country, By Genre and more; needs the [Radio Browser](https://www.home-assistant.io/integrations/radio_browser/) integration). Star your favourite stations
- **Movies & TV**: search films and TV shows, open their info and pin favourites
- **Made for You**: the integration's weekly mixes (see [What the integration adds](#what-the-integration-adds))
- **Remembers where you left off**: reopening Discover returns to the section you were last in (a deliberate close resets it back to the top)

### Pins

Pin your favourites for one-tap access. All pins live together in **Pins** in Discover, grouped into Songs, Artists, Albums, Playlists, Queues, Radio, Podcasts, Audiobooks, Music Recap, Video Recap, Movies & TV and Charts.

- **What can be pinned**: radio stations, podcasts, audiobooks, films and TV shows, saved queues, recap snapshots, charts, and Music Assistant songs, artists, albums and playlists
- **How to pin**: long-press any item and choose Pin, or tap **Pin** in the row of round buttons in its info panel (it turns yellow and reads Unpin once pinned). For what's playing, double-tap the centre of the artwork. Unpin shows in red in every menu, and unpinning always asks first; pinned queues and recaps also warn that the snapshot can't be made again
- **Show Pins in Sections** (on by default): pinned items also appear at the top of their own section (Pinned Songs in Songs, for example); turn it off in the editor's Discover section so they only appear in Pins
- **Pin Queue**: save the current queue from the queue's ⋮ menu as a named snapshot (a copy, not a live link), also saved as a Music Assistant playlist (see [Music Assistant's queue](#music-assistants-queue))
- **Export Pins to PDF** from the Pins ⋮ menu
- **Clear All Pins** in the editor's Caches, Data & Support section
- With the integration, pins are kept for each person in Home Assistant and follow you between devices

### Vibe

Build a themed Music Assistant queue in one tap, from more than 100 vibes across 11 categories:

| Category | Examples |
|---|---|
| Energy | Energetic, Workout, Hype, Beast Mode |
| Calm | Chill, Meditate, Sleep, Bath / Spa |
| Focus | Study, Deep Work, Coding, Flow State |
| Mood | Happy, Melancholic, Nostalgic, Romantic |
| Social | Party, Pub Night, BBQ, Pre-Drinks |
| Activity | Sunday Morning, Cooking, Holiday |
| Decades | 50s through 2020s |
| Genre | Rock, Jazz, Classical, Hip Hop, Electronic, and 20+ more |
| Time | Morning, Evening, Late Night |
| Seasons | Summer, Autumn, Winter, Spring |
| Binaural & Noise | White, Pink, Brown and Green Noise; Delta, Theta, Alpha, Beta and Gamma Waves |

Decade vibes search your library for chart compilations first, then fall back to streaming. Genre and Social vibes search for curated playlists, falling back to Radio Mode. Every search term and artist is customisable in the editor's **Vibe Artist Seeds** section.

### The queue

- **Now Playing** row with animated sound bars; tap it for its info
- **Drag to reorder** (with Queue Actions), or long-press for **Reorder Queue**
- **Long-press any song**: Play Now, Play Next, Move to Top of Queue, Add to Queue, Pin Song, AI Artist Radio, Remove from Queue (with an iOS-style confirmation), Share and More Info
- **The queue's ⋮ menu**, grouped like the quick menu: Reorder, Jump to Current Track, Pin Song, **Pin Queue**, **Transfer Queue** (move the queue to another Music Assistant speaker) · Search, Discover · Vibe, Recommendations, AI Artist Radio, Radio Mode, **Add to Queue ›** (Similar Songs, Same Genre, Same Year, Same Genre & Year, This Album) · **Share & Announce ›** (Announce, Send Message) · **Export Queue to PDF** · Clear Queue
- **Working indicator**: while the card is adding songs (Add Similar Songs, Same Year / Genre, AI Artist Radio, Vibe), a small spinner shows inside the mini artwork and the speaker pill pulses. The first few songs are added straight away so the queue starts filling while the rest are found, and an open queue shows "Building your queue" until they're in. If only some are found, it says so ("Added 12 of 18 songs")
- **Ghost-Skip Healer**: when Music Assistant silently skips a song that failed to stream (an old Apple Music playlist entry, for example), the card looks it up again and queues the fresh match to play next. On by default, in Player & Controls

### Several rooms at once

- Play the same music on several Music Assistant speakers together
- **Choose Speakers**: tap the broadcast icon to pick speakers from a scrolling list, with Play kept at the bottom
- **Summary pill**: one compact pill shows the speaker you're controlling, with a count of the others playing along
- **Tap to manage**: a sheet lists every speaker in the group; tap one to control its volume, or × to remove it
- **Sync Volume**: matches every grouped speaker to the one you're controlling
- **Add a speaker**: a **+** button beside the speaker pill once something is playing
- Music Assistant's own fixed player groups (a stereo pair, for example) play as one speaker, but can't be folded into a separate group with others; that's a Music Assistant limit

### Play on this device

Turn the browser showing the card (your iPhone, a tablet or a computer) into a Music Assistant speaker, using Music Assistant's **Sendspin**. Needs **Music Assistant 2.10 or newer**.

- Turn on **Show "Play on this device"** in the editor's **Music Assistant** section
- Each device then opts in separately: tap **Play on this device** in the speaker menu on that device. It joins Music Assistant with a name like "James's iPhone (Safari)" (rename it in Music Assistant) and appears in the card like any other speaker
- **Browsers only**: it's offered in a web browser such as Safari, not in the Home Assistant app
- **Setting up**: the first time, the menu shows "Almost ready" for a few seconds, then "Ready — tap to play on this device". If Home Assistant still hasn't found it after 90 seconds, **Choose this device yourself…** lets you pick its entity
- **Connecting**: the speaker pill reads "This device · Connecting…" and pulses, and reconnects in the background (coming back to Safari, for example) stay quiet unless they take more than a few seconds
- **Disconnect this device** turns it off again. Only one browser tab plays at a time; if another tab took over, the menu offers to play here instead
- **If a song won't resume**: pressing play checks that sound actually starts, and if not, the card reconnects and restarts the song from the same spot
- **Locking the phone**: Safari pauses web pages when the iPhone locks, so music stops a few seconds later. Keep the screen on (or use a dedicated speaker) for longer listening
- **Volume** works as for any speaker, on top of the phone's own volume buttons. Each device remembers its own volume, starting at 50% the very first time
- **Music Assistant server URL**: leave blank to use your Home Assistant host on Sendspin's port **8927** (not Music Assistant's web port 8095). If you open Home Assistant over https, this must be an https address too, or the browser will block it

### Music Recap and Video Recap

Open from **Recaps ›** in the quick menu for a personal snapshot of your recent listening and watching.

- **Top Artists & Top Tracks**: top 10 each, by play count over the last 7 days; **Show Top 50** in the ⋮ menu expands both lists
- **⋮ menu**: Show Top 50 / Show Top 10, Play All, Add, Play Next, **Pin This Music Recap**, **Export Recap to PDF**, **Export Report to PDF** and Clear Listening History
- **Pinning a recap** saves a frozen snapshot under **Music Recap** in Pins; long-press a pinned recap to rename it
- **AI summary**: a short, warm write-up of your week, written fresh every time the panel opens so it always matches the numbers. Needs AI features; the stats themselves work without AI
- **Tap a song** for its info, **tap an artist** for their bio
- **What counts as a play**: a song has to play for 30 seconds (or half its length, whichever is shorter), so quick skips don't count. Radio, podcasts, audiobooks and announcements never count
- **With the integration**, Home Assistant records what plays on your speakers itself, so music played from the Music Assistant app, a voice assistant, an automation or a phone with every screen off still counts
- **Per person**: each Home Assistant user's history is kept separately
- **Video Recap**: the same for films and TV shows: Top Shows and Top Movies over the last 7 days, the AI summary, pinning, and both PDF exports. Tap a title for its info. Entries that are just a date (some sources report a recording's date instead of a title) are left out
- **Clear Listening History / Clear Watch History** in the ⋮ menu, with a confirmation. These are the same histories Music History and Watch History read from, so clearing either clears both

### Sharing

Share is in the quick menu (**Share & Announce ›**), the info panels (⋯ → **Copy to Clipboard**) and the long-press menu on any queue row. It copies to the clipboard, with a message when it's done:

- **Music**: the song title and artist (plus the album, where shown) with a link to find the song on your chosen service
- **Films & TV**: the title, year and a short synopsis with a link to it on TheMovieDB
- **Choose your service** for music links in the editor's Discover section: YouTube Music (default), Apple Music, Spotify, Tidal, Amazon Music or Deezer

### Export to PDF

Almost everything in the card can be saved as a PDF. A preview opens straight away with a progress spinner, then shows the finished PDF with a **Download** button. Every type can be switched off in the editor's **Export & PDF** section; a type that's off disappears from every menu and action bar.

| PDF | Where to find it |
|---|---|
| Info | ⋯ menu on every info panel (music, Discogs, album, film and TV, season and episode, person, podcast, station and audiobook). The PDF button on a TV show's seasons page makes an episode guide |
| Lyrics | **Lyrics & Export** in music panels, quick menu **Export ›**, album pages (a lyrics booklet for the whole album) |
| CD Case Printables | ⋯ menu in music panels, quick menu **Export ›** while a song plays, album pages |
| DVD / Blu-ray Case Printables | ⋯ menu in film and TV panels, quick menu **Export ›** while a show or film plays, a Watch History title's ⋮ menu, and long-press on any Movies & TV row (Watch History, Video Recap, Movies & TV search, Pins) |
| Listening Report | Quick menu **Export ›**, Music History ⋮ → **Export to PDF**, the Music History hero bar's **Export**, Music Recap ⋮ → **Export Report to PDF** |
| Your Month in Music | Quick menu **Export ›**, Music History ⋮ → **Export to PDF** |
| Recently Played | Quick menu **Export ›**, Music History ⋮ → **Export to PDF** (choose a speaker) |
| Watch Report | Quick menu **Export ›**, Watch History ⋮ → **Export Report to PDF**, Video Recap ⋮ → **Export Report to PDF**, and a title's **Export** button for that title's history. Includes a YouTube section (videos, time, top channels and when you watch) whenever YouTube was watched in the period |
| Recaps | Music Recap and Video Recap ⋮ → **Export Recap to PDF**, and **Export** on a pinned recap |
| Pinned Items | Quick menu **Export ›**, Pins ⋮ → **Export Pins to PDF**, and **Export** on pinned songs |
| Lists & Results | Queue ⋮ → **Export Queue to PDF**, saved queues, album tracklists, playlists and artists, charts, AI Search and Recommendations (**Export Results to PDF**), podcast episodes (**Export Episodes to PDF**) |

- **Reports ask for a period**: Today, Last 7 days, Last 30 days, Last 90 days or All time
- **Album pages**: **Export** offers Tracklist, Lyrics booklet or CD case printables. Only the types that are on are offered, and if just one is left it goes straight to it
- **Music and other panels**: the title and artist as the heading, the artwork beside the Year / Label / Length / Genre rows, then everything else on screen in order: Fun Fact, Band Members, Similar Tracks in two columns, tracklists, and anything you've opened with Ask, Meaning or Trivia. Web addresses (a station's website or stream) are clickable
- **Films and TV**: the title and year as the heading, the poster beside the user-score ring and Type / Seasons / Creator or Director / Genre / Rated rows, then Overview, Fun Fact, Cast in columns, Where to Watch and Similar
- **Lyrics**: the song and band as the heading, the artwork beside the details, then the lyrics centred, running onto further pages as needed
- **Instant the second time**: finished PDFs are kept for the session, so reopening one doesn't fetch everything again
- **Friendly errors**: if a PDF can't be made, an iOS-style alert says why, such as "You're Offline", "No Artwork Found", "No Lyrics Found" or "Couldn't Make the PDF"
- **Glass**: with Style set to Glass, the preview, its alerts, the chooser and the Download button use Liquid Glass, in light and dark
- **Not this one?**: CD and DVD / Blu-ray cases have a **Not this one?** button under the preview (and on their error alerts). It lists other matches with their artwork, with a search box for anything else. Your choice is remembered on that device, and a film or show you choose is used by its info panel too

**CD case printables.** Print-and-cut inserts for a standard CD jewel case:

- **Sizes**: front cover 120 × 120 mm, back tray card 150 × 118 mm with fold marks for the spines, a 118 mm disc label with a 36 mm hole, and booklet pages
- **Artwork**: the album's own front and back covers from MusicBrainz and the Cover Art Archive first, then the info panel's artwork, iTunes album art (1200 px) and finally the now-playing artwork
- **No back cover?** The card makes a tracklist back from MusicBrainz in one to three columns, numbered by disc (D1-1) for multi-disc albums, with a faint copy of the front cover behind it (switch it off with **Cover on the Back**). A real back cover scan is never changed
- **Album artist**: taken from the album itself, not the song playing. Compilations credited to Various Artists leave out the artist line and spine name
- **No artwork anywhere?** A **No Cover Art Yet** alert offers **Make with Title Cards**, **Add Cover on MusicBrainz** and **Not Now**
- **Format marks**: a made tracklist back gets a small CD mark at the foot of each spine and a strip along the bottom with a Compact Disc mark, the label, year and running time. The marks are the card's own design, not any official logo, and can be switched off with **Format Marks**

**DVD / Blu-ray case printables.** Print-and-cut wraps for a standard DVD or Blu-ray case, for films and TV shows:

- **Sizes**: DVD wrap 273 × 183 mm, Blu-ray wrap 272 × 149 mm, each with a 14 mm spine, plus a 118 mm disc label. Pages are A4 or US Letter to match your region; set `cd_paper_size` to `a4` or `letter` to choose
- **Back and spine**: a colour gradient taken from the poster, headings in a matching accent colour, and a slightly darker spine showing the title. With **Cover on the Back** on, a faint copy of the poster fills the back panel
- **Films**: tagline, synopsis, a **Film details** grid (Written by, Music by, Cinematography, Produced by, Studio, Released, Country, Language, Box office, Budget), **Starring** with character names, and Directed by. A strip along the bottom shows the certificate (your local rating), running time, year, rating and genre
- **TV shows**: synopsis, an **Episode Guide** with every episode title (smaller text and two columns for long series), Starring and Created by, then a strip with the certificate, runtime, years, seasons, rating and genre
- **Where the details come from**: the info panel if you've opened it, then TMDB, TVmaze, Wikipedia, Wikidata and the iTunes Store. A TMDB key isn't needed, but fills in more
- **Titles with a colon** (Star Trek: Strange New Worlds, Mission: Impossible) are matched in full, and an exact match decides whether a title is a show or a film
- **Format marks**: a small DVD or Blu-ray mark at the foot of the spine, on the back and on the disc label; the card's own design, and can be switched off

The preview uses PDF.js, and the PDFs are made with jsPDF, loaded the first time you export. Artwork a site won't let the card copy is fetched through an image proxy; if that fails too, the PDF is made without it. The PDF fonts only cover Western characters, so other scripts are left out. In the Home Assistant app on iPhone the Download button may not save the file, depending on the app version; it works in Safari. When printing a case, choose **Actual size** (100%), not Fit to page.

### Announce and Send Message

**Announce** (quick menu → **Share & Announce ›**):

- Speaker search grouped by Home Assistant area
- A volume for all speakers, or each one
- Playing speakers pause and carry on automatically. On a Music Assistant speaker, Music Assistant plays the announcement itself and restores the music the moment it ends
- Announcement history with favourites
- **Improve** rewrites your announcement naturally (with AI on)

**Send Message**: push notifications to phones running the Home Assistant app, with several devices at once, live search, a custom heading, and **Improve** (with AI on).

### Apple TV remote

**Opening the remote**: tap the **Remote** button on the left of the controls bar, long-press the artwork while a show or film is playing on an Apple TV (or when nothing is showing), or choose **Remote Control** in the quick menu. In compact mode the card expands first. Music keeps its long-press for lyrics. Anything playing in a video app such as YouTube, Netflix or iPlayer counts as video, so long-press opens the remote rather than lyrics.

**Back to the artwork**: tap the **X** in the top-left corner, swipe down on the remote, long-press an empty part of it, or choose **Remote Control** again. A short hint about the touchpad and the holds shows the first three times the remote opens.

| Button | Action |
|---|---|
| **Touchpad** | Swipe to move (a longer swipe moves further, and resting your finger at the end keeps moving), tap to select, hold for the options menu in most apps. The whole pad is the touch surface, with a soft glow along the edge you swipe toward |
| **Back** | Back / menu. Hold for the Home screen |
| **TV** | Home screen, and wakes the Apple TV. Hold for Control Centre |
| **Apps** | A grid of the Apple TV's apps over the touchpad, like its own Home screen, with the open app highlighted and the apps you open most first. A search box filters them by name. Real icons come from the iTunes Store, with a coloured letter tile until then. Shows when the Apple TV shares its app list with Home Assistant. Also in the quick menu as **Open App**, and can be turned off with **Apps Button** |
| **Sleep / Wake** | Follows the Apple TV: Sleep (red, with a confirmation) when it's awake, Wake (green) when it's asleep. About eight seconds later, the card checks whether it worked |

**Keyboard panel**: while the remote is open, the moment the Apple TV's on-screen keyboard becomes active (searching in an app, entering a password), a text box appears over the card. Type on your phone's keyboard and tap **Send** to push the text straight to the TV. No setup needed; toggle **Apple TV Keyboard Panel** in Player & Controls.

**Play Trailer on Apple TV**: in a film or show's info panel ⋯ menu (see [Info panels](#info-panels)).

**App icons**: with **Apple TV App Icons** kept in the editor's Caches, Data & Support section, the icons appear straight away after the app restarts and on your other devices.

### AI features

AI features are **off by default**. To unlock them (AI Info, Ask, Meaning, Story, Trivia, Mood Match, Spot It, AI Search, Recommendations, AI Artist Radio, Add Similar Songs, Add Songs from Same Year / Genre, Find Soundtrack, Translate Lyrics, Recap summaries, and Improve for Announce and Send Message), turn on **Enable AI Features** in the editor's **AI** section and choose a conversation agent. With the integration, AI requests go through Home Assistant, and answers that can be reused are kept for a week and shared by the house. Play a Mood and the integration's mixes use Home Assistant's AI Task when one is set up.

**Google Gemini** is the recommended and best-tested agent:

**Step 1: Enable the Generative Language API**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library**
4. Search for **Generative Language API** and click **Enable**

> Don't skip this step. An API key won't work until the Generative Language API is enabled; it returns errors straight away.

**Step 2: Create an API key**
1. In Google Cloud Console go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → API key** and copy the key

**Step 3: Add Google Generative AI to Home Assistant**
1. Go to **Settings → Devices & Services → + Add Integration**
2. Search for **Google Generative AI** and select it
3. Paste your API key and click Submit
4. The recommended model settings work fine. If you choose a model yourself, pick a **current Flash model**, because Google retires older models regularly

**Step 4: Configure the card**
In the card's editor, open **AI**, turn on **Enable AI Features**, and choose your Google AI agent under **AI Agent**. Use **Test AI** in Caches, Data & Support to check it answers.

> Other conversation agents (OpenAI, Claude, Ollama and others, added via **Settings → Voice Assistants**) may also work, but Google Gemini is the recommended and best-tested option. Home Assistant's built-in Assist agent can't answer AI questions.

**Rate limits.** Free-tier limits vary by model and change over time, so check Google AI Studio for your quota. AI answers (song info, bios, recommendations, search and panel results) are kept, so repeat lookups don't ask the agent again; recap summaries are the exception, written fresh each time. If you do see a quota message, it resets the next day.

### Keep in Home Assistant

With the integration, everyone's pins, starred stations, saved queues, pinned recaps, lyrics, AI answers and the rest are kept for each person in Home Assistant, so they survive app restarts and follow you between devices. The **Keep in Home Assistant** switches in the editor's **Caches, Data & Support** section are on by default; switch one off to keep that kind of thing on the device only.

- **Pins**, **Lyrics**, **AI Info** (song info, bios, recommendations, listening and watch history), **iTunes Artwork**, **Wikipedia Artwork** and **Apple TV App Icons** each have their own switch
- Home Assistant's copy is loaded once per session and merged with the device's; Home Assistant's copy wins on conflict
- **Clear Persistent Storage** removes everything kept this way
- **Clear All Caches** clears every cache but leaves your own things alone: pins, saved stations and queues, Music and Watch History, muted artists, favourite announcements and remembered choices
- Clear All Pins, Clear All Caches and Clear Persistent Storage turn red and say **Tap Again to Clear** first, so nothing is cleared by a stray tap

### Visual editor

The editor has a search box at the top that searches its own text: type any words from a setting's name, description or choices and only the matching settings show, with collapsed sections opened for you. There's also a **Reset All Settings to Defaults** button. Each section is a collapsible card.

| Section | Settings |
|---|---|
| Manage & Reorder Media Players | Drag to reorder; enable or disable; tap a speaker's name for its own page (Display Name, Startup Volume, Volume Entity, Music Assistant Speaker) |
| Player & Controls | **Startup & Navigation:** Auto Switch to Playing Device, Remember Last Selected Speaker, Show Media Player Selector, Startup View, Retain Current View. **Buttons:** Always Show Discover Button. **Apple TV:** Apple TV Remote Button, Remote Button Row Position, Apple TV Keyboard Panel, Apps Button. **Display:** Scroll Long Track / Artist Text, iTunes Artwork Fallback, Show Vibe, Show Live/Podcast/Audiobook Pill. **Volume:** Show Volume HUD, Use Volume Buttons, Show Volume Percentage. **Now Playing:** Sleep Timer, Ghost-Skip Healer |
| Music Assistant | **Play on This Device:** Show "Play on this device", Music Assistant server URL. **Radio:** Default Radio Mode on Startup (off by default) |
| Vibe Artist Seeds | The playlist search terms and radio fallback artists for each vibe |
| Discover | **Search & Pins:** Library Search (Normal or AI Enhanced), Show Pins in Sections, Share Track Service. **Charts:** Charts (off by default) with its Apple Music and Deezer switches, Movie & TV Charts with its TV Guide switch, Podcast Charts |
| Info Panels | A summary of where each panel's info will come from. **Songs:** Try First (AI First, Discogs First, or Discogs with AI Extras), New Releases, Audio Quality. **Movies & TV:** TMDB API Key, Try First (AI First, TMDB First, or TMDB with AI Extras), Movie & TV Matching (Best Guess or Exact Match). **Extras:** AI Details, Watch on YouTube |
| Lyrics | Synced Lyric Line Style, Keep Lyrics Open Between Tracks, Translate Lyrics, Cache Lyrics, Save Lyrics For |
| AI | **Enable AI Features** (off by default), AI Agent, AI Features (Look Up in Advance, Search and Recommendations, Ask, Meaning and Trivia, Recap Summaries), Announce TTS Service, and **Try AI Again** when the AI is paused |
| Visualiser & Screensaver | Start Automatically, then Start (Visualiser or Screensaver), After (Immediately for the visualiser, or 30 seconds to 1 hour), Visualiser Style or Screensaver Style. **Quick Menu:** Visualiser in Quick Menu, Screensaver in Quick Menu. **Screensaver:** Full Screen (off by default), Analogue Clock Face (Luxury by default), Show Clock, Weather |
| Export & PDF | **Enable PDF Exports**, then **PDF Types**: Lyrics, CD Case Printables, DVD / Blu-ray Case Printables, Format Marks, Cover on the Back, Info Panel PDFs, Listening & Watch Reports, Your Month in Music, Recently Played, Recaps, Pinned Items, and Lists & Results. All on by default |
| Caches, Data & Support | **Health & Support:** Run Health Check, Test AI and Report a Problem. **Keep in Home Assistant** switches. Then the AI, artwork, library and radio, announcement, icon, tempo and TV episode caches, Clear All Pins, Clear All Caches and Clear Persistent Storage |
| Appearance | **Theme & Colours:** Skin, Skin in Quick Menu, Style (Classic or Glass), Theme (Auto, Light or Dark), Follow Home Assistant Theme, Controls Theme (12 presets), Player Icon Theme (8 sets), Button Icons, Accent Preset, and accent, volume accent, title, artist, button, +Add pill, volume %, background and lyrics colours, with a live preview. **Glass & Glow:** Remote Liquid Glass, Volume HUD Liquid Glass, Ambient Glow, Row Glow, Row Swipes, Keyboard Shortcuts. **Animations:** Artwork Crossfade, Pin Hearts, Resize Button Spin |

### Quick start

```yaml
type: custom:crow-media-player-card
entities:
  - media_player.living_room_apple_tv
  - media_player.living_room_homepod
ma_entities:
  - media_player.mass_living_room
ai_features_enabled: true
ai_conversation_agent: conversation.google_generative_ai
tmdb_api_key: YOUR_TMDB_KEY
accent_color: '#007AFF'
controls_theme: classic
icon_theme: robot
use_ha_theme: false
lyrics_scroll_mode: highlight
ma_radio_mode: false
artwork_crossfade: false
ambient_glow: false
row_glow: false
row_swipes: true
keyboard_shortcuts: true
skin_menu: true
show_media_type_pill: false
pdf_enabled: true
cd_paper_size: a4
card_liquid_glass: true
show_pins_in_sections: true
```

`ma_entities` lists your Music Assistant speakers (for example `media_player.mass_kitchen_homepod`); they don't need to be in `entities` too. AI features are off by default: leave out `ai_features_enabled` (or set it to `false`) for a card with no AI. `tmdb_api_key` is optional, and with the integration it can go in **Configure** instead. Every PDF type is on by default; `pdf_enabled: false` turns them all off, and `cd_paper_size` can be `a4` or `letter` (leave it out to match your region).

### Health Check and reporting a problem

In the editor's **Caches, Data & Support** section:

- **Run Health Check** sends one small, known request to each service the card uses (Home Assistant and Music Assistant, MusicBrainz, the Cover Art Archive, Discogs, the iTunes Store, LRCLIB, Deezer, Apple's charts, Wikipedia, Wikidata, Radio Browser, the Internet Archive, the Apple TV's app list, TMDB, TVmaze, the UK TV guide and the PDF library) and checks that it answers in time and that its answer still has what the card reads. Each gets a coloured dot and a plain line such as Working, Slow, Not reachable from this device, Key not accepted, or Its answer has changed. Features that are switched off show as off rather than failing
- **Test AI** asks your AI agent one tiny question to confirm it answers, and how quickly. It uses a little quota, so it's separate from the Health Check
- **Report a Problem** explains what helps most, runs the Health Check in the background, and offers **Open GitHub Issue** (with the versions, your device, which features are on and the Health Check results filled in) or **Copy Report**. API keys, entity names, addresses and anything personal are never included

If Apple's chart feeds can't be reached, the card falls back to Deezer's charts on its own. MusicBrainz sometimes answers "busy" when asked too often; the Health Check retries once and shows this as amber rather than red.

The card is split into a main file and parts that load when they're first used (the editor, PDF exports, the screensaver and so on), so dashboards open faster.

---

## Troubleshooting

**The card doesn't appear after installing**
- Restart Home Assistant after downloading, add the integration, then hard-refresh your browser (Cmd+Shift+R on Mac) or close and reopen the Home Assistant app on your iPhone.

**AI features are missing from the quick menu, or don't work**
- Check **Enable AI Features** is on in the editor's **AI** section; AI is off by default, and its entries are hidden until it's on.
- With Google Gemini, check the **Generative Language API** is enabled in Google Cloud Console. This is the most common setup mistake.
- Check your agent is chosen as the **AI Agent**. Home Assistant's built-in Assist can't answer AI questions, so AI Search says "Search failed" with it.

**AI features say "The AI has reached its usage limit for now"**
- Your quota is used up; it resets the next day. If you chose an older Gemini model yourself, Google may have retired it: switch to a current Flash model.

**AI info has stopped appearing and the panels show Discogs, TVmaze or Wikipedia instead**
- The card pauses the AI after it hits its usage limit or stops answering, and uses the fallbacks meanwhile. Open **AI** in the editor and tap **Try AI Again**, or wait for the pause to end.

**Vibe queue plays only one song or none**
- Make sure the speaker has **Music Assistant Speaker** turned on in the editor, and use its `media_player.mass_*` entity, not the native HomePod or Apple TV entity.

**Custom colours don't work**
- Turn off **Follow Home Assistant Theme** in Appearance.

**Lyrics don't open**
- Long-press the artwork while a song is playing.

**Send Message shows no devices**
- Install the Home Assistant app on your phone and sign in.

**Radio Mode turns itself on when the card loads**
- Check **Default Radio Mode on Startup** in the Music Assistant section is off.

**The PDF Download button does nothing in the app**
- Some versions of the Home Assistant app on iPhone won't save files. Open your dashboard in Safari and export from there.

**An Export option is missing**
- Check the editor's **Export & PDF** section: that type, or **Enable PDF Exports**, may be off. If every option in a menu is off, you'll see "Exports are switched off in the card settings".

**The CD case has title cards instead of artwork**
- Neither MusicBrainz nor iTunes had art for that album. The **No Cover Art Yet** alert links to MusicBrainz so you (or anyone) can add it.

**The case is for the wrong film, show or album**
- Tap **Not this one?** under the preview and choose the right one, or search for it. The choice is remembered.

**My printed case is the wrong size**
- Print at **Actual size** (100%), not Fit to page. For A4 or US Letter, set `cd_paper_size` to `a4` or `letter`.

**Where's the remote button?**
- It's on the left of the controls bar on Apple TVs. If it's missing, turn on **Apple TV Remote Button** in Player & Controls. You can also long-press the artwork while a show or film plays, or use **Remote Control** in the quick menu.

**Apple TV won't wake**
- Use **Wake** on the remote, or the **TV** button. Home Assistant can't always tell whether the Apple TV is on, so the Sleep / Wake button shows the last state it knows. If the card says it can't reach the Apple TV, check it's plugged in and on the network.

**Film or TV info is empty with AI off**
- Add a free TMDB key in **Configure** on the integration, or in the editor's **Info Panels** section. Without one, the card uses TVmaze and Wikipedia.

**"Play on this device" won't connect**
- You need Music Assistant 2.10 or newer.
- Leave the server URL blank, or point it at Sendspin's port **8927**, not Music Assistant's web port 8095. Over https, it must be https too.
- Stuck on "Home Assistant hasn't found this device yet"? Check the player is on and available in Music Assistant, or tap **Choose this device yourself…** in the speaker menu.
- It's only offered in a web browser such as Safari, not the Home Assistant app.

**"Can't browse Home Assistant Radio" in the Radio tab**
- Add the [Radio Browser](https://www.home-assistant.io/integrations/radio_browser/) integration under **Settings → Devices & Services**, then reopen the Radio tab.

**The keyboard shortcuts don't do anything**
- Tap the player once first: the keys only go to the player you last tapped.
- Check **Keyboard Shortcuts** is on in Appearance.
- Keys aren't used while you're typing in a box; press **Esc** to leave it.
- On an iPhone or iPad, the shortcuts need a keyboard attached.

---

## Requirements

- Home Assistant 2025.8 or newer
- Music Assistant is optional, but needed for the library, queue, Made for You mixes and Play a Mood
- Queue Actions (mass_queue, from HACS) is optional; with it the card uses Music Assistant's own queue, Radio Mode, playlists and resume
- The Home Assistant Companion app for notifications (optional)

## Credits

- Music data from [Discogs](https://www.discogs.com) and [MusicBrainz](https://musicbrainz.org), cover art from the [Cover Art Archive](https://coverartarchive.org) and the iTunes Store, lyrics from [LRCLIB](https://lrclib.net), charts from Apple and [Deezer](https://www.deezer.com)
- Film and TV data from [TMDB](https://www.themoviedb.org), [TVmaze](https://www.tvmaze.com) (CC BY-SA) and the iTunes Store, facts from [Wikidata](https://www.wikidata.org), and bios and photos from [Wikipedia](https://www.wikipedia.org)
- Radio stations from [radio-browser.info](https://www.radio-browser.info) and audiobooks from [LibriVox](https://librivox.org)
- PDFs made with [jsPDF](https://github.com/parallax/jsPDF) and previewed with [PDF.js](https://mozilla.github.io/pdf.js/)
- The skins use the Silkscreen, VT323 and DSEG7 Classic fonts (SIL Open Font License 1.1), built into the card
- This product uses the TMDB API but is not endorsed or certified by TMDB
- The Home Assistant community, and everyone who tests, reports problems and suggests improvements
- My Loving Wife for her endless support

## Support

Report problems or ask for features at [GitHub Issues](https://github.com/jamesmcginnis/crow-media-player/issues). New versions are listed under [Releases](https://github.com/jamesmcginnis/crow-media-player/releases), and HACS offers them as updates.

## Licence

MIT. See [LICENSE.md](LICENSE.md).
