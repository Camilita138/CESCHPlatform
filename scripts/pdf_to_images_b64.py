# scripts/pdf_to_images_b64.py
import sys, json, base64
from typing import List
import fitz  # PyMuPDF

def pdf_to_images_b64(path: str, max_pages: int = 2, zoom: float = 2.0) -> List[str]:
    imgs = []
    doc = fitz.open(path)
    pages = min(len(doc), max_pages)
    for i in range(pages):
        page = doc.load_page(i)
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        b = pix.tobytes("png")
        imgs.append(base64.b64encode(b).decode("utf-8"))
    doc.close()
    return imgs

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"images": [], "warnings": ["usage: pdf_to_images_b64.py <pdf_path> [max_pages]"]}))
        return
    path = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    try:
        imgs = pdf_to_images_b64(path, max_pages=max_pages)
        print(json.dumps({"images": imgs, "warnings": []}))
    except Exception as e:
        print(json.dumps({"images": [], "warnings": [f"{type(e).__name__}: {e}"]}))

if __name__ == "__main__":
    main()
