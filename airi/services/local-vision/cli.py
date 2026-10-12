"""Reproducible local commands. Missing evidence always produces a nonzero acceptance exit."""
import argparse
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from registry import CATALOG, DATA, MODELS, ROOT, digest, prepare, prepare_grounding, prepare_recognition, verify

REPORTS = Path(__file__).parent / 'reports'


def report(name, value):
    REPORTS.mkdir(exist_ok=True)
    value = dict(at=datetime.now(timezone.utc).isoformat(), **value)
    (REPORTS / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return value


def doctor():
    packages = {}
    for name in ['opencv-contrib-python', 'onnxruntime-gpu', 'mediapipe', 'supervision', 'fastapi', 'pydantic']:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    try:
        gpu = subprocess.check_output(['nvidia-smi', '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'],
                                      creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=10).decode().strip()
    except (OSError, subprocess.SubprocessError):
        gpu = 'unavailable'
    return report('environment.actual.json', dict(os=platform.platform(), python=sys.version, gpu=gpu,
                  packages=packages, models={key: (MODELS / filename).exists() for key, (filename, _, _) in CATALOG.items()},
                  note='Device inventory is not proof of GPU inference.'))


def service_get(path):
    import urllib.request
    token = (DATA / 'credential').read_text().strip()
    request = urllib.request.Request('http://127.0.0.1:18765' + path, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def recognition_benchmark():
    from recognition import benchmark_models
    return report('recognition-benchmark.actual.json', benchmark_models())


def recognition_probe():
    from recognition import probe_saved_face
    return report('recognition-probe.actual.json', probe_saved_face())


def smoke():
    import numpy as np
    from model import Runtime
    runtime = Runtime(profile=True)
    # Synthetic input proves execution only. It cannot establish face or object recognition quality.
    image = np.full((720, 1280, 3), 127, dtype=np.uint8)
    started = time.monotonic()
    result, actions, quality = runtime.analyze(image, {'face': False}, None, lambda: True)
    # Execute each task with a bounded image even when the detector finds no actor.
    import cv2
    import mediapipe as mp
    test_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    runtime.landmarks.detect(test_image)
    runtime.gestures.recognize(test_image)
    runtime.face_sample(image)
    runtime.recognizer.feature(np.zeros((112, 112, 3), np.uint8))
    profile_path = runtime.detector.end_profiling()
    profile = json.loads(Path(profile_path).read_text())
    executed = {}
    for node in profile:
        provider = node.get('args', {}).get('provider')
        if provider:
            executed[provider] = executed.get(provider, 0) + 1
    return report('model-smoke.actual.json', dict(status='PASS', evidence_mode='synthetic', device=runtime.device,
                   executed_nodes=executed, profile_sha256=digest(profile_path),
                   providers=runtime.detector.get_providers(), elapsed_ms=(time.monotonic() - started) * 1000,
                   people=len(result['actors']), objects=len(result['objects']), quality=quality,
                   models=verify(), note='Executed provider nodes prove this synthetic inference only. Camera quality and full performance remain untested.'))


def calibrate(manifest_path):
    import cv2
    from model import Runtime
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('consented_adults') is not True or not manifest.get('camera_condition'):
        raise ValueError('A consent declaration and camera condition are required')
    clips = manifest['clips']
    known = [clip for clip in clips if clip['person_id'] is not None]
    unknown = [clip for clip in clips if clip['person_id'] is None]
    if len(known) < 100 or len(unknown) < 100:
        raise ValueError('Calibration needs 100 known and 100 unknown independent clips')
    runtime = Runtime()
    hashes, accepted, impostors, margins = set(), [], [], []
    for clip in clips:
        path = (manifest_path.parent / clip['path']).resolve()
        checksum = digest(path)
        if checksum in hashes or clip.get('split') != 'calibration' or not clip.get('recording_session'):
            raise ValueError('Independent calibration recordings are required')
        hashes.add(checksum)
        video = cv2.VideoCapture(str(path))
        try:
            video.set(cv2.CAP_PROP_POS_FRAMES, max(0, video.get(cv2.CAP_PROP_FRAME_COUNT) // 2))
            valid, image = video.read()
        finally:
            video.release()
        if not valid:
            raise ValueError('Unreadable calibration clip')
        vector, quality = runtime.face_sample(image)
        if vector is None:
            raise ValueError('Calibration frame failed quality checks: ' + quality)
        scores = runtime.people.scores(vector)
        if not scores:
            raise ValueError('Enroll the gallery before calibration')
        if clip['person_id']:
            matching = [score for score, person, _ in scores if person == clip['person_id']]
            if not matching:
                raise ValueError('Calibration person is absent from the gallery')
            accepted.append(matching[0])
            other = [score for score, person, _ in scores if person != clip['person_id']]
            margins.append(matching[0] - max(other, default=-1))
        impostors.extend(score for score, person, _ in scores if person != clip['person_id'])
    threshold = max(impostors) + .01
    if threshold >= 1 or sum(score >= threshold for score in accepted) / len(accepted) < .95:
        raise ValueError('Calibration classes overlap. No threshold was installed.')
    min_margin = sorted(margins)[max(0, int(len(margins) * .05) - 1)] - .01
    if min_margin <= 0:
        raise ValueError('Calibration identity margins overlap')
    value = dict(model_hash=runtime.people.model_hash, gallery_hash=runtime.people.gallery_hash(),
                 manifest_hash=digest(manifest_path), camera_condition=manifest['camera_condition'],
                 accept_threshold=threshold, min_margin=min_margin, known_clips=len(known), unknown_clips=len(unknown),
                 note='Development calibration. A disjoint held-out quality evaluation remains required.')
    runtime.people.lock_path.write_text(json.dumps(value, indent=2), encoding='utf-8')
    return {'calibrated': True, 'known_clips': len(known), 'unknown_clips': len(unknown)}


def benchmark(profile, seconds):
    import numpy as np
    required = 28800 if profile == 'soak' else 900
    if seconds < required:
        raise ValueError(f'{profile} requires at least {required} seconds')
    before = service_get('/metrics')
    samples = []
    started = time.monotonic()
    while time.monotonic() - started < seconds:
        metrics = service_get('/metrics')
        samples.append({'elapsed': time.monotonic() - started, 'received': metrics['received'], 'processed': metrics['processed']})
        time.sleep(5)
    after = service_get('/metrics')
    processed = after['processed'] - before['processed']
    received = after['received'] - before['received']
    latencies = after['latency_ms']
    value = dict(profile=profile, evidence_mode='live', elapsed_seconds=seconds, processed=processed,
                 received=received, fps=processed / seconds, samples=samples,
                 percentiles_ms=np.percentile(latencies, [50, 95, 99]).tolist() if latencies else [],
                 status='NOT_RUN' if not received else 'PARTIAL',
                 note='Service telemetry only. Add independent input, stage FPS, RSS, GPU and landmark-rate evidence for acceptance.')
    report(f'benchmark-{profile}.json', value)
    return value


def accept(profile):
    matrix = json.loads((Path(__file__).parent / 'test-matrix.json').read_text(encoding='utf-8'))
    tests = matrix['tests'] if 'tests' in matrix else matrix['cases']
    evidence = []
    for path in sorted(REPORTS.glob('*.actual.json')):
        if path.name == 'acceptance.actual.json':
            continue
        value = json.loads(path.read_text(encoding='utf-8'))
        evidence.append(dict(file=path.name, sha256=digest(path), status=value.get('status'), at=value.get('at'),
                             evidence_mode=value.get('evidence_mode')))
    cases = []
    for case in tests:
        status, reason = 'NOT_RUN', 'Full case evidence is not attached. Component checks are listed separately.'
        if case['requires_real_provider']:
            status, reason = 'BLOCKED_DEPENDENCY', 'A configured and authorized real vision provider is required.'
        elif case['layer'] == 'replay':
            status, reason = 'BLOCKED_MANUAL', 'Independent consented recordings and frozen labels are required.'
        elif case['requires_target_hardware']:
            status, reason = 'NOT_RUN', 'Camera, stage, and profile-specific hardware evidence is not attached.'
        if case['id'].startswith('LOC-'):
            status, reason = 'BLOCKED_DEPENDENCY', 'Grounding DINO preparation and actual quality evidence are required.'
        cases.append(dict(id=case['id'], title=case['title'], status=status, reason=reason, profiles=case['profiles']))
    value = report('acceptance.actual.json', dict(profile=profile, status='NOT_ACCEPTED',
        tests=cases, component_evidence=evidence,
        note='Unit tests and synthetic model smoke are separate reports, not full acceptance.'))
    (REPORTS / 'acceptance.html').write_text('<!doctype html><meta charset="utf-8"><title>AIRI vision acceptance</title><h1>NOT ACCEPTED</h1><p>Full evidence remains required.</p><pre>' +
                                           __import__('html').escape(json.dumps(value, ensure_ascii=False, indent=2)) + '</pre>', encoding='utf-8')
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['doctor', 'prepare', 'prepare-grounding', 'prepare-recognition', 'recognition-benchmark', 'recognition-probe', 'adaptation-probe', 'verify', 'test', 'calibrate', 'benchmark', 'accept', 'smoke', 'integration'])
    parser.add_argument('--manifest')
    parser.add_argument('--profile', default='engineering')
    parser.add_argument('--seconds', type=int, default=900)
    args = parser.parse_args([arg for arg in sys.argv[1:] if arg != '--'])
    if args.command == 'test':
        suite = unittest.defaultTestLoader.discover('tests')
        def names(group):
            return [name for item in group for name in (names(item) if isinstance(item, unittest.TestSuite) else [item.id()])]
        identifiers = names(suite)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        failed = {test.id() for test, _ in [*result.failures, *result.errors]}
        skipped = {test.id() for test, _ in result.skipped}
        code = 0 if result.wasSuccessful() else 1
        report('unit-tests.actual.json', dict(status='PASS' if code == 0 else 'FAIL', exit_code=code, tests_run=result.testsRun,
               evidence_mode='unit', command='scripts/vision.ps1 test',
               tests=[dict(id=name, status='FAIL' if name in failed else 'NOT_RUN' if name in skipped else 'PASS') for name in identifiers]))
        return code
    from integration import run_integration
    from adaptation_probe import run_probe
    operations = {'doctor': doctor, 'prepare': prepare, 'prepare-grounding': prepare_grounding,
                  'prepare-recognition': prepare_recognition,
                  'recognition-benchmark': recognition_benchmark, 'recognition-probe': recognition_probe, 'verify': verify, 'smoke': smoke,
                  'adaptation-probe': lambda: report('adaptation-probe.actual.json', run_probe()),
                  'integration': lambda: report('service-integration.actual.json', run_integration()),
                  'calibrate': lambda: calibrate(args.manifest),
                  'benchmark': lambda: benchmark(args.profile, args.seconds), 'accept': lambda: accept(args.profile)}
    value = operations[args.command]()
    print(json.dumps(value, ensure_ascii=True, indent=2))
    return 1 if args.command in ('accept', 'benchmark') else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
