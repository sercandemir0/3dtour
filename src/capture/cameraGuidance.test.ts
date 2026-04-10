import test from 'node:test';
import assert from 'node:assert/strict';

import { getCameraStatusModel, getOverlayCopy, getShutterHelperText } from './cameraGuidance';

test('guiding state asks the user to follow the arrows', () => {
  const model = getCameraStatusModel({
    captureSubPhase: 'guiding',
    aligned: false,
    stable: false,
    capturing: false,
    manualShutter: false,
    hasCapturedFrames: false,
  });

  assert.equal(model.title, 'Oku takip et');
  assert.equal(model.detail, 'Hedefe dönün, nişanı merkeze getirin.');
  assert.equal(model.tone, 'neutral');
});

test('stabilizing state explains auto capture expectation', () => {
  const model = getCameraStatusModel({
    captureSubPhase: 'stabilizing',
    aligned: true,
    stable: false,
    capturing: false,
    manualShutter: false,
    hasCapturedFrames: false,
  });

  assert.equal(model.title, 'Sabit tut');
  assert.equal(model.detail, 'Nişan yeşilken telefon sabit kalırsa otomatik çeker.');
  assert.equal(model.tone, 'warning');
});

test('capturing state reflects an active shot', () => {
  const model = getCameraStatusModel({
    captureSubPhase: 'shutter',
    aligned: true,
    stable: true,
    capturing: true,
    manualShutter: false,
    hasCapturedFrames: true,
  });

  assert.equal(model.title, 'Fotoğraf çekiliyor');
  assert.equal(model.detail, 'Telefonu sabit tutmaya devam edin.');
  assert.equal(model.tone, 'success');
});

test('overlay copy hides technical deltas and focuses on action', () => {
  const copy = getOverlayCopy({
    aligned: false,
    stable: false,
    hintLabel: 'Sağa ~12° · Yukarı ~4°',
    yawDeltaDeg: 12,
    pitchDeltaDeg: 4,
  });

  assert.equal(copy.mainLabel, 'Sağa dön');
  assert.equal(copy.secondaryLabel, 'Biraz yukarı bakın');
});

test('shutter helper explains manual mode clearly', () => {
  assert.equal(
    getShutterHelperText({
      manualShutter: true,
      canShoot: true,
      capturing: false,
    }),
    'Manuel mod açık. İstediğiniz anda çekebilirsiniz.',
  );

  assert.equal(
    getShutterHelperText({
      manualShutter: false,
      canShoot: false,
      capturing: false,
    }),
    'Otomatik mod açık. Önce hedefe dönüp telefonu sabit tutun.',
  );
});
