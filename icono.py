# Arma el ícono de Marito (marito.ico y ui\marito.png) desde la cara de marito-cara.png, sin el fondo.
# Se corre a mano solo si se cambia la imagen:  python icono.py  (para acomodarla a ojo: python editar_icono.py)
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

AQUI = os.path.dirname(os.path.abspath(__file__))


def sin_fondo(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # El fondo es marrón (rojo > verde > azul, bien saturado) y las ramas, casi negras pero rojizas; el personaje es
    # gris, blanco y negro neutro.
    marron = (r - b > 40) & (r >= g)
    ramas = (r - b >= 6) & (r > g) & (np.maximum(np.maximum(r, g), b) < 70)  # el pelo gris también es algo cálido
    # Sin fondo ni ramas, una apertura chica saca restos sueltos y queda la mancha más grande (la cara con el pelo).
    abierto = ndimage.binary_opening(~marron & ~ramas, structure=np.ones((3, 3)))
    etiquetas, n = ndimage.label(abierto)
    if n == 0:
        raise SystemExit("No encontré el personaje.")
    tam = ndimage.sum(abierto, etiquetas, range(1, n + 1))
    cuerpo = etiquetas == (1 + int(np.argmax(tam)))
    # Se recupera el contorno negro (que puede salir rojizo por la compresión) y se rellenan los agujeros.
    cuerpo = ndimage.binary_dilation(cuerpo, structure=np.ones((3, 3)), iterations=2) & ~marron
    # Lo negro que no está pegado a algo gris o blanco del personaje es un pedazo de rama: afuera.
    oscuro = np.maximum(np.maximum(r, g), b) < 70
    relleno = ~oscuro & ~marron
    cuerpo &= ~oscuro | ndimage.binary_dilation(relleno & cuerpo, structure=np.ones((3, 3)), iterations=3)
    etiquetas, n = ndimage.label(cuerpo)
    cuerpo = etiquetas == (1 + int(np.argmax(ndimage.sum(cuerpo, etiquetas, range(1, n + 1)))))
    cuerpo = ndimage.binary_fill_holes(cuerpo)
    alfa = ndimage.gaussian_filter(cuerpo.astype(float), 0.6)
    rgba = np.dstack([a, (np.clip(alfa, 0, 1) * 255).astype(int)]).astype(np.uint8)
    return Image.fromarray(rgba)


LADO = 256
AJUSTE = os.path.join(AQUI, "icono-ajuste.json")  # lo deja editar_icono.py: escala y posición de la cara en el cuadrado


def recorte():
    """La cara sin fondo, recortada a lo que tiene dibujo."""
    im = sin_fondo(Image.open(os.path.join(AQUI, "marito-cara.png")))
    return im.crop(im.getbbox())


def ajuste_inicial(cara):
    # El lado mayor ocupa todo el cuadrado, centrado y apoyado abajo (el cuerpo sigue fuera del cuadro).
    escala = LADO / max(cara.size)
    return {"escala": escala, "x": (LADO - cara.width * escala) / 2, "y": LADO - cara.height * escala}


def leer_ajuste(cara):
    if os.path.exists(AJUSTE):
        with open(AJUSTE, encoding="utf-8") as f:
            return json.load(f)
    return ajuste_inicial(cara)


def armar(cara, ajuste):
    """Pone la cara en el cuadrado del ícono (lo que se sale, se corta) y guarda marito.ico y ui/marito.png."""
    # Se compone a 4x y se achica, para que las posiciones con decimales queden como en el editor.
    k = 4
    w, h = (max(1, round(n * ajuste["escala"] * k)) for n in cara.size)
    lienzo = Image.new("RGBA", (LADO * k, LADO * k), (0, 0, 0, 0))
    lienzo.paste(cara.resize((w, h), Image.LANCZOS), (round(ajuste["x"] * k), round(ajuste["y"] * k)))
    grande = lienzo.resize((LADO, LADO), Image.LANCZOS)
    grande.save(os.path.join(AQUI, "ui", "marito.png"))
    grande.save(os.path.join(AQUI, "marito.ico"), sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])


def main():
    cara = recorte()
    armar(cara, leer_ajuste(cara))
    print("listo: marito.ico y ui/marito.png")


if __name__ == "__main__":
    main()
