"""Loopback inference service. The AIRI gateway alone holds the control credential."""
import asyncio
import io
import importlib.util
import json
import secrets
import time
import uuid
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from PIL import Image
from starlette.responses import JSONResponse

from protocol import Binding, Conversation, Enrollment, Find, Policy, Primary, SocialEvent, decode_frame
from registry import DATA
from developer import access, register_routes

ORIGINS = {'http://127.0.0.1:5173', 'http://127.0.0.1:4173', 'http://localhost:5173', 'http://localhost:4173'}


class VisionService:
    def __init__(self):
        DATA.mkdir(parents=True, exist_ok=True)
        credential = DATA / 'credential'
        if not credential.exists():
            credential.write_text(secrets.token_urlsafe(48))
        self.credential = credential.read_text().strip()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='airi-vision')
        self.runtime = None
        self.error = 'loading'
        self.source = None
        self.tickets = {}
        self.socket = None
        self.frame = None
        self.frame_at = 0
        self.snapshot = None
        self.policy = {'face': False}
        self.primary = None
        self.metrics = dict(received=0, processed=0, rejected=0, latency_ms=[])
        self.quality = ''
        self.finding = False
        self.bound_at = 0
        self.diagnostic_frames = deque(maxlen=200)
        self.quiescing = False

    async def worker(self, function, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, function, *args)

    async def load(self):
        try:
            from model import Runtime
            self.runtime = await self.worker(Runtime)
            self.error = ''
        except Exception as error:
            # Only an exception class crosses the UI boundary. Paths and model data stay local.
            self.error = type(error).__name__

    def require_source(self, binding):
        if not self.source or self.source['session_binding_id'] != binding:
            raise HTTPException(409, 'source-not-owned')
        return self.source

    async def stop(self):
        self.source = None
        self.frame = None
        self.snapshot = None
        self.primary = None
        self.policy = {'face': False}
        self.tickets.clear()
        if self.socket:
            socket, self.socket = self.socket, None
            try:
                await socket.close()
            except RuntimeError:
                pass
        if self.runtime:
            await self.worker(self.runtime.reset)

    async def expire_bindings(self):
        while True:
            await asyncio.sleep(1)
            if self.source and not self.socket and time.monotonic() - self.bound_at > 45:
                await self.stop()

    def health(self):
        return dict(protocol='1.0', ready=self.runtime is not None, error=self.error,
                    device=self.runtime.device if self.runtime else 'unavailable',
                    calibrated=bool(self.runtime and self.runtime.people.calibration()),
                    camera_condition=self.runtime.people.camera_condition if self.runtime else None,
                    grounding='ready' if (DATA / 'models' / 'dino' / 'lock.json').exists()
                    and importlib.util.find_spec('torch') and importlib.util.find_spec('transformers') else 'missing')


state = VisionService()


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(state.load())
    lease = asyncio.create_task(state.expire_bindings())
    yield
    lease.cancel()
    await state.stop()
    await task
    state.executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
register_routes(app, state)


@app.middleware('http')
async def authorize(request: Request, call_next):
    if request.headers.get('host') != '127.0.0.1:18765':
        return JSONResponse({'error': 'host'}, 403)
    if not secrets.compare_digest(request.headers.get('authorization', ''), f'Bearer {state.credential}'):
        return JSONResponse({'error': 'unauthorized'}, 403)
    length = request.headers.get('content-length', '0')
    if not length.isdecimal() or int(length) > 8192:
        return JSONResponse({'error': 'size'}, 413)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/health')
async def health():
    return state.health()


@app.post('/runtime/wake')
async def wake_runtime():
    state.quiescing = False
    return {'idle': False}


@app.post('/runtime/sleep')
async def prepare_sleep():
    # The gateway may stop only an idle process. Fence new bindings before its PID guard runs.
    if state.source or state.socket or state.finding:
        return {'idle': False}
    state.quiescing = True
    return {'idle': True}


@app.post('/bindings')
async def bind(request: Binding):
    if state.quiescing:
        raise HTTPException(503, 'runtime-sleeping')
    if not state.runtime:
        raise HTTPException(503, 'models-not-ready')
    if state.source:
        raise HTTPException(409, 'camera-already-owned')
    source = dict(session_binding_id=str(uuid.uuid4()), source_id=str(uuid.uuid4()), epoch=1,
                  privacy_generation=1, seq=-1, owner=request.owner)
    state.source = source
    state.bound_at = time.monotonic()
    state.diagnostic_frames.clear()
    await state.worker(state.runtime.reset)
    return source


@app.delete('/bindings/{binding}')
async def unbind(binding: str):
    state.require_source(binding)
    await state.stop()
    return {'stopped': True}


@app.post('/bindings/{binding}/ticket')
async def ticket(binding: str):
    source = state.require_source(binding)
    state.tickets = {key: value for key, value in state.tickets.items() if value[0] > time.monotonic()}
    if len(state.tickets) >= 4:
        raise HTTPException(429, 'ticket-limit')
    value = secrets.token_urlsafe(32)
    state.tickets[value] = (time.monotonic() + 15, source['source_id'])
    return {'ticket': value}


@app.post('/bindings/{binding}/policy')
async def policy(binding: str, value: Policy):
    source = state.require_source(binding)
    source['privacy_generation'] += 1
    state.policy = value.model_dump()
    state.snapshot = None
    state.frame = None
    await state.worker(state.runtime.reset)
    state.runtime.people.camera_condition = value.camera_condition
    return source


@app.post('/bindings/{binding}/primary')
async def primary(binding: str, value: Primary):
    state.require_source(binding)
    if value.track_id is not None and (not state.snapshot or not any(
            actor['track_id'] == value.track_id for actor in state.snapshot['payload']['actors'])):
        raise HTTPException(409, 'track-not-visible')
    state.primary = value.track_id
    return {'selected': value.track_id}


@app.get('/persons')
async def persons(request: Request):
    access.require(request)
    if not state.runtime:
        raise HTTPException(503, 'models-not-ready')
    return await state.worker(state.runtime.people.list)


def social_actor(binding, track=None):
    state.require_source(binding)
    if not state.policy['face'] or not state.snapshot or time.monotonic() - state.frame_at > 2:
        raise HTTPException(409, 'fresh-face-required')
    actors = state.snapshot['payload']['actors']
    if len(actors) != 1 or not actors[0]['primary'] or (track and actors[0]['track_id'] != track):
        raise HTTPException(409, 'one-person-required')
    # Do not bind words to a body whose face was not actually visible in this frame.
    face = state.runtime.identities.get(actors[0]['track_id'])
    if actors[0]['identity_status'] in ('ambiguous', 'unavailable') or not face or face[0] < time.monotonic() - 2:
        raise HTTPException(409, 'face-unavailable')
    return actors[0]


@app.post('/bindings/{binding}/social')
async def social(binding: str, value: SocialEvent):
    source = state.require_source(binding)
    generation = source['privacy_generation']
    def read():
        if state.source is not source or generation != source['privacy_generation']:
            raise HTTPException(409, 'stale-result')
        actor = social_actor(binding, value.track_id)
        if value.ask_name and actor['identity_status'] == 'unknown':
            state.runtime.social.ask(value.track_id)
        person = actor['person_id'] if actor['identity_status'] == 'confirmed' else None
        state.runtime.social.review_identity(value.track_id, actor)
        learning = state.runtime.social.status()
        if learning['name_state'] in ('confirming', 'correcting') or (learning['name'] and learning['name'] != actor['display_name']):
            person = None
        return dict(learning=learning,
                    profile=state.runtime.people.profile(person, value.character) if person else None,
                    rules=state.runtime.people.rules())
    return await state.worker(read)


@app.post('/bindings/{binding}/conversation')
async def conversation(binding: str, value: Conversation):
    source = state.require_source(binding)
    generation = source['privacy_generation']
    def remember():
        if state.source is not source or generation != source['privacy_generation']:
            raise HTTPException(409, 'stale-result')
        actor = social_actor(binding, value.track_id)
        outcome = state.runtime.social.converse(value.track_id, actor, value.text, value.character, value.event_id)
        return dict(outcome=outcome, learning=state.runtime.social.status())
    return await state.worker(remember)


@app.post('/persons/{person}/forget')
async def forget_person(person: str, value: SocialEvent, request: Request):
    access.require(request)
    if not state.runtime:
        raise HTTPException(503, 'models-not-ready')
    await state.worker(state.runtime.people.forget, person, value.character)
    return {'forgotten': True}


@app.delete('/persons/{person}')
async def delete_person(person: str, request: Request):
    access.require(request)
    if not state.runtime:
        raise HTTPException(503, 'models-not-ready')
    # Invalidate in-flight results before the database operation reaches the worker.
    if state.source:
        state.source['privacy_generation'] += 1
    state.snapshot = None
    def remove():
        state.runtime.people.delete(person)
        state.runtime.reset()
    await state.worker(remove)
    return {'deleted': True, 'source': state.source}


@app.post('/bindings/{binding}/enrollment')
async def enrollment(binding: str, value: Enrollment, request: Request):
    access.require(request)
    state.require_source(binding)
    if not state.policy['face']:
        raise HTTPException(403, 'face-consent-required')

    def begin():
        state.runtime.enrollment = dict(name=value.name, samples=[], poses=[], track=None, last=0, started=time.monotonic())
    await state.worker(begin)
    return {'started': True}


@app.post('/bindings/{binding}/enrollment/commit')
async def commit(binding: str, request: Request):
    access.require(request)
    state.require_source(binding)
    if not state.policy['face']:
        raise HTTPException(403, 'face-consent-required')

    def save():
        current = state.runtime.enrollment
        if not current or time.monotonic() - current['started'] > 60:
            raise ValueError('enrollment-expired')
        if len(set(current['poses'])) < 3:
            raise ValueError('enrollment-needs-front-left-right')
        person = state.runtime.people.enroll(current['name'], current['samples'])
        state.runtime.enrollment = None
        return person
    try:
        person = await state.worker(save)
    except ValueError:
        raise HTTPException(409, 'need-ten-quality-samples') from None
    return {'person_id': person}


@app.post('/bindings/{binding}/correct')
async def correct(binding: str):
    source = state.require_source(binding)
    source['privacy_generation'] += 1
    state.policy['face'] = False
    state.snapshot = None
    await state.worker(state.runtime.reset)
    return source


@app.get('/metrics')
async def metrics(request: Request):
    age = (time.monotonic() - state.frame_at) * 1000 if state.frame_at else None
    return dict(state.metrics, camera_connected=state.socket is not None,
                frame_age_ms=age, quality=state.quality,
                diagnostics=dict(window_frames=len(state.diagnostic_frames),
                    quality_counts=dict(Counter(item[0] for item in state.diagnostic_frames)),
                    recognition_counts=dict(Counter(item[1] for item in state.diagnostic_frames))),
                perception=state.runtime.perception() if state.runtime else None,
                observation=state.snapshot['payload'] if access.status(request)['authenticated']
                and age is not None and age < 2000 and state.snapshot else None)


@app.post('/bindings/{binding}/find')
async def find(binding: str, value: Find):
    source = state.require_source(binding)
    if state.finding:
        raise HTTPException(429, 'find-busy')
    if state.frame is None or time.monotonic() - state.frame_at > 2:
        raise HTTPException(409, 'fresh-frame-required')
    if any(not item.strip() or len(item) > 80 for item in value.labels):
        raise HTTPException(400, 'invalid-label')
    from grounding import find_objects
    state.finding = True
    generation = source['privacy_generation']
    frame = state.frame.copy()
    try:
        result = await asyncio.to_thread(find_objects, frame, value.labels)
        if state.source is not source or source['privacy_generation'] != generation:
            raise HTTPException(409, 'stale-result')
        return result
    except (ImportError, FileNotFoundError, RuntimeError):
        raise HTTPException(503, 'grounding-unavailable') from None
    finally:
        state.finding = False


@app.websocket('/stream')
async def stream(socket: WebSocket):
    ticket = state.tickets.pop(socket.query_params.get('ticket', ''), None)
    source = state.source
    if (socket.headers.get('origin') not in ORIGINS or socket.headers.get('host') != '127.0.0.1:18765'
            or not ticket or ticket[0] < time.monotonic() or not source or ticket[1] != source['source_id'] or state.socket):
        await socket.close(code=1008)
        return
    await socket.accept()
    state.socket = socket
    previous = 0
    try:
        while state.source is source:
            data = await asyncio.wait_for(socket.receive_bytes(), timeout=8)
            started = time.monotonic()
            if started - previous < .05:
                raise ValueError('frame-rate-limit')
            previous = started
            header, jpeg = decode_frame(data, source)
            source['seq'] = header.seq
            state.metrics['received'] += 1
            generation = source['privacy_generation']

            def infer():
                with Image.open(io.BytesIO(jpeg)) as image_header:
                    if image_header.size != (header.width, header.height) or image_header.format != 'JPEG':
                        raise ValueError('image-dimensions')
                image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                if image is None or image.shape[:2] != (header.height, header.width):
                    raise ValueError('image-decode')
                payload, actions, quality = state.runtime.analyze(image, dict(state.policy), state.primary,
                    lambda: state.source is source and generation == source['privacy_generation'])
                return image, payload, actions, quality

            frame, payload, actions, quality = await state.worker(infer)
            if state.source is not source or generation != source['privacy_generation']:
                continue
            state.frame, state.frame_at = frame, time.monotonic()
            state.quality = quality
            recognition = state.runtime.recognition_diagnostics.get(payload['primary_track_id']) if state.policy['face'] else None
            state.diagnostic_frames.append((quality if state.policy['face'] else 'face-disabled',
                                            recognition['reason'] if recognition else 'no-match-sample'))
            payload['frame_seq'] = header.seq
            envelope = dict(schema_version='1.0', event_id=str(uuid.uuid4()), evidence_mode='live',
                            session_binding_id=source['session_binding_id'], source_id=source['source_id'],
                            epoch=source['epoch'], seq=header.seq, privacy_generation=generation,
                            observed_at_utc=datetime.now(timezone.utc).isoformat(), valid_for_ms=2000,
                            type='observation.snapshot', payload=payload)
            state.snapshot = envelope
            state.metrics['processed'] += 1
            elapsed = (time.monotonic() - started) * 1000
            state.metrics['latency_ms'] = (state.metrics['latency_ms'] + [elapsed])[-15000:]
            current = state.runtime.enrollment
            await socket.send_json(dict(snapshot=envelope, actions=actions, quality=quality,
                                        enrollment_samples=len(current['samples']) if current else 0,
                                        recognition=recognition,
                                        adaptation=state.runtime.adaptation.status() if state.policy['face'] and state.runtime.adaptation else None,
                                        processing_ms=elapsed))
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError):
        state.metrics['rejected'] += 1
    finally:
        if state.source is source:
            await state.stop()
