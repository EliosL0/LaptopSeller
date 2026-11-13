from fastapi import APIRouter

from database import db_cursor, rows_to_dicts

router = APIRouter(prefix="/reportes", tags=["Reportes y Finanzas"])


# --- ENDPOINT 1: KÁRDEX GENERAL (Resumen de Inventario y Movimientos) ---
@router.get("/kardex")
def obtener_kardex():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT estado_flujo, COUNT(*) AS total_equipos
            FROM LAPTOP
            GROUP BY estado_flujo
            """
        )
        por_estado = [{"estado": row[0], "total": row[1]} for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT TOP (100) m.id_movimiento, m.tipo_movimiento, m.id_laptop, m.id_repuesto,
                   m.documento_origen, m.id_documento_origen, m.fecha_movimiento, m.cantidad, m.valor_unitario,
                   l.marca, l.procesador, r.nombre_pieza
            FROM MOVIMIENTO_INVENTARIO m
            LEFT JOIN LAPTOP l ON l.id_laptop = m.id_laptop
            LEFT JOIN INVENTARIO_REPUESTO r ON r.id_repuesto = m.id_repuesto
            ORDER BY m.fecha_movimiento DESC, m.id_movimiento DESC
            """
        )
        movimientos = rows_to_dicts(cursor)

    return {"status": "success", "data": por_estado, "movimientos": movimientos}


# --- ENDPOINT 2: RENTABILIDAD Y MÁRGENES (incluye costos de taller, reembolsos y reemplazos de garantía) ---
@router.get("/rentabilidad")
def obtener_rentabilidad():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                v.id_venta,
                v.id_laptop,
                l.marca + ' ' + l.procesador AS equipo,
                v.fecha_venta,
                v.punto_entrega,
                v.metodo_pago,
                v.precio_venta_final AS ingreso,
                ISNULL(dcl.costo_unitario_compra + dcl.flete_prorrateado, 0) AS costo_adquisicion,
                ISNULL(t.costo_taller, 0) AS costo_taller,
                ISNULL(inc.reembolsado, 0) AS monto_reembolsado,
                ISNULL(inc.costo_reemplazos, 0) AS costo_reemplazo,
                ISNULL(inc.total_incidencias, 0) AS total_incidencias,
                v.precio_venta_final
                  - ISNULL(dcl.costo_unitario_compra + dcl.flete_prorrateado, 0)
                  - ISNULL(t.costo_taller, 0)
                  - ISNULL(inc.reembolsado, 0)
                  - ISNULL(inc.costo_reemplazos, 0) AS ganancia_neta
            FROM VENTA v
            INNER JOIN LAPTOP l ON v.id_laptop = l.id_laptop
            LEFT JOIN DETALLE_COMPRA_LAPTOP dcl ON l.id_laptop = dcl.id_laptop
            LEFT JOIN (
                SELECT id_laptop, SUM(costo_unitario_aplicado * cantidad) AS costo_taller
                FROM INSTALACION_REPUESTO
                GROUP BY id_laptop
            ) t ON t.id_laptop = l.id_laptop
            LEFT JOIN GARANTIA_SERVICIO g ON g.id_venta = v.id_venta
            LEFT JOIN (
                SELECT
                    i.id_garantia,
                    COUNT(*) AS total_incidencias,
                    SUM(i.monto_reembolsado) AS reembolsado,
                    SUM(
                        ISNULL(dclr.costo_unitario_compra + dclr.flete_prorrateado, 0)
                        + ISNULL(tr.costo_taller_reemp, 0)
                    ) AS costo_reemplazos
                FROM INCIDENCIA_DEVOLUCION i
                LEFT JOIN DETALLE_COMPRA_LAPTOP dclr ON dclr.id_laptop = i.id_laptop_reemplazo
                LEFT JOIN (
                    SELECT id_laptop, SUM(costo_unitario_aplicado * cantidad) AS costo_taller_reemp
                    FROM INSTALACION_REPUESTO GROUP BY id_laptop
                ) tr ON tr.id_laptop = i.id_laptop_reemplazo
                GROUP BY i.id_garantia
            ) inc ON inc.id_garantia = g.id_garantia
            ORDER BY v.fecha_venta DESC, v.id_venta DESC
            """
        )
        resultados = rows_to_dicts(cursor)

        cursor.execute(
            """
            SELECT ISNULL(SUM(costo_productos_total + costo_flete_total), 0) AS total_compras,
                   COUNT(*) AS cantidad_compras
            FROM COMPRA
            """
        )
        row_compras = cursor.fetchone()
        total_compras = float(row_compras[0] or 0)
        cantidad_compras = int(row_compras[1] or 0)

        cursor.execute(
            """
            SELECT ISNULL(SUM(stock_actual * costo_unitario_promedio), 0) AS valor_repuestos,
                   ISNULL(SUM(stock_actual), 0) AS unidades_repuestos
            FROM INVENTARIO_REPUESTO
            """
        )
        row_rep = cursor.fetchone()
        valor_repuestos = float(row_rep[0] or 0)
        unidades_repuestos = int(row_rep[1] or 0)

    ingreso_total = float(sum(float(r["ingreso"] or 0) for r in resultados))
    reembolsos_total = float(sum(float(r["monto_reembolsado"] or 0) for r in resultados))
    ganancia_total = float(sum(float(r["ganancia_neta"] or 0) for r in resultados))

    return {
        "status": "success",
        "resumen_global": {
            "ingreso_total_usd": ingreso_total,
            "reembolsos_total_usd": reembolsos_total,
            "ganancia_neta_total_usd": ganancia_total,
            "inversion_compras_usd": total_compras,
            "cantidad_compras": cantidad_compras,
            "valor_stock_repuestos_usd": valor_repuestos,
            "unidades_repuestos": unidades_repuestos,
        },
        "detalle_ventas": resultados,
    }
