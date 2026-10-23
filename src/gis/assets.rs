use super::*;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
};
const ALLOWED: &[&str] = &[
    "kml", "kmz", "czml", "geojson", "topojson", "gpx", "json", "gltf", "glb", "bin", "png", "jpg",
    "jpeg", "gif", "webp", "svg", "ktx", "ktx2", "basis", "b3dm", "i3dm", "pnts", "cmpt",
    "subtree", "terrain", "vctr", "geom", "shp", "shx", "dbf", "prj", "cpg", "gpkg",
];
fn bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = vec![];
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("GIS file exceeds size budget".into());
    }
    Ok(bytes)
}
fn hash(path: &Path) -> Result<String, String> {
    let mut sha = Sha256::new();
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut b = [0u8; 65536];
    loop {
        let n = f.read(&mut b).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        sha.update(&b[..n]);
        crate::operation::check()?;
    }
    Ok(format!("{:x}", sha.finalize()))
}
fn urls(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                if ["uri", "url", "image", "gltf"].contains(&key.as_str()) {
                    if let Some(s) = value.as_str() {
                        out.push(s.into());
                    }
                }
                urls(value, out);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                urls(value, out);
            }
        }
        _ => {}
    }
}
fn references(path: &Path) -> Result<Vec<String>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut out = vec![];
    if ["json", "czml", "gltf"].contains(&ext.as_str()) {
        let data = bounded(path, MAX_SOURCE)?;
        let v: serde_json::Value = serde_json::from_slice(&data)
            .map_err(|e| format!("Invalid GIS companion JSON: {e}"))?;
        urls(&v, &mut out);
    } else if ext == "kml" {
        let data = bounded(path, MAX_SOURCE)?;
        let text = std::str::from_utf8(&data).map_err(|_| "KML must be UTF-8")?;
        let xml = roxmltree::Document::parse(text).map_err(|e| e.to_string())?;
        for n in xml
            .descendants()
            .filter(|n| n.is_element() && matches!(n.tag_name().name(), "href" | "styleUrl"))
        {
            if let Some(s) = n.text() {
                out.push(s.trim().into());
            }
        }
    } else if ["glb", "b3dm", "i3dm", "cmpt"].contains(&ext.as_str()) {
        let data = bounded(path, MAX_ASSET)?;
        // A GLB may be a direct model or embedded in a legacy 3D Tiles payload.
        // Read only bounded valid JSON chunks; embedded BIN chunks are not interpreted as paths.
        for (index, magic) in data.windows(4).enumerate() {
            if magic == b"glTF"
                && index + 20 <= data.len()
                && u32::from_le_bytes(data[index + 4..index + 8].try_into().unwrap()) == 2
            {
                let n =
                    u32::from_le_bytes(data[index + 12..index + 16].try_into().unwrap()) as usize;
                if n <= MAX_SOURCE as usize
                    && data.get(index + 16..index + 20) == Some(b"JSON")
                    && index + 20 + n <= data.len()
                {
                    if let Ok(v) = serde_json::from_slice(&data[index + 20..index + 20 + n]) {
                        urls(&v, &mut out);
                    }
                }
            }
        }
        if ext == "i3dm"
            && data.len() >= 32
            && u32::from_le_bytes(data[28..32].try_into().unwrap()) == 0
        {
            let mut start = 32usize;
            for offset in [12, 16, 20, 24] {
                start = start.saturating_add(u32::from_le_bytes(
                    data[offset..offset + 4].try_into().unwrap(),
                ) as usize);
            }
            if start < data.len() {
                if let Ok(uri) = std::str::from_utf8(&data[start..]) {
                    out.push(uri.trim_matches(['\0', ' ', '\n', '\r']).into());
                }
            }
        }
    }
    Ok(out)
}
fn collect_template(
    dir: &Path,
    root: &Path,
    prefix: &str,
    suffix: &str,
    out: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<(), String> {
    if depth > 24 {
        return Err("GIS directory depth exceeds 24".into());
    }
    for item in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        crate::operation::check()?;
        let item = item.map_err(|e| e.to_string())?;
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_template(&item.path(), root, prefix, suffix, out, depth + 1)?;
        } else if kind.is_file() {
            let path = item.path();
            let name = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if name.starts_with(prefix) && name.ends_with(suffix) {
                out.push(path);
                if out.len() > MAX_FILES {
                    return Err("GIS template exceeds 8192 files".into());
                }
            }
        }
    }
    Ok(())
}
fn collect(entry: &Path, warnings: &mut Vec<String>) -> Result<BTreeMap<String, PathBuf>, String> {
    let root = entry.parent().ok_or("GIS source has no directory")?;
    let mut files = BTreeMap::new();
    let mut queue = vec![entry.to_owned()];
    let mut total = 0u64;
    while let Some(path) = queue.pop() {
        crate::operation::check()?;
        let path = path
            .canonicalize()
            .map_err(|e| format!("Missing GIS companion {}: {e}", path.display()))?;
        if !path.starts_with(root) {
            return Err("GIS companion paths must remain inside the source directory".into());
        }
        let name = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if !safe_name(&name) {
            return Err("Invalid GIS companion filename".into());
        }
        if files.contains_key(&name) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !ALLOWED.contains(&ext.as_str()) {
            return Err(format!("Unsupported GIS companion type: {ext}"));
        }
        let meta = path.metadata().map_err(|e| e.to_string())?;
        total = total.checked_add(meta.len()).ok_or("GIS size overflow")?;
        if !meta.is_file()
            || meta.len() > MAX_ASSET
            || total > MAX_PACKAGE
            || files.len() >= MAX_FILES
        {
            return Err("GIS package exceeds file/size budgets".into());
        }
        files.insert(name, path.clone());
        for uri in references(&path)? {
            if uri.is_empty() || uri.starts_with('#') || uri.starts_with("data:") {
                continue;
            }
            if uri.contains(':') || uri.starts_with('/') || uri.contains('\\') {
                if !warnings.iter().any(|w| w.starts_with("External GIS")) {
                    warnings.push("External GIS URLs are retained in the source but are not fetched; package linked assets locally.".into());
                }
                continue;
            }
            let uri = uri.split(['?', '#']).next().unwrap();
            let base =
                reqwest::Url::from_file_path(&path).map_err(|_| "Invalid GIS source path")?;
            let resolved = base.join(uri).map_err(|_| "Invalid GIS resource URI")?;
            let target = resolved
                .to_file_path()
                .map_err(|_| "Invalid GIS resource URI")?;
            if uri.contains('{') {
                let text = target
                    .strip_prefix(root)
                    .map_err(|_| "GIS tile template escapes source directory")?
                    .to_string_lossy()
                    .replace('\\', "/");
                let prefix = text.split('{').next().unwrap();
                let suffix = text.rsplit('}').next().unwrap();
                let parent = prefix
                    .rsplit_once('/')
                    .map(|(d, _)| root.join(d))
                    .unwrap_or_else(|| root.to_path_buf());
                if parent.is_dir() {
                    collect_template(&parent, root, prefix, suffix, &mut queue, 0)?;
                }
            } else {
                queue.push(target);
            }
        }
    }
    Ok(files)
}
pub fn load(
    path: &Path,
    data_dir: &Path,
    position: Option<[f64; 3]>,
    scale: f64,
) -> Result<Layer, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let meta = path.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_ASSET {
        return Err("GIS input must be a regular file of at most 256 MiB".into());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let probe = if ext == "glb" {
        bounded(&path, MAX_ASSET)?
    } else {
        bounded(&path, MAX_SOURCE)?
    };
    let format = super::format(&path, &probe)?;
    let prepared = if matches!(ext.as_str(), "shp" | "gpkg") {
        Some(super::vector::prepare(&path, &probe)?)
    } else {
        None
    };
    let document = prepared
        .as_ref()
        .map(|p| p.document.as_slice())
        .unwrap_or(&probe);
    let root = data_dir.join("gis-assets");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(&root).map_err(|e| e.to_string())?;
    let mut entrypoint;
    let features;
    let mut warnings = prepared
        .as_ref()
        .map(|p| p.warnings.clone())
        .unwrap_or_default();
    let count;
    {
        let mut zip = zip::ZipWriter::new(&mut tmp);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(0o600);
        if format == Format::Kmz {
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&probe))
                .map_err(|e| format!("Invalid KMZ: {e}"))?;
            if archive.len() > MAX_FILES {
                return Err("KMZ exceeds 8192 entries".into());
            }
            let mut names = std::collections::BTreeSet::new();
            let mut total = 0u64;
            let mut kml = vec![];
            for i in 0..archive.len() {
                let mut item = archive.by_index(i).map_err(|e| e.to_string())?;
                if item.is_dir() {
                    continue;
                }
                let name = item.name().map_err(|e| e.to_string())?.into_owned();
                if !safe_name(&name) || item.is_symlink() || !names.insert(name.clone()) {
                    return Err("Invalid or duplicate KMZ resource path".into());
                }
                total = total.checked_add(item.size()).ok_or("KMZ size overflow")?;
                if item.size() > MAX_ASSET || total > MAX_PACKAGE {
                    return Err("Expanded KMZ exceeds size budget".into());
                }
                let mut data = vec![];
                item.by_ref()
                    .take(MAX_ASSET + 1)
                    .read_to_end(&mut data)
                    .map_err(|e| e.to_string())?;
                if data.len() as u64 != item.size() {
                    return Err("Invalid KMZ resource size".into());
                }
                if name.to_ascii_lowercase().ends_with(".kml") {
                    if data.len() as u64 > MAX_SOURCE {
                        return Err("KMZ KML exceeds 64 MiB".into());
                    }
                    kml.push((name.clone(), data.clone()));
                }
                zip.start_file(&name, opts).map_err(|e| e.to_string())?;
                zip.write_all(&data).map_err(|e| e.to_string())?;
            }
            kml.sort_by_key(|(n, _)| (!n.eq_ignore_ascii_case("doc.kml"), n.clone()));
            let (name, doc) = kml.first().ok_or("KMZ has no KML document")?;
            entrypoint = name.clone();
            features = normalize::parse(&Format::Kml, doc, &mut warnings)?;
            count = names.len();
        } else {
            entrypoint = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid GIS filename")?
                .to_owned();
            if !safe_name(&entrypoint) {
                return Err("Invalid GIS filename".into());
            }
            features = normalize::parse(&format, document, &mut warnings)?;
            let files = if prepared.is_some() {
                BTreeMap::new()
            } else if format.is_3d() || matches!(format, Format::Czml | Format::Kml) {
                collect(&path, &mut warnings)?
            } else {
                BTreeMap::from([(entrypoint.clone(), path.clone())])
            };
            if !files.contains_key(&entrypoint)
                && !prepared
                    .as_ref()
                    .is_some_and(|p| p.sources.contains_key(&entrypoint))
            {
                return Err("GIS entrypoint is missing from its package".into());
            }
            let normalized = normalize::render_json(&format, document, &features)?;
            let render_name = format!(
                "_chronoscope_render.{}",
                if format == Format::Topojson {
                    "topojson"
                } else {
                    "geojson"
                }
            );
            if normalized.is_some() && files.contains_key(&render_name) {
                return Err(
                    "Source uses a reserved normalized GIS filename; rename it before importing"
                        .into(),
                );
            }
            count = files.len()
                + prepared.as_ref().map_or(0, |p| p.sources.len())
                + usize::from(normalized.is_some());
            if let Some(prepared) = &prepared {
                for (name, bytes) in &prepared.sources {
                    if !safe_name(name) || name == &render_name {
                        return Err("Invalid or reserved vector companion filename".into());
                    }
                    crate::operation::check()?;
                    zip.start_file(name, opts).map_err(|e| e.to_string())?;
                    zip.write_all(bytes).map_err(|e| e.to_string())?;
                }
            }
            for (name, file) in files {
                crate::operation::check()?;
                zip.start_file(&name, opts).map_err(|e| e.to_string())?;
                let copied = std::io::copy(
                    &mut File::open(file)
                        .map_err(|e| e.to_string())?
                        .take(MAX_ASSET + 1),
                    &mut zip,
                )
                .map_err(|e| e.to_string())?;
                if copied > MAX_ASSET {
                    return Err("GIS companion grew beyond size budget".into());
                }
            }
            if let Some(normalized) = normalized {
                zip.start_file(&render_name, opts)
                    .map_err(|e| e.to_string())?;
                zip.write_all(&normalized).map_err(|e| e.to_string())?;
                entrypoint = render_name;
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    tmp.flush().map_err(|e| e.to_string())?;
    if tmp.as_file().metadata().map_err(|e| e.to_string())?.len() > MAX_PACKAGE {
        return Err("GIS package exceeds 512 MiB".into());
    }
    let sha256 = hash(tmp.path())?;
    let asset = root.join(format!("{sha256}.cga"));
    if !asset.exists() {
        tmp.persist(&asset).map_err(|e| e.to_string())?;
    }
    let (bounds, time_bounds) = normalize::bounds(&features);
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let layer = Layer {
        id: random.iter().map(|b| format!("{b:02x}")).collect(),
        name: path.file_name().unwrap().to_string_lossy().into(),
        format,
        source_format: match ext.as_str() {
            "shp" => Some(SourceFormat::Shapefile),
            "gpkg" => Some(SourceFormat::Geopackage),
            _ => None,
        },
        enabled: true,
        selected: Vec::new(),
        bytes: asset.metadata().map_err(|e| e.to_string())?.len(),
        asset,
        sha256,
        entrypoint,
        resource_count: count,
        feature_count: features.len(),
        bounds,
        time_bounds,
        position,
        scale,
        warnings,
    };
    layer.validate()?;
    Ok(layer)
}
/// Check the effective file capability before opening or hashing an external
/// package. Portable extracted assets and the app's own immutable cache are trusted.
pub(crate) fn validate_scoped_package(
    layer: &Layer,
    data_dir: &Path,
    root: Option<&Path>,
    extracted: Option<&Path>,
) -> Result<(), String> {
    let asset = layer
        .asset
        .canonicalize()
        .map_err(|e| format!("Missing GIS resource {}: {e}", layer.name))?;
    let within = |root: &Path| {
        root.canonicalize()
            .ok()
            .is_some_and(|root| asset.starts_with(root))
    };
    if root.is_some_and(|root| {
        !within(root) && !within(&data_dir.join("gis-assets")) && !extracted.is_some_and(within)
    }) {
        return Err("SCOPE_DENIED: GIS resource is outside the permitted file root".into());
    }
    validate_package(layer)
}

pub fn validate_package(layer: &Layer) -> Result<(), String> {
    layer.validate()?;
    let size = layer
        .asset
        .metadata()
        .map_err(|e| format!("Missing GIS resource: {e}"))?
        .len();
    if size != layer.bytes || hash(&layer.asset)? != layer.sha256 {
        return Err("GIS package checksum mismatch".into());
    }
    let mut zip = zip::ZipArchive::new(File::open(&layer.asset).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if zip.len() != layer.resource_count {
        return Err("GIS resource count mismatch".into());
    }
    let mut names = std::collections::BTreeSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().map_err(|e| e.to_string())?.into_owned();
        total = total.checked_add(entry.size()).ok_or("GIS size overflow")?;
        if entry.compression() != zip::CompressionMethod::Stored
            || entry.is_dir()
            || entry.is_symlink()
            || !safe_name(&name)
            || !names.insert(name)
            || entry.size() > MAX_ASSET
            || total > MAX_PACKAGE
        {
            return Err("Invalid GIS asset archive".into());
        }
    }
    if !names.contains(&layer.entrypoint) {
        return Err("GIS entrypoint missing".into());
    }
    Ok(())
}
pub fn read(
    layer: &Layer,
    name: &str,
    offset: u64,
    limit: usize,
) -> Result<serde_json::Value, String> {
    if !safe_name(name) || !(1..=1024 * 1024).contains(&limit) {
        return Err("Invalid GIS asset request".into());
    }
    let mut zip = zip::ZipArchive::new(File::open(&layer.asset).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let entry = zip.by_name(name).map_err(|_| {
        "GIS resource not packaged; external URLs and paths outside the package are unavailable"
    })?;
    if entry.compression() != zip::CompressionMethod::Stored
        || entry.size() > MAX_ASSET
        || offset > entry.size()
    {
        return Err("Invalid GIS asset range".into());
    }
    let total = entry.size();
    let start = entry.data_start().ok_or("Missing GIS asset data offset")?;
    let start = start
        .checked_add(offset)
        .ok_or("GIS asset range overflow")?;
    let len = ((total - offset) as usize).min(limit);
    drop(entry);
    drop(zip);
    let mut file = File::open(&layer.asset).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![0u8; len];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"data":base64::engine::general_purpose::STANDARD.encode(bytes),"offset":offset,"total":total,"mime":mime(name)}),
    )
}
pub(super) fn document(layer: &Layer) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(File::open(&layer.asset).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let entry = zip.by_name(&layer.entrypoint).map_err(|e| e.to_string())?;
    let mut bytes = vec![];
    entry
        .take(MAX_SOURCE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_SOURCE {
        return Err("GIS document exceeds 64 MiB".into());
    }
    Ok(bytes)
}
pub fn features(layer: &Layer) -> Result<Vec<Feature>, String> {
    normalize::parse(&layer.format, &document(layer)?, &mut vec![])
}
