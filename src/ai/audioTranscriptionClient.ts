import { transcribeAudio as transcribeAudioViaBridge } from "./bridgeClient";
import type { AudioTranscriptionResult } from "../types";

export async function transcribeAudio(blob: Blob, fileName = "dictation.webm"): Promise<AudioTranscriptionResult> {
  return await transcribeAudioViaBridge(blob, fileName);
}
