"""Local profiles, encrypted face samples and conversation memories."""
import ctypes
import hashlib
import json
import os
import sqlite3
import time
import uuid
from collections import deque
from contextlib import contextmanager

import numpy as np


def protect(data: bytes, decrypt=False):
    # Windows DPAPI binds templates to the current OS user. No key enters the repository.
    if os.name != 'nt':
        raise RuntimeError('A system secret-store adapter is required on this OS')

    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_char))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    result = Blob()
    operation = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.windll.kernel32.LocalFree(result.data)


class People:
    def __init__(self, folder, model_hash):
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / 'people.sqlite'
        self.lock_path = folder / 'calibration.json'
        self.model_hash = model_hash
        self.evidence = {}
        self.confirmed = {}
        self.camera_condition = None
        with self.connect() as db:
            db.executescript('CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT, template BLOB);'
                             'CREATE TABLE IF NOT EXISTS revoked (id TEXT PRIMARY KEY, at REAL);'
                             'CREATE TABLE IF NOT EXISTS photos (person TEXT, pose TEXT, image BLOB, at REAL, PRIMARY KEY(person,pose));'
                             'CREATE TABLE IF NOT EXISTS memories (person TEXT, character TEXT, event TEXT, text BLOB, at REAL, PRIMARY KEY(person,character,event));'
                             'CREATE TABLE IF NOT EXISTS encounters (person TEXT PRIMARY KEY, created REAL, last_seen REAL);'
                             'CREATE TABLE IF NOT EXISTS recognition_templates (person TEXT, model TEXT, pose TEXT, photo_hash TEXT, feature BLOB, PRIMARY KEY(person,model,pose));'
                             'CREATE TABLE IF NOT EXISTS face_extensions (id TEXT PRIMARY KEY, person TEXT, model TEXT, round_id TEXT, base_hash TEXT, pose TEXT, light TEXT, feature BLOB, image BLOB, at REAL);'
                             'CREATE TABLE IF NOT EXISTS name_confirmations (person TEXT PRIMARY KEY, at REAL);'
                             'CREATE TABLE IF NOT EXISTS behavior_rules (id TEXT PRIMARY KEY, text TEXT, updated_at REAL);'
                             'PRAGMA secure_delete=ON;')
            db.execute('INSERT OR IGNORE INTO behavior_rules VALUES (?,?,?)', ('name-confirmation',
                       '认识新朋友时，复述听到的完整姓名并询问文字是否正确。用户否认时询问错字和正确写法，'
                       '必要时请用户打出完整姓名，再复述确认。只有本人明确确认后才能声称名字登记成功。'
                       '姓名不是账号身份，不授予开发者权限。', time.time()))
            db.execute('INSERT OR IGNORE INTO behavior_rules VALUES (?,?,?)', ('unnamed-friend',
                       '未命名的朋友先使用永久人物ID归档，照常交流。适时换一种自然方式询问对方希望如何称呼，'
                       '不要每句话都问名字，不催促、不打断；对方拒绝时尊重拒绝。'
                       '得到名字后确认文字写法，只更新同一人物ID的显示姓名，以后自然称呼其名字。'
                       '人脸仅用于消息归档，不能触发登录、退出或切换主舞台会话。', time.time()))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        db.execute('PRAGMA secure_delete=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def list(self):
        with self.connect() as db:
            return [dict(person_id=row[0], display_name=row[1]) for row in db.execute('SELECT id,name FROM people')]

    def rules(self):
        with self.connect() as db:
            return [dict(id=k, text=text, updated_at=at) for k, text, at in db.execute('SELECT * FROM behavior_rules ORDER BY id')]

    def update_rule(self, rule, text):
        with self.connect() as db:
            if db.execute('UPDATE behavior_rules SET text=?,updated_at=? WHERE id=?', (text, time.time(), rule)).rowcount != 1:
                raise ValueError('rule-missing')

    def name_confirmed(self, person):
        with self.connect() as db:
            return bool(db.execute('SELECT 1 FROM name_confirmations WHERE person=?', (person,)).fetchone())

    def rename(self, person, name):
        if not name.strip() or len(name) > 64:
            raise ValueError('invalid-name')
        with self.connect() as db:
            if db.execute('UPDATE people SET name=? WHERE id=?', (name.strip(), person)).rowcount != 1:
                raise ValueError('person-missing')
            db.execute('INSERT OR REPLACE INTO name_confirmations VALUES (?,?)', (person, time.time()))
        self.evidence.clear()
        self.confirmed.clear()

    def memory_records(self, person, character):
        with self.connect() as db:
            return [dict(event_id=event, text=protect(text, True).decode(), at=at) for event, text, at in db.execute(
                'SELECT event,text,at FROM memories WHERE person=? AND character=? ORDER BY at DESC LIMIT 80', (person, character))]

    def edit_memory(self, person, character, event, text=None):
        with self.connect() as db:
            if text is None:
                changed = db.execute('DELETE FROM memories WHERE person=? AND character=? AND event=?', (person, character, event))
            else:
                changed = db.execute('UPDATE memories SET text=? WHERE person=? AND character=? AND event=?',
                                     (protect(text.encode()), person, character, event))
            if changed.rowcount != 1:
                raise ValueError('memory-missing')

    def overview(self):
        with self.connect() as db:
            counts = {table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                      for table in ('people', 'memories', 'photos', 'recognition_templates', 'face_extensions', 'encounters', 'behavior_rules')}
            characters = [row[0] for row in db.execute('SELECT DISTINCT character FROM memories ORDER BY character')]
        return dict(counts=counts, characters=characters, persons=self.list(), rules=self.rules())

    def gallery_hash(self):
        with self.connect() as db:
            rows = db.execute('SELECT id,template FROM people ORDER BY id').fetchall()
        return hashlib.sha256(b''.join(k.encode() + v for k, v in rows)).hexdigest()

    def calibration(self):
        if not self.lock_path.exists():
            return None
        lock = json.loads(self.lock_path.read_text())
        if lock.get('model_hash') != self.model_hash or lock.get('gallery_hash') != self.gallery_hash():
            return None
        if not self.camera_condition or lock.get('camera_condition') != self.camera_condition:
            return None
        return lock

    def enroll(self, name, vectors, photos=None):
        if len(vectors) < 10 or not name.strip() or len(name) > 64:
            raise ValueError('At least 10 quality samples and a name are required')
        samples = np.asarray(vectors, dtype=np.float32).reshape(-1, 128)
        normalized = samples / np.maximum(np.linalg.norm(samples, axis=1, keepdims=True), 1e-9)
        with self.connect() as db:
            gallery = db.execute('SELECT id,template FROM people').fetchall()
            matches = []
            for existing, encrypted in gallery:
                saved = np.frombuffer(protect(encrypted, True), dtype=np.float32).reshape(-1, 128)
                saved_normalized = saved / np.maximum(np.linalg.norm(saved, axis=1, keepdims=True), 1e-9)
                similarity = (normalized @ saved_normalized.T).max(axis=1)
                matches.append((float(np.median(similarity)), float(similarity.min()), existing, saved))
            matches.sort(key=lambda row: row[0], reverse=True)
            # Ten fresh samples must strongly agree with one stored face. Names alone never combine profiles.
            same_face = bool(matches and matches[0][0] >= .9 and matches[0][1] >= .85)
            if same_face and len(matches) > 1 and matches[0][0] - matches[1][0] < .1:
                raise ValueError('ambiguous-existing-profile')
            if same_face:
                _, _, person, saved = matches[0]
                combined = np.concatenate((saved, samples))[-30:]
                db.execute('UPDATE people SET name=?,template=? WHERE id=?', (name.strip(), protect(combined.tobytes()), person))
                db.execute('UPDATE encounters SET last_seen=? WHERE person=?', (time.time(), person))
            else:
                if len(gallery) >= 100:
                    raise ValueError('The local gallery is full')
                person = str(uuid.uuid4())
                db.execute('INSERT INTO people VALUES (?,?,?)', (person, name.strip(), protect(samples.tobytes())))
                db.execute('INSERT INTO encounters VALUES (?,?,?)', (person, time.time(), time.time()))
        if photos:
            self.add_photos(person, photos)
        self.evidence.clear()
        self.confirmed.clear()
        return person

    def anonymous(self, vector, pose, jpeg):
        """A quality-checked single face can own records before it supplies a name."""
        samples = np.asarray(vector, np.float32).reshape(1, 128)
        if not np.isfinite(samples).all() or np.linalg.norm(samples) < 1e-9:
            raise ValueError('invalid-face-sample')
        with self.connect() as db:
            if db.execute('SELECT COUNT(*) FROM people').fetchone()[0] >= 100:
                raise ValueError('The local gallery is full')
            person = str(uuid.uuid4())
            db.execute('INSERT INTO people VALUES (?,?,?)', (person, '', protect(samples.tobytes())))
            db.execute('INSERT INTO encounters VALUES (?,?,?)', (person, time.time(), time.time()))
        self.add_photos(person, {pose: jpeg})
        return person

    def delete(self, person):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO revoked VALUES (?,?)', (person, time.time()))
            db.execute('DELETE FROM people WHERE id=?', (person,))
            db.execute('DELETE FROM photos WHERE person=?', (person,))
            db.execute('DELETE FROM memories WHERE person=?', (person,))
            db.execute('DELETE FROM encounters WHERE person=?', (person,))
            db.execute('DELETE FROM recognition_templates WHERE person=?', (person,))
            db.execute('DELETE FROM face_extensions WHERE person=?', (person,))
            db.execute('DELETE FROM name_confirmations WHERE person=?', (person,))
        self.evidence.clear()
        self.confirmed.clear()

    def extension_records(self, person):
        with self.connect() as db:
            return [dict(round_id=round_id, count=count, at=at) for round_id, count, at in db.execute(
                'SELECT round_id,COUNT(*),MAX(at) FROM face_extensions WHERE person=? GROUP BY round_id ORDER BY MAX(at) DESC', (person,))]

    def revoke_extensions(self, person, round_id):
        with self.connect() as db:
            if db.execute('DELETE FROM face_extensions WHERE person=? AND round_id=?', (person, round_id)).rowcount == 0:
                raise ValueError('extension-missing')
        self.evidence.clear()
        self.confirmed.clear()

    def add_extensions(self, person, model, round_id, base_hash, samples):
        # Reviewed samples stay separate from original references. They never authorize another learning round.
        with self.connect() as db:
            if not db.execute('SELECT 1 FROM people JOIN name_confirmations ON id=person WHERE id=?', (person,)).fetchone():
                return 0
            saved = [np.frombuffer(protect(row[0], True), np.float32).copy() for row in db.execute(
                'SELECT feature FROM face_extensions WHERE person=? AND model=?', (person, model))]
            added = 0
            for sample in samples[:3]:
                vector = np.asarray(sample['vector'], np.float32).reshape(512)
                jpeg = sample['jpeg']
                if (sample['pose'] not in ('front', 'left', 'right') or sample['light'] not in ('dim', 'normal', 'bright')
                        or not np.isfinite(vector).all() or abs(float(np.linalg.norm(vector)) - 1) > .01
                        or not jpeg.startswith(b'\xff\xd8') or len(jpeg) > 65536):
                    raise ValueError('invalid-extension')
                if len(saved) >= 12 or any(float(feature @ vector) >= .98 for feature in saved):
                    continue
                db.execute('INSERT INTO face_extensions VALUES (?,?,?,?,?,?,?,?,?,?)',
                           (str(uuid.uuid4()), person, model, round_id, base_hash, sample['pose'], sample['light'],
                            protect(vector.tobytes()), protect(jpeg), time.time()))
                saved.append(vector)
                added += 1
        return added

    def add_photos(self, person, photos):
        # Save one aligned face crop per angle, never the full camera image or a bystander.
        with self.connect() as db:
            if not db.execute('SELECT 1 FROM people WHERE id=?', (person,)).fetchone():
                raise ValueError('person-missing')
            for pose, jpeg in photos.items():
                if pose not in ('front', 'left', 'right') or len(jpeg) > 65536:
                    raise ValueError('invalid-face-photo')
                db.execute('INSERT OR IGNORE INTO photos VALUES (?,?,?,?)', (person, pose, protect(jpeg), time.time()))

    def add_pose(self, person, pose, jpeg, vector):
        if pose not in ('front', 'left', 'right') or len(jpeg) > 65536:
            raise ValueError('invalid-face-photo')
        with self.connect() as db:
            if db.execute('SELECT 1 FROM photos WHERE person=? AND pose=?', (person, pose)).fetchone():
                return
            row = db.execute('SELECT template FROM people WHERE id=?', (person,)).fetchone()
            if not row:
                return
            templates = np.frombuffer(protect(row[0], True), dtype=np.float32).reshape(-1, 128).copy()
            normalized = templates / np.maximum(np.linalg.norm(templates, axis=1, keepdims=True), 1e-9)
            sample = np.asarray(vector, dtype=np.float32).reshape(128)
            score = float(np.max(normalized @ (sample / max(float(np.linalg.norm(sample)), 1e-9))))
            if not np.isfinite(score) or score < .55:
                return
            # Keep the original introduction and add at most one template per new angle.
            updated = np.concatenate((templates[:10], templates[10:][-19:], sample.reshape(1, 128)))
            db.execute('INSERT INTO photos VALUES (?,?,?,?)', (person, pose, protect(jpeg), time.time()))
            db.execute('UPDATE people SET template=? WHERE id=?', (protect(updated.tobytes()), person))

    def remember(self, person, character, event, text):
        with self.connect() as db:
            if not db.execute('SELECT 1 FROM people WHERE id=?', (person,)).fetchone():
                raise ValueError('person-missing')
            db.execute('INSERT OR IGNORE INTO memories VALUES (?,?,?,?,?)',
                       (person, character, event, protect(text[:2000].encode()), time.time()))
            db.execute('DELETE FROM memories WHERE person=? AND character=? AND event NOT IN '
                       '(SELECT event FROM memories WHERE person=? AND character=? ORDER BY at DESC LIMIT 80)',
                       (person, character, person, character))

    def forget(self, person, character):
        with self.connect() as db:
            db.execute('DELETE FROM memories WHERE person=? AND character=?', (person, character))

    def profile(self, person, character):
        with self.connect() as db:
            row = db.execute('SELECT name FROM people WHERE id=?', (person,)).fetchone()
            if not row:
                return None
            encounter = db.execute('SELECT created,last_seen FROM encounters WHERE person=?', (person,)).fetchone()
            poses = [row[0] for row in db.execute('SELECT pose FROM photos WHERE person=? ORDER BY pose', (person,))]
            memories = [dict(text=protect(text, True).decode(), at=at) for text, at in db.execute(
                'SELECT text,at FROM memories WHERE person=? AND character=? ORDER BY at DESC LIMIT 8', (person, character))]
        return dict(person_id=person, display_name=row[0], poses=poses, memories=memories,
                    created_at=encounter[0] if encounter else 0, last_seen=encounter[1] if encounter else 0)

    def seen(self, person):
        with self.connect() as db:
            db.execute('INSERT INTO encounters VALUES (?,?,?) ON CONFLICT(person) DO UPDATE SET last_seen=excluded.last_seen',
                       (person, time.time(), time.time()))

    def scores(self, vector):
        with self.connect() as db:
            rows = db.execute('SELECT id,name,template FROM people').fetchall()
        vector = vector / max(float(np.linalg.norm(vector)), 1e-9)
        scores = []
        for person, name, encrypted in rows:
            templates = np.frombuffer(protect(encrypted, True), dtype=np.float32).reshape(-1, 128)
            templates = templates / np.maximum(np.linalg.norm(templates, axis=1, keepdims=True), 1e-9)
            scores.append((float(np.max(templates @ vector)), person, name))
        return sorted(scores, reverse=True)

    def invalidate(self, track):
        self.evidence.pop(track, None)
        self.confirmed.pop(track, None)

    def match(self, track, vector, now):
        lock = self.calibration()
        # Conversational profiles work without a manual calibration campaign. Use a
        # stricter cosine threshold than SFace's published LFW threshold (0.363).
        # A valid local calibration can raise, never lower, these social-use limits.
        threshold = max(.55, lock['accept_threshold']) if lock else .55
        margin = max(.1, lock['min_margin']) if lock else .1
        scores = self.scores(vector)
        return self.resolve(track, scores, now, threshold, margin)

    def resolve(self, track, scores, now, threshold=.55, margin=.1):
        previous = self.confirmed.get(track)
        if previous and 0 <= now - previous[1] <= 2.5 and scores:
            score, person, name = scores[0]
            retention = max(.5, threshold - .05)
            separated = len(scores) == 1 or score - scores[1][0] >= margin
            if person == previous[0] and score >= retention and separated:
                self.confirmed[track] = (person, now)
                return dict(identity_status='confirmed', person_id=person, display_name=name)
        # A different or expired face must reacquire confirmation. Never carry a name across people.
        self.confirmed.pop(track, None)
        status = 'unknown'
        if scores and scores[0][0] >= threshold:
            status = 'candidate'
            if len(scores) > 1 and scores[0][0] - scores[1][0] < margin:
                status = 'ambiguous'
        history = self.evidence.setdefault(track, deque(maxlen=6))
        # One-Hz capture needs jitter tolerance across three samples. Every sample still requires a current unique match.
        if history and (now < history[-1][0] or now - history[-1][0] > 1.5
                        or (scores and history[-1][1] != scores[0][1])):
            history.clear()
        while history and now - history[0][0] > 3.5:
            history.popleft()
        if status != 'candidate':
            history.clear()
        elif not history or now - history[-1][0] >= .25:
            history.append((now, scores[0][1]))
        if status == 'candidate' and len(history) >= 3 and all(p == scores[0][1] for _, p in history):
            self.confirmed[track] = (scores[0][1], now)
            return dict(identity_status='confirmed', person_id=scores[0][1], display_name=scores[0][2])
        return dict(identity_status=status, person_id=None, display_name=None)
