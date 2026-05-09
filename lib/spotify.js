export async function getAccessToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  const missing = [
    ["SPOTIFY_CLIENT_ID", SPOTIFY_CLIENT_ID],
    ["SPOTIFY_CLIENT_SECRET", SPOTIFY_CLIENT_SECRET],
    ["SPOTIFY_REFRESH_TOKEN", SPOTIFY_REFRESH_TOKEN]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing Spotify environment variables: ${missing.join(", ")}.`);
  }

  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify token request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

function normalizeTrack(track, state, playedAt = null) {
  if (!track) {
    return null;
  }

  const largestImage = [...(track.album?.images || [])].sort((a, b) => b.width - a.width)[0];

  return {
    state,
    playedAt,
    title: track.name,
    artists: track.artists?.map((artist) => artist.name).join(", ") || "Unknown artist",
    album: track.album?.name || "",
    albumArt: largestImage?.url || "",
    previewUrl: track.preview_url,
    spotifyUrl: track.external_urls?.spotify || "",
    durationMs: track.duration_ms,
    explicit: Boolean(track.explicit)
  };
}

async function spotifyGet(endpoint, accessToken) {
  const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify API request failed: ${response.status} ${body}`);
  }

  return response.json();
}

export async function getListeningStatus() {
  const accessToken = await getAccessToken();
  const current = await spotifyGet("me/player/currently-playing?additional_types=track", accessToken);

  if (current?.is_playing && current.item?.type === "track") {
    return normalizeTrack(current.item, "playing");
  }

  const recent = await spotifyGet("me/player/recently-played?limit=1", accessToken);
  const lastPlayed = recent?.items?.[0];

  if (lastPlayed?.track) {
    return normalizeTrack(lastPlayed.track, "recent", lastPlayed.played_at);
  }

  return {
    state: "empty",
    title: "Nothing yet",
    artists: "Start listening on Spotify and this page will update.",
    album: "",
    albumArt: "",
    previewUrl: null,
    spotifyUrl: "",
    durationMs: null,
    explicit: false
  };
}
