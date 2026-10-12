"""Download only the fixed model catalog. A local lock records actual bytes."""
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / '.local' / 'vision'
MODELS = DATA / 'models'
CATALOG = {
    'yolox': ('yolox-s.onnx', 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx', 'https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/LICENSE'),
    'yunet': ('yunet.onnx', 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx', 'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/LICENSE'),
    'sface': ('sface.onnx', 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx', 'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_recognition_sface/LICENSE'),
    'face': ('face.task', 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE'),
    'gesture': ('gesture.task', 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE'),
}
DINO_REVISION = 'a2bb814dd30d776dcf7e30523b00659f4f141c71'
DINO_FILES = ['README.md', 'added_tokens.json', 'config.json', 'model.safetensors',
              'preprocessor_config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt']
RECOGNITION_CATALOG = {
    'edgeface-xs': 'edgeface_xs_gamma_06.onnx',
    'edgeface-s': 'edgeface_s_gamma_05.onnx',
}


def prepare_recognition():
    folder = MODELS / 'recognition'
    folder.mkdir(parents=True, exist_ok=True)
    lock_path = folder / 'lock.json'
    previous = json.loads(lock_path.read_text()) if lock_path.exists() else {}
    lock = {}
    for name, filename in RECOGNITION_CATALOG.items():
        url = f'https://github.com/yakhyo/edgeface-onnx/releases/download/weights/{filename}'
        target = folder / filename
        if target.exists() and name in previous and digest(target) != previous[name]['sha256']:
            raise ValueError('Recognition model hash changed')
        if not target.exists():
            temp = target.with_suffix('.download')
            download(url, temp)
            import onnxruntime as ort
            ort.InferenceSession(str(temp), providers=['CPUExecutionProvider'])
            temp.replace(target)
        lock[name] = dict(file=filename, url=url, sha256=digest(target), bytes=target.stat().st_size,
                          preprocessing='arcface-112-bgr-to-rgb-minus-one-to-one-v1')
        print(f'{name}: {target.stat().st_size} bytes prepared', flush=True)
    licenses = {}
    for name, url in {
        'edgeface-BSD-3-Clause': 'https://raw.githubusercontent.com/otroshi/edgeface/main/LICENSE',
        'onnx-export-MIT': 'https://raw.githubusercontent.com/yakhyo/edgeface-onnx/main/LICENSE',
    }.items():
        target = folder / (name + '.txt')
        if not target.exists():
            download(url, target)
        licenses[name] = dict(file=target.name, url=url, sha256=digest(target))
    lock['licenses'] = licenses
    lock['purpose'] = 'non-commercial scientific research, as instructed by the project owner'
    lock_path.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    return lock


def verify_recognition():
    folder = MODELS / 'recognition'
    lock = json.loads((folder / 'lock.json').read_text())
    for name, filename in RECOGNITION_CATALOG.items():
        if lock[name]['file'] != filename or digest(folder / filename) != lock[name]['sha256']:
            raise ValueError('Recognition model hash mismatch')
    for record in lock['licenses'].values():
        if record['file'] not in ('edgeface-BSD-3-Clause.txt', 'onnx-export-MIT.txt') or digest(folder / record['file']) != record['sha256']:
            raise ValueError('Recognition license hash mismatch')
    return lock


def prepare_grounding():
    folder = MODELS / 'dino'
    folder.mkdir(parents=True, exist_ok=True)
    files = {}
    for name in DINO_FILES:
        target = folder / name
        url = f'https://huggingface.co/IDEA-Research/grounding-dino-tiny/resolve/{DINO_REVISION}/{name}'
        if not target.exists():
            temp = folder / (name + '.download')
            download(url, temp)
            temp.replace(target)
        files[name] = dict(sha256=digest(target), bytes=target.stat().st_size, url=url)
        print(f'grounding: {name} prepared', flush=True)
    license_path = folder / 'LICENSE'
    if not license_path.exists():
        download('https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/main/LICENSE', license_path)
    files['LICENSE'] = dict(sha256=digest(license_path), bytes=license_path.stat().st_size)
    lock = dict(revision=DINO_REVISION, files=files, license_review='REVIEW_REQUIRED', precision='fp32', preprocessing='transformers-4.51.3')
    (folder / 'lock.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    return lock


def verify_grounding():
    folder = MODELS / 'dino'
    lock = json.loads((folder / 'lock.json').read_text())
    if lock['revision'] != DINO_REVISION or any(name not in lock['files'] for name in DINO_FILES):
        raise ValueError('Grounding model revision or inventory changed')
    for name, record in lock['files'].items():
        if name not in [*DINO_FILES, 'LICENSE'] or digest(folder / name) != record['sha256']:
            raise ValueError('Grounding model hash mismatch')
    return lock


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, target):
    import time
    for attempt in range(5):
        try:
            offset = target.stat().st_size if target.exists() else 0
            request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
            with urllib.request.urlopen(request, timeout=45) as response:
                resumed = response.status == 206 and offset > 0
                if resumed and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                    raise ValueError('Download range mismatch')
                expected = int(response.headers.get('Content-Length', '0'))
                with target.open('ab' if resumed else 'wb') as output:
                    received = 0
                    while chunk := response.read(1024 * 256):
                        output.write(chunk)
                        received += len(chunk)
                if expected and received != expected:
                    raise ValueError('Incomplete model download')
            return
        except (OSError, ValueError):
            if attempt == 4:
                raise
            time.sleep(2)


def prepare():
    MODELS.mkdir(parents=True, exist_ok=True)
    lock_path = MODELS / 'lock.json'
    previous = json.loads(lock_path.read_text()) if lock_path.exists() else {}
    lock = {}
    for name, (filename, url, license_url) in CATALOG.items():
        target = MODELS / filename
        if target.exists() and name in previous and digest(target) != previous[name]['sha256']:
            raise ValueError(f'Model hash changed: {name}. Preserve the file and investigate.')
        if not target.exists():
            temp = target.with_suffix('.download')
            download(url, temp)
            if filename.endswith('.onnx'):
                import onnxruntime as ort
                ort.InferenceSession(str(temp), providers=['CPUExecutionProvider'])
            temp.replace(target)
        license_path = MODELS / f'{name}-LICENSE.txt'
        if not license_path.exists():
            with urllib.request.urlopen(license_url, timeout=30) as response:
                license_path.write_bytes(response.read())
        lock[name] = dict(file=filename, url=url, bytes=target.stat().st_size, sha256=digest(target),
                          license_file=license_path.name, license_sha256=digest(license_path),
                          license_review='REVIEW_REQUIRED', preprocessing='airi-local-vision-v1')
        lock_path.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
        print(f'{name}: {target.stat().st_size} bytes verified', flush=True)
    return lock


def verify():
    lock = json.loads((MODELS / 'lock.json').read_text())
    for name, (filename, _, _) in CATALOG.items():
        record = lock[name]
        if digest(MODELS / filename) != record['sha256']:
            raise ValueError(f'Model hash mismatch: {name}')
        if digest(MODELS / record['license_file']) != record['license_sha256']:
            raise ValueError(f'License hash mismatch: {name}')
    return lock
