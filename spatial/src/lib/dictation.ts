import { useEffect, useRef, useState } from 'react';
import { transcribe } from './service';
import { t } from '../i18n';
import { noticeRequestCost } from './cost';

/** マイクで録音し、止めたら書き起こして返す（hosted は課金対象、ローカルはブリッジ経由） */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => () => stream.current?.getTracks().forEach((tr) => tr.stop()), []);

  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError(t('voice.insecure'));
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(t('voice.micDenied'));
      return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.current?.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 800) {
        setState('idle');
        return;
      }
      setState('transcribing');
      try {
        // 音声はトークンで測れないので、サーバーの最低課金額を目安に出す
        noticeRequestCost({ chars: 0, outputTokens: 0, minimumUsd: 0.002 });
        const { text } = await transcribe(blob);
        if (text?.trim()) onText(text.trim());
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setState('idle');
      }
    };
    recorder.current = rec;
    rec.start();
    setState('recording');
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();

  return { state, start, stop, toggle: () => (state === 'recording' ? stop() : state === 'idle' ? void start() : undefined) };
}

/** 画像ファイルを最大辺 800px の JPEG データURLに縮める（保存容量を抑える） */
export async function shrinkImage(file: Blob, maxSide = 800, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
