# Browser Video Link Pickers

Two Chrome Manifest V3 extensions for selecting videos on video-list pages and copying links in batches.

## Extensions

- `youtube-link-picker`: works on YouTube search, playlist, feed, and channel pages.
- `bilibili-fav-link-picker`: works on Bilibili favorite pages and other Bilibili video-list pages.

## Shared Behavior

- Click a video thumbnail or preview area to select or unselect that video.
- Click the round check button to select or unselect that video.
- Click the video title to open the video normally.
- Use the floating toolbar to copy selected links, select all loaded videos, or clear selection.
- Infinite-scroll pages only expose videos that are currently loaded in the DOM.

## Install In Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select one of these folders:
   - `youtube-link-picker`
   - `bilibili-fav-link-picker`

Each folder is an independent unpacked Chrome extension.

## Development

There is no build step. Edit the extension files directly, then reload the extension from `chrome://extensions/` and refresh the target website.
