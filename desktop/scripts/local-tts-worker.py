"""Offline JSON-lines TTS worker. stdout is reserved for protocol messages."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time

parent_pid = int(sys.argv[1])
system_speech = None


def shutdown(*_):
    if system_speech is not None:
        system_speech.kill()
    os._exit(0)


def watch_parent():
    # Includes SIGKILL/crashes of Electron, where its exit hooks cannot run.
    while True:
        if os.getppid() != parent_pid:
            shutdown()
        time.sleep(0.5)


signal.signal(signal.SIGTERM, shutdown)
threading.Thread(target=watch_parent, daemon=True).start()
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'


def reply(message):
    print(json.dumps(message), flush=True)


# Third-party libraries may print diagnostics; never mix them into the protocol.
with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from kokoro import KModel, KPipeline
    import spacy

    if not spacy.util.is_package('en_core_web_sm'):
        raise RuntimeError('Offline English tokenizer en_core_web_sm is not installed')
    snapshot = Path(snapshot_download('hexgrad/Kokoro-82M', local_files_only=True))
    voice = snapshot / 'voices' / 'af_heart.pt'
    if not voice.is_file():
        raise RuntimeError('Cached Kokoro voice af_heart.pt is missing')
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(snapshot / 'config.json'),
                   model=str(snapshot / 'kokoro-v1_0.pth')).eval()
    pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', model=model)
    pipeline.load_voice(str(voice))

reply({'ready': True})
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        text = str(request['text'])[:500].strip()
        speed = max(0.5, min(2.0, float(request.get('speed', 1))))
        if not text:
            raise ValueError('Empty speech text')
        with contextlib.redirect_stdout(sys.stderr):
            if re.search(r'[\u3400-\u9fff]', text):
                if sys.platform != 'darwin':
                    raise RuntimeError('Chinese offline speech requires macOS system voice')
                with tempfile.TemporaryDirectory(prefix='typewords-tts-') as temp:
                    output = Path(temp) / 'speech.aiff'
                    system_speech = subprocess.Popen(
                        ['/usr/bin/say', '-v', 'Tingting', '-r', str(round(180 * speed)),
                         '-o', str(output)], stdin=subprocess.PIPE,
                        stdout=sys.stderr, stderr=sys.stderr)
                    try:
                        system_speech.communicate(input=text.encode('utf-8'), timeout=45)
                        if system_speech.returncode:
                            raise RuntimeError('macOS Chinese speech failed')
                        audio, rate = sf.read(output)
                    finally:
                        if system_speech.poll() is None:
                            system_speech.kill()
                            system_speech.wait()
                        system_speech = None
            else:
                chunks = [result.audio.numpy() for result in pipeline(text, voice=str(voice), speed=speed)
                          if result.audio is not None]
                if not chunks:
                    raise RuntimeError('Kokoro generated no audio')
                audio, rate = np.concatenate(chunks), 24000
            buffer = io.BytesIO()
            sf.write(buffer, audio, rate, format='WAV', subtype='PCM_16')
        reply({'id': request['id'], 'src': 'data:audio/wav;base64,' +
               base64.b64encode(buffer.getvalue()).decode('ascii')})
    except Exception as error:
        reply({'id': request.get('id'), 'error': str(error)})
