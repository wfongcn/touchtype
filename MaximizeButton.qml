import QtQuick
import qs.Commons
import qs.Ui
import "I18n.js" as I18n

// Compact control that switches the trainer between its compact layout and
// a full-bleed one. The overlay owns the state; this only reports intent.
Rectangle {
  id: root

  property bool maximized: false
  property string language: I18n.defaultLanguage()
  property color foreground: Color.popups.text

  signal activated()

  implicitHeight: Style.space(28)
  implicitWidth: Style.space(28)
  radius: height / 2
  color: area.containsMouse ? Util.alpha(Color.accent, 0.2) : Util.alpha(root.foreground, 0.05)
  border.width: 1
  border.color: Util.alpha(root.foreground, 0.12)

  Text {
    anchors.centerIn: parent
    text: root.maximized ? "⤡" : "⛶"
    color: root.foreground
    font.family: Style.font.family
    font.pixelSize: Style.font.body
    font.bold: true
  }

  MouseArea {
    id: area
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.activated()
  }

  Text {
    anchors.top: root.bottom
    anchors.topMargin: Style.spacing.xs
    anchors.horizontalCenter: parent.horizontalCenter
    visible: area.containsMouse
    text: I18n.t(root.maximized ? "app.restore" : "app.maximize", root.language)
    color: Color.muted
    font.family: I18n.fontFamily(root.language, Style.font.family)
    font.pixelSize: Style.font.caption
    z: 5
  }
}
