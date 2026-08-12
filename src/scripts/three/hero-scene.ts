import { capPixelRatio, isSmallViewport, prefersReducedMotion, disposeObject3D } from "./utils";

interface HeroSceneHandle {
  destroy: () => void;
}

/**
 * Sculptural hero scene: three angular "blade" prisms echoing the WEBLACK
 * mark's chevron vocabulary (without reproducing the mark itself), tumbling
 * slowly under raking gold/white key lights against the ink background.
 */
export async function initHeroScene(canvas: HTMLCanvasElement): Promise<HeroSceneHandle | null> {
  if (!window.WebGLRenderingContext) return null;

  let THREE: typeof import("three");
  try {
    THREE = await import("three");
  } catch {
    return null;
  }

  let renderer: InstanceType<typeof THREE.WebGLRenderer>;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const group = new THREE.Group();
  scene.add(group);

  function makeBlade(width: number, height: number, thickness: number, skew: number) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 + skew, height / 2);
    shape.lineTo(width / 2 + skew, height / 2);
    shape.lineTo(width / 2 - skew, -height / 2);
    shape.lineTo(-width / 2 - skew, -height / 2);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
      curveSegments: 1,
    });
    geometry.center();
    return geometry;
  }

  const goldMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8955f,
    metalness: 0.7,
    roughness: 0.32,
  });
  const paperMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8f6f1,
    metalness: 0.1,
    roughness: 0.5,
  });
  const inkMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c1a16,
    metalness: 0.4,
    roughness: 0.45,
  });

  const blades: InstanceType<typeof THREE.Mesh>[] = [];
  const specs = [
    { w: 1.6, h: 4.4, t: 0.35, skew: 0.5, mat: paperMaterial, pos: [-1.5, 0.2, 0], rot: [0.15, 0.4, -0.18] },
    { w: 1.4, h: 4.0, t: 0.35, skew: 0.45, mat: goldMaterial, pos: [0.3, -0.3, 0.6], rot: [-0.1, -0.3, 0.12] },
    { w: 1.7, h: 4.6, t: 0.32, skew: -0.4, mat: inkMaterial, pos: [1.8, 0.4, -0.4], rot: [0.2, 0.6, 0.22] },
  ] as const;

  specs.forEach((spec) => {
    const geometry = makeBlade(spec.w, spec.h, spec.t, spec.skew);
    const mesh = new THREE.Mesh(geometry, spec.mat);
    mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    group.add(mesh);
    blades.push(mesh);
  });

  const keyLight = new THREE.DirectionalLight(0xd9bc86, 2.4);
  keyLight.position.set(4, 5, 6);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
  rimLight.position.set(-5, -2, -4);
  scene.add(rimLight);

  const ambient = new THREE.AmbientLight(0x2a2620, 1.4);
  scene.add(ambient);

  let width = 0;
  let height = 0;
  let frameId = 0;
  let running = false;
  const clock = new THREE.Clock();

  const reduceMotion = prefersReducedMotion();
  const small = isSmallViewport();

  group.scale.setScalar(small ? 0.8 : 1);

  const pointer = { x: 0, y: 0 };
  function onPointerMove(event: PointerEvent) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  }
  if (!reduceMotion) window.addEventListener("pointermove", onPointerMove, { passive: true });

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect();
    width = rect?.width || window.innerWidth;
    height = rect?.height || window.innerHeight;
    renderer.setPixelRatio(capPixelRatio());
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    frameId = requestAnimationFrame(render);
    const elapsed = clock.getElapsedTime();

    if (!reduceMotion) {
      group.rotation.y = elapsed * 0.08 + pointer.x * 0.25;
      group.rotation.x = Math.sin(elapsed * 0.15) * 0.08 + pointer.y * 0.12;
      blades.forEach((blade, i) => {
        blade.position.y += Math.sin(elapsed * 0.4 + i) * 0.0009;
      });
    }

    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    frameId = requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
  }

  const resizeObserver = new ResizeObserver(() => resize());
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
  resize();

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? start() : stop()));
    },
    { threshold: 0.05 },
  );
  intersectionObserver.observe(canvas);

  if (reduceMotion) {
    resize();
    renderer.render(scene, camera);
  } else {
    start();
  }

  let scrollTriggerCleanup: (() => void) | null = null;
  if (!reduceMotion) {
    const [{ gsap }, ScrollTriggerModule] = await Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
    ]);
    const ScrollTrigger = ScrollTriggerModule.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    const trigger = ScrollTrigger.create({
      trigger: canvas.closest("[data-hero-section]") || canvas,
      start: "top top",
      end: "bottom top",
      scrub: 0.6,
      onUpdate: (self) => {
        group.position.z = self.progress * -2.5;
        group.rotation.z = self.progress * 0.3;
      },
    });
    scrollTriggerCleanup = () => trigger.kill();
  }

  function destroy() {
    stop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    window.removeEventListener("pointermove", onPointerMove);
    scrollTriggerCleanup?.();
    disposeObject3D(group);
    renderer.dispose();
  }

  return { destroy };
}
