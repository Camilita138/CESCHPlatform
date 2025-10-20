# scripts/parser_proforma.py
import sys, io, json, mimetypes
import pandas as pd
from typing import Optional
import pdfplumber
from PIL import Image
import numpy as np
import math

def clean_nans(obj):
    """Convierte NaN/Inf/pd.NA en None recursivamente para JSON válido."""
    if isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    # pandas/NumPy missing
    if obj is None:
        return None
    try:
        # floats especiales
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
    except Exception:
        pass
    # pandas NA / numpy nan
    try:
        import pandas as _pd, numpy as _np
        if obj is _pd.NA:
            return None
        if isinstance(obj, _np.floating):
            if math.isnan(float(obj)) or math.isinf(float(obj)):
                return None
    except Exception:
        pass
    # strings "nan" → dejar como "" o None si prefieres
    if isinstance(obj, str) and obj.strip().lower() in {"nan", "<na>"}:
        return None
    return obj

# Opcional: OCR (puedes omitir si no lo usarás)
try:
    from paddleocr import PaddleOCR
    OCR_AVAILABLE = True
except Exception:
    OCR_AVAILABLE = False

TARGET_COLUMNS = [
    "item_no","commercial_name","model","color","size","qty","package",
    "unit_price","total_amount","hs_code","picture_url","notes"
]

HEADER_ALIASES = {
    "item": "item_no", "no": "item_no",
    "description": "commercial_name", "item description": "commercial_name", "product": "commercial_name",
    "model": "model", "color": "color", "size": "size",
    "qty": "qty", "quantity": "qty",
    "package": "package", "packages": "package",
    "unit price": "unit_price", "unit price (usd)": "unit_price", "price": "unit_price", "usd": "unit_price",
    "amount": "total_amount", "total": "total_amount",
    "hs code": "hs_code", "hs": "hs_code",
    "picture": "picture_url", "photo": "picture_url",
    "remark": "notes", "note": "notes"
}

def best_header_match(name: str) -> Optional[str]:
    n = name.strip().lower()
    if n in HEADER_ALIASES:
        return HEADER_ALIASES[n]
    if n in TARGET_COLUMNS:
        return n
    # heurísticas simples
    if "hs" in n and "code" in n: return "hs_code"
    if "unit" in n and "price" in n: return "unit_price"
    if "amount" in n or ("total" in n and "unit" not in n): return "total_amount"
    if "qty" in n or "quantity" in n: return "qty"
    if "desc" in n: return "commercial_name"
    return None

def normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    # renombrar columnas según alias/heurística
    new_cols = {}
    for c in df.columns:
        mapped = best_header_match(str(c))
        if mapped:
            new_cols[c] = mapped
    df = df.rename(columns=new_cols)

    # asegurar todas las columnas destino
    for c in TARGET_COLUMNS:
        if c not in df.columns:
            df[c] = None
    df = df[TARGET_COLUMNS]

    # convertir cantidades a numérico
    for c in ["qty", "package"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # limpiar precios / montos (quita comas, $, etc.)
    for c in ["unit_price", "total_amount"]:
        df[c] = (
            df[c].astype(str)
                 .str.replace(",", "", regex=False)
                 .str.replace("$", "", regex=False)
                 .str.extract(r"([-+]?\d*\.?\d+)")[0]
        )
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # strings a str (no llenes con "nan")
    for c in ["commercial_name","model","color","size","hs_code","notes","picture_url"]:
        df[c] = df[c].astype("string")

    # ❌ NO numeres aún; primero borra filas vacías reales
    non_idx_cols = [c for c in TARGET_COLUMNS if c != "item_no"]
    df = df.dropna(how="all", subset=non_idx_cols)

    # ✅ ahora sí, si item_no está vacío, numéralo incrementalmente
    if df.empty or df["item_no"].isna().all():
        df["item_no"] = range(1, len(df) + 1)
    else:
        # rellena item_no donde falte, manteniendo los que existan
        missing = df["item_no"].isna()
        if missing.any():
            next_ids = [i for i in range(1, len(df) + 1)]
            already = set(x for x in df["item_no"].dropna().tolist() if str(x).isdigit())
            counter = (i for i in next_ids if i not in already)
            df.loc[missing, "item_no"] = [next(counter) for _ in range(missing.sum())]

    return df


def parse_excel(data: bytes) -> pd.DataFrame:
    excel = pd.ExcelFile(io.BytesIO(data))
    # elige la hoja con más columnas (suele ser la tabla principal)
    best = max(excel.sheet_names, key=lambda n: pd.read_excel(excel, nrows=200, sheet_name=n).shape[1])
    df = pd.read_excel(excel, sheet_name=best)
    return df.dropna(how="all").reset_index(drop=True)

def parse_pdf_tables(data: bytes) -> Optional[pd.DataFrame]:
    rows = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                if not table or len(table) < 2:
                    continue
                part = pd.DataFrame(table[1:], columns=table[0])
                if part.shape[1] >= 3:
                    rows.append(part)
    if rows:
        return pd.concat(rows, ignore_index=True)
    return None

def parse_image_ocr(data: bytes) -> pd.DataFrame:
    if not OCR_AVAILABLE:
        return pd.DataFrame()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    arr = np.array(img)
    ocr = PaddleOCR(use_angle_cls=True, lang='en')
    result = ocr.ocr(arr, cls=True)

    # Heurística simple: construir filas por líneas con muchos espacios / separadores
    lines = []
    for block in result:
        for line in block:
            lines.append(line[1][0])

    candidate = [l for l in lines if sum(ch.isspace() for ch in l) > 5 or "\t" in l or "|" in l]
    if not candidate:
        return pd.DataFrame()

    split_rows = [[tok for tok in l.replace("|", "\t").split() if tok] for l in candidate]
    width = max((len(r) for r in split_rows), default=0)
    split_rows = [r + [None] * (width - len(r)) for r in split_rows]
    df = pd.DataFrame(split_rows)

    if df.shape[0] >= 2:
        header = df.iloc[0].astype(str).str.lower().tolist()
        df = df.iloc[1:]
        df.columns = header

    return df.reset_index(drop=True)

def detect_kind(filename: str, content_type: Optional[str]) -> str:
    ct = content_type or (mimetypes.guess_type(filename)[0] or "")
    ext = (filename.split(".")[-1] or "").lower()
    if ext in ("xls", "xlsx", "csv") or "excel" in ct or "csv" in ct:
        return "excel"
    if ext in ("png", "jpg", "jpeg", "webp", "tiff", "bmp") or "image" in ct:
        return "image"
    return "pdf"

def main():
    """
    Uso:
      python scripts/parser_proforma.py /ruta/al/archivo.ext [content_type]
    Salida:
      JSON en stdout con { meta, columns, rows, warnings }
    """
    if len(sys.argv) < 2:
        print(json.dumps({"meta": {}, "columns": TARGET_COLUMNS, "rows": [], "warnings": ["Missing file arg"]}))
        return

    path = sys.argv[1]
    content_type = sys.argv[2] if len(sys.argv) >= 3 else None
    with open(path, "rb") as f:
        data = f.read()

    kind = detect_kind(path, content_type)
    warnings = []
    df_raw = None

    try:
        if kind == "excel":
            df_raw = parse_excel(data)
        elif kind == "pdf":
            df_raw = parse_pdf_tables(data)
            if df_raw is None or df_raw.empty:
                warnings.append("PDF sin tablas legibles. Considera OCR.")
                df_raw = pd.DataFrame()
        else:
            df_raw = parse_image_ocr(data)
    except Exception as e:
        warnings.append(f"Error de parseo: {type(e).__name__}: {e}")
        df_raw = pd.DataFrame()

        if df_raw is None or df_raw.empty:
            out = {
                "meta": {"currency": "USD"},
                "columns": TARGET_COLUMNS,
                "rows": [],
                "warnings": warnings or ["No se detectaron tablas."]
            }
        # forzamos JSON estricto
        print(json.dumps(clean_nans(out), ensure_ascii=False, allow_nan=False))
        return

    df = normalize_dataframe(df_raw)

    # ✅ limpiar NaN/NA a None antes de serializar
    df = df.where(pd.notna(df), None).replace({np.nan: None})
    rows = df.to_dict(orient="records")

    out = {
        "meta": {"currency": "USD"},
        "columns": TARGET_COLUMNS,
        "rows": rows,
        "warnings": warnings
    }

    # ✅ usar helper + allow_nan=False para evitar 'NaN' en JSON
    print(json.dumps(clean_nans(out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
