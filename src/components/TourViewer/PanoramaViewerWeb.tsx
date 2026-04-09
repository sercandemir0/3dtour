import { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { Scene } from '@/src/types/tour';

interface Props {
  scene: Scene;
  scenes: Scene[];
  onHotspotClick?: (targetSceneId: string) => void;
}

function PanoramaSphere({ imageUrl }: { imageUrl: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, imageUrl);

  useEffect(() => {
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
  }, [texture]);

  return (
    <mesh ref={meshRef} scale={[-1, 1, 1]}>
      <sphereGeometry args={[500, 64, 32]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}

function CameraControls() {
  const { camera, gl } = useThree();
  const isDragging = useRef(false);
  const previousMouse = useRef({ x: 0, y: 0 });
  const rotation = useRef({ lon: 0, lat: 0 });

  useEffect(() => {
    const domElement = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      isDragging.current = true;
      previousMouse.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - previousMouse.current.x;
      const dy = e.clientY - previousMouse.current.y;
      previousMouse.current = { x: e.clientX, y: e.clientY };

      rotation.current.lon -= dx * 0.2;
      rotation.current.lat = Math.max(-85, Math.min(85, rotation.current.lat + dy * 0.2));
    };

    const onPointerUp = () => {
      isDragging.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const fov = (camera as THREE.PerspectiveCamera).fov;
      (camera as THREE.PerspectiveCamera).fov = Math.max(30, Math.min(100, fov + e.deltaY * 0.05));
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    };

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointerleave', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointerleave', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
    };
  }, [camera, gl]);

  useFrame(() => {
    const { lon, lat } = rotation.current;
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);

    const target = new THREE.Vector3(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );

    camera.lookAt(target);
  });

  return null;
}

function HotspotMarkers({
  hotspots,
  onHotspotClick,
}: {
  hotspots: Scene['hotspots'];
  onHotspotClick?: (targetSceneId: string) => void;
}) {
  if (!hotspots?.length) return null;

  return (
    <>
      {hotspots
        .filter((h) => h.target_scene_id && h.yaw != null && h.pitch != null)
        .map((hotspot) => {
          const phi = THREE.MathUtils.degToRad(90 - hotspot.pitch!);
          const theta = THREE.MathUtils.degToRad(hotspot.yaw!);
          const r = 50;

          const x = r * Math.sin(phi) * Math.cos(theta);
          const y = r * Math.cos(phi);
          const z = r * Math.sin(phi) * Math.sin(theta);

          return (
            <mesh
              key={hotspot.id}
              position={[x, y, z]}
              onClick={() => onHotspotClick?.(hotspot.target_scene_id!)}
            >
              <circleGeometry args={[2, 32]} />
              <meshBasicMaterial
                color="#8b5cf6"
                transparent
                opacity={0.8}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}
    </>
  );
}

export function PanoramaViewerWeb({ scene, scenes, onHotspotClick }: Props) {
  if (!scene.panorama_url) return null;

  return (
    <View style={styles.container}>
      <Canvas
        camera={{ fov: 75, position: [0, 0, 0.1] }}
        style={{ width: '100%', height: '100%' }}
      >
        <PanoramaSphere imageUrl={scene.panorama_url} />
        <CameraControls />
        <HotspotMarkers
          hotspots={scene.hotspots}
          onHotspotClick={onHotspotClick}
        />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
