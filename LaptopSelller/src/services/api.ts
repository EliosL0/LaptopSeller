import axios, { AxiosError } from 'axios';
import { Alert } from 'react-native';

// ⚠️ IP de tu PC donde corre uvicorn (host 0.0.0.0, puerto 8000)
export const BASE_URL = 'http://192.168.0.4:8000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
  headers: { Accept: 'application/json' },
});

// ============================================================================
// TIPOS: Proveedores
// ============================================================================
export interface Proveedor {
  id_proveedor: number;
  nombre: string;
  tipo: string;
  contacto?: string 
  | null;
  pais?: string | null;
  total_compras?: number;
}

export interface CrearProveedorPayload {
  nombre: string;
  tipo: string;
  contacto?: string;
  pais?: string;
}

// ============================================================================
// TIPOS: Compras
// ============================================================================
export interface DatosExtraidosIA {
  marca?: string;
  procesador?: string;
  ram_gb?: number;
  precio_detectado_usd?: number;
}

export interface EvaluarImagenResponse {
  status: string;
  datos_extraidos: DatosExtraidosIA;
  estimaciones: {
    flete_sugerido_usd: number;
    nota: string;
  };
}

export interface RegistrarCompraPayload {
  id_proveedor: number;
  tipo_compra?: string;
  codigo_orden?: string;
  numero_recibo_local?: string;
  tracking_courier?: string;
  costo_flete_total: number;
  costo_productos_total: number;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  tamano_almacenamiento?: number;
  pantalla?: string;
  numero_serie?: string;
  origen_datos?: string;
  notas?: string;
}

export interface RegistrarCompraResponse {
  status: string;
  message: string;
  id_compra: number;
  id_laptop: number;
  estado_inicial?: string;
}

export interface CompraHistorialItem {
  id_compra: number;
  fecha_compra: string;
  tipo_compra: string;
  codigo_orden?: string | null;
  numero_recibo_local?: string | null;
  tracking_courier?: string | null;
  costo_flete_total: number;
  costo_productos_total: number;
  id_proveedor: number;
  proveedor: string;
  id_laptop?: number | null;
  marca?: string | null;
  procesador?: string | null;
  ram_gb?: number | null;
  estado_flujo?: string | null;
  tipo_item: string;
  detalle_repuestos?: string | null;
}

// ============================================================================
// TIPOS: Taller e Inventario de Repuestos
// ============================================================================
export interface LaptopResumen {
  id_laptop: number;
  numero_serie?: string | null;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  tamano_almacenamiento?: number | null;
  pantalla?: string | null;
  estado_flujo: string;
  costo_adquisicion?: number;
  costo_taller?: number;
  piezas_instaladas?: number;
}

export interface PiezaInstalada {
  id_instalacion: number;
  id_repuesto: number;
  nombre_pieza: string;
  categoria?: string | null;
  cantidad: number;
  costo_unitario_aplicado: number;
  fecha_instalacion: string;
  observaciones?: string | null;
}

export interface LaptopDetalleCompleto {
  laptop: LaptopResumen;
  compra?: {
    id_compra: number;
    fecha_compra: string;
    tipo_compra: string;
    codigo_orden?: string | null;
    tracking_courier?: string | null;
    proveedor: string;
  } | null;
  piezas: PiezaInstalada[];
  diagnosticos: Array<{
    id_diagnostico: number;
    fecha_prueba: string;
    salud_bateria_pct?: number | null;
    resultado_general: string;
  }>;
  venta?: {
    id_venta: number;
    fecha_venta: string;
    precio_venta_final: number;
    metodo_pago: string;
    punto_entrega?: string | null;
    id_garantia?: number | null;
    fecha_vencimiento?: string | null;
    estado_garantia?: string | null;
  } | null;
  bitacora: BitacoraItem[];
}

export interface RepuestoInventario {
  id_repuesto: number;
  nombre_pieza: string;
  categoria?: string | null;
  stock_actual: number;
  costo_unitario_promedio: number;
  valor_stock?: number;
}

export interface InstalarPiezaPayload {
  id_laptop: number;
  id_repuesto: number;
  cantidad: number;
  observaciones?: string;
}

export interface QuitarPiezaPayload {
  id_instalacion: number;
  devolver_a_stock: boolean;
  motivo: string;
}

// ============================================================================
// TIPOS: Ventas
// ============================================================================
export interface LaptopDisponible {
  id_laptop: number;
  numero_serie?: string | null;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  tamano_almacenamiento?: number | null;
  pantalla?: string | null;
  costo_adquisicion?: number;
  costo_taller?: number;
}

export interface GenerarCopyPayload {
  id_laptop?: number;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  precio_estimado: number;
}

export interface GenerarCopyResponse {
  status: string;
  texto_generado: string;
}

export interface RegistrarVentaPayload {
  id_laptop: number;
  precio_venta_final: number;
  punto_entrega: string;
  metodo_pago: string;
  meses_garantia: number;
  notas?: string;
}

export interface VentaHistorialItem {
  id_venta: number;
  id_laptop: number;
  fecha_venta: string;
  precio_venta_final: number;
  punto_entrega: string;
  metodo_pago: string;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  pantalla?: string | null;
  estado_flujo: string;
  id_garantia?: number | null;
  fecha_inicio?: string | null;
  fecha_vencimiento?: string | null;
  estado_garantia?: string | null;
  dias_restantes_garantia?: number;
  costo_adquisicion: number;
  costo_taller: number;
  total_incidencias: number;
  total_reembolsado: number;
}

// ============================================================================
// TIPOS: Garantías y Reclamos
// ============================================================================
export interface GarantiaItem {
  id_garantia: number;
  id_venta: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estado_garantia: string;
  dias_restantes: number;
  id_laptop: number;
  fecha_venta: string;
  precio_venta_final: number;
  punto_entrega?: string | null;
  metodo_pago: string;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  estado_flujo: string;
  total_incidencias: number;
  total_reembolsado: number;
}

export interface IncidenciaItem {
  id_incidencia: number;
  id_garantia: number;
  id_laptop_reemplazo?: number | null;
  fecha_reclamo: string;
  motivo_falla: string;
  es_defecto_fabrica: boolean;
  resolucion: string;
  monto_reembolsado: number;
  detalle_resolucion: string;
  id_venta: number;
  id_laptop: number;
  precio_venta_final: number;
  marca_original: string;
  procesador_original: string;
  marca_reemplazo?: string | null;
  procesador_reemplazo?: string | null;
}

export interface RegistrarIncidenciaPayload {
  id_garantia: number;
  motivo_falla: string;
  es_defecto_fabrica: boolean;
  resolucion: 'Reparado' | 'Reemplazo' | 'Reembolso Efectivo' | 'Nota de Credito';
  detalle_resolucion: string;
  id_repuesto?: number;
  cantidad_repuesto?: number;
  id_laptop_reemplazo?: number;
  estado_laptop_devuelta?: 'En Taller' | 'Devuelta';
  monto_reembolsado?: number;
  devolver_laptop_a_taller?: boolean;
}

// ============================================================================
// TIPOS: Bitácora y Reportes
// ============================================================================
export interface BitacoraItem {
  id_bitacora: number;
  fecha: string;
  modulo: string;
  accion: string;
  id_laptop?: number | null;
  id_referencia?: number | null;
  descripcion: string;
  equipo?: string | null;
}

export interface RentabilidadItem {
  id_venta: number;
  id_laptop: number;
  equipo: string;
  fecha_venta: string;
  punto_entrega?: string | null;
  metodo_pago?: string | null;
  ingreso: number;
  costo_adquisicion: number;
  costo_taller: number;
  monto_reembolsado: number;
  costo_reemplazo: number;
  total_incidencias: number;
  ganancia_neta: number;
}

export interface RentabilidadResponse {
  status: string;
  resumen_global: {
    ingreso_total_usd: number;
    reembolsos_total_usd: number;
    ganancia_neta_total_usd: number;
    inversion_compras_usd: number;
    cantidad_compras: number;
    valor_stock_repuestos_usd: number;
    unidades_repuestos: number;
  };
  detalle_ventas: RentabilidadItem[];
}

export interface ListResponse<T> {
  status: string;
  data: T[];
  movimientos?: any[];
}

// ============================================================================
// Helpers
// ============================================================================
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<{ detail?: unknown; message?: string }>;
    if (err.response) {
      const detail = err.response.data?.detail ?? err.response.data?.message;
      if (typeof detail === 'string') return `(${err.response.status}) ${detail}`;
      if (Array.isArray(detail)) {
        return detail
          .map((d: any) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`)
          .join('\n');
      }
      return `Error ${err.response.status} del servidor.`;
    }
    if (err.code === 'ECONNABORTED') return 'Tiempo de espera agotado. El servidor tardó demasiado.';
    return `No se pudo conectar a ${BASE_URL}.\nVerifica que uvicorn esté corriendo con --host 0.0.0.0 y que el celular/emulador esté en la misma red.`;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido.';
}

export function showApiError(title: string, error: unknown): void {
  Alert.alert(title, getErrorMessage(error));
}

export function formatUSD(value: unknown): string {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? '-' : '';
  const [int, dec] = Math.abs(safe).toFixed(2).split('.');
  return `${sign}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

export function formatFecha(value: unknown): string {
  if (!value) return '';
  const str = String(value);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
