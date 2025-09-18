import sys, os, json, base64, tempfile
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from autenticacion import get_service

def save_b64_to_png(b64: str, path: str):
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))

def upload_file(drive, path: str, name: str, parent_id: str) -> str:
    media = MediaFileUpload(path, mimetype="image/png", resumable=True)
    file = drive.files().create(
        body={"name": name, "parents": [parent_id]},
        media_body=media,
        fields="id",
        supportsAllDrives=True
    ).execute(num_retries=3)
    fid = file["id"]
    drive.permissions().create(
        fileId=fid, body={"type": "anyone", "role": "reader"}, supportsAllDrives=True
    ).execute()
    return f"https://drive.google.com/uc?export=view&id={fid}"

def create_sheet(sheets, title: str) -> str:
    spreadsheet = sheets.spreadsheets().create(body={"properties": {"title": title}}).execute()
    return spreadsheet["spreadsheetId"]

def move_to_folder(drive, file_id: str, folder_id: str):
    drive.files().update(fileId=file_id, addParents=folder_id, removeParents="root", supportsAllDrives=True).execute()

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "usage: commit_liquidacion.py <payload_json>"})); return
    payload_path = sys.argv[1]
    with open(payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    doc_name = payload["documentName"]
    folder_id = payload["folderId"]
    items = payload["items"]  # [{name,b64,hsCode,commercialName,confidence,reason}]

    try:
        drive = build("drive", "v3", credentials=get_service("drive"))
        sheets = get_service("sheets")

        urls = []
        with tempfile.TemporaryDirectory() as tmp:
            for it in items:
                name = it.get("name") or "image.png"
                p = os.path.join(tmp, name)
                save_b64_to_png(it["b64"], p)
                url = upload_file(drive, p, name, folder_id)
                urls.append(url)

        ssid = create_sheet(sheets, f"Liquidación - {doc_name}")
        try:
            move_to_folder(drive, ssid, folder_id)
        except Exception as e:
            print(f"[sheet] move warn: {e}")

        rows = [["URL","Vista","Partida_Arancelaria","Nombre_Comercial","Confianza","Justificación"]]
        for it, url in zip(items, urls):
            rows.append([url, f'=IMAGE("{url}")', it.get("hsCode",""), it.get("commercialName",""),
                         it.get("confidence", 0), it.get("reason","")])
        sheets.spreadsheets().values().update(
            spreadsheetId=ssid, range="A1", valueInputOption="USER_ENTERED", body={"values": rows}
        ).execute()

        print(json.dumps({
            "success": True,
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{ssid}",
            "driveFolder": f"https://drive.google.com/drive/folders/{folder_id}",
            "total": len(items),
            "rows": len(rows)-1
        }))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
