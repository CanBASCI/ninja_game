import * as THREE from "three";

/**
 * Perfect parry — karakterlerin değdiği noktada kısa çarpışma işareti
 * (merkez flaş + halka + çapraz çizgiler).
 */
export function createParryClashFx(scene) {
  const active = [];
  const streakGeo = new THREE.PlaneGeometry(0.22, 0.028);
  const _q = new THREE.Quaternion();
  const _z = new THREE.Vector3(0, 0, 1);

  function spawn(worldPos, { color = 0xff9a2e } = {}) {
    if (!worldPos) return;
    const origin = worldPos.clone();
    origin.z = 0.05;

    // Merkez disk — temas alanı
    const coreMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), coreMat);
    core.position.copy(origin);
    core.lookAt(origin.x, origin.y, origin.z + 1);
    core.renderOrder = 28;
    scene.add(core);
    active.push({ type: "core", mesh: core, age: 0, life: 0.28 });

    // Genişleyen ince halka
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff7a18,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 32),
      ringMat,
    );
    ring.position.copy(origin);
    ring.lookAt(origin.x, origin.y, origin.z + 1);
    ring.renderOrder = 27;
    scene.add(ring);
    active.push({ type: "ring", mesh: ring, age: 0, life: 0.38 });

    // Çapraz çarpışma çizgileri (X) — temas düzlemi
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0xffe0a0 : 0xff8c28,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.035),
        mat,
      );
      bar.position.copy(origin);
      bar.lookAt(origin.x, origin.y, origin.z + 1);
      bar.rotateZ(i === 0 ? Math.PI * 0.22 : -Math.PI * 0.22);
      bar.renderOrder = 29;
      scene.add(bar);
      active.push({ type: "cross", mesh: bar, age: 0, life: 0.32 });
    }

    // Kısa radial kıvılcımlar
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfff0c8 : color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(streakGeo, mat);
      mesh.position.copy(origin);
      const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.2;
      const speed = 3.2 + Math.random() * 4.2;
      const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
      _q.setFromUnitVectors(
        _z,
        new THREE.Vector3(dir.x, dir.y, 0.001).normalize(),
      );
      mesh.quaternion.copy(_q);
      mesh.scale.set(0.7 + Math.random() * 1.1, 1, 1);
      mesh.renderOrder = 30;
      scene.add(mesh);
      active.push({
        type: "spark",
        mesh,
        age: 0,
        life: 0.2 + Math.random() * 0.14,
        vel: dir.multiplyScalar(speed),
      });
    }
  }

  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const s = active[i];
      s.age += dt;
      const u = s.age / s.life;
      if (u >= 1) {
        scene.remove(s.mesh);
        s.mesh.material?.dispose?.();
        if (s.type === "core" || s.type === "ring") {
          s.mesh.geometry?.dispose?.();
        }
        if (s.type === "cross") s.mesh.geometry?.dispose?.();
        active.splice(i, 1);
        continue;
      }
      const fade = (1 - u) * (1 - u);
      if (s.type === "core") {
        s.mesh.scale.setScalar(1 + u * 2.8);
        s.mesh.material.opacity = fade;
      } else if (s.type === "ring") {
        s.mesh.scale.setScalar(1 + u * 5.5);
        s.mesh.material.opacity = 0.95 * fade;
      } else if (s.type === "cross") {
        s.mesh.scale.set(1 + u * 1.6, 1 - u * 0.5, 1);
        s.mesh.material.opacity = fade;
      } else {
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.multiplyScalar(Math.exp(-5.5 * dt));
        s.mesh.material.opacity = 0.95 * fade;
        s.mesh.scale.x *= Math.exp(-1.1 * dt);
      }
    }
  }

  function dispose() {
    for (const s of active) {
      scene.remove(s.mesh);
      s.mesh.material?.dispose?.();
      s.mesh.geometry?.dispose?.();
    }
    active.length = 0;
    streakGeo.dispose();
  }

  return { spawn, update, dispose };
}
