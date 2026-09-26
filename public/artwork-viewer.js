// EXPERIMENT: Touch artwork depth + fullscreen artwork viewer.
// Coarse pointers only. The fine-pointer desktop hover in app.js is left untouched and never overlaps this.
const touchMode = window.matchMedia("(pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;
const artStage = document.querySelector(".art-stage");
const artWrap = document.querySelector(".art-wrap");
const viewer = document.querySelector("#art-viewer");
const viewerBackdrop = viewer.querySelector(".art-viewer-backdrop");
const viewerFrame = viewer.querySelector(".art-viewer-frame");
const viewerClose = document.querySelector("#art-viewer-close");
const pageRegions = [".site-topbar", ".page-shell", ".site-footer", "#previous-drawer", "#modal-scrim"]
  .map((selector) => document.querySelector(selector))
  .filter(Boolean);

const easeCinematic = "cubic-bezier(0.22, 0.72, 0.2, 1)";
const openDurationMs = 520;
const closeDurationMs = 460;
const tapSlopPx = 10;
const tapMaxMs = 500;

// Desktop hover peaks at ±6.4deg (app.js); every touch range below is derived from it.
// Perspective is 900px in the page and scales with the artwork in fullscreen, so a given angle
// reads the same at any size; the size factor only trims the angle on physically larger artwork.
const desktopMaxTilt = 6.4;

const followSpring = { omega: 19, zeta: 1 };
const releaseSpring = { omega: 10.5, zeta: 0.84 };
const viewerFollowSpring = { omega: 14, zeta: 1 };
const viewerReleaseSpring = { omega: 8.5, zeta: 0.8 };
const closeSettleSpring = { omega: 13, zeta: 1 };
const pressInSpring = { omega: 30, zeta: 1 };
const pressOutSpring = { omega: 13, zeta: 0.8 };

// Normal player: controlled, anchored in the layout. Fullscreen: the strongest version, isolated on black.
const slotProfile = {
  tiltRatio: 1.75,
  referenceSize: 320,
  sizeFactorRange: [0.8, 1.1],
  press: 0.972,
  shift: 0,
  follow: followSpring,
  release: releaseSpring
};
const viewerProfile = {
  tiltRatio: 2.6,
  referenceSize: 400,
  sizeFactorRange: [0.85, 1.05],
  press: 0.962,
  shift: 3.5, // % of the artwork's own size, toward the finger
  follow: viewerFollowSpring,
  release: viewerReleaseSpring
};
const reflectionShiftPerDegree = 5.7; // % — the normal-player mapping, extended across the fullscreen range
const reflectionOpacityPerDegree = 0.025;

function createSpring(value, epsilon) {
  return { value, velocity: 0, target: value, params: releaseSpring, epsilon };
}

const motion = {
  tiltX: createSpring(0, 0.01),
  tiltY: createSpring(0, 0.01),
  shiftX: createSpring(0, 0.005),
  shiftY: createSpring(0, 0.005),
  press: createSpring(1, 0.0003),
  maxTilt: desktopMaxTilt * slotProfile.tiltRatio,
  frame: null,
  lastTime: 0
};
const springs = [motion.tiltX, motion.tiltY, motion.shiftX, motion.shiftY, motion.press];
const motionProperties = [
  "--touch-tilt-x",
  "--touch-tilt-y",
  "--touch-shift-x",
  "--touch-shift-y",
  "--touch-press",
  "--touch-reflection-shift",
  "--touch-reflection-opacity"
];

let gesture = null;
let suppressClickUntil = 0;
let viewerState = "closed";
let viewerAnimations = [];
let lockedScrollY = 0;
let slotStyle = null;
let openedByPointer = false;

// Touch motion: pointer input only sets spring targets; a single rAF loop renders them.
function stepSpring(spring, dt) {
  const { omega, zeta } = spring.params;
  const acceleration = omega * omega * (spring.target - spring.value) - 2 * zeta * omega * spring.velocity;
  spring.velocity += acceleration * dt;
  spring.value += spring.velocity * dt;
}

function writeMotion() {
  const limit = motion.maxTilt * 1.08;
  const tiltX = Math.max(-limit, Math.min(limit, motion.tiltX.value));
  const tiltY = Math.max(-limit, Math.min(limit, motion.tiltY.value));

  artWrap.style.setProperty("--touch-tilt-x", `${tiltX.toFixed(3)}deg`);
  artWrap.style.setProperty("--touch-tilt-y", `${tiltY.toFixed(3)}deg`);
  artWrap.style.setProperty("--touch-shift-x", `${motion.shiftX.value.toFixed(3)}%`);
  artWrap.style.setProperty("--touch-shift-y", `${motion.shiftY.value.toFixed(3)}%`);
  artWrap.style.setProperty("--touch-press", motion.press.value.toFixed(4));
  // Driven by the actual angle, so the highlight stays locked to the surface in both ranges.
  artWrap.style.setProperty("--touch-reflection-shift", `${(tiltY * reflectionShiftPerDegree).toFixed(2)}%`);
  artWrap.style.setProperty(
    "--touch-reflection-opacity",
    (0.12 + Math.min(0.4, Math.abs(tiltY) * reflectionOpacityPerDegree)).toFixed(3)
  );
}

function renderMotion(time) {
  const dt = motion.lastTime ? Math.min(0.05, (time - motion.lastTime) / 1000) : 1 / 60;
  motion.lastTime = time;
  let settled = true;

  for (const spring of springs) {
    for (let remaining = dt; remaining > 0; remaining -= 1 / 120) {
      stepSpring(spring, Math.min(remaining, 1 / 120));
    }

    if (Math.abs(spring.target - spring.value) > spring.epsilon || Math.abs(spring.velocity) > spring.epsilon) {
      settled = false;
    } else {
      spring.value = spring.target;
      spring.velocity = 0;
    }
  }

  writeMotion();

  if (settled) {
    motion.frame = null;
    motion.lastTime = 0;
  } else {
    motion.frame = requestAnimationFrame(renderMotion);
  }
}

function requestMotionFrame() {
  if (motion.frame === null) motion.frame = requestAnimationFrame(renderMotion);
}

function settleMotion(release = releaseSpring) {
  [motion.tiltX, motion.tiltY, motion.shiftX, motion.shiftY].forEach((spring) => {
    spring.target = 0;
    spring.params = release;
  });
  motion.press.target = 1;
  motion.press.params = release === closeSettleSpring ? closeSettleSpring : pressOutSpring;
  requestMotionFrame();
}

function clearMotion() {
  if (motion.frame !== null) cancelAnimationFrame(motion.frame);
  motion.frame = null;
  motion.lastTime = 0;
  springs.forEach((spring) => {
    spring.value = spring.target = spring === motion.press ? 1 : 0;
    spring.velocity = 0;
  });
  motionProperties.forEach((property) => artWrap.style.removeProperty(property));
}

// Linear through the middle, then increasing resistance, capped at the edge and beyond.
function resist(value) {
  const knee = 0.75;
  const magnitude = Math.abs(value);
  if (magnitude <= knee) return value;
  return Math.sign(value) * (knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee)));
}

function maxTiltFor(profile, artSize) {
  const [minFactor, maxFactor] = profile.sizeFactorRange;
  const sizeFactor = Math.max(minFactor, Math.min(maxFactor, Math.sqrt(profile.referenceSize / artSize)));
  return desktopMaxTilt * profile.tiltRatio * sizeFactor;
}

function aimAt(clientX, clientY) {
  const { bounds, profile } = gesture;
  const horizontal = resist(((clientX - bounds.left) / bounds.width) * 2 - 1);
  const vertical = resist(((clientY - bounds.top) / bounds.height) * 2 - 1);

  // Same direction as the desktop hover: the side under the finger tips away.
  motion.tiltX.target = -vertical * motion.maxTilt;
  motion.tiltY.target = horizontal * motion.maxTilt;
  motion.shiftX.target = horizontal * profile.shift;
  motion.shiftY.target = vertical * profile.shift;
  [motion.tiltX, motion.tiltY, motion.shiftX, motion.shiftY].forEach((spring) => {
    spring.params = profile.follow;
  });
  requestMotionFrame();
}

function releaseGesture(release = gesture?.profile.release ?? releaseSpring) {
  if (gesture?.captured && gesture.surface.hasPointerCapture(gesture.id)) {
    gesture.surface.releasePointerCapture(gesture.id);
  }
  gesture = null;
  settleMotion(release);
}

// mode "slot": the artwork in the page (tap opens, drag tilts, bounds = the artwork).
// mode "viewer": fullscreen (the viewport is the surface, no tap semantics, never closes).
function startGesture(event, { mode, surface, tilts, bounds, profile, artSize }) {
  gesture = {
    id: event.pointerId,
    mode,
    surface,
    tilts,
    bounds,
    profile,
    captured: false,
    startX: event.clientX,
    startY: event.clientY,
    startTime: event.timeStamp,
    isTap: true
  };

  if (!tilts) return;
  motion.maxTilt = maxTiltFor(profile, artSize);
  motion.press.target = profile.press;
  motion.press.params = pressInSpring;
  aimAt(event.clientX, event.clientY);
}

artWrap.addEventListener("pointerdown", (event) => {
  if (!touchMode.matches || event.pointerType === "mouse") return;
  // Expanded: the fullscreen surface below owns the gesture (this event bubbles to it).
  if (viewerState === "opening" || viewerState === "open") return;
  // Suppresses compatibility mouse events (which would steal focus from the viewer); scrolling and click are unaffected.
  event.preventDefault();

  // A second contact means pinch/multi-touch: neither a tap nor a tilt.
  if (gesture) {
    releaseGesture();
    return;
  }
  if (!event.isPrimary) return;

  // While closing, a tap on the flying artwork reopens it; it does not tilt.
  const tilts = !reducedMotion.matches && viewerState === "closed";
  // Measured once per gesture from the untilted slot, then reused for every move.
  const bounds = tilts ? artStage.getBoundingClientRect() : null;
  startGesture(event, { mode: "slot", surface: artWrap, tilts, bounds, profile: slotProfile, artSize: bounds?.width });
});

viewer.addEventListener("pointerdown", (event) => {
  if (!touchMode.matches || event.pointerType === "mouse") return;
  if (viewerState !== "opening" && viewerState !== "open") return;
  if (viewerClose.contains(event.target)) return;
  event.preventDefault();

  // A second finger hands the gesture to the browser (pinch-zoom).
  if (gesture) {
    releaseGesture();
    return;
  }
  if (!event.isPrimary) return;

  startGesture(event, {
    mode: "viewer",
    surface: viewer,
    tilts: !reducedMotion.matches,
    // The whole viewport is the interaction area: centre is neutral, edges are full range.
    bounds: viewer.getBoundingClientRect(),
    profile: viewerProfile,
    artSize: viewerFrame.offsetWidth
  });
  // Keep receiving moves wherever the finger goes until it lifts.
  viewer.setPointerCapture(event.pointerId);
  gesture.captured = true;
});

window.addEventListener("pointermove", (event) => {
  if (!gesture || event.pointerId !== gesture.id) return;

  if (gesture.isTap && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > tapSlopPx) {
    gesture.isTap = false;
  }
  if (gesture.tilts) aimAt(event.clientX, event.clientY);
});

window.addEventListener("pointerup", (event) => {
  if (!gesture || event.pointerId !== gesture.id) return;

  const opensViewer = gesture.mode === "slot" && gesture.isTap && event.timeStamp - gesture.startTime <= tapMaxMs;
  releaseGesture();
  suppressClickUntil = performance.now() + 600;
  if (opensViewer) openViewer({ byPointer: true });
});

// Fires when the browser takes the gesture over (scroll on the page, pinch in fullscreen) or interrupts it.
window.addEventListener("pointercancel", (event) => {
  if (gesture && event.pointerId === gesture.id) releaseGesture();
});

// Mouse on a touch device, switch control and screen readers arrive as a plain click.
artWrap.addEventListener("click", () => {
  if (!touchMode.matches || performance.now() < suppressClickUntil) return;
  openViewer();
});

artWrap.addEventListener("keydown", (event) => {
  if (!touchMode.matches || viewerState !== "closed" || event.target !== artWrap) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openViewer();
});

// Fullscreen viewer: the real .art-wrap moves into the overlay, laid out at its final size,
// and a FLIP transform on the frame carries it from its measured slot and back.
function hasArtwork() {
  return Boolean(artWrap.querySelector(".album-art.is-loaded"));
}

function syncTrigger() {
  if (touchMode.matches && viewerState === "closed") {
    artWrap.setAttribute("role", "button");
    artWrap.setAttribute("tabindex", "0");
    artWrap.setAttribute("aria-label", "Expand album artwork");
    artWrap.setAttribute("aria-haspopup", "dialog");
  } else {
    ["role", "tabindex", "aria-label", "aria-haspopup"].forEach((name) => artWrap.removeAttribute(name));
  }
}

function syncTouchAction() {
  // Vertical drags stay with the page when it can scroll; otherwise they are free to drive the tilt.
  const pageScrolls = root.scrollHeight > window.innerHeight + 1;
  artWrap.classList.toggle("is-tilt-exclusive", touchMode.matches && !pageScrolls);
}

function setPageInert(isInert) {
  pageRegions.forEach((region) => region.toggleAttribute("inert", isInert));
}

function lockScroll() {
  lockedScrollY = window.scrollY;
  root.classList.add("is-art-viewing");
}

function unlockScroll() {
  root.classList.remove("is-art-viewing");
  if (window.scrollY !== lockedScrollY) window.scrollTo(0, lockedScrollY);
}

function currentTransform(element) {
  return getComputedStyle(element).transform || "none";
}

function currentOpacity(element) {
  return Number.parseFloat(getComputedStyle(element).opacity);
}

function cancelViewerAnimations() {
  viewerAnimations.forEach((animation) => animation.cancel());
  viewerAnimations = [];
}

function whenViewerAnimationsFinish(expectedState, done) {
  const animations = viewerAnimations;
  Promise.all(animations.map((animation) => animation.finished)).then(
    () => {
      if (viewerAnimations === animations && viewerState === expectedState) done();
    },
    () => {}
  );
}

function readSlotStyle() {
  const style = getComputedStyle(artWrap);
  return {
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    shadowY: Number.parseFloat(style.getPropertyValue("--shadow-y")) || 0,
    shadowBlur: Number.parseFloat(style.getPropertyValue("--shadow-blur")) || 0
  };
}

// The frame has no transform while this runs, so its rect is the final fullscreen layout.
function measureFlip() {
  const slot = artStage.getBoundingClientRect();
  const frame = viewerFrame.getBoundingClientRect();
  const scale = slot.width / frame.width;
  const deltaX = slot.left + slot.width / 2 - (frame.left + frame.width / 2);
  const deltaY = slot.top + slot.height / 2 - (frame.top + frame.height / 2);
  return { scale, transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})` };
}

// The fullscreen artwork is scaled down to the slot, so lengths that don't scale with layout
// (perspective, corner radius, shadow) are scaled up by the same factor to stay visually identical.
function applySlotCompensation(scale) {
  const factor = 1 / scale;
  artWrap.style.setProperty("--touch-depth-scale", factor.toFixed(4));
  artWrap.style.setProperty("--shadow-y", `${(slotStyle.shadowY * factor).toFixed(2)}px`);
  artWrap.style.setProperty("--shadow-blur", `${(slotStyle.shadowBlur * factor).toFixed(2)}px`);
  artWrap.style.borderRadius = `${(slotStyle.radius * factor).toFixed(2)}px`;
}

function clearSlotCompensation() {
  ["--touch-depth-scale", "--shadow-y", "--shadow-blur", "border-radius"].forEach((property) =>
    artWrap.style.removeProperty(property)
  );
}

function openViewer({ byPointer = false } = {}) {
  if (!touchMode.matches || !hasArtwork()) return;
  if (viewerState === "opening" || viewerState === "open") return;

  const reversing = viewerState === "closing";
  let from;

  if (reversing) {
    from = {
      transform: currentTransform(viewerFrame),
      backdrop: currentOpacity(viewerBackdrop),
      close: currentOpacity(viewerClose),
      viewer: currentOpacity(viewer)
    };
    cancelViewerAnimations();
  } else {
    slotStyle = readSlotStyle();
    openedByPointer = byPointer;
    lockScroll();
    setPageInert(true);
    viewer.hidden = false;
    viewerFrame.append(artWrap);
    const flip = measureFlip();
    applySlotCompensation(flip.scale);
    from = { transform: flip.transform, backdrop: 0, close: 0, viewer: 0 };
  }

  viewerState = "opening";
  viewer.classList.add("is-open");
  syncTrigger();
  // A live tilt/press eases to neutral on the inner element while the frame flies: one blended motion.
  releaseGesture();
  // Keyboard/assistive opens land on the close control; a finger tap focuses the dialog itself so no focus ring flashes.
  (openedByPointer ? viewer : viewerClose).focus({ preventScroll: true });

  if (reducedMotion.matches) {
    viewerAnimations = [
      viewer.animate([{ opacity: from.viewer }, { opacity: 1 }], { duration: 160, easing: "ease-out", fill: "forwards" })
    ];
  } else {
    viewerAnimations = [
      viewerFrame.animate([{ transform: from.transform }, { transform: "none" }], {
        duration: openDurationMs,
        easing: easeCinematic,
        fill: "forwards"
      }),
      viewerBackdrop.animate([{ opacity: from.backdrop }, { opacity: 1 }], {
        duration: openDurationMs * 0.7,
        easing: "cubic-bezier(0.33, 0, 0.2, 1)",
        fill: "forwards"
      }),
      viewerClose.animate([{ opacity: from.close }, { opacity: 1 }], {
        duration: 260,
        delay: reversing ? 0 : openDurationMs * 0.45,
        easing: "ease-out",
        fill: "both"
      })
    ];
  }

  whenViewerAnimationsFinish("opening", () => {
    cancelViewerAnimations();
    viewerState = "open";
  });
}

function finishClose() {
  cancelViewerAnimations();
  const restoreFocus = viewer.contains(document.activeElement) || document.activeElement === document.body;

  artStage.append(artWrap);
  clearSlotCompensation();
  viewer.classList.remove("is-open");
  viewer.hidden = true;
  setPageInert(false);
  unlockScroll();
  viewerState = "closed";
  syncTrigger();

  if (!restoreFocus) return;
  if (touchMode.matches && !openedByPointer) artWrap.focus({ preventScroll: true });
  else document.activeElement.blur();
}

function closeViewer({ immediate = false } = {}) {
  if (viewerState === "closing" && immediate) {
    finishClose();
    return;
  }
  if (viewerState !== "opening" && viewerState !== "open") return;

  const from = {
    transform: currentTransform(viewerFrame),
    backdrop: currentOpacity(viewerBackdrop),
    close: currentOpacity(viewerClose),
    viewer: currentOpacity(viewer)
  };
  cancelViewerAnimations();
  viewerState = "closing";
  viewer.classList.remove("is-open");
  // Whatever tilt/shift the fullscreen artwork has now eases out during the flight: no flat snap first.
  releaseGesture(closeSettleSpring);

  if (immediate) {
    finishClose();
    return;
  }

  if (reducedMotion.matches) {
    viewerAnimations = [
      viewer.animate([{ opacity: from.viewer }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" })
    ];
  } else {
    const flip = measureFlip();
    applySlotCompensation(flip.scale);
    viewerAnimations = [
      viewerFrame.animate([{ transform: from.transform }, { transform: flip.transform }], {
        duration: closeDurationMs,
        easing: easeCinematic,
        fill: "forwards"
      }),
      viewerBackdrop.animate([{ opacity: from.backdrop }, { opacity: 0 }], {
        duration: closeDurationMs * 0.85,
        delay: closeDurationMs * 0.15,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both"
      }),
      viewerClose.animate([{ opacity: from.close }, { opacity: 0 }], {
        duration: 140,
        easing: "ease-out",
        fill: "forwards"
      })
    ];
  }

  whenViewerAnimationsFinish("closing", finishClose);
}

viewerClose.addEventListener("click", () => closeViewer());

// Belt and braces for iOS versions that still rubber-band a fixed overlay; two-finger pinch-zoom stays available.
viewer.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length === 1) event.preventDefault();
  },
  { passive: false }
);

// Capture phase so Escape closes only the viewer, not the popover/drawer hidden behind it.
window.addEventListener(
  "keydown",
  (event) => {
    if (viewerState === "closed") return;

    // The close control is the dialog's only focusable element, so Tab stays on it.
    if (event.key === "Tab") {
      event.preventDefault();
      viewerClose.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeViewer();
  },
  true
);

window.addEventListener("resize", () => {
  syncTouchAction();
  if (gesture) releaseGesture();

  // A FLIP measured against the old viewport would land in the wrong place; jump to its end state instead.
  if (viewerState === "opening") {
    cancelViewerAnimations();
    viewerState = "open";
  } else if (viewerState === "closing") {
    finishClose();
  }
});

// A new track swaps the <img> inside the same .art-wrap, so the viewer follows automatically; just ease it in.
window.addEventListener("spotify:track", (event) => {
  if (!event.detail.trackChanged || viewerState === "closed" || reducedMotion.matches) return;
  artWrap.querySelector(".album-art.is-loaded")?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 420,
    easing: easeCinematic
  });
});

touchMode.addEventListener("change", () => {
  releaseGesture();
  closeViewer({ immediate: true });
  clearMotion();
  syncTrigger();
  syncTouchAction();
});

reducedMotion.addEventListener("change", () => {
  releaseGesture();
  clearMotion();
});

new ResizeObserver(syncTouchAction).observe(document.body);
syncTrigger();
syncTouchAction();
