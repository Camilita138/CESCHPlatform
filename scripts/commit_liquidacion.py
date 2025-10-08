# scripts/commit_liquidacion.py
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
# AUXILIARES DRIVE
# ==================================================
def _upload_b64_to_drive(b64: str, name: str, folder_id: str, drive):
    """Sube imagen a Drive y devuelve URL directa usable por =IMAGE()."""
    data = base64.b64decode(b64)
    mime = mimetypes.guess_type(name)[0] or "image/png"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    tmp.write(data)
    tmp.flush()
    tmp.close()

    fid = None
    try:
        media = MediaFileUpload(tmp.name, mimetype=mime, resumable=False)
        created = drive.files().create(
            body={"name": name, "parents": [folder_id]},
            media_body=media,
            fields="id",
            supportsAllDrives=True
        ).execute()
        fid = created["id"]

        # Permiso público
        drive.permissions().create(
            fileId=fid,
            body={"type": "anyone", "role": "reader"},
            supportsAllDrives=True
        ).execute()
    finally:
        # Intentar eliminar el archivo temporal (Windows puede bloquearlo)
        for _ in range(10):
            try:
                if os.path.exists(tmp.name):
                    os.remove(tmp.name)
                break
            except PermissionError:
                time.sleep(0.5)
            except Exception:
                break

    return f"https://lh3.googleusercontent.com/d/{fid}=s0"


# ==================================================
# AUXILIARES SHEETS
# ==================================================
def _sheet_id_by_title(sheets, ssid, titles):
    meta = sheets.spreadsheets().get(spreadsheetId=ssid).execute()
    titles = [titles] if isinstance(titles, str) else list(titles)
    want = {t.strip() for t in titles}
    for s in meta["sheets"]:
        if s["properties"]["title"].strip() in want:
            return s["properties"]["sheetId"]
    raise RuntimeError(f"No se encontró hoja: {titles}")


def _get_colA(sheets, ssid, sheet, start, end=200):
    rng = f"{sheet}!A{start}:A{end}"
    vals = sheets.spreadsheets().values().get(
        spreadsheetId=ssid, range=rng
    ).execute().get("values", [])
    # normaliza a strings
    return [ (row[0] if row else "").strip() for row in vals ]


def _find_row_containing_colA(sheets, ssid, sheet, text, start=1, end=200):
    """Primera fila (1-based) donde la col A contiene 'text', desde 'start'."""
    vals = _get_colA(sheets, ssid, sheet, start, end)
    text = str(text).lower()
    for idx, v in enumerate(vals, start):
        if text in v.lower():
            return idx
    return None


def _clone_exact_rows(sheets, ssid, sheet_title, start_row_1b, n_items, existing_rows=1):
    """
    Inserta filas para que el bloque tenga n_items, clonando formato y fórmulas exactas
    desde la fila base (start_row_1b). Dinámico y sin romper referencias.
    """
    if n_items <= existing_rows:
        return

    sheet_id = _sheet_id_by_title(sheets, ssid, sheet_title)
    to_add = n_items - existing_rows
    insert_start = start_row_1b - 1 + existing_rows
    insert_end = insert_start + to_add

    # Paso 1: Insertar nuevas filas
    requests = [{
        "insertDimension": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": insert_start,
                "endIndex": insert_end
            },
            "inheritFromBefore": False
        }
    }]

    # Paso 2: Copiar formato y fórmulas de la fila base
    for i in range(to_add):
        dst_row = start_row_1b + existing_rows + i
        requests += [
            {
                "copyPaste": {
                    "source": {
                        "sheetId": sheet_id,
                        "startRowIndex": start_row_1b - 1,
                        "endRowIndex": start_row_1b,
                    },
                    "destination": {
                        "sheetId": sheet_id,
                        "startRowIndex": dst_row - 1,
                        "endRowIndex": dst_row,
                    },
                    "pasteType": "PASTE_FORMULA"
                }
            },
            {
                "copyPaste": {
                    "source": {
                        "sheetId": sheet_id,
                        "startRowIndex": start_row_1b - 1,
                        "endRowIndex": start_row_1b,
                    },
                    "destination": {
                        "sheetId": sheet_id,
                        "startRowIndex": dst_row - 1,
                        "endRowIndex": dst_row,
                    },
                    "pasteType": "PASTE_FORMAT"
                }
            }
        ]

    # Ejecutar en un solo batch
    sheets.spreadsheets().batchUpdate(spreadsheetId=ssid, body={"requests": requests}).execute()

    # Copiar fórmulas/valores exactos de la fila base a cada fila nueva
    base_range = f"{sheet_title}!A{start_row_1b}:ZZ{start_row_1b}"
    base_vals = sheets.spreadsheets().values().get(
        spreadsheetId=ssid, range=base_range, valueRenderOption="FORMULA"
    ).execute().get("values", [[]])[0]

    writes = []
    for i in range(existing_rows, n_items):
        r = start_row_1b + i
        writes.append({"range": f"{sheet_title}!A{r}:ZZ{r}", "values": [base_vals]})

    if writes:
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=ssid,
            body={"valueInputOption": "USER_ENTERED", "data": writes}
        ).execute()


# --------- CONTADORES DINÁMICOS (CON “CONTADOR”) ---------
def _count_products_block_1cal(sheets, ssid):
    """
    Tabla superior 1.CÁL:
      - Comienza en fila 3 (primera fila de datos)
      - Termina justo antes del siguiente encabezado "MODELO" (del bloque inferior).
    Devuelve (existing_rows, next_header_row).
    """
    start = 3
    # Busca el siguiente "MODELO" a partir de la 8 para evitar el del header superior.
    next_header = _find_row_containing_colA(sheets, ssid, "1.CÁL", "MODELO", start=8, end=300)
    if not next_header:
        # fallback largo por si cambia la plantilla: cuenta hasta un blank-run
        colA = _get_colA(sheets, ssid, "1.CÁL", start, 300)
        count = 0
        for v in colA:
            if v.lower() in ("modelo", "subtotal", "total") or v == "":
                break
            count += 1
        return max(count, 1), start + count
    # existing = filas entre 3 y (next_header-1)
    existing = max(next_header - start - 0, 1)  # -0 para dejar claro que es inclusivo arriba, exclusivo abajo
    return existing, next_header


def _count_lower_block_1cal(sheets, ssid, header_row):
    """
    Bloque inferior 1.CÁL (debajo del encabezado MODELO que viene a mitad de la hoja):
      - Empieza en header_row+1
      - Termina en fila con "Subtotal" (en col A)
    Devuelve existing_rows.
    """
    start = header_row + 1
    subtotal_row = _find_row_containing_colA(sheets, ssid, "1.CÁL", "Subtotal", start=start, end=300)
    if not subtotal_row:
        # fallback: cuenta 3 filas como en plantilla base
        return 3
    existing = max(subtotal_row - start, 1)
    return existing


def _detect_a1_liq_pd_data_start(sheets, ssid):
    """
    Hoja a.1 LIQ PD:
      - Encuentra "LISTA DE PRODUCTOS"
      - La fila de títulos de columnas es la siguiente, y la fila de datos empieza 1 fila después.
    Devuelve data_start_row (1-based).
    """
    hdr = _find_row_containing_colA(sheets, ssid, "a.1 LIQ PD", "LISTA DE PRODUCTOS", start=1, end=300)
    if not hdr:
        # fallback al valor histórico
        return 63
    return hdr + 2  # (hdr) título grande, (hdr+1) encabezados de columnas, datos en (hdr+2)


def _count_until_total_a1pd(sheets, ssid, data_start):
    """
    Cuenta filas de la lista de productos en a.1 LIQ PD hasta encontrar "Total" en la columna D (descripción).
    """
    rng = f"a.1 LIQ PD!D{data_start}:D300"
    colD = sheets.spreadsheets().values().get(
        spreadsheetId=ssid, range=rng
    ).execute().get("values", [])
    count = 0
    for row in colD:
        v = (row[0] if row else "").strip().lower()
        if v == "total":
            break
        count += 1
    return max(count, 1)


# ==================================================
# ESCRITURA EN BLOQUE
# ==================================================
def _batch_write_values(sheets, ssid, writes):
    if writes:
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

        # ========== 1) CONTADORES DINÁMICOS (contador) ==========
        # 1.CÁL (arriba)
        existing_top, next_header_row = _count_products_block_1cal(sheets, ssid)
        # 1.CÁL (bloque inferior)
        existing_lower = _count_lower_block_1cal(sheets, ssid, next_header_row)
        # a.1 LIQ PD
        a1pd_start = _detect_a1_liq_pd_data_start(sheets, ssid)
        existing_a1pd = _count_until_total_a1pd(sheets, ssid, a1pd_start)

        # ========== 2) INSERCIÓN (clonado exacto) ==========
        # 1.CÁL superior (datos visibles)
        _clone_exact_rows(sheets, ssid, "1.CÁL", 3, n, existing_top)

        # 1.CÁL bloque inferior (entre MODELO y Subtotal) → clonar desde la primera fila de datos del bloque
        _clone_exact_rows(sheets, ssid, "1.CÁL", next_header_row + 1, n, existing_lower)

        # a.1 LIQ PD (lista de productos)
        _clone_exact_rows(sheets, ssid, "a.1 LIQ PD", a1pd_start, n, existing_a1pd)

        # a.LIQ (siempre 3 iniciales en plantilla; si tu plantilla ya trae 3, esto escala a n)
        _clone_exact_rows(sheets, ssid, "a.LIQ", 62, n, 3)

        # Hojas opcionales
        for hoja, start in ((["3. LCL D", "3.LCL D"], 2), (["b.LIQ.F", "b. LIQ.F"], 109)):
            try:
                _clone_exact_rows(sheets, ssid, hoja, start, n, 3)
            except Exception:
                pass  # si no existe, seguir

        # ========== 3) ESCRITURA VISIBLE EN 1.CÁL ==========
        start_row, end_row = 3, 3 + n - 1
        links_A, fotos_E, enlaces_F, descrip_G, nombre_H = [], [], [], [], []
        um_I, cxj_J, cajas_K, total_L, hs_U = [], [], [], [], []

        for i, it in enumerate(items, 1):
            name = it.get("name") or f"image_{i:03d}.png"
            b64 = it.get("b64") or it.get("_b64")
            url = _upload_b64_to_drive(b64, name, folder_id, drive) if b64 else it.get("url", "")
            com = it.get("commercial_name") or it.get("commercialName") or ""
            hs  = str(it.get("hs_code") or it.get("hsCode") or "")
            lc  = it.get("linkCotizador") or f"https://www.amazon.com/s?k={com.replace(' ', '+')}"
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
