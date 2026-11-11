"""Inference stays on one worker. Camera bytes and face vectors never leave this process."""
import time
import os
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort
import supervision as sv

from identity import People
from registry import DATA, MODELS, verify
from recognition import FaceEvidence, RecognitionClock, configured_recognizer
from social import SocialLearning
from temporal import Motions
from adaptation import TrajectoryLearning

LABELS = ('person bicycle car motorcycle airplane bus train truck boat traffic_light fire_hydrant stop_sign parking_meter bench bird cat dog horse sheep cow elephant bear zebra giraffe backpack umbrella handbag tie suitcase frisbee skis snowboard sports_ball kite baseball_bat baseball_glove skateboard surfboard tennis_racket bottle wine_glass cup fork knife spoon bowl banana apple sandwich orange broccoli carrot hot_dog pizza donut cake chair couch potted_plant bed dining_table toilet tv laptop mouse remote keyboard cell_phone microwave oven toaster sink refrigerator book clock vase scissors teddy_bear hair_drier toothbrush').split()


class Runtime:
    def __init__(self, profile=False):
        lock = verify()
        # Register transitive NVIDIA DLLs, including newer cuDNN engine libraries.
        cuda_bins = sorted((Path(sys.prefix) / 'Lib/site-packages/nvidia').glob('*/bin'))
        self.dll_directories = [os.add_dll_directory(str(folder)) for folder in cuda_bins] if os.name == 'nt' else []
        if cuda_bins:
            os.environ['PATH'] = os.pathsep.join(map(str, cuda_bins)) + os.pathsep + os.environ.get('PATH', '')
        ort.preload_dlls()
        options = ort.SessionOptions()
        options.enable_profiling = profile
        options.profile_file_prefix = str(DATA / 'ort-profile')
        self.detector = ort.InferenceSession(str(MODELS / 'yolox-s.onnx'), sess_options=options, providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        self.tracker = sv.ByteTrack(frame_rate=15, lost_track_buffer=15)
        # Buffer loading supports Windows paths containing Chinese characters.
        self.face = cv2.FaceDetectorYN.create('onnx', np.frombuffer((MODELS / 'yunet.onnx').read_bytes(), np.uint8), np.empty(0, np.uint8), (320, 320), .85)
        self.recognizer = cv2.FaceRecognizerSF.create('onnx', np.frombuffer((MODELS / 'sface.onnx').read_bytes(), np.uint8), np.empty(0, np.uint8))
        base = mp.tasks.BaseOptions
        vision = mp.tasks.vision
        self.landmarks = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=base(model_asset_buffer=(MODELS / 'face.task').read_bytes()), num_faces=1,
            output_face_blendshapes=True, output_facial_transformation_matrixes=True))
        self.gestures = vision.GestureRecognizer.create_from_options(vision.GestureRecognizerOptions(
            base_options=base(model_asset_buffer=(MODELS / 'gesture.task').read_bytes()), num_hands=2))
        self.people = People(DATA, lock['sface']['sha256'] + ':' + lock['yunet']['sha256'] + ':v1')
        self.edge = configured_recognizer(DATA, self.people)
        self.adaptation = TrajectoryLearning(self.edge) if self.edge else None
        self.recognition_clock = RecognitionClock()
        self.face_evidence = FaceEvidence()
        self.secondary_extractions = 0
        self.social = SocialLearning(self.people)
        self.motion = {}
        self.enrollment = None
        self.sample_pose = 'front'
        self.face_times = {}
        self.identities = {}
        self.recognition_diagnostics = {}
        self.face_quality = {}
        self.face_boxes = {}
        self.boxes = {}

    @property
    def device(self):
        return 'cuda' if self.detector.get_providers()[0] == 'CUDAExecutionProvider' else 'cpu'

    def reset(self):
        self.tracker.reset()
        self.motion.clear()
        self.people.evidence.clear()
        self.people.confirmed.clear()
        self.people.camera_condition = None
        self.enrollment = None
        self.face_times.clear()
        self.social.reset()
        self.identities.clear()
        self.recognition_diagnostics.clear()
        self.face_quality.clear()
        self.face_boxes.clear()
        self.boxes.clear()
        self.recognition_clock.clear()
        self.face_evidence.clear()
        if self.adaptation:
            self.adaptation.clear()

    def perception(self):
        return dict(model=self.edge.encoder.name if self.edge else 'sface',
                    embedding_extractions=self.recognition_clock.extracted,
                    embedding_skipped=self.recognition_clock.skipped,
                    secondary_extractions=self.secondary_extractions,
                    confirmed_embedding_hz=1, uncertain_face_check_hz=5,
                    adaptation=self.adaptation.status() if self.adaptation else None)

    def detect(self, image):
        h, w = image.shape[:2]
        ratio = min(640 / h, 640 / w)
        resized = cv2.resize(image, (int(w * ratio), int(h * ratio)))
        padded = np.full((640, 640, 3), 114, dtype=np.uint8)
        padded[:resized.shape[0], :resized.shape[1]] = resized
        tensor = np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32)
        output = self.detector.run(None, {self.detector.get_inputs()[0].name: tensor})[0][0]
        grids, strides = [], []
        for stride in (8, 16, 32):
            y, x = np.meshgrid(np.arange(640 // stride), np.arange(640 // stride), indexing='ij')
            grids.append(np.stack((x, y), axis=-1).reshape(-1, 2))
            strides.append(np.full((x.size, 1), stride))
        grid, stride = np.concatenate(grids), np.concatenate(strides)
        centers = (output[:, :2] + grid) * stride
        sizes = np.exp(np.clip(output[:, 2:4], -20, 20)) * stride
        scores = output[:, 4:5] * output[:, 5:]
        classes = scores.argmax(1)
        confidence = scores.max(1)
        keep = confidence > .25
        boxes = np.concatenate((centers - sizes / 2, centers + sizes / 2), axis=1)[keep] / ratio
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)
        return sv.Detections(xyxy=boxes, confidence=confidence[keep], class_id=classes[keep]).with_nms(threshold=.45)

    def face_sample(self, image, track=None, now=None, learning=False):
        self.sample_face_box = None
        self.sample_light = 'normal'
        h, w = image.shape[:2]
        self.face.setInputSize((w, h))
        _, faces = self.face.detect(image)
        if faces is None:
            return None, 'face-not-visible'
        if len(faces) != 1:
            return None, 'multiple-faces'
        face = faces[0]
        x, y, fw, fh = face[:4].astype(int)
        crop = image[max(0, y):min(h, y + fh), max(0, x):min(w, x + fw)]
        if min(fw, fh) < 64 or not crop.size:
            return None, 'face-too-small'
        # Gaze uses a visible face location, independent of its social identity or enrollment quality.
        self.sample_face_box = np.array([max(0, x), max(0, y), min(w, x + fw), min(h, y + fh)], np.float32)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
        brightness = float(gray.mean())
        if not 40 < brightness < 220:
            return None, 'face-exposure'
        if sharpness < 35:
            return None, 'face-blurry'
        self.sample_light = 'dim' if brightness < 85 else 'bright' if brightness > 170 else 'normal'
        # Reject strong yaw using the nose position between the eye landmarks.
        left, right, nose = face[4:6], face[6:8], face[8:10]
        width = float(np.linalg.norm(left - right))
        offset = float(nose[0] - (left[0] + right[0]) / 2) / max(width, 1)
        if width < 1 or abs(offset) > .6:
            return None, 'face-pose'
        self.sample_pose = 'left' if offset < -.12 else 'right' if offset > .12 else 'front'
        quality = 'accepted' if min(fw, fh) >= 96 and sharpness >= 70 and abs(offset) <= .45 else 'recognition-only'
        cached = self.identities.get(track)
        confirmed = bool(cached and cached[1]['identity_status'] == 'confirmed')
        if track is not None and not self.recognition_clock.due(track, now, crop, confirmed, learning):
            return None, quality
        aligned = self.recognizer.alignCrop(image, face)
        self.sample_aligned = aligned
        self.sample_photo = cv2.imencode('.jpg', aligned, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
        vector = self.edge.encoder.feature(aligned) if self.edge else self.recognizer.feature(aligned).reshape(128).copy()
        return vector, quality

    def analyze(self, image, policy, primary, is_current):
        now = time.monotonic()
        detections = self.detect(image)
        people = self.tracker.update_with_detections(detections[detections.class_id == 0])
        height, width = image.shape[:2]
        normalize = np.array([width, height, width, height])
        actors, events = [], []
        tracks = people.tracker_id.tolist() if people.tracker_id is not None else []
        active = set(map(str, tracks[:3]))
        if self.adaptation:
            if policy['face']:
                self.adaptation.frame([(str(track), (box / normalize).tolist()) for track, box in zip(tracks, people.xyxy)], now)
            else:
                self.adaptation.clear()
        self.recognition_clock.retain(active, now)
        self.face_evidence.retain(active, now)
        if len(tracks) != 1 or not policy['face']:
            self.face_evidence.clear()
        self.social.observe(list(map(str, tracks)))
        selected = str(tracks[0]) if len(tracks) == 1 else primary if primary in active else None
        self.motion = {key: value for key, value in self.motion.items() if key in active}
        self.people.evidence = {key: value for key, value in self.people.evidence.items() if key in active or (value and now - value[-1][0] <= 1)}
        self.people.confirmed = {key: value for key, value in self.people.confirmed.items() if key in active or now - value[1] <= 1.5}
        self.face_times = {key: value for key, value in self.face_times.items() if key in active}
        self.identities = {key: value for key, value in self.identities.items() if key in active or now - value[0] <= 1.5}
        self.recognition_diagnostics = {key: value for key, value in self.recognition_diagnostics.items() if key in self.identities}
        self.face_quality = {key: value for key, value in self.face_quality.items() if key in self.identities or key in active}
        self.face_boxes = {key: value for key, value in self.face_boxes.items() if key in active}
        self.boxes = {key: value for key, value in self.boxes.items() if key in active}
        if self.enrollment and (now - self.enrollment['started'] > 60 or len(tracks) != 1
                                or self.enrollment['track'] not in (None, str(tracks[0]))):
            self.enrollment = None
        quality = 'one-person-required'
        for box, track in zip(people.xyxy[:3], tracks[:3]):
            track = str(track)
            actor = dict(track_id=track, bbox=(box / normalize).tolist(), primary=track == selected,
                         face_bbox=None, identity_status='unknown', person_id=None, display_name=None, visible_cues=[])
            x1, y1, x2, y2 = box.astype(int)
            crop = image[y1:y2, x1:x2]
            if not crop.size:
                continue
            overlap = any(other != track and min(box[2], other_box[2]) > max(box[0], other_box[0])
                          and min(box[3], other_box[3]) > max(box[1], other_box[1])
                          for other_box, other in zip(people.xyxy, map(str, tracks)))
            if overlap:
                self.face_boxes.pop(track, None)
                self.people.invalidate(track)
                self.identities.pop(track, None)
                self.recognition_diagnostics.pop(track, None)
                self.face_evidence.clear(track)
                self.recognition_clock.clear(track)
                if self.adaptation:
                    self.adaptation.clear('ambiguous')
            previous_box = self.boxes.get(track)
            normalized_box = box / normalize
            if previous_box is not None and np.max(np.abs(normalized_box - previous_box)) > .07:
                self.motion.pop(track, None)
                self.face_evidence.clear(track)
            self.boxes[track] = normalized_box
            if policy['face'] and not overlap and now - self.face_times.get(track, -1) >= .2:
                self.face_times[track] = now
                learning = bool(self.enrollment or (self.social.name_state == 'confirmed' and self.social.name and not self.social.person)
                                or (self.adaptation and self.adaptation.round))
                self.sample_face_box = None
                self.sample_light = 'normal'
                vector, quality = self.face_sample(crop, track, now, learning)
                if self.sample_face_box is not None:
                    face_box = (self.sample_face_box + np.array([x1, y1, x1, y1])) / normalize
                    self.face_boxes[track] = (now, face_box.clip(0, 1).tolist())
                else:
                    self.face_boxes.pop(track, None)
                self.face_quality[track] = quality
                if self.adaptation:
                    face_box = self.face_boxes.get(track)
                    self.adaptation.sample(track, now, face_box[1] if face_box else None,
                        vector, quality, self.sample_pose, self.sample_light,
                        self.sample_photo if vector is not None else b'',
                        lambda: is_current() and self.social.declined != track)
                if vector is not None:
                    lock = self.people.calibration() if not self.edge else None
                    threshold = max(.55, lock['accept_threshold']) if lock else .55
                    margin = max(.1, lock['min_margin']) if lock else .1
                    ranked = self.edge.scores(vector) if self.edge else self.people.scores(vector)
                    # Current-frame disagreement revokes ownership before historical scores can smooth it.
                    previous_identity = self.identities.get(track)
                    if previous_identity and previous_identity[1]['person_id'] and (not ranked or ranked[0][1] != previous_identity[1]['person_id']):
                        self.face_evidence.clear(track)
                    fused = self.face_evidence.fuse(track, ranked, now, quality, threshold, margin)
                    identity = self.people.resolve(track, fused, now, threshold, margin)
                    matched_at = now
                    if len(tracks) == 1:
                        identity, matched_at = self.face_evidence.stabilize(track, ranked, vector, now, identity,
                            previous_identity[1] if previous_identity else None, threshold, margin)
                    held = matched_at != now
                    if held:
                        self.people.confirmed[track] = (identity['person_id'], matched_at)
                    reason = {'confirmed': 'confirmed', 'candidate': 'collecting', 'ambiguous': 'ambiguous'}.get(identity['identity_status'])
                    self.recognition_diagnostics[track] = dict(
                        reason=reason or ('below-threshold' if ranked else 'no-templates'),
                        samples=min(3, len(self.people.evidence.get(track, []))),
                        score=float(np.clip(ranked[0][0], -1, 1)) if ranked else None, threshold=threshold)
                    canonical = vector if not self.edge else None
                    base_ranked = self.edge.base_scores(vector) if self.edge else ranked
                    base_trusted = bool(base_ranked and base_ranked[0][1] == identity['person_id']
                                        and base_ranked[0][0] >= .7
                                        and (len(base_ranked) == 1 or base_ranked[0][0] - base_ranked[1][0] >= .15))
                    allow_social = not held and (not self.edge or identity['identity_status'] != 'confirmed' or base_trusted)
                    if quality == 'accepted' and len(tracks) == 1 and is_current() and allow_social:
                        needs_sample = bool((identity['identity_status'] == 'unknown' and not self.social.person and not self.social.name)
                                            or (self.social.name_state == 'confirmed' and self.social.name and not self.social.person) or self.enrollment)
                        if identity['identity_status'] == 'confirmed':
                            needs_sample = needs_sample or identity['person_id'] not in self.social.memorized
                        if self.edge and needs_sample:
                            canonical = self.recognizer.feature(self.sample_aligned).reshape(128).copy()
                            self.secondary_extractions += 1
                        if canonical is not None:
                            self.social.sample(track, canonical, self.sample_pose, self.sample_photo, identity)
                    self.identities[track] = (matched_at, identity)
                    actor.update(identity)
                    enrollment = self.enrollment
                    if not held and quality == 'accepted' and enrollment and is_current() and len(tracks) == 1 and now - enrollment['last'] >= .4:
                        if now - enrollment['started'] > 60 or (enrollment['track'] is not None and enrollment['track'] != track):
                            self.enrollment = None
                        elif len(enrollment['samples']) < 30 and enrollment['poses'].count(self.sample_pose) < 10:
                            enrollment['track'] = track
                            enrollment['samples'].append(canonical)
                            enrollment['poses'].append(self.sample_pose)
                            enrollment['last'] = now
                else:
                    cached = self.identities.get(track)
                    # Brief blur or a head turn does not erase a known face. Multiple faces revoke ownership immediately.
                    if quality == 'multiple-faces' or not cached or now - cached[0] > 2.5:
                        self.people.invalidate(track)
                        self.identities.pop(track, None)
                        self.recognition_diagnostics.pop(track, None)
                        self.face_evidence.clear(track)
                        self.recognition_clock.clear(track)
                        actor['identity_status'] = 'unavailable'
                    elif cached[1]['identity_status'] == 'confirmed':
                        actor.update(cached[1])
            elif policy['face'] and not overlap and track in self.identities:
                at, identity = self.identities[track]
                quality = self.face_quality.get(track, quality)
                if now - at <= 2.5:
                    actor.update(identity)
            # Overlap makes body ownership ambiguous. Never attach hand or face cues across people.
            face_box = self.face_boxes.get(track)
            if policy['face'] and not overlap and face_box and now - face_box[0] <= .3:
                actor['face_bbox'] = face_box[1]
            if actor['primary'] and len(tracks) == 1:
                rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                face_result = self.landmarks.detect(rgb)
                hands = self.gestures.recognize(rgb)
                pitch, yaw, hand_x, gesture = None, None, None, ''
                if face_result.face_landmarks:
                    matrix = face_result.facial_transformation_matrixes[0]
                    pitch = float(np.arctan2(matrix[2, 1], matrix[2, 2]))
                    yaw = float(np.arctan2(-matrix[2, 0], np.hypot(matrix[2, 1], matrix[2, 2])))
                    if abs(yaw) < .3:
                        actor['visible_cues'].append('head_facing_camera')
                    blends = {b.category_name: b.score for b in face_result.face_blendshapes[0]}
                    if min(blends.get('mouthSmileLeft', 0), blends.get('mouthSmileRight', 0)) > .5:
                        actor['visible_cues'].append('mouth_corner_raised')
                if hands.gestures:
                    best = hands.gestures[0][0]
                    gesture = best.category_name if best.score >= .75 else ''
                    actor['visible_cues'].append('hand_visible')
                    if gesture == 'Open_Palm':
                        hand_x = hands.hand_landmarks[0][0].x
                motion = self.motion.setdefault(track, Motions())
                events.extend(dict(action=action, track_id=track) for action in motion.update(now, pitch, yaw, hand_x, gesture))
            actors.append(actor)
        objects = [dict(label=LABELS[int(cls)], score=float(score), bbox=(box / normalize).tolist())
                   for box, score, cls in zip(detections.xyxy, detections.confidence, detections.class_id) if cls != 0][:20]
        return dict(actors=actors, objects=objects, primary_track_id=selected if selected in active else None), events, quality
