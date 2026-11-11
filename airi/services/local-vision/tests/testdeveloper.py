import hashlib
import json
import secrets
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from developer import DeveloperAccess
from identity import People
from social import SocialLearning
from service import app, state


class DeveloperTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        folder = Path(self.folder.name)
        salt = secrets.token_bytes(32)
        self.password = secrets.token_urlsafe(24)
        config = dict(username='test-developer', salt=salt.hex(), hash=hashlib.scrypt(
            self.password.encode(), salt=salt, n=16384, r=8, p=1).hex())
        path = folder / 'auth.json'
        path.write_text(json.dumps(config))
        self.access = DeveloperAccess(path)
        self.patch = patch('developer.access', self.access)
        self.patch.start()
        self.service_patch = patch('service.access', self.access)
        self.service_patch.start()
        self.original = state.runtime
        self.people = People(folder, 'test')
        state.runtime = SimpleNamespace(people=self.people, reset=lambda: None, perception=lambda: dict(model='test'))
        self.client = TestClient(app, base_url='http://127.0.0.1:18765', headers={'Authorization': 'Bearer ' + state.credential})

    def tearDown(self):
        self.client.close()
        state.runtime = self.original
        self.patch.stop()
        self.service_patch.stop()
        self.folder.cleanup()

    def login(self):
        response = self.client.post('/developer/session', json=dict(username='test-developer', password=self.password))
        self.assertEqual(response.status_code, 200)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('SameSite=strict', response.headers['set-cookie'])
        self.assertNotIn(self.password, response.text)
        cookie = response.headers['set-cookie'].split(';')[0]
        self.client.headers['Cookie'] = cookie
        return cookie.split('=', 1)[1]

    def test_guests_cannot_read_or_modify_management_routes(self):
        for path in ('/admin/overview', '/admin/persons/test', '/persons'):
            self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.client.get('/metrics').status_code, 200)
        self.assertIsNone(self.client.get('/metrics').json()['observation'])
        self.assertEqual(self.client.patch('/admin/rules/name-confirmation', json=dict(text='changed')).status_code, 403)
        self.assertEqual(self.client.delete('/persons/test').status_code, 403)
        self.assertEqual(self.client.delete('/admin/persons/test').status_code, 403)
        self.assertEqual(self.client.delete('/admin/persons/test/face-extensions/round').status_code, 403)
        self.assertEqual(self.client.get('/developer/session').json()['authenticated'], False)

    def test_login_failure_limit_logout_expiry_and_restart(self):
        for _ in range(5):
            self.assertEqual(self.client.post('/developer/session', json=dict(username='test-developer', password='incorrect')).status_code, 401)
        self.assertEqual(self.client.post('/developer/session', json=dict(username='test-developer', password=self.password)).status_code, 429)
        self.access.failures.clear()
        token = self.login()
        self.assertEqual(self.client.get('/admin/overview').status_code, 200)
        self.access.sessions[token] = time.time() - 1
        self.assertEqual(self.client.get('/admin/overview').status_code, 403)
        self.login()
        self.assertEqual(self.client.delete('/developer/session').status_code, 200)
        self.assertEqual(self.client.get('/admin/overview').status_code, 403)
        self.login()
        self.access.sessions.clear()
        self.assertEqual(self.client.get('/admin/overview').status_code, 403)

    def test_developer_changes_keep_person_id_and_character_isolation(self):
        vector = np.eye(1, 128, dtype=np.float32)[0]
        person = self.people.enroll('测试甲', [vector] * 10)
        self.people.remember(person, 'a', 'turn', '生成的测试正文')
        self.people.remember(person, 'b', 'turn', '另一角色的正文')
        self.login()
        response = self.client.patch('/admin/persons/' + person, json=dict(name='测试乙'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.people.list()), 1)
        self.assertEqual(self.people.profile(person, 'a')['display_name'], '测试乙')
        path = '/admin/persons/' + person + '/memories/turn?character=a'
        self.assertEqual(self.client.patch(path, json=dict(text='更新的正文')).status_code, 200)
        self.assertEqual(self.people.memory_records(person, 'a')[0]['text'], '更新的正文')
        self.assertEqual(self.people.memory_records(person, 'b')[0]['text'], '另一角色的正文')
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual(self.people.memory_records(person, 'a'), [])
        self.assertEqual(self.client.patch('/admin/rules/name-confirmation', json=dict(text='测试行为规则')).status_code, 200)
        reopened = People(Path(self.folder.name), 'test')
        self.assertEqual(reopened.rules()[0]['text'], '测试行为规则')
        overview = self.client.get('/admin/overview').json()
        self.assertEqual(overview['counts']['people'], 1)
        self.assertNotIn('"template":', json.dumps(overview))
        self.assertEqual(self.client.delete('/admin/persons/' + person).status_code, 200)
        self.assertEqual(reopened.memory_records(person, 'b'), [])

    def test_revoked_session_cannot_write_after_waiting_for_the_worker(self):
        self.login()
        original = self.people.rules()[0]['text']
        async def revoked_worker(function, *args):
            self.access.sessions.clear()
            return function(*args)
        with patch.object(state, 'worker', revoked_worker):
            response = self.client.patch('/admin/rules/name-confirmation', json=dict(text='unauthorized change'))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.people.rules()[0]['text'], original)

    def test_configuration_stores_only_a_salted_digest_and_rejects_other_usernames(self):
        self.access.configure('test-developer', self.password)
        stored = self.access.path.read_text()
        self.assertNotIn(self.password, stored)
        self.assertEqual(self.client.post('/developer/session', json=dict(username='错误账号', password=self.password)).status_code, 401)
        self.login()

    def test_developer_can_revoke_one_extension_round_without_deleting_original_data(self):
        vector = np.eye(1, 128, dtype=np.float32)[0]
        person = self.people.enroll('测试人物', [vector] * 10)
        self.people.rename(person, '测试人物')
        feature = np.eye(1, 512, dtype=np.float32)[0]
        self.people.add_extensions(person, 'test:512', 'test-round', 'base-hash',
            [dict(vector=feature, pose='left', light='normal', jpeg=b'\xff\xd8test')])
        self.people.remember(person, 'airi', 'turn', '测试记忆')
        self.login()
        before = self.client.get('/admin/persons/' + person + '?character=airi').json()
        self.assertEqual(before['face_extensions'][0]['count'], 1)
        self.assertNotIn('feature', before)
        self.assertNotIn('image', before)
        self.assertEqual(self.client.delete('/admin/persons/' + person + '/face-extensions/test-round').status_code, 200)
        self.assertEqual(self.people.extension_records(person), [])
        self.assertEqual(self.people.memory_records(person, 'airi')[0]['text'], '测试记忆')
        self.assertEqual(len(self.people.list()), 1)

    def test_AIRI_042_forgetting_removes_every_personal_table_and_allows_a_fresh_introduction(self):
        vector = np.eye(1, 128, dtype=np.float32)[0]
        person = self.people.enroll('生成测试人物', [vector] * 10, {'front': b'generated-jpeg'})
        other = self.people.enroll('另一个生成测试人物', [np.eye(2, 128, dtype=np.float32)[1]] * 10)
        self.people.rename(person, '生成测试人物')
        self.people.remember(person, 'first-character', 'generated-first', '生成测试记忆一')
        self.people.remember(person, 'second-character', 'generated-second', '生成测试记忆二')
        self.people.remember(other, 'first-character', 'generated-other', '其他人物记忆')
        feature = np.eye(1, 512, dtype=np.float32)[0]
        self.people.add_extensions(person, 'test:512', 'generated-round', 'base-hash',
            [dict(vector=feature, pose='left', light='normal', jpeg=b'\xff\xd8generated')])
        with self.people.connect() as db:
            db.execute('INSERT INTO recognition_templates VALUES (?,?,?,?,?)', (person, 'test:512', 'front', 'generated-hash', b'generated-encrypted-feature'))
        reset = unittest.mock.Mock()
        state.runtime.reset = reset
        self.login()
        path = '/admin/persons/' + person
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual(self.client.get(path).status_code, 404)
        reset.assert_called_once()
        reopened = People(Path(self.folder.name), 'test')
        with reopened.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM people WHERE id=?', (person,)).fetchone()[0], 0)
            for table in ('photos', 'memories', 'encounters', 'recognition_templates', 'face_extensions', 'name_confirmations'):
                self.assertEqual(db.execute(f'SELECT COUNT(*) FROM {table} WHERE person=?', (person,)).fetchone()[0], 0, table)
        self.assertEqual(reopened.memory_records(other, 'first-character')[0]['text'], '其他人物记忆')
        self.assertTrue(reopened.rules())
        self.assertEqual(self.client.delete(path).status_code, 200)
        social = SocialLearning(reopened)
        unknown = dict(identity_status='unknown', person_id=None, display_name=None)
        social.converse('fresh-track', unknown, '我叫新朋友', 'first-character', 'fresh-introduction')
        self.assertEqual(social.status()['name_state'], 'confirming')
        self.assertEqual(len(reopened.list()), 1)
        social.converse('fresh-track', unknown, '名字正确', 'first-character', 'fresh-confirmation')
        for index in range(10):
            with patch('social.time.monotonic', return_value=social.started + 1 + index * .5):
                social.sample('fresh-track', vector, 'front', b'generated-jpeg', unknown)
        self.assertIsNotNone(social.person)
        self.assertNotEqual(social.person, person)
        self.assertEqual([item['event_id'] for item in reopened.memory_records(social.person, 'first-character')], ['fresh-introduction'])
