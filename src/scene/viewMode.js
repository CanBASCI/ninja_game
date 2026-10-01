import { sceneSettings } from "./sceneMenu.js";
import { lookSimple } from "../main_char/look.js";

/**
 * Kamera / bakış: 2D (düz yandan) | 2.5D (yöne göre orbit açısı).
 */
export function getViewCam(zoom = lookSimple.zoom) {
  const CAM_Z = zoom;
  if (sceneSettings.view === "2d") {
    return { CAM_Z, CAM_SIDE: 0, orbit: 0 };
  }
  const CAM_SIDE = Math.max(2.8, CAM_Z * 0.42);
  const orbit = Math.atan2(CAM_SIDE, CAM_Z) * 0.7;
  return { CAM_Z, CAM_SIDE, orbit };
}

/** Karakter yaw — facing +1 sağ / −1 sol */
export function facingYaw(facing, zoom = lookSimple.zoom) {
  const { orbit } = getViewCam(zoom);
  const f = facing >= 0 ? 1 : -1;
  const baseY = f > 0 ? Math.PI / 2 : -Math.PI / 2;
  return baseY - f * orbit;
}
