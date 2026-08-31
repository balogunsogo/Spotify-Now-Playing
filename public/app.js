import { DEFAULT_PALETTE, extractPaletteFromPixels } from "./palette.js";

const playerEl = document.querySelector("#player");
const trackCopyEl = document.querySelector(".track-copy");
const presenceBadge = document.querySelector("#presence-badge");
const lagosTimeEl = document.querySelector("#lagos-time");
const aboutToggle = document.querySelector("#about-toggle");
const aboutPopover = document.querySelector("#about-popover");
const modalScrim = document.querySelector("#modal-scrim");
const artWrap = document.querySelector(".art-wrap");
let albumArt = document.querySelector("#album-art");
const artFallback = document.querySelector("#art-fallback");
const statusEl = document.querySelector("#status");
const titleEl = document.querySelector("#title");
const artistEl = document.querySelector("#artist");
const albumEl = document.querySelector("#album");
const linkEl = document.querySelector("#spotify-link");
const explicitEl = document.querySelector("#explicit");
const ambientLayers = [
  document.querySelector("#ambient-layer-a"),
  document.querySelector("#ambient-layer-b")
];
const pollIntervalMs = 10000;
const lagosTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const paletteCache = new Map();
const paletteCacheLimit = 16;
let paletteCanvas = null;
let paletteContext = null;

let activeRequest = null;
let pollTimer = null;
let clockTimer = null;
let lastPlaybackState = "";
let displayedTrackKey = "";
let ambientLayerIndex = 0;
let sceneGeneration = 0;
let pendingScene = null;
let cancelArtworkPreload = null;
let sceneMidpointTimer = null;
let sceneCleanupTimer = null;
let tiltFrame = null;
let tiltBounds = null;
const tilt = {
  currentX: 0,
  currentY: 0,
  currentLift: 0,
  targetX: 0,
  targetY: 0,
  targetLift: 0
};

function updateLagosTime() {
  const now = new Date();
  const time = lagosTimeFormatter.format(now);

  lagosTimeEl.textContent = `${time} WAT`;
  lagosTimeEl.dateTime = now.toISOString();
}

function scheduleLagosClock() {
  window.clearTimeout(clockTimer);
  updateLagosTime();
  const delayUntilNextMinute = 60000 - (Date.now() % 60000) + 50;
  clockTimer = window.setTimeout(scheduleLagosClock, delayUntilNextMinute);
}

function setPlaybackState(state) {
  if (state === lastPlaybackState) return;
  lastPlaybackState = state;

  const isPlaying = state === "playing";
  const isPaused = state === "paused";

  presenceBadge.textContent = isPlaying ? "Online" : isPaused ? "Paused" : "Offline";
  presenceBadge.classList.toggle("is-online", isPlaying);
  presenceBadge.classList.toggle("is-offline", !isPlaying);
  playerEl.classList.toggle("is-playing", isPlaying);
  playerEl.classList.toggle("is-paused", isPaused);
  playerEl.classList.toggle("is-offline", !isPlaying && !isPaused);
  document.body.dataset.playbackState = isPlaying ? "playing" : isPaused ? "paused" : "offline";
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

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  const units = [
    ["YR", 31536000],
    ["MO", 2592000],
    ["DAY", 86400],
    ["HR", 3600],
    ["MIN", 60]
  ];

  for (const [label, size] of units) {
    if (elapsedSeconds >= size) {
      return `Last played · ${Math.floor(elapsedSeconds / size)} ${label} ago`;
    }
  }

  return "Last played · just now";
}

function getTrackKey(track) {
  return [track.spotifyUrl, track.title, track.artists, track.album, track.durationMs].join("|");
}

function getStatusText(track) {
  if (track.state === "playing") return "Currently listening to";
  if (track.state === "paused") return "Playback paused";
  if (track.state === "recent") return formatPlayedAt(track.playedAt);
  return "Spotify offline";
}

// EXPERIMENT: Ambient background engine. Palette extraction remains separate from Spotify fetching.
function setAmbientLayer(layer, imageUrl, palette) {
  const base = palette.base.join(", ");
  const accent = palette.accent.join(", ");
  const middle = palette.base.map((channel, index) => Math.round((channel + palette.accent[index]) / 2)).join(", ");
  const paletteSeed = palette.base.reduce((total, channel, index) => total + channel * (index + 3), 0);
  const fieldOneX = 38 + (paletteSeed % 24);
  const fieldTwoY = 62 + (paletteSeed % 18);
  const fieldThreeX = 76 + (paletteSeed % 12);

  layer.style.setProperty("--ambient-artwork", imageUrl ? `url(${JSON.stringify(imageUrl)})` : "none");
  layer.style.backgroundImage = [
    `radial-gradient(circle at ${fieldOneX}% 28%, rgba(${accent}, 0.42), transparent 44%)`,
    `radial-gradient(circle at 14% ${fieldTwoY}%, rgba(${base}, 0.32), transparent 50%)`,
    `radial-gradient(circle at ${fieldThreeX}% 58%, rgba(${middle}, 0.22), transparent 48%)`,
    "linear-gradient(180deg, rgba(3, 3, 3, 0.16), rgba(3, 3, 3, 0.76))"
  ].join(", ");
}

function prepareAmbientScene(imageUrl, palette = DEFAULT_PALETTE) {
  const nextIndex = ambientLayerIndex === 0 ? 1 : 0;
  const nextLayer = ambientLayers[nextIndex];

  nextLayer.classList.remove("is-active", "is-blooming");
  setAmbientLayer(nextLayer, imageUrl, palette);
  return { nextIndex, nextLayer, palette };
}

function activateAmbientScene(preparedAmbient, shouldBloom) {
  const currentLayer = ambientLayers[ambientLayerIndex];
  const { nextIndex, nextLayer, palette } = preparedAmbient;

  document.documentElement.style.setProperty("--accent-rgb", palette.accent.join(", "));
  document.documentElement.style.setProperty("--base-rgb", palette.base.join(", "));
  nextLayer.classList.toggle("is-blooming", shouldBloom);
  nextLayer.classList.add("is-active");
  currentLayer.classList.remove("is-active");
  ambientLayerIndex = nextIndex;
}

function extractPalette(imageUrl, sourceImage) {
  if (paletteCache.has(imageUrl)) {
    return paletteCache.get(imageUrl);
  }

  let palette = DEFAULT_PALETTE;

  try {
    if (!paletteCanvas) {
      paletteCanvas = document.createElement("canvas");
      paletteCanvas.width = 32;
      paletteCanvas.height = 32;
      paletteContext = paletteCanvas.getContext("2d", { willReadFrequently: true });
    }

    paletteContext.clearRect(0, 0, paletteCanvas.width, paletteCanvas.height);
    paletteContext.drawImage(sourceImage, 0, 0, paletteCanvas.width, paletteCanvas.height);
    const pixels = paletteContext.getImageData(0, 0, paletteCanvas.width, paletteCanvas.height).data;
    palette = extractPaletteFromPixels(pixels);
  } catch {
    palette = DEFAULT_PALETTE;
  }

  if (paletteCache.size >= paletteCacheLimit) {
    paletteCache.delete(paletteCache.keys().next().value);
  }
  paletteCache.set(imageUrl, palette);
  return palette;
}

async function prepareIncomingScene(track, generation) {
  const imageUrl = track.albumArt;

  if (!imageUrl) {
    return {
      image: null,
      ambient: prepareAmbientScene("", DEFAULT_PALETTE)
    };
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.fetchPriority = displayedTrackKey ? "auto" : "high";

  let cancelThisPreload = null;
  const loaded = await new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(false), 8000);
    const finish = (didLoad) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(didLoad);
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    cancelThisPreload = () => {
      image.removeAttribute("src");
      finish(false);
    };
    cancelArtworkPreload = cancelThisPreload;
    image.src = imageUrl;
  });

  if (cancelArtworkPreload === cancelThisPreload) cancelArtworkPreload = null;

  if (generation !== sceneGeneration) return null;

  if (!loaded) {
    return {
      image: null,
      ambient: prepareAmbientScene("", DEFAULT_PALETTE)
    };
  }

  if (typeof image.decode === "function") {
    await new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 1500);
      image.decode().then(
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        () => {
          window.clearTimeout(timeout);
          resolve();
        }
      );
    });
  }

  if (generation !== sceneGeneration) return null;

  const palette = extractPalette(imageUrl, image);
  return {
    image,
    ambient: prepareAmbientScene(imageUrl, palette)
  };
}

const depthPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function canUseArtworkDepth() {
  return depthPointer.matches && !reducedMotion.matches && !document.hidden;
}

// EXPERIMENT: Artwork depth. Pointer motion only supplies targets; rendering is interpolated.
function renderArtworkDepth() {
  tilt.currentX += (tilt.targetX - tilt.currentX) * 0.11;
  tilt.currentY += (tilt.targetY - tilt.currentY) * 0.11;
  tilt.currentLift += (tilt.targetLift - tilt.currentLift) * 0.09;

  artWrap.style.setProperty("--tilt-x", `${tilt.currentX.toFixed(3)}deg`);
  artWrap.style.setProperty("--tilt-y", `${tilt.currentY.toFixed(3)}deg`);
  artWrap.style.setProperty("--art-lift", `${tilt.currentLift.toFixed(3)}px`);
  artWrap.style.setProperty("--shadow-x", `${(-tilt.currentY * 2.4).toFixed(2)}px`);
  artWrap.style.setProperty("--shadow-y", `${(24 + tilt.currentX * 1.6).toFixed(2)}px`);
  artWrap.style.setProperty("--shadow-blur", `${(60 + Math.abs(tilt.currentX + tilt.currentY) * 2).toFixed(2)}px`);
  artWrap.style.setProperty("--reflection-shift", `${(tilt.currentY * 8).toFixed(2)}%`);
  artWrap.style.setProperty("--reflection-opacity", `${(0.12 + Math.abs(tilt.currentY) * 0.035).toFixed(3)}`);

  const distance =
    Math.abs(tilt.targetX - tilt.currentX) +
    Math.abs(tilt.targetY - tilt.currentY) +
    Math.abs(tilt.targetLift - tilt.currentLift);
  if (distance > 0.01) {
    tiltFrame = requestAnimationFrame(renderArtworkDepth);
  } else {
    tilt.currentX = tilt.targetX;
    tilt.currentY = tilt.targetY;
    tiltFrame = null;
  }
}

function requestArtworkDepthFrame() {
  if (tiltFrame === null) tiltFrame = requestAnimationFrame(renderArtworkDepth);
}

function resetArtworkDepth(immediate = false) {
  tilt.targetX = 0;
  tilt.targetY = 0;
  tilt.targetLift = 0;
  tiltBounds = null;

  if (immediate) {
    if (tiltFrame !== null) cancelAnimationFrame(tiltFrame);
    tilt.currentX = 0;
    tilt.currentY = 0;
    tilt.currentLift = 0;
    tiltFrame = null;
    artWrap.style.setProperty("--tilt-x", "0deg");
    artWrap.style.setProperty("--tilt-y", "0deg");
    artWrap.style.setProperty("--art-lift", "0px");
    artWrap.style.setProperty("--shadow-x", "0px");
    artWrap.style.setProperty("--shadow-y", "24px");
    artWrap.style.setProperty("--shadow-blur", "60px");
    return;
  }

  requestArtworkDepthFrame();
}

artWrap.addEventListener("pointerenter", () => {
  if (!canUseArtworkDepth()) return;
  tiltBounds = artWrap.getBoundingClientRect();
  tilt.targetLift = -6;
  requestArtworkDepthFrame();
});

artWrap.addEventListener("pointermove", (event) => {
  if (!canUseArtworkDepth() || !tiltBounds) return;
  const horizontal = (event.clientX - tiltBounds.left) / tiltBounds.width - 0.5;
  const vertical = (event.clientY - tiltBounds.top) / tiltBounds.height - 0.5;
  tilt.targetX = Math.max(-3.2, Math.min(3.2, vertical * -6.4));
  tilt.targetY = Math.max(-3.2, Math.min(3.2, horizontal * 6.4));
  requestArtworkDepthFrame();
});

artWrap.addEventListener("pointerleave", () => resetArtworkDepth());
artWrap.addEventListener("pointercancel", () => resetArtworkDepth());
reducedMotion.addEventListener("change", (event) => {
  if (event.matches) resetArtworkDepth(true);
});
depthPointer.addEventListener("change", () => resetArtworkDepth(true));

function announceTrack(track, trackChanged) {
  window.dispatchEvent(
    new CustomEvent("spotify:track", {
      detail: {
        track: { ...track },
        trackChanged,
        syncedAt: Date.now()
      }
    })
  );
}

function clearSceneTimeline() {
  window.clearTimeout(sceneMidpointTimer);
  window.clearTimeout(sceneCleanupTimer);
  sceneMidpointTimer = null;
  sceneCleanupTimer = null;
  playerEl.classList.remove("is-departing", "is-arriving");
  trackCopyEl.classList.remove("is-transitioning");
  document.body.classList.remove("is-scene-departing");
  ambientLayers.forEach((layer) => layer.classList.remove("is-blooming"));
}

function cancelPendingScene() {
  sceneGeneration += 1;
  cancelArtworkPreload?.();
  cancelArtworkPreload = null;
  pendingScene = null;
  clearSceneTimeline();
}

function applyTrackContent(track) {
  titleEl.textContent = track.title;
  artistEl.textContent = track.artists;
  albumEl.textContent = track.album;
  titleEl.title = track.title;
  artistEl.title = track.artists;
  explicitEl.hidden = !track.explicit;

  if (track.spotifyUrl) {
    linkEl.href = track.spotifyUrl;
    linkEl.hidden = false;
  } else {
    linkEl.hidden = true;
  }

  setPlaybackState(track.state);
  statusEl.textContent = getStatusText(track);
}

function applyPreparedArtwork(track, prepared) {
  if (!prepared.image) {
    albumArt.remove();
    albumArt = document.createElement("img");
    albumArt.id = "album-art";
    albumArt.className = "album-art";
    albumArt.alt = "";
    albumArt.crossOrigin = "anonymous";
    albumArt.decoding = "async";
    artWrap.insertBefore(albumArt, artFallback);
    artFallback.hidden = false;
    return;
  }

  const nextArtwork = prepared.image;
  nextArtwork.id = "album-art";
  nextArtwork.className = "album-art is-loaded";
  nextArtwork.alt = track.album ? `${track.album} cover art` : `${track.title} cover art`;
  albumArt.replaceWith(nextArtwork);
  albumArt = nextArtwork;
  artFallback.hidden = true;
}

function beginSceneReveal(prepared, shouldBloom) {
  if (reducedMotion.matches) return;

  trackCopyEl.classList.add("is-transitioning");
  playerEl.classList.add("is-arriving");

  sceneCleanupTimer = window.setTimeout(() => {
    trackCopyEl.classList.remove("is-transitioning");
    playerEl.classList.remove("is-arriving");
    if (shouldBloom) prepared.ambient.nextLayer.classList.remove("is-blooming");
    sceneCleanupTimer = null;
  }, 900);
}

function commitPreparedScene(trackKey, prepared, generation) {
  if (generation !== sceneGeneration || pendingScene?.key !== trackKey) return;

  const latestTrack = pendingScene.track;
  const shouldBloom = latestTrack.state === "playing" && !reducedMotion.matches;

  clearSceneTimeline();
  applyTrackContent(latestTrack);
  applyPreparedArtwork(latestTrack, prepared);
  activateAmbientScene(prepared.ambient, shouldBloom);

  displayedTrackKey = trackKey;
  pendingScene = null;
  announceTrack(latestTrack, true);
  beginSceneReveal(prepared, shouldBloom);
}

async function coordinateTrackScene(track, trackKey) {
  cancelPendingScene();
  const generation = sceneGeneration;
  pendingScene = { key: trackKey, track };

  let prepared;
  try {
    prepared = await prepareIncomingScene(track, generation);
  } catch {
    if (generation !== sceneGeneration || pendingScene?.key !== trackKey) return;
    prepared = {
      image: null,
      ambient: prepareAmbientScene("", DEFAULT_PALETTE)
    };
  }
  if (!prepared || generation !== sceneGeneration || pendingScene?.key !== trackKey) return;

  if (!displayedTrackKey || reducedMotion.matches) {
    commitPreparedScene(trackKey, prepared, generation);
    return;
  }

  playerEl.classList.add("is-departing");
  document.body.classList.add("is-scene-departing");

  sceneMidpointTimer = window.setTimeout(() => {
    sceneMidpointTimer = null;
    commitPreparedScene(trackKey, prepared, generation);
  }, 180);
}

function updateDisplayedTrackState(track) {
  setPlaybackState(track.state);
  const nextStatus = getStatusText(track);
  if (statusEl.textContent !== nextStatus) statusEl.textContent = nextStatus;
  announceTrack(track, false);
}

// EXPERIMENT: Track arrival. Only a changed stable track key enters the staged sequence.
function render(track) {
  const trackKey = getTrackKey(track);

  if (trackKey === displayedTrackKey) {
    if (pendingScene) cancelPendingScene();
    updateDisplayedTrackState(track);
    return;
  }

  if (pendingScene?.key === trackKey) {
    pendingScene.track = track;
    return;
  }

  void coordinateTrackScene(track, trackKey);
}

function showOffline(error) {
  cancelPendingScene();
  setPlaybackState("offline");
  if (statusEl.textContent !== "Spotify unavailable") statusEl.textContent = "Spotify unavailable";
  titleEl.textContent = displayedTrackKey ? titleEl.textContent : "Try again soon";
  artistEl.textContent = displayedTrackKey ? artistEl.textContent : error.message;
  albumEl.textContent = displayedTrackKey ? albumEl.textContent : "";
  if (!displayedTrackKey) {
    linkEl.hidden = true;
    explicitEl.hidden = true;
  }
  window.dispatchEvent(
    new CustomEvent("spotify:offline", {
      detail: { error: error.message, syncedAt: Date.now() }
    })
  );
}

async function loadTrack() {
  if (activeRequest) activeRequest.abort();

  const controller = new AbortController();
  activeRequest = controller;

  try {
    const response = await fetch(`/api/spotify?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) throw new Error("Spotify endpoint returned an error.");
    const track = await response.json();

    try {
      render(track);
    } catch (error) {
      console.error("Spotify response rendered with an error.", error);
    }
  } catch (error) {
    if (error.name !== "AbortError") showOffline(error);
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}

async function pollTrack() {
  window.clearTimeout(pollTimer);
  pollTimer = null;
  await loadTrack();
  if (!document.hidden) {
    pollTimer = window.setTimeout(pollTrack, pollIntervalMs);
  }
}

function updatePageVisibility() {
  const isHidden = document.hidden;
  document.body.classList.toggle("is-page-hidden", isHidden);

  if (isHidden) {
    cancelPendingScene();
    window.clearTimeout(pollTimer);
    window.clearTimeout(clockTimer);
    pollTimer = null;
    clockTimer = null;
    activeRequest?.abort();
    resetArtworkDepth(true);
    return;
  }

  scheduleLagosClock();
  pollTrack();
}

aboutToggle.addEventListener("click", () => {
  setAboutOpen(aboutPopover.hidden);
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.closest("a")) return;
  if (aboutPopover.hidden || aboutPopover.contains(target) || aboutToggle.contains(target)) return;
  setAboutOpen(false);
});

modalScrim.addEventListener("click", () => {
  setAboutOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setAboutOpen(false);
});

document.addEventListener("visibilitychange", updatePageVisibility);
updatePageVisibility();
