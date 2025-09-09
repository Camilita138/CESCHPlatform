from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from autenticacion import authenticate
import os, time, mimetypes, re

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
MAX_RETRIES = 3

def _is_valid_image(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in IMAGE_EXTENSIONS

def _natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]

def _build_links(file_id: str) -> dict:
    # link robusto para <img>
    preview = f"https://lh3.googleusercontent.com/d/{file_id}=s1200"
    # otros útiles
    view = f"https://drive.google.com/file/d/{file_id}/view?usp=drivesdk"
    download = f"https://drive.google.com/uc?export=download&id={file_id}"
    return {"preview": preview, "view": view, "download": download}

def upload_images_to_drive(output_folder: str, folder_id: str):
    """
    Sube imágenes a *folder_id* (el que llega desde la UI) y devuelve
    (urls_para_mostrar, nombres, ids). Las URLs son de lh3.googleusercontent.com
    para que carguen perfectas en <img>.
    """
    print(f"[upload] Carpeta local: {output_folder}")
    print(f"[upload] Carpeta Drive destino: {folder_id}")

    creds = authenticate()
    drive = build("drive", "v3", credentials=creds)

    files = [f for f in os.listdir(output_folder) if _is_valid_image(f)]
    files.sort(key=_natural_key)

    image_urls, image_names, image_ids = [], [], []

    for filename in files:
        path = os.path.join(output_folder, filename)
        if not os.path.isfile(path):
            continue

        retries = 0
        while retries < MAX_RETRIES:
            try:
                mime, _ = mimetypes.guess_type(path)
                if not mime:
                    ext = os.path.splitext(filename)[1].lstrip(".").lower()
                    mime = f"image/{'jpeg' if ext == 'jpg' else ext}"

                media = MediaFileUpload(path, mimetype=mime, resumable=True)
                created = drive.files().create(
                    body={"name": filename, "parents": [folder_id]},
                    media_body=media,
                    fields="id,name",
                    supportsAllDrives=True,
                ).execute()

                file_id = created["id"]

                # Público (cualquiera con el enlace, solo lectura)
                drive.permissions().create(
                    fileId=file_id,
                    body={"type": "anyone", "role": "reader"},
                    supportsAllDrives=True,
                ).execute()

                links = _build_links(file_id)
                image_names.append(filename)
                image_urls.append(links["preview"])  # <- para <img>
                image_ids.append(file_id)

                print(f"[upload] {filename} -> {links['preview']}")
                break
            except Exception as e:
                retries += 1
                print(f"[upload] Error {filename}: {e}")
                if retries < MAX_RETRIES:
                    time.sleep(2)
                else:
                    print(f"[upload] Falló definitivamente: {filename}")

    print(f"[upload] Subidas: {len(image_urls)}")
    return image_urls, image_names, image_ids
