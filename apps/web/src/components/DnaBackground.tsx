import { useEffect, useRef } from 'react';

/**
 * 3D rotating "digital DNA" helix drawn with raw WebGL point sprites (no three.js).
 * - Each strand is a tube of glyph particles (0 / 1) built on the GPU; the CPU only updates a time uniform.
 * - Particle count scales with device capability; DPR capped; pauses when tab hidden or off-screen.
 * - prefers-reduced-motion renders one static frame.
 */

const VERT = `
attribute vec4 a; // x: t along helix, y: angle around tube, z: strand/rung tag, w: glyph seed
uniform float uTime, uAspect, uPx;
varying float vDepth, vGlyph, vAlpha;
void main() {
  float t = a.x, ang = a.y, tag = a.z;
  float twist = t * 0.9 + uTime * 0.25;
  vec3 p;
  if (tag < 1.5) {                       // backbone strand 0 or 1
    float ph = twist + tag * 3.14159;
    vec3 c = vec3(cos(ph) * 1.1, t * 0.55, sin(ph) * 1.1);
    vec3 n = normalize(vec3(cos(ph), 0.0, sin(ph)));
    vec3 b = vec3(0.0, 1.0, 0.0);
    p = c + (n * cos(ang) + b * sin(ang)) * 0.28;
  } else {                               // rung: interpolate between strands, a.y = 0..1
    vec3 s0 = vec3(cos(twist) * 1.1, t * 0.55, sin(twist) * 1.1);
    vec3 s1 = vec3(cos(twist + 3.14159) * 1.1, t * 0.55, sin(twist + 3.14159) * 1.1);
    p = mix(s0, s1, ang);
  }
  // tilt the helix diagonally like the reference image
  float tl = 0.75; mat2 r = mat2(cos(tl), -sin(tl), sin(tl), cos(tl));
  p.xy = r * p.xy;
  p.z -= 5.0;
  vDepth = clamp((-p.z - 3.0) / 4.0, 0.0, 1.0);
  vGlyph = step(0.5, fract(a.w + floor(uTime * 0.6 + a.w * 7.0) * 0.37));
  vAlpha = tag < 1.5 ? 1.0 : 0.55;
  gl_Position = vec4(p.x / uAspect * 1.6, p.y * 1.6, p.z * 0.1, -p.z * 0.6);
  gl_PointSize = uPx / -p.z;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying float vDepth, vGlyph, vAlpha;
void main() {
  vec2 uv = vec2((gl_PointCoord.x + vGlyph) * 0.5, gl_PointCoord.y);
  float g = texture2D(uTex, uv).r;
  vec3 col = mix(vec3(0.55, 0.95, 1.0), vec3(0.05, 0.35, 0.55), vDepth);
  float a = g * vAlpha * mix(1.0, 0.25, vDepth);
  gl_FragColor = vec4(col * a, a);
}`;

function glyphAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.font = 'bold 26px monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('0', 16, 17);
  x.fillText('1', 48, 17);
  return c;
}

function budget(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const small = window.innerWidth < 700;
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData || cores <= 2) return 0.4;
  if (small || cores <= 4) return 0.65;
  return 1;
}

function buildGeometry(scale: number): Float32Array {
  const len = Math.round(160 * scale); // samples along helix
  const ring = Math.max(6, Math.round(10 * scale)); // samples around tube
  const out: number[] = [];
  for (let s = 0; s < 2; s++)
    for (let i = 0; i < len; i++) {
      const t = (i / len) * 14 - 7;
      for (let j = 0; j < ring; j++) out.push(t, (j / ring) * Math.PI * 2 + i * 0.3, s, Math.random());
    }
  const rungs = Math.round(26 * scale);
  for (let r = 0; r < rungs; r++) {
    const t = (r / rungs) * 14 - 7;
    for (let k = 1; k < 12; k++) out.push(t, k / 12, 2, Math.random());
  }
  return new Float32Array(out);
}

export default function DnaBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, powerPreference: 'low-power' });
    if (!gl || gl.isContextLost()) return; // CSS gradient fallback stays visible

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const data = buildGeometry(budget());
    const count = data.length / 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphAtlas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uAspect = gl.getUniformLocation(prog, 'uAspect');
    const uPx = gl.getUniformLocation(prog, 'uPx');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uAspect, w / h);
      gl.uniform1f(uPx, Math.min(w, h) * dpr * 0.09);
    };
    resize();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, visible = true, last = 0;
    const start = performance.now();
    const draw = (now: number) => {
      raf = 0;
      if (now - last >= 1000 / 40) { // ~40fps cap: smooth, cheaper
        last = now;
        gl.uniform1f(uTime, (now - start) / 1000);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.POINTS, 0, count);
      }
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const kick = () => { if (!raf && !reduced && visible && !document.hidden) raf = requestAnimationFrame(draw); };
    draw(performance.now() + 1000);

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(performance.now() + 1000); });
    ro.observe(canvas);
    document.addEventListener('visibilitychange', kick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
  }, []);

  return <canvas ref={ref} className="dna-canvas" aria-hidden="true" />;
}
