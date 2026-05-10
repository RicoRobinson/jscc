// WebGL2 GPU fluid simulation — GLSL 300 es
// Navier-Stokes: advect (RK2) → curl → vorticity → divergence → pressure (Jacobi) → gradient subtract
// Post-process: HDR bloom (prefilter → 2× H+V Gaussian) → Reinhard tonemap → gamma

// ─── Shaders ─────────────────────────────────────────────────────────────────

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Gaussian splat for velocity and dye, aspect-corrected so the blob is circular
const SPLAT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_point;
uniform vec3 u_color;
uniform float u_radius;
uniform float u_aspect;
void main() {
  vec2 d = v_uv - u_point;
  d.x *= u_aspect;
  float splat = exp(-dot(d, d) / u_radius);
  vec3 base = texture(u_tex, v_uv).rgb;
  fragColor = vec4(base + splat * u_color, 1.0);
}`;

// RK2 (midpoint method) advection — significantly smoother than forward Euler
const ADVECT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;
uniform float u_dt;
uniform float u_dissipation;
void main() {
  vec2 vel0 = texture(u_velocity, v_uv).xy;
  vec2 mid  = v_uv - 0.5 * u_dt * vel0 * u_texelSize;
  vec2 vel1 = texture(u_velocity, mid).xy;
  vec2 pos  = v_uv - u_dt * vel1 * u_texelSize;
  fragColor = vec4(u_dissipation * texture(u_source, pos).rgb, 1.0);
}`;

// Scalar curl (z-component of ∇ × v)
const CURL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
void main() {
  float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).y;
  float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).y;
  float T = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).x;
  float curl = 0.5 * ((R - L) - (T - B));
  fragColor = vec4(curl, 0.0, 0.0, 1.0);
}`;

// Vorticity confinement: f = ε · (ẑ × ∇|ω|) · ω — amplifies existing rotation
const VORTICITY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_velocity;
uniform sampler2D u_curl;
uniform vec2 u_texelSize;
uniform float u_curl_strength;
uniform float u_dt;
void main() {
  float L = abs(texture(u_curl, v_uv - vec2(u_texelSize.x, 0.0)).x);
  float R = abs(texture(u_curl, v_uv + vec2(u_texelSize.x, 0.0)).x);
  float T = abs(texture(u_curl, v_uv + vec2(0.0, u_texelSize.y)).x);
  float B = abs(texture(u_curl, v_uv - vec2(0.0, u_texelSize.y)).x);
  float C = texture(u_curl, v_uv).x;
  vec2 N = 0.5 * vec2(R - L, T - B); // ∇|ω|
  N /= length(N) + 1e-5;
  vec2 force = u_curl_strength * vec2(-N.y, N.x) * C; // ẑ × N̂ · ω
  vec2 vel = texture(u_velocity, v_uv).xy;
  fragColor = vec4(vel + force * u_dt, 0.0, 1.0);
}`;

const DIVERGENCE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
void main() {
  float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).y;
  float B = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).y;
  fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

// Jacobi pressure iteration
const PRESSURE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_texelSize;
void main() {
  float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
  float div = texture(u_divergence, v_uv).x;
  fragColor = vec4((L + R + T + B - div) * 0.25, 0.0, 0.0, 1.0);
}`;

// Subtract pressure gradient to make velocity divergence-free
const GRADIENT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
void main() {
  float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
  vec2 vel = texture(u_velocity, v_uv).xy;
  fragColor = vec4(vel - 0.5 * vec2(R - L, T - B), 0.0, 1.0);
}`;

// Bloom prefilter: extract luminous regions above threshold (pre-tonemap)
const BLOOM_THRESH_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_dye;
uniform float u_threshold;
uniform float u_brightness;
void main() {
  vec3 col = texture(u_dye, v_uv).rgb * u_brightness;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee so the transition isn't harsh
  float rq = clamp(luma - u_threshold + 0.1, 0.0, 0.2);
  rq = rq * rq * 25.0;
  float contribution = max(rq, luma - u_threshold) / max(luma, 1e-4);
  fragColor = vec4(col * contribution, 1.0);
}`;

// Separable 9-tap Gaussian blur — called twice (H then V) per pass
const BLOOM_BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_direction;
void main() {
  vec2 d = u_direction;
  vec3 c = vec3(0.0);
  c += texture(u_tex, v_uv - d * 4.0).rgb * 0.0162;
  c += texture(u_tex, v_uv - d * 3.0).rgb * 0.0540;
  c += texture(u_tex, v_uv - d * 2.0).rgb * 0.1216;
  c += texture(u_tex, v_uv - d * 1.0).rgb * 0.1945;
  c += texture(u_tex, v_uv          ).rgb * 0.2270;
  c += texture(u_tex, v_uv + d * 1.0).rgb * 0.1945;
  c += texture(u_tex, v_uv + d * 2.0).rgb * 0.1216;
  c += texture(u_tex, v_uv + d * 3.0).rgb * 0.0540;
  c += texture(u_tex, v_uv + d * 4.0).rgb * 0.0162;
  fragColor = vec4(c, 1.0);
}`;

// Final display: HDR composite → Reinhard tonemap → gamma 2.2
const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_dye;
uniform sampler2D u_bloom;
uniform float u_brightness;
uniform float u_bloomIntensity;
uniform float u_saturation;
void main() {
  vec3 dye   = texture(u_dye,   v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  vec3 col   = dye * u_brightness + bloom * u_bloomIntensity;

  // Saturation
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, u_saturation);

  // Reinhard tonemapping (keeps HDR bloom values from clipping harshly)
  col = col / (col + vec3(1.0));

  // Gamma correction
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  fragColor = vec4(col, 1.0);
}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`Shader:\n${gl.getShaderInfoLog(s)}`);
  return s;
}

function createProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, uniforms };
}

function makeFBO(gl, w, h, iFormat, format, type, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, iFormat, w, h, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function makeDoubleFBO(gl, w, h, iFormat, format, type, filter) {
  let a = makeFBO(gl, w, h, iFormat, format, type, filter);
  let b = makeFBO(gl, w, h, iFormat, format, type, filter);
  return {
    get read()  { return a; },
    get write() { return b; },
    swap() { [a, b] = [b, a]; },
  };
}

// ─── FluidSim ─────────────────────────────────────────────────────────────────

export class FluidSim {
  constructor(canvas) {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not supported in this browser.');

    // Enables rendering to RGBA16F framebuffers
    gl.getExtension('EXT_color_buffer_float');
    this.gl = gl;

    this.config = {
      curl:                 35,
      splatRadius:          0.005,
      velocityDissipation:  0.980,
      dyeDissipation:       0.988,
      pressureIterations:   30,
      bloomEnabled:         true,
      bloomIntensity:       0.9,
      bloomThreshold:       0.45,
      brightness:           2.2,
      saturation:           1.25,
      colorCycleSpeed:      1.2,
    };

    // Fullscreen quad vertex buffer — shared across all programs
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    this.prog = {
      splat:       createProgram(gl, VERT, SPLAT_FRAG),
      advect:      createProgram(gl, VERT, ADVECT_FRAG),
      curl:        createProgram(gl, VERT, CURL_FRAG),
      vorticity:   createProgram(gl, VERT, VORTICITY_FRAG),
      divergence:  createProgram(gl, VERT, DIVERGENCE_FRAG),
      pressure:    createProgram(gl, VERT, PRESSURE_FRAG),
      gradient:    createProgram(gl, VERT, GRADIENT_FRAG),
      bloomThresh: createProgram(gl, VERT, BLOOM_THRESH_FRAG),
      bloomBlur:   createProgram(gl, VERT, BLOOM_BLUR_FRAG),
      display:     createProgram(gl, VERT, DISPLAY_FRAG),
    };

    Object.values(this.prog).forEach(({ p }) => {
      gl.useProgram(p);
      const loc = gl.getAttribLocation(p, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    });

    this._SIM   = 256;
    this._DYE   = 1024;
    this._BLOOM = 256; // low-res bloom → wider soft glow

    this._initFBOs();
  }

  _initFBOs() {
    const gl = this.gl;
    const { _SIM: S, _DYE: D, _BLOOM: B } = this;
    const f16  = gl.RGBA16F;
    const rgba = gl.RGBA;
    const hf   = gl.HALF_FLOAT;

    this.velocity   = makeDoubleFBO(gl, S, S, f16, rgba, hf, gl.LINEAR);
    this.dye        = makeDoubleFBO(gl, D, D, f16, rgba, hf, gl.LINEAR);
    this.pressure   = makeDoubleFBO(gl, S, S, f16, rgba, hf, gl.NEAREST);
    this.divergence = makeFBO(gl, S, S, f16, rgba, hf, gl.NEAREST);
    this.curlFBO    = makeFBO(gl, S, S, f16, rgba, hf, gl.NEAREST);
    this.bloomA     = makeFBO(gl, B, B, f16, rgba, hf, gl.LINEAR);
    this.bloomB     = makeFBO(gl, B, B, f16, rgba, hf, gl.LINEAR);
  }

  _use(name) {
    const gl = this.gl;
    gl.useProgram(this.prog[name].p);
    return this.prog[name].uniforms;
  }

  _bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  _blit(target) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Add a Gaussian force+dye blob at (x, y) in UV space [0,1]
  // dx/dy are pre-scaled velocity deltas; color is [r,g,b] in linear float
  splat(x, y, dx, dy, color) {
    const gl = this.gl;
    const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const r = this.config.splatRadius;

    let u = this._use('splat');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_point, x, y);
    gl.uniform3f(u.u_color, dx, dy, 0.0);
    gl.uniform1f(u.u_radius, r);
    gl.uniform1f(u.u_aspect, aspect);
    this._blit(this.velocity.write);
    this.velocity.swap();

    u = this._use('splat');
    this._bindTex(0, this.dye.read.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_point, x, y);
    gl.uniform3f(u.u_color, color[0], color[1], color[2]);
    gl.uniform1f(u.u_radius, r);
    gl.uniform1f(u.u_aspect, aspect);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  step(dt) {
    const gl = this.gl;
    const c = this.config;
    const S = this._SIM, D = this._DYE;
    const sv = [1 / S, 1 / S];
    const dv = [1 / D, 1 / D];

    // Curl
    let u = this._use('curl');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.curlFBO);

    // Vorticity confinement
    u = this._use('vorticity');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.curlFBO.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_curl, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    gl.uniform1f(u.u_curl_strength, c.curl);
    gl.uniform1f(u.u_dt, dt);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // Divergence
    u = this._use('divergence');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.divergence);

    // Clear pressure before solve
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Pressure solve — Jacobi iterations
    for (let i = 0; i < c.pressureIterations; i++) {
      u = this._use('pressure');
      this._bindTex(0, this.pressure.read.tex);
      this._bindTex(1, this.divergence.tex);
      gl.uniform1i(u.u_pressure, 0);
      gl.uniform1i(u.u_divergence, 1);
      gl.uniform2fv(u.u_texelSize, sv);
      this._blit(this.pressure.write);
      this.pressure.swap();
    }

    // Gradient subtract — project velocity to divergence-free field
    u = this._use('gradient');
    this._bindTex(0, this.pressure.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(u.u_pressure, 0);
    gl.uniform1i(u.u_velocity, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // Advect velocity (self-advection)
    u = this._use('advect');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_source, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    gl.uniform1f(u.u_dt, dt);
    gl.uniform1f(u.u_dissipation, c.velocityDissipation);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // Advect dye along the now-clean velocity field
    u = this._use('advect');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.dye.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_source, 1);
    gl.uniform2fv(u.u_texelSize, dv);
    gl.uniform1f(u.u_dt, dt);
    gl.uniform1f(u.u_dissipation, c.dyeDissipation);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  render() {
    const gl = this.gl;
    const c  = this.config;
    const B  = this._BLOOM;

    if (c.bloomEnabled) {
      // Extract bright regions from HDR dye texture
      let u = this._use('bloomThresh');
      this._bindTex(0, this.dye.read.tex);
      gl.uniform1i(u.u_dye, 0);
      gl.uniform1f(u.u_threshold, c.bloomThreshold);
      gl.uniform1f(u.u_brightness, c.brightness);
      this._blit(this.bloomA);

      // 2 passes of separable H + V Gaussian blur at low resolution → wide soft glow
      for (let pass = 0; pass < 2; pass++) {
        let u = this._use('bloomBlur');
        this._bindTex(0, this.bloomA.tex);
        gl.uniform1i(u.u_tex, 0);
        gl.uniform2f(u.u_direction, 1 / B, 0.0);
        this._blit(this.bloomB);

        u = this._use('bloomBlur');
        this._bindTex(0, this.bloomB.tex);
        gl.uniform1i(u.u_tex, 0);
        gl.uniform2f(u.u_direction, 0.0, 1 / B);
        this._blit(this.bloomA);
      }
    }

    // Composite dye + bloom → tonemap → screen
    const u = this._use('display');
    this._bindTex(0, this.dye.read.tex);
    this._bindTex(1, this.bloomA.tex);
    gl.uniform1i(u.u_dye, 0);
    gl.uniform1i(u.u_bloom, 1);
    gl.uniform1f(u.u_brightness,     c.brightness);
    gl.uniform1f(u.u_bloomIntensity, c.bloomEnabled ? c.bloomIntensity : 0.0);
    gl.uniform1f(u.u_saturation,     c.saturation);
    this._blit(null);
  }
}
