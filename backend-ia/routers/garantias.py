from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database import (
    ESTADO_DEVUELTA,
    ESTADO_LISTA,
    ESTADO_TALLER,
    ESTADO_VENDIDO,
    db_cursor,
    registrar_bitacora,
    row_to_dict,
    rows_to_dicts,
)

router = APIRouter(prefix="/garantias", tags=["Garantías y Reclamos"])

RESOLUCION_REPARADO = "Reparado"
RESOLUCION_REEMPLAZO = "Reemplazo"
RESOLUCION_REEMBOLSO = "Reembolso Efectivo"
RESOLUCION_CREDITO = "Nota de Credito"
RESOLUCIONES_VALIDAS = [
    RESOLUCION_REPARADO,
    RESOLUCION_REEMPLAZO,
    RESOLUCION_REEMBOLSO,
    RESOLUCION_CREDITO,
]


class IncidenciaPayload(BaseModel):
    id_garantia: int
    motivo_falla: str = Field(min_length=1, max_length=255)
    es_defecto_fabrica: bool = True
    resolucion: str  # 'Reparado', 'Reemplazo', 'Reembolso Efectivo', 'Nota de Credito'
    detalle_resolucion: str = Field(min_length=1)
    # Solo para 'Reparado' (opcional: instalar pieza del inventario sin costo para el cliente)
    id_repuesto: Optional[int] = None
    cantidad_repuesto: int = Field(default=1, gt=0)
    # Solo para 'Reemplazo'
    id_laptop_reemplazo: Optional[int] = None
    estado_laptop_devuelta: str = Field(default=ESTADO_TALLER)  # 'En Taller' o 'Devuelta'
    # Solo para 'Reembolso Efectivo' o 'Nota de Credito'
    monto_reembolsado: float = Field(default=0.0, ge=0)
    devolver_laptop_a_taller: bool = True


# --- ENDPOINT 1: LISTAR PÓLIZAS DE GARANTÍA ---
@router.get("")
def listar_garantias():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT g.id_garantia, g.id_venta, g.fecha_inicio, g.fecha_vencimiento,
                   CASE
                       WHEN g.estado_garantia = 'Vigente' AND g.fecha_vencimiento < CAST(GETDATE() AS DATE)
                       THEN 'Expirada'
                       ELSE g.estado_garantia
                   END AS estado_garantia,
                   DATEDIFF(day, CAST(GETDATE() AS DATE), g.fecha_vencimiento) AS dias_restantes,
                   v.id_laptop, v.fecha_venta, v.precio_venta_final, v.punto_entrega, v.metodo_pago,
                   l.marca, l.procesador, l.ram_gb, l.tipo_almacenamiento, l.estado_flujo,
                   ISNULL(inc.total_incidencias, 0) AS total_incidencias,
                   ISNULL(inc.total_reembolsado, 0) AS total_reembolsado
            FROM GARANTIA_SERVICIO g
            JOIN VENTA v ON v.id_venta = g.id_venta
            JOIN LAPTOP l ON l.id_laptop = v.id_laptop
            LEFT JOIN (
                SELECT id_garantia, COUNT(*) AS total_incidencias, SUM(monto_reembolsado) AS total_reembolsado
                FROM INCIDENCIA_DEVOLUCION GROUP BY id_garantia
            ) inc ON inc.id_garantia = g.id_garantia
            ORDER BY g.id_garantia DESC
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


# --- ENDPOINT 2: LISTAR INCIDENCIAS / RECLAMOS ---
@router.get("/incidencias")
def listar_incidencias(id_garantia: Optional[int] = None):
    where = "WHERE i.id_garantia = ?" if id_garantia is not None else ""
    params = [id_garantia] if id_garantia is not None else []
    with db_cursor() as cursor:
        cursor.execute(
            f"""
            SELECT i.id_incidencia, i.id_garantia, i.id_laptop_reemplazo, i.fecha_reclamo,
                   i.motivo_falla, i.es_defecto_fabrica, i.resolucion, i.monto_reembolsado,
                   i.detalle_resolucion,
                   v.id_venta, v.id_laptop, v.precio_venta_final,
                   l.marca AS marca_original, l.procesador AS procesador_original,
                   lr.marca AS marca_reemplazo, lr.procesador AS procesador_reemplazo
            FROM INCIDENCIA_DEVOLUCION i
            JOIN GARANTIA_SERVICIO g ON g.id_garantia = i.id_garantia
            JOIN VENTA v ON v.id_venta = g.id_venta
            JOIN LAPTOP l ON l.id_laptop = v.id_laptop
            LEFT JOIN LAPTOP lr ON lr.id_laptop = i.id_laptop_reemplazo
            {where}
            ORDER BY i.fecha_reclamo DESC, i.id_incidencia DESC
            """,
            params,
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


# --- ENDPOINT 3: RESOLVER INCIDENCIA DE GARANTÍA (Reparar c/pieza sin costo, Reemplazar o Reembolsar) ---
@router.post("/incidencias")
def registrar_incidencia(payload: IncidenciaPayload):
    if payload.resolucion not in RESOLUCIONES_VALIDAS:
        raise HTTPException(
            status_code=422, detail=f"Resolución inválida. Usa una de: {', '.join(RESOLUCIONES_VALIDAS)}"
        )

    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT g.id_garantia, g.id_venta, g.estado_garantia, v.id_laptop, v.precio_venta_final,
                   l.marca, l.procesador
            FROM GARANTIA_SERVICIO g
            JOIN VENTA v ON v.id_venta = g.id_venta
            JOIN LAPTOP l ON l.id_laptop = v.id_laptop
            WHERE g.id_garantia = ?
            """,
            (payload.id_garantia,),
        )
        garantia = row_to_dict(cursor)
        if garantia is None:
            raise HTTPException(status_code=404, detail="Póliza de garantía no encontrada")

        id_laptop_original = garantia["id_laptop"]
        resumen_acciones = []

        # --- Caso A: REPARADO (opcionalmente instalando pieza sin costo al cliente) ---
        if payload.resolucion == RESOLUCION_REPARADO:
            if payload.id_repuesto is not None:
                cursor.execute(
                    "SELECT nombre_pieza, stock_actual, costo_unitario_promedio FROM INVENTARIO_REPUESTO WHERE id_repuesto = ?",
                    (payload.id_repuesto,),
                )
                rep = cursor.fetchone()
                if rep is None:
                    raise HTTPException(status_code=404, detail="Repuesto no encontrado")
                nombre_pieza, stock_actual, costo_unit = rep[0], rep[1], rep[2]
                if stock_actual < payload.cantidad_repuesto:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Stock insuficiente de '{nombre_pieza}' (disponible: {stock_actual})",
                    )
                obs = f"Garantía #{payload.id_garantia} (sin costo al cliente): {payload.motivo_falla}"[:255]
                cursor.execute(
                    """
                    INSERT INTO INSTALACION_REPUESTO (id_laptop, id_repuesto, cantidad, costo_unitario_aplicado,
                                                      fecha_instalacion, observaciones)
                    OUTPUT INSERTED.id_instalacion
                    VALUES (?, ?, ?, ?, GETDATE(), ?)
                    """,
                    (id_laptop_original, payload.id_repuesto, payload.cantidad_repuesto, costo_unit, obs),
                )
                id_inst = cursor.fetchone()[0]
                cursor.execute(
                    "UPDATE INVENTARIO_REPUESTO SET stock_actual = stock_actual - ? WHERE id_repuesto = ?",
                    (payload.cantidad_repuesto, payload.id_repuesto),
                )
                cursor.execute(
                    """
                    INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_repuesto, documento_origen, id_documento_origen,
                                                       fecha_movimiento, cantidad, valor_unitario)
                    VALUES ('Salida Garantia', ?, 'Incidencia Garantia', ?, GETDATE(), ?, ?)
                    """,
                    (payload.id_repuesto, id_inst, payload.cantidad_repuesto, costo_unit),
                )
                resumen_acciones.append(
                    f"Se instaló sin cobro al cliente: {payload.cantidad_repuesto} x {nombre_pieza} "
                    f"(costo interno asumido: ${float(costo_unit) * payload.cantidad_repuesto:.2f})."
                )
            else:
                resumen_acciones.append("Reparación/ajuste realizado sin consumir repuestos del inventario.")

        # --- Caso B: REEMPLAZO POR OTRA COMPUTADORA ---
        elif payload.resolucion == RESOLUCION_REEMPLAZO:
            if not payload.id_laptop_reemplazo:
                raise HTTPException(status_code=422, detail="Selecciona la laptop de reemplazo.")
            if payload.id_laptop_reemplazo == id_laptop_original:
                raise HTTPException(status_code=400, detail="La laptop de reemplazo debe ser distinta a la original.")

            cursor.execute(
                "SELECT marca, procesador, estado_flujo FROM LAPTOP WHERE id_laptop = ?",
                (payload.id_laptop_reemplazo,),
            )
            reemp = cursor.fetchone()
            if reemp is None:
                raise HTTPException(status_code=404, detail="Laptop de reemplazo no encontrada")
            if reemp[2] == ESTADO_VENDIDO:
                raise HTTPException(status_code=400, detail="La laptop elegida como reemplazo ya está vendida.")

            estado_devuelta = (
                payload.estado_laptop_devuelta
                if payload.estado_laptop_devuelta in (ESTADO_TALLER, ESTADO_DEVUELTA)
                else ESTADO_TALLER
            )
            # La laptop original entra de vuelta al taller/devuelta
            cursor.execute(
                "UPDATE LAPTOP SET estado_flujo = ? WHERE id_laptop = ?",
                (estado_devuelta, id_laptop_original),
            )
            # La laptop de reemplazo se entrega al cliente (pasa a Vendido)
            cursor.execute(
                "UPDATE LAPTOP SET estado_flujo = ? WHERE id_laptop = ?",
                (ESTADO_VENDIDO, payload.id_laptop_reemplazo),
            )
            resumen_acciones.append(
                f"Cambio de equipo: se entregó la laptop #{payload.id_laptop_reemplazo} ({reemp[0]} {reemp[1]}) "
                f"y la laptop #{id_laptop_original} regresó con estado '{estado_devuelta}'."
            )

        # --- Caso C: REEMBOLSO DE DINERO / NOTA DE CRÉDITO ---
        elif payload.resolucion in (RESOLUCION_REEMBOLSO, RESOLUCION_CREDITO):
            if payload.monto_reembolsado <= 0:
                raise HTTPException(status_code=422, detail="Ingresa un monto de reembolso mayor a 0.")
            if payload.devolver_laptop_a_taller:
                cursor.execute(
                    "UPDATE LAPTOP SET estado_flujo = ? WHERE id_laptop = ?",
                    (ESTADO_DEVUELTA, id_laptop_original),
                )
                cursor.execute(
                    "UPDATE GARANTIA_SERVICIO SET estado_garantia = 'Anulada' WHERE id_garantia = ?",
                    (payload.id_garantia,),
                )
                resumen_acciones.append(
                    f"{payload.resolucion} por ${payload.monto_reembolsado:.2f} USD. "
                    f"El equipo #{id_laptop_original} fue recibido de vuelta (estado '{ESTADO_DEVUELTA}') y la garantía quedó cerrada."
                )
            else:
                resumen_acciones.append(
                    f"{payload.resolucion} parcial/compensación por ${payload.monto_reembolsado:.2f} USD "
                    f"(el cliente conserva la laptop #{id_laptop_original})."
                )

        monto_guardar = (
            payload.monto_reembolsado if payload.resolucion in (RESOLUCION_REEMBOLSO, RESOLUCION_CREDITO) else 0.0
        )
        id_reemplazo_guardar = payload.id_laptop_reemplazo if payload.resolucion == RESOLUCION_REEMPLAZO else None

        detalle_completo = f"{payload.detalle_resolucion.strip()}\nAcción del sistema: {' '.join(resumen_acciones)}"

        cursor.execute(
            """
            INSERT INTO INCIDENCIA_DEVOLUCION (id_garantia, id_laptop_reemplazo, fecha_reclamo, motivo_falla,
                                               es_defecto_fabrica, resolucion, monto_reembolsado, detalle_resolucion)
            OUTPUT INSERTED.id_incidencia
            VALUES (?, ?, GETDATE(), ?, ?, ?, ?, ?)
            """,
            (
                payload.id_garantia,
                id_reemplazo_guardar,
                payload.motivo_falla.strip(),
                1 if payload.es_defecto_fabrica else 0,
                payload.resolucion,
                monto_guardar,
                detalle_completo,
            ),
        )
        id_incidencia = cursor.fetchone()[0]

        # Movimientos de inventario para dejar trazabilidad física en reemplazos y devoluciones
        if payload.resolucion == RESOLUCION_REEMPLAZO and id_reemplazo_guardar:
            cursor.execute(
                """
                INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_laptop, documento_origen, id_documento_origen,
                                                   fecha_movimiento, cantidad, valor_unitario)
                VALUES ('Entrada Devolucion', ?, 'Incidencia Garantia', ?, GETDATE(), 1, 0),
                       ('Salida Reemplazo', ?, 'Incidencia Garantia', ?, GETDATE(), 1, 0)
                """,
                (id_laptop_original, id_incidencia, id_reemplazo_guardar, id_incidencia),
            )
            registrar_bitacora(
                cursor,
                "Garantias",
                "Entregada como reemplazo",
                f"Entregada como reemplazo en incidencia #{id_incidencia} (sustituye a laptop #{id_laptop_original}). "
                f"Motivo: {payload.motivo_falla.strip()}.",
                id_laptop=id_reemplazo_guardar,
                id_referencia=id_incidencia,
            )
        elif payload.resolucion in (RESOLUCION_REEMBOLSO, RESOLUCION_CREDITO) and payload.devolver_laptop_a_taller:
            cursor.execute(
                """
                INSERT INTO MOVIMIENTO_INVENTARIO (tipo_movimiento, id_laptop, documento_origen, id_documento_origen,
                                                   fecha_movimiento, cantidad, valor_unitario)
                VALUES ('Entrada Devolucion', ?, 'Incidencia Garantia', ?, GETDATE(), 1, ?)
                """,
                (id_laptop_original, id_incidencia, monto_guardar),
            )

        defecto_txt = "Defecto de fábrica" if payload.es_defecto_fabrica else "Falla reportada post-venta"
        registrar_bitacora(
            cursor,
            "Garantias",
            f"Garantía: {payload.resolucion}",
            f"Incidencia #{id_incidencia} (Garantía #{payload.id_garantia}, Venta #{garantia['id_venta']}). "
            f"{defecto_txt}: {payload.motivo_falla.strip()}.\n{detalle_completo}",
            id_laptop=id_laptop_original,
            id_referencia=id_incidencia,
        )

    return {
        "status": "success",
        "message": f"Incidencia #{id_incidencia} registrada ({payload.resolucion})",
        "id_incidencia": id_incidencia,
    }


# --- ENDPOINT 4: EQUIPOS ELEGIBLES PARA REEMPLAZO ---
@router.get("/reemplazos-disponibles")
def reemplazos_disponibles():
    """Laptops en Lista para Venta o En Taller que pueden entregarse como reemplazo."""
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT id_laptop, marca, procesador, ram_gb, tipo_almacenamiento, pantalla, estado_flujo
            FROM LAPTOP
            WHERE estado_flujo IN (?, ?, ?)
            ORDER BY CASE WHEN estado_flujo = ? THEN 0 ELSE 1 END, id_laptop DESC
            """,
            (ESTADO_LISTA, ESTADO_TALLER, ESTADO_DEVUELTA, ESTADO_LISTA),
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}

