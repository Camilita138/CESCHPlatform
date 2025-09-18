import os
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

CREDENTIALS_PATH = os.path.join(os.getcwd(), "credentials.json")
TOKEN_PATH       = os.path.join(os.getcwd(), "token.json")

def authenticate() -> Credentials:
    """
    Devuelve credenciales válidas. Si el refresh_token está revocado/expirado,
    elimina token.json y levanta nuevamente el flujo de autorización.
    """
    creds = None

    # 1) Cargar token si existe
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        except Exception:
            creds = None

    # 2) Intentar refrescar si está expirado
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            # refresh_token inválido → rehacer login
            try:
                os.remove(TOKEN_PATH)
            except Exception:
                pass
            creds = None

    # 3) Si no hay credenciales válidas, abrir login local
    if not creds or not creds.valid:
        if not os.path.exists(CREDENTIALS_PATH):
            raise FileNotFoundError(
                "No se encontró credentials.json. Descárgalo desde Google Cloud Console."
            )
        flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w", encoding="utf-8") as f:
            f.write(creds.to_json())

    print("Autenticación exitosa con Google API.")
    return creds

def get_service(api: str):
    creds = authenticate()
    if api == "drive":
        return build("drive", "v3", credentials=creds)
    if api == "sheets":
        return build("sheets", "v4", credentials=creds)
    raise ValueError(f"API no soportada: {api}")
