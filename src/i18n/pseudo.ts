const ACCENTS: Record<string, string> = {
  a: "à", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ğ", h: "ħ", i: "ï", j: "ĵ", k: "ķ", l: "ľ", m: "ɱ",
  n: "ñ", o: "ô", p: "þ", q: "ɋ", r: "ř", s: "š", t: "ŧ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
};

export function pseudoLocalize(message: string, rtl = false) {
  const protectedParts = splitProtectedIcu(message);
  const transformed = protectedParts.map((part) => {
    if (part.startsWith("{") || part.startsWith("<")) return part;
    const accented = [...part].map((char) => {
      const lower = char.toLowerCase();
      const replacement = ACCENTS[lower];
      if (!replacement) return char;
      return char === lower ? replacement : replacement.toUpperCase();
    }).join("");
    return accented.replace(/([aeiouàëïôü])/gi, "$1$1");
  }).join("");
  return rtl ? `\u202e${transformed}\u202c` : `［${transformed}］`;
}

function splitProtectedIcu(message: string) {
  const parts: string[] = [];
  let plain = "";
  let index = 0;
  while (index < message.length) {
    const char = message[index];
    if (char !== "{" && char !== "<") {
      plain += char;
      index += 1;
      continue;
    }
    if (plain) {
      parts.push(plain);
      plain = "";
    }
    if (char === "<") {
      const end = message.indexOf(">", index);
      if (end < 0) {
        plain += char;
        index += 1;
      } else {
        parts.push(message.slice(index, end + 1));
        index = end + 1;
      }
      continue;
    }
    let depth = 0;
    let end = index;
    for (; end < message.length; end += 1) {
      if (message[end] === "{") depth += 1;
      if (message[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    parts.push(message.slice(index, end));
    index = end;
  }
  if (plain) parts.push(plain);
  return parts;
}
