# Pasa a texto el audio del botón del micrófono (server.mjs lo llama con la ruta del archivo).
# Usa faster-whisper local: primero en la placa de video (large-v3-turbo) y, si no se puede, en el procesador (small).
# Escribe el texto en stdout (UTF-8); los errores van a stderr. Con --servidor queda abierto y atiende pedidos por stdin
# (server.mjs lo usa así para ir escribiendo mientras se habla, sin cargar el modelo cada vez).
import glob
import json
import os
import sys

# Las DLL de CUDA (cuBLAS y cuDNN) vienen de los paquetes pip nvidia-cublas-cu12 y nvidia-cudnn-cu12: sin esto la placa
# de video no anda (cublas64_12.dll no se encuentra) y cae al procesador, que es lentísimo para dictar.
for _base in sys.path:
    for _bin in glob.glob(os.path.join(_base, "nvidia", "*", "bin")):
        os.add_dll_directory(_bin)
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

import av
import numpy as np
from faster_whisper import WhisperModel

OPCIONES = [
    ("mobiuslabsgmbh/faster-whisper-large-v3-turbo", "cuda", "float16"),
    ("small", "cpu", "int8"),
]


def leer_audio(ruta):
    # El decode_audio de faster-whisper no anda con el PyAV nuevo (metadata_errors): se decodifica acá a 16 kHz mono.
    r = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
    cuadros = []
    with av.open(ruta) as c:
        try:
            for f in c.decode(audio=0):
                cuadros += [x.to_ndarray() for x in r.resample(f)]
        except av.error.FFmpegError:
            # Los parciales del celular son un OGG que la app sigue escribiendo: el final puede venir cortado
            if not cuadros:
                raise
    cuadros += [x.to_ndarray() for x in r.resample(None)]
    if not cuadros:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(cuadros, axis=1).flatten().astype(np.float32) / 32768.0


_modelo = None  # el que anduvo, para no volver a cargarlo en cada pedido (modo --servidor)


def cargar():
    # El primer modelo que carga y transcribe de verdad (la falta de cuBLAS recién salta al transcribir).
    global _modelo
    if _modelo is not None:
        return _modelo
    ultimo = None
    for modelo, dispositivo, tipo in OPCIONES:
        try:
            m = WhisperModel(modelo, device=dispositivo, compute_type=tipo)
            list(m.transcribe(np.zeros(16000, dtype=np.float32), language="es", beam_size=1)[0])
            _modelo = m
            return m
        except Exception as e:  # sin CUDA, sin el modelo, etc.: probar la siguiente
            ultimo = e
            print(f"{modelo} en {dispositivo} no anduvo: {e}", file=sys.stderr, flush=True)
    raise RuntimeError(f"No pude pasar el audio a texto: {ultimo}")


def transcribir(ruta, beam=5):
    audio = leer_audio(ruta)
    if not audio.size:
        return ""
    partes, _ = cargar().transcribe(audio, language="es", vad_filter=True, beam_size=beam)
    return " ".join(p.text.strip() for p in partes).strip()


def servidor():
    # Una línea JSON por pedido ({"id", "ruta", "parcial"}) y una por respuesta ({"id", "texto"} o {"id", "error"}).
    # Los parciales (mientras se habla) van con beam 1, más rápido; el final, con beam 5.
    # El modelo se carga ya (con un segundo de silencio), antes del primer pedido, para que el dictado arranque al instante.
    try:
        cargar()
    except RuntimeError as e:
        print(e, file=sys.stderr, flush=True)
    for linea in sys.stdin:
        try:
            p = json.loads(linea)
        except ValueError:
            continue
        try:
            r = {"id": p.get("id"), "texto": transcribir(p["ruta"], 1 if p.get("parcial") else 5)}
        except Exception as e:
            r = {"id": p.get("id"), "error": str(e)}
        print(json.dumps(r, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:] == ["--servidor"]:
        servidor()
    else:
        try:
            print(transcribir(sys.argv[1]))
        except RuntimeError as e:
            raise SystemExit(str(e))
