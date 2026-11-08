import {
  BoxGeometry,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  Texture,
  type Material,
} from 'three';
import { describe, expect, it } from 'vitest';

import { findTextureUploadFailures, type UploadedVersion } from './texture-upload.ts';

/** A texture marked for upload (`version` 1) whose image is `image`. */
const marked = (image: unknown, name = ''): Texture => {
  const texture = new Texture();
  texture.image = image;
  texture.name = name;
  texture.needsUpdate = true;
  return texture;
};

/** What three would have recorded after rendering: each given texture uploaded at its version. */
const uploaded =
  (...textures: readonly Texture[]): UploadedVersion =>
  (texture) =>
    textures.includes(texture) ? texture.version : undefined;

const sceneOf = (...materials: readonly Material[]): Scene => {
  const scene = new Scene();
  for (const material of materials) scene.add(new Mesh(new BoxGeometry(), material));
  return scene;
};

const pixels = { width: 2, height: 2 };

describe('findTextureUploadFailures', () => {
  it('finds nothing for a texture that was uploaded and has pixels', () => {
    const texture = marked(pixels, 'good');
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));

    expect(findTextureUploadFailures(scene, uploaded(texture))).toEqual([]);
  });

  it('reports a texture marked for update that has no image', () => {
    const texture = marked(null, 'missing');
    const scene = sceneOf(new MeshBasicMaterial({ map: texture, name: 'sign' }));
    const [poster] = scene.children;
    if (poster === undefined) throw new Error('no object');
    poster.name = 'poster';

    expect(findTextureUploadFailures(scene, uploaded())).toEqual([
      { slot: 'map', texture: 'missing', object: 'poster', material: 'sign', reason: 'no-image' },
    ]);
  });

  it('reports a texture whose image was still loading when it was marked for update', () => {
    const texture = marked({ complete: false, width: 0, height: 0 });
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));

    expect(findTextureUploadFailures(scene, uploaded())).toMatchObject([
      { texture: '', material: 'MeshBasicMaterial', reason: 'image-incomplete' },
    ]);
  });

  it('reports an uploaded texture whose image has no pixels, which is a source that failed to decode', () => {
    const texture = marked({ complete: true, width: 0, height: 0 });
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));

    expect(findTextureUploadFailures(scene, uploaded(texture))).toMatchObject([
      { slot: 'map', reason: 'empty-image' },
    ]);
  });

  it('reports a cube texture with a missing face as empty', () => {
    const texture = marked([pixels, null, pixels, pixels, pixels, pixels]);
    const scene = sceneOf(new MeshBasicMaterial({ envMap: texture }));

    expect(findTextureUploadFailures(scene, uploaded(texture))).toMatchObject([
      { slot: 'envMap', reason: 'empty-image' },
    ]);
  });

  it('reports a not-uploaded texture with an image that is not incomplete', () => {
    const texture = marked(pixels);
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));

    expect(findTextureUploadFailures(scene, uploaded())).toMatchObject([
      { reason: 'not-uploaded' },
    ]);
  });

  it('re-reports a texture that was uploaded before it was marked for update again', () => {
    const texture = marked(pixels);
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));
    const staleVersion: UploadedVersion = () => texture.version - 1;

    expect(findTextureUploadFailures(scene, staleVersion)).toHaveLength(1);
  });

  it('skips a texture the author never marked for update', () => {
    const scene = sceneOf(new MeshBasicMaterial({ map: new Texture() }));

    expect(findTextureUploadFailures(scene, uploaded())).toEqual([]);
  });

  it('skips render target, video and external textures', () => {
    const renderTarget = marked(null);
    renderTarget.isRenderTargetTexture = true;
    const video = Object.assign(marked(null), { isVideoTexture: true });
    const external = Object.assign(marked(null), { isExternalTexture: true });
    const scene = sceneOf(
      new MeshBasicMaterial({ map: renderTarget }),
      new MeshBasicMaterial({ map: video }),
      new MeshBasicMaterial({ map: external }),
    );

    expect(findTextureUploadFailures(scene, uploaded())).toEqual([]);
  });

  it('finds textures in ShaderMaterial uniforms, single or in an array', () => {
    const single = marked(null, 'single');
    const first = marked(null, 'first');
    const material = new ShaderMaterial({
      uniforms: {
        uMap: { value: single },
        uList: { value: [first, 3] },
        uNumber: { value: 1 },
      },
    });

    const failures = findTextureUploadFailures(sceneOf(material), uploaded());

    expect(failures.map((failure) => [failure.slot, failure.texture])).toEqual([
      ['uniforms.uMap', 'single'],
      ['uniforms.uList', 'first'],
    ]);
  });

  it('checks every material of a multi-material object, and a shared texture once', () => {
    const shared = marked(null, 'shared');
    const other = marked(null, 'other');
    const scene = new Scene();
    scene.add(
      new Mesh(new BoxGeometry(), [
        new MeshBasicMaterial({ map: shared }),
        new MeshBasicMaterial({ map: shared, alphaMap: other }),
      ]),
    );

    expect(findTextureUploadFailures(scene, uploaded()).map((failure) => failure.texture)).toEqual([
      'shared',
      'other',
    ]);
  });

  it('ignores invisible objects, because three does not render them', () => {
    const scene = sceneOf(new MeshBasicMaterial({ map: marked(null) }));
    for (const object of scene.children) object.visible = false;

    expect(findTextureUploadFailures(scene, uploaded())).toEqual([]);
  });

  it('is deterministic: the same scene and record give the same failures', () => {
    const scene = sceneOf(new MeshBasicMaterial({ map: marked(null, 'a') }));

    expect(findTextureUploadFailures(scene, uploaded())).toEqual(
      findTextureUploadFailures(scene, uploaded()),
    );
  });

  it('accepts a DataTexture, whose image is a plain object with pixels', () => {
    const texture = new DataTexture(new Uint8Array(16), 2, 2);
    texture.needsUpdate = true;
    const scene = sceneOf(new MeshBasicMaterial({ map: texture }));

    expect(findTextureUploadFailures(scene, uploaded(texture))).toEqual([]);
  });
});
