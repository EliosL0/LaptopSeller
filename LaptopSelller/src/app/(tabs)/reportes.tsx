import { useCallback, useRef, useState } from 'react';
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
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  BitacoraItem,
  formatFecha,
  formatUSD,
  ListResponse,
  RentabilidadItem,
  RentabilidadResponse,
  showApiError,
} from '../../services/api';
import { colors, radius, spacing } from '../../constants/theme';

type TabReporte = 'finanzas' | 'bitacora';

export default function ReportesScreen() {
  const [tab, setTab] = useState<TabReporte>('finanzas');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  // Finanzas
  const [resumen, setResumen] = useState<RentabilidadResponse['resumen_global']>({
    ingreso_total_usd: 0,
    reembolsos_total_usd: 0,
    ganancia_neta_total_usd: 0,
    inversion_compras_usd: 0,
    cantidad_compras: 0,
    valor_stock_repuestos_usd: 0,
    unidades_repuestos: 0,
  });
  const [ventas, setVentas] = useState<RentabilidadItem[]>([]);

  // Bitácora
  const [bitacora, setBitacora] = useState<BitacoraItem[]>([]);
  const [modalNotaVisible, setModalNotaVisible] = useState(false);
  const [notaModulo, setNuevoNotaModulo] = useState('Nota');
  const [notaDescripcion, setNotaDescripcion] = useState('');
  const [guardandoNota, setGuardandoNota] = useState(false);

  const cargarDatos = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [resRent, resBit] = await Promise.all([
        api.get<RentabilidadResponse>('/reportes/rentabilidad'),
        api.get<ListResponse<BitacoraItem>>('/bitacora'),
      ]);
      setResumen(resRent.data.resumen_global);
      setVentas(resRent.data.detalle_ventas ?? []);
      setBitacora(resBit.data.data ?? []);
    } catch (error) {
      showApiError('Error al cargar reportes y bitácora', error);
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

  const guardarNotaManual = async () => {
    if (!notaDescripcion.trim()) {
      Alert.alert('Nota requerida', 'Escribe el texto de la nota.');
      return;
    }
    setGuardandoNota(true);
    try {
      const { data } = await api.post<{ status: string; message: string }>('/bitacora', {
        modulo: notaModulo,
        descripcion: notaDescripcion.trim(),
      });
      Alert.alert('Nota guardada ✅', data.message);
      setModalNotaVisible(false);
      setNotaDescripcion('');
      await cargarDatos('silent');
    } catch (error) {
      showApiError('Error al guardar nota', error);
    } finally {
      setGuardandoNota(false);
    }
  };

  const margenGlobal =
    resumen.ingreso_total_usd > 0
      ? (resumen.ganancia_neta_total_usd / resumen.ingreso_total_usd) * 100
      : 0;

  const renderVentaItem = ({ item }: { item: RentabilidadItem }) => {
    const ganancia = Number(item.ganancia_neta ?? 0);
    const positiva = ganancia >= 0;
    const costoTotal = Number(item.costo_adquisicion ?? 0) + Number(item.costo_taller ?? 0);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardId}>Venta #{item.id_venta} · {formatFecha(item.fecha_venta)}</Text>
            <Text style={styles.marca} numberOfLines={1}>{item.equipo}</Text>
          </View>
          <Text style={[styles.profitBadge, { color: positiva ? colors.success : colors.danger }]}>
            {positiva ? '+' : ''}
            {formatUSD(ganancia)}
          </Text>
        </View>

        <View style={styles.costosGrid}>
          <View style={styles.costoCol}>
            <Text style={styles.costoColLabel}>Ingreso</Text>
            <Text style={styles.costoColVal}>{formatUSD(item.ingreso)}</Text>
          </View>
          <View style={styles.costoCol}>
            <Text style={styles.costoColLabel}>Adquisición</Text>
            <Text style={styles.costoColVal}>{formatUSD(item.costo_adquisicion)}</Text>
          </View>
          <View style={styles.costoCol}>
            <Text style={styles.costoColLabel}>Taller</Text>
            <Text style={styles.costoColVal}>{formatUSD(item.costo_taller)}</Text>
          </View>
          {item.monto_reembolsado > 0 ? (
            <View style={styles.costoCol}>
              <Text style={[styles.costoColLabel, { color: colors.danger }]}>Reembolso</Text>
              <Text style={[styles.costoColVal, { color: colors.danger }]}>{formatUSD(item.monto_reembolsado)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderBitacoraItem = ({ item }: { item: BitacoraItem }) => {
    let colorMod = colors.primary;
    if (item.modulo === 'Compras') colorMod = colors.warning;
    if (item.modulo === 'Ventas') colorMod = colors.success;
    if (item.modulo === 'Garantias') colorMod = colors.danger;
    if (item.modulo === 'Inventario') colorMod = colors.accent;

    return (
      <View style={styles.cardBitacora}>
        <View style={styles.bitHeader}>
          <View style={[styles.badgeMod, { borderColor: colorMod, backgroundColor: `${colorMod}22` }]}>
            <Text style={[styles.badgeModText, { color: colorMod }]}>{item.modulo}</Text>
          </View>
          <Text style={styles.bitAccion}>{item.accion}</Text>
          <Text style={styles.bitFecha}>{formatFecha(item.fecha)}</Text>
        </View>

        {item.equipo ? (
          <Text style={styles.bitEquipo}>
            Equipo #{item.id_laptop} · {item.equipo}
          </Text>
        ) : null}

        <Text style={styles.bitDesc}>{item.descripcion}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Calculando métricas del ERP...</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Sub-tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('finanzas')}
          style={[styles.tabButton, tab === 'finanzas' && styles.tabButtonActive]}
        >
          <Ionicons name="bar-chart" size={18} color={tab === 'finanzas' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'finanzas' && styles.tabTextActive]}>
            Rentabilidad y Métricas
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('bitacora')}
          style={[styles.tabButton, tab === 'bitacora' && styles.tabButtonActive]}
        >
          <Ionicons name="journal" size={18} color={tab === 'bitacora' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'bitacora' && styles.tabTextActive]}>
            Bitácora Escrita ({bitacora.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'finanzas' ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={ventas}
          keyExtractor={(item) => String(item.id_venta)}
          renderItem={renderVentaItem}
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
            <View>
              {/* Tarjeta Ganancia Neta */}
              <View
                style={[
                  styles.hero,
                  resumen.ganancia_neta_total_usd >= 0 ? styles.heroGanancia : styles.heroPerdida,
                ]}
              >
                <View style={styles.heroTop}>
                  <Ionicons name="trophy" size={22} color="#BBF7D0" />
                  <Text style={styles.heroLabel}>Ganancia Neta Real (USD)</Text>
                </View>
                <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
                  {formatUSD(resumen.ganancia_neta_total_usd)}
                </Text>
                <Text style={styles.heroFoot}>
                  Margen neto global: {margenGlobal.toFixed(1)}% · {ventas.length} venta(s)
                </Text>
              </View>

              {/* Grid 2x2 Métricas del ERP */}
              <View style={styles.metricGrid}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Ingresos por Ventas</Text>
                  <Text style={styles.metricValue}>{formatUSD(resumen.ingreso_total_usd)}</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Inversión Compras</Text>
                  <Text style={styles.metricValue}>{formatUSD(resumen.inversion_compras_usd)}</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Stock Repuestos</Text>
                  <Text style={styles.metricValue}>{formatUSD(resumen.valor_stock_repuestos_usd)}</Text>
                  <Text style={styles.metricSub}>{resumen.unidades_repuestos} piezas</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Reembolsos Garantía</Text>
                  <Text style={[styles.metricValue, { color: colors.danger }]}>
                    {formatUSD(resumen.reembolsos_total_usd)}
                  </Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Rentabilidad por Venta</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centerEmpty}>
              <Ionicons name="receipt-outline" size={54} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Sin ventas para calcular</Text>
              <Text style={styles.muted}>Al registrar ventas verás el margen neto de cada equipo.</Text>
            </View>
          }
        />
      ) : (
        <View style={styles.flex}>
          <View style={styles.subBar}>
            <Text style={styles.subBarTitle}>Registro Histórico Escrito</Text>
            <Pressable
              onPress={() => setModalNotaVisible(true)}
              style={({ pressed }) => [styles.btnNuevaNota, pressed && styles.pressed]}
            >
              <Ionicons name="create" size={16} color="#fff" />
              <Text style={styles.btnNuevaNotaText}>+ Escribir Nota</Text>
            </Pressable>
          </View>
          <FlatList
            data={bitacora}
            keyExtractor={(item) => String(item.id_bitacora)}
            renderItem={renderBitacoraItem}
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
                <Ionicons name="journal-outline" size={54} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Bitácora vacía</Text>
                <Text style={styles.muted}>Todo lo que hagas en el sistema quedará escrito aquí.</Text>
              </View>
            }
          />
        </View>
      )}

      {/* MODAL AGREGAR NOTA MANUAL */}
      <Modal visible={modalNotaVisible} transparent animationType="slide" onRequestClose={() => setModalNotaVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalNotaVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Escribir Nota en Bitácora</Text>
              <Pressable onPress={() => setModalNotaVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.labelModal}>Módulo relacionado</Text>
              <View style={styles.chipsRowModal}>
                {['Nota', 'Compras', 'Taller', 'Ventas', 'Garantias', 'Inventario'].map((mod) => (
                  <Pressable
                    key={mod}
                    onPress={() => setNuevoNotaModulo(mod)}
                    style={[styles.chipModal, notaModulo === mod && styles.chipModalActive]}
                  >
                    <Text style={[styles.chipModalText, notaModulo === mod && styles.chipModalTextActive]}>{mod}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>
                Descripción de la nota o evento *
              </Text>
              <TextInput
                value={notaDescripcion}
                onChangeText={setNotaDescripcion}
                placeholder="Escribe lo que ocurrió, acuerdo con cliente, llegada de paquetes, pruebas realizadas..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
                style={[styles.input, { minHeight: 90 }]}
                textAlignVertical="top"
              />

              <Pressable
                onPress={guardarNotaManual}
                disabled={guardandoNota}
                style={({ pressed }) => [styles.btnGuardarModal, pressed && styles.pressed, guardandoNota && styles.disabled]}
              >
                {guardandoNota ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.btnGuardarModalText}>Guardar Nota en Bitácora</Text>
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
  list: { flex: 1, backgroundColor: colors.bg },
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
  subBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  subBarTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  btnNuevaNota: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  btnNuevaNotaText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  centerEmpty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.md,
    minHeight: 140,
    justifyContent: 'space-between',
  },
  heroGanancia: { backgroundColor: '#14532D' },
  heroPerdida: { backgroundColor: '#7F1D1D' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLabel: { color: '#E5E7EB', fontSize: 14, fontWeight: '700' },
  heroValue: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', marginVertical: spacing.xs },
  heroFoot: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  metricBox: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  metricSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardId: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  marca: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  profitBadge: { fontSize: 16, fontWeight: '900' },
  costosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  costoCol: { flex: 1 },
  costoColLabel: { color: colors.textMuted, fontSize: 10 },
  costoColVal: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 1 },
  cardBitacora: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bitHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeMod: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  badgeModText: { fontSize: 10, fontWeight: '800' },
  bitAccion: { color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 },
  bitFecha: { color: colors.textMuted, fontSize: 11 },
  bitEquipo: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 },
  bitDesc: { color: colors.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sheetBody: { padding: spacing.lg, paddingBottom: 40 },
  labelModal: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
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
  chipsRowModal: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chipModal: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipModalActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}22` },
  chipModalText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chipModalTextActive: { color: colors.primary },
  btnGuardarModal: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnGuardarModalText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
