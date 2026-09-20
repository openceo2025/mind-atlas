// 音声対話（Realtime Talk）。押して話す方式で、AI は空間を操作するツールを使える。
// hosted では既存の /api/realtime/calls（クレジット予約つき）、ローカルでは開発ブリッジを使う。
import { createRealtimeCall, endRealtimeCall } from './service';
import { confirmRequestCost } from './cost';

export type VoiceState = 'connecting' | 'live' | 'listening' | 'responding' | 'closed' | 'error';

export interface VoiceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionOptions {
  contextText: string;
  tools: VoiceTool[];
  execute: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  onState: (state: VoiceState) => void;
  onTranscript: (role: 'user' | 'assistant', text: string, final: boolean) => void;
  onError: (message: string) => void;
}

export interface VoiceSession {
  begin: () => void;
  end: () => void;
  stop: () => void;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function startVoiceSession(opts: VoiceSessionOptions): Promise<VoiceSession> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
  opts.onState('connecting');
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0] ?? null;
  };
  const dc = pc.createDataChannel('oai-events');
  const queue: Record<string, unknown>[] = [];
  let stopped = false;
  let listening = false;
  let assistantBuf = '';
  let userBuf = '';
  let maxTimer = 0;
  let responding = false;
  let sessionId = '';
  const done = new Set<string>();

  const send = (event: Record<string, unknown>) => {
    if (stopped) return;
    if (dc.readyState === 'open') dc.send(JSON.stringify(event));
    else if (dc.readyState === 'connecting') queue.push(event);
  };

  dc.addEventListener('open', () => {
    opts.onState('live');
    while (queue.length) dc.send(JSON.stringify(queue.shift()));
  });

  dc.addEventListener('message', (e) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    void handle(data);
  });

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getAudioTracks()) {
    track.enabled = false;
    pc.addTrack(track, stream);
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // 音声は話した時間ぶんの課金。1分あたりのおおよそで見積りを出す
  await confirmRequestCost({ chars: (opts.contextText ?? '').length, outputTokens: 0, minimumUsd: 0.12 });
  const call = await createRealtimeCall({
    product: 'spatial',
    contextText: opts.contextText,
    tools: opts.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
    sdp: offer.sdp,
  });
  sessionId = call.sessionId;
  await pc.setRemoteDescription({ type: 'answer', sdp: call.sdp });
  if (call.maxSessionSeconds) maxTimer = window.setTimeout(() => stop(), call.maxSessionSeconds * 1000);

  pc.addEventListener('connectionstatechange', () => {
    if (!stopped && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      opts.onError(pc.connectionState);
      stop();
    }
  });

  async function handle(ev: Record<string, unknown>) {
    const type = str(ev.type);
    if (type === 'conversation.item.input_audio_transcription.delta') {
      userBuf += str(ev.delta);
      opts.onTranscript('user', userBuf, false);
    } else if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = str(ev.transcript) || userBuf;
      userBuf = '';
      if (text) opts.onTranscript('user', text, true);
    } else if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta', 'response.output_text.delta', 'response.text.delta'].includes(type)) {
      assistantBuf += str(ev.delta);
      opts.onTranscript('assistant', assistantBuf, false);
    } else if (type === 'response.created') {
      responding = true;
      opts.onState('responding');
    } else if (type === 'response.done') {
      responding = false;
      if (assistantBuf.trim()) opts.onTranscript('assistant', assistantBuf.trim(), true);
      assistantBuf = '';
      if (!listening && !stopped) opts.onState('live');
    } else if (type === 'response.output_item.done') {
      const item = (ev.item ?? {}) as Record<string, unknown>;
      if (item.type === 'function_call') await runTool(str(item.name), str(item.arguments), str(item.call_id));
    } else if (type === 'response.function_call_arguments.done') {
      await runTool(str(ev.name), str(ev.arguments), str(ev.call_id));
    } else if (type === 'error' || type.endsWith('.error')) {
      const err = (ev.error ?? {}) as Record<string, unknown>;
      const message = str(err.message) || type;
      responding = false;
      // 話し終わったあとの取り消しなど、会話には影響しないものは黙って流す
      if (/no active response|cancellation failed|already has an active response/i.test(message)) return;
      opts.onError(message);
    }
  }

  async function runTool(name: string, args: string, callId: string) {
    const key = `${callId}:${name}`;
    if (!name || done.has(key)) return;
    done.add(key);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = args ? JSON.parse(args) : {};
    } catch {
      parsed = {};
    }
    const result = await opts.execute(name, parsed).catch((e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : String(e) }));
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) } });
    send({ type: 'response.create', response: { output_modalities: ['audio'] } });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(maxTimer);
    try {
      dc.close();
    } catch {
      // 既に閉じている
    }
    pc.close();
    stream.getTracks().forEach((tr) => tr.stop());
    audio.srcObject = null;
    // 通話の終わりを伝える（時間ぶんの課金に確定し、枠をすぐ空ける）
    void endRealtimeCall(sessionId);
    opts.onState('closed');
  }

  return {
    begin: () => {
      if (stopped || listening) return;
      listening = true;
      userBuf = '';
      // 何も話していないのに取り消すと API がエラーを返す
      if (responding) {
        responding = false;
        send({ type: 'response.cancel' });
      }
      send({ type: 'input_audio_buffer.clear' });
      stream.getAudioTracks().forEach((tr) => (tr.enabled = true));
      opts.onState('listening');
    },
    end: () => {
      if (stopped || !listening) return;
      listening = false;
      stream.getAudioTracks().forEach((tr) => (tr.enabled = false));
      opts.onState('responding');
      window.setTimeout(() => {
        send({ type: 'input_audio_buffer.commit' });
        send({ type: 'response.create', response: { output_modalities: ['audio'] } });
      }, 180);
    },
    stop,
  };
}
