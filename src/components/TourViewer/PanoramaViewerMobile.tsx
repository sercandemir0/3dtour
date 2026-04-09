import { useRef, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Scene } from '@/src/types/tour';
import { getGuidedPanoramaUris } from '@/src/utils/sceneProjection';

interface Props {
  scene: Scene;
  scenes: Scene[];
  onHotspotClick?: (targetSceneId: string) => void;
}

export function PanoramaViewerMobile({ scene, scenes, onHotspotClick }: Props) {
  const webViewRef = useRef<WebView>(null);
  const guidedUris = useMemo(() => getGuidedPanoramaUris(scene), [scene]);

  const hotspots = (scene.hotspots ?? [])
    .filter((h) => h.target_scene_id && h.yaw != null && h.pitch != null)
    .map((h) => ({
      id: h.id,
      pitch: h.pitch!,
      yaw: h.yaw!,
      type: 'scene' as const,
      text: h.label ?? '',
      sceneId: h.target_scene_id!,
    }));

  const html = useMemo(
    () => generatePannellumHTML(scene.panorama_url!, hotspots, guidedUris),
    [scene.id, scene.panorama_url, guidedUris, JSON.stringify(hotspots)],
  );

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'hotspot_click' && data.sceneId) {
        onHotspotClick?.(data.sceneId);
      }
    } catch {}
  };

  if (!scene.panorama_url) return null;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        allowsInlineMediaPlayback
        javaScriptEnabled
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}

function generatePannellumHTML(
  imageUrl: string,
  hotspots: { id: string; pitch: number; yaw: number; text: string; sceneId: string }[],
  guidedUris: string[] | null,
) {
  const hotspotsJSON = JSON.stringify(hotspots);
  const guidedUrisJSON = JSON.stringify(guidedUris ?? []);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css"/>
  <script src="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #panorama { width: 100%; height: 100%; }
    .pnlm-hotspot-base { cursor: pointer; }
    .custom-hotspot {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: rgba(139, 92, 246, 0.8);
      border: 3px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.6);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 12px rgba(139, 92, 246, 0.6); }
      50% { transform: scale(1.15); box-shadow: 0 0 20px rgba(139, 92, 246, 0.8); }
    }
  </style>
</head>
<body>
  <div id="panorama"></div>
  <script>
    var hotspots = ${hotspotsJSON};
    var guidedUris = ${guidedUrisJSON};

    var hotspotConfig = hotspots.map(function(h) {
      return {
        pitch: h.pitch,
        yaw: h.yaw,
        type: 'custom',
        cssClass: 'custom-hotspot',
        createTooltipFunc: function(div) {
          div.classList.add('custom-hotspot');
        },
        clickHandlerFunc: function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'hotspot_click',
            sceneId: h.sceneId
          }));
        }
      };
    });

    function loadImage(src) {
      return new Promise(function(resolve, reject) {
        var img = new Image();
        img.onload = function() { resolve(img); };
        img.onerror = reject;
        img.src = src;
      });
    }

    function buildGuidedPanorama(uris) {
      var canvas = document.createElement('canvas');
      canvas.width = 4096;
      canvas.height = 2048;
      var ctx = canvas.getContext('2d');

      if (!ctx) {
        return Promise.reject(new Error('Canvas context unavailable'));
      }

      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      return Promise.all(uris.map(loadImage)).then(function(images) {
        var segmentWidth = canvas.width / images.length;

        images.forEach(function(image, index) {
          var scale = Math.max(segmentWidth / image.width, canvas.height / image.height);
          var drawWidth = image.width * scale;
          var drawHeight = image.height * scale;
          var dx = index * segmentWidth + (segmentWidth - drawWidth) / 2;
          var dy = (canvas.height - drawHeight) / 2;
          ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
        });

        return canvas.toDataURL('image/jpeg', 0.92);
      });
    }

    function initPanorama(panoramaUrl) {
      pannellum.viewer('panorama', {
        type: 'equirectangular',
        panorama: panoramaUrl,
        autoLoad: true,
        showControls: false,
        mouseZoom: true,
        hfov: 100,
        minHfov: 30,
        maxHfov: 120,
        friction: 0.15,
        hotSpots: hotspotConfig
      });
    }

    if (guidedUris.length) {
      buildGuidedPanorama(guidedUris)
        .then(initPanorama)
        .catch(function() { initPanorama('${imageUrl}'); });
    } else {
      initPanorama('${imageUrl}');
    }
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
