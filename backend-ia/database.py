import logging
from contextlib import contextmanager

import pyodbc

logger = logging.getLogger("uvicorn.error")

CONNECTION_STRING = (
    r"DRIVER={ODBC Driver 17 for SQL Server};"
    r"SERVER=LENOVO-15IML\SQLEXPRESS;"
    r"DATABASE=LAPTOPS;"
    r"UID=eliosl0;"
    r"PWD=Los3Mosqueteros"
)

# Estados del flujo de una laptop (columna LAPTOP.estado_flujo)
ESTADO_TRANSITO = "En Tránsito"
ESTADO_TALLER = "En Taller"
ESTADO_LISTA = "Lista para Venta"
ESTADO_VENDIDO = "Vendido"
ESTADO_DEVUELTA = "Devuelta"
ESTADOS_VALIDOS = [ESTADO_TRANSITO, ESTADO_TALLER, ESTADO_LISTA, ESTADO_VENDIDO, ESTADO_DEVUELTA]


def get_db_connection():
    return pyodbc.connect(CONNECTION_STRING)


@contextmanager
def db_cursor():
    """Abre conexión + cursor. Hace commit si todo sale bien y rollback si algo falla."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def rows_to_dicts(cursor):
    if cursor.description is None:
        return []
    columnas = [c[0] for c in cursor.description]
    return [dict(zip(columnas, row)) for row in cursor.fetchall()]


def row_to_dict(cursor):
    if cursor.description is None:
        return None
    row = cursor.fetchone()
    if row is None:
        return None
    columnas = [c[0] for c in cursor.description]
    return dict(zip(columnas, row))


def registrar_bitacora(cursor, modulo, accion, descripcion, id_laptop=None, id_referencia=None):
    """Deja un registro escrito de lo ocurrido (tabla BITACORA)."""
    cursor.execute(
        """
        INSERT INTO BITACORA (modulo, accion, id_laptop, id_referencia, descripcion)
        VALUES (?, ?, ?, ?, ?)
        """,
        (modulo, accion[:100], id_laptop, id_referencia, descripcion),
    )


# --- Migraciones idempotentes (se ejecutan al arrancar el servidor) ---
# Ver también migracion_erp.sql para ejecutarlas manualmente desde SSMS.
MIGRACIONES = [
    """
    IF OBJECT_ID('dbo.BITACORA', 'U') IS NULL
    CREATE TABLE BITACORA (
        id_bitacora INT IDENTITY(1,1) PRIMARY KEY,
        fecha DATETIME NOT NULL DEFAULT GETDATE(),
        modulo VARCHAR(50) NOT NULL,
        accion VARCHAR(100) NOT NULL,
        id_laptop INT NULL,
        id_referencia INT NULL,
        descripcion NVARCHAR(MAX) NOT NULL,
        CONSTRAINT FK_Bitacora_Laptop FOREIGN KEY (id_laptop) REFERENCES LAPTOP(id_laptop)
    )
    """,
    """
    IF COL_LENGTH('dbo.INCIDENCIA_DEVOLUCION', 'detalle_resolucion') IS NULL
    ALTER TABLE INCIDENCIA_DEVOLUCION ADD detalle_resolucion NVARCHAR(MAX) NULL
    """,
]


def run_migrations():
    try:
        conn = get_db_connection()
        conn.autocommit = True
        cursor = conn.cursor()
        for sql in MIGRACIONES:
            cursor.execute(sql)
        cursor.close()
        conn.close()
        logger.info("Migraciones ERP verificadas (BITACORA, detalle_resolucion).")
    except Exception as e:  # No tumbamos el servidor: avisamos en consola.
        logger.warning("No se pudieron aplicar las migraciones ERP: %s. Ejecuta migracion_erp.sql en SSMS.", e)
