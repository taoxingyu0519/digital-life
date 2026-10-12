"""Exercise continuous identity with the real tracker and database, replacing model boundaries."""
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import supervision as sv

from model import Runtime


class ContinuousIdentityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        directory = Path(self.folder.name)
        for name in ('yunet.onnx', 'sface.onnx', 'face.task', 'gesture.task'):
            (directory / name).write_bytes(b'test-model')
        boundaries = self.enterContext(ExitStack())
        boundaries.enter_context(patch('model.MODELS', directory))
        boundaries.enter_context(patch('model.DATA', directory))
        boundaries.enter_context(patch('model.verify', return_value={'sface': {'sha256': 'a'}, 'yunet': {'sha256': 'b'}}))
        boundaries.enter_context(patch('model.ort.preload_dlls'))
        boundaries.enter_context(patch('model.ort.InferenceSession'))
        boundaries.enter_context(patch('model.cv2.FaceDetectorYN'))
        boundaries.enter_context(patch('model.cv2.FaceRecognizerSF'))
        boundaries.enter_context(patch('model.mp.tasks.vision.FaceLandmarker'))
        boundaries.enter_context(patch('model.mp.tasks.vision.GestureRecognizer'))
        self.runtime = Runtime()
        self.runtime.landmarks.detect.return_value = SimpleNamespace(face_landmarks=[])
        self.runtime.gestures.recognize.return_value = SimpleNamespace(gestures=[])
        self.image = np.full((200, 200, 3), 127, np.uint8)
        self.detections = sv.Detections(xyxy=np.array([[10, 10, 190, 190]], np.float32),
                                        confidence=np.array([.9]), class_id=np.array([0]))
        self.runtime.detect = Mock(return_value=self.detections)
        self.vector = np.zeros(128, np.float32)
        self.vector[0] = 1
        self.person = self.runtime.people.enroll('test-person', [self.vector] * 10)
        self.runtime.sample_pose = 'front'
        self.runtime.sample_photo = b'test-photo'
        self.runtime.face_sample = Mock(return_value=(self.vector, 'accepted'))

    def observe(self, now):
        with patch('model.time.monotonic', return_value=now):
            result, _, quality = self.runtime.analyze(self.image, {'face': True}, None, lambda: True)
        return result, quality

    def confirm(self):
        for now in (0, .3, .6):
            result, _ = self.observe(now)
        self.assertEqual(result['actors'][0]['person_id'], self.person)

    def test_brief_blur_keeps_confirmed_identity_but_persistent_blur_expires(self):
        self.confirm()
        self.runtime.face_sample.return_value = (None, 'blur-or-exposure')
        for now in (.9, 1.2):
            result, quality = self.observe(now)
            self.assertEqual(result['actors'][0]['identity_status'], 'confirmed')
            self.assertEqual(result['actors'][0]['person_id'], self.person)
            self.assertEqual(quality, 'blur-or-exposure')
        result, _ = self.observe(2.3)
        self.assertEqual(result['actors'][0]['identity_status'], 'unavailable')
        self.assertIsNone(result['actors'][0]['person_id'])

    def test_slow_frames_confirm_and_expose_diagnostics_without_identity_or_vectors(self):
        for now in (0, .6, 1.2):
            result, _ = self.observe(now)
        actor = result['actors'][0]
        self.assertEqual(actor['person_id'], self.person)
        diagnostic = self.runtime.recognition_diagnostics[actor['track_id']]
        self.assertEqual(diagnostic, dict(reason='confirmed', samples=3, score=1.0, threshold=.55))
        self.runtime.face_sample.return_value = (None, 'blur-or-exposure')
        result, _ = self.observe(3)
        self.assertEqual(self.runtime.recognition_diagnostics, {})

    def test_multiple_faces_revoke_the_name_without_waiting_for_blur_grace(self):
        self.confirm()
        self.runtime.face_sample.return_value = (None, 'multiple-faces')
        result, _ = self.observe(.9)
        self.assertIsNone(result['actors'][0]['person_id'])
        self.runtime.face_sample.return_value = (self.vector, 'accepted')
        result, _ = self.observe(1.2)
        self.assertEqual(result['actors'][0]['identity_status'], 'candidate')

    def test_a_brief_detection_miss_preserves_tracking_without_inventing_an_actor(self):
        self.confirm()
        self.runtime.detect.return_value = sv.Detections.empty()
        result, _ = self.observe(.75)
        self.assertEqual(result['actors'], [])
        self.runtime.detect.return_value = self.detections
        result, _ = self.observe(.9)
        self.assertEqual(result['actors'][0]['person_id'], self.person)

    def test_recognition_only_frames_cannot_enroll_or_update_the_gallery(self):
        self.runtime.face_sample.return_value = (self.vector, 'recognition-only')
        self.runtime.enrollment = dict(started=0, last=-1, track=None, samples=[], poses=[])
        with patch.object(self.runtime.social, 'sample') as sample:
            for now in (0, .3, .6):
                result, quality = self.observe(now)
            sample.assert_not_called()
        self.assertEqual(quality, 'recognition-only')
        self.assertEqual(result['actors'][0]['person_id'], self.person)
        self.assertEqual(self.runtime.enrollment['samples'], [])

    def test_the_real_face_sampling_path_keeps_checks_running_while_reducing_features(self):
        self.runtime.face_sample = Runtime.face_sample.__get__(self.runtime)
        pattern = np.indices((200, 200)).sum(axis=0) % 2 * 120 + 60
        self.image = np.repeat(pattern[:, :, None], 3, axis=2).astype(np.uint8)
        face = np.array([20, 20, 130, 130, 55, 70, 115, 70, 85, 100, 60, 125, 110, 125, .99], np.float32)
        self.runtime.face.detect.return_value = (None, face[None])
        self.runtime.recognizer.alignCrop.return_value = np.full((112, 112, 3), 127, np.uint8)
        self.runtime.recognizer.feature.return_value = self.vector[None]
        for now in (0, .3, .6, .9, 1.2, 1.5):
            result, _ = self.observe(now)
            if now >= .6:
                self.assertEqual(result['actors'][0]['person_id'], self.person)
        self.assertEqual(self.runtime.face.detect.call_count, 6)
        self.assertTrue(np.allclose(result['actors'][0]['face_bbox'], [.15, .15, .8, .8]))
        self.assertEqual(self.runtime.recognizer.feature.call_count, 3)
        result, _ = self.observe(1.8)
        self.assertEqual(self.runtime.recognizer.feature.call_count, 4)
        self.assertEqual(result['actors'][0]['person_id'], self.person)
        self.runtime.face.detect.return_value = (None, np.stack([face, face]))
        result, _ = self.observe(2.1)
        self.assertIsNone(result['actors'][0]['person_id'])
        self.assertIsNone(result['actors'][0]['face_bbox'])

    def test_visible_face_position_does_not_require_a_known_name_or_clear_enrollment_sample(self):
        self.runtime.face_sample = Runtime.face_sample.__get__(self.runtime)
        face = np.array([20, 30, 90, 100, 35, 50, 85, 50, 60, 75, 40, 100, 80, 100, .99], np.float32)
        self.runtime.face.detect.return_value = (None, face[None])
        result, quality = self.observe(0)
        self.assertEqual(quality, 'face-blurry')
        self.assertIsNone(result['actors'][0]['person_id'])
        self.assertTrue(np.allclose(result['actors'][0]['face_bbox'], [.15, .2, .6, .7]))
        self.runtime.face.detect.return_value = (None, None)
        result, _ = self.observe(.3)
        self.assertIsNone(result['actors'][0]['face_bbox'])
        self.runtime.reset()
        self.assertEqual(self.runtime.face_boxes, {})

    def test_edge_recognition_keeps_natural_enrollment_in_the_original_face_space(self):
        from recognition import RecognitionGallery
        import cv2
        aligned = np.full((112, 112, 3), 127, np.uint8)
        photo = cv2.imencode('.jpg', aligned)[1].tobytes()
        vector = np.zeros(512, np.float32)
        vector[1] = 1

        class Encoder:
            name = 'edge-test'
            version = 'edge-test-model:512'

            def feature(self, image):
                return vector.copy()

        self.runtime.edge = RecognitionGallery(Encoder(), self.runtime.people)
        self.runtime.face_sample.return_value = (vector, 'accepted')
        self.runtime.sample_aligned = aligned
        self.runtime.sample_photo = photo
        self.runtime.recognizer.feature.return_value = self.vector[None]
        unknown = dict(identity_status='unknown', person_id=None, display_name=None)
        with patch('social.time.monotonic', return_value=0):
            self.runtime.social.converse('1', unknown, '我叫测试人物', 'airi', 'intro')
            self.runtime.social.converse('1', unknown, '名字正确', 'airi', 'name-confirmation')
        for index in range(13):
            result, _ = self.observe(.5 + index * .5)
        self.assertEqual(result['actors'][0]['identity_status'], 'confirmed')
        self.assertEqual(result['actors'][0]['person_id'], self.person)
        profile = self.runtime.people.profile(self.person, 'airi')
        self.assertEqual(profile['display_name'], '测试人物')
        self.assertEqual(profile['memories'][0]['text'], '我叫测试人物')
        self.assertIn('front', profile['poses'])
        with self.runtime.people.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recognition_templates').fetchone()[0], 1)

    def test_reviewed_angle_reaches_the_real_pipeline_without_becoming_a_trusted_base(self):
        # AIRI-029: a gallery extension once skipped by add_pose must never bootstrap another trusted reference.
        from adaptation import TrajectoryLearning
        from recognition import RecognitionGallery
        import cv2
        photo = cv2.imencode('.jpg', np.full((112, 112, 3), 127, np.uint8))[1].tobytes()
        base = np.zeros(512, np.float32)
        base[0] = 1

        class Encoder:
            name = 'edge-test'
            version = 'edge-test:512'

            def feature(self, image):
                return base.copy()

        self.runtime.people.add_photos(self.person, {'front': photo})
        self.runtime.people.rename(self.person, 'test-person')
        self.runtime.edge = RecognitionGallery(Encoder(), self.runtime.people)
        self.runtime.adaptation = TrajectoryLearning(self.runtime.edge)
        current_cosine = 1

        def face_sample(*args):
            self.runtime.sample_face_box = np.array([20, 20, 100, 100], np.float32)
            self.runtime.sample_photo = photo
            self.runtime.sample_aligned = np.full((112, 112, 3), 127, np.uint8)
            self.runtime.sample_pose = 'left'
            vector = base.copy()
            vector[0], vector[1] = current_cosine, np.sqrt(1 - current_cosine ** 2)
            return vector, 'accepted'

        self.runtime.face_sample.side_effect = face_sample
        self.runtime.recognizer.feature.return_value = self.vector[None]
        sequence = [1, 1, 1, .85, .65, .45, .65, .85, 1, 1, 1, .45, .45, .45]
        for index, current_cosine in enumerate(sequence):
            result, _ = self.observe(index * .3)
        self.assertEqual(result['actors'][0]['person_id'], self.person)
        self.assertEqual(len(self.runtime.people.extension_records(self.person)), 1)
        self.assertEqual(self.runtime.people.profile(self.person, 'airi')['poses'], ['front'])
        self.runtime.reset()
        self.assertEqual(self.runtime.adaptation.status()['candidates'], 0)
