import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clearRopeAnchors, addRopeAnchor } from "./ropeAnchors.js";
import { billboardFromMap } from "./billboardBake.js";

const LAYER_ENV = 0;
const BASE = "./public/scene2";
const TEMPLE_2D = "./public/asset_2d/buildings/moonlit_temple.png";
const TEMPLE_2D_META = {
  worldW: 14.796621180718667,
  worldH: 14.067144726514815,
};

/**
 * Scene 2 — ShipGame hissi + 2D yan-scroll derinlik (parallax katmanlar).
 * Mobil: az mesh, az light.
 *
 * @param {THREE.Object3D} root
 * @param {{
 *   onStaticReady?: () => void,
 *   barriers?: Array,
 *   limboBarrier?: object,
 * }} [opts]
 * @returns {{ update: (camX: number) => void }}
 */
export function buildScenePack2(root, opts = {}) {
  const { onStaticReady, barriers = [], limboBarrier = null } = opts;
  const loader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();

  clearRopeAnchors();

  /** @type {Array<{ id: string, path: string, group: string, role: string, parent: string, object: THREE.Object3D }>} */
  const editableProps = [];
  function registerEditable(object, meta) {
    editableProps.push({
      id: meta.id,
      path: meta.path,
      group: meta.group,
      role: meta.role,
      parent: meta.parent || "root",
      object,
    });
  }

  // sakura, lantern + curated props/scenery
  let staticLeft = 9;
  function markStaticReady() {
    staticLeft -= 1;
    if (staticLeft <= 0) onStaticReady?.();
  }

  function loadStaticGlb(url, onOk) {
    gltfLoader.load(
      url,
      (gltf) => {
        try {
          onOk(gltf.scene);
        } catch (err) {
          console.warn("Scene2 place:", url, err);
        }
        markStaticReady();
      },
      undefined,
      (err) => {
        console.warn("Scene2 load:", url, err);
        markStaticReady();
      },
    );
  }

  // Parallax grupları — factor: 0=kameraya yapışık, 1=dünya sabit
  const far = new THREE.Group(); // ~0.12
  const mid = new THREE.Group(); // ~0.45
  const nearFx = new THREE.Group(); // ~0.78 — ön sis
  root.add(far, mid, nearFx);

  const farFactor = 0.12;
  const midFactor = 0.42;
  const nearFactor = 0.78;

  // --- Zemin — dar şerit (kamera tarafı bom boş taş olmasın) ---
  // depth≈10, z=-2.2 → kabaca Z −7…+3 (lane + mid kök; +Z boş alan yok)
  const cobbleDiff = loadColorMap(loader, `${BASE}/ground/cobble_diff.jpg`, [10, 1.6]);
  const cobbleNor = loadDataMap(loader, `${BASE}/ground/cobble_nor.jpg`, [10, 1.6]);
  const cobbleRough = loadDataMap(loader, `${BASE}/ground/cobble_rough.jpg`, [10, 1.6]);
  const plankDiff = loadColorMap(loader, `${BASE}/wood/planks_diff.jpg`, [14, 1.2]);
  const plankNor = loadDataMap(loader, `${BASE}/wood/planks_nor.jpg`, [14, 1.2]);
  const plankRough = loadDataMap(loader, `${BASE}/wood/planks_rough.jpg`, [14, 1.2]);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 10),
    new THREE.MeshStandardMaterial({
      map: cobbleDiff,
      normalMap: cobbleNor,
      roughnessMap: cobbleRough,
      roughness: 1,
      metalness: 0.04,
      color: 0x6a7078,
      envMapIntensity: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -2.2;
  ground.receiveShadow = true;
  root.add(ground);

  // Orta şerit — biraz yukarı/öne (yürüme hissi)
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 2.6),
    new THREE.MeshStandardMaterial({
      map: plankDiff,
      normalMap: plankNor,
      roughnessMap: plankRough,
      roughness: 1,
      metalness: 0.02,
      color: 0xb89878,
      envMapIntensity: 0,
    }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.02;
  lane.position.z = 0.15;
  lane.receiveShadow = true;
  root.add(lane);

  // Kamera kenarı — dar koyu bant (taş düzlemi bitişini yumuşatır)
  const nearBand = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 1.1),
    new THREE.MeshStandardMaterial({
      map: cobbleDiff,
      normalMap: cobbleNor,
      roughness: 1,
      color: 0x2a3038,
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 0,
    }),
  );
  nearBand.rotation.x = -Math.PI / 2;
  nearBand.position.set(0, 0.025, 2.15);
  root.add(nearBand);

  // --- FAR: ShipGame yıldızlı gökyüzü + ay ---
  const sky = createNightSky(loader);
  // Parallax’tan bağımsız — kamerayı takip eder
  root.add(sky.mesh);

  const moonTex = loader.load(`${BASE}/moon/full-moon.png`);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: moonTex,
      color: 0x8eb4ff,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.94,
    }),
  );
  moon.scale.set(9.2, 9.2, 1);
  moon.position.set(-4, 12.4, -22);
  moon.renderOrder = 8;
  far.add(moon);

  // Extra hemi fill yok — kameraya bakan gövdeleri yapay aydınlatıyordu

  // Uzak dağ/sırt peçeleri yok — düz renk duvar gibi okunuyordu
  // Sis far/mid katmanda derinlik verir

  const mistMaps = ["mist-a", "mist-b", "mist-c"].map((n) => {
    const t = loader.load(`${BASE}/fog/${n}.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });

  const mistMeshes = [];

  function addMist(parent, specs) {
    for (const s of specs) {
      // Kısa yatay bant — dikkati kare kart gibi çekmesin
      const w = s.w ?? 46;
      const h = s.h ?? 5.5;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        map: mistMaps[s.map],
        color: s.color ?? 0xffffff,
        transparent: true,
        opacity: s.op,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        alphaTest: 0.02,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.ry ?? 0;
      mesh.rotation.x = s.rx ?? 0;
      mesh.renderOrder = s.order ?? 2;
      mesh.frustumCulled = false;
      mesh.userData.baseX = s.x;
      mesh.userData.drift = s.drift ?? 0.35;
      mesh.userData.phase = s.phase ?? Math.random() * Math.PI * 2;
      // Plane merkezden büyür — alt kenar y=0 olsun diye
      if (s.grounded) mesh.position.y = h * 0.5;
      parent.add(mesh);
      mistMeshes.push(mesh);
    }
  }

  // Far sis — sağ+sol geniş, zemine uzanır
  addMist(far, [
    { x: -40, y: 3.0, z: -19, map: 0, op: 0.55, ry: 0.04, order: 1, w: 75, h: 22, drift: 0.35, phase: 0.1 },
    { x: -12, y: 3.0, z: -19.5, map: 1, op: 0.55, ry: -0.03, order: 1, w: 75, h: 22, drift: 0.33, phase: 0.7 },
    { x: 14, y: 3.0, z: -20, map: 2, op: 0.52, ry: 0.03, order: 1, w: 75, h: 22, drift: 0.32, phase: 1.3 },
    { x: 40, y: 2.5, z: -20.5, map: 0, op: 0.52, ry: -0.04, order: 1, w: 75, h: 21, drift: 0.3, phase: 1.9 },
    { x: 65, y: 2.5, z: -21, map: 1, op: 0.5, ry: 0.04, order: 1, w: 70, h: 21, drift: 0.28, phase: 2.5 },
  ]);

  addMist(mid, [
    { x: -10, y: 2.4, z: -9.5, map: 2, op: 0.55, ry: -0.04, order: 2, w: 55, h: 8, drift: 0.45, phase: 0.4 },
    { x: 8, y: 2.5, z: -10, map: 1, op: 0.58, ry: 0.05, order: 2, w: 58, h: 8.2, drift: 0.42, phase: 1.1 },
    { x: 26, y: 2.3, z: -11, map: 0, op: 0.55, ry: -0.05, order: 2, w: 55, h: 7.8, drift: 0.4, phase: 2.2 },
    { x: 42, y: 2.2, z: -11.5, map: 2, op: 0.5, ry: 0.04, order: 2, w: 52, h: 7.5, drift: 0.38, phase: 3.0 },
  ]);

  addMist(nearFx, [
    { x: 8, y: 1.4, z: 3.0, map: 1, op: 0.08, ry: 0.03, order: 4, w: 38, h: 3.2, drift: 0.55, phase: 0.9 },
  ]);
  // Mid siluet binalar yok — tek renk “çit duvarı” gibi duruyordu

  // --- Sakura mid plan ---
  gltfLoader.load(
    `${BASE}/trees/sakura.glb`,
    (gltf) => {
      const variants = [];
      gltf.scene.traverse((obj) => {
        if (/^Sakura[ABC]$/.test(obj.name)) variants.push(obj);
      });
      variants.sort((a, b) => a.name.localeCompare(b.name));
      if (!variants.length) variants.push(gltf.scene);

      const placements = [
        {
          x: -8.5,
          z: -4.2,
          side: -1,
          position: [-8.5, 0, -4.2],
          rotation: [0, 20.054, 0],
          scale: [0.326, 0.326, 0.326],
        },
        {
          x: 2.5,
          z: -4.5,
          side: 1,
          position: [2.5, 0, -4.5],
          rotation: [-180, 14.324, -180],
          scale: [0.281, 0.281, 0.281],
        },
        {
          x: 14.5,
          z: -4.0,
          side: 1,
          position: [14.5, 0, -4],
          rotation: [-180, -28.648, -180],
          scale: [0.304, 0.304, 0.304],
        },
        {
          x: 26.5,
          z: -4.3,
          side: -1,
          position: [26.5, 0, -4.3],
          rotation: [0, -8.594, 0],
          scale: [0.27, 0.27, 0.27],
        },
      ];

      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const tree = variants[i % variants.length].clone(true);
        tree.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          const next = mats.map((m) => {
            const c = m.clone();
            const bark = /bark/i.test(m.name || "");
            c.metalness = 0;
            c.emissive?.set?.(0x000000);
            c.emissiveIntensity = 0;
            c.envMap = null;
            c.envMapIntensity = 0;
            if (!bark) {
              c.side = THREE.DoubleSide;
              c.transparent = false;
              c.alphaTest = 0.45;
              c.depthWrite = true;
              c.roughness = 0.92;
              if (c.map) c.map.colorSpace = THREE.SRGBColorSpace;
              c.color.set(p.side < 0 ? 0xe4ecff : 0xffe6d8);
            } else {
              c.color.set(0xffffff);
              c.roughness = 1;
            }
            return c;
          });
          obj.material = Array.isArray(obj.material) ? next : next[0];
          // Yaprak alpha gölge haritasında da kesilsin — kare kart silüeti olmasın
          const foliage = next.find((m) => !/bark/i.test(m.name || ""));
          if (foliage?.map) {
            const depthMat = new THREE.MeshDepthMaterial({
              map: foliage.map,
              alphaTest: 0.5,
              depthPacking: THREE.RGBADepthPacking,
              side: THREE.DoubleSide,
            });
            obj.customDepthMaterial = depthMat;
          }
          obj.castShadow = true;
          obj.receiveShadow = true;
        });
        // Asset Editor default (Copy)
        tree.position.set(p.position[0], p.position[1], p.position[2]);
        tree.rotation.set(
          THREE.MathUtils.degToRad(p.rotation[0]),
          THREE.MathUtils.degToRad(p.rotation[1]),
          THREE.MathUtils.degToRad(p.rotation[2]),
        );
        tree.scale.set(p.scale[0], p.scale[1], p.scale[2]);
        // Dünya sabit — parallax yok (kamerayla kaymasın)
        root.add(tree);

        // Üst örtü — yatay taç alanı; kanca yüksekliği MainChar ekran tepesi
        tree.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(tree);
        const halfW = Math.max(1.4, (box.max.x - box.min.x) * 0.5);
        addRopeAnchor({
          x: p.position[0],
          halfW,
          topY: Math.max(box.max.y, 2.5),
          z: 0,
        });
        registerEditable(tree, {
          id: `builtin_sakura_${i}`,
          path: "trees/sakura.glb",
          group: "trees",
          role: "decor",
          parent: "root",
        });
      }
      markStaticReady();
    },
    undefined,
    (err) => {
      console.warn("Scene2 sakura:", err);
      markStaticReady();
    },
  );

  // --- Fenerler (sadece mesh — ışık/emissive yok) ---
  const lanternSpecs = [
    {
      x: -5,
      color: 0xffc15a,
      position: [-5, 0, 1.35],
      rotation: [0, 0, 0],
      scale: [0.72, 0.72, 0.72],
    },
    {
      x: 5.5,
      color: 0xff4fa3,
      position: [7.556, -0.005, -2.045],
      rotation: [-180, -88.624, -180],
      scale: [0.72, 0.72, 0.72],
    },
    {
      x: 16,
      color: 0x3ee0ff,
      position: [16, 0, 1.35],
      rotation: [-180, 0, -180],
      scale: [0.72, 0.72, 0.72],
    },
    {
      x: 25.5,
      color: 0xffa033,
      position: [25.5, 0, 1.3],
      rotation: [-180, 0, -180],
      scale: [0.72, 0.72, 0.72],
    },
  ];

  gltfLoader.load(
    `${BASE}/lantern/bamboo_lantern.glb`,
    (gltf) => {
      const template = gltf.scene;
      for (const spec of lanternSpecs) {
        const model = template.clone(true);
        const color = new THREE.Color(spec.color);
        model.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;
          const matName = obj.material.name || "";
          const shade =
            matName === "Paper" ||
            /^Paper/i.test(obj.name) ||
            /paper/i.test(matName);
          if (!shade) return;
          const mat = obj.material.clone();
          mat.color.copy(color);
          mat.emissive?.set?.(0x000000);
          mat.emissiveIntensity = 0;
          mat.envMapIntensity = 0;
          mat.side = THREE.DoubleSide;
          obj.material = mat;
        });
        // Asset Editor default (Copy)
        model.position.set(
          spec.position[0],
          spec.position[1],
          spec.position[2],
        );
        model.rotation.set(
          THREE.MathUtils.degToRad(spec.rotation[0]),
          THREE.MathUtils.degToRad(spec.rotation[1]),
          THREE.MathUtils.degToRad(spec.rotation[2]),
        );
        model.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (m && m.envMapIntensity != null) m.envMapIntensity = 0;
            }
          }
        });
        root.add(model);
        registerEditable(model, {
          id: `builtin_lantern_${spec.x}`,
          path: "lantern/bamboo_lantern.glb",
          group: "lantern",
          role: "decor",
          parent: "root",
        });
      }
      markStaticReady();
    },
    undefined,
    (err) => {
      console.warn("Scene2 lantern:", err);
      markStaticReady();
    },
  );

  // --- Oynanabilir engeller — Scene1 vault/limbo ölçüleri ---
  // Scene1: vault h=0.72/0.68, thickness=0.45, width=2.8
  // Limbo: clearance=1.5, thickness=0.55, width=3.2, beamH=0.28
  loadStaticGlb(`${BASE}/props/auto_jump/Rustic_Wooden_Fence.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    // Asset Editor default (Copy)
    model.position.set(1.6, 0.589, 0);
    model.rotation.set(0, THREE.MathUtils.degToRad(90), 0);
    model.scale.set(2.944, 1.101, 2.735);
    root.add(model);
    syncVaultBarrierFixed(barriers, 1.6, 0.72, 0.45, "builtin_fence");
    registerEditable(model, {
      id: "builtin_fence",
      path: "props/auto_jump/Rustic_Wooden_Fence.glb",
      group: "auto_jump",
      role: "vault",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/props/jump/Stone_Formation.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    // Asset Editor default (Copy)
    model.position.set(9.624, 0.461, 0.043);
    model.rotation.set(0, 0, 0);
    model.scale.set(0.629, 1.25, 2.425);
    root.add(model);
    // Scene1 hitbox X 6.5 → görsel X’e taşı (yükseklik/kalınlık aynı)
    syncVaultBarrierFixed(barriers, 6.5, 0.68, 0.45, "builtin_stone");
    const stoneB = barriers.find((e) => e.editorId === "builtin_stone");
    if (stoneB) stoneB.x = 9.624;
    registerEditable(model, {
      id: "builtin_stone",
      path: "props/jump/Stone_Formation.glb",
      group: "jump",
      role: "vault",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/props/slide_croch/Stone_Archway_Bridge.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    // Asset Editor default (Copy)
    model.position.set(23.399, 1.121, 0.312);
    model.rotation.set(0, THREE.MathUtils.degToRad(90), 0);
    model.scale.set(2.898, 3.535, 2.989);
    root.add(model);
    model.updateMatrixWorld(true);
    const archBox = new THREE.Box3().setFromObject(model);
    const archHalfT = Math.max(0.4, (archBox.max.x - archBox.min.x) * 0.5);
    const archX = (archBox.min.x + archBox.max.x) * 0.5;
    // Çarpışma kalınlığı mesh X’ine otursun (eski 0.55 tahta kirişti → beden içeri giriyordu)
    syncLimboBarrierFixed(limboBarrier, 1.5, archHalfT * 2, 0.28, "builtin_arch");
    if (limboBarrier) limboBarrier.x = archX;
    registerEditable(model, {
      id: "builtin_arch",
      path: "props/slide_croch/Stone_Archway_Bridge.glb",
      group: "slide_croch",
      role: "limbo",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/props/climb/Knotted_Ladder_1001153335.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    // Asset Editor default (Copy)
    model.position.set(13.2, 0.95, -1.55);
    model.rotation.set(0, THREE.MathUtils.degToRad(8.594), 0);
    model.scale.set(1, 1, 1);
    root.add(model);
    registerEditable(model, {
      id: "builtin_ladder",
      path: "props/climb/Knotted_Ladder_1001153335.glb",
      group: "climb",
      role: "climbVisual",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/zones/tori_gate.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    // Asset Editor default (Copy)
    model.position.set(32, 3.746, -0.2);
    model.rotation.set(0, THREE.MathUtils.degToRad(88.329), 0);
    model.scale.set(4.257, 4.105, 4.769);
    root.add(model);
    registerEditable(model, {
      id: "builtin_torii",
      path: "zones/tori_gate.glb",
      group: "zones",
      role: "zone",
      parent: "root",
    });
  });

  // Foliage — root (mid parallax takip ettiriyordu)
  loadStaticGlb(
    `${BASE}/foliage/Bamboo_Serenity_1001153856_texture.glb`,
    (src) => {
      const spots = [
        {
          id: "builtin_bamboo",
          parent: "root",
          position: [10.5, 0.96, -6.5],
          rotation: [0, 22.918, 0],
          scale: [1, 1, 1],
        },
        {
          id: "Bamboo_Serenity_10_3",
          parent: "root",
          position: [-23.325, 0.55, 1.65],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ];
      for (const s of spots) {
        const model = src.clone(true);
        prepareEnvMesh(model);
        // Asset Editor default (Copy)
        model.position.set(s.position[0], s.position[1], s.position[2]);
        model.rotation.set(
          THREE.MathUtils.degToRad(s.rotation[0]),
          THREE.MathUtils.degToRad(s.rotation[1]),
          THREE.MathUtils.degToRad(s.rotation[2]),
        );
        model.scale.set(s.scale[0], s.scale[1], s.scale[2]);
        const layer = s.parent === "mid" ? mid : root;
        layer.add(model);
        registerEditable(model, {
          id: s.id,
          path: "foliage/Bamboo_Serenity_1001153856_texture.glb",
          group: "foliage",
          role: "decor",
          parent: s.parent,
        });
      }
    },
  );

  loadStaticGlb(`${BASE}/foliage/Tall_Meadow_Grass.glb`, (src) => {
    const template = src;
    const spots = [
      {
        id: "builtin_grass_0",
        parent: "root",
        position: [-2, 0.797, -5.2],
        rotation: [0, 11.459, 0],
        scale: [0.847, 0.847, 0.847],
      },
      {
        id: "builtin_grass_1",
        parent: "root",
        position: [18, 0.897, -5.8],
        rotation: [0, -20.054, 0],
        scale: [0.952, 0.952, 0.952],
      },
      {
        id: "Tall_Meadow_Grass_2",
        parent: "root",
        position: [-18.37, 0.55, 1.85],
        rotation: [0, 0, 0],
        scale: [1.2, 1.1, 1],
      },
    ];
    for (let gi = 0; gi < spots.length; gi++) {
      const s = spots[gi];
      const model = template.clone(true);
      prepareEnvMesh(model);
      // Asset Editor default (Copy)
      model.position.set(s.position[0], s.position[1], s.position[2]);
      model.rotation.set(
        THREE.MathUtils.degToRad(s.rotation[0]),
        THREE.MathUtils.degToRad(s.rotation[1]),
        THREE.MathUtils.degToRad(s.rotation[2]),
      );
      model.scale.set(s.scale[0], s.scale[1], s.scale[2]);
      const layer = s.parent === "mid" ? mid : root;
      layer.add(model);
      registerEditable(model, {
        id: s.id,
        path: "foliage/Tall_Meadow_Grass.glb",
        group: "foliage",
        role: "decor",
        parent: s.parent,
      });
    }
  });

  // Ev — root’ta sabit 2B (prebaked PNG)
  {
    const map = loader.load(TEMPLE_2D);
    map.colorSpace = THREE.SRGBColorSpace;
    const bake = billboardFromMap(map, {
      ...TEMPLE_2D_META,
      fog: true,
      alphaTest: 0.08,
    });
    const spr = bake.sprite;
    // Eski 3D placement: x/z aynı; alt kenar zemine (bake world boyutu)
    spr.position.set(-3.529, 0, -10.121);
    spr.scale.set(TEMPLE_2D_META.worldW, TEMPLE_2D_META.worldH, 1);
    spr.renderOrder = 2;
    root.add(spr);
    registerEditable(spr, {
      id: "builtin_temple",
      path: "asset_2d/buildings/moonlit_temple.png",
      group: "buildings",
      role: "decor",
      parent: "root",
    });
  }

  // Atmosfer peçesi yok — tek renk duvar gibi duruyordu

  function update(camX = 0) {
    // Parallax: katman kamera ile orantılı kayar → 2D’de derinlik
    far.position.x = camX * (1 - farFactor);
    mid.position.x = camX * (1 - midFactor);
    nearFx.position.x = camX * (1 - nearFactor);
    // Ay hafif ekstra kayma (gökyüzü)
    moon.position.x = -4 + camX * 0.04;
    // Yıldız küresi kamerayı takip — far yeterince büyük, kesilmesin
    sky.mesh.position.set(camX, 2.0, 0);

    const t = performance.now() * 0.001;
    for (const m of mistMeshes) {
      const { baseX, drift, phase } = m.userData;
      m.position.x = baseX + Math.sin(t * 0.22 + phase) * drift;
    }
  }

  return {
    update,
    getLayers: () => ({ root, mid, far }),
    getEditableProps: () => editableProps.slice(),
  };
}

/** ShipGame createSky — Kenney star stamp + gece gradient */
function createNightSky(loader) {
  const starTex = loader.load(`${BASE}/stars/star.png`);
  starTex.colorSpace = THREE.SRGBColorSpace;
  starTex.magFilter = THREE.LinearFilter;
  starTex.minFilter = THREE.LinearMipmapLinearFilter;
  starTex.wrapS = THREE.ClampToEdgeWrapping;
  starTex.wrapT = THREE.ClampToEdgeWrapping;
  starTex.generateMipmaps = true;

  const uniforms = {
    uDay: { value: 0 },
    uStar: { value: starTex },
    // Zenith + horizon yakın ton — mor “balon” bandı olmasın
    uZenithN: { value: new THREE.Color(0x05010c) },
    uHorizonN: { value: new THREE.Color(0x0a0614) },
    uZenithD: { value: new THREE.Color(0x4a5568) },
    uHorizonD: { value: new THREE.Color(0xb09a8c) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uDay;
      uniform sampler2D uStar;
      uniform vec3 uZenithN;
      uniform vec3 uHorizonN;
      uniform vec3 uZenithD;
      uniform vec3 uHorizonD;
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 zenith = mix(uZenithN, uZenithD, uDay);
        vec3 horizon = mix(uHorizonN, uHorizonD, uDay);
        float g = smoothstep(-0.05, 0.55, h);
        vec3 col = mix(horizon, zenith, g);
        float scale = 90.0;
        vec3 id = floor(dir * scale);
        float pick = hash13(id);
        float on = smoothstep(0.992, 0.997, pick);
        vec3 nrm = normalize((id + 0.5) / scale);
        vec3 upv = abs(nrm.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 tangent = normalize(cross(upv, nrm));
        vec3 bitangent = cross(nrm, tangent);
        vec2 uv = vec2(dot(dir - nrm, tangent), dot(dir - nrm, bitangent)) * scale + 0.5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec4 stamp = texture2D(uStar, clamp(uv, 0.0, 1.0));
        // Yıldızlar daha alçaktan da görünsün (mor bantta da)
        float sky = smoothstep(-0.02, 0.18, h) * (1.0 - uDay);
        col += stamp.rgb * stamp.a * on * inside * sky * 1.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // camera.far=400 — küre kesilmesin
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), material);
  mesh.name = "NightSkyStars";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

function loadColorMap(loader, url, repeat) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadDataMap(loader, url, repeat) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

/** Statik ENV mesh — IBL kapalı, gölge açık */
function prepareEnvMesh(root) {
  root.traverse((obj) => {
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

/**
 * Lane prop: scale + ground + optional rotate so long axis crosses Z.
 * @returns {THREE.Box3} world AABB after placement
 */
function placeLaneProp(model, opts) {
  const {
    x,
    z = 0,
    maxHeight = 2,
    maxDepth = 4,
    acrossLane = false,
    yaw = 0,
  } = opts;

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());

  // Uzun kenar şeridi çaprazlasın (Z) — koşu yönü X ince kalsın
  if (acrossLane && size.x > size.z * 1.15) {
    model.rotation.y = Math.PI / 2;
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    size = box.getSize(size);
  }

  model.rotation.y += yaw;

  let s = 1;
  if (size.y > 1e-4) s = Math.min(s, maxHeight / size.y);
  const spanZ = Math.max(size.z, 1e-4);
  const spanX = Math.max(size.x, 1e-4);
  if (acrossLane) {
    s = Math.min(s, maxDepth / spanZ);
  } else {
    s = Math.min(s, maxDepth / Math.max(spanX, spanZ));
  }
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);

  model.position.set(x, -box.min.y, z);
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model);
}

/** Scene1 vault collision — görsel ayrı ölçeklenmiş olsa da aynı hitbox */
function syncVaultBarrierFixed(barriers, x, height, thickness, editorId) {
  const b = barriers.find((e) => Math.abs(e.x - x) < 0.05 && !e.passUnder);
  if (!b) return;
  b.x = x;
  b.height = height;
  b.halfT = thickness / 2;
  if (editorId) b.editorId = editorId;
}

/** Scene1 limbo collision (clearance slider aynı API) */
function syncLimboBarrierFixed(
  limboBarrier,
  clearance = 1.5,
  thickness = 0.55,
  beamH = 0.28,
  editorId = null,
) {
  if (!limboBarrier) return;
  limboBarrier.halfT = thickness / 2;
  if (editorId) limboBarrier.editorId = editorId;
  if (typeof limboBarrier.setClearance === "function") {
    limboBarrier.setClearance(clearance);
  } else {
    limboBarrier.clearance = clearance;
    limboBarrier.height = clearance + beamH;
  }
}

/**
 * Scene1 engel kutusu boyutuna sığdır: height × thickness(X) × width(Z).
 */
function placeSizedLaneProp(model, { x, z = 0, height, thickness, width }) {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());

  // Uzun kenar Z (şerit eni), ince kenar X (koşu kalınlığı)
  if (size.x > size.z * 1.05) {
    model.rotation.y = Math.PI / 2;
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    size = box.getSize(size);
  }

  const sx = size.x > 1e-4 ? thickness / size.x : 1;
  const sy = size.y > 1e-4 ? height / size.y : 1;
  const sz = size.z > 1e-4 ? width / size.z : 1;
  model.scale.set(sx, sy, sz);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.set(x, -box.min.y, z);
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model);
}
