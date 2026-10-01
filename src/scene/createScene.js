import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { buildScenePack2 } from "./scenePack2.js";
import { buildScenePack3 } from "./scenePack3.js";
import {
  applyShadowFrustum,
  anchorLightToShadowVolume,
  addCharShadowCatcher,
  suspendDynamicCasters,
  resumeDynamicCasters,
  wantsDynamicKeyShadow,
} from "./shadowPolicy.js";

export const LAYER_ENV = 0;
export const LAYER_CHAR = 1;

const TEX = {
  nightHdr: "./public/scene2/hdri/satara_night_1k.hdr",
};

/**
 * Sahne, kamera, renderer, ışık + Scene1 (mevcut) / Scene2 (gece, mobil-hafif).
 */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c4);
  scene.fog = new THREE.Fog(0x87a0c4, 18, 42);

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  );
  camera.position.set(0, 6.0, 20.0);
  camera.layers.enable(LAYER_CHAR);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = roomEnv;

  const envHemi = new THREE.HemisphereLight(0xddeeff, 0x445566, 1.15);
  envHemi.layers.set(LAYER_ENV);
  scene.add(envHemi);

  const envSun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  envSun.position.set(6, 12, 4);
  envSun.userData.lightOffset = { x: 6, y: 12, z: 4 };
  envSun.castShadow = true;
  applyShadowFrustum(envSun, { autoUpdate: false });
  envSun.layers.set(LAYER_ENV);
  scene.add(envSun);
  scene.add(envSun.target);

  function anchorEnvSun() {
    const o = envSun.userData.lightOffset || { x: 6, y: 12, z: 4 };
    anchorLightToShadowVolume(envSun, o);
  }

  /** Statik env gölgesi — tek seferlik; dinamikler bake’e girmez */
  function bakeEnvShadows() {
    suspendDynamicCasters(scene);
    // charSun bu karede de dinamik çizmesin (spawn silüeti)
    const dynLights = [];
    scene.traverse((o) => {
      if (o.isDirectionalLight && o !== envSun && o.castShadow) {
        dynLights.push(o);
        o.castShadow = false;
      }
    });

    anchorEnvSun();
    envSun.shadow.autoUpdate = false;
    envSun.shadow.needsUpdate = true;

    // Shadow map render edildikten sonra dinamikleri aç
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resumeDynamicCasters(scene);
        for (const l of dynLights) {
          l.castShadow = wantsDynamicKeyShadow();
        }
      });
    });
  }

  anchorEnvSun();

  // Karakter/enemy dinamik gölgesi için zemin catcher (ışık katmanı CHAR)
  addCharShadowCatcher(scene, LAYER_CHAR);

  /** Ortak: barrier data. Su + beige engeller sadece Scene1 */
  const { barriers, limboBarrier, sharedRoot, pack1Obstacles } =
    buildSharedGameplay(scene);

  const pack1 = buildScenePack1(scene);
  pack1.add(pack1Obstacles);
  const waterRoot = new THREE.Group();
  waterRoot.name = "Pack1Water";
  pack1.add(waterRoot);
  const waterZone = buildWater(waterRoot);
  waterZone.enabled = false; // default Scene 2
  pack1.visible = false;
  let resolveStaticReady;
  const staticReady = new Promise((r) => {
    resolveStaticReady = r;
  });
  const pack2 = new THREE.Group();
  pack2.name = "ScenePack2";
  pack2.visible = false;
  scene.add(pack2);
  // Pack2 cold-start’ta yüklenmesin (Scene3 default) — ilk açılış lag + OOM bake kaçın
  let pack2Built = false;
  let pack2StaticDone = true;
  let pack3StaticDone = false;
  /** Sabit referans — main.js destructure sonrası ensurePack2 günceller */
  const pack2Api = {
    update(_camX) {},
    getLayers: () => ({ root: pack2, mid: pack2, far: pack2 }),
    getEditableProps: () => [],
  };
  function tryResolveStaticReady() {
    if (!pack3StaticDone) return;
    if (pack2Built && !pack2StaticDone) return;
    disableStaticIbl(pack3);
    if (pack2Built) disableStaticIbl(pack2);
    disableStaticIbl(sharedRoot);
    bakeEnvShadows();
    resolveStaticReady?.();
  }
  function ensurePack2() {
    if (pack2Built) return pack2Api;
    pack2Built = true;
    pack2StaticDone = false;
    const api = buildScenePack2(pack2, {
      barriers,
      limboBarrier,
      onStaticReady: () => {
        pack2StaticDone = true;
        disableStaticIbl(pack2);
        bakeEnvShadows();
        tryResolveStaticReady();
      },
    });
    pack2Api.update = api.update?.bind(api) ?? pack2Api.update;
    pack2Api.getLayers = api.getLayers?.bind(api) ?? pack2Api.getLayers;
    pack2Api.getEditableProps =
      api.getEditableProps?.bind(api) ?? pack2Api.getEditableProps;
    return pack2Api;
  }

  const pack3 = new THREE.Group();
  pack3.name = "ScenePack3";
  pack3.visible = true;
  scene.add(pack3);
  const pack3Api = buildScenePack3(pack3, {
    renderer,
    barriers,
    limboBarrier,
    onStaticReady: () => {
      pack3StaticDone = true;
      tryResolveStaticReady();
    },
  });

  disableStaticIbl(pack3);
  disableStaticIbl(sharedRoot);

  let nightEnvMap = null;
  let currentPack = "3";

  // HDRI async — Scene2 gece için (1k, mobil uyumlu)
  new RGBELoader().load(
    TEX.nightHdr,
    (hdr) => {
      nightEnvMap = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      // Sadece karakterler — scene.environment KAPALI (ağaç IBL almasın)
      scene.userData.charEnvMap = nightEnvMap;
      if (currentPack === "2" || currentPack === "3") {
        scene.environment = null;
      }
    },
    undefined,
    () => {
      /* HDR yoksa jpg sky yeter */
    },
  );

  // Default Scene 3 — pembe/mor gece
  scene.background = new THREE.Color(0x0a0414);
  scene.fog = new THREE.FogExp2(0x140818, 0.028);
  scene.environment = null;
  scene.userData.charEnvMap = null;

  /** Statik ENV — IBL’ye kapalı */
  function disableStaticIbl(root) {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if ("envMapIntensity" in m) m.envMapIntensity = 0;
        if ("envMap" in m) m.envMap = null;
      }
    });
  }

  function setWorldPack(id = "1") {
    const next = id === "3" ? "3" : id === "2" ? "2" : "1";
    currentPack = next;
    if (next === "2") ensurePack2();
    pack1.visible = next === "1";
    pack2.visible = next === "2";
    pack3.visible = next === "3";
    if (waterZone) waterZone.enabled = next === "1";
    if (next === "2" || next === "3") {
      scene.environment = null;
      if (nightEnvMap) scene.userData.charEnvMap = nightEnvMap;
      disableStaticIbl(next === "3" ? pack3 : pack2);
      disableStaticIbl(sharedRoot);
      const fogCol = next === "3" ? 0x140818 : 0x0c0612;
      const fogDen = next === "3" ? 0.028 : 0.034;
      if (!(scene.fog instanceof THREE.FogExp2)) {
        scene.fog = new THREE.FogExp2(fogCol, fogDen);
      } else {
        scene.fog.color.set(fogCol);
        scene.fog.density = fogDen;
      }
      scene.background = new THREE.Color(next === "3" ? 0x0a0414 : 0x05010c);
    } else {
      scene.environment = roomEnv;
      scene.userData.charEnvMap = roomEnv;
      if (!(scene.fog instanceof THREE.Fog)) {
        scene.fog = new THREE.Fog(0x87a0c4, 18, 42);
      }
    }
    return next;
  }

  function updateWorld(camX = 0) {
    if (currentPack === "2") pack2Api?.update?.(camX);
    else if (currentPack === "3") pack3Api?.update?.(camX);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,
    envHemi,
    envSun,
    barriers,
    limboBarrier,
    waterZone,
    pack2Root: pack2,
    pack2Api,
    ensurePack2,
    pack3Root: pack3,
    pack3Api,
    staticReady,
    setWorldPack,
    getWorldPack: () => currentPack,
    bakeEnvShadows,
    updateWorld,
    onResize,
    render,
  };
}

/** Su sharedRoot’ta; vault/limbo görselleri pack1Obstacles (Scene1). Barrier data ortak. */
function buildSharedGameplay(scene) {
  const sharedRoot = new THREE.Group();
  sharedRoot.name = "SharedGameplay";
  scene.add(sharedRoot);

  const pack1Obstacles = new THREE.Group();
  pack1Obstacles.name = "Pack1Obstacles";

  const barriers = [];

  function addVaultBarrier(x, height = 0.7, thickness = 0.45, width = 1.6) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4a35a,
      roughness: 0.75,
      metalness: 0.05,
    });
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, height, width),
      mat,
    );
    barrier.position.set(x, height / 2, 0);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    pack1Obstacles.add(barrier);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(thickness + 0.02, 0.08, width + 0.02),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }),
    );
    stripe.position.set(x, height - 0.04, 0);
    pack1Obstacles.add(stripe);

    barriers.push({ x, halfT: thickness / 2, height });
  }

  addVaultBarrier(1.6, 0.72, 0.45, 2.8);
  addVaultBarrier(6.5, 0.68, 0.45, 2.8);
  const limboBarrier = addLimboBarrier(pack1Obstacles, barriers, 24.5, 1.5);

  return { barriers, limboBarrier, sharedRoot, pack1Obstacles };
}

/** Scene 1 — mevcut yeşil zemin / dekor (dokunulmaz görünüm) */
function buildScenePack1(scene) {
  const root = new THREE.Group();
  root.name = "ScenePack1";
  scene.add(root);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 24),
    new THREE.MeshStandardMaterial({
      color: 0x3d5a3a,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 2.4),
    new THREE.MeshStandardMaterial({
      color: 0x4a6b45,
      roughness: 1,
      metalness: 0,
    }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.01;
  lane.receiveShadow = true;
  root.add(lane);

  for (let i = -6; i <= 6; i++) {
    if (i === 0) continue;
    const h = 0.35 + Math.abs(i % 3) * 0.15;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, h, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 0.85 }),
    );
    box.position.set(i * 3.2, h / 2, -3.2);
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
  }

  return root;
}

function addLimboBarrier(parent, barriers, x, clearance = 1.5) {
  const thickness = 0.55;
  const width = 3.2;
  const beamH = 0.28;
  const postW = 0.22;
  const postD = 0.22;
  const halfW = width * 0.5;

  const wood = new THREE.MeshStandardMaterial({
    color: 0x5c4030,
    roughness: 0.88,
    metalness: 0.04,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x3a3f45,
    roughness: 0.55,
    metalness: 0.35,
  });
  const hazard = new THREE.MeshStandardMaterial({
    color: 0xe8b020,
    roughness: 0.7,
    metalness: 0.1,
  });
  const hazardDark = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.9,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0xc45a2a,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

  const limboRoot = new THREE.Group();
  limboRoot.position.set(x, 0, 0);
  parent.add(limboRoot);

  const posts = [];
  const caps = [];
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(postW, 1, postD),
      wood,
    );
    post.position.set(0, 0.5, side * halfW);
    post.castShadow = true;
    post.receiveShadow = true;
    limboRoot.add(post);
    posts.push(post);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(postW + 0.08, 0.1, postD + 0.08),
      metal,
    );
    cap.castShadow = true;
    limboRoot.add(cap);
    caps.push(cap);
  }

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, beamH, width + 0.15),
    wood,
  );
  beam.castShadow = true;
  beam.receiveShadow = true;
  limboRoot.add(beam);

  const stripes = [];
  const stripeCount = 7;
  const stripeZ = width / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    const dark = i % 2 === 0;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(thickness + 0.04, beamH + 0.04, stripeZ * 0.92),
      dark ? hazardDark : hazard,
    );
    stripe.position.z = -halfW + stripeZ * (i + 0.5);
    limboRoot.add(stripe);
    stripes.push(stripe);
  }

  const flags = [];
  for (let i = -2; i <= 2; i++) {
    const h = 0.28 + (Math.abs(i) % 2) * 0.1;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, h), cloth);
    flag.userData.flagH = h;
    flag.position.set(thickness * 0.35, 0, i * 0.45);
    flag.rotation.y = Math.PI * 0.5;
    limboRoot.add(flag);
    flags.push(flag);
  }

  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(thickness + 0.8, width * 0.55),
    new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 1,
      transparent: true,
      opacity: 0.55,
    }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(0, 0.02, 0);
  limboRoot.add(mark);

  const barrier = {
    x,
    halfT: thickness / 2,
    height: clearance + beamH,
    clearance,
    passUnder: true,
    vaultable: false,
    setClearance(next) {
      const c = Math.min(2.2, Math.max(0.7, Number(next) || clearance));
      barrier.clearance = c;
      barrier.height = c + beamH;

      for (const post of posts) {
        post.scale.y = c + beamH;
        post.position.y = (c + beamH) * 0.5;
      }
      for (let i = 0; i < caps.length; i++) {
        caps[i].position.set(0, c + beamH + 0.05, posts[i].position.z);
      }
      beam.position.set(0, c + beamH * 0.5, 0);
      for (const stripe of stripes) {
        stripe.position.y = c + beamH * 0.5;
      }
      for (const flag of flags) {
        const fh = flag.userData.flagH;
        flag.position.y = c - fh * 0.45;
      }
    },
  };

  barrier.setClearance(clearance);
  barriers.push(barrier);
  return barrier;
}

function buildWater(parent) {
  const waterZone = {
    minX: 9.2,
    maxX: 22,
    minZ: -3.2,
    maxZ: 3.2,
    surfaceY: 0.42,
    enabled: true,
  };

  const w = waterZone.maxX - waterZone.minX;
  const d = waterZone.maxZ - waterZone.minZ;
  const cx = (waterZone.minX + waterZone.maxX) * 0.5;
  const cz = (waterZone.minZ + waterZone.maxZ) * 0.5;

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.4, 0.2, d + 0.4),
    new THREE.MeshStandardMaterial({
      color: 0x1a3a4a,
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  floor.position.set(cx, -0.05, cz);
  floor.receiveShadow = true;
  parent.add(floor);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshPhysicalMaterial({
      color: 0x2e7eb8,
      transparent: true,
      opacity: 0.62,
      roughness: 0.15,
      metalness: 0.05,
      transmission: 0.35,
      thickness: 0.4,
      depthWrite: false,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, waterZone.surfaceY, cz);
  water.receiveShadow = true;
  parent.add(water);

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x6b736e,
    roughness: 0.88,
  });
  const rimH = 0.55;
  const rimT = 0.35;
  const edges = [
    { x: cx, z: waterZone.minZ - rimT * 0.5, sx: w + rimT * 2, sz: rimT },
    { x: cx, z: waterZone.maxZ + rimT * 0.5, sx: w + rimT * 2, sz: rimT },
    { x: waterZone.minX - rimT * 0.5, z: cz, sx: rimT, sz: d },
    { x: waterZone.maxX + rimT * 0.5, z: cz, sx: rimT, sz: d },
  ];
  for (const e of edges) {
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(e.sx, rimH, e.sz),
      rimMat,
    );
    rim.position.set(e.x, rimH * 0.5, e.z);
    rim.castShadow = true;
    rim.receiveShadow = true;
    parent.add(rim);
  }

  return waterZone;
}
