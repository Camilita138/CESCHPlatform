import fitz  # PyMuPDF
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

    doc = fitz.open(pdf_path)
    img_count = 0

    for pno, page in enumerate(doc, start=1):
        print(f"[extract] Página {pno}")
        items = []  # (row_key, x_left, xref, rect)

        page_h = float(page.rect.height)
        tol = float(max(8.0, (row_tol_px if row_tol_px is not None else page_h * row_tol_ratio)))

        # Recolectar TODAS las instancias de cada imagen
        # (get_images da los xrefs únicos; get_image_rects da cada instancia/rect)
        for meta in page.get_images(full=True):
            xref = meta[0]
            # nombre de recurso, puede ayudar con bbox transformado
            imname = meta[7] if len(meta) > 7 else None

            rect_list = []
            # Preferir bbox por nombre (aplica CTM)
            if imname:
                try:
                    r = page.get_image_bbox(imname)
                    if r and not r.is_empty:
                        rect_list.append(r)
                except Exception:
                    pass
            # Fallback: todas las ocurrencias del xref
            if not rect_list:
                rect_list = page.get_image_rects(xref) or []

            for rect in rect_list:
                if not rect or rect.is_empty:
                    continue

                # Coordenadas “visuales”
                # y aumenta hacia abajo en PyMuPDF; usamos el centro vertical para clusterizar filas
                y_center = (rect.y0 + rect.y1) / 2.0
                if invert_y:
                    y_center = page_h - y_center  # por si tu pipeline invierte eje Y (no debería)

                x_left = min(rect.x0, rect.x1)

                # Bucket de fila por tolerancia
                row_key = round(y_center / tol)

                items.append((row_key, x_left, xref, rect))

        if not items:
            continue

        # Orden final: fila (arriba->abajo) y luego X (izq->der)
        items.sort(key=lambda t: (t[0], t[1]))

        # Render / guardado respetando ese orden
        for _, __, xref, rect in items:
            try:
                img_count += 1
                out_path = os.path.join(output_folder, f"image_{img_count:03d}.png")
                # Render del “placement” (clip al rect para respetar rotación/flip/escala)
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat, clip=rect, alpha=alpha)
                pix.save(out_path)
                print(f"[extract]  -> {out_path}")
            except Exception as e:
                print(f"[extract] xref {xref} error: {e}")

    print(f"[extract] Total de imágenes: {img_count}")
    return img_count
