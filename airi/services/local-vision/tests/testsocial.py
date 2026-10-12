import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from identity import People, protect
from social import SocialLearning, spoken_name


class SocialTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.people = People(Path(self.folder.name), 'test-model')
        self.social = SocialLearning(self.people)
        self.vector = np.zeros(128, np.float32)
        self.vector[0] = 1
        self.unknown = dict(identity_status='unknown', person_id=None, display_name=None)

    def tearDown(self):
        self.folder.cleanup()

    def test_names_come_from_introductions_not_questions_or_general_chat(self):
        self.assertEqual(spoken_name('我叫小明，很高兴认识你'), '小明')
        self.assertEqual(spoken_name('叫我阿明就行'), '阿明')
        self.assertEqual(spoken_name('My name is Alex'), 'Alex')
        self.assertEqual(spoken_name('小明', True), '小明')
        self.assertEqual(spoken_name('我是小明', True), '小明')
        for text in ('你叫什么名字？', '今天天气很好', '我喜欢打球', '不要记住我', '小明', 'I am tired'):
            self.assertIsNone(spoken_name(text))
        self.assertIsNone(spoken_name('今天天气很好', True))
        self.assertIsNone(spoken_name('我叫桃我叫陶我叫桃心我叫陶新宇'))

    def introduce(self):
        with patch('social.time.monotonic', return_value=10):
            self.social.ask('track')
            self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
            self.social.converse('track', self.unknown, '名字正确', 'airi', 'confirm')
        for index in range(10):
            with patch('social.time.monotonic', return_value=11 + index * .5):
                self.social.sample('track', self.vector, 'front', b'face-jpeg', self.unknown)
        return self.social.person

    def test_AIRI_025_no_profile_is_saved_until_the_name_is_confirmed(self):
        self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
        started = self.social.started
        for index in range(12):
            with patch('social.time.monotonic', return_value=started + index * .5):
                self.social.sample('track', self.vector, 'front', b'face', self.unknown)
        self.assertEqual(self.people.list(), [])
        self.assertEqual(self.social.status()['name_state'], 'confirming')

    def test_AIRI_025_correction_preserves_profile_and_requires_confirmation(self):
        person = self.introduce()
        self.people.remember(person, 'airi', 'hobby', '我喜欢骑车')
        known = dict(identity_status='confirmed', person_id=person, display_name='小明')
        self.social.converse('track', known, '名字写错了，把明改成铭', 'airi', 'fix')
        self.assertEqual(self.people.profile(person, 'airi')['display_name'], '小明')
        self.assertEqual(self.social.status()['name'], '小铭')
        self.social.converse('track', known, '名字正确', 'airi', 'yes')
        self.assertEqual(self.people.profile(person, 'airi')['display_name'], '小铭')
        self.assertEqual(len(self.people.list()), 1)
        self.assertTrue(any(m['text'] == '我喜欢骑车' for m in self.people.profile(person, 'airi')['memories']))

    def test_AIRI_025_ambiguous_spelling_asks_for_complete_name(self):
        self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
        self.social.converse('track', self.unknown, '不是这个字', 'airi', 'no')
        self.assertEqual(self.social.status()['name_state'], 'correcting')
        self.social.converse('track', self.unknown, '小铭', 'airi', 'spelling')
        self.assertEqual(self.social.status()['name'], '小铭')
        self.assertEqual(self.social.status()['name_state'], 'confirming')

    def test_AIRI_025_repeated_denial_and_expired_confirmation_do_not_save_a_name(self):
        with patch('social.time.monotonic', return_value=10):
            self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
            self.social.converse('track', self.unknown, '不对', 'airi', 'no')
            self.social.converse('track', self.unknown, '还是不对', 'airi', 'no-again')
            self.assertEqual(self.social.status()['name'], '小明')
            self.assertEqual(self.social.status()['name_state'], 'correcting')
        with patch('social.time.monotonic', return_value=200):
            self.social.converse('track', self.unknown, '名字正确', 'airi', 'late')
            self.assertEqual(self.social.status()['name_state'], 'idle')
        self.assertEqual(self.people.list(), [])

    def test_AIRI_025_general_disagreement_does_not_change_the_name_workflow(self):
        person = self.introduce()
        known = dict(identity_status='confirmed', person_id=person, display_name='小明')
        with patch('social.time.monotonic', return_value=20):
            self.social.converse('track', known, '我不是很喜欢这个天气', 'airi', 'general')
        self.assertEqual(self.social.name_state, 'confirmed')
        self.assertEqual(self.people.profile(person, 'airi')['memories'][0]['text'], '我不是很喜欢这个天气')

    def test_introduction_saves_profile_without_manual_registration_and_adds_angles(self):
        person = self.introduce()
        self.assertIsNotNone(person)
        profile = self.people.profile(person, 'airi')
        self.assertEqual(profile['display_name'], '小明')
        self.assertEqual(profile['poses'], ['front'])
        self.assertEqual(profile['memories'][0]['text'], '我叫小明')
        with patch('social.time.monotonic', return_value=20):
            self.social.sample('track', self.vector, 'left', b'left-photo', self.unknown)
        with patch('social.time.monotonic', return_value=21):
            self.social.sample('track', self.vector, 'right', b'right-photo', self.unknown)
        self.assertEqual(self.people.profile(person, 'airi')['poses'], ['front', 'left', 'right'])
        with self.people.connect() as db:
            template = db.execute('SELECT template FROM people WHERE id=?', (person,)).fetchone()[0]
        self.assertEqual(len(np.frombuffer(protect(template, True), dtype=np.float32)) // 128, 12)
        with self.people.connect() as db:
            encrypted = db.execute('SELECT image FROM photos WHERE pose=?', ('left',)).fetchone()[0]
        self.assertNotIn(b'left-photo', encrypted)
        self.assertEqual(protect(encrypted, True), b'left-photo')

    def test_memories_are_deduplicated_and_scoped_to_person_and_character(self):
        person = self.introduce()
        self.people.remember(person, 'airi', 'turn-2', '我喜欢骑车')
        self.people.remember(person, 'airi', 'turn-2', 'duplicate')
        memories = self.people.profile(person, 'airi')['memories']
        self.assertEqual(sum(memory['text'] == '我喜欢骑车' for memory in memories), 1)
        self.assertEqual(self.people.profile(person, 'other')['memories'], [])
        self.people.forget(person, 'airi')
        self.assertEqual(self.people.profile(person, 'airi')['memories'], [])
        self.assertEqual(self.people.profile(person, 'airi')['poses'], ['front'])

    def test_saved_name_photos_and_memories_survive_camera_and_service_restart(self):
        person = self.introduce()
        self.social.reset()
        reopened = People(Path(self.folder.name), 'test-model')
        matched = None
        for now in (100, 100.3, 100.6):
            matched = reopened.match('new-camera-track', self.vector, now)
        self.assertEqual(matched['identity_status'], 'confirmed')
        self.assertEqual(matched['person_id'], person)
        self.assertEqual(matched['display_name'], '小明')
        profile = reopened.profile(person, 'airi')
        self.assertEqual(profile['poses'], ['front'])
        self.assertEqual(profile['memories'][0]['text'], '我叫小明')
        with reopened.connect() as db:
            photo = db.execute('SELECT image FROM photos WHERE person=?', (person,)).fetchone()[0]
        self.assertEqual(protect(photo, True), b'face-jpeg')

    def test_multiple_people_or_track_change_cancel_pending_learning(self):
        self.social.converse('first', self.unknown, '我叫小明', 'airi', 'intro')
        self.social.observe(['first', 'second'])
        self.assertFalse(self.social.status()['learning'])
        self.assertEqual(self.people.list(), [])
        self.social.converse('first', self.unknown, '我叫小明', 'airi', 'intro')
        self.social.observe(['second'])
        self.assertEqual(self.social.name, '')

    def test_a_brief_detector_miss_keeps_an_introduction_but_another_person_cancels_it(self):
        with patch('social.time.monotonic', return_value=10):
            self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
        with patch('social.time.monotonic', return_value=10.1):
            self.social.observe([])
        self.assertEqual(self.social.name, '小明')
        with patch('social.time.monotonic', return_value=10.2):
            self.social.observe(['other'])
        self.assertEqual(self.social.name, '')

    def test_refusal_discards_pending_photos_and_deletion_removes_all_profile_data(self):
        self.social.converse('track', self.unknown, '我叫小明', 'airi', 'intro')
        self.assertEqual(self.social.converse('track', self.unknown, '不要记录我', 'airi', 'decline'), 'declined')
        self.assertEqual(self.social.samples, [])
        person = self.introduce()
        self.people.delete(person)
        self.assertIsNone(self.people.profile(person, 'airi'))
        with self.people.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM photos').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM memories').fetchone()[0], 0)

    def test_known_person_can_revoke_memory_in_conversation(self):
        person = self.introduce()
        known = dict(identity_status='confirmed', person_id=person, display_name='小明')
        self.assertEqual(self.social.converse('track', known, '不要记住我', 'airi', 'forget'), 'declined')
        self.assertIsNone(self.people.profile(person, 'airi'))
        self.assertEqual(self.social.converse('track', known, '今天天气很好', 'airi', 'later'), 'declined')
