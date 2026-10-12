"""Visible motion events. These rules do not infer mental states."""
from collections import deque


class Motions:
    def __init__(self):
        self.samples = deque()
        self.last = {}

    def update(self, now, pitch, yaw, hand_x, gesture):
        self.samples.append((now, pitch, yaw, hand_x, gesture))
        while self.samples and now - self.samples[0][0] > 1.5:
            self.samples.popleft()
        result = []
        if len(self.samples) < 5:
            return result
        for label, index, amplitude, reversals in [('nod', 1, .12, 1), ('shake', 2, .15, 1), ('wave', 3, .15, 2)]:
            values = [row[index] for row in self.samples if row[index] is not None]
            if len(values) < 5 or self.samples[-1][0] - self.samples[0][0] < .5:
                continue
            # Count excursions from each turning point. Frame noise cannot create reversals.
            anchor, direction, turns = values[0], 0, 0
            for value in values[1:]:
                delta = value - anchor
                if abs(delta) < amplitude:
                    continue
                sign = 1 if delta > 0 else -1
                if direction and sign != direction:
                    turns += 1
                direction, anchor = sign, value
            if turns >= reversals and now - self.last.get(label, -100) >= 2:
                self.last[label] = now
                result.append(label)
        recent = [row for row in self.samples if now - row[0] <= .4]
        if recent and now - recent[0][0] >= .3 and all(row[4] == 'Thumb_Up' for row in recent):
            if now - self.last.get('thumbs_up', -100) >= 2:
                self.last['thumbs_up'] = now
                result.append('thumbs_up')
        return result
