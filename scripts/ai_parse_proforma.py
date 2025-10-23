#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI Parser de Proformas - Versión extendida (2025-10-22)
Lee TODO el PDF (sin límite de páginas), lo convierte a imágenes base64
y envía todo a ChatGPT para extracción completa de ítems.
"""

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
# CONVERSIÓN DE PDF A IMÁGENES BASE64 (SIN LÍMITE)
# ==========================================================
def pdf_to_images_b64(path: str, max_pages: int = None, zoom: float = 2.0) -> List[str]:
    out: List[str] = []
    doc = fitz.open(path)
    total_pages = len(doc)
    if max_pages is None or max_pages > total_pages:
        max_pages = total_pages
    for i in range(max_pages):
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
        # 1) Convertir TODO el PDF a imágenes base64
        images = pdf_to_images_b64(pdf_path, max_pages=None, zoom=2.0)
        print(f"[INFO] PDF convertido a {len(images)} imágenes base64", file=sys.stderr)

        # 2) Prompt principal
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
            "- No ignores las filas sin precio o modelo.\n"
            "- Mantén todos los datos, incluso si parecen subtítulos.\n"
            "- Devuelve SOLO JSON válido, sin texto adicional.\n"
        )

        # 3) Contenido del prompt
        content: List[Dict[str, Any]] = [
            {"type": "text", "text": "Extrae todos los ítems de esta proforma. Devuelve SOLO JSON válido."}
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
                # máximo permitido para salida larga
                "max_tokens": 16000,
            },
            timeout=300,
        )

        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"] or "{}"

        # 5) Reparar JSON incompleto
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # intentar reparar
            fixed = raw.rsplit("}", 1)[0] + "}"
            try:
                data = json.loads(fixed)
            except Exception:
                print("[WARN] Respuesta JSON incompleta o corrupta", file=sys.stderr)
                data = {"rows": [], "notas": "Respuesta incompleta del modelo"}

        # 6) Normalizar filas
        rows = data.get("rows", []) if isinstance(data, dict) else []
        norm = []
        for rrow in rows:
            nombre = (rrow or {}).get("nombre_comercial")
            modelo = (rrow or {}).get("modelo")
            desc = (rrow or {}).get("descripcion")

            if nombre and modelo and nombre.strip().upper() == modelo.strip().upper():
                nombre = f"PRODUCTO {modelo}"
            if not nombre and modelo:
                nombre = f"PRODUCTO {modelo}"
            if not modelo and nombre:
                m = re.search(r"[A-Z]{2,}\d+[A-Z]*", nombre)
                if m:
                    modelo = m.group(0)
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

        # 7) Salida final
        _emit_json({"success": True, "rows": norm, "notas": data.get("notas")})

    except Exception as e:
        _emit_json({"success": False, "error": str(e)})

# ==========================================================
if __name__ == "__main__":
    main()
