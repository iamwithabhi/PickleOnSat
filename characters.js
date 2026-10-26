// 3D player characters: loads the glTF models in /Characters and renders a
// portrait image of each for the player cards.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTERS } from './character-list.js?v=202610262007';

export { CHARACTERS };

// Height the portraits are centred on (models stand ~0..19.6 tall). Slightly below the face so
// the face sits in the part of the slot above the "P 01" strip.
const FACE_Y = 17.1;
const ARM_DROP = 1.2; // radians: lowers the T-pose arms into a relaxed stance

const loader = new GLTFLoader();
const models = new Map(); // id -> THREE.Group

const fileUrl = (c, part, file) => `Characters/${encodeURIComponent(c.dir)}/${part}/${file}.gltf`;

function prepare(scene) {
  scene.traverse((o) => {
    if (o.name === 'l_ninoude') o.rotation.z = -ARM_DROP;
    if (o.name === 'r_ninoude') o.rotation.z = ARM_DROP;
    if (o.isMesh) {
      o.frustumCulled = false; // skinned bounds are unreliable once posed
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.colorSpace = THREE.SRGBColorSpace; }
        m.roughness = 1; m.metalness = 0;
      }
    }
  });
  return scene;
}

async function loadModel(c) {
  if (models.has(c.id)) return models.get(c.id);
  const [body, head] = await Promise.all([
    loader.loadAsync(fileUrl(c, 'Body', c.body)),
    loader.loadAsync(fileUrl(c, 'Head', c.head)),
  ]);
  const group = new THREE.Group();
  group.add(prepare(body.scene), prepare(head.scene));
  models.set(c.id, group);
  return group;
}

function makeStage(width, height) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f6a, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 14, 12);
  scene.add(key);
  // tight head-and-shoulders crop that fills the small portrait slot
  const camera = new THREE.PerspectiveCamera(28, width / height, 1, 200);
  camera.position.set(0, FACE_Y, 12);
  camera.lookAt(0, FACE_Y, 0);
  return { renderer, scene, camera };
}

const portraits = new Map(); // id -> data URL

/**
 * Load every character and render a still portrait of each.
 * onProgress(done, total) is called as each one finishes. Never rejects:
 * characters that fail to load simply have no portrait.
 */
export async function preload(onProgress) {
  const stage = makeStage(256, 192); // 4:3, matches the card picture
  let done = 0;
  await Promise.all(CHARACTERS.map(async (c) => {
    try {
      const model = await loadModel(c);
      model.rotation.y = -0.3;
      stage.scene.add(model);
      stage.renderer.render(stage.scene, stage.camera);
      portraits.set(c.id, stage.renderer.domElement.toDataURL('image/png'));
      stage.scene.remove(model);
      model.rotation.y = 0;
    } catch (e) {
      console.warn('Character failed to load:', c.name, e);
    }
    onProgress && onProgress(++done, CHARACTERS.length);
  }));
  stage.renderer.dispose();
  return portraits;
}

export const portrait = (id) => portraits.get(id) || null;

// Renders one model, framed to fit, to a transparent square still. Resolves to a data URL.
function stillOf(model, size, rotY, elev = 0.4, dist = 1.45) {
  model.rotation.y = rotY;
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3()), dim = box.getSize(new THREE.Vector3());
  const stage = makeStage(size, size);
  stage.scene.add(model);
  const r = Math.max(dim.x, dim.y, dim.z) * 1.15;
  stage.camera.fov = 30;
  stage.camera.near = r * 0.1; stage.camera.far = r * 10; // these models are far bigger than the characters
  stage.camera.updateProjectionMatrix();
  stage.camera.position.set(centre.x, centre.y + r * elev, centre.z + r * dist);
  stage.camera.lookAt(centre);
  stage.renderer.render(stage.scene, stage.camera);
  const url = stage.renderer.domElement.toDataURL('image/png');
  stage.renderer.dispose();
  return url;
}

const crisp = (model) => model.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) {
    if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.colorSpace = THREE.SRGBColorSpace; }
    m.roughness = 1; m.metalness = 0;
  }
});

/** Render the winners' podium (Assets/Podium) to a transparent still for the logo. Resolves to a data URL. */
export async function podiumImage(size = 192) {
  const model = (await loader.loadAsync('Assets/Podium/model.gltf')).scene;
  crisp(model);
  return stillOf(model, size, 0.6); // three-quarter view, left side nearer
}

async function loadCrown() {
  const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
  const model = (await new ColladaLoader().loadAsync('Assets/Crown/Crown/Crown.dae')).scene;
  // The file's own material renders black here, so paint the gold texture on unlit, which also keeps the colour true.
  const gold = await new THREE.TextureLoader().loadAsync('Assets/Crown/Crown/Crown.png');
  gold.colorSpace = THREE.SRGBColorSpace;
  gold.flipY = false; // Collada UVs are already top-down
  const material = new THREE.MeshBasicMaterial({ map: gold, side: THREE.DoubleSide });
  model.traverse((o) => { if (o.isMesh) o.material = material; });
  return model;
}

/** Render the crown (Assets/Crown) to a transparent still, shown beside the winning team. Resolves to a data URL. */
export async function crownImage(size = 96) {
  return stillOf(await loadCrown(), size, -0.5, 0.55, 1.5);
}

// Poses for the podium. The skeleton uses Japanese bone names: kosi = hips, mune = chest, kubi = neck,
// l_/r_ninoude = upper arm, hizi = elbow, te = hand, momo = thigh, sune = shin. Each value is an Euler
// rotation [x, y, z] in radians, set on top of the model's relaxed rest pose.
export const POSES = {
  first: { // arms up in a victory V, chest out, chin up
    l_ninoude: [0, 0, 1.0], r_ninoude: [0, 0, -1.0],
    l_hizi: [0, 0, 0.15], r_hizi: [0, 0, -0.15],
    kubi: [-0.15, 0, 0], mune: [-0.08, 0, 0],
    l_momo: [0, 0, 0.1], r_momo: [0, 0, -0.1],
  },
  second: { // hands on hips, weight on one leg, head turned a little
    l_ninoude: [0, 0, -0.9], r_ninoude: [0, 0, 0.9],
    l_hizi: [0, 0, -1.5], r_hizi: [0, 0, 1.5],
    kosi: [0, 0, 0.05], l_momo: [0, 0, 0.08], r_momo: [0, 0, -0.04],
    kubi: [0, 0.1, 0],
  },
  third: { // one arm waving up, the other hand on the hip
    r_ninoude: [0, 0, -1.15], r_hizi: [0, 0, -0.5],
    l_ninoude: [0, 0, -0.9], l_hizi: [0, 0, -1.5],
    kosi: [0, 0, -0.05], l_momo: [0, 0, 0.05], r_momo: [0, 0, -0.1],
    kubi: [0, -0.12, 0.05],
  },
};
function applyPose(model, pose) {
  for (const [bone, r] of Object.entries(pose || {})) {
    model.traverse((o) => { if (o.name === bone) o.rotation.set(r[0], r[1], r[2]); });
  }
}

// The three podium steps in the model's own units (left = 2nd, middle = 1st, right = 3rd): where each one's top is.
const STEPS = [{ x: -66.4, y: 14.8 }, { x: 0, y: 32.1 }, { x: 66.4, y: 1.7 }];
const PODIUM_BOTTOM = -32.1, PODIUM_HALF_WIDTH = 99.6;
const PODIUM_SCALE = 5.2; // characters stand ~19.6 tall, the podium is ~200 wide, so they are scaled up to fit the steps

/**
 * Render the podium with the top three players' characters standing on it and the crown on 1st place's head.
 * ids = [1st, 2nd, 3rd] character ids. Resolves to { url, centres } where centres are the x positions (0..1 across the
 * image) of the left, middle and right step, so names can be lined up under them.
 */
export async function podiumScene(ids, width = 960, height = 720) {
  const podium = (await loader.loadAsync('Assets/Podium/model.gltf')).scene;
  crisp(podium);
  const stage = makeStage(width, height);
  stage.scene.add(podium);

  // order on the steps: 2nd on the left, 1st in the middle, 3rd on the right
  const onStep = [ids[1], ids[0], ids[2]];
  const turn = [0.35, 0, -0.35]; // the outer two angle in toward the winner
  for (let i = 0; i < 3; i++) {
    const c = CHARACTERS.find((ch) => ch.id === onStep[i]);
    if (!c) continue;
    const body = cloneSkinned(await loadModel(c));
    applyPose(body, [POSES.second, POSES.first, POSES.third][i]);
    body.scale.setScalar(PODIUM_SCALE);
    body.position.set(STEPS[i].x, STEPS[i].y, 0);
    body.rotation.y = turn[i];
    stage.scene.add(body);
  }

  const crown = await loadCrown();
  const cb = new THREE.Box3().setFromObject(crown), cs = cb.getSize(new THREE.Vector3());
  crown.scale.setScalar(15 / Math.max(cs.x, cs.z));
  const cb2 = new THREE.Box3().setFromObject(crown);
  const headTop = STEPS[1].y + 19.6 * PODIUM_SCALE;
  crown.position.set(-(cb2.min.x + cb2.max.x) / 2, headTop - 6 - cb2.min.y, -(cb2.min.z + cb2.max.z) / 2);
  stage.scene.add(crown);

  // straight-on, orthographic: the steps sit at exactly known positions across the picture
  // frame it to fit the tallest thing (the crown) with a little air, so the bigger the characters the smaller the podium appears
  const top = headTop - 6 + new THREE.Box3().setFromObject(crown).getSize(new THREE.Vector3()).y + 14, bottom = PODIUM_BOTTOM - 4;
  const viewH = top - bottom, viewW = viewH * (width / height), midY = (top + bottom) / 2;
  const cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 1, 1000);
  cam.position.set(0, midY + 10, 400);
  cam.lookAt(0, midY, 0);
  stage.renderer.render(stage.scene, cam);
  const url = stage.renderer.domElement.toDataURL('image/png');
  stage.renderer.dispose();
  return { url, centres: STEPS.map((s) => 0.5 + s.x / viewW) };
}
