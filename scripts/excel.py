import gspread
from autenticacion import authenticate
from datetime import datetime
from googleapiclient.discovery import build   
import time
from googleapiclient.errors import HttpError


def update_sheet_with_links(image_urls, image_names, doc_title, folder_id):
    """
    Crea un Google Sheet NUEVO llamado `doc_title` DIRECTAMENTE dentro de la carpeta `folder_id`.
    Columna A = URL
    Columna B = =IMAGE(URL)
    Devuelve la URL del Sheet creado.
    """

    print("========== [INICIO] update_sheet_with_links ==========")
    print(f"[{datetime.now()}] Creando Spreadsheet '{doc_title}' en carpeta: {folder_id}")

    # 1) Credenciales y clientes
    creds = authenticate()
    drive = build('drive', 'v3', credentials=creds)
    client = gspread.authorize(creds)

    # 2) Crear el Spreadsheet directamente en la carpeta (Drive API + parents)
    #    Esto evita crear en 'Mi unidad' y luego mover.
    try:
        file_metadata = {
            'name': doc_title,
            'mimeType': 'application/vnd.google-apps.spreadsheet',
            'parents': [folder_id],  # <- clave para que se cree dentro de esa carpeta
        }
        created = drive.files().create(
            body=file_metadata,
            fields='id, webViewLink',
            supportsAllDrives=True  # importante para Carpetas de Unidad Compartida
        ).execute()
        spreadsheet_id = created['id']
        web_view_link = created['webViewLink']
        sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
        print(f"[OK] Spreadsheet creado en carpeta destino. ID={spreadsheet_id}")
        print(f"[URL] {sheet_url}")
    except HttpError as e:
        print("[ERROR] No se pudo crear el Spreadsheet en la carpeta indicada.")
        print(traceback.format_exc())
        # Mensajes típicos a revisar:
        # - 404 notFound: la carpeta no existe o no tienes acceso
        # - 403 insufficientFilePermissions: tu cuenta/bot no tiene permiso de editor en esa carpeta
        raise

    # 3) Abrir con gspread y escribir contenido
    try:
        sh = client.open_by_key(spreadsheet_id)
        ws = sh.sheet1
        ws.update_title("Imágenes")
        ws.update("A1:B1", [["URL", "Vista"]])
        print("[OK] Encabezados escritos (A1:B1).")
    except Exception:
        print("[ERROR] No se pudo abrir el Spreadsheet recién creado con gspread o preparar encabezados.")
        print(traceback.format_exc())
        raise

    # 4) Escribir filas: A=url, B==IMAGE(url)
    try:
        if image_urls:
            rows = [[u, f'=IMAGE("{u}")'] for u in image_urls if u]
            start_row = 2
            end_row = start_row + len(rows) - 1
            rango = f"A{start_row}:B{end_row}"
            print(f"[INFO] Escribiendo {len(rows)} filas en {rango} ...")
            ws.update(rango, rows, value_input_option="USER_ENTERED")
            print("[OK] Filas insertadas correctamente.")
        else:
            print("[ADVERTENCIA] No hay URLs para escribir (solo se dejaron encabezados).")
    except HttpError as e:
        print("[ERROR] HttpError durante la escritura de filas.")
        print(traceback.format_exc())
        raise
    except Exception:
        print("[ERROR] Excepción no controlada durante la escritura de filas.")
        print(traceback.format_exc())
        raise

    print("========== [FIN] update_sheet_with_links ==========")
    return sheet_url
