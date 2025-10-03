import sys, os, json, base64, mimetypes, traceback, tempfile
from typing import List, Any
from autenticacion import get_service
from googleapiclient.http import MediaFileUpload

# =========================
# IDS DE PLANTILLAS
# =========================
TEMPLATES = {
    "aereo": "11G1xXCDwhnvzJS9yvB8q26fsozVvAvcpOm19vaAGONs",
    "maritimo": "1m2H_QSNOa6JIp7Pyq1aAwRATB6MSQ6LXD5YWiBOM4F0",
    "contenedor": "1SIJhWSJPZnNQ69FSIn-XEzqFqGrQ9sI5X-yf2mY8R3A"
}

# ----------------------
# Subida de imágenes
# ----------------------
def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive) -> str:
    """Sube imagen a Drive, la hace pública y devuelve URL directa válida para =IMAGE()"""
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1] or ".png")
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()  # 👈 Cerramos el archivo antes de usarlo en MediaFileUpload

        media = MediaFileUpload(tmp.name, mimetype=mime, resumable=False)
        created = drive.files().create(
            body={"name": name, "parents": [folder_id]},
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()

    finally:
        try:
            os.unlink(tmp.name)  # 👈 Ahora sí se puede borrar sin error en Windows
        except Exception:
            pass

    file_id = created["id"]

    # Hacer público (lector)
    drive.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()

    return f"https://lh3.googleusercontent.com/d/{file_id}=s0"


# ----------------------
# Crear copia de plantilla
# ----------------------
def copy_template(template_key: str, title: str, folder_id: str, drive) -> str:
    if template_key not in TEMPLATES:
        raise RuntimeError(f"Plantilla desconocida: {template_key}")
    template_id = TEMPLATES[template_key]
    copied = drive.files().copy(
        fileId=template_id,
        body={"name": title, "parents": [folder_id]},
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return copied["id"]

# ----------------------
# Escribir datos en la plantilla
# ----------------------
def _write_rows_to_template(spreadsheet_id: str, rows: List[List[Any]], sheets) -> None:
    start_row = 3  # inicio en la fila 3
    num_items = len(rows)

    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheet_id = meta["sheets"][0]["properties"]["sheetId"]

    # Insertar filas si hace falta
    requests = []
    if num_items > 1:
        requests.append({
            "insertDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": start_row,
                    "endIndex": start_row + (num_items - 1)
                },
                "inheritFromBefore": True
            }
        })

    if requests:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": requests}
        ).execute()

    # Escribir valores
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"A{start_row}",
        valueInputOption="USER_ENTERED",
        body={"values": rows},
    ).execute()

# ----------------------
# MAIN
# ----------------------
def main():
    try:
        if len(sys.argv) != 3:
            raise RuntimeError("Uso: python commit_liquidacion.py <payload_json_path> <tipo_plantilla>")

        payload_path, template_key = sys.argv[1], sys.argv[2]
        with open(payload_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        document_name = payload.get("documentName", "Liquidación")
        folder_id = payload.get("folderId")
        items = payload.get("items", [])
        if not folder_id:
            raise RuntimeError("Falta folderId en payload")

        drive = get_service("drive")
        sheets = get_service("sheets")

        ssid = copy_template(template_key, f"{document_name} ({template_key})", folder_id, drive)

        rows: List[List[Any]] = []
        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"

            # Imagen
            b64 = it.get("b64") or it.get("_b64")
            url = _upload_b64_to_drive(b64, name, folder_id, drive) if b64 else it.get("url", "")

            hs = str(it.get("hs_code") or it.get("hsCode") or "")
            com = it.get("commercial_name") or it.get("commercialName") or ""
            link_cotizador = it.get("linkCotizador") or f"https://www.amazon.com/s?k={com.replace(' ', '+')}"

            # Mapeo exacto columnas
            row = [
                link_cotizador,     # A: Link cotizador
                "",                 # B: Proveedores
                "",                 # C: Modelo
                f'=IMAGE("{url}")', # D: Foto (imagen dentro de celda)
                url,                # E: Link de la imagen
                "",                 # F: Descripción (vacío)
                com,                # G/H: Nombre comercial
                1,                  # I: Unidad de medida
                1,                  # J: Cantidad x Caja
                1,                  # K: Cajas
                1,                  # L: Total unidades
                "", "", "", "", "", "", "", "", "",  # M-T vacíos
                hs,                 # U: Partida (HS code)
                "", "", "", "", ""  # V-Z vacíos
            ]
            rows.append(row)

        _write_rows_to_template(ssid, rows, sheets)

        print(json.dumps({
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "driveFolder": f"https://drive.google.com/drive/folders/{folder_id}",
            "rows": len(rows),
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"{e}\n{traceback.format_exc()}"},
                         ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
