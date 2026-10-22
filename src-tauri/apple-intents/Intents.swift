import Foundation
// Import both frameworks so Swift links the public AppKit/App Intents overlay.
// Linking AppKit from Rust alone does not install the system intent handoff.
import AppKit
import AppIntents
private typealias Call = @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
private typealias Free = @convention(c) (UnsafeMutablePointer<CChar>) -> Void
private final class BridgeState: @unchecked Sendable {
 static let shared=BridgeState()
 let lock=NSLock(); var call:Call?; var free:Free?
 func request(_ command:String,_ args:[String:Any]=[:]) throws -> [String:Any] {
  lock.lock(); let call=self.call; let free=self.free; lock.unlock()
  guard let call,let free else {throw IntentFailure("Open Chronoscope first")}
  let input=try JSONSerialization.data(withJSONObject:["command":command,"args":args])
  let text=String(decoding:input,as:UTF8.self)
  guard let pointer=text.withCString({call($0)}) else {throw IntentFailure("Chronoscope is unavailable")}
  let data=Data(String(cString:pointer).utf8); free(pointer)
  let result=try JSONSerialization.jsonObject(with:data) as! [String:Any]
  if let error=result["error"] as? String {throw IntentFailure(error)}
  return result
 }
}
private struct IntentFailure: LocalizedError {let message:String;init(_ message:String){self.message=message};var errorDescription:String?{message}}
private func engine(_ command:String,_ args:[String:Any]=[:]) async throws -> [String:Any] {
 // Never block the main app actor while an engine operation emits UI events.
 try await Task.detached {try BridgeState.shared.request(command,args)}.value
}
@available(macOS 13.0, *)
enum ChronoscopeView: String, AppEnum {
 static var typeDisplayRepresentation:TypeDisplayRepresentation="Chronoscope view"
 static var caseDisplayRepresentations:[Self:DisplayRepresentation]=[.spaceTime:"Space-time",.map:"2D Map",.globe:"Globe"]
 case spaceTime,map,globe
 var mode:String {switch self{case .spaceTime:"space-time";case .map:"map";case .globe:"globe"}}
}
@available(macOS 13.0, *)
enum AnalysisScope: String, AppEnum {
 static var typeDisplayRepresentation:TypeDisplayRepresentation="Analysis scope"
 static var caseDisplayRepresentations:[Self:DisplayRepresentation]=[.visible:"Visible events",.selected:"Selected events within current filters"]
 case visible,selected
 var key:String {self == .visible ? "visible":"selected"}
}
@available(macOS 13.0, *)
struct WorkspaceSummaryIntent: AppIntent {
 static var title:LocalizedStringResource="Summarize Chronoscope workspace"
 static var description=IntentDescription("Read exact event and selection counts for the current workspace.")
 static var openAppWhenRun:Bool=true
 static var authenticationPolicy:IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
 func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
  let result=try await engine("snapshot",["compact":true,"include_statistics":false,"selection_limit":0])
  let text="\(result["count"] ?? 0) events; \(result["visible"] ?? 0) visible; \(result["selected_count"] ?? 0) selected."
  return .result(value:text,dialog:IntentDialog(stringLiteral:text))
 }
}
@available(macOS 13.0, *)
struct ShowChronoscopeViewIntent: AppIntent {
 static var title:LocalizedStringResource="Show Chronoscope view"
 static var description=IntentDescription("Switch the current workspace to a named map or time view.")
 static var openAppWhenRun:Bool=true
 static var authenticationPolicy:IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
 @Parameter(title:"View") var view:ChronoscopeView
 static var parameterSummary:some ParameterSummary {Summary("Show \(\.$view)")}
 func perform() async throws -> some IntentResult {
  _=try await engine("view_set",["mode":view.mode])
  return .result()
 }
}
@available(macOS 13.0, *)
struct RecommendChronoscopeAnalysisIntent: AppIntent {
 static var title:LocalizedStringResource="Recommend Chronoscope analyses"
 static var description=IntentDescription("Check which analyses have usable inputs. No model or cloud required; does not run an analysis.")
 static var openAppWhenRun:Bool=true
 static var authenticationPolicy:IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
 @Parameter(title:"Scope",default:.visible) var scope:AnalysisScope
 func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
  let result=try await engine("analysis_context",["scope":scope.key])
  let choices=(result["recommendations"] as? [[String:Any]] ?? []).filter{$0["eligible"] as? Bool == true}.compactMap{$0["pattern"] as? String}
  let text=choices.isEmpty ? "No analyses have sufficient usable inputs in this scope." : "Applicable analyses: \(choices.joined(separator:", ")). Thresholds require review; findings are not guaranteed."
  return .result(value:text,dialog:IntentDialog(stringLiteral:text))
 }
}
@available(macOS 13.0, *)
struct FindChronoscopeGapsIntent: AppIntent {
 static var title:LocalizedStringResource="Find Chronoscope track gaps"
 static var description=IntentDescription("Find gaps longer than an explicit number of hours. Read-only; uses exact track timestamps and reports input limits.")
 static var openAppWhenRun:Bool=true
 static var authenticationPolicy:IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
 @Parameter(title:"Gap threshold in hours") var hours:Double
 @Parameter(title:"Scope",default:.visible) var scope:AnalysisScope
 static var parameterSummary:some ParameterSummary {Summary("Find gaps longer than \(\.$hours) hours in \(\.$scope)")}
 func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
  guard hours.isFinite,hours>0,hours<=8766000 else {throw IntentFailure("Choose a positive gap threshold in hours")}
  let plan=try await engine("analysis_prepare",["pattern":"Gaps","scope":scope.key,"parameters":["gap_s":Int((hours*3600).rounded())]])
  let result=try await engine("analysis_execute",["plan":plan])
  let text="\(result["count"] ?? 0) gap findings; \(result["evaluated_count"] ?? 0) of \(result["input_count"] ?? 0) events evaluated. Limited: \(result["limited"] ?? false)."
  return .result(value:text,dialog:IntentDialog(stringLiteral:text))
 }
}
@available(macOS 13.0, *)
struct SelectChronoscopeEntityIntent: AppIntent {
 static var title:LocalizedStringResource="Select Chronoscope entity"
 static var description=IntentDescription("Add all events for an exact entity name to selection without clearing other entities. Set Remove to deselect it.")
 static var openAppWhenRun:Bool=true
 static var authenticationPolicy:IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
 @Parameter(title:"Exact entity name") var entity:String
 @Parameter(title:"Remove from selection",default:false) var remove:Bool
 static var parameterSummary:some ParameterSummary {Summary("Select entity \(\.$entity)")}
 func perform() async throws -> some IntentResult {
  guard !entity.isEmpty,entity.utf8.count<=1024 else {throw IntentFailure("Provide an exact entity name")}
  _=try await engine("select_query",["apply_filter":false,"filter":["predicates":[["field":"entity","op":"Equals","value":entity]]],"mode":remove ? "subtract":"add"])
  return .result()
 }
}
@available(macOS 13.0, *)
struct ChronoscopeShortcuts: AppShortcutsProvider {
 static var appShortcuts:[AppShortcut] {
  AppShortcut(intent:WorkspaceSummaryIntent(),phrases:["Summarize my workspace in \(.applicationName)"],shortTitle:"Workspace summary",systemImageName:"chart.bar.doc.horizontal")
  AppShortcut(intent:ShowChronoscopeViewIntent(),phrases:["Show \(\.$view) in \(.applicationName)"],shortTitle:"Show view",systemImageName:"globe")
  AppShortcut(intent:RecommendChronoscopeAnalysisIntent(),phrases:["Recommend analyses in \(.applicationName)"],shortTitle:"Recommend analyses",systemImageName:"sparkles")
  AppShortcut(intent:FindChronoscopeGapsIntent(),phrases:["Find track gaps in \(.applicationName)"],shortTitle:"Find track gaps",systemImageName:"clock.arrow.circlepath")
  AppShortcut(intent:SelectChronoscopeEntityIntent(),phrases:["Select an entity in \(.applicationName)"],shortTitle:"Select entity",systemImageName:"plus.circle")
 }
}
@_cdecl("chronoscope_intents_install")
func install(_ call:@escaping @convention(c)(UnsafePointer<CChar>)->UnsafeMutablePointer<CChar>?,_ free:@escaping @convention(c)(UnsafeMutablePointer<CChar>)->Void) {
 let state=BridgeState.shared;state.lock.lock();state.call=call;state.free=free;state.lock.unlock()
 if #available(macOS 13.0,*) {ChronoscopeShortcuts.updateAppShortcutParameters()}
}
@_cdecl("chronoscope_intents_verify")
func verify()->UnsafeMutablePointer<CChar> {
 guard #available(macOS 13.0,*) else {return strdup("{\"unavailable\":true}")!}
 let semaphore=DispatchSemaphore(value:0)
 final class Output:@unchecked Sendable {var text=""}
 let output=Output()
 Task.detached {
  do {
   _=try await WorkspaceSummaryIntent().perform()
   let view=ShowChronoscopeViewIntent();view.view = .map;_=try await view.perform()
   let recommend=RecommendChronoscopeAnalysisIntent();recommend.scope = .visible;_=try await recommend.perform()
   let select=SelectChronoscopeEntityIntent();select.entity="Atlas";select.remove=false;_=try await select.perform()
   let gaps=FindChronoscopeGapsIntent();gaps.hours=0.1;gaps.scope = .visible;_=try await gaps.perform()
   output.text="{\"passed\":true,\"intents\":5}"
  }catch {let data=try! JSONSerialization.data(withJSONObject:["error":error.localizedDescription]);output.text=String(decoding:data,as:UTF8.self)}
  semaphore.signal()
 }
 _=semaphore.wait(timeout:.now()+30)
 return strdup(output.text)!
}
@_cdecl("chronoscope_intents_free") func release(_ pointer:UnsafeMutablePointer<CChar>){free(pointer)}

@available(macOS 14.0, *)
struct ChronoscopeIntentPackage: AppIntentsPackage {}
