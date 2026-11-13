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
  BitacoraItem,
  formatFecha,
  formatUSD,
  InstalarPiezaPayload,
  LaptopDetalleCompleto,
  LaptopResumen,
  ListResponse,
  PiezaInstalada,
  QuitarPiezaPayload,
  RepuestoInventario,
  showApiError,
} from '../../services/api';
import { colors, radius, spacing } from '../../constants/theme';

type TabTaller = 'pendientes' | 'repuestos' | 'historial';

const ESTADO_COLORS: Record<string, string> = {
  'En Tránsito': colors.warning,
  'En Taller': colors.primary,
  'Lista para Venta': colors.success,
  'Devuelta': colors.danger,
};

export default function TallerScreen() {
  const [tab, setTab] = useState<TabTaller>('pendientes');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  // Datos
  const [laptops, setLaptops] = useState<LaptopResumen[]>([]);
  const [repuestos, setRepuestos] = useState<RepuestoInventario[]>([]);
  const [historial, setHistorial] = useState<BitacoraItem[]>([]);

  // Modal: Gestión detallada de una Laptop (piezas, diagnóstico, etc.)
  const [modalLaptopVisible, setModalLaptopVisible] = useState(false);
  const [selectedLaptopId, setSelectedLaptopId] = useState<number | null>(null);
  const [detalleLaptop, setDetalleLaptop] = useState<LaptopDetalleCompleto | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Sub-modal: Instalar pieza en la laptop seleccionada
  const [modalInstalarVisible, setModalInstalarVisible] = useState(false);
  const [instRepuestoId, setInstRepuestoId] = useState<number | null>(null);
  const [instCantidad, setInstCantidad] = useState('1');
  const [instObservaciones, setInstObservaciones] = useState('');
  const [instalando, setInstalando] = useState(false);

  // Sub-modal: Quitar pieza
  const [modalQuitarVisible, setModalQuitarVisible] = useState(false);
  const [piezaAQuitar, setPiezaAQuitar] = useState<PiezaInstalada | null>(null);
  const [devolverAStock, setDevolverAStock] = useState(true);
  const [motivoQuitar, setMotivoQuitar] = useState('');
  const [quitando, setQuitando] = useState(false);

  // Modal: Crear nuevo repuesto en inventario
  const [modalCrearRepuestoVisible, setModalCrearRepuestoVisible] = useState(false);
  const [nuevoRepNombre, setNuevoRepNombre] = useState('');
  const [nuevoRepCat, setNuevoRepCat] = useState('SSD');
  const [nuevoRepStock, setNuevoRepStock] = useState('5');
  const [nuevoRepCosto, setNuevoRepCosto] = useState('20.00');
  const [creandoRep, setCreandoRep] = useState(false);

  // Modal: Diagnóstico
  const [modalDiagVisible, setModalDiagVisible] = useState(false);
  const [diagBateria, setDiagBateria] = useState('95');
  const [diagResultado, setDiagResultado] = useState('Revisión general OK. Listo para publicar.');
  const [guardandoDiag, setGuardandoDiag] = useState(false);

  const cargarDatos = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [resPend, resRep, resHist] = await Promise.all([
        api.get<ListResponse<LaptopResumen>>('/taller/pendientes'),
        api.get<ListResponse<RepuestoInventario>>('/taller/repuestos'),
        api.get<ListResponse<BitacoraItem>>('/taller/historial'),
      ]);
      setLaptops(resPend.data.data ?? []);
      setRepuestos(resRep.data.data ?? []);
      setHistorial(resHist.data.data ?? []);
    } catch (error) {
      showApiError('Error al cargar datos del taller', error);
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

  const abrirGestionLaptop = async (id_laptop: number) => {
    setSelectedLaptopId(id_laptop);
    setModalLaptopVisible(true);
    setCargandoDetalle(true);
    try {
      const { data } = await api.get<{ status: string; data: LaptopDetalleCompleto }>(
        `/taller/laptops/${id_laptop}`,
      );
      setDetalleLaptop(data.data);
    } catch (error) {
      showApiError('Error al cargar detalle de laptop', error);
      setModalLaptopVisible(false);
    } finally {
      setCargandoDetalle(false);
    }
  };

  const recargarDetalleActual = async () => {
    if (!selectedLaptopId) return;
    try {
      const { data } = await api.get<{ status: string; data: LaptopDetalleCompleto }>(
        `/taller/laptops/${selectedLaptopId}`,
      );
      setDetalleLaptop(data.data);
    } catch {
      // Ignorar
    }
  };

  const cambiarEstadoRapido = async (laptop: LaptopResumen, nuevoEstado: string) => {
    try {
      const { data } = await api.put<{ status: string; message: string }>('/taller/estado', {
        id_laptop: laptop.id_laptop,
        nuevo_estado: nuevoEstado,
      });
      Alert.alert('Estado actualizado', data.message);
      await cargarDatos('silent');
      if (modalLaptopVisible) await recargarDetalleActual();
    } catch (error) {
      showApiError('Error al cambiar estado', error);
    }
  };

  const ejecutarInstalacionPieza = async () => {
    if (!selectedLaptopId || !instRepuestoId) {
      Alert.alert('Selecciona una pieza', 'Debes elegir qué repuesto instalar.');
      return;
    }
    const cant = parseInt(instCantidad, 10);
    if (!Number.isInteger(cant) || cant <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa una cantidad mayor a 0.');
      return;
    }

    setInstalando(true);
    try {
      const payload: InstalarPiezaPayload = {
        id_laptop: selectedLaptopId,
        id_repuesto: instRepuestoId,
        cantidad: cant,
        observaciones: instObservaciones.trim() || undefined,
      };
      const { data } = await api.post<{ status: string; message: string; costo_agregado: number }>(
        '/taller/instalar-pieza',
        payload,
      );
      Alert.alert('Pieza instalada ✅', `${data.message}\nCosto agregado al equipo: ${formatUSD(data.costo_agregado)}`);
      setModalInstalarVisible(false);
      setInstObservaciones('');
      setInstCantidad('1');
      await Promise.all([recargarDetalleActual(), cargarDatos('silent')]);
    } catch (error) {
      showApiError('Error al instalar pieza', error);
    } finally {
      setInstalando(false);
    }
  };

  const abrirModalQuitarPieza = (pieza: PiezaInstalada) => {
    setPiezaAQuitar(pieza);
    setDevolverAStock(true);
    setMotivoQuitar('');
    setModalQuitarVisible(true);
  };

  const ejecutarQuitarPieza = async () => {
    if (!piezaAQuitar) return;
    if (!motivoQuitar.trim()) {
      Alert.alert('Motivo requerido', 'Escribe por qué se retira esta pieza (queda en el registro escrito).');
      return;
    }

    setQuitando(true);
    try {
      const payload: QuitarPiezaPayload = {
        id_instalacion: piezaAQuitar.id_instalacion,
        devolver_a_stock: devolverAStock,
        motivo: motivoQuitar.trim(),
      };
      const { data } = await api.post<{ status: string; message: string }>('/taller/quitar-pieza', payload);
      Alert.alert('Pieza retirada ✅', data.message);
      setModalQuitarVisible(false);
      setPiezaAQuitar(null);
      await Promise.all([recargarDetalleActual(), cargarDatos('silent')]);
    } catch (error) {
      showApiError('Error al retirar pieza', error);
    } finally {
      setQuitando(false);
    }
  };

  const guardarNuevoRepuesto = async () => {
    if (!nuevoRepNombre.trim()) {
      Alert.alert('Nombre requerido', 'Ingresa el nombre del repuesto.');
      return;
    }
    const stock = parseInt(nuevoRepStock, 10) || 0;
    const costo = parseFloat(nuevoRepCosto.replace(',', '.')) || 0;

    setCreandoRep(true);
    try {
      const { data } = await api.post<{ status: string; message: string; id_repuesto: number }>('/taller/repuestos', {
        nombre_pieza: nuevoRepNombre.trim(),
        categoria: nuevoRepCat,
        stock_inicial: stock,
        costo_unitario: costo,
      });
      Alert.alert('Repuesto creado ✅', `${data.message} (#${data.id_repuesto}).`);
      setModalCrearRepuestoVisible(false);
      setNuevoRepNombre('');
      await cargarDatos('silent');
    } catch (error) {
      showApiError('Error al registrar repuesto', error);
    } finally {
      setCreandoRep(false);
    }
  };

  const guardarDiagnostico = async () => {
    if (!selectedLaptopId) return;
    if (!diagResultado.trim()) {
      Alert.alert('Resultado requerido', 'Escribe el resultado general de la prueba.');
      return;
    }
    const bat = parseInt(diagBateria, 10);

    setGuardandoDiag(true);
    try {
      const { data } = await api.post<{ status: string; message: string }>('/taller/diagnostico', {
        id_laptop: selectedLaptopId,
        salud_bateria_pct: Number.isInteger(bat) ? bat : undefined,
        resultado_general: diagResultado.trim(),
      });
      Alert.alert('Diagnóstico guardado ✅', data.message);
      setModalDiagVisible(false);
      await Promise.all([recargarDetalleActual(), cargarDatos('silent')]);
    } catch (error) {
      showApiError('Error al guardar diagnóstico', error);
    } finally {
      setGuardandoDiag(false);
    }
  };

  // Render cards
  const renderLaptopCard = ({ item }: { item: LaptopResumen }) => {
    const colorEstado = ESTADO_COLORS[item.estado_flujo] ?? colors.textMuted;
    const costoTotal = (item.costo_adquisicion ?? 0) + (item.costo_taller ?? 0);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardId}>Laptop #{item.id_laptop}</Text>
          <View style={[styles.badge, { borderColor: colorEstado, backgroundColor: `${colorEstado}22` }]}>
            <View style={[styles.dot, { backgroundColor: colorEstado }]} />
            <Text style={[styles.badgeText, { color: colorEstado }]}>{item.estado_flujo}</Text>
          </View>
        </View>

        <Text style={styles.marca} numberOfLines={1}>{item.marca}</Text>
        <Text style={styles.subtext}>{item.procesador}</Text>

        <View style={styles.tagsRow}>
          <Text style={styles.tag}>{item.ram_gb} GB RAM</Text>
          <Text style={styles.tag}>{item.tipo_almacenamiento}</Text>
          {item.pantalla ? <Text style={styles.tag}>{item.pantalla}</Text> : null}
        </View>

        <View style={styles.costosRow}>
          <Text style={styles.costoSub}>
            Adquisición: <Text style={styles.costoNum}>{formatUSD(item.costo_adquisicion)}</Text>
          </Text>
          <Text style={styles.costoSub}>
            Taller ({item.piezas_instaladas ?? 0} piezas): <Text style={styles.costoNum}>{formatUSD(item.costo_taller)}</Text>
          </Text>
          <Text style={[styles.costoSub, { color: colors.success, fontWeight: '800' }]}>
            Invertido: {formatUSD(costoTotal)}
          </Text>
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => abrirGestionLaptop(item.id_laptop)}
            style={({ pressed }) => [styles.btnGestionar, pressed && styles.pressed]}
          >
            <Ionicons name="construct" size={16} color="#fff" />
            <Text style={styles.btnGestionarText}>Gestionar Piezas ({item.piezas_instaladas ?? 0})</Text>
          </Pressable>

          {item.estado_flujo !== 'Lista para Venta' ? (
            <Pressable
              onPress={() => cambiarEstadoRapido(item, 'Lista para Venta')}
              style={({ pressed }) => [styles.btnPasarLista, pressed && styles.pressed]}
            >
              <Ionicons name="checkmark-done" size={16} color="#fff" />
              <Text style={styles.btnPasarListaText}>Pasar a Lista</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => cambiarEstadoRapido(item, 'En Taller')}
              style={({ pressed }) => [styles.btnRegresarTaller, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
              <Text style={styles.btnRegresarTallerText}>Regresar a Taller</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderRepuestoCard = ({ item }: { item: RepuestoInventario }) => {
    const conStock = item.stock_actual > 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardId}>Repuesto #{item.id_repuesto}</Text>
            <Text style={styles.marca} numberOfLines={1}>{item.nombre_pieza}</Text>
            {item.categoria && <Text style={styles.subtext}>{item.categoria}</Text>}
          </View>
          <View
            style={[
              styles.badge,
              {
                borderColor: conStock ? colors.success : colors.danger,
                backgroundColor: conStock ? `${colors.success}22` : `${colors.danger}22`,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: conStock ? colors.success : colors.danger }]}>
              {conStock ? `${item.stock_actual} en stock` : 'Agotado'}
            </Text>
          </View>
        </View>
        <View style={styles.costosRow}>
          <Text style={styles.costoSub}>
            Costo prom: <Text style={styles.costoNum}>{formatUSD(item.costo_unitario_promedio)}</Text>
          </Text>
          <Text style={[styles.costoSub, { color: colors.text, fontWeight: '800' }]}>
            Valor stock: {formatUSD(item.valor_stock ?? item.stock_actual * item.costo_unitario_promedio)}
          </Text>
        </View>
      </View>
    );
  };

  const renderHistorialItem = useCallback(({ item }: { item: BitacoraItem }) => {
    return (
      <View style={styles.cardHistorial}>
        <View style={styles.histHeader}>
          <Text style={styles.histAccion}>{item.accion}</Text>
          <Text style={styles.histFecha}>{formatFecha(item.fecha)}</Text>
        </View>
        {item.equipo ? (
          <Text style={styles.histEquipo}>Equipo #{item.id_laptop} · {item.equipo}</Text>
        ) : null}
        <Text style={styles.histDesc}>{item.descripcion}</Text>
      </View>
    );
  }, []);

  const emptyPendientes = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="checkmark-circle-outline" size={54} color={colors.success} />
        <Text style={styles.emptyTitle}>Taller sin pendientes</Text>
        <Text style={styles.muted}>No hay laptops en tránsito ni en reparación.</Text>
      </View>
    ),
    [],
  );

  const emptyRepuestos = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="cube-outline" size={54} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin repuestos</Text>
        <Text style={styles.muted}>Toca "+ Nuevo Repuesto" para agregar piezas.</Text>
      </View>
    ),
    [],
  );

  const emptyHistorial = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="journal-outline" size={54} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin registros aún</Text>
        <Text style={styles.muted}>Las piezas instaladas o retiradas aparecerán aquí.</Text>
      </View>
    ),
    [],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando taller y repuestos...</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Selector de sub-tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('pendientes')}
          style={[styles.tabButton, tab === 'pendientes' && styles.tabButtonActive]}
        >
          <Ionicons name="laptop" size={18} color={tab === 'pendientes' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'pendientes' && styles.tabTextActive]}>
            En Taller ({laptops.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('repuestos')}
          style={[styles.tabButton, tab === 'repuestos' && styles.tabButtonActive]}
        >
          <Ionicons name="hardware-chip" size={18} color={tab === 'repuestos' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'repuestos' && styles.tabTextActive]}>
            Repuestos ({repuestos.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('historial')}
          style={[styles.tabButton, tab === 'historial' && styles.tabButtonActive]}
        >
          <Ionicons name="journal" size={18} color={tab === 'historial' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'historial' && styles.tabTextActive]}>
            Registro Taller
          </Text>
        </Pressable>
      </View>

      {tab === 'pendientes' && (
        <FlatList
          data={laptops ?? []}
          keyExtractor={(item) => String(item.id_laptop)}
          renderItem={renderLaptopCard}
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
          ListEmptyComponent={emptyPendientes}
        />
      )}

      {tab === 'repuestos' && (
        <View style={styles.flex}>
          <View style={styles.subBar}>
            <Text style={styles.subBarTitle}>Inventario Físico de Piezas</Text>
            <Pressable
              onPress={() => setModalCrearRepuestoVisible(true)}
              style={({ pressed }) => [styles.btnNuevoRep, pressed && styles.pressed]}
            >
              <Ionicons name="add-circle" size={16} color="#fff" />
              <Text style={styles.btnNuevoRepText}>+ Nuevo Repuesto</Text>
            </Pressable>
          </View>
          <FlatList
            data={repuestos ?? []}
            keyExtractor={(item) => String(item.id_repuesto)}
            renderItem={renderRepuestoCard}
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
            ListEmptyComponent={emptyRepuestos}
          />
        </View>
      )}

      {tab === 'historial' && (
        <FlatList
          data={historial ?? []}
          keyExtractor={(item) => String(item.id_bitacora)}
          renderItem={renderHistorialItem}
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
          ListEmptyComponent={emptyHistorial}
        />
      )}

      {/* MODAL DETALLE Y GESTIÓN DE PIEZAS DE UNA LAPTOP */}
      <Modal visible={modalLaptopVisible} transparent animationType="slide" onRequestClose={() => setModalLaptopVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalLaptopVisible(false)} />
          <View style={styles.sheetGrande}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {detalleLaptop ? `${detalleLaptop.laptop.marca}` : 'Cargando equipo...'}
                </Text>
                {detalleLaptop && (
                  <Text style={styles.sheetSub}>
                    #{detalleLaptop.laptop.id_laptop} · {detalleLaptop.laptop.procesador} · {detalleLaptop.laptop.estado_flujo}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => setModalLaptopVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            {cargandoDetalle ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.muted}>Cargando historial de piezas...</Text>
              </View>
            ) : detalleLaptop ? (
              <ScrollView contentContainerStyle={styles.sheetBody}>
                {/* Resumen de costos del equipo */}
                <View style={styles.costosBoxModal}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.costoSubModal}>Adquisición</Text>
                    <Text style={styles.costoValModal}>{formatUSD(detalleLaptop.laptop.costo_adquisicion)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.costoSubModal}>Taller (Piezas)</Text>
                    <Text style={styles.costoValModal}>{formatUSD(detalleLaptop.laptop.costo_taller)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.costoSubModal, { color: colors.success }]}>Total Invertido</Text>
                    <Text style={[styles.costoValModal, { color: colors.success }]}>
                      {formatUSD((detalleLaptop.laptop.costo_adquisicion ?? 0) + (detalleLaptop.laptop.costo_taller ?? 0))}
                    </Text>
                  </View>
                </View>

                {/* Botones de acción del equipo */}
                <View style={styles.accionesModalRow}>
                  <Pressable
                    onPress={() => {
                      if (repuestos.length === 0) {
                        Alert.alert('Sin repuestos', 'No hay repuestos registrados en el inventario.');
                        return;
                      }
                      setInstRepuestoId(repuestos[0].id_repuesto);
                      setInstCantidad('1');
                      setInstObservaciones('');
                      setModalInstalarVisible(true);
                    }}
                    style={({ pressed }) => [styles.btnModalAccion, styles.btnInstalarPieza, pressed && styles.pressed]}
                  >
                    <Ionicons name="add-circle" size={18} color="#fff" />
                    <Text style={styles.btnModalAccionText}>Instalar Pieza</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setModalDiagVisible(true)}
                    style={({ pressed }) => [styles.btnModalAccion, styles.btnDiag, pressed && styles.pressed]}
                  >
                    <Ionicons name="speedometer" size={18} color="#fff" />
                    <Text style={styles.btnModalAccionText}>Diagnóstico</Text>
                  </Pressable>
                </View>

                {/* Sección: Piezas instaladas actualmente */}
                <Text style={styles.modalSectionTitle}>
                  Piezas Instaladas ({detalleLaptop.piezas.length})
                </Text>
                {detalleLaptop.piezas.length === 0 ? (
                  <Text style={[styles.muted, { marginVertical: spacing.md }]}>
                    No tiene piezas instaladas. Puedes agregar una con el botón de arriba.
                  </Text>
                ) : (
                  detalleLaptop.piezas.map((pieza) => (
                    <View key={pieza.id_instalacion} style={styles.piezaItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.piezaNombre}>
                          {pieza.cantidad} x {pieza.nombre_pieza}
                        </Text>
                        <Text style={styles.piezaSub}>
                          Costo: {formatUSD(pieza.costo_unitario_aplicado)} c/u · Total: {formatUSD(pieza.costo_unitario_aplicado * pieza.cantidad)}
                        </Text>
                        {pieza.observaciones ? (
                          <Text style={styles.piezaObs}>Obs: {pieza.observaciones}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => abrirModalQuitarPieza(pieza)}
                        style={({ pressed }) => [styles.btnQuitarPieza, pressed && styles.pressed]}
                      >
                        <Ionicons name="trash" size={16} color={colors.danger} />
                        <Text style={styles.btnQuitarPiezaText}>Quitar</Text>
                      </Pressable>
                    </View>
                  ))
                )}

                {/* Sección: Diagnósticos previos */}
                {detalleLaptop.diagnosticos.length > 0 && (
                  <>
                    <Text style={[styles.modalSectionTitle, { marginTop: spacing.lg }]}>
                      Historial de Diagnóstico
                    </Text>
                    {detalleLaptop.diagnosticos.map((diag) => (
                      <View key={diag.id_diagnostico} style={styles.diagItem}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.diagFecha}>{formatFecha(diag.fecha_prueba)}</Text>
                          {diag.salud_bateria_pct != null && (
                            <Text style={styles.diagBateria}>Batería: {diag.salud_bateria_pct}%</Text>
                          )}
                        </View>
                        <Text style={styles.diagRes}>{diag.resultado_general}</Text>
                      </View>
                    ))}
                  </>
                )}

                {/* Sección: Registro escrito / Bitácora de este equipo */}
                {detalleLaptop.bitacora.length > 0 && (
                  <>
                    <Text style={[styles.modalSectionTitle, { marginTop: spacing.lg }]}>
                      Bitácora de este equipo ({detalleLaptop.bitacora.length})
                    </Text>
                    {detalleLaptop.bitacora.map((b) => (
                      <View key={b.id_bitacora} style={styles.bitacoraMini}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.bitMiniAccion}>{b.accion}</Text>
                          <Text style={styles.bitMiniFecha}>{formatFecha(b.fecha)}</Text>
                        </View>
                        <Text style={styles.bitMiniDesc}>{b.descripcion}</Text>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SUB-MODAL: INSTALAR PIEZA */}
      <Modal visible={modalInstalarVisible} transparent animationType="slide" onRequestClose={() => setModalInstalarVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalInstalarVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Instalar Pieza en Equipo</Text>
              <Pressable onPress={() => setModalInstalarVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.labelModal}>Selecciona el repuesto del inventario *</Text>
              <View style={styles.chipsRowModal}>
                {repuestos.map((r) => {
                  const sel = instRepuestoId === r.id_repuesto;
                  return (
                    <Pressable
                      key={r.id_repuesto}
                      onPress={() => setInstRepuestoId(r.id_repuesto)}
                      style={[styles.chipModal, sel && styles.chipModalActive]}
                    >
                      <Text style={[styles.chipModalText, sel && styles.chipModalTextActive]}>
                        {r.nombre_pieza} ({formatUSD(r.costo_unitario_promedio)} · Stock: {r.stock_actual})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>Cantidad</Text>
              <TextInput
                value={instCantidad}
                onChangeText={setInstCantidad}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { width: 100 }]}
              />

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>Observaciones de la instalación</Text>
              <TextInput
                value={instObservaciones}
                onChangeText={setInstObservaciones}
                placeholder="Ej. Cambio por pasta térmica nueva, ranura 2..."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              <Pressable
                onPress={ejecutarInstalacionPieza}
                disabled={instalando}
                style={({ pressed }) => [styles.btnGuardarModal, pressed && styles.pressed, instalando && styles.disabled]}
              >
                {instalando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color="#fff" />
                    <Text style={styles.btnGuardarModalText}>Confirmar e Instalar</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SUB-MODAL: QUITAR PIEZA */}
      <Modal visible={modalQuitarVisible} transparent animationType="slide" onRequestClose={() => setModalQuitarVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalQuitarVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Retirar Pieza del Equipo</Text>
              <Pressable onPress={() => setModalQuitarVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              {piezaAQuitar && (
                <View style={styles.warningStrip}>
                  <Ionicons name="alert-circle" size={20} color={colors.warning} />
                  <Text style={styles.warningStripText}>
                    Se retirará: {piezaAQuitar.cantidad} x {piezaAQuitar.nombre_pieza} ({formatUSD(piezaAQuitar.costo_unitario_aplicado)} c/u).
                  </Text>
                </View>
              )}

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>¿Devolver la pieza al stock de inventario?</Text>
                <Switch
                  value={devolverAStock}
                  onValueChange={setDevolverAStock}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              <Text style={styles.hintSwitch}>
                {devolverAStock
                  ? 'La pieza volverá al inventario lista para ser instalada en otro equipo.'
                  : 'La pieza se dará de baja/descartada (ej. si estaba defectuosa o dañada).'}
              </Text>

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>
                Motivo del retiro * (Registro escrito obligatorio)
              </Text>
              <TextInput
                value={motivoQuitar}
                onChangeText={setMotivoQuitar}
                placeholder="Ej. El cliente pidió otra capacidad, o la pieza presentó error en prueba de estrés..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                style={[styles.input, { minHeight: 70 }]}
              />

              <Pressable
                onPress={ejecutarQuitarPieza}
                disabled={quitando}
                style={({ pressed }) => [styles.btnDangerModal, pressed && styles.pressed, quitando && styles.disabled]}
              >
                {quitando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="trash" size={20} color="#fff" />
                    <Text style={styles.btnDangerModalText}>Confirmar y Dejar Registro</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL CREAR NUEVO REPUESTO */}
      <Modal visible={modalCrearRepuestoVisible} transparent animationType="slide" onRequestClose={() => setModalCrearRepuestoVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalCrearRepuestoVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Nuevo Repuesto en Inventario</Text>
              <Pressable onPress={() => setModalCrearRepuestoVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.labelModal}>Nombre de la pieza *</Text>
              <TextInput
                value={nuevoRepNombre}
                onChangeText={setNuevoRepNombre}
                placeholder="Ej. SSD NVMe 512GB Kingston / Batería Dell 68Wh"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>Categoría</Text>
              <View style={styles.chipsRowModal}>
                {['SSD', 'RAM', 'Batería', 'Pantalla', 'Teclado', 'Cargador', 'Otro'].map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setNuevoRepCat(cat)}
                    style={[styles.chipModal, nuevoRepCat === cat && styles.chipModalActive]}
                  >
                    <Text style={[styles.chipModalText, nuevoRepCat === cat && styles.chipModalTextActive]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.labelModal}>Stock inicial</Text>
                  <TextInput
                    value={nuevoRepStock}
                    onChangeText={setNuevoRepStock}
                    keyboardType="number-pad"
                    placeholder="5"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.labelModal}>Costo unitario (USD)</Text>
                  <TextInput
                    value={nuevoRepCosto}
                    onChangeText={setNuevoRepCosto}
                    keyboardType="decimal-pad"
                    placeholder="25.00"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
              </View>

              <Pressable
                onPress={guardarNuevoRepuesto}
                disabled={creandoRep}
                style={({ pressed }) => [styles.btnGuardarModal, pressed && styles.pressed, creandoRep && styles.disabled]}
              >
                {creandoRep ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cube" size={20} color="#fff" />
                    <Text style={styles.btnGuardarModalText}>Guardar Repuesto</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL REGISTRAR DIAGNÓSTICO */}
      <Modal visible={modalDiagVisible} transparent animationType="slide" onRequestClose={() => setModalDiagVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalDiagVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Prueba de Diagnóstico</Text>
              <Pressable onPress={() => setModalDiagVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.labelModal}>Salud de la batería (%)</Text>
              <TextInput
                value={diagBateria}
                onChangeText={setDiagBateria}
                keyboardType="number-pad"
                placeholder="95"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { width: 120 }]}
              />

              <Text style={[styles.labelModal, { marginTop: spacing.md }]}>Resultado General / Checklist *</Text>
              <TextInput
                value={diagResultado}
                onChangeText={setDiagResultado}
                placeholder="Ej. Teclado OK, Puertos USB OK, Sonido OK, Pantalla sin fugas de luz..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                style={[styles.input, { minHeight: 70 }]}
              />

              <Pressable
                onPress={guardarDiagnostico}
                disabled={guardandoDiag}
                style={({ pressed }) => [styles.btnGuardarModal, pressed && styles.pressed, guardandoDiag && styles.disabled]}
              >
                {guardandoDiag ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.btnGuardarModalText}>Guardar Diagnóstico</Text>
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
  subBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  subBarTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  btnNuevoRep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  btnNuevoRepText: { color: '#fff', fontSize: 12, fontWeight: '800' },
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
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  tag: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  costosRow: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  costoSub: { color: colors.textMuted, fontSize: 11 },
  costoNum: { color: colors.text, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btnGestionar: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  btnGestionarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnPasarLista: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  btnPasarListaText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnRegresarTaller: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  btnRegresarTallerText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  cardHistorial: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  histHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  histAccion: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  histFecha: { color: colors.textMuted, fontSize: 11 },
  histEquipo: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 2 },
  histDesc: { color: colors.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
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
  sheetGrande: {
    maxHeight: '94%',
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
  sheetSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sheetBody: { padding: spacing.lg, paddingBottom: 40 },
  costosBoxModal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  costoSubModal: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  costoValModal: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  accionesModalRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  btnModalAccion: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  btnInstalarPieza: { backgroundColor: colors.success },
  btnDiag: { backgroundColor: colors.primary },
  btnModalAccionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  modalSectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: spacing.sm },
  piezaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  piezaNombre: { color: colors.text, fontSize: 14, fontWeight: '700' },
  piezaSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  piezaObs: { color: colors.accent, fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  btnQuitarPieza: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: `${colors.danger}22`,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  btnQuitarPiezaText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  diagItem: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  diagFecha: { color: colors.textMuted, fontSize: 11 },
  diagBateria: { color: colors.success, fontSize: 12, fontWeight: '700' },
  diagRes: { color: colors.text, fontSize: 13, marginTop: 4 },
  bitacoraMini: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  bitMiniAccion: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  bitMiniFecha: { color: colors.textMuted, fontSize: 10 },
  bitMiniDesc: { color: colors.text, fontSize: 11, marginTop: 2 },
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  switchLabel: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  hintSwitch: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  warningStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.15)',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  warningStripText: { color: colors.warning, fontSize: 12, fontWeight: '700', flex: 1 },
  btnGuardarModal: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnGuardarModalText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  btnDangerModal: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnDangerModalText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
