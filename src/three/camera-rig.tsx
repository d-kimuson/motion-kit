import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useState } from 'react';
import { OrthographicCamera, PerspectiveCamera, type Camera } from 'three';

import { useCompositionFrame } from '../core/composition/composition.tsx';
import { useTime } from '../core/timeline/hooks.ts';

export type Vector3Tuple = readonly [number, number, number];

/** An absolute camera pose. Every field is written on every settled frame, so no frame can inherit
 * one from the frame rendered before it. An omitted `fov` or `zoom` is restored to the value the
 * camera had at mount. */
export type CameraPose = Readonly<{
  position: Vector3Tuple;
  /** Defaults to `[0, 0, 0]`. */
  lookAt?: Vector3Tuple;
  /** Defaults to `[0, 1, 0]`. */
  up?: Vector3Tuple;
  /** Perspective cameras only. Omitted: the camera's `fov` at mount. */
  fov?: number;
  /** Perspective and orthographic cameras. Omitted: the camera's `zoom` at mount. */
  zoom?: number;
}>;

export type CameraRigProps = Readonly<{ pose: (time: number) => CameraPose }>;

const defaultLookAt: Vector3Tuple = [0, 0, 0];
const defaultUp: Vector3Tuple = [0, 1, 0];

/** The projection the camera had before the first pose. A pose that omits `fov`/`zoom` restores
 * these, so the value never comes from the frame rendered before. */
type MountProjection = Readonly<{ fov?: number; zoom?: number }>;

const mountProjection = (camera: Camera): MountProjection =>
  camera instanceof PerspectiveCamera
    ? { fov: camera.fov, zoom: camera.zoom }
    : camera instanceof OrthographicCamera
      ? { zoom: camera.zoom }
      : {};

const applyPose = (camera: Camera, pose: CameraPose, mount: MountProjection): void => {
  camera.position.set(...pose.position);
  camera.up.set(...(pose.up ?? defaultUp));
  camera.lookAt(...(pose.lookAt ?? defaultLookAt));
  if (camera instanceof PerspectiveCamera) {
    const fov = pose.fov ?? mount.fov;
    const zoom = pose.zoom ?? mount.zoom;
    // Omitted only when the camera was replaced by one of a different kind; leave it alone then.
    if (fov === undefined || zoom === undefined) return;
    if (camera.fov === fov && camera.zoom === zoom) return;
    camera.fov = fov;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  } else if (camera instanceof OrthographicCamera) {
    const zoom = pose.zoom ?? mount.zoom;
    if (zoom === undefined || camera.zoom === zoom) return;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
};

/** Writes an absolute camera pose from motion-kit time on every settled frame.
 *
 * No `useFrame`: the pose is computed during React commit, so the canvas stays Tier B and no
 * frame of it is spent reading a delta or a prior pose.
 */
export const CameraRig = ({ pose }: CameraRigProps): null => {
  const camera = useThree((state) => state.camera);
  const time = useTime();
  const { generation } = useCompositionFrame();
  // Captured before the first pose is applied, and never re-read: the pose is absolute against it.
  const [mount] = useState(() => mountProjection(camera));
  useLayoutEffect(() => {
    applyPose(camera, pose(time), mount);
  }, [camera, generation, mount, pose, time]);
  return null;
};
