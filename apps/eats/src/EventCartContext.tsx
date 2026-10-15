import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert } from 'react-native';

// Event/stall cart, kept purely as in-memory client state -- same
// rationale as CartContext.tsx's carryout cart: it only becomes a server
// record once "Review order" calls createEventOrderDraft. A SEPARATE
// context from CartContext rather than one more field on it, because the
// two carts are genuinely independent -- a diner can have a regular
// carryout cart from one restaurant AND an event cart from one stall at
// the same time, and placing/clearing one should never touch the other.
// Scoped by event_id + stall_id (one stall per cart, mirroring the
// carryout cart's one-restaurant-per-cart rule), keyed by
// event_menu_item_id rather than menu_item_id.

export interface EventCartItem {
  key: string; // event_menu_item_id
  eventMenuItemId: string;
  itemName: string;
  category: string;
  unitPrice: number | null;
  currency: string;
  quantity: number;
  instructions: string;
  imageUrl?: string | null;
}

interface EventCartState {
  eventId: string | null;
  eventName: string;
  stallId: string | null;
  stallName: string;
  items: EventCartItem[];
}

interface AddEventItemInput {
  eventMenuItemId: string;
  itemName: string;
  category?: string;
  unitPrice?: number | null;
  currency?: string;
  eventId: string;
  eventName?: string;
  stallId: string;
  stallName?: string;
  imageUrl?: string | null;
  quantity?: number;
}

interface EventCartContextValue extends EventCartState {
  subtotal: number;
  itemCount: number;
  addItem: (item: AddEventItemInput) => void;
  updateQuantity: (key: string, quantity: number) => void;
  updateInstructions: (key: string, instructions: string) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
}

const EMPTY_STATE: EventCartState = { eventId: null, eventName: '', stallId: null, stallName: '', items: [] };

const EventCartContext = createContext<EventCartContextValue | null>(null);

export function EventCartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EventCartState>(EMPTY_STATE);

  const addItem = useCallback((item: AddEventItemInput) => {
    const key = item.eventMenuItemId;
    const qty = Math.max(1, item.quantity || 1);

    // Single setState updater, no nested setState -- see CartContext.tsx's
    // own comment on why that's required (React's dev-mode double-invoke
    // + eager-bailout check can silently drop a nested update).
    setState((prev) => {
      if (prev.stallId && prev.stallId !== item.stallId && prev.items.length > 0) {
        Alert.alert(
          'Replace cart?',
          `Your event cart has items from ${prev.stallName || 'another stall'}. An event order can only include one stall at a time -- replace the cart with items from ${
            item.stallName || 'this stall'
          }?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Replace',
              style: 'destructive',
              onPress: () => {
                setState({
                  eventId: item.eventId,
                  eventName: item.eventName || '',
                  stallId: item.stallId,
                  stallName: item.stallName || '',
                  items: [
                    {
                      key,
                      eventMenuItemId: item.eventMenuItemId,
                      itemName: item.itemName,
                      category: item.category || '',
                      unitPrice: item.unitPrice ?? null,
                      currency: item.currency || 'USD',
                      quantity: qty,
                      instructions: '',
                      imageUrl: item.imageUrl ?? null,
                    },
                  ],
                });
              },
            },
          ]
        );
        return prev;
      }

      const existing = prev.items.find((i) => i.key === key);
      const items = existing
        ? prev.items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + qty } : i))
        : [
            ...prev.items,
            {
              key,
              eventMenuItemId: item.eventMenuItemId,
              itemName: item.itemName,
              category: item.category || '',
              unitPrice: item.unitPrice ?? null,
              currency: item.currency || 'USD',
              quantity: qty,
              instructions: '',
              imageUrl: item.imageUrl ?? null,
            },
          ];
      return {
        eventId: item.eventId,
        eventName: item.eventName || prev.eventName,
        stallId: item.stallId,
        stallName: item.stallName || prev.stallName,
        items,
      };
    });
  }, []);

  const updateQuantity = useCallback((key: string, quantity: number) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, quantity) } : i)),
    }));
  }, []);

  const updateInstructions = useCallback((key: string, instructions: string) => {
    setState((prev) => ({ ...prev, items: prev.items.map((i) => (i.key === key ? { ...i, instructions } : i)) }));
  }, []);

  const removeItem = useCallback((key: string) => {
    setState((prev) => {
      const items = prev.items.filter((i) => i.key !== key);
      return items.length ? { ...prev, items } : EMPTY_STATE;
    });
  }, []);

  const clearCart = useCallback(() => setState(EMPTY_STATE), []);

  const subtotal = useMemo(
    () => state.items.reduce((sum, i) => sum + (i.unitPrice || 0) * i.quantity, 0),
    [state.items]
  );
  const itemCount = useMemo(() => state.items.reduce((sum, i) => sum + i.quantity, 0), [state.items]);

  const value = useMemo<EventCartContextValue>(
    () => ({ ...state, subtotal, itemCount, addItem, updateQuantity, updateInstructions, removeItem, clearCart }),
    [state, subtotal, itemCount, addItem, updateQuantity, updateInstructions, removeItem, clearCart]
  );

  return <EventCartContext.Provider value={value}>{children}</EventCartContext.Provider>;
}

export function useEventCart(): EventCartContextValue {
  const ctx = useContext(EventCartContext);
  if (!ctx) throw new Error('useEventCart must be used within an EventCartProvider');
  return ctx;
}
