#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parser Proforma híbrido (pdfplumber + OCR)
Versión 2025-10-22 (Fix columnas duplicadas + logs)
"""

import sys, io, json, mimetypes, re, math
from typing import Optional
import pandas as pd
import numpy as np
from PIL import Image
import pdfplumber

# OCR (opcional)
try:
    from paddleocr import PaddleOCR
    OCR_AVAILABLE = True
except Exception:
    OCR_AVAILABLE = False

TARGET_COLUMNS = [
    "item_no", "commercial_name", "model", "qty",
    "package", "unit_price", "total_amount", "hs_code", "notes"
]

HEADER_ALIASES = {
    "item": "item_no", "no": "item_no",
    "description": "commercial_name", "item description": "commercial_name",
    "product": "commercial_name", "model": "model",
    "qty": "qty", "quantity": "qty",
    "package": "package", "packages": "package",
    "unit price": "unit_price", "price": "unit_price",
    "amount": "total_amount", "total": "total_amount",
    "hs": "hs_code", "hs code": "hs_code",
    "remark": "notes", "note": "notes"
}


def clean_nans(obj):
    if isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    if obj is None:
        return None
    try:
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
    except Exception:
        pass
    if isinstance(obj, str) and obj.strip().lower() in {"nan", "<na>"}:
        return None
    return obj


def best_header_match(name: str) -> Optional[str]:
    n = name.strip().lower()
    if n in HEADER_ALIASES:
        return HEADER_ALIASES[n]
    for k in HEADER_ALIASES:
        if k in n:
            return HEADER_ALIASES[k]
    return None


def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    print(f"[DEBUG] Normalizando dataframe ({len(df)} filas)", file=sys.stderr)
    new_cols = {}
    for c in df.columns:
        mapped = best_header_match(str(c))
        if mapped:
            new_cols[c] = mapped
    df = df.rename(columns=new_cols)
    df = df.loc[:, ~df.columns.duplicated()]

    for col in TARGET_COLUMNS:
        if col not in df.columns:
            df[col] = None
    df = df.reindex(columns=TARGET_COLUMNS, fill_value=None)

    # Conversión numérica tolerante
    for c in ["qty", "package", "unit_price", "total_amount"]:
        df[c] = (
            df[c].astype(str)
            .str.replace(",", "", regex=False)
            .str.replace("$", "", regex=False)
            .str.extract(r"([-+]?\d*\.?\d+)")[0]
        )
        df[c] = pd.to_numeric(df[c], errors="ignore")

    # 🧹 Filtro 1: eliminar filas completamente vacías
    df = df.dropna(how="all")

    # 🧹 Filtro 2: eliminar filas sin cantidad ni precio
    df = df[
        df[["qty", "unit_price", "total_amount"]]
        .apply(lambda r: any(pd.notna(x) and str(x).strip() != "" for x in r), axis=1)
    ]

    # 🧹 Filtro 3: eliminar descripciones irrelevantes (tipo “Weight”, “Size”, “Speed”)
    exclude_words = [
        "structure", "size", "weight", "efficiency", "rotating", "speed",
        "depth", "type", "shaft", "width", "number", "overall", "guage", "track"
    ]
    df = df[
        ~df["model"].astype(str).str.lower().isin(exclude_words)
    ]

    df = df.where(pd.notna(df), None)
    print(f"[DEBUG] Filas válidas tras limpiar: {len(df)}", file=sys.stderr)
    return df



def parse_pdf_hybrid(data: bytes) -> pd.DataFrame:
    all_rows = []
    if not OCR_AVAILABLE:
        print("[WARN] PaddleOCR no disponible. Solo se usará pdfplumber.", file=sys.stderr)

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        print(f"[DEBUG] PDF con {len(pdf.pages)} páginas detectadas", file=sys.stderr)
        ocr = PaddleOCR(use_angle_cls=True, lang='en') if OCR_AVAILABLE else None

        for i, page in enumerate(pdf.pages, start=1):
            try:
                tables = page.extract_tables() or []
                if tables:
                    print(f"[PLUMBER] Página {i}: {len(tables)} tabla(s) detectadas", file=sys.stderr)
                    for t in tables:
                        if len(t) > 1:
                            header = t[0]
                            for row in t[1:]:
                                row += [None] * (len(header) - len(row))
                                all_rows.append(dict(zip(header, row)))
                else:
                    text = page.extract_text() or ""
                    if len(text.strip()) < 30 and OCR_AVAILABLE:
                        print(f"[OCR] Página {i} sin texto legible, aplicando OCR...", file=sys.stderr)
                        img = page.to_image(resolution=300).original
                        img = Image.fromarray(img)
                        result = ocr.ocr(np.array(img), cls=True)
                        lines = []
                        for block in result:
                            for line in block:
                                lines.append(line[1][0])
                        if lines:
                            pattern = r"(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+\$?([\d\.]+)\s+\$?([\d\.]+)"
                            for l in lines:
                                m = re.match(pattern, l)
                                if m:
                                    all_rows.append({
                                        "item_no": m.group(1),
                                        "model": m.group(2),
                                        "commercial_name": m.group(3),
                                        "qty": m.group(4),
                                        "unit_price": m.group(5),
                                        "total_amount": m.group(6)
                                    })
                        print(f"[OCR] Página {i}: {len(lines)} líneas OCR leídas", file=sys.stderr)
                    else:
                        print(f"[PLUMBER] Página {i} sin tablas pero con texto plano", file=sys.stderr)
            except Exception as e:
                print(f"[WARN] Error en página {i}: {e}", file=sys.stderr)
                continue

    if not all_rows:
        print("[ERROR] No se detectaron filas válidas", file=sys.stderr)
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    print(f"[FUSION] Total filas combinadas: {len(df)}", file=sys.stderr)
    return normalize_dataframe(df)


def detect_kind(filename: str, content_type: Optional[str]) -> str:
    ct = content_type or (mimetypes.guess_type(filename)[0] or "")
    ext = (filename.split(".")[-1] or "").lower()
    if ext in ("xls", "xlsx", "csv") or "excel" in ct or "csv" in ct:
        return "excel"
    return "pdf"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"meta": {}, "columns": [], "rows": [], "warnings": ["No file"]}))
        return

    path = sys.argv[1]
    content_type = sys.argv[2] if len(sys.argv) >= 3 else None
    with open(path, "rb") as f:
        data = f.read()

    kind = detect_kind(path, content_type)
    df = parse_pdf_hybrid(data)

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "nombre_comercial": r.get("commercial_name"),
            "descripcion": r.get("notes") or "Sin descripción",
            "modelo": r.get("model"),
            "unidad_de_medida": "PZA",
            "cantidad_x_caja": r.get("package") or 1,
            "cajas": 1,
            "total_unidades": r.get("qty") or 1,
            "partida": r.get("hs_code"),
            "precio_unitario_usd": r.get("unit_price"),
            "total_usd": r.get("total_amount")
        })

    print(json.dumps(clean_nans({
        "meta": {"currency": "USD"},
        "columns": list(rows[0].keys()) if rows else [],
        "rows": rows,
        "warnings": []
    }), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
