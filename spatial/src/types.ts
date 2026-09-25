// MindAtlas 空間UI のデータモデル（保存形式 mindatlas.space/1）。
// カードの意味上の位置は埋め込みベクトルから計算し、人がドラッグした軸の値は
// card.overrides に「その軸での正規化済みの値（0..1）」として保存して優先する。

import type { VocabularyId } from './lib/relationCatalog';

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

/** アプリが自分で引く線。related は「まだ言葉を選んでいない線」 */
export type SystemRelationType =
  | 'related'
  | 'source'
  | 'derived'
  | 'contains'
  | 'axis-of'
  // 以前の「比較」機能の名残。すでにある空間のために残してある
  | 'compared-with';

/**
 * 線の種類。アプリの線か、言葉の ID（lib/relationCatalog.ts の WORDS）か、
 * ユーザーが作った言葉の ID（"u:" で始まる）。
 */
export type RelationType = SystemRelationType | (string & {});

/** ユーザーが空間に足した、自分の言葉。土台がないので推論には使わない */
export interface RelationWord {
  id: string;
  label: string;
  /** 逆から読んだときの言葉（向きのある言葉だけ。無ければ label のまま） */
  back?: string;
  /** どういうつながりか（判断モデルへの説明にも使う） */
  meaning: string;
  directed: boolean;
  color: string;
}

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
  /** グループの中での置き場所（グループのカードからのずれ）。開くたびに同じ場所へ出る */
  groupOffset?: { x: number; y: number };
  /** 軸ID → その軸での人による上書き値（0..1） */
  overrides?: Record<string, number>;
  log: MeaningEvent[];
  createdBy?: 'user' | 'ai';
  /** リマインダー。発火すると、この空間を内包する惑星（ノード）に波紋が出る */
  reminder?: CardReminder;
  createdAt: number;
  updatedAt: number;
}

export interface CardReminder {
  /** 知らせる時刻（epoch ms） */
  at: number;
  /** 知らせた時刻。未発火なら無い */
  firedAt?: number;
}

/**
 * マインドアトラス（スペース）のノードとの結びつき。ノードに入り込むと開く空間には、
 * そのノードの惑星IDが付く。惑星IDはノードとこの空間の両方に保存され、端末やクラウドを
 * またいでも同じ空間を指す。取り込みや複製で作った空間には付かない（別の空間になる）。
 */
export interface SpaceAnchor {
  planetId: string;
  nodeId: string;
  nodeTitle: string;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  label?: string;
  /** AI の提案（未承認） */
  suggested?: boolean;
  /** 判断モデルが言葉を選んだときの確信度（0..1）。人が選び直したら消える */
  judged?: number;
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
  /** 線に使う言葉のセット（無ければ「考える」） */
  vocabulary?: VocabularyId;
  /** この空間でユーザーが作った言葉 */
  relationWords?: RelationWord[];
  createdAt: number;
  updatedAt: number;
  /** クラウド保存先（ログイン時） */
  cloudId?: string;
  cloudUpdatedAt?: number;
  /** 共有リンクから開いた読み取り専用のスペース */
  readOnly?: boolean;
  shareToken?: string;
  /** マインドアトラス（スペース）のノードの内側にある空間 */
  anchor?: SpaceAnchor;
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
  /** ノードの内側にある空間なら、その惑星ID */
  planetId?: string;
}

export type WindowType =
  | 'summary'
  | 'reminder'
  | 'axis'
  | 'preview'
  | 'detail'
  | 'cluster'
  | 'relations'
  | 'chat'
  | 'assistant'
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
