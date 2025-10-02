import sys, os, json, base64, mimetypes, traceback, tempfile
from typing import Dict, Any, List
from autenticacion import get_service
from googleapiclient.http import MediaFileUpload


def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive) -> str:
    """Sube imagen a Drive, la hace pública y devuelve URL directa válida para =IMAGE()"""
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1] or ".png") as tmp:
        tmp.write(data)
        tmp.flush()
        media = MediaFileUpload(tmp.name, mimetype=mime, resumable=True)
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

    file_id = created["id"]

    # Hacer público (lector)
    drive.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()

    # URL directa (carga rápida) y compatible con =IMAGE()
    return f"https://lh3.googleusercontent.com/d/{file_id}=s0"


def _create_sheet(title: str, folder_id: str, drive, sheets) -> str:
    created = drive.files().create(
        body={
            "name": title,
            "mimeType": "application/vnd.google-apps.spreadsheet",
            "parents": [folder_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return created["id"]


def _write_rows_to_sheet(spreadsheet_id: str, rows: List[List[Any]], sheets) -> None:
    headers = [["URL","Vista","Partida_Arancelaria","Nombre_Comercial","Confianza","Justificación","Link_Cotizador"]]
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="A1",
        valueInputOption="USER_ENTERED",
        body={"values": headers + rows},
    ).execute()

    # Formato cabecera
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
        },
    ).execute()


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

        rows: List[List[Any]] = []
        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"

            # 1) Conseguir base64
            b64 = (
                it.get("b64")
                or it.get("_b64")
                or (it.get("url").split(",", 1)[1] if isinstance(it.get("url"), str) and it["url"].startswith("data:image") else None)
            )

            # 2) Subir siempre a Drive
            url = _upload_b64_to_drive(b64, name, folder_id, drive) if b64 else (
                it.get("url") if isinstance(it.get("url"), str) and it["url"].startswith("http") else ""
            )

            hs = str(it.get("hs_code") or it.get("hsCode") or "")[:6]
            com = it.get("commercial_name") or it.get("commercialName") or ""
            conf = it.get("confidence")
            try:
                conf = float(conf) if conf is not None else ""
            except Exception:
                conf = ""
            reason = it.get("reason") or ""

            # 👇 Nuevo: Link cotizador (de OpenAI o generado con Amazon)
            link_cotizador = it.get("linkCotizador") or ""
            if not link_cotizador and com:
                query = com.replace(" ", "+")
                link_cotizador = f"https://www.amazon.com/s?k={query}"

            rows.append([
                url or "",
                f"=IMAGE(A{i+1})" if url else "",
                hs,
                com,
                conf,
                reason,
                link_cotizador,
            ])

        ssid = _create_sheet(f"Liquidación - {document_name}", folder_id, drive, sheets)
        _write_rows_to_sheet(ssid, rows, sheets)

        print(json.dumps({
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "driveFolder": f"https://drive.google.com/drive/folders/{folder_id}",
            "total": len(rows),
            "rows": len(rows),
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"{e}\n{traceback.format_exc()}"},
                         ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
    