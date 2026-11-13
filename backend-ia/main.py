from contextlib import asynccontextmanager

import pyodbc
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from database import run_migrations
from routers import bitacora, compras, garantias, proveedores, reportes, taller, ventas


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    yield


app = FastAPI(title="LaptopSeller ERP (beta)", lifespan=lifespan)

for modulo in (proveedores, compras, taller, ventas, garantias, reportes, bitacora):
    app.include_router(modulo.router)


# Errores de SQL Server -> JSON con "detail" (la app lo muestra en un Alert)
@app.exception_handler(pyodbc.Error)
async def pyodbc_error_handler(_request: Request, exc: pyodbc.Error):
    mensaje = exc.args[1] if len(exc.args) > 1 else str(exc)
    return JSONResponse(status_code=500, content={"detail": f"Error en BD: {mensaje}"})


@app.get("/")
def health():
    return {"status": "ok", "app": "LaptopSeller ERP beta"}
