import React, { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { analyzeFeedback, submitFeedback } from './eatsApi';

const BRAND = '#1b2430';

export interface FeedbackTarget {
  restaurant_id: string;
  restaurant_name?: string;
  menu_item_id?: string | null;
  menu_item_name?: string | null;
  order_id?: string | null;
}

/** Star rating + text feedback, submitted via POST /api/restaurant/feedback
 *  -- mirrors RestaurantPanel.jsx's feedback tab (minus voice recording,
 *  which is a web-only nice-to-have). Ratings feed back into menu search/
 *  compare/recommend for everyone else (see eatsApi.ts's submitFeedback
 *  doc comment). */
export function FeedbackModal({
  visible,
  target,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  target: FeedbackTarget | null;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRating(5);
    setText('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const suggestRating = async () => {
    if (!text.trim()) {
      setError('Type some feedback first so a rating can be suggested.');
      return;
    }
    setSuggesting(true);
    setError(null);
    try {
      const analysis = await analyzeFeedback(client, accessToken, {
        feedbackText: text,
        currentRating: rating,
        restaurantName: target?.restaurant_name || '',
        menuItemName: target?.menu_item_name || '',
      });
      if (analysis?.suggested_rating) setRating(Number(analysis.suggested_rating));
    } catch {
      setError('Could not suggest a rating right now.');
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    if (!target?.restaurant_id) {
      setError('Missing restaurant for this feedback.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitFeedback(client, accessToken, {
        restaurantId: target.restaurant_id,
        menuItemId: target.menu_item_id,
        orderId: target.order_id,
        rating,
        feedbackText: text,
      });
      reset();
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not submit feedback.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Rate your experience</Text>
          {target?.menu_item_name ? (
            <Text style={styles.subtitle}>{target.menu_item_name}{target.restaurant_name ? ` · ${target.restaurant_name}` : ''}</Text>
          ) : target?.restaurant_name ? (
            <Text style={styles.subtitle}>{target.restaurant_name}</Text>
          ) : null}

          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setRating(n)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                <Text style={[styles.star, n <= rating && styles.starActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.textInput}
            placeholder="What stood out? (optional)"
            value={text}
            onChangeText={setText}
            multiline
          />

          <TouchableOpacity onPress={suggestRating} disabled={suggesting} style={styles.suggestLink}>
            <Text style={styles.suggestLinkText}>{suggesting ? 'Thinking…' : 'Suggest a rating from my text'}</Text>
          </TouchableOpacity>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={close}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} disabled={busy} onPress={submit}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 32 },
  title: { fontSize: 17, fontWeight: '700', color: '#14181f' },
  subtitle: { fontSize: 13, color: '#5b6472', marginTop: 4 },
  stars: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 14 },
  star: { fontSize: 32, color: '#d7dbe0' },
  starActive: { color: '#f1b94c' },
  textInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 70,
    textAlignVertical: 'top',
  },
  suggestLink: { marginTop: 10 },
  suggestLinkText: { color: BRAND, fontSize: 13, fontWeight: '600' },
  errorText: { color: '#c0392b', fontSize: 13, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  primaryButton: { flex: 1, backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
