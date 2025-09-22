import os
import sys
import json
import tempfile
from typing import List, Dict, Any
import requests
import re

# ====== REDIRECCIÓN: todo print() va a STDERR; stdout queda limpio para JSON ======
_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr  # desde aquí, cualquier print va a stderr

from extraerimagenes import extract_images_from_pdf
from subirfotos import upload_images_to_drive
from autenticacion import get_service

# ------------------------------ OpenAI ------------------------------

def _mime_for_path(p: str) -> str:
    ext = os.path.splitext(p)[1].lower()
    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    if ext == ".gif":
        return "image/gif"
    return "image/png"

def classify_image_with_openai_base64(image_path: str, openai_api_key: str) -> Dict[str, Any]:
    import base64
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    mime = _mime_for_path(image_path)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openai_api_key}",
    }

    SYSTEM_PROMPT = (
        "Eres un especialista en clasificación arancelaria (Ecuador / SENAE, NANDINA). "
        'Devuelve SOLO JSON con: {"hs_code":"xxxxxx","commercial_name":"texto","confidence":0-1,"reason":"texto"}. '
        "Si la imagen no es suficiente, devuelve hs_code vacío y explica brevemente en reason."
    )

    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "max_tokens": 300,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Clasifica este producto según el sistema arancelario ecuatoriano:"},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            },
        ],
    }

    try:
        r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=90)
        if r.status_code != 200:
            return {
                "hs_code": "",
                "commercial_name": "",
                "confidence": 0.0,
                "reason": f"OpenAI {r.status_code}: {r.text[:500]}",
            }

        raw = r.json()["choices"][0]["message"]["content"] or "{}"
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
        return {
            "hs_code": str(data.get("hs_code", "")),
            "commercial_name": str(data.get("commercial_name", "")),
            "confidence": float(data.get("confidence", 0) or 0),
            "reason": str(data.get("reason", "")),
        }
    except Exception as e:
        return {
            "hs_code": "",
            "commercial_name": "",
            "confidence": 0.0,
            "reason": f"Error en clasificación: {e}",
        }

# ------------------------------ Google Sheets ------------------------------

def _hs6(v: str) -> str:
    return re.sub(r"\D", "", v or "")[:6]

def _to_uc_link(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"/file/d/([A-Za-z0-9_-]+)", url) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url)
    return f"https://drive.google.com/uc?export=view&id={m.group(1)}" if m else url

def create_liquidacion_sheet(image_data: List[Dict], doc_name: str, folder_id: str) -> str:
    """
    Crea Google Sheet en `folder_id` con:
    A=URL, B=IMAGE(A), C=HS(6), D=Nombre, E=Confianza, F=Justificación
    """
    service = get_service("sheets")
    drive_service = get_service("drive")

    spreadsheet = service.spreadsheets().create(
        body={"properties": {"title": f"Liquidación - {doc_name}"}}
    ).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]

    # mover a la carpeta destino
    try:
        drive_service.files().update(
            fileId=spreadsheet_id,
            addParents=folder_id,
            removeParents="root",
            supportsAllDrives=True,
        ).execute()
    except Exception as e:
        print(f"[sheet] No pude mover el archivo: {e}")

    headers = [["URL", "Vista", "Partida_Arancelaria", "Nombre_Comercial", "Confianza", "Justificación"]]
    rows = []
    for idx, item in enumerate(image_data, start=2):
        u = _to_uc_link(item.get("url", ""))
        c = item.get("classification") or {}
        rows.append([
            u,                 # A: URL (preview, normalizada)
            f"=IMAGE(A{idx})", # B: Vista (referencia a A)
            _hs6(c.get("hs_code", "")),
            c.get("commercial_name", ""),
            c.get("confidence", 0),
            c.get("reason", ""),
        ])

    body = {"values": headers + rows}
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="A1",
        valueInputOption="USER_ENTERED",
        body=body,
    ).execute()

    # formato de encabezados
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "repeatCell": {
                        "range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1},
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.2, "green": 0.6, "blue": 0.9},
                                "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat)",
                    }
                }
            ]
        },
    ).execute()

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"

# ------------------------------ Pipeline ------------------------------

def process_liquidacion_completa(pdf_path: str, doc_name: str, folder_id: str, openai_api_key: str) -> Dict[str, Any]:
    """
    Procesa un PDF completo para liquidación arancelaria
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            extraction_folder = os.path.join(temp_dir, "imagenes_extraidas")
            os.makedirs(extraction_folder, exist_ok=True)

            print("Extrayendo imágenes del PDF...")
            extract_images_from_pdf(pdf_path, extraction_folder)

            print("Subiendo imágenes a Google Drive...")
            image_urls, image_names, image_ids = upload_images_to_drive(extraction_folder, folder_id)

            print("Clasificando imágenes con OpenAI...")
            image_data: List[Dict[str, Any]] = []
            for i, (url, name) in enumerate(zip(image_urls, image_names)):
                img_path = os.path.join(extraction_folder, name)
                classification = classify_image_with_openai_base64(img_path, openai_api_key)
                image_data.append({"name": name, "url": url, "classification": classification})
                print(f"Procesada imagen {i+1}/{len(image_names)}: {name}")

            print("Creando hoja de Google Sheets...")
            sheet_url = create_liquidacion_sheet(image_data, doc_name, folder_id)

            return {
                "success": True,
                "sheet_url": sheet_url,
                "folder_url": f"https://drive.google.com/drive/folders/{folder_id}",
                "total_images": len(image_data),
                "image_data": image_data,
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "total_images": 0,
            "image_data": [],
        }

# ------------------------------ Main ------------------------------

def _emit_json(obj: Dict[str, Any]) -> None:
    """Imprime SOLO el JSON al stdout real, sin logs alrededor."""
    _REAL_STDOUT.write(json.dumps(obj, ensure_ascii=False))
    _REAL_STDOUT.flush()

if __name__ == "__main__":
    # Uso: python liquidacion_completa.py <pdf_path> <doc_name> <folder_id> <openai_api_key>
    if len(sys.argv) != 5:
        print("Uso: python liquidacion_completa.py <pdf_path> <doc_name> <folder_id> <openai_api_key>")
        sys.exit(1)

    pdf_path, doc_name, folder_id, openai_api_key = sys.argv[1:5]
    out = process_liquidacion_completa(pdf_path, doc_name, folder_id, openai_api_key)
    _emit_json(out)  # <-- SOLO JSON en stdout
