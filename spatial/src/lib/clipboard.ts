// 画像カードの画像を、ペイントなどへそのまま貼れる形（PNG）でクリップボードへ入れる。
// ClipboardItem に Promise を渡すと、画像の変換を待つ間もクリックの操作として扱われる。

function toPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

export async function copyImage(src: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(src) })]);
}
