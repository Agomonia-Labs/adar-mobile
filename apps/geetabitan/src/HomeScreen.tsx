import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';

// Placeholder post-login screen — replace with the real Geetabitan
// (Rabindra Sangeet assistant) UI.
export function HomeScreen() {
  const { session, signOut, tenant } = useAuth();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#f7f8fa' }]}>
      <View style={styles.content}>
        <Text style={styles.title}>{tenant.displayName}</Text>
        <Text style={styles.subtitle}>Signed in as {session?.teamName}</Text>
        <Text style={styles.meta}>Role: {session?.role}</Text>
        <Text style={styles.placeholder}>Build the real product UI here.</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: tenant.brandColor }]}
          onPress={() => signOut()}
        >
          <Text style={styles.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#5b6472', marginBottom: 2 },
  meta: { fontSize: 13, color: '#5b6472', marginBottom: 16 },
  placeholder: { fontSize: 13, color: '#9aa2ad', marginBottom: 24, fontStyle: 'italic' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
