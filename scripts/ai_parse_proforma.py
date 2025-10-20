import sys, json, base64
from typing import List, Dict, Any
import fitz  # PyMuPDF
import requests
import re

# ===== stdout limpio =====
_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr
def _emit_json(obj: Dict[str, Any]) -> None:
    _REAL_STDOUT.write(json.dumps(obj, ensure_ascii=False))
    _REAL_STDOUT.flush()

# ==========================================================
# CONVERSIÓN DE PDF A IMÁGENES BASE64
# ==========================================================
def pdf_to_images_b64(path: str, max_pages: int = 3, zoom: float = 2.0) -> List[str]:
    out: List[str] = []
    doc = fitz.open(path)
    pages = min(len(doc), max_pages)
    for i in range(pages):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        out.append(base64.b64encode(pix.tobytes("png")).decode("utf-8"))
    doc.close()
    return out

# ==========================================================
# HELPERS DE FORMATO Y NÚMEROS
# ==========================================================
def try_float(x):
    try:
        if x is None:
            return None
        return float(str(x).replace(",", ".").replace(" ", ""))
    except Exception:
        return None

def clean_partida(v) -> str:
    s = (str(v or "")).replace(" ", "")
    s = "".join(ch for ch in s if ch.isdigit())
    return s[:10] if s else ""

# ==========================================================
# MAIN PRINCIPAL
# ==========================================================
def main():
    # Uso: python ai_parse_proforma.py <pdf_path> <max_pages> <OPENAI_API_KEY>
    if len(sys.argv) < 4:
        _emit_json({
            "success": False,
            "error": "usage: ai_parse_proforma.py <pdf_path> <max_pages> <OPENAI_API_KEY>"
        })
        return

    pdf_path = sys.argv[1]
    max_pages = int(sys.argv[2])
    api_key = sys.argv[3]

    try:
        # 1) Convertir PDF a imágenes
        images = pdf_to_images_b64(pdf_path, max_pages=max_pages, zoom=2.0)

        # 2) Prompt mejorado y extendido
        system = (
            "Eres un asistente experto en interpretar PROFORMAS o INVOICES con tablas de productos. "
            "Tu misión es leer TODO el contenido tabular desde el encabezado 'MODEL' hasta el final del documento, "
            "sin detenerte cuando cambien los modelos ni cuando haya filas con celdas vacías.\n\n"

            "Debes combinar texto y estructura visual del PDF para extraer las filas completas. "
            "Incluye absolutamente todos los productos hasta la última fila visible, incluso si algunas no tienen precios o modelos definidos.\n\n"

            "Formato de salida EXACTO:\n"
            "{\n"
            '  \"rows\": [\n'
            "    {\n"
            '      \"nombre_comercial\": \"string|null\",\n'
            '      \"descripcion\": \"string|null\",\n'
            '      \"modelo\": \"string|null\",\n'
            '      \"unidad_de_medida\": \"string|null\",\n'
            '      \"cantidad_x_caja\": number|null,\n'
            '      \"cajas\": number|null,\n'
            '      \"total_unidades\": number|null,\n'
            '      \"partida\": \"string|null\",\n'
            '      \"precio_unitario_usd\": number|null,\n'
            '      \"total_usd\": number|null\n'
            "    }\n"
            "  ],\n"
            '  \"notas\": \"string\"\n'
            "}\n\n"

            "⚙️ INSTRUCCIONES CLAVE:\n"
            "- Lee toda la tabla desde el encabezado 'MODEL' o 'DESCRIPTION' hasta la última fila antes del total.\n"
            "- No te detengas aunque veas filas sin modelo o descripción. Cada línea con números, texto o precios es una fila válida.\n"
            "- Si varias filas pertenecen al mismo modelo (ejemplo: HDL30A), repite ese modelo en todas.\n"
            "- Si el nombre comercial se parece al modelo, corrígelo para que sea descriptivo: "
            "ejemplo: 'HDL30A' → 'ALTAVOZ PROFESIONAL HDL30A', 'HDL30A FLIGHT CASE' → 'FLIGHT CASE PARA HDL30A'.\n"
            "- 'descripcion' debe contener características técnicas: potencia, materiales, conectores, dimensiones. "
            "Si no hay descripción visible, genera una a partir del texto y la imagen.\n"
            "- 'unidad_de_medida' proviene de columnas UNIT, PCS, CTN, PZA, U/M.\n"
            "- 'cantidad_x_caja', 'cajas', 'total_unidades': deben provenir de columnas QTY, PCS o CTN. "
            "Si no aparecen explícitos, infiere total_unidades = cantidad_x_caja * cajas.\n"
            "- 'precio_unitario_usd' y 'total_usd': extrae de PRICE, UNIT PRICE o AMOUNT.\n"
            "- 'partida' es el HS CODE si existe, o null.\n"
            "- No ignores las filas al final de la tabla (como 'HDL30A fly bar for hanging'). Deben incluirse.\n"
            "- Todos los nombres comerciales deben estar en MAYÚSCULAS.\n"
            "- Devuelve SOLO JSON válido sin texto adicional ni explicaciones.\n"
        )


        # 3) Construir contenido para el modelo
        content: List[Dict[str, Any]] = [
            {"type": "text", "text": "Extrae todos los ítems de esta proforma. Responde SOLO JSON válido."}
        ]
        for b64 in images:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"}
            })

        # 4) Llamada a OpenAI
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4o-mini",
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": content},
                ],
                "max_tokens": 1600,
            },
            timeout=120,
        )

        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"] or "{}"
        data = json.loads(raw)

        # 5) Normalización final
        rows = data.get("rows", []) if isinstance(data, dict) else []
        norm = []
        for rrow in rows:
            nombre = (rrow or {}).get("nombre_comercial")
            modelo = (rrow or {}).get("modelo")
            desc = (rrow or {}).get("descripcion")

            # Si modelo y nombre son iguales → reescribir el nombre
            if nombre and modelo and nombre.strip().upper() == modelo.strip().upper():
                nombre = f"PRODUCTO {modelo}"

            # Si hay modelo pero no nombre → generar uno descriptivo
            if not nombre and modelo:
                nombre = f"PRODUCTO {modelo}"

            # Si hay nombre pero no modelo → intentar extraer del nombre (ej. HDL30A dentro del texto)
            if not modelo and nombre:
                m = re.search(r"[A-Z]{2,}\d+[A-Z]*", nombre)
                if m:
                    modelo = m.group(0)

            # Si no hay descripción, crear una base
            if not desc:
                desc = f"Artículo {nombre.title()}" if nombre else "Producto sin descripción"

            norm.append({
                "nombre_comercial": nombre.upper().strip() if nombre else None,
                "descripcion": desc,
                "modelo": modelo,
                "unidad_de_medida": (rrow or {}).get("unidad_de_medida"),
                "cantidad_x_caja": try_float((rrow or {}).get("cantidad_x_caja")),
                "cajas": try_float((rrow or {}).get("cajas")),
                "total_unidades": try_float((rrow or {}).get("total_unidades")),
                "partida": clean_partida((rrow or {}).get("partida")),
                "precio_unitario_usd": try_float((rrow or {}).get("precio_unitario_usd")),
                "total_usd": try_float((rrow or {}).get("total_usd")),
            })

        # 6) Salida final
        _emit_json({"success": True, "rows": norm, "notas": data.get("notas")})

    except Exception as e:
        _emit_json({"success": False, "error": str(e)})

# ==========================================================
if __name__ == "__main__":
    main()
