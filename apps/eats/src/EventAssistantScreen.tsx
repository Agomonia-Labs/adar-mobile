import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import { EatsEventChatMenuAction, EatsEventDetail, streamEventChat } from './eatsApi';
import { MarkdownMessage } from './MarkdownMessage';
import { useEventCart } from './EventCartContext';

const BRAND = '#1b2430';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  menuActions?: EatsEventChatMenuAction[];
  autoAdded?: EatsEventChatMenuAction;
  autoAddedQuantity?: number;
}

/** "Use the assistant instead" path for event ordering -- a single,
 *  un-persisted conversation (unlike the main Menu Assistant's saved
 *  session list in ChatScreen.tsx) scoped to exactly one event via
 *  streamEventChat's event_id, mirroring the web app's EventAssistantPanel
 *  (a compact single-conversation chat embedded in EventsPage.jsx).
 *  Parses actions by their EXPLICIT event_menu_item_id/stall_id/
 *  stall_name/accepting_orders fields (see EatsEventChatMenuAction's own
 *  comment) -- never the internally-repurposed generic menu_item_id/
 *  restaurant_id keys the backend also sets on the same action object. */
export function EventAssistantScreen({ event, onBack }: { event: EatsEventDetail; onBack: () => void }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const baseURL: string = (client as any).defaults.baseURL;
  const cart = useEventCart();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);

  const onSend = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    Keyboard.dismiss();
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: question };
    const assistantId = `a-${Date.now()}`;
    const historyForRequest = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setBusy(true);

    cancelRef.current = streamEventChat(
      baseURL,
      accessToken,
      { question, history: historyForRequest, eventId: event.id },
      {
        onToken: (t) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
        },
        onDone: (evt) => {
          const actionsPayload = (evt as any)?.actions;
          const menuActions: EatsEventChatMenuAction[] | undefined = Array.isArray(actionsPayload?.restaurant_menu_items)
            ? actionsPayload.restaurant_menu_items
            : undefined;
          const autoAddItem =
            actionsPayload?.auto_add === true && menuActions && menuActions.length === 1
              ? menuActions[0]
              : undefined;
          const autoAddQuantity: number =
            typeof actionsPayload?.auto_add_quantity === 'number' && actionsPayload.auto_add_quantity > 0
              ? Math.floor(actionsPayload.auto_add_quantity)
              : 1;
          // Same guard ChatScreen.tsx's carryout assistant uses: auto-add
          // only fires when it can't silently collide with a different
          // stall already in the event cart -- otherwise this falls back
          // to an ordinary tappable chip, which drives the "Replace
          // cart?" confirmation correctly because a real tap is behind it.
          const wouldConflictWithCart =
            !!autoAddItem &&
            !!cart.stallId &&
            cart.stallId !== autoAddItem.stall_id &&
            cart.items.length > 0;
          const resolvedAutoAddItem = wouldConflictWithCart ? undefined : autoAddItem;
          if (resolvedAutoAddItem) {
            cart.addItem({
              eventMenuItemId: resolvedAutoAddItem.event_menu_item_id,
              itemName: resolvedAutoAddItem.item_name,
              category: resolvedAutoAddItem.category,
              unitPrice: resolvedAutoAddItem.price ?? null,
              currency: resolvedAutoAddItem.currency || 'USD',
              eventId: event.id,
              eventName: event.name,
              stallId: resolvedAutoAddItem.stall_id,
              stallName: resolvedAutoAddItem.stall_name,
              quantity: autoAddQuantity,
            });
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    menuActions,
                    autoAdded: resolvedAutoAddItem,
                    autoAddedQuantity: resolvedAutoAddItem ? autoAddQuantity : undefined,
                  }
                : m
            )
          );
          setBusy(false);
        },
        onError: (msg) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content || `⚠️ ${msg}`, streaming: false } : m))
          );
          setBusy(false);
        },
      }
    );
  };

  const addFromChip = (action: EatsEventChatMenuAction) => {
    cart.addItem({
      eventMenuItemId: action.event_menu_item_id,
      itemName: action.item_name,
      category: action.category,
      unitPrice: action.price ?? null,
      currency: action.currency || 'USD',
      eventId: event.id,
      eventName: event.name,
      stallId: action.stall_id,
      stallName: action.stall_name,
    });
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{event.name}</Text>
        <View style={{ width: 50 }} />
      </View>

      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={{ padding: 16 }}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => {
          listRef.current?.scrollToEnd({ animated: true });
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Ask about this event -- how many stalls are participating, what's available, dietary options, and
            more.
          </Text>
        }
        renderItem={({ item }) => (
          <View>
            <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              {item.role === 'user' ? (
                <Text style={styles.bubbleTextUser}>{item.content}</Text>
              ) : item.content ? (
                <MarkdownMessage>{item.content}</MarkdownMessage>
              ) : (
                <Text style={styles.bubbleTextAssistant}>{item.streaming ? '…' : ''}</Text>
              )}
              {item.streaming && item.content ? (
                <ActivityIndicator size="small" color={BRAND} style={{ marginTop: 6 }} />
              ) : null}
            </View>
            {!item.streaming && item.autoAdded && (
              <View style={styles.autoAddedWrap}>
                <Text style={styles.autoAddedText}>
                  {'✅'} Added {item.autoAddedQuantity && item.autoAddedQuantity > 1 ? `${item.autoAddedQuantity}x ` : ''}
                  {item.autoAdded.item_name} to your cart
                </Text>
              </View>
            )}
            {!item.streaming && !item.autoAdded && item.menuActions && item.menuActions.length > 0 && (
              <View style={styles.actionChipsWrap}>
                {item.menuActions.map((action) => (
                  <TouchableOpacity key={action.event_menu_item_id} style={styles.actionChip} onPress={() => addFromChip(action)}>
                    <Text style={styles.actionChipText}>
                      + Add {action.item_name}
                      {action.price != null ? ` ($${Number(action.price).toFixed(2)})` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={`Ask about ${event.name}...`}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!busy}
        />
        <TouchableOpacity
          style={[styles.sendButton, { opacity: input.trim() && !busy ? 1 : 0.5 }]}
          onPress={onSend}
          disabled={!input.trim() || busy}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  backButton: { width: 50 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#14181f', textAlign: 'center' },
  emptyText: { fontSize: 14, color: '#5b6472', textAlign: 'center', lineHeight: 20, padding: 16 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 10 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: BRAND },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea' },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: '#14181f', fontSize: 14, lineHeight: 20 },
  actionChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14, marginLeft: 4 },
  actionChip: { backgroundColor: '#eef1f0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  actionChipText: { color: BRAND, fontWeight: '700', fontSize: 12.5 },
  autoAddedWrap: { marginBottom: 14, marginLeft: 4 },
  autoAddedText: { color: '#1f7a4d', fontWeight: '700', fontSize: 12.5 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#e2e5ea',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, maxHeight: 100, marginRight: 8,
  },
  sendButton: { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
