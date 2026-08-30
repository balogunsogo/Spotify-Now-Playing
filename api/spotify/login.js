import { randomBytes } from "node:crypto";

const redirectUri = "http://127.0.0.1:3000/api/spotify/callback";
const scopes = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played"
];

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    response.status(500).json({ error: "SPOTIFY_CLIENT_ID is not configured." });
    return;
  }

  const state = randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state
  });

  response.setHeader(
    "Set-Cookie",
    `spotify_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/spotify/callback; Max-Age=600`
  );
  response.redirect(302, `https://accounts.spotify.com/authorize?${params}`);
}
