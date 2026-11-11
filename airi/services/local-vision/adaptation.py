"""Bounded trajectory review. Weak samples cannot label themselves or overwrite trusted references."""
import uuid

import numpy as np


class TrajectoryLearning:
    def __init__(self, gallery):
        self.gallery = gallery
        self.clear()

    def clear(self, reason='idle'):
        self.round = None
        self.track = None
        self.box = None
        self.frame_at = None
        self.reason = reason
        self.saved = 0

    def frame(self, tracks, now):
        if len(tracks) != 1:
            self.clear('lost' if not tracks else 'ambiguous')
            return
        track, box = tracks[0]
        box = np.asarray(box)
        if (self.track != track or (self.frame_at is not None and (now <= self.frame_at or now - self.frame_at > 1.5))
                or (self.box is not None and np.max(np.abs(box - self.box)) > .07)):
            self.clear('discontinuous')
        self.track, self.box, self.frame_at = track, box.copy(), now
        if self.round and now - self.round['started'] > 12:
            self.round = None
            self.reason = 'expired'

    def status(self):
        current = self.round
        return dict(state=self.reason, candidates=len(current['candidates']) if current else 0,
                    saved=self.saved, tracking=bool(current and current['anchored']))

    def sample(self, track, now, face_box, vector, quality, pose, light, jpeg, is_current):
        if not is_current() or self.track != track or self.frame_at != now:
            self.clear('discontinuous')
            return
        if quality not in ('accepted', 'recognition-only') or face_box is None:
            self.round = None
            self.reason = 'quality-rejected'
            return
        if vector is None:
            return
        ranked = self.gallery.base_scores(vector)
        strong = bool(ranked and ranked[0][0] >= .7 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= .15))
        current = self.round
        if current:
            previous_face = current['face_box']
            old_size = previous_face[2:] - previous_face[:2]
            new_size = np.asarray(face_box[2:]) - face_box[:2]
            if (current['base_hash'] != self.gallery.base_hash
                    or np.max(np.abs(np.asarray(face_box) - previous_face)) > .1
                    or np.any(new_size / np.maximum(old_size, .001) < .65)
                    or np.any(new_size / np.maximum(old_size, .001) > 1.5)
                    or float(current['vector'] @ vector) < .7
                    or (ranked and ranked[0][1] != current['person'] and ranked[0][0] >= .5)):
                self.round = None
                self.reason = 'conflict'
                return
        if current is None:
            if not strong or not self.gallery.people.name_confirmed(ranked[0][1]):
                self.reason = 'waiting-anchor'
                return
            current = dict(person=ranked[0][1], started=now, base_hash=self.gallery.base_hash,
                           round_id=str(uuid.uuid4()), confirmations=[], anchored=False,
                           candidates={}, face_box=np.asarray(face_box), vector=vector.copy())
            self.round = current
        current['face_box'], current['vector'] = np.asarray(face_box), vector.copy()
        if strong and ranked[0][1] == current['person']:
            confirmations = current['confirmations']
            if not confirmations or now - confirmations[-1] >= .25:
                confirmations.append(now)
            confirmations[:] = [at for at in confirmations if now - at <= 3.5]
            if len(confirmations) >= 3:
                if current['anchored'] and current['candidates']:
                    # Closing proof uses the unchanged base, never these candidates or older automatic extensions.
                    if is_current():
                        self.saved = self.gallery.people.add_extensions(current['person'], self.gallery.encoder.version,
                            current['round_id'], current['base_hash'], list(current['candidates'].values()))
                    self.round = None
                    self.reason = 'learned' if self.saved else 'duplicate'
                    return
                current['anchored'] = True
                self.reason = 'collecting'
        else:
            current['confirmations'].clear()
        if not current['anchored']:
            self.reason = 'stabilizing'
            return
        if quality == 'accepted':
            base_features = next(features for person, _, features in self.gallery.base_rows if person == current['person'])
            if float(np.max(base_features @ vector)) < .98:
                key = (pose, light)
                if key in current['candidates'] or len(current['candidates']) < 3:
                    previous = current['candidates'].get(key)
                    # Keep the most novel acceptable frame for each condition. Identical frontal frames add no value.
                    if previous is None or ranked[0][0] < previous['base_score']:
                        current['confirmations'].clear()
                        current['candidates'][key] = dict(vector=vector.copy(), pose=pose, light=light,
                                                         jpeg=jpeg, base_score=ranked[0][0])
                self.reason = 'reviewing'
