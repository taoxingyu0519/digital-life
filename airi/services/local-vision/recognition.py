"""Local ONNX encoders and encrypted model-specific indexes. No camera images leave the worker."""
import hashlib
import json
import time
from collections import deque

import cv2
import numpy as np
import onnxruntime as ort

from identity import protect
from registry import DATA, MODELS, RECOGNITION_CATALOG, digest, download, verify_recognition


class EdgeFace:
    def __init__(self, name):
        if name not in RECOGNITION_CATALOG:
            raise ValueError('Unknown recognition model')
        lock = verify_recognition()
        self.name = name
        self.version = name + ':' + lock[name]['sha256'] + ':rgb-112-v1'
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(MODELS / 'recognition' / lock[name]['file']),
                                           sess_options=options, providers=['CPUExecutionProvider'])
        entry = self.session.get_inputs()[0]
        if entry.shape[1:] != [3, 112, 112] or self.session.get_outputs()[0].shape[-1] != 512:
            raise ValueError('Unexpected recognition model contract')
        self.input = entry.name

    def feature(self, aligned):
        if aligned.shape != (112, 112, 3):
            raise ValueError('Expected an aligned face crop')
        tensor = cv2.dnn.blobFromImage(aligned, 1 / 127.5, (112, 112), (127.5,) * 3, swapRB=True)
        vector = self.session.run(None, {self.input: tensor})[0].reshape(512).astype(np.float32)
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(vector).all() or norm < 1e-6:
            raise ValueError('Invalid recognition feature')
        return vector / norm


class RecognitionGallery:
    def __init__(self, encoder, people):
        self.encoder = encoder
        self.people = people
        self.fingerprint = None
        self.base_hash = None
        self.base_rows = []
        self.rows = []
        self.refresh()

    def refresh(self):
        with self.people.connect() as db:
            photos = db.execute('SELECT p.id,p.name,f.pose,f.image FROM people p JOIN photos f ON f.person=p.id ORDER BY p.id,f.pose').fetchall()
            extensions = db.execute('SELECT person,id,feature FROM face_extensions WHERE model=? ORDER BY person,id', (self.encoder.version,)).fetchall()
        base_hash = hashlib.sha256(b''.join(person.encode() + name.encode() + pose.encode() + image
                                           for person, name, pose, image in photos)).hexdigest()
        fingerprint = hashlib.sha256(base_hash.encode() + b''.join(person.encode() + key.encode() + feature
                                                                  for person, key, feature in extensions)).hexdigest()
        if fingerprint == self.fingerprint:
            return
        rows = {}
        with self.people.connect() as db:
            for person, name, pose, encrypted in photos:
                photo_hash = hashlib.sha256(encrypted).hexdigest()
                cached = db.execute('SELECT photo_hash,feature FROM recognition_templates WHERE person=? AND model=? AND pose=?',
                                    (person, self.encoder.version, pose)).fetchone()
                if cached and cached[0] == photo_hash:
                    feature = np.frombuffer(protect(cached[1], True), np.float32).reshape(512).copy()
                else:
                    aligned = cv2.imdecode(np.frombuffer(protect(encrypted, True), np.uint8), cv2.IMREAD_COLOR)
                    if aligned is None or aligned.shape != (112, 112, 3):
                        raise ValueError('Invalid saved face crop')
                    feature = self.encoder.feature(aligned)
                    db.execute('INSERT OR REPLACE INTO recognition_templates VALUES (?,?,?,?,?)',
                               (person, self.encoder.version, pose, photo_hash, protect(feature.tobytes())))
                rows.setdefault(person, [name, []])[1].append(feature)
            db.execute('DELETE FROM recognition_templates WHERE person NOT IN (SELECT id FROM people)')
        self.rows = [(person, name, np.stack(features)) for person, (name, features) in rows.items()]
        self.base_rows = list(self.rows)
        expanded = {person: [name, list(features)] for person, name, features in self.rows}
        for person, _, encrypted in extensions:
            if person in expanded:
                expanded[person][1].append(np.frombuffer(protect(encrypted, True), np.float32).reshape(512).copy())
        self.rows = [(person, name, np.stack(features)) for person, (name, features) in expanded.items()]
        self.base_hash = base_hash
        self.fingerprint = fingerprint

    def scores(self, vector):
        self.refresh()
        return sorted([(float(np.max(features @ vector)), person, name) for person, name, features in self.rows], reverse=True)

    def base_scores(self, vector):
        self.refresh()
        return sorted([(float(np.max(features @ vector)), person, name) for person, name, features in self.base_rows], reverse=True)


class RecognitionClock:
    """Continue cheap face checks. Reduce embeddings only while the same visible face stays stable."""
    def __init__(self):
        self.samples = {}
        self.extracted = 0
        self.skipped = 0

    def clear(self, track=None):
        if track is None:
            self.samples.clear()
        else:
            self.samples.pop(track, None)

    def retain(self, active, now):
        self.samples = {track: sample for track, sample in self.samples.items() if track in active or now - sample[0] <= 1.5}

    def due(self, track, now, image, confirmed, learning):
        thumbnail = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (16, 16)).astype(np.float32) / 255
        previous = self.samples.get(track)
        stable = previous is not None and float(np.mean(np.abs(thumbnail - previous[1]))) < .08
        if confirmed and not learning and stable and now - previous[0] < 1:
            self.skipped += 1
            return False
        self.samples[track] = (now, thumbnail)
        self.extracted += 1
        return True


class FaceEvidence:
    """Fuse scores and bridge brief dips against a fixed, independently confirmed face reference."""
    def __init__(self):
        self.tracks = {}
        self.references = {}

    def clear(self, track=None):
        if track is None:
            self.tracks.clear()
            self.references.clear()
        else:
            self.tracks.pop(track, None)
            self.references.pop(track, None)

    def retain(self, active, now):
        self.tracks = {track: samples for track, samples in self.tracks.items()
                       if track in active or (samples and now - samples[-1][0] <= 1.5)}
        self.references = {track: reference for track, reference in self.references.items()
                           if track in active and 0 <= now - reference[0] <= 2.5}

    def fuse(self, track, ranked, now, quality, threshold=.55, margin=.1):
        if not ranked or ranked[0][0] < threshold - .05 or (len(ranked) > 1 and ranked[0][0] - ranked[1][0] < margin):
            self.tracks.pop(track, None)
            return ranked
        score, person, name = ranked[0]
        history = self.tracks.setdefault(track, deque(maxlen=4))
        if history and (history[-1][1] != person or now - history[-1][0] > 1.5):
            history.clear()
        while history and now - history[0][0] > 2:
            history.popleft()
        weight = 1 if quality == 'accepted' else .35
        history.append((now, person, score, weight))
        fused = sum(item[2] * item[3] for item in history) / sum(item[3] for item in history)
        return [(fused, person, name), *ranked[1:]]

    def stabilize(self, track, ranked, vector, now, identity, previous, threshold=.55, margin=.1):
        """A held match cannot refresh its reference, teach a profile, or outlive the last independent match."""
        reference = self.references.get(track)
        norm = float(np.linalg.norm(vector))
        separated = bool(ranked and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= margin))
        if norm < 1e-6 or not np.isfinite(vector).all() or not separated:
            self.references.pop(track, None)
            return identity, now
        vector = vector / norm
        if identity['identity_status'] == 'confirmed':
            if ranked[0][1] == identity['person_id'] and ranked[0][0] >= threshold:
                self.references[track] = (now, identity['person_id'], vector.copy())
            return identity, now
        if (identity['identity_status'] == 'unknown' and reference and previous
                and previous['identity_status'] == 'confirmed' and previous['person_id'] == reference[1]
                and ranked[0][1] == reference[1] and 0 <= now - reference[0] <= 2.5
                and float(reference[2] @ vector) >= .8):
            return dict(identity_status='confirmed', person_id=reference[1], display_name=ranked[0][2]), reference[0]
        self.references.pop(track, None)
        return identity, now


def configured_recognizer(folder, people):
    path = folder / 'recognition.json'
    config = json.loads(path.read_text()) if path.exists() else {'model': 'sface'}
    if config['model'] == 'sface':
        return None
    return RecognitionGallery(EdgeFace(config['model']), people)


def benchmark_models():
    from model import Runtime
    runtime = Runtime()
    encoders = {'sface': lambda aligned: runtime.recognizer.feature(aligned).reshape(128)}
    edge = [EdgeFace(name) for name in RECOGNITION_CATALOG]
    encoders.update({encoder.name: encoder.feature for encoder in edge})
    with runtime.people.connect() as db:
        saved = db.execute('SELECT person,image FROM photos ORDER BY person,pose').fetchall()
    crops = [(person, cv2.imdecode(np.frombuffer(protect(image, True), np.uint8), cv2.IMREAD_COLOR)) for person, image in saved]
    if not crops:
        raise ValueError('No saved face crops are available for comparison')
    public = []
    sources = []
    for label, name in [('public-a', 'einstein1_aligned.jpg'), ('public-a', 'einstein2_aligned.jpg'), ('public-b', 'curie_aligned.jpg')]:
        target = MODELS / 'recognition' / name
        url = 'https://raw.githubusercontent.com/yakhyo/edgeface-onnx/main/assets/samples/' + name
        if not target.exists():
            download(url, target)
        image = cv2.imdecode(np.frombuffer(target.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape != (112, 112, 3):
            raise ValueError('Unexpected public sample shape')
        public.append((label, image))
        sources.append(dict(url=url, sha256=digest(target)))
    result = {}
    for name, encode in encoders.items():
        for _ in range(5):
            encode(crops[0][1])
        elapsed = []
        for index in range(60):
            started = time.perf_counter()
            encode(crops[index % len(crops)][1])
            elapsed.append((time.perf_counter() - started) * 1000)
        vectors = [encode(image) for _, image in crops]
        vectors = [vector / np.linalg.norm(vector) for vector in vectors]
        genuine, different = [], []
        for left in range(len(crops)):
            for right in range(left):
                score = float(vectors[left] @ vectors[right])
                (genuine if crops[left][0] == crops[right][0] else different).append(score)
        result[name] = dict(median_ms=float(np.median(elapsed)), p95_ms=float(np.percentile(elapsed, 95)),
                            genuine_pairs=len(genuine), genuine_min=min(genuine, default=None),
                            genuine_median=float(np.median(genuine)) if genuine else None,
                            different_pairs=len(different), different_max=max(different, default=None))
        public_vectors = [encode(image) for _, image in public]
        public_vectors = [vector / np.linalg.norm(vector) for vector in public_vectors]
        result[name]['public_same_person'] = float(public_vectors[0] @ public_vectors[1])
        result[name]['public_different_person_max'] = max(float(public_vectors[0] @ public_vectors[2]), float(public_vectors[1] @ public_vectors[2]))
        result[name]['public_to_local_max'] = max(float(left @ right) for left in public_vectors for right in vectors)
    return dict(status='PASS', evidence_mode='saved-aligned-crops-and-public-examples', models=result, crops=len(crops), public_sources=sources,
                note='No images or identities exported. Stored crops prove neither live accuracy nor unknown-person rejection.')


def probe_saved_face():
    """Repeat authorized saved crops through real face models. Only the body detector and clock are supplied."""
    from unittest.mock import patch
    import supervision as sv
    from model import Runtime
    runtime = Runtime()
    with runtime.people.connect() as db:
        row = db.execute('SELECT person FROM photos ORDER BY person LIMIT 1').fetchone()
        saved = db.execute('SELECT image FROM photos WHERE person=? ORDER BY pose', (row[0],)).fetchall() if row else []
    if not saved:
        raise ValueError('No saved face crop is available')
    images = [cv2.resize(cv2.imdecode(np.frombuffer(protect(item[0], True), np.uint8), cv2.IMREAD_COLOR), (224, 224)) for item in saved]
    detection = sv.Detections(xyxy=np.array([[0, 0, 224, 224]], np.float32), confidence=np.array([.99]), class_id=np.array([0]))
    visits = []
    with patch.object(runtime, 'detect', return_value=detection):
        for visit, interval in enumerate((1 / 15, 1 / 15, .6, .6)):
            runtime.reset()
            statuses = []
            qualities = []
            reasons = []
            face_boxes = 0
            before = runtime.perception()
            for seq in range(60):
                with patch('model.time.monotonic', return_value=100 + seq * interval):
                    payload, _, quality = runtime.analyze(images[(seq // 20) % len(images)], {'face': True}, None, lambda: False)
                actor = payload['actors'][0]
                box = actor['face_bbox']
                if box is not None:
                    if not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1):
                        raise AssertionError('Invalid normalized face location')
                    face_boxes += 1
                if actor['person_id'] is not None and actor['person_id'] != row[0]:
                    raise AssertionError('Replay matched a different profile')
                statuses.append(actor['identity_status'])
                qualities.append(quality)
                diagnostic = runtime.recognition_diagnostics.get(actor['track_id'])
                reasons.append(diagnostic['reason'] if diagnostic else 'no-match-sample')
            after = runtime.perception()
            if 'confirmed' not in statuses:
                raise AssertionError('Saved face replay never confirmed')
            if face_boxes == 0:
                raise AssertionError('Saved face replay never located a face')
            visits.append(dict(visit=visit + 1, frames=len(statuses), confirmed_frames=statuses.count('confirmed'),
                               input_interval_ms=round(interval * 1000, 2),
                               first_confirmed_frame=statuses.index('confirmed'),
                               quality_counts={key: qualities.count(key) for key in sorted(set(qualities))},
                               recognition_reasons={key: reasons.count(key) for key in sorted(set(reasons))},
                               face_box_frames=face_boxes,
                               status_transitions=sum(left != right for left, right in zip(statuses, statuses[1:])),
                               extractions=after['embedding_extractions'] - before['embedding_extractions'],
                               skipped=after['embedding_skipped'] - before['embedding_skipped']))
        blank = np.full((224, 224, 3), 127, np.uint8)
        for seq in range(60, 100):
            with patch('model.time.monotonic', return_value=100 + seq * interval):
                payload, _, _ = runtime.analyze(blank, {'face': True}, None, lambda: False)
        if payload['actors'][0]['person_id'] is not None:
            raise AssertionError('Lost face retained an expired name')
    return dict(status='PASS', evidence_mode='saved-crop-replay-with-supplied-body-box-and-clock', model=runtime.perception()['model'],
                visits=visits, lost_face_expired=True,
                note='使用真实 YuNet、对齐、编码器、跟踪器和本地档案，人体框与时钟由回放提供。未进行登记或写入交流记忆，不代表真人摄像头准确率。')
