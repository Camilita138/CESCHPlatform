import os
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2 import service_account

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

# Rutas locales (solo si estás en desarrollo)
CREDENTIALS_PATH = os.path.join(os.getcwd(), "scripts", "credentials.json")
TOKEN_PATH = os.path.join(os.getcwd(), "scripts", "token.json")

def authenticate() -> Credentials:
    """
    Devuelve credenciales válidas para Google APIs.
    En Render usa GOOGLE_CREDENTIALS (JSON en variable de entorno).
    En local usa credentials.json + token.json.
    """
    # 1️⃣ Si estamos en Render (GOOGLE_CREDENTIALS existe)
    creds_env = os.getenv("GOOGLE_CREDENTIALS")
    if creds_env:
        print("✅ Autenticando con GOOGLE_CREDENTIALS desde entorno (modo Render)...")
        creds_dict = json.loads(creds_env)

        # Si es un JSON de tipo 'installed' (OAuth2 de cliente)
        if "installed" in creds_dict:
            flow = InstalledAppFlow.from_client_config(creds_dict, SCOPES)
            creds = flow.run_console()
            return creds

        # Si es un service account (ideal para Render)
        if "type" in creds_dict and creds_dict["type"] == "service_account":
            creds = service_account.Credentials.from_service_account_info(
                creds_dict, scopes=SCOPES
            )
            return creds

        raise ValueError("Formato de GOOGLE_CREDENTIALS inválido")

    # 2️⃣ Si estamos en local (modo desarrollo)
    creds = None
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        except Exception:
            creds = None

    # Refrescar token si expiró
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            print("⚠️ Token expirado, se requerirá nueva autenticación...")
            try:
                os.remove(TOKEN_PATH)
            except Exception:
                pass
            creds = None

    # Si no hay token válido, iniciar flujo de login local
    if not creds or not creds.valid:
        if not os.path.exists(CREDENTIALS_PATH):
            raise FileNotFoundError("❌ No se encontró credentials.json en local.")
        flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w", encoding="utf-8") as f:
            f.write(creds.to_json())

    print("✅ Autenticación exitosa (modo local).")
    return creds


def get_service(api: str):
    """
    Devuelve un cliente autenticado para la API solicitada.
    """
    creds = authenticate()
    if api == "drive":
        return build("drive", "v3", credentials=creds)
    if api == "sheets":
        return build("sheets", "v4", credentials=creds)
    raise ValueError(f"API no soportada: {api}")
