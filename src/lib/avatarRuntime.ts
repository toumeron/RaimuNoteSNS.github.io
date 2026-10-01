import { AnimationClip, Box3, Group, Mesh, Object3D, Texture, Vector3 } from 'three';

/** Release shared geometries/materials/textures once, including stale asynchronous loads. */
export function disposeAvatarObject(object: Object3D) {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<import('three').Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<import('three').Skeleton>();
  object.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: import('three').Skeleton };
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      // ShaderMaterial uniforms (including MMD) may also own textures.
      for (const value of Object.values(material)) {
        if ((value as Texture)?.isTexture) textures.add(value as Texture);
      }
      const uniforms = (material as import('three').ShaderMaterial).uniforms;
      for (const uniform of Object.values(uniforms || {})) {
        if ((uniform.value as Texture)?.isTexture) textures.add(uniform.value as Texture);
      }
      materials.add(material);
    }
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material: import('three').Material) => material.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

/** A wrapper preserves authored transforms and provides a consistent floor and camera scale. */
export function normalizeAvatarObject(object: Object3D) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object, true);
  const size = box.getSize(new Vector3());
  if (box.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || size.y < 1e-6) {
    throw new Error('モデルに表示可能な立体がありません');
  }
  const stage = new Group();
  stage.add(object);
  stage.scale.setScalar(1.55 / size.y);
  stage.updateMatrixWorld(true);
  box.setFromObject(stage, true);
  const center = box.getCenter(new Vector3());
  stage.position.set(-center.x, -box.min.y, -center.z);
  stage.updateMatrixWorld(true);
  const normalized = new Box3().setFromObject(stage, true);
  return { stage, box: normalized, size: normalized.getSize(new Vector3()) };
}

/** Never start a walk, death, or attack animation simply because it is first in the file. */
export function selectIdleClip(clips: AnimationClip[]) {
  return clips.find((clip) => /(^|[|:_.\s-])(idle|stand(?:ing)?|rest)([|:_.\s-]|$)/i.test(clip.name));
}
