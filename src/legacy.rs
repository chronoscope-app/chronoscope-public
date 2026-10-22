#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#![forbid(unsafe_code)]
use chronoscope::{app::Chronoscope, import, model, project};
fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "--inspect") {
        let Some(path) = args.get(2) else {
            eprintln!("Usage: chronoscope --inspect FILE.csv|FILE.xlsx");
            std::process::exit(2)
        };
        match import::read_file(std::path::Path::new(path), b',') {
            Ok(raw) => {
                for t in &raw.tables {
                    match import::convert(t, &import::Mapping::guess(&t.headers), &raw.source, 1) {
                        Ok(r) => println!(
                            "{}: {} valid, {} rejected, time range {:?}",
                            t.sheet,
                            r.events.len(),
                            r.rejected_count,
                            model::Dataset {
                                events: r.events,
                                name: raw.source.clone()
                            }
                            .time_bounds()
                        ),
                        Err(e) => {
                            eprintln!("{e}");
                            std::process::exit(1)
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1)
            }
        }
        return Ok(());
    }
    let initial = args.get(1).map(std::path::PathBuf::from);
    if args.get(1).is_some_and(|a| a == "--demo-export") {
        let p = project::Project::new(chronoscope::demo::dataset());
        let path = std::path::Path::new(args.get(2).map(String::as_str).unwrap_or("demo.csv"));
        match project::export_csv(path, p.dataset.events.into_iter()) {
            Ok(n) => println!("Exported {n} events"),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1)
            }
        }
        return Ok(());
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Chronoscope — Space & time")
            .with_inner_size([1440., 980.])
            .with_min_inner_size([1050., 720.]),
        ..Default::default()
    };
    eframe::run_native(
        "Chronoscope",
        options,
        Box::new(move |cc| Ok(Box::new(Chronoscope::new(cc, initial)))),
    )
}
