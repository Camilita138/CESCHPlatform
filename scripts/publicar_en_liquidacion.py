import json, tempfile, subprocess

def publicar_en_liquidacion(rows, folder_id, tipo="maritimo"):
    """
    Publica los ítems detectados en Google Sheets usando commit_liquidacion.py.
    No modifica tu flujo ni tu formato actual, solo construye el payload esperado.
    """

    items = []
    for i, row in enumerate(rows, 1):
        items.append({
            "name": f"image_{i:03d}.png",
            "b64": row.get("b64") or None,
            "commercial_name": row.get("nombre_comercial") or "",
            "hs_code": row.get("partida") or "",
            "linkCotizador": f"https://www.amazon.com/s?k={row.get('nombre_comercial','').replace(' ', '+')}",
            "description": row.get("descripcion") or "",
            "unit": row.get("unidad_de_medida") or "",
            "qty_per_box": row.get("cantidad_x_caja") or "",
            "boxes": row.get("cajas") or "",
            "total_units": row.get("total_unidades") or "",
            "model": row.get("modelo") or ""
        })

    payload = {
        "folderId": folder_id,
        "documentName": "Liquidación automática generada",
        "items": items
    }

    # Crear archivo temporal JSON y ejecutar tu script commit_liquidacion.py
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8") as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.flush()
        print(f"➡️ Enviando {len(items)} ítems a Sheets...")
        subprocess.run(["python", "commit_liquidacion.py", tmp.name, tipo], check=True)
