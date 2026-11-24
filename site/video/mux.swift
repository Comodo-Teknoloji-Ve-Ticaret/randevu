// Sessiz H.264 videoyu AAC seslendirmeyle birleştirir (yeniden kodlamadan, "passthrough"), web için moov önde.
// Kullanım: swift mux.swift video.mp4 ses.m4a cikti.mp4
import AVFoundation

let a = CommandLine.arguments
guard a.count == 4 else { print("kullanım: mux.swift video ses çıktı"); exit(2) }
let video = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let audio = AVURLAsset(url: URL(fileURLWithPath: a[2]))
let out = URL(fileURLWithPath: a[3])
try? FileManager.default.removeItem(at: out)

let comp = AVMutableComposition()
guard let vSrc = video.tracks(withMediaType: .video).first, let aSrc = audio.tracks(withMediaType: .audio).first else {
  print("video ya da ses izi bulunamadı"); exit(1)
}
let range = CMTimeRange(start: .zero, duration: video.duration)
let vDst = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try vDst.insertTimeRange(range, of: vSrc, at: .zero)
let aDur = CMTimeMinimum(audio.duration, video.duration)
let aDst = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
try aDst.insertTimeRange(CMTimeRange(start: .zero, duration: aDur), of: aSrc, at: .zero)

guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { print("dışa aktarma açılamadı"); exit(1) }
ex.outputURL = out
ex.outputFileType = .mp4
ex.shouldOptimizeForNetworkUse = true
let sem = DispatchSemaphore(value: 0)
ex.exportAsynchronously { sem.signal() }
sem.wait()
if ex.status != .completed { print("dışa aktarma hatası:", ex.error?.localizedDescription ?? "bilinmiyor"); exit(1) }
print("ok", CMTimeGetSeconds(comp.duration))
