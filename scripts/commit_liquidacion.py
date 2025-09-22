# scripts/commit_liquidacion.py
import sys, os, json, base64, time, mimetypes, traceback, re
from typing import Dict, Any, List

from autenticacion import get_service   # Debe devolver clientes autenticados: get_service("drive") / get_service("sheets")

# ---------- Helpers ----------

def _hs6(v: str) -> str:
    """Deja solo números y recorta a 6 dígitos."""
    return re.sub(r"\D", "", v or "")[:6]

def _to_uc_link(url: str) -> str:
    """Convierte /file/d/<id>/... o ?id=<id> a uc?export=view&id=<id>."""
    if not url:
        return ""
    m = re.search(r"/file/d/([A-Za-z0-9_-]+)", url) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url)
    return f"https://drive.google.com/uc?export=view&id={m.group(1)}" if m else url

def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive) -> str:
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    file_metadata = {"name": name, "parents": [folder_id]}
    import tempfile
    from googleapiclient.http import MediaFileUpload
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1] or ".png") as tmp:
        tmp.write(data)
        tmp.flush()
        media = MediaFileUpload(tmp.name, mimetype=mime, resumable=True)
        created = drive.files().create(
            body=file_metadata,
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()
    try:
        os.unlink(tmp.name)
    except Exception:
        pass

    file_id = created["id"]

    # Permiso público lectura
    drive.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()

    # URL que funciona con =IMAGE()
    return f"https://drive.google.com/uc?export=view&id={file_id}"

def _create_sheet(title: str, folder_id: str, drive, sheets) -> str:
    # Crea spreadsheet en carpeta destino (usamos Drive API para setear parents)
    created = drive.files().create(
        body={
            "name": title,
            "mimeType": "application/vnd.google-apps.spreadsheet",
            "parents": [folder_id],
        },
        fields="id,webViewLink",
        supportsAllDrives=True,
    ).execute()
    return created["id"]

def _write_rows_to_sheet(spreadsheet_id: str, rows: List[List[Any]], sheets) -> None:
    # Encabezados + datos
    head = [["URL","Vista","Partida_Arancelaria","Nombre_Comercial","Confianza","Justificación"]]
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="A1",
        valueInputOption="USER_ENTERED",
        body={"values": head + rows},
    ).execute()

    # Dar color al encabezado
    sheets.spreadsheets().batchUpdate(
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
        }
    ).execute()

# ---------- Main ----------

def main():
    try:
        if len(sys.argv) != 2:
            raise RuntimeError("Uso: python commit_liquidacion.py <payload_json_path>")

        payload_path = sys.argv[1]
        with open(payload_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        document_name = payload.get("documentName") or "Liquidación"
        folder_id = payload.get("folderId") or payload.get("folder_id")
        items = payload.get("items") or []

        if not folder_id:
            raise RuntimeError("Falta folderId en payload")

        drive = get_service("drive")
        sheets = get_service("sheets")

        # Subir imágenes si vienen en b64 o data: y formar filas
        rows = []
        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"
            url = it.get("url") or ""
            b64 = it.get("b64")

            # Si la URL es data:image...;base64, extrae el payload y súbelo a Drive
            if url.startswith("data:") and "base64," in url:
                try:
                    _, b64payload = url.split("base64,", 1)
                    url = _upload_b64_to_drive(b64payload, name, folder_id, drive)
                except Exception:
                    url = ""  # si falla, que pase a siguiente branch

            # Si no hay url pero viene b64 separado -> sube a Drive
            if (not url) and b64:
                url = _upload_b64_to_drive(b64, name, folder_id, drive)

            # Normaliza URL a uc?export=view
            url = _to_uc_link(url)

            # Normaliza HS a 6 dígitos
            hs = _hs6(it.get("hs_code") or it.get("classification", {}).get("hs_code", "") or "")
            com = it.get("commercial_name") or it.get("classification", {}).get("commercial_name", "") or ""
            conf = it.get("confidence") if it.get("confidence") is not None else it.get("classification", {}).get("confidence")
            try:
                conf = float(conf) if conf is not None else ""
            except Exception:
                conf = ""
            reason = it.get("reason") or it.get("classification", {}).get("reason", "") or ""

            # IMPORTANTE: B usa =IMAGE(Afila) para evitar problemas de comillas / data url
            rows.append([
                url or "",
                f"=IMAGE(A{i+1})" if url else "",
                hs,
                com,
                conf,
                reason,
            ])

        # Crear la sheet en la carpeta y escribir
        ssid = _create_sheet(f"Liquidación - {document_name}", folder_id, drive, sheets)
        _write_rows_to_sheet(ssid, rows, sheets)

        out = {
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "driveFolder": f"https://drive.google.com/drive/folders/{folder_id}",
            "total": len(rows),
            "rows": len(rows),
        }
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        err = {"success": False, "error": f"{e}\n{traceback.format_exc()}"}
        print(json.dumps(err, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
