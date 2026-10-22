import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import {
  EatsMenuItem,
  EatsRestaurant,
  MENU_CATEGORY_ORDER,
  MenuCategoryBucket,
  compareMarketplaceMenu,
  listMarketplaceRestaurants,
  searchMarketplaceMenu,
  searchMenuAdvanced,
} from './eatsApi';
import { OwnerDashboardScreen } from './OwnerDashboardScreen';
import { DineInScreen } from './DineInScreen';
import { EventsScreen } from './EventsScreen';
import { DocumentsScreen } from './DocumentsScreen';
import { ChatScreen } from './ChatScreen';
import { CartScreen } from './CartScreen';
import { OrdersScreen } from './OrdersScreen';
import { MenuItemDetailModal } from './MenuItemDetailModal';
import { NotificationsBell } from './NotificationsBell';
import { AccountScreen } from './AccountScreen';
import { usePushRegistration } from './usePushRegistration';
import { useCart } from './CartContext';
import { useEatsLocation } from './LocationContext';
import { LocationPickerBar } from './LocationPickerBar';

const BRAND = '#1b2430';
// Same convention as the other ADAR mobile apps' own PRIVACY_URL --
// a static page on labs.agomoniai.com, one per ADAR product.
const PRIVACY_URL = 'https://labs.agomoniai.com/eats-privacy';

function formatPrice(price: number | null, currency: string) {
  if (price == null) return '';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(2)}`;
}

type MainTab = 'discover' | 'owner' | 'documents' | 'chat' | 'cart' | 'orders' | 'account' | 'dinein' | 'events';

/** Discover tab: restaurant discovery + menu search/compare across the
 *  whole marketplace, with AND/OR term combination + category filtering
 *  and one-tap "Add to cart". Owner tab: a restaurant owner's own
 *  dashboard. Cart/Orders tabs: the carryout cart and order-tracking/
 *  management screens -- see CartScreen.tsx/OrdersScreen.tsx. */
export function HomeScreen() {
  const { session, client, signOut } = useAuth();
  // Registers this device for order-status push notifications (new
  // orders for an owner, status updates for a diner) -- reaches the
  // phone even when the app is closed/backgrounded, unlike the
  // NotificationsBell above which only polls while the app is open.
  // HomeScreen only mounts while signed in and unmounts on sign-out, so
  // the hook's own cleanup doubles as sign-out token cleanup.
  usePushRegistration(client, session?.accessToken);
  // Chat (the menu assistant) is the default tab -- the user framed
  // conversation as "the main" way diners compare menus/prices, with
  // Discover's structured search/compare kept as a secondary option.
  const [mainTab, setMainTab] = useState<MainTab>('chat');
  // Restaurant-name search is its own box, independent of the menu/dish
  // search below -- it only filters which restaurants show in the list
  // view (client-side, over the already-fetched marketplace list), it
  // never switches the screen into menu-item results the way the menu
  // search does. Empty = "All".
  const [restaurantQuery, setRestaurantQuery] = useState('');
  // Both search bars start collapsed so the restaurant/menu results
  // underneath get the screen space -- tapping a section's header
  // expands it to search, then it can be collapsed again without
  // clearing whatever was typed.
  const [restaurantSearchOpen, setRestaurantSearchOpen] = useState(false);
  const [menuSearchOpen, setMenuSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [queryB, setQueryB] = useState('');
  const [combineMode, setCombineMode] = useState<'AND' | 'OR'>('AND');
  const [categoryFilter, setCategoryFilter] = useState<MenuCategoryBucket | ''>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [restaurants, setRestaurants] = useState<EatsRestaurant[]>([]);
  const [locationRelaxed, setLocationRelaxed] = useState(false);
  const [menuResults, setMenuResults] = useState<EatsMenuItem[]>([]);
  const [priceRange, setPriceRange] = useState<{ lowest: number | null; highest: number | null } | null>(null);
  const [detailItem, setDetailItem] = useState<EatsMenuItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cart = useCart();
  const { location, radiusMiles, setRadiusMiles } = useEatsLocation();

  const accessToken = session?.accessToken || '';

  // Default scope for discovery/search/compare: within radiusMiles of the
  // customer's active location (GPS or a typed city/state), or the same
  // city regardless of distance -- see LocationContext.tsx/LocationPickerBar.
  // No active location yet => undefined => every marketplace-wide call
  // below falls back to its old, unscoped behavior.
  const geoScope = useMemo(
    () =>
      location
        ? {
            city: location.city || undefined,
            state: location.state || undefined,
            lat: location.latitude ?? undefined,
            lng: location.longitude ?? undefined,
            radiusMiles,
          }
        : undefined,
    [location, radiusMiles]
  );

  const loadRestaurants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMarketplaceRestaurants(client, accessToken, geoScope);
      setRestaurants(result.restaurants);
      setLocationRelaxed(result.locationRelaxed);
    } catch (err) {
      setError('Could not load restaurants. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, geoScope]);

  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  const runSearch = useCallback(
    async (mode: 'search' | 'compare') => {
      const q = query.trim();
      if (!q) {
        setMenuResults([]);
        setPriceRange(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (mode === 'compare') {
          const result = await compareMarketplaceMenu(client, accessToken, q, geoScope);
          setMenuResults(result.items);
          setPriceRange({ lowest: result.lowest_price, highest: result.highest_price });
        } else {
          const items = await searchMarketplaceMenu(client, accessToken, q, geoScope);
          setMenuResults(items);
          setPriceRange(null);
        }
      } catch (err) {
        setError('Search failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [client, accessToken, query, geoScope]
  );

  const runAdvancedSearch = useCallback(async () => {
    const a = query.trim();
    const b = queryB.trim();
    if (!a && !b && !categoryFilter) {
      setError('Enter at least one search term or pick a category.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await searchMenuAdvanced(client, accessToken, {
        termA: a || b,
        termB: a ? b : '',
        mode: combineMode,
        category: categoryFilter,
        geo: geoScope,
      });
      setMenuResults(items);
      setPriceRange(null);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, query, queryB, combineMode, categoryFilter, geoScope]);

  const addToCartQuick = useCallback(
    (item: EatsMenuItem) => {
      cart.addItem({
        menu_item_id: item.id,
        item_name: item.item_name,
        category: item.category,
        unit_price: item.price,
        currency: item.currency,
        restaurant_id: item.restaurant_id,
        restaurant_name: item.restaurant_name,
        image_url: item.image_url,
      });
    },
    [cart]
  );

  const showingMenuResults = menuResults.length > 0 || (query.trim().length > 0 && !loading);

  const filteredRestaurants = useMemo(() => {
    const term = restaurantQuery.trim().toLowerCase();
    if (!term) return restaurants;
    return restaurants.filter((r) => r.name.toLowerCase().includes(term));
  }, [restaurants, restaurantQuery]);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <Image source={require('../assets/icon.png')} style={styles.headerLogo} />
        <Text style={styles.headerTitle}>ADAR Eats</Text>
      </View>
      <View style={styles.headerActions}>
        <NotificationsBell />
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const tabRow = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mainTabScroll} contentContainerStyle={styles.mainTabRow}>
      {(['chat', 'discover', 'dinein', 'events', 'cart', 'orders', 'owner', 'documents', 'account'] as MainTab[]).map((t) => (
        <TouchableOpacity
          key={t}
          style={[styles.mainTabButton, mainTab === t && styles.mainTabButtonActive]}
          onPress={() => setMainTab(t)}
        >
          <Text style={[styles.mainTabText, mainTab === t && styles.mainTabTextActive]}>
            {t === 'chat' ? 'Chat' : t === 'discover' ? 'Discover' : t === 'dinein' ? 'Dine-In' : t === 'events' ? 'Events' : t === 'cart' ? `Cart${cart.itemCount ? ` (${cart.itemCount})` : ''}` : t === 'orders' ? 'Orders' : t === 'owner' ? 'Owner' : t === 'documents' ? 'Documents' : 'Account'}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const footer = (
    <View style={styles.appFooter}>
      <Text style={styles.footerText}>© 2026 Agomonia Labs. All Rights Reserved.</Text>
      <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
        <Text style={[styles.footerText, styles.footerLink]}>Privacy Policy</Text>
      </TouchableOpacity>
    </View>
  );

  if (mainTab !== 'discover') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        {header}
        {tabRow}
        {mainTab === 'owner' ? (
          <OwnerDashboardScreen />
        ) : mainTab === 'dinein' ? (
          <DineInScreen />
        ) : mainTab === 'events' ? (
          <EventsScreen />
        ) : mainTab === 'documents' ? (
          <DocumentsScreen />
        ) : mainTab === 'cart' ? (
          <CartScreen onViewOrders={() => setMainTab('orders')} />
        ) : mainTab === 'orders' ? (
          <OrdersScreen />
        ) : mainTab === 'account' ? (
          <AccountScreen />
        ) : (
          <ChatScreen />
        )}
        {/* Hidden on the Dine-In and Events tabs: their "use the assistant
            instead" chat screens (DineInAssistantScreen, EventAssistantScreen)
            have their own TextInput + keyboard handling (ChatView's internal
            KeyboardAvoidingView for Dine-In; EventAssistantScreen's own
            KeyboardAvoidingView), which can only push THEIR OWN content up --
            it can't also push this footer (a flex sibling, not a parent, of
            it) out of the way. Left in place, the footer stayed fixed at the
            bottom while the keyboard rose over it, covering the message box.
            Same fix ADAR Front Desk's "Ask ADAR" tab uses for the identical
            reason -- see apps/frontdesk/src/FrontdeskHomeScreen.tsx. */}
        {mainTab !== 'dinein' && mainTab !== 'events' && footer}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      {header}
      {tabRow}
      <LocationPickerBar />

      <View style={styles.searchSection}>
        <TouchableOpacity
          style={styles.searchSectionHeader}
          onPress={() => setRestaurantSearchOpen((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.searchSectionLabel}>Restaurants</Text>
          <View style={styles.searchSectionHeaderRight}>
            {!restaurantSearchOpen && restaurantQuery.trim().length > 0 && (
              <Text style={styles.searchSectionSummary} numberOfLines={1}>
                "{restaurantQuery.trim()}"
              </Text>
            )}
            <Text style={styles.searchSectionChevron}>{restaurantSearchOpen ? '▾' : '▸'}</Text>
          </View>
        </TouchableOpacity>
        {restaurantSearchOpen && (
          <>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search restaurant name"
                value={restaurantQuery}
                onChangeText={setRestaurantQuery}
                returnKeyType="search"
                autoFocus
              />
            </View>
            <View style={styles.searchActions}>
              <TouchableOpacity
                style={[styles.advancedToggle, !restaurantQuery.trim() && styles.advancedToggleActive]}
                onPress={() => setRestaurantQuery('')}
              >
                <Text style={[styles.advancedToggleText, !restaurantQuery.trim() && styles.advancedToggleTextActive]}>All</Text>
              </TouchableOpacity>
              {restaurantQuery.trim().length > 0 && (
                <Text style={styles.restaurantMatchCount}>
                  {filteredRestaurants.length} match{filteredRestaurants.length === 1 ? '' : 'es'}
                </Text>
              )}
            </View>
          </>
        )}
      </View>

      <View style={[styles.searchSection, styles.searchSectionDivider]}>
        <TouchableOpacity
          style={styles.searchSectionHeader}
          onPress={() => setMenuSearchOpen((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.searchSectionLabel}>Menu</Text>
          <View style={styles.searchSectionHeaderRight}>
            {!menuSearchOpen && query.trim().length > 0 && (
              <Text style={styles.searchSectionSummary} numberOfLines={1}>
                "{query.trim()}"
              </Text>
            )}
            <Text style={styles.searchSectionChevron}>{menuSearchOpen ? '▾' : '▸'}</Text>
          </View>
        </TouchableOpacity>
        {menuSearchOpen && (
          <>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search dishes, cuisines"
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => runSearch('search')}
                returnKeyType="search"
                autoFocus
              />
            </View>
            <View style={styles.searchActions}>
              <TouchableOpacity style={styles.searchButton} onPress={() => runSearch('search')}>
                <Text style={styles.searchButtonText}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.searchButton, styles.compareButton]} onPress={() => runSearch('compare')}>
                <Text style={styles.searchButtonText}>Compare prices</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced((v) => !v)}>
                <Text style={styles.advancedToggleText}>{showAdvanced ? 'Hide filters' : 'Filters'}</Text>
              </TouchableOpacity>
              {query.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => {
                    setQuery('');
                    setMenuResults([]);
                    setPriceRange(null);
                  }}
                >
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

      {menuSearchOpen && showAdvanced && (
        <View style={styles.advancedPanel}>
          <Text style={styles.advancedLabel}>Combine with a second term</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Second term (e.g. restaurant name, dietary tag)"
            value={queryB}
            onChangeText={setQueryB}
          />
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeButton, combineMode === 'AND' && styles.modeButtonActive]}
              onPress={() => setCombineMode('AND')}
            >
              <Text style={[styles.modeButtonText, combineMode === 'AND' && styles.modeButtonTextActive]}>Match both (AND)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, combineMode === 'OR' && styles.modeButtonActive]}
              onPress={() => setCombineMode('OR')}
            >
              <Text style={[styles.modeButtonText, combineMode === 'OR' && styles.modeButtonTextActive]}>Match either (OR)</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.advancedLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.categoryChip, categoryFilter === '' && styles.categoryChipActive]}
              onPress={() => setCategoryFilter('')}
            >
              <Text style={[styles.categoryChipText, categoryFilter === '' && styles.categoryChipTextActive]}>All</Text>
            </TouchableOpacity>
            {MENU_CATEGORY_ORDER.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, categoryFilter === cat && styles.categoryChipActive]}
                onPress={() => setCategoryFilter(cat)}
              >
                <Text style={[styles.categoryChipText, categoryFilter === cat && styles.categoryChipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={[styles.searchButton, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={runAdvancedSearch}>
            <Text style={styles.searchButtonText}>Apply filters</Text>
          </TouchableOpacity>
        </View>
      )}
      </View>

      {showingMenuResults && location && (
        <Text style={styles.scopeNote}>
          Showing restaurants within {radiusMiles} mi of {location.label}
          {location.city ? ' (or in the same city)' : ''} --{' '}
          <Text style={styles.scopeNoteLink} onPress={() => setRadiusMiles(Math.min(500, radiusMiles * 2))}>
            widen to {Math.min(500, radiusMiles * 2)} mi
          </Text>
        </Text>
      )}

      {priceRange && (priceRange.lowest != null || priceRange.highest != null) && (
        <Text style={styles.priceRangeNote}>
          Prices range from {formatPrice(priceRange.lowest, 'USD')} to {formatPrice(priceRange.highest, 'USD')} across{' '}
          {menuResults.length} {menuResults.length === 1 ? 'match' : 'matches'}.
        </Text>
      )}

      {locationRelaxed && location && (
        <Text style={styles.locationRelaxedNote}>
          No restaurants found near {location.label} yet -- showing the full marketplace instead.
        </Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && restaurants.length === 0 && menuResults.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : showingMenuResults ? (
        <FlatList
          style={styles.list}
          data={menuResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setDetailItem(item)} activeOpacity={0.7}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{item.item_name}</Text>
                <Text style={styles.cardPrice}>{formatPrice(item.price, item.currency)}</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                {item.restaurant_name}
                {item.cuisine_type ? ` · ${item.cuisine_type}` : ''}
                {item.category ? ` · ${item.category}` : ''}
                {item.distance_miles != null ? ` · ${item.distance_miles} mi` : ''}
              </Text>
              {item.description ? <Text style={styles.cardDescription}>{item.description}</Text> : null}
              <View style={styles.cardFooter}>
                {item.rating_count > 0 ? (
                  <Text style={styles.cardRating}>
                    ★ {item.avg_rating?.toFixed(1)} ({item.rating_count} {item.rating_count === 1 ? 'review' : 'reviews'})
                  </Text>
                ) : <View />}
                <TouchableOpacity style={styles.addButton} onPress={() => addToCartQuick(item)}>
                  <Text style={styles.addButtonText}>+ Add</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loading ? <Text style={styles.emptyText}>No menu items matched "{query.trim()}".</Text> : null
          }
        />
      ) : (
        <FlatList
          style={styles.list}
          data={filteredRestaurants}
          keyExtractor={(item) => item.id}
          onRefresh={loadRestaurants}
          refreshing={loading}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSubtitle}>
                {item.cuisine_type || 'Restaurant'} · {item.menu_count} menu {item.menu_count === 1 ? 'item' : 'items'}
                {item.distance_miles != null ? ` · ${item.distance_miles} mi away` : item.city ? ` · ${item.city}${item.state ? `, ${item.state}` : ''}` : ''}
              </Text>
              {(item.min_price != null || item.max_price != null) && (
                <Text style={styles.cardDescription}>
                  {formatPrice(item.min_price, 'USD')} – {formatPrice(item.max_price, 'USD')}
                </Text>
              )}
              {item.rating_count > 0 && (
                <Text style={styles.cardRating}>
                  ★ {item.avg_rating?.toFixed(1)} ({item.rating_count} {item.rating_count === 1 ? 'review' : 'reviews'})
                </Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>
                {restaurantQuery.trim()
                  ? `No restaurants match "${restaurantQuery.trim()}".`
                  : 'No restaurants are in the marketplace yet. A restaurant owner can opt in from their account.'}
              </Text>
            ) : null
          }
        />
      )}
      <MenuItemDetailModal
        item={detailItem}
        visible={!!detailItem}
        onClose={() => setDetailItem(null)}
        onAddToCart={(item, quantity) =>
          cart.addItem({
            menu_item_id: item.id,
            item_name: item.item_name,
            category: item.category,
            unit_price: item.price,
            currency: item.currency,
            restaurant_id: item.restaurant_id,
            restaurant_name: item.restaurant_name,
            image_url: item.image_url,
            quantity,
          })
        }
      />
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: BRAND,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 28, height: 28, borderRadius: 7, marginRight: 8 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  signOut: { color: '#c9d2dc', fontSize: 13, fontWeight: '600' },
  appFooter: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#f7f8fa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e1e4ea',
  },
  footerText: { fontSize: 11, color: '#8a93a3', textAlign: 'center' },
  footerLink: { color: BRAND, fontWeight: '600', marginTop: 2, textDecorationLine: 'underline' },
  mainTabScroll: { flexGrow: 0 },
  mainTabRow: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  mainTabButton: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#eef1f0' },
  mainTabButtonActive: { backgroundColor: BRAND },
  mainTabText: { fontSize: 13, fontWeight: '700', color: '#5b6472' },
  mainTabTextActive: { color: '#fff' },
  searchSection: { paddingBottom: 4 },
  searchSectionDivider: { borderTopWidth: 1, borderTopColor: '#e4e7ec', marginTop: 10, paddingTop: 2 },
  searchSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
  },
  searchSectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  searchSectionSummary: { fontSize: 12.5, color: '#5b6472', maxWidth: 140 },
  searchSectionChevron: { fontSize: 13, color: '#8a93a3', width: 14, textAlign: 'center' },
  searchSectionLabel: {
    fontSize: 11.5, fontWeight: '700', color: '#8a93a3', textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  restaurantMatchCount: { fontSize: 12.5, color: '#5b6472', alignSelf: 'center' },
  searchRow: { paddingHorizontal: 16, paddingTop: 14 },
  searchInput: {
    borderWidth: 1,
    borderColor: '#d7dbe0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  searchActions: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, gap: 10, flexWrap: 'wrap' },
  searchButton: { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  compareButton: { backgroundColor: '#3a4a60' },
  searchButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  advancedToggle: { borderWidth: 1, borderColor: BRAND, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  advancedToggleText: { color: BRAND, fontWeight: '600', fontSize: 13 },
  advancedToggleActive: { backgroundColor: BRAND },
  advancedToggleTextActive: { color: '#fff' },
  clearButton: { paddingHorizontal: 10, paddingVertical: 8 },
  clearButtonText: { color: '#5b6472', fontWeight: '600', fontSize: 13 },
  advancedPanel: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e2e5ea' },
  advancedLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginBottom: 6, marginTop: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  modeButton: { flex: 1, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  modeButtonActive: { backgroundColor: BRAND, borderColor: BRAND },
  modeButtonText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },
  modeButtonTextActive: { color: '#fff' },
  categoryChip: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  categoryChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  categoryChipText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },
  categoryChipTextActive: { color: '#fff' },
  priceRangeNote: { paddingHorizontal: 16, paddingTop: 10, fontSize: 13, color: '#5b6472' },
  scopeNote: { paddingHorizontal: 16, paddingTop: 8, fontSize: 12, color: '#6b7280' },
  scopeNoteLink: { color: BRAND, fontWeight: '700' },
  locationRelaxedNote: { paddingHorizontal: 16, paddingTop: 8, fontSize: 12, color: '#9a6b00' },
  errorText: {
    marginHorizontal: 16,
    marginTop: 10,
    color: '#c0392b',
    backgroundColor: '#fdecea',
    padding: 10,
    borderRadius: 10,
    fontSize: 13,
  },
  list: { flex: 1, marginTop: 12, paddingHorizontal: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', flexShrink: 1 },
  cardPrice: { fontSize: 15, fontWeight: '700', color: BRAND },
  cardSubtitle: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  cardDescription: { fontSize: 13, color: '#374151', marginTop: 6 },
  cardRating: { fontSize: 12, color: '#b7791f', fontWeight: '600' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  addButton: { backgroundColor: '#eef1f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addButtonText: { color: BRAND, fontWeight: '700', fontSize: 12.5 },
  emptyText: { textAlign: 'center', color: '#5b6472', marginTop: 40, paddingHorizontal: 20, fontSize: 14 },
});
