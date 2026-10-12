"""Replay constructed lighting and pose changes with the real encoder in an isolated encrypted gallery."""
import tempfile
from pathlib import Path

import cv2
import numpy as np

from adaptation import TrajectoryLearning
from identity import People, protect
from model import Runtime
from registry import MODELS
from recognition import RecognitionGallery


def run_probe():
    runtime = Runtime()
    if not runtime.edge:
        raise ValueError('An EdgeFace model is required for trajectory adaptation')
    with runtime.people.connect() as db:
        first = db.execute('SELECT person FROM photos ORDER BY person LIMIT 1').fetchone()
        saved = db.execute('SELECT pose,image FROM photos WHERE person=? ORDER BY pose', (first[0],)).fetchall() if first else []
    if not saved:
        raise ValueError('No authorized saved crops are available')
    crops = {pose: protect(image, True) for pose, image in saved}
    decoded = [cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR) for image in crops.values()]
    source = max(decoded, key=lambda image: cv2.Laplacian(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    original = runtime.recognizer.feature(source).reshape(128)

    def transform(angle, light):
        matrix = cv2.getRotationMatrix2D((56, 56), angle, 1)
        moved = cv2.warpAffine(source, matrix, (112, 112), borderMode=cv2.BORDER_REFLECT_101)
        return np.clip(moved.astype(np.float32) * light, 0, 255).astype(np.uint8)

    held_out = [runtime.edge.encoder.feature(transform(angle, light)) for angle, light in ((9, .78), (-9, 1.18), (3, .86))]
    with tempfile.TemporaryDirectory() as folder:
        people = People(Path(folder), 'isolated-probe')
        person = people.enroll('回放测试人物', [original] * 10, crops)
        people.rename(person, '回放测试人物')
        gallery = RecognitionGallery(runtime.edge.encoder, people)
        before = [gallery.scores(vector)[0][0] for vector in held_out]
        learner = TrajectoryLearning(gallery)
        qualities = []
        time_at = 0
        for angle, light in [(0, 1)] * 3 + [(3, .9), (6, .82), (9, .74), (12, .66), (9, .74), (6, .82), (3, .9)] + [(0, 1)] * 3:
            image = source if angle == 0 and light == 1 else transform(angle, light)
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            brightness = float(gray.mean())
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            quality = 'face-exposure' if not 40 < brightness < 220 else 'face-blurry' if sharpness < 35 else 'accepted' if sharpness >= 70 else 'recognition-only'
            qualities.append(quality)
            time_at += .3
            learner.frame([('probe', [0, 0, 1, 1])], time_at)
            learner.sample('probe', time_at, [.2, .1, .6, .5], gallery.encoder.feature(image), quality,
                           'front', 'dim' if brightness < 85 else 'bright' if brightness > 170 else 'normal',
                           cv2.imencode('.jpg', image)[1].tobytes(), lambda: True)
        records = people.extension_records(person)
        after = [gallery.scores(vector)[0][0] for vector in held_out]
        negatives = []
        for name in ('einstein1_aligned.jpg', 'einstein2_aligned.jpg', 'curie_aligned.jpg'):
            path = MODELS / 'recognition' / name
            if path.exists():
                image = cv2.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
                negatives.append(gallery.scores(gallery.encoder.feature(image))[0][0])
        for batch in records:
            people.revoke_extensions(person, batch['round_id'])
        revoked = [gallery.scores(vector)[0][0] for vector in held_out]
        if not np.allclose(before, revoked):
            raise AssertionError('Revocation did not restore original matching')
        return dict(status='PASS', evidence_mode='saved-aligned-crops-and-constructed-trajectory',
                    model=gallery.encoder.name, constructed_frames=len(qualities),
                    quality_counts={quality: qualities.count(quality) for quality in sorted(set(qualities))},
                    added_samples=sum(batch['count'] for batch in records),
                    held_out_constructed_scores_before=before, held_out_constructed_scores_after=after,
                    public_negative_examples=len(negatives), public_negative_max=max(negatives, default=None),
                    revocation_restored_original=True, real_gallery_modified=False,
                    note='使用真实 EdgeFace 编码器和已有授权裁剪，临时加密图库独立运行。姿态、亮度和轨迹由程序构造，位置已知，未验证真人连续跟踪、现场误认率或独立录像提升。原始人物库未增加补采样本。')
