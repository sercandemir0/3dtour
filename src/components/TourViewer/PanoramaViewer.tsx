import { Platform } from 'react-native';
import { PanoramaViewerWeb } from './PanoramaViewerWeb';
import { PanoramaViewerMobile } from './PanoramaViewerMobile';
import type { Scene } from '@/src/types/tour';

interface PanoramaViewerProps {
  scene: Scene;
  scenes: Scene[];
  onHotspotClick?: (targetSceneId: string) => void;
}

export function PanoramaViewer(props: PanoramaViewerProps) {
  if (Platform.OS === 'web') {
    return <PanoramaViewerWeb {...props} />;
  }
  return <PanoramaViewerMobile {...props} />;
}
