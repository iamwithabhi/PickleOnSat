// 3D player characters: loads the glTF models in /Characters and renders a
// portrait image of each for the player cards.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTERS } from './character-list.js';

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
