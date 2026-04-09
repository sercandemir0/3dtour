import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0f0f23' },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: '3DTour' }}
        />
        <Stack.Screen
          name="tour/new"
          options={{ title: 'Yeni Tur', presentation: 'modal' }}
        />
        <Stack.Screen
          name="tour/[id]/index"
          options={{ title: 'Tur Detay' }}
        />
        <Stack.Screen
          name="tour/[id]/viewer"
          options={{
            title: 'Tur Görüntüle',
            headerShown: false,
          }}
        />
      </Stack>
    </>
  );
}
