import { FluidSim } from './fluid.js';
import { FluidAudio } from './audio.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('c');

function resize() {
  canvas.width  = Math.floor(window.innerWidth  * devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
}
resize();
window.addEventListener('resize', resize);

const sim   = new FluidSim(canvas);
const audio = new FluidAudio();
createUI(sim);

// Hue cycles over time for the rainbow injection effect
let hue = Math.random();

// Pointer state — tracks prev position for sub-step splatting
const ptr = { x: 0.5, y: 0.5, active: false };

// Smoothed speed for audio
let speedSmoothed = 0;

// Fade out hint after first interaction
const hint = document.getElementById('hint');
let hintFaded = false;
function fadeHint() {
  if (hintFaded) return;
  hintFaded = true;
  hint.classList.add('hidden');
}

function onMove(nx, ny) {
  const dx = nx - ptr.x;
  const dy = ny - ptr.y;          // already in [0,1] UV, Y not flipped here
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Advance hue — cycles faster during rapid movement
  const normSpeed = Math.min(dist * 120, 1.0);
  speedSmoothed = speedSmoothed * 0.75 + normSpeed * 0.25;
  hue = (hue + sim.config.colorCycleSpeed * 0.004 * (1 + normSpeed * 2.5)) % 1.0;

  const [r, g, b] = hslToRgb(hue, 1.0, 0.5);
  const color = [r * 0.55, g * 0.55, b * 0.55]; // inject at HDR-ready level

  // Force in sim units (velocity field is ~1 unit = full viewport per second at normal speed)
  // Flip dy: WebGL UV Y=0 is bottom, pointer Y=0 is top
  const fdx =  dx * 500;
  const fdy = -dy * 500;

  // Sub-step: splat along the mouse path so fast moves leave continuous trails
  const steps = Math.min(Math.max(Math.ceil(dist * 300), 1), 8);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    sim.splat(
      ptr.x + dx * t,
      ptr.y + dy * t, // note: ptr.y is in UV (bottom=0), conversion below
      fdx / steps,
      fdy / steps,
      color,
    );
  }

  ptr.x = nx;
  ptr.y = ny;

  audio.update(speedSmoothed);
  fadeHint();
}

// Convert event coords to UV space where Y=0 is bottom (matches WebGL)
function toUV(clientX, clientY) {
  return [
    clientX / window.innerWidth,
    1 - clientY / window.innerHeight,
  ];
}

canvas.addEventListener('mousemove', e => {
  audio.activate();
  const [nx, ny] = toUV(e.clientX, e.clientY);
  onMove(nx, ny);
});

canvas.addEventListener('mouseleave', () => {
  speedSmoothed = 0;
  audio.update(0);
});

canvas.addEventListener('touchstart', e => {
  audio.activate();
  const t = e.touches[0];
  [ptr.x, ptr.y] = toUV(t.clientX, t.clientY);
  fadeHint();
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  audio.activate();
  const t = e.touches[0];
  const [nx, ny] = toUV(t.clientX, t.clientY);
  onMove(nx, ny);
}, { passive: false });

canvas.addEventListener('touchend', () => {
  speedSmoothed = 0;
  audio.update(0);
});

// Animation loop
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.016);
  last = now;

  // Passive hue drift even when idle
  hue = (hue + sim.config.colorCycleSpeed * 0.0005) % 1.0;

  // Gentle speed decay when not moving
  speedSmoothed *= 0.94;
  audio.update(speedSmoothed);

  sim.step(dt);
  sim.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// HSL → linear RGB
function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
