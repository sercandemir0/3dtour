/**
 * localStitch — client-side equirectangular canvas assembly.
 *
 * Takes captured frames with their yaw/pitch metadata and pastes them
 * onto a 4096×2048 equirectangular canvas. Each frame is positioned
 * according to its capture orientation and the camera's FOV.
 *
 * This is a "quick preview" stitch — not feature-matched or blended.
 * A proper server-side stitch can upgrade it later.
 *
 * Works only on web or via a WebView bridge on native.
 */
import { Platform } from 'react-native';
import type { CaptureFrame, CaptureSession } from './CaptureEngine';

export const EQUIRECT_W = 4096;
export const EQUIRECT_H = 2048;

/**
 * Map a (yawDeg, pitchDeg) to the equirectangular pixel coordinate
 * on a canvas of (EQUIRECT_W × EQUIRECT_H).
 *
 * yaw 0° → centre-left, 360° wraps. pitch 0° → vertical centre,
 * +90° → top, -90° → bottom.
 */
export function equirectCoord(
  yawDeg: number,
  pitchDeg: number,
): { x: number; y: number } {
  const x = ((yawDeg % 360 + 360) % 360 / 360) * EQUIRECT_W;
  const y = (0.5 - pitchDeg / 180) * EQUIRECT_H;
  return { x, y };
}

/**
 * Compute the pixel-space width/height of a single frame when projected
 * onto the equirectangular canvas.
 */
export function frameSizeOnCanvas(fovDeg: number): { w: number; h: number } {
  const w = (fovDeg / 360) * EQUIRECT_W;
  const h = (fovDeg / 180) * EQUIRECT_H;
  return { w, h };
}

/**
 * Generate an HTML document that can be loaded in a WebView to produce
 * the stitched equirectangular image as a data-URI.
 *
 * The WebView should post a message with the resulting data URI.
 */
export function buildStitchHTML(session: CaptureSession): string {
  const fov = session.deviceInfo.cameraFov || 70;
  const { w: fw, h: fh } = frameSizeOnCanvas(fov);
  const frames = session.frames;

  const imageLoaders = frames
    .map(
      (f, i) =>
        `loadImg("${f.uri}").then(img => images[${i}] = img)`,
    )
    .join(',\n    ');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><canvas id="c" width="${EQUIRECT_W}" height="${EQUIRECT_H}"></canvas>
<script>
  const W = ${EQUIRECT_W}, H = ${EQUIRECT_H};
  const fw = ${fw.toFixed(1)}, fh = ${fh.toFixed(1)};
  const frames = ${JSON.stringify(frames.map((f) => ({ yawDeg: f.yawDeg, pitchDeg: f.pitchDeg })))};

  function loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  const images = new Array(frames.length);
  Promise.all([
    ${imageLoaders}
  ]).then(() => {
    const ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const cx = ((f.yawDeg % 360 + 360) % 360 / 360) * W;
      const cy = (0.5 - f.pitchDeg / 180) * H;
      const dx = cx - fw / 2;
      const dy = cy - fh / 2;
      ctx.drawImage(images[i], dx, dy, fw, fh);
    }
    const data = document.getElementById('c').toDataURL('image/jpeg', 0.85);
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(data);
  }).catch(err => {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ERROR:' + err.message);
  });
</script></body></html>`;
}

/**
 * On web, run stitch directly via an off-screen canvas.
 * Returns a blob URL.
 */
export async function stitchOnWeb(session: CaptureSession): Promise<string | null> {
  if (Platform.OS !== 'web') return null;

  const fov = session.deviceInfo.cameraFov || 70;
  const { w: fw, h: fh } = frameSizeOnCanvas(fov);

  const canvas = document.createElement('canvas');
  canvas.width = EQUIRECT_W;
  canvas.height = EQUIRECT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, EQUIRECT_W, EQUIRECT_H);

  for (const f of session.frames) {
    try {
      const img = await loadImage(f.uri);
      const { x: cx, y: cy } = equirectCoord(f.yawDeg, f.pitchDeg);
      ctx.drawImage(img, cx - fw / 2, cy - fh / 2, fw, fh);
    } catch {
      // skip broken frame
    }
  }

  return new Promise<string>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : ''),
      'image/jpeg',
      0.85,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
