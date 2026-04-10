import type { CaptureSubPhase } from './CaptureEngine';

export type GuidanceTone = 'neutral' | 'warning' | 'success';

interface CameraStatusInput {
  captureSubPhase: CaptureSubPhase;
  aligned: boolean;
  stable: boolean;
  capturing: boolean;
  manualShutter: boolean;
  hasCapturedFrames: boolean;
}

interface OverlayCopyInput {
  aligned: boolean;
  stable: boolean;
  hintLabel: string;
  yawDeltaDeg: number;
  pitchDeltaDeg: number;
}

interface ShutterHelperInput {
  manualShutter: boolean;
  canShoot: boolean;
  capturing: boolean;
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
          detail: 'Oku takip edip hazır olduğunuzda deklanşöre basın.',
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

  if (input.hasCapturedFrames) {
    return {
      title: 'Sıradaki kare',
      detail: 'Okları izleyip bir sonraki hedefe dönün.',
      tone: 'neutral',
    };
  }

  return {
    title: 'Oku takip et',
    detail: 'Hedefe dönün, nişanı merkeze getirin.',
    tone: 'neutral',
  };
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
  const mainFromYaw = absYaw >= absPitch && absYaw > 2;
  const mainFromPitch = absPitch > absYaw && absPitch > 2;

  let mainLabel = input.hintLabel || 'Oku takip edin';
  let secondaryLabel: string | null = null;

  if (mainFromYaw) {
    mainLabel = input.yawDeltaDeg > 0 ? 'Sağa dön' : 'Sola dön';
    if (absPitch > 2) {
      secondaryLabel = input.pitchDeltaDeg > 0 ? 'Biraz yukarı bakın' : 'Biraz aşağı bakın';
    }
  } else if (mainFromPitch) {
    mainLabel = input.pitchDeltaDeg > 0 ? 'Biraz yukarı bakın' : 'Biraz aşağı bakın';
    if (absYaw > 2) {
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

  if (input.manualShutter) {
    return input.canShoot
      ? 'Manuel mod açık. İstediğiniz anda çekebilirsiniz.'
      : 'Manuel mod açık. Hazır olduğunuzda deklanşöre basın.'
  }

  return input.canShoot
    ? 'Otomatik mod açık. Sabit kalırsanız fotoğraf birazdan çekilecek.'
    : 'Otomatik mod açık. Önce hedefe dönüp telefonu sabit tutun.';
}
