import { createRealtimeCall } from "./bridgeClient";
import type { AiNodeContext, RealtimeSessionConfig } from "../types";

export type RealtimeSessionState = "connecting" | "live" | "closed" | "error";

export interface RealtimeVoiceSession {
  stop: () => void;
}

interface StartRealtimeVoiceSessionOptions {
  context: AiNodeContext;
  instructions?: string;
  onStateChange?: (state: RealtimeSessionState) => void;
  onEvent?: (event: unknown) => void;
}

export async function startRealtimeVoiceSession({
  context,
  instructions,
  onStateChange,
  onEvent,
}: StartRealtimeVoiceSessionOptions): Promise<RealtimeVoiceSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  onStateChange?.("connecting");
  const peerConnection = new RTCPeerConnection();
  const audioElement = new Audio();
  audioElement.autoplay = true;
  let mediaStream: MediaStream | null = null;

  peerConnection.ontrack = (event) => {
    audioElement.srcObject = event.streams[0];
  };

  const dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.addEventListener("open", () => {
    onStateChange?.("live");
    dataChannel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `This voice session is anchored to the Mind Atlas node "${context.selectedNode.title}". Wait for spoken input before giving long answers.`,
          },
        ],
      },
    }));
  });
  dataChannel.addEventListener("message", (event) => {
    try {
      onEvent?.(JSON.parse(event.data));
    } catch {
      onEvent?.(event.data);
    }
  });

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mediaStream.getAudioTracks()) {
    peerConnection.addTrack(track, mediaStream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  if (!offer.sdp) throw new Error("Unable to create a Realtime SDP offer.");

  const session: RealtimeSessionConfig = {
    context,
    instructions,
  };
  const answerSdp = await createRealtimeCall({ ...session, sdp: offer.sdp });
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    stop: () => {
      dataChannel.close();
      peerConnection.close();
      mediaStream?.getTracks().forEach((track) => track.stop());
      audioElement.srcObject = null;
      onStateChange?.("closed");
    },
  };
}
