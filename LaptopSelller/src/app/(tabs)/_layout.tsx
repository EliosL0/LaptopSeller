import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Compras',
          headerTitle: 'Compras · ERP Beta',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="taller"
        options={{
          title: 'Taller',
          headerTitle: 'Taller · Reparación y Piezas',
          tabBarIcon: ({ color, size }) => <Ionicons name="construct" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ventas"
        options={{
          title: 'Ventas',
          headerTitle: 'Ventas · Marketplace',
          tabBarIcon: ({ color, size }) => <Ionicons name="pricetags" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="garantias"
        options={{
          title: 'Garantías',
          headerTitle: 'Garantías y Reclamos',
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reportes"
        options={{
          title: 'Reportes',
          headerTitle: 'Kárdex · Finanzas · Bitácora',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
