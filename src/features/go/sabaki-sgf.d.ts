declare module "@sabaki/sgf" {
  export type Vertex = [number, number];
  export interface SgfNode {
    id: number | string;
    data: Record<string, string[]>;
    parentId: number | string | null;
    children: SgfNode[];
  }

  export function parse(contents: string, options?: { getId?: () => number | string }): SgfNode[];
  export function stringify(nodes: SgfNode | SgfNode[]): string;
  export function parseCompressedVertices(input: string): Vertex[];
  const sgf: {
    parse: typeof parse;
    stringify: typeof stringify;
    parseCompressedVertices: typeof parseCompressedVertices;
  };
  export default sgf;
}
