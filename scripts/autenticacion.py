# /scripts/autenticacion.py
import os
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError

# ==========================================================
# 🔐 SCOPES NECESARIOS (Drive + Sheets + acceso total)
# ==========================================================
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]

# ==========================================================
# 🔧 AUTENTICACIÓN GENERAL
# ==========================================================
def authenticate() -> Credentials:
    """
    Devuelve credenciales válidas para Google APIs.
    🔹 En Render: usa GOOGLE_CREDENTIALS (contenido del token.json).
    🔹 En local: usa credentials.json + token.json.
    """
    creds_env = os.getenv("GOOGLE_CREDENTIALS")
    creds = None

    # === 🌐 MODO RENDER ===
    if creds_env:
        print("✅ Autenticando con GOOGLE_CREDENTIALS (modo Render)...")
        creds_dict = json.loads(creds_env)

        # Puede venir directamente de token.json o credenciales serializadas
        if "token" in creds_dict or "refresh_token" in creds_dict:
            creds = Credentials.from_authorized_user_info(creds_dict, scopes=SCOPES)

            # Refrescar token si es necesario
            if creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    print("🔄 Token refrescado correctamente.")
                except RefreshError:
                    raise RuntimeError("⚠️ Token expirado. Genera un nuevo token.json y súbelo a Render.")
            print("🔐 Autenticado correctamente en modo Render.")
            return creds

        raise ValueError("❌ GOOGLE_CREDENTIALS no contiene un token OAuth válido (usa el contenido de token.json).")

    # === 🖥️ MODO LOCAL ===
    credentials_path = os.path.join(os.getcwd(), "scripts", "credentials.json")
    token_path = os.path.join(os.getcwd(), "scripts", "token.json")

    # Cargar token.json local si existe
    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception:
            creds = None

    # Refrescar token si expiró
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            print("⚠️ Token expirado, se eliminará y se requerirá nueva autenticación...")
            try:
                os.remove(token_path)
            except Exception:
                pass
            creds = None

    # Si no hay token válido, ejecutar flujo OAuth
    if not creds or not creds.valid:
        if not os.path.exists(credentials_path):
            raise FileNotFoundError("❌ No se encontró credentials.json en local.")
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())

    print("✅ Autenticación exitosa (modo local).")
    return creds


# ==========================================================
# 🧩 CONSTRUCTOR DE SERVICIOS
# ==========================================================
def get_service(api: str):
    """
    Devuelve un cliente autenticado para la API solicitada (drive o sheets).
    Usa el mismo token válido para todas las operaciones.
    """
    creds = authenticate()
    if api == "drive":
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        # Añadir atributos útiles para operaciones con Shared Drives
        service._supportsAllDrives = True
        return service
    elif api == "sheets":
        return build("sheets", "v4", credentials=creds, cache_discovery=False)
    else:
        raise ValueError(f"❌ API no soportada: {api}")
