import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CaptureDirection,
  Tour,
  Scene,
  Hotspot,
  CaptureMode,
  SceneMediaType,
  SceneCaptureSource,
  SceneCaptureSet,
  SceneCaptureShot,
  SceneProjection,
  ProcessingJob,
  CaptureSession,
} from '@/src/types/tour';
import { CAPTURE_DIRECTIONS } from '@/src/types/tour';
import {
  startPanoramaPipeline,
  pollPanoramaPipeline,
} from '@/src/services/panoramaPipeline';
import {
  createEmptyCaptureSet,
  deriveCaptureStatus,
  deriveStitchStatus,
  getOrderedCaptureShots,
  getSceneCaptureStatus,
  getSceneStitchedAsset,
  getSceneThumbnailUri,
  getSceneViewerMode,
  isCaptureSetComplete,
} from '@/src/utils/sceneState';
import { buildPreviewProjectionFromCaptureSet } from '@/src/utils/sceneProjection';

const STORAGE_KEY = '@3dtour_tours';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function generateSlug(): string {
  return Math.random().toString(36).substring(2, 10);
}

interface TourState {
  tours: Tour[];
  currentTour: Tour | null;
  loading: boolean;

  fetchTours: () => Promise<void>;
  fetchTour: (id: string) => Promise<void>;
  createTour: (title: string, captureMode: CaptureMode, description?: string) => Promise<Tour>;
  createTourWithRooms: (
    title: string,
    captureMode: CaptureMode,
    roomNames: string[],
    description?: string,
  ) => Promise<Tour>;
  /** MVP: one tour + single default scene (no room list). */
  createTourWithDefaultScene: (
    title: string,
    captureMode: CaptureMode,
    description?: string,
  ) => Promise<Tour>;
  updateTour: (id: string, updates: Partial<Tour>) => Promise<void>;
  deleteTour: (id: string) => Promise<void>;

  addScene: (tourId: string, name: string, sceneType: Scene['scene_type']) => Promise<Scene>;
  updateScene: (id: string, updates: Partial<Scene>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  setSceneMedia: (sceneId: string, uri: string, mediaType: SceneMediaType) => Promise<void>;
  saveCaptureShot: (
    sceneId: string,
    direction: CaptureDirection,
    shot: Omit<SceneCaptureShot, 'direction'>,
  ) => Promise<SceneCaptureSet>;
  finalizeCaptureSet: (
    sceneId: string,
    mediaType?: SceneMediaType,
  ) => Promise<{ captureSet: SceneCaptureSet; previewProjection: SceneProjection | null }>;
  queueStitch: (sceneId: string) => Promise<ProcessingJob | null>;
  reconcileStitch: (sceneId: string) => Promise<void>;
  commitSceneCapture: (
    sceneId: string,
    payload: {
      primaryUri: string;
      sources: SceneCaptureSource[];
      sectorMask: boolean[];
      mediaType: SceneMediaType;
    },
  ) => Promise<{ projection: SceneProjection; processingJob: ProcessingJob | null }>;
  saveCaptureSession: (sceneId: string, session: CaptureSession) => Promise<void>;
  reorderScenes: (tourId: string, sceneIds: string[]) => Promise<void>;
  reconcileSceneProcessing: (sceneId: string) => Promise<void>;
  reconcileTourProcessing: (tourId: string) => Promise<void>;

  addHotspot: (hotspot: Omit<Hotspot, 'id' | 'created_at'>) => Promise<Hotspot>;
  deleteHotspot: (id: string) => Promise<void>;

  getIncompleteScenes: (tourId: string) => Scene[];
  getCompletedCount: (tourId: string) => { completed: number; total: number };
}

async function saveTours(tours: Tour[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tours));
}

async function loadTours(): Promise<Tour[]> {
  const data = await AsyncStorage.getItem(STORAGE_KEY);
  const tours = data ? JSON.parse(data) : [];
  return tours.map(normalizeTour);
}

function updateSceneInTours(
  tours: Tour[],
  sceneId: string,
  updates: Partial<Scene>,
): Tour[] {
  return tours.map((tour) => normalizeTour({
    ...tour,
    scenes: tour.scenes?.map((scene) => (
      scene.id === sceneId ? { ...scene, ...updates } : scene
    )),
  }));
}

function normalizeScene(scene: Scene): Scene {
  const captureSet = scene.capture_set ?? null;
  const captureSession = scene.capture_session ?? null;
  const captureStatus = scene.capture_status ?? deriveCaptureStatus(captureSet, captureSession);
  const previewProjection = scene.preview_projection
    ?? buildPreviewProjectionFromCaptureSet(captureSet)
    ?? scene.projection
    ?? null;
  const stitchedAsset = scene.stitched_asset ?? getSceneStitchedAsset(scene);
  const stitchStatus = scene.stitch_status ?? deriveStitchStatus({ ...scene, stitched_asset: stitchedAsset });
  const thumbnailUrl = scene.thumbnail_url ?? getSceneThumbnailUri({ ...scene, stitched_asset: stitchedAsset, preview_projection: previewProjection });

  return {
    ...scene,
    capture_set: captureSet,
    capture_status: captureStatus,
    stitch_status: stitchStatus,
    stitched_asset: stitchedAsset,
    preview_projection: previewProjection,
    thumbnail_url: thumbnailUrl,
  };
}

function normalizeTour(tour: Tour): Tour {
  return {
    ...tour,
    scenes: (tour.scenes ?? []).map(normalizeScene),
  };
}

function findScene(tours: Tour[], sceneId: string): Scene | null {
  return tours.flatMap((tour) => tour.scenes ?? []).find((scene) => scene.id === sceneId) ?? null;
}

export const useTourStore = create<TourState>((set, get) => ({
  tours: [],
  currentTour: null,
  loading: false,

  fetchTours: async () => {
    set({ loading: true });
    const tours = await loadTours();
    set({ tours, loading: false });
  },

  fetchTour: async (id) => {
    set({ loading: true });
    const tours = await loadTours();
    const tour = tours.find((t) => t.id === id) ?? null;
    set({ currentTour: tour, loading: false });
  },

  createTour: async (title, captureMode, description) => {
    const now = new Date().toISOString();
    const tour: Tour = {
      id: uuid(),
      user_id: 'local',
      title,
      description: description ?? null,
      cover_image_url: null,
      capture_mode: captureMode,
      status: 'draft',
      share_slug: generateSlug(),
      created_at: now,
      updated_at: now,
      scenes: [],
    };
    const tours = [tour, ...get().tours];
    await saveTours(tours);
    set({ tours });
    return tour;
  },

  createTourWithRooms: async (title, captureMode, roomNames, description) => {
    const now = new Date().toISOString();
    const tourId = uuid();
    const sceneType = captureMode === 'gaussian_splat'
      ? 'gaussian_splat' as const
      : captureMode === 'roomplan'
        ? 'roomplan' as const
        : 'panorama' as const;

    const scenes: Scene[] = roomNames.map((name, i) => ({
      id: uuid(),
      tour_id: tourId,
      name,
      scene_type: sceneType,
      media_type: null,
      panorama_url: null,
      splat_url: null,
      roomplan_url: null,
      thumbnail_url: null,
      order: i,
      initial_yaw: 0,
      initial_pitch: 0,
      initial_fov: 100,
      camera_position: null,
      camera_target: null,
      created_at: now,
      hotspots: [],
      capture_set: null,
      capture_session: null,
      capture_status: 'empty',
      stitch_status: 'idle',
      stitched_asset: null,
      preview_projection: null,
    }));

    const tour: Tour = {
      id: tourId,
      user_id: 'local',
      title,
      description: description ?? null,
      cover_image_url: null,
      capture_mode: captureMode,
      status: 'draft',
      share_slug: generateSlug(),
      created_at: now,
      updated_at: now,
      scenes,
    };

    const tours = [tour, ...get().tours];
    await saveTours(tours);
    set({ tours });
    return tour;
  },

  createTourWithDefaultScene: async (title, captureMode, description) => {
    const tour = await get().createTour(title, captureMode, description);
    const sceneType = captureMode === 'gaussian_splat'
      ? 'gaussian_splat' as const
      : captureMode === 'roomplan'
        ? 'roomplan' as const
        : 'panorama' as const;
    const sceneName =
      title.trim().length > 0 ? `${title.trim()} — görünüm` : 'Ana görünüm';
    await get().addScene(tour.id, sceneName, sceneType);
    const tours = await loadTours();
    const updated = tours.find((t) => t.id === tour.id) ?? tour;
    set({
      tours,
      currentTour: get().currentTour?.id === tour.id ? updated : get().currentTour,
    });
    return updated;
  },

  updateTour: async (id, updates) => {
    const tours = get().tours.map((t) =>
      t.id === id ? normalizeTour({ ...t, ...updates, updated_at: new Date().toISOString() }) : t
    );
    await saveTours(tours);
    set({
      tours,
      currentTour: get().currentTour?.id === id
        ? tours.find((tour) => tour.id === id) ?? get().currentTour
        : get().currentTour,
    });
  },

  deleteTour: async (id) => {
    const tours = get().tours.filter((t) => t.id !== id);
    await saveTours(tours);
    set({
      tours,
      currentTour: get().currentTour?.id === id ? null : get().currentTour,
    });
  },

  addScene: async (tourId, name, sceneType) => {
    const now = new Date().toISOString();
    const currentTour = get().tours.find((t) => t.id === tourId);
    const maxOrder = (currentTour?.scenes ?? []).reduce((max, s) => Math.max(max, s.order), -1);

    const scene: Scene = {
      id: uuid(),
      tour_id: tourId,
      name,
      scene_type: sceneType,
      media_type: null,
      panorama_url: null,
      splat_url: null,
      roomplan_url: null,
      thumbnail_url: null,
      order: maxOrder + 1,
      initial_yaw: 0,
      initial_pitch: 0,
      initial_fov: 100,
      camera_position: null,
      camera_target: null,
      created_at: now,
      hotspots: [],
      capture_set: null,
      capture_session: null,
      capture_status: 'empty',
      stitch_status: 'idle',
      stitched_asset: null,
      preview_projection: null,
    };

    const tours = get().tours.map((t) =>
      t.id === tourId ? normalizeTour({ ...t, scenes: [...(t.scenes ?? []), scene] }) : t
    );
    await saveTours(tours);
    const updatedTour = tours.find((t) => t.id === tourId) ?? null;
    set({ tours, currentTour: get().currentTour?.id === tourId ? updatedTour : get().currentTour });
    return scene;
  },

  updateScene: async (id, updates) => {
    const tours = get().tours.map((t) => normalizeTour({
      ...t,
      scenes: t.scenes?.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    await saveTours(tours);
    const currentTour = get().currentTour;
    if (currentTour?.scenes?.some((s) => s.id === id)) {
      set({
        tours,
        currentTour: tours.find((tour) => tour.id === currentTour.id) ?? currentTour,
      });
    } else {
      set({ tours });
    }
  },

  deleteScene: async (id) => {
    const tours = get().tours.map((t) => normalizeTour({
      ...t,
      scenes: t.scenes?.filter((s) => s.id !== id),
    }));
    await saveTours(tours);
    const currentTour = get().currentTour;
    set({
      tours,
      currentTour: currentTour
        ? { ...currentTour, scenes: currentTour.scenes?.filter((s) => s.id !== id) }
        : null,
    });
  },

  addHotspot: async (hotspotData) => {
    const hotspot: Hotspot = {
      ...hotspotData,
      id: uuid(),
      created_at: new Date().toISOString(),
    };

    const tours = get().tours.map((t) => ({
      ...t,
      scenes: t.scenes?.map((s) =>
        s.id === hotspotData.scene_id
          ? { ...s, hotspots: [...(s.hotspots ?? []), hotspot] }
          : s
      ),
    }));
    await saveTours(tours);

    const currentTour = get().currentTour;
    if (currentTour) {
      set({
        tours,
        currentTour: {
          ...currentTour,
          scenes: currentTour.scenes?.map((s) =>
            s.id === hotspotData.scene_id
              ? { ...s, hotspots: [...(s.hotspots ?? []), hotspot] }
              : s
          ),
        },
      });
    }
    return hotspot;
  },

  deleteHotspot: async (id) => {
    const tours = get().tours.map((t) => ({
      ...t,
      scenes: t.scenes?.map((s) => ({
        ...s,
        hotspots: s.hotspots?.filter((h) => h.id !== id),
      })),
    }));
    await saveTours(tours);

    const currentTour = get().currentTour;
    if (currentTour) {
      set({
        tours,
        currentTour: {
          ...currentTour,
          scenes: currentTour.scenes?.map((s) => ({
            ...s,
            hotspots: s.hotspots?.filter((h) => h.id !== id),
          })),
        },
      });
    }
  },

  setSceneMedia: async (sceneId, uri, mediaType) => {
    const updates: Partial<Scene> = {
      panorama_url: uri,
      thumbnail_url: uri,
      media_type: mediaType,
      capture_set: null,
      capture_status: 'empty',
      stitch_status: 'completed',
      stitched_asset: {
        uri,
        provider: 'local',
        job_id: null,
        created_at: new Date().toISOString(),
      },
      preview_projection: null,
      capture_sources: undefined,
      coverage_sector_mask: undefined,
      projection: {
        version: 1,
        kind: 'single_image',
        source_uris: [uri],
        provider: 'local',
      },
      processing_job: null,
    };
    await get().updateScene(sceneId, updates);
  },

  saveCaptureShot: async (sceneId, direction, shot) => {
    const scene = findScene(get().tours, sceneId);
    const currentCaptureSet = scene?.capture_set ?? createEmptyCaptureSet();
    const nextCaptureSet: SceneCaptureSet = {
      ...currentCaptureSet,
      shots: {
        ...currentCaptureSet.shots,
        [direction]: {
          ...shot,
          direction,
        },
      },
      primary_direction: currentCaptureSet.primary_direction ?? 'front',
      finalized_at: null,
    };

    const captureStatus = deriveCaptureStatus(nextCaptureSet);
    const previewProjection = buildPreviewProjectionFromCaptureSet(nextCaptureSet);
    const firstShotUri = nextCaptureSet.shots.front?.uri ?? getOrderedCaptureShots(nextCaptureSet)[0]?.uri ?? null;

    await get().updateScene(sceneId, {
      media_type: 'camera',
      capture_set: nextCaptureSet,
      capture_status: captureStatus,
      stitch_status: captureStatus === 'complete' ? 'idle' : 'idle',
      stitched_asset: null,
      preview_projection: previewProjection,
      panorama_url: scene?.panorama_url && !scene.capture_set ? scene.panorama_url : null,
      thumbnail_url: firstShotUri,
      processing_job: null,
      projection: previewProjection,
    });

    return nextCaptureSet;
  },

  finalizeCaptureSet: async (sceneId, mediaType = 'camera') => {
    const scene = findScene(get().tours, sceneId);
    const captureSet = scene?.capture_set ?? createEmptyCaptureSet();
    const captureStatus = deriveCaptureStatus(captureSet);

    if (captureStatus !== 'complete') {
      throw new Error('Capture set tamamlanmadan finalize edilemez');
    }

    const finalizedCaptureSet: SceneCaptureSet = {
      ...captureSet,
      finalized_at: new Date().toISOString(),
    };
    const previewProjection = buildPreviewProjectionFromCaptureSet(finalizedCaptureSet);
    const primaryShot =
      finalizedCaptureSet.shots[finalizedCaptureSet.primary_direction ?? 'front']
      ?? getOrderedCaptureShots(finalizedCaptureSet)[0]
      ?? null;

    await get().updateScene(sceneId, {
      media_type: mediaType,
      capture_set: finalizedCaptureSet,
      capture_status: 'complete',
      stitch_status: 'idle',
      stitched_asset: null,
      preview_projection: previewProjection,
      panorama_url: null,
      thumbnail_url: primaryShot?.uri ?? null,
      processing_job: null,
      projection: previewProjection,
    });

    return {
      captureSet: finalizedCaptureSet,
      previewProjection,
    };
  },

  queueStitch: async (sceneId) => {
    const scene = findScene(get().tours, sceneId);
    if (!scene?.capture_set || !isCaptureSetComplete(scene.capture_set)) {
      return null;
    }

    const sceneWithFinalPreview = normalizeScene(scene);
    const pipeline = await startPanoramaPipeline({
      sceneId,
      tourId: sceneWithFinalPreview.tour_id,
      mode: sceneWithFinalPreview.scene_type,
      mediaType: sceneWithFinalPreview.media_type,
      captureSet: sceneWithFinalPreview.capture_set,
    });

    await get().updateScene(sceneId, {
      capture_set: sceneWithFinalPreview.capture_set,
      capture_status: 'complete',
      preview_projection: pipeline.previewProjection,
      projection: pipeline.previewProjection,
      stitch_status: pipeline.processingJob ? pipeline.stitchStatus : 'idle',
      processing_job: pipeline.processingJob,
      stitched_asset: null,
      panorama_url: null,
    });

    return pipeline.processingJob;
  },

  reconcileStitch: async (sceneId) => {
    await get().reconcileSceneProcessing(sceneId);
  },

  commitSceneCapture: async (sceneId, { primaryUri, sources, sectorMask, mediaType }) => {
    const captureSet = createEmptyCaptureSet();
    CAPTURE_DIRECTIONS.forEach((direction, index) => {
      const source = sources[index];
      if (!source?.uri) {
        return;
      }
      captureSet.shots[direction] = {
        uri: source.uri,
        direction,
        captured_at: new Date().toISOString(),
        yawDeg: source.yawDeg,
        validation: 'passed',
      };
    });
    captureSet.primary_direction = 'front';

    for (const direction of CAPTURE_DIRECTIONS) {
      const shot = captureSet.shots[direction];
      if (!shot) {
        continue;
      }
      await get().saveCaptureShot(sceneId, direction, {
        uri: shot.uri,
        captured_at: shot.captured_at,
        yawDeg: shot.yawDeg,
        validation: shot.validation,
      });
    }

    const finalized = await get().finalizeCaptureSet(sceneId, mediaType);
    const processingJob = await get().queueStitch(sceneId);

    return {
      projection: finalized.previewProjection ?? {
        version: 1,
        kind: 'single_image',
        source_uris: [primaryUri],
        provider: 'local',
      },
      processingJob,
    };
  },

  saveCaptureSession: async (sceneId, session) => {
    const scene = findScene(get().tours, sceneId);
    const firstFrame = session.frames[0];
    const thumbnailUri = firstFrame?.uri ?? null;

    const projection: SceneProjection = {
      version: 1,
      kind: 'equirect_grid',
      source_uris: session.frames.map((f) => f.uri),
      provider: 'local',
      coverage_sector_count: session.frames.length,
    };

    await get().updateScene(sceneId, {
      media_type: 'camera',
      capture_session: session,
      capture_status: session.frames.length >= (session.gridConfig.totalTargets * 0.7) ? 'complete' : 'partial',
      stitch_status: 'idle',
      stitched_asset: null,
      preview_projection: projection,
      projection,
      panorama_url: null,
      thumbnail_url: thumbnailUri,
      processing_job: null,
    });
  },

  reorderScenes: async (tourId, sceneIds) => {
    const tours = get().tours.map((t) => {
      if (t.id !== tourId) return t;
      const reordered = sceneIds
        .map((sid, i) => {
          const scene = t.scenes?.find((s) => s.id === sid);
          return scene ? { ...scene, order: i } : null;
        })
        .filter(Boolean) as Scene[];
      return normalizeTour({ ...t, scenes: reordered });
    });
    await saveTours(tours);
    const currentTour = get().currentTour;
    set({
      tours,
      currentTour: currentTour?.id === tourId
        ? tours.find((t) => t.id === tourId) ?? null
        : currentTour,
    });
  },

  reconcileSceneProcessing: async (sceneId) => {
    const scene =
      get().tours.flatMap((tour) => tour.scenes ?? []).find((item) => item.id === sceneId) ?? null;

    if (!scene) {
      return;
    }

    const result = await pollPanoramaPipeline(scene);
    if (!result) {
      return;
    }

    const updates: Partial<Scene> = {};

    if (result.panoramaUrl !== undefined) {
      updates.panorama_url = result.panoramaUrl;
    }
    if (result.thumbnailUrl !== undefined) {
      updates.thumbnail_url = result.thumbnailUrl;
    }
    if (result.stitchedAsset !== undefined) {
      updates.stitched_asset = result.stitchedAsset;
      updates.panorama_url = result.stitchedAsset?.uri ?? null;
    }
    if (result.processingJob !== undefined) {
      updates.processing_job = result.processingJob;
    }
    if (result.stitchStatus !== undefined) {
      updates.stitch_status = result.stitchStatus;
    }

    const tours = updateSceneInTours(get().tours, sceneId, updates);
    await saveTours(tours);
    const currentTour = get().currentTour;
    set({
      tours,
      currentTour: currentTour?.scenes?.some((item) => item.id === sceneId)
        ? tours.find((tour) => tour.id === currentTour.id) ?? currentTour
        : currentTour,
    });
  },

  reconcileTourProcessing: async (tourId) => {
    const tour = get().tours.find((item) => item.id === tourId);
    const remotePendingScenes = (tour?.scenes ?? []).filter((scene) => {
      const job = scene.processing_job;
      return (
        job != null &&
        (job.status === 'pending' || job.status === 'processing')
      );
    });

    for (const scene of remotePendingScenes) {
      await get().reconcileSceneProcessing(scene.id);
    }
  },

  getIncompleteScenes: (tourId) => {
    const tour = get().tours.find((t) => t.id === tourId);
    return (tour?.scenes ?? []).filter((scene) => getSceneCaptureStatus(scene) !== 'complete' && getSceneViewerMode(scene) === 'none');
  },

  getCompletedCount: (tourId) => {
    const tour = get().tours.find((t) => t.id === tourId);
    const scenes = tour?.scenes ?? [];
    return {
      completed: scenes.filter((scene) => getSceneViewerMode(scene) !== 'none').length,
      total: scenes.length,
    };
  },
}));
