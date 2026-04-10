import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { Scene } from '@/src/types/tour';
import { getGuidedPanoramaUris } from '@/src/utils/sceneProjection';
import { getSceneStitchedAsset, getSceneViewerMode } from '@/src/utils/sceneState';
import { resolveToDataUri } from '@/src/utils/imageUri';

interface Props {
  scene: Scene;
  scenes: Scene[];
  onHotspotClick?: (targetSceneId: string) => void;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function buildGuidedPanoramaTexture(sourceUris: string[]): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const segmentWidth = canvas.width / sourceUris.length;
  const images = await Promise.all(sourceUris.map((uri) => loadImage(uri)));

  images.forEach((image, index) => {
    const scale = Math.max(segmentWidth / image.width, canvas.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const dx = index * segmentWidth + (segmentWidth - drawWidth) / 2;
    const dy = (canvas.height - drawHeight) / 2;

    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  });

  return canvas.toDataURL('image/jpeg', 0.92);
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
  const stitchedUri = getSceneStitchedAsset(scene)?.uri ?? null;
  const viewerMode = getSceneViewerMode(scene);
  const guidedUris = useMemo(
    () => (viewerMode === 'preview' ? getGuidedPanoramaUris(scene) : null),
    [scene, viewerMode],
  );
  const fallbackPanoramaUrl = stitchedUri ?? scene.panorama_url ?? '';
  const [panoramaUrl, setPanoramaUrl] = useState(fallbackPanoramaUrl);
  const [loadingProjection, setLoadingProjection] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingProjection(true);

    (async () => {
      try {
        if (guidedUris?.length) {
          const dataUrl = await buildGuidedPanoramaTexture(guidedUris);
          if (!cancelled) setPanoramaUrl(dataUrl);
        } else {
          const resolved = await resolveToDataUri(fallbackPanoramaUrl);
          if (!cancelled) setPanoramaUrl(resolved);
        }
      } catch {
        if (!cancelled) setPanoramaUrl(fallbackPanoramaUrl);
      } finally {
        if (!cancelled) setLoadingProjection(false);
      }
    })();

    return () => { cancelled = true; };
  }, [fallbackPanoramaUrl, guidedUris]);

  if (!fallbackPanoramaUrl && !guidedUris?.length) return null;

  return (
    <View style={styles.container}>
      <View style={styles.modeBadge}>
        <Text style={styles.modeBadgeText}>
          {viewerMode === 'stitched'
            ? 'Islenmis panorama'
            : viewerMode === 'preview'
              ? 'Onizleme 360'
              : 'Legacy panorama'}
        </Text>
      </View>
      {loadingProjection && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8b5cf6" />
          <Text style={styles.loadingText}>360 goruntu hazirlaniyor...</Text>
        </View>
      )}
      <Canvas
        camera={{ fov: 75, position: [0, 0, 0.1] }}
        style={{ width: '100%', height: '100%' }}
      >
        <PanoramaSphere imageUrl={panoramaUrl} />
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
  modeBadge: {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  modeBadgeText: {
    color: '#f5f3ff',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  loadingText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
});
