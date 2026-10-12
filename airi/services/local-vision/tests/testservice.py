import unittest
import tempfile
import time
import numpy as np
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from service import app, state
from identity import People
from social import SocialLearning


class ServiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url='http://127.0.0.1:18765')

    def tearDown(self):
        self.client.close()

    def test_health_requires_the_local_gateway_credential(self):
        self.assertEqual(self.client.get('/health').status_code, 403)
        self.assertEqual(self.client.get('/health', headers={'Authorization': 'Bearer wrong'}).status_code, 403)
        response = self.client.get('/health', headers={'Authorization': 'Bearer ' + state.credential})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('credential', response.text)
        self.assertFalse(response.json()['ready'])

    def test_host_rebinding_is_denied_even_with_the_credential(self):
        response = self.client.get('/health', headers={'Host': 'evil.example:18765', 'Authorization': 'Bearer ' + state.credential})
        self.assertEqual(response.status_code, 403)

    def test_unpaired_websocket_cannot_connect(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/stream?ticket=wrong', headers={'Origin': 'http://127.0.0.1:5173'}):
                self.fail('Unauthorized websocket connected')

    def test_no_arbitrary_media_urls_or_paths(self):
        response = self.client.post('/bindings', headers={'Authorization': 'Bearer ' + state.credential}, json={'owner': 'test', 'url': 'file:///private'})
        self.assertEqual(response.status_code, 422)

    def test_runtime_sleep_requires_gateway_authorization(self):
        self.assertEqual(self.client.post('/runtime/sleep').status_code, 403)
        self.assertFalse(state.quiescing)

    def test_sleep_fences_new_bindings_and_wake_restores_them(self):
        headers = {'Authorization': 'Bearer ' + state.credential}
        try:
            self.assertTrue(self.client.post('/runtime/sleep', headers=headers).json()['idle'])
            self.assertEqual(self.client.post('/bindings', headers=headers, json={'owner': 'test'}).json()['detail'], 'runtime-sleeping')
            self.assertEqual(self.client.post('/runtime/wake', headers=headers).status_code, 200)
            self.assertFalse(state.quiescing)
        finally:
            state.quiescing = False

    def test_sleep_never_claims_another_camera_binding(self):
        original = state.source
        state.source = {'session_binding_id': 'another-client'}
        try:
            response = self.client.post('/runtime/sleep', headers={'Authorization': 'Bearer ' + state.credential})
            self.assertFalse(response.json()['idle'])
            self.assertFalse(state.quiescing)
            self.assertEqual(state.source['session_binding_id'], 'another-client')
        finally:
            state.source = original


class SocialServiceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        people = People(Path(self.folder.name), 'test-model')
        self.actor = dict(track_id='track', primary=True, identity_status='unknown', person_id=None, display_name=None)
        self.original_runtime = state.runtime
        # The camera/model boundary provides synthetic evidence. The API, worker and database are real.
        state.runtime = SimpleNamespace(people=people, social=SocialLearning(people),
                                        identities={'track': (time.monotonic(), dict(self.actor))})
        state.source = dict(session_binding_id='binding', privacy_generation=1)
        state.policy = dict(face=True)
        state.snapshot = dict(payload=dict(actors=[self.actor]))
        state.frame_at = time.monotonic()
        self.client = TestClient(app, base_url='http://127.0.0.1:18765',
                                 headers={'Authorization': 'Bearer ' + state.credential})
        self.turn = dict(track_id='track', text='我叫小明', character='airi', event_id='turn')

    def tearDown(self):
        self.client.close()
        state.runtime = self.original_runtime
        state.source = None
        state.snapshot = None
        state.policy = dict(face=False)
        self.folder.cleanup()

    def test_real_conversation_starts_learning_without_an_enrollment_command(self):
        asked = self.client.post('/bindings/binding/social', json=dict(track_id='track', character='airi', ask_name=True))
        self.assertTrue(asked.json()['learning']['awaiting_name'])
        response = self.client.post('/bindings/binding/conversation', json=self.turn)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['outcome'], 'confirming')
        self.assertEqual(response.json()['learning']['name'], '小明')

    def test_stale_frames_and_missing_face_evidence_cannot_own_words(self):
        state.frame_at -= 3
        self.assertEqual(self.client.post('/bindings/binding/conversation', json=self.turn).status_code, 409)
        state.frame_at = time.monotonic()
        state.runtime.identities.clear()
        self.assertEqual(self.client.post('/bindings/binding/conversation', json=self.turn).status_code, 409)
        self.assertFalse(state.runtime.social.status()['learning'])

    def test_multiple_people_cannot_bind_a_conversation_to_one_profile(self):
        state.snapshot['payload']['actors'].append(dict(self.actor, track_id='other', primary=False))
        self.assertEqual(self.client.post('/bindings/binding/conversation', json=self.turn).status_code, 409)
        self.assertFalse(state.runtime.social.status()['learning'])

    def test_camera_revocation_before_worker_execution_rejects_a_queued_turn(self):
        async def revoked_worker(function, *args):
            state.source = None
            return function(*args)
        with patch.object(state, 'worker', revoked_worker):
            response = self.client.post('/bindings/binding/conversation', json=self.turn)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(state.runtime.social.status()['learning'])

    def test_name_correction_never_reuses_the_previous_matching_persons_memories(self):
        vector = np.zeros(128, np.float32)
        vector[0] = 1
        person = state.runtime.people.enroll('其他人', [vector] * 10)
        state.runtime.people.remember(person, 'airi', 'old-turn', '以前的私人记忆')
        self.actor.update(identity_status='confirmed', person_id=person, display_name='其他人')
        self.assertEqual(self.client.post('/bindings/binding/conversation', json=self.turn).status_code, 200)
        response = self.client.post('/bindings/binding/social', json=dict(track_id='track', character='airi', ask_name=False))
        self.assertEqual(response.json()['learning']['name'], '小明')
        self.assertIsNone(response.json()['profile'])
