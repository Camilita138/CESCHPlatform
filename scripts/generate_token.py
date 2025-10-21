from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

flow = InstalledAppFlow.from_client_secrets_file("scripts/credentials.json", SCOPES)
creds = flow.run_local_server(port=0)

with open("scripts/token.json", "w", encoding="utf-8") as token:
    token.write(creds.to_json())

print("\n✅ Token generado correctamente y guardado en scripts/token.json")
