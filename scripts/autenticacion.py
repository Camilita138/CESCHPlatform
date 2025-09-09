# autenticacion.py
import os
import sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Permisos necesarios para Drive y Sheets
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

def resource_path(relative_path):
    """Obtiene la ruta absoluta, incluso dentro del .exe empaquetado."""
    base_path = getattr(sys, '_MEIPASS', os.path.abspath("."))
    return os.path.join(base_path, relative_path)

def authenticate():
    creds = None
    token_path = resource_path("token.json")
    credentials_path = resource_path("credentials.json")  # archivo de Google OAuth

    # Si ya existe un token de sesión previa, lo cargamos
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # Si no hay credenciales válidas, iniciar login
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                print(f"ERROR: No se encontró {credentials_path}")
                return None
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        # Guardar credenciales para próximas ejecuciones
        with open(token_path, "w") as token:
            token.write(creds.to_json())

    print("Autenticación exitosa con Google API.")
    return creds

def get_service(service_name: str):
    """Obtiene un servicio de Google API autenticado"""
    
    creds = authenticate()
    if not creds:
        raise Exception("No se pudo autenticar con Google API")
    
    if service_name == 'sheets':
        return build('sheets', 'v4', credentials=creds)
    elif service_name == 'drive':
        return build('drive', 'v3', credentials=creds)
    else:
        raise ValueError(f"Servicio no soportado: {service_name}")
