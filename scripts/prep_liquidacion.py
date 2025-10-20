# scripts/prep_liquidacion.py
import os, sys, io, json, tempfile, base64, subprocess
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

# ==========================================================
# Helpers de proforma
# ==========================================================
ESP_KEYS = [
    "nombre_comercial","descripcion","unidad_de_medida","cantidad_x_caja","cajas",
    "total_unidades","partida","precio_unitario_usd","total_usd",
    "link_de_la_imagen","link_cotizador","proveedores","modelo"
]

def _safe_num(x):
    try:
        if x in (None, "", "None"):
            return None
        return float(str(x).replace(",", "").replace("$",""))
    except Exception:
        return None

def _run_parser_proforma(pdf_path: str) -> List[Dict[str, Any]]:
    """
    Ejecuta scripts/parser_proforma.py y devuelve filas normalizadas en español.
    Si no existe o falla, retorna [] y no rompe el flujo.
    """
    script = os.path.join(os.getcwd(), "scripts", "parser_proforma.py")
    if not os.path.exists(script):
        return []

    try:
        out = subprocess.check_output([sys.executable, script, pdf_path], cwd=os.getcwd(), stderr=subprocess.STDOUT, timeout=180)
        data = json.loads(out.decode("utf-8", errors="ignore"))
        rows = data.get("rows", []) or []
    except Exception:
        return []

    norm: List[Dict[str, Any]] = []
    for i, r in enumerate(rows, 1):
        out = {
            "item_no": r.get("item_no", i),
            "nombre_comercial": r.get("nombre_comercial") or r.get("commercial_name") or "",
            "descripcion": r.get("descripcion") or r.get("description") or "",
            "unidad_de_medida": (r.get("unidad_de_medida") or r.get("um") or "PZA"),
            "cantidad_x_caja": r.get("cantidad_x_caja") or r.get("qty_per_box"),
            "cajas": r.get("cajas") or r.get("package"),
            "total_unidades": r.get("total_unidades") or r.get("total_units"),
            "partida": (r.get("partida") or r.get("hs_code") or r.get("hsCode") or ""),
            "precio_unitario_usd": _safe_num(r.get("precio_unitario_usd") or r.get("unit_price_usd")),
            "total_usd": _safe_num(r.get("total_usd")),
            "link_de_la_imagen": r.get("link_de_la_imagen") or r.get("picture_url") or "",
            "link_cotizador": r.get("link_cotizador") or r.get("linkCotizador") or "",
            "proveedores": r.get("proveedores") or "",
            "modelo": r.get("modelo") or r.get("model") or "",
        }
        # Derivados
        if out["total_unidades"] in (None, "", 0) and out["cantidad_x_caja"] and out["cajas"]:
            try:
                out["total_unidades"] = int(out["cantidad_x_caja"]) * int(out["cajas"])
            except Exception:
                pass
        if out["total_usd"] in (None, "") and out["precio_unitario_usd"] and out["total_unidades"]:
            try:
                out["total_usd"] = round(float(out["precio_unitario_usd"]) * float(out["total_unidades"]), 2)
            except Exception:
                pass
        # limpia partida (solo dígitos)
        out["partida"] = "".join(ch for ch in str(out["partida"]) if ch.isdigit())[:10] if out["partida"] else ""
        norm.append(out)
    return norm

def _merge_ai_with_proforma(ai_item: Dict[str, Any], proforma_row: Dict[str, Any] | None) -> Dict[str, Any]:
    """
    Fusiona IA + Proforma. La proforma manda si trae el dato; si no, queda IA.
    """
    merged = dict(ai_item)
    if proforma_row:
        for k in ESP_KEYS:
            v = proforma_row.get(k)
            if v not in (None, "", "None"):
                merged[k] = v

        # nombre comercial (alias para UI y commit)
        if proforma_row.get("nombre_comercial"):
            merged["commercial_name"] = proforma_row["nombre_comercial"]

        # partida prioriza proforma
        if proforma_row.get("partida"):
            merged["hs_code"] = proforma_row["partida"]

        # si no hay b64 y viene link de imagen, úsalo
        if not merged.get("b64") and proforma_row.get("link_de_la_imagen"):
            merged["picture_url"] = proforma_row["link_de_la_imagen"]

        # derivados
        cxj = proforma_row.get("cantidad_x_caja") or merged.get("cantidad_x_caja")
        cajas = proforma_row.get("cajas") or merged.get("cajas")
        if not merged.get("total_unidades") and cxj and cajas:
            try:
                merged["total_unidades"] = int(cxj) * int(cajas)
            except Exception:
                pass
        if not merged.get("total_usd") and merged.get("precio_unitario_usd") and merged.get("total_unidades"):
            try:
                merged["total_usd"] = round(float(merged["precio_unitario_usd"]) * float(merged["total_unidades"]), 2)
            except Exception:
                pass
    return merged

# ==========================================================
# CLASIFICADOR DE PRODUCTOS (con prioridad Alibaba)
# ==========================================================
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
                    "Reglas para linkCotizador: "
                    "- Prioriza enlaces de Alibaba (www.alibaba.com). "
                    "- Si no se encuentra un producto exacto, genera un link de búsqueda en Alibaba con 2–5 palabras clave relevantes (en inglés). "
                    "- Solo si no se puede determinar, usa un link de búsqueda en Amazon como respaldo. "
                    "- Evita devolver links de categorías o páginas vacías."
            },
            {
                "role": "user",
                "content": [
                    {"type": "text",
                     "text": "Describe brevemente el producto de la imagen y genera un link de cotización (preferiblemente de Alibaba)."},
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

        cname = str(data.get("commercialName") or data.get("commercial_name") or "").strip()
        link = str(data.get("linkCotizador") or "").strip()

        # Fallback → búsqueda en Alibaba
        if not link or "alibaba.com" not in link:
            q = cname.replace(" ", "+") if cname else "product"
            link = f"https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&SearchText={q}"

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

# ==========================================================
# MAIN PRINCIPAL
# ==========================================================
def main():
    if len(sys.argv) < 4:
        _emit_json({"success": False, "error": "usage: prep_liquidacion.py <pdf_path> <doc_name> <openai_api_key>"})
        return

    pdf_path, doc_name, api_key = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = os.path.join(tmp, "imgs")
            os.makedirs(out_dir, exist_ok=True)

            # 1) Extrae imágenes
            extract_images_from_pdf(pdf_path, out_dir)

            # 2) Lee proforma (tablas / OCR) si está disponible
            proforma_rows = _run_parser_proforma(pdf_path)  # [] si no hay parser o falla

            # 3) Clasifica + fusiona
            files = sorted(os.listdir(out_dir))
            images: List[Dict[str, Any]] = []
            for i, f in enumerate(files):
                fp = os.path.join(out_dir, f)
                if not os.path.isfile(fp):
                    continue
                b64 = to_b64(fp)
                cls = classify_b64(b64, api_key)

                base_item = {
                    "id": f"img{i+1}",
                    "name": f,
                    "b64": b64,
                    "hs_code": cls.get("hs_code", ""),
                    "commercial_name": cls.get("commercial_name", ""),
                    "confidence": cls.get("confidence", 0),
                    "reason": cls.get("reason", ""),
                    "linkCotizador": cls.get("linkCotizador", ""),
                    # alias español popular en tu pipeline
                    "nombre_comercial": cls.get("commercial_name", ""),
                }

                row = proforma_rows[i] if i < len(proforma_rows) else None
                merged = _merge_ai_with_proforma(base_item, row)
                images.append(merged)

            _emit_json({"success": True, "documentName": doc_name, "images": images})
    except Exception as e:
        _emit_json({"success": False, "error": str(e)})

if __name__ == "__main__":
    main()
