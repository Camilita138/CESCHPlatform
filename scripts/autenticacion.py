import os
import json
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from google.oauth2.service_account import Credentials as ServiceAccountCreds

# Scopes requeridos para Drive y Sheets
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

def authenticate():
    """
    Devuelve credenciales válidas para Google APIs.
    - En Render: usa GOOGLE_CREDENTIALS (cuenta de servicio)
    - En local: usa credentials.json + token.json (OAuth normal)
    """
    creds_env = os.getenv("GOOGLE_CREDENTIALS")

    # === 🌐 MODO RENDER ===
    if creds_env:
        print("✅ Autenticando con GOOGLE_CREDENTIALS (modo Render)...")
        creds_dict = json.loads(creds_env)

        if creds_dict.get("type") == "service_account":
            creds = ServiceAccountCreds.from_service_account_info(creds_dict, scopes=SCOPES)
            print("🔐 Autenticado correctamente con cuenta de servicio.")
            return creds
        else:
            raise RuntimeError("❌ GOOGLE_CREDENTIALS no es una cuenta de servicio válida (usa el JSON de Google Cloud).")

    # === 🖥️ MODO LOCAL ===
    creds = None
    credentials_path = os.path.join(os.getcwd(), "scripts", "credentials.json")
    token_path = os.path.join(os.getcwd(), "scripts", "token.json")

    # Cargar token local si existe
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # Refrescar si expiró
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            print("⚠️ Token expirado. Elimina scripts/token.json y vuelve a autenticar.")
            creds = None

    # Si no hay token o no es válido, ejecutar flujo OAuth
    if not creds or not creds.valid:
        from google_auth_oauthlib.flow import InstalledAppFlow
        if not os.path.exists(credentials_path):
            raise FileNotFoundError("❌ No se encontró credentials.json en scripts/")
        flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())

    print("✅ Autenticación exitosa (modo local).")
    return creds


def get_service(api: str):
    creds = authenticate()
    if api == "drive":
        return build("drive", "v3", credentials=creds)
    elif api == "sheets":
        return build("sheets", "v4", credentials=creds)
    else:
        raise ValueError(f"❌ API no soportada: {api}")
