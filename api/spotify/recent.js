import { getRecentlyPlayed } from "../../lib/spotify.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const tracks = await getRecentlyPlayed(5);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ tracks });
  } catch (error) {
    console.error(error);
    response.setHeader("Cache-Control", "no-store");
    response.status(500).json({ error: "Could not load recently played tracks." });
  }
}
