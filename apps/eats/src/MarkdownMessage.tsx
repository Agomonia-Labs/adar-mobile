import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

const BRAND = '#1b2430';
const TEXT_PRIMARY = '#14181f';
const TEXT_SECONDARY = '#5b6472';
const SURFACE = '#fff';
const BACKGROUND = '#f7f8fa';
const BORDER = '#e2e5ea';

// The menu assistant's replies (comparisons, recommendations) are Markdown
// -- routes/chat.py's Gemini calls return **bold**, headers, bullet lists,
// and (especially for a "compare these two restaurants" question) GFM
// tables. Ported from apps/docintel/src/MarkdownMessage.tsx verbatim
// (same library, same table-as-cards trick for narrow screens), restyled
// with Eats' brand color instead of DocIntel's.
const mdStyles = StyleSheet.create({
  body: { color: TEXT_PRIMARY, fontSize: 14, lineHeight: 21 },
  heading1: { fontSize: 20, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 10, marginBottom: 6 },
  heading2: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 10, marginBottom: 6 },
  heading3: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 8, marginBottom: 4 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 3 },
  hr: { backgroundColor: BORDER, height: 1, marginVertical: 12 },
  blockquote: {
    backgroundColor: BACKGROUND, borderLeftWidth: 3, borderLeftColor: BRAND,
    paddingHorizontal: 10, paddingVertical: 6, marginVertical: 6,
  },
  code_inline: {
    backgroundColor: BACKGROUND, color: TEXT_PRIMARY, borderRadius: 4,
    paddingHorizontal: 4, fontSize: 13,
  },
  code_block: { backgroundColor: BACKGROUND, borderRadius: 8, padding: 10, fontSize: 13 },
  fence: { backgroundColor: BACKGROUND, borderRadius: 8, padding: 10, fontSize: 13 },
  link: { color: BRAND },
});

// GFM tables render badly as a literal grid on a narrow phone screen --
// flatten each row into a card instead: the first column becomes the
// card's title (e.g. a dish name) and every other column becomes a
// "Label: Value" line (e.g. "Price: $12.99").
function extractPlainText(node: any): string {
  if (!node) return '';
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map(extractPlainText).join('');
  }
  if (typeof node.content === 'string') return node.content;
  return '';
}

function renderInline(node: any, key: string): React.ReactNode {
  if (!node) return null;
  if (node.type === 'link') {
    const href = node.attributes?.href;
    return (
      <Text key={key} style={{ color: BRAND, textDecorationLine: 'underline' }} onPress={() => { if (href) Linking.openURL(href); }}>
        {extractPlainText(node)}
      </Text>
    );
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map((child: any, i: number) => renderInline(child, `${key}-${i}`));
  }
  if (typeof node.content === 'string') return node.content;
  return null;
}

function renderTableAsCards(node: any) {
  const thead = node.children?.find((c: any) => c.type === 'thead');
  const tbody = node.children?.find((c: any) => c.type === 'tbody');
  const headerRow = thead?.children?.[0];
  const headers: string[] = (headerRow?.children || []).map(extractPlainText);
  const bodyRows = tbody?.children || [];

  return (
    <View key={node.key} style={{ marginBottom: 8 }}>
      {bodyRows.map((row: any, rowIdx: number) => {
        const cells = row.children || [];
        const [firstCell, ...restCells] = cells;
        const title = firstCell ? extractPlainText(firstCell) : '';
        return (
          <View key={row.key ?? rowIdx} style={{ backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 10, marginBottom: 8 }}>
            {title ? <Text style={{ fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 4 }}>{title}</Text> : null}
            {restCells.map((cell: any, colIdx: number) => {
              const value = extractPlainText(cell);
              if (!value) return null;
              const label = headers[colIdx + 1] || '';
              return (
                <View key={colIdx} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2 }}>
                  <Text style={{ fontSize: 12, color: TEXT_SECONDARY, flexShrink: 0, marginRight: 8 }}>{label}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, flexShrink: 1, textAlign: 'right' }}>
                    {renderInline(cell, `cell-${rowIdx}-${colIdx}`)}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** Drop-in replacement for a plain <Text> wherever Eats displays the menu
 *  assistant's replies. Renders nothing for an empty string, so callers
 *  can keep a `{text ? <MarkdownMessage>...}</MarkdownMessage> : null}` guard. */
export function MarkdownMessage({ children }: { children: string }) {
  if (!children) return null;
  return (
    <Markdown style={mdStyles} rules={{ table: (node) => renderTableAsCards(node) }}>
      {children}
    </Markdown>
  );
}
