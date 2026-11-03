/**
 * La trame — couche WebGL de l'ouverture de l'accueil.
 *
 * Des fils de chaîne verticaux, à peine visibles, et cinq fils de trame d'or
 * qui passent dessus puis dessous (le tissage), convergent à travers
 * l'anneau WEBLACK et se tendent quand on quitte l'ouverture : plusieurs
 * fils, un point de passage, une étoffe. Un seul shader plein écran, aucune
 * dépendance — three.js ajouterait ~130 Ko compressés pour dessiner un
 * triangle.
 *
 * Le canvas est purement décoratif (aria-hidden) et part transparent : si
 * ce module ne se charge pas, ne trouve pas WebGL2 ou se coupe faute de
 * cadence, l'ouverture reste exactement celle d'origine (photo, symbole,
 * anneau CSS).
 */

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;      // taille du canvas, pixels physiques
uniform float uDpr;
uniform float uTime;
uniform vec2 uSym;      // centre de l'anneau, coordonnées 0..1 (origine en bas à gauche)
uniform vec3 uPointer;  // xy 0..1, z = présence 0..1
uniform float uTension; // 0 au repos, 1 quand l'ouverture a quitté l'écran
uniform float uFade;
out vec4 outColor;

const vec3 GOLD = vec3(0.722, 0.584, 0.373);     // #B8955F
const vec3 GOLD_HI = vec3(0.851, 0.737, 0.525);  // #D9BC86

// Trait antialiasé de largeur w (pixels) à la distance d (pixels).
float stroke(float d, float w) {
  return 1.0 - smoothstep(0.5 * w, 0.5 * w + uDpr, abs(d));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 uv = p / uRes;
  float aspect = uRes.x / uRes.y;
  float x = uv.x * aspect;
  float symX = uSym.x * aspect;

  // Chaîne : un fil vertical toutes les 22 px CSS.
  float gap = 22.0 * uDpr;
  float wx = mod(p.x, gap) - 0.5 * gap;
  float column = floor(p.x / gap);
  float nearWarp = 1.0 - smoothstep(0.0, 2.0 * uDpr, abs(wx));
  float warp = stroke(wx, uDpr) * 0.045;

  // Les fils s'écartent loin de l'anneau et s'y resserrent ; la tension les
  // rapproche encore et les redresse.
  float away = smoothstep(0.0, 0.9, abs(x - symX));
  float spread = mix(0.012, 0.075, away) * (1.0 - 0.7 * uTension);
  float calm = 1.0 - 0.85 * uTension;

  float alpha = warp;
  vec3 color = GOLD * warp;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float lane = fi - 2.0;
    float y = uSym.y + lane * spread;
    y += calm * (0.018 + 0.006 * fi) * away * sin(x * (2.1 + 0.55 * fi) + uTime * (0.16 + 0.04 * fi) + fi * 1.7);
    // Le pointeur attire doucement le fil le plus proche, jamais au-delà de quelques pixels.
    float pull = exp(-pow((x - uPointer.x * aspect) * 4.0, 2.0)) * uPointer.z * calm;
    y = mix(y, uPointer.y, pull * 0.12);

    float dy = (uv.y - y) * uRes.y;
    // Dessus / dessous en alternance d'une colonne à l'autre, décalé d'un fil au suivant.
    float under = mod(column + fi, 2.0);
    float visible = 1.0 - under * nearWarp * 0.6;
    float shine = 0.5 + 0.5 * sin(x * 3.0 - uTime * 0.5 + fi * 2.0);
    // Plus discret loin de l'anneau : le titre et les piliers passent devant.
    float a = stroke(dy, (1.1 + 0.25 * fi) * uDpr) * visible * (0.62 - 0.07 * fi) * mix(1.0, 0.45, away);
    a += exp(-abs(dy) / (7.0 * uDpr)) * 0.05 * visible;
    color += mix(GOLD, GOLD_HI, shine) * a;
    alpha += a;
  }

  float edges = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
  float k = clamp(edges * uFade, 0.0, 1.0);
  alpha = clamp(alpha * k, 0.0, 1.0);
  outColor = vec4(min(color * k, vec3(alpha)), alpha);
}`;

interface WeaveOptions {
  canvas: HTMLCanvasElement;
  section: HTMLElement;
  mark: HTMLElement | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Démarre la trame ; renvoie false sans rien modifier si WebGL2 est indisponible. */
export function startWeave({ canvas, section, mark }: WeaveOptions): boolean {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return false;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return false;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);

  // Un triangle qui couvre tout l'écran.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u("uRes"), uDpr = u("uDpr"), uTime = u("uTime"), uSym = u("uSym");
  const uPointer = u("uPointer"), uTension = u("uTension"), uFade = u("uFade");

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const sym = { x: 0.7, y: 0.5 };
  const pointer = { x: 0.5, y: 0.5, z: 0, tx: 0.5, ty: 0.5, tz: 0 };

  const measure = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    const box = section.getBoundingClientRect();
    const ring = mark?.getBoundingClientRect();
    if (ring && box.width && box.height) {
      sym.x = (ring.left + ring.width / 2 - box.left) / box.width;
      sym.y = 1 - (ring.top + ring.height * 0.475 - box.top) / box.height;
    }
  };
  const resize = new ResizeObserver(measure);
  resize.observe(canvas);
  measure();

  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const onPointer = (event: PointerEvent) => {
    const box = section.getBoundingClientRect();
    pointer.tx = (event.clientX - box.left) / box.width;
    pointer.ty = 1 - (event.clientY - box.top) / box.height;
    pointer.tz = event.clientY < box.bottom ? 1 : 0;
  };
  const onLeave = () => (pointer.tz = 0);
  if (finePointer) {
    section.addEventListener("pointermove", onPointer, { passive: true });
    section.addEventListener("pointerleave", onLeave, { passive: true });
  }

  let raf = 0;
  let running = false;
  let inView = true;
  let last = 0;
  let clock = 0;
  let fade = 0;
  const frames: number[] = [];
  let stopped = false;

  const shutdown = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    running = false;
    resize.disconnect();
    io.disconnect();
    section.removeEventListener("pointermove", onPointer);
    section.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("pagehide", pause);
    window.removeEventListener("pageshow", sync);
    canvas.style.opacity = "0";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now;
    clock += dt / 1000;

    // Garde-fou de cadence : sur les 90 premières images, une médiane au-delà
    // de 28 ms (< 36 i/s) coupe la trame. L'ouverture CSS reste intacte.
    if (frames.length < 90) {
      frames.push(dt);
      if (frames.length === 90) {
        const median = [...frames].sort((a, b) => a - b)[45];
        if (median > 28) return shutdown();
      }
    }

    const box = section.getBoundingClientRect();
    const tension = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)));
    fade = Math.min(1, fade + dt / 1400);
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    pointer.z += (pointer.tz - pointer.z) * 0.04;

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uDpr, dpr);
    gl.uniform1f(uTime, clock);
    gl.uniform2f(uSym, sym.x, sym.y);
    gl.uniform3f(uPointer, pointer.x, pointer.y, pointer.z);
    gl.uniform1f(uTension, tension);
    gl.uniform1f(uFade, fade * (1 - tension * 0.6));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const play = () => {
    if (running || stopped) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const sync = () => (inView && !document.hidden ? play() : pause());

  // Hors écran ou onglet masqué : aucune image calculée.
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  });
  io.observe(section);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", sync);
  canvas.addEventListener("webglcontextlost", shutdown, { once: true });

  canvas.style.opacity = "1";
  sync();
  return true;
}
