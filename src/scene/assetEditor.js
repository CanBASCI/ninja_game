import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

const BASE = "./public/scene2";
const PUBLIC = "./public";
const STORAGE_KEY = "ninja_scene2_placements";
const STORAGE_KEY_3 = "ninja_scene3_placements";

const TEMPLE_2D_META = {
  worldW: 14.796621180718667,
  worldH: 14.067144726514815,
};

/** @typedef {"decor"|"vault"|"limbo"|"climbVisual"|"zone"} PlacementRole */
/** @typedef {"root"|"mid"|"far"} PlacementParent */

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   group: string,
 *   role: PlacementRole,
 *   parent: PlacementParent,
 *   position: [number, number, number],
 *   rotation: [number, number, number],
 *   scale: [number, number, number],
 * }} PlacementData
 */

export const ASSET_CATALOG = [
  { path: "props/auto_jump/Rustic_Wooden_Fence.glb", group: "auto_jump", label: "Rustic Fence" },
  { path: "props/auto_jump/Weathered_Fence.glb", group: "auto_jump", label: "Weathered Fence" },
  { path: "props/auto_jump/Ancient_Slate_Slab.glb", group: "auto_jump", label: "Ancient Slate" },
  { path: "props/auto_jump/Rock_Formation_1001.glb", group: "auto_jump", label: "Rock Formation" },
  { path: "props/auto_jump/Zaun_HolzLattenRustik_1001153254.glb", group: "auto_jump", label: "Zaun Latten" },
  { path: "props/auto_jump/Zaun_HolzPlankenRusti.glb", group: "auto_jump", label: "Zaun Planken" },
  { path: "props/jump/Stone_Formation.glb", group: "jump", label: "Stone Formation" },
  { path: "props/jump/Stone_Plateau.glb", group: "jump", label: "Stone Plateau" },
  { path: "props/jump/Stone_Wall_Segment.glb", group: "jump", label: "Stone Wall" },
  { path: "props/slide_croch/Stone_Archway_Bridge.glb", group: "slide_croch", label: "Stone Archway" },
  { path: "props/climb/Knotted_Ladder_1001153335.glb", group: "climb", label: "Knotted Ladder" },
  { path: "props/climb/Monolithic_Fragmen.glb", group: "climb", label: "Monolith" },
  { path: "foliage/Bamboo_Serenity_1001153856_texture.glb", group: "foliage", label: "Bamboo Serenity" },
  { path: "foliage/Bamboo_Grove.glb", group: "foliage", label: "Bamboo Grove" },
  { path: "foliage/Tall_Meadow_Grass.glb", group: "foliage", label: "Tall Grass" },
  { path: "foliage/Ancient_Remnants_1001153728_texture.glb", group: "foliage", label: "Ancient Remnants" },
  { path: "foliage/Generate_individual_g_1001090218_texture.glb", group: "foliage", label: "Grass Clump" },
  { path: "asset_2d/buildings/moonlit_temple.png", group: "buildings", label: "Moonlit Temple (2D)" },
  {
    path: "scene_3/buildings/pink/cyber_japan_buildings_1001231821_texture.glb",
    group: "buildings",
    label: "Cyber Japan Pink",
  },
  {
    path: "scene_3/buildings/pink/cyber_japan_building__1001233346_texture.glb",
    group: "buildings",
    label: "Cyber Japan Pink B",
  },
  { path: "buildings/low_poly_ancient_chin_1001153652_texture.glb", group: "buildings", label: "Low Poly Chinese" },
  { path: "zones/tori_gate.glb", group: "zones", label: "Torii Gate" },
  { path: "trees/sakura.glb", group: "trees", label: "Sakura Pack" },
  { path: "trees/sakura_tree_1001152836.glb", group: "trees", label: "Sakura Tree" },
  { path: "lantern/bamboo_lantern.glb", group: "lantern", label: "Bamboo Lantern" },
];

export const ASSET_GROUPS = [
  "auto_jump",
  "jump",
  "slide_croch",
  "climb",
  "foliage",
  "buildings",
  "zones",
  "trees",
  "lantern",
];

const ROLE_BY_GROUP = {
  auto_jump: "vault",
  jump: "vault",
  slide_croch: "limbo",
  climb: "climbVisual",
  zones: "zone",
  foliage: "decor",
  buildings: "decor",
  trees: "decor",
  lantern: "decor",
};

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   renderer: THREE.WebGLRenderer,
 *   pack2Root: THREE.Object3D,
 *   getLayers: () => { root: THREE.Object3D, mid: THREE.Object3D, far: THREE.Object3D },
 *   onChange?: () => void,
 * }} opts
 */
export function createAssetEditor(opts) {
  const {
    scene,
    camera,
    renderer,
    pack2Root,
    pack3Root = null,
    getLayers,
    onChange,
    barriers = null,
    limboBarrier = null,
  } = opts;
  const gltfLoader = new GLTFLoader();
  /** @type {Map<string, { data: PlacementData, object: THREE.Object3D, pack: string }>} */
  const entries = new Map();
  let selectedId = null;
  let enabled = false;
  let seq = 1;
  let suppressPersist = false;
  let activePack = "3";
  let pack3Bootstrapped = false;

  const editorRoot2 = new THREE.Group();
  editorRoot2.name = "EditorPlacements2";
  pack2Root.add(editorRoot2);

  const editorRoot3 = new THREE.Group();
  editorRoot3.name = "EditorPlacements3";
  if (pack3Root) pack3Root.add(editorRoot3);

  function getEditorRoot() {
    return activePack === "3" && pack3Root ? editorRoot3 : editorRoot2;
  }

  function storageKey() {
    return activePack === "3" ? STORAGE_KEY_3 : STORAGE_KEY;
  }

  function getPackRoot() {
    return activePack === "3" && pack3Root ? pack3Root : pack2Root;
  }

  const controls = new TransformControls(camera, renderer.domElement);
  controls.setMode("translate");
  controls.setSpace("world");
  controls.setSize(0.9);
  controls.enabled = false;
  controls.visible = false;
  scene.add(controls.getHelper());

  let dragging = false;
  controls.addEventListener("dragging-changed", (e) => {
    dragging = !!e.value;
  });
  controls.addEventListener("objectChange", () => {
    syncSelectedFromObject();
    if (selectedId) {
      entries.get(selectedId)?.object?.userData?.syncShadowBlob?.();
    }
    persist();
    notify();
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let ptrDown = null; // { x, y, t }

  // Z derinlik ipucu (layer değişince, sadece Z boş/yakınsa)
  const LAYER_Z = { root: 0, mid: -8, far: -16 };

  function notify() {
    onChange?.();
  }

  function prepareEnvMesh(root, editorId) {
    root.traverse((obj) => {
      obj.userData.editorId = editorId;
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if ("envMapIntensity" in m) m.envMapIntensity = 0;
        if ("envMap" in m) m.envMap = null;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      }
    });
  }

  function catalogEntry(path) {
    return ASSET_CATALOG.find((c) => c.path === path) || null;
  }

  function makeId(path) {
    const base = path.split("/").pop()?.replace(/\.glb$/i, "") || "asset";
    const short = base.slice(0, 18).replace(/[^a-zA-Z0-9_]/g, "_");
    return `${short}_${seq++}`;
  }

  function applyTransform(object, data) {
    object.position.set(data.position[0], data.position[1], data.position[2]);
    object.rotation.set(
      THREE.MathUtils.degToRad(data.rotation[0]),
      THREE.MathUtils.degToRad(data.rotation[1]),
      THREE.MathUtils.degToRad(data.rotation[2]),
    );
    object.scale.set(data.scale[0], data.scale[1], data.scale[2]);
    object.userData?.syncShadowBlob?.();
  }

  function readTransform(object, data) {
    data.position = [
      round3(object.position.x),
      round3(object.position.y),
      round3(object.position.z),
    ];
    data.rotation = [
      round3(THREE.MathUtils.radToDeg(object.rotation.x)),
      round3(THREE.MathUtils.radToDeg(object.rotation.y)),
      round3(THREE.MathUtils.radToDeg(object.rotation.z)),
    ];
    data.scale = [
      round3(object.scale.x),
      round3(object.scale.y),
      round3(object.scale.z),
    ];
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function syncSelectedFromObject() {
    if (!selectedId) return;
    const e = entries.get(selectedId);
    if (!e) return;
    readTransform(e.object, e.data);
    syncGameplayBarrier(e);
  }

  /** vault / limbo mesh → barriers[] collision (auto-jump / slide) */
  function syncGameplayBarrier(entry) {
    if (!barriers || !entry?.object) return;
    const role = entry.data.role;
    if (role !== "vault" && role !== "limbo") {
      // Role değiştiyse eski barrier’ı temizle
      removeBarrierForId(entry.data.id);
      return;
    }

    entry.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(entry.object);
    const x = round3((box.min.x + box.max.x) * 0.5);
    const halfT = Math.max(0.1, (box.max.x - box.min.x) * 0.5);
    const height = Math.max(0.25, box.max.y);

    if (role === "limbo") {
      let b =
        (limboBarrier && limboBarrier.editorId === entry.data.id
          ? limboBarrier
          : null) ||
        barriers.find((e) => e.passUnder && e.editorId === entry.data.id) ||
        (limboBarrier && !limboBarrier.editorId ? limboBarrier : null) ||
        barriers.find((e) => e.passUnder && !e.editorId);

      if (!b) {
        b = {
          editorId: entry.data.id,
          x,
          halfT,
          height,
          clearance: 1.5,
          passUnder: true,
          vaultable: false,
        };
        barriers.push(b);
      } else {
        b.editorId = entry.data.id;
        b.x = x;
        b.halfT = halfT;
        b.passUnder = true;
        b.vaultable = false;
        if (b.clearance == null) b.clearance = 1.5;
        b.height = Math.max(b.clearance + 0.28, height);
      }
      return;
    }

    // vault / auto-jump
    let b = barriers.find(
      (e) => e.editorId === entry.data.id && !e.passUnder,
    );
    if (!b) {
      b = { editorId: entry.data.id, x, halfT, height };
      barriers.push(b);
    } else {
      b.x = x;
      b.halfT = halfT;
      b.height = height;
    }
  }

  function removeBarrierForId(id) {
    if (!barriers || !id) return;
    for (let i = barriers.length - 1; i >= 0; i--) {
      const b = barriers[i];
      if (b.editorId !== id) continue;
      // Limbo slider API’sini silme — sadece konum sıfırlama yerine listeden çıkar
      // ama limboBarrier referansı menüde kullanılıyor; limbo ise sadece disable et
      if (b === limboBarrier || b.passUnder) {
        b.x = -9999;
        b.halfT = 0.01;
        continue;
      }
      barriers.splice(i, 1);
    }
  }

  function syncAllGameplayBarriers() {
    for (const e of entries.values()) syncGameplayBarrier(e);
  }

  function detachGizmo() {
    if (controls.object) controls.detach();
  }

  function attachGizmo(object) {
    if (!enabled) {
      detachGizmo();
      return;
    }
    controls.attach(object);
    controls.visible = true;
    controls.enabled = true;
  }

  function setSelected(id) {
    selectedId = id && entries.has(id) ? id : null;
    if (selectedId) {
      attachGizmo(entries.get(selectedId).object);
    } else {
      detachGizmo();
      controls.visible = false;
      controls.enabled = false;
    }
    notify();
  }

  /** parent = export katmanı; sahnede kaydırma yok, isteğe Z ipucu */
  function setLayer(entry, nextParent, { nudgeZ = true } = {}) {
    const parent =
      nextParent === "mid" || nextParent === "far" ? nextParent : "root";
    if (entry.data.parent === parent) return;
    entry.data.parent = parent;
    if (nudgeZ) {
      const zHint = LAYER_Z[parent] ?? 0;
      // Mevcut Z layer bandına yakınsa veya 0’sa ipucu uygula
      const z = entry.object.position.z;
      if (Math.abs(z) < 0.35 || Math.abs(z - (LAYER_Z.root ?? 0)) < 0.5 ||
          Math.abs(z - LAYER_Z.mid) < 1.5 || Math.abs(z - LAYER_Z.far) < 1.5) {
        entry.object.position.z = zHint;
        entry.data.position[2] = zHint;
      }
    }
  }

  /**
   * @param {Partial<PlacementData> & { path: string }} spec
   * @returns {Promise<string|null>}
   */
  async function spawn(spec) {
    const cat = catalogEntry(spec.path);
    const group = spec.group || cat?.group || "decor";
    /** @type {PlacementData} */
    const data = {
      id: spec.id || makeId(spec.path),
      path: spec.path,
      group,
      role: spec.role || ROLE_BY_GROUP[group] || "decor",
      parent: spec.parent || "root",
      position: spec.position
        ? [...spec.position]
        : [camera.position.x, 0, LAYER_Z[spec.parent || "root"] ?? 0],
      rotation: spec.rotation ? [...spec.rotation] : [0, 0, 0],
      scale: spec.scale ? [...spec.scale] : [1, 1, 1],
    };

    if (entries.has(data.id)) {
      data.id = makeId(spec.path);
    }

    const url =
      data.path.startsWith("asset_2d/") || data.path.startsWith("scene_3/")
        ? `${PUBLIC}/${data.path}`
        : `${BASE}/${data.path}`;

    let object;
    if (/\.png$/i.test(data.path)) {
      const map = await new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, resolve, undefined, reject);
      });
      map.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({
        map,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
      });
      object = new THREE.Sprite(mat);
      object.center.set(0.5, 0);
      const w = TEMPLE_2D_META.worldW;
      const h = TEMPLE_2D_META.worldH;
      object.userData.worldW = w;
      object.userData.worldH = h;
      object.userData.billboard = true;
      if (
        !spec.scale ||
        (spec.scale[0] === 1 && spec.scale[1] === 1 && spec.scale[2] === 1)
      ) {
        data.scale = [w, h, 1];
      }
    } else {
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject);
      });
      object = gltf.scene.clone(true);
      prepareEnvMesh(object, data.id);
    }

    object.name = `editor:${data.id}`;
    object.userData.editorId = data.id;
    applyTransform(object, data);
    getEditorRoot().add(object);

    entries.set(data.id, { data, object, pack: activePack });
    if (!suppressPersist) {
      if (!enabled) setEnabled(true);
      setSelected(data.id);
      syncGameplayBarrier(entries.get(data.id));
      persist();
      notify();
    } else {
      syncGameplayBarrier(entries.get(data.id));
    }
    return data.id;
  }

  function removeSelected() {
    if (!selectedId) return;
    remove(selectedId);
  }

  function remove(id) {
    const e = entries.get(id);
    if (!e) return;
    if (selectedId === id) {
      detachGizmo();
      selectedId = null;
    }
    e.object.parent?.remove(e.object);
    disposeObject(e.object);
    removeBarrierForId(id);
    entries.delete(id);
    persist();
    notify();
  }

  function clearAll() {
    detachGizmo();
    selectedId = null;
    for (const [id, e] of [...entries.entries()]) {
      if (e.pack && e.pack !== activePack) continue;
      e.object.parent?.remove(e.object);
      disposeObject(e.object);
      entries.delete(id);
    }
    persist();
    notify();
  }

  function disposeObject(root) {
    root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m?.dispose?.();
    });
  }

  function listPlacements() {
    return [...entries.values()]
      .filter((e) => !e.pack || e.pack === activePack)
      .map((e) => ({ ...e.data }));
  }

  function getSelected() {
    if (!selectedId) return null;
    const e = entries.get(selectedId);
    return e ? { ...e.data } : null;
  }

  function updateSelected(patch = {}) {
    if (!selectedId) return;
    const e = entries.get(selectedId);
    if (!e) return;

    if (patch.role) e.data.role = patch.role;
    if (patch.parent) setLayer(e, patch.parent, { nudgeZ: true });
    if (patch.position) {
      e.data.position = patch.position.map(Number);
      e.object.position.set(...e.data.position);
    }
    if (patch.rotation) {
      e.data.rotation = patch.rotation.map(Number);
      e.object.rotation.set(
        THREE.MathUtils.degToRad(e.data.rotation[0]),
        THREE.MathUtils.degToRad(e.data.rotation[1]),
        THREE.MathUtils.degToRad(e.data.rotation[2]),
      );
    }
    if (patch.scale) {
      e.data.scale = patch.scale.map(Number);
      e.object.scale.set(...e.data.scale);
    }
    syncGameplayBarrier(e);
    persist();
    notify();
  }

  function setTransformMode(mode) {
    const m =
      mode === "rotate" || mode === "scale" || mode === "translate"
        ? mode
        : "translate";
    controls.setMode(m);
    notify();
  }

  function getTransformMode() {
    return controls.mode;
  }

  function setEnabled(next) {
    enabled = !!next;
    if (!enabled) {
      detachGizmo();
      controls.visible = false;
      controls.enabled = false;
    } else if (selectedId && entries.has(selectedId)) {
      attachGizmo(entries.get(selectedId).object);
    }
    notify();
  }

  function isEnabled() {
    return enabled;
  }

  function isDragging() {
    return dragging;
  }

  function getExportPayload(onlyId = null) {
    const list = listPlacements().filter((p) =>
      onlyId ? p.id === onlyId : true,
    );
    return {
      version: 1,
      pack: activePack,
      placements: list,
    };
  }

  function getExportJson(onlyId = null) {
    return JSON.stringify(getExportPayload(onlyId), null, 2);
  }

  function persist() {
    if (suppressPersist) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(getExportPayload()));
    } catch (err) {
      console.warn("assetEditor persist:", err);
    }
  }

  /**
   * Kodla konmuş sahne objesini editöre al (dünya pozisyonunu koru).
   */
  function adoptExisting(spec) {
    if (!spec?.object || !spec.id) return null;
    if (entries.has(spec.id)) return spec.id;

    const object = spec.object;
    getEditorRoot().attach(object);
    object.name = object.name || `editor:${spec.id}`;
    object.userData.editorId = spec.id;
    object.traverse((o) => {
      if (o.userData?.editorPickIgnore || o.userData?.billboardShadowCaster || o.userData?.billboardShadowBlob) {
        return;
      }
      o.userData.editorId = spec.id;
    });

    const euler = new THREE.Euler().setFromQuaternion(object.quaternion, "XYZ");
    const data = {
      id: spec.id,
      path: spec.path,
      group: spec.group || catalogEntry(spec.path)?.group || "decor",
      role: spec.role || ROLE_BY_GROUP[spec.group] || "decor",
      parent: spec.parent || "root",
      position: [
        round3(object.position.x),
        round3(object.position.y),
        round3(object.position.z),
      ],
      rotation: [
        round3(THREE.MathUtils.radToDeg(euler.x)),
        round3(THREE.MathUtils.radToDeg(euler.y)),
        round3(THREE.MathUtils.radToDeg(euler.z)),
      ],
      scale: [
        round3(object.scale.x),
        round3(object.scale.y),
        round3(object.scale.z),
      ],
      builtIn: true,
    };

    entries.set(data.id, { data, object, pack: activePack });
    return data.id;
  }

  function adoptMany(list = []) {
    for (const spec of list) {
      try {
        const id = adoptExisting(spec);
        if (id) syncGameplayBarrier(entries.get(id));
      } catch (err) {
        console.warn("assetEditor adopt:", spec?.id, err);
      }
    }
    notify();
  }

  async function loadFromStorage() {
    let raw;
    try {
      raw = localStorage.getItem(storageKey());
    } catch {
      return;
    }
    if (!raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const list = Array.isArray(parsed?.placements) ? parsed.placements : [];
    if (!list.length) return;

    suppressPersist = true;
    for (const p of list) {
      if (!p?.id && !p?.path) continue;
      if (p.removed) {
        if (p.id && entries.has(p.id)) remove(p.id);
        continue;
      }
      const existing = p.id ? entries.get(p.id) : null;
      if (existing) {
        if (existing.pack && existing.pack !== activePack) continue;
        existing.data.role = p.role || existing.data.role;
        existing.data.parent = p.parent || existing.data.parent;
        if (p.position) existing.data.position = [...p.position];
        if (p.rotation) existing.data.rotation = [...p.rotation];
        if (p.scale) {
          const sx = Number(p.scale[0]) || 1;
          const sy = Number(p.scale[1]) || 1;
          const isTree =
            existing.data.group === "trees" || /sakura/i.test(existing.data.path || "");
          // Cüce ölçeği yoksay; yayvan (W>H) sakura artık kanonik — izin ver
          const badTree = isTree && sy < 12;
          if (!badTree) existing.data.scale = [...p.scale];
        }
        // Pack3 builtin — 2B mesh merkez Y (zemin Y değil); LS ezmesin
        const PACK3_FIX = {
          s3_grass_0: { position: [-2.417, 1.585, -5.2], scale: [2.05, 3.25, 1] },
          s3_grass_1: { position: [18, 1.66, -5.8], scale: [2.15, 3.4, 1] },
          s3_grass_2: { position: [-18.37, 1.408, 2.779], scale: [2.35, 2.9, 1] },
          s3_grass_2b: { position: [-17.52, 1.158, 2.42], scale: [1.95, 2.4, 1] },
          s3_grass_2c: { position: [-19.18, 1.018, 3.08], scale: [1.68, 2.12, 1] },
          s3_grass_2d: { position: [-17.95, 1.268, 3.32], scale: [2.12, 2.62, 1] },
          s3_grass_2e: { position: [-19.05, 0.898, 2.18], scale: [1.48, 1.88, 1] },
          s3_grass_2f: { position: [-18.7, 1.098, 2.95], scale: [1.82, 2.28, 1] },
          s3_bamboo_0: { position: [10.5, 3.56, -6.5], scale: [3.2, 7.2, 1] },
          s3_bamboo_1: { position: [-23.325, 3.17, -5.4], scale: [3.6, 6.4, 1] },
          s3_sakura_0: {
            position: [-10.904, 9.211, -2.198],
            scale: [29.839, 18.722, 1],
          },
          s3_sakura_1: {
            position: [2.5, 9.05, -2.75],
            scale: [29.552, 18.542, 1],
          },
          s3_sakura_2: {
            position: [14.616, 8.934, -3.9],
            scale: [29.181, 18.309, 1],
          },
          s3_sakura_3: {
            position: [26.603, 9.09, -3.5],
            scale: [29.678, 18.621, 1],
          },
          s3_temple: {
            position: [-4.109, 12.115, -6.366],
            scale: [-7.66, 12.121, 15.728],
            rotation: [1.013, -89.835, 0.943],
          },
          s3_temple_l: {
            position: [-35.181, 7.379, -6.366],
            scale: [-3.545, 7.971, 6.636],
            rotation: [0.009, -71.814, -0.061],
          },
          s3_fence: {
            position: [1.6, 0.589, 0.203],
            scale: [2.944, 1.101, 2.735],
            rotation: [0, 90, 0],
          },
          s3_arch: {
            lockX: false,
            position: [23.399, 1.257, 0.333],
            scale: [2.898, 3.726, 2.989],
            rotation: [0, 90, 0],
          },
          s3_torii: {
            position: [41.67, 3.746, -0.09],
            scale: [4.257, 4.105, 4.769],
            rotation: [0, 88.329, 0],
          },
          s3_ladder: {
            position: [13.053, 3.371, -3.185],
            scale: [2.763, 4.062, 3.966],
            rotation: [-51.66, -52.507, -40.033],
          },
          s3_lantern_0: {
            lockX: false,
            position: [-5, -0.035, 2.0],
            scale: [0.82, 1.55, 0.82],
            rotation: [0, 88.558, 0],
          },
          s3_lantern_1: {
            lockX: false,
            position: [7.556, -0.005, -2.0],
            scale: [0.82, 1.55, 0.82],
            rotation: [-180, -88.624, -180],
          },
          s3_lantern_2: {
            lockX: false,
            position: [16, -0.035, 2.0],
            scale: [0.82, 1.55, 0.82],
            rotation: [0, 88.558, 0],
          },
          s3_lantern_3: {
            lockX: false,
            position: [25.5, -0.035, 2.0],
            scale: [0.82, 1.55, 0.82],
            rotation: [0, 88.558, 0],
          },
        };
        const p3fix = PACK3_FIX[existing.data.id];
        if (p3fix) {
          if (p3fix.lockX === false && existing.data.position?.length >= 3) {
            // Lane X serbest — y/z (ve verilen scale/rot) kilitle
            existing.data.position = [
              existing.data.position[0],
              p3fix.position[1],
              p3fix.position[2],
            ];
          } else {
            existing.data.position = [...p3fix.position];
          }
          existing.data.scale = [...p3fix.scale];
          existing.data.parent = p3fix.parent || existing.data.parent || "root";
          existing.data.rotation = p3fix.rotation
            ? [...p3fix.rotation]
            : [0, 0, 0];
          setLayer(existing, existing.data.parent, { nudgeZ: false });
        }
        applyTransform(existing.object, existing.data);
        existing.object.userData?.syncShadowBlob?.();
        syncGameplayBarrier(existing);
        continue;
      }
      if (!p.path) continue;
      try {
        await spawn({
          id: p.id,
          path: p.path,
          group: p.group,
          role: p.role,
          parent: p.parent,
          position: p.position,
          rotation: p.rotation,
          scale: p.scale,
        });
      } catch (err) {
        console.warn("assetEditor restore:", p.path, err);
      }
    }
    suppressPersist = false;
    for (const id of entries.keys()) {
      const m = /_(\d+)$/.exec(id);
      if (m) seq = Math.max(seq, Number(m[1]) + 1);
    }
    setSelected(null);
    persist();
  }

  async function bootstrap(editableProps = [], pack = "2") {
    activePack = pack === "3" ? "3" : "2";
    if (activePack === "3") pack3Bootstrapped = true;
    adoptMany(editableProps);
    await loadFromStorage();
    syncAllGameplayBarriers();
    setEnabled(false);
    setSelected(null);
    notify();
  }

  /**
   * Scene 2/3 geçişi — editör o pack’in objelerini seçer.
   * @param {"2"|"3"} pack
   * @param {Array} [editableProps] pack3 ilk açılışta
   */
  async function setActivePack(pack, editableProps = null) {
    const next = pack === "3" ? "3" : "2";
    setSelected(null);
    activePack = next;
    if (next === "3" && !pack3Bootstrapped) {
      suppressPersist = true;
      if (editableProps?.length) adoptMany(editableProps);
      await loadFromStorage();
      pack3Bootstrapped = true;
      suppressPersist = false;
    }
    notify();
  }

  function getActivePack() {
    return activePack;
  }

  function pickEditorId(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Sprite picking (2B)
    if (!raycaster.params.Sprite) raycaster.params.Sprite = {};
    raycaster.params.Sprite.threshold = 0.2;

    const roots = [...entries.values()]
      .filter((e) => !e.pack || e.pack === activePack)
      .map((e) => e.object)
      .filter((o) => {
        // Gizli pack’e bakma
        let p = o;
        while (p) {
          if (p.visible === false) return false;
          p = p.parent;
        }
        return true;
      });
    if (!roots.length) return null;
    const hits = raycaster.intersectObjects(roots, true);
    /** Yakından uzağa benzersiz id’ler — tekrar tık arkadakine geçer (ağaç → ot) */
    const ids = [];
    for (const hit of hits) {
      let obj = hit.object;
      if (obj?.userData?.editorPickIgnore) continue;
      while (obj) {
        if (obj.userData?.editorPickIgnore) break;
        const id = obj.userData?.editorId;
        if (id && entries.has(id)) {
          const e = entries.get(id);
          if ((!e.pack || e.pack === activePack) && !ids.includes(id)) {
            ids.push(id);
          }
          break;
        }
        obj = obj.parent;
      }
    }
    if (!ids.length) return null;
    if (selectedId && ids.length > 1) {
      const i = ids.indexOf(selectedId);
      if (i >= 0) return ids[(i + 1) % ids.length];
    }
    return ids[0];
  }

  function onPointerDown(ev) {
    if (!enabled) return;
    if (ev.button !== 0) return;
    if (ev.target !== renderer.domElement) return;
    if (controls.axis) {
      ptrDown = null;
      return;
    }
    ptrDown = { x: ev.clientX, y: ev.clientY };
    const id = pickEditorId(ev.clientX, ev.clientY);
    if (id) setSelected(id);
    else setSelected(null);
  }

  function onPointerUp(ev) {
    if (!enabled || !ptrDown) return;
    if (ev.button !== 0) {
      ptrDown = null;
      return;
    }
    const dx = ev.clientX - ptrDown.x;
    const dy = ev.clientY - ptrDown.y;
    const moved = dx * dx + dy * dy;
    ptrDown = null;
    if (dragging || moved > 64) return;
    const id = pickEditorId(ev.clientX, ev.clientY);
    if (id) setSelected(id);
    else setSelected(null);
  }

  function onKeyDown(ev) {
    if (!enabled) return;
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    if (ev.code === "KeyT") setTransformMode("translate");
    if (ev.code === "KeyR") setTransformMode("rotate");
    if (ev.code === "KeyG") setTransformMode("scale");
    if (ev.code === "Delete" || ev.code === "Backspace") {
      if (selectedId) {
        ev.preventDefault();
        removeSelected();
      }
    }
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);

  const ready = Promise.resolve();

  return {
    ready,
    bootstrap,
    setActivePack,
    getActivePack,
    adoptMany,
    adoptExisting,
    ASSET_CATALOG,
    ASSET_GROUPS,
    setEnabled,
    isEnabled,
    isDragging,
    spawn,
    addFromCatalog: (path) => spawn({ path }),
    remove,
    removeSelected,
    clearAll,
    setSelected,
    getSelected,
    listPlacements,
    updateSelected,
    setTransformMode,
    getTransformMode,
    getExportJson,
    getExportPayload,
    persist,
    dispose() {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      detachGizmo();
      scene.remove(controls.getHelper());
      controls.dispose();
      clearAll();
      editorRoot2.parent?.remove(editorRoot2);
      editorRoot3.parent?.remove(editorRoot3);
    },
  };
}
