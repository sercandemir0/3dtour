/**
 * OrientationTracker — device orientation for guided panorama capture.
 *
 * Yaw priority:
 * 1. Tilt-compensated magnetic heading (Magnetometer + Accelerometer)
 * 2. Gyroscope integration from last good magnetic yaw (when field is weak)
 * 3. DeviceMotion.rotation alpha delta (fallback when magnet never locked)
 *
 * Pitch: gravity-based from DeviceMotion beta (portrait panorama convention).
 */
import { Platform } from 'react-native';
import { DeviceMotion, Magnetometer, Accelerometer, Gyroscope } from 'expo-sensors';
import { normalizeAngle } from './CaptureGrid';

export interface Orientation {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  angularVelocityDegPerSec: number;
  timestamp: number;
}

interface RotationSample {
  yaw: number;
  pitch: number;
  ts: number;
}

const HISTORY_WINDOW_MS = 600;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Magnetic heading 0–360° from accel (m/s², gravity) + mag (µT). Null if unreliable. */
export function computeMagneticHeadingDeg(
  ax: number,
  ay: number,
  az: number,
  mx: number,
  my: number,
  mz: number,
): number | null {
  const g = Math.hypot(ax, ay, az);
  if (g < 2) return null;

  const axn = ax / g;
  const ayn = ay / g;
  const azn = az / g;

  const pitch = Math.asin(clamp(-axn, -1, 1));
  const roll = Math.atan2(ayn, azn);

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);

  const xh = mx * cosP + mz * sinP;
  const yh = mx * sinR * sinP + my * cosR - mz * sinR * cosP;

  let deg = (Math.atan2(yh, xh) * 180) / Math.PI;
  if (Platform.OS === 'ios') {
    deg = -deg;
  }
  return normalizeAngle(deg);
}

function magNorm(mx: number, my: number, mz: number): number {
  return Math.hypot(mx, my, mz);
}

export class OrientationTracker {
  private _dmSub: ReturnType<typeof DeviceMotion.addListener> | null = null;
  private _magSub: ReturnType<typeof Magnetometer.addListener> | null = null;
  private _accSub: ReturnType<typeof Accelerometer.addListener> | null = null;
  private _gyroSub: ReturnType<typeof Gyroscope.addListener> | null = null;
  private _latestAlphaRad = 0;
  private _latestBetaDeg = 0;
  private _latestGammaDeg = 0;

  private _latestMag = { x: 0, y: 0, z: 0 };
  private _latestAccel = { x: 0, y: 0, z: 0 };
  private _latestGyro = { x: 0, y: 0, z: 0 };
  private _refAlphaRad: number | null = null;
  private _refHeadingDeg: number | null = null;
  /** Last yaw from magnetometer (null if magnet never valid since lock). */
  private _yawFromMag: number | null = null;
  /** Integrated gyro yaw (deg) since magnet dropped; reset when magnet good. */
  private _gyroSlipDeg = 0;
  private _prevGyroIntegrateMs: number | null = null;

  private _history: RotationSample[] = [];
  private _listeners: Set<(o: Orientation) => void> = new Set();
  private _intervalMs: number;

  constructor(updateIntervalMs = 50) {
    this._intervalMs = updateIntervalMs;
  }

  private _notify(): void {
    const o = this.getCurrent();
    this._pushHistory(o);
    for (const fn of this._listeners) fn(o);
  }

  async start(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      const { granted } = await DeviceMotion.requestPermissionsAsync();
      if (!granted) return false;

      DeviceMotion.setUpdateInterval(this._intervalMs);
      Magnetometer.setUpdateInterval(this._intervalMs);
      Accelerometer.setUpdateInterval(this._intervalMs);
      Gyroscope.setUpdateInterval(this._intervalMs);
      this._dmSub = DeviceMotion.addListener((data) => {
        if (data.rotation) {
          this._latestAlphaRad = data.rotation.alpha;
          this._latestBetaDeg = this._radToDeg(data.rotation.beta);
          this._latestGammaDeg = this._radToDeg(data.rotation.gamma);
        }
        this._notify();
      });

      this._magSub = Magnetometer.addListener((m) => {
        this._latestMag = { x: m.x, y: m.y, z: m.z };
      });

      this._accSub = Accelerometer.addListener((a) => {
        this._latestAccel = { x: a.x, y: a.y, z: a.z };
      });

      this._gyroSub = Gyroscope.addListener((g) => {
        this._latestGyro = { x: g.x, y: g.y, z: g.z };
      });

      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this._dmSub?.remove();
    this._dmSub = null;
    this._magSub?.remove();
    this._magSub = null;
    this._accSub?.remove();
    this._accSub = null;
    this._gyroSub?.remove();
    this._gyroSub = null;
    this._history = [];
  }

  addListener(fn: (o: Orientation) => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  lockReference(): void {
    this._refAlphaRad = this._latestAlphaRad;
    this._yawFromMag = null;
    this._gyroSlipDeg = 0;
    this._prevGyroIntegrateMs = null;

    const { x: ax, y: ay, z: az } = this._latestAccel;
    const { x: mx, y: my, z: mz } = this._latestMag;
    const h = computeMagneticHeadingDeg(ax, ay, az, mx, my, mz);
    const mn = magNorm(mx, my, mz);

    if (h != null && mn >= 8) {
      this._refHeadingDeg = h;
    } else {
      this._refHeadingDeg = null;
    }
  }

  get isLocked(): boolean {
    return this._refAlphaRad != null;
  }

  private _gravityPitchDeg(): number {
    const shifted = this._latestBetaDeg - 90;
    return Math.max(-90, Math.min(90, shifted));
  }

  private _relativeYawFromAlpha(): number {
    if (this._refAlphaRad == null) return 0;
    const diff = this._latestAlphaRad - this._refAlphaRad;
    return normalizeAngle(this._radToDeg(diff));
  }

  private _integrateGyroSlip(now: number, magOk: boolean): void {
    if (magOk) {
      this._gyroSlipDeg = 0;
      this._prevGyroIntegrateMs = now;
      return;
    }
    if (this._prevGyroIntegrateMs == null) {
      this._prevGyroIntegrateMs = now;
      return;
    }
    const dt = (now - this._prevGyroIntegrateMs) / 1000;
    this._prevGyroIntegrateMs = now;
    if (dt <= 0 || dt > 0.25 || this._yawFromMag == null) return;
    const rateDeg = (this._latestGyro.z * 180) / Math.PI;
    this._gyroSlipDeg += rateDeg * dt;
  }

  /** Magnetic delta when field is strong; else gyro from last mag yaw; else alpha. */
  private _computeYawDeg(): number {
    const now = Date.now();
    const { x: ax, y: ay, z: az } = this._latestAccel;
    const { x: mx, y: my, z: mz } = this._latestMag;
    const mn = magNorm(mx, my, mz);
    const h = computeMagneticHeadingDeg(ax, ay, az, mx, my, mz);

    const magOk =
      this._refHeadingDeg != null && h != null && mn >= 8;

    this._integrateGyroSlip(now, magOk);

    if (magOk) {
      const y = normalizeAngle(h! - this._refHeadingDeg!);
      this._yawFromMag = y;
      return y;
    }

    if (this._yawFromMag != null) {
      return normalizeAngle(this._yawFromMag + this._gyroSlipDeg);
    }

    return this._relativeYawFromAlpha();
  }

  isLevel(): boolean {
    if (Platform.OS === 'web') return true;
    const panoramaPitch = this._latestBetaDeg - 90;
    const pitchOk = Math.abs(panoramaPitch) < 25;
    const gammaOk = Math.abs(this._latestGammaDeg) < 25;
    return pitchOk && gammaOk;
  }

  getCurrent(): Orientation {
    if (Platform.OS === 'web') {
      return {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0,
        angularVelocityDegPerSec: 0,
        timestamp: Date.now(),
      };
    }
    return {
      yawDeg: this._computeYawDeg(),
      pitchDeg: this._gravityPitchDeg(),
      rollDeg: this._latestGammaDeg,
      angularVelocityDegPerSec: this._computeAngularVelocity(),
      timestamp: Date.now(),
    };
  }

  getRefQuaternion(): [number, number, number, number] {
    const alpha = this._refAlphaRad ?? this._latestAlphaRad;
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

  isStable(thresholdDegPerSec = 5, windowMs = 350): boolean {
    if (Platform.OS === 'web') return true;
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = this._history.filter((s) => s.ts >= cutoff);
    if (recent.length < 2) return false;
    for (let i = 1; i < recent.length; i++) {
      const dt = (recent[i].ts - recent[i - 1].ts) / 1000;
      if (dt <= 0) continue;
      let dYaw = Math.abs(recent[i].yaw - recent[i - 1].yaw);
      if (dYaw > 180) dYaw = 360 - dYaw;
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
    let dYaw = Math.abs(b.yaw - a.yaw);
    if (dYaw > 180) dYaw = 360 - dYaw;
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
