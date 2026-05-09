const playerEl = document.querySelector("#player");
const presenceBadge = document.querySelector("#presence-badge");
const lagosTimeEl = document.querySelector("#lagos-time");
const aboutToggle = document.querySelector("#about-toggle");
const aboutPopover = document.querySelector("#about-popover");
const modalScrim = document.querySelector("#modal-scrim");
const albumArt = document.querySelector("#album-art");
const artFallback = document.querySelector("#art-fallback");
const statusEl = document.querySelector("#status");
const titleEl = document.querySelector("#title");
const artistEl = document.querySelector("#artist");
const albumEl = document.querySelector("#album");
const linkEl = document.querySelector("#spotify-link");
const explicitEl = document.querySelector("#explicit");
const pollIntervalMs = 5000;
let activeRequest = null;
let lastTrackKey = "";

function updateLagosTime() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);

  lagosTimeEl.textContent = `${time} WAT`;
  lagosTimeEl.dateTime = now.toISOString();
}

function setPresence(isOnline) {
  presenceBadge.textContent = isOnline ? "Online" : "Offline";
  presenceBadge.classList.toggle("is-online", isOnline);
  presenceBadge.classList.toggle("is-offline", !isOnline);
}

function setAboutOpen(isOpen) {
  aboutPopover.hidden = !isOpen;
  modalScrim.hidden = !isOpen;
  aboutToggle.setAttribute("aria-expanded", String(isOpen));
}

function formatPlayedAt(value) {
  if (!value) {
    return "Last played";
  }

  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === "minute") {
      return `Last played ${relative.format(Math.round(seconds / size), unit)}`;
    }
  }

  return "Last played just now";
}

function setAlbumArt(track) {
  albumArt.classList.remove("is-loaded");
  albumArt.onload = null;

  if (!track.albumArt) {
    albumArt.removeAttribute("src");
    albumArt.removeAttribute("alt");
    document.body.style.removeProperty("--album-bg");
    artFallback.hidden = false;
    return;
  }

  artFallback.hidden = true;
  document.body.style.setProperty("--album-bg", `url("${track.albumArt}")`);
  albumArt.onload = () => {
    albumArt.classList.add("is-loaded");
  };
  albumArt.src = track.albumArt;
  albumArt.alt = `${track.album} cover art`;
}

function render(track) {
  const isPlaying = track.state === "playing";
  const trackKey = `${track.state}:${track.title}:${track.artists}:${track.album}:${track.playedAt || ""}`;

  setPresence(isPlaying);

  if (trackKey === lastTrackKey) {
    statusEl.textContent = isPlaying ? "Currently listening to" : formatPlayedAt(track.playedAt);
    return;
  }

  lastTrackKey = trackKey;
  playerEl.classList.toggle("is-playing", isPlaying);
  statusEl.textContent = isPlaying ? "Currently listening to" : formatPlayedAt(track.playedAt);
  titleEl.textContent = track.title;
  artistEl.textContent = track.artists;
  albumEl.textContent = track.album;
  explicitEl.hidden = !track.explicit;

  if (track.spotifyUrl) {
    linkEl.href = track.spotifyUrl;
    linkEl.hidden = false;
  } else {
    linkEl.hidden = true;
  }

  setAlbumArt(track);
}

async function loadTrack() {
  if (activeRequest) {
    activeRequest.abort();
  }

  const controller = new AbortController();
  activeRequest = controller;

  try {
    const response = await fetch(`/api/spotify?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Spotify endpoint returned an error.");
    }

    render(await response.json());
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    playerEl.classList.remove("is-playing");
    setPresence(false);
    statusEl.textContent = "Spotify is unavailable";
    titleEl.textContent = "Try again soon";
    artistEl.textContent = error.message;
    albumEl.textContent = "";
    linkEl.hidden = true;
    explicitEl.hidden = true;
  } finally {
    if (activeRequest === controller) {
      activeRequest = null;
    }
  }
}

aboutToggle.addEventListener("click", () => {
  setAboutOpen(aboutPopover.hidden);
});

document.addEventListener("click", (event) => {
  const target = event.target;

  if (target.closest("a")) {
    return;
  }

  if (aboutPopover.hidden || aboutPopover.contains(target) || aboutToggle.contains(target)) {
    return;
  }

  setAboutOpen(false);
});

modalScrim.addEventListener("click", () => {
  setAboutOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setAboutOpen(false);
  }
});

updateLagosTime();
setInterval(updateLagosTime, 1000);
loadTrack();
setInterval(loadTrack, pollIntervalMs);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadTrack();
  }
});
