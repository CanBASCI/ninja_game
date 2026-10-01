import * as THREE from "three";

/**
 * Gölge politikası
 * - Statik (ağaç, engel, fener…): bakeEnvShadows — tek sefer, sabit frustum
 * - Dinamik (mainChar/enemy/bomber/rope): sadece her kare charSun — bake’e ASLA girmez
 */
export const dynamicShadowCast = {
  mainChar: true,
  enemy: true,
  bomber: true,
  rope: true,
};

/** İlk env bake bitmeden dinamik cast kapalı (spawn gölgesi sahneye gömülmesin) */
let allowDynamicShadows = false;

export function getAllowDynamicShadows() {
  return allowDynamicShadows;
}

export function setAllowDynamicShadows(on) {
  allowDynamicShadows = !!on;
}

/** Tüm sahne gölge merkezi — karakter takip edilmez */
export const SHADOW_ANCHOR = { x: 12, y: 0, z: 0 };

/** Ortak orthographic gölge kutusu (statik + dinamik) */
export const SHADOW_FRUSTUM = {
  near: 2,
  far: 80,
  left: -48,
  right: 48,
  top: 32,
  bottom: -32,
  mapSize: 2048,
};

/** Karakter key light gölgesi — herhangi bir dinamik açıksa */
export function wantsDynamicKeyShadow() {
  return (
    allowDynamicShadows &&
    (dynamicShadowCast.mainChar ||
      dynamicShadowCast.enemy ||
      dynamicShadowCast.bomber ||
      dynamicShadowCast.rope)
  );
}

/**
 * @param {THREE.DirectionalLight} light
 * @param {{ autoUpdate?: boolean }} [opts]
 */
export function applyShadowFrustum(light, opts = {}) {
  const f = SHADOW_FRUSTUM;
  light.shadow.mapSize.set(f.mapSize, f.mapSize);
  light.shadow.camera.near = f.near;
  light.shadow.camera.far = f.far;
  light.shadow.camera.left = f.left;
  light.shadow.camera.right = f.right;
  light.shadow.camera.top = f.top;
  light.shadow.camera.bottom = f.bottom;
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.04;
  light.shadow.camera.updateProjectionMatrix();
  if (opts.autoUpdate != null) light.shadow.autoUpdate = opts.autoUpdate;
}

/**
 * Işığı sabit sahne çapasina + offset’e kilitle (karakter X takip yok).
 * @param {THREE.DirectionalLight} light
 * @param {{ x: number, y: number, z: number }} offset
 */
export function anchorLightToShadowVolume(light, offset) {
  const a = SHADOW_ANCHOR;
  light.target.position.set(a.x, a.y, a.z);
  light.position.set(a.x + offset.x, a.y + offset.y, a.z + offset.z);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

function shouldCastDynamic(kind) {
  return allowDynamicShadows && !!dynamicShadowCast[kind];
}

/**
 * @param {import('three').Object3D} root
 * @param {keyof typeof dynamicShadowCast} kind
 */
export function applyCasterPolicy(root, kind) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.userData.dynamicShadowCaster = true;
    obj.userData.dynamicShadowKind = kind;
    obj.castShadow = shouldCastDynamic(kind);
    obj.receiveShadow = true;
  });
}

/** Bake sırasında dinamikleri kapat */
export function suspendDynamicCasters(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.dynamicShadowCaster) return;
    obj.castShadow = false;
  });
}

/** Bake sonrası dinamikleri aç */
export function resumeDynamicCasters(scene) {
  allowDynamicShadows = true;
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.dynamicShadowCaster) return;
    const kind = obj.userData.dynamicShadowKind;
    obj.castShadow = !!dynamicShadowCast[kind];
  });
}

/**
 * Dinamik karakter IBL — scene.environment kullanılmaz (ağaçlara sızmasın).
 * @param {import('three').Material[]} materials
 * @param {import('three').Texture | null} envMap
 * @param {number} [intensity]
 */
export function applyDynamicCharEnv(materials, envMap, intensity = 0.4) {
  if (!materials?.length) return;
  for (const mat of materials) {
    if (!mat || !("envMap" in mat)) continue;
    mat.envMap = envMap || null;
    mat.envMapIntensity = envMap ? intensity : 0;
    mat.needsUpdate = true;
  }
}

/**
 * Karakter gölgesini zeminde göstermek için (sadece gölge, ekstra ışık yok).
 * @param {THREE.Scene | THREE.Object3D} parent
 * @param {number} layerChar
 */
export function addCharShadowCatcher(parent, layerChar) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 12),
    new THREE.ShadowMaterial({
      opacity: 0.36,
      // Cobble ile neredeyse aynı yükseklik → yürürken siyah z-fight titremesi
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  mesh.name = "CharShadowCatcher";
  mesh.rotation.x = -Math.PI / 2;
  // Biraz daha yukarı + cobble’ın gerisine daha az binmesin
  mesh.position.set(SHADOW_ANCHOR.x - 2, 0.06, -1.2);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.layers.set(layerChar);
  mesh.renderOrder = 2;
  parent.add(mesh);
  return mesh;
}
