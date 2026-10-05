import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert } from 'react-native';

// Carryout cart, kept purely as in-memory client state -- there is no
// cart table on the backend (see eatsApi.ts's "Carryout cart / orders /
// checkout" section): the cart only becomes a server record once "Review
// order" calls createOrderDraft. Mirrors RestaurantPanel.jsx's
// `useState({ restaurant_id, restaurant_name, items })` 1:1, including its
// one-restaurant-per-cart rule (switching restaurants asks to replace the
// cart, same as the web's window.confirm). Not persisted across app
// restarts -- acceptable for a carryout cart the diner fills and checks
// out in one sitting; add AsyncStorage later if diners want it to survive
// a restart.

export interface CartItem {
  key: string; // menu_item_id, or a synthetic key for ad-hoc/chat items
  menu_item_id: string | null;
  item_name: string;
  category: string;
  unit_price: number | null;
  currency: string;
  quantity: number;
  instructions: string;
  image_url?: string | null;
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string;
  workspaceId: string | null;
  items: CartItem[];
}

interface AddItemInput {
  menu_item_id?: string | null;
  item_name: string;
  category?: string;
  unit_price?: number | null;
  currency?: string;
  restaurant_id: string;
  restaurant_name?: string;
  workspace_id?: string | null;
  image_url?: string | null;
  quantity?: number;
}

interface CartContextValue extends CartState {
  subtotal: number;
  itemCount: number;
  addItem: (item: AddItemInput) => void;
  updateQuantity: (key: string, quantity: number) => void;
  updateInstructions: (key: string, instructions: string) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
}

const EMPTY_STATE: CartState = { restaurantId: null, restaurantName: '', workspaceId: null, items: [] };

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY_STATE);

  const addItem = useCallback((item: AddItemInput) => {
    const key = item.menu_item_id || `${item.restaurant_id}:${item.item_name}`;
    const qty = Math.max(1, item.quantity || 1);

    // IMPORTANT: this must be exactly one setState call with one updater
    // function. An earlier version called a second, nested setState
    // (via a "doAdd" helper) from inside this updater's own body -- that
    // "setState-inside-a-setState-updater" pattern races with React's
    // eager-state bailout check (used to decide whether a render is even
    // needed) and the nested update could get silently clobbered by the
    // outer updater's own (unchanged) return value. In practice that
    // meant "Add to cart" sometimes did nothing at all, most visibly
    // from Discover search results. Keeping all the logic -- the
    // restaurant-conflict check AND the add/merge -- in this single
    // updater avoids that race entirely.
    setState((prev) => {
      if (prev.restaurantId && prev.restaurantId !== item.restaurant_id && prev.items.length > 0) {
        Alert.alert(
          'Replace cart?',
          `Your cart has items from ${prev.restaurantName || 'another restaurant'}. Carryout orders can only include one restaurant at a time -- replace the cart with items from ${
            item.restaurant_name || 'this restaurant'
          }?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Replace',
              style: 'destructive',
              onPress: () => {
                setState({
                  restaurantId: item.restaurant_id,
                  restaurantName: item.restaurant_name || '',
                  workspaceId: item.workspace_id ?? null,
                  items: [
                    {
                      key,
                      menu_item_id: item.menu_item_id ?? null,
                      item_name: item.item_name,
                      category: item.category || '',
                      unit_price: item.unit_price ?? null,
                      currency: item.currency || 'USD',
                      quantity: qty,
                      instructions: '',
                      image_url: item.image_url ?? null,
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
              menu_item_id: item.menu_item_id ?? null,
              item_name: item.item_name,
              category: item.category || '',
              unit_price: item.unit_price ?? null,
              currency: item.currency || 'USD',
              quantity: qty,
              instructions: '',
              image_url: item.image_url ?? null,
            },
          ];
      return {
        restaurantId: item.restaurant_id,
        restaurantName: item.restaurant_name || prev.restaurantName,
        workspaceId: item.workspace_id ?? prev.workspaceId ?? null,
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
    () => state.items.reduce((sum, i) => sum + (i.unit_price || 0) * i.quantity, 0),
    [state.items]
  );
  const itemCount = useMemo(() => state.items.reduce((sum, i) => sum + i.quantity, 0), [state.items]);

  const value = useMemo<CartContextValue>(
    () => ({ ...state, subtotal, itemCount, addItem, updateQuantity, updateInstructions, removeItem, clearCart }),
    [state, subtotal, itemCount, addItem, updateQuantity, updateInstructions, removeItem, clearCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
