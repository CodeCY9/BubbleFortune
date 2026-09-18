import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Mesh } from 'three';

export const StageEnvironment: React.FC<{ asset: string; lowQuality?: boolean }> = ({ asset, lowQuality = false }) => {
  const { scene } = useGLTF(asset);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse(object => {
      if (object instanceof Mesh) {
        // The stage receives light but does not need to cast 26 extra shadows.
        object.receiveShadow = !lowQuality;
        object.castShadow = false;
      }
    });
    return clone;
  }, [scene, lowQuality]);
  return <primitive object={model} dispose={null} />;
};
