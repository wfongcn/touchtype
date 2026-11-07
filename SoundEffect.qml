import QtQuick
import Quickshell.Io
import QtMultimedia
import "SoundWriter.js" as SoundWriter

// One sound effect of the Falling Letters game. The sound is synthesised by
// Sounds.js as a base64 WAV payload and written to a private directory, so
// the plugin carries no audio files of its own. The caller passes the
// payload; this only writes it once, points a player at it and plays it on
// demand.
Item {
  id: effect

  // The name of the sound file, and the payload that is written there.
  property string fileName: ""
  property string payload: ""
  property real volume: 0.5

  // Where the payload was written, and whether it is ready to be played.
  // False until the file has been written, so a hit before the writer
  // finishes stays silent instead of playing an empty file.
  property string filePath: ""
  property bool ready: false

  function play() {
    if (effect.ready) player.play()
  }

  MediaPlayer {
    id: player
    source: ""
    audioOutput: AudioOutput { volume: effect.volume }
  }

  Process {
    id: writer
    command: SoundWriter.writeCommand(effect.fileName, effect.payload)
    stdout: StdioCollector {
      id: collector
      // The writer prints the path of the file it wrote.
      onStreamFinished: effect.filePath = collector.text.trim()
    }
    onExited: (exitCode) => {
      if (exitCode !== 0 || effect.filePath === "") return
      player.source = "file://" + effect.filePath
      effect.ready = true
    }
  }

  // The sound is prepared as soon as the plugin loads, so the first letter
  // that is hit already makes a noise.
  Component.onCompleted: {
    if (effect.fileName !== "" && effect.payload !== "") writer.running = true
  }
}
