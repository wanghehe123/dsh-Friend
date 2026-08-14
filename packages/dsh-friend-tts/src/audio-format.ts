/** Ported from Kokoro-Engine `src/lib/audio-player.ts` (format helpers). */

export type AudioContainer = 'mp3' | 'wav' | 'unknown'

export function detectAudioContainer(chunk: Uint8Array): AudioContainer {
  if (chunk.byteLength >= 12) {
    const isRiff = chunk[0] === 0x52 && chunk[1] === 0x49 && chunk[2] === 0x46 && chunk[3] === 0x46
    const isWave = chunk[8] === 0x57 && chunk[9] === 0x41 && chunk[10] === 0x56 && chunk[11] === 0x45
    if (isRiff && isWave) {
      return 'wav'
    }
  }

  if (chunk.byteLength >= 3) {
    const hasId3 = chunk[0] === 0x49 && chunk[1] === 0x44 && chunk[2] === 0x33
    if (hasId3) {
      return 'mp3'
    }
  }

  if (chunk.byteLength >= 2) {
    const first = chunk[0]
    const second = chunk[1]
    if (first === 0xff && second !== undefined && (second & 0xe0) === 0xe0) {
      return 'mp3'
    }
  }

  return 'unknown'
}

/**
 * Some cloud TTS gateways ship WAV files with placeholder RIFF/data sizes.
 * WebAudio decodeAudioData rejects them even though the PCM payload is valid.
 */
export function repairWavHeaders(input: Uint8Array): Uint8Array {
  if (input.byteLength < 44) {
    return input
  }
  const isRiff = input[0] === 0x52 && input[1] === 0x49 && input[2] === 0x46 && input[3] === 0x46
  const isWave = input[8] === 0x57 && input[9] === 0x41 && input[10] === 0x56 && input[11] === 0x45
  if (!isRiff || !isWave) {
    return input
  }

  const out = Uint8Array.from(input)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint32(4, out.byteLength - 8, true)

  let offset = 12
  while (offset + 8 <= out.byteLength) {
    const id = String.fromCharCode(out[offset] ?? 0, out[offset + 1] ?? 0, out[offset + 2] ?? 0, out[offset + 3] ?? 0)
    const declared = view.getUint32(offset + 4, true)
    if (id === 'data') {
      const payload = out.byteLength - offset - 8
      if (declared > payload || declared >= 0x7f000000 || declared === 0xffffffff) {
        view.setUint32(offset + 4, payload, true)
      }
      break
    }

    let step = 8 + declared
    if (declared % 2 === 1) {
      step += 1
    }
    if (step <= 8 || offset + step > out.byteLength) {
      break
    }
    offset += step
  }

  return out
}

/** RMS of an AnalyserNode time-domain buffer (unsigned bytes, 128 = silence). */
export function rmsFromTimeDomain(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0
  }
  let sum = 0
  for (const sample of bytes) {
    const normalized = (sample - 128) / 128
    sum += normalized * normalized
  }
  return Math.sqrt(sum / bytes.length)
}

/** Build a one-period unsigned-8 sine for energy-pump fixtures. */
export function sineTimeDomainBytes(amplitude: number, length = 128): Uint8Array {
  const clamped = Math.min(1, Math.max(0, amplitude))
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    const sample = Math.sin((index / length) * Math.PI * 2)
    out[index] = Math.round(128 + sample * clamped * 127)
  }
  return out
}
