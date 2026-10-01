import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { addRopeAnchor } from "./ropeAnchors.js";
import { bakeBillboard, placeBillboard, billboardFromMap } from "./billboardBake.js";

const LAYER_ENV = 0;
const LAYER_CHAR = 1;

const BASE = "./public/scene2";
const ASSET_2D = "./public/asset_2d";
const TEMPLE_2D = `${ASSET_2D}/buildings/moonlit_temple`;
const TEMPLE_2D_META = {
  worldW: 14.796621180718667,
  worldH: 14.067144726514815,
};

/**
 * Scene 3 — Scene 2 layout’unun 2B dekor versiyonu.
 * Ağaç / ev / ot / bamboo = billboard; oynanabilir engel + fener + torii = 3D.
 * Scene 2 dosyasına dokunulmaz.
 *
 * @param {THREE.Object3D} root
 * @param {{
 *   onStaticReady?: () => void,
 *   renderer?: THREE.WebGLRenderer,
 *   barriers?: Array,
 *   limboBarrier?: object | null,
 * }} [opts]
 */
export function buildScenePack3(root, opts = {}) {
  const { onStaticReady, renderer, barriers = [], limboBarrier = null } = opts;
  const loader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const use2B = !!renderer;

  /** @type {Array<{ id: string, path: string, group: string, role: string, parent: string, object: THREE.Object3D }>} */
  const editableProps = [];
  function registerEditable(object, meta) {
    object.userData.editorId = meta.id;
    object.traverse((o) => {
      if (o.userData?.editorPickIgnore || o.userData?.billboardShadowCaster || o.userData?.billboardShadowBlob) {
        return;
      }
      o.userData.editorId = meta.id;
    });
    editableProps.push({
      id: meta.id,
      path: meta.path,
      group: meta.group,
      role: meta.role,
      parent: meta.parent || "root",
      object,
    });
  }

  let staticLeft = 10;
  function markStaticReady() {
    staticLeft -= 1;
    if (staticLeft <= 0) onStaticReady?.();
  }

  function loadStaticGlb(url, onOk) {
    gltfLoader.load(
      url,
      (gltf) => {
        Promise.resolve()
          .then(() => onOk(gltf.scene))
          .catch((err) => {
            console.warn("Scene3 place:", url, err);
          })
          .finally(() => {
            markStaticReady();
          });
      },
      undefined,
      (err) => {
        console.warn("Scene3 load:", url, err);
        markStaticReady();
      },
    );
  }

  function bakeOnce(src, bakeOpts = {}) {
    if (!use2B) return null;
    try {
      return bakeBillboard(renderer, src, bakeOpts);
    } catch (err) {
      console.warn("Scene3 bake:", err);
      return null;
    }
  }

  /** Bake’leri kare kare sıraya koy — cold start’ta main thread kilitlenmesin */
  let bakeTail = Promise.resolve();
  function bakeQueued(src, bakeOpts = {}) {
    if (!use2B) return Promise.resolve(null);
    const job = bakeTail.then(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve(bakeOnce(src, bakeOpts));
          });
        }),
    );
    bakeTail = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  /** 3D fallback: sprite absolute scale GLB’ye basılmasın — hedef yüksekliğe göre */
  function fitHeight(model, targetH, targetW = null) {
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(0.05, size.y);
    const sy = targetH / h;
    if (targetW != null && size.x > 0.05) {
      const sx = targetW / size.x;
      model.scale.set(sx, sy, (sx + sy) * 0.5);
    } else {
      model.scale.set(sy, sy, sy);
    }
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
  }

  /** Root 2B — sadece Y, çok hafif dönüş (karton kenarı; kameraya yapışmasın) */
  const yBillboards = [];
  const Y_BILLBOARD_AMOUNT = 0.08;
  const Y_BILLBOARD_MAX = 0.08;
  const CAM_Z = 20;

  /**
   * Sprite gölge atmaz — alpha silüetli dik plane + zemin blob.
   * castShadow plane, bakeEnvShadows ile statik gölgeye girer.
   */
  function attachBillboardShadow(spr, map, parent, opts = {}) {
    if (!spr || !map) return;
    const alphaTest = opts.alphaTest ?? 0.35;
    const w = spr.scale.x;
    const h = spr.scale.y;
    if (!(w > 0.15 && h > 0.15)) return;

    const invis = new THREE.MeshBasicMaterial({
      map,
      alphaTest,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide,
    });
    const caster = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), invis);
    // Sprite: alt kenar merkez → 0.5; Mesh plane: geometri merkez → 0
    caster.position.set(0, spr.isSprite ? 0.5 : 0, 0);
    caster.castShadow = true;
    caster.receiveShadow = false;
    caster.frustumCulled = false;
    caster.customDepthMaterial = new THREE.MeshDepthMaterial({
      map,
      alphaTest: Math.max(0.42, alphaTest),
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    caster.userData.billboardShadowCaster = true;
    caster.userData.editorPickIgnore = true;
    caster.raycast = () => {};
    spr.add(caster);

    // Mid/far: sadece bake caster (yuvarlak blob parallax ile kayıyordu)
    if (opts.skipBlob) return;

    // Yumuşak temas gölgesi (bake yumuşak kalsa bile okunur)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({
        color: 0x050208,
        transparent: true,
        opacity: opts.blobOpacity ?? 0.32,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(spr.position.x, 0.03, spr.position.z + w * 0.02);
    blob.scale.set(w * 0.34, h * 0.1, 1);
    blob.renderOrder = 1;
    blob.castShadow = false;
    blob.receiveShadow = false;
    blob.userData.billboardShadowBlob = true;
    blob.userData.editorPickIgnore = true;
    blob.raycast = () => {};
    parent.add(blob);
    spr.userData.shadowBlob = blob;
    spr.userData.syncShadowBlob = () => {
      if (!blob.parent) return;
      blob.position.set(spr.position.x, 0.03, spr.position.z + spr.scale.x * 0.02);
      blob.scale.set(spr.scale.x * 0.34, spr.scale.y * 0.1, 1);
    };
  }

  function spawnGrounded(bake, parent, p, sink = 0.1) {
    const scale = p.scale ?? 1;
    const mat = bake.sprite.material.clone();
    if (p.tint != null) mat.color.set(p.tint);
    if (p.fog === false) mat.fog = false;

    // mid/far + binalar: sabit. root foliage: sadece Y, çok hafif
    const layer = p.parentLayer || "root";
    const fixedFacing =
      p.fixedFacing === true ||
      layer === "mid" ||
      layer === "far" ||
      p.group === "buildings" ||
      p.yBillboard === false;
    const yBillboard = !fixedFacing && p.yBillboard !== false;

    let w;
    let h;
    let yBase;
    if (Array.isArray(scale)) {
      const abs =
        p.absoluteScale === true ||
        Math.max(Math.abs(scale[0]), Math.abs(scale[1])) > 2.5;
      if (abs) {
        w = scale[0];
        h = scale[1];
        yBase = p.y ?? 0;
      } else {
        w = bake.worldW * scale[0];
        h = bake.worldH * scale[1];
        yBase = (p.y ?? 0) - h * sink;
      }
    } else {
      w = bake.worldW * scale;
      h = bake.worldH * scale;
      yBase = (p.y ?? 0) - h * sink;
    }

    let obj;
    if (fixedFacing || yBillboard) {
      const meshMat = new THREE.MeshBasicMaterial({
        map: mat.map,
        color: mat.color.clone(),
        transparent: true,
        alphaTest: mat.alphaTest ?? 0.12,
        depthWrite: false,
        fog: mat.fog,
        side: THREE.DoubleSide,
      });
      obj = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), meshMat);
      obj.position.set(p.x, yBase + h * 0.5, p.z);
      obj.scale.set(w, h, 1);
      if (fixedFacing) {
        obj.userData.fixedFacing = true;
      } else {
        obj.userData.yBillboard = true;
        yBillboards.push(obj);
      }
    } else {
      obj = new THREE.Sprite(mat);
      obj.center.set(0.5, 0);
      obj.scale.set(w, h, 1);
      obj.position.set(p.x, yBase, p.z);
      obj.userData.billboard = true;
    }
    obj.userData.worldH = bake.worldH;
    obj.userData.worldW = bake.worldW;
    obj.castShadow = false;
    obj.receiveShadow = false;
    obj.renderOrder =
      p.renderOrder ?? (layer === "mid" ? 2.15 : layer === "far" ? 1.3 : 2.85);
    parent.add(obj);

    const wantShadow =
      layer !== "far" &&
      (p.castEnvShadow === true ||
        p.group === "trees" ||
        p.group === "buildings" ||
        p.group === "foliage" ||
        p.group === "jump" ||
        p.group === "auto_jump");
    if (wantShadow && bake.map) {
      const isTree = p.group === "trees";
      const isFoliage = p.group === "foliage";
      attachBillboardShadow(obj, bake.map, parent, {
        alphaTest: isTree ? 0.28 : isFoliage ? 0.32 : 0.4,
        blobOpacity: isTree ? 0.34 : isFoliage ? 0.26 : 0.22,
        skipBlob: layer === "mid",
      });
    }

    if (p.id && p.path) {
      registerEditable(obj, {
        id: p.id,
        path: p.path,
        group: p.group || "decor",
        role: p.role || "decor",
        parent: layer,
      });
    }
    return obj;
  }

  // Scene2 ile aynı parallax
  const far = new THREE.Group();
  const mid = new THREE.Group();
  const nearFx = new THREE.Group();
  root.add(far, mid, nearFx);
  const farFactor = 0.12;
  const midFactor = 0.42;
  const nearFactor = 0.78;

  // --- Zemin (Scene2) ---
  const cobbleDiff = loadColorMap(loader, `${BASE}/ground/cobble_diff.jpg`, [10, 2.4]);
  const cobbleNor = loadDataMap(loader, `${BASE}/ground/cobble_nor.jpg`, [10, 2.4]);
  const cobbleRough = loadDataMap(loader, `${BASE}/ground/cobble_rough.jpg`, [10, 2.4]);
  const plankDiff = loadColorMap(loader, `${BASE}/wood/planks_diff.jpg`, [14, 1.2]);
  const plankNor = loadDataMap(loader, `${BASE}/wood/planks_nor.jpg`, [14, 1.2]);
  const plankRough = loadDataMap(loader, `${BASE}/wood/planks_rough.jpg`, [14, 1.2]);

  // Ana cobble — mid derinliğine kadar uzat (z ≈ +2.8 … −12)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 15),
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
  ground.position.z = -4.6;
  ground.receiveShadow = true;
  root.add(ground);

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

  // Mid / far dekor zemini — ana cobble (z≈-7.2 arkası) ile örtüşmesin (z-fight = parlama)
  // Unlit: gece ışığında Specular/normal titremesi olmasın
  // Mid dekor zemini — ana cobble (z≈-7.2 arkası) ile örtüşmesin (z-fight = parlama)
  // Unlit: gece ışığında Specular/normal titremesi olmasın
  // Nötr gri (texture/kırmızı yok)
  const midGround = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 5),
    new THREE.MeshBasicMaterial({
      color: 0x2a3038,
      fog: true,
    }),
  );
  midGround.rotation.x = -Math.PI / 2;
  midGround.position.set(0, -0.04, -9.6);
  mid.add(midGround);

  const farGround = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 7),
    new THREE.MeshBasicMaterial({
      color: 0x1a1e24,
      transparent: true,
      opacity: 0.9,
      fog: true,
      depthWrite: false,
    }),
  );
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.set(0, -0.06, -14.5);
  far.add(farGround);

  // --- Gökyüzü / ay (mor-pembe palet) ---
  const sky = createNightSky(loader);
  root.add(sky.mesh);

  const moonTex = loader.load(`${BASE}/moon/full-moon.png`);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  // Texture turuncu; G’yi bastırıp B’yi yükselt → Scene3 mor palet
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: moonTex,
      color: 0xc878ff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      opacity: 0.92,
    }),
  );
  moon.scale.set(9.2, 9.2, 1);
  moon.position.set(-4, 12.4, -22);
  moon.renderOrder = -2;
  far.add(moon);

  const mistMaps = ["mist-a", "mist-b", "mist-c"].map((n) => {
    const t = loader.load(`${BASE}/fog/${n}.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const mistMeshes = [];
  function addMist(parent, specs) {
    for (const s of specs) {
      const w = s.w ?? 46;
      const h = s.h ?? 5.5;
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
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.ry ?? 0;
      mesh.renderOrder = s.order ?? 2;
      mesh.frustumCulled = false;
      mesh.userData.baseX = s.x;
      mesh.userData.drift = s.drift ?? 0.35;
      mesh.userData.phase = s.phase ?? Math.random() * Math.PI * 2;
      parent.add(mesh);
      mistMeshes.push(mesh);
    }
  }
  addMist(far, [
    // Arka peçe duvarı — mid sonrası boşluğu kapat
    { x: -40, y: 3.2, z: -18.5, map: 0, op: 0.72, ry: 0.04, order: 1, w: 80, h: 26, drift: 0.28, phase: 0.1 },
    { x: -12, y: 3.2, z: -19.2, map: 1, op: 0.74, ry: -0.03, order: 1, w: 80, h: 26, drift: 0.26, phase: 0.7 },
    { x: 14, y: 3.1, z: -19.8, map: 2, op: 0.72, ry: 0.03, order: 1, w: 80, h: 26, drift: 0.25, phase: 1.3 },
    { x: 40, y: 2.8, z: -20.4, map: 0, op: 0.7, ry: -0.04, order: 1, w: 78, h: 25, drift: 0.24, phase: 1.9 },
    { x: 65, y: 2.8, z: -21.0, map: 1, op: 0.68, ry: 0.04, order: 1, w: 75, h: 24, drift: 0.22, phase: 2.5 },
    // İkinci sıra — daha yoğun / biraz önde (mid→far geçiş)
    { x: -28, y: 2.6, z: -16.2, map: 2, op: 0.48, ry: -0.02, order: 1.2, w: 70, h: 18, drift: 0.3, phase: 0.4 },
    { x: 0, y: 2.7, z: -16.8, map: 0, op: 0.5, ry: 0.03, order: 1.2, w: 72, h: 18, drift: 0.28, phase: 1.0 },
    { x: 28, y: 2.5, z: -17.2, map: 1, op: 0.48, ry: -0.03, order: 1.2, w: 70, h: 17, drift: 0.27, phase: 1.8 },
    { x: 52, y: 2.4, z: -17.6, map: 2, op: 0.46, ry: 0.02, order: 1.2, w: 68, h: 17, drift: 0.26, phase: 2.4 },
  ]);
  addMist(mid, [
    // Mid peçe — renderOrder < root (2.8+) ki root sisin arkasında kalmasın
    { x: -10, y: 2.5, z: -9.5, map: 2, op: 0.7, ry: -0.04, order: 1.55, w: 58, h: 9.5, drift: 0.4, phase: 0.4 },
    { x: 8, y: 2.6, z: -10.0, map: 1, op: 0.72, ry: 0.05, order: 1.55, w: 60, h: 9.6, drift: 0.38, phase: 1.1 },
    { x: 26, y: 2.4, z: -10.8, map: 0, op: 0.7, ry: -0.05, order: 1.55, w: 58, h: 9.2, drift: 0.36, phase: 2.2 },
    { x: 42, y: 2.3, z: -11.4, map: 2, op: 0.68, ry: 0.04, order: 1.55, w: 55, h: 9, drift: 0.34, phase: 3.0 },
    { x: -22, y: 2.2, z: -11.8, map: 0, op: 0.62, ry: 0.03, order: 1.55, w: 52, h: 8.5, drift: 0.35, phase: 0.8 },
    { x: 16, y: 2.3, z: -12.2, map: 1, op: 0.65, ry: -0.03, order: 1.55, w: 54, h: 8.6, drift: 0.33, phase: 2.6 },
    // Mid içi — root’un altında kalsın
    { x: -16, y: 2.0, z: -8.6, map: 1, op: 0.36, ry: 0.02, order: 1.65, w: 48, h: 7.2, drift: 0.42, phase: 0.2 },
    { x: -2, y: 2.1, z: -8.9, map: 0, op: 0.34, ry: -0.03, order: 1.65, w: 46, h: 7, drift: 0.4, phase: 1.4 },
    { x: 12, y: 2.0, z: -8.4, map: 2, op: 0.36, ry: 0.04, order: 1.65, w: 48, h: 7.2, drift: 0.38, phase: 2.0 },
    { x: 30, y: 1.9, z: -9.0, map: 1, op: 0.34, ry: -0.02, order: 1.65, w: 46, h: 6.8, drift: 0.36, phase: 2.8 },
  ]);
  addMist(nearFx, [
    { x: 8, y: 1.4, z: 3.0, map: 1, op: 0.08, ry: 0.03, order: 4, w: 38, h: 3.2, drift: 0.55, phase: 0.9 },
  ]);

  // --- Sakura 2B — yola yakın ~29.8×18.7 (kullanıcı kanonik); z ile hafif perspektif ---
  // Ref: s3_sakura_0 @ z≈-3.373
  const SAKURA_REF = { w: 29.839, h: 18.722, z: -3.373 };
  const SAKURA_CAM_Z = 20;
  function sakuraScaleAt(z) {
    const refD = SAKURA_CAM_Z - SAKURA_REF.z;
    const d = Math.max(4, SAKURA_CAM_Z - z);
    const f = refD / d;
    return [
      +(SAKURA_REF.w * f).toFixed(3),
      +(SAKURA_REF.h * f).toFixed(3),
      1,
    ];
  }
  const sakuraPlacements = [
    {
      id: "s3_sakura_0",
      position: [-10.904, -0.221, -3.373],
      rotation: [0, 0, 0],
      scale: [29.839, 18.722, 1],
      // pack SakuraA — soğuk pembe
      kind: "pack",
      packIndex: 0,
      tint: 0xe4ecff,
    },
    {
      id: "s3_sakura_1",
      position: [2.5, -0.221, -3.6],
      rotation: [0, 0, 0],
      scale: sakuraScaleAt(-3.6),
      // mor yapraklı ayrı GLB
      kind: "purple",
      tint: 0xffffff,
    },
    {
      id: "s3_sakura_2",
      position: [14.616, -0.221, -3.9],
      rotation: [0, 0, 0],
      scale: sakuraScaleAt(-3.9),
      kind: "pack",
      packIndex: 1,
      tint: 0xffe6d8,
    },
    {
      id: "s3_sakura_3",
      position: [26.603, -0.221, -3.5],
      rotation: [0, 0, 0],
      scale: sakuraScaleAt(-3.5),
      kind: "purple",
      tint: 0xffe8f4,
    },
  ];

  function loadGltf(url) {
    return new Promise((resolve, reject) => {
      gltfLoader.load(url, resolve, undefined, reject);
    });
  }

  (async () => {
    try {
      const [packGltf, purpleGltf] = await Promise.all([
        loadGltf(`${BASE}/trees/sakura.glb`),
        loadGltf(`${BASE}/trees/sakura_tree_1001152836.glb`),
      ]);

      const packVariants = [];
      packGltf.scene.traverse((obj) => {
        if (/^Sakura[ABC]$/.test(obj.name)) packVariants.push(obj);
      });
      packVariants.sort((a, b) => a.name.localeCompare(b.name));
      if (!packVariants.length) packVariants.push(packGltf.scene);

      const packBakes = [];
      for (let i = 0; i < packVariants.length; i++) {
        const styled = packVariants[i].clone(true);
        styleSakura(styled, 0xffffff);
        packBakes.push(
          await bakeQueued(styled, {
            size: 1536,
            yaw: i * 0.35,
            alphaTest: 0.12,
            lighting: "night",
          }),
        );
      }

      const purpleSrc = purpleGltf.scene.clone(true);
      styleTexturedTree(purpleSrc);
      const purpleBake = await bakeQueued(purpleSrc, {
        size: 1536,
        yaw: 0.2,
        alphaTest: 0.12,
        lighting: "night",
      });

      for (let i = 0; i < sakuraPlacements.length; i++) {
        const p = sakuraPlacements[i];
        const isPurple = p.kind === "purple";
        const bake = isPurple
          ? purpleBake
          : packBakes[(p.packIndex ?? i) % packBakes.length];
        const path = isPurple
          ? "trees/sakura_tree_1001152836.glb"
          : "trees/sakura.glb";
        if (bake) {
          const spr = spawnGrounded(
            bake,
            root,
            {
              id: p.id,
              path,
              group: "trees",
              role: "decor",
              parentLayer: "root",
              x: p.position[0],
              y: p.position[1],
              z: p.position[2],
              scale: p.scale,
              tint: p.tint,
              absoluteScale: true,
              renderOrder: 3,
            },
            0.1,
          );
          const sprH = spr?.scale.y ?? p.scale[1];
          const sprW = spr?.scale.x ?? p.scale[0];
          addRopeAnchor({
            x: p.position[0],
            halfW: Math.max(1.2, sprW * 0.5),
            topY: Math.max(sprH * 0.9, 2.5),
            z: 0,
          });
          void spr;
        } else {
          const src = isPurple
            ? purpleGltf.scene
            : packVariants[(p.packIndex ?? i) % packVariants.length];
          const tree = src.clone(true);
          if (isPurple) styleTexturedTree(tree);
          else styleSakura(tree, p.tint);
          tree.position.set(p.position[0], 0, p.position[2]);
          tree.rotation.set(
            THREE.MathUtils.degToRad(p.rotation[0]),
            THREE.MathUtils.degToRad(p.rotation[1]),
            THREE.MathUtils.degToRad(p.rotation[2]),
          );
          fitHeight(tree, p.scale[1], p.scale[0]);
          tree.position.y += p.position[1];
          root.add(tree);
          tree.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(tree);
          addRopeAnchor({
            x: p.position[0],
            halfW: Math.max(1.4, (box.max.x - box.min.x) * 0.5),
            topY: Math.max(box.max.y, 2.5),
            z: 0,
          });
          registerEditable(tree, {
            id: p.id,
            path,
            group: "trees",
            role: "decor",
            parent: "root",
          });
        }
      }

      // Mid — küçük sakura serpiştirme (parallax dolgu)
      const midTrees = [
        {
          id: "s3_sakura_m0",
          bake: purpleBake,
          path: "trees/sakura_tree_1001152836.glb",
          x: -16.5,
          y: -0.2,
          z: -9.0,
          scale: [14.5, 9.2, 1],
          tint: 0xe8d0e8,
        },
        {
          id: "s3_sakura_m1",
          bake: packBakes[0] || purpleBake,
          path: "trees/sakura.glb",
          x: 7.0,
          y: -0.2,
          z: -9.6,
          scale: [13.2, 8.4, 1],
          tint: 0xd8e0f0,
        },
        {
          id: "s3_sakura_m2",
          bake: purpleBake || packBakes[1],
          path: "trees/sakura_tree_1001152836.glb",
          x: 22.5,
          y: -0.2,
          z: -8.8,
          scale: [15.0, 9.5, 1],
          tint: 0xffe8f4,
        },
      ];
      for (const t of midTrees) {
        if (!t.bake) continue;
        spawnGrounded(
          t.bake,
          mid,
          {
            id: t.id,
            path: t.path,
            group: "trees",
            role: "decor",
            parentLayer: "mid",
            x: t.x,
            y: t.y,
            z: t.z,
            scale: t.scale,
            tint: t.tint,
            absoluteScale: true,
            castEnvShadow: false,
            renderOrder: 2.3,
          },
          0,
        );
      }
    } catch (err) {
      console.warn("Scene3 sakura:", err);
    } finally {
      markStaticReady();
    }
  })();

  // --- Fenerler 3D (Scene2) ---
  // Kamera tarafı: yola bakan açı; yol mesafesi |z|=2.00; X serbest
  // Boy: Y uzatıldı (kısa / yere yapışık durmasın)
  const LANTERN_NEAR = {
    y: -0.035,
    z: 2.0,
    rotation: [0, 88.558, 0],
    scale: [0.82, 1.55, 0.82],
  };
  const lanternSpecs = [
    {
      id: "s3_lantern_0",
      color: 0xff4fa3,
      position: [-5, LANTERN_NEAR.y, LANTERN_NEAR.z],
      rotation: [...LANTERN_NEAR.rotation],
      scale: [...LANTERN_NEAR.scale],
    },
    {
      id: "s3_lantern_1",
      color: 0xff4fa3,
      position: [7.556, -0.005, -2.0],
      rotation: [-180, -88.624, -180],
      scale: [0.82, 1.55, 0.82],
    },
    {
      id: "s3_lantern_2",
      color: 0xff4fa3,
      position: [16, LANTERN_NEAR.y, LANTERN_NEAR.z],
      rotation: [...LANTERN_NEAR.rotation],
      scale: [...LANTERN_NEAR.scale],
    },
    {
      id: "s3_lantern_3",
      color: 0xff4fa3,
      position: [25.5, LANTERN_NEAR.y, LANTERN_NEAR.z],
      rotation: [...LANTERN_NEAR.rotation],
      scale: [...LANTERN_NEAR.scale],
    },
  ];
  gltfLoader.load(
    `${BASE}/lantern/bamboo_lantern.glb`,
    (gltf) => {
      for (const spec of lanternSpecs) {
        const model = gltf.scene.clone(true);
        prepareEnvMesh(model);
        // Ay/env ışığı feneri yıkamasın — unlit + kağıt rengi
        tintLanternUnlit(model, spec.color);
        model.position.set(...spec.position);
        model.rotation.set(
          THREE.MathUtils.degToRad(spec.rotation[0]),
          THREE.MathUtils.degToRad(spec.rotation[1]),
          THREE.MathUtils.degToRad(spec.rotation[2]),
        );
        model.scale.set(...spec.scale);
        // Mor glow: geniş yer aydınlatması (yüksek + uzun menzil + yumuşak decay)
        const glow = new THREE.PointLight(spec.color, 4.8, 32, 0.85);
        glow.castShadow = false;
        glow.layers.set(LAYER_ENV);
        glow.layers.enable(LAYER_CHAR);
        model.add(glow);
        model.updateMatrixWorld(true);
        const laneAim = new THREE.Vector3(
          spec.position[0],
          Math.max(1.8, spec.position[1] + 2.1),
          THREE.MathUtils.lerp(spec.position[2], 0.15, 0.88),
        );
        model.worldToLocal(laneAim);
        glow.position.copy(laneAim);
        root.add(model);
        registerEditable(model, {
          id: spec.id,
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
      console.warn("Scene3 lantern:", err);
      markStaticReady();
    },
  );

  // --- Oynanabilir engeller 3D — görsel + barrier aynı X (Scene2 ile aynı)
  loadStaticGlb(`${BASE}/props/auto_jump/Rustic_Wooden_Fence.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    model.position.set(1.6, 0.589, 0);
    model.rotation.set(0, THREE.MathUtils.degToRad(90), 0);
    model.scale.set(2.944, 1.101, 2.735);
    root.add(model);
    syncVaultBarrierFixed(barriers, 1.6, 0.72, 0.45, "s3_fence");
    registerEditable(model, {
      id: "s3_fence",
      path: "props/auto_jump/Rustic_Wooden_Fence.glb",
      group: "auto_jump",
      role: "vault",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/props/jump/Stone_Formation.glb`, async (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    model.position.set(9.624, 0.461, 0.043);
    model.rotation.set(0, 0, 0);
    model.scale.set(0.629, 1.25, 2.425);
    root.add(model);
    // Scene1 hitbox 6.5’te kalıyordu → görsel X’e çek
    syncVaultBarrierFixed(barriers, 6.5, 0.68, 0.45, "s3_stone");
    const stoneB = barriers.find((e) => e.editorId === "s3_stone");
    if (stoneB) stoneB.x = 9.624;
    registerEditable(model, {
      id: "s3_stone",
      path: "props/jump/Stone_Formation.glb",
      group: "jump",
      role: "vault",
      parent: "root",
    });

    // Mid — 2B taş serpiştirme
    const stoneBake = await bakeQueued(src, {
      size: 640,
      lighting: "night",
      yaw: THREE.MathUtils.degToRad(18),
      alphaTest: 0.15,
    });
    if (stoneBake) {
      const midStones = [
        { id: "s3_mid_stone_0", x: -12.5, y: -0.04, z: -8.4, scale: [2.4, 1.55, 1] },
        { id: "s3_mid_stone_1", x: -1.2, y: -0.04, z: -9.6, scale: [1.9, 1.25, 1] },
        { id: "s3_mid_stone_2", x: 8.8, y: -0.04, z: -8.7, scale: [2.6, 1.7, 1] },
        { id: "s3_mid_stone_3", x: 19.4, y: -0.04, z: -9.9, scale: [2.1, 1.35, 1] },
        { id: "s3_mid_stone_4", x: 29.0, y: -0.04, z: -8.5, scale: [2.3, 1.5, 1] },
      ];
      for (const s of midStones) {
        spawnGrounded(
          stoneBake,
          mid,
          {
            id: s.id,
            path: "props/jump/Stone_Formation.glb",
            group: "jump",
            role: "decor",
            parentLayer: "mid",
            x: s.x,
            y: s.y,
            z: s.z,
            scale: s.scale,
            tint: 0x7a8490,
            absoluteScale: true,
            castEnvShadow: false,
            renderOrder: 2.15,
          },
          0,
        );
      }
    }
  });

  // Mid rock clusters (2B)
  loadStaticGlb(
    `${BASE}/props/auto_jump/Rock_Formation_1001.glb`,
    async (src) => {
      const bake = await bakeQueued(src, {
        size: 640,
        lighting: "night",
        yaw: THREE.MathUtils.degToRad(-25),
        alphaTest: 0.15,
      });
      if (!bake) return;
      const rocks = [
        { id: "s3_mid_rock_0", x: -18.5, y: -0.04, z: -9.2, scale: [2.8, 2.1, 1] },
        { id: "s3_mid_rock_1", x: 2.6, y: -0.04, z: -8.3, scale: [2.2, 1.7, 1] },
        { id: "s3_mid_rock_2", x: 12.4, y: -0.04, z: -9.7, scale: [2.5, 1.9, 1] },
        { id: "s3_mid_rock_3", x: 36.0, y: -0.04, z: -8.8, scale: [2.6, 2.0, 1] },
      ];
      for (const s of rocks) {
        spawnGrounded(
          bake,
          mid,
          {
            id: s.id,
            path: "props/auto_jump/Rock_Formation_1001.glb",
            group: "auto_jump",
            role: "decor",
            parentLayer: "mid",
            x: s.x,
            y: s.y,
            z: s.z,
            scale: s.scale,
            tint: 0x6e7884,
            absoluteScale: true,
            castEnvShadow: false,
            renderOrder: 2.1,
          },
          0,
        );
      }
    },
  );

  // Limbo kemeri — kanonik pose (boy/rotate/scale/y-z); lane X sahneye göre
  const S3_ARCH = {
    x: 23.399,
    y: 1.257,
    z: 0.333,
    rotY: 90,
    scale: [2.898, 3.726, 2.989],
  };
  loadStaticGlb(`${BASE}/props/slide_croch/Stone_Archway_Bridge.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    model.position.set(S3_ARCH.x, S3_ARCH.y, S3_ARCH.z);
    model.rotation.set(0, THREE.MathUtils.degToRad(S3_ARCH.rotY), 0);
    model.scale.set(...S3_ARCH.scale);
    root.add(model);
    model.updateMatrixWorld(true);
    const archBox = new THREE.Box3().setFromObject(model);
    const archHalfT = Math.max(0.4, (archBox.max.x - archBox.min.x) * 0.5);
    const archX = (archBox.min.x + archBox.max.x) * 0.5;
    syncLimboBarrierFixed(limboBarrier, 1.5, archHalfT * 2, 0.28, "s3_arch");
    if (limboBarrier) limboBarrier.x = archX;
    registerEditable(model, {
      id: "s3_arch",
      path: "props/slide_croch/Stone_Archway_Bridge.glb",
      group: "slide_croch",
      role: "limbo",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/props/climb/Knotted_Ladder_1001153335.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    model.position.set(13.2, 0.95, -1.55);
    model.rotation.set(0, THREE.MathUtils.degToRad(8.594), 0);
    model.scale.set(1, 1, 1);
    root.add(model);
    registerEditable(model, {
      id: "s3_ladder",
      path: "props/climb/Knotted_Ladder_1001153335.glb",
      group: "climb",
      role: "climbVisual",
      parent: "root",
    });
  });

  loadStaticGlb(`${BASE}/zones/tori_gate.glb`, (src) => {
    const model = src.clone(true);
    prepareEnvMesh(model);
    model.position.set(32, 3.746, -0.09);
    model.rotation.set(0, THREE.MathUtils.degToRad(88.329), 0);
    model.scale.set(4.257, 4.105, 4.769);
    root.add(model);
    registerEditable(model, {
      id: "s3_torii",
      path: "zones/tori_gate.glb",
      group: "zones",
      role: "zone",
      parent: "root",
    });
  });

  // --- Bamboo 2B (root + mid serpiştirme) ---
  loadStaticGlb(
    `${BASE}/foliage/Bamboo_Serenity_1001153856_texture.glb`,
    async (src) => {
      const spots = [
        {
          id: "s3_bamboo_0",
          parent: root,
          parentLayer: "root",
          position: [10.5, -0.04, -6.5],
          scale: [3.2, 7.2, 1],
          yaw: 22.918,
        },
        {
          id: "s3_bamboo_1",
          parent: root,
          parentLayer: "root",
          position: [-23.325, -0.03, -5.4],
          scale: [3.6, 6.4, 1],
          yaw: 0,
        },
        // Mid — boş gövdeyi doldur (parallax mid grubu)
        {
          id: "s3_bamboo_m0",
          parent: mid,
          parentLayer: "mid",
          position: [-14, -0.05, -8.8],
          scale: [2.4, 5.6, 1],
          yaw: 18,
        },
        {
          id: "s3_bamboo_m1",
          parent: mid,
          parentLayer: "mid",
          position: [-4.5, -0.05, -9.4],
          scale: [2.1, 5.1, 1],
          yaw: -12,
        },
        {
          id: "s3_bamboo_m2",
          parent: mid,
          parentLayer: "mid",
          position: [5.2, -0.05, -8.6],
          scale: [2.6, 5.9, 1],
          yaw: 28,
        },
        {
          id: "s3_bamboo_m3",
          parent: mid,
          parentLayer: "mid",
          position: [15.8, -0.05, -9.8],
          scale: [2.2, 5.3, 1],
          yaw: -6,
        },
        {
          id: "s3_bamboo_m4",
          parent: mid,
          parentLayer: "mid",
          position: [24.5, -0.05, -8.9],
          scale: [2.5, 5.7, 1],
          yaw: 14,
        },
        {
          id: "s3_bamboo_m5",
          parent: mid,
          parentLayer: "mid",
          position: [33.2, -0.05, -9.5],
          scale: [2.0, 4.8, 1],
          yaw: -22,
        },
      ];
      const bake = await bakeQueued(src, {
        size: 1024,
        yaw: THREE.MathUtils.degToRad(12),
        lighting: "night",
      });
      for (const s of spots) {
        if (bake) {
          spawnGrounded(
            bake,
            s.parent,
            {
              id: s.id,
              path: "foliage/Bamboo_Serenity_1001153856_texture.glb",
              group: "foliage",
              role: "decor",
              parentLayer: s.parentLayer,
              x: s.position[0],
              y: s.position[1],
              z: s.position[2],
              scale: s.scale,
              tint: s.parentLayer === "mid" ? 0x8a96a4 : 0xa8b4c4,
              absoluteScale: true,
              castEnvShadow: s.parentLayer === "root",
              renderOrder: s.parentLayer === "mid" ? 2.2 : 2.85,
            },
            0,
          );
        } else {
          const model = src.clone(true);
          prepareEnvMesh(model);
          model.position.set(s.position[0], 0, s.position[2]);
          model.rotation.y = THREE.MathUtils.degToRad(s.yaw);
          fitHeight(model, s.scale[1], s.scale[0]);
          model.position.y += s.position[1];
          s.parent.add(model);
          registerEditable(model, {
            id: s.id,
            path: "foliage/Bamboo_Serenity_1001153856_texture.glb",
            group: "foliage",
            role: "decor",
            parent: s.parentLayer,
          });
        }
      }
    },
  );

  // --- Grass 2B — absolute scale; y≈0 (sprite alt kenar zemin, havada kalmasın) ---
  // s3_grass_2 kümesi: kullanıcı pozisyonu; max scale [2.35, 2.9] — diğerleri daha küçük + farklı bake yaw
  loadStaticGlb(`${BASE}/foliage/Tall_Meadow_Grass.glb`, async (src) => {
    const spots = [
      { id: "s3_grass_0", parent: root, parentLayer: "root", position: [-2, -0.04, -5.2], scale: [2.05, 3.25, 1], yaw: 0, tint: 0x9aa8b8 },
      { id: "s3_grass_1", parent: root, parentLayer: "root", position: [18, -0.04, -5.8], scale: [2.15, 3.4, 1], yaw: 32, tint: 0x8f9eae },
      // Ana ot (en büyük) + etrafında daha küçük / farklı açı
      { id: "s3_grass_2", parent: root, parentLayer: "root", position: [-18.37, -0.042, 2.779], scale: [2.35, 2.9, 1], yaw: 0, tint: 0xa3b0be },
      { id: "s3_grass_2b", parent: root, parentLayer: "root", position: [-17.52, -0.042, 2.42], scale: [1.95, 2.4, 1], yaw: 32, tint: 0x96a4b4 },
      { id: "s3_grass_2c", parent: root, parentLayer: "root", position: [-19.18, -0.042, 3.08], scale: [1.68, 2.12, 1], yaw: -28, tint: 0x8f9eae },
      { id: "s3_grass_2d", parent: root, parentLayer: "root", position: [-17.95, -0.042, 3.32], scale: [2.12, 2.62, 1], yaw: 32, tint: 0xa8b4c2 },
      { id: "s3_grass_2e", parent: root, parentLayer: "root", position: [-19.05, -0.042, 2.18], scale: [1.48, 1.88, 1], yaw: -28, tint: 0x9aa8b8 },
      { id: "s3_grass_2f", parent: root, parentLayer: "root", position: [-18.7, -0.042, 2.95], scale: [1.82, 2.28, 1], yaw: -28, tint: 0x92a0b0 },
      // Mid ot — boşluğu doldur
      { id: "s3_grass_m0", parent: mid, parentLayer: "mid", position: [-9.5, -0.05, -8.5], scale: [1.7, 2.4, 1], yaw: 0, tint: 0x7e8a96 },
      { id: "s3_grass_m1", parent: mid, parentLayer: "mid", position: [0.8, -0.05, -9.3], scale: [1.55, 2.2, 1], yaw: 32, tint: 0x74808c },
      { id: "s3_grass_m2", parent: mid, parentLayer: "mid", position: [11.2, -0.05, -8.7], scale: [1.8, 2.5, 1], yaw: -28, tint: 0x82909c },
      { id: "s3_grass_m3", parent: mid, parentLayer: "mid", position: [21.5, -0.05, -9.5], scale: [1.6, 2.25, 1], yaw: 32, tint: 0x788490 },
      { id: "s3_grass_m4", parent: mid, parentLayer: "mid", position: [31.8, -0.05, -8.6], scale: [1.75, 2.35, 1], yaw: -28, tint: 0x7a8692 },
    ];
    // Sadece 3 yaw bake — çeşitlilik yeterli, cold-start maliyeti düşük
    const bakeByYaw = new Map();
    const bakeYaw = async (deg) => {
      const k = Math.round(deg);
      if (!bakeByYaw.has(k)) {
        bakeByYaw.set(
          k,
          bakeQueued(src, {
            size: 768,
            alphaTest: 0.22,
            lighting: "night",
            yaw: THREE.MathUtils.degToRad(deg),
          }),
        );
      }
      return bakeByYaw.get(k);
    };
    for (const s of spots) {
      const bake = await bakeYaw(s.yaw ?? 0);
      if (bake) {
        spawnGrounded(
          bake,
          s.parent,
          {
            id: s.id,
            path: "foliage/Tall_Meadow_Grass.glb",
            group: "foliage",
            role: "decor",
            parentLayer: s.parentLayer,
            x: s.position[0],
            y: s.position[1],
            z: s.position[2],
            scale: s.scale,
            tint: s.tint,
            absoluteScale: true,
          },
          0,
        );
      } else {
        const model = src.clone(true);
        prepareEnvMesh(model);
        model.position.set(s.position[0], 0, s.position[2]);
        model.rotation.y = THREE.MathUtils.degToRad(s.yaw ?? 0);
        fitHeight(model, s.scale[1], s.scale[0]);
        model.position.y += s.position[1];
        s.parent.add(model);
        registerEditable(model, {
          id: s.id,
          path: "foliage/Tall_Meadow_Grass.glb",
          group: "foliage",
          role: "decor",
          parent: s.parentLayer,
        });
      }
    }
  });

  // --- Temple 2B (prebaked PNG, root) — editör absolute scale/pos ---
  {
    const map = loader.load(`${TEMPLE_2D}.png`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, 8);
    const bake = billboardFromMap(map, {
      ...TEMPLE_2D_META,
      fog: false,
      alphaTest: 0.08,
    });
    spawnGrounded(
      bake,
      root,
      {
        id: "s3_temple",
        path: "asset_2d/buildings/moonlit_temple.png",
        group: "buildings",
        role: "decor",
        parentLayer: "root",
        fixedFacing: true,
        x: -3.529,
        y: -0.419,
        z: -7.06,
        scale: [20.774, 21.169, 1],
        absoluteScale: true,
        tint: 0xfff0f6,
        fog: false,
        renderOrder: 2.5,
      },
      0,
    );
  }

  function update(camX = 0) {
    far.position.x = camX * (1 - farFactor);
    mid.position.x = camX * (1 - midFactor);
    nearFx.position.x = camX * (1 - nearFactor);
    moon.position.x = -4 + camX * 0.04;
    sky.mesh.position.set(camX, 2.0, 0);
    const t = performance.now() * 0.001;
    for (const m of mistMeshes) {
      const { baseX, drift, phase } = m.userData;
      m.position.x = baseX + Math.sin(t * 0.22 + phase) * drift;
    }
    // Root 2B: sadece Y, kısmi bakış (karton kenarı yumuşak)
    for (const o of yBillboards) {
      const dx = camX - o.position.x;
      const dz = CAM_Z - o.position.z;
      let yaw = Math.atan2(dx, dz) * Y_BILLBOARD_AMOUNT;
      if (yaw > Y_BILLBOARD_MAX) yaw = Y_BILLBOARD_MAX;
      else if (yaw < -Y_BILLBOARD_MAX) yaw = -Y_BILLBOARD_MAX;
      o.rotation.y = yaw;
    }
  }

  return {
    update,
    getLayers: () => ({ root, mid, far }),
    getEditableProps: () => editableProps.slice(),
  };
}

function styleSakura(tree, tint) {
  tree.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
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
        c.color.set(tint);
      } else {
        c.color.set(0xffffff);
        c.roughness = 1;
      }
      return c;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
    const foliage = next.find((m) => !/bark/i.test(m.name || ""));
    if (foliage?.map) {
      obj.customDepthMaterial = new THREE.MeshDepthMaterial({
        map: foliage.map,
        alphaTest: 0.5,
        depthPacking: THREE.RGBADepthPacking,
        side: THREE.DoubleSide,
      });
    }
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

/** Mor sakura GLB — texture rengini koru (tint yıkama yok) */
function styleTexturedTree(tree) {
  tree.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      const c = m.clone();
      c.metalness = 0;
      c.emissive?.set?.(0x000000);
      c.emissiveIntensity = 0;
      c.envMap = null;
      c.envMapIntensity = 0;
      c.side = THREE.DoubleSide;
      c.roughness = 0.9;
      c.color.set(0xffffff);
      if (c.map) {
        c.map.colorSpace = THREE.SRGBColorSpace;
        c.transparent = false;
        c.alphaTest = 0.35;
        c.depthWrite = true;
      }
      return c;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
    const withMap = next.find((m) => m.map);
    if (withMap?.map) {
      obj.customDepthMaterial = new THREE.MeshDepthMaterial({
        map: withMap.map,
        alphaTest: 0.45,
        depthPacking: THREE.RGBADepthPacking,
        side: THREE.DoubleSide,
      });
    }
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

/** Bambu fener — tüm obje unlit; map yok; kağıt opaque (transparent depth-sort ağaç arkasına kaçmasın) */
function tintLanternUnlit(model, colorHex) {
  const paperColor = new THREE.Color(colorHex).multiplyScalar(0.62);
  const frameColor = new THREE.Color(0x2a2218);
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = srcMats.map((src) => {
      const matName = src?.name || "";
      const shade =
        matName === "Paper" ||
        /^Paper/i.test(obj.name) ||
        /paper/i.test(matName);
      const mat = new THREE.MeshBasicMaterial({
        color: shade ? paperColor : frameColor,
        map: null,
        transparent: false,
        opacity: 1,
        side: THREE.FrontSide,
        fog: true,
        depthWrite: true,
        depthTest: true,
      });
      mat.name = src.name || (shade ? "Paper" : "Bamboo");
      return mat;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
    obj.castShadow = true;
    obj.receiveShadow = false;
    obj.renderOrder = 1;
  });
}

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

function createNightSky(loader) {
  const starTex = loader.load(`${BASE}/stars/star.png`);
  starTex.colorSpace = THREE.SRGBColorSpace;
  starTex.magFilter = THREE.LinearFilter;
  starTex.minFilter = THREE.LinearMipmapLinearFilter;
  starTex.wrapS = THREE.ClampToEdgeWrapping;
  starTex.wrapT = THREE.ClampToEdgeWrapping;

  const uniforms = {
    uDay: { value: 0 },
    uStar: { value: starTex },
    uZenithN: { value: new THREE.Color(0x0a0414) },
    uHorizonN: { value: new THREE.Color(0x1a0a22) },
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
        float sky = smoothstep(-0.02, 0.18, h) * (1.0 - uDay);
        col += stamp.rgb * stamp.a * on * inside * sky * 1.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), material);
  mesh.name = "Scene3NightSky";
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

/** Scene1 vault collision — görsel X’e hizala */
function syncVaultBarrierFixed(barriers, x, height, thickness, editorId) {
  const b = barriers.find((e) => Math.abs(e.x - x) < 0.05 && !e.passUnder);
  if (!b) return;
  b.x = x;
  b.height = height;
  b.halfT = thickness / 2;
  if (editorId) b.editorId = editorId;
}

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
