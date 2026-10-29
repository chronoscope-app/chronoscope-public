use crate::{
    analysis::{self, AnalysisResult, Parameters, Pattern},
    import::{self, ImportReport, Mapping, RawImport},
    model::*,
    project::{self, Group, Project, SavedView},
    scene::{self, Scene, ViewMode, ACCENT, MUTED},
};
use eframe::egui::{self, Align2, Color32, RichText, Sense, Stroke, Vec2};
use egui_extras::{Column, TableBuilder};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender},
    time::Instant,
};

#[derive(Clone, Copy, PartialEq)]
enum InspectorTab {
    Inspect,
    Patterns,
    Charts,
    Views,
}
struct ImportWizard {
    raw: RawImport,
    sheet: usize,
    mapping: Mapping,
    append: bool,
}
struct EditDraft {
    id: u64,
    entity: String,
    time: String,
    end: String,
    lat: String,
    lon: String,
    category: String,
    label: String,
    value: String,
    related: String,
    note: String,
    tags: String,
}
impl EditDraft {
    fn from(e: &Event) -> Self {
        Self {
            id: e.id,
            entity: e.entity.clone(),
            time: time_label(e.time),
            end: e.end.map(time_label).unwrap_or_default(),
            lat: e.lat.map(|v| v.to_string()).unwrap_or_default(),
            lon: e.lon.map(|v| v.to_string()).unwrap_or_default(),
            category: e.category.clone(),
            label: e.label.clone(),
            value: e.value.map(|v| v.to_string()).unwrap_or_default(),
            related: e.related_to.clone(),
            note: e.note.clone(),
            tags: e.tags.iter().cloned().collect::<Vec<_>>().join(", "),
        }
    }
    fn apply(&self, e: &Event) -> Result<Event, String> {
        let mut next = e.clone();
        next.entity = self.entity.trim().into();
        next.time = parse_time(&self.time, "", 0)?;
        next.end = if self.end.trim().is_empty() {
            None
        } else {
            Some(parse_time(&self.end, "", 0)?)
        };
        let number = |s: &str| -> Result<Option<f64>, String> {
            if s.trim().is_empty() {
                Ok(None)
            } else {
                s.trim()
                    .parse()
                    .map(Some)
                    .map_err(|_| format!("Invalid number: {s}"))
            }
        };
        next.lat = number(&self.lat)?;
        next.lon = number(&self.lon)?;
        next.value = number(&self.value)?;
        next.category = self.category.clone();
        next.label = self.label.clone();
        next.related_to = self.related.clone();
        next.note = self.note.clone();
        next.tags = self
            .tags
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
        next.validate()?;
        Ok(next)
    }
}
enum WorkerResult {
    Raw(Result<RawImport, String>),
    Converted(Result<ImportReport, String>, bool, String),
    Analysis(AnalysisResult, u64),
}
#[derive(Clone, Copy, PartialEq)]
enum FileAction {
    Import,
    Open,
    Save,
    Export,
    Snapshot,
}
pub struct Chronoscope {
    pub project: Project,
    scene: Scene,
    visible: Vec<usize>,
    last_filter: Filter,
    last_selected: BTreeSet<u64>,
    dirty: bool,
    revision: u64,
    mode: ViewMode,
    tab: InspectorTab,
    show_table: bool,
    split_map: bool,
    map_camera: project::Camera,
    exact_start: String,
    exact_end: String,
    table_sort: usize,
    table_desc: bool,
    entity_search: String,
    tx: Sender<WorkerResult>,
    rx: Receiver<WorkerResult>,
    busy: bool,
    wizard: Option<ImportWizard>,
    import_report: Option<(ImportReport, bool, String)>,
    status: String,
    error: Option<String>,
    file_action: Option<FileAction>,
    file_path: String,
    delimiter: u8,
    project_path: Option<PathBuf>,
    unsaved: bool,
    undo: Vec<Project>,
    redo: Vec<Project>,
    draft: Option<EditDraft>,
    group_name: String,
    rename_entity: String,
    tag_name: String,
    confirm_close: bool,
    close_allowed: bool,
    just_opened: bool,
    pattern: Pattern,
    params: Parameters,
    analysis_selected: bool,
    results: AnalysisResult,
    analysis_revision: u64,
    view_name: String,
    link_depth: usize,
    path_from: String,
    path_to: String,
    time_start: f64,
    time_end: f64,
    focus: f64,
    playing: bool,
    play_speed: f64,
    last_tick: Instant,
    geo_enabled: bool,
    geo_south: f64,
    geo_north: f64,
    geo_west: f64,
    geo_east: f64,
    chart_group_entity: bool,
    predicate_field: String,
    predicate_op: Operator,
    predicate_value: String,
    snapshot_path: Option<PathBuf>,
    capture_after: Option<(u32, PathBuf)>,
    frame_count: u32,
}
impl Chronoscope {
    pub fn new(cc: &eframe::CreationContext<'_>, initial: Option<PathBuf>) -> Self {
        let mut style = (*cc.egui_ctx.style()).clone();
        style.visuals = egui::Visuals::dark();
        style.visuals.panel_fill = Color32::from_rgb(20, 29, 41);
        style.visuals.window_fill = Color32::from_rgb(24, 35, 48);
        style.visuals.extreme_bg_color = Color32::from_rgb(12, 21, 31);
        style.visuals.faint_bg_color = Color32::from_rgb(26, 39, 53);
        style.visuals.override_text_color = Some(Color32::from_rgb(216, 226, 237));
        style.visuals.selection.bg_fill = Color32::from_rgb(36, 91, 89);
        style.visuals.selection.stroke = Stroke::new(1_f32, ACCENT);
        style.spacing.item_spacing = Vec2::new(8., 8.);
        style.spacing.button_padding = Vec2::new(11., 7.);
        style.spacing.interact_size = Vec2::new(40., 28.);
        cc.egui_ctx.set_style(style);
        let project = Project::empty();
        let scene = Scene::new(&project.dataset);
        let (tx, rx) = mpsc::channel();
        let mut app = Self {
            project,
            scene,
            visible: Vec::new(),
            last_filter: Filter::default(),
            last_selected: BTreeSet::new(),
            dirty: true,
            revision: 0,
            mode: ViewMode::SpaceTime,
            tab: InspectorTab::Inspect,
            show_table: true,
            split_map: false,
            map_camera: project::Camera::default(),
            exact_start: String::new(),
            exact_end: String::new(),
            table_sort: 0,
            table_desc: false,
            entity_search: String::new(),
            tx,
            rx,
            busy: false,
            wizard: None,
            import_report: None,
            status: "Synthetic demo loaded · all processing stays on this device".into(),
            error: None,
            file_action: None,
            file_path: String::new(),
            delimiter: b',',
            project_path: None,
            unsaved: false,
            undo: Vec::new(),
            redo: Vec::new(),
            draft: None,
            group_name: String::new(),
            rename_entity: String::new(),
            tag_name: String::new(),
            confirm_close: false,
            close_allowed: false,
            just_opened: false,
            pattern: Pattern::Proximity,
            params: Parameters::default(),
            analysis_selected: false,
            results: AnalysisResult::default(),
            analysis_revision: 0,
            view_name: String::new(),
            link_depth: 1,
            path_from: String::new(),
            path_to: String::new(),
            time_start: 0.,
            time_end: 1.,
            focus: 0.4,
            playing: false,
            play_speed: 0.06,
            last_tick: Instant::now(),
            geo_enabled: false,
            geo_south: -90.,
            geo_north: 90.,
            geo_west: -180.,
            geo_east: 180.,
            chart_group_entity: true,
            predicate_field: "category".into(),
            predicate_op: Operator::Contains,
            predicate_value: String::new(),
            snapshot_path: None,
            capture_after: std::env::var_os("CHRONOSCOPE_CAPTURE").map(|p| (8, PathBuf::from(p))),
            frame_count: 0,
        };
        if let Some(path) = initial {
            if path.to_string_lossy().ends_with(".json") {
                app.open_project(path);
            } else {
                app.read_import(path);
            }
        }
        app.refresh();
        app
    }
    fn checkpoint(&mut self) {
        // Bound history by event count as well as operation count.
        let cap = (1_000_000 / self.project.dataset.events.len().max(1)).clamp(1, 20);
        self.undo.push(self.project.clone());
        if self.undo.len() > cap {
            self.undo.remove(0);
        }
        self.redo.clear();
    }
    fn changed(&mut self) {
        self.dirty = true;
        self.unsaved = true;
        self.revision += 1;
        self.draft = None;
    }
    fn select(&mut self, ids: Vec<u64>, additive: bool) {
        if !additive {
            self.project.selected.clear();
        }
        for id in ids.into_iter().collect::<BTreeSet<_>>() {
            if additive && !self.project.selected.insert(id) {
                self.project.selected.remove(&id);
            } else {
                self.project.selected.insert(id);
            }
        }
        self.draft = None;
    }
    fn refresh(&mut self) {
        if self.dirty
            || self.last_filter != self.project.filter
            || self.last_selected != self.project.selected
        {
            self.visible = self
                .project
                .dataset
                .events
                .iter()
                .enumerate()
                .filter(|(_, e)| self.project.filter.matches(e, &self.project.selected))
                .map(|(i, _)| i)
                .collect();
            self.sort_visible();
            self.last_filter = self.project.filter.clone();
            self.last_selected = self.project.selected.clone();
            self.dirty = false;
        }
    }
    fn sort_visible(&mut self) {
        let data = &self.project.dataset.events;
        let sort = self.table_sort;
        self.visible.sort_by(|&a, &b| {
            let (a, b) = (&data[a], &data[b]);
            let ord = match sort {
                1 => a.entity.cmp(&b.entity),
                2 => a.category.cmp(&b.category),
                3 => a.label.cmp(&b.label),
                4 => a
                    .value
                    .unwrap_or(f64::NEG_INFINITY)
                    .total_cmp(&b.value.unwrap_or(f64::NEG_INFINITY)),
                _ => a.time.total_cmp(&b.time),
            };
            let ord = ord.then(a.id.cmp(&b.id));
            if self.table_desc {
                ord.reverse()
            } else {
                ord
            }
        });
    }
    fn read_import(&mut self, path: PathBuf) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.status = "Reading data…".into();
        let tx = self.tx.clone();
        let delimiter = if path.extension().is_some_and(|e| e == "tsv") {
            b'\t'
        } else {
            self.delimiter
        };
        std::thread::spawn(move || {
            let _ = tx.send(WorkerResult::Raw(import::read_file(&path, delimiter)));
        });
    }
    fn open_project(&mut self, path: PathBuf) {
        match project::load(&path) {
            Ok(p) => {
                self.project = p;
                self.project_path = Some(path);
                self.mode = self.project.mode;
                self.scene.frame = scene::GeoFrame::fit(self.project.dataset.events.iter());
                self.sync_controls();
                self.undo.clear();
                self.redo.clear();
                self.changed();
                self.unsaved = false;
                self.status = "Project opened".into();
                self.just_opened = true;
            }
            Err(e) => self.error = Some(e),
        }
    }
    fn sync_controls(&mut self) {
        self.exact_start = self
            .project
            .filter
            .start
            .map(time_label)
            .unwrap_or_default();
        self.exact_end = self.project.filter.end.map(time_label).unwrap_or_default();
        let (lo, hi) = self.project.dataset.time_bounds();
        let span = (hi - lo) as f64;
        self.time_start = self
            .project
            .filter
            .start
            .map(|t| (t - lo) as f64 / span)
            .unwrap_or(0.)
            .clamp(0., 1.);
        self.time_end = self
            .project
            .filter
            .end
            .map(|t| (t - lo) as f64 / span)
            .unwrap_or(1.)
            .clamp(0., 1.);
        self.geo_enabled = self.project.filter.bounds.is_some();
        if let Some(b) = &self.project.filter.bounds {
            self.geo_south = b.south;
            self.geo_north = b.north;
            self.geo_west = b.west;
            self.geo_east = b.east;
        }
        self.draft = None;
    }
    fn accept_import(&mut self, mut report: ImportReport, append: bool, name: String) {
        if report.events.is_empty() {
            self.error = Some("No valid rows to import".into());
            return;
        }
        if append && self.project.dataset.events.len() + report.events.len() > MAX_EVENTS {
            self.error = Some(format!("Merged data would exceed {MAX_EVENTS} events"));
            return;
        }
        if append {
            let max_id = self
                .project
                .dataset
                .events
                .iter()
                .map(|e| e.id)
                .max()
                .unwrap_or(0);
            if max_id.checked_add(report.events.len() as u64).is_none() {
                self.error = Some("Event ID capacity exhausted".into());
                return;
            }
            for (i, e) in report.events.iter_mut().enumerate() {
                e.id = max_id + i as u64 + 1;
            }
        }
        self.checkpoint();
        let count = report.events.len();
        let rejected = report.rejected_count;
        if append {
            self.project.dataset.events.extend(report.events);
        } else {
            self.project = Project::new(Dataset {
                events: report.events,
                name,
            });
            self.project_path = None;
        }
        self.scene.frame = scene::GeoFrame::fit(self.project.dataset.events.iter());
        self.project.filter = Filter::default();
        self.project.selected.clear();
        self.sync_controls();
        self.changed();
        self.results = AnalysisResult::default();
        self.status = format!("Imported {count} events · {rejected} rejected rows");
    }
    fn poll(&mut self) {
        while let Ok(message) = self.rx.try_recv() {
            self.busy = false;
            match message {
                WorkerResult::Raw(result) => match result {
                    Ok(raw) => {
                        let mapping = Mapping::guess(&raw.tables[0].headers);
                        self.wizard = Some(ImportWizard {
                            raw,
                            sheet: 0,
                            mapping,
                            append: false,
                        });
                        self.status = "Review column mapping before import".into();
                    }
                    Err(e) => self.error = Some(e),
                },
                WorkerResult::Converted(result, append, name) => match result {
                    Ok(report) => {
                        self.wizard = None;
                        if report.rejected_count > 0 {
                            self.import_report = Some((report, append, name));
                        } else {
                            self.accept_import(report, append, name);
                        }
                    }
                    Err(e) => self.error = Some(e),
                },
                WorkerResult::Analysis(result, revision) => {
                    self.analysis_revision = revision;
                    self.results = result;
                    self.status = format!(
                        "Found {} patterns{}",
                        self.results.findings.len(),
                        if self.results.limited {
                            " · computation limit reached"
                        } else {
                            ""
                        }
                    );
                }
            }
        }
    }
    fn dialog(&mut self, action: FileAction) {
        if self.busy {
            return;
        }
        let path = match action {
            FileAction::Import => rfd::FileDialog::new()
                .add_filter("Tabular data", &["csv", "tsv", "xlsx", "xls", "xlsb"])
                .pick_file(),
            FileAction::Open => rfd::FileDialog::new()
                .add_filter("Chronoscope project", &["json"])
                .pick_file(),
            FileAction::Save => rfd::FileDialog::new()
                .set_file_name("study.chrono.json")
                .add_filter("Chronoscope project", &["json"])
                .save_file(),
            FileAction::Export => rfd::FileDialog::new()
                .set_file_name("events.csv")
                .add_filter("CSV", &["csv"])
                .save_file(),
            FileAction::Snapshot => rfd::FileDialog::new()
                .set_file_name("chronoscope.png")
                .add_filter("PNG", &["png"])
                .save_file(),
        };
        if let Some(p) = path {
            self.perform_file(action, p);
        } else {
            self.file_action = Some(action);
        }
    }
    fn perform_file(&mut self, action: FileAction, path: PathBuf) {
        if self.busy {
            self.status = "Wait for the current operation to finish".into();
            return;
        }
        self.project.mode = self.mode;
        match action {
            FileAction::Import => self.read_import(path),
            FileAction::Open => self.open_project(path),
            FileAction::Save => match project::save(&path, &self.project) {
                Ok(()) => {
                    self.project_path = Some(path);
                    self.unsaved = false;
                    self.status = "Project saved".into();
                }
                Err(e) => self.error = Some(e),
            },
            FileAction::Export => {
                let use_selection = !self.project.selected.is_empty();
                let events = self
                    .visible
                    .iter()
                    .map(|&i| &self.project.dataset.events[i])
                    .filter(|e| !use_selection || self.project.selected.contains(&e.id))
                    .cloned();
                match project::export_csv(&path, events) {
                    Ok(n) => {
                        self.status = format!(
                            "Exported {n} {}events",
                            if use_selection {
                                "selected visible "
                            } else {
                                "visible "
                            }
                        )
                    }
                    Err(e) => self.error = Some(e),
                }
            }
            FileAction::Snapshot => {
                self.snapshot_path = Some(path);
            }
        }
    }
    fn header(&mut self, ctx: &egui::Context) {
        let panel = egui::TopBottomPanel::top("header").exact_height(54.);
        panel.show(ctx,|ui|{
            ui.add_space(8.);
            ui.horizontal(|ui|{
                ui.add_space(10.);
                let(r,_)=ui.allocate_exact_size(Vec2::new(34.,34.),Sense::hover());
                let p=ui.painter();
                p.circle_stroke(r.center(),13.,Stroke::new(2_f32,ACCENT));
                p.line_segment([r.center()-Vec2::new(0.,8.),r.center()+Vec2::new(0.,8.)],Stroke::new(2_f32,ACCENT));
                p.line_segment([r.center()-Vec2::new(8.,0.),r.center()+Vec2::new(8.,0.)],Stroke::new(2_f32,ACCENT));

                ui.vertical(|ui|{
                    ui.label(RichText::new("CHRONOSCOPE").size(19.).strong());
                }
                );
                ui.add_space(20.);

                if ui.add(egui::Button::new(RichText::new("+  Import data").color(Color32::from_rgb(10,30,30))).fill(ACCENT)).clicked(){self.dialog(FileAction::Import);}
                if ui.button("Open project").clicked(){self.dialog(FileAction::Open);}
                if ui.button(if self.unsaved{
                    "Save *"}
                else{
                    "Save"}
                ).clicked(){
                    if let Some(p)=self.project_path.clone(){
                        self.perform_file(FileAction::Save,p);
                    }
                    else{
                        self.dialog(FileAction::Save);
                    }
                }

                if ui.button("Export CSV").on_hover_text("Exports selected visible events, or all visible events when nothing is selected").clicked(){
                    self.dialog(FileAction::Export);
                }

                if ui.button("Snapshot").clicked(){self.dialog(FileAction::Snapshot);}
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center),|ui|{
                    if self.busy{
                        ui.spinner();
                    }
                    if ui.small_button("File path…").on_hover_text("Use a path without a native file dialog").clicked(){
                        self.file_action=Some(FileAction::Import);
                    }
                }
                );

            });
        });
    }
    fn sidebar(&mut self, ctx: &egui::Context) {
        let panel = egui::SidePanel::left("filters")
            .resizable(true)
            .default_width(240.)
            .width_range(215. ..=340.);
        panel.show(ctx,|ui|{
            egui::ScrollArea::vertical().show(ui,|ui|{
                ui.add_space(12.);
                ui.label(RichText::new("DATA EXPLORER").size(11.).strong().color(MUTED));
                ui.add_space(8.);
                ui.label(RichText::new(&self.project.dataset.name).strong().size(14.));
                ui.add_space(6.);

                ui.horizontal(|ui|{
                    stat(ui,&self.project.dataset.events.len().to_string(),"events");
                    ui.add_space(14.);
                    stat(ui,&self.project.dataset.entities().len().to_string(),"entities");
                }
                );
                ui.separator();

                ui.add(egui::TextEdit::singleline(&mut self.project.filter.search).hint_text("Search all fields…").desired_width(f32::INFINITY));
                ui.horizontal(|ui|{
                    ui.label(RichText::new("FILTERS").size(11.).color(MUTED));
                    if ui.small_button("Reset").clicked(){
                        self.project.filter=Filter::default();
                        self.sync_controls();
                    }
                }
                );

                ui.checkbox(&mut self.project.filter.selected_only,"Selection only");ui.checkbox(&mut self.project.filter.located_only,"Located events only");
                egui::CollapsingHeader::new("Entities").default_open(true).show(ui,|ui|{
                    ui.add(egui::TextEdit::singleline(&mut self.entity_search).hint_text("Find entity…").desired_width(f32::INFINITY));
                    ui.horizontal(|ui|{if ui.small_button("All").clicked(){self.project.filter.hidden_entities.clear();}
                        if ui.small_button("None").clicked(){self.project.filter.hidden_entities=self.project.dataset.entities();}});
                    let mut counts:BTreeMap<&str,usize>=BTreeMap::new();for e in &self.project.dataset.events{*counts.entry(&e.entity).or_default()+=1;}
                    egui::ScrollArea::vertical().id_salt("entities").max_height(190.).show(ui,|ui|{
                        for(entity,count)in counts{
                            if !entity.to_lowercase().contains(&self.entity_search.to_lowercase()){
                                continue;
                            }

                            let mut shown=!self.project.filter.hidden_entities.contains(entity);
                            ui.horizontal(|ui|{
                                let(r,_)=ui.allocate_exact_size(Vec2::splat(8.),Sense::hover());
                                ui.painter().circle_filled(r.center(),3.,scene::entity_color(entity));
                                if ui.checkbox(&mut shown,format!("{entity}  ·  {count}")).changed(){
                                    if shown{
                                        self.project.filter.hidden_entities.remove(entity);
                                    }
                                    else{
                                        self.project.filter.hidden_entities.insert(entity.into());
                                    }
                                }

                                if ui.small_button("select").clicked(){self.project.selected=self.project.dataset.events.iter().filter(|e|e.entity==entity).map(|e|e.id).collect();self.draft=None;}});
                    }});
                });
                egui::CollapsingHeader::new("Categories").default_open(true).show(ui,|ui|{
                    for category in self.project.dataset.categories(){
                        let mut shown=!self.project.filter.hidden_categories.contains(&category);
                        if ui.checkbox(&mut shown,if category.is_empty(){
                            "(uncategorized)"}
                        else{
                            &category}
                        ).changed(){
                            if shown{
                                self.project.filter.hidden_categories.remove(&category);
                            }
                            else{
                                self.project.filter.hidden_categories.insert(category);
                            }
                        }
                    }
                }
                );

                egui::CollapsingHeader::new("Exact time range").show(ui,|ui| {
                    ui.label(RichText::new("UTC / ISO 8601 · blank means unbounded").small().color(MUTED));
                    ui.add(egui::TextEdit::singleline(&mut self.exact_start).hint_text("Start timestamp"));
                    ui.add(egui::TextEdit::singleline(&mut self.exact_end).hint_text("End timestamp"));
                    if ui.button("Apply time range").clicked() {
                        let parse=|s:&str| -> Result<Option<f64>,String> {if s.trim().is_empty(){Ok(None)}else{parse_time(s,"",0).map(Some)}};
                        match parse(&self.exact_start).and_then(|a|parse(&self.exact_end).map(|b|(a,b))) {
                            Ok((a,b)) if !a.zip(b).is_some_and(|(a,b)|a>b) => {self.project.filter.start=a;self.project.filter.end=b;self.playing=false;self.sync_controls();}
                            Ok(_)=>self.error=Some("Start must be at or before end".into()),Err(e)=>self.error=Some(e),
                        }
                    }
                });
                egui::CollapsingHeader::new("Attribute rules (AND)").show(ui,|ui|{
                    ui.label(RichText::new("Field name").small().color(MUTED));ui.text_edit_singleline(&mut self.predicate_field);
                    egui::ComboBox::from_id_salt("operator").selected_text(format!("{:?}",self.predicate_op)).show_ui(ui,|ui|{
                        for op in [Operator::Contains,Operator::Equals,Operator::NotEquals,Operator::Greater,Operator::Less,Operator::IsEmpty]{
                            ui.selectable_value(&mut self.predicate_op,op.clone(),format!("{op:?}"));
                        }
                    }
                    );

                    ui.add(egui::TextEdit::singleline(&mut self.predicate_value).hint_text("Match value"));
                    if ui.add_enabled(self.project.filter.predicates.len()<128,egui::Button::new("Add rule")).clicked(){
                        self.project.filter.predicates.push(Predicate{
                            field:self.predicate_field.clone(),op:self.predicate_op.clone(),value:self.predicate_value.clone()}
                        );
                    }

                    let mut remove=None;
                    for(i,p)in self.project.filter.predicates.iter().enumerate(){
                        ui.horizontal_wrapped(|ui|{
                            ui.label(format!("{} {:?} {}",p.field,p.op,p.value));
                            if ui.small_button("x").clicked(){
                                remove=Some(i);
                            }
                        }
                        );
                    }
                    if let Some(i)=remove{
                        self.project.filter.predicates.remove(i);
                    }

                });
                egui::CollapsingHeader::new("Geographic region").show(ui,|ui|{
                    ui.label(RichText::new("WGS84 bounds · west > east crosses the dateline").small().color(MUTED));ui.checkbox(&mut self.geo_enabled,"Enable region filter");
                    egui::Grid::new("geo_bounds").num_columns(2).show(ui,|ui|{
                        for(label,v,lo,hi)in[("South",&mut self.geo_south,-90.,90.),("North",&mut self.geo_north,-90.,90.),("West",&mut self.geo_west,-180.,180.),("East",&mut self.geo_east,-180.,180.)]{
                            ui.label(label);
                            ui.add(egui::DragValue::new(v).speed(0.001).range(lo..=hi));
                            ui.end_row();
                        }
                    }
                    );

                    if self.geo_enabled&&self.geo_south<=self.geo_north{
                        self.project.filter.bounds=Some(GeoBounds{
                            south:self.geo_south,north:self.geo_north,west:self.geo_west,east:self.geo_east}
                        );
                    }
                    else{
                        self.project.filter.bounds=None;
                    }

                });
                ui.separator();ui.label(RichText::new("SELECTION").size(11.).color(MUTED));ui.label(format!("{} events selected",self.project.selected.len()));
                ui.horizontal(|ui|{
                    if ui.small_button("All visible").clicked(){
                        self.project.selected=self.visible.iter().map(|&i|self.project.dataset.events[i].id).collect();
                        self.draft=None;
                    }

                    if ui.small_button("Clear").clicked(){self.project.selected.clear();self.draft=None;}
                    if ui.small_button("Invert").clicked(){
                        let ids=self.visible.iter().map(|&i|self.project.dataset.events[i].id).filter(|id|!self.project.selected.contains(id)).collect();
                        self.project.selected=ids;
                        self.draft=None;
                    }
                }
                );

                ui.add_space(10.);ui.label(RichText::new("Offline reference map: Natural Earth\nCoordinates and analysis use WGS84\nTimes displayed in UTC").small().color(MUTED));
            });
        });
    }
    fn inspector(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("inspector")
            .resizable(true)
            .default_width(285.)
            .width_range(250. ..=420.)
            .show(ctx, |ui| {
                ui.add_space(10.);
                ui.horizontal(|ui| {
                    for (tab, name) in [
                        (InspectorTab::Inspect, "Inspect"),
                        (InspectorTab::Patterns, "Patterns"),
                        (InspectorTab::Charts, "Charts"),
                        (InspectorTab::Views, "Views"),
                    ] {
                        ui.selectable_value(&mut self.tab, tab, name);
                    }
                });
                ui.separator();
                egui::ScrollArea::vertical()
                    .id_salt("inspector_scroll")
                    .show(ui, |ui| match self.tab {
                        InspectorTab::Inspect => self.inspect_tab(ui),
                        InspectorTab::Patterns => self.patterns_tab(ui),
                        InspectorTab::Charts => self.charts_tab(ui),
                        InspectorTab::Views => self.views_tab(ui),
                    });
            });
    }
    fn inspect_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if ui
                .add_enabled(!self.busy, egui::Button::new("+ Add event"))
                .clicked()
            {
                if self.project.dataset.events.len() >= MAX_EVENTS {
                    self.error = Some("Event limit reached".into());
                } else if let Some(id) = self
                    .project
                    .dataset
                    .events
                    .iter()
                    .map(|e| e.id)
                    .max()
                    .unwrap_or(0)
                    .checked_add(1)
                {
                    self.checkpoint();
                    let (lo, hi) = self.project.dataset.time_bounds();
                    self.project.dataset.events.push(Event {
                        altitude: None,
                        location_kind: None,
                        geometry_wkt: None,
                        mgrs_precision: None,
                        id,
                        entity: "New entity".into(),
                        time: lo + ((hi - lo) * self.focus),
                        end: None,
                        lat: None,
                        lon: None,
                        category: String::new(),
                        label: "New event".into(),
                        value: None,
                        related_to: String::new(),
                        attrs: BTreeMap::new(),
                        tags: BTreeSet::new(),
                        note: String::new(),
                        source: "Manually entered".into(),
                        source_row: 0,
                    });
                    self.project.selected = BTreeSet::from([id]);
                    self.changed();
                } else {
                    self.error = Some("Event ID capacity exhausted".into());
                }
            }
            if ui
                .add_enabled(
                    !self.busy && !self.project.selected.is_empty(),
                    egui::Button::new("Remove selected"),
                )
                .on_hover_text("Removes selected events; Undo restores them")
                .clicked()
            {
                self.checkpoint();
                let removed = self.project.selected.clone();
                self.project
                    .dataset
                    .events
                    .retain(|e| !removed.contains(&e.id));
                for g in &mut self.project.groups {
                    g.ids.retain(|id| !removed.contains(id));
                }
                for v in &mut self.project.views {
                    v.selected.retain(|id| !removed.contains(id));
                }
                self.project.selected.clear();
                self.changed();
                self.status = "Selected events removed · Undo is available".into();
            }
        });
        if self.project.selected.is_empty() {
            ui.add_space(12.);
            ui.label(RichText::new("No event selected").size(14.).strong());
            ui.label(RichText::new("Select an event in the scene, timeline, or table to inspect its source values and edit it.").color(MUTED));
            ui.add_space(12.);
            ui.label("Click an event to select it.\nShift-click to add or remove.\nUse Box select for an area.");
        } else {
            ui.label(
                RichText::new(format!("{} selected events", self.project.selected.len()))
                    .size(17.)
                    .strong(),
            );
            if self.project.selected.len() == 1 {
                let id = *self.project.selected.first().unwrap();
                if let Some(index) = self.project.dataset.events.iter().position(|e| e.id == id) {
                    if self.draft.as_ref().is_none_or(|d| d.id != id) {
                        self.draft = Some(EditDraft::from(&self.project.dataset.events[index]));
                    }
                    let e = &self.project.dataset.events[index];
                    ui.label(
                        RichText::new(format!("{} · row {}", e.source, e.source_row))
                            .small()
                            .color(MUTED),
                    );
                    let mut apply = false;
                    let mut revert = false;
                    if let Some(d) = &mut self.draft {
                        for (label, value) in [
                            ("Entity", &mut d.entity),
                            ("Timestamp (UTC)", &mut d.time),
                            ("End time (optional)", &mut d.end),
                            ("Latitude", &mut d.lat),
                            ("Longitude", &mut d.lon),
                            ("Category", &mut d.category),
                            ("Label", &mut d.label),
                            ("Numeric value", &mut d.value),
                            ("Related entity", &mut d.related),
                            ("Tags (comma separated)", &mut d.tags),
                        ] {
                            ui.label(RichText::new(label).small().color(MUTED));
                            ui.add(egui::TextEdit::singleline(value).desired_width(f32::INFINITY));
                        }
                        ui.label(RichText::new("Analyst note").small().color(MUTED));
                        ui.add(
                            egui::TextEdit::multiline(&mut d.note)
                                .desired_rows(3)
                                .desired_width(f32::INFINITY),
                        );
                        ui.horizontal(|ui| {
                            apply = ui.button("Apply changes").clicked();
                            revert = ui.button("Revert").clicked();
                        });
                    }
                    if apply {
                        match self
                            .draft
                            .as_ref()
                            .unwrap()
                            .apply(&self.project.dataset.events[index])
                        {
                            Ok(e) => {
                                self.checkpoint();
                                self.project.dataset.events[index] = e;
                                self.changed();
                                self.status =
                                    "Event updated · original import attributes retained".into();
                            }
                            Err(e) => self.error = Some(e),
                        }
                    }
                    if revert {
                        self.draft = None;
                    }
                    egui::CollapsingHeader::new("Original source attributes").show(ui, |ui| {
                        for (k, v) in &self.project.dataset.events[index].attrs {
                            ui.label(RichText::new(k).small().color(MUTED));
                            ui.label(v);
                        }
                    });
                }
            }
            ui.separator();
            ui.add(
                egui::TextEdit::singleline(&mut self.tag_name).hint_text("Tag for selected events"),
            );
            ui.horizontal(|ui| {
                for (add, label) in [(true, "Add tag"), (false, "Remove tag")] {
                    if ui
                        .add_enabled(!self.tag_name.trim().is_empty(), egui::Button::new(label))
                        .clicked()
                    {
                        self.checkpoint();
                        for e in &mut self.project.dataset.events {
                            if self.project.selected.contains(&e.id) {
                                if add {
                                    e.tags.insert(self.tag_name.trim().into());
                                } else {
                                    e.tags.remove(self.tag_name.trim());
                                }
                            }
                        }
                        self.changed();
                    }
                }
            });
            ui.separator();
            ui.label(RichText::new("GROUP / REASSIGN").size(11.).color(MUTED));
            ui.add(
                egui::TextEdit::singleline(&mut self.group_name).hint_text("Selection group name"),
            );
            if ui
                .add_enabled(
                    !self.group_name.trim().is_empty() && self.project.groups.len() < 500,
                    egui::Button::new("Save selection group"),
                )
                .clicked()
            {
                self.checkpoint();
                self.project.groups.push(Group {
                    name: self.group_name.trim().into(),
                    ids: self.project.selected.clone(),
                });
                self.group_name.clear();
                self.changed();
            }
            ui.add(
                egui::TextEdit::singleline(&mut self.rename_entity)
                    .hint_text("Entity name for selected events"),
            );
            if ui
                .add_enabled(
                    !self.rename_entity.trim().is_empty(),
                    egui::Button::new("Merge / split into entity"),
                )
                .on_hover_text(
                    "Reassigns selected events to this entity; other events retain their entity",
                )
                .clicked()
            {
                self.checkpoint();
                for e in &mut self.project.dataset.events {
                    if self.project.selected.contains(&e.id) {
                        e.entity = self.rename_entity.trim().into();
                    }
                }
                self.changed();
                self.status = "Selected events reassigned".into();
            }
        }
        ui.separator();
        ui.label(RichText::new("LINK EXPLORATION").size(11.).color(MUTED));
        ui.horizontal(|ui| {
            ui.label("Depth");
            ui.add(egui::DragValue::new(&mut self.link_depth).range(1..=20));
        });
        if ui
            .add_enabled(
                !self.project.selected.is_empty(),
                egui::Button::new("Expand connected entities"),
            )
            .clicked()
        {
            let events: Vec<_> = self
                .visible
                .iter()
                .map(|&i| self.project.dataset.events[i].clone())
                .collect();
            let seeds = events
                .iter()
                .filter(|e| self.project.selected.contains(&e.id))
                .map(|e| e.entity.clone())
                .collect();
            self.project.selected = analysis::expand_links(&events, &seeds, self.link_depth);
            self.draft = None;
        }
        ui.add(egui::TextEdit::singleline(&mut self.path_from).hint_text("From entity"));
        ui.add(egui::TextEdit::singleline(&mut self.path_to).hint_text("To entity"));
        if ui.button("Select shortest connection path").clicked() {
            let events: Vec<_> = self
                .visible
                .iter()
                .map(|&i| self.project.dataset.events[i].clone())
                .collect();
            self.project.selected =
                analysis::connecting_path(&events, &self.path_from, &self.path_to);
            self.draft = None;
            self.status = if self.project.selected.is_empty() {
                "No connection path in visible data"
            } else {
                "Connection path selected"
            }
            .into();
        }
        ui.separator();
        ui.horizontal(|ui| {
            if ui
                .add_enabled(!self.undo.is_empty(), egui::Button::new("Undo"))
                .clicked()
            {
                self.undo();
            }
            if ui
                .add_enabled(!self.redo.is_empty(), egui::Button::new("Redo"))
                .clicked()
            {
                self.redo();
            }
        });
    }
    fn undo(&mut self) {
        if let Some(p) = self.undo.pop() {
            self.redo.push(self.project.clone());
            self.project = p;
            self.mode = self.project.mode;
            self.scene.frame = scene::GeoFrame::fit(self.project.dataset.events.iter());
            self.sync_controls();
            self.changed();
            self.status = "Undo applied".into();
        }
    }
    fn redo(&mut self) {
        if let Some(p) = self.redo.pop() {
            self.undo.push(self.project.clone());
            self.project = p;
            self.mode = self.project.mode;
            self.scene.frame = scene::GeoFrame::fit(self.project.dataset.events.iter());
            self.sync_controls();
            self.changed();
            self.status = "Redo applied".into();
        }
    }
    fn patterns_tab(&mut self, ui: &mut egui::Ui) {
        ui.label(RichText::new("Pattern analysis").size(18.).strong());
        ui.label(RichText::new("Analysis uses visible events. Select a finding to highlight its evidence in every view.").color(MUTED));
        ui.add_space(8.);
        egui::ComboBox::from_id_salt("pattern")
            .width(220.)
            .selected_text(self.pattern.title())
            .show_ui(ui, |ui| {
                for p in [
                    Pattern::Proximity,
                    Pattern::Stationary,
                    Pattern::Gaps,
                    Pattern::Speed,
                    Pattern::Clusters,
                ] {
                    ui.selectable_value(&mut self.pattern, p, p.title());
                }
            });
        ui.checkbox(
            &mut self.analysis_selected,
            "Analyze selected visible events only",
        );
        if matches!(
            self.pattern,
            Pattern::Proximity | Pattern::Stationary | Pattern::Clusters
        ) {
            ui.horizontal(|ui| {
                ui.label("Radius (m)");
                ui.add(
                    egui::DragValue::new(&mut self.params.radius_m)
                        .range(1. ..=1_000_000.)
                        .speed(5.),
                );
            });
        }
        if matches!(self.pattern, Pattern::Proximity | Pattern::Clusters) {
            ui.horizontal(|ui| {
                ui.label("Time tolerance (s)");
                ui.add(
                    egui::DragValue::new(&mut self.params.tolerance_s)
                        .range(0..=86400)
                        .speed(30.),
                );
            });
        }
        if self.pattern == Pattern::Stationary {
            ui.horizontal(|ui| {
                ui.label("Minimum duration (s)");
                ui.add(
                    egui::DragValue::new(&mut self.params.duration_s)
                        .range(1..=604800)
                        .speed(60.),
                );
            });
        }
        if matches!(self.pattern, Pattern::Gaps | Pattern::Stationary) {
            ui.horizontal(|ui| {
                ui.label(if self.pattern == Pattern::Gaps {
                    "Minimum gap (s)"
                } else {
                    "Max sample gap (s)"
                });
                ui.add(
                    egui::DragValue::new(&mut self.params.gap_s)
                        .range(1..=604800)
                        .speed(60.),
                );
            });
        }
        if self.pattern == Pattern::Speed {
            ui.horizontal(|ui| {
                ui.label("Threshold (km/h)");
                ui.add(
                    egui::DragValue::new(&mut self.params.speed_kmh)
                        .range(0.1..=10000.)
                        .speed(1.),
                );
            });
        }
        if self.pattern == Pattern::Clusters {
            ui.horizontal(|ui| {
                ui.label("Minimum events");
                ui.add(egui::DragValue::new(&mut self.params.min_cluster).range(2..=10000));
            });
        }
        if ui
            .add_enabled(
                !self.busy,
                egui::Button::new("Run analysis").fill(Color32::from_rgb(36, 91, 89)),
            )
            .clicked()
        {
            let events = self
                .visible
                .iter()
                .map(|&i| &self.project.dataset.events[i])
                .filter(|e| !self.analysis_selected || self.project.selected.contains(&e.id))
                .cloned()
                .collect::<Vec<_>>();
            let tx = self.tx.clone();
            let pattern = self.pattern;
            let params = self.params.clone();
            let revision = self.revision;
            self.busy = true;
            self.status = "Analyzing events…".into();
            std::thread::spawn(move || {
                let result = analysis::run(&events, pattern, &params);
                let _ = tx.send(WorkerResult::Analysis(result, revision));
            });
        }
        ui.add_space(8.);
        ui.label(RichText::new(match self.pattern{
            Pattern::Proximity=>"Pairs of observed points on different entities within both thresholds; proximity is not proof of a meeting.",Pattern::Stationary=>"Consecutive samples near an anchor with no gap larger than the limit; unobserved motion is unknown.",Pattern::Gaps=>"Time between one event's end and the next start on the same entity.",Pattern::Speed=>"Great-circle distance / elapsed time between consecutive located samples; an average, not measured speed.",Pattern::Clusters=>"Single-link connected components. Chained members may be farther apart than the radius or time tolerance."}
        ).small().color(MUTED));

        ui.separator();
        if self.analysis_revision != self.revision && !self.results.findings.is_empty() {
            ui.colored_label(
                Color32::from_rgb(247, 186, 105),
                "Data changed; rerun analysis.",
            );
        }
        if self.results.limited {
            ui.colored_label(
                Color32::from_rgb(247, 186, 105),
                "Partial results: 5 million comparisons or 10,000 findings reached.",
            );
        }
        ui.label(
            RichText::new(format!("{} FINDINGS", self.results.findings.len()))
                .size(11.)
                .color(MUTED),
        );
        let mut pick = None;
        for (i, finding) in self.results.findings.iter().enumerate().take(1000) {
            let selected = finding
                .ids
                .iter()
                .all(|id| self.project.selected.contains(id));
            egui::Frame::new()
                .fill(if selected {
                    Color32::from_rgb(30, 65, 68)
                } else {
                    Color32::from_rgb(27, 40, 54)
                })
                .inner_margin(10.)
                .corner_radius(5.)
                .show(ui, |ui| {
                    if ui.selectable_label(selected, &finding.summary).clicked() {
                        pick = Some(i);
                    }
                    ui.label(RichText::new(&finding.metric).small().color(MUTED));
                });
        }
        if let Some(i) = pick {
            self.select(self.results.findings[i].ids.clone(), false);
        }
        if self.results.findings.len() > 1000 {
            ui.label("Showing first 1,000 findings.");
        }
    }
    fn charts_tab(&mut self, ui: &mut egui::Ui) {
        ui.label(RichText::new("Visible data summary").size(18.).strong());
        let values = self
            .visible
            .iter()
            .filter_map(|&i| self.project.dataset.events[i].value);
        let stats = analysis::statistics(values);
        ui.label(
            RichText::new(format!(
                "{} events · {} numeric values",
                self.visible.len(),
                stats.count
            ))
            .small()
            .color(MUTED),
        );
        if stats.count > 0 {
            egui::Grid::new("stats").striped(true).show(ui, |ui| {
                for (name, value) in [
                    ("Mean", stats.mean),
                    ("Median", stats.median),
                    ("Min", stats.min),
                    ("Max", stats.max),
                    ("Sum", stats.sum),
                    ("Std. deviation", stats.std_dev),
                ] {
                    ui.label(name);
                    ui.monospace(format!("{value:.2}"));
                    ui.end_row();
                }
            });
        }
        ui.separator();
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.chart_group_entity, true, "By entity");
            ui.selectable_value(&mut self.chart_group_entity, false, "By category");
        });
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for &i in &self.visible {
            let e = &self.project.dataset.events[i];
            *counts
                .entry(if self.chart_group_entity {
                    &e.entity
                } else {
                    &e.category
                })
                .or_default() += 1;
        }
        let max = counts.values().copied().max().unwrap_or(1) as f32;
        let mut sorted: Vec<_> = counts.into_iter().collect();
        sorted.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        let mut selection = None;
        for (name, count) in sorted.into_iter().take(30) {
            ui.horizontal(|ui| {
                if ui
                    .small_button(if name.is_empty() { "(none)" } else { name })
                    .clicked()
                {
                    selection = Some(name.to_owned());
                }
                ui.label(count.to_string());
            });
            let (r, _) =
                ui.allocate_exact_size(Vec2::new(ui.available_width(), 6.), Sense::hover());
            ui.painter().rect_filled(
                egui::Rect::from_min_size(r.min, Vec2::new(r.width() * count as f32 / max, 6.)),
                2.,
                if self.chart_group_entity {
                    scene::entity_color(name)
                } else {
                    ACCENT
                },
            );
        }
        if let Some(name) = selection {
            let ids = self
                .visible
                .iter()
                .filter_map(|&i| {
                    let e = &self.project.dataset.events[i];
                    (if self.chart_group_entity {
                        e.entity == name
                    } else {
                        e.category == name
                    })
                    .then_some(e.id)
                })
                .collect();
            self.select(ids, false);
        }
        ui.separator();
        ui.label(
            RichText::new("ACTIVITY BY HOUR / WEEKDAY · UTC")
                .size(10.)
                .color(MUTED),
        );
        let mut buckets = [[0u32; 24]; 7];
        use chrono::{Datelike, Timelike};
        for &i in &self.visible {
            if let Some(t) = crate::timestamps::datetime(self.project.dataset.events[i].time) {
                buckets[t.weekday().num_days_from_monday() as usize][t.hour() as usize] += 1;
            }
        }
        let max = buckets.iter().flatten().copied().max().unwrap_or(1).max(1) as f32;
        let width = ui.available_width() / 24.;
        let (r, response) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), 100.), Sense::click());
        for (day, row) in buckets.iter().enumerate() {
            for (hour, &count) in row.iter().enumerate() {
                let cell = egui::Rect::from_min_size(
                    r.min + Vec2::new(hour as f32 * width, day as f32 * 14.),
                    Vec2::new(width - 1., 12.),
                );
                ui.painter().rect_filled(
                    cell,
                    1.,
                    if count == 0 {
                        Color32::from_rgb(30, 44, 59)
                    } else {
                        ACCENT.gamma_multiply(0.2 + count as f32 / max * 0.8)
                    },
                );
            }
        }
        if response.clicked() {
            if let Some(p) = response.interact_pointer_pos() {
                let hour = ((p.x - r.left()) / width).floor() as usize;
                let day = ((p.y - r.top()) / 14.).floor() as usize;
                let ids = self
                    .visible
                    .iter()
                    .filter_map(|&i| {
                        let e = &self.project.dataset.events[i];
                        let t = crate::timestamps::datetime(e.time)?;
                        (t.weekday().num_days_from_monday() as usize == day
                            && t.hour() as usize == hour)
                            .then_some(e.id)
                    })
                    .collect();
                self.select(ids, false);
            }
        }
        ui.label(
            RichText::new("Mon → Sun · 00 → 23 · click a cell to select")
                .small()
                .color(MUTED),
        );
    }
    fn views_tab(&mut self, ui: &mut egui::Ui) {
        ui.label(RichText::new("Saved context").size(18.).strong());
        ui.label(
            RichText::new("Save the current filters, selection and camera as a view.").color(MUTED),
        );
        ui.add(egui::TextEdit::singleline(&mut self.view_name).hint_text("View name"));
        if ui
            .add_enabled(
                !self.view_name.trim().is_empty() && self.project.views.len() < 200,
                egui::Button::new("Save current view"),
            )
            .clicked()
        {
            self.checkpoint();
            self.project.views.push(SavedView {
                scene: Default::default(),
                mode: self.mode,
                name: self.view_name.trim().into(),
                filter: self.project.filter.clone(),
                selected: self.project.selected.clone(),
                camera: self.project.camera.clone(),
            });
            self.view_name.clear();
            self.changed();
        }
        let mut restore = None;
        let mut remove = None;
        for (i, v) in self.project.views.iter().enumerate() {
            ui.horizontal(|ui| {
                if ui.button(&v.name).clicked() {
                    restore = Some(i);
                }
                if ui.small_button("x").clicked() {
                    remove = Some(i);
                }
            });
        }
        if let Some(i) = restore {
            let view = self.project.views[i].clone();
            self.mode = view.mode;
            self.project.filter = view.filter;
            self.project.selected = view.selected;
            self.project.camera = view.camera;
            self.sync_controls();
        }
        if let Some(i) = remove {
            self.checkpoint();
            self.project.views.remove(i);
            self.changed();
        }
        ui.separator();
        ui.label(RichText::new("SELECTION GROUPS").size(11.).color(MUTED));
        let mut pick = None;
        let mut delete = None;
        for (i, g) in self.project.groups.iter().enumerate() {
            ui.horizontal(|ui| {
                if ui.button(format!("{} · {}", g.name, g.ids.len())).clicked() {
                    pick = Some(i);
                }
                if ui.small_button("x").clicked() {
                    delete = Some(i);
                }
            });
        }
        if let Some(i) = pick {
            self.project.selected = self.project.groups[i].ids.clone();
            self.draft = None;
        }
        if let Some(i) = delete {
            self.checkpoint();
            self.project.groups.remove(i);
            self.changed();
        }
        ui.separator();
        ui.label(RichText::new("Workspace is saved in .chrono.json files. Import source values, notes, groups and views are preserved.").small().color(MUTED));
    }
    fn timeline(&mut self, ctx: &egui::Context) {
        let previous_time = (self.time_start, self.time_end);
        egui::TopBottomPanel::bottom("timeline")
            .exact_height(174.)
            .show(ctx, |ui| {
                let (lo, hi) = self.project.dataset.time_bounds();
                let span = (hi - lo) as f64;
                ui.horizontal(|ui| {
                    ui.add_space(12.);
                    ui.label(RichText::new("TIME WINDOW").size(11.).color(MUTED));
                    ui.label(
                        RichText::new(format!(
                            "{} — {} UTC",
                            time_label(lo + (self.time_start * span)),
                            time_label(lo + (self.time_end * span))
                        ))
                        .monospace()
                        .size(11.),
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.small_button("Full range").clicked() {
                            self.time_start = 0.;
                            self.time_end = 1.;
                            self.project.filter.start = None;
                            self.project.filter.end = None;
                            self.exact_start.clear();
                            self.exact_end.clear();
                        }
                        if ui
                            .button(if self.playing { "Pause" } else { "Play" })
                            .clicked()
                        {
                            self.playing = !self.playing;
                        }
                        ui.add(
                            egui::DragValue::new(&mut self.play_speed)
                                .range(0.005..=0.5)
                                .speed(0.005)
                                .suffix(" /s"),
                        );
                    });
                });
                let mut buckets = [0u32; 80];
                let mut selected = [0u32; 80];
                let mut f = self.project.filter.clone();
                f.start = None;
                f.end = None;
                for e in &self.project.dataset.events {
                    if f.matches(e, &self.project.selected) {
                        let b = (((e.time - lo) as f64 / span * 80.).floor() as usize).min(79);
                        buckets[b] += 1;
                        if self.project.selected.contains(&e.id) {
                            selected[b] += 1;
                        }
                    }
                }
                let (r, response) = ui.allocate_exact_size(
                    Vec2::new(ui.available_width(), 52.),
                    Sense::click_and_drag(),
                );
                let max = buckets.iter().max().copied().unwrap_or(1).max(1) as f32;
                let width = r.width() / 80.;
                for (i, &n) in buckets.iter().enumerate() {
                    let h = n as f32 / max * (r.height() - 3.);
                    let left = r.left() + i as f32 * width;
                    let in_window =
                        i as f64 / 80. >= self.time_start && i as f64 / 80. <= self.time_end;
                    ui.painter().rect_filled(
                        egui::Rect::from_min_max(
                            egui::pos2(left, r.bottom() - h),
                            egui::pos2(left + width - 2., r.bottom()),
                        ),
                        1.,
                        if in_window {
                            Color32::from_rgb(74, 126, 138)
                        } else {
                            Color32::from_rgb(35, 53, 70)
                        },
                    );
                    if selected[i] > 0 {
                        let h = selected[i] as f32 / max * (r.height() - 3.);
                        ui.painter().rect_filled(
                            egui::Rect::from_min_max(
                                egui::pos2(left, r.bottom() - h),
                                egui::pos2(left + width - 2., r.bottom()),
                            ),
                            1.,
                            ACCENT,
                        );
                    }
                }
                let x = r.left() + self.focus as f32 * r.width();
                ui.painter().line_segment(
                    [egui::pos2(x, r.top()), egui::pos2(x, r.bottom())],
                    Stroke::new(1.5_f32, Color32::WHITE),
                );
                if response.clicked() || response.dragged() {
                    if let Some(p) = response.interact_pointer_pos() {
                        self.focus = ((p.x - r.left()) / r.width()).clamp(0., 1.) as f64;
                        if response.clicked() {
                            let bin = (self.focus * 80.).floor() as usize;
                            let ids = self
                                .project
                                .dataset
                                .events
                                .iter()
                                .filter(|e| f.matches(e, &self.project.selected))
                                .filter(|e| {
                                    (((e.time - lo) as f64 / span * 80.).floor() as usize).min(79)
                                        == bin.min(79)
                                })
                                .map(|e| e.id)
                                .collect();
                            self.select(ids, ctx.input(|i| i.modifiers.shift));
                        }
                    }
                }
                ui.horizontal(|ui| {
                    ui.label("Start");
                    ui.add(
                        egui::Slider::new(&mut self.time_start, 0. ..=self.time_end)
                            .show_value(false)
                            .clamping(egui::SliderClamping::Always),
                    );
                    ui.label("End");
                    ui.add(
                        egui::Slider::new(&mut self.time_end, self.time_start..=1.)
                            .show_value(false)
                            .clamping(egui::SliderClamping::Always),
                    );
                    ui.label(
                        RichText::new("Click histogram to select · drag to scrub")
                            .small()
                            .color(MUTED),
                    );
                });
                ui.horizontal(|ui| {
                    ui.label("Focus");
                    ui.add(egui::Slider::new(&mut self.focus, 0. ..=1.).show_value(false));
                    ui.label(
                        RichText::new(time_label(lo + (self.focus * span)) + " UTC")
                            .small()
                            .monospace(),
                    );
                });
                if self.playing || previous_time != (self.time_start, self.time_end) {
                    self.project.filter.start = if self.time_start <= 0. {
                        None
                    } else {
                        Some(lo + (self.time_start * span))
                    };
                    self.project.filter.end = if self.time_end >= 1. {
                        None
                    } else {
                        Some(lo + (self.time_end * span))
                    };
                    self.exact_start = self
                        .project
                        .filter
                        .start
                        .map(time_label)
                        .unwrap_or_default();
                    self.exact_end = self.project.filter.end.map(time_label).unwrap_or_default();
                }
            });
    }
    fn data_table(&mut self, ui: &mut egui::Ui, height: f32) {
        let mut click = None;
        let selected = &self.project.selected;
        let data = &self.project.dataset.events;
        let mut sort = None;
        TableBuilder::new(ui)
            .striped(true)
            .resizable(true)
            .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
            .column(Column::exact(28.))
            .column(Column::initial(148.))
            .column(Column::initial(78.))
            .column(Column::initial(70.))
            .column(Column::remainder().at_least(100.))
            .column(Column::initial(58.))
            .column(Column::initial(138.))
            .column(Column::initial(80.))
            .min_scrolled_height(height)
            .max_scroll_height(height)
            .header(26., |mut header| {
                header.col(|ui| {
                    ui.label(" ");
                });
                for (sort_id, title) in [
                    (0, "Timestamp / UTC"),
                    (1, "Entity"),
                    (2, "Category"),
                    (3, "Label"),
                    (4, "Value"),
                    (5, "Coordinates"),
                    (6, "Related to"),
                ] {
                    header.col(|ui| {
                        if ui.small_button(title).clicked() && sort_id <= 4 {
                            sort = Some(sort_id);
                        }
                    });
                }
            })
            .body(|body| {
                body.rows(25., self.visible.len(), |mut row| {
                    let index = self.visible[row.index()];
                    let e = &data[index];
                    let sel = selected.contains(&e.id);
                    row.set_selected(sel);
                    row.col(|ui| {
                        let mut checked = sel;
                        if ui.checkbox(&mut checked, "").clicked() {
                            click = Some((e.id, true));
                        }
                    });
                    row.col(|ui| {
                        if ui
                            .selectable_label(
                                sel,
                                RichText::new(time_label(e.time)).monospace().size(11.),
                            )
                            .clicked()
                        {
                            click = Some((
                                e.id,
                                ui.input(|i| i.modifiers.shift || i.modifiers.command),
                            ));
                        }
                    });
                    row.col(|ui| {
                        ui.colored_label(scene::entity_color(&e.entity), &e.entity);
                    });
                    row.col(|ui| {
                        ui.label(&e.category);
                    });
                    row.col(|ui| {
                        ui.label(&e.label);
                    });
                    row.col(|ui| {
                        ui.monospace(
                            e.value
                                .map(|v| format!("{v:.1}"))
                                .unwrap_or_else(|| "—".into()),
                        );
                    });
                    row.col(|ui| {
                        ui.label(
                            RichText::new(
                                e.location()
                                    .map(|(lat, lon)| format!("{lat:.4}, {lon:.4}"))
                                    .unwrap_or_else(|| "No location".into()),
                            )
                            .monospace()
                            .size(10.),
                        );
                    });
                    row.col(|ui| {
                        ui.label(&e.related_to);
                    });
                });
            });
        if let Some(sort) = sort {
            if self.table_sort == sort {
                self.table_desc = !self.table_desc;
            } else {
                self.table_sort = sort;
                self.table_desc = false;
            }
            self.sort_visible();
        }
        if let Some((id, add)) = click {
            self.select(vec![id], add);
        }
    }
    fn center(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(Color32::from_rgb(12, 21, 31))
                    .inner_margin(12.),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    for (mode, label) in [
                        (ViewMode::SpaceTime, "Space-time"),
                        (ViewMode::Map, "Map"),
                        (ViewMode::Network, "Network"),
                    ] {
                        ui.selectable_value(&mut self.mode, mode, label);
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.checkbox(&mut self.show_table, "Table");
                        ui.checkbox(&mut self.split_map, "Split map");
                    });
                });
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.scene.select_box, false, "Navigate");
                    ui.selectable_value(&mut self.scene.select_box, true, "Box select");
                    if ui.small_button("Fit visible").clicked() {
                        self.scene.frame = scene::GeoFrame::fit(
                            self.visible
                                .iter()
                                .map(|&i| &self.project.dataset.events[i]),
                        );
                        self.project.camera = project::Camera::default();
                    }
                    if ui.small_button("Reset camera").clicked() {
                        self.project.camera = project::Camera::default();
                    }
                    ui.checkbox(&mut self.scene.trails, "Trails");
                    if self.mode == ViewMode::SpaceTime {
                        ui.checkbox(&mut self.scene.stems, "Stems");
                    }
                });
                if self.mode == ViewMode::SpaceTime {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("Time height").small().color(MUTED));
                        ui.add(
                            egui::Slider::new(&mut self.project.camera.time_scale, 0.1..=3.)
                                .show_value(false),
                        );
                        ui.checkbox(&mut self.scene.size_value, "Size by value");
                    });
                }
                let table_height = if self.show_table {
                    ui.available_height().clamp(110., 200.)
                } else {
                    0.
                };
                let scene_height =
                    (ui.available_height() - table_height - if self.show_table { 36. } else { 0. })
                        .max(140.);
                let mut hit = None;
                if self.split_map && self.mode != ViewMode::Map {
                    let width = (ui.available_width() - 8.) / 2.;
                    ui.horizontal(|ui| {
                        ui.allocate_ui(Vec2::new(width, scene_height), |ui| {
                            hit = self.scene.show(
                                ui,
                                &self.project.dataset,
                                &self.visible,
                                &self.project.selected,
                                &mut self.project.camera,
                                self.mode,
                                self.focus,
                            );
                        });
                        ui.allocate_ui(Vec2::new(width, scene_height), |ui| {
                            let pick = self.scene.show(
                                ui,
                                &self.project.dataset,
                                &self.visible,
                                &self.project.selected,
                                &mut self.map_camera,
                                ViewMode::Map,
                                self.focus,
                            );
                            if pick.is_some() {
                                hit = pick;
                            }
                        });
                    });
                } else {
                    ui.allocate_ui(Vec2::new(ui.available_width(), scene_height), |ui| {
                        hit = self.scene.show(
                            ui,
                            &self.project.dataset,
                            &self.visible,
                            &self.project.selected,
                            &mut self.project.camera,
                            self.mode,
                            self.focus,
                        );
                    });
                }
                if let Some((ids, add)) = hit {
                    self.select(ids, add);
                }
                if self.show_table {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("EVENT TABLE").size(10.).color(MUTED));
                        ui.label(
                            RichText::new(format!(
                                "{} visible / {} total · {} selected",
                                self.visible.len(),
                                self.project.dataset.events.len(),
                                self.project.selected.len()
                            ))
                            .small()
                            .color(MUTED),
                        );
                    });
                    self.data_table(ui, table_height);
                }
            });
    }
    fn import_window(&mut self, ctx: &egui::Context) {
        let mut cancel = false;
        let mut run = false;
        if let Some(wizard) = &mut self.wizard {
            egui::Window::new("Import tabular data").id(egui::Id::new("import")).collapsible(false).resizable(true).default_width(810.).default_height(560.).anchor(Align2::CENTER_CENTER,Vec2::ZERO).show(ctx,|ui|{

                ui.label(RichText::new(&wizard.raw.source).size(18.).strong());
                ui.horizontal(|ui|{
                    ui.label("Worksheet");
                    let previous=wizard.sheet;
                    egui::ComboBox::from_id_salt("sheet").selected_text(&wizard.raw.tables[wizard.sheet].sheet).show_ui(ui,|ui|{
                        for(i,t)in wizard.raw.tables.iter().enumerate(){
                            ui.selectable_value(&mut wizard.sheet,i,&t.sheet);
                        }
                    }
                    );
                    if previous!=wizard.sheet{
                        wizard.mapping=Mapping::guess(&wizard.raw.tables[wizard.sheet].headers);
                    }
                    ui.label(format!("{} rows",wizard.raw.tables[wizard.sheet].rows.len()));
                }
                );

                ui.horizontal(|ui|{ui.radio_value(&mut wizard.append,false,"Replace workspace data");ui.radio_value(&mut wizard.append,true,"Append to workspace");});ui.separator();
                let table=&wizard.raw.tables[wizard.sheet];
                egui::Grid::new("mapping_grid").num_columns(4).spacing([14.,5.]).show(ui,|ui|{
                    let columns=[("Timestamp *",&mut wizard.mapping.time),("Entity",&mut wizard.mapping.entity),("Latitude",&mut wizard.mapping.lat),("Longitude",&mut wizard.mapping.lon),("End timestamp",&mut wizard.mapping.end),("Category",&mut wizard.mapping.category),("Label",&mut wizard.mapping.label),("Numeric value",&mut wizard.mapping.value),("Related entity",&mut wizard.mapping.related_to)];

                    for(i,(label,column))in columns.into_iter().enumerate(){
                        ui.label(label);
                        egui::ComboBox::from_id_salt(("column",i)).width(190.).selected_text(column.and_then(|i|table.headers.get(i)).map(String::as_str).unwrap_or("(none)")).show_ui(ui,|ui|{
                            ui.selectable_value(column,None,"(none)");
                            for(i,h)in table.headers.iter().enumerate(){
                                ui.selectable_value(column,Some(i),h);
                            }
                        }
                        );
                        if i%2==1{
                            ui.end_row();
                        }
                    }
                    ui.end_row();

                });
                if wizard.mapping.entity.is_none(){ui.horizontal(|ui|{ui.label("Default entity");ui.text_edit_singleline(&mut wizard.mapping.default_entity);});}
                ui.horizontal(|ui|{
                    ui.label("Custom date format");
                    ui.add(egui::TextEdit::singleline(&mut wizard.mapping.custom_format).hint_text("e.g. %d/%m/%Y %H:%M:%S").desired_width(260.));
                    ui.label("Naive times UTC offset (min)");
                    ui.add(egui::DragValue::new(&mut wizard.mapping.offset_minutes).range(-840..=840).speed(15.));
                }
                );

                ui.label(RichText::new("ISO 8601 and Unix seconds/milliseconds detected automatically. Excel date cells are decoded. Ambiguous dates require a custom format; coordinates are WGS84 decimal degrees.").small().color(MUTED));
                ui.separator();

                ui.label(RichText::new("SOURCE PREVIEW · ORIGINAL FIELDS ARE RETAINED").size(10.).color(MUTED));
                egui::ScrollArea::both().id_salt("preview").max_height(130.).show(ui,|ui|{
                    egui::Grid::new("raw_preview").striped(true).show(ui,|ui|{
                        for h in &table.headers{
                            ui.strong(h);
                        }
                        ui.end_row();
                        for row in table.rows.iter().take(6){
                            for value in row{
                                ui.label(value);
                            }
                            ui.end_row();
                        }
                    }
                    );
                }
                );

                let preview=import::RawTable{
                    sheet:table.sheet.clone(),row_numbers:table.row_numbers.iter().take(20).copied().collect(),headers:table.headers.clone(),rows:table.rows.iter().take(20).cloned().collect()}
                ;

                match import::convert(&preview,&wizard.mapping,&wizard.raw.source,1){
                    Ok(report)=>{
                        ui.label(format!("Validation preview: {} valid / {} rejected in first {} rows",report.events.len(),report.rejected_count,preview.rows.len()));
                        if let Some((row,reason))=report.rejected.first(){
                            ui.colored_label(Color32::from_rgb(247,186,105),format!("Row {row}: {reason}"));
                        }
                    }
                    ,Err(e)=>{
                        ui.colored_label(Color32::from_rgb(247,186,105),e);
                    }
                }

                ui.separator();
                ui.horizontal(|ui|{
                    run=ui.add_enabled(!self.busy&&wizard.mapping.time.is_some(),egui::Button::new("Validate and import").fill(Color32::from_rgb(36,91,89))).clicked();
                    cancel=ui.add_enabled(!self.busy,egui::Button::new("Cancel")).clicked();
                    if self.busy{
                        ui.spinner();
                    }
                }
                );

            });
        }
        if cancel {
            self.wizard = None;
        }
        if run {
            if let Some(w) = &self.wizard {
                let table = w.raw.tables[w.sheet].clone();
                let mapping = w.mapping.clone();
                let source = w.raw.source.clone();
                let append = w.append;
                let first_id = if append {
                    self.project
                        .dataset
                        .events
                        .iter()
                        .map(|e| e.id)
                        .max()
                        .unwrap_or(0)
                        .saturating_add(1)
                } else {
                    1
                };
                let tx = self.tx.clone();
                self.busy = true;
                std::thread::spawn(move || {
                    let report = import::convert(&table, &mapping, &source, first_id);
                    let _ = tx.send(WorkerResult::Converted(report, append, source));
                });
            }
        }
        let mut accept = false;
        let mut dismiss = false;
        if let Some((report, _, name)) = &self.import_report {
            egui::Window::new("Import validation results")
                .collapsible(false)
                .default_width(650.)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.strong(name);
                    ui.label(format!(
                        "{} valid rows · {} rejected rows",
                        report.events.len(),
                        report.rejected_count
                    ));
                    ui.label(
                        "Rejected rows will be excluded. Review the reasons before continuing.",
                    );
                    egui::ScrollArea::vertical()
                        .max_height(300.)
                        .show(ui, |ui| {
                            for (row, reason) in &report.rejected {
                                ui.label(format!("Row {row}: {reason}"));
                            }
                        });
                    if report.rejected_count > report.rejected.len() {
                        ui.label("Showing first 100 rejection reasons.");
                    }
                    ui.horizontal(|ui| {
                        accept = ui
                            .add_enabled(
                                !report.events.is_empty(),
                                egui::Button::new("Import valid rows"),
                            )
                            .clicked();
                        dismiss = ui.button("Cancel import").clicked();
                    });
                });
        }
        if accept {
            if let Some((report, append, name)) = self.import_report.take() {
                self.accept_import(report, append, name);
            }
        }
        if dismiss {
            self.import_report = None;
        }
    }
    fn file_window(&mut self, ctx: &egui::Context) {
        let mut submit = false;
        let mut close = false;
        if let Some(action) = self.file_action {
            egui::Window::new("Local file path")
                .collapsible(false)
                .default_width(520.)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.horizontal(|ui| {
                        for (a, name) in [
                            (FileAction::Import, "Import"),
                            (FileAction::Open, "Open"),
                            (FileAction::Save, "Save"),
                            (FileAction::Export, "Export"),
                            (FileAction::Snapshot, "PNG"),
                        ] {
                            if ui.selectable_label(action == a, name).clicked() {
                                self.file_action = Some(a);
                            }
                        }
                    });
                    ui.add(
                        egui::TextEdit::singleline(&mut self.file_path)
                            .desired_width(f32::INFINITY)
                            .hint_text("Absolute or relative path"),
                    );
                    if action == FileAction::Import {
                        ui.horizontal(|ui| {
                            ui.label("CSV delimiter");
                            for (d, label) in [(b',', "Comma"), (b';', "Semicolon"), (b'\t', "Tab")]
                            {
                                ui.selectable_value(&mut self.delimiter, d, label);
                            }
                        });
                    }
                    ui.horizontal(|ui| {
                        submit = ui
                            .add_enabled(
                                !self.file_path.trim().is_empty(),
                                egui::Button::new("Continue"),
                            )
                            .clicked();
                        close = ui.button("Cancel").clicked();
                    });
                });
            if submit {
                let path = PathBuf::from(self.file_path.trim());
                self.file_action = None;
                self.perform_file(action, path);
            }
            if close {
                self.file_action = None;
            }
        }
    }
}
fn stat(ui: &mut egui::Ui, value: &str, label: &str) {
    ui.vertical(|ui| {
        ui.label(RichText::new(value).size(24.).strong().color(ACCENT));
        ui.label(RichText::new(label).small().color(MUTED));
    });
}
impl eframe::App for Chronoscope {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.frame_count += 1;
        let prior_filter = self.project.filter.clone();
        let prior_selection = self.project.selected.clone();
        let prior_camera = self.project.camera.clone();
        let prior_mode = self.mode;
        if ctx.input(|i| i.viewport().close_requested()) && self.unsaved && !self.close_allowed {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.confirm_close = true;
        }
        self.poll();
        let elapsed = self.last_tick.elapsed().as_secs_f64().min(0.2);
        self.last_tick = Instant::now();
        if self.playing {
            let width = self.time_end - self.time_start;
            if width >= 0.999 {
                self.time_start = 0.;
                self.time_end = 0.25;
            } else {
                self.time_start += elapsed * self.play_speed;
                self.time_end = self.time_start + width;
                if self.time_end > 1. {
                    self.time_start = 0.;
                    self.time_end = width;
                }
            }
            self.focus = (self.time_start + self.time_end) / 2.;
            ctx.request_repaint();
        }
        if self.busy {
            ctx.request_repaint_after(std::time::Duration::from_millis(50));
        }
        if ctx.input(|i| i.modifiers.command && i.key_pressed(egui::Key::Z)) {
            self.undo();
        }
        if ctx.input(|i| i.modifiers.command && i.key_pressed(egui::Key::Y)) {
            self.redo();
        }
        let dropped = ctx.input(|i| {
            i.raw
                .dropped_files
                .iter()
                .filter_map(|f| f.path.clone())
                .collect::<Vec<_>>()
        });
        if let Some(path) = dropped.first() {
            self.read_import(path.clone());
        }
        self.refresh();
        self.header(ctx);
        egui::TopBottomPanel::bottom("status")
            .exact_height(28.)
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.add_space(10.);
                    ui.label(RichText::new(&self.status).size(11.).color(MUTED));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(
                            RichText::new(format!(
                                "{} visible · {} selected",
                                self.visible.len(),
                                self.project.selected.len()
                            ))
                            .size(11.)
                            .color(ACCENT),
                        );
                    });
                });
            });
        self.timeline(ctx);
        self.sidebar(ctx);
        self.refresh();
        self.inspector(ctx);
        self.refresh();
        self.center(ctx);
        self.import_window(ctx);
        self.file_window(ctx);
        if let Some(error) = self.error.clone() {
            let mut close = false;
            egui::Window::new("Action could not be completed")
                .collapsible(false)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.label(error);
                    close = ui.button("Dismiss").clicked();
                });
            if close {
                self.error = None;
            }
        }
        self.project.mode = self.mode;
        if !self.just_opened
            && (prior_filter != self.project.filter
                || prior_selection != self.project.selected
                || prior_camera != self.project.camera
                || prior_mode != self.mode)
        {
            self.unsaved = true;
        }
        self.just_opened = false;
        if self.confirm_close {
            egui::Window::new("Save workspace before closing?")
                .collapsible(false)
                .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.label("The workspace contains unsaved changes.");
                    ui.horizontal(|ui| {
                        if ui.button("Save and close").clicked() {
                            if let Some(p) = self.project_path.clone() {
                                self.perform_file(FileAction::Save, p);
                            } else {
                                self.dialog(FileAction::Save);
                            }
                            if !self.unsaved {
                                self.close_allowed = true;
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            }
                        }
                        if ui.button("Discard and close").clicked() {
                            self.close_allowed = true;
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                        if ui.button("Keep working").clicked() {
                            self.confirm_close = false;
                        }
                    });
                });
        }
        if let Some((after, path)) = self.capture_after.clone() {
            ctx.request_repaint();
            if self.frame_count >= after {
                self.snapshot_path = Some(path);
                self.capture_after = None;
            }
        }
        if self.snapshot_path.is_some() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
        }
        for event in ctx.input(|i| i.events.clone()) {
            if let egui::Event::Screenshot { image, .. } = event {
                if let Some(path) = self.snapshot_path.take() {
                    let bytes = image
                        .pixels
                        .iter()
                        .flat_map(|p| p.to_array())
                        .collect::<Vec<_>>();
                    match image::save_buffer_with_format(
                        &path,
                        &bytes,
                        image.width() as u32,
                        image.height() as u32,
                        image::ColorType::Rgba8,
                        image::ImageFormat::Png,
                    ) {
                        Ok(()) => self.status = format!("Snapshot saved to {}", path.display()),
                        Err(e) => self.error = Some(e.to_string()),
                    }
                }
            }
        }
    }
}
