import fitz  # PyMuPDF4
import os
from math import inf

def extract_images_from_pdf(
    pdf_path: str,
    output_folder: str,
    zoom: float = 2.0,
    alpha: bool = False,
    row_tol_ratio: float = 0.018,   # ~1.8% del alto de página (tolerancia de fila)
    row_tol_px: float | None = None,
    invert_y: bool = False,         # deja False: PyMuPDF usa origen arriba-izquierda
):
    """
    Extrae en ORDEN VISUAL: de arriba hacia abajo, y dentro de cada fila de izquierda a derecha.
    Respeta rotaciones/flip de colocación usando rectángulos reales (bbox/rects).
    Guarda como image_001.png, image_002.png, ... para que el orden quede fijado.
    """
    print(f"[extract] Archivo: {pdf_path}")
    os.makedirs(output_folder, exist_ok=True)

    # 🔹 Crear subcarpeta FOTOS dentro de la carpeta base
    output_folder = os.path.join(output_folder, "FOTOS")
    os.makedirs(output_folder, exist_ok=True)

    doc = fitz.open(pdf_path)
    img_count = 0

    for pno, page in enumerate(doc, start=1):
        print(f"[extract] Página {pno}")
        items = []  # (row_key, x_left, xref, rect)

        page_h = float(page.rect.height)
        tol = float(max(8.0, (row_tol_px if row_tol_px is not None else page_h * row_tol_ratio)))

        # Recolectar TODAS las instancias de cada imagen
        for meta in page.get_images(full=True):
            xref = meta[0]
            imname = meta[7] if len(meta) > 7 else None

            rect_list = []
            if imname:
                try:
                    r = page.get_image_bbox(imname)
                    if r and not r.is_empty:
                        rect_list.append(r)
                except Exception:
                    pass

            if not rect_list:
                rect_list = page.get_image_rects(xref) or []

            for rect in rect_list:
                if not rect or rect.is_empty:
                    continue

                y_center = (rect.y0 + rect.y1) / 2.0
                if invert_y:
                    y_center = page_h - y_center

                x_left = min(rect.x0, rect.x1)
                row_key = round(y_center / tol)
                items.append((row_key, x_left, xref, rect))

        if not items:
            continue

        items.sort(key=lambda t: (t[0], t[1]))

        for _, __, xref, rect in items:
            try:
                img_count += 1
                out_path = os.path.join(output_folder, f"image_{img_count:03d}.png")
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat, clip=rect, alpha=alpha)
                pix.save(out_path)
                print(f"[extract]  -> {out_path}")
            except Exception as e:
                print(f"[extract] xref {xref} error: {e}")

    print(f"[extract] Total de imágenes: {img_count}")
    return img_count


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Uso: python extraer_imagenes.py <pdf_path> <output_folder>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_folder = sys.argv[2]

    total = extract_images_from_pdf(pdf_path, output_folder)
    print(f"Extracción completada: {total} imágenes")
