import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/theme';

/**
 * Layout raíz de LaptopSeller.
 *
 * TODO: La funcionalidad de la burbuja flotante se implementará a escala en una
 * futura actualización con una arquitectura moderna. Por ahora, se retira de forma
 * intencional para optimizar el rendimiento nativo, garantizando que la app no sufra
 * caídas de frames ni se sienta lenta al hacer multitasking pesado o cambiar
 * rápidamente entre aplicaciones externas (ej. eBay, Facebook, LaptopSeller).
 *
 * Elementos retirados junto con `react-native-floating-bubble`:
 *  - Inicialización, solicitud/verificación del permiso SYSTEM_ALERT_WINDOW y
 *    show/hide de la burbuja.
 *  - Listeners `floating-bubble-press` / `floating-bubble-remove` y el listener de
 *    AppState usado para reintentar el permiso.
 *  - Seguimiento de la última ruta (`setLastPath`) y el deep link `bubble-open`
 *    (services/bubbleNavigation.ts y app/+native-intent.tsx).
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
