// GPU fluid simulation — Jos Stam style on WebGL 1 with OES_texture_float

const VERT = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const SPLAT_VERT = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const SPLAT_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform vec2 u_point;
  uniform vec3 u_color;
  uniform float u_radius;
  uniform bool u_isVelocity;
  void main() {
    vec2 d = v_uv - u_point;
    d.x *= (1.0 / 1.0); // aspect handled externally via radius
    float splat = exp(-dot(d, d) / u_radius);
    vec3 base = texture2D(u_tex, v_uv).xyz;
    gl_FragColor = vec4(base + splat * u_color, 1.0);
  }
`;

const ADVECT_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_velocity;
  uniform sampler2D u_source;
  uniform vec2 u_texelSize;
  uniform float u_dt;
  uniform float u_dissipation;
  void main() {
    vec2 vel = texture2D(u_velocity, v_uv).xy;
    vec2 pos = v_uv - u_dt * vel * u_texelSize;
    gl_FragColor = u_dissipation * texture2D(u_source, pos);
  }
`;

const CURL_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_velocity;
  uniform vec2 u_texelSize;
  void main() {
    float L = texture2D(u_velocity, v_uv - vec2(u_texelSize.x, 0)).y;
    float R = texture2D(u_velocity, v_uv + vec2(u_texelSize.x, 0)).y;
    float T = texture2D(u_velocity, v_uv + vec2(0, u_texelSize.y)).x;
    float B = texture2D(u_velocity, v_uv - vec2(0, u_texelSize.y)).x;
    float curl = 0.5 * ((R - L) - (T - B));
    gl_FragColor = vec4(curl, 0.0, 0.0, 1.0);
  }
`;

const VORTICITY_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_velocity;
  uniform sampler2D u_curl;
  uniform vec2 u_texelSize;
  uniform float u_curl_strength;
  uniform float u_dt;
  void main() {
    float L = abs(texture2D(u_curl, v_uv - vec2(u_texelSize.x, 0)).x);
    float R = abs(texture2D(u_curl, v_uv + vec2(u_texelSize.x, 0)).x);
    float T = abs(texture2D(u_curl, v_uv + vec2(0, u_texelSize.y)).x);
    float B = abs(texture2D(u_curl, v_uv - vec2(0, u_texelSize.y)).x);
    float C =     texture2D(u_curl, v_uv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 1e-5;
    force *= u_curl_strength * C;
    vec2 vel = texture2D(u_velocity, v_uv).xy;
    gl_FragColor = vec4(vel + force * u_dt, 0.0, 1.0);
  }
`;

const DIVERGENCE_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_velocity;
  uniform vec2 u_texelSize;
  void main() {
    float L = texture2D(u_velocity, v_uv - vec2(u_texelSize.x, 0)).x;
    float R = texture2D(u_velocity, v_uv + vec2(u_texelSize.x, 0)).x;
    float T = texture2D(u_velocity, v_uv + vec2(0, u_texelSize.y)).y;
    float B = texture2D(u_velocity, v_uv - vec2(0, u_texelSize.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const PRESSURE_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_pressure;
  uniform sampler2D u_divergence;
  uniform vec2 u_texelSize;
  void main() {
    float L = texture2D(u_pressure, v_uv - vec2(u_texelSize.x, 0)).x;
    float R = texture2D(u_pressure, v_uv + vec2(u_texelSize.x, 0)).x;
    float T = texture2D(u_pressure, v_uv + vec2(0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_uv - vec2(0, u_texelSize.y)).x;
    float div = texture2D(u_divergence, v_uv).x;
    gl_FragColor = vec4((L + R + T + B - div) * 0.25, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_pressure;
  uniform sampler2D u_velocity;
  uniform vec2 u_texelSize;
  void main() {
    float L = texture2D(u_pressure, v_uv - vec2(u_texelSize.x, 0)).x;
    float R = texture2D(u_pressure, v_uv + vec2(u_texelSize.x, 0)).x;
    float T = texture2D(u_pressure, v_uv + vec2(0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_uv - vec2(0, u_texelSize.y)).x;
    vec2 vel = texture2D(u_velocity, v_uv).xy;
    gl_FragColor = vec4(vel - 0.5 * vec2(R - L, T - B), 0.0, 1.0);
  }
`;

const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_dye;
  uniform sampler2D u_velocity;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 dye = texture2D(u_dye, v_uv).rgb;
    float mag = length(texture2D(u_velocity, v_uv).xy);
    float speed = clamp(mag * 0.4, 0.0, 1.0);

    // hue shifts with speed: deep violet -> cyan -> warm orange
    float hue = mix(0.72, 0.08, speed);
    float sat = 0.85 + 0.15 * speed;
    float val = clamp(length(dye) * 1.6, 0.0, 1.0);

    vec3 tint = hsv2rgb(vec3(hue, sat, val));
    gl_FragColor = vec4(tint, 1.0);
  }
`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function createProgram(gl, vertSrc, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
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

function createDoubleFBO(gl, w, h, internalFormat, format, type, filter) {
  const make = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  };
  let read = make(), write = make();
  return {
    get read() { return read; },
    get write() { return write; },
    swap() { [read, write] = [write, read]; },
  };
}

export class FluidSim {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL not supported');

    const floatExt = gl.getExtension('OES_texture_float');
    const linearExt = gl.getExtension('OES_texture_float_linear');
    if (!floatExt) throw new Error('OES_texture_float not supported');
    const filter = linearExt ? gl.LINEAR : gl.NEAREST;

    this.gl = gl;
    this.filter = filter;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const programs = {
      splat:      createProgram(gl, VERT, SPLAT_FRAG),
      advect:     createProgram(gl, VERT, ADVECT_FRAG),
      curl:       createProgram(gl, VERT, CURL_FRAG),
      vorticity:  createProgram(gl, VERT, VORTICITY_FRAG),
      divergence: createProgram(gl, VERT, DIVERGENCE_FRAG),
      pressure:   createProgram(gl, VERT, PRESSURE_FRAG),
      gradient:   createProgram(gl, VERT, GRADIENT_FRAG),
      display:    createProgram(gl, VERT, DISPLAY_FRAG),
    };
    this.prog = programs;

    this._initAttr(buf);
    this._resize();
  }

  _initAttr(buf) {
    const gl = this.gl;
    Object.values(this.prog).forEach(({ p }) => {
      gl.useProgram(p);
      const loc = gl.getAttribLocation(p, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    });
  }

  _resize() {
    const gl = this.gl;
    const SIM = 256, DYE = 512;
    this.simSize = SIM;
    this.dyeSize = DYE;

    const fmt = gl.RGBA, type = gl.FLOAT;
    this.velocity  = createDoubleFBO(gl, SIM, SIM, fmt, fmt, type, this.filter);
    this.dye       = createDoubleFBO(gl, DYE, DYE, fmt, fmt, type, this.filter);
    this.pressure  = createDoubleFBO(gl, SIM, SIM, fmt, fmt, type, this.filter);
    this.divergence = (() => {
      const make = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM, SIM, 0, gl.RGBA, gl.FLOAT, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, w: SIM, h: SIM };
      };
      return make();
    })();
    this.curl = (() => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM, SIM, 0, gl.RGBA, gl.FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo, w: SIM, h: SIM };
    })();
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

  splat(x, y, dx, dy, color) {
    const gl = this.gl;
    const S = this.simSize, D = this.dyeSize;
    const radius = 0.0015;

    // velocity splat
    let u = this._use('splat');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_point, x, y);
    gl.uniform3f(u.u_color, dx, dy, 0);
    gl.uniform1f(u.u_radius, radius);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // dye splat
    u = this._use('splat');
    this._bindTex(0, this.dye.read.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_point, x, y);
    gl.uniform3f(u.u_color, color[0], color[1], color[2]);
    gl.uniform1f(u.u_radius, radius * (D / S));
    this._blit(this.dye.write);
    this.dye.swap();
  }

  step(dt) {
    const gl = this.gl;
    const S = this.simSize, D = this.dyeSize;
    const sv = [1 / S, 1 / S];
    const dv = [1 / D, 1 / D];

    // curl
    let u = this._use('curl');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.curl);

    // vorticity confinement
    u = this._use('vorticity');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.curl.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_curl, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    gl.uniform1f(u.u_curl_strength, 28.0);
    gl.uniform1f(u.u_dt, dt);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // divergence
    u = this._use('divergence');
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.divergence);

    // pressure solve — clear first
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (let i = 0; i < 25; i++) {
      u = this._use('pressure');
      this._bindTex(0, this.pressure.read.tex);
      this._bindTex(1, this.divergence.tex);
      gl.uniform1i(u.u_pressure, 0);
      gl.uniform1i(u.u_divergence, 1);
      gl.uniform2fv(u.u_texelSize, sv);
      this._blit(this.pressure.write);
      this.pressure.swap();
    }

    // gradient subtract
    u = this._use('gradient');
    this._bindTex(0, this.pressure.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(u.u_pressure, 0);
    gl.uniform1i(u.u_velocity, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // advect velocity
    u = this._use('advect');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_source, 1);
    gl.uniform2fv(u.u_texelSize, sv);
    gl.uniform1f(u.u_dt, dt);
    gl.uniform1f(u.u_dissipation, 0.98);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // advect dye
    u = this._use('advect');
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.dye.read.tex);
    gl.uniform1i(u.u_velocity, 0);
    gl.uniform1i(u.u_source, 1);
    gl.uniform2fv(u.u_texelSize, dv);
    gl.uniform1f(u.u_dt, dt);
    gl.uniform1f(u.u_dissipation, 0.985);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  render() {
    const gl = this.gl;
    const u = this._use('display');
    this._bindTex(0, this.dye.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(u.u_dye, 0);
    gl.uniform1i(u.u_velocity, 1);
    this._blit(null);
  }
}
