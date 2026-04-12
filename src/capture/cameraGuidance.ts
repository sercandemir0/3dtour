import type { CaptureSubPhase } from './CaptureEngine';

export type GuidanceTone = 'neutral' | 'warning' | 'success';

export const DIRECTION_THRESHOLD_DEG = 2;

export type RingName = 'horizon' | 'upper' | 'lower' | 'zenith' | 'nadir';

export interface CameraStatusInput {
  captureSubPhase: CaptureSubPhase;
  aligned: boolean;
  stable: boolean;
  capturing: boolean;
  manualShutter: boolean;
  hasCapturedFrames: boolean;
  yawDeltaDeg: number;
  pitchDeltaDeg: number;
  ring: RingName | null;
}

export interface OverlayCopyInput {
  aligned: boolean;
  stable: boolean;
  hintLabel: string;
  yawDeltaDeg: number;
  pitchDeltaDeg: number;
}

export interface ShutterHelperInput {
  manualShutter: boolean;
  canShoot: boolean;
  capturing: boolean;
  yawDeltaDeg: number;
  pitchDeltaDeg: number;
  aligned: boolean;
}

export interface CameraStatusModel {
  title: string;
  detail: string;
  tone: GuidanceTone;
}

export interface OverlayCopy {
  mainLabel: string;
  secondaryLabel: string | null;
}

export function getCameraStatusModel(input: CameraStatusInput): CameraStatusModel {
  if (input.capturing || input.captureSubPhase === 'shutter') {
    return {
      title: 'Fotoğraf çekiliyor',
      detail: 'Telefonu sabit tutmaya devam edin.',
      tone: 'success',
    };
  }

  if (input.manualShutter) {
    return input.aligned
      ? {
          title: 'Hazır',
          detail: 'Kadraj uygunsa şimdi deklanşöre basabilirsiniz.',
          tone: input.stable ? 'success' : 'warning',
        }
      : {
          title: 'Manuel çekim',
          detail: formatDirectionDetail(input) + ' Hazır olduğunuzda deklanşöre basın.',
          tone: 'neutral',
        };
  }

  if (input.captureSubPhase === 'stabilizing' || input.aligned) {
    return input.stable
      ? {
          title: 'Harika',
          detail: 'Fotoğraf otomatik çekilmek üzere.',
          tone: 'success',
        }
      : {
          title: 'Sabit tut',
          detail: 'Nişan yeşilken telefon sabit kalırsa otomatik çeker.',
          tone: 'warning',
        };
  }

  const ringHint = input.ring ? getRingDirectionName(input.ring) : null;
  const dirDetail = formatDirectionDetail(input);

  if (input.hasCapturedFrames) {
    return {
      title: ringHint ? `${ringHint} hedefi` : 'Sıradaki kare',
      detail: dirDetail || 'Okları izleyip bir sonraki hedefe dönün.',
      tone: 'neutral',
    };
  }

  return {
    title: ringHint ? `${ringHint} hedefi` : 'Oku takip et',
    detail: dirDetail || 'Hedefe dönün, nişanı merkeze getirin.',
    tone: 'neutral',
  };
}

function getRingDirectionName(ring: RingName): string {
  switch (ring) {
    case 'horizon': return 'Ufuk';
    case 'upper': return 'Üst';
    case 'lower': return 'Alt';
    case 'zenith': return 'Tavan';
    case 'nadir': return 'Zemin';
  }
}

function formatDirectionDetail(input: { yawDeltaDeg: number; pitchDeltaDeg: number }): string {
  const absYaw = Math.abs(input.yawDeltaDeg);
  const absPitch = Math.abs(input.pitchDeltaDeg);
  const parts: string[] = [];

  if (absYaw > DIRECTION_THRESHOLD_DEG) {
    parts.push(input.yawDeltaDeg > 0 ? `Sağa ~${Math.round(absYaw)}°` : `Sola ~${Math.round(absYaw)}°`);
  }
  if (absPitch > DIRECTION_THRESHOLD_DEG) {
    parts.push(input.pitchDeltaDeg > 0 ? `Yukarı ~${Math.round(absPitch)}°` : `Aşağı ~${Math.round(absPitch)}°`);
  }

  return parts.length > 0 ? parts.join(', ') + ' dönün.' : '';
}

export function getOverlayCopy(input: OverlayCopyInput): OverlayCopy {
  if (input.aligned) {
    return input.stable
      ? {
          mainLabel: 'Harika, sabit tut',
          secondaryLabel: 'Fotoğraf birazdan otomatik çekilecek.',
        }
      : {
          mainLabel: 'Sabit tut',
          secondaryLabel: 'Telefonu oynatmayın, otomatik çekim hazırlanıyor.',
        };
  }

  const absYaw = Math.abs(input.yawDeltaDeg);
  const absPitch = Math.abs(input.pitchDeltaDeg);
  const mainFromYaw = absYaw >= absPitch && absYaw > DIRECTION_THRESHOLD_DEG;
  const mainFromPitch = absPitch > absYaw && absPitch > DIRECTION_THRESHOLD_DEG;

  let mainLabel = input.hintLabel || 'Oku takip edin';
  let secondaryLabel: string | null = null;

  if (mainFromYaw) {
    mainLabel = input.yawDeltaDeg > 0 ? 'Sağa dön' : 'Sola dön';
    if (absPitch > DIRECTION_THRESHOLD_DEG) {
      secondaryLabel = input.pitchDeltaDeg > 0 ? 'Biraz yukarı bakın' : 'Biraz aşağı bakın';
    }
  } else if (mainFromPitch) {
    mainLabel = input.pitchDeltaDeg > 0 ? 'Biraz yukarı bakın' : 'Biraz aşağı bakın';
    if (absYaw > DIRECTION_THRESHOLD_DEG) {
      secondaryLabel = input.yawDeltaDeg > 0 ? 'Biraz sağa dönün' : 'Biraz sola dönün';
    }
  }

  return { mainLabel, secondaryLabel };
}

export function getCaptureModeHelperText(manualShutter: boolean): string {
  return manualShutter
    ? 'Açıksa istediğiniz an manuel çekersiniz.'
    : 'Kapalıysa hizalanınca otomatik çeker.';
}

export function getShutterHelperText(input: ShutterHelperInput): string {
  if (input.capturing) {
    return 'Fotoğraf çekiliyor, telefonu sabit tutun.';
  }

  const dir = input.aligned ? '' : formatDirectionBrief(input.yawDeltaDeg, input.pitchDeltaDeg);

  if (input.manualShutter) {
    if (input.canShoot) return 'Manuel mod açık. İstediğiniz anda çekebilirsiniz.';
    return dir
      ? `Manuel mod. ${dir}`
      : 'Manuel mod açık. Hazır olduğunuzda deklanşöre basın.';
  }

  if (input.canShoot) {
    return 'Otomatik mod açık. Sabit kalırsanız fotoğraf birazdan çekilecek.';
  }
  return dir
    ? `Otomatik mod. ${dir}`
    : 'Otomatik mod açık. Önce hedefe dönüp telefonu sabit tutun.';
}

function formatDirectionBrief(yawDelta: number, pitchDelta: number): string {
  const absY = Math.abs(yawDelta);
  const absP = Math.abs(pitchDelta);
  if (absY <= DIRECTION_THRESHOLD_DEG && absP <= DIRECTION_THRESHOLD_DEG) return '';
  if (absY >= absP && absY > DIRECTION_THRESHOLD_DEG) {
    return yawDelta > 0 ? `Sağa ~${Math.round(absY)}° dönün.` : `Sola ~${Math.round(absY)}° dönün.`;
  }
  return pitchDelta > 0 ? `Yukarı ~${Math.round(absP)}° bakın.` : `Aşağı ~${Math.round(absP)}° bakın.`;
}
