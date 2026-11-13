from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database import (
    ESTADO_LISTA,
    ESTADO_VENDIDO,
    db_cursor,
    registrar_bitacora,
    rows_to_dicts,
)
from services.ai_service import redactar_publicacion_marketplace

router = APIRouter(prefix="/ventas", tags=["Ventas y Marketplace"])


# --- ESQUEMAS ---
class PublicacionPayload(BaseModel):
    id_laptop: Optional[int] = None
    marca: str
    procesador: str
    ram_gb: int
    tipo_almacenamiento: str
    precio_estimado: float = Field(gt=0)


class RegistrarVentaPayload(BaseModel):
    id_laptop: int
    precio_venta_final: float = Field(gt=0)
    punto_entrega: str = Field(min_length=1, max_length=150)
    metodo_pago: str = Field(min_length=1, max_length=50)
    meses_garantia: int = Field(default=3, ge=0)
    notas: Optional[str] = None


# --- ENDPOINT 1: LISTAR LAPTOPS LISTAS PARA VENDER ---
@router.get("/disponibles")
def obtener_laptops_disponibles():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT l.id_laptop, l.numero_serie, l.marca, l.procesador, l.ram_gb, l.tipo_almacenamiento,
                   l.[tamaño_almacenamiento] AS tamano_almacenamiento, l.pantalla,
                   ISNULL(dcl.costo_unitario_compra + dcl.flete_prorrateado, 0) AS costo_adquisicion,
                   ISNULL(t.costo_taller, 0) AS costo_taller
            FROM LAPTOP l
            LEFT JOIN DETALLE_COMPRA_LAPTOP dcl ON dcl.id_laptop = l.id_laptop
            LEFT JOIN (
                SELECT id_laptop, SUM(costo_unitario_aplicado * cantidad) AS costo_taller
                FROM INSTALACION_REPUESTO GROUP BY id_laptop
            ) t ON t.id_laptop = l.id_laptop
            WHERE l.estado_flujo = ?
            ORDER BY l.id_laptop DESC
            """,
            (ESTADO_LISTA,),
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


# --- ENDPOINT 2: GENERAR TEXTO PARA MARKETPLACE CON IA ---
@router.post("/generar-copy")
def generar_copy_marketplace(payload: PublicacionPayload):
    try:
        texto = redactar_publicacion_marketplace(
            payload.marca,
            payload.procesador,
            payload.ram_gb,
            payload.tipo_almacenamiento,
            payload.precio_estimado,
        )
        if payload.id_laptop:
            with db_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO PUBLICACION_MARKETPLACE (id_laptop, titulo_anuncio, precio_publicado, estado_anuncio)
                    VALUES (?, ?, ?, 'Activo')
                    """,
                    (payload.id_laptop, f"{payload.marca} {payload.procesador}"[:255], payload.precio_estimado),
                )
        return {"status": "success", "texto_generado": texto}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- ENDPOINT 3: REGISTRAR VENTA (TRANSACCIÓN COMPLETA) ---
@router.post("/registrar")
def registrar_venta(payload: RegistrarVentaPayload):
    with db_cursor() as cursor:
        cursor.execute(
            "SELECT marca, procesador, estado_flujo FROM LAPTOP WHERE id_laptop = ?",
            (payload.id_laptop,),
        )
        row = cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Laptop no encontrada")
        marca, procesador, estado = row[0], row[1], row[2]
        if estado == ESTADO_VENDIDO:
            raise HTTPException(status_code=400, detail="Esta laptop ya aparece como vendida.")

        cursor.execute("SELECT id_venta FROM VENTA WHERE id_laptop = ?", (payload.id_laptop,))
        if cursor.fetchone() is not None:
            raise HTTPException(
                status_code=400,
                detail="Esta laptop ya tiene un registro de venta previo (fue devuelta). Usa Garantías para asignarla como reemplazo.",
            )

        cursor.execute(
            """
            SELECT TOP (1) id_publicacion
            FROM PUBLICACION_MARKETPLACE
            WHERE id_laptop = ? AND estado_anuncio = 'Activo'
            ORDER BY id_publicacion DESC
            """,
            (payload.id_laptop,),
        )
        pub_row = cursor.fetchone()
        id_publicacion = pub_row[0] if pub_row else None

        cursor.execute(
            """
            INSERT INTO VENTA (id_laptop, id_publicacion, fecha_venta, precio_venta_final, punto_entrega, metodo_pago)
            OUTPUT INSERTED.id_venta
            VALUES (?, ?, GETDATE(), ?, ?, ?)
            """,
            (
                payload.id_laptop,
                id_publicacion,
                payload.precio_venta_final,
                payload.punto_entrega.strip(),
                payload.metodo_pago.strip(),
            ),
        )
        id_venta = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO GARANTIA_SERVICIO (id_venta, fecha_inicio, fecha_vencimiento, estado_garantia)
            OUTPUT INSERTED.id_garantia
            VALUES (?, GETDATE(), DATEADD(month, ?, GETDATE()), 'Vigente')
            """,
            (id_venta, payload.meses_garantia),
        )
        id_garantia = cursor.fetchone()[0]

        cursor.execute(
            "UPDATE LAPTOP SET estado_flujo = ? WHERE id_laptop = ?",
            (ESTADO_VENDIDO, payload.id_laptop),
        )

        if id_publicacion:
            cursor.execute(
                "UPDATE PUBLICACION_MARKETPLACE SET estado_anuncio = 'Vendido' WHERE id_publicacion = ?",
                (id_publicacion,),
            )

        cursor.execute(
            """
            INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_laptop, documento_origen, id_documento_origen,
                                               fecha_movimiento, cantidad, valor_unitario)
            VALUES ('Salida Venta', ?, 'Factura/Recibo Venta', ?, GETDATE(), 1, ?)
            """,
            (payload.id_laptop, id_venta, payload.precio_venta_final),
        )

        descripcion = (
            f"Venta #{id_venta} de laptop #{payload.id_laptop} ({marca} {procesador}) por "
            f"${payload.precio_venta_final:.2f} USD ({payload.metodo_pago.strip()}) en '{payload.punto_entrega.strip()}'. "
            f"Garantía #{id_garantia} emitida por {payload.meses_garantia} mes(es)."
        )
        if payload.notas and payload.notas.strip():
            descripcion += f"\nNotas: {payload.notas.strip()}"
        registrar_bitacora(
            cursor, "Ventas", "Venta registrada", descripcion, id_laptop=payload.id_laptop, id_referencia=id_venta
        )

    return {
        "status": "success",
        "message": "Venta registrada, garantía emitida e inventario actualizado.",
        "id_venta": id_venta,
        "id_garantia": id_garantia,
    }


# --- ENDPOINT 4: REGISTRO / HISTORIAL DE VENTAS ---
@router.get("/historial")
def historial_ventas():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT v.id_venta, v.id_laptop, v.fecha_venta, v.precio_venta_final, v.punto_entrega, v.metodo_pago,
                   l.marca, l.procesador, l.ram_gb, l.tipo_almacenamiento, l.pantalla, l.estado_flujo,
                   g.id_garantia, g.fecha_inicio, g.fecha_vencimiento, g.estado_garantia,
                   CASE
                       WHEN g.fecha_vencimiento >= CAST(GETDATE() AS DATE) AND g.estado_garantia = 'Vigente'
                       THEN DATEDIFF(day, CAST(GETDATE() AS DATE), g.fecha_vencimiento)
                       ELSE 0
                   END AS dias_restantes_garantia,
                   ISNULL(dcl.costo_unitario_compra + dcl.flete_prorrateado, 0) AS costo_adquisicion,
                   ISNULL(t.costo_taller, 0) AS costo_taller,
                   ISNULL(inc.total_incidencias, 0) AS total_incidencias,
                   ISNULL(inc.total_reembolsado, 0) AS total_reembolsado
            FROM VENTA v
            JOIN LAPTOP l ON l.id_laptop = v.id_laptop
            LEFT JOIN GARANTIA_SERVICIO g ON g.id_venta = v.id_venta
            LEFT JOIN DETALLE_COMPRA_LAPTOP dcl ON dcl.id_laptop = l.id_laptop
            LEFT JOIN (
                SELECT id_laptop, SUM(costo_unitario_aplicado * cantidad) AS costo_taller
                FROM INSTALACION_REPUESTO GROUP BY id_laptop
            ) t ON t.id_laptop = l.id_laptop
            LEFT JOIN (
                SELECT id_garantia, COUNT(*) AS total_incidencias, SUM(monto_reembolsado) AS total_reembolsado
                FROM INCIDENCIA_DEVOLUCION GROUP BY id_garantia
            ) inc ON inc.id_garantia = g.id_garantia
            ORDER BY v.fecha_venta DESC, v.id_venta DESC
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}
