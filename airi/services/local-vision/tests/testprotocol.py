import json
import struct
import unittest

from protocol import decode_frame
from temporal import Motions


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.source = dict(session_binding_id='binding', source_id='camera', epoch=1, privacy_generation=1, seq=0)
        self.header = dict(schema_version='1.0', **self.source, captured_at_utc='2026-09-29T00:00:00Z',
                           capture_monotonic_ms=10.0, width=1280, height=720, mime_type='image/jpeg', jpeg_bytes=4)
        self.header['seq'] = 1

    def packet(self):
        data = json.dumps(self.header).encode()
        return b'LV01' + struct.pack('>I', len(data)) + data + b'\xff\xd8\xff\xd9'

    def test_valid_frame(self):
        header, jpeg = decode_frame(self.packet(), self.source)
        self.assertEqual(header.seq, 1)
        self.assertEqual(len(jpeg), 4)

    def test_rejects_each_ownership_dimension(self):
        for key in ['session_binding_id', 'source_id', 'epoch', 'privacy_generation']:
            changed = dict(self.source)
            changed[key] = 2 if isinstance(changed[key], int) else 'other'
            with self.assertRaises(ValueError):
                decode_frame(self.packet(), changed)

    def test_stale_sequence(self):
        self.source['seq'] = 1
        with self.assertRaises(ValueError):
            decode_frame(self.packet(), self.source)

    def test_header_limits_and_unknown_fields(self):
        self.header['path'] = '/private-file'
        with self.assertRaises(ValueError):
            decode_frame(self.packet(), self.source)
        with self.assertRaises(ValueError):
            decode_frame(b'LV01' + struct.pack('>I', 5000) + b'x' * 5000, self.source)

    def test_jpeg_size_mismatch(self):
        self.header['jpeg_bytes'] = 100
        with self.assertRaises(ValueError):
            decode_frame(self.packet(), self.source)

    def test_static_open_palm_never_becomes_wave(self):
        motion = Motions()
        events = []
        for i in range(50):
            events += motion.update(i / 15, 0, 0, .5, 'Open_Palm')
        self.assertEqual(events, [])

    def test_wave_requires_reversals_and_has_cooldown(self):
        motion = Motions()
        events = []
        for i, x in enumerate([.2, .2, .4, .6, .8, .6, .4, .2, .4, .6, .8, .8]):
            events += motion.update(i / 12, 0, 0, x, 'Open_Palm')
        self.assertEqual(events.count('wave'), 1)

    def test_thumb_requires_dwell(self):
        motion = Motions()
        for i in range(5):
            self.assertNotIn('thumbs_up', motion.update(i / 20, 0, 0, None, 'Thumb_Up'))
        self.assertIn('thumbs_up', motion.update(.35, 0, 0, None, 'Thumb_Up'))


if __name__ == '__main__':
    unittest.main()
