const CSS = `
  *,*::before,*::after { box-sizing: border-box; }

  #fluid-toggle {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.55);
    cursor: pointer;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, color 0.2s, border-color 0.2s;
    padding: 0;
    outline: none;
    flex-shrink: 0;
  }
  #fluid-toggle:hover,
  #fluid-toggle.active {
    background: rgba(255,255,255,0.13);
    border-color: rgba(255,255,255,0.22);
    color: rgba(255,255,255,0.9);
  }
  #fluid-toggle svg { display: block; }

  #fluid-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 272px;
    height: 100%;
    background: rgba(6,6,10,0.93);
    border-left: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.16,1,0.3,1);
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 199;
    padding: 64px 20px 32px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }
  #fluid-panel::-webkit-scrollbar { width: 4px; }
  #fluid-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

  #fluid-panel.open { transform: translateX(0); }

  .fp-title {
    font-family: system-ui, sans-serif;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.25);
    margin: 0 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .fp-group { margin-bottom: 24px; }

  .fp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .fp-label {
    font-family: system-ui, sans-serif;
    font-size: 11.5px;
    color: rgba(255,255,255,0.6);
    width: 120px;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fp-value {
    font-family: monospace;
    font-size: 10.5px;
    color: rgba(255,255,255,0.35);
    width: 34px;
    text-align: right;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* Toggle row (for checkboxes) */
  .fp-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    cursor: pointer;
  }
  .fp-toggle-row .fp-label { width: auto; cursor: pointer; }

  /* Pill toggle switch */
  .fp-switch {
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
  }
  .fp-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .fp-switch-track {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.12);
    transition: background 0.2s;
    cursor: pointer;
  }
  .fp-switch-track::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgba(255,255,255,0.4);
    top: 2px;
    left: 2px;
    transition: transform 0.2s, background 0.2s;
  }
  .fp-switch input:checked + .fp-switch-track {
    background: rgba(120,180,255,0.25);
    border-color: rgba(120,180,255,0.4);
  }
  .fp-switch input:checked + .fp-switch-track::after {
    transform: translateX(16px);
    background: rgba(160,210,255,0.9);
  }

  /* Range slider */
  input[type=range] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 2px;
    background: rgba(255,255,255,0.12);
    border-radius: 1px;
    outline: none;
    cursor: pointer;
    transition: background 0.2s;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: rgba(255,255,255,0.85);
    cursor: pointer;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.1), 0 0 8px rgba(180,220,255,0.3);
    transition: box-shadow 0.15s;
  }
  input[type=range]::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.85);
    cursor: pointer;
  }
  input[type=range]:hover::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px rgba(255,255,255,0.15), 0 0 12px rgba(180,220,255,0.5);
  }

  .fp-divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 20px 0;
  }
`;

export function createUI(sim) {
  // Inject CSS
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // Toggle button (sliders icon)
  const toggle = document.createElement('button');
  toggle.id = 'fluid-toggle';
  toggle.setAttribute('aria-label', 'Toggle parameters');
  toggle.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <line x1="2" y1="4" x2="14" y2="4"/>
    <circle cx="5.5" cy="4" r="1.8" fill="currentColor" stroke="none"/>
    <line x1="2" y1="8" x2="14" y2="8"/>
    <circle cx="10.5" cy="8" r="1.8" fill="currentColor" stroke="none"/>
    <line x1="2" y1="12" x2="14" y2="12"/>
    <circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>
  </svg>`;
  document.body.appendChild(toggle);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'fluid-panel';
  document.body.appendChild(panel);

  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.classList.toggle('open', open);
    toggle.classList.toggle('active', open);
  });

  // ─── Parameter definitions ──────────────────────────────────────────────────
  // Each entry: { label, key, min, max, step, format }
  // format: function from raw value → display string (optional)
  const groups = [
    {
      title: 'Simulation',
      rows: [
        { label: 'Curl / Vorticity',  key: 'curl',                 min: 0,     max: 80,    step: 1,     fmt: v => v.toFixed(0) },
        { label: 'Splat Size',        key: 'splatRadius',           min: 0.001, max: 0.02,  step: 0.001, fmt: v => v.toFixed(3) },
        { label: 'Vel. Persistence',  key: 'velocityDissipation',   min: 0.90,  max: 1.00,  step: 0.001, fmt: v => v.toFixed(3) },
        { label: 'Dye Persistence',   key: 'dyeDissipation',        min: 0.95,  max: 1.00,  step: 0.001, fmt: v => v.toFixed(3) },
        { label: 'Pressure Steps',    key: 'pressureIterations',    min: 5,     max: 60,    step: 1,     fmt: v => v.toFixed(0) },
      ],
    },
    {
      title: 'Rendering',
      rows: [
        { label: 'Brightness',        key: 'brightness',     min: 0.5,  max: 5.0,  step: 0.05,  fmt: v => v.toFixed(2) },
        { label: 'Saturation',        key: 'saturation',     min: 0.0,  max: 2.5,  step: 0.05,  fmt: v => v.toFixed(2) },
        { label: 'Bloom Intensity',   key: 'bloomIntensity', min: 0.0,  max: 3.0,  step: 0.05,  fmt: v => v.toFixed(2) },
        { label: 'Bloom Threshold',   key: 'bloomThreshold', min: 0.0,  max: 1.0,  step: 0.01,  fmt: v => v.toFixed(2) },
      ],
      toggle: { label: 'Bloom', key: 'bloomEnabled' },
    },
    {
      title: 'Color',
      rows: [
        { label: 'Hue Cycle Speed',  key: 'colorCycleSpeed', min: 0.0, max: 5.0, step: 0.05, fmt: v => v.toFixed(2) },
      ],
    },
  ];

  groups.forEach(group => {
    const section = document.createElement('div');
    section.className = 'fp-group';

    const title = document.createElement('div');
    title.className = 'fp-title';
    title.textContent = group.title;
    section.appendChild(title);

    // Optional boolean toggle at the top of the section
    if (group.toggle) {
      section.appendChild(makeSwitchRow(group.toggle.label, group.toggle.key, sim));
    }

    group.rows.forEach(def => {
      section.appendChild(makeSliderRow(def, sim));
    });

    panel.appendChild(section);
  });
}

function makeSliderRow(def, sim) {
  const row = document.createElement('div');
  row.className = 'fp-row';

  const label = document.createElement('span');
  label.className = 'fp-label';
  label.textContent = def.label;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min  = def.min;
  slider.max  = def.max;
  slider.step = def.step;
  slider.value = sim.config[def.key];

  const valueEl = document.createElement('span');
  valueEl.className = 'fp-value';
  valueEl.textContent = def.fmt(sim.config[def.key]);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    sim.config[def.key] = v;
    valueEl.textContent = def.fmt(v);
  });

  row.appendChild(label);
  row.appendChild(slider);
  row.appendChild(valueEl);
  return row;
}

function makeSwitchRow(label, key, sim) {
  const row = document.createElement('label');
  row.className = 'fp-toggle-row';

  const lbl = document.createElement('span');
  lbl.className = 'fp-label';
  lbl.textContent = label;

  const sw = document.createElement('div');
  sw.className = 'fp-switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = sim.config[key];
  input.addEventListener('change', () => { sim.config[key] = input.checked; });

  const track = document.createElement('div');
  track.className = 'fp-switch-track';

  sw.appendChild(input);
  sw.appendChild(track);

  row.appendChild(lbl);
  row.appendChild(sw);
  return row;
}
