# crear_sheet_liquidacion.py
import re
from typing import Dict, Any, List
from autenticacion import get_service

# ===================== Helpers URL =====================

def _extract_drive_id(url: str) -> str:
    if not url:
        return ""
    m = (re.search(r"/file/d/([A-Za-z0-9_-]+)", url)
         or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url)
         or re.search(r"/d/([A-Za-z0-9_-]+)", url))
    if m:
        return m.group(1)
    m2 = re.search(r"lh3\.googleusercontent\.com/d/([A-Za-z0-9_-]+)", url)
    return m2.group(1) if m2 else ""

def _public_img_url(file_id: str, prefer: str = "lh3") -> str:
    fid = (file_id or "").strip()
    if not fid:
        return ""
    if prefer == "lh3":
        return f"https://lh3.googleusercontent.com/d/{fid}=s0"
    return f"https://drive.google.com/uc?export=download&id={fid}"

def _hs6(v: str) -> str:
    return re.sub(r"\D", "", v or "")[:6]

# ===================== Crear Sheet =====================

def create_liquidacion_sheet(image_data: List[Dict[str, Any]], doc_name: str, folder_id: str) -> str:
    """
    Crea Google Sheet en `folder_id` con:
    A=URL directa, B=IMAGE(A), C=HS(6), D=Nombre, E=Confianza, F=Justificación
    """
    service = get_service("sheets")
    drive_service = get_service("drive")

    spreadsheet = service.spreadsheets().create(
        body={"properties": {"title": f"Liquidación - {doc_name}"}}
    ).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]

    # mover a carpeta destino
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
    rows: List[List[Any]] = []

    for idx, item in enumerate(image_data, start=2):
        raw_url = item.get("url", "") or ""
        fid = _extract_drive_id(raw_url)
        u = _public_img_url(fid, prefer="lh3") if fid else raw_url

        c = item.get("classification") or {}
        rows.append([
            u,
            f"=IMAGE(A{idx})",
            _hs6(c.get("hs_code", "")),
            c.get("commercial_name", ""),
            c.get("confidence", 0) or 0,
            c.get("reason", ""),
        ])

    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="A1",
        valueInputOption="USER_ENTERED",
        body={"values": headers + rows},
    ).execute()

    # Formato cabecera
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [{
                "repeatCell": {
                    "range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1},
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.2, "green": 0.6, "blue": 0.9},
                            "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat)"
                }
            }]
        },
    ).execute()

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
