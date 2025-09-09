import gspread
import sys
import json
from datetime import datetime

def create_liquidacion_sheet(image_data, doc_title, folder_id, credentials_path="credentials.json"):
    """
    Crea un Google Sheet con columnas adicionales para liquidación:
    - URL
    - Vista (=IMAGE)
    - Partida_Arancelaria
    - Nombre_Comercial
    - Confianza
    - Justificación
    """
    print(f"[SHEET] Creando hoja de liquidación: {doc_title}")
    
    # Autenticación con gspread
    gc = gspread.service_account(filename=credentials_path)
    
    # Crear spreadsheet en la carpeta específica
    sh = gc.create(doc_title, folder_id=folder_id)
    ws = sh.sheet1
    ws.update_title("Liquidación")
    
    # Encabezados
    headers = ["URL", "Vista", "Partida_Arancelaria", "Nombre_Comercial", "Confianza", "Justificación"]
    ws.update("A1:F1", [headers])
    
    # Datos
    rows = []
    for item in image_data:
        row = [
            item['url'],
            f'=IMAGE("{item["url"]}")',
            item.get('hs_code', ''),
            item.get('commercial_name', ''),
            item.get('confidence', 0),
            item.get('reason', '')
        ]
        rows.append(row)
    
    if rows:
        range_name = f"A2:F{len(rows) + 1}"
        ws.update(range_name, rows, value_input_option="USER_ENTERED")
    
    sheet_url = f"https://docs.google.com/spreadsheets/d/{sh.id}"
    print(f"[SHEET] Creado: {sheet_url}")
    return sheet_url

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Uso: python crear_sheet_liquidacion.py <image_data_json> <doc_title> <folder_id>")
        sys.exit(1)
    
    image_data = json.loads(sys.argv[1])
    doc_title = sys.argv[2]
    folder_id = sys.argv[3]
    
    sheet_url = create_liquidacion_sheet(image_data, doc_title, folder_id)
    print(sheet_url)
