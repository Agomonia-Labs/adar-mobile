import React, { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const RED = '#c0392b';
// How much of the row slides away to reveal the Delete button behind it --
// matches the button's own width so it's either fully hidden or fully
// shown, never half-cut.
export const SWIPE_REVEAL_WIDTH = 84;

/** A row that can be dragged left to reveal a red Delete button behind it --
 *  no gesture library needed (react-native-gesture-handler isn't a
 *  dependency in this app, and adding one mid-testing would need a native
 *  rebuild -- pod install plus a fresh Xcode build -- which isn't
 *  something to reach for casually), just core RN Animated + PanResponder.
 *  Swipe right also works (it simply closes an already-open row a beat
 *  early). Tapping the row while it's open closes it instead of firing its
 *  own onPress, matching how Mail/Reminders-style swipe rows behave
 *  elsewhere. Shared by Workspaces, Documents, Video, and Conversations --
 *  wrap a row in it only when the viewer is actually allowed to delete
 *  that item (each screen decides that for its own permission model). */
export function SwipeableRow({
  children,
  onDelete,
  disabled,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = () => {
    isOpen.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };
  const open = () => {
    isOpen.current = true;
    Animated.spring(translateX, { toValue: -SWIPE_REVEAL_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        !disabled && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_evt, gesture) => {
        const base = isOpen.current ? -SWIPE_REVEAL_WIDTH : 0;
        const next = base + gesture.dx;
        translateX.setValue(Math.max(-SWIPE_REVEAL_WIDTH, Math.min(0, next)));
      },
      onPanResponderRelease: (_evt, gesture) => {
        const base = isOpen.current ? -SWIPE_REVEAL_WIDTH : 0;
        const finalValue = Math.max(-SWIPE_REVEAL_WIDTH, Math.min(0, base + gesture.dx));
        if (finalValue <= -SWIPE_REVEAL_WIDTH / 2) {
          open();
        } else {
          close();
        }
      },
    })
  ).current;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.deleteButton} onPress={() => { close(); onDelete(); }} disabled={disabled}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
        onStartShouldSetResponderCapture={() => isOpen.current}
        onResponderGrant={() => { if (isOpen.current) close(); }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10, borderRadius: 12, overflow: 'hidden' },
  deleteButton: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: SWIPE_REVEAL_WIDTH,
    backgroundColor: RED, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
  },
  deleteText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
