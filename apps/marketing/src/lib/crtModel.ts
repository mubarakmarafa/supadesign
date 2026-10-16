import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// A flattened export of the app icon's procedural Three.js model; its glow materials are named phosphor-*.
import modelUrl from "../assets/supaterm-crt.glb?url";

const REST_YAW = -0.5;
const REST_PITCH = 0.16;
const TURN = Math.PI * 2;
const MIN_PITCH = -0.35;
const MAX_PITCH = 0.6;
const RADIANS_PER_PIXEL = 0.009;
const MAX_VELOCITY = 0.03;
const RELEASE_HOLD_MS = 80;
const STIFFNESS = 0.00003;
const DAMPING = 0.0075;

/**
 * Adds a canvas with the app icon model to `container` once it has loaded, and lets the user spin
 * it. A spring carries a fling and settles on the nearest front-facing turn. Frames are drawn only
 * while it moves. Nothing is added if the model or WebGL is unavailable, and the canvas is removed
 * if its context is lost.
 */
export async function mountCrtModel(container: HTMLElement) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene: model } = await loader.loadAsync(modelUrl);
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  const canvas = renderer.domElement;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const key = new DirectionalLight(0xfff6e8, 2.4);
  key.position.set(-0.45, 0.75, 0.55);
  const rim = new DirectionalLight(0xffffff, 0.5);
  rim.position.set(0.5, 0.3, -0.6);
  const lights = new Group().add(key, rim, new HemisphereLight(0xf4f1ea, 0x6a6458, 0.9));
  lights.rotation.y = REST_YAW;
  scene.add(lights);

  model.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material;
    if (material.name.startsWith("phosphor-")) material.toneMapped = false;
    if (material.name === "phosphor-halo") {
      material.blending = AdditiveBlending;
      material.depthWrite = false;
      object.renderOrder = 2;
    }
  });
  model.position.sub(new Box3().setFromObject(model).getCenter(new Vector3()));
  const pivot = new Group().add(model);
  scene.add(pivot);

  const camera = new PerspectiveCamera(22, 1, 0.1, 20);
  camera.position.set(0, 0.04, 3.7);
  camera.lookAt(0, 0, 0);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let target = REST_YAW;
  let yaw = reducedMotion ? REST_YAW : 0;
  let pitch = reducedMotion ? REST_PITCH : 0;
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let drag: { id: number; x: number; y: number; at: number } | null = null;
  let frame = 0;
  let last = 0;

  const draw = () => {
    pivot.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  };
  const tick = (now: number) => {
    frame = 0;
    if (drag) {
      last = 0;
      draw();
      return;
    }
    const dt = last ? Math.min(now - last, 64) : 16;
    yawVelocity += ((target - yaw) * STIFFNESS - yawVelocity * DAMPING) * dt;
    pitchVelocity += ((REST_PITCH - pitch) * STIFFNESS - pitchVelocity * DAMPING) * dt;
    yaw += yawVelocity * dt;
    pitch += pitchVelocity * dt;
    const settled =
      Math.abs(target - yaw) + Math.abs(REST_PITCH - pitch) < 1e-3 &&
      Math.abs(yawVelocity) + Math.abs(pitchVelocity) < 1e-5;
    if (settled) {
      yaw = target;
      pitch = REST_PITCH;
      last = 0;
    } else {
      last = now;
      frame = requestAnimationFrame(tick);
    }
    draw();
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const release = (event: PointerEvent) => {
    if (event.pointerId !== drag?.id) return;
    if (event.timeStamp - drag.at > RELEASE_HOLD_MS) yawVelocity = 0;
    target = REST_YAW + Math.round((yaw + yawVelocity / DAMPING - REST_YAW) / TURN) * TURN;
    drag = null;
    wake();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
    yawVelocity = pitchVelocity = 0;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    if (event.buttons === 0) {
      release(event);
      return;
    }
    const step = (event.clientX - drag.x) * RADIANS_PER_PIXEL;
    const elapsed = Math.max(event.timeStamp - drag.at, 1);
    yaw += step;
    pitch = MathUtils.clamp(
      pitch + (event.clientY - drag.y) * RADIANS_PER_PIXEL,
      MIN_PITCH,
      MAX_PITCH,
    );
    yawVelocity = MathUtils.clamp((yawVelocity + step / elapsed) / 2, -MAX_VELOCITY, MAX_VELOCITY);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.at = event.timeStamp;
    wake();
  });
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("webglcontextlost", () => canvas.remove());

  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The Supaterm app icon in 3D. Drag to spin it.");
  container.append(canvas);
  new ResizeObserver(() => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }).observe(canvas);
  wake();
}
