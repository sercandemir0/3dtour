import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Tour,
  Scene,
  Hotspot,
  CaptureMode,
  SceneMediaType,
  SceneCaptureSource,
  SceneProjection,
  ProcessingJob,
} from '@/src/types/tour';
import {
  startPanoramaPipeline,
  pollPanoramaPipeline,
} from '@/src/services/panoramaPipeline';

const STORAGE_KEY = '@3dtour_tours';
const COVERAGE_SECTOR_COUNT = 6;

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
  updateTour: (id: string, updates: Partial<Tour>) => Promise<void>;
  deleteTour: (id: string) => Promise<void>;

  addScene: (tourId: string, name: string, sceneType: Scene['scene_type']) => Promise<Scene>;
  updateScene: (id: string, updates: Partial<Scene>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  setSceneMedia: (sceneId: string, uri: string, mediaType: SceneMediaType) => Promise<void>;
  commitSceneCapture: (
    sceneId: string,
    payload: {
      primaryUri: string;
      sources: SceneCaptureSource[];
      sectorMask: boolean[];
      mediaType: SceneMediaType;
    },
  ) => Promise<{ projection: SceneProjection; processingJob: ProcessingJob | null }>;
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
  return data ? JSON.parse(data) : [];
}

function updateSceneInTours(
  tours: Tour[],
  sceneId: string,
  updates: Partial<Scene>,
): Tour[] {
  return tours.map((tour) => ({
    ...tour,
    scenes: tour.scenes?.map((scene) => (
      scene.id === sceneId ? { ...scene, ...updates } : scene
    )),
  }));
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

  updateTour: async (id, updates) => {
    const tours = get().tours.map((t) =>
      t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t
    );
    await saveTours(tours);
    set({
      tours,
      currentTour: get().currentTour?.id === id
        ? { ...get().currentTour!, ...updates }
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
    };

    const tours = get().tours.map((t) =>
      t.id === tourId ? { ...t, scenes: [...(t.scenes ?? []), scene] } : t
    );
    await saveTours(tours);
    const updatedTour = tours.find((t) => t.id === tourId) ?? null;
    set({ tours, currentTour: get().currentTour?.id === tourId ? updatedTour : get().currentTour });
    return scene;
  },

  updateScene: async (id, updates) => {
    const tours = get().tours.map((t) => ({
      ...t,
      scenes: t.scenes?.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    await saveTours(tours);
    const currentTour = get().currentTour;
    if (currentTour?.scenes?.some((s) => s.id === id)) {
      set({
        tours,
        currentTour: {
          ...currentTour,
          scenes: currentTour.scenes?.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        },
      });
    } else {
      set({ tours });
    }
  },

  deleteScene: async (id) => {
    const tours = get().tours.map((t) => ({
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
    const pipeline = await startPanoramaPipeline({
      sceneId,
      primaryUri: uri,
      mediaType,
    });

    const updates: Partial<Scene> = {
      panorama_url: uri,
      thumbnail_url: uri,
      media_type: mediaType,
      capture_sources: undefined,
      coverage_sector_mask: undefined,
      projection: pipeline.projection,
      processing_job: pipeline.processingJob,
    };
    await get().updateScene(sceneId, updates);
  },

  commitSceneCapture: async (sceneId, { primaryUri, sources, sectorMask, mediaType }) => {
    const paddedMask = Array.from(
      { length: COVERAGE_SECTOR_COUNT },
      (_, i) => !!sectorMask[i],
    );
    const pipeline = await startPanoramaPipeline({
      sceneId,
      primaryUri,
      mediaType,
      sources,
      sectorMask: paddedMask,
    });

    const updates: Partial<Scene> = {
      panorama_url: primaryUri,
      thumbnail_url: primaryUri,
      media_type: mediaType,
      capture_sources: sources,
      coverage_sector_mask: paddedMask,
      projection: pipeline.projection,
      processing_job: pipeline.processingJob,
    };
    await get().updateScene(sceneId, updates);
    return {
      projection: pipeline.projection,
      processingJob: pipeline.processingJob,
    };
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
      return { ...t, scenes: reordered };
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
    if (result.projection !== undefined) {
      updates.projection = result.projection;
    }
    if (result.processingJob !== undefined) {
      updates.processing_job = result.processingJob;
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
        scene.projection?.provider === 'remote' &&
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
    return (tour?.scenes ?? []).filter((s) => !s.panorama_url);
  },

  getCompletedCount: (tourId) => {
    const tour = get().tours.find((t) => t.id === tourId);
    const scenes = tour?.scenes ?? [];
    return {
      completed: scenes.filter((s) => s.panorama_url).length,
      total: scenes.length,
    };
  },
}));
