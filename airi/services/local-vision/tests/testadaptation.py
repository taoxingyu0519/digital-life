"""AIRI-029: real encrypted galleries reject interrupted trajectories and reversible learning chains."""
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from adaptation import TrajectoryLearning
from identity import People
from recognition import RecognitionGallery


class Encoder:
    name = 'edge-test'
    version = 'edge-test:512'

    def feature(self, image):
        result = np.zeros(512, np.float32)
        result[0] = 1
        return result


class AdaptationTests(unittest.TestCase):
    # https://espace2.etsmtl.ca/id/eprint/9302/ distinguishes recognition from trajectory update authorization.
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.people = People(Path(self.folder.name), 'sface-test')
        original = np.zeros(128, np.float32)
        original[0] = 1
        self.photo = cv2.imencode('.jpg', np.full((112, 112, 3), 127, np.uint8))[1].tobytes()
        self.person = self.people.enroll('测试人物', [original] * 10, {'front': self.photo})
        self.people.rename(self.person, '测试人物')
        self.gallery = RecognitionGallery(Encoder(), self.people)
        self.learning = TrajectoryLearning(self.gallery)
        self.base = Encoder().feature(None)
        self.now = 0

    def sample(self, cosine=1, quality='accepted', track='1', box=None, interval=.3):
        self.now += interval
        body = box or [0, 0, 1, 1]
        self.learning.frame([(track, body)], self.now)
        vector = np.zeros(512, np.float32)
        vector[0], vector[1] = cosine, np.sqrt(1 - cosine ** 2)
        self.learning.sample(track, self.now, [.2, .1, .6, .5], vector, quality,
                             'left', 'normal', self.photo, lambda: True)

    def open(self):
        for _ in range(3):
            self.sample()

    def turn(self):
        for cosine in (.85, .65, .45):
            self.sample(cosine)

    def close(self):
        for cosine in (.65, .85, 1, 1, 1):
            self.sample(cosine)

    def test_difficult_angle_waits_for_three_base_confirmations_then_improves_matching(self):
        self.open()
        self.turn()
        self.assertEqual(self.people.extension_records(self.person), [])
        self.assertGreater(self.learning.status()['candidates'], 0)
        self.close()
        records = self.people.extension_records(self.person)
        self.assertEqual(len(records), 1)
        self.assertGreater(records[0]['count'], 0)
        vector = np.zeros(512, np.float32)
        vector[0], vector[1] = .45, np.sqrt(1 - .45 ** 2)
        self.assertLess(self.gallery.base_scores(vector)[0][0], .55)
        self.assertGreater(self.gallery.scores(vector)[0][0], .99)
        self.people.revoke_extensions(self.person, records[0]['round_id'])
        self.assertLess(self.gallery.scores(vector)[0][0], .55)
        self.assertEqual(len(self.people.profile(self.person, 'airi')['poses']), 1)

    def test_one_hz_with_jitter_still_requires_base_confirmation_before_and_after_learning(self):
        for cosine in (1, 1, 1, .85, .65, .45):
            self.sample(cosine, interval=1.02)
        self.assertEqual(self.people.extension_records(self.person), [])
        for cosine in (.65, .85, 1, 1, 1):
            self.sample(cosine, interval=1.02)
        self.assertEqual(len(self.people.extension_records(self.person)), 1)

    def test_face_loss_body_jump_or_long_gap_prevents_learning_even_after_same_face_returns(self):
        for disruption in ('lost', 'jump', 'gap', 'multiple'):
            with self.subTest(disruption=disruption):
                self.learning.clear()
                self.open()
                self.turn()
                if disruption == 'lost':
                    self.learning.frame([], self.now + .1)
                elif disruption == 'multiple':
                    self.learning.frame([('1', [0, 0, .6, 1]), ('2', [.4, 0, 1, 1])], self.now + .1)
                elif disruption == 'jump':
                    self.sample(.45, box=[.3, 0, 1, 1])
                else:
                    self.now += 2
                self.close()
                self.assertEqual(self.people.extension_records(self.person), [])

    def test_unknown_face_cannot_bootstrap_and_extensions_cannot_authorize_new_learning(self):
        self.open()
        self.turn()
        self.close()
        before = self.people.extension_records(self.person)
        self.learning.clear()
        for _ in range(20):
            self.sample(.45)
        self.assertEqual(self.learning.status()['candidates'], 0)
        self.assertEqual(self.people.extension_records(self.person), before)

    def test_blur_conflicting_face_and_revoked_current_generation_discard_candidates(self):
        for disruption in ('blur', 'conflict', 'revoked'):
            with self.subTest(disruption=disruption):
                self.learning.clear()
                self.open()
                self.turn()
                if disruption == 'blur':
                    self.sample(.45, quality='blur-or-exposure')
                elif disruption == 'conflict':
                    self.sample(-.4)
                else:
                    self.learning.sample('1', self.now, [.2, .1, .6, .5], self.base, 'accepted',
                                         'front', 'normal', self.photo, lambda: False)
                self.close()
                self.assertEqual(self.people.extension_records(self.person), [])

    def test_delete_profile_removes_extensions_and_preserves_original_until_deletion(self):
        self.open()
        self.turn()
        self.close()
        with self.people.connect() as db:
            self.assertGreater(db.execute('SELECT COUNT(*) FROM face_extensions').fetchone()[0], 0)
        self.people.delete(self.person)
        self.assertEqual(self.gallery.scores(self.base), [])
        with self.people.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM face_extensions').fetchone()[0], 0)

    def test_base_revision_change_prevents_closing_a_round_with_new_references(self):
        self.open()
        self.turn()
        self.people.rename(self.person, '修正姓名')
        self.close()
        self.assertEqual(self.people.extension_records(self.person), [])
