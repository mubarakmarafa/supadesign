import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  MathUtils,
  type Mesh,
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

const REST_YAW = -0.5;
const REST_PITCH = 0.16;
const TURN = Math.PI * 2;
const RADIANS_PER_PIXEL = 0.009;
const MAX_VELOCITY = 0.03;
const STIFFNESS = 0.00003;
const DAMPING = 0.0075;

/**
 * Renders the app icon model into `canvas` and lets the user spin it. A spring carries a fling
 * and settles on the nearest front-facing turn. Frames are drawn only while it moves.
 */
export async function mountCrtModel(canvas: HTMLCanvasElement, url: string) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
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

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const model = (await loader.loadAsync(url)).scene;
  model.traverse((object) => {
    const material = (object as Mesh).material as Material | undefined;
    if (material?.name.startsWith("phosphor-")) material.toneMapped = false;
    if (material?.name === "phosphor-halo") {
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

  canvas.addEventListener("pointerdown", (event) => {
    if (drag) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
    yawVelocity = pitchVelocity = 0;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    const step = (event.clientX - drag.x) * RADIANS_PER_PIXEL;
    const elapsed = Math.max(event.timeStamp - drag.at, 1);
    yaw += step;
    pitch = MathUtils.clamp(pitch + (event.clientY - drag.y) * RADIANS_PER_PIXEL, -0.35, 0.6);
    yawVelocity = MathUtils.clamp((yawVelocity + step / elapsed) / 2, -MAX_VELOCITY, MAX_VELOCITY);
    drag = { ...drag, x: event.clientX, y: event.clientY, at: event.timeStamp };
    wake();
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== drag?.id) return;
    if (event.timeStamp - drag.at > 80) yawVelocity = 0;
    target = REST_YAW + Math.round((yaw + yawVelocity / DAMPING - REST_YAW) / TURN) * TURN;
    drag = null;
    wake();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  new ResizeObserver(() => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }).observe(canvas);
  wake();
}
