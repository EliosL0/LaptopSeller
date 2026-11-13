import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  formatFecha,
  formatUSD,
  GarantiaItem,
  IncidenciaItem,
  ListResponse,
  RegistrarIncidenciaPayload,
  RepuestoInventario,
  showApiError,
} from '../../services/api';
import { colors, radius, spacing } from '../../constants/theme';

type TabModo = 'polizas' | 'incidencias';
type TipoResolucion = 'Reparado' | 'Reemplazo' | 'Reembolso Efectivo' | 'Nota de Credito';

interface LaptopReemplazoOpcion {
  id_laptop: number;
  marca: string;
  procesador: string;
  ram_gb: number;
  tipo_almacenamiento: string;
  pantalla?: string;
  estado_flujo: string;
}

export default function GarantiasScreen() {
  const [tab, setTab] = useState<TabModo>('polizas');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  const [garantias, setGarantias] = useState<GarantiaItem[]>([]);
  const [incidencias, setIncidencias] = useState<IncidenciaItem[]>([]);

  // Modal para registrar incidencia
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGarantia, setSelectedGarantia] = useState<GarantiaItem | null>(null);

  // Formulario de incidencia
  const [motivoFalla, setMotivoFalla] = useState('');
  const [esDefectoFabrica, setEsDefectoFabrica] = useState(true);
  const [resolucion, setResolucion] = useState<TipoResolucion>('Reparado');
  const [detalleResolucion, setDetalleResolucion] = useState('');

  // Opciones de repuestos para 'Reparado'
  const [repuestos, setRepuestos] = useState<RepuestoInventario[]>([]);
  const [selectedRepuestoId, setSelectedRepuestoId] = useState<number | null>(null);
  const [cantidadRepuesto, setCantidadRepuesto] = useState('1');

  // Opciones para 'Reemplazo'
  const [reemplazos, setReemplazos] = useState<LaptopReemplazoOpcion[]>([]);
  const [selectedReemplazoId, setSelectedReemplazoId] = useState<number | null>(null);
  const [estadoDevuelta, setEstadoDevuelta] = useState<'En Taller' | 'Devuelta'>('En Taller');

  // Opciones para 'Reembolso'
  const [montoReembolso, setMontoReembolso] = useState('');
  const [devolverLaptopATaller, setDevolverLaptopATaller] = useState(true);

  const [guardando, setGuardando] = useState(false);

  const cargarDatos = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [resGar, resInc] = await Promise.all([
        api.get<ListResponse<GarantiaItem>>('/garantias'),
        api.get<ListResponse<IncidenciaItem>>('/garantias/incidencias'),
      ]);
      setGarantias(resGar.data.data ?? []);
      setIncidencias(resInc.data.data ?? []);
    } catch (error) {
      showApiError('Error al cargar garantías', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargarDatos(hasLoadedRef.current ? 'silent' : 'initial');
      hasLoadedRef.current = true;
    }, [cargarDatos]),
  );

  const abrirModalIncidencia = async (garantia?: GarantiaItem) => {
    const target = garantia ?? (garantias.length > 0 ? garantias[0] : null);
    if (!target) {
      Alert.alert('Sin ventas', 'No hay pólizas de garantía registradas todavía.');
      return;
    }
    setSelectedGarantia(target);
    setMotivoFalla('');
    setEsDefectoFabrica(true);
    setResolucion('Reparado');
    setDetalleResolucion('');
    setSelectedRepuestoId(null);
    setCantidadRepuesto('1');
    setSelectedReemplazoId(null);
    setEstadoDevuelta('En Taller');
    setMontoReembolso(String(target.precio_venta_final || ''));
    setDevolverLaptopATaller(true);

    try {
      const [resRep, resReemp] = await Promise.all([
        api.get<ListResponse<RepuestoInventario>>('/taller/repuestos'),
        api.get<ListResponse<LaptopReemplazoOpcion>>('/garantias/reemplazos-disponibles'),
      ]);
      setRepuestos(resRep.data.data ?? []);
      setReemplazos(resReemp.data.data ?? []);
    } catch {
      // Ignorar fallo de precarga secundaria
    }

    setModalVisible(true);
  };

  const guardarIncidencia = async () => {
    if (!selectedGarantia) return;
    const errores: string[] = [];

    if (!motivoFalla.trim()) errores.push('Indica el motivo de la falla o reclamo.');
    if (!detalleResolucion.trim()) errores.push('Escribe el detalle de cómo se resolvió el caso.');

    if (resolucion === 'Reemplazo' && !selectedReemplazoId) {
      errores.push('Selecciona la laptop que se entregará al cliente en reemplazo.');
    }

    let montoFinal = 0;
    if (resolucion === 'Reembolso Efectivo' || resolucion === 'Nota de Credito') {
      montoFinal = parseFloat(montoReembolso.replace(',', '.'));
      if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
        errores.push('Ingresa un monto de reembolso válido mayor a 0.');
      }
    }

    let cantRep = 1;
    if (resolucion === 'Reparado' && selectedRepuestoId) {
      cantRep = parseInt(cantidadRepuesto, 10);
      if (!Number.isInteger(cantRep) || cantRep <= 0) {
        errores.push('Cantidad de repuestos inválida.');
      }
    }

    if (errores.length) {
      Alert.alert('Revisa los datos', errores.join('\n'));
      return;
    }

    const payload: RegistrarIncidenciaPayload = {
      id_garantia: selectedGarantia.id_garantia,
      motivo_falla: motivoFalla.trim(),
      es_defecto_fabrica: esDefectoFabrica,
      resolucion,
      detalle_resolucion: detalleResolucion.trim(),
      id_repuesto: selectedRepuestoId ?? undefined,
      cantidad_repuesto: selectedRepuestoId ? cantRep : undefined,
      id_laptop_reemplazo: selectedReemplazoId ?? undefined,
      estado_laptop_devuelta: estadoDevuelta,
      monto_reembolsado: montoFinal,
      devolver_laptop_a_taller: devolverLaptopATaller,
    };

    setGuardando(true);
    try {
      const { data } = await api.post<{ status: string; message: string; id_incidencia: number }>(
        '/garantias/incidencias',
        payload,
      );
      setModalVisible(false);
      Alert.alert('Incidencia procesada ✅', `${data.message}\nRegistro escrito guardado en la bitácora.`);
      await cargarDatos('silent');
      setTab('incidencias');
    } catch (error) {
      showApiError('Error al registrar incidencia', error);
    } finally {
      setGuardando(false);
    }
  };

  const renderPoliza = ({ item }: { item: GarantiaItem }) => {
    const vigente = item.estado_garantia === 'Vigente';
    const dias = item.dias_restantes ?? 0;
    const colorEstado = vigente ? (dias <= 15 ? colors.warning : colors.success) : colors.textMuted;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardId}>Póliza #{item.id_garantia} · Venta #{item.id_venta}</Text>
            <Text style={styles.marca} numberOfLines={1}>{item.marca}</Text>
            <Text style={styles.subtext}>
              {item.procesador} · {item.ram_gb}GB · {item.tipo_almacenamiento}
            </Text>
          </View>
          <View style={[styles.badge, { borderColor: colorEstado, backgroundColor: `${colorEstado}22` }]}>
            <Text style={[styles.badgeText, { color: colorEstado }]}>
              {vigente ? `${dias}d vigentes` : item.estado_garantia}
            </Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Vendido por</Text>
            <Text style={styles.infoVal}>{formatUSD(item.precio_venta_final)}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Fecha venta</Text>
            <Text style={styles.infoVal}>{formatFecha(item.fecha_venta)}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Vencimiento</Text>
            <Text style={styles.infoVal}>{formatFecha(item.fecha_vencimiento)}</Text>
          </View>
        </View>

        {item.total_incidencias > 0 && (
          <View style={styles.warningStrip}>
            <Ionicons name="warning" size={16} color={colors.warning} />
            <Text style={styles.warningText}>
              {item.total_incidencias} reclamo(s) registrado(s) · Reembolsos: {formatUSD(item.total_reembolsado)}
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => abrirModalIncidencia(item)}
          style={({ pressed }) => [styles.btnReclamo, pressed && styles.pressed]}
        >
          <Ionicons name="shield-half" size={18} color="#fff" />
          <Text style={styles.btnReclamoText}>Procesar Reclamo / Incidencia</Text>
        </Pressable>
      </View>
    );
  };

  const renderIncidencia = ({ item }: { item: IncidenciaItem }) => {
    let colorRes = colors.primary;
    let iconName: any = 'build';
    if (item.resolucion === 'Reemplazo') {
      colorRes = colors.accent;
      iconName = 'swap-horizontal';
    } else if (item.resolucion.includes('Reembolso') || item.resolucion.includes('Credito')) {
      colorRes = colors.danger;
      iconName = 'cash';
    }

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardId}>
              Incidencia #{item.id_incidencia} · {formatFecha(item.fecha_reclamo)}
            </Text>
            <Text style={styles.marca} numberOfLines={1}>{item.marca_original} (Venta #{item.id_venta})</Text>
          </View>
          <View style={[styles.badge, { borderColor: colorRes, backgroundColor: `${colorRes}22` }]}>
            <Ionicons name={iconName} size={14} color={colorRes} style={{ marginRight: 4 }} />
            <Text style={[styles.badgeText, { color: colorRes }]}>{item.resolucion}</Text>
          </View>
        </View>

        <View style={styles.blockRow}>
          <Text style={styles.blockLabel}>Motivo:</Text>
          <Text style={styles.blockValue}>{item.motivo_falla}</Text>
        </View>

        {item.marca_reemplazo ? (
          <View style={styles.blockRow}>
            <Text style={styles.blockLabel}>Equipo reemplazo:</Text>
            <Text style={[styles.blockValue, { color: colors.accent, fontWeight: '700' }]}>
              #{item.id_laptop_reemplazo} {item.marca_reemplazo} {item.procesador_reemplazo}
            </Text>
          </View>
        ) : null}

        {item.monto_reembolsado > 0 ? (
          <View style={styles.blockRow}>
            <Text style={styles.blockLabel}>Monto reembolsado:</Text>
            <Text style={[styles.blockValue, { color: colors.danger, fontWeight: '700' }]}>
              {formatUSD(item.monto_reembolsado)}
            </Text>
          </View>
        ) : null}

        <View style={styles.blockResolucion}>
          <Text style={styles.blockLabel}>Registro escrito de la resolución:</Text>
          <Text style={styles.resolucionTexto}>{item.detalle_resolucion}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando garantías...</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Selector de modo */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('polizas')}
          style={[styles.tabButton, tab === 'polizas' && styles.tabButtonActive]}
        >
          <Ionicons
            name="shield-checkmark"
            size={18}
            color={tab === 'polizas' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabText, tab === 'polizas' && styles.tabTextActive]}>
            Pólizas Activas ({garantias.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('incidencias')}
          style={[styles.tabButton, tab === 'incidencias' && styles.tabButtonActive]}
        >
          <Ionicons
            name="list-circle"
            size={18}
            color={tab === 'incidencias' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabText, tab === 'incidencias' && styles.tabTextActive]}>
            Historial Reclamos ({incidencias.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'polizas' ? (
        <FlatList
          data={garantias}
          keyExtractor={(item) => String(item.id_garantia)}
          renderItem={renderPoliza}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => cargarDatos('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerEmpty}>
              <Ionicons name="shield-outline" size={54} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Sin garantías</Text>
              <Text style={styles.muted}>Las pólizas se crean automáticamente al registrar una venta.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={incidencias}
          keyExtractor={(item) => String(item.id_incidencia)}
          renderItem={renderIncidencia}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => cargarDatos('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerEmpty}>
              <Ionicons name="checkmark-done-circle-outline" size={54} color={colors.success} />
              <Text style={styles.emptyTitle}>Cero reclamos</Text>
              <Text style={styles.muted}>No hay incidencias reportadas. Todo en orden.</Text>
            </View>
          }
        />
      )}

      {/* MODAL PARA PROCESAR INCIDENCIA */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Procesar Garantía / Reclamo</Text>
                {selectedGarantia && (
                  <Text style={styles.sheetSub}>
                    Laptop #{selectedGarantia.id_laptop} · {selectedGarantia.marca} · Venta #{selectedGarantia.id_venta}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              {/* Motivo de la falla */}
              <Text style={styles.formLabel}>Motivo de la falla o reclamo *</Text>
              <TextInput
                value={motivoFalla}
                onChangeText={setMotivoFalla}
                placeholder="Ej. Batería no carga, pantalla parpadea, etc."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              {/* Defecto de fábrica */}
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>¿Es defecto de fábrica o vicio oculto?</Text>
                <Switch
                  value={esDefectoFabrica}
                  onValueChange={setEsDefectoFabrica}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {/* Selector de tipo de resolución */}
              <Text style={styles.formLabel}>Tipo de resolución del caso *</Text>
              <View style={styles.chipGroup}>
                {(['Reparado', 'Reemplazo', 'Reembolso Efectivo', 'Nota de Credito'] as TipoResolucion[]).map((res) => {
                  const active = resolucion === res;
                  return (
                    <Pressable
                      key={res}
                      onPress={() => setResolucion(res)}
                      style={[styles.resChip, active && styles.resChipActive]}
                    >
                      <Text style={[styles.resChipText, active && styles.resChipTextActive]}>{res}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* CASO 1: REPARADO -> Instalar pieza sin costo */}
              {resolucion === 'Reparado' && (
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Instalar pieza del taller (sin costo al cliente)</Text>
                  <Text style={styles.subCardHint}>
                    Opcional: Si necesitas cambiar una pieza (ej. batería, SSD, RAM), selecciónala. Se descontará del stock
                    y se registrará como gasto de garantía.
                  </Text>
                  <View style={styles.chipGroup}>
                    <Pressable
                      onPress={() => setSelectedRepuestoId(null)}
                      style={[styles.pieceChip, selectedRepuestoId === null && styles.pieceChipActive]}
                    >
                      <Text style={[styles.pieceChipText, selectedRepuestoId === null && styles.pieceChipTextActive]}>
                        Ninguna (solo mano de obra / ajuste)
                      </Text>
                    </Pressable>
                    {repuestos.map((r) => {
                      const sel = selectedRepuestoId === r.id_repuesto;
                      return (
                        <Pressable
                          key={r.id_repuesto}
                          onPress={() => setSelectedRepuestoId(r.id_repuesto)}
                          style={[styles.pieceChip, sel && styles.pieceChipActive]}
                        >
                          <Text style={[styles.pieceChipText, sel && styles.pieceChipTextActive]}>
                            {r.nombre_pieza} (Stock: {r.stock_actual})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {selectedRepuestoId && (
                    <View style={{ marginTop: spacing.sm }}>
                      <Text style={styles.formLabel}>Cantidad de piezas</Text>
                      <TextInput
                        value={cantidadRepuesto}
                        onChangeText={setCantidadRepuesto}
                        keyboardType="number-pad"
                        placeholder="1"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, { width: 100 }]}
                      />
                    </View>
                  )}
                </View>
              )}

              {/* CASO 2: REEMPLAZO -> Seleccionar laptop nueva */}
              {resolucion === 'Reemplazo' && (
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Seleccionar laptop de reemplazo</Text>
                  <Text style={styles.subCardHint}>
                    Se entregará al cliente esta laptop (pasará a 'Vendido') y la laptop dañada volverá al taller.
                  </Text>
                  {reemplazos.length === 0 ? (
                    <Text style={[styles.muted, { marginVertical: spacing.md }]}>
                      No hay otras laptops disponibles en inventario para reemplazo.
                    </Text>
                  ) : (
                    <View style={styles.chipGroup}>
                      {reemplazos
                        .filter((r) => r.id_laptop !== selectedGarantia?.id_laptop)
                        .map((r) => {
                          const sel = selectedReemplazoId === r.id_laptop;
                          return (
                            <Pressable
                              key={r.id_laptop}
                              onPress={() => setSelectedReemplazoId(r.id_laptop)}
                              style={[styles.pieceChip, sel && styles.pieceChipActive]}
                            >
                              <Text style={[styles.pieceChipText, sel && styles.pieceChipTextActive]}>
                                #{r.id_laptop} {r.marca} ({r.procesador} · {r.ram_gb}GB · {r.estado_flujo})
                              </Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  )}

                  <Text style={[styles.formLabel, { marginTop: spacing.md }]}>
                    Estado de la laptop devuelta al regresar al taller:
                  </Text>
                  <View style={styles.chipGroup}>
                    {(['En Taller', 'Devuelta'] as const).map((st) => (
                      <Pressable
                        key={st}
                        onPress={() => setEstadoDevuelta(st)}
                        style={[styles.pieceChip, estadoDevuelta === st && styles.pieceChipActive]}
                      >
                        <Text style={[styles.pieceChipText, estadoDevuelta === st && styles.pieceChipTextActive]}>
                          {st}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* CASO 3: REEMBOLSO / NOTA DE CRÉDITO */}
              {(resolucion === 'Reembolso Efectivo' || resolucion === 'Nota de Credito') && (
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Monto a devolver (USD)</Text>
                  <TextInput
                    value={montoReembolso}
                    onChangeText={setMontoReembolso}
                    placeholder="250.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />

                  <View style={[styles.switchRow, { marginTop: spacing.md }]}>
                    <Text style={styles.switchLabel}>¿El cliente devuelve la laptop al taller?</Text>
                    <Switch
                      value={devolverLaptopATaller}
                      onValueChange={setDevolverLaptopATaller}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#fff"
                    />
                  </View>
                </View>
              )}

              {/* Detalle escrito obligatorio */}
              <Text style={styles.formLabel}>Registro escrito de lo que pasó (Justificación técnica) *</Text>
              <TextInput
                value={detalleResolucion}
                onChangeText={setDetalleResolucion}
                multiline
                numberOfLines={3}
                placeholder="Describe qué revisión técnica se hizo, qué acuerdo se tuvo con el cliente y qué acciones se tomaron..."
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textArea]}
                textAlignVertical="top"
              />

              <Pressable
                onPress={guardarIncidencia}
                disabled={guardando}
                style={({ pressed }) => [styles.btnGuardar, pressed && styles.pressed, guardando && styles.disabled]}
              >
                {guardando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.btnGuardarText}>Registrar y Dejar Asentado en Bitácora</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: 40 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: colors.primary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  centerEmpty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardId: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  marca: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 2 },
  subtext: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  infoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  infoCol: { flex: 1 },
  infoLabel: { color: colors.textMuted, fontSize: 11 },
  infoVal: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
  warningStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(245,158,11,0.15)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  warningText: { color: colors.warning, fontSize: 12, fontWeight: '600', flex: 1 },
  btnReclamo: {
    marginTop: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  btnReclamoText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  blockRow: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  blockLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  blockValue: { color: colors.text, fontSize: 12, flex: 1 },
  blockResolucion: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  resolucionTexto: { color: colors.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sheetSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  sheetBody: { padding: spacing.lg, paddingBottom: 40 },
  formLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 80 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  switchLabel: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  resChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  resChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  resChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  resChipTextActive: { color: '#fff' },
  subCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subCardTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  subCardHint: { color: colors.textMuted, fontSize: 11, marginTop: 2, marginBottom: spacing.xs },
  pieceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  pieceChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}33` },
  pieceChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  pieceChipTextActive: { color: colors.primary },
  btnGuardar: {
    marginTop: spacing.xl,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnGuardarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});

