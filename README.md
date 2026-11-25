# BetterTab

## Install
1. Unzip this folder somewhere permanent (Chrome loads it from there).
2. Open chrome://extensions and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `better-tab` folder.
4. Open a new tab. If Chrome asks whether to keep the new tab page, choose **Keep it**.

## Use
- **+** adds an app: paste a link, the name and icon fill in automatically.
- Right-click an app to edit, refresh its icon, move it or remove it. Drag to reorder.
- Left/Right arrow keys move between apps, Enter opens.
- Moon button: night mode. Pills at top left: switch between Chill and Work mode (each has its own apps; right-click an app to move it to the other mode).
- Settings (gear): app bar style (Bar or Drawer), 24-hour clock. Turn on **Advanced settings** for the icons-in-bar slider, Brandfetch client ID, icon refresh and backup.
- Drawer mode: the bar shows your first apps; the **up arrow** after the last one expands the bar into a drawer with all apps (Esc or click outside to close, Up arrow key opens it).

## Icons
Order tried:
1. The App Store icon (matched by app name and developer)
2. The site's own app icon (PWA manifest / apple-touch-icon), ignored if the site redirects elsewhere (e.g. to a login page)
3. Brandfetch (only if you add a free client ID in Advanced settings)
4. A large site logo
5. Favicon, then a letter tile
Transparent or small icons are placed on a solid tile so everything looks like an app icon.

## Keep watching (Prime Video)
While you watch Prime Video in this Chrome browser, the extension notes the show,
episode, poster and how far in you are (from the video player itself), saved only
on this computer. The new tab then shows a "Keep watching" card above the app bar
with the time left. Click it to go back to the show (Prime resumes where you left
off); hover and press ✕ to dismiss. It hides once you're 95% through or after 3 weeks.
Turn it off in Settings → Keep watching; turning it off also deletes what was saved.
Only viewing in this browser is tracked, not the TV or phone apps.
