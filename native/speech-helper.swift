import Foundation
import Speech
import AVFoundation
import CoreMedia

func output(_ packet: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}

enum InputError: Error { case invalid }

func readExact(_ count: Int) throws -> Data? {
    var result = Data()
    while result.count < count {
        let part = try FileHandle.standardInput.read(upToCount: count - result.count) ?? Data()
        if part.isEmpty {
            if result.isEmpty { return nil }
            throw InputError.invalid
        }
        result.append(part)
    }
    return result
}

@available(macOS 26.0, *)
func recognize(locale: Locale) async throws {
    let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
          let inputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: inputFormat, to: format) else { throw InputError.invalid }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.prepareToAnalyze(in: format)
    let (sequence, continuation) = AsyncThrowingStream<AnalyzerInput, Error>.makeStream(bufferingPolicy: .bufferingOldest(50))
    let results = Task {
        for try await result in transcriber.results {
            let start = CMTimeGetSeconds(result.range.start)
            let end = CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))
            let boundary = CMTimeGetSeconds(result.resultsFinalizationTime)
            guard start.isFinite, end.isFinite else { throw InputError.invalid }
            output(["type": "result", "start": start, "end": end,
                    "finalized_through": boundary.isFinite ? max(0, boundary) : 0,
                    "is_final": result.isFinal, "text": String(result.text.characters)])
        }
    }
    let producer = Task.detached {
        var offset: Int64 = 0
        func emit(_ buffer: AVAudioPCMBuffer) throws {
            if buffer.frameLength == 0 { return }
            let input = AnalyzerInput(buffer: buffer, bufferStartTime: CMTime(value: offset, timescale: Int32(format.sampleRate)))
            offset += Int64(buffer.frameLength)
            switch continuation.yield(input) {
            case .enqueued: break
            case .dropped, .terminated: throw InputError.invalid
            @unknown default: throw InputError.invalid
            }
        }
        do {
            while let header = try readExact(4) {
                let length = header.reduce(0) { ($0 << 8) | Int($1) }
                guard length > 0, length <= 9600, length % 2 == 0,
                      let pcm = try readExact(length),
                      let source = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(length / 2)),
                      let samples = source.int16ChannelData else { throw InputError.invalid }
                source.frameLength = AVAudioFrameCount(length / 2)
                pcm.copyBytes(to: UnsafeMutableRawBufferPointer(start: samples[0], count: length))
                let capacity = AVAudioFrameCount(ceil(Double(source.frameLength) * format.sampleRate / 24000) + 1024)
                guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw InputError.invalid }
                var supplied = false
                var error: NSError?
                let status = converter.convert(to: converted, error: &error) { _, inputStatus in
                    if supplied { inputStatus.pointee = .noDataNow; return nil }
                    supplied = true
                    inputStatus.pointee = .haveData
                    return source
                }
                guard status != .error, error == nil else { throw InputError.invalid }
                try emit(converted)
            }
            // Drain converter latency before finalizing the analyzer.
            for _ in 0..<8 {
                guard let tail = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024) else { throw InputError.invalid }
                var error: NSError?
                let status = converter.convert(to: tail, error: &error) { _, state in state.pointee = .endOfStream; return nil }
                guard status != .error, error == nil else { throw InputError.invalid }
                try emit(tail)
                if status == .endOfStream { break }
            }
            continuation.finish()
        } catch {
            continuation.finish(throwing: InputError.invalid)
            throw InputError.invalid
        }
    }
    output(["type": "ready"])
    do {
        _ = try await analyzer.analyzeSequence(sequence)
        try await producer.value
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await results.value
    } catch {
        producer.cancel()
        results.cancel()
        await analyzer.cancelAndFinishNow()
        throw InputError.invalid
    }
}

@main struct SpeechHelper {
    static func main() async {
        if #available(macOS 26.0, *) {
            let supported = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP"))
            let installed = await SpeechTranscriber.installedLocales.contains { $0.identifier(.bcp47) == "ja-JP" }
            if CommandLine.arguments.contains("--probe") {
                output(["available": SpeechTranscriber.isAvailable && supported != nil, "japanese_installed": installed])
                return
            }
            guard SpeechTranscriber.isAvailable, installed, let locale = supported else {
                output(["type": "error"])
                exit(1)
            }
            do { try await recognize(locale: locale) }
            catch { output(["type": "error"]); exit(1) }
        } else {
            output(["available": false, "japanese_installed": false])
            if !CommandLine.arguments.contains("--probe") { exit(1) }
        }
    }
}
