const body = document.body;
const presenceBadge = document.querySelector("#presence-badge");
const titleEl = document.querySelector("#title");
const statusEl = document.querySelector("#status");
const previousToggle = document.querySelector("#previous-toggle");
const previousDrawer = document.querySelector("#previous-drawer");
const previousClose = document.querySelector("#previous-close");
const previousList = document.querySelector("#previous-list");
const pageShell = document.querySelector(".page-shell");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const RECENT_STORAGE_KEY = "spotify-now-playing:experimental-recents";
const MAX_RECENT_TRACKS = 4;
const IDLE_DELAY_MS = 6500;

let currentTrack = null;
let idleTimer = null;
let titleRevealTimer = null;
let touchStart = null;
let lastPlaybackObservedAt = null;
let offlineStatusTimer = null;
let lastActivityAt = performance.now();
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
  titleRevealTimer = window.setTimeout(() => titleEl.classList.remove("is-word-revealing"), 760);
}

function readRecentTracks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_TRACKS) : [];
  } catch {
    return [];
  }
}

function writeRecentTracks(tracks) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(tracks.slice(0, MAX_RECENT_TRACKS)));
  } catch {
    // The experiment remains usable without persistence when storage is unavailable.
  }
}

function trackIdentity(track) {
  return [track.spotifyUrl, track.title, track.artists, track.album].join("|");
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

function renderRecentTracks(tracks = readRecentTracks()) {
  previousList.replaceChildren();

  if (!tracks.length) {
    const empty = document.createElement("p");
    empty.className = "previous-empty";
    empty.textContent = "Previous tracks will collect here as this page observes changes.";
    previousList.append(empty);
    return;
  }

  tracks.forEach((track) => previousList.append(createRecentTrackNode(track)));
}

// EXPERIMENT: Recent listening uses only locally observed tracks; no extra Spotify request.
function rememberPreviousTrack(nextTrack, trackChanged) {
  if (!trackChanged) return;

  if (currentTrack && trackIdentity(currentTrack) !== trackIdentity(nextTrack)) {
    const stored = readRecentTracks().filter((track) => trackIdentity(track) !== trackIdentity(currentTrack));
    stored.unshift({
      title: currentTrack.title,
      artists: currentTrack.artists,
      album: currentTrack.album,
      albumArt: currentTrack.albumArt,
      spotifyUrl: currentTrack.spotifyUrl
    });
    writeRecentTracks(stored);
    if (!previousDrawer.hidden) renderRecentTracks(stored);
  }

  currentTrack = { ...nextTrack };
}

function setPreviousOpen(isOpen) {
  previousDrawer.hidden = !isOpen;
  previousToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) renderRecentTracks();
}

previousToggle.addEventListener("click", () => setPreviousOpen(previousDrawer.hidden));
previousClose.addEventListener("click", () => setPreviousOpen(false));

// EXPERIMENT: Touch gesture reveals the local previous-track strip without cancelling scrolling.
pageShell.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  },
  { passive: true }
);

pageShell.addEventListener(
  "touchend",
  (event) => {
    if (!touchStart || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const horizontal = touch.clientX - touchStart.x;
    const vertical = touch.clientY - touchStart.y;
    touchStart = null;
    if (vertical < -64 && Math.abs(horizontal) < 48) setPreviousOpen(true);
  },
  { passive: true }
);

function canUseIdleState() {
  return finePointer.matches && !reducedMotion.matches && !document.hidden;
}

function clearIdleState() {
  window.clearTimeout(idleTimer);
  idleTimer = null;
  body.classList.remove("is-idle");
}

function scheduleIdleState() {
  if (!canUseIdleState()) {
    clearIdleState();
    return;
  }

  if (idleTimer !== null) return;
  const remaining = Math.max(0, IDLE_DELAY_MS - (performance.now() - lastActivityAt));
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (!canUseIdleState()) return;

    const timeSinceActivity = performance.now() - lastActivityAt;
    if (timeSinceActivity < IDLE_DELAY_MS) {
      scheduleIdleState();
      return;
    }

    body.classList.add("is-idle");
  }, remaining);
}

function recordActivity() {
  lastActivityAt = performance.now();
  if (body.classList.contains("is-idle")) body.classList.remove("is-idle");
  scheduleIdleState();
}

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

function updateExperimentVisibility() {
  if (document.hidden) {
    clearIdleState();
    stopOfflineStatusUpdates();
    return;
  }

  recordActivity();
  scheduleOfflineStatusUpdates();
}

for (const eventName of ["pointermove", "pointerdown", "keydown", "focusin"]) {
  window.addEventListener(eventName, recordActivity, { passive: eventName.startsWith("pointer") });
}

document.addEventListener("visibilitychange", updateExperimentVisibility);
finePointer.addEventListener("change", recordActivity);
reducedMotion.addEventListener("change", recordActivity);

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
  rememberPreviousTrack(track, trackChanged);
});

window.addEventListener("spotify:offline", () => {
  isOffline = true;
  scheduleOfflineStatusUpdates();
});

recordActivity();
