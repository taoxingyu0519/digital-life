import tempfile
import unittest
from pathlib import Path

import numpy as np

from identity import People, protect
from recognition import FaceEvidence, RecognitionClock, RecognitionGallery


class RecognitionTests(unittest.TestCase):
    def test_fixed_reference_never_confirms_a_new_track_or_hides_conflict_or_loss(self):
        confirmed = dict(identity_status='confirmed', person_id='person-a', display_name='A')
        unknown = dict(identity_status='unknown', person_id=None, display_name=None)
        reference = np.array([.7, np.sqrt(1 - .7 ** 2)], np.float32)
        weak = np.array([.48, np.sqrt(1 - .48 ** 2)], np.float32)
        for disruption in ('different-person', 'ambiguous', 'lost', 'jump', 'expired'):
            with self.subTest(disruption=disruption):
                evidence = FaceEvidence()
                evidence.stabilize('a', [(.7, 'person-a', 'A')], reference, 0, confirmed, None)
                ranked = [(.48, 'person-a', 'A')]
                now = 1
                if disruption == 'different-person':
                    ranked = [(.6, 'person-b', 'B')]
                elif disruption == 'ambiguous':
                    ranked.append((.46, 'person-b', 'B'))
                elif disruption == 'lost':
                    evidence.retain(set(), .5)
                elif disruption == 'jump':
                    evidence.clear('a')
                else:
                    now = 2.6
                result, _ = evidence.stabilize('a', ranked, weak, now, unknown, confirmed)
                self.assertIsNone(result['person_id'])
        evidence = FaceEvidence()
        result, _ = evidence.stabilize('new', [(.48, 'person-a', 'A')], weak, 0, unknown, None)
        self.assertIsNone(result['person_id'])

    def test_confirmed_face_reduces_embeddings_but_changes_and_learning_restore_them(self):
        clock = RecognitionClock()
        image = np.full((112, 112, 3), 100, np.uint8)
        self.assertTrue(clock.due('a', 0, image, False, False))
        self.assertTrue(clock.due('a', .2, image, False, False))
        self.assertFalse(clock.due('a', .4, image, True, False))
        self.assertFalse(clock.due('a', .8, image, True, False))
        self.assertTrue(clock.due('a', 1.2, image, True, False))
        self.assertTrue(clock.due('a', 1.4, image, True, True))
        self.assertTrue(clock.due('a', 1.6, np.full_like(image, 200), True, False))
        self.assertTrue(clock.due('b', 1.7, image, True, False))
        clock.clear('a')
        self.assertTrue(clock.due('a', 1.8, image, True, False))

    def test_weighted_evidence_does_not_hide_a_stranger_or_a_different_person(self):
        evidence = FaceEvidence()
        evidence.fuse('a', [(.8, 'person-a', 'A')], 0, 'accepted')
        fused = evidence.fuse('a', [(.52, 'person-a', 'A')], .3, 'recognition-only')
        self.assertGreater(fused[0][0], .7)
        stranger = [(.2, 'person-a', 'A')]
        self.assertEqual(evidence.fuse('a', stranger, .6, 'accepted'), stranger)
        self.assertEqual(evidence.fuse('a', [(.6, 'person-b', 'B')], .9, 'accepted')[0][0], .6)
        ambiguous = [(.8, 'person-a', 'A'), (.75, 'person-b', 'B')]
        self.assertEqual(evidence.fuse('a', ambiguous, 1.2, 'accepted'), ambiguous)

    def test_expired_fusion_cannot_restore_old_high_scores(self):
        evidence = FaceEvidence()
        evidence.fuse('a', [(.9, 'person-a', 'A')], 0, 'accepted')
        self.assertEqual(evidence.fuse('a', [(.51, 'person-a', 'A')], 3, 'accepted')[0][0], .51)

    def test_lost_tracks_release_retained_images_and_scores(self):
        clock = RecognitionClock()
        evidence = FaceEvidence()
        image = np.full((112, 112, 3), 100, np.uint8)
        clock.due('old', 0, image, True, False)
        evidence.fuse('old', [(.9, 'person-a', 'A')], 0, 'accepted')
        clock.retain(set(), 3)
        evidence.retain(set(), 3)
        self.assertTrue(clock.due('old', 3.1, image, True, False))
        self.assertEqual(evidence.fuse('old', [(.51, 'person-a', 'A')], 3.1, 'accepted')[0][0], .51)

    def test_model_specific_gallery_keeps_profiles_and_encrypts_new_features(self):
        with tempfile.TemporaryDirectory() as directory:
            people = People(Path(directory), 'sface-test')
            vector = np.zeros(128, np.float32)
            vector[0] = 1
            import cv2
            image = np.full((112, 112, 3), 127, np.uint8)
            photo = cv2.imencode('.jpg', image)[1].tobytes()
            person = people.enroll('test-person', [vector] * 10, {'front': photo})
            people.remember(person, 'test', 'intro', 'real statement')

            class Encoder:
                version = 'external-model-test:512-v1'

                def feature(self, aligned):
                    result = np.zeros(512, np.float32)
                    result[1] = 1
                    return result

            gallery = RecognitionGallery(Encoder(), people)
            query = np.zeros(512, np.float32)
            query[1] = 1
            self.assertEqual(gallery.scores(query)[0][1], person)
            with people.connect() as db:
                feature = db.execute('SELECT feature FROM recognition_templates').fetchone()[0]
                canonical = db.execute('SELECT template FROM people').fetchone()[0]
            self.assertNotIn(query.tobytes(), feature)
            self.assertEqual(len(protect(canonical, True)) // (4 * 128), 10)
            reopened = RecognitionGallery(Encoder(), People(Path(directory), 'sface-test'))
            self.assertEqual(reopened.scores(query)[0][1], person)
            self.assertEqual(people.profile(person, 'test')['memories'][0]['text'], 'real statement')
            people.delete(person)
            self.assertEqual(gallery.scores(query), [])
            with people.connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM recognition_templates').fetchone()[0], 0)
