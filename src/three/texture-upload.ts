import { type Material, type Object3D, type Texture } from 'three';

/** Why a texture held by a material of a visible object holds no image on the GPU. */
export type TextureUploadFailureReason =
  /** Marked for upload, but it has no image (three warns "no image data found"). */
  | 'no-image'
  /** Marked for upload while its image was still loading (three warns "image is incomplete"). */
  | 'image-incomplete'
  /** Marked for upload and never uploaded, for a reason three reports nowhere else. */
  | 'not-uploaded'
  /** Uploaded, but the image has no pixels: a source that failed to decode is 0x0. */
  | 'empty-image';

export type TextureUploadFailure = Readonly<{
  /** The material property or `uniforms.<name>` that holds the texture. */
  slot: string;
  /** `Texture.name`; empty when the author never named it. */
  texture: string;
  /** `Object3D.name` of the first visible object that uses it; empty when unnamed. */
  object: string;
  /** `Material.name`, or its `type` when unnamed. */
  material: string;
  reason: TextureUploadFailureReason;
}>;

/** Makes three attempt the upload of `texture` if no draw has, then returns the version it recorded
 * as uploaded, or `undefined` when it recorded none. The adapter does that with
 * `renderer.initTexture` and `renderer.properties`. The attempt matters: three uploads a texture only
 * when a draw samples it, so without it a valid texture of a culled object would look not uploaded. */
export type UploadedVersion = (texture: Texture) => number | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const flagged = (value: unknown, flag: string): boolean => isRecord(value) && value[flag] === true;
const isTexture = (value: unknown): value is Texture => flagged(value, 'isTexture');
const isMaterial = (value: unknown): value is Material => flagged(value, 'isMaterial');

/** Textures set on a material property, and on a `ShaderMaterial` uniform (a value or an array). */
const texturesOf = (material: Material): readonly (readonly [string, Texture])[] => {
  const found: (readonly [string, Texture])[] = [];
  for (const [key, value] of Object.entries(material)) {
    if (isTexture(value)) found.push([key, value]);
    if (key !== 'uniforms' || !isRecord(value)) continue;
    for (const [name, uniform] of Object.entries(value)) {
      const held: unknown = isRecord(uniform) ? uniform['value'] : undefined;
      for (const texture of Array.isArray(held) ? held : [held])
        if (isTexture(texture)) found.push([`uniforms.${name}`, texture]);
    }
  }
  return found;
};

/** The pixel size an image source reports; an unknown source is not reported as empty. */
const hasNoPixels = (image: unknown): boolean => {
  if (Array.isArray(image))
    return image.some((face: unknown) => face === null || face === undefined || hasNoPixels(face));
  if (!isRecord(image)) return false;
  const { width, height } = image;
  return width === 0 || height === 0;
};

/** Textures that render to or are driven by something else are not an upload of an author's image. */
const isUploadedFromImage = (texture: Texture): boolean =>
  !texture.isRenderTargetTexture &&
  !flagged(texture, 'isVideoTexture') &&
  !flagged(texture, 'isExternalTexture');

const reasonFor = (
  texture: Texture,
  uploadedVersion: UploadedVersion,
): TextureUploadFailureReason | undefined => {
  // `version` stays 0 until the author sets `needsUpdate`; three uploads nothing for it and says
  // nothing either, which is an unfinished texture rather than an upload that failed.
  if (texture.version === 0 || !isUploadedFromImage(texture)) return undefined;
  if (uploadedVersion(texture) !== texture.version) {
    const image: unknown = texture.image;
    if (image === null || image === undefined) return 'no-image';
    if (isRecord(image) && image['complete'] === false) return 'image-incomplete';
    return 'not-uploaded';
  }
  return hasNoPixels(texture.image) ? 'empty-image' : undefined;
};

/**
 * The textures of `Object3D.visible` objects' materials whose upload did not happen or uploaded
 * nothing.
 *
 * three has no callback for an upload: it warns on the console and renders the material with an
 * empty texture. It does record the version it last uploaded per texture, so once the upload has
 * been attempted a texture that was marked for update (`version > 0`) and whose recorded version
 * differs never reached the GPU. That is deterministic: it reads state, not console output. A
 * texture whose image has no pixels is the other observable outcome, because a source that failed
 * to decode reports 0x0 and three uploads that without a warning.
 *
 * The verdict is a function of the scene and its textures, never of which draws happened or in
 * which order: `uploadedVersion` attempts every checked upload itself, so a valid texture that no
 * draw sampled (a frustum-culled object, `Material.visible = false`, a layer the camera does not
 * render, a uniform the shader never reads) is uploaded then and passes, and a frame sought fresh
 * gives the verdict of the same frame sought after others. Objects with `Object3D.visible = false`
 * are not walked, and neither is a texture the scene does not reference.
 *
 * Not covered: an upload three accepts and the GPU rejects (for example a `DataTexture` whose data
 * is shorter than its size, or one beyond `MAX_TEXTURE_SIZE`), which only `gl.getError()` shows.
 */
export const findTextureUploadFailures = (
  scene: Object3D,
  uploadedVersion: UploadedVersion,
): readonly TextureUploadFailure[] => {
  const failures: TextureUploadFailure[] = [];
  const seen = new Set<Texture>();
  scene.traverseVisible((object) => {
    const held: unknown = isRecord(object) ? object['material'] : undefined;
    const materials: readonly unknown[] = Array.isArray(held) ? held : [held];
    for (const material of materials) {
      if (!isMaterial(material)) continue;
      for (const [slot, texture] of texturesOf(material)) {
        if (seen.has(texture)) continue;
        seen.add(texture);
        const reason = reasonFor(texture, uploadedVersion);
        if (reason === undefined) continue;
        failures.push({
          slot,
          texture: texture.name,
          object: object.name,
          material: material.name === '' ? material.type : material.name,
          reason,
        });
      }
    }
  });
  return failures;
};
