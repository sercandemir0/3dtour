import * as VideoThumbnails from 'expo-video-thumbnails';

export interface ExtractedFrame {
  uri: string;
  timeMs: number;
}

/**
 * Extracts N evenly-spaced thumbnail frames from a video.
 * Uses expo-video-thumbnails which works on iOS/Android.
 * On web, returns an empty array (not supported).
 */
export async function extractFrames(
  videoUri: string,
  count: number = 8,
  durationMs: number = 30000,
): Promise<ExtractedFrame[]> {
  const frames: ExtractedFrame[] = [];
  const interval = durationMs / (count + 1);

  for (let i = 1; i <= count; i++) {
    const timeMs = Math.round(interval * i);
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: timeMs,
        quality: 0.8,
      });
      frames.push({ uri: thumb.uri, timeMs });
    } catch {
      // Some timestamps may fail for short videos; skip them
    }
  }

  return frames;
}
