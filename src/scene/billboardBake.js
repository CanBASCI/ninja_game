import * as THREE from "three";

/**
 * GLB/mesh’i bir kez render edip kamera-bakan Sprite (2B) üretir.
 * Ortho frustum bbox’a oturur (kare pad yok → zeminde uçmaz).
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Object3D} object
 * @param {{
 *   size?: number,
 *   yaw?: number,
 *   tint?: number,
 *   alphaTest?: number,
 *   pad?: number,
 *   lighting?: "day" | "night" | "nightBright",
 *   fog?: boolean,
 * }} [opts]
 * @returns {{ sprite: THREE.Sprite, worldW: number, worldH: number, map: THREE.Texture }}
 */
export function bakeBillboard(renderer, object, opts = {}) {
  const size = opts.size ?? 384;
  const yaw = opts.yaw ?? 0;
  const alphaTest = opts.alphaTest ?? 0.12;
  const pad = opts.pad ?? 1.04;

  const bakeRoot = object.clone(true);
  // Bake pozisyonunu sıfırla; scale/rot korunur — yaw eklenir
  const baseYaw = bakeRoot.rotation.y;
  bakeRoot.position.set(0, 0, 0);
  bakeRoot.rotation.set(bakeRoot.rotation.x, baseYaw + yaw, bakeRoot.rotation.z);
  bakeRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    o.customDepthMaterial = null;
  });
  bakeRoot.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(bakeRoot);
  // Yere bas (min.y = 0) — sonra yeniden ölç
  bakeRoot.position.y = -box.min.y;
  bakeRoot.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(bakeRoot);

  const sizeV = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const worldW = Math.max(sizeV.x, sizeV.z, 0.05);
  const worldH = Math.max(sizeV.y, 0.05);

  // Merkeze al (kamera ortasın)
  bakeRoot.position.x -= center.x;
  bakeRoot.position.y -= center.y;
  bakeRoot.position.z -= center.z;
  bakeRoot.updateMatrixWorld(true);

  const halfW = worldW * pad * 0.5;
  const halfH = worldH * pad * 0.5;
  // Pad altta boşluk bırakmasın — gövde frustum dibine (sprite center=alt kenar)
  if (pad > 1) {
    bakeRoot.position.y -= worldH * (pad - 1) * 0.5;
    bakeRoot.updateMatrixWorld(true);
  }

  const bakeScene = new THREE.Scene();
  bakeScene.add(bakeRoot);
  const lighting = opts.lighting ?? "day";
  if (lighting === "night" || lighting === "nightBright") {
    // Scene3 gece: ay ana ışık — bina için biraz daha fill (silik kalmasın)
    const bright = lighting === "nightBright";
    bakeScene.add(new THREE.AmbientLight(0x2a1838, bright ? 0.38 : 0.14));
    const key = new THREE.DirectionalLight(0xffd0e8, bright ? 1.45 : 1.05);
    // Pack3 ay / sunPos (−X, +Y, −Z)
    key.position.set(-4, 12.2, -22);
    bakeScene.add(key);
    const kick = new THREE.DirectionalLight(0x6a80a8, bright ? 0.35 : 0.12);
    kick.position.set(6, 3, 8);
    bakeScene.add(kick);
    if (bright) {
      const rim = new THREE.DirectionalLight(0xffc0e0, 0.28);
      rim.position.set(2, 8, 10);
      bakeScene.add(rim);
    }
  } else {
    bakeScene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff0e8, 1.35);
    key.position.set(2.2, 4.5, 5.5);
    bakeScene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45);
    fill.position.set(-3, 2, 2);
    bakeScene.add(fill);
  }

  // Bbox oranında ortho — kare boşluk bırakma
  const cam = new THREE.OrthographicCamera(
    -halfW,
    halfW,
    halfH,
    -halfH,
    0.05,
    Math.max(halfW, halfH) * 10,
  );
  cam.position.set(0, 0, Math.max(halfW, halfH) * 4);
  cam.lookAt(0, 0, 0);

  const aspect = worldW / worldH;
  let rtW = size;
  let rtH = size;
  if (aspect >= 1) {
    rtH = Math.max(64, Math.round(size / aspect));
  } else {
    rtW = Math.max(64, Math.round(size * aspect));
  }

  const rt = new THREE.WebGLRenderTarget(rtW, rtH, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = true;
  rt.texture.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);

  const prevRt = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevXR = renderer.xr?.enabled;

  if (renderer.xr) renderer.xr.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(bakeScene, cam);
  renderer.setRenderTarget(prevRt);
  renderer.setClearColor(prevClear, prevAlpha);
  if (renderer.xr && prevXR != null) renderer.xr.enabled = prevXR;

  bakeScene.clear();

  const mat = new THREE.SpriteMaterial({
    map: rt.texture,
    transparent: true,
    alphaTest,
    depthWrite: false,
    fog: opts.fog !== false,
    color: opts.tint != null ? opts.tint : 0xffffff,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(worldW, worldH, 1);
  // Alt kenar = zemin
  sprite.center.set(0.5, 0);
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  sprite.frustumCulled = true;
  sprite.userData.billboard = true;
  sprite.userData.worldH = worldH;
  sprite.userData.worldW = worldW;

  return { sprite, worldW, worldH, map: rt.texture };
}

/**
 * Bake edilmiş sprite’ı yere bas (alt kenar y=0).
 * @param {THREE.Sprite} sprite
 * @param {{ x: number, y?: number, z: number, scale?: number }} p
 */
export function placeBillboard(sprite, p) {
  const s = p.scale ?? 1;
  const h = (sprite.userData.worldH || 1) * s;
  const w = (sprite.userData.worldW || 1) * s;
  sprite.scale.set(w, h, 1);
  sprite.position.set(p.x, p.y ?? 0, p.z);
  return sprite;
}

/**
 * Diskteki bake PNG (+ opsiyonel json worldW/H) → billboard sonucu.
 * @param {THREE.Texture} map
 * @param {{ worldW: number, worldH: number, tint?: number, alphaTest?: number, fog?: boolean }} meta
 */
export function billboardFromMap(map, meta) {
  const alphaTest = meta.alphaTest ?? 0.08;
  const mat = new THREE.SpriteMaterial({
    map,
    transparent: true,
    alphaTest,
    depthWrite: false,
    fog: meta.fog !== false,
    color: meta.tint != null ? meta.tint : 0xffffff,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(meta.worldW, meta.worldH, 1);
  sprite.center.set(0.5, 0);
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  sprite.frustumCulled = true;
  sprite.userData.billboard = true;
  sprite.userData.worldH = meta.worldH;
  sprite.userData.worldW = meta.worldW;
  return { sprite, worldW: meta.worldW, worldH: meta.worldH, map };
}
