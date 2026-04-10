/**
 * OrientationTracker — quaternion-based device orientation tracking.
 *
 * Uses DeviceMotion rotation data to derive gravity-stabilised pitch
 * (drift-free) and gyro-relative yaw. Provides angular velocity and
 * a stability predicate for the auto-shutter gate.
 *
 * On web, orientation is not available — the tracker returns fixed
 * default values so the rest of the pipeline still works.
 */
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { normalizeAngle } from './CaptureGrid';

export interface Orientation {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** Approximate angular velocity in °/s computed from recent samples. */
  angularVelocityDegPerSec: number;
  timestamp: number;
}

interface RotationSample {
  yaw: number;
  pitch: number;
  ts: number;
}

const HISTORY_WINDOW_MS = 600;

export class OrientationTracker {
  private _sub: ReturnType<typeof DeviceMotion.addListener> | null = null;
  private _refAlphaRad: number | null = null;
  private _latestAlphaRad = 0;
  private _latestBetaDeg = 0;
  private _latestGammaDeg = 0;
  private _history: RotationSample[] = [];
  private _listeners: Set<(o: Orientation) => void> = new Set();
  private _intervalMs: number;

  constructor(updateIntervalMs = 60) {
    this._intervalMs = updateIntervalMs;
  }

  async start(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      const { granted } = await DeviceMotion.requestPermissionsAsync();
      if (!granted) return false;
      DeviceMotion.setUpdateInterval(this._intervalMs);
      this._sub = DeviceMotion.addListener((data) => {
        if (!data.rotation) return;
        this._latestAlphaRad = data.rotation.alpha;
        this._latestBetaDeg = this._radToDeg(data.rotation.beta);
        this._latestGammaDeg = this._radToDeg(data.rotation.gamma);

        const o = this.getCurrent();
        this._pushHistory(o);
        for (const fn of this._listeners) fn(o);
      });
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this._sub?.remove();
    this._sub = null;
    this._history = [];
  }

  addListener(fn: (o: Orientation) => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Lock current heading as the yaw=0° reference. */
  lockReference(): void {
    this._refAlphaRad = this._latestAlphaRad;
  }

  get isLocked(): boolean {
    return this._refAlphaRad != null;
  }

  /**
   * Pitch derived from gravity (beta). Drift-free.
   * Returns -90..+90 where 0 = device held upright landscape, positive = tilted up.
   */
  private _gravityPitchDeg(): number {
    return Math.max(-90, Math.min(90, this._latestBetaDeg));
  }

  /**
   * Relative yaw from the locked reference. 0-360°.
   */
  private _relativeYawDeg(): number {
    if (this._refAlphaRad == null) return 0;
    const diff = this._latestAlphaRad - this._refAlphaRad;
    return normalizeAngle(this._radToDeg(diff));
  }

  /** True if the device is roughly level (appropriate for panorama capture). */
  isLevel(): boolean {
    if (Platform.OS === 'web') return true;
    return Math.abs(this._latestBetaDeg) < 14 && Math.abs(this._latestGammaDeg - 90) < 18;
  }

  getCurrent(): Orientation {
    if (Platform.OS === 'web') {
      return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, angularVelocityDegPerSec: 0, timestamp: Date.now() };
    }
    return {
      yawDeg: this._relativeYawDeg(),
      pitchDeg: this._gravityPitchDeg(),
      rollDeg: this._latestGammaDeg,
      angularVelocityDegPerSec: this._computeAngularVelocity(),
      timestamp: Date.now(),
    };
  }

  getRefQuaternion(): [number, number, number, number] {
    const alpha = this._refAlphaRad ?? 0;
    const beta = (this._latestBetaDeg * Math.PI) / 180;
    const gamma = (this._latestGammaDeg * Math.PI) / 180;
    const cy = Math.cos(alpha / 2);
    const sy = Math.sin(alpha / 2);
    const cp = Math.cos(beta / 2);
    const sp = Math.sin(beta / 2);
    const cr = Math.cos(gamma / 2);
    const sr = Math.sin(gamma / 2);
    return [
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
    ];
  }

  /**
   * Returns true if the device has been stable (low angular velocity)
   * for at least `windowMs` milliseconds.
   */
  isStable(thresholdDegPerSec = 3, windowMs = 500): boolean {
    if (Platform.OS === 'web') return true;
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = this._history.filter((s) => s.ts >= cutoff);
    if (recent.length < 3) return false;
    for (let i = 1; i < recent.length; i++) {
      const dt = (recent[i].ts - recent[i - 1].ts) / 1000;
      if (dt <= 0) continue;
      const dYaw = Math.abs(recent[i].yaw - recent[i - 1].yaw);
      const dPitch = Math.abs(recent[i].pitch - recent[i - 1].pitch);
      const speed = Math.sqrt(dYaw * dYaw + dPitch * dPitch) / dt;
      if (speed > thresholdDegPerSec) return false;
    }
    return true;
  }

  private _computeAngularVelocity(): number {
    if (this._history.length < 2) return 0;
    const a = this._history[this._history.length - 2];
    const b = this._history[this._history.length - 1];
    const dt = (b.ts - a.ts) / 1000;
    if (dt <= 0) return 0;
    const dYaw = Math.abs(b.yaw - a.yaw);
    const dPitch = Math.abs(b.pitch - a.pitch);
    return Math.sqrt(dYaw * dYaw + dPitch * dPitch) / dt;
  }

  private _pushHistory(o: Orientation): void {
    this._history.push({ yaw: o.yawDeg, pitch: o.pitchDeg, ts: o.timestamp });
    const cutoff = Date.now() - HISTORY_WINDOW_MS * 2;
    while (this._history.length > 0 && this._history[0].ts < cutoff) {
      this._history.shift();
    }
  }

  private _radToDeg(r: number): number {
    return (r * 180) / Math.PI;
  }
}
