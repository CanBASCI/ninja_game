import * as THREE from "three";

/**
 * Bomba patlaması — kısa flaş + parçacık halkası.
 * `radius` hasar alanıyla aynı dış yarıçapa kadar büyür.
 */
export function createExplosionFx(scene) {
  const active = [];
  const streakGeo = new THREE.PlaneGeometry(0.22, 0.035);
  const _q = new THREE.Quaternion();
  const _z = new THREE.Vector3(0, 0, 1);

  function spawn(
    worldPos,
    { color = 0xff7a20, count = 28, radius = 3 } = {},
  ) {
    if (!worldPos) return;
    const origin = worldPos.clone();
    origin.z = 0;
    const R = Math.max(0.5, radius);

    const flashStart = 0.35;
    const flashGrow = R / flashStart - 1;
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe6a0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(
      new THREE.CircleGeometry(flashStart, 24),
      flashMat,
    );
    flash.position.copy(origin);
    flash.lookAt(origin.x, origin.y, origin.z + 1);
    flash.renderOrder = 30;
    scene.add(flash);
    active.push({
      type: "flash",
      mesh: flash,
      age: 0,
      life: 0.32,
      grow: flashGrow,
    });

    const ringOuter = 0.22;
    const ringGrow = R / ringOuter - 1;
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.15, ringOuter, 28),
      ringMat,
    );
    ring.position.copy(origin);
    ring.lookAt(origin.x, origin.y, origin.z + 1);
    ring.renderOrder = 29;
    scene.add(ring);
    active.push({
      type: "ring",
      mesh: ring,
      age: 0,
      life: 0.4,
      grow: ringGrow,
    });

    // Kıvılcımlar hasar yarıçapına kadar saçılır
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffe08a : color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(streakGeo, mat);
      mesh.position.copy(origin);
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const life = 0.35 + Math.random() * 0.25;
      const reach = R * (0.55 + Math.random() * 0.45);
      const speed = reach / life;
      const dir = new THREE.Vector3(
        Math.cos(ang),
        Math.sin(ang) * 0.75 + 0.15,
        0,
      ).normalize();
      _q.setFromUnitVectors(
        _z,
        new THREE.Vector3(dir.x, dir.y, 0.001).normalize(),
      );
      mesh.quaternion.copy(_q);
      mesh.scale.set(1.2 + Math.random() * 1.8, 1, 1);
      mesh.renderOrder = 31;
      scene.add(mesh);
      active.push({
        type: "spark",
        mesh,
        age: 0,
        life,
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
        if (s.type === "flash" || s.type === "ring") s.mesh.geometry?.dispose?.();
        active.splice(i, 1);
        continue;
      }
      const t = 1 - u;
      if (s.type === "flash") {
        s.mesh.scale.setScalar(1 + u * s.grow);
        s.mesh.material.opacity = t * t;
      } else if (s.type === "ring") {
        s.mesh.scale.setScalar(1 + u * s.grow);
        s.mesh.material.opacity = 0.85 * t * t;
      } else {
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.multiplyScalar(Math.exp(-1.2 * dt));
        s.mesh.material.opacity = 0.95 * t * t;
        s.mesh.scale.x *= Math.exp(-0.9 * dt);
      }
    }
  }

  return { spawn, update };
}
