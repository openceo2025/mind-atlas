// MindAtlas 空間UI のデータモデル（保存形式 mindatlas.space/1）。
// カードの意味上の位置は埋め込みベクトルから計算し、人がドラッグした軸の値は
// card.overrides に「その軸での正規化済みの値（0..1）」として保存して優先する。

export type CardKind =
  | 'note'
  | 'document'
  | 'article'
  | 'image'
  | 'dataset'
  | 'company'
  | 'person'
  | 'summary'
  | 'idea'
  | 'hypothesis'
  | 'issue'
  | 'quote'
  | 'link'
  | 'group'
  | 'concept'
  | 'topic';

export const CARD_KINDS: CardKind[] = [
  'note',
  'idea',
  'hypothesis',
  'issue',
  'quote',
  'document',
  'article',
  'link',
  'image',
  'dataset',
  'company',
  'person',
  'summary',
  'topic',
];

export type RelationType =
  | 'related'
  | 'source'
  | 'derived'
  | 'contains'
  | 'supports'
  | 'contradicts'
  | 'axis-of'
  // 以前の「比較」機能の名残。すでにある空間のために残してある
  | 'compared-with';

export const USER_RELATION_TYPES: RelationType[] = ['related', 'supports', 'contradicts', 'derived', 'source'];

export interface Fact {
  label: string;
  value: string;
  /** 比較時に大小を比べるための数値（任意） */
  num?: number;
  higherIsBetter?: boolean;
}

/** カードに蓄積される「意味の履歴」。表示時にロケールで文章化する */
export interface MeaningEvent {
  at: number;
  code: string;
  params?: Record<string, string | number>;
}

export type Place = 'canvas' | 'shelf' | 'hidden' | 'library';

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  body: string;
  tags: string[];
  subtitle?: string;
  url?: string;
  /** 小さく縮小した画像（data URL） */
  image?: string;
  facts?: Fact[];
  /** デモ用の描画サムネイル */
  visual?: 'wind' | 'solar' | 'earth' | 'battery' | 'chart';
  /** ワールド座標（カード中心）。レイアウト結果のキャッシュ */
  x: number;
  y: number;
  /** 奥行き 0..1（手前ほど大きい） */
  depth: number;
  place: Place;
  /** 概念（軸）カードの両端ラベル [低, 高] */
  axisEnds?: [string, string];
  /** 概念カードの両極を説明する文（埋め込み用。表示しない） */
  axisPoles?: [string, string];
  members?: string[];
  expanded?: boolean;
  groupId?: string;
  /** 軸ID → その軸での人による上書き値（0..1） */
  overrides?: Record<string, number>;
  log: MeaningEvent[];
  createdBy?: 'user' | 'ai';
  createdAt: number;
  updatedAt: number;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  label?: string;
  /** AI の提案（未承認） */
  suggested?: boolean;
}

export type AxisKey = 'x' | 'y' | 'z';
export type Axes = Record<AxisKey, string>;

export interface TrailItem {
  id: string;
  axes: Axes;
  at: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Space {
  schema: 'mindatlas.space/1';
  id: string;
  title: string;
  description: string;
  cards: Record<string, Card>;
  relations: Relation[];
  axes: Axes;
  trail: TrailItem[];
  createdAt: number;
  updatedAt: number;
  /** クラウド保存先（ログイン時） */
  cloudId?: string;
  cloudUpdatedAt?: number;
  /** 共有リンクから開いた読み取り専用のスペース */
  readOnly?: boolean;
  shareToken?: string;
}

export interface SpaceMeta {
  id: string;
  title: string;
  updatedAt: number;
  cardCount: number;
  cloudId?: string;
  cloudUpdatedAt?: number;
  /** クラウドにしか無い（この端末に未ダウンロード） */
  cloudOnly?: boolean;
}

export type WindowType =
  | 'summary'
  | 'extract'
  | 'axis'
  | 'preview'
  | 'detail'
  | 'cluster'
  | 'relations'
  | 'chat'
  | 'search'
  | 'voice'
  | 'agent'
  | 'account'
  | 'share'
  | 'spaces'
  | 'help'
  | 'settings'
  | 'relation';

export interface FloatWin {
  id: string;
  type: WindowType;
  anchor: { x: number; y: number };
  offset: { x: number; y: number };
  pinnedAt?: { x: number; y: number };
  pinned: boolean;
  z: number;
  cardIds: string[];
  width: number;
  data?: Record<string, unknown>;
}

export interface Cluster {
  id: string;
  label: string;
  cardIds: string[];
  hue: number;
}
