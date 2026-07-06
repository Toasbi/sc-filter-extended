[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/soundcloud-feed-filter-ex/mnfcpieidcneompnhaamejajfodlclal)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-GB/firefox/addon/soundcloud-feedfilter-extended/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/toaster2)

# SoundCloud Feed Filter Extended

Browser extension that adds filtering to your [SoundCloud feed](https://soundcloud.com/feed).
Create multiple filter presets and switch between them with a tab bar.

![Demo](/docs/soundcloud-feed.gif)
![Example](/docs/screenshot.png)


## Installation

Chrome: https://chromewebstore.google.com/detail/soundcloud-feed-filter-ex/mnfcpieidcneompnhaamejajfodlclal

Firefox: https://addons.mozilla.org/en-GB/firefox/addon/soundcloud-feedfilter-extended/


## Adding a filter tab

1. Click + in the tab bar to create a new tab
2. Give it a name and configure the filters
3. Click Save — the tab appears in the bar as the last item
4. Switch between tabs to instantly change your feed view

## Editing/Deleting a filter tab

1. Hover over a tab in the tab bar, a pencil icon appears on the right
2. Click the pencil icon on the right side of the tab name
3. Adjust the settings to your liking and Click Save
4. Or Click Delete on the left bottom of the settings panel  
  
**Note**: You can always restore the default Filter Tabs by clicking the gear icon in the tab bar.

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

## Credits

This extension is based/inspired on these extensions:
- [SoundCloud Feed Filter](https://github.com/7x11x13/sc-filter) by [7x11x13](https://github.com/7x11x13).
- [SoundCloud repost blocker](https://github.com/apsun/sc-repost-blocker) by [apsun](https://github.com/apsun).
