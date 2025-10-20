import sys, os, json, base64, mimetypes, traceback, tempfile, time, subprocess
from concurrent.futures import ThreadPoolExecutor
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
    """Sube una imagen desde b64 a Drive y devuelve URL directa válida para =IMAGE()."""
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

    # Permiso público para que =IMAGE() funcione
    drive.permissions().create(
        fileId=fid,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True
    ).execute()

    # Intentar eliminar archivo temporal (Windows a veces bloquea)
    for _ in range(5):
        try:
            os.remove(tmp.name)
            break
        except PermissionError:
            time.sleep(0.25)
        except Exception:
            break

    return f"https://lh3.googleusercontent.com/d/{fid}=s0"


def _sheet_ids_cache(sheets, ssid):
    """Devuelve un dict {titulo: sheetId} con todos los títulos (trim)."""
    meta = sheets.spreadsheets().get(spreadsheetId=ssid).execute()
    return {s["properties"]["title"].strip(): s["properties"]["sheetId"] for s in meta["sheets"]}


def _resolve_sheet_id(sheet_ids, titles):
    """Acepta un título o lista de títulos; devuelve el primero que exista en el archivo."""
    if isinstance(titles, str):
        titles = [titles]
    for t in titles:
        key = t.strip()
        if key in sheet_ids:
            return sheet_ids[key]
    raise RuntimeError(f"No se encontró hoja con alguno de estos títulos: {titles}")


# ==================================================
# CONSTRUCCIÓN DE REQUESTS (una sola batchUpdate)
# ==================================================
def _clone_rows_requests(sheet_id, start_row_1b, end_row_1b, n, col_end=200):
    """Crea requests para copiar filas con formato."""
    if n <= 1:
        return []
    block_h = end_row_1b - start_row_1b + 1
    insert_start = end_row_1b
    insert_end = insert_start + (n - 1) * block_h

    reqs = [{
        "insertDimension": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": insert_start,
                "endIndex": insert_end
            },
            "inheritFromBefore": True
        }
    }]

    for i in range(1, n):
        offset = (i - 1) * block_h
        reqs.append({
            "copyPaste": {
                "source": {
                    "sheetId": sheet_id,
                    "startRowIndex": start_row_1b - 1,
                    "endRowIndex": end_row_1b,
                    "startColumnIndex": 0,
                    "endColumnIndex": col_end
                },
                "destination": {
                    "sheetId": sheet_id,
                    "startRowIndex": end_row_1b + offset,
                    "endRowIndex": end_row_1b + block_h + offset,
                    "startColumnIndex": 0,
                    "endColumnIndex": col_end
                },
                "pasteType": "PASTE_NORMAL"
            }
        })
    return reqs


def _batch_write_values(sheets, ssid, writes):
    if writes:
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=ssid,
            body={"valueInputOption": "USER_ENTERED", "data": writes}
        ).execute()


# ==================================================
# PUBLICADOR DIRECTO (puente)
# ==================================================
def publicar_en_liquidacion(rows, folder_id, tipo="maritimo"):
    """Genera el payload y ejecuta este mismo script internamente."""
    items = []
    for i, row in enumerate(rows, 1):
        items.append({
            "name": f"image_{i:03d}.png",
            "b64": row.get("b64") or None,
            "commercial_name": row.get("nombre_comercial") or "",
            "hs_code": row.get("partida") or "",
            "linkCotizador": f"https://www.amazon.com/s?k={row.get('nombre_comercial','').replace(' ', '+')}",
            "description": row.get("descripcion") or "",
            "unit": row.get("unidad_de_medida") or "",
            "qty_per_box": row.get("cantidad_x_caja") or "",
            "boxes": row.get("cajas") or "",
            "total_units": row.get("total_unidades") or "",
            "model": row.get("modelo") or ""
        })

    payload = {
        "folderId": folder_id,
        "documentName": "Liquidación automática generada",
        "items": items
    }

    with tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8") as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.flush()
        subprocess.run(["python", __file__, tmp.name, tipo], check=True)


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

        # Copiar plantilla base
        ssid = drive.files().copy(
            fileId=TEMPLATES[tipo],
            body={"name": f"{doc_name} ({tipo})", "parents": [folder_id]},
            fields="id",
            supportsAllDrives=True
        ).execute()["id"]

        # Cache IDs de hojas
        sheet_ids = _sheet_ids_cache(sheets, ssid)

        # === Inserciones dinámicas ===
        requests = []
        sid_cal = _resolve_sheet_id(sheet_ids, "1.CÁL")
        requests += _clone_rows_requests(sid_cal, 3, 3, n)

        fila_inicial_subtabla = 11
        fila_subtabla = fila_inicial_subtabla + (n - 1)
        requests += _clone_rows_requests(sid_cal, fila_subtabla, fila_subtabla, n)

        sid_aliq = _resolve_sheet_id(sheet_ids, "a.LIQ")
        sid_aliq_pd = _resolve_sheet_id(sheet_ids, "a.1 LIQ PD")
        requests += _clone_rows_requests(sid_aliq, 62, 62, n)
        requests += _clone_rows_requests(sid_aliq_pd, 63, 63, n)

        sid_bliqf = _resolve_sheet_id(sheet_ids, ["b.LIQ.F", "b. LIQ.F"])
        requests += _clone_rows_requests(sid_bliqf, 109, 109, n, col_end=500)

        sid_lcld = _resolve_sheet_id(sheet_ids, "3. LCL D")
        requests += _clone_rows_requests(sid_lcld, 2, 2, n)

        if requests:
            sheets.spreadsheets().batchUpdate(spreadsheetId=ssid, body={"requests": requests}).execute()

        # === Subida de imágenes en paralelo con conexiones separadas ===
        start_row = 3
        end_row = start_row + n - 1

        def build_row(idx_item):
            """Cada hilo crea su propia sesión segura con Google Drive"""
            from autenticacion import get_service
            local_drive = get_service("drive")
            i, it = idx_item
            name = it.get("name") or f"image_{i:03d}.png"
            b64 = it.get("b64") or it.get("_b64")
            if b64:
                url = _upload_b64_to_drive(b64, name, folder_id, local_drive)
            else:
                url = it.get("url", "")
            com = it.get("commercial_name") or it.get("commercialName") or ""
            hs = str(it.get("hs_code") or it.get("hsCode") or "")
            link_cotizador = it.get("linkCotizador") or f"https://www.amazon.com/s?k={com.replace(' ', '+')}"
            img_formula = f'=IMAGE("{url}")' if url else ""
            return (link_cotizador, img_formula, url, "", com, "PZA", 1, 1, 1, hs)

        # === Llenado de listas ===
        links_A, fotos_E, enlaces_F, descrip_G, nombre_H = [], [], [], [], []
        um_I, cxj_J, cajas_K, total_L, hs_U = [], [], [], [], []

        if n > 0:
            with ThreadPoolExecutor(max_workers=6) as pool:
                for (link, imgf, url, desc, com, um, cxj, cajas, total, hs) in pool.map(
                    build_row, [(i, it) for i, it in enumerate(items, 1)]
                ):
                    links_A.append([link])
                    fotos_E.append([imgf])
                    enlaces_F.append([url])
                    descrip_G.append([desc])
                    nombre_H.append([com])
                    um_I.append([um])
                    cxj_J.append([cxj])
                    cajas_K.append([cajas])
                    total_L.append([total])
                    hs_U.append([hs])

        # === Escritura final ===
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
