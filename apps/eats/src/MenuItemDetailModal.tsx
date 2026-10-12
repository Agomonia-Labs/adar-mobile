import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { EatsMenuItem, EatsMenuItemEdits } from './eatsApi';

const BRAND = '#1b2430';

function formatPrice(price: number | null, currency: string): string {
  if (price == null) return 'Price not set';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(2)}`;
}

interface EditFormState {
  item_name: string;
  category: string;
  price: string;
  quantity: string;
  description: string;
  dietary_tags: string;
  spice_level: string;
  availability: string;
}

function toFormState(item: EatsMenuItem): EditFormState {
  return {
    item_name: item.item_name || '',
    category: item.category || '',
    price: item.price != null ? String(item.price) : '',
    quantity: item.quantity || '',
    description: item.description || '',
    dietary_tags: Array.isArray(item.dietary_tags) ? item.dietary_tags.join(', ') : '',
    spice_level: item.spice_level || '',
    availability: item.availability || '',
  };
}

/** Full-detail popup for one menu item -- name, category, price, quantity,
 *  description, and photo all together in one screen, on tap/click,
 *  instead of a row that only ever shows a sliver of this at a time.
 *  Shared by the Owner's "Manage menu photos" screen and the Discover
 *  tab's menu search/compare results, so tapping any menu item anywhere
 *  in the app opens the same kind of detail view. `restaurantContext`
 *  (restaurant name / cuisine) is customer-facing-only info that Owner's
 *  own-restaurant list doesn't need to repeat.
 *
 *  `editable` + `onSave` turn on an "Edit" button (Owner's menu screen
 *  only -- Discover never passes these): tapping it swaps the read-only
 *  view for a form over the same fields, and Save calls onSave with only
 *  the changed fields (PATCH semantics, matching
 *  routes/restaurant.py's update_menu_item). A customer never sees this --
 *  Discover's usage leaves editable unset. */
export function MenuItemDetailModal({
  item,
  visible,
  onClose,
  restaurantContext = true,
  editable = false,
  onSave,
  onAddToCart,
}: {
  item: EatsMenuItem | null;
  visible: boolean;
  onClose: () => void;
  restaurantContext?: boolean;
  editable?: boolean;
  onSave?: (edits: EatsMenuItemEdits) => Promise<void>;
  // Customer-facing only (Discover/chat) -- when set, a non-editing view
  // shows an "Add to cart" button alongside Close instead of just Close.
  onAddToCart?: (item: EatsMenuItem, quantity: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addQty, setAddQty] = useState(1);

  // Reset to a fresh read-only view whenever a different item is opened
  // (or the modal is closed and reopened on the same item) -- otherwise a
  // half-edited form from the last item tapped could leak into this one.
  useEffect(() => {
    setEditing(false);
    setForm(item ? toFormState(item) : null);
    setError(null);
    setSaving(false);
    setAddQty(1);
  }, [item?.id, visible]);

  const startEdit = () => {
    if (item) setForm(toFormState(item));
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (item) setForm(toFormState(item));
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (!item || !form || !onSave) return;
    let price: number | null = null;
    if (form.price.trim()) {
      const parsed = Number(form.price.trim());
      if (Number.isNaN(parsed)) {
        setError('Price must be a number.');
        return;
      }
      price = parsed;
    }
    setSaving(true);
    setError(null);
    try {
      const edits: EatsMenuItemEdits = {
        item_name: form.item_name.trim(),
        category: form.category.trim(),
        price,
        quantity: form.quantity.trim(),
        description: form.description.trim(),
        dietary_tags: form.dietary_tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        spice_level: form.spice_level.trim(),
        availability: form.availability.trim(),
      };
      await onSave(edits);
      setEditing(false);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible && !!item} animationType="slide" transparent onRequestClose={editing ? cancelEdit : onClose}>
      {/* Edit mode's form fields (item name, price, description, ...) are
          plain TextInputs in a bottom-sheet Modal -- without this, the
          keyboard covers the sheet instead of pushing it up, same bug as
          the scribe recorder/review screens. backdrop is
          justifyContent:'flex-end', so "padding" behavior here adds
          bottom padding equal to the keyboard height and the sheet rides
          up above it. */}
      <KeyboardAvoidingView style={styles.flexFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>
          {item && !editing && (
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoPlaceholder]}>
                  <Text style={styles.photoPlaceholderText}>No photo yet</Text>
                </View>
              )}

              <View style={styles.titleRow}>
                <Text style={styles.name}>{item.item_name || 'Untitled item'}</Text>
                <Text style={styles.price}>{formatPrice(item.price, item.currency || 'USD')}</Text>
              </View>

              {restaurantContext && item.restaurant_name ? (
                <Text style={styles.restaurant}>
                  {item.restaurant_name}
                  {item.cuisine_type ? ` · ${item.cuisine_type}` : ''}
                </Text>
              ) : null}

              <View style={styles.metaRow}>
                {item.category ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{item.category}</Text>
                  </View>
                ) : null}
                {item.quantity ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{item.quantity}</Text>
                  </View>
                ) : null}
                {item.spice_level ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{item.spice_level}</Text>
                  </View>
                ) : null}
                {item.availability && item.availability.toLowerCase() !== 'available' ? (
                  <View style={[styles.pill, styles.pillWarn]}>
                    <Text style={[styles.pillText, styles.pillTextWarn]}>{item.availability}</Text>
                  </View>
                ) : null}
              </View>

              {Array.isArray(item.dietary_tags) && item.dietary_tags.length > 0 ? (
                <Text style={styles.dietary}>{item.dietary_tags.join(' · ')}</Text>
              ) : null}

              {item.description ? (
                <Text style={styles.description}>{item.description}</Text>
              ) : (
                <Text style={styles.descriptionEmpty}>No description recorded for this item.</Text>
              )}

              {item.rating_count > 0 && (
                <Text style={styles.rating}>
                  ★ {item.avg_rating?.toFixed(1)} ({item.rating_count} {item.rating_count === 1 ? 'review' : 'reviews'})
                </Text>
              )}

              {onAddToCart && (
                <View style={styles.qtyRow}>
                  <Text style={styles.formLabel}>Quantity</Text>
                  <View style={styles.qtyStepper}>
                    <TouchableOpacity style={styles.qtyButton} onPress={() => setAddQty((q) => Math.max(1, q - 1))}>
                      <Text style={styles.qtyButtonText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{addQty}</Text>
                    <TouchableOpacity style={styles.qtyButton} onPress={() => setAddQty((q) => q + 1)}>
                      <Text style={styles.qtyButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          {item && editing && form && (
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.formLabel}>Item name</Text>
              <TextInput
                style={styles.formInput}
                value={form.item_name}
                onChangeText={(v) => setForm({ ...form, item_name: v })}
                placeholder="e.g. Chicken Biryani"
              />

              <View style={styles.formRow}>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>Category</Text>
                  <TextInput
                    style={styles.formInput}
                    value={form.category}
                    onChangeText={(v) => setForm({ ...form, category: v })}
                    placeholder="e.g. Entree"
                  />
                </View>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>Price (USD)</Text>
                  <TextInput
                    style={styles.formInput}
                    value={form.price}
                    onChangeText={(v) => setForm({ ...form, price: v })}
                    placeholder="e.g. 14.99"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              <View style={styles.formRow}>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>Quantity</Text>
                  <TextInput
                    style={styles.formInput}
                    value={form.quantity}
                    onChangeText={(v) => setForm({ ...form, quantity: v })}
                    placeholder="e.g. 1 lb"
                  />
                </View>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>Spice level</Text>
                  <TextInput
                    style={styles.formInput}
                    value={form.spice_level}
                    onChangeText={(v) => setForm({ ...form, spice_level: v })}
                    placeholder="e.g. Medium"
                  />
                </View>
              </View>

              <Text style={styles.formLabel}>Availability</Text>
              <TextInput
                style={styles.formInput}
                value={form.availability}
                onChangeText={(v) => setForm({ ...form, availability: v })}
                placeholder="available / seasonal / limited"
              />

              <Text style={styles.formLabel}>Dietary tags (comma separated)</Text>
              <TextInput
                style={styles.formInput}
                value={form.dietary_tags}
                onChangeText={(v) => setForm({ ...form, dietary_tags: v })}
                placeholder="e.g. vegetarian, gluten-free"
              />

              <Text style={styles.formLabel}>Description</Text>
              <TextInput
                style={[styles.formInput, styles.formTextarea]}
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                placeholder="What's in it, how it's served..."
                multiline
              />

              {error ? <Text style={styles.formError}>{error}</Text> : null}
            </ScrollView>
          )}

          <View style={styles.footerRow}>
            {editing ? (
              <>
                <TouchableOpacity style={[styles.footerButton, styles.footerButtonSecondary]} onPress={cancelEdit} disabled={saving}>
                  <Text style={styles.footerButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.footerButton} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerButtonText}>Save</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {editable && onSave ? (
                  <TouchableOpacity style={[styles.footerButton, styles.footerButtonSecondary]} onPress={startEdit}>
                    <Text style={styles.footerButtonSecondaryText}>Edit</Text>
                  </TouchableOpacity>
                ) : null}
                {!editable && onAddToCart && item ? (
                  <TouchableOpacity
                    style={[styles.footerButton, styles.footerButtonSecondary]}
                    onPress={() => {
                      onAddToCart(item, addQty);
                      onClose();
                    }}
                  >
                    <Text style={styles.footerButtonSecondaryText}>Add to cart</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.footerButton} onPress={onClose}>
                  <Text style={styles.footerButtonText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,13,18,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: 20,
  },
  handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d7dbe0' },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  photo: { width: '100%', height: 200, borderRadius: 14, backgroundColor: '#eef1f0', marginBottom: 16 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: '#8a94a3', fontSize: 13, fontWeight: '600' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 20, fontWeight: '700', color: '#14181f', flex: 1, marginRight: 10 },
  price: { fontSize: 18, fontWeight: '700', color: BRAND },
  restaurant: { fontSize: 13, color: '#5b6472', marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: { backgroundColor: '#eef1f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  pillWarn: { backgroundColor: '#fdecea' },
  pillTextWarn: { color: '#c0392b' },
  dietary: { fontSize: 12, color: '#5b6472', marginTop: 10, fontStyle: 'italic' },
  description: { fontSize: 14, color: '#374151', marginTop: 14, lineHeight: 21 },
  descriptionEmpty: { fontSize: 14, color: '#8a94a3', marginTop: 14, fontStyle: 'italic' },
  rating: { fontSize: 13, color: '#b7791f', marginTop: 14, fontWeight: '600' },
  qtyRow: { marginTop: 4 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#eef1f0', alignItems: 'center', justifyContent: 'center' },
  qtyButtonText: { fontSize: 18, fontWeight: '700', color: BRAND },
  qtyValue: { minWidth: 24, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#14181f' },
  formLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginTop: 14, marginBottom: 6 },
  formInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 9, fontSize: 14, color: '#14181f', backgroundColor: '#fff',
  },
  formTextarea: { minHeight: 80, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: 12 },
  formHalf: { flex: 1 },
  formError: { color: '#c0392b', fontSize: 13, marginTop: 12 },
  footerRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginTop: 12 },
  footerButton: { flex: 1, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  footerButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  footerButtonSecondary: { backgroundColor: '#eef1f0' },
  footerButtonSecondaryText: { color: '#374151', fontWeight: '700', fontSize: 14 },
});
