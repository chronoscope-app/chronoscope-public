//! Small, bounded recognizer for WGS84 WKT1 .prj definitions. This is not a
//! reprojection engine: projected, ambiguous and extended definitions fail closed.
#[derive(Debug)]
enum Item {
    Text(String),
    Number(f64),
    Word(String),
    Node(String, Vec<Item>),
}
struct Parser<'a> {
    text: &'a [u8],
    pos: usize,
    nodes: usize,
}
impl Parser<'_> {
    fn space(&mut self) {
        while self.text.get(self.pos).is_some_and(u8::is_ascii_whitespace) {
            self.pos += 1;
        }
    }
    fn item(&mut self, depth: usize) -> Result<Item, String> {
        self.nodes += 1;
        if depth > 16 || self.nodes > 256 {
            return Err("CRS definition is too complex".into());
        }
        self.space();
        if self.text.get(self.pos) == Some(&b'"') {
            self.pos += 1;
            let mut out = Vec::new();
            loop {
                let b = *self.text.get(self.pos).ok_or("Unterminated CRS string")?;
                self.pos += 1;
                if b == b'"' {
                    if self.text.get(self.pos) == Some(&b'"') {
                        self.pos += 1;
                        out.push(b);
                    } else {
                        break;
                    }
                } else {
                    out.push(b);
                }
            }
            return Ok(Item::Text(
                String::from_utf8(out).map_err(|_| "CRS strings must be UTF-8")?,
            ));
        }
        let start = self.pos;
        while self
            .text
            .get(self.pos)
            .is_some_and(|b| b.is_ascii_alphanumeric() || b"_+-.".contains(b))
        {
            self.pos += 1;
        }
        if self.pos == start {
            return Err("Invalid CRS token".into());
        }
        let token =
            std::str::from_utf8(&self.text[start..self.pos]).map_err(|_| "Invalid CRS token")?;
        self.space();
        if self.text.get(self.pos) == Some(&b'[') {
            self.pos += 1;
            let mut items = Vec::new();
            loop {
                items.push(self.item(depth + 1)?);
                self.space();
                match self.text.get(self.pos) {
                    Some(b',') => self.pos += 1,
                    Some(b']') => {
                        self.pos += 1;
                        break;
                    }
                    _ => return Err("Invalid CRS brackets".into()),
                }
            }
            Ok(Item::Node(token.to_ascii_uppercase(), items))
        } else if let Ok(n) = token.parse::<f64>() {
            if !n.is_finite() {
                return Err("Nonfinite CRS parameter".into());
            }
            Ok(Item::Number(n))
        } else {
            Ok(Item::Word(token.to_ascii_uppercase()))
        }
    }
}
fn node<'a>(items: &'a [Item], name: &str) -> Result<&'a [Item], String> {
    let nodes: Vec<_> = items
        .iter()
        .filter_map(|i| match i {
            Item::Node(n, v) if n == name => Some(v.as_slice()),
            _ => None,
        })
        .collect();
    if nodes.len() != 1 {
        return Err(format!("CRS requires exactly one {name}"));
    }
    Ok(nodes[0])
}
fn number(items: &[Item], index: usize, expected: f64, tolerance: f64) -> bool {
    matches!(items.get(index), Some(Item::Number(n)) if (*n-expected).abs() <= tolerance)
}
fn allowed(items: &[Item], names: &[&str]) -> bool {
    items
        .iter()
        .skip(1)
        .all(|i| matches!(i, Item::Node(n, _) if names.contains(&n.as_str())))
}
pub(super) fn wgs84(bytes: &[u8]) -> Result<(), String> {
    let reject = "Shapefile requires a WGS84 longitude/latitude WKT1 .prj file; reproject or export to EPSG:4326 before importing";
    if bytes.len() > 32768 {
        return Err(reject.into());
    }
    let mut parser = Parser {
        text: bytes,
        pos: 0,
        nodes: 0,
    };
    let parsed = parser.item(0).map_err(|e| format!("{reject}: {e}"))?;
    parser.space();
    let Item::Node(root, items) = parsed else {
        return Err(reject.into());
    };
    if root != "GEOGCS"
        || parser.pos != bytes.len()
        || !matches!(items.first(), Some(Item::Text(_)))
        || !allowed(&items, &["DATUM", "PRIMEM", "UNIT", "AUTHORITY", "AXIS"])
    {
        return Err(reject.into());
    }
    let authorities: Vec<_> = items
        .iter()
        .filter_map(|i| match i {
            Item::Node(n, v) if n == "AUTHORITY" => Some(v),
            _ => None,
        })
        .collect();
    if authorities.len()>1 || authorities.iter().any(|a| !matches!(a.as_slice(), [Item::Text(org),Item::Text(code)] if org.eq_ignore_ascii_case("EPSG") && code=="4326" || org.eq_ignore_ascii_case("OGC") && code.eq_ignore_ascii_case("CRS84"))) {
        return Err(reject.into());
    }
    let datum = node(&items, "DATUM")?;
    let name = match datum.first() {
        Some(Item::Text(n)) => n
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
            .to_ascii_uppercase(),
        _ => return Err(reject.into()),
    };
    if !["WGS84", "WGS1984", "DWGS1984", "WORLDGEODETICSYSTEM1984"].contains(&name.as_str())
        || !allowed(datum, &["SPHEROID", "AUTHORITY", "TOWGS84"])
    {
        return Err(reject.into());
    }
    let spheroid = node(datum, "SPHEROID")?;
    let prime = node(&items, "PRIMEM")?;
    let unit = node(&items, "UNIT")?;
    if !number(spheroid, 1, 6378137., 1e-8)
        || !number(spheroid, 2, 298.257223563, 1e-9)
        || !number(prime, 1, 0., 1e-15)
        || !number(unit, 1, std::f64::consts::PI / 180., 1e-15)
        || spheroid
            .iter()
            .skip(3)
            .any(|i| !matches!(i, Item::Node(n, _) if n=="AUTHORITY"))
        || prime
            .iter()
            .skip(2)
            .any(|i| !matches!(i, Item::Node(n, _) if n=="AUTHORITY"))
        || unit
            .iter()
            .skip(2)
            .any(|i| !matches!(i, Item::Node(n, _) if n=="AUTHORITY"))
    {
        return Err(reject.into());
    }
    let shifts: Vec<_> = datum
        .iter()
        .filter_map(|i| match i {
            Item::Node(n, v) if n == "TOWGS84" => Some(v),
            _ => None,
        })
        .collect();
    if shifts.len() > 1
        || shifts.iter().any(|v| {
            ![3, 7].contains(&v.len()) || v.iter().any(|i| !matches!(i,Item::Number(n) if *n==0.))
        })
    {
        return Err(reject.into());
    }
    let axes: Vec<_> = items
        .iter()
        .filter_map(|i| match i {
            Item::Node(n, v) if n == "AXIS" => Some(v),
            _ => None,
        })
        .collect();
    if !axes.is_empty()
        && (axes.len() != 2
            || !matches!(axes[0].get(1),Some(Item::Word(n)) if n=="EAST")
            || !matches!(axes[1].get(1),Some(Item::Word(n)) if n=="NORTH"))
    {
        return Err(reject.into());
    }
    Ok(())
}
