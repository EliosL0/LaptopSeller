-- Migración ERP beta de LaptopSeller.
-- El backend la aplica automáticamente al arrancar (database.run_migrations).
-- Si el usuario de SQL no tiene permisos para crear tablas, ejecútala manualmente en SSMS.
USE LAPTOPS;
GO

-- Registro escrito de todo lo que pasa (compras, taller, ventas, garantías, notas manuales)
IF OBJECT_ID('dbo.BITACORA', 'U') IS NULL
CREATE TABLE BITACORA (
    id_bitacora INT IDENTITY(1,1) PRIMARY KEY,
    fecha DATETIME NOT NULL DEFAULT GETDATE(),
    modulo VARCHAR(50) NOT NULL,          -- 'Compras', 'Taller', 'Inventario', 'Ventas', 'Garantias', 'Nota'
    accion VARCHAR(100) NOT NULL,
    id_laptop INT NULL,
    id_referencia INT NULL,               -- id de la compra / venta / incidencia relacionada
    descripcion NVARCHAR(MAX) NOT NULL,
    CONSTRAINT FK_Bitacora_Laptop FOREIGN KEY (id_laptop) REFERENCES LAPTOP(id_laptop)
);
GO

-- Explicación escrita y detallada de cómo se resolvió cada incidencia de garantía
IF COL_LENGTH('dbo.INCIDENCIA_DEVOLUCION', 'detalle_resolucion') IS NULL
ALTER TABLE INCIDENCIA_DEVOLUCION ADD detalle_resolucion NVARCHAR(MAX) NULL;
GO

