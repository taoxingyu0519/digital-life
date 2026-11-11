import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from identity import People


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.people = People(Path(self.folder.name), 'model-v1')
        self.people.camera_condition = 'camera-a'
        self.vector = np.zeros(128, np.float32)
        self.vector[0] = 1

    def tearDown(self):
        self.folder.cleanup()

    def enroll(self):
        return self.people.enroll('local-person', [self.vector] * 10)

    def calibrate(self):
        self.people.lock_path.write_text(json.dumps(dict(model_hash='model-v1', gallery_hash=self.people.gallery_hash(),
                                                         camera_condition='camera-a', accept_threshold=.8, min_margin=.1)))

    def test_minimum_samples(self):
        with self.assertRaises(ValueError):
            self.people.enroll('name', [self.vector])

    # http://127.0.0.1:5174 — AIRI-028: valid matches at two frames per second never confirm.
    # ROOT CAUSE: a one-second window cannot hold three samples spaced by .6 seconds. Use the two-second live lease.
    def test_slow_camera_needs_three_fresh_independent_matches_without_lowering_threshold(self):
        person = self.enroll()
        for now in (0, .6, 1.2):
            result = self.people.match('track', self.vector, now)
        self.assertEqual(result['person_id'], person)
        self.assertEqual(result['identity_status'], 'confirmed')

    # http://127.0.0.1:5174 — AIRI-044: one-second capture includes encoding and transport jitter.
    def test_one_hz_camera_confirms_with_jitter_and_recovers_after_one_rejected_frame(self):
        person = self.enroll()
        for now in (0, 1.02, 2.04):
            result = self.people.match('track', self.vector, now)
        self.assertEqual(result['person_id'], person)
        result = self.people.match('track', self.vector, 4.08)
        self.assertEqual(result['person_id'], person)

    def test_confirmation_restarts_after_a_candidate_change_or_interrupted_sampling(self):
        self.enroll()
        first = [(.8, 'first', 'A')]
        second = [(.8, 'second', 'B')]
        self.people.resolve('track', first, 0)
        self.people.resolve('track', second, .3)
        self.people.resolve('track', second, .6)
        self.assertEqual(self.people.resolve('track', second, .9)['person_id'], 'second')
        self.assertEqual(self.people.resolve('new', first, 0)['identity_status'], 'candidate')
        self.assertEqual(self.people.resolve('new', first, 1.6)['identity_status'], 'candidate')
        self.assertEqual(self.people.resolve('new', first, 2.6)['identity_status'], 'candidate')

    def test_slow_camera_conflict_and_expired_evidence_cannot_restore_a_name(self):
        self.enroll()
        for now in (0, 1.6, 3.2):
            result = self.people.match('track', self.vector, now)
        self.assertEqual(result['identity_status'], 'candidate')
        other = np.zeros(128, np.float32)
        other[1] = 1
        self.people.match('track', other, 3.5)
        self.assertEqual(self.people.match('track', self.vector, 3.8)['identity_status'], 'candidate')

    def test_templates_are_encrypted_and_social_matching_needs_no_manual_calibration(self):
        self.enroll()
        with self.people.connect() as db:
            encrypted = db.execute('SELECT template FROM people').fetchone()[0]
        self.assertNotIn(self.vector.tobytes(), encrypted)
        self.assertEqual(self.people.match('track', self.vector, 0)['identity_status'], 'candidate')

    def test_confirmation_needs_spaced_evidence_and_revocation_cannot_restore_name(self):
        person = self.enroll()
        self.calibrate()
        self.assertEqual(self.people.match('track', self.vector, 0)['identity_status'], 'candidate')
        self.assertEqual(self.people.match('track', self.vector, .01)['identity_status'], 'candidate')
        self.assertEqual(self.people.match('track', self.vector, .3)['identity_status'], 'candidate')
        self.assertEqual(self.people.match('track', self.vector, .6)['person_id'], person)
        self.people.delete(person)
        self.assertEqual(self.people.list(), [])
        self.assertIsNone(self.people.match('track', self.vector, .7)['person_id'])

    def test_gallery_change_invalidates_calibration(self):
        self.enroll()
        self.calibrate()
        self.assertIsNotNone(self.people.calibration())
        self.enroll()
        self.assertIsNone(self.people.calibration())

    def test_unknown_face_is_rejected(self):
        self.enroll()
        self.calibrate()
        vector = np.zeros(128, np.float32)
        vector[1] = 1
        self.assertEqual(self.people.match('track', vector, .5)['identity_status'], 'unknown')

    def test_camera_change_requires_new_calibration(self):
        self.enroll()
        self.calibrate()
        self.people.camera_condition = 'camera-b'
        self.assertIsNone(self.people.calibration())
        self.assertEqual(self.people.match('track', self.vector, .5)['identity_status'], 'candidate')

    def test_reintroduction_of_the_same_face_updates_one_profile_without_ambiguous_duplicates(self):
        person = self.enroll()
        self.people.remember(person, 'airi', 'old', 'real conversation')
        repeated = self.people.enroll('corrected-name', [self.vector] * 10, {'front': b'photo'})
        self.assertEqual(repeated, person)
        self.assertEqual(len(self.people.list()), 1)
        for now in (0, .3, .6):
            result = self.people.match('new-track', self.vector, now)
        self.assertEqual(result['identity_status'], 'confirmed')
        self.assertEqual(result['display_name'], 'corrected-name')
        self.assertEqual(self.people.profile(person, 'airi')['memories'][0]['text'], 'real conversation')
        self.assertEqual(self.people.profile(person, 'airi')['poses'], ['front'])

    def test_the_same_name_with_a_different_face_keeps_separate_profiles(self):
        person = self.enroll()
        other = np.zeros(128, np.float32)
        other[1] = 1
        second = self.people.enroll('local-person', [other] * 10)
        self.assertNotEqual(person, second)
        self.assertEqual(len(self.people.list()), 2)

    def test_confirmed_track_tolerates_small_score_dips_but_rejects_a_different_face(self):
        person = self.enroll()
        for now in (0, .3, .6):
            self.people.match('track', self.vector, now)
        weak = np.zeros(128, np.float32)
        weak[0], weak[1] = .52, np.sqrt(1 - .52 ** 2)
        result = self.people.match('track', weak, .8)
        self.assertEqual(result['identity_status'], 'confirmed')
        self.assertEqual(result['person_id'], person)
        other = np.zeros(128, np.float32)
        other[1] = 1
        self.assertEqual(self.people.match('track', other, 1)['identity_status'], 'unknown')
        self.assertEqual(self.people.match('track', self.vector, 1.2)['identity_status'], 'candidate')

    def test_a_confirmed_track_after_a_long_gap_requires_fresh_confirmation(self):
        self.enroll()
        for now in (0, .3, .6):
            self.people.match('track', self.vector, now)
        self.assertEqual(self.people.match('track', self.vector, 4)['identity_status'], 'candidate')
