import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  KeyboardTypeOptions,
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
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  CompraHistorialItem,
  CrearProveedorPayload,
  DatosExtraidosIA,
  EvaluarImagenResponse,
  formatFecha,
  formatUSD,
  ListResponse,
  Proveedor,
  RegistrarCompraPayload,
  RegistrarCompraResponse,
  showApiError,
} from '../../services/api';
import { colors, radius, spacing } from '../../constants/theme';

type TabCompras = 'nueva' | 'historial';
type ModoIngreso = 'ia' | 'manual';

type FormState = {
  id_proveedor: string;
  tipo_compra: string; // 'Internacional Courier' o 'Compra Local / Particular'
  codigo_orden: string;
  numero_recibo_local: string;
  tracking_courier: string;
  costo_productos_total: string;
  costo_flete_total: string;
  marca: string;
  procesador: string;
  ram_gb: string;
  tipo_almacenamiento: string;
  tamano_almacenamiento: string;
  pantalla: string;
  numero_serie: string;
  notas: string;
};

const EMPTY_FORM: FormState = {
  id_proveedor: '',
  tipo_compra: 'Internacional Courier',
  codigo_orden: '',
  numero_recibo_local: '',
  tracking_courier: '',
  costo_productos_total: '',
  costo_flete_total: '32.00',
  marca: '',
  procesador: '',
  ram_gb: '8',
  tipo_almacenamiento: 'SSD',
  tamano_almacenamiento: '256',
  pantalla: '14" FHD',
  numero_serie: '',
  notas: '',
};

const STORAGE_CHIPS = ['SSD', 'NVMe', 'HDD', 'eMMC'];
const TIPOS_COMPRA = ['Internacional Courier', 'Compra Local / Particular'];
const TIPOS_PROVEEDOR = ['Marketplace Online', 'Distribuidor Local', 'Particular'];

export default function ComprasScreen() {
  const [tab, setTab] = useState<TabCompras>('nueva');
  const [modoIngreso, setModoIngreso] = useState<ModoIngreso>('ia');

  // Estado del formulario
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notaIA, setNotaIA] = useState<string>('');
  const [iaData, setIaData] = useState<DatosExtraidosIA | null>(null);

  // Proveedores
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [modalProveedorVisible, setModalProveedorVisible] = useState(false);
  const [nuevoProvNombre, setNuevoProvNombre] = useState('');
  const [nuevoProvTipo, setNuevoProvTipo] = useState(TIPOS_PROVEEDOR[0]);
  const [nuevoProvContacto, setNuevoProvContacto] = useState('');
  const [nuevoProvPais, setNuevoProvPais] = useState('Nicaragua');
  const [creandoProv, setCreandoProv] = useState(false);

  // Historial de compras
  const [historial, setHistorial] = useState<CompraHistorialItem[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [refreshingHistorial, setRefreshingHistorial] = useState(false);
  const hasLoadedRef = useRef(false);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const cargarProveedores = useCallback(async () => {
    try {
      const { data } = await api.get<ListResponse<Proveedor>>('/proveedores');
      const list = data.data ?? [];
      setProveedores(list);
      // Auto-seleccionar el primer proveedor si no hay ninguno seleccionado
      setForm((prev) => {
        if (!prev.id_proveedor && list.length > 0) {
          return { ...prev, id_proveedor: String(list[0].id_proveedor) };
        }
        return prev;
      });
    } catch {
      // Ignorar error de fondo
    }
  }, []);

  const cargarHistorial = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setLoadingHistorial(true);
    if (mode === 'refresh') setRefreshingHistorial(true);
    try {
      const { data } = await api.get<ListResponse<CompraHistorialItem>>('/compras/historial');
      setHistorial(data.data ?? []);
    } catch (error) {
      showApiError('Error al cargar historial de compras', error);
    } finally {
      setLoadingHistorial(false);
      setRefreshingHistorial(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargarProveedores();
      if (!hasLoadedRef.current) {
        cargarHistorial('silent');
        hasLoadedRef.current = true;
      }
    }, [cargarProveedores, cargarHistorial]),
  );

  const resetFormulario = () => {
    setImageUri(null);
    setNotaIA('');
    setIaData(null);
    setForm({
      ...EMPTY_FORM,
      id_proveedor: proveedores.length > 0 ? String(proveedores[0].id_proveedor) : '',
    });
  };

  const quitarImagen = () => {
    setImageUri(null);
    setNotaIA('');
    setIaData(null);
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permiso requerido', 'Se necesita acceso a la galería.');
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      };

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setImageUri(asset.uri);
      await evaluarImagen(asset);
    } catch (error) {
      showApiError('Error al seleccionar imagen', error);
    }
  };

  const evaluarImagen = async (asset: ImagePicker.ImagePickerAsset) => {
    setAnalyzing(true);
    try {
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const extension = mimeType.split('/')[1] ?? 'jpg';
      const fileName = asset.fileName ?? `laptop_${Date.now()}.${extension}`;

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: fileName,
        type: mimeType,
      } as unknown as Blob);

      const { data } = await api.post<EvaluarImagenResponse>('/compras/evaluar-imagen', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        transformRequest: (body) => body,
      });

      const ia = data.datos_extraidos ?? {};
      setIaData(ia);
      setForm((prev) => ({
        ...prev,
        marca: ia.marca ?? prev.marca,
        procesador: ia.procesador ?? prev.procesador,
        ram_gb: ia.ram_gb != null ? String(ia.ram_gb) : prev.ram_gb,
        costo_productos_total:
          ia.precio_detectado_usd != null ? String(ia.precio_detectado_usd) : prev.costo_productos_total,
        costo_flete_total:
          data.estimaciones?.flete_sugerido_usd != null
            ? String(data.estimaciones.flete_sugerido_usd)
            : prev.costo_flete_total,
      }));
      setNotaIA(data.estimaciones?.nota ?? '');
    } catch (error) {
      showApiError('Error al evaluar imagen con IA', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const guardarNuevoProveedor = async () => {
    if (!nuevoProvNombre.trim()) {
      Alert.alert('Nombre requerido', 'Ingresa el nombre del proveedor.');
      return;
    }
    const payload: CrearProveedorPayload = {
      nombre: nuevoProvNombre.trim(),
      tipo: nuevoProvTipo,
      contacto: nuevoProvContacto.trim() || undefined,
      pais: nuevoProvPais.trim() || undefined,
    };
    setCreandoProv(true);
    try {
      const { data } = await api.post<{ status: string; id_proveedor: number; message: string }>(
        '/proveedores',
        payload,
      );
      await cargarProveedores();
      setForm((prev) => ({ ...prev, id_proveedor: String(data.id_proveedor) }));
      setModalProveedorVisible(false);
      setNuevoProvNombre('');
      setNuevoProvContacto('');
      Alert.alert('Proveedor creado ✅', `Seleccionado automáticamente (#${data.id_proveedor}).`);
    } catch (error) {
      showApiError('Error al crear proveedor', error);
    } finally {
      setCreandoProv(false);
    }
  };

  const guardarCompra = async () => {
    const idProv = parseInt(form.id_proveedor, 10);
    const flete = parseFloat(form.costo_flete_total.replace(',', '.')) || 0;
    const productos = parseFloat(form.costo_productos_total.replace(',', '.'));
    const ram = parseInt(form.ram_gb, 10);
    const tamano = parseInt(form.tamano_almacenamiento, 10);

    const errores: string[] = [];
    if (!Number.isInteger(idProv) || idProv <= 0) errores.push('Selecciona o registra un proveedor.');
    if (!form.marca.trim()) errores.push('Marca / Modelo requerida.');
    if (!form.procesador.trim()) errores.push('Procesador requerido.');
    if (!Number.isInteger(ram) || ram <= 0) errores.push('RAM (GB) inválida.');
    if (!Number.isFinite(productos) || productos < 0) errores.push('Costo de productos inválido.');
    if (flete < 0) errores.push('Costo de flete inválido.');

    if (errores.length) {
      Alert.alert('Faltan campos obligatorios', errores.join('\n'));
      return;
    }

    const payload: RegistrarCompraPayload = {
      id_proveedor: idProv,
      tipo_compra: form.tipo_compra,
      codigo_orden: form.codigo_orden.trim() || undefined,
      numero_recibo_local: form.numero_recibo_local.trim() || undefined,
      tracking_courier: form.tracking_courier.trim() || undefined,
      costo_productos_total: productos,
      costo_flete_total: flete,
      marca: form.marca.trim(),
      procesador: form.procesador.trim(),
      ram_gb: ram,
      tipo_almacenamiento: form.tipo_almacenamiento.trim(),
      tamano_almacenamiento: Number.isInteger(tamano) ? tamano : undefined,
      pantalla: form.pantalla.trim() || undefined,
      numero_serie: form.numero_serie.trim() || undefined,
      origen_datos: imageUri ? 'Escáner IA' : 'Manual',
      notas: form.notas.trim() || undefined,
    };

    setSaving(true);
    try {
      const { data } = await api.post<RegistrarCompraResponse>('/compras/registrar', payload);
      Alert.alert(
        'Compra registrada ✅',
        `${data.message}\n\nID Compra: #${data.id_compra}\nID Laptop: #${data.id_laptop}\nEstado inicial: ${data.estado_inicial ?? 'En Tránsito'}\n\nQuedó registrada en la bitácora y en el historial.`,
        [
          {
            text: 'Ver en Historial',
            onPress: () => {
              resetFormulario();
              setTab('historial');
              cargarHistorial('silent');
            },
          },
          { text: 'Registrar otra', onPress: resetFormulario },
        ],
      );
    } catch (error) {
      showApiError('Error al guardar compra', error);
    } finally {
      setSaving(false);
    }
  };

  const costoTotal =
    (parseFloat(form.costo_productos_total.replace(',', '.')) || 0) +
    (parseFloat(form.costo_flete_total.replace(',', '.')) || 0);

  const renderHistorialItem = useCallback(({ item }: { item: CompraHistorialItem }) => {
    return (
      <View style={styles.cardHistorial}>
        <View style={styles.histHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.histId}>Compra #{item.id_compra} · {formatFecha(item.fecha_compra)}</Text>
            <Text style={styles.histProveedor}>{item.proveedor}</Text>
          </View>
          <View style={[styles.badge, { borderColor: colors.primary, backgroundColor: `${colors.primary}22` }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{item.tipo_compra}</Text>
          </View>
        </View>

        {item.id_laptop ? (
          <View style={styles.histEquipoBox}>
            <Ionicons name="laptop-outline" size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.histEquipoTitle}>
                #{item.id_laptop} {item.marca} {item.procesador}
              </Text>
              <Text style={styles.histEquipoSub}>
                {item.ram_gb} GB RAM · Estado: {item.estado_flujo}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.histEquipoBox}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.warning} />
            <Text style={styles.histEquipoTitle}>{item.detalle_repuestos || 'Repuestos'}</Text>
          </View>
        )}

        <View style={styles.histCostosRow}>
          <Text style={styles.histCostoLabel}>
            Productos: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatUSD(item.costo_productos_total)}</Text>
          </Text>
          <Text style={styles.histCostoLabel}>
            Flete: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatUSD(item.costo_flete_total)}</Text>
          </Text>
          <Text style={[styles.histCostoLabel, { color: colors.success, fontWeight: '800' }]}>
            Total: {formatUSD(item.costo_productos_total + item.costo_flete_total)}
          </Text>
        </View>

        {item.codigo_orden ? (
          <Text style={styles.histRef}>Orden: {item.codigo_orden}</Text>
        ) : item.numero_recibo_local ? (
          <Text style={styles.histRef}>Recibo: {item.numero_recibo_local}</Text>
        ) : null}
      </View>
    );
  }, []);

  const emptyHistorial = useMemo(
    () => (
      <View style={styles.centerEmpty}>
        <Ionicons name="cart-outline" size={54} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin compras registradas</Text>
        <Text style={styles.muted}>Las compras que guardes aparecerán aquí.</Text>
      </View>
    ),
    [],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Sub-tabs: Nueva Compra vs Historial */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('nueva')}
          style={[styles.tabButton, tab === 'nueva' && styles.tabButtonActive]}
        >
          <Ionicons name="add-circle" size={18} color={tab === 'nueva' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'nueva' && styles.tabTextActive]}>Nueva Compra</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setTab('historial');
            if (hasLoadedRef.current) {
              cargarHistorial('silent');
            }
          }}
          style={[styles.tabButton, tab === 'historial' && styles.tabButtonActive]}
        >
          <Ionicons name="receipt" size={18} color={tab === 'historial' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === 'historial' && styles.tabTextActive]}>
            Registro de Compras ({historial.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'historial' ? (
        <FlatList
          data={historial ?? []}
          keyExtractor={(item) => String(item.id_compra)}
          renderItem={renderHistorialItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshingHistorial}
              onRefresh={() => cargarHistorial('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={emptyHistorial}
        />
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Selector de modo: Con Imagen (IA) vs Manual con texto */}
          <View style={styles.modoSelector}>
            <Pressable
              onPress={() => setModoIngreso('ia')}
              style={[styles.modoBtn, modoIngreso === 'ia' && styles.modoBtnActive]}
            >
              <Ionicons name="sparkles" size={16} color={modoIngreso === 'ia' ? '#fff' : colors.textMuted} />
              <Text style={[styles.modoBtnText, modoIngreso === 'ia' && styles.modoBtnTextActive]}>
                Escáner con IA
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setModoIngreso('manual')}
              style={[styles.modoBtn, modoIngreso === 'manual' && styles.modoBtnActive]}
            >
              <Ionicons name="create-outline" size={16} color={modoIngreso === 'manual' ? '#fff' : colors.textMuted} />
              <Text style={[styles.modoBtnText, modoIngreso === 'manual' && styles.modoBtnTextActive]}>
                Ingreso Manual (Texto)
              </Text>
            </Pressable>
          </View>

          {/* Bloque de imagen (si modo == 'ia' o si hay imagen) */}
          {modoIngreso === 'ia' && (
            <View style={styles.imageBlock}>
              <Pressable
                onPress={() => pickImage('camera')}
                disabled={analyzing}
                style={({ pressed }) => [styles.bigButton, pressed && styles.pressed, analyzing && styles.disabled]}
              >
                {imageUri ? (
                  <View style={styles.previewContainer}>
                    <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
                    {/* BOTÓN OBLIGATORIO: QUITAR IMAGEN */}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        quitarImagen();
                      }}
                      style={styles.btnQuitarImagen}
                      hitSlop={8}
                    >
                      <Ionicons name="trash" size={18} color="#fff" />
                      <Text style={styles.btnQuitarImagenText}>Quitar imagen</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.bigButtonContent}>
                    <Ionicons name="camera" size={56} color={colors.text} />
                    <Text style={styles.bigButtonText}>Escanear anuncio o etiqueta</Text>
                    <Text style={styles.bigButtonSub}>Toca aquí para abrir la cámara o usa la galería</Text>
                  </View>
                )}
                {analyzing && (
                  <View style={styles.overlay}>
                    <ActivityIndicator size="large" color={colors.text} />
                    <Text style={styles.overlayText}>Analizando con IA de Gemini...</Text>
                  </View>
                )}
              </Pressable>

              <View style={styles.imageActionsRow}>
                <Pressable
                  onPress={() => pickImage('library')}
                  disabled={analyzing}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                  <Ionicons name="images" size={18} color={colors.primary} />
                  <Text style={styles.secondaryButtonText}>Elegir captura de galería</Text>
                </Pressable>
                {imageUri && (
                  <Pressable
                    onPress={quitarImagen}
                    style={({ pressed }) => [styles.secondaryButtonDanger, pressed && styles.pressed]}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.danger} />
                    <Text style={styles.secondaryButtonDangerText}>Limpiar foto</Text>
                  </Pressable>
                )}
              </View>

              {notaIA ? (
                <View style={styles.notaBox}>
                  <Ionicons name="information-circle" size={18} color={colors.warning} />
                  <Text style={styles.notaText}>{notaIA}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* FORMULARIO DE COMPRA (Siempre visible para poder ingresar por texto o revisar lo de IA) */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.sectionTitle}>Datos del Proveedor y Compra</Text>
              <Pressable
                onPress={() => setModalProveedorVisible(true)}
                style={({ pressed }) => [styles.btnAddProv, pressed && styles.pressed]}
              >
                <Ionicons name="person-add" size={14} color={colors.primary} />
                <Text style={styles.btnAddProvText}>+ Proveedor</Text>
              </Pressable>
            </View>

            {/* Selector de proveedor */}
            <Text style={styles.label}>Proveedor *</Text>
            {proveedores.length === 0 ? (
              <Pressable onPress={() => setModalProveedorVisible(true)} style={styles.provVacioBox}>
                <Ionicons name="add-circle" size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Registrar primer proveedor</Text>
              </Pressable>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                <View style={styles.chipsRow}>
                  {proveedores.map((p) => {
                    const sel = form.id_proveedor === String(p.id_proveedor);
                    return (
                      <Pressable
                        key={p.id_proveedor}
                        onPress={() => updateField('id_proveedor', String(p.id_proveedor))}
                        style={[styles.chip, sel && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, sel && styles.chipTextActive]}>
                          #{p.id_proveedor} {p.nombre} ({p.tipo})
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {/* Tipo de compra */}
            <Text style={[styles.label, { marginTop: spacing.md }]}>Tipo de compra</Text>
            <View style={styles.chipsRow}>
              {TIPOS_COMPRA.map((tc) => {
                const sel = form.tipo_compra === tc;
                return (
                  <Pressable
                    key={tc}
                    onPress={() => {
                      updateField('tipo_compra', tc);
                      if (tc.includes('Local')) updateField('costo_flete_total', '0');
                    }}
                    style={[styles.chip, sel && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{tc}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Código de orden o recibo */}
            {form.tipo_compra.includes('Internacional') ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>Código de Orden (eBay / Amazon / Newegg)</Text>
                <TextInput
                  value={form.codigo_orden}
                  onChangeText={(t) => updateField('codigo_orden', t)}
                  placeholder="Ej. 18-12345-67890"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
                <Text style={[styles.label, { marginTop: spacing.sm }]}>Tracking Courier (Opcional)</Text>
                <TextInput
                  value={form.tracking_courier}
                  onChangeText={(t) => updateField('tracking_courier', t)}
                  placeholder="Ej. 1Z9999999999999999"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </>
            ) : (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>Número de Recibo / Factura Local</Text>
                <TextInput
                  value={form.numero_recibo_local}
                  onChangeText={(t) => updateField('numero_recibo_local', t)}
                  placeholder="Ej. REC-0045"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </>
            )}

            {/* Costos */}
            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Costo Producto (USD) *</Text>
                  {iaData?.precio_detectado_usd != null && <Text style={styles.aiTag}>IA</Text>}
                </View>
                <TextInput
                  value={form.costo_productos_total}
                  onChangeText={(t) => updateField('costo_productos_total', t)}
                  placeholder="150.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Costo Flete (USD)</Text>
                <TextInput
                  value={form.costo_flete_total}
                  onChangeText={(t) => updateField('costo_flete_total', t)}
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>
          </View>

          {/* ESPECIFICACIONES DE LA LAPTOP */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Especificaciones del Equipo</Text>

            {/* Marca y Modelo */}
            <View style={styles.labelRow}>
              <Text style={styles.label}>Marca / Modelo *</Text>
              {iaData?.marca && <Text style={styles.aiTag}>IA</Text>}
            </View>
            <TextInput
              value={form.marca}
              onChangeText={(t) => updateField('marca', t)}
              placeholder="Ej. Dell Latitude 5490 / Lenovo ThinkPad T480"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            {/* Procesador */}
            <View style={styles.labelRow}>
              <Text style={styles.label}>Procesador *</Text>
              {iaData?.procesador && <Text style={styles.aiTag}>IA</Text>}
            </View>
            <TextInput
              value={form.procesador}
              onChangeText={(t) => updateField('procesador', t)}
              placeholder="Ej. Intel Core i5-8350U / Ryzen 5 4500U"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            {/* RAM y Almacenamiento */}
            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>RAM (GB) *</Text>
                  {iaData?.ram_gb != null && <Text style={styles.aiTag}>IA</Text>}
                </View>
                <TextInput
                  value={form.ram_gb}
                  onChangeText={(t) => updateField('ram_gb', t)}
                  placeholder="8"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Tamaño (GB)</Text>
                <TextInput
                  value={form.tamano_almacenamiento}
                  onChangeText={(t) => updateField('tamano_almacenamiento', t)}
                  placeholder="256"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
            </View>

            {/* Tipo de almacenamiento chips */}
            <Text style={styles.label}>Tipo de almacenamiento</Text>
            <View style={styles.chipsRow}>
              {STORAGE_CHIPS.map((chip) => {
                const active = form.tipo_almacenamiento === chip;
                return (
                  <Pressable
                    key={chip}
                    onPress={() => updateField('tipo_almacenamiento', chip)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Pantalla y Número de Serie */}
            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Pantalla</Text>
                <TextInput
                  value={form.pantalla}
                  onChangeText={(t) => updateField('pantalla', t)}
                  placeholder='14" FHD'
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Número de serie</Text>
                <TextInput
                  value={form.numero_serie}
                  onChangeText={(t) => updateField('numero_serie', t)}
                  placeholder="Opcional"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </View>
            </View>

            {/* Notas escritas */}
            <Text style={styles.label}>Notas adicionales de la compra (Registro escrito)</Text>
            <TextInput
              value={form.notas}
              onChangeText={(t) => updateField('notas', t)}
              placeholder="Ej. Viene sin cargador, teclado iluminado, estética 9/10..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={2}
              style={[styles.input, { minHeight: 60 }]}
            />
          </View>

          {/* Resumen del costo total */}
          <View style={styles.totalBox}>
            <View>
              <Text style={styles.totalLabel}>Costo total de adquisición</Text>
              <Text style={styles.totalSub}>Producto + Flete prorrateado</Text>
            </View>
            <Text style={styles.totalValue}>{formatUSD(costoTotal)}</Text>
          </View>

          {/* Botón Guardar */}
          <Pressable
            onPress={guardarCompra}
            disabled={saving}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="save" size={22} color="#fff" />
                <Text style={styles.saveButtonText}>Guardar Compra en ERP</Text>
              </>
            )}
          </Pressable>

          <Pressable onPress={resetFormulario} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Limpiar Formulario</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* MODAL CREAR NUEVO PROVEEDOR */}
      <Modal visible={modalProveedorVisible} transparent animationType="slide" onRequestClose={() => setModalProveedorVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setModalProveedorVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Nuevo Proveedor</Text>
              <Pressable onPress={() => setModalProveedorVisible(false)} hitSlop={12}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.label}>Nombre del Proveedor *</Text>
              <TextInput
                value={nuevoProvNombre}
                onChangeText={setNuevoProvNombre}
                placeholder="Ej. BestDeals Miami / Don Carlos Particular"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              <Text style={[styles.label, { marginTop: spacing.md }]}>Tipo de proveedor</Text>
              <View style={styles.chipsRow}>
                {TIPOS_PROVEEDOR.map((tp) => (
                  <Pressable
                    key={tp}
                    onPress={() => setNuevoProvTipo(tp)}
                    style={[styles.chip, nuevoProvTipo === tp && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, nuevoProvTipo === tp && styles.chipTextActive]}>{tp}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.label, { marginTop: spacing.md }]}>Contacto (WhatsApp / Email)</Text>
              <TextInput
                value={nuevoProvContacto}
                onChangeText={setNuevoProvContacto}
                placeholder="+505 8888-8888 o usuario@ebay.com"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              <Text style={[styles.label, { marginTop: spacing.md }]}>País</Text>
              <TextInput
                value={nuevoProvPais}
                onChangeText={setNuevoProvPais}
                placeholder="Estados Unidos / Nicaragua"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />

              <Pressable
                onPress={guardarNuevoProveedor}
                disabled={creandoProv}
                style={({ pressed }) => [styles.btnGuardarModal, pressed && styles.pressed, creandoProv && styles.disabled]}
              >
                {creandoProv ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.btnGuardarModalText}>Guardar y Seleccionar</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.lg, paddingBottom: 48 },
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
  modoSelector: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modoBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modoBtnActive: { backgroundColor: colors.primary },
  modoBtnText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  modoBtnTextActive: { color: '#fff' },
  imageBlock: { marginBottom: spacing.md },
  bigButton: {
    height: 240,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDark,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  bigButtonContent: { alignItems: 'center', paddingHorizontal: spacing.xl },
  bigButtonText: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: spacing.md, textAlign: 'center' },
  bigButtonSub: { color: '#C7D7FE', fontSize: 13, marginTop: spacing.xs, textAlign: 'center' },
  previewContainer: { width: '100%', height: '100%', position: 'relative' },
  preview: { width: '100%', height: '100%' },
  btnQuitarImagen: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  btnQuitarImagenText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: { color: colors.text, marginTop: spacing.md, fontSize: 15, fontWeight: '700' },
  imageActionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  secondaryButtonDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: `${colors.danger}15`,
  },
  secondaryButtonDangerText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  notaBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.4)',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  notaText: { color: colors.warning, flex: 1, fontSize: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  btnAddProv: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.primary}22`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  btnAddProvText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  provVacioBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 6 },
  aiTag: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
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
  twoCols: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  chipsScroll: { marginHorizontal: -spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  totalBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  totalSub: { color: colors.textMuted, fontSize: 11 },
  totalValue: { color: colors.success, fontSize: 24, fontWeight: '900' },
  saveButton: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancelButton: { alignItems: 'center', paddingVertical: spacing.lg },
  cancelText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
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
  histProveedor: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  histEquipoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: spacing.md,
  },
  histEquipoTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  histEquipoSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  histCostosRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  histCostoLabel: { color: colors.textMuted, fontSize: 12 },
  histRef: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs, fontStyle: 'italic' },
  centerEmpty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '90%',
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
