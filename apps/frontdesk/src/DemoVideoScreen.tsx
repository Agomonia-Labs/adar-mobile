import React, { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface DemoVideoScreenProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "Watch how it works" -- a short, bundled walkthrough of the real app
 * (sign up, the six sample practices, booking by hand or by asking ADAR,
 * confirmation, and My Calendar), reachable from the sign-in screen for
 * anyone who wants to see the whole flow before creating an account.
 *
 * The clip ships inside the app bundle (assets/demo-walkthrough.mp4, same
 * file used for the App Store preview and the adar-web demo page) rather
 * than streaming, so it plays instantly and works offline -- this is a
 * short, fixed asset, not something that needs a network round trip.
 */
export function DemoVideoScreen({ visible, onClose }: DemoVideoScreenProps) {
  const [loading, setLoading] = useState(true);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>How it works</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.playerWrap}>
          {loading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          ) : null}
          <Video
            source={require('../assets/demo-walkthrough.mp4')}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay={visible}
            isLooping={false}
            onLoadStart={() => setLoading(true)}
            onReadyForDisplay={() => setLoading(false)}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1626' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  closeButton: { paddingVertical: 6, paddingHorizontal: 10 },
  closeText: { color: '#3FD1B4', fontSize: 15, fontWeight: '700' },
  playerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  loadingOverlay: {
    position: 'absolute',
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
