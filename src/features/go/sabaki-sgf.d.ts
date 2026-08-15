declare module "@sabaki/sgf" {
  export interface SgfNode {
    id: number | string;
    data: Record<string, string[]>;
    parentId: number | string | null;
    children: SgfNode[];
  }

  export function parse(contents: string, options?: { getId?: () => number | string }): SgfNode[];
  export function stringify(nodes: SgfNode | SgfNode[]): string;
  const sgf: {
    parse: typeof parse;
    stringify: typeof stringify;
  };
  export default sgf;
}
