from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from database import (
    ESTADO_TALLER,
    ESTADO_TRANSITO,
    db_cursor,
    registrar_bitacora,
    rows_to_dicts,
)
from services.ai_service import analizar_imagen_laptop

router = APIRouter(prefix="/compras", tags=["Compras"])

TIPO_INTERNACIONAL = "Internacional"
TIPO_LOCAL = "Local / Particular"


# --- ESQUEMAS ---
class CompraLaptopPayload(BaseModel):
    id_proveedor: int = Field(gt=0)
    tipo_compra: str = Field(default=TIPO_INTERNACIONAL, max_length=30)
    codigo_orden: Optional[str] = Field(default=None, max_length=100)
    numero_recibo_local: Optional[str] = Field(default=None, max_length=100)
    tracking_courier: Optional[str] = Field(default=None, max_length=100)
    costo_flete_total: float = Field(default=0, ge=0)
    costo_productos_total: float = Field(ge=0)
    # Especificaciones de la laptop
    marca: str = Field(min_length=1, max_length=100)
    procesador: str = Field(min_length=1, max_length=100)
    ram_gb: int = Field(gt=0)
    tipo_almacenamiento: str = Field(min_length=1, max_length=50)
    tamano_almacenamiento: Optional[int] = Field(default=None, ge=0)
    pantalla: Optional[str] = Field(default=None, max_length=100)
    numero_serie: Optional[str] = Field(default=None, max_length=100)
    # Registro escrito
    origen_datos: str = "Manual"  # 'IA' o 'Manual'
    notas: Optional[str] = None


class ItemCompraRepuesto(BaseModel):
    id_repuesto: Optional[int] = None  # Si es None se crea la pieza en el inventario
    nombre_pieza: Optional[str] = Field(default=None, max_length=150)
    categoria: Optional[str] = Field(default=None, max_length=50)
    cantidad: int = Field(gt=0)
    costo_unitario: float = Field(ge=0)


class CompraRepuestosPayload(BaseModel):
    id_proveedor: int = Field(gt=0)
    tipo_compra: str = Field(default=TIPO_LOCAL, max_length=30)
    codigo_orden: Optional[str] = Field(default=None, max_length=100)
    numero_recibo_local: Optional[str] = Field(default=None, max_length=100)
    tracking_courier: Optional[str] = Field(default=None, max_length=100)
    costo_flete_total: float = Field(default=0, ge=0)
    items: List[ItemCompraRepuesto] = Field(min_length=1)
    notas: Optional[str] = None


def _limpiar(valor: Optional[str]) -> Optional[str]:
    if valor is None:
        return None
    valor = valor.strip()
    return valor or None


def _validar_proveedor(cursor, id_proveedor: int) -> str:
    cursor.execute("SELECT nombre FROM PROVEEDOR WHERE id_proveedor = ?", (id_proveedor,))
    row = cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"El proveedor #{id_proveedor} no existe. Regístralo primero.")
    return row[0]


# --- ENDPOINT 1: EVALUAR IMAGEN CON IA ---
@router.post("/evaluar-imagen")
async def evaluar_imagen(file: UploadFile = File(...)):
    try:
        image_data = await file.read()
        datos_ia = analizar_imagen_laptop(image_data, file.content_type)
        # Flete aéreo Miami -> Managua aprox. $8/lb y una laptop pesa ~4 lb
        flete_estimado = 32.0
        return {
            "status": "success",
            "datos_extraidos": datos_ia,
            "estimaciones": {
                "flete_sugerido_usd": flete_estimado,
                "nota": "Revisa los datos extraídos y si el equipo incluye cargador.",
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- ENDPOINT 2: REGISTRAR COMPRA DE LAPTOP (con IA o manual) ---
@router.post("/registrar")
def registrar_compra(payload: CompraLaptopPayload):
    tipo_compra = payload.tipo_compra.strip() or TIPO_INTERNACIONAL
    es_local = tipo_compra != TIPO_INTERNACIONAL
    # Una compra local ya está en tus manos: entra directo al taller.
    estado_inicial = ESTADO_TALLER if es_local else ESTADO_TRANSITO
    flete = payload.costo_flete_total

    with db_cursor() as cursor:
        proveedor = _validar_proveedor(cursor, payload.id_proveedor)

        cursor.execute(
            """
            INSERT INTO COMPRA (id_proveedor, tipo_compra, codigo_orden, numero_recibo_local, fecha_compra,
                                tracking_courier, costo_flete_total, costo_productos_total)
            OUTPUT INSERTED.id_compra
            VALUES (?, ?, ?, ?, GETDATE(), ?, ?, ?)
            """,
            (
                payload.id_proveedor, tipo_compra, _limpiar(payload.codigo_orden),
                _limpiar(payload.numero_recibo_local), _limpiar(payload.tracking_courier),
                flete, payload.costo_productos_total,
            ),
        )
        id_compra = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO LAPTOP (numero_serie, marca, estado_flujo, procesador, ram_gb,
                                tipo_almacenamiento, [tamaño_almacenamiento], pantalla)
            OUTPUT INSERTED.id_laptop
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _limpiar(payload.numero_serie), payload.marca.strip(), estado_inicial, payload.procesador.strip(),
                payload.ram_gb, payload.tipo_almacenamiento.strip(), payload.tamano_almacenamiento,
                _limpiar(payload.pantalla),
            ),
        )
        id_laptop = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO DETALLE_COMPRA_LAPTOP (id_compra, id_laptop, costo_unitario_compra, flete_prorrateado)
            VALUES (?, ?, ?, ?)
            """,
            (id_compra, id_laptop, payload.costo_productos_total, flete),
        )

        cursor.execute(
            """
            INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_laptop, documento_origen, id_documento_origen,
                                               fecha_movimiento, cantidad, valor_unitario)
            VALUES ('Entrada Compra', ?, 'Compra', ?, GETDATE(), 1, ?)
            """,
            (id_laptop, id_compra, payload.costo_productos_total + flete),
        )

        descripcion = (
            f"Compra #{id_compra} ({tipo_compra}) a '{proveedor}'. Laptop #{id_laptop}: {payload.marca.strip()} · "
            f"{payload.procesador.strip()} · {payload.ram_gb}GB RAM · {payload.tipo_almacenamiento.strip()}. "
            f"Costo producto ${payload.costo_productos_total:.2f} + flete ${flete:.2f}. "
            f"Datos ingresados: {payload.origen_datos}. Estado inicial: {estado_inicial}."
        )
        if _limpiar(payload.notas):
            descripcion += f"\nNotas: {payload.notas.strip()}"
        registrar_bitacora(cursor, "Compras", "Compra de laptop", descripcion, id_laptop=id_laptop, id_referencia=id_compra)

    return {
        "status": "success",
        "message": "Compra registrada exitosamente",
        "id_compra": id_compra,
        "id_laptop": id_laptop,
        "estado_inicial": estado_inicial,
    }


# --- ENDPOINT 3: REGISTRAR COMPRA DE REPUESTOS (entrada de stock) ---
@router.post("/repuestos")
def registrar_compra_repuestos(payload: CompraRepuestosPayload):
    for item in payload.items:
        if item.id_repuesto is None and not _limpiar(item.nombre_pieza):
            raise HTTPException(status_code=422, detail="Cada pieza nueva necesita un nombre.")

    valor_total = sum(i.cantidad * i.costo_unitario for i in payload.items)
    cantidad_total = sum(i.cantidad for i in payload.items)

    with db_cursor() as cursor:
        proveedor = _validar_proveedor(cursor, payload.id_proveedor)

        cursor.execute(
            """
            INSERT INTO COMPRA (id_proveedor, tipo_compra, codigo_orden, numero_recibo_local, fecha_compra,
                                tracking_courier, costo_flete_total, costo_productos_total)
            OUTPUT INSERTED.id_compra
            VALUES (?, ?, ?, ?, GETDATE(), ?, ?, ?)
            """,
            (
                payload.id_proveedor, payload.tipo_compra.strip() or TIPO_LOCAL, _limpiar(payload.codigo_orden),
                _limpiar(payload.numero_recibo_local), _limpiar(payload.tracking_courier),
                payload.costo_flete_total, valor_total,
            ),
        )
        id_compra = cursor.fetchone()[0]

        lineas = []
        for item in payload.items:
            # Prorrateo del flete por valor (o por cantidad si todo cuesta 0)
            if valor_total > 0:
                flete_linea = payload.costo_flete_total * (item.cantidad * item.costo_unitario) / valor_total
            else:
                flete_linea = payload.costo_flete_total * item.cantidad / cantidad_total
            costo_real_unit = item.costo_unitario + flete_linea / item.cantidad

            if item.id_repuesto is not None:
                cursor.execute(
                    "SELECT nombre_pieza, stock_actual, costo_unitario_promedio FROM INVENTARIO_REPUESTO WHERE id_repuesto = ?",
                    (item.id_repuesto,),
                )
                row = cursor.fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail=f"Repuesto #{item.id_repuesto} no encontrado")
                nombre, stock, promedio = row[0], int(row[1]), float(row[2])
                id_repuesto = item.id_repuesto
            else:
                nombre = item.nombre_pieza.strip()
                cursor.execute(
                    """
                    INSERT INTO INVENTARIO_REPUESTO (nombre_pieza, categoria, stock_actual, costo_unitario_promedio)
                    OUTPUT INSERTED.id_repuesto
                    VALUES (?, ?, 0, 0)
                    """,
                    (nombre, _limpiar(item.categoria)),
                )
                id_repuesto = cursor.fetchone()[0]
                stock, promedio = 0, 0.0

            nuevo_stock = stock + item.cantidad
            nuevo_promedio = ((stock * promedio) + (item.cantidad * costo_real_unit)) / nuevo_stock

            cursor.execute(
                """
                UPDATE INVENTARIO_REPUESTO
                SET stock_actual = ?, costo_unitario_promedio = ?
                WHERE id_repuesto = ?
                """,
                (nuevo_stock, round(nuevo_promedio, 2), id_repuesto),
            )
            cursor.execute(
                """
                INSERT INTO DETALLE_COMPRA_REPUESTO (id_compra, id_repuesto, cantidad, costo_unitario_compra, flete_prorrateado)
                VALUES (?, ?, ?, ?, ?)
                """,
                (id_compra, id_repuesto, item.cantidad, item.costo_unitario, round(flete_linea, 2)),
            )
            cursor.execute(
                """
                INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_repuesto, documento_origen, id_documento_origen,
                                                   fecha_movimiento, cantidad, valor_unitario)
                VALUES ('Entrada Compra', ?, 'Compra', ?, GETDATE(), ?, ?)
                """,
                (id_repuesto, id_compra, item.cantidad, round(costo_real_unit, 2)),
            )
            lineas.append(f"{item.cantidad} x {nombre} (#{id_repuesto}) a ${item.costo_unitario:.2f}")

        descripcion = (
            f"Compra #{id_compra} de repuestos a '{proveedor}': " + "; ".join(lineas)
            + f". Flete total ${payload.costo_flete_total:.2f}."
        )
        if _limpiar(payload.notas):
            descripcion += f"\nNotas: {payload.notas.strip()}"
        registrar_bitacora(cursor, "Inventario", "Compra de repuestos", descripcion, id_referencia=id_compra)

    return {"status": "success", "message": "Compra de repuestos registrada y stock actualizado", "id_compra": id_compra}


# --- ENDPOINT 4: REGISTRO / HISTORIAL DE COMPRAS ---
@router.get("/historial")
def historial_compras():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT c.id_compra, c.fecha_compra, c.tipo_compra, c.codigo_orden, c.numero_recibo_local,
                   c.tracking_courier, c.costo_flete_total, c.costo_productos_total,
                   p.id_proveedor, p.nombre AS proveedor,
                   l.id_laptop, l.marca, l.procesador, l.ram_gb, l.estado_flujo,
                   CASE WHEN l.id_laptop IS NOT NULL THEN 'Laptop' ELSE 'Repuestos' END AS tipo_item,
                   STUFF((
                       SELECT ', ' + CAST(d.cantidad AS VARCHAR(10)) + ' x ' + r.nombre_pieza
                       FROM DETALLE_COMPRA_REPUESTO d
                       JOIN INVENTARIO_REPUESTO r ON r.id_repuesto = d.id_repuesto
                       WHERE d.id_compra = c.id_compra
                       FOR XML PATH('')
                   ), 1, 2, '') AS detalle_repuestos
            FROM COMPRA c
            JOIN PROVEEDOR p ON p.id_proveedor = c.id_proveedor
            LEFT JOIN DETALLE_COMPRA_LAPTOP dcl ON dcl.id_compra = c.id_compra
            LEFT JOIN LAPTOP l ON l.id_laptop = dcl.id_laptop
            ORDER BY c.fecha_compra DESC, c.id_compra DESC
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}
