from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from database import (
    ESTADO_DEVUELTA,
    ESTADO_LISTA,
    ESTADO_TALLER,
    ESTADO_TRANSITO,
    ESTADO_VENDIDO,
    ESTADOS_VALIDOS,
    db_cursor,
    registrar_bitacora,
    row_to_dict,
    rows_to_dicts,
)

router = APIRouter(prefix="/taller", tags=["Taller e Inventario"])

# Subconsulta reutilizable con el costo acumulado de cada laptop
SQL_LAPTOP_BASE = """
    SELECT l.id_laptop, l.numero_serie, l.marca, l.procesador, l.ram_gb, l.tipo_almacenamiento,
           l.[tamaño_almacenamiento] AS tamano_almacenamiento, l.pantalla, l.estado_flujo,
           ISNULL(dcl.costo_unitario_compra + dcl.flete_prorrateado, 0) AS costo_adquisicion,
           ISNULL(t.costo_taller, 0) AS costo_taller,
           ISNULL(t.piezas, 0) AS piezas_instaladas
    FROM LAPTOP l
    LEFT JOIN DETALLE_COMPRA_LAPTOP dcl ON dcl.id_laptop = l.id_laptop
    LEFT JOIN (
        SELECT id_laptop, SUM(costo_unitario_aplicado * cantidad) AS costo_taller, SUM(cantidad) AS piezas
        FROM INSTALACION_REPUESTO GROUP BY id_laptop
    ) t ON t.id_laptop = l.id_laptop
"""


# --- ESQUEMAS ---
class InstalarRepuestoPayload(BaseModel):
    id_laptop: int
    id_repuesto: int
    cantidad: int = Field(default=1, gt=0)
    observaciones: str = Field(default="", max_length=255)


class QuitarPiezaPayload(BaseModel):
    id_instalacion: int
    devolver_a_stock: bool = True
    motivo: str = Field(min_length=1)


class CambiarEstadoPayload(BaseModel):
    id_laptop: int
    nuevo_estado: str
    nota: Optional[str] = None


class EditarLaptopPayload(BaseModel):
    marca: str = Field(min_length=1, max_length=100)
    procesador: str = Field(min_length=1, max_length=100)
    ram_gb: int = Field(gt=0)
    tipo_almacenamiento: str = Field(min_length=1, max_length=50)
    tamano_almacenamiento: Optional[int] = Field(default=None, ge=0)
    pantalla: Optional[str] = Field(default=None, max_length=100)
    numero_serie: Optional[str] = Field(default=None, max_length=100)


class RepuestoPayload(BaseModel):
    nombre_pieza: str = Field(min_length=1, max_length=150)
    categoria: Optional[str] = Field(default=None, max_length=50)
    stock_inicial: int = Field(default=0, ge=0)
    costo_unitario: float = Field(default=0, ge=0)


class DiagnosticoPayload(BaseModel):
    id_laptop: int
    salud_bateria_pct: Optional[int] = Field(default=None, ge=0, le=100)
    resultado_general: str = Field(min_length=1, max_length=255)


def _obtener_laptop(cursor, id_laptop: int) -> dict:
    cursor.execute(SQL_LAPTOP_BASE + " WHERE l.id_laptop = ?", (id_laptop,))
    laptop = row_to_dict(cursor)
    if laptop is None:
        raise HTTPException(status_code=404, detail=f"Laptop #{id_laptop} no encontrada")
    return laptop


# --- LISTADOS DE LAPTOPS ---
@router.get("/pendientes")
def obtener_laptops_pendientes():
    """Equipos que aún requieren trabajo: en tránsito, en taller o devueltos por garantía."""
    with db_cursor() as cursor:
        cursor.execute(
            SQL_LAPTOP_BASE + " WHERE l.estado_flujo IN (?, ?, ?) ORDER BY l.id_laptop DESC",
            (ESTADO_TRANSITO, ESTADO_TALLER, ESTADO_DEVUELTA),
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


@router.get("/laptops")
def listar_laptops(estado: Optional[List[str]] = Query(default=None)):
    """Inventario completo de laptops (opcionalmente filtrado por estado)."""
    with db_cursor() as cursor:
        if estado:
            marcadores = ", ".join("?" for _ in estado)
            cursor.execute(
                SQL_LAPTOP_BASE + f" WHERE l.estado_flujo IN ({marcadores}) ORDER BY l.id_laptop DESC", estado
            )
        else:
            cursor.execute(SQL_LAPTOP_BASE + " ORDER BY l.id_laptop DESC")
        return {"status": "success", "data": rows_to_dicts(cursor)}


@router.get("/laptops/{id_laptop}")
def detalle_laptop(id_laptop: int):
    with db_cursor() as cursor:
        laptop = _obtener_laptop(cursor, id_laptop)

        cursor.execute(
            """
            SELECT c.id_compra, c.fecha_compra, c.tipo_compra, c.codigo_orden, c.tracking_courier,
                   p.nombre AS proveedor
            FROM DETALLE_COMPRA_LAPTOP d
            JOIN COMPRA c ON c.id_compra = d.id_compra
            JOIN PROVEEDOR p ON p.id_proveedor = c.id_proveedor
            WHERE d.id_laptop = ?
            """,
            (id_laptop,),
        )
        compra = row_to_dict(cursor)

        cursor.execute(
            """
            SELECT i.id_instalacion, i.id_repuesto, r.nombre_pieza, r.categoria, i.cantidad,
                   i.costo_unitario_aplicado, i.fecha_instalacion, i.observaciones
            FROM INSTALACION_REPUESTO i
            JOIN INVENTARIO_REPUESTO r ON r.id_repuesto = i.id_repuesto
            WHERE i.id_laptop = ?
            ORDER BY i.id_instalacion DESC
            """,
            (id_laptop,),
        )
        piezas = rows_to_dicts(cursor)

        cursor.execute(
            """
            SELECT id_diagnostico, fecha_prueba, salud_bateria_pct, resultado_general
            FROM PRUEBA_DIAGNOSTICO WHERE id_laptop = ? ORDER BY id_diagnostico DESC
            """,
            (id_laptop,),
        )
        diagnosticos = rows_to_dicts(cursor)

        cursor.execute(
            """
            SELECT v.id_venta, v.fecha_venta, v.precio_venta_final, v.metodo_pago, v.punto_entrega,
                   g.id_garantia, g.fecha_vencimiento, g.estado_garantia
            FROM VENTA v LEFT JOIN GARANTIA_SERVICIO g ON g.id_venta = v.id_venta
            WHERE v.id_laptop = ?
            """,
            (id_laptop,),
        )
        venta = row_to_dict(cursor)

        cursor.execute(
            """
            SELECT TOP (100) id_bitacora, fecha, modulo, accion, descripcion
            FROM BITACORA WHERE id_laptop = ? ORDER BY fecha DESC, id_bitacora DESC
            """,
            (id_laptop,),
        )
        bitacora = rows_to_dicts(cursor)

    return {
        "status": "success",
        "data": {
            "laptop": laptop,
            "compra": compra,
            "piezas": piezas,
            "diagnosticos": diagnosticos,
            "venta": venta,
            "bitacora": bitacora,
        },
    }


@router.put("/laptops/{id_laptop}")
def editar_laptop(id_laptop: int, payload: EditarLaptopPayload):
    with db_cursor() as cursor:
        anterior = _obtener_laptop(cursor, id_laptop)
        cursor.execute(
            """
            UPDATE LAPTOP
            SET marca = ?, procesador = ?, ram_gb = ?, tipo_almacenamiento = ?,
                [tamaño_almacenamiento] = ?, pantalla = ?, numero_serie = ?
            WHERE id_laptop = ?
            """,
            (
                payload.marca.strip(), payload.procesador.strip(), payload.ram_gb,
                payload.tipo_almacenamiento.strip(), payload.tamano_almacenamiento,
                (payload.pantalla or "").strip() or None, (payload.numero_serie or "").strip() or None, id_laptop,
            ),
        )
        registrar_bitacora(
            cursor, "Taller", "Edición de especificaciones",
            f"Antes: {anterior['marca']} · {anterior['procesador']} · {anterior['ram_gb']}GB · "
            f"{anterior['tipo_almacenamiento']}. Ahora: {payload.marca.strip()} · {payload.procesador.strip()} · "
            f"{payload.ram_gb}GB · {payload.tipo_almacenamiento.strip()}.",
            id_laptop=id_laptop,
        )
    return {"status": "success", "message": "Especificaciones actualizadas"}


# --- CAMBIAR ESTADO DE FLUJO ---
@router.put("/estado")
def cambiar_estado(payload: CambiarEstadoPayload):
    if payload.nuevo_estado not in ESTADOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"Estado inválido. Usa uno de: {', '.join(ESTADOS_VALIDOS)}")
    if payload.nuevo_estado == ESTADO_VENDIDO:
        raise HTTPException(status_code=400, detail="Para marcar como vendida registra la venta en la pestaña Ventas.")

    with db_cursor() as cursor:
        laptop = _obtener_laptop(cursor, payload.id_laptop)
        anterior = laptop["estado_flujo"]
        if anterior == ESTADO_VENDIDO:
            raise HTTPException(
                status_code=400,
                detail="La laptop está vendida. Los cambios post-venta se manejan desde Garantías.",
            )
        if payload.nuevo_estado == ESTADO_LISTA:
            cursor.execute("SELECT 1 FROM VENTA WHERE id_laptop = ?", (payload.id_laptop,))
            if cursor.fetchone() is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Esta laptop ya tuvo una venta (fue devuelta). La base de datos no permite venderla dos veces; "
                           "puedes usarla como equipo de reemplazo cuando esté reparada.",
                )

        cursor.execute(
            "UPDATE LAPTOP SET estado_flujo = ? WHERE id_laptop = ?", (payload.nuevo_estado, payload.id_laptop)
        )
        descripcion = f"Estado cambiado de '{anterior}' a '{payload.nuevo_estado}'."
        if payload.nota and payload.nota.strip():
            descripcion += f"\nNota: {payload.nota.strip()}"
        registrar_bitacora(cursor, "Taller", "Cambio de estado", descripcion, id_laptop=payload.id_laptop)

    return {"status": "success", "message": f"Estado actualizado a {payload.nuevo_estado}"}


# --- INVENTARIO DE REPUESTOS ---
@router.get("/repuestos")
def listar_repuestos():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT id_repuesto, nombre_pieza, categoria, stock_actual, costo_unitario_promedio,
                   stock_actual * costo_unitario_promedio AS valor_stock
            FROM INVENTARIO_REPUESTO
            ORDER BY nombre_pieza
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


@router.post("/repuestos")
def crear_repuesto(payload: RepuestoPayload):
    """Alta manual de una pieza (por ejemplo, piezas que ya tenías antes de usar el sistema)."""
    with db_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO INVENTARIO_REPUESTO (nombre_pieza, categoria, stock_actual, costo_unitario_promedio)
            OUTPUT INSERTED.id_repuesto
            VALUES (?, ?, ?, ?)
            """,
            (payload.nombre_pieza.strip(), (payload.categoria or "").strip() or None,
             payload.stock_inicial, payload.costo_unitario),
        )
        id_repuesto = cursor.fetchone()[0]
        if payload.stock_inicial > 0:
            cursor.execute(
                """
                INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_repuesto, documento_origen, id_documento_origen,
                                                   fecha_movimiento, cantidad, valor_unitario)
                VALUES ('Ajuste', ?, 'Alta manual', ?, GETDATE(), ?, ?)
                """,
                (id_repuesto, id_repuesto, payload.stock_inicial, payload.costo_unitario),
            )
        registrar_bitacora(
            cursor, "Inventario", "Alta de repuesto",
            f"Repuesto #{id_repuesto} '{payload.nombre_pieza.strip()}' creado con stock {payload.stock_inicial} "
            f"a ${payload.costo_unitario:.2f} c/u.",
            id_referencia=id_repuesto,
        )
    return {"status": "success", "message": "Repuesto registrado", "id_repuesto": id_repuesto}


# --- INSTALAR PIEZA ---
@router.post("/instalar-pieza")
def instalar_repuesto(payload: InstalarRepuestoPayload):
    with db_cursor() as cursor:
        laptop = _obtener_laptop(cursor, payload.id_laptop)
        if laptop["estado_flujo"] == ESTADO_VENDIDO:
            raise HTTPException(
                status_code=400,
                detail="La laptop ya fue vendida. Para instalar piezas sin costo al cliente registra una incidencia en Garantías.",
            )

        cursor.execute(
            "SELECT nombre_pieza, stock_actual, costo_unitario_promedio FROM INVENTARIO_REPUESTO WHERE id_repuesto = ?",
            (payload.id_repuesto,),
        )
        repuesto = cursor.fetchone()
        if not repuesto:
            raise HTTPException(status_code=404, detail="Repuesto no encontrado")
        nombre, stock_actual, costo_unitario = repuesto[0], repuesto[1], repuesto[2]
        if stock_actual < payload.cantidad:
            raise HTTPException(status_code=400, detail=f"Stock insuficiente de '{nombre}' (disponible: {stock_actual})")

        cursor.execute(
            """
            INSERT INTO INSTALACION_REPUESTO (id_laptop, id_repuesto, cantidad, costo_unitario_aplicado, fecha_instalacion, observaciones)
            OUTPUT INSERTED.id_instalacion
            VALUES (?, ?, ?, ?, GETDATE(), ?)
            """,
            (payload.id_laptop, payload.id_repuesto, payload.cantidad, costo_unitario, payload.observaciones or None),
        )
        id_instalacion = cursor.fetchone()[0]

        cursor.execute(
            "UPDATE INVENTARIO_REPUESTO SET stock_actual = stock_actual - ? WHERE id_repuesto = ?",
            (payload.cantidad, payload.id_repuesto),
        )
        cursor.execute(
            """
            INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_repuesto, documento_origen, id_documento_origen,
                                               fecha_movimiento, cantidad, valor_unitario)
            VALUES ('Salida Ensamble', ?, 'Instalacion Taller', ?, GETDATE(), ?, ?)
            """,
            (payload.id_repuesto, id_instalacion, payload.cantidad, costo_unitario),
        )
        descripcion = f"Instalada pieza: {payload.cantidad} x {nombre} (${float(costo_unitario):.2f} c/u)."
        if payload.observaciones:
            descripcion += f"\nObservaciones: {payload.observaciones}"
        registrar_bitacora(cursor, "Taller", "Instalación de pieza", descripcion,
                           id_laptop=payload.id_laptop, id_referencia=id_instalacion)

    return {
        "status": "success",
        "message": "Pieza instalada y stock actualizado correctamente",
        "costo_agregado": float(costo_unitario) * payload.cantidad,
    }


# --- QUITAR PIEZA ---
@router.post("/quitar-pieza")
def quitar_repuesto(payload: QuitarPiezaPayload):
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT i.id_laptop, i.id_repuesto, i.cantidad, i.costo_unitario_aplicado, r.nombre_pieza, l.estado_flujo
            FROM INSTALACION_REPUESTO i
            JOIN INVENTARIO_REPUESTO r ON r.id_repuesto = i.id_repuesto
            JOIN LAPTOP l ON l.id_laptop = i.id_laptop
            WHERE i.id_instalacion = ?
            """,
            (payload.id_instalacion,),
        )
        inst = row_to_dict(cursor)
        if inst is None:
            raise HTTPException(status_code=404, detail="Instalación no encontrada")
        if inst["estado_flujo"] == ESTADO_VENDIDO:
            raise HTTPException(status_code=400, detail="No se pueden quitar piezas de una laptop vendida.")

        cursor.execute("DELETE FROM INSTALACION_REPUESTO WHERE id_instalacion = ?", (payload.id_instalacion,))

        if payload.devolver_a_stock:
            cursor.execute(
                "UPDATE INVENTARIO_REPUESTO SET stock_actual = stock_actual + ? WHERE id_repuesto = ?",
                (inst["cantidad"], inst["id_repuesto"]),
            )
            tipo_mov, destino = "Entrada Desinstalacion", "devuelta al inventario"
        else:
            tipo_mov, destino = "Baja Repuesto", "descartada (no vuelve al stock)"

        cursor.execute(
            """
            INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_repuesto, documento_origen, id_documento_origen,
                                               fecha_movimiento, cantidad, valor_unitario)
            VALUES (?, ?, 'Desinstalacion Taller', ?, GETDATE(), ?, ?)
            """,
            (tipo_mov, inst["id_repuesto"], payload.id_instalacion, inst["cantidad"], inst["costo_unitario_aplicado"]),
        )
        registrar_bitacora(
            cursor, "Taller", "Pieza retirada",
            f"Retirada pieza: {inst['cantidad']} x {inst['nombre_pieza']} — {destino}.\nMotivo: {payload.motivo.strip()}",
            id_laptop=inst["id_laptop"], id_referencia=payload.id_instalacion,
        )

    return {"status": "success", "message": f"Pieza retirada y {destino}"}


# --- DIAGNÓSTICO ---
@router.post("/diagnostico")
def registrar_diagnostico(payload: DiagnosticoPayload):
    with db_cursor() as cursor:
        _obtener_laptop(cursor, payload.id_laptop)
        cursor.execute(
            """
            INSERT INTO PRUEBA_DIAGNOSTICO (id_laptop, fecha_prueba, salud_bateria_pct, resultado_general)
            OUTPUT INSERTED.id_diagnostico
            VALUES (?, GETDATE(), ?, ?)
            """,
            (payload.id_laptop, payload.salud_bateria_pct, payload.resultado_general.strip()),
        )
        id_diag = cursor.fetchone()[0]
        bateria = f" Batería: {payload.salud_bateria_pct}%." if payload.salud_bateria_pct is not None else ""
        registrar_bitacora(cursor, "Taller", "Diagnóstico",
                           f"Diagnóstico: {payload.resultado_general.strip()}.{bateria}",
                           id_laptop=payload.id_laptop, id_referencia=id_diag)
    return {"status": "success", "message": "Diagnóstico registrado", "id_diagnostico": id_diag}


# --- REGISTRO / HISTORIAL DEL TALLER ---
@router.get("/historial")
def historial_taller():
    """Bitácora de taller e inventario (instalaciones, retiros, estados, diagnósticos, notas)."""
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT TOP (300) b.id_bitacora, b.fecha, b.modulo, b.accion, b.id_laptop, b.descripcion,
                   ISNULL(l.marca, '') + ' ' + ISNULL(l.procesador, '') AS equipo
            FROM BITACORA b
            LEFT JOIN LAPTOP l ON l.id_laptop = b.id_laptop
            WHERE b.modulo IN ('Taller', 'Inventario')
            ORDER BY b.fecha DESC, b.id_bitacora DESC
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}
