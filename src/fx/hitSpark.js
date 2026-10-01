import * as THREE from "three";

/**
 * Kısa vuruş / parry isabet kıvılcımı (temas noktasında).
 */
export function createHitSparkFx(scene) {
  const active = [];
  const geo = new THREE.PlaneGeometry(0.12, 0.02);
  const _q = new THREE.Quaternion();
  const _z = new THREE.Vector3(0, 0, 1);

  function spawn(worldPos, { color = 0xffffff, count = 10 } = {}) {
    if (!worldPos) return;
    const origin = worldPos.clone();
    origin.z = 0;
    // Zemin altı kıvılcım görünmesin
    if (origin.y < 0.02) origin.y = 0.02;

    // Merkez flaş
    const flashMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 16),
      flashMat,
    );
    flash.position.copy(origin);
    flash.lookAt(origin.x, origin.y, origin.z + 1);
    flash.renderOrder = 20;
    scene.add(flash);
    active.push({
      type: "flash",
      mesh: flash,
      age: 0,
      life: 0.18,
    });

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.35;
      const speed = 2.2 + Math.random() * 3.4;
      const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
      _q.setFromUnitVectors(_z, new THREE.Vector3(dir.x, dir.y, 0.001).normalize());
      mesh.quaternion.copy(_q);
      mesh.scale.set(0.6 + Math.random() * 1.4, 1, 1);
      mesh.renderOrder = 21;
      scene.add(mesh);
      active.push({
        type: "spark",
        mesh,
        age: 0,
        life: 0.22 + Math.random() * 0.16,
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
        if (s.type === "flash") s.mesh.geometry?.dispose?.();
        active.splice(i, 1);
        continue;
      }
      if (s.type === "flash") {
        const t = 1 - u;
        s.mesh.scale.setScalar(1 + u * 4.5);
        s.mesh.material.opacity = 0.95 * t * t;
      } else {
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.multiplyScalar(Math.exp(-6 * dt));
        s.mesh.material.opacity = 0.9 * (1 - u) * (1 - u);
        s.mesh.scale.x *= Math.exp(-1.2 * dt);
      }
    }
  }

  return { spawn, update };
}
