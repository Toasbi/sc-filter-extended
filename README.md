# SoundCloud Feed Filter Extended

Browser extension that adds filtering to your [SoundCloud feed](https://soundcloud.com/feed).
Create multiple filter presets and switch between them with a tab bar.
Disclaimer: This is mostly vibe coded, dont expect perfect code :)

![Example](/docs/screenshot.png)
![Example2](/docs/screenshotdark.png)


## Credits

This extension is based/inspired on these extensions:
- [SoundCloud Feed Filter](https://github.com/7x11x13/sc-filter) by [7x11x13](https://github.com/7x11x13).
- [SoundCloud repost blocker](https://github.com/apsun/sc-repost-blocker) by [apsun](https://github.com/apsun).


## Filters

- **Repost filter** — block all reposts, allow only from people you follow, or show only from people you don't follow
- **Playlist filter** — hide large playlists (more than 5 tracks) or all playlists; optionally show only playlists where the artist's name appears in a track title
- **Tag filter** — include or exclude tracks by genre/tag
- **Track length** — show only tracks within a duration range
- **Content age** — control how old feed entries and uploads can be
- **Free downloads only** — show only tracks with a free download link
- **Hide seen tracks** — hide tracks you've already scrolled past this session

## Default tabs

The extension ships with these pre-configured tabs:

- **Default** — your full SoundCloud feed with no changes
- **No reposts** — only original posts; nothing someone else shared
- **Not following** — only content from people you don't follow; good for discovering artists through your network
- **Only singles by followed** — short tracks (under 30 min) from followed artists only; playlists appear only when the poster's name shows up in a track title, which catches label releases by artists you follow
- **Only mixes by followed** — longer tracks (45–120+ min) from followed artists only; same playlist rule as above — good for DJ sets and albums
- **Downtempo mixes** — longer downtempo tracks (45–120+ min) only; good for background listening sessions
- **Free Downloads** — short tracks (under 30 min) with a free download link
- **New Free Downloads** — same as Free Downloads but limited to uploads from the last 7 days
- **Deep cuts** — tracks from small or under-the-radar artists; surfaces music you'd otherwise miss

## Adding a filter tab

1. Click + in the tab bar to create a new tab
2. Give it a name and configure the filters
3. Click Save — the tab appears in the bar as the last item
4. Switch between tabs to instantly change your feed view

