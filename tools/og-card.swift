// Text measurement and PNG painting for the social preview card (see tools/og-card.ts).
//
// Why a Swift helper: the card has to be a real raster PNG (X and Facebook do not render
// SVG in link previews) and it has to draw CJK. Nothing in the Node toolchain here can
// rasterise text — the repo has no canvas binding, and the screenshot tool is headless
// Chrome, which is far too heavy to sit in an asset pipeline. CoreText is already on every
// macOS box, needs no install and no network. It only ever runs when someone regenerates
// the card; `public/og.png` is committed, so a build, the CI and the deploy never touch it.
//
//   swift tools/og-card.swift measure < req.json > out.json
//   swift tools/og-card.swift draw    < spec.json          (writes spec.out)
//
// Both modes take the same font list and pick the first family the machine actually has,
// so a measured width is the width that later gets drawn.

import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write(("og-card.swift: " + msg + "\n").data(using: .utf8)!)
  exit(1)
}

func readStdinJSON() -> [String: Any] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    fail("stdin is not a JSON object")
  }
  return obj
}

/// First family in the list that this machine really has; the system font otherwise.
/// CTFontCreateWithName silently substitutes, so the resolved family name is compared back.
func resolveFamily(_ names: [String]) -> String? {
  for name in names {
    let f = CTFontCreateWithName(name as CFString, 12, nil)
    let got = CTFontCopyFamilyName(f) as String
    if got.caseInsensitiveCompare(name) == .orderedSame { return name }
  }
  return nil
}

func makeFont(_ family: String?, _ size: Double, bold: Bool) -> CTFont {
  let base: CTFont = family.map { CTFontCreateWithName($0 as CFString, size, nil) }
    ?? CTFontCreateUIFontForLanguage(.system, size, nil)!
  guard bold else { return base }
  return CTFontCreateCopyWithSymbolicTraits(base, size, nil, .traitBold, .traitBold) ?? base
}

func line(_ text: String, _ font: CTFont, _ color: CGColor) -> CTLine {
  let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: color]
  let astr = CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary)!
  return CTLineCreateWithAttributedString(astr)
}

/// `#rrggbb` (or `#rgb`) to a device-RGB colour. Anything else is a hard error: a silently
/// black word on a black card would be very easy to miss.
func parseColor(_ hex: String) -> CGColor {
  var s = hex.trimmingCharacters(in: .whitespaces)
  if s.hasPrefix("#") { s.removeFirst() }
  if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
  guard s.count == 6, let v = UInt32(s, radix: 16) else { fail("bad colour \(hex)") }
  return CGColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                 blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

let black = CGColor(red: 0, green: 0, blue: 0, alpha: 1)

// ── measure ──────────────────────────────────────────────────────────────────
// { family: [..], bold: Bool, size: Double, texts: [..] }
//   -> { "词": { "w": …, "h": … }, … }
// `w` is the advance width (what canvas measureText returns) and `h` the ink height
// (canvasMeasure's actualBoundingBoxAscent + Descent), so src/render/layout.ts gets
// exactly the two numbers its `Measure` contract asks for.
func runMeasure(_ req: [String: Any]) {
  let names = req["family"] as? [String] ?? []
  let bold = req["bold"] as? Bool ?? false
  let size = req["size"] as? Double ?? 100
  let texts = req["texts"] as? [String] ?? []
  let font = makeFont(resolveFamily(names), size, bold: bold)

  var out: [String: [String: Double]] = [:]
  for text in texts {
    let l = line(text, font, black)
    var asc: CGFloat = 0, desc: CGFloat = 0, lead: CGFloat = 0
    let advance = CTLineGetTypographicBounds(l, &asc, &desc, &lead)
    let ink = CTLineGetBoundsWithOptions(l, .useOpticalBounds)
    let h = ink.height > 0 ? Double(ink.height) : size * 0.92
    out[text] = ["w": Double(advance), "h": h]
  }
  let data = try! JSONSerialization.data(withJSONObject: out)
  FileHandle.standardOutput.write(data)
}

// ── draw ─────────────────────────────────────────────────────────────────────
// { width, height, background, family: [..], out: "path.png", items: [
//     { text, x, y, size, color, bold?, rotate?, align?: left|center|right,
//       baseline?: middle|alphabetic, opacity? } ] }
// Coordinates are top-left origin, like the layout and the SVG export; the context is
// native CoreGraphics (y up), so every y is flipped once here and nowhere else.
func runDraw(_ spec: [String: Any]) {
  let w = spec["width"] as? Int ?? 1200
  let h = spec["height"] as? Int ?? 630
  guard let outPath = spec["out"] as? String else { fail("draw needs `out`") }
  let names = spec["family"] as? [String] ?? []
  let family = resolveFamily(names)
  guard let items = spec["items"] as? [[String: Any]] else { fail("draw needs `items`") }

  let cs = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fail("could not create a \(w)x\(h) bitmap")
  }
  ctx.setFillColor(parseColor(spec["background"] as? String ?? "#000000"))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.setAllowsAntialiasing(true)
  ctx.setShouldSmoothFonts(true)

  for item in items {
    guard let text = item["text"] as? String, !text.isEmpty else { continue }
    let size = item["size"] as? Double ?? 16
    let bold = item["bold"] as? Bool ?? false
    let color = parseColor(item["color"] as? String ?? "#ffffff")
    let x = item["x"] as? Double ?? 0
    let y = Double(h) - (item["y"] as? Double ?? 0)      // top-left origin -> CG
    let rotate = item["rotate"] as? Double ?? 0           // degrees, counter-clockwise
    let align = item["align"] as? String ?? "center"
    let baseline = item["baseline"] as? String ?? "middle"
    let opacity = item["opacity"] as? Double ?? 1

    let l = line(text, makeFont(family, size, bold: bold), color)
    var asc: CGFloat = 0, desc: CGFloat = 0, lead: CGFloat = 0
    let advance = CTLineGetTypographicBounds(l, &asc, &desc, &lead)
    let ink = CTLineGetBoundsWithOptions(l, .useOpticalBounds)

    // Offset from the anchor to the text origin (the baseline's left end).
    var dx: Double
    switch align {
    case "left": dx = 0
    case "right": dx = -Double(advance)
    default: dx = -Double(advance) / 2
    }
    // "middle" centres the ink box on the anchor, which is what the canvas renderer and
    // the SVG export do for cloud words; "alphabetic" puts the baseline on it.
    let dy: Double = baseline == "alphabetic" ? 0 : -Double(ink.origin.y + ink.height / 2)

    ctx.saveGState()
    ctx.setAlpha(CGFloat(opacity))
    ctx.translateBy(x: CGFloat(x), y: CGFloat(y))
    if rotate != 0 { ctx.rotate(by: CGFloat(rotate * .pi / 180)) }
    ctx.textPosition = CGPoint(x: dx, y: dy)
    CTLineDraw(l, ctx)
    ctx.restoreGState()
  }

  guard let img = ctx.makeImage() else { fail("makeImage failed") }
  let url = URL(fileURLWithPath: outPath) as CFURL
  guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else {
    fail("cannot write \(outPath)")
  }
  CGImageDestinationAddImage(dest, img, nil)
  guard CGImageDestinationFinalize(dest) else { fail("PNG encoding failed") }
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
switch mode {
case "measure": runMeasure(readStdinJSON())
case "draw": runDraw(readStdinJSON())
default: fail("usage: og-card.swift measure|draw  (JSON on stdin)")
}
