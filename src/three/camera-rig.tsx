import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { OrthographicCamera, PerspectiveCamera, type Camera } from 'three';

import { useCompositionFrame } from '../core/composition/composition.tsx';
import { useTime } from '../core/timeline/hooks.ts';

export type Vector3Tuple = readonly [number, number, number];

/** An absolute camera pose. Every field is written on every settled frame. */
export type CameraPose = Readonly<{
  position: Vector3Tuple;
  /** Defaults to `[0, 0, 0]`. */
  lookAt?: Vector3Tuple;
  /** Defaults to `[0, 1, 0]`. */
  up?: Vector3Tuple;
  /** Perspective cameras only. */
  fov?: number;
  /** Perspective and orthographic cameras. */
  zoom?: number;
}>;

export type CameraRigProps = Readonly<{ pose: (time: number) => CameraPose }>;

const defaultLookAt: Vector3Tuple = [0, 0, 0];
const defaultUp: Vector3Tuple = [0, 1, 0];

const applyPose = (camera: Camera, pose: CameraPose): void => {
  camera.position.set(...pose.position);
  camera.up.set(...(pose.up ?? defaultUp));
  camera.lookAt(...(pose.lookAt ?? defaultLookAt));
  if (camera instanceof PerspectiveCamera) {
    if (pose.fov !== undefined) camera.fov = pose.fov;
    if (pose.zoom !== undefined) camera.zoom = pose.zoom;
    if (pose.fov !== undefined || pose.zoom !== undefined) camera.updateProjectionMatrix();
  } else if (camera instanceof OrthographicCamera && pose.zoom !== undefined) {
    camera.zoom = pose.zoom;
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
  useLayoutEffect(() => {
    applyPose(camera, pose(time));
  }, [camera, generation, pose, time]);
  return null;
};
