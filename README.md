# Rank 1 Watch

Tracks GH's #1 run on the Keqing (Mistsplitter Reforged, 4p Thundering Fury) leaderboard on [akasha.cv](https://akasha.cv/leaderboards/1000004200/tf), anchored since February 2, 2026.

## What's in this repo

- **`index.html`** — the app itself. A standalone, installable web app (PWA) — open it directly, or install it via Chrome's "Add to Home Screen" / "Install app."
- **`data/leaderboard.json`** — auto-updated leaderboard snapshot, build stats, and Top 20 history. Refreshed automatically (see below).
- **`data/build-screenshot.png`** — an auto-captured screenshot of the current build card.
- **`scripts/`** — the Node scripts that do the actual data fetching and screenshot capture, run by the GitHub Actions workflow below.
- **`.github/workflows/update-leaderboard.yml`** — runs twice daily (09:00 and 17:00 UTC) to pull fresh data and commit it here, so the app always has current information without anyone needing to check the leaderboard manually.

## How it works

1. A scheduled GitHub Action fetches the latest standings from akasha.cv and enka.network
2. It commits the results to `data/`
3. GitHub Pages serves the updated site
4. The app reads that data automatically on load, or via the in-app "Sync now" button

## Manually triggering an update

Go to the **Actions** tab → **"Update leaderboard data"** → **Run workflow**, if you don't want to wait for the next scheduled run.
