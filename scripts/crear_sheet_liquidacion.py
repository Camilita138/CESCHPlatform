import re, os, base64, tempfile
from autenticacion import get_service
from googleapiclient.http import MediaFileUpload

def _to_uc_link(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"/file/d/([A-Za-z0-9_-]+)", url) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url)
    return f"https://drive.google.com/uc?export=view&id={m.group(1)}" if m else url

def _hs6(v: str) -> str:
    return re.sub(r"\D", "", v or "")[:6]

def _upload_data_url_to_drive(data_url: str, name: str, folder_id: str, drive) -> str:
    """Sube un data:image/...;base64,xxx a Drive y devuelve uc?export=view."""
    _, b64payload = data_url.split("base64,", 1)
    data = base64.b64decode(b64payload)
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1] or ".png") as tmp:
        tmp.write(data)
        tmp.flush()
        media = MediaFileUpload(tmp.name, mimetype="image/png", resumable=True)
        created = drive.files().create(
            body={"name": name, "parents": [folder_id]},
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()
    try:
        os.unlink(tmp.name)
    except Exception:
        pass
    fid = created["id"]
    drive.permissions().create(fileId=fid, body={"type":"anyone","role":"reader"}, supportsAllDrives=True).execute()
    return f"https://drive.google.com/uc?export=view&id={fid}"

def create_liquidacion_sheet(image_data, doc_name: str, folder_id: str) -> str:
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
    rows = []
    for idx, item in enumerate(image_data, start=2):
        raw_url = item.get("url", "")
        name = item.get("name") or f"image_{idx-1:03d}.png"

        # Si viene data URL, subir y reemplazar
        if raw_url.startswith("data:") and "base64," in raw_url:
            try:
                u = _upload_data_url_to_drive(raw_url, name, folder_id, drive_service)
            except Exception:
                u = ""
        else:
            u = _to_uc_link(raw_url)

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
