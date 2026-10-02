# Spotify Now Playing Page

A small portfolio page that shows what I am currently listening to on Spotify, paused playback, or my most recently played track.

Live: [now-playing.balogunoluwasogo.com](https://now-playing.balogunoluwasogo.com/).

The page polls `/api/spotify` every **10 seconds**, only while visible. Polling stops when the page is hidden or receives `pagehide`, and resumes when visible again or restored through `pageshow`.

`/api/spotify` asks Spotify for currently-playing first, then the playback state if no track is returned, then recently-played if neither returns a track. The Previously drawer fetches `/api/spotify/recent`, excludes the current track, and displays up to four previous tracks. The endpoint returns up to five unique recently played tracks.

The page includes an animated artwork and ambient background, an information note, a Previously drawer, and a touch artwork viewer. Keyboard controls, Escape and reduced motion are supported.

## Files

- `public/index.html`: page markup, canonical URL and share tags.
- `public/app.js`: status rendering, 10-second polling and visibility lifecycle, artwork, palette and desktop interactions.
- `public/experiments.js`: title reveals, previous-track drawer, offline status and status double-click afterglow.
- `public/artwork-viewer.js`: coarse-pointer artwork interactions and full-screen viewer.
- `public/palette.js`: artwork palette extraction.
- `public/styles.css`: one stylesheet, ordered base styles, experimental layers, then touch artwork/viewer styles, with labelled sections.
- `api/spotify.js` and `api/spotify/recent.js`: Vercel status and history endpoints.
- `api/spotify/login.js` and `api/spotify/callback.js`: local helpers for minting the refresh token.
- `lib/spotify.js`: shared token, Spotify requests and track normalization.
- `server.js`: local server, serving `public/` and the API routes.

Static HTML, CSS and JavaScript modules; no framework or build step.

Inter remains in the font stack but is not loaded. A three-run mobile Lighthouse trial of the self-hosted Latin variable font increased median LCP from 3,338 to 3,601 ms (+263 ms), exceeding the requested 200 ms regression limit, so it was deferred. A proposed follow-up is to test `font-display: optional` with a metrics-matched fallback.

## Local Development

Create `.env.local` or `.env` with:

```bash
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token
PORT=3000
```

Start the local server:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:3000
```

With valid Spotify credentials, the page loads the current, paused or last-played track. Local development uses the same shared Spotify logic as the serverless endpoints.

## Vercel Deployment

This repo is prepared for Vercel:

- Static files live in `public/`.
- The Spotify endpoints live in `api/spotify.js` and `api/spotify/recent.js`.
- Shared Spotify logic lives in `lib/spotify.js`.
- `vercel.json` sets `framework` to `null` and the output directory to `public`; no build step is required.

Set these Vercel Environment Variables in Project Settings:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Do not commit `.env` or `.env.local`.

## Spotify Token

This project expects a long-lived Spotify refresh token with these scopes:

- `user-read-currently-playing`
- `user-read-playback-state`
- `user-read-recently-played`

Keep the refresh token and client secret server-side only.

To mint the refresh token locally, register this redirect URI in your Spotify app:

```text
http://127.0.0.1:3000/api/spotify/callback
```

Set the client ID and secret in your local environment file, start `npm run dev` on port 3000, and open `http://127.0.0.1:3000/api/spotify/login`. After authorization, the callback returns the refresh token; copy it into `SPOTIFY_REFRESH_TOKEN` locally and into the Vercel environment variables. These login/callback routes are local token-minting helpers and use the fixed `127.0.0.1:3000` redirect.
