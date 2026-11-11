"""Conversation-led introductions. Only one fresh, quality-checked face owns a turn."""
import re
import time

import numpy as np


def spoken_name(text, expecting=False):
    text = text.strip()
    if re.search(r'不(?:要|想|用|能).*(?:记|存|拍|认识)|forget me|don.t remember', text, re.I):
        return None
    match = re.search(r'(?:我(?:的名字是|叫)|(?:你可以)?叫我|称呼我(?:为)?|my name is|call me)\s*([\w\u4e00-\u9fff· -]{1,32})', text, re.I)
    name = match.group(1).strip() if match else text if expecting and len(text) <= 20 else ''
    if not match and re.search(r'正确|确认|没错|不对|错了|错字|写错|改成|换成|名字|姓名|^(?:对|好|yes|correct)$', name, re.I):
        return None
    if not match and expecting:
        name = re.sub(r'^我是\s*', '', name)
    name = re.split(r'[，,。.!！?？]|(?:很高兴|今年|我喜欢|你呢|请问)', name)[0].strip()
    name = re.sub(r'(?:就行|就好|吧|呀|哦|呢)$', '', name).strip()
    if re.search(r'我(?:叫|的名字是)|叫我|my name is|call me', name, re.I):
        return None
    if not name or len(name) > 32 or re.search(r'[?？]|(?:不知道|不告诉|随便|为什么|什么|你好|谢谢|不是|没有|可以|喜欢|是的|好的|嗯|不要|今天|明天|昨天|吃|工作|天气|累|饿)', name):
        return None
    if not match and (len(name) > 8 or len(name.split()) > 3):
        return None
    if not re.fullmatch(r'[\w\u4e00-\u9fff· -]+', name):
        return None
    return name


class SocialLearning:
    """Track-scoped candidates move idle -> confirming/correcting -> confirmed before any name write."""
    def __init__(self, people):
        self.people = people
        self.reset()

    def reset(self):
        self.track = None
        self.name = ''
        self.person = None
        self.origin_anonymous = False
        self.started = 0
        self.last_sample = 0
        self.samples = []
        self.photos = {}
        self.pending = []
        self.awaiting = 0
        self.last_seen = 0
        self.memorized = set()
        self.declined = None
        self.name_state = 'idle'
        self.rename_person = None
        self.events = set()

    def ask(self, track):
        # A camera greeting can be retried while a person is replying or samples are collected.
        # Reopening that same invitation must not erase confirmation, samples, or refusal.
        if self.declined == track or (self.track == track and (
                self.name_state != 'idle' or self.name or self.person or time.monotonic() < self.awaiting)):
            if self.declined != track and self.track == track and self.person and not self.name:
                self.awaiting = time.monotonic() + 120
            return
        self.reset()
        self.track = track
        self.awaiting = time.monotonic() + 120

    def observe(self, tracks):
        now = time.monotonic()
        # The tracker can keep an id over a brief occlusion. Clear ownership after
        # absence so a replacement person cannot inherit the previous introduction.
        if not tracks and now - self.last_seen <= 1.5:
            return
        if len(tracks) != 1 or (self.track and tracks[0] != self.track):
            self.reset()
            return
        if self.track and now - self.last_seen > 2 and self.last_seen:
            self.reset()
        self.last_seen = now

    def converse(self, track, identity, text, character, event):
        now = time.monotonic()
        if self.name and now - self.started >= 180:
            self.reset()
        if self.track and self.track != track:
            self.reset()
        if event in self.events:
            return self.name_state
        name = spoken_name(text, self.track == track and (now < self.awaiting or self.name_state == 'correcting'))
        rejected = bool(re.search(r'不(?:要|想|用).*(?:记|存|拍)|忘(?:掉|记)我|forget me|don.t remember', text, re.I))
        if rejected:
            person = self.person or self.rename_person or (identity.get('person_id') if identity.get('identity_status') == 'confirmed' else None)
            if person:
                self.people.delete(person)
            self.reset()
            self.declined = track
            return 'declined'
        if self.declined == track:
            return 'declined'
        correction = re.search(r'(?:名字|姓名|称呼).*(?:不对|错误|错了|写错|改成|换成)|(?:叫|写|记).*错.*(?:名字|姓名)', text)
        if self.name_state in ('confirming', 'correcting') and re.fullmatch(
                r'(?:不对|不正确|不是|不是这个名字|不是这个字|还是不对|名字不对|no|wrong|not correct)[。.!！\s]*', text.strip(), re.I):
            correction = True
        candidate = self.name or identity.get('display_name') or ''
        replacement = re.search(r'把[“"\s]*([\w·-]{1,16})[”"\s]*(?:改成|换成)[“"\s]*([\w·-]{1,16})', text)
        if replacement and candidate.count(replacement[1]) == 1:
            name = candidate.replace(replacement[1], replacement[2], 1)
        full_correction = re.search(r'不(?:是|叫)\s*([\w·-]{1,32})[，,]\s*(?:是|叫)\s*([\w·-]{1,32})', text)
        if full_correction and full_correction[1] == candidate:
            name = spoken_name('叫我' + full_correction[2])
        if (name and name != candidate) or (name and self.name_state == 'idle'):
            previous = self.rename_person or self.person or (identity.get('person_id') if identity.get('identity_status') == 'confirmed' else None)
            origin_anonymous = self.origin_anonymous
            self.reset()
            self.track, self.name, self.started, self.last_seen = track, name, now, now
            self.rename_person = previous
            self.origin_anonymous = origin_anonymous
            self.name_state = 'confirming'
        elif correction and candidate:
            self.track, self.name = track, candidate
            self.rename_person = self.rename_person or self.person or identity.get('person_id')
            self.name_state = 'correcting'
            self.started, self.last_seen = now, now
        elif self.name_state == 'confirming' and re.fullmatch(
                r'(?:名字正确|姓名正确|名字是对的|(?:是的|对的|对|正确|没错|确认|是这个名字|yes|correct))[。.!！\s]*', text.strip(), re.I):
            self.name_state = 'confirmed'
            if self.rename_person:
                self.people.rename(self.rename_person, self.name)
                self.person = self.rename_person
                for owner, pending_event, pending_text in self.pending:
                    self.people.remember(self.person, owner, pending_event, pending_text)
                self.pending.clear()
            self.events.add(event)
            return 'confirmed'
        if self.name_state in ('confirming', 'correcting'):
            self.pending.append((character, event, text))
            self.pending = self.pending[-20:]
            self.events.add(event)
            return self.name_state
        person = self.person if self.track == track else None
        if not person and identity.get('identity_status') == 'confirmed' and not self.name:
            person = identity['person_id']
        if person:
            self.people.remember(person, character, event, text)
        elif self.name:
            self.pending.append((character, event, text))
            self.pending = self.pending[-20:]
        self.events.add(event)
        if len(self.events) > 100:
            self.events = {event}
        return 'learning' if self.name and not self.person else 'remembered' if person else 'unknown'

    def sample(self, track, vector, pose, jpeg, identity):
        now = time.monotonic()
        if self.declined == track:
            return
        if identity.get('identity_status') == 'unknown' and not self.name and not self.person:
            self.track = track
            self.person = self.people.anonymous(vector, pose, jpeg)
            self.origin_anonymous = True
            self.last_seen = now
            self.samples = [vector]
            self.photos = {pose: jpeg}
        self.review_identity(track, identity)
        if self.name_state in ('confirming', 'correcting'):
            return
        if self.track == track and self.name and self.name_state == 'confirmed' and now - self.started < 180:
            if now - self.last_sample < .4:
                return
            self.last_sample = now
            if self.samples:
                similarity = float(np.dot(self.samples[0], vector) / max(np.linalg.norm(self.samples[0]) * np.linalg.norm(vector), 1e-9))
                if similarity < .55:
                    self.ask(track)
                    return
            if len(self.samples) < 30:
                self.samples.append(vector)
            self.photos.setdefault(pose, jpeg)
            if not self.person and len(self.samples) >= 10:
                self.person = self.people.enroll(self.name, self.samples, self.photos)
                self.people.rename(self.person, self.name)
                self.memorized.add(self.person)
                for character, event, text in self.pending:
                    self.people.remember(self.person, character, event, text)
                self.pending.clear()
            elif self.person:
                self.people.add_pose(self.person, pose, jpeg, vector)
        elif identity.get('identity_status') == 'confirmed':
            person = identity['person_id']
            # Known profiles keep their original references. TrajectoryLearning reviews new angles separately.
            if person not in self.memorized:
                self.people.seen(person)
                self.memorized.add(person)

    def review_identity(self, track, identity):
        person = identity.get('person_id') if identity.get('identity_status') == 'confirmed' else None
        if self.name_state == 'idle' and person and identity.get('display_name') and not self.people.name_confirmed(person):
            self.track, self.name, self.rename_person = track, identity['display_name'], person
            self.name_state = 'confirming'
            self.started = self.last_seen = time.monotonic()

    def archive_person(self, track, identity):
        if identity.get('identity_status') == 'confirmed':
            return identity['person_id']
        if self.track == track and self.origin_anonymous and self.declined != track:
            return self.person or self.rename_person
        return None

    def status(self):
        if self.name and time.monotonic() - self.started >= 180:
            self.reset()
        return dict(name=self.name, person_id=self.person, samples=len(self.samples), poses=sorted(self.photos),
                    learning=bool(self.name and not self.person), awaiting_name=time.monotonic() < self.awaiting,
                    name_state=self.name_state)
