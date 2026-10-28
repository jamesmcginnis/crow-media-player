# Crow Media Player

An iPhone-style media player card for Home Assistant, with the integration that runs it: deep Music Assistant support, synced lyrics, AI track and film information, podcasts, radio and audiobooks, Listening Recaps, PDF exports, a screensaver, a visualiser and an Apple TV remote.

**One download installs both.** The card is bundled inside the integration and loaded into your dashboards automatically.

## What the integration adds

- **Everyone's data in Home Assistant**: pins, starred stations, saved queues, lyrics and AI answers are kept for each person and follow them between devices
- **Listening Recaps that never miss a song**: Home Assistant records what plays, so music from the Music Assistant app, a voice assistant or an automation counts, even with every screen off
- **Sleep timer**: turns the volume down gently and pauses, with the dashboard closed and the phone locked
- **Wake-up alarms**: start quietly and get louder over a minute, on the days you choose
- **Made for You mixes**: made each week from what the house plays: On Repeat, Your Month in Music, Forgotten Favourites, Discover Weekly and mood mixes such as Sunday Morning, Focus, Dinner Party, Workout, Chill Evening and Road Trip
- **Resume**: carry on where a speaker stopped, at the same volume, after a pause, switching off or a power cut
- **Outside services through Home Assistant**: artwork, charts, podcasts, lyrics, films and TV are fetched and cached by your server, with your TheMovieDB key and Discogs token kept there
- **AI through Home Assistant**: answers that can be reused are shared by the house for a week
- **Notifications**: new episodes of pinned podcasts, and new releases by the artists you play most
- **Music Assistant's own queue** (with Queue Actions): the whole queue, Radio Mode as "Don't stop the music", reordering, announcements that pause and restore the music, and pinned queues saved as Music Assistant playlists
- **Sensors**: Music playing, Listening time, Tracks played today, Top artist and track this week, Last played, Listening streak, New podcast episodes, New releases, Rooms playing, Last music and Listening by room, and for each speaker Sleep timer, Next alarm, Radio station, Queue time left, Now watching, Audiobook progress, Up next, Song ends at, Audio quality, Radio Mode and Something to resume
- **Actions**: start and cancel a sleep timer, set and delete alarms, play a station, play something pinned, play a mood, play a mix, make mixes, pause everywhere, resume, forget history, and check for new episodes and releases

## The card

**The player**
- iPhone-style player in compact and full size, Classic or Liquid Glass, light and dark
- 12 control colour themes, 8 icon sets, accent presets and your own colours
- Twelve skins: Winamp Classic and Modern, iPod Classic (with a working click wheel), iTunes 2005, Windows Media Player, Walkman, Windows 98, Windows XP, Mac OS X Aqua, Zune, Spotify Style and Terminal
- Full Screen for tablets, phones and wall screens, with big artwork, scrolling lyrics, the next song and the Apple TV remote
- Artwork gestures: tap for info, double-tap the edges to skip 15 seconds, double-tap the middle to pin, hold for lyrics
- Row swipes like Apple's Mail app, and keyboard shortcuts on a tablet or computer
- Volume slider or buttons, a separate volume entity per speaker, display names and startup volumes
- Several rooms at once, with one pill for the group and Sync Volume
- Play on this device: turn a browser into a Music Assistant speaker with Sendspin

**Search and Discover**
- Search by description with AI ("upbeat 90s rock"), or a normal Music Assistant search
- The library: songs, albums, artists, playlists, Recently Added, Favourites, Made for You and Recent Searches
- Charts from Apple Music and Deezer, including the UK Official Charts
- Movie & TV charts, and TV Tonight from the Freeview guide in the UK
- Podcasts, thousands of radio stations, and free LibriVox audiobooks with chapters
- Music History and Watch History, with YouTube kept separate
- Pins for songs, albums, artists, playlists, queues, stations, podcasts, audiobooks, recaps, films, shows and charts
- Vibe: build a queue from more than 100 moods and themes, including binaural waves and noise
- Shuffle beside Play All on every list of songs

**Lyrics and info**
- Synced lyrics that glide along with the song, with translation
- Info panels for songs, albums, artists, films, TV shows, seasons, episodes and people
- Audio quality, new releases, Where to Watch and content warnings
- Free sources when AI is off: Discogs, TMDB (with a key), TVmaze and Wikipedia

**AI extras** (optional, off by default)
- AI Info, Ask, Meaning, Story, Trivia, Mood Match and Spot It
- AI Search, Recommendations, AI Artist Radio, Add Similar Songs and songs from the same year or genre
- Find Soundtrack, Translate Lyrics, Recap summaries, and Improve for announcements and messages

**Visualiser and screensaver**
- Eleven visualiser styles, including a spectrum equaliser, VU meters, a vinyl turntable, a cassette deck, Synthwave and Code Rain
- Eleven screensavers, including Album Wall, Rain on Glass, Aurora, Lava Lamp, Night Sky, Fireplace, Ocean, and flip, analogue and word clocks

**Recaps and PDFs**
- Music Recap and Video Recap of your week
- PDFs of info panels, lyrics and lyrics booklets, listening and watch reports, Your Month in Music, recaps, pins, queues and search results
- Printable CD cases, and DVD and Blu-ray case wraps

**Around the house**
- Apple TV remote with touchpad, apps, Sleep and Wake, and typing from your phone
- Announce on any speakers, and Send Message to phones
- Share what's playing with a link to your music service
- Health Check, Test AI and Report a Problem in the editor

## Setup

1. Download, then restart Home Assistant
2. **Settings → Devices & Services → + Add Integration** → **Crow Media Player** → **Submit**
3. Optionally choose **Configure** for speakers, keys and notifications
4. Refresh your browser or app, then add the **Crow Media Player** card to a dashboard

Music Assistant is optional, but needed for the library, queue, mixes and Play a Mood. AI features need a conversation agent such as Google Gemini, chosen in the card's editor.

Full documentation, and where to report problems: [github.com/jamesmcginnis/crow-media-player](https://github.com/jamesmcginnis/crow-media-player)
