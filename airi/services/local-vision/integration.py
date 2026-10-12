"""Synthetic JPEGs exercise the real HTTP, WebSocket and inference path without a camera."""
import asyncio
import json
import struct
import time
from datetime import datetime, timezone
from urllib.parse import quote

import cv2
import httpx
import numpy as np
from websockets.asyncio.client import connect

from registry import DATA


async def exercise():
    gateway_checks = []
    async with httpx.AsyncClient(base_url='http://127.0.0.1:5173', timeout=10) as gateway:
        assert (await gateway.get('/api/local-vision/health')).status_code == 403
        gateway_checks.append('custom-header-required')
        denied = await gateway.get('/api/local-vision/health', headers={'X-Airi-Vision': '1', 'Origin': 'https://example.invalid'})
        assert denied.status_code == 403
        gateway_checks.append('cross-origin-denied')
        assert (await gateway.get('/api/local-vision/health', headers={'X-Airi-Vision': '1'})).status_code == 200
        for name in ('credential', 'people.sqlite'):
            for suffix in ('', '?raw', '?import&raw'):
                path = '/@fs/' + quote((DATA / name).as_posix(), safe='/:') + suffix
                response = await gateway.get(path)
                assert response.status_code in (403, 404), (name, suffix, response.status_code)
        gateway_checks.append('private-files-blocked-six-routes')
    headers = {'Authorization': 'Bearer ' + (DATA / 'credential').read_text().strip()}
    async with httpx.AsyncClient(base_url='http://127.0.0.1:18765', headers=headers, timeout=20) as client:
        health = (await client.get('/health')).json()
        binding = await client.post('/bindings', json={'owner': 'synthetic-integration'})
        binding.raise_for_status()
        source = binding.json()
        path = '/bindings/' + source['session_binding_id']
        try:
            policy = await client.post(path + '/policy', json={'face': False, 'camera_condition': 'a' * 64})
            policy.raise_for_status()
            source = policy.json()
            conflict = await client.post('/bindings', json={'owner': 'second-owner'})
            assert conflict.status_code == 409
            ticket = (await client.post(path + '/ticket')).json()['ticket']
            _, encoded = cv2.imencode('.jpg', np.full((720, 1280, 3), 127, np.uint8))
            jpeg = encoded.tobytes()
            elapsed = []
            async with connect('ws://127.0.0.1:18765/stream?ticket=' + ticket, origin='http://127.0.0.1:5173', max_size=2**20) as socket:
                for seq in range(5):
                    fields = {key: source[key] for key in ('session_binding_id', 'source_id', 'epoch', 'privacy_generation')}
                    fields.update(schema_version='1.0', seq=seq, captured_at_utc=datetime.now(timezone.utc).isoformat(),
                                  capture_monotonic_ms=time.monotonic() * 1000, width=1280, height=720, mime_type='image/jpeg', jpeg_bytes=len(jpeg))
                    header = json.dumps(fields).encode()
                    started = time.monotonic()
                    await socket.send(b'LV01' + struct.pack('>I', len(header)) + header + jpeg)
                    message = json.loads(await asyncio.wait_for(socket.recv(), 10))
                    assert message['snapshot']['seq'] == seq
                    assert message['snapshot']['source_id'] == source['source_id']
                    assert message['snapshot']['payload']['actors'] == []
                    assert message['recognition'] is None
                    assert message['adaptation'] is None
                    assert 'image' not in message and 'credential' not in message
                    elapsed.append((time.monotonic() - started) * 1000)
                    await asyncio.sleep(.075)
        finally:
            await client.delete(path)
        return dict(status='PASS', evidence_mode='synthetic', frames=5, health=health, round_trip_ms=elapsed,
                    checks=[*gateway_checks, 'face-disabled-policy', 'recognition-diagnostics-empty-without-face', 'single-owner', 'real-jpeg-decode', 'real-model-inference', 'LV01-result-correlation', 'release'],
                    note='合成 JPEG 验证真实服务协议和推理，不包含真人摄像头、识别准确率、舞台帧率或完整性能验收。')


def run_integration():
    return asyncio.run(exercise())
