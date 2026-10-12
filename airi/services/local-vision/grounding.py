"""On-demand local Grounding DINO. No network or language-model translation."""
import subprocess

from registry import MODELS, verify_grounding

MODEL = None
PROCESSOR = None
WORDS = {'杯子': 'cup', '手机': 'cell phone', '钥匙': 'keys', '螺丝刀': 'screwdriver', '眼镜': 'glasses',
         '遥控器': 'remote control', '水瓶': 'bottle', '书': 'book', '鼠标': 'mouse', '耳机': 'headphones'}


def find_objects(frame, labels):
    global MODEL, PROCESSOR
    if not (MODELS / 'dino' / 'config.json').exists():
        raise FileNotFoundError('Prepare the isolated Grounding DINO runtime first')
    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
    if not torch.cuda.is_available():
        raise RuntimeError('Grounding DINO requires CUDA for this deployment')
    # Keep headroom for AIRI and other processes. This check does not alter their allocations.
    used = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=3)
    if max(int(value) for value in used.decode().split()) >= 18 * 1024:
        raise RuntimeError('GPU budget exceeded')
    if MODEL is None:
        verify_grounding()
        PROCESSOR = AutoProcessor.from_pretrained(MODELS / 'dino', local_files_only=True, trust_remote_code=False)
        MODEL = AutoModelForZeroShotObjectDetection.from_pretrained(MODELS / 'dino', local_files_only=True,
                                                                   trust_remote_code=False, use_safetensors=True).to('cuda')
    prompts = [WORDS.get(label.strip(), label.strip()) for label in labels]
    image = Image.fromarray(frame[:, :, ::-1])
    inputs = PROCESSOR(images=image, text='. '.join(prompts) + '.', return_tensors='pt').to('cuda')
    with torch.inference_mode():
        outputs = MODEL(**inputs)
    result = PROCESSOR.post_process_grounded_object_detection(outputs, inputs.input_ids, box_threshold=.35,
                                                              text_threshold=.25, target_sizes=[image.size[::-1]])[0]
    return dict(prompts=prompts, device=str(next(MODEL.parameters()).device),
                objects=[dict(label=label, score=float(score), bbox=box.tolist()) for label, score, box in
                         zip(result['labels'], result['scores'].cpu(), result['boxes'].cpu())])
