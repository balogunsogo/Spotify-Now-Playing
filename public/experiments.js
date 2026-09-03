const body = document.body;
const presenceBadge = document.querySelector("#presence-badge");
const titleEl = document.querySelector("#title");
const statusEl = document.querySelector("#status");
const previousToggle = document.querySelector("#previous-toggle");
const previousDrawer = document.querySelector("#previous-drawer");
const previousClose = document.querySelector("#previous-close");
const previousList = document.querySelector("#previous-list");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const MAX_RECENT_TRACKS = 4;

let currentTrack = null;
let titleRevealTimer = null;
let lastPlaybackObservedAt = null;
let offlineStatusTimer = null;
let isOffline = false;

function formatObservedAge(timestamp) {
  if (!timestamp) return "Last played";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "Last played · just now";
  if (elapsedMinutes < 60) return `Last played · ${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Last played · ${elapsedHours} hr ago`;
}

// EXPERIMENT: Intentional offline state using the last locally observed playback moment.
function updateOfflineStatus() {
  if (currentTrack) {
    statusEl.textContent = formatObservedAge(lastPlaybackObservedAt);
  }
}

// EXPERIMENT: Typography reveal and title-length hierarchy.
function revealTitle(track, trackChanged) {
  if (!trackChanged) return;

  const title = String(track.title || "");
  titleEl.classList.toggle("is-short-title", title.length > 0 && title.length <= 18);
  titleEl.classList.toggle("is-long-title", title.length >= 48);

  if (reducedMotion.matches) return;

  window.clearTimeout(titleRevealTimer);
  const words = title.split(/\s+/).filter(Boolean);
  titleEl.replaceChildren();

  words.forEach((word, index) => {
    const span = document.createElement("span");
    span.className = "title-word";
    span.style.setProperty("--word-index", Math.min(index, 8));
    span.textContent = word;
    titleEl.append(span, document.createTextNode(index === words.length - 1 ? "" : " "));
  });

  titleEl.classList.add("is-word-revealing");
  titleRevealTimer = window.setTimeout(() => {
    titleEl.classList.remove("is-word-revealing");
    titleRevealTimer = null;
  }, 760);
}

function trackIdentity(track) {
  return `${String(track.title || "").trim().toLowerCase()}|${String(track.artists || "").trim().toLowerCase()}`;
}

function createRecentTrackNode(track) {
  const element = document.createElement(track.spotifyUrl ? "a" : "article");
  element.className = "previous-track";

  if (track.spotifyUrl) {
    element.href = track.spotifyUrl;
    element.target = "_blank";
    element.rel = "noreferrer";
    element.setAttribute("aria-label", `Open ${track.title} by ${track.artists} in Spotify`);
  }

  if (track.albumArt) {
    const image = document.createElement("img");
    image.src = track.albumArt;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 300;
    image.height = 300;
    element.append(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "previous-art-fallback";
    fallback.textContent = "SP";
    element.append(fallback);
  }

  const copy = document.createElement("span");
  copy.className = "previous-track-copy";
  const title = document.createElement("strong");
  const artist = document.createElement("small");
  title.textContent = track.title;
  artist.textContent = track.artists;
  copy.append(title, artist);
  element.append(copy);
  return element;
}

function renderRecentTracks(tracks) {
  previousList.replaceChildren();

  if (!tracks.length) {
    const empty = document.createElement("p");
    empty.className = "previous-empty";
    empty.textContent = "No previous tracks found.";
    previousList.append(empty);
    return;
  }

  tracks.forEach((track) => previousList.append(createRecentTrackNode(track)));
}

function renderRecentTrackSkeletons() {
  previousList.replaceChildren();
  previousList.setAttribute("aria-busy", "true");

  for (let index = 0; index < MAX_RECENT_TRACKS; index += 1) {
    const skeleton = document.createElement("div");
    skeleton.className = "previous-track previous-track-skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.innerHTML = `
      <span class="previous-skeleton-art"></span>
      <span class="previous-skeleton-copy">
        <span></span>
        <span></span>
      </span>
    `;
    previousList.append(skeleton);
  }
}

async function loadRecentTracks() {
  renderRecentTrackSkeletons();

  try {
    const response = await fetch(`/api/spotify/recent?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Recently played endpoint returned an error.");

    const data = await response.json();
    if (!Array.isArray(data.tracks)) throw new Error("Recently played endpoint returned invalid data.");

    const currentIdentity = currentTrack ? trackIdentity(currentTrack) : "";
    const tracks = data.tracks
      .filter((track) => trackIdentity(track) !== currentIdentity)
      .slice(0, MAX_RECENT_TRACKS);
    renderRecentTracks(tracks);
  } catch {
    previousList.textContent = "Could not load previous tracks.";
  } finally {
    previousList.removeAttribute("aria-busy");
  }
}

function setPreviousOpen(isOpen) {
  previousDrawer.hidden = !isOpen;
  previousToggle.setAttribute("aria-expanded", String(isOpen));
}

previousToggle.addEventListener("click", () => {
  const isOpen = previousDrawer.hidden;
  setPreviousOpen(isOpen);
  if (isOpen) void loadRecentTracks();
});
previousClose.addEventListener("click", () => setPreviousOpen(false));

function stopOfflineStatusUpdates() {
  window.clearTimeout(offlineStatusTimer);
  offlineStatusTimer = null;
}

function scheduleOfflineStatusUpdates() {
  stopOfflineStatusUpdates();
  if (!isOffline || document.hidden) return;
  updateOfflineStatus();
  offlineStatusTimer = window.setTimeout(scheduleOfflineStatusUpdates, 30000);
}

function resumeExperimentTimers() {
  scheduleOfflineStatusUpdates();
}

function suspendExperimentTimers() {
  stopOfflineStatusUpdates();
  window.clearTimeout(titleRevealTimer);
  titleRevealTimer = null;
  titleEl.classList.remove("is-word-revealing");
}

window.addEventListener("spotify:page-resume", resumeExperimentTimers);
window.addEventListener("spotify:page-suspend", suspendExperimentTimers);

// EXPERIMENT: Easter egg. Double-click the status to toggle a restrained afterglow.
presenceBadge.addEventListener("dblclick", () => {
  body.classList.toggle("is-afterglow");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setPreviousOpen(false);
});

window.addEventListener("spotify:track", (event) => {
  const { track, trackChanged, syncedAt } = event.detail;
  isOffline = false;
  stopOfflineStatusUpdates();
  if (track.state === "playing") lastPlaybackObservedAt = syncedAt;
  if (track.state === "recent" && track.playedAt) lastPlaybackObservedAt = new Date(track.playedAt).getTime();
  revealTitle(track, trackChanged);
  currentTrack = { ...track };
});

window.addEventListener("spotify:offline", () => {
  isOffline = true;
  scheduleOfflineStatusUpdates();
});
