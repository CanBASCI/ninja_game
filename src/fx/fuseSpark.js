import * as THREE from "three";

/** Net kırmızı merkez — turuncu sadece ince dış halka */
function makeFuseTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    0,
    size * 0.5,
    size * 0.5,
    size * 0.48,
  );
  // Merkez: çok ince kırmızı nokta
  g.addColorStop(0.0, "rgba(255, 0, 0, 1)");
  g.addColorStop(0.06, "rgba(255, 30, 0, 1)");
  g.addColorStop(0.14, "rgba(255, 110, 25, 0.95)");
  g.addColorStop(0.35, "rgba(255, 165, 50, 0.75)");
  g.addColorStop(0.65, "rgba(255, 210, 95, 0.35)");
  g.addColorStop(1.0, "rgba(255, 230, 120, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** İnce çizgi: orta kırmızı, uçlar turuncu */
function makeStreakTexture() {
  const w = 64;
  const h = 12;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // Dikey soft mask
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = Math.abs(y / (h - 1) - 0.5) * 2; // 0 merkez, 1 kenar
      const edge = Math.max(0, 1 - v * v);
      // yatay: uçlar sönük turuncu, orta kırmızı
      let r;
      let g;
      let b;
      let a;
      if (u < 0.42) {
        const t = u / 0.42;
        r = 255;
        g = 160 + 50 * (1 - t);
        b = 45 * (1 - t);
        a = t * edge;
      } else if (u > 0.58) {
        const t = (1 - u) / 0.42;
        r = 255;
        g = 160 + 50 * (1 - t);
        b = 45 * (1 - t);
        a = t * edge;
      } else {
        // çok dar kırmızı çekirdek
        const mid = 1 - Math.abs(u - 0.5) / 0.045;
        const m = Math.max(0, mid);
        r = 255;
        g = 8 + 110 * (1 - m);
        b = 0;
        a = edge;
      }
      ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},${a.toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bomba fitili — NormalBlending: kırmızı merkez gerçekten kırmızı görünür.
 */
export function createFuseSparkFx(scene) {
  const sparks = [];
  const trails = [];
  const fuseTex = makeFuseTexture();
  const streakTex = makeStreakTexture();
  const sparkGeo = new THREE.PlaneGeometry(0.1, 0.02);
  const trailGeo = new THREE.PlaneGeometry(0.1, 0.1);
  const tipGeo = new THREE.PlaneGeometry(0.125, 0.125);
  const _pos = new THREE.Vector3();
  const _prev = new THREE.Vector3();
  const _move = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _z = new THREE.Vector3(0, 0, 1);
  let marker = null;
  let active = false;
  let emitAcc = 0;
  let trailAcc = 0;
  let hasPrev = false;

  const tipMat = new THREE.MeshBasicMaterial({
    map: fuseTex,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.renderOrder = 24;
  tip.visible = false;
  scene.add(tip);

  function bind(markerObj) {
    marker = markerObj || null;
    hasPrev = false;
  }

  function setActive(on) {
    active = !!on && !!marker;
    if (!active) {
      tip.visible = false;
      hasPrev = false;
    }
  }

  /** Anında tüm kıvılcım / trail temizle (ölüm vb.) */
  function clear() {
    setActive(false);
    emitAcc = 0;
    trailAcc = 0;
    for (const s of sparks) {
      scene.remove(s.mesh);
      s.mesh.material?.dispose?.();
    }
    sparks.length = 0;
    for (const t of trails) {
      scene.remove(t.mesh);
      t.mesh.material?.dispose?.();
    }
    trails.length = 0;
  }

  function spawnSpark(origin) {
    const mat = new THREE.MeshBasicMaterial({
      map: streakTex,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.position.copy(origin);
    const ang = -Math.PI * 0.4 + Math.random() * Math.PI * 0.8;
    const speed = 0.75 + Math.random() * 1.25;
    const dir = new THREE.Vector3(
      Math.sin(ang) * 0.4,
      0.7 + Math.random() * 0.5,
      Math.cos(ang) * 0.2,
    ).normalize();
    _q.setFromUnitVectors(_z, new THREE.Vector3(dir.x, dir.y, 0.001).normalize());
    mesh.quaternion.copy(_q);
    mesh.scale.set(0.875 + Math.random() * 0.8125, 1.125 + Math.random() * 0.4375, 1);
    mesh.renderOrder = 25;
    scene.add(mesh);
    sparks.push({
      mesh,
      age: 0,
      life: 0.16 + Math.random() * 0.18,
      vel: dir.multiplyScalar(speed),
    });
  }

  function spawnTrail(origin, moveDir, speed) {
    const mat = new THREE.MeshBasicMaterial({
      map: fuseTex,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(trailGeo, mat);
    mesh.position.copy(origin);
    mesh.position.x += (Math.random() - 0.5) * 0.05;
    mesh.position.y += (Math.random() - 0.5) * 0.04;
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    mesh.scale.setScalar(0.625 + Math.random() * 0.5);
    mesh.renderOrder = 22;
    scene.add(mesh);

    const back =
      moveDir.lengthSq() > 1e-6
        ? moveDir.clone().normalize().multiplyScalar(-(0.3 + speed * 0.12))
        : new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, 0);
    back.y += 0.12 + Math.random() * 0.28;

    trails.push({
      mesh,
      age: 0,
      life: 0.4 + Math.random() * 0.45,
      vel: back,
    });
  }

  function update(dt) {
    if (active && marker) {
      marker.getWorldPosition(_pos);

      tip.position.copy(_pos);
      tip.lookAt(_pos.x, _pos.y, _pos.z + 1);
      tip.visible = true;
      tip.scale.setScalar(1.1875 + Math.sin(performance.now() * 0.028) * 0.15);
      tipMat.opacity = 0.95;

      let moveSpeed = 0;
      if (hasPrev) {
        _move.subVectors(_pos, _prev);
        moveSpeed = _move.length() / Math.max(dt, 1e-4);
      } else {
        _move.set(0, 0, 0);
      }
      _prev.copy(_pos);
      hasPrev = true;

      emitAcc += dt;
      while (emitAcc >= 0.04) {
        emitAcc -= 0.04;
        spawnSpark(_pos);
      }

      const moving = moveSpeed > 1.2;
      trailAcc += dt;
      const trailRate = moving ? 0.032 : 0.1;
      while (trailAcc >= trailRate) {
        trailAcc -= trailRate;
        spawnTrail(_pos, _move, moveSpeed);
        if (moving) spawnTrail(_pos, _move, moveSpeed);
      }
    } else {
      emitAcc = 0;
      trailAcc = 0;
      tip.visible = false;
      hasPrev = false;
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      const u = s.age / s.life;
      if (u >= 1) {
        scene.remove(s.mesh);
        s.mesh.material?.dispose?.();
        sparks.splice(i, 1);
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y += 1.8 * dt;
      s.vel.multiplyScalar(Math.exp(-3.5 * dt));
      s.mesh.material.opacity = (1 - u) * (1 - u);
      s.mesh.scale.x *= Math.exp(-1.4 * dt);
    }

    for (let i = trails.length - 1; i >= 0; i--) {
      const t = trails[i];
      t.age += dt;
      const u = t.age / t.life;
      if (u >= 1) {
        scene.remove(t.mesh);
        t.mesh.material?.dispose?.();
        trails.splice(i, 1);
        continue;
      }
      t.mesh.position.addScaledVector(t.vel, dt);
      t.vel.multiplyScalar(Math.exp(-2.2 * dt));
      t.vel.y += 0.35 * dt;
      t.mesh.material.opacity = (1 - u) * (1 - u);
      t.mesh.scale.setScalar(0.5625 + u * 1.0625);
    }
  }

  function dispose() {
    clear();
    scene.remove(tip);
    tipGeo.dispose();
    tipMat.dispose();
    sparkGeo.dispose();
    trailGeo.dispose();
    fuseTex.dispose();
    streakTex.dispose();
  }

  return { bind, setActive, clear, update, dispose };
}
