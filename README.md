# Spotify Now Playing Page

A small portfolio page that shows what I am currently listening to on Spotify. If nothing is playing, it falls back to my most recently played track.

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

The page polls `/api/spotify` every 5 seconds. When Spotify reports an active track, the page shows it as currently playing. When nothing is active, it requests the latest recently played track instead.

## Vercel Deployment

This repo is prepared for Vercel:

- Static files live in `public/`.
- The Spotify endpoint lives in `api/spotify.js`.
- Shared Spotify logic lives in `lib/spotify.js`.

Set these Vercel Environment Variables in Project Settings:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Do not commit `.env` or `.env.local`.

## Spotify Token

This project expects a long-lived Spotify refresh token with these scopes:

- `user-read-currently-playing`
- `user-read-recently-played`

Keep the refresh token and client secret server-side only.
