// H.264 映像 1 本と AAC 音声 1 本を、ふつうの MP4（moov が先頭＝faststart）に詰める。
// WebCodecs が出した圧縮済みのかたまりをそのまま並べるだけで、再圧縮はしない。
// X や YouTube が受け付ける、いちばん素直な形にしてある（B フレームなし前提）。

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u8 = (n) => Uint8Array.of(n & 255);
const u16 = (n) => Uint8Array.of((n >>> 8) & 255, n & 255);
const u24 = (n) => Uint8Array.of((n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const zeros = (n) => new Uint8Array(n);

function concat(parts) {
  const flat = parts.flat(Infinity);
  const length = flat.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of flat) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function box(type, ...parts) {
  const payload = concat(parts);
  return concat([u32(payload.length + 8), ascii(type), payload]);
}

const fullbox = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);

// 回転なしの変換行列
const MATRIX = [u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)];

/** MPEG-4 の記述子（長さは 4 バイトの形で書く） */
function descriptor(tag, ...parts) {
  const payload = concat(parts);
  const n = payload.length;
  return concat([u8(tag), Uint8Array.of(0x80 | ((n >>> 21) & 0x7f), 0x80 | ((n >>> 14) & 0x7f), 0x80 | ((n >>> 7) & 0x7f), n & 0x7f), payload]);
}

function sampleTable({ entry, deltas, sizes, offsets, keyframes }) {
  // 同じ長さが続く所はまとめる
  const runs = [];
  for (const d of deltas) {
    const last = runs.at(-1);
    if (last && last.delta === d) last.count += 1;
    else runs.push({ count: 1, delta: d });
  }
  return box(
    "stbl",
    fullbox("stsd", 0, 0, u32(1), entry),
    fullbox("stts", 0, 0, u32(runs.length), runs.map((r) => [u32(r.count), u32(r.delta)])),
    keyframes ? fullbox("stss", 0, 0, u32(keyframes.length), keyframes.map((k) => u32(k))) : [],
    fullbox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullbox("stsz", 0, 0, u32(0), u32(sizes.length), sizes.map((s) => u32(s))),
    fullbox("stco", 0, 0, u32(offsets.length), offsets.map((o) => u32(o))),
  );
}

function track({ id, kind, timescale, duration, movieDuration, width = 0, height = 0, table }) {
  const video = kind === "video";
  return box(
    "trak",
    fullbox("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
    box(
      "mdia",
      fullbox("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
      fullbox("hdlr", 0, 0, u32(0), ascii(video ? "vide" : "soun"), zeros(12), ascii(video ? "VideoHandler" : "SoundHandler"), u8(0)),
      box(
        "minf",
        video ? fullbox("vmhd", 0, 1, zeros(8)) : fullbox("smhd", 0, 0, u16(0), u16(0)),
        box("dinf", fullbox("dref", 0, 0, u32(1), fullbox("url ", 0, 1))),
        table,
      ),
    ),
  );
}

/**
 * video: { width, height, fps, avcC, samples: [{ data, key }] }
 * audio: { sampleRate, channels, asc, samples: [{ data }], frameSize }（無くてもよい）
 */
export function buildMp4({ video, audio }) {
  const vScale = video.fps * 1000;
  const vDelta = 1000;
  const vDuration = video.samples.length * vDelta;
  const movieDuration = Math.round((video.samples.length / video.fps) * 1000);
  const aDuration = audio ? audio.samples.length * audio.frameSize : 0;

  const avc1 = box(
    "avc1",
    zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(video.width), u16(video.height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
    box("avcC", video.avcC),
  );
  const mp4a = audio
    ? box(
        "mp4a",
        zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.sampleRate << 16),
        fullbox(
          "esds", 0, 0,
          descriptor(
            0x03, u16(2), u8(0),
            descriptor(0x04, u8(0x40), u8(0x15), u24(0), u32(audio.bitrate), u32(audio.bitrate), descriptor(0x05, audio.asc)),
            descriptor(0x06, u8(0x02)),
          ),
        ),
      )
    : null;

  const keyframes = video.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const build = (vOffsets, aOffsets) =>
    box(
      "moov",
      fullbox("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(movieDuration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(audio ? 3 : 2)),
      track({
        id: 1, kind: "video", timescale: vScale, duration: vDuration, movieDuration, width: video.width, height: video.height,
        table: sampleTable({ entry: avc1, deltas: video.samples.map(() => vDelta), sizes: video.samples.map((s) => s.data.length), offsets: vOffsets, keyframes }),
      }),
      audio
        ? track({
            id: 2, kind: "audio", timescale: audio.sampleRate, duration: aDuration, movieDuration,
            table: sampleTable({ entry: mp4a, deltas: audio.samples.map(() => audio.frameSize), sizes: audio.samples.map((s) => s.data.length), offsets: aOffsets }),
          })
        : [],
    );

  const ftyp = box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));
  // moov の大きさは位置の数だけで決まるので、仮の位置で一度組んで大きさを測る
  const aSamples = audio ? audio.samples : [];
  const trial = build(video.samples.map(() => 0), aSamples.map(() => 0));
  let at = ftyp.length + trial.length + 8;
  const vOffsets = video.samples.map((s) => ((at += s.data.length), at - s.data.length));
  const aOffsets = aSamples.map((s) => ((at += s.data.length), at - s.data.length));
  const moov = build(vOffsets, aOffsets);
  if (moov.length !== trial.length) throw new Error("moov size changed");
  const payload = [...video.samples.map((s) => s.data), ...aSamples.map((s) => s.data)];
  const mdatSize = 8 + payload.reduce((a, p) => a + p.length, 0);
  return concat([ftyp, moov, u32(mdatSize), ascii("mdat"), payload]);
}
