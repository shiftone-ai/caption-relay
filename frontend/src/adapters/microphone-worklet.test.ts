import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("downmixes PCM and flushes the last partial frame with continuous sequence and sample offsets", () => {
  const packets: ArrayBuffer[] = [];
  class Processor {
    port = { onmessage: null as ((event: { data: { type: string } }) => void) | null,
      postMessage: (packet: ArrayBuffer) => { if (packet instanceof ArrayBuffer) packets.push(packet); } };
  }
  let Registered!: new () => Processor & { process(input: Float32Array[][]): boolean };
  runInNewContext(readFileSync(new URL("./microphone-worklet.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor: Processor, sampleRate: 48000, ArrayBuffer, DataView,
    registerProcessor: (_name: string, processor: typeof Registered) => { Registered = processor; },
  });
  const processor = new Registered();
  const channel = new Float32Array(4800).fill(0.5);
  processor.process([[channel, new Float32Array(4800)]]);
  processor.process([[new Float32Array(240).fill(-1)]]);
  processor.port.onmessage!({ data: { type: "flush" } });
  expect(packets.map(packet => packet.byteLength)).toEqual([9608, 488]);
  const first = new DataView(packets[0]);
  expect([first.getUint32(0), first.getUint32(4), first.getInt16(8, true)]).toEqual([0, 0, 8192]);
  const last = new DataView(packets[1]);
  expect([last.getUint32(0), last.getUint32(4), last.getInt16(8, true)]).toEqual([1, 4800, -32768]);
  processor.process([[channel]]);
  expect(packets).toHaveLength(2); // Never send more audio after the stop barrier.
});
