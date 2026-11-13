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
  Share,
  StyleSheet,
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
  GenerarCopyPayload,
  GenerarCopyResponse,
  LaptopDisponible,
  ListResponse,
  RegistrarVentaPayload,
  showApiError,
  VentaHistorialItem,
} from '../../services/api';
import { colors, radius, spacing } from '../../constants/theme';

type TabVentas = 'disponibles' | 'historial';

const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta'];
const PUNTOS_RAPIDOS = ['Metrocentro', 'Galerías Santo Domingo', 'Plaza Inter', 'Multicentro Las Américas', 'Delivery'];

export default function VentasScreen() {
  const [tab, setTab] = useState<TabVentas>('disponibles');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  // Listados
  const [laptops, setLaptops] = useState<LaptopDisponible[]>([]);
  const [historial, setHistorial] = useState<VentaHistorialItem[]>([]);

  // Panel modal de venta
  const [selected, setSelected] = useState<LaptopDisponible | null>(null);
  const [precioEstimado, setPrecioEstimado] = useState('');
  const [copy, setCopy] = useState('');
  const [generandoCopy, setGenerandoCopy] = useState(false);

  // Formulario de venta
  const [precioVentaFinal, setPrecioVentaFinal] = useState('');
  const [puntoEntrega, setPuntoEntrega] = useState('Metrocentro');
  const [metodoPago, setMetodoPago] = useState('Efectivo');
  const [mesesGarantia, setMesesGarantia] = useState('3');
  const [notasVenta, setNotasVenta] = useState('');
  const [registrando, setRegistrando] = useState(false);

  const cargarDatos = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [resDisp, resHist] = await Promise.all([
        api.get<ListResponse<LaptopDisponible>>('/ventas/disponibles'),
        api.get<ListResponse<VentaHistorialItem>>('/ventas/historial'),
      ]);
      setLaptops(resDisp.data.data ?? []);
      setHistorial(resHist.data.data ?? []);
    } catch (error) {
      showApiError('Error al cargar ventas', error);
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

  const abrirPanel = (laptop: LaptopDisponible) => {
    setSelected(laptop);
    setPrecioEstimado('');
    setCopy('');
    setPrecioVentaFinal('');
    setPuntoEntrega('Metrocentro');
    setMetodoPago('Efectivo');
    setMesesGarantia('3');
    setNotasVenta('');
  };

  const cerrarPanel = () => {
    if (registrando || generandoCopy) return;
    setSelected(null);
  };

  const generarCopy = async () => {
    if (!selected) return;
    const precio = parseFloat(precioEstimado.replace(',', '.'));
    if (!Number.isFinite(precio) || precio <= 0) {
      Alert.alert('Precio requerido', 'Ingresa el precio estimado de publicación en USD.');
      return;
    }

    const payload: GenerarCopyPayload = {
      id_laptop: selected.id_laptop,
      marca: selected.marca,
      procesador: selected.procesador,
      ram_gb: Number(selected.ram_gb),
      tipo_almacenamiento: selected.tipo_almacenamiento ?? 'SSD',
      precio_estimado: precio,
    };

    setGenerandoCopy(true);
    try {
      const { data } = await api.post<GenerarCopyResponse>('/ventas/generar-copy', payload);
      setCopy(data.texto_generado ?? '');
      if (!precioVentaFinal) setPrecioVentaFinal(String(precio));
    } catch (error) {
      showApiError('Error al generar copy', error);
    } finally {
      setGenerandoCopy(false);
    }
  };

  const compartirCopy = async () => {
    if (!copy) return;
    try {
      await Share.share({ message: copy });
    } catch (error) {
      showApiError('Error al compartir', error);
    }
  };

  const registrarVenta = async () => {
    if (!selected) return;
    const precio = parseFloat(precioVentaFinal.replace(',', '.'));
    const meses = parseInt(mesesGarantia, 10);

    const errores: string[] = [];
    if (!Number.isFinite(precio) || precio <= 0) errores.push('Precio de venta final inválido');
    if (!puntoEntrega.trim()) errores.push('Punto de entrega requerido');
    if (!metodoPago.trim()) errores.push('Método de pago requerido');
    if (!Number.isInteger(meses) || meses < 0) errores.push('Meses de garantía inválidos');
    if (errores.length) {
      Alert.alert('Revisa el formulario', errores.join('\n'));
      return;
    }

    const payload: RegistrarVentaPayload = {
      id_laptop: selected.id_laptop,
      precio_venta_final: precio,
      punto_entrega: puntoEntrega.trim(),
      metodo_pago: metodoPago.trim(),
      meses_garantia: meses,
      notas: notasVenta.trim() || undefined,
    };

    setRegistrando(true);
    try {
      const { data } = await api.post<{ status: string; message: string; id_venta: number; id_garantia: number }>(
        '/ventas/registrar',
        payload,
      );
      setSelected(null);
      Alert.alert(
        'Venta registrada 💰',
        `${data.message}\n\nID Venta: #${data.id_venta}\nPóliza de Garantía: #${data.id_garantia} (${meses} meses)\n\nSe registró salida de inventario y se guardó en la bitácora.`,
        [
          {
            text: 'Ver en Registro',
            onPress: () => {
              setTab('historial');
              cargarDatos('silent');
            },
          },
          { text: 'OK' },
        ],
      );
      await cargarDatos('silent');
    } catch (error) {
      showApiError('Error al registrar venta', error);
    } finally {
      setRegistrando(false);
    }
  };

  const renderDisponible = ({ item }: { item: LaptopDisponible }) => {
    const costoTotal = (item.costo_adquisicion ?? 0) + (item.costo_taller ?? 0);
    return (
      <Pressable onPress={() => abrirPanel(item)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.cardIcon}>
          <Ionicons name="laptop-outline" size={28} color={colors.primary} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.marca} numberOfLines={1}>{item.marca}</Text>
          <Text style={styles.procesador} numberOfLines={1}>{item.procesador}</Text>
          <View style={styles.tagsRow}>
            <Text style={styles.tag}>{item.ram_gb} GB</Text>
            <Text style={styles.tag}>{item.tipo_almacenamiento}</Text>
            {item.pantalla ? <Text style={styles.tag}>{item.pantalla}</Text> : null}
          </View>
          <Text style={styles.costoAcumulado}>
            Costo acumulado: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatUSD(costoTotal)}</Text>
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.idText}>#{item.id_laptop}</Text>
          <View style={styles.badgeVender}>
            <Text style={styles.badgeVenderText}>Vender</Text>
            <Ionicons name="chevron-forward" size={14} color="#fff" />
          </View>
        </View>
      </Pressable>
    );
  };

  const renderHistorialItem = useCallback(({ item }: { item: VentaHistorialItem }) => {
    const costo = (item.costo_adquisicion ?? 0) + (item.costo_taller ?? 0);
    const ganancia = item.precio_venta_final - costo - (item.total_reembolsado ?? 0);
    const diasGar = item.dias_restantes_garantia ?? 0;
    const vigente = item.estado_garantia === 'Vigente';

    return (
      <View style={styles.cardHistorial}>
        <View style={styles.histHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.histId}>Venta #{item.id_venta} · {formatFecha(item.fecha_venta)}</Text>
            <Text style={styles.marca} numberOfLines={1}>{item.marca}</Text>
            <Text style={styles.subtext}>
              #{item.id_laptop} · {item.procesador} · {item.ram_gb}GB · {item.tipo_almacenamiento}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.histPrecio}>{formatUSD(item.precio_venta_final)}</Text>
            <Text style={styles.histMetodo}>{item.metodo_pago}</Text>
          </View>
        </View>

        <View style={styles.histInfoRow}>
          <Text style={styles.histInfoLabel}>Entrega: {item.punto_entrega}</Text>
          <Text style={[styles.histInfoLabel, { color: ganancia >= 0 ? colors.success : colors.danger, fontWeight: '800' }]}>
            Ganancia: {formatUSD(ganancia)}
          </Text>
        </View>

        {item.id_garantia ? (
          <View style={styles.garantiaStrip}>
            <Ionicons
              name={vigente ? 'shield-checkmark' : 'shield-outline'}
              size={16}
              color={vigente ? colors.success : colors.textMuted}
            />
            <Text style={styles.garantiaStripText}>
              Garantía #{item.id_garantia}: {vigente ? `${diasGar} días restantes` : item.estado_garantia}
            </Text>
          </View>
        ) : null}

        {item.total_incidencias > 0 && (
          <View style={styles.incidenciaStrip}>
            <Ionicons name="warning" size={14} color={colors.warning} />
            <Text style={styles.incidenciaStripText}>
              {item.total_incidencias} reclamo(s) atendido(s) · Reembolsos: {formatUSD(item.total_reembolsado)}
            </Text>
          </View>
        )}
      </View>
    );
  }, []);

  const emptyDisponibles = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="storefront-outline" size={54} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin inventario listo</Text>
        <Text style={styles.muted}>
          Pasa laptops a "Lista para Venta" desde la pestaña Taller para que aparezcan aquí.
        </Text>
      </View>
    ),
    [],
  );

  const emptyHistorialVentas = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="receipt-outline" size={54} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin ventas registradas</Text>
        <Text style={styles.muted}>Las ventas cerradas aparecerán aquí con su garantía.</Text>
      </View>
    ),
    [],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando ventas y marketplace...</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Sub-tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('disponibles')}
          style={[styles.tabButton, tab === 'disponibles' && styles.tabButtonActive]}
        >
          <Ionicons name="pricetag" size={18} color={tab === 'disponibles' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'disponibles' && styles.tabTextActive]}>
            Listas para Venta ({laptops.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('historial')}
          style={[styles.tabButton, tab === 'historial' && styles.tabButtonActive]}
        >
          <Ionicons name="receipt" size={18} color={tab === 'historial' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'historial' && styles.tabTextActive]}>
            Registro de Ventas ({historial.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'disponibles' ? (
        <FlatList
          style={styles.flex}
          contentContainerStyle={[styles.listContent, laptops.length === 0 && styles.flexGrow]}
          data={laptops ?? []}
          keyExtractor={(item) => String(item.id_laptop)}
          renderItem={renderDisponible}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => cargarDatos('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListHeaderComponent={
            laptops.length > 0 ? (
              <Text style={styles.header}>{laptops.length} equipo(s) listos para vender · toca para vender</Text>
            ) : null
          }
          ListEmptyComponent={emptyDisponibles}
        />
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          data={historial ?? []}
          keyExtractor={(item) => String(item.id_venta)}
          renderItem={renderHistorialItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => cargarDatos('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={emptyHistorialVentas}
        />
      )}

      {/* MODAL / BOTTOM SHEET DE VENTA */}
      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={cerrarPanel}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={cerrarPanel} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            {selected && (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
                <View style={styles.sheetHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.sheetTitle} numberOfLines={1}>{selected.marca}</Text>
                    <Text style={styles.procesador}>
                      #{selected.id_laptop} · {selected.procesador} · {selected.ram_gb}GB · {selected.tipo_almacenamiento}
                    </Text>
                    <Text style={styles.costoReferencia}>
                      Costo total acumulado: {formatUSD((selected.costo_adquisicion ?? 0) + (selected.costo_taller ?? 0))}
                    </Text>
                  </View>
                  <Pressable onPress={cerrarPanel} hitSlop={12}>
                    <Ionicons name="close-circle" size={30} color={colors.textMuted} />
                  </Pressable>
                </View>

                {/* Generar Copy IA */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Publicación con IA (Marketplace)</Text>
                  <Text style={styles.label}>Precio estimado de publicación (USD)</Text>
                  <View style={styles.row}>
                    <TextInput
                      value={precioEstimado}
                      onChangeText={setPrecioEstimado}
                      placeholder="250.00"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      style={[styles.input, styles.flex]}
                    />
                    <Pressable
                      onPress={generarCopy}
                      disabled={generandoCopy}
                      style={({ pressed }) => [styles.aiButton, pressed && styles.pressed, generandoCopy && styles.disabled]}
                    >
                      {generandoCopy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="sparkles" size={16} color="#fff" />
                          <Text style={styles.aiButtonText}>Generar Copy</Text>
                        </>
                      )}
                    </Pressable>
                  </View>

                  {copy ? (
                    <>
                      <TextInput
                        value={copy}
                        onChangeText={setCopy}
                        multiline
                        scrollEnabled={false}
                        selectTextOnFocus
                        style={styles.copyBox}
                        textAlignVertical="top"
                      />
                      <Pressable onPress={compartirCopy} style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}>
                        <Ionicons name="share-social" size={18} color={colors.primary} />
                        <Text style={styles.shareText}>Compartir / Copiar Texto</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>

                {/* Formulario de venta */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Registrar Venta y Emitir Garantía</Text>

                  <Text style={styles.label}>Precio de venta final (USD) *</Text>
                  <TextInput
                    value={precioVentaFinal}
                    onChangeText={setPrecioVentaFinal}
                    placeholder="240.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />

                  <Text style={styles.label}>Punto de entrega</Text>
                  <TextInput
                    value={puntoEntrega}
                    onChangeText={setPuntoEntrega}
                    placeholder="Ej. Metrocentro"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                  <View style={styles.chipsRow}>
                    {PUNTOS_RAPIDOS.map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setPuntoEntrega(p)}
                        style={[styles.chip, puntoEntrega === p && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, puntoEntrega === p && styles.chipTextActive]}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Método de pago</Text>
                  <View style={styles.chipsRow}>
                    {METODOS_PAGO.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setMetodoPago(m)}
                        style={[styles.chipLarge, metodoPago === m && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, metodoPago === m && styles.chipTextActive]}>{m}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Meses de garantía</Text>
                  <TextInput
                    value={mesesGarantia}
                    onChangeText={setMesesGarantia}
                    placeholder="3"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />

                  <Text style={styles.label}>Notas de la venta (Registro escrito)</Text>
                  <TextInput
                    value={notasVenta}
                    onChangeText={setNotasVenta}
                    placeholder="Ej. Cliente pagó mitad en dólares y mitad en córdobas, se entregó con cargador nuevo..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={2}
                    style={[styles.input, { minHeight: 60 }]}
                  />

                  <Pressable
                    onPress={registrarVenta}
                    disabled={registrando}
                    style={({ pressed }) => [styles.sellButton, pressed && styles.pressed, registrando && styles.disabled]}
                  >
                    {registrando ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="cash" size={22} color="#fff" />
                        <Text style={styles.sellText}>Cerrar Venta y Emitir Póliza</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexGrow: { flexGrow: 1 },
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
  header: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: { flex: 1 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  idText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  badgeVender: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.success,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  badgeVenderText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  marca: { color: colors.text, fontSize: 17, fontWeight: '800' },
  procesador: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  subtext: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  tag: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  costoAcumulado: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  costoReferencia: { color: colors.warning, fontSize: 12, fontWeight: '700', marginTop: 4 },
  cardHistorial: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  histHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  histId: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  histPrecio: { color: colors.success, fontSize: 18, fontWeight: '900' },
  histMetodo: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  histInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  histInfoLabel: { color: colors.textMuted, fontSize: 12 },
  garantiaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  garantiaStripText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  incidenciaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,158,11,0.15)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: 4,
  },
  incidenciaStripText: { color: colors.warning, fontSize: 11, fontWeight: '600' },
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
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: 40 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  section: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: spacing.xs },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
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
  aiButton: {
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  copyBox: {
    marginTop: spacing.md,
    minHeight: 140,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.md,
    fontSize: 13,
    lineHeight: 18,
  },
  shareButton: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  shareText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipLarge: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#fff' },
  sellButton: {
    marginTop: spacing.xl,
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sellText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
