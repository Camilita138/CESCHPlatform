import sys, os, json, base64, mimetypes, traceback, tempfile
from typing import List, Any, Dict
from autenticacion import get_service
from googleapiclient.http import MediaFileUpload

# =========================
# IDS DE PLANTILLAS
# =========================
TEMPLATES = {
    "aereo": "11G1xXCDwhnvzJS9yvB8q26fsozVvAvcpOm19vaAGONs",
    "maritimo": "1m2H_QSNOa6JIp7Pyq1aAwRATB6MSQ6LXD5YWiBOM4F0",
    "contenedor": "1SIJhWSJPZnNQ69FSIn-XEzqFqGrQ9sI5X-yf2mY8R3A",
}

# ============ Utils Drive ============

def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive) -> str:
    """Sube imagen a Drive y devuelve URL directa válida para =IMAGE()"""
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1] or ".png")
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()  # necesario en Windows
        media = MediaFileUpload(tmp.name, mimetype=mime, resumable=False)
        created = drive.files().create(
            body={"name": name, "parents": [folder_id]},
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

    file_id = created["id"]
    # hacer público
    drive.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()
    return f"https://lh3.googleusercontent.com/d/{file_id}=s0"


def _sheet_id_by_title(sheets, ssid: str, title: str) -> int:
    meta = sheets.spreadsheets().get(spreadsheetId=ssid).execute()
    for s in meta["sheets"]:
        if s["properties"]["title"] == title:
            return s["properties"]["sheetId"]
    raise RuntimeError(f"No se encontró la hoja '{title}'")


def _grow_table(
    sheets,
    ssid: str,
    sheet_title: str,
    header_row_1based: int,
    n_items: int,
    paste_type: str = "PASTE_NORMAL",
):
    """
    Inserta (n_items-1) filas a partir de la primera fila de datos (header+1)
    y copia la fila-plantilla (la primera fila de datos original) a todas las nuevas.
    """
    if n_items <= 1:
        return

    sheet_id = _sheet_id_by_title(sheets, ssid, sheet_title)

    first_data_row_0 = header_row_1based  # 0-based (header_1b + 1) - 1
    # header_row_1based es la fila del encabezado; la primera fila de datos es header+1.
    # en 0-based: (header_row_1based) porque 1-based->0-based y +1 de datos.
    # Ej: header 2 => primera fila de datos = 3 (1-based) => 2 (0-based)

    # 1) Insertar (n_items-1) filas nuevas encima de la primera fila de datos
    insert_req = {
        "insertDimension": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": first_data_row_0,
                "endIndex": first_data_row_0 + (n_items - 1),
            },
            "inheritFromBefore": True,
        }
    }

    # 2) Copiar la fila-plantilla (que tras la inserción queda desplazada a + (n_items-1))
    template_row_0 = first_data_row_0 + (n_items - 1)

    copy_reqs = []
    for i in range(n_items):
        dest_row_0 = first_data_row_0 + i
        copy_reqs.append(
            {
                "copyPaste": {
                    "source": {
                        "sheetId": sheet_id,
                        "startRowIndex": template_row_0,
                        "endRowIndex": template_row_0 + 1,
                    },
                    "destination": {
                        "sheetId": sheet_id,
                        "startRowIndex": dest_row_0,
                        "endRowIndex": dest_row_0 + 1,
                    },
                    "pasteType": paste_type,  # PASTE_NORMAL para copiar fórmulas/estilo
                }
            }
        )

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=ssid,
        body={"requests": [insert_req] + copy_reqs},
    ).execute()


def _batch_write_values(sheets, ssid: str, writes: List[Dict[str, Any]]):
    """
    writes: [{"range":"Hoja!A5:A10", "values":[[...],[...], ...]}, ...]
    """
    if not writes:
        return
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=ssid,
        body={
            "valueInputOption": "USER_ENTERED",
            "data": writes,
        },
    ).execute()


def copy_template(template_key: str, title: str, folder_id: str, drive):
    if template_key not in TEMPLATES:
        raise RuntimeError(f"Plantilla desconocida: {template_key}")
    copied = drive.files().copy(
        fileId=TEMPLATES[template_key],
        body={"name": title, "parents": [folder_id]},
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return copied["id"]

# ============ MAIN ============

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
        n = len(items)

        # ========= Tablas a crecer (MARÍTIMO) =========
        # Valores pasados son FILAS DE ENCABEZADO (1-based).
        # La primera fila de datos es "encabezado + 1".
        maritime_tables = [
            ("b. LIQ.F", 108),   # Crece toda la hoja (afecta A108, I108 y Q108 a la vez)
            ("a.LIQ", 61),
            ("a.1 LIQ PD", 62),
            ("3. LCL D", 1),
            ("1.CÁL", 10),      # primero la de abajo...
            ("1.CÁL", 2),       # ...luego la de arriba para no desfasar índices
        ]
        for sheet_title, header_row in maritime_tables:
            _grow_table(sheets, ssid, sheet_title, header_row, n)

        # ========= Preparar datos de 1.CÁL (tabla 1) =========
        # ¡OJO! La tabla 1 de 1.CÁL tiene encabezado en A2; primera fila de datos: A3.
        start_row_1cal = 3  # 1-based
        end_row_1cal = start_row_1cal + max(n, 1) - 1

        links_A = []
        fotos_E = []
        enlaces_F = []
        descrip_G = []
        nombre_H = []
        um_I = []
        cxj_J = []
        cajas_K = []
        total_L = []
        hs_U = []

        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"
            b64 = it.get("b64") or it.get("_b64")
            url = _upload_b64_to_drive(b64, name, folder_id, drive) if b64 else it.get("url", "")

            hs = str(it.get("hs_code") or it.get("hsCode") or "")
            com = it.get("commercial_name") or it.get("commercialName") or ""
            link_cotizador = it.get("linkCotizador") or f"https://www.amazon.com/s?k={com.replace(' ', '+')}"
            img_formula = f'=IMAGE("{url}")' if url else ""

            links_A.append([link_cotizador])
            fotos_E.append([img_formula])
            enlaces_F.append([url])
            descrip_G.append([""])             # descripción vacía (según requerimiento)
            nombre_H.append([com])
            um_I.append(["PZA"])
            cxj_J.append([1])
            cajas_K.append([1])
            total_L.append([1])
            hs_U.append([hs])

        writes = []
        if n > 0:
            writes.extend([
                {"range": f"1.CÁL!A{start_row_1cal}:A{end_row_1cal}", "values": links_A},
                {"range": f"1.CÁL!E{start_row_1cal}:E{end_row_1cal}", "values": fotos_E},
                {"range": f"1.CÁL!F{start_row_1cal}:F{end_row_1cal}", "values": enlaces_F},
                {"range": f"1.CÁL!G{start_row_1cal}:G{end_row_1cal}", "values": descrip_G},
                {"range": f"1.CÁL!H{start_row_1cal}:H{end_row_1cal}", "values": nombre_H},
                {"range": f"1.CÁL!I{start_row_1cal}:I{end_row_1cal}", "values": um_I},
                {"range": f"1.CÁL!J{start_row_1cal}:J{end_row_1cal}", "values": cxj_J},
                {"range": f"1.CÁL!K{start_row_1cal}:K{end_row_1cal}", "values": cajas_K},
                {"range": f"1.CÁL!L{start_row_1cal}:L{end_row_1cal}", "values": total_L},
                {"range": f"1.CÁL!U{start_row_1cal}:U{end_row_1cal}", "values": hs_U},
            ])
        _batch_write_values(sheets, ssid, writes)

        print(json.dumps({
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "driveFolder": f"https://drive.google.com/drive/folders/{folder_id}",
            "rows": n,
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps(
            {"success": False, "error": f"{e}\n{traceback.format_exc()}"},
            ensure_ascii=False
        ))
        sys.exit(1)


if __name__ == "__main__":
    main()
