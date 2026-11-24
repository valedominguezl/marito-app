# La voz de Marito, local y en el procesador: queda prendido con la voz cargada y pasa a audio cada frase que le manda
# server.mjs. Dos voces, a elección (botón «Voz» en la configuración de Marito):
#   daniela: Piper es_AR-daniela-high (el .onnx y su .json en %LOCALAPPDATA%\arreglo\voz\).
#   santa:   Kokoro-82M, voz em_santa (el modelo lo baja de Hugging Face la primera vez).
# Lo corre el Python del entorno de la voz (%LOCALAPPDATA%\arreglo\voz\venv, lo arma instalar-voz.ps1).
#   voz.py --servidor [--motor daniela|santa]
#       Una línea JSON por pedido ({"id", "texto"}) y una por respuesta ({"id", "wav": <base64>, "seg"} o {"id", "error"}).
#       Al terminar de cargar escribe {"listo": true, "motor": ...}. El audio va por stdout: no se escribe nada en disco.
#   voz.py --probar "texto" --salida prueba.wav [--motor ...]   (para probar a mano)
import argparse
import base64
import io
import json
import os
import sys
import time
import wave

import warnings
warnings.filterwarnings('ignore')  # avisos de torch/kokoro en cada carga: no son errores

DATOS = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'arreglo', 'voz')
PIPER = os.path.join(DATOS, 'es_AR-daniela-high.onnx')


def wav_bytes(muestras_int16, frecuencia):
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(frecuencia)
        w.writeframes(muestras_int16)
    return b.getvalue()


class Santa:
    # Kokoro-82M (hexgrad, Apache-2.0) con la voz em_santa, en castellano por espeak-ng (lang_code 'e'), en el procesador.
    nombre = 'santa'

    def __init__(self):
        from kokoro import KPipeline
        self.p = KPipeline(lang_code='e', repo_id='hexgrad/Kokoro-82M', device='cpu')
        self.voz = self.p.load_voice('em_santa')
        self.decir('Hola.')  # la primera tarda más: que no le toque a la primera frase de verdad

    def decir(self, texto):
        import numpy as np
        a = np.concatenate([r.audio.numpy() for r in self.p(texto, voice=self.voz, speed=1.0)])
        a = (np.clip(a, -1, 1) * 32767).astype(np.int16)
        return wav_bytes(a.tobytes(), 24000), len(a) / 24000


class Daniela:
    # Piper es_AR-daniela-high: liviana y rápida (0,5 s para 12 s de audio).
    nombre = 'daniela'

    def __init__(self):
        from piper import PiperVoice
        if not os.path.exists(PIPER):
            raise RuntimeError(f'Falta la voz de Piper: {PIPER}')
        self.v = PiperVoice.load(PIPER)

    def decir(self, texto):
        partes = [c.audio_int16_bytes for c in self.v.synthesize(texto)]
        datos = b''.join(partes)
        sr = self.v.config.sample_rate
        return wav_bytes(datos, sr), len(datos) / 2 / sr


def cargar(motor):
    # La que eligió el usuario (botón «Voz» en la configuración de Marito); si no carga, la otra.
    orden = [Santa, Daniela] if motor == 'santa' else [Daniela, Santa]
    ultimo = None
    for clase in orden:
        try:
            t = time.time()
            m = clase()
            print(f'{clase.nombre} cargada en {time.time() - t:.1f} s', file=sys.stderr, flush=True)
            return m
        except Exception as e:  # sin el paquete o sin el modelo
            ultimo = e
            print(f'{clase.nombre} no anduvo: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
    raise RuntimeError(f'No pude cargar ninguna voz: {ultimo}')


def servidor(motor):
    out = sys.stdout
    try:
        m = cargar(motor)
    except RuntimeError as e:
        print(json.dumps({'listo': False, 'error': str(e)}, ensure_ascii=False), file=out, flush=True)
        return 1
    print(json.dumps({'listo': True, 'motor': m.nombre}), file=out, flush=True)
    for linea in sys.stdin:
        try:
            p = json.loads(linea)
        except ValueError:
            continue
        try:
            datos, seg = m.decir(str(p.get('texto') or '').strip() or '…')
            r = {'id': p.get('id'), 'wav': base64.b64encode(datos).decode('ascii'), 'seg': round(seg, 2)}
        except Exception as e:
            r = {'id': p.get('id'), 'error': f'{type(e).__name__}: {e}'}
        print(json.dumps(r), file=out, flush=True)
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    a = argparse.ArgumentParser()
    a.add_argument('--servidor', action='store_true')
    a.add_argument('--motor', default='daniela')
    a.add_argument('--probar')
    a.add_argument('--salida')
    o = a.parse_args()
    if o.servidor:
        sys.exit(servidor(o.motor))
    if o.probar and o.salida:
        m = cargar(o.motor)
        t = time.time()
        datos, seg = m.decir(o.probar)
        with open(o.salida, 'wb') as f:
            f.write(datos)
        print(f'{m.nombre}: {time.time() - t:.1f} s para {seg:.1f} s de audio')
        sys.exit(0)
    a.print_help()
    sys.exit(2)
