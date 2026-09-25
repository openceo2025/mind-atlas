// 線の言葉の「土台」を使った推論。画面にもストアにも依存しない（検査スクリプトから直接呼ぶ）。
//
// 演繹（必ず）の線だけで、推移・対偶・両立しないことの伝播・自己矛盾を計算する。
// 論証（たいてい）の線は、つながりの候補と「ぶつかるかも」の注意にとどめる。
// 因果の線は、根本原因（それ以上さかのぼれないカード）と、輪（悪循環・歯止め）を探す。
// 自分で作った言葉は土台が無いので、ここには入らない。
import { VOCABULARIES, WORDS, type Core, type VocabularyId } from './relationCatalog';

export interface InferenceRelation {
  id: string;
  from: string;
  to: string;
  type: string;
}

/** まだ線になっていないが、今ある線から言えること */
export interface Derivation {
  from: string;
  to: string;
  type: string;
  /** 根拠になった線の ID（たどった順） */
  because: string[];
  /** 演繹だけで導いた（必ず成り立つ） */
  strict: boolean;
  rule: 'chain' | 'equivalence' | 'contraposition' | 'exclusion' | 'membership';
}

export interface Finding {
  kind: 'inconsistent' | 'maybeConflict' | 'rootCause' | 'loop';
  cards: string[];
  because: string[];
  /** 輪の性質：強め合う（悪循環・好循環）か、歯止めがかかるか */
  loop?: 'reinforcing' | 'balancing';
}

export interface InferenceResult {
  derived: Derivation[];
  findings: Finding[];
}

interface Edge {
  to: string;
  id: string;
  strict?: boolean;
  sign?: 1 | -1;
}

type Adjacency = Map<string, Edge[]>;

const MAX_DERIVED = 40;
const MAX_FINDINGS = 30;
const WEAK_DEPTH = 3;

function push(adj: Adjacency, from: string, edge: Edge) {
  const list = adj.get(from);
  if (list) list.push(edge);
  else adj.set(from, [edge]);
}

/** 幅優先でたどり、たどり着いたカードごとに「どの線を通ってきたか」を返す */
function reach(start: string, adj: Adjacency, maxDepth = Infinity) {
  const paths = new Map<string, Edge[]>([[start, []]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    const path = paths.get(at)!;
    if (path.length >= maxDepth) continue;
    for (const e of adj.get(at) ?? []) {
      if (paths.has(e.to)) continue;
      paths.set(e.to, [...path, e]);
      queue.push(e.to);
    }
  }
  return paths;
}

const ids = (path: Edge[]) => path.map((e) => e.id);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 同じ土台の言葉を、いまのセットから選ぶ（無ければ既定の言葉） */
function wordFor(core: Core, vocabulary: VocabularyId, fallback: string) {
  return VOCABULARIES[vocabulary].find((id) => WORDS[id].core === core) ?? fallback;
}

export function infer(relations: InferenceRelation[], vocabulary: VocabularyId = 'think'): InferenceResult {
  const linked = new Set(relations.map((r) => pairKey(r.from, r.to)));
  const derived: Derivation[] = [];
  const findings: Finding[] = [];
  const taken = new Set<string>();
  const derive = (d: Derivation) => {
    const key = pairKey(d.from, d.to);
    if (d.from === d.to || linked.has(key) || taken.has(key) || derived.length >= MAX_DERIVED) return;
    taken.add(key);
    derived.push(d);
  };
  const find = (f: Finding) => {
    if (findings.length < MAX_FINDINGS) findings.push(f);
  };

  // 土台ごとに線を仕分ける
  const strictImp: Adjacency = new Map(); // ⇒（同値は両向き）
  const anyImp: Adjacency = new Map(); // ⇒ と「だから・根拠」
  const excl: [string, string, string][] = []; // 両立しない（矛盾を含む）
  const contra: [string, string, string][] = []; // 矛盾（A ⇔ ¬B）
  const oppose: [string, string, string][] = []; // でも・反論
  const subset: Adjacency = new Map();
  const members: InferenceRelation[] = [];
  const kind: Adjacency = new Map();
  const part: Adjacency = new Map();
  const cause: Adjacency = new Map();
  const causeIn = new Set<string>();

  for (const r of relations) {
    const core = WORDS[r.type]?.core;
    if (!core || r.from === r.to) continue;
    const e = (to: string, extra: Partial<Edge> = {}): Edge => ({ to, id: r.id, ...extra });
    switch (core) {
      case 'implies!':
        push(strictImp, r.from, e(r.to));
        push(anyImp, r.from, e(r.to, { strict: true }));
        break;
      case 'equiv!':
        push(strictImp, r.from, e(r.to));
        push(strictImp, r.to, e(r.from));
        push(anyImp, r.from, e(r.to, { strict: true }));
        push(anyImp, r.to, e(r.from, { strict: true }));
        break;
      case 'implies~':
        push(anyImp, r.from, e(r.to, { strict: false }));
        break;
      case 'contra!':
        contra.push([r.from, r.to, r.id]);
        excl.push([r.from, r.to, r.id]);
        break;
      case 'excl!':
        excl.push([r.from, r.to, r.id]);
        break;
      case 'oppose~':
      case 'rebut~':
        oppose.push([r.from, r.to, r.id]);
        break;
      case 'subset':
        push(subset, r.from, e(r.to));
        break;
      case 'member':
        members.push(r);
        break;
      case 'kind':
        push(kind, r.from, e(r.to));
        break;
      case 'part':
        push(part, r.from, e(r.to));
        break;
      case 'cause':
      case 'cause+':
      case 'cause-':
        push(cause, r.from, e(r.to, { sign: core === 'cause-' ? -1 : 1 }));
        causeIn.add(r.to);
        break;
      default:
        break;
    }
  }

  // ── 演繹：推移（A⇒B, B⇒C ⊢ A⇒C）と、行き来できれば同値 ──
  const strictReach = new Map<string, Map<string, Edge[]>>();
  for (const a of strictImp.keys()) strictReach.set(a, reach(a, strictImp));
  const reachOf = (a: string) => strictReach.get(a) ?? new Map([[a, []]]);
  for (const [a, paths] of strictReach) {
    for (const [c, path] of paths) {
      if (c === a || path.length < 2) continue;
      const back = strictReach.get(c)?.get(a);
      if (back) {
        if (a < c) derive({ from: a, to: c, type: 'equiv', because: [...ids(path), ...ids(back)], strict: true, rule: 'equivalence' });
      } else {
        derive({ from: a, to: c, type: 'suff', because: ids(path), strict: true, rule: 'chain' });
      }
    }
  }

  // ── 演繹：両立しないことの伝播（A⇒X, X と Y は両立しない ⊢ A と Y も両立しない）と自己矛盾 ──
  const inconsistent = new Set<string>();
  const exclBoth = excl.flatMap(([x, y, id]) => [[x, y, id], [y, x, id]] as [string, string, string][]);
  const starts = new Set([...strictImp.keys(), ...exclBoth.map(([x]) => x)]);
  for (const a of starts) {
    const paths = reachOf(a);
    for (const [x, y, id] of exclBoth) {
      const toX = paths.get(x);
      if (!toX) continue;
      const toY = paths.get(y);
      if (toY) {
        // A から、両立しない X と Y の両方が言えてしまう：A は成り立ちえない
        if (!inconsistent.has(a)) {
          inconsistent.add(a);
          find({ kind: 'inconsistent', cards: [...new Set([a, x, y])], because: [...new Set([...ids(toX), ...ids(toY), id])] });
        }
        continue;
      }
      if (toX.length >= 1 && y !== a) derive({ from: a, to: y, type: 'excl', because: [...ids(toX), id], strict: true, rule: 'exclusion' });
    }
  }

  // ── 演繹：対偶（A⇒B, A と A' は矛盾, B と B' は矛盾 ⊢ B'⇒A'） ──
  const negations = new Map<string, [string, string][]>();
  for (const [x, y, id] of contra) {
    negations.set(x, [...(negations.get(x) ?? []), [y, id]]);
    negations.set(y, [...(negations.get(y) ?? []), [x, id]]);
  }
  for (const [a, paths] of strictReach) {
    const notA = negations.get(a);
    if (!notA) continue;
    for (const [b, path] of paths) {
      if (b === a || !path.length) continue;
      for (const [nb, idB] of negations.get(b) ?? []) {
        for (const [na, idA] of notA) {
          if (nb !== na) derive({ from: nb, to: na, type: 'suff', because: [idB, ...ids(path), idA], strict: true, rule: 'contraposition' });
        }
      }
    }
  }

  // ── 論証：「だから」「根拠」をつないだ先（たいてい）と、ぶつかるかもしれない組 ──
  const weakWord = wordFor('implies~', vocabulary, 'so');
  const opposeBoth = oppose.flatMap(([x, y, id]) => [[x, y, id], [y, x, id]] as [string, string, string][]);
  const warned = new Set<string>();
  for (const a of anyImp.keys()) {
    const paths = reach(a, anyImp, WEAK_DEPTH);
    for (const [c, path] of paths) {
      if (c === a) continue;
      const weak = path.some((e) => e.strict === false);
      if (weak && path.length >= 2) derive({ from: a, to: c, type: weakWord, because: ids(path), strict: false, rule: 'chain' });
      for (const [x, y, id] of opposeBoth) {
        if (x !== c || y === a || paths.has(y)) continue;
        const key = pairKey(a, y);
        if (linked.has(key) || warned.has(key)) continue;
        warned.add(key);
        find({ kind: 'maybeConflict', cards: [a, y], because: [...ids(path), id] });
      }
    }
  }

  // ── 集合：⊆ の推移と、要素は上の集合にも属する（∈ は推移しない） ──
  for (const a of subset.keys()) {
    for (const [c, path] of reach(a, subset)) {
      if (path.length >= 2) derive({ from: a, to: c, type: 'subset', because: ids(path), strict: true, rule: 'chain' });
    }
  }
  for (const m of members) {
    for (const [c, path] of reach(m.to, subset)) {
      if (path.length >= 1) derive({ from: m.from, to: c, type: 'member', because: [m.id, ...ids(path)], strict: true, rule: 'membership' });
    }
  }
  // 「たとえば」（一般 → 具体）と「構成要素」も推移する
  for (const [adj, type] of [
    [kind, 'example'],
    [part, 'part'],
  ] as [Adjacency, string][]) {
    for (const a of adj.keys()) {
      for (const [c, path] of reach(a, adj)) {
        if (path.length >= 2) derive({ from: a, to: c, type, because: ids(path), strict: type === 'part', rule: 'chain' });
      }
    }
  }

  // ── 因果：根本原因と輪 ──
  for (const [a, edges] of cause) {
    if (!causeIn.has(a)) find({ kind: 'rootCause', cards: [a], because: edges.map((e) => e.id) });
  }
  const seenLoops = new Set<string>();
  const walk = (start: string, at: string, trail: Edge[], visited: Set<string>) => {
    if (findings.length >= MAX_FINDINGS || trail.length > 8) return;
    for (const e of cause.get(at) ?? []) {
      if (e.to === start) {
        const cards = [start, ...trail.map((x) => x.to)];
        const key = [...cards].sort().join('|');
        if (seenLoops.has(key)) continue;
        seenLoops.add(key);
        const negatives = [...trail, e].filter((x) => x.sign === -1).length;
        find({ kind: 'loop', cards, because: ids([...trail, e]), loop: negatives % 2 === 0 ? 'reinforcing' : 'balancing' });
      } else if (!visited.has(e.to) && e.to > start) {
        // 輪の中でいちばん小さい ID から始めたものだけを数える（同じ輪を何度も見つけない）
        visited.add(e.to);
        walk(start, e.to, [...trail, e], visited);
        visited.delete(e.to);
      }
    }
  };
  for (const a of [...cause.keys()].sort()) walk(a, a, [], new Set([a]));

  return { derived, findings };
}
