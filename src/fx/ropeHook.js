import * as THREE from "three";

/**
 * Tavana saplanan Konoha-stili kunai ucu + gerçek ip (texture).
 * İp halkaya (toto) bağlanır.
 */
export function createRopeHookFx(scene, { layer = 1 } = {}) {
  const group = new THREE.Group();
  group.name = "RopeHookFx";
  group.visible = false;
  scene.add(group);

  const texLoader = new THREE.TextureLoader();
  const ropeDiff = texLoader.load("./public/props/rope_fence/rope_diffuse.png");
  const ropeNorm = texLoader.load("./public/props/rope_fence/rope_normal.png");
  ropeDiff.wrapS = ropeDiff.wrapT = THREE.RepeatWrapping;
  ropeNorm.wrapS = ropeNorm.wrapT = THREE.RepeatWrapping;
  ropeDiff.repeat.set(1, 4);
  ropeNorm.repeat.set(1, 4);
  ropeDiff.colorSpace = THREE.SRGBColorSpace;

  const ropeMat = new THREE.MeshStandardMaterial({
    map: ropeDiff,
    normalMap: ropeNorm,
    color: 0xc4a06a,
    roughness: 0.92,
    metalness: 0.0,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xb8c4d0,
    roughness: 0.28,
    metalness: 0.9,
  });
  const wrapMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.85,
    metalness: 0.05,
  });

  // İp — el ↔ kunai halkası
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 1, 8),
    ropeMat,
  );
  rope.castShadow = true;
  group.add(rope);

  // Konoha kunai (tavana saplanan uç yukarı bakar)
  const kunai = new THREE.Group();
  kunai.name = "KonohaKunaiTip";

  const blade = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.22, 4),
    steelMat,
  );
  blade.position.y = 0.12;
  blade.rotation.y = Math.PI / 4;
  kunai.add(blade);

  const tang = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.08, 0.018),
    steelMat,
  );
  tang.position.y = -0.02;
  kunai.add(tang);

  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.024, 0.09, 8),
    wrapMat,
  );
  wrap.position.y = -0.1;
  kunai.add(wrap);

  // Halka (ip bağlanır) — aşağıda
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.038, 0.008, 8, 16),
    steelMat,
  );
  ring.position.y = -0.165;
  ring.rotation.x = Math.PI / 2;
  ring.name = "KunaiRing";
  kunai.add(ring);

  group.add(kunai);

  const handKnot = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 8, 8),
    ropeMat,
  );
  group.add(handKnot);

  group.traverse((o) => {
    o.layers.set(layer);
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const _hand = new THREE.Vector3();
  const _anchor = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _ropeTop = new THREE.Vector3();

  function setActive(on) {
    group.visible = !!on;
  }

  /**
   * @param {THREE.Vector3} handWorld
   * @param {number} anchorY
   * @param {number} [anchorX]
   * @param {number} [anchorZ]
   */
  function update(handWorld, anchorY, anchorX, anchorZ = 0) {
    if (!group.visible || !handWorld) return;

    _hand.copy(handWorld);
    _anchor.set(
      anchorX != null ? anchorX : handWorld.x,
      anchorY,
      anchorZ,
    );

    kunai.position.copy(_anchor);
    // Uç, el→kanca yönünde (dikey tavanda yukarı, salıncakta çapraz)
    _dir.subVectors(_anchor, _hand);
    if (_dir.lengthSq() > 1e-8) {
      _quat.setFromUnitVectors(_up, _dir.clone().normalize());
      kunai.quaternion.copy(_quat);
    } else {
      kunai.rotation.set(0, 0, 0);
    }
    kunai.updateMatrixWorld(true);

    // İp: el → halka
    ring.getWorldPosition(_ropeTop);
    _mid.addVectors(_hand, _ropeTop).multiplyScalar(0.5);
    _dir.subVectors(_ropeTop, _hand);
    const len = Math.max(0.05, _dir.length());
    rope.position.copy(_mid);
    rope.scale.set(1, len, 1);
    if (ropeMat.map) ropeMat.map.repeat.set(1, Math.max(1, len * 2.2));
    if (ropeMat.normalMap) ropeMat.normalMap.repeat.set(1, Math.max(1, len * 2.2));
    _quat.setFromUnitVectors(_up, _dir.clone().normalize());
    rope.quaternion.copy(_quat);

    handKnot.position.copy(_hand);
  }

  function dispose() {
    scene.remove(group);
    rope.geometry.dispose();
    ropeMat.dispose();
    steelMat.dispose();
    wrapMat.dispose();
    ropeDiff.dispose();
    ropeNorm.dispose();
    blade.geometry.dispose();
    tang.geometry.dispose();
    wrap.geometry.dispose();
    ring.geometry.dispose();
    handKnot.geometry.dispose();
  }

  return { setActive, update, dispose, group };
}
