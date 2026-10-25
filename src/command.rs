//! Authoritative command identity and effects. Transport, transaction, recovery,
//! and discovery decisions use the same registry.
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mutation {
    Never,
    Always,
    Preferences,
    MapAccess,
}
#[derive(Clone, Copy, Debug)]
pub struct Effects {
    pub mutation: Mutation,
    pub transactional: bool,
    pub undoable: bool,
    pub dirty: bool,
    pub public_mcp: bool,
    pub detached: bool,
}
macro_rules! commands {
    ($($(#[$meta:meta])* $variant:ident => $name:literal, $mutation:ident, $transactional:literal, $undoable:literal, $dirty:literal, $public:literal, $detached:literal;)*) => {
        #[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
        pub enum Command {$($(#[$meta])* #[serde(rename=$name)] $variant,)*}
        pub const NAMES:&[&str]=&[$($(#[$meta])* $name,)*];
        impl Command {
            pub fn parse(value:&str)->Option<Self> {match canonical_name(value) {$($(#[$meta])* $name=>Some(Self::$variant),)* _=>None}}
            pub const fn as_str(self)->&'static str {match self {$($(#[$meta])* Self::$variant=>$name,)*}}
            pub const fn effects(self)->Effects {match self {$($(#[$meta])* Self::$variant=>Effects{mutation:Mutation::$mutation,transactional:$transactional,undoable:$undoable,dirty:$dirty,public_mcp:$public,detached:$detached},)*}}
            pub fn mutates(self,args:&Value)->bool {match self.effects().mutation {Mutation::Never=>false,Mutation::Always=>true,Mutation::Preferences=>args.get("preferences").is_some(),Mutation::MapAccess=>args.get("settings").is_some()}}
        }
    }
}
commands! {
    WorkspaceStatus => "workspace_status", Never, false, false, false, true, true;
    RecoveryList => "recovery_list", Never, false, false, false, false, false;
    RecoveryCheckpoint => "recovery_checkpoint", Never, false, false, false, true, false;
    RecoveryClear => "recovery_clear", Never, false, false, false, false, false;
    RecoveryRestore => "recovery_restore", Always, false, false, true, false, false;
    RecoveryDiscard => "recovery_discard", Never, false, false, false, false, false;
    AutosaveUnsaved => "autosave_unsaved", Never, false, false, false, false, false;
    RecoveryArchive => "recovery_archive", Never, false, false, false, false, false;
    #[cfg(feature = "experimental-browser-webmcp")]
    WebMcpExtension => "webmcp_extension", Never, false, false, false, false, false;
    #[cfg(feature = "experimental-browser-webmcp")]
    WebMcpStart => "webmcp_start", Never, false, false, false, false, false;
    #[cfg(feature = "experimental-browser-webmcp")]
    WebMcpStatus => "webmcp_status", Never, false, false, false, false, false;
    #[cfg(feature = "experimental-browser-webmcp")]
    WebMcpConnect => "webmcp_connect", Never, false, false, false, false, false;
    #[cfg(feature = "experimental-browser-webmcp")]
    WebMcpStop => "webmcp_stop", Never, false, false, false, false, false;
    ClientStatus => "client_status", Never, false, false, false, true, false;
    ClientTools => "client_tools", Never, false, false, false, true, false;
    ClientConnect => "client_connect", Never, false, false, false, false, false;
    ClientDisconnect => "client_disconnect", Never, false, false, false, false, false;
    ClientGrants => "client_grants", Never, false, false, false, false, false;
    ClientCall => "client_call", Never, false, false, false, true, false;
    AnalysisContext => "analysis_context", Never, false, false, false, true, false;
    AnalysisPrepare => "analysis_prepare", Never, false, false, false, true, false;
    AnalysisExecute => "analysis_execute", Never, false, false, false, true, false;
    AssistUi => "assist_ui", Never, false, false, false, true, false;
    AssistStatus => "assist_status", Never, false, false, false, true, false;
    AssistExplain => "assist_explain", Never, false, false, false, true, false;
    AssistTags => "assist_tags", Never, false, false, false, true, false;
    AssistTagsApply => "assist_tags_apply", Always, true, true, true, true, false;
    SiAppleStatus => "si_apple_status", Never, false, false, false, true, false;
    SiHistory => "si_history", Never, false, false, false, true, false;
    SiClear => "si_clear", Never, false, false, false, true, false;
    SiPermissions => "si_permissions", Never, false, false, false, true, false;
    SiStatus => "si_status", Never, false, false, false, true, false;
    SiConfigure => "si_configure", Never, false, false, false, true, false;
    SiDisconnect => "si_disconnect", Never, false, false, false, true, false;
    SiRun => "si_run", Never, false, false, false, true, false;
    PresentResult => "present_result", Never, false, false, false, true, false;
    SiChatDraft => "si_chat_draft", Never, false, false, false, false, false;
    SiChatState => "si_chat_state", Never, false, false, false, false, false;
    SiChatSend => "si_chat_send", Never, false, false, false, false, false;
    SiChatAttach => "si_chat_attach", Never, false, false, false, false, false;
    SiChatImage => "si_chat_image", Never, false, false, false, false, false;
    SiCancel => "si_cancel", Never, false, false, false, true, false;
    JobStart => "job_start", Never, false, false, false, true, false;
    JobStatus => "job_status", Never, false, false, false, true, false;
    JobResult => "job_result", Never, false, false, false, true, false;
    JobCancel => "job_cancel", Never, false, false, false, true, false;
    JobRelease => "job_release", Never, false, false, false, true, false;
    DisplayData => "display_data", Never, false, false, false, true, false;
    SelectionContains => "selection_contains", Never, false, false, false, true, false;
    Revision => "revision", Never, false, false, false, true, true;
    ViewSnapshotV1 => "view_snapshot_v1", Never, false, false, false, false, false;
    Snapshot => "snapshot", Never, false, false, false, true, false;
    Events => "events", Never, false, false, false, true, false;
    AttributeTable => "attribute_table", Never, false, false, false, true, false;
    Query => "query", Never, false, false, false, true, false;
    Aggregate => "aggregate", Never, false, false, false, true, false;
    Statistics => "statistics", Never, false, false, false, true, false;
    AnalyticsDiscover => "analytics_discover", Never, false, false, false, true, true;
    AnalyticsDescribe => "analytics_describe", Never, false, false, false, true, true;
    AnalyticsRun => "analytics_run", Never, false, false, true, true, true;
    AnalyticsResult => "analytics_result", Never, false, false, false, true, true;
    AnalyticsList => "analytics_list", Never, false, false, false, true, true;
    AnalyticsRemove => "analytics_remove", Never, false, false, true, true, true;
    TimeParse => "time_parse", Never, false, false, false, true, false;
    SpaceTimeAggregate => "space_time_aggregate", Never, false, false, false, true, false;
    AggregateApply => "aggregate_apply", Always, false, false, true, true, false;
    DatasetSchema => "dataset_schema", Never, false, false, false, true, false;
    FieldRolesSet => "field_roles_set", Always, true, true, true, true, false;
    PatternScan => "pattern_scan", Never, false, false, false, true, true;
    ChartData => "chart_data", Never, false, false, false, true, true;
    FieldProfile => "field_profile", Never, false, false, false, true, true;
    RenderData => "render_data", Never, false, false, false, true, false;
    RenderGeometries => "render_geometries", Never, false, false, false, true, false;
    FileProbe => "file_probe", Never, false, false, false, true, false;
    GisLayers => "gis_layers", Never, false, false, false, true, false;
    GisLoad => "gis_load", Always, false, false, true, true, false;
    GisSet => "gis_set", Always, true, true, true, true, false;
    GisRemove => "gis_remove", Always, true, true, true, true, false;
    GisRead => "gis_read", Never, false, false, false, true, false;
    GisTable => "gis_table", Never, false, false, false, true, false;
    GisImportPreview => "gis_import_preview", Always, false, false, false, true, false;
    ImportPreview => "import_preview", Always, false, false, false, true, false;
    ImportValidate => "import_validate", Always, false, false, false, true, false;
    ImportReview => "import_review", Never, false, false, false, true, true;
    ImportRejectionsExport => "import_rejections_export", Always, false, false, false, true, false;
    ImportCommit => "import_commit", Always, false, false, true, true, false;
    Filter => "filter", Always, true, false, true, true, false;
    SelectVisible => "select_visible", Always, true, false, true, true, false;
    SelectQuery => "select_query", Always, true, false, true, true, false;
    Select => "select", Always, true, false, true, true, false;
    SelectionPick => "selection_pick", Always, true, false, true, false, false;
    SelectionRestore => "selection_restore", Always, true, false, true, false, false;
    Analyze => "analyze", Never, false, false, false, true, true;
    Coordinates => "coordinates", Never, false, false, false, true, true;
    Edit => "edit", Always, true, true, true, true, false;
    EditMany => "edit_many", Always, true, true, true, true, false;
    Reassign => "reassign", Always, true, true, true, true, false;
    Tag => "tag", Always, true, true, true, true, false;
    Delete => "delete", Always, true, true, true, true, false;
    Undo => "undo", Always, false, false, true, true, false;
    Redo => "redo", Always, false, false, true, true, false;
    SaveView => "save_view", Always, true, true, true, true, false;
    SaveGroup => "save_group", Always, true, true, true, true, false;
    RestoreView => "restore_view", Always, true, false, true, true, false;
    RestoreGroup => "restore_group", Always, true, false, true, true, false;
    Open => "open", Always, false, false, false, true, false;
    Save => "save", Always, false, false, false, true, false;
    Export => "export", Always, false, false, false, true, false;
    TerrainLoad => "terrain_load", Always, false, false, true, true, false;
    TerrainUnload => "terrain_unload", Always, false, false, true, true, false;
    TerrainInfo => "terrain_info", Never, false, false, false, true, true;
    TerrainSample => "terrain_sample", Never, false, false, false, true, true;
    TerrainMesh => "terrain_mesh", Never, false, false, false, true, true;
    WmtsAuthStatus => "wmts_auth_status", Never, false, false, false, true, true;
    WmtsAuthSet => "wmts_auth_set", Always, false, false, false, true, false;
    WmtsAuthRemove => "wmts_auth_remove", Always, false, false, false, true, false;
    WmtsAuthReset => "wmts_auth_reset", Always, false, false, false, true, false;
    WmtsCapabilities => "wmts_capabilities", Never, false, false, false, true, true;
    WmtsPlan => "wmts_plan", Never, false, false, false, true, true;
    WmtsPlanPage => "wmts_plan_page", Never, false, false, false, true, true;
    WmtsServers => "wmts_servers", MapAccess, false, false, false, true, false;
    BasemapResource => "basemap_resource", Never, false, false, false, false, true;
    WmtsAccess => "wmts_access", MapAccess, false, false, false, true, false;
    WmtsCacheClear => "wmts_cache_clear", Always, false, false, false, true, false;
    WmtsRasters => "wmts_rasters", Never, false, false, false, true, true;
    Preferences => "preferences", Preferences, false, false, true, true, false;
    Demo => "demo", Always, false, false, true, false, false;
    DemoCatalog => "demo_catalog", Never, false, false, false, true, false;
    DemoOpen => "demo_open", Always, false, false, true, true, false;
    Capabilities => "capabilities", Never, false, false, false, true, true;
    Diagnostics => "diagnostics", Never, false, false, false, true, false;
    SceneSync => "scene_sync", Always, false, false, true, false, false;
    ViewSet => "view_set", Always, true, false, true, true, false;
    ViewStatus => "view_status", Never, false, false, false, true, false;
    ViewNavigate => "view_navigate", Always, false, false, false, true, false;
    ViewRecording => "view_recording", Never, false, false, false, true, false;
    ViewProfile => "view_profile", Never, false, false, false, true, false;
    ViewWait => "view_wait", Never, false, false, false, true, false;
    ViewPlayback => "view_playback", Never, false, false, false, true, false;
    ViewScenario => "view_scenario", Never, false, false, false, true, false;
    ViewCapture => "view_capture", Never, false, false, false, true, false;
    ViewResponse => "view_response", Never, false, false, false, false, false;
    Batch => "batch", Always, true, true, true, true, false;
}

/// Legacy spellings stay callable, but discovery advertises SI commands only.
pub fn canonical_name(value: &str) -> &str {
    match value {
        "ai_status" => "si_status",
        "ai_configure" => "si_configure",
        "ai_disconnect" => "si_disconnect",
        "ai_run" => "si_run",
        "ai_cancel" => "si_cancel",
        _ => value,
    }
}
