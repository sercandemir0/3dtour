export type CaptureMode = 'panorama' | 'gaussian_splat' | 'roomplan';
export type TourStatus = 'draft' | 'processing' | 'published' | 'archived';
export type SceneType = 'panorama' | 'gaussian_splat' | 'roomplan';
export type HotspotIconType = 'navigate' | 'info' | 'link';
export type JobType = 'panorama_stitch' | 'gaussian_splat' | 'video_extract';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Profile {
  id: string;
  full_name: string | null;
  company: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Tour {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  capture_mode: CaptureMode;
  status: TourStatus;
  share_slug: string | null;
  created_at: string;
  updated_at: string;
  scenes?: Scene[];
}

export interface Scene {
  id: string;
  tour_id: string;
  name: string;
  scene_type: SceneType;
  panorama_url: string | null;
  splat_url: string | null;
  roomplan_url: string | null;
  thumbnail_url: string | null;
  order: number;
  initial_yaw: number;
  initial_pitch: number;
  initial_fov: number;
  camera_position: Vector3 | null;
  camera_target: Vector3 | null;
  created_at: string;
  hotspots?: Hotspot[];
}

export interface Hotspot {
  id: string;
  scene_id: string;
  target_scene_id: string | null;
  yaw: number | null;
  pitch: number | null;
  position_3d: Vector3 | null;
  label: string | null;
  icon_type: HotspotIconType;
  created_at: string;
}

export interface ProcessingJob {
  id: string;
  scene_id: string;
  job_type: JobType;
  input_url: string;
  status: JobStatus;
  progress: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
