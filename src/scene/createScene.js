import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const LAYER_ENV = 0;
export const LAYER_CHAR = 1;

/**
 * Sahne, kamera, renderer, ortam ışıkları, zemin ve vault engelleri.
 */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c4);
  scene.fog = new THREE.Fog(0x87a0c4, 18, 42);

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 2.2, 14.0);
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
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const envHemi = new THREE.HemisphereLight(0xddeeff, 0x445566, 1.15);
  envHemi.layers.set(LAYER_ENV);
  scene.add(envHemi);

  const envSun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  envSun.position.set(6, 12, 4);
  envSun.castShadow = true;
  envSun.shadow.mapSize.set(2048, 2048);
  envSun.shadow.camera.near = 1;
  envSun.shadow.camera.far = 40;
  envSun.shadow.camera.left = -14;
  envSun.shadow.camera.right = 14;
  envSun.shadow.camera.top = 14;
  envSun.shadow.camera.bottom = -14;
  envSun.shadow.bias = -0.0002;
  envSun.layers.set(LAYER_ENV);
  scene.add(envSun);
  scene.add(envSun.target);

  buildGround(scene);
  const { barriers, limboBarrier } = buildBarriers(scene);
  const waterZone = buildWater(scene);

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
    onResize,
    render,
  };
}

function buildGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 24),
    new THREE.MeshStandardMaterial({
      color: 0x3d5a3a,
      roughness: 0.92,
      metalness: 0.05,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 2.4),
    new THREE.MeshStandardMaterial({
      color: 0x4a6b45,
      roughness: 1,
      metalness: 0,
    })
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.01;
  lane.receiveShadow = true;
  scene.add(lane);

  for (let i = -6; i <= 6; i++) {
    if (i === 0) continue;
    const h = 0.35 + Math.abs(i % 3) * 0.15;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, h, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 0.85 })
    );
    box.position.set(i * 3.2, h / 2, -3.2);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
  }
}

function buildBarriers(scene) {
  const barriers = [];

  function addVaultBarrier(x, height = 0.7, thickness = 0.45, width = 1.6) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4a35a,
      roughness: 0.75,
      metalness: 0.05,
    });
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, height, width),
      mat
    );
    barrier.position.set(x, height / 2, 0);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    scene.add(barrier);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(thickness + 0.02, 0.08, width + 0.02),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 })
    );
    stripe.position.set(x, height - 0.04, 0);
    scene.add(stripe);

    barriers.push({ x, halfT: thickness / 2, height });
  }

  addVaultBarrier(1.6, 0.72, 0.45, 2.8);
  addVaultBarrier(6.5, 0.68, 0.45, 2.8);

  // Havuzun sağı — yalnızca çömelme / slide ile altından geçilir
  const limboBarrier = addLimboBarrier(scene, barriers, 24.5, 1.5);

  return { barriers, limboBarrier };
}

/**
 * Limbo / alçak tavan: ayaktayken çarpar; crouch/slide ile altından geçer.
 * setClearance(m) ile menüden yükseklik ayarlanır.
 */
function addLimboBarrier(scene, barriers, x, clearance = 1.5) {
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

  const root = new THREE.Group();
  root.position.set(x, 0, 0);
  scene.add(root);

  /** @type {THREE.Mesh[]} */
  const posts = [];
  /** @type {THREE.Mesh[]} */
  const caps = [];
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(postW, 1, postD),
      wood,
    );
    post.position.set(0, 0.5, side * halfW);
    post.castShadow = true;
    post.receiveShadow = true;
    root.add(post);
    posts.push(post);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(postW + 0.08, 0.1, postD + 0.08),
      metal,
    );
    cap.castShadow = true;
    root.add(cap);
    caps.push(cap);
  }

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, beamH, width + 0.15),
    wood,
  );
  beam.castShadow = true;
  beam.receiveShadow = true;
  root.add(beam);

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
    root.add(stripe);
    stripes.push(stripe);
  }

  const flags = [];
  for (let i = -2; i <= 2; i++) {
    const h = 0.28 + (Math.abs(i) % 2) * 0.1;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, h), cloth);
    flag.userData.flagH = h;
    flag.position.set(thickness * 0.35, 0, i * 0.45);
    flag.rotation.y = Math.PI * 0.5;
    root.add(flag);
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
  root.add(mark);

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
        const h = flag.userData.flagH;
        flag.position.y = c - h * 0.45;
      }
    },
  };

  barrier.setClearance(clearance);
  barriers.push(barrier);
  return barrier;
}

/** Engellerden sonra su alanı */
function buildWater(scene) {
  const waterZone = {
    minX: 9.2,
    maxX: 22,
    minZ: -3.2,
    maxZ: 3.2,
    surfaceY: 0.42,
  };

  const w = waterZone.maxX - waterZone.minX;
  const d = waterZone.maxZ - waterZone.minZ;
  const cx = (waterZone.minX + waterZone.maxX) * 0.5;
  const cz = (waterZone.minZ + waterZone.maxZ) * 0.5;

  // Havuz tabanı
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
  scene.add(floor);

  // Su yüzeyi
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
  scene.add(water);

  // Kenar taşları
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
    scene.add(rim);
  }

  return waterZone;
}
