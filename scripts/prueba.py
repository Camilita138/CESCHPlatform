from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

creds = Credentials.from_authorized_user_file("token.json", ["https://www.googleapis.com/auth/drive"])
service = build("drive", "v3", credentials=creds)

about = service.about().get(fields="user(emailAddress)").execute()
print("Cuenta autenticada:", about["user"]["emailAddress"])
