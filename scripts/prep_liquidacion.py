# scripts/prep_liquidacion.py
import os, sys, json, tempfile, base64
from typing import Any, Dict, List
import requests

# ====== Muy importante: redirigir stdout a stderr para que los logs NO rompan el JSON ======
_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr  # a partir de aquí, todo print() va a STDERR

# Importa tu extractor según el nombre de archivo que tengas en /scripts
try:
    from extraer_imagenes import extract_images_from_pdf  # si tu archivo es extraer_imagenes.py
except Exception:
    from extraerimagenes import extract_images_from_pdf   # fallback si es extraerimagenes.py


def _emit_json(obj: Dict[str, Any]) -> None:
    """Imprime SOLO el JSON al stdout real, sin logs alrededor."""
    _REAL_STDOUT.write(json.dumps(obj, ensure_ascii=False))
    _REAL_STDOUT.flush()


def classify_b64(b64png: str, api_key: str) -> Dict[str, Any]:
    """Clasifica la imagen y devuelve hsCode, nombre, confianza, razón y link de cotizador."""
    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0.2,
        "max_tokens": 600,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content":
                    "Eres un especialista en clasificación arancelaria (Ecuador / SENAE, NANDINA). "
                    "Devuelve SOLO JSON con este esquema: "
                    "{"
                    "\"hsCode\":\"xxxxxx\","
                    "\"commercialName\":\"texto\","
                    "\"confidence\":0-1,"
                    "\"reason\":\"texto\","
                    "\"linkCotizador\":\"url\""
                    "}. "
                    "⚠️ Reglas para `linkCotizador`: "
                    "- Debe ser un link DIRECTO a un producto real en Amazon, eBay o Alibaba. "
                    "- Elige un producto muy parecido a la imagen y al nombre comercial. "
                    "- Evita devolver links de búsqueda generales o categorías. "
                    "- Si no puedes identificar un producto específico, SOLO como último recurso devuelve un link de búsqueda en Amazon con el nombre comercial."
            },
            {
                "role": "user",
                "content": [
                    {"type": "text",
                     "text": "Clasifica este producto según el sistema arancelario ecuatoriano y devuelve un link de referencia real para cotizar (Amazon, eBay o Alibaba)."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64png}"}}
                ]
            }
        ],
    }
    try:
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"] or "{}"
        data = json.loads(raw)

        # Fallback automático: si no hay link válido → crea uno de búsqueda en Amazon
        cname = str(data.get("commercialName") or data.get("commercial_name") or "").strip()
        link = str(data.get("linkCotizador") or "").strip()
        if (not link or "amazon.com/s?" in link) and cname:
            q = cname.replace(" ", "+")
            link = f"https://www.amazon.com/s?k={q}"

        return {
            "hs_code": str(data.get("hsCode") or data.get("hs_code") or ""),
            "commercial_name": cname,
            "confidence": float(data.get("confidence") or 0),
            "reason": str(data.get("reason") or ""),
            "linkCotizador": link,
        }
    except Exception as e:
        return {
            "hs_code": "",
            "commercial_name": "",
            "confidence": 0.0,
            "reason": f"Error: {e}",
            "linkCotizador": "",
        }


def to_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def main():
    if len(sys.argv) < 4:
        _emit_json({"success": False, "error": "usage: prep_liquidacion.py <pdf_path> <doc_name> <openai_api_key>"})
        return

    pdf_path, doc_name, api_key = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = os.path.join(tmp, "imgs")
            os.makedirs(out_dir, exist_ok=True)

            # Extrae imágenes
            extract_images_from_pdf(pdf_path, out_dir)

            files = sorted(os.listdir(out_dir))
            images: List[Dict[str, Any]] = []
            for i, f in enumerate(files):
                fp = os.path.join(out_dir, f)
                if not os.path.isfile(fp):
                    continue
                b64 = to_b64(fp)
                cls = classify_b64(b64, api_key)
                images.append({
                    "id": f"img{i+1}",
                    "name": f,
                    "b64": b64,
                    "hs_code": cls.get("hs_code", ""),
                    "commercial_name": cls.get("commercial_name", ""),
                    "confidence": cls.get("confidence", 0),
                    "reason": cls.get("reason", ""),
                    "linkCotizador": cls.get("linkCotizador", ""),
                })

            _emit_json({"success": True, "documentName": doc_name, "images": images})
    except Exception as e:
        _emit_json({"success": False, "error": str(e)})


if __name__ == "__main__":
    main()
