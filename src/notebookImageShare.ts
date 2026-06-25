import { toBlob } from "html-to-image";
import type { AtlasTheme } from "./theme";

const MIND_ATLAS_HOME_URL = "https://mind-atlas.org/";
const SHARE_IMAGE_MAX_EDGE = 1800;
const SHARE_IMAGE_MAX_PIXEL_RATIO = 2;
const SHARE_CAPTURE_EXCLUDED_SELECTOR = ".context-menu, .node-action-button, .node-snooze-actions";

export async function createAtlasShareImage(target: HTMLElement, title: string, theme: AtlasTheme) {
  const bounds = target.getBoundingClientRect();
  if (bounds.width < 2 || bounds.height < 2) {
    throw new Error("The universe view is not ready to capture.");
  }

  await document.fonts?.ready;
  const pixelRatio = Math.min(SHARE_IMAGE_MAX_PIXEL_RATIO, SHARE_IMAGE_MAX_EDGE / Math.max(bounds.width, bounds.height));
  const snapshot = await toBlob(target, {
    backgroundColor: theme === "light" ? "#f7fbff" : "#050706",
    cacheBust: true,
    pixelRatio: Math.max(0.5, pixelRatio),
    filter: (node) => !(node instanceof HTMLElement && node.matches(SHARE_CAPTURE_EXCLUDED_SELECTOR)),
  });
  if (!snapshot) throw new Error("The universe image could not be created.");

  const image = await loadBlobImage(snapshot);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas image export is unavailable in this browser.");

  context.drawImage(image, 0, 0);
  drawShareImageChrome(context, canvas.width, canvas.height, title, theme);

  const blob = await canvasToBlob(canvas);
  return new File([blob], `${shareImageFileName(title)}.png`, { type: "image/png" });
}

export function createAtlasImageShareData(file: File, title: string): ShareData {
  const safeTitle = title.trim() || "Mind Atlas";
  return {
    files: [file],
    title: safeTitle,
    text: `${safeTitle}\n\nMade with Mind Atlas\n${MIND_ATLAS_HOME_URL}\n#MindAtlas`,
  };
}

function drawShareImageChrome(context: CanvasRenderingContext2D, width: number, height: number, title: string, theme: AtlasTheme) {
  const scale = Math.max(0.75, Math.min(2.2, width / 1400));
  const padding = Math.round(28 * scale);
  const titleFontSize = Math.round(32 * scale);
  const brandingFontSize = Math.round(18 * scale);
  const titleFont = `800 ${titleFontSize}px Inter, system-ui, sans-serif`;
  const safeTitle = fitText(context, title.trim() || "Mind Atlas", width - padding * 2, titleFont);
  const titleMetrics = context.measureText(safeTitle);
  const titleBoxWidth = Math.ceil(titleMetrics.width + padding * 1.15);
  const titleBoxHeight = Math.ceil(titleFontSize + padding * 0.72);
  const darkTheme = theme === "dark";

  context.save();
  context.fillStyle = darkTheme ? "rgba(5, 7, 6, 0.72)" : "rgba(247, 251, 255, 0.82)";
  roundRect(context, padding, padding, titleBoxWidth, titleBoxHeight, Math.round(10 * scale));
  context.fill();
  context.strokeStyle = darkTheme ? "rgba(211, 230, 203, 0.2)" : "rgba(30, 111, 203, 0.2)";
  context.lineWidth = Math.max(1, scale);
  context.stroke();
  context.font = titleFont;
  context.textBaseline = "middle";
  context.fillStyle = darkTheme ? "#f6f2db" : "#123b67";
  context.fillText(safeTitle, padding * 1.55, padding + titleBoxHeight / 2);

  const branding = "Made with Mind Atlas  ·  mind-atlas.org";
  context.font = `700 ${brandingFontSize}px Inter, system-ui, sans-serif`;
  const brandingMetrics = context.measureText(branding);
  const brandingPaddingX = Math.round(16 * scale);
  const brandingPaddingY = Math.round(11 * scale);
  const brandingWidth = Math.ceil(brandingMetrics.width + brandingPaddingX * 2);
  const brandingHeight = Math.ceil(brandingFontSize + brandingPaddingY * 2);
  const brandingX = width - padding - brandingWidth;
  const brandingY = height - padding - brandingHeight;
  context.fillStyle = darkTheme ? "rgba(5, 7, 6, 0.78)" : "rgba(247, 251, 255, 0.88)";
  roundRect(context, brandingX, brandingY, brandingWidth, brandingHeight, Math.round(9 * scale));
  context.fill();
  context.fillStyle = darkTheme ? "#d7ead9" : "#1e5d91";
  context.fillText(branding, brandingX + brandingPaddingX, brandingY + brandingHeight / 2);
  context.restore();
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) {
  context.font = font;
  if (context.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && context.measureText(`${shortened}...`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened.trimEnd()}...`;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function loadBlobImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The captured universe image could not be decoded."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG export is unavailable in this browser."));
    }, "image/png");
  });
}

function shareImageFileName(title: string) {
  const safe = (title.trim() || "mind-atlas")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return safe || "mind-atlas";
}
