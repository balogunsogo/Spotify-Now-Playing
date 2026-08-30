import { timingSafeEqual } from "node:crypto";

const redirectUri = "http://127.0.0.1:3000/api/spotify/callback";

function getCookie(request, name) {
  const cookies = request.headers.cookie || "";
  const match = cookies.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function statesMatch(received, expected) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Set-Cookie",
    "spotify_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/spotify/callback; Max-Age=0"
  );

  const requestUrl = new URL(request.url, redirectUri);
  const error = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = getCookie(request, "spotify_oauth_state");

  if (error) {
    response.status(400).json({ error: `Spotify authorization failed: ${error}` });
    return;
  }

  if (!code) {
    response.status(400).json({ error: "Missing authorization code." });
    return;
  }

  if (!statesMatch(state, expectedState)) {
    response.status(400).json({ error: "Invalid or expired OAuth state." });
    return;
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    response.status(500).json({ error: "Spotify client credentials are not configured." });
    return;
  }

  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenResponse.ok) {
    response.status(502).json({ error: "Spotify token exchange failed." });
    return;
  }

  const tokens = await tokenResponse.json();

  if (!tokens.refresh_token) {
    response.status(502).json({ error: "Spotify did not return a refresh token." });
    return;
  }

  response.status(200).json({ refresh_token: tokens.refresh_token });
}
