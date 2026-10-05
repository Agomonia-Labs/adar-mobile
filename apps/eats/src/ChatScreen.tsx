import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import {
  EatsChatMessage,
  EatsChatSessionSummary,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  saveChatSessionMessages,
  streamRestaurantChat,
} from './eatsApi';
import { MarkdownMessage } from './MarkdownMessage';
import { useCart } from './CartContext';
import { useLanguagePreference } from './i18n/useLanguagePreference';
import { VoiceRecorderButton } from './VoiceRecorderButton';
import { ListenButton } from './ListenButton';

const BRAND = '#1b2430';

interface ChatMenuAction {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  item_name: string;
  category?: string;
  price?: number | null;
  currency?: string;
}

interface Message extends EatsChatMessage {
  streaming?: boolean;
  menuActions?: ChatMenuAction[];
  autoAdded?: ChatMenuAction;
  autoAddedQuantity?: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** The ADAR Eats customer-facing menu assistant -- "the main way" diners
 *  compare dishes/prices and decide what to order (per the user's framing),
 *  built on the SAME /api/chat/stream + /api/chat/sessions infrastructure
 *  DocIntel already uses, just with `marketplace: true` so it searches
 *  every marketplace-visible restaurant instead of documents the caller
 *  selected. Two views: a session list (past conversations, newest first)
 *  and a conversation view, mirroring the Documents tab's list/detail
 *  pattern already used in this app. */
export function ChatScreen() {
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [startingNew, setStartingNew] = useState(false);

  if (openSessionId || startingNew) {
    return (
      <ConversationScreen
        sessionId={openSessionId}
        onBack={() => {
          setOpenSessionId(null);
          setStartingNew(false);
        }}
      />
    );
  }

  return <SessionListScreen onOpen={setOpenSessionId} onStartNew={() => setStartingNew(true)} />;
}

function SessionListScreen({
  onOpen,
  onStartNew,
}: {
  onOpen: (id: string) => void;
  onStartNew: () => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [sessions, setSessions] = useState<EatsChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listChatSessions(client, accessToken);
      setSessions(list);
      setError(null);
    } catch (err) {
      setError('Could not load your past conversations. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDelete = useCallback(
    async (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      try {
        await deleteChatSession(client, accessToken, id);
      } catch {
        refresh();
      }
    },
    [client, accessToken, refresh]
  );

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.listHeaderTitle}>Menu Assistant</Text>
          <Text style={styles.listHeaderHint}>
            Ask about dishes, prices, and restaurants to decide what to order.
          </Text>
        </View>
        <TouchableOpacity style={styles.newChatButton} onPress={onStartNew}>
          <Text style={styles.newChatButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && sessions.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <FlatList
          style={styles.list}
          data={sessions}
          keyExtractor={(item) => item.id}
          onRefresh={refresh}
          refreshing={loading}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => onOpen(item.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.cardDate}>
                  {item.message_count} message{item.message_count === 1 ? '' : 's'} · {formatDate(item.updated_at)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => onDelete(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  No conversations yet. Tap "+ New" and ask something like "what's the
                  cheapest biryani near me" or "compare menus at Royal Biriyani House and
                  Biriyani Bistro".
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function ConversationScreen({ sessionId: initialSessionId, onBack }: { sessionId: string | null; onBack: () => void }) {
  const { client, session } = useAuth();
  const accessToken = session?.accessToken || '';
  const baseURL: string = (client as any).defaults.baseURL;
  const cart = useCart();
  const { language, meta, languages, setLanguage } = useLanguagePreference();

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(!!initialSessionId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<Message>>(null);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getChatSession(client, accessToken, initialSessionId);
        if (!cancelled) setMessages(detail.messages as Message[]);
      } catch {
        // fall through to an empty conversation rather than blocking the screen
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      cancelRef.current?.cancel();
    };
  }, []);

  const onSend = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: question };
    const assistantId = `a-${Date.now()}`;
    const historyForRequest = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setBusy(true);

    // Lazily create the session on the first message rather than the
    // moment the screen opens -- otherwise every tap of "+ New" that the
    // diner abandons without asking anything would leave a blank "New
    // Chat" row cluttering their conversation list.
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      try {
        const created = await createChatSession(client, accessToken, question.slice(0, 60));
        activeSessionId = created.id;
        setSessionId(created.id);
      } catch {
        // If session creation fails, still let the diner get an answer --
        // it just won't be saved to their conversation history.
      }
    }

    cancelRef.current = streamRestaurantChat(
      baseURL,
      accessToken,
      { question, history: historyForRequest, responseLanguage: language },
      {
        onToken: (t) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
        },
        onDone: (evt) => {
          const actionsPayload = (evt as any)?.actions;
          const menuActions: ChatMenuAction[] | undefined = Array.isArray(actionsPayload?.restaurant_menu_items)
            ? actionsPayload.restaurant_menu_items
            : undefined;
          // Conversational "add X to cart" support: the backend only sets
          // auto_add when it resolved the request to exactly one menu item
          // unambiguously (see _detect_cart_add_intent / the RESTAURANT
          // ORDERING RULE prompt server-side) -- a clarifying question for
          // an ambiguous match still comes back as plain tappable chips
          // below, never auto-added. Call cart.addItem here, outside the
          // setMessages updater, so it never risks firing twice under
          // React's dev-mode double-invoke of updater functions.
          const autoAddItem =
            actionsPayload?.auto_add === true && menuActions && menuActions.length === 1
              ? menuActions[0]
              : undefined;
          const autoAddQuantity: number =
            typeof actionsPayload?.auto_add_quantity === 'number' && actionsPayload.auto_add_quantity > 0
              ? Math.floor(actionsPayload.auto_add_quantity)
              : 1;
          // cart.addItem() pops a native "Replace cart?" confirmation
          // and leaves the cart UNCHANGED until the user answers it,
          // whenever the cart already holds items from a different
          // restaurant (see CartContext.tsx). That's the right behavior
          // for an explicit tap on a chip -- but firing it from here,
          // unprompted, means the alert can appear while the user isn't
          // looking at it, or get missed/dismissed, and the chat bubble
          // would still claim "added" while the cart stays exactly as
          // it was. So auto-add only actually fires when it can't
          // collide with an existing different-restaurant cart;
          // otherwise this falls back to the ordinary tappable chip
          // (menuActions is unchanged, so it still renders below),
          // which drives that same confirmation correctly because a
          // real tap is behind it.
          const wouldConflictWithCart =
            !!autoAddItem &&
            !!cart.restaurantId &&
            cart.restaurantId !== autoAddItem.restaurant_id &&
            cart.items.length > 0;
          const resolvedAutoAddItem = wouldConflictWithCart ? undefined : autoAddItem;
          if (resolvedAutoAddItem) {
            cart.addItem({
              menu_item_id: resolvedAutoAddItem.id,
              item_name: resolvedAutoAddItem.item_name,
              category: resolvedAutoAddItem.category,
              unit_price: resolvedAutoAddItem.price ?? null,
              currency: resolvedAutoAddItem.currency || 'USD',
              restaurant_id: resolvedAutoAddItem.restaurant_id,
              restaurant_name: resolvedAutoAddItem.restaurant_name,
              quantity: autoAddQuantity,
            });
          }
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    menuActions,
                    autoAdded: resolvedAutoAddItem,
                    autoAddedQuantity: resolvedAutoAddItem ? autoAddQuantity : undefined,
                  }
                : m
            );
            if (activeSessionId) {
              const toSave: EatsChatMessage[] = next.map(({ id, role, content }) => ({ id, role, content }));
              saveChatSessionMessages(client, accessToken, activeSessionId, toSave).catch(() => {});
            }
            return next;
          });
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

  return (
    <SafeAreaView style={[styles.flex, { paddingBottom: keyboardHeight }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Menu Assistant</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.languageRow}>
        {languages.map((l) => (
          <TouchableOpacity
            key={l.code}
            style={[styles.languageChip, l.code === language && styles.languageChipActive]}
            onPress={() => setLanguage(l.code)}
          >
            <Text style={[styles.languageChipText, l.code === language && styles.languageChipTextActive]}>
              {l.nativeName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loadingHistory ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
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
              Ask about any marketplace restaurant's menu -- prices, dietary options,
              or "which has the cheaper biryani."
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
              {!item.streaming && item.role === 'assistant' && item.content ? (
                <ListenButton client={client} accessToken={accessToken} text={item.content} meta={meta} />
              ) : null}
              {!item.streaming && item.autoAdded && (
                <View style={styles.autoAddedWrap}>
                  <Text style={styles.autoAddedText}>
                    {'\u2705'} Added {item.autoAddedQuantity && item.autoAddedQuantity > 1 ? `${item.autoAddedQuantity}x ` : ''}
                    {item.autoAdded.item_name} to your cart
                  </Text>
                </View>
              )}
              {!item.streaming && !item.autoAdded && item.menuActions && item.menuActions.length > 0 && (
                <View style={styles.actionChipsWrap}>
                  {item.menuActions.map((action) => (
                    <TouchableOpacity
                      key={action.id}
                      style={styles.actionChip}
                      onPress={() =>
                        cart.addItem({
                          menu_item_id: action.id,
                          item_name: action.item_name,
                          category: action.category,
                          unit_price: action.price ?? null,
                          currency: action.currency || 'USD',
                          restaurant_id: action.restaurant_id,
                          restaurant_name: action.restaurant_name,
                        })
                      }
                    >
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
      )}

      <View style={styles.inputRow}>
        <VoiceRecorderButton
          client={client}
          accessToken={accessToken}
          sttHint={meta.sttHint}
          disabled={busy}
          onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
        />
        <TextInput
          style={styles.input}
          placeholder="Ask about menus, prices, dishes..."
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
  listHeader: {
    flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderBottomWidth: 1,
    borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  listHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#14181f' },
  listHeaderHint: { fontSize: 13, color: '#5b6472', marginTop: 4 },
  newChatButton: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginLeft: 10 },
  newChatButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  list: { flex: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#e2e5ea',
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#14181f' },
  cardDate: { fontSize: 12, color: '#5b6472', marginTop: 4 },
  deleteText: { color: '#c0392b', fontSize: 13, fontWeight: '600', marginLeft: 12 },
  emptyWrap: { padding: 24 },
  emptyText: { fontSize: 14, color: '#5b6472', textAlign: 'center', lineHeight: 20, padding: 16 },
  errorText: { color: '#c0392b', fontSize: 13, padding: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  languageRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  languageChip: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  languageChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  languageChipText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },
  languageChipTextActive: { color: '#fff' },
  backButton: { width: 50 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
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
