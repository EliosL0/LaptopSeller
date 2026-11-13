from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from database import db_cursor, registrar_bitacora, rows_to_dicts

router = APIRouter(prefix="/proveedores", tags=["Proveedores"])


class ProveedorPayload(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    tipo: str = Field(min_length=1, max_length=50)  # 'Marketplace Online', 'Distribuidor Local', 'Particular'
    contacto: Optional[str] = Field(default=None, max_length=100)
    pais: Optional[str] = Field(default=None, max_length=50)


@router.get("")
def listar_proveedores():
    with db_cursor() as cursor:
        cursor.execute(
            """
            SELECT p.id_proveedor, p.nombre, p.tipo, p.contacto, p.pais,
                   (SELECT COUNT(*) FROM COMPRA c WHERE c.id_proveedor = p.id_proveedor) AS total_compras
            FROM PROVEEDOR p
            ORDER BY p.nombre
            """
        )
        return {"status": "success", "data": rows_to_dicts(cursor)}


@router.post("")
def crear_proveedor(payload: ProveedorPayload):
    with db_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO PROVEEDOR (nombre, tipo, contacto, pais)
            OUTPUT INSERTED.id_proveedor
            VALUES (?, ?, ?, ?)
            """,
            (payload.nombre.strip(), payload.tipo.strip(), payload.contacto, payload.pais),
        )
        id_proveedor = cursor.fetchone()[0]
        registrar_bitacora(
            cursor, "Compras", "Nuevo proveedor",
            f"Se registró el proveedor '{payload.nombre.strip()}' ({payload.tipo}).",
            id_referencia=id_proveedor,
        )
    return {"status": "success", "message": "Proveedor registrado", "id_proveedor": id_proveedor}

