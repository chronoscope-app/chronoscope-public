#![forbid(unsafe_code)]
use crate::{engine::Engine, project::Project};
use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
#[derive(Parser)]
#[command(
    version,
    about = "Chronoscope: spatial-temporal engine, CLI and MCP server"
)]
struct Cli {
    #[arg(long, global = true)]
    project: Option<PathBuf>,
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    /// Explicitly seed synthetic data for deterministic development/regression tests.
    #[arg(long, global = true, conflicts_with_all = ["project", "connect", "attach"])]
    demo_data: bool,
    /// Emit stable success/error envelopes for automation.
    #[arg(long, global = true)]
    json: bool,
    /// Use the running desktop's private agent connection descriptor.
    #[arg(long, global = true, conflicts_with = "project")]
    connect: Option<PathBuf>,
    /// Discover and attach to the live desktop, for any command or MCP.
    #[arg(long, global = true, conflicts_with_all = ["project", "connect"])]
    attach: bool,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Import CSV/Excel or GIS features as Events using automatic or JSON column mapping.
    Import {
        path: PathBuf,
        #[arg(long)]
        mapping: Option<PathBuf>,
        #[arg(long, default_value_t = 0)]
        sheet: usize,
        #[arg(long, default_value = "auto")]
        delimiter: String,
        #[arg(long)]
        accept_rejected: bool,
        /// Retain time/proximity summaries instead of individual rows.
        #[arg(long, requires = "aggregate_radius_m")]
        aggregate_window_minutes: Option<i64>,
        #[arg(long, requires = "aggregate_window_minutes")]
        aggregate_radius_m: Option<f64>,
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Ask the configured in-app SI assistant (use --connect for its live session).
    Ask {
        prompt: String,
        #[arg(long)]
        allow_edits: bool,
        #[arg(long)]
        allow_external_actions: bool,
        #[arg(long, default_value_t = 8)]
        max_steps: u64,
    },
    /// Convert DD, UTM or MGRS; input is a JSON coordinate object.
    Coordinates {
        #[arg(long)]
        input: String,
    },
    /// Inspect, navigate or capture the live Chronoscope desktop (use --attach).
    View {
        #[command(subcommand)]
        command: ViewCommand,
    },
    /// Execute any engine operation with JSON arguments (see docs/CLI-MCP.md).
    Call {
        command: String,
        #[arg(long, default_value = "{}")]
        args: String,
        #[arg(short, long)]
        output: Option<PathBuf>,
        #[arg(long, conflicts_with = "args")]
        args_file: Option<PathBuf>,
    },
    /// Run a pattern tool against a project.
    Analyze {
        #[arg(long, default_value = "Proximity")]
        pattern: String,
        #[arg(long, default_value = "{}")]
        parameters: String,
        #[arg(long)]
        selected_only: bool,
    },
    /// Inspect DTED file/folder metadata, checksum-valid elevations and coverage.
    Terrain {
        path: PathBuf,
        #[arg(long)]
        sample: Option<String>,
    },
    /// Read WMTS capabilities or plan/fetch a bounded viewport.
    Wmts {
        url: String,
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        matrix_set: Option<String>,
        #[arg(long)]
        bounds: Option<String>,
        #[arg(long)]
        fetch: bool,
    },
    /// Model Context Protocol server over stdio. File access confined to --root.
    Mcp {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Discover, configure and enable live desktop agent access.
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
    /// Local browser development bridge. Requires a bearer token; not a hosted service.
    Serve {
        #[arg(long, default_value = "127.0.0.1:8787")]
        listen: String,
        #[arg(long)]
        token_file: PathBuf,
        #[arg(long)]
        frontend: Option<PathBuf>,
    },
    /// Persistent NDJSON command session; each line is {id,command,args}.
    Session {
        #[arg(long)]
        save: Option<PathBuf>,
    },
    /// Atomic batch of workspace commands; input JSON is an operations array or object.
    Batch {
        #[arg(long)]
        file: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Discover enforced command contracts.
    Schema { command: Option<String> },
    /// Export synthetic events as CSV.
    DemoExport { path: PathBuf },
}
#[derive(Subcommand)]
enum ViewCommand {
    /// Inspect the actual rendered camera, backend, loading and layer readiness.
    Status,
    /// Set playback fade: 0 retains history, 100 keeps only recent positions.
    Fade {
        #[arg(value_parser = clap::value_parser!(u8).range(0..=100))]
        amount: u8,
    },
    /// Choose Globe height: timestamp elevation, physical altitude, or ground.
    Height {
        #[arg(value_parser = ["time", "altitude", "ground"])]
        mode: String,
        /// Time Height multiplier (0.05–20); valid only with time.
        #[arg(long)]
        scale: Option<f64>,
    },
    /// Reload map graphics, preserving Events, camera and workspace. Requires --confirm.
    Reset {
        #[arg(long, required = true)]
        confirm: bool,
    },
    /// Fit Events or an enabled native GIS layer.
    Fit {
        #[arg(long, conflicts_with = "whole_globe")]
        layer: Option<String>,
        #[arg(long)]
        whole_globe: bool,
    },
    /// Aim at WGS84 coordinates. In 2D, distance is the map width in metres.
    LookAt {
        #[arg(long, allow_hyphen_values = true)]
        longitude: f64,
        #[arg(long, allow_hyphen_values = true)]
        latitude: f64,
        #[arg(long, default_value_t = 0., allow_hyphen_values = true)]
        height: f64,
        #[arg(long)]
        distance: f64,
        #[arg(long, default_value_t = 0.)]
        heading: f64,
        #[arg(long, default_value_t = 0.)]
        tilt: f64,
    },
    /// Zoom around the view centre: factors above one zoom in.
    Zoom { factor: f64 },
    /// Restore a north-up bearing around the current target.
    North,
    /// Save the whole app (default) or map as PNG, without base64 on stdout.
    Capture {
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long)]
        overwrite: bool,
        #[arg(long, default_value = "app", value_parser = ["app", "map"])]
        target: String,
        #[arg(long, default_value = "main", value_parser = ["main", "si-chat"])]
        window: String,
    },
}
#[derive(Subcommand)]
enum AgentCommand {
    /// Inspect live connectivity without exposing credentials.
    Status,
    /// Enable access; no path required. The default exchange folder is private.
    Enable {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Disable access in the running app and on subsequent launches.
    Disable,
    /// Print MCP client JSON using this executable (also works inside a Mac app).
    Config,
}
fn run() -> Result<(), String> {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) {
                error.print().map_err(|e| e.to_string())?;
                return Ok(());
            }
            return Err(format!("Invalid command line: {error}"));
        }
    };
    let data_dir = match cli.data_dir {
        Some(path) => path,
        None => crate::platform::prepare_default_profile()?,
    };
    let data_dir = if data_dir.is_absolute() {
        data_dir
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(data_dir)
    };
    if let Command::Schema { command } = &cli.command {
        let schema = if let Some(command) = command {
            crate::schema::command_schema(command).ok_or("Unknown command")?
        } else {
            json!({"tools":crate::mcp::tools(),"commands":crate::schema::COMMANDS.iter().map(|name|((*name).to_string(),json!({"input":crate::schema::command_schema(name).unwrap(),"output":crate::schema::domain_output_schema(name)}))).collect::<serde_json::Map<_,_>>(),"error_codes":serde_json::to_value(schemars::schema_for!(crate::error::ErrorCode)).map_err(|e|e.to_string())?})
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&if cli.json {
                json!({"ok":true,"result":schema})
            } else {
                schema
            })
            .map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    if let Command::Agent { command } = &cli.command {
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let result = match command {
            AgentCommand::Config => {
                crate::agent::access::config_for_data(&executable, Some(&data_dir))
            }
            AgentCommand::Status => crate::agent::access::status(&data_dir, &executable)?,
            AgentCommand::Enable { .. } | AgentCommand::Disable => {
                let enabled = matches!(command, AgentCommand::Enable { .. });
                let root = if let AgentCommand::Enable { root } = command {
                    root.clone()
                } else {
                    crate::agent::access::read_settings(&data_dir)?.root
                };
                crate::agent::access::write_settings(&data_dir, enabled, root)?;
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                loop {
                    let status = crate::agent::access::status(&data_dir, &executable)?;
                    if status["connected"] == enabled && status["pending"] == false
                        || std::time::Instant::now() >= deadline
                    {
                        break status;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&if cli.json {
                json!({"ok":true,"result":result})
            } else {
                result
            })
            .map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    let attached = if let Some(path) = &cli.connect {
        Some(crate::agent::read_connection(path)?)
    } else if cli.attach {
        Some(crate::agent::read_connection(
            &data_dir.join("agent-connection.json"),
        )?)
    } else {
        None
    };
    if let Command::Mcp { root } = &cli.command {
        if attached.is_some() && (root.is_some() || cli.project.is_some()) {
            return Err("Invalid attached configuration: desktop access uses its configured file scope; omit --root/--project".into());
        }
        if let Some(info) = attached {
            crate::agent::proxy(info)?;
            return Ok(());
        }
    }
    if attached.is_some()
        && matches!(
            cli.command,
            Command::Serve { .. } | Command::DemoExport { .. }
        )
    {
        return Err(
            "INVALID_ARGUMENT: this local utility does not support --attach/--connect".into(),
        );
    }
    let terrain_scope = if let Command::Mcp { root, .. } = &cli.command {
        Some(
            root.clone()
                .unwrap_or(std::env::current_dir().map_err(|e| e.to_string())?)
                .canonicalize()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let engine = if attached.is_some() {
        None
    } else {
        Some(Arc::new(if let Some(path) = cli.project {
            Engine::from_path(&path, data_dir, terrain_scope.as_deref())?
        } else {
            Engine::new_with_terrain_scope(
                if cli.demo_data {
                    Project::new(crate::demo::dataset())
                } else {
                    Project::empty()
                },
                data_dir,
                terrain_scope.as_deref(),
            )?
        }))
    };
    let invoke = |command: &str, args: Value| -> Result<Value, String> {
        if let Some(info) = &attached {
            crate::agent::invoke_remote(info, command, args)
        } else {
            engine.as_ref().unwrap().invoke(command, args)
        }
    };
    let result = match cli.command {
        Command::Import {
            path,
            mapping,
            sheet,
            delimiter,
            accept_rejected,
            aggregate_window_minutes,
            aggregate_radius_m,
            output,
        } => {
            let preview = invoke("import_preview", json!({"path":path,"delimiter":delimiter}))?;
            let mapping = if let Some(path) = mapping {
                read_json(&path)?
            } else {
                preview["sheets"].get(sheet).ok_or("Invalid sheet")?["mapping"].clone()
            };
            let mut arguments = json!({"sheet":sheet,"mapping":mapping,"accept_rejected":accept_rejected,"import_id":preview["import_id"]});
            if let (Some(window), Some(radius)) = (aggregate_window_minutes, aggregate_radius_m) {
                arguments["aggregation"] = json!({"window_minutes":window,"radius_m":radius});
            }
            let result = invoke("import_commit", arguments)?;
            if result["needs_review"] == true {
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&if cli.json {
                        json!({"ok":true,"result":result})
                    } else {
                        result
                    })
                    .unwrap()
                );
                return Err("Rejected rows require --accept-rejected".into());
            }
            invoke("save", json!({"path":output}))?;
            result
        }
        Command::Ask {
            prompt,
            allow_edits,
            allow_external_actions,
            max_steps,
        } => invoke(
            "si_run",
            json!({"prompt":prompt,"allow_edits":allow_edits,"allow_external_actions":allow_external_actions,"max_steps":max_steps}),
        )?,
        Command::Coordinates { input } => invoke(
            "coordinates",
            json!({"coordinate":serde_json::from_str::<Value>(&input).map_err(|e|e.to_string())?}),
        )?,
        Command::View { command } => match command {
            ViewCommand::Status => invoke("view_status", json!({}))?,
            ViewCommand::Fade { amount } => {
                if attached.is_none() {
                    return Err("UNAVAILABLE: use --attach for live playback fade controls".into());
                }
                invoke(
                    "view_playback",
                    json!({"action":"configure","fade_amount":amount}),
                )?
            }
            ViewCommand::Reset { confirm } => invoke("view_reset", json!({"confirm":confirm}))?,
            ViewCommand::Height { mode, scale } => {
                if scale.is_some() && mode != "time" {
                    return Err("INVALID_ARGUMENT: --scale applies only to Time Height".into());
                }
                if attached.is_none() {
                    return Err("UNAVAILABLE: use --attach for live Globe height controls".into());
                }
                let mut args = json!({"mode":"globe","globe_time":mode=="time","globe_altitude":mode=="altitude"});
                if let Some(scale) = scale {
                    args["globe_time_scale"] = json!(scale);
                }
                invoke("view_set", args)?
            }
            ViewCommand::Fit { layer, whole_globe } => invoke(
                "view_navigate",
                match layer {
                    Some(id) => json!({"action":"fit_layer","layer_id":id}),
                    None => json!({"action":"fit","whole_globe":whole_globe}),
                },
            )?,
            ViewCommand::LookAt {
                longitude,
                latitude,
                height,
                distance,
                heading,
                tilt,
            } => invoke(
                "view_navigate",
                json!({"action":"look_at","center":[longitude,latitude,height],"distance_m":distance,"heading_degrees":heading,"tilt_degrees":tilt}),
            )?,
            ViewCommand::Zoom { factor } => {
                invoke("view_navigate", json!({"action":"zoom","factor":factor}))?
            }
            ViewCommand::North => invoke("view_navigate", json!({"action":"north_up"}))?,
            ViewCommand::Capture {
                output,
                overwrite,
                target,
                window,
            } => {
                if output.exists() && !overwrite {
                    return Err("Output exists; use --overwrite".into());
                }
                let result = invoke("view_capture", json!({"target":target,"window":window}))?;
                write_capture(&output, &result, overwrite)?
            }
        },
        Command::Call {
            command,
            args,
            args_file,
            output,
        } => {
            if attached.is_none() && command.starts_with("job_") {
                return Err("UNAVAILABLE: job handles require a persistent session, MCP server or --connect desktop".into());
            }
            let args = if let Some(path) = args_file {
                read_json(&path)?
            } else {
                serde_json::from_str(&args).map_err(|e| e.to_string())?
            };
            let result = invoke(&command, args)?;
            if let Some(path) = output {
                invoke("save", json!({"path":path}))?;
            }
            result
        }
        Command::Analyze {
            pattern,
            parameters,
            selected_only,
        } => invoke(
            "analyze",
            json!({"pattern":pattern,"parameters":serde_json::from_str::<Value>(&parameters).map_err(|e|e.to_string())?,"selected_only":selected_only}),
        )?,
        Command::Terrain { path, sample } => {
            let info = invoke("terrain_load", json!({"path":path}))?;
            if let Some(pair) = sample {
                let n: Vec<_> = pair
                    .split(',')
                    .map(str::parse::<f64>)
                    .collect::<Result<_, _>>()
                    .map_err(|e| e.to_string())?;
                if n.len() != 2 {
                    return Err("Sample expects lat,lon".into());
                }
                invoke("terrain_sample", json!({"latitude":n[0],"longitude":n[1]}))?
            } else {
                info
            }
        }
        Command::Wmts {
            url,
            layer,
            matrix_set,
            bounds,
            fetch,
        } => {
            let caps = invoke("wmts_capabilities", json!({"url":url}))?;
            if let Some(layer) = layer {
                let matrix_set = matrix_set.ok_or("Provide --matrix-set")?;
                let bounds: Vec<_> = bounds
                    .ok_or("Provide --bounds west,south,east,north")?
                    .split(',')
                    .map(str::parse::<f64>)
                    .collect::<Result<_, _>>()
                    .map_err(|e| e.to_string())?;
                if bounds.len() != 4 {
                    return Err("Bounds require four values".into());
                }
                invoke(
                    if fetch { "wmts_rasters" } else { "wmts_plan" },
                    json!({"config":{"url":url,"layer":layer,"matrix_set":matrix_set,"style":"","format":"","time":"","enabled":true},"bounds":bounds}),
                )?
            } else {
                caps
            }
        }
        Command::Mcp { root, .. } => {
            crate::mcp::serve(
                engine.unwrap(),
                root.unwrap_or(std::env::current_dir().map_err(|e| e.to_string())?),
            )?;
            return Ok(());
        }
        Command::Serve {
            listen,
            token_file,
            frontend,
        } => {
            let token = std::fs::read_to_string(token_file).map_err(|e| e.to_string())?;
            if token.trim().len() < 24 {
                return Err("Use a random token of at least 24 characters".into());
            }
            let address: std::net::SocketAddr =
                listen.parse().map_err(|_| "Invalid listen address")?;
            if !address.ip().is_loopback() {
                return Err("Development bridge only binds loopback".into());
            }
            let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            runtime.block_on(crate::server::serve(
                engine.unwrap(),
                address,
                token.trim().into(),
                frontend,
            ))?;
            return Ok(());
        }
        Command::Session { save } => {
            use std::io::Write;
            let stdin = std::io::stdin();
            let mut reader = stdin.lock();
            let mut stdout = std::io::stdout().lock();
            loop {
                let input = match crate::mcp::read_message(&mut reader) {
                    Ok(Some(v)) => v,
                    Ok(None) => break,
                    Err(e) => {
                        writeln!(stdout, "{}", error_envelope(&e, Value::Null))
                            .map_err(|e| e.to_string())?;
                        stdout.flush().map_err(|e| e.to_string())?;
                        continue;
                    }
                };
                let request: Value = match serde_json::from_slice(&input) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(
                            stdout,
                            "{}",
                            error_envelope(&format!("Invalid JSON: {e}"), Value::Null)
                        )
                        .map_err(|e| e.to_string())?;
                        stdout.flush().map_err(|e| e.to_string())?;
                        continue;
                    }
                };
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let valid = request.is_object()
                    && request.as_object().is_some_and(|v| {
                        v.keys()
                            .all(|k| ["id", "command", "args"].contains(&k.as_str()))
                    })
                    && request.get("args").is_none_or(|v| v.is_object());
                let response = if !valid {
                    error_envelope(
                        "Invalid session request; use only id, command and object args",
                        id,
                    )
                } else if let Some(command) = request["command"].as_str() {
                    match invoke(command, request.get("args").cloned().unwrap_or(json!({}))) {
                        Ok(value) => json!({"ok":true,"id":id,"result":value}),
                        Err(e) => error_envelope(&e, id),
                    }
                } else {
                    error_envelope("Invalid command: expected a string", id)
                };
                writeln!(stdout, "{response}").map_err(|e| e.to_string())?;
                stdout.flush().map_err(|e| e.to_string())?;
            }
            if let Some(path) = save {
                invoke("save", json!({"path":path,"overwrite":false}))?;
            }
            return Ok(());
        }
        Command::Batch { file, output } => {
            let input = read_json(&file)?;
            let args = if input.is_array() {
                json!({"operations":input})
            } else {
                input
            };
            let result = invoke("batch", args)?;
            if let Some(path) = output {
                invoke("save", json!({"path":path,"overwrite":false}))?;
            }
            result
        }
        Command::Schema { .. } | Command::Agent { .. } => unreachable!(),
        Command::DemoExport { path } => {
            json!({"exported":crate::project::export_csv(&path,crate::demo::dataset().events.into_iter())?})
        }
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&if cli.json {
            json!({"ok":true,"result":result})
        } else {
            result
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}
fn read_json(path: &std::path::Path) -> Result<Value, String> {
    use std::io::Read;
    let mut bytes = vec![];
    if path == std::path::Path::new("-") {
        std::io::stdin()
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
    } else {
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("JSON arguments exceed 4 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid JSON: {e}"))
}
fn error_envelope(message: &str, id: Value) -> Value {
    json!({"ok":false,"id":id,"error":{"code":crate::mcp::error_code(message),"message":message}})
}
pub fn main() {
    let machine = std::env::args().any(|a| a == "--json");
    if let Err(error) = run() {
        if machine {
            println!("{}", error_envelope(&error, Value::Null));
        } else {
            eprintln!("{error}");
        }
        let code = match crate::mcp::error_code(&error) {
            "INVALID_ARGUMENT" => 2,
            "CONFLICT" => 3,
            "SCOPE_DENIED" => 4,
            "CANCELLED" => 5,
            "RESOURCE_LIMIT" => 6,
            "NOT_FOUND" => 7,
            _ => 1,
        };
        std::process::exit(code);
    }
}

fn write_capture(path: &std::path::Path, result: &Value, overwrite: bool) -> Result<Value, String> {
    use base64::Engine as _;
    use std::io::Write;
    let data = result["data_url"]
        .as_str()
        .and_then(|s| s.strip_prefix("data:image/png;base64,"))
        .ok_or("Invalid PNG capture response")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid PNG base64")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid PNG signature".into());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if overwrite {
        crate::persistence::persist(temp, path)?;
    } else {
        temp.persist_noclobber(path).map_err(|e| e.to_string())?;
    }
    Ok(
        json!({"saved":path,"bytes":bytes.len(),"mime_type":"image/png","target":result["target"],"window":result["window"]}),
    )
}
