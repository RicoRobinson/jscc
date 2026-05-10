import { FluidSim } from './fluid.js';
import { FluidAudio } from './audio.js';

const canvas = document.getElementById('c');
const hint = document.getElementById('hint');

function resize() {
  canvas.width  = window.innerWidth  * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
resize();
window.addEventListener('resize', resize);

const sim = new FluidSim(canvas);
const audio = new FluidAudio();

// pointer state
const ptr = { x: 0.5, y: 0.5, dx: 0, dy: 0, down: false };
let speedSmoothed = 0;
let hintTimer = setTimeout(() => hint.classList.add('hidden'), 3000);

function onMove(nx, ny) {
  const dx = (nx - ptr.x) * 800;
  const dy = (ptr.y - ny) * 800; // flip Y: WebGL UV origin is bottom-left
  ptr.dx = dx;
  ptr.dy = dy;
  ptr.x = nx;
  ptr.y = ny;

  const rawSpeed = Math.sqrt(dx * dx + dy * dy);
  speedSmoothed = speedSmoothed * 0.7 + rawSpeed * 0.3;
  const normSpeed = Math.min(speedSmoothed / 60, 1);

  // color: fast = warm (red-orange), slow = cool blue-violet, mapped via hue
  const hue = (1 - normSpeed) * 260 + normSpeed * 20; // degrees
  const [r, g, b] = hslToRgb(hue / 360, 0.9, 0.55);

  sim.splat(ptr.x, ptr.y, dx, dy, [r * 0.4, g * 0.4, b * 0.4]);
  audio.update(normSpeed);
}

canvas.addEventListener('mousemove', e => {
  const nx = e.clientX / window.innerWidth;
  const ny = 1 - e.clientY / window.innerHeight;
  audio.activate();
  onMove(nx, ny);
});

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const nx = t.clientX / window.innerWidth;
  const ny = 1 - t.clientY / window.innerHeight;
  audio.activate();
  onMove(nx, ny);
}, { passive: false });

canvas.addEventListener('touchstart', e => {
  const t = e.touches[0];
  ptr.x = t.clientX / window.innerWidth;
  ptr.y = 1 - t.clientY / window.innerHeight;
  audio.activate();
});

// slow decay when idle
function decayIdle() {
  speedSmoothed *= 0.92;
  audio.update(Math.min(speedSmoothed / 60, 1));
}

// animation loop
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.016);
  last = now;

  decayIdle();
  sim.step(dt);
  sim.render();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// HSL -> RGB helper
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}
