import { getListeningStatus } from "../lib/spotify.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const track = await getListeningStatus();
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(track);
  } catch (error) {
    console.error(error);
    response.setHeader("Cache-Control", "no-store");
    response.status(500).json({
      error: "Could not load Spotify status."
    });
  }
}
