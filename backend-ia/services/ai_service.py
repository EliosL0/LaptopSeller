import google.generativeai as genai
import json

genai.configure(api_key="")
model_vision = genai.GenerativeModel('gemini-1.5-flash')

def analizar_imagen_laptop(image_data, mime_type):
    prompt = """
    Analiza esta imagen. Extrae: marca, procesador, ram_gb, precio_detectado_usd.
    Devuelve ESTRICTAMENTE JSON, sin markdown.
    {"marca": "string", "procesador": "string", "ram_gb": 8, "precio_detectado_usd": 150.0}
    """
    response = model_vision.generate_content([prompt, {"mime_type": mime_type, "data": image_data}])
    clean_json = response.text.replace('```json', '').replace('```', '').strip()
    return json.loads(clean_json)

# Agregar esto al final de services/ai_service.py

def redactar_publicacion_marketplace(marca: str, procesador: str, ram: int, almacenamiento: str, precio: float):
    prompt = f"""
    Actúa como un vendedor experto de tecnología en Facebook Marketplace en Nicaragua.
    Redacta una publicación atractiva y persuasiva para vender esta laptop:
    - Marca: {marca}
    - Procesador: {procesador}
    - RAM: {ram}GB
    - Almacenamiento: {almacenamiento}
    - Precio: ${precio} USD

    Incluye:
    1. Un título llamativo.
    2. Viñetas con las características.
    3. Llamado a la acción (ej. "Entregas en centros comerciales de Managua").
    4. Etiquetas (Hashtags) relevantes al final.
    No uses formato markdown (ni asteriscos ni negritas), solo texto plano con emojis.
    """
    
    # Usamos el mismo modelo rápido
    response = model_vision.generate_content(prompt)
    return response.text.strip()