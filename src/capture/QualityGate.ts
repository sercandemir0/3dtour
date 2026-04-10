/**
 * QualityGate — post-capture quality validation for panorama frames.
 *
 * Runs entirely on-device using pixel data from the captured image.
 * Three checks:
 *   1. Blur detection via Laplacian variance
 *   2. Exposure consistency (average brightness vs session baseline)
 *   3. Stability verification (was the device stable during capture)
 */

export type ValidationResult = 'passed' | 'warning' | 'failed';

export interface QualityReport {
  blurScore: number;
  brightnessAvg: number;
  validation: ValidationResult;
  issues: string[];
}

const BLUR_THRESHOLD = 80;
const BLUR_FAIL_THRESHOLD = 30;
const BRIGHTNESS_WARN_RATIO = 0.25;

/**
 * Compute Laplacian variance as a sharpness/blur metric.
 * Input: grayscale pixel buffer, width, height.
 * Higher value = sharper image.
 */
export function computeBlurScore(gray: Uint8Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -gray[idx - w] -
        gray[idx - 1] +
        4 * gray[idx] -
        gray[idx + 1] -
        gray[idx + w];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * Compute average brightness of grayscale pixel data (0-255).
 */
export function computeBrightness(gray: Uint8Array): number {
  if (gray.length === 0) return 128;
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

/**
 * Convert RGBA pixel data to grayscale.
 */
export function rgbaToGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/**
 * Run quality checks on a captured frame.
 *
 * @param gray - Grayscale pixel buffer of the (downscaled) image
 * @param w - Width of the downscaled image
 * @param h - Height of the downscaled image
 * @param sessionAvgBrightness - Running average brightness of all frames so far (or null if first frame)
 * @param wasStable - Whether the device was stable during capture
 */
export function validateFrame(
  gray: Uint8Array,
  w: number,
  h: number,
  sessionAvgBrightness: number | null,
  wasStable: boolean,
): QualityReport {
  const blurScore = computeBlurScore(gray, w, h);
  const brightnessAvg = computeBrightness(gray);
  const issues: string[] = [];
  let worst: ValidationResult = 'passed';

  if (blurScore < BLUR_FAIL_THRESHOLD) {
    issues.push('Fotoğraf çok bulanık — lütfen sabit tutun ve tekrar çekin');
    worst = 'failed';
  } else if (blurScore < BLUR_THRESHOLD) {
    issues.push('Hafif bulanıklık algılandı — mümkünse sabit tutun');
    if (worst !== 'failed') worst = 'warning';
  }

  if (sessionAvgBrightness != null) {
    const diff = Math.abs(brightnessAvg - sessionAvgBrightness) / Math.max(1, sessionAvgBrightness);
    if (diff > BRIGHTNESS_WARN_RATIO) {
      issues.push('Pozlama farkı — ışığa/gölgeye dikkat edin');
      if (worst !== 'failed') worst = 'warning';
    }
  }

  if (!wasStable) {
    issues.push('Cihaz hareket halindeydi — sabit tutmayı deneyin');
    if (worst !== 'failed') worst = 'warning';
  }

  return { blurScore, brightnessAvg, validation: worst, issues };
}
