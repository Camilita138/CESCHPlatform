from autenticacion import get_service

drive = get_service("drive")
FOLDER_ID = "1g9ucVqwqgyuZRQE_eq3lOLIuTi-yLHv4"

try:
    file = drive.files().get(fileId=FOLDER_ID, fields="id, name, mimeType, parents").execute()
    print("✅ La carpeta es visible para la API:")
    print(file)
except Exception as e:
    print("❌ No se puede acceder a la carpeta:")
    print(e)
