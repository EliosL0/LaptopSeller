from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from database import db_cursor, registrar_bitacora, rows_to_dicts

router = APIRouter(prefix="/bitacora", tags=["Bitácora"])


class NotaPayload(BaseModel):
    modulo: str = Field(default="Nota", max_length=50)
    id_laptop: Optional[int] = None
    id_referencia: Optional[int] = None
    descripcion: str = Field(min_length=1)


@router.get("")
def listar_bitacora(
    modulo: Optional[str] = None,
    id_laptop: Optional[int] = None,
    limite: int = Query(default=200, ge=1, le=1000),
):
    filtros, params = [], []
    if modulo:
        filtros.append("b.modulo = ?")
        params.append(modulo)
    if id_laptop is not None:
        filtros.append("b.id_laptop = ?")
        params.append(id_laptop)
    where = f"WHERE {' AND '.join(filtros)}" if filtros else ""

    with db_cursor() as cursor:
        cursor.execute(
            f"""
            SELECT TOP ({limite}) b.id_bitacora, b.fecha, b.modulo, b.accion, b.id_laptop,
                   b.id_referencia, b.descripcion,
                   ISNULL(l.marca, '') + ' ' + ISNULL(l.procesador, '') AS equipo
            FROM BITACORA b
            LEFT JOIN LAPTOP l ON l.id_laptop = b.id_laptop
            {where}
            ORDER BY b.fecha DESC, b.id_bitacora DESC
            """,
            params,
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


@router.post("")
def agregar_nota(payload: NotaPayload):
    with db_cursor() as cursor:
        if payload.id_laptop is not None:
            cursor.execute("SELECT 1 FROM LAPTOP WHERE id_laptop = ?", (payload.id_laptop,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail="Laptop no encontrada")
        registrar_bitacora(
            cursor, payload.modulo, "Nota manual", payload.descripcion.strip(),
            id_laptop=payload.id_laptop, id_referencia=payload.id_referencia,
        )
    return {"status": "success", "message": "Nota guardada en la bitácora"}

