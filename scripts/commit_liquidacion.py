import sys, os, json, base64, mimetypes, traceback, tempfile, time
from autenticacion import get_service
from googleapiclient.http import MediaFileUpload

# ==================================================
# PLANTILLAS BASE
# ==================================================
TEMPLATES = {
    "aereo": "11G1xXCDwhnvzJS9yvB8q26fsozVvAvcpOm19vaAGONs",
    "maritimo": "1m2H_QSNOa6JIp7Pyq1aAwRATB6MSQ6LXD5YWiBOM4F0",
    "contenedor": "1SIJhWSJPZnNQ69FSIn-XEzqFqGrQ9sI5X-yf2mY8R3A",
}

# ==================================================
# AUXILIARES
# ==================================================
def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive):
    """Sube una imagen en base64 a Drive y devuelve la URL pública de vista directa."""
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    tmp.write(data)
    tmp.flush()
    tmp.close()

    media = MediaFileUpload(tmp.name, mimetype=mime, resumable=False)
    created = drive.files().create(
        body={"name": name, "parents": [folder_id]},
        media_body=media,
        fields="id",
        supportsAllDrives=True
    ).execute()

    fid = created["id"]

    # Dar permisos públicos
    drive.permissions().create(
        fileId=fid,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True
    ).execute()

    # Intentar borrar archivo temporal
    for _ in range(6):
        try:
            os.remove(tmp.name)
            break
        except PermissionError:
            time.sleep(0.3)
        except Exception:
            break

    return f"https://lh3.googleusercontent.com/d/{fid}=s0"


def _sheet_id_by_title(sheets, ssid, titles):
    """Devuelve el ID de hoja a partir del nombre o lista de posibles nombres."""
    meta = sheets.spreadsheets().get(spreadsheetId=ssid).execute()
    titles = [titles] if isinstance(titles, str) else list(titles)
    want = {t.strip() for t in titles}
    for s in meta["sheets"]:
        if s["properties"]["title"].strip() in want:
            return s["properties"]["sheetId"]
    raise RuntimeError(f"No se encontró hoja: {titles}")

# ==================================================
# INSERCIÓN DE FILAS
# ==================================================
def _insert_rows_with_format(sheets, ssid, sheet_title, start_row_1b, n_items, existing_rows=1, block_height=1):
    """Inserta filas copiando formato y fórmulas sin romper referencias."""
    if n_items <= existing_rows:
        return
    to_add = n_items - existing_rows
    sheet_id = _sheet_id_by_title(sheets, ssid, sheet_title)
    base_r0 = start_row_1b - 1
    insert_start = base_r0 + existing_rows * block_height
    insert_end = insert_start + to_add * block_height

    insert_req = {
        "insertDimension": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": insert_start,
                "endIndex": insert_end
            },
            "inheritFromBefore": True
        }
    }

    copy_reqs = []
    for i in range(existing_rows, n_items):
        dst_r0 = base_r0 + i * block_height
        dst_r1 = dst_r0 + block_height

        # Copiar formato
        copy_reqs.append({
            "copyPaste": {
                "source": {
                    "sheetId": sheet_id,
                    "startRowIndex": base_r0,
                    "endRowIndex": base_r0 + block_height
                },
                "destination": {
                    "sheetId": sheet_id,
                    "startRowIndex": dst_r0,
                    "endRowIndex": dst_r1
                },
                "pasteType": "PASTE_FORMAT"
            }
        })

        # Copiar fórmulas/valores
        copy_reqs.append({
            "copyPaste": {
                "source": {
                    "sheetId": sheet_id,
                    "startRowIndex": base_r0,
                    "endRowIndex": base_r0 + block_height
                },
                "destination": {
                    "sheetId": sheet_id,
                    "startRowIndex": dst_r0,
                    "endRowIndex": dst_r1
                },
                "pasteType": "PASTE_NORMAL"
            }
        })

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=ssid,
        body={"requests": [insert_req] + copy_reqs}
    ).execute()


def _insert_rows_clone_entire_row(sheets, ssid, sheet_title, start_row_1b, n_items, existing_rows=1):
    """Inserta filas clonando toda la fila completa (para tablas con merges o fórmulas sensibles)."""
    if n_items <= existing_rows:
        return
    to_add = n_items - existing_rows
    sheet_id = _sheet_id_by_title(sheets, ssid, sheet_title)
    base_r0 = start_row_1b - 1
    insert_start = base_r0 + existing_rows
    insert_end = insert_start + to_add

    insert_req = {
        "insertDimension": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": insert_start,
                "endIndex": insert_end
            },
            "inheritFromBefore": True
        }
    }

    copy_reqs = []
    for i in range(existing_rows, n_items):
        dst_r0 = base_r0 + i
        dst_r1 = dst_r0 + 1

        # Copiar formato
        copy_reqs.append({
            "copyPaste": {
                "source": {"sheetId": sheet_id, "startRowIndex": base_r0, "endRowIndex": base_r0 + 1},
                "destination": {"sheetId": sheet_id, "startRowIndex": dst_r0, "endRowIndex": dst_r1},
                "pasteType": "PASTE_FORMAT"
            }
        })

        # Copiar fórmulas y valores
        copy_reqs.append({
            "copyPaste": {
                "source": {"sheetId": sheet_id, "startRowIndex": base_r0, "endRowIndex": base_r0 + 1},
                "destination": {"sheetId": sheet_id, "startRowIndex": dst_r0, "endRowIndex": dst_r1},
                "pasteType": "PASTE_NORMAL"
            }
        })

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=ssid,
        body={"requests": [insert_req] + copy_reqs}
    ).execute()

# ==================================================
# ESCRITURA DE DATOS
# ==================================================
def _batch_write_values(sheets, ssid, writes):
    if not writes:
        return
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=ssid,
        body={"valueInputOption": "USER_ENTERED", "data": writes}
    ).execute()

# ==================================================
# MAIN
# ==================================================
def main():
    try:
        if len(sys.argv) != 3:
            raise RuntimeError("Uso: python commit_liquidacion.py <payload_json> <tipo_plantilla>")

        payload_path, tipo = sys.argv[1], sys.argv[2]
        with open(payload_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        folder_id = payload["folderId"]
        items = payload.get("items", [])
        n = len(items)
        doc_name = payload.get("documentName", "Liquidación")

        drive = get_service("drive")
        sheets = get_service("sheets")

        # Crear copia de la plantilla
        ssid = drive.files().copy(
            fileId=TEMPLATES[tipo],
            body={"name": f"{doc_name} ({tipo})", "parents": [folder_id]},
            fields="id",
            supportsAllDrives=True
        ).execute()["id"]

        # ========= INSERCIÓN DE FILAS =========
        existing = 3  # filas base ya en plantilla

        # Insertar de abajo hacia arriba
        _insert_rows_clone_entire_row(sheets, ssid, ["b.LIQ.F", "b. LIQ.F"], 109, n, existing)
        _insert_rows_with_format(sheets, ssid, ["3. LCL D", "3.LCL D"], 2, n, existing)
        _insert_rows_with_format(sheets, ssid, "a.1 LIQ PD", 63, n, existing)
        _insert_rows_with_format(sheets, ssid, "a.LIQ", 62, n, existing)

        # Subtabla inferior de 1.CÁL — ahora clonamos toda la fila completa para preservar fórmulas
        _insert_rows_clone_entire_row(sheets, ssid, "1.CÁL", 14, n, existing)

        # Tabla principal superior de 1.CÁL
        _insert_rows_with_format(sheets, ssid, "1.CÁL", 3, n, existing)

        # ========= Escritura de datos visibles =========
        start_row = 3
        end_row = start_row + n - 1
        links_A, fotos_E, enlaces_F, descrip_G, nombre_H = [], [], [], [], []
        um_I, cxj_J, cajas_K, total_L, hs_U = [], [], [], [], []

        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"
            b64 = it.get("b64") or it.get("_b64")
            url = _upload_b64_to_drive(b64, name, folder_id, drive) if b64 else it.get("url", "")
            com = it.get("commercial_name") or it.get("commercialName") or ""
            hs = str(it.get("hs_code") or it.get("hsCode") or "")
            lc = it.get("linkCotizador") or ""
            img_formula = f'=IMAGE("{url}")' if url else ""

            links_A.append([lc])
            fotos_E.append([img_formula])
            enlaces_F.append([url])
            descrip_G.append([""])
            nombre_H.append([com])
            um_I.append(["PZA"])
            cxj_J.append([1])
            cajas_K.append([1])
            total_L.append([1])
            hs_U.append([hs])

        writes = [
            {"range": f"1.CÁL!A{start_row}:A{end_row}", "values": links_A},
            {"range": f"1.CÁL!E{start_row}:E{end_row}", "values": fotos_E},
            {"range": f"1.CÁL!F{start_row}:F{end_row}", "values": enlaces_F},
            {"range": f"1.CÁL!G{start_row}:G{end_row}", "values": descrip_G},
            {"range": f"1.CÁL!H{start_row}:H{end_row}", "values": nombre_H},
            {"range": f"1.CÁL!I{start_row}:I{end_row}", "values": um_I},
            {"range": f"1.CÁL!J{start_row}:J{end_row}", "values": cxj_J},
            {"range": f"1.CÁL!K{start_row}:K{end_row}", "values": cajas_K},
            {"range": f"1.CÁL!L{start_row}:L{end_row}", "values": total_L},
            {"range": f"1.CÁL!U{start_row}:U{end_row}", "values": hs_U},
        ]
        _batch_write_values(sheets, ssid, writes)

        print(json.dumps({
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "rows": n
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": f"{e}\n{traceback.format_exc()}"
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
