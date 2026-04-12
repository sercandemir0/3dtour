import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCameraStatusModel,
  getOverlayCopy,
  getShutterHelperText,
  DIRECTION_THRESHOLD_DEG,
  type CameraStatusInput,
  type ShutterHelperInput,
} from './cameraGuidance';

const BASE_STATUS: CameraStatusInput = {
  captureSubPhase: 'guiding',
  aligned: false,
  stable: false,
  capturing: false,
  manualShutter: false,
  hasCapturedFrames: false,
  yawDeltaDeg: 0,
  pitchDeltaDeg: 0,
  ring: null,
};

const BASE_SHUTTER: ShutterHelperInput = {
  manualShutter: false,
  canShoot: false,
  capturing: false,
  yawDeltaDeg: 0,
  pitchDeltaDeg: 0,
  aligned: false,
};

test('guiding state with no deltas uses generic copy', () => {
  const model = getCameraStatusModel({ ...BASE_STATUS });
  assert.equal(model.title, 'Oku takip et');
  assert.equal(model.detail, 'Hedefe dönün, nişanı merkeze getirin.');
  assert.equal(model.tone, 'neutral');
});

test('guiding state includes ring name and direction when available', () => {
  const model = getCameraStatusModel({
    ...BASE_STATUS,
    hasCapturedFrames: true,
    yawDeltaDeg: 30,
    pitchDeltaDeg: -5,
    ring: 'upper',
  });
  assert.equal(model.title, 'Üst hedefi');
  assert.ok(model.detail.includes('Sağa'), `detail should include "Sağa": ${model.detail}`);
  assert.ok(model.detail.includes('Aşağı'), `detail should include "Aşağı": ${model.detail}`);
  assert.equal(model.tone, 'neutral');
});

test('banner shows direction on first frame too (no previous captures)', () => {
  const model = getCameraStatusModel({
    ...BASE_STATUS,
    yawDeltaDeg: -15,
    pitchDeltaDeg: 0,
    ring: 'horizon',
  });
  assert.equal(model.title, 'Ufuk hedefi');
  assert.ok(model.detail.includes('Sola'), `detail: ${model.detail}`);
});

test('stabilizing state explains auto capture expectation', () => {
  const model = getCameraStatusModel({
    ...BASE_STATUS,
    captureSubPhase: 'stabilizing',
    aligned: true,
    stable: false,
  });
  assert.equal(model.title, 'Sabit tut');
  assert.equal(model.tone, 'warning');
});

test('capturing state reflects an active shot', () => {
  const model = getCameraStatusModel({
    ...BASE_STATUS,
    captureSubPhase: 'shutter',
    aligned: true,
    stable: true,
    capturing: true,
    hasCapturedFrames: true,
  });
  assert.equal(model.title, 'Fotoğraf çekiliyor');
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

test('overlay copy shows aligned state when aligned', () => {
  const copy = getOverlayCopy({
    aligned: true,
    stable: true,
    hintLabel: '',
    yawDeltaDeg: 0.5,
    pitchDeltaDeg: 0.3,
  });
  assert.equal(copy.mainLabel, 'Harika, sabit tut');
  assert.ok(copy.secondaryLabel?.includes('otomatik'));
});

test('shutter helper explains manual mode clearly', () => {
  assert.equal(
    getShutterHelperText({ ...BASE_SHUTTER, manualShutter: true, canShoot: true, aligned: true }),
    'Manuel mod açık. İstediğiniz anda çekebilirsiniz.',
  );
});

test('shutter helper includes direction when not aligned in auto mode', () => {
  const text = getShutterHelperText({
    ...BASE_SHUTTER,
    yawDeltaDeg: -20,
    pitchDeltaDeg: 0,
    aligned: false,
  });
  assert.ok(text.includes('Sola'), `text: ${text}`);
  assert.ok(text.includes('Otomatik'), `text: ${text}`);
});

test('shutter helper includes direction in manual mode when not aligned', () => {
  const text = getShutterHelperText({
    ...BASE_SHUTTER,
    manualShutter: true,
    canShoot: false,
    yawDeltaDeg: 10,
    pitchDeltaDeg: 0,
    aligned: false,
  });
  assert.ok(text.includes('Sağa'), `text: ${text}`);
  assert.ok(text.includes('Manuel'), `text: ${text}`);
});

test('DIRECTION_THRESHOLD_DEG is a sensible value', () => {
  assert.ok(DIRECTION_THRESHOLD_DEG >= 1 && DIRECTION_THRESHOLD_DEG <= 5);
});
